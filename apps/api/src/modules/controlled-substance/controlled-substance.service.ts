import { Injectable, NotFoundException, BadRequestException, ConflictException, Optional, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ControlledSubstanceStockService } from './controlled-substance-stock.service';
import { dayRange, parseLocalDate, localDateKey, todayRange } from '../../common/day-range';
import {
  NIMS_CHANNEL, NIMS_STATUS, RESUBMITTABLE_NIMS_STATUSES,
  classifyNimsTransmission, localNimsBatchNo, localNimsRef, notTransmittedNimsLog,
  nimsChannelNotice, transmitNims,
} from './nims-reporting';

/** 원장 화면이 사람 칸(처방의·확인자·불출자·투약자·폐기 증인)에 쓰는 최소 정보 */
export interface StaffBrief { id: string; familyName: string; givenName: string; role: string }

/** 일일 마약류 원장 한 줄(약품×등급×단위) — 화면 7열의 정본 */
export interface DailyLedgerRow {
  drugName: string; schedule: string; narcoticType: string | null; unit: string;
  prescribed: number; dispensed: number; administered: number; wasted: number;
  /** 🔴 폐기량 미기재가 섞이면 `null`(산출 불가) — 0 으로 채우지 않는다 */
  remaining: number | null;
  count: number;
  /** 투여량 미기재라 불출량을 투약량으로 본 건수(NIMS 보고와 같은 규칙) */
  assumedFullDose: number;
  /** 폐기량 미기재 건수 — 있으면 잔량은 산출 불가 */
  wastedQtyUnknown: number;
  notes: string[];
}

/** 원장 행에 들어 있는 사람 참조(전부 User.id) */
interface LogStaffIds {
  prescribedBy: string;
  verifiedBy?: string | null;
  dispensedBy?: string | null;
  administeredBy?: string | null;
  wasteWitness?: string | null;
}

@Injectable()
export class ControlledSubstanceService {
  private readonly logger = new Logger(ControlledSubstanceService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly stock?: ControlledSubstanceStockService,
  ) {}

  /**
   * 🔴 원장 화면의 사람 칸이 영구 공란이던 것 — `getLogs` 가 관계를 하나도 싣지 않았다.
   * 확인자·불출자·투약자·폐기 증인은 스키마상 **관계가 없는 Uuid 컬럼**이라 `include` 로 못 실는다.
   * (스키마 수정은 이 작업 범위 밖 → 한 번의 배치 조회로 채운다. N+1 아님.)
   */
  private async hydrateStaff<T extends LogStaffIds>(logs: T[]) {
    const ids = new Set<string>();
    for (const l of logs) {
      for (const v of [l.prescribedBy, l.verifiedBy, l.dispensedBy, l.administeredBy, l.wasteWitness]) {
        if (v) ids.add(v);
      }
    }
    const users = ids.size
      ? await this.prisma.user.findMany({
          where: { id: { in: [...ids] } },
          select: { id: true, familyName: true, givenName: true, role: true },
        })
      : [];
    const m = new Map<string, StaffBrief>(
      users.map((u) => [u.id, { id: u.id, familyName: u.familyName, givenName: u.givenName, role: String(u.role) }]),
    );
    const at = (v?: string | null): StaffBrief | null => (v ? m.get(v) ?? null : null);
    return logs.map((l) => ({
      ...l,
      prescriber: at(l.prescribedBy),
      verifier: at(l.verifiedBy),
      dispenser: at(l.dispensedBy),
      administrator: at(l.administeredBy),
      witness: at(l.wasteWitness),
    }));
  }

  /** 마약류 상태 전이를 원자적으로 — 동시 요청 이중발생(이중 조제·투약) 방지.
   *  현재 상태가 fromStatus인 경우에만 전이. count 0이면 이미 처리됨(Conflict). */
  private async atomicTransition(id: string, fromStatus: string, data: Prisma.ControlledSubstanceLogUpdateManyMutationInput, notFoundMsg = '이미 처리되었거나 상태가 맞지 않습니다') {
    const upd = await this.prisma.controlledSubstanceLog.updateMany({ where: { id, status: fromStatus }, data });
    if (upd.count === 0) throw new ConflictException(notFoundMsg);
    return this.prisma.controlledSubstanceLog.findUnique({ where: { id } });
  }

  /**
   * NIMS 취급보고 아웃박스 적재(식약처 마약류통합관리시스템). 실제 전송은 별도(스텁).
   *
   * 🔴 (2026-09-16 K2) 종전엔 실패를 `warn` 한 줄로 삼키고 끝냈다("best-effort, 실패해도 임상흐름 무영향").
   *    임상흐름을 막지 않는 판단은 옳다 — 원장 전이는 이미 커밋됐고 여기서 던지면 사용자는 **성공한 일을
   *    실패로 본다**. 틀린 것은 그 다음이었다: 적재가 실패하면 **법정 보고가 사라지는데 아무 데도 남지
   *    않았다.** 게다가 전이 가드(`atomicTransition`)가 재시도를 막아 다시 시도할 길도 없었다.
   *    이제 ① 실패는 `error` 로 말하고(누락은 경고가 아니다) ② 결과를 돌려주며
   *    ③ 누락은 원장과 대조해 `getNimsQueue` 가 세고 `reenqueueMissingNims()` 로 다시 담을 수 있다.
   *
   * 🔴 같은 사건을 두 번 보고하지 않는다 — (reportType, refId) 가 자연키다(법정 보고 중복도 사고다).
   *    스키마에 유니크가 없어 선검사로 막는다. 동시 호출 경합은 남지만, 호출부가 전부
   *    `atomicTransition` 뒤라 같은 사건이 두 번 흐르지 않는다(재적재만 이 검사에 걸린다).
   */
  private async enqueueNims(evt: { reportType: string; refId?: string; drugCode?: string | null; drugName: string; narcoticType?: string | null; quantity: number; unit: string; eventAt: Date; payload: Record<string, unknown> }): Promise<{ recorded: boolean; reason?: 'DUPLICATE' | 'WRITE_FAILED' }> {
    try {
      if (evt.refId) {
        const dup = await this.prisma.nimsReport.count({ where: { reportType: evt.reportType, refId: evt.refId } });
        if (dup > 0) return { recorded: false, reason: 'DUPLICATE' };
      }
      await this.prisma.nimsReport.create({
        data: {
          reportType: evt.reportType, refId: evt.refId, drugCode: evt.drugCode ?? undefined,
          drugName: evt.drugName, narcoticType: evt.narcoticType ?? undefined,
          quantity: evt.quantity, unit: evt.unit, eventAt: evt.eventAt, payload: evt.payload as Prisma.InputJsonValue,
        },
      });
      return { recorded: true };
    } catch (e) {
      this.logger.error(`NIMS 취급보고 적재 실패 — 법정 보고가 남지 않았다(${evt.reportType}/${evt.refId ?? '-'}/${evt.drugName}): ${e instanceof Error ? e.message : String(e)}`);
      return { recorded: false, reason: 'WRITE_FAILED' };
    }
  }

  /**
   * 원장은 전이됐는데 보고 행이 없는 건 — **누락 탐지**.
   * 상태는 마지막 것만 남으므로 시각 필드로 판정한다(ADMINISTERED 인 원장도 DISPENSE 보고가 있어야 한다).
   */
  private async findMissingNims(limit = 500) {
    const logs = await this.prisma.controlledSubstanceLog.findMany({
      where: { OR: [{ dispensedAt: { not: null } }, { administeredAt: { not: null } }, { status: 'WASTED' }] },
      orderBy: { prescribedAt: 'desc' },
      take: limit,
    });
    if (logs.length === 0) return [];
    const reports = await this.prisma.nimsReport.findMany({
      where: { refId: { in: logs.map((l) => l.id) } },
      select: { refId: true, reportType: true },
    });
    const have = new Set(reports.map((r) => `${r.reportType}:${r.refId}`));
    const missing: { logId: string; reportType: string; drugName: string; eventAt: Date }[] = [];
    for (const l of logs) {
      const expected: [string, Date | null][] = [
        ['DISPENSE', l.dispensedAt],
        ['ADMINISTER', l.administeredAt],
        ['WASTE', l.status === 'WASTED' ? (l.administeredAt ?? l.dispensedAt ?? l.prescribedAt) : null],
      ];
      for (const [reportType, at] of expected) {
        if (!at) continue;
        if (!have.has(`${reportType}:${l.id}`)) missing.push({ logId: l.id, reportType, drugName: l.drugName, eventAt: at });
      }
    }
    return missing;
  }

  /**
   * 누락된 보고를 다시 담는다(재시도 경로). 원장에 남은 사실만 옮기고 값을 지어내지 않는다.
   * 🔴 전송이 아니라 **적재**다 — 실제 식약처 전송은 배치·수기 접수 경로가 따로 판정한다.
   */
  async reenqueueMissingNims(userId?: string): Promise<{ missing: number; requeued: number; failed: number }> {
    const missing = await this.findMissingNims();
    let requeued = 0;
    let failed = 0;
    for (const m of missing) {
      const log = await this.prisma.controlledSubstanceLog.findUnique({ where: { id: m.logId } });
      if (!log) { failed += 1; continue; }
      const r = await this.enqueueNims({
        reportType: m.reportType, refId: log.id, drugCode: log.drugCode, drugName: log.drugName,
        narcoticType: log.narcoticType, quantity: Number(log.administeredQty ?? log.quantity), unit: log.unit,
        eventAt: m.eventAt, payload: { patientId: log.patientId, requeuedBy: userId ?? null, via: 'reenqueueMissingNims' },
      });
      if (r.recorded) requeued += 1;
      else if (r.reason === 'WRITE_FAILED') failed += 1;
    }
    return { missing: missing.length, requeued, failed };
  }

  async prescribe(data: Record<string, unknown>) {
    if (!data.patientId || !data.drugName || !data.deaSchedule || !data.quantity || !data.unit || !data.prescribedBy) {
      throw new BadRequestException('필수 항목: patientId, drugName, deaSchedule, quantity, unit, prescribedBy');
    }

    return this.prisma.controlledSubstanceLog.create({
      data: {
        patientId: data.patientId as string,
        prescriptionId: data.prescriptionId as string | undefined, // CPOE 처방 링크(자동발행 시 필수적 추적키)
        drugName: data.drugName as string,
        drugCode: data.drugCode as string | undefined,
        deaSchedule: data.deaSchedule as string,
        // 한국 마약류 분류(NIMS 보고 키) — 마약/향정 + 향정 가·나·다·라
        narcoticType: data.narcoticType as string | undefined,
        psychotropicGroup: data.psychotropicGroup as string | undefined,
        quantity: data.quantity as number,
        unit: data.unit as string,
        prescribedBy: data.prescribedBy as string,
        prescribedAt: new Date(),
        status: 'PRESCRIBED',
        notes: data.notes as string | undefined,
      },
    });
  }

  /**
   * 약국 조제 완료 이벤트(dispensing.completed) 연동 — CPOE 자동발행 원장을 DISPENSED로 전이.
   * 약국 경로는 자체 2인확인(pharmacy.highAlertDoubleCheck)을 거치므로 PRESCRIBED에서도 전이 허용.
   * 수불부 차감은 CS 자체 불출(dispense) 경로 전용 — 약국 재고와 이중차감 방지를 위해 여기선 미수행.
   * 원장 미발행 처방(마약류 아님/과거분)은 no-op.
   */
  async markDispensedByPrescription(prescriptionId: string, dispensedBy?: string) {
    const log = await this.prisma.controlledSubstanceLog.findFirst({
      where: { prescriptionId, status: { in: ['PRESCRIBED', 'VERIFIED'] } },
      orderBy: { prescribedAt: 'desc' },
    });
    if (!log) return null;
    const upd = await this.prisma.controlledSubstanceLog.updateMany({
      where: { id: log.id, status: log.status },
      data: { dispensedBy: dispensedBy ?? log.prescribedBy, dispensedAt: new Date(), status: 'DISPENSED' },
    });
    if (upd.count === 0) return null; // 동시 처리 충돌 — 이미 전이됨
    await this.enqueueNims({
      reportType: 'DISPENSE', refId: log.id, drugCode: log.drugCode, drugName: log.drugName,
      narcoticType: log.narcoticType, quantity: Number(log.quantity), unit: log.unit,
      eventAt: new Date(), payload: { patientId: log.patientId, prescriptionId, via: 'pharmacy.dispensing.completed' },
    });
    return this.prisma.controlledSubstanceLog.findUnique({ where: { id: log.id } });
  }

  async verify(id: string, verifierId: string) {
    const log = await this.prisma.controlledSubstanceLog.findUnique({ where: { id } });
    if (!log) throw new NotFoundException('Record not found');
    if (log.status !== 'PRESCRIBED') throw new BadRequestException('처방 상태에서만 확인 가능합니다.');
    if (log.prescribedBy === verifierId) throw new BadRequestException('처방자와 확인자가 동일할 수 없습니다.');

    return this.atomicTransition(id, 'PRESCRIBED', { verifiedBy: verifierId, verifiedAt: new Date(), status: 'VERIFIED' });
  }

  async dispense(id: string, dispensedBy: string, scanCode?: string) {
    const log = await this.prisma.controlledSubstanceLog.findUnique({ where: { id } });
    if (!log) throw new NotFoundException('Record not found');
    if (log.status !== 'VERIFIED') throw new BadRequestException('확인된 처방만 조제할 수 있습니다.');

    const result = await this.atomicTransition(id, 'VERIFIED', {
      dispensedBy, dispensedAt: new Date(), dispenseScanCode: scanCode || undefined, status: 'DISPENSED',
    }, '이미 조제되었습니다(동시 조제 충돌)');

    // 영속재고 자동 차감(수불부 연동) — 해당 약품 재고가 등록돼 있으면 ISSUE. 재고 미등록/부족은
    // best-effort로 로그만 남기고 조제 자체는 차단하지 않음(수불부 롤아웃 중 조제 흐름 보호).
    if (log.drugCode) {
      try {
        const issued = await this.stock?.issueByDrug(log.drugCode, 'PHARMACY', Number(log.quantity), dispensedBy, id);
        if (!issued) this.logger.warn(`마약재고 자동차감 건너뜀(재고 미등록): ${log.drugName}(${log.drugCode})`);
      } catch (e) {
        this.logger.warn(`마약재고 자동차감 실패(${log.drugName}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await this.enqueueNims({ reportType: 'DISPENSE', refId: id, drugCode: log.drugCode, drugName: log.drugName, narcoticType: log.narcoticType, quantity: Number(log.quantity), unit: log.unit, eventAt: new Date(), payload: { patientId: log.patientId, dispensedBy } });
    return result;
  }

  async administer(id: string, administeredBy: string, administeredQty?: number) {
    const log = await this.prisma.controlledSubstanceLog.findUnique({ where: { id } });
    if (!log) throw new NotFoundException('Record not found');
    if (log.status !== 'DISPENSED') throw new BadRequestException('조제된 약품만 투약할 수 있습니다.');
    if (administeredQty != null) {
      // 🔴 방어 심층 — DTO 가 1차 검증하지만 서비스도 하한/수치를 지킨다(마약류 원장·NIMS 보고에 음수 금지)
      if (!Number.isFinite(administeredQty) || administeredQty <= 0) {
        throw new BadRequestException('투여량은 0보다 큰 수여야 합니다.');
      }
      if (administeredQty > Number(log.quantity)) {
        throw new BadRequestException(`투여량(${administeredQty})이 불출량(${log.quantity})을 초과할 수 없습니다.`);
      }
    }
    const result = await this.atomicTransition(id, 'DISPENSED', { administeredBy, administeredAt: new Date(), status: 'ADMINISTERED', ...(administeredQty != null ? { administeredQty } : {}) }, '이미 투약되었습니다(동시 투약 충돌)');
    await this.enqueueNims({ reportType: 'ADMINISTER', refId: id, drugCode: log.drugCode, drugName: log.drugName, narcoticType: log.narcoticType, quantity: administeredQty ?? Number(log.quantity), unit: log.unit, eventAt: new Date(), payload: { patientId: log.patientId, administeredBy } });
    return result;
  }

  /** 폐기(잔량 포함) — 앰플 부분사용 잔량을 증인 하에 폐기(다이버전 차단). wastedQty=폐기 잔량. */
  async recordWaste(id: string, reason: string, witnessId: string, wastedById?: string, wastedQty?: number) {
    const log = await this.prisma.controlledSubstanceLog.findUnique({ where: { id } });
    if (!log) throw new NotFoundException('Record not found');
    if (!reason) throw new BadRequestException('폐기 사유가 필요합니다.');
    if (!witnessId) throw new BadRequestException('폐기 시 증인이 필요합니다.');
    // 상태 가드 — 조제/투약 단계의 약품만 폐기 가능(미조제 처방·이미 폐기/반납을 폐기로 위장하는 은폐 방지).
    if (!['DISPENSED', 'ADMINISTERED'].includes(log.status)) {
      throw new BadRequestException(`폐기는 조제/투약 상태에서만 가능합니다(현재 ${log.status}).`);
    }
    // 독립 증인 — 폐기 수행자와 증인이 동일할 수 없음(2인 무결성).
    // 🔴 수행자를 모르면 2인 무결성 자체가 성립하지 않는다 → 옵셔널 비교를 걷어낸다.
    if (!wastedById) throw new BadRequestException('폐기 수행자를 확인할 수 없습니다(재로그인 후 시도).');
    if (witnessId === wastedById) {
      throw new BadRequestException('폐기 증인은 폐기 수행자와 달라야 합니다.');
    }
    // 🔴 증인은 **사람(User.id)** 이어야 2인 무결성이 성립한다. 종전 화면은 성명 문자열을 보냈고
    //    서버는 그것을 uuid 로 취급해(wasteWitness 는 @db.Uuid) 위 동일인 비교가 무력화됐다.
    //    (문자열이면 Prisma 가 P2023 으로 터져 폐기 자체가 100% 실패하기도 했다.)
    const witness = await this.prisma.user.findUnique({
      where: { id: witnessId },
      select: { id: true, isActive: true },
    });
    if (!witness || !witness.isActive) throw new BadRequestException('폐기 증인이 유효한 직원이 아닙니다.');
    // 잔량 정합 — 투여량+폐기량이 불출량 초과 불가(부분사용 은폐 다이버전 차단)
    const admin = log.administeredQty != null ? Number(log.administeredQty) : 0;
    if (wastedQty != null && admin + wastedQty > Number(log.quantity) + 1e-6) {
      throw new BadRequestException(`투여량(${admin})+폐기량(${wastedQty})이 불출량(${log.quantity})을 초과합니다.`);
    }

    const result = await this.atomicTransition(id, log.status, {
      wasteReason: reason, wasteWitness: witnessId, status: 'WASTED', ...(wastedQty != null ? { wastedQty } : {}),
    }, '이미 폐기/반납되었습니다');
    await this.enqueueNims({ reportType: 'WASTE', refId: id, drugCode: log.drugCode, drugName: log.drugName, narcoticType: log.narcoticType, quantity: wastedQty ?? Number(log.quantity), unit: log.unit, eventAt: new Date(), payload: { patientId: log.patientId, witnessId, reason } });
    return result;
  }

  // ── 사고마약류(§12) ──
  /**
   * 날짜 파싱(엄격) — `new Date(2026, 12, 99)` 는 던지지 않고 **다음 해로 굴러간다**.
   * 🔴 `2026-13-99` 를 `2027-04-09` 로 조용히 바꿔 읽으면 원장·사고 발생일이 **다른 날짜**가 된다.
   *    날짜만 들어온 경우 되돌려 찍어 같은 날인지 확인한다(다르면 잘못된 입력).
   */
  private parseDayStrict(value?: string | null): Date | null {
    const d = parseLocalDate(value);
    if (!d) return null;
    const s = String(value ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s) && localDateKey(d) !== s) return null;
    return d;
  }

  async reportIncident(dto: { logId?: string; incidentType: string; drugName: string; drugCode?: string; quantity: number; unit: string; occurredAt: string; description: string }, userId: string) {
    if (!['THEFT', 'LOSS', 'DAMAGE', 'DISASTER'].includes(dto.incidentType)) {
      throw new BadRequestException('사고유형은 THEFT/LOSS/DAMAGE/DISASTER 중 하나여야 합니다.');
    }
    // 🔴 `new Date(<쓰레기>)` = Invalid Date → Prisma 500. 사고 보고가 500 으로 사라지면 안 된다.
    //    (`2026-02-31` 처럼 굴러가는 날짜도 거부 — 발생일이 조용히 다른 날이 되면 안 된다.)
    const occurredAt = this.parseDayStrict(dto.occurredAt);
    if (!occurredAt) throw new BadRequestException('발생일시가 올바르지 않습니다.');
    if (occurredAt.getTime() > Date.now() + 60_000) throw new BadRequestException('발생일시가 미래일 수 없습니다.');
    const incident = await this.prisma.controlledSubstanceIncident.create({
      data: { ...dto, occurredAt, reportedBy: userId },
    });
    await this.enqueueNims({ reportType: 'INCIDENT', refId: incident.id, drugCode: dto.drugCode, drugName: dto.drugName, quantity: dto.quantity, unit: dto.unit, eventAt: occurredAt, payload: { incidentType: dto.incidentType, description: dto.description, reportedBy: userId } });
    return incident;
  }

  async getIncidents(status?: string) {
    return this.prisma.controlledSubstanceIncident.findMany({
      where: status ? { status } : {},
      orderBy: { occurredAt: 'desc' },
      include: { reporter: { select: { id: true, familyName: true, givenName: true } } },
    });
  }

  /**
   * 사고마약류 관할 신고 기록(마약류관리법 §12 — 지체 없이 관할 관청 신고).
   * 🔴 여기서 나가는 전송은 없다. **사람이 신고한 사실**을 기록할 뿐이다(그렇게만 말한다).
   */
  async fileIncident(id: string, input: { filedRef?: string; filedAt?: string }, userId?: string) {
    const inc = await this.prisma.controlledSubstanceIncident.findUnique({ where: { id } });
    if (!inc) throw new NotFoundException('사고 보고 없음');
    if (inc.status === 'CLOSED') throw new BadRequestException('종결된 사고 보고입니다');
    const filedAt = parseLocalDate(input.filedAt) ?? new Date();
    if (filedAt.getTime() > Date.now() + 60_000) throw new BadRequestException('신고 시각이 미래일 수 없습니다');
    return this.prisma.controlledSubstanceIncident.update({
      where: { id },
      data: {
        status: 'FILED',
        filedAt,
        description: `${inc.description}\n[관할 신고 기록] ${filedAt.toISOString()} · 기록자 ${userId ?? '미상'}${input.filedRef ? ` · 접수번호 ${input.filedRef}` : ' · 접수번호 미기재'}`,
      },
    });
  }

  // ── NIMS 취급보고 아웃박스 ──
  /**
   * NIMS 큐 — 각 건이 **실제로 나갔는지**를 읽는 쪽에서 판정해 함께 준다.
   * (저장값은 변형하지 않는다 — 레거시 `NIMS-…`/`STUB-…` 는 '전송 근거 없음'으로 읽힌다.)
   */
  async getNimsQueue(status?: string) {
    const rows = await this.prisma.nimsReport.findMany({
      where: status ? { status } : {}, orderBy: { eventAt: 'desc' }, take: 500,
    });
    const items = rows.map((r) => ({ ...r, transmission: classifyNimsTransmission(r) }));
    /**
     * 🔴 (2026-09-16 K2) 큐에 **없는 것**은 큐를 봐서는 영영 모른다 — 적재가 실패하면 행 자체가 없으므로
     *    이 화면은 조용했다. 원장과 대조해 "보고가 남아야 하는데 없는 건"을 함께 센다(재적재는 별도 경로).
     */
    const missing = await this.findMissingNims();
    return {
      items,
      counts: {
        total: items.length,
        /** 식약처에 도달한 근거가 있는 건 */
        transmitted: items.filter((i) => i.transmission.transmitted).length,
        /** 아직 나가지 않은 건 — 배치에 다시 담긴다 */
        notTransmitted: items.filter((i) => !i.transmission.transmitted).length,
        /** 원장은 전이됐는데 보고 행이 아예 없는 건(적재 실패·누락) */
        missing: missing.length,
      },
      missing,
      ...nimsChannelNotice(),
    };
  }

  /**
   * 배치 결과를 **읽은 시점의 상태에만** 적는다.
   *
   * 🔴 (2026-09-16 E1) 종전엔 `updateMany({ where: { id: { in: ids } } })` 로 조건 없이 덮어썼다.
   *    배치를 읽고 전송을 시도하는 사이에 담당자가 수기 접수번호를 기록하면(ACK·실제 접수번호·접수 시각),
   *    그 위로 `LOCAL_RECORDED · submittedAt=null · nimsRefNo=LOCAL-…` 가 덮여 **식약처 도달의 유일한 근거가
   *    지워졌다**(마약류 취급보고는 법정 기록이고, 지워지면 복구할 방법이 없다).
   *    읽은 상태를 조건으로 걸어 그 사이 바뀐 행은 건드리지 않고, 건너뛴 수를 남긴다.
   */
  private async claimNimsRows(
    rows: { id: string; status: string }[],
    data: Prisma.NimsReportUpdateManyMutationInput,
    batchNo: string,
  ): Promise<{ claimed: number; skipped: number }> {
    const byStatus = new Map<string, string[]>();
    for (const r of rows) byStatus.set(r.status, [...(byStatus.get(r.status) ?? []), r.id]);
    let claimed = 0;
    for (const [status, ids] of byStatus) {
      const upd = await this.prisma.nimsReport.updateMany({ where: { id: { in: ids }, status }, data });
      claimed += upd.count;
    }
    const skipped = rows.length - claimed;
    // (한 줄 유지 — 조립 문장 스캐너는 `logger.` 를 **같은 줄에서** 보고 제외한다)
    if (skipped > 0) this.logger.warn(`[NIMS] 배치 ${batchNo} ${skipped}건은 읽은 뒤 상태가 바뀌어 건너뛰었습니다(수기 접수 기록 등) — 기존 기록을 덮어쓰지 않았습니다`);
    return { claimed, skipped };
  }

  /**
   * NIMS 취급보고 배치파일 생성 — **파일을 만드는 것은 제출이 아니다.**
   *
   * 🔴 종전: 파일 생성 직후 `status:'SUBMITTED' · submittedAt:now · nimsRefNo:'NIMS-…'` 를 적어,
   *    다운로드만 하고 업로드를 안 해도 원장상 '제출 완료'였고 그 건은 다음 배치에서 영구 누락됐다.
   *
   * 지금: 전송 시도 결과대로만 적는다(`transmitNims` — 현재 채널 미구현).
   *  - SENT            → SUBMITTED · 기관 접수번호 · 기관 접수시각
   *  - NOT_TRANSMITTED → LOCAL_RECORDED · `LOCAL-NIMS-…`(원내 배치번호) · **submittedAt=null**
   *                      · errorMessage 에 미전송 사유·수기 조치 · **다음 배치에 다시 담긴다**
   *  - FAILED          → SEND_FAILED (재시도 가능)
   *
   * 기본 범위(status 미지정)는 **미전송 전량**이다(PENDING 만 담으면 이미 내려받은 건이 영구 누락).
   */
  async buildNimsBatch(
    status?: string,
    format: 'csv' | 'xml' = 'csv',
    userId?: string,
  ): Promise<{ filename: string; mime: string; content: string; count: number; batchNo: string; transmitted: boolean; notice: ReturnType<typeof nimsChannelNotice> }> {
    const all = await this.prisma.nimsReport.findMany({
      where: status ? { status } : {}, orderBy: { eventAt: 'asc' }, take: 5000,
    });
    // 이미 도달 근거가 있는 건(수기 접수 기록 등)은 다시 제출하지 않는다. 그 외는 전부 담는다.
    const rows = all.filter((r) => !classifyNimsTransmission(r).transmitted);
    const TYPE_KO: Record<string, string> = { DISPENSE: '조제', ADMINISTER: '투약', WASTE: '폐기', INVENTORY: '재고', INCIDENT: '사고' };
    const at = new Date();
    // 🔴 배치번호는 로컬(KST) 기준 — 종전 `toISOString()` 은 UTC 라 자정 근처에서 날짜가 밀렸다.
    //    접두어 `LOCAL-` 로 **기관이 준 번호가 아님**을 드러낸다.
    const batchNo = localNimsBatchNo(at);
    let content: string;
    if (format === 'xml') {
      const esc = (s: unknown) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
      const items = rows.map((r) => `  <취급내역>
    <취급구분>${esc(TYPE_KO[r.reportType] ?? r.reportType)}</취급구분>
    <품목명>${esc(r.drugName)}</품목명>
    <품목코드>${esc(r.drugCode)}</품목코드>
    <마약류구분>${esc(r.narcoticType)}</마약류구분>
    <수량>${esc(r.quantity)}</수량>
    <단위>${esc(r.unit)}</단위>
    <취급일시>${esc(r.eventAt.toISOString())}</취급일시>
    <보고ID>${esc(r.id)}</보고ID>
  </취급내역>`).join('\n');
      content = `<?xml version="1.0" encoding="UTF-8"?>\n<마약류취급보고 배치번호="${batchNo}" 건수="${rows.length}">\n${items}\n</마약류취급보고>\n`;
    } else {
      const q = (s: unknown) => { const v = String(s ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
      const header = '취급구분,품목명,품목코드,마약류구분,수량,단위,취급일시,보고ID';
      const lines = rows.map((r) => [TYPE_KO[r.reportType] ?? r.reportType, r.drugName, r.drugCode, r.narcoticType, r.quantity, r.unit, r.eventAt.toISOString(), r.id].map(q).join(','));
      content = '﻿' + [header, ...lines].join('\r\n') + '\r\n'; // BOM(엑셀 한글)
    }
    // 🔴 전송을 시도하고, **결과대로만** 적는다. 파일 생성은 제출이 아니다.
    const result = await transmitNims({ batchNo, format, count: rows.length });
    const transmitted = result.outcome === 'SENT';
    if (rows.length) {
      if (transmitted) {
        await this.claimNimsRows(rows, {
          status: NIMS_STATUS.SUBMITTED,
          submittedAt: result.at ?? at,
          nimsRefNo: result.externalRef ?? batchNo,
          errorMessage: null,
        }, batchNo);
      } else {
        this.logger.warn(
          `[NIMS] 배치 ${batchNo} ${rows.length}건 ${result.outcome === 'FAILED' ? '전송 실패' : '미전송'} — ${result.reason ?? ''} · ${NIMS_CHANNEL.manualFallback}`,
        );
        await this.claimNimsRows(rows, {
          status: result.outcome === 'FAILED' ? NIMS_STATUS.SEND_FAILED : NIMS_STATUS.LOCAL_RECORDED,
          submittedAt: null, // 나가지 않았으므로 '전송 시각'은 없다(추정 금지)
          nimsRefNo: batchNo, // 원내 배치번호 — 기관 접수번호 아님
          errorMessage: notTransmittedNimsLog(at, { attemptedBy: userId, reason: result.reason, batchNo }),
        }, batchNo);
      }
    }
    return {
      filename: `${batchNo}.${format}`,
      mime: format === 'xml' ? 'application/xml; charset=utf-8' : 'text/csv; charset=utf-8',
      content, count: rows.length, batchNo, transmitted, notice: nimsChannelNotice(),
    };
  }

  /**
   * NIMS 건별 제출 시도.
   * 🔴 종전: 전송 없이 `status:'SUBMITTED' · nimsRefNo:'STUB-…'` 를 적는 자인된 스텁이었다.
   * 지금: 나가지 않았으면 `LOCAL_RECORDED · submittedAt=null · LOCAL-NIMS-…` 로 적고 **재제출을 열어 둔다**.
   */
  async submitNimsReport(id: string, userId?: string) {
    const report = await this.prisma.nimsReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('NIMS 보고 없음');
    // 재제출 차단은 **실제로 나간 건**에만 건다(수기 접수번호가 기록된 건).
    const before = classifyNimsTransmission(report);
    if (before.transmitted && !RESUBMITTABLE_NIMS_STATUSES.includes(report.status)) {
      throw new BadRequestException(`이미 ${NIMS_CHANNEL.name}에 접수된 보고입니다 — 재제출 불가`);
    }

    const at = new Date();
    const result = await transmitNims({ id: report.id, reportType: report.reportType });
    if (result.outcome === 'SENT') {
      const sent = await this.prisma.nimsReport.update({
        where: { id },
        data: {
          status: NIMS_STATUS.SUBMITTED, submittedAt: result.at ?? at,
          nimsRefNo: result.externalRef ?? null, errorMessage: null,
        },
      });
      return { ...sent, transmission: classifyNimsTransmission(sent) };
    }

    // 레거시 번호(`NIMS-…`/`STUB-…`)는 지우지 않고 errorMessage 에 보존한다.
    const priorRef = report.nimsRefNo && !report.nimsRefNo.startsWith('LOCAL-')
      ? ` · 이전 기록 번호 보존: ${report.nimsRefNo}` : '';
    this.logger.warn(
      `[NIMS] 보고 ${id}(${report.drugName}) ${result.outcome === 'FAILED' ? '전송 실패' : '미전송'} — ${result.reason ?? ''} · ${NIMS_CHANNEL.manualFallback}`,
    );
    const updated = await this.prisma.nimsReport.update({
      where: { id },
      data: {
        status: result.outcome === 'FAILED' ? NIMS_STATUS.SEND_FAILED : NIMS_STATUS.LOCAL_RECORDED,
        submittedAt: null,
        nimsRefNo: localNimsRef(at),
        errorMessage: notTransmittedNimsLog(at, { attemptedBy: userId, reason: result.reason }) + priorRef,
      },
    });
    return { ...updated, transmission: classifyNimsTransmission(updated) };
  }

  /**
   * 수기 접수번호 기록 — 담당자가 NIMS 웹에 배치파일을 올리고 받은 **실제 접수번호**를 적는다.
   * 연동이 없는 동안 '도달했다'고 말할 수 있는 **유일한 근거**다(사람이 확인한 사실).
   * 배치 단위로 올렸다면 batchNo 로 그 배치에 속한 건 전부를 한 번에 닫는다.
   */
  async recordManualNimsAck(
    target: { id?: string; batchNo?: string },
    input: { nimsRefNo: string; submittedAt?: string; note?: string },
    userId?: string,
  ) {
    const ref = (input.nimsRefNo ?? '').trim();
    if (!ref) throw new BadRequestException('NIMS 접수번호가 필요합니다');
    if (/^(LOCAL-|STUB-|NIMS-)/.test(ref)) {
      throw new BadRequestException('원내 배치번호는 접수번호가 아닙니다 — NIMS 가 발급한 번호를 입력하십시오');
    }
    const submittedAt = parseLocalDate(input.submittedAt) ?? new Date();
    if (submittedAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException('접수 시각이 미래일 수 없습니다');
    }

    const where: Prisma.NimsReportWhereInput = target.id
      ? { id: target.id }
      : target.batchNo ? { nimsRefNo: target.batchNo } : (() => { throw new BadRequestException('대상(id 또는 batchNo)이 필요합니다'); })();
    const targets = await this.prisma.nimsReport.findMany({ where });
    if (!targets.length) throw new NotFoundException('NIMS 보고 없음');

    await this.prisma.nimsReport.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: {
        status: NIMS_STATUS.ACK,
        submittedAt,
        nimsRefNo: ref,
        errorMessage: `[수기 접수] ${new Date().toISOString()} · 기록자 ${userId ?? '미상'} · ${NIMS_CHANNEL.name} 접수번호 ${ref}${input.note ? ` · ${input.note}` : ''}`,
      },
    });
    return { updated: targets.length, nimsRefNo: ref, submittedAt };
  }

  async returnDrug(id: string) {
    const log = await this.prisma.controlledSubstanceLog.findUnique({ where: { id } });
    if (!log) throw new NotFoundException('Record not found');
    if (!['DISPENSED', 'VERIFIED'].includes(log.status)) {
      throw new BadRequestException('조제 또는 확인 상태에서만 반납 가능합니다.');
    }

    return this.prisma.controlledSubstanceLog.update({
      where: { id },
      data: { status: 'RETURNED' },
    });
  }

  async getLogs(filters: {
    patientId?: string;
    deaSchedule?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) {
    const { patientId, deaSchedule, status, dateFrom, dateTo, page = 1, limit = 20 } = filters;
    const where: Prisma.ControlledSubstanceLogWhereInput = {};
    if (patientId) where.patientId = patientId;
    if (deaSchedule) where.deaSchedule = deaSchedule;
    if (status) where.status = status;
    // 🔴 날짜는 정본 dayRange — `new Date('YYYY-MM-DD')` 는 TZ 무관 UTC 자정이라 KST 하루가 어긋난다.
    const range = dayRange(dateFrom, dateTo);
    if (range) where.prescribedAt = range;

    const [rows, total] = await Promise.all([
      this.prisma.controlledSubstanceLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { prescribedAt: 'desc' },
        // 🔴 환자 칸이 영구 공란이던 것 — 관계를 실어 준다.
        //    (환자 전체 include 는 암호화 PID 를 응답에 싣는다 → 필요한 칸만 select)
        include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } },
      }),
      this.prisma.controlledSubstanceLog.count({ where }),
    ]);

    const items = await this.hydrateStaff(rows);
    return { items, total, page, limit };
  }

  async getLogById(id: string) {
    const log = await this.prisma.controlledSubstanceLog.findUnique({
      where: { id },
      include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } },
    });
    if (!log) throw new NotFoundException('Record not found');
    const [hydrated] = await this.hydrateStaff([log]);
    return hydrated;
  }

  /**
   * 일일 마약류 원장 — 마약류관리법 시행규칙상 **일자별 취급 내역**(처방·불출·투약·폐기·잔량).
   *
   * 🔴 종전: 서버가 7열 중 어느 것도 계산하지 않고 원시 로그 배열만 돌려줬다(화면 5칸이 undefined).
   *    게다가 `new Date('2026-08-14')` 는 UTC 자정이라 KST 에서 **하루 밀린 원장**이 나왔다.
   *
   * 취급 시점 기준으로 각 칸을 나눈다(그날 처방/그날 불출/그날 투약이 서로 다른 날일 수 있다).
   * 🔴 폐기는 스키마에 시각 컬럼이 없어(wasteReason/wasteWitness 만 존재) **추정하지 않고**
   *    그 건의 마지막 확인 시점(투약→불출→처방)이 이 날인 경우에만 집계하며, 그 사실을 note 로 밝힌다.
   * 🔴 폐기량 미기재(wastedQty=null)가 있으면 잔량은 **0 이 아니라 `null`(산출 불가)** 이다.
   */
  async getDailyLedger(date?: string) {
    if (date && !this.parseDayStrict(date)) throw new BadRequestException('날짜 형식이 올바르지 않습니다(YYYY-MM-DD)');
    const start = this.parseDayStrict(date) ?? (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const within = (d: Date | null | undefined) => !!d && d >= start && d < end;

    const logs = await this.prisma.controlledSubstanceLog.findMany({
      where: {
        OR: [
          { prescribedAt: { gte: start, lt: end } },
          { dispensedAt: { gte: start, lt: end } },
          { administeredAt: { gte: start, lt: end } },
        ],
      },
      orderBy: [{ drugName: 'asc' }, { prescribedAt: 'asc' }],
    });

    // 🔴 합계는 Prisma.Decimal 로 누적한다 — number 로 더하면 0.1+0.2 같은 부동소수점 잔차가
    //    마약류 잔량에 섞인다(Decimal 직렬화 잔차 교훈). 표시 직전에만 number 로 바꾼다.
    interface Acc {
      drugName: string; schedule: string; narcoticType: string | null; unit: string;
      prescribed: Prisma.Decimal; dispensed: Prisma.Decimal; administered: Prisma.Decimal; wasted: Prisma.Decimal;
      count: number; assumedFullDose: number; wastedQtyUnknown: number;
    }
    const zero = () => new Prisma.Decimal(0);
    const map = new Map<string, Acc>();

    for (const log of logs) {
      const key = `${log.drugName}|${log.deaSchedule}|${log.unit}`;
      let row = map.get(key);
      if (!row) {
        row = {
          drugName: log.drugName, schedule: log.deaSchedule, narcoticType: log.narcoticType, unit: log.unit,
          prescribed: zero(), dispensed: zero(), administered: zero(), wasted: zero(),
          count: 0, assumedFullDose: 0, wastedQtyUnknown: 0,
        };
        map.set(key, row);
      }
      row.count += 1;
      const qty = new Prisma.Decimal(log.quantity ?? 0);
      if (within(log.prescribedAt)) row.prescribed = row.prescribed.plus(qty);
      if (within(log.dispensedAt)) row.dispensed = row.dispensed.plus(qty);
      if (within(log.administeredAt)) {
        if (log.administeredQty != null) row.administered = row.administered.plus(log.administeredQty);
        else { row.administered = row.administered.plus(qty); row.assumedFullDose += 1; }
      }
      if (log.status === 'WASTED') {
        // 폐기 시각이 없다 — 그 건의 마지막 확인 시점을 폐기일로 본다(추정 표기).
        const wasteDay = log.administeredAt ?? log.dispensedAt ?? log.prescribedAt;
        if (within(wasteDay)) {
          if (log.wastedQty != null) row.wasted = row.wasted.plus(log.wastedQty);
          else row.wastedQtyUnknown += 1;
        }
      }
    }

    const rows: DailyLedgerRow[] = [...map.values()].map((r) => {
      const notes: string[] = [];
      if (r.assumedFullDose > 0) notes.push(`투여량 미기재 ${r.assumedFullDose}건 — 불출량을 투약량으로 집계(NIMS 보고와 동일 규칙)`);
      // 🔴 모르는 값을 0 으로 채우지 않는다 — 폐기량 미기재가 섞이면 잔량은 '산출 불가'.
      let remaining: number | null = null;
      if (r.wastedQtyUnknown > 0) notes.push(`폐기량 미기재 ${r.wastedQtyUnknown}건 — 잔량 산출 불가`);
      else remaining = r.dispensed.minus(r.administered).minus(r.wasted).toNumber();
      return {
        drugName: r.drugName, schedule: r.schedule, narcoticType: r.narcoticType, unit: r.unit,
        prescribed: r.prescribed.toNumber(), dispensed: r.dispensed.toNumber(),
        administered: r.administered.toNumber(), wasted: r.wasted.toNumber(),
        remaining, count: r.count,
        assumedFullDose: r.assumedFullDose, wastedQtyUnknown: r.wastedQtyUnknown, notes,
      };
    });

    return {
      date: localDateKey(start), // 🔴 로컬(KST) 달력 날짜 — toISOString() 은 하루 밀린다
      rows,
      /** 폐기 시각 컬럼이 없다는 사실을 화면이 숨기지 않도록 함께 준다 */
      wasteDateBasis: '폐기 시각 컬럼이 없어 투약(없으면 불출·처방) 시점을 폐기일로 봅니다',
    };
  }

  async getStats() {
    const today = todayRange();
    // 🔴 종전: 화면이 쓰는 pendingVerification·wasteCount 를 서버가 계산하지 않아
    //    FE 가 (항상 비어 있던) 목록으로 0 을 만들어 단정했다. 서버가 세어 준다.
    const notTransmittedStatuses = NIMS_CHANNEL.implemented
      ? [...RESUBMITTABLE_NIMS_STATUSES]
      : [...RESUBMITTABLE_NIMS_STATUSES, NIMS_STATUS.SUBMITTED]; // 연동 전 SUBMITTED 는 나간 적 없다
    const [bySchedule, byStatus, total, todayPrescribed, pendingVerification, wasteCount, nimsTotal, nimsNotTransmitted, discrepancyCount, openIncidents] =
      await Promise.all([
        this.prisma.controlledSubstanceLog.groupBy({ by: ['deaSchedule'], _count: { id: true } }),
        this.prisma.controlledSubstanceLog.groupBy({ by: ['status'], _count: { id: true } }),
        this.prisma.controlledSubstanceLog.count(),
        this.prisma.controlledSubstanceLog.count({ where: { prescribedAt: today } }),
        this.prisma.controlledSubstanceLog.count({ where: { status: 'PRESCRIBED' } }),
        this.prisma.controlledSubstanceLog.count({ where: { status: 'WASTED' } }),
        this.prisma.nimsReport.count(),
        this.prisma.nimsReport.count({ where: { status: { in: notTransmittedStatuses } } }),
        this.prisma.controlledSubstanceStockTxn.count({ where: { type: 'COUNT', discrepancy: { not: 0 } } }),
        this.prisma.controlledSubstanceIncident.count({ where: { status: { not: 'CLOSED' } } }),
      ]);

    return {
      bySchedule: bySchedule.reduce(
        (acc, s) => ({ ...acc, [s.deaSchedule]: s._count.id }),
        {} as Record<string, number>,
      ),
      byStatus: byStatus.reduce(
        (acc, s) => ({ ...acc, [s.status]: s._count.id }),
        {} as Record<string, number>,
      ),
      total,
      todayPrescribed,
      pendingVerification,
      wasteCount,
      nims: { total: nimsTotal, notTransmitted: nimsNotTransmitted, ...nimsChannelNotice() },
      /** 유용 의심(실사 불일치) — 마약류관리법상 알려야 할 사실 */
      discrepancyCount,
      openIncidents,
    };
  }

  async getUnverified() {
    const rows = await this.prisma.controlledSubstanceLog.findMany({
      where: { status: 'PRESCRIBED' },
      orderBy: { prescribedAt: 'asc' },
      include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } },
    });
    return this.hydrateStaff(rows);
  }

  /**
   * 폐기·실사 **증인 후보**(2인 무결성) — 증인은 사람(User.id)이어야 성립한다.
   * 🔴 종전 화면은 증인을 '성명 문자열'로 받아 보냈고 서버는 그것을 uuid 로 취급했다
   *    → `witnessId === wastedById` 비교가 늘 거짓이라 **혼자 폐기**가 통과할 수 있었다.
   * 최소 정보만 준다(id·성명·역할) — 연락처·면허번호는 싣지 않는다.
   */
  async getWitnessCandidates(excludeUserId?: string, q?: string) {
    const where: Prisma.UserWhereInput = {
      isActive: true,
      accountStage: 'ACTIVE',
      role: { in: ['DOCTOR', 'NURSE', 'PHARMACIST', 'ADMIN'] as never },
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      ...(q ? { OR: [{ familyName: { contains: q } }, { givenName: { contains: q } }] } : {}),
    };
    const users = await this.prisma.user.findMany({
      where,
      select: { id: true, familyName: true, givenName: true, role: true, department: true },
      orderBy: [{ familyName: 'asc' }, { givenName: 'asc' }],
      take: 200,
    });
    return users.map((u) => ({ ...u, role: String(u.role) }));
  }
}
