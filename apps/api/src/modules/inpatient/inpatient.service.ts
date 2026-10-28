import { transferBedInTx } from './bed-transfer';
import { takeOverInTx } from '../nurse-station/take-over';
import { readHandoffAckMode } from '../nursing-rules/nursing-rules.read';
import { AdmissionVitalsReader } from '../vitals/admission-vitals.reader';
import { AdmissionIoReader } from '../nursing/admission-io.reader';
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException, Optional, Logger } from '@nestjs/common';
import { dateOnlyValue, todayDateOnly, assertDateParam } from '../../common/day-range';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JourneyService } from '../journey/journey.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { shiftWindowAt, HOSPITAL_TZ_OFFSET_MIN, normalizeShiftBoundaries, stayDays, handoffKindOf, HANDOFF_TYPES, type HandoffAckMode } from '@hospital-run/shared';
import { IntegrationOutboxService, type HisEvent } from '../integration/integration-outbox.service';
import { BillingService } from '../billing/billing.service';
import { NotificationService } from '../notification/notification.service';
// 게이트 위반·면제 원장 — 차단만 하고 남기지 않으면 관제의 '0건'이 준수인지 미평가인지 구분 불가
import { SafetyGateService } from '../safety-gate/safety-gate.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { recordGateViolation } from '../../common/gate-enforce';

/** 중간정산 수납 입력 — DTO(PayInterimBillingDto)가 검증한 값 */
export interface PayInterimBillingInput {
  method: 'CARD' | 'CASH' | 'TRANSFER';
  amount?: number;
  cardApprovalNo?: string;
  cardCompany?: string;
  installment?: number;
  cashReceiptNo?: string;
}

/**
 * 인계 응답 보강(2026-10-26) — 화면 분기 정본 `kind`(종류 + 보낸 사람 직종 · shared `handoffKindOf`)와
 * 관리자 대리 확인 여부(`acknowledgedByProxy` — 확인 전 null · 확인자 기록 전 확인분도 null = 모른다).
 */
export function withHandoffView<T extends { type: string; toDoctorId: string; acknowledgedAt: Date | null; acknowledgedBy?: string | null; fromDoctor?: { role?: string | null } | null }>(h: T) {
  return {
    ...h,
    kind: handoffKindOf(h.type, h.fromDoctor?.role ?? null),
    acknowledgedByProxy: !h.acknowledgedAt || h.acknowledgedBy == null ? null : h.acknowledgedBy !== h.toDoctorId,
  };
}

@Injectable()
export class InpatientService {
  private readonly logger = new Logger(InpatientService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly journey?: JourneyService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly outbox?: IntegrationOutboxService,
    @Optional() private readonly billing?: BillingService,
    @Optional() private readonly notifications?: NotificationService, // 인수인계 인앱 알림(미주입=무알림·무중단)
    @Optional() private readonly events?: EventEmitter2, // handoff.created — W.Channel 어댑터 향후 구독점
    @Optional() private readonly gates?: SafetyGateService, // 퇴원 게이트 위반·면제 원장,
    /** 입원 활력 읽기 정본(플로시트 + 재원 중 외래 원장 · 2026-10-10) — 미주입(단위 테스트)이면 같은 prisma 로 구성 */
    @Optional() private readonly admissionVitalsInjected?: AdmissionVitalsReader,
  ) {}

  private _admissionVitalsFallback?: AdmissionVitalsReader;
  private get admissionVitals(): AdmissionVitalsReader {
    return this.admissionVitalsInjected ?? (this._admissionVitalsFallback ??= new AdmissionVitalsReader(this.prisma));
  }

  async admit(data: { patientId: string; bedId: string; doctorId: string; reason?: string; dietType?: string; admissionId?: string }) {
    // 병상 점유·입원·ChargeOfCare·BedAssignment 생성을 원자적으로(부분 실패 시 병상누수 방지) +
    // 신병상 비관적 선점(updateMany AVAILABLE→OCCUPIED)으로 동시 입원 경쟁 차단.
    const admission = await this.prisma.$transaction(async (tx) => {
      // 환자 단위 advisory lock — 동시 이중입원(다른 병상) 경쟁 직렬화. 재원 중복 체크를 락 안에서(check-then-act race 제거)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`admit:${data.patientId}`}))`;
      const active = await tx.admission.findFirst({ where: { patientId: data.patientId, status: 'ADMITTED' }, select: { id: true } });
      if (active) throw new BadRequestException('이미 재원 중인 환자입니다.');

      const claimed = await tx.bed.updateMany({ where: { id: data.bedId, status: 'AVAILABLE' }, data: { status: 'OCCUPIED' } });
      if (claimed.count === 0) throw new BadRequestException('Bed not available');

      const adm = await tx.admission.create({
        data: {
          patientId: data.patientId,
          bedId: data.bedId,
          admittingDoctorId: data.doctorId,
          attendingDoctorId: data.doctorId,
          admitDate: new Date(),
          admitReason: data.reason,
          dietType: data.dietType ?? '일반식',
        },
        include: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
          bed: { include: { ward: { select: { name: true } } } },
        },
      });
      await tx.chargeOfCare.create({ data: { admissionId: adm.id, doctorId: data.doctorId, assignedAt: new Date() } });
      await tx.bedAssignment.create({ data: { admissionId: adm.id, bedId: data.bedId, assignedAt: new Date(), reason: 'ADMISSION' } });
      return adm;
    });

    // 🔴 입원 생성 경로는 둘(admission.create / 여기)인데 `admission.created` 를 emit 하는 쪽은
    //    종전에 admission.create 하나뿐이었다 — 이 경로로 들어온 환자는 입원 프로토콜이 생기지 않았고,
    //    후속(재평가 스케줄 등)을 이벤트에 붙이면 환자 절반만 걸리는 P12 가 된다. 같은 이벤트로 맞춘다.
    //    (구독자는 전부 ensure* 멱등 — 이중 emit 되어도 인스턴스가 두 벌 생기지 않는다.)
    this.events?.emit('admission.created', { admissionId: admission.id, patientId: data.patientId });

    this.journey?.emit({
      patientId: data.patientId, eventType: 'ADMISSION',
      title: `입원 (${admission.bed?.ward?.name ?? ''})`, department: admission.bed?.ward?.name,
      doctorId: data.doctorId, refType: 'ADMISSION', refId: admission.id,
      navUrl: `/inpatient/${admission.id}`,
      occurredAt: admission.admitDate, // 여정 P1: 입원 원장 시각
    });

    return admission;
  }

  /** 퇴원 정본(단일 구현) — admissions/:id/discharge도 여기로 위임.
   *  상태전이·병상반납·ChargeOfCare/BedAssignment 종료를 트랜잭션으로(부분 실패 시 병상누수 방지) + 여정 DISCHARGE. */
  async discharge(id: string, summary: string, disposition?: string, dischargeDate?: Date) {
    const admission = await this.prisma.admission.findUnique({ where: { id } });
    if (!admission) throw new NotFoundException('Admission not found');
    if (admission.status !== 'ADMITTED') throw new BadRequestException('Not currently admitted');

    // 퇴원 게이트(R3-1) — config inpatient.dischargeGate(기본 OFF): 요약 서명·정산 잔액을 전이 조건으로.
    // (기존엔 status 확인 하나뿐 — 미서명 요약·미납 잔액·미결 오더가 있어도 퇴원됐음)
    const dischargeWarnings: string[] = [];
    const gateOn = String((await this.config?.get('inpatient.dischargeGate')) ?? 'false') === 'true';
    /**
     * 🔴 게이트 **면제**는 코드에 적혀 있어야 한다(2026-08-26).
     *
     *  · `TRANSFER`(전원·응급 이송) — 지연이 더 위험하다. 종전부터 명시돼 있었다.
     *  · `DECEASED`(사망) — **어디에도 적혀 있지 않았다.** DTO 는 `DECEASED` 를 허용하는데
     *    게이트는 면제하지 않아, 이 경로로 사망 퇴원을 하면 "미납 잔액" 으로 막혔다.
     *    동시에 `PatientService.markDeceased()`(`POST /patients/:id/deceased`)는
     *    `admission.updateMany({status:'DISCHARGED'})` 로 **여기를 통째로 우회**해 조용히 퇴원시켰다.
     *    → 같은 사실에 정본이 둘이었고(P12), 한쪽은 막고 한쪽은 몰래 통과시켰다.
     *
     *  🔴 사망 퇴원은 **막지 않는다** — 막으면 현장이 멈추고, 유족을 세워둔 채 수납을 요구하게 된다.
     *     대신 **면제를 명시하고 원장에 남긴다**(severity=`EXEMPT`). 그래야 관제의 "위반 0건"이
     *     '준수'인지 '면제로 빠져나간 건'인지 구분된다. 미납·미서명은 사후 정산·기록 완결로 처리한다.
     */
    const GATE_EXEMPT_DISPOSITIONS: Record<string, string> = {
      TRANSFER: '전원(타 의료기관 이송) — 이송 지연이 더 위험',
      DECEASED: '사망 — 사망 퇴원을 수납·서명으로 막지 않는다(사후 정산·기록 완결로 처리)',
    };
    const exemptReason = disposition ? GATE_EXEMPT_DISPOSITIONS[disposition] : undefined;
    if (gateOn && exemptReason) {
      // 면제는 위반이 아니다 — `EXEMPT` 로 남겨 위반 집계에서 빠지되 관제 최근목록에는 보이게 한다.
      await recordGateViolation({ gateKey: 'inpatient.dischargeGate', recorder: this.gates, logger: this.logger, refType: 'Admission', refId: id }, 'EXEMPT', `퇴원 게이트 면제(${disposition}) — ${exemptReason}`);
    }
    if (gateOn && !exemptReason) {
      const summaryDoc = await this.prisma.dischargeSummary.findUnique({ where: { admissionId: id }, select: { status: true } });
      if (!summaryDoc || summaryDoc.status === 'DRAFT') {
        const msg = summaryDoc ? '퇴원요약이 서명되지 않았습니다 — 서명 후 퇴원하세요' : '퇴원요약이 작성되지 않았습니다';
        // 🔴 종전엔 예외만 던지고 아무 데도 남기지 않아, 관제의 '0건'이 준수인지 미평가인지 구분 불가였다.
        await recordGateViolation({ gateKey: 'inpatient.dischargeGate', recorder: this.gates, logger: this.logger, refType: 'Admission', refId: id }, 'BLOCK', msg);
        throw new BadRequestException({ code: 'DISCHARGE_SUMMARY_UNSIGNED', message: msg });
      }
      // 🔴 `getDischargeSettlement` 는 `{ data: { …, balanceDue } }` 로 **감싸서** 반환한다.
      //    종전엔 최상위에서 `settlement.balanceDue` 를 읽어 **항상 undefined → `?? 0`** 이었고,
      //    이 미납 차단은 **개통 이래 한 번도 발동한 적이 없다**(정본을 부르는 모양만 갖춘 코드).
      const settlement = await this.getDischargeSettlement(id);
      const balance = settlement.data?.balanceDue ?? 0;
      if (balance > 0) {
        const msg = `퇴원 수납 잔액 ${balance.toLocaleString()}원 미납 — 정산 완료 후 퇴원하세요`;
        await recordGateViolation({ gateKey: 'inpatient.dischargeGate', recorder: this.gates, logger: this.logger, refType: 'Admission', refId: id }, 'BLOCK', msg);
        throw new BadRequestException({ code: 'DISCHARGE_BALANCE_DUE', message: msg, balanceDue: balance });
      }
    }
    // 미결 오더는 차단 대신 경고(퇴원 시점 임상 판단 존중 — 목록은 사후 추적용)
    const openOrders = await this.prisma.order.count({
      where: { status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] }, prescription: { encounter: { admissionId: id } } },
    });
    if (openOrders > 0) dischargeWarnings.push(`미결 오더 ${openOrders}건이 남아 있습니다 — 취소 또는 완료 처리를 확인하세요`);

    const now = dischargeDate ?? new Date();
    // 전원은 사유 TRANSFER로 이력 기록
    const bedReason = disposition === 'TRANSFER' ? 'TRANSFER' : 'DISCHARGE';
    // 전원(타 의료기관 이송)은 TRANSFERRED로 구분 → 재원통계·disposition 정확
    const finalStatus = disposition === 'TRANSFER' ? 'TRANSFERRED' : 'DISCHARGED';
    // 퇴원 후 병상 상태 — config bed.cleaningOnDischarge ON이면 CLEANING(청소대기)로,
    // 기본 OFF면 즉시 AVAILABLE(기존 동작). 청소 완료는 PATCH /beds/:id/status로 AVAILABLE 전환.
    const cleaningCfg = await this.config?.get('bed.cleaningOnDischarge');
    const bedStatusAfter = (cleaningCfg === true || cleaningCfg === 'true') ? 'CLEANING' : 'AVAILABLE';

    // 병상 반납·팀/배정 종료·상태전이를 원자적으로(ghost-occupied 병상누수 방지)
    const discharged = await this.prisma.$transaction(async (tx) => {
      await tx.bed.update({ where: { id: admission.bedId }, data: { status: bedStatusAfter } });
      await tx.chargeOfCare.updateMany({ where: { admissionId: id, releasedAt: null }, data: { releasedAt: now } });
      await tx.bedAssignment.updateMany({ where: { admissionId: id, releasedAt: null }, data: { releasedAt: now, reason: bedReason } });
      /**
       * 🔴 퇴원해도 **식이 처방이 활성인 채로 남아 있었다**(2026-08-21 운영 실측:
       *    활성 처방 3건이 전부 퇴원 환자의 것). 재입원 시 옛 처방이 딸려오고,
       *    "활성 식이 처방" 집계가 퇴원 환자까지 세어 실제보다 많아 보인다.
       *    입원이 끝나면 그 입원의 처방도 끝난다.
       */
      await tx.dietOrder.updateMany({
        where: { admissionId: id, isActive: true },
        data: { isActive: false, endDate: dateOnlyValue(now)! },
      });
      return tx.admission.update({
        where: { id },
        data: { status: finalStatus, dischargeDate: now, dischargeSummary: summary || null },
        include: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
          bed: { select: { id: true, roomNumber: true, bedNumber: true } },
        },
      });
    });
    // 🔴 재원이 끝났다는 사실의 단일 구독점 — 종전엔 퇴원 도메인 이벤트가 없어(journey 만 emit)
    //    퇴원 후에도 위험 재평가 스케줄이 영구 활성으로 남아 매시간 주치의에게 기한초과 알림이 갔다.
    //    (거짓 경보는 진짜 경보를 죽인다.) 퇴원 정본이 이 하나뿐이라 여기 한 곳이면 충분하다.
    this.events?.emit('admission.closed', {
      admissionId: id, patientId: admission.patientId, reason: disposition === 'TRANSFER' ? 'TRANSFER' : 'DISCHARGE',
    });

    this.journey?.emit({
      patientId: admission.patientId, eventType: 'DISCHARGE', refType: 'ADMISSION', refId: id, // 여정 P0-5: 방문 단위 귀속
      title: disposition === 'TRANSFER' ? '전원' : '퇴원',
      // 여정 P1: 퇴원 원장 시각 — 직원이 퇴원 시각을 입력했으면 관측이 아니라 입력값
      occurredAt: now, occurredAtSource: dischargeDate ? 'USER_CLAIMED' : 'DOMAIN_FIELD',
      outcome: finalStatus, // 여정 P2: 퇴원·전원(원장 상태와 같은 값)
      // 🔴 (2026-09-14) 환자 노출 유형 — 직원 자유 입력(메모·사유·소견)을 설명에 싣지 않는다(포털 타임라인에 그대로 나갔다). 원문은 원 기록이 정본.
    });
    // 입원료 Billing 자동 생성(입원 EDI 청구 P1) — 게이트 inpatient.stayBilling.enabled(기본 OFF)·비차단
    try {
      const stayOn = (await this.config?.get('inpatient.stayBilling.enabled')) === true;
      if (stayOn && this.billing) {
        void this.billing.createInpatientStayBilling(id)
          .then((r) => { if (!r.created && r.reason !== 'ALREADY_BILLED') this.logger.warn(`입원료 Billing 미생성 admission=${id}: ${r.reason}`); })
          .catch((e) => this.logger.warn(`입원료 Billing 실패(비차단) admission=${id}: ${e instanceof Error ? e.message : e}`));
      }
    } catch { /* 비차단 */ }
    return dischargeWarnings.length > 0 ? { ...discharged, warnings: dischargeWarnings } : discharged;
  }

  /** 입원료 Billing 수동 생성/재시도(P1) — 게이트 무관(ADMIN 수동 판단) */
  async createStayBilling(admissionId: string) {
    if (!this.billing) throw new BadRequestException('billing 서비스 미구성');
    return this.billing.createInpatientStayBilling(admissionId);
  }

  /** 퇴원 준비 현황(R3-1) — 워크스테이션 체크리스트의 서버 정본(요약·정산·미결 오더·사전처방) */
  async getDischargeReadiness(admissionId: string) {
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { id: true, status: true, expectedDischargeDate: true } });
    if (!admission) throw new NotFoundException('Admission not found');
    // 🔴 정산 조회 실패를 `?? 0` 으로 접으면 **미납이 있어도 "정산 완료"**가 되고 `readyToDischarge` 가
    //    초록으로 켜진다(조회 장애가 곧 퇴원 허가). 실패는 실패로 말한다 — 3상태(금액 / 미조회 / 실패).
    const [summaryDoc, settlementResult, openOrders] = await Promise.all([
      this.prisma.dischargeSummary.findUnique({ where: { admissionId }, select: { status: true, signedAt: true, followUpDate: true, dischargeMedications: true, patientEducation: true } }),
      this.getDischargeSettlement(admissionId).then(
        // 🔴 반환은 `{ data: { …, balanceDue } }` — 최상위에서 읽으면 영원히 undefined 다(위 게이트와 같은 함정)
        (v) => ({ ok: true as const, value: v.data as { balanceDue?: number } | undefined }),
        (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }),
      ),
      // 퇴원약 오더는 '미결 입원 오더'가 아니다 — 퇴원 때 조제되는 것이 정상이다(아래 dischargeMeds 에서 따로 센다)
      this.prisma.order.count({ where: { status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] }, prescription: { dischargeMed: false, encounter: { admissionId } } } }),
    ]);
    // 퇴원약 오더화(2026-09-30) — 처방 원장의 퇴원약(활성)과 그 조제 오더 상태
    const dischargeRx = await this.prisma.prescription.findMany({
      where: { type: 'MEDICATION', dischargeMed: true, status: 'ACTIVE', encounter: { admissionId } },
      select: { id: true, dispensingType: true, orders: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    // 환자 교육 기록(2026-09-30) — 이 입원에 붙은 유효한(무효 처리 안 된) 교육 기록 수
    const educationRecords = await this.prisma.patientEducationRecord.count({ where: { admissionId, voidedAt: null } });
    const settlementUnavailable = !settlementResult.ok;
    if (settlementUnavailable) {
      this.logger.error(`퇴원 준비 — 정산 조회 실패(admission=${admissionId}): ${(settlementResult as { error: string }).error}`);
    }
    const balanceDue = settlementResult.ok ? (settlementResult.value?.balanceDue ?? null) : null;
    const settled = balanceDue == null ? null : balanceDue <= 0; // null = 판정 불가(0원 아님)
    const meds = summaryDoc?.dischargeMedications;
    const legacyListed = Array.isArray(meds) ? meds.length : meds ? 1 : 0;
    // 원외(EXTERNAL)는 처방전 발행이 곧 준비다 — 원내 조제분만 조제 완료 여부를 본다
    const internal = dischargeRx.filter((r) => r.dispensingType !== 'EXTERNAL');
    const dispensed = internal.filter((r) => r.orders[0]?.status === 'COMPLETED').length;
    return {
      admissionStatus: admission.status,
      expectedDischargeDate: admission.expectedDischargeDate,
      summary: { exists: !!summaryDoc, status: summaryDoc?.status ?? null, signedAt: summaryDoc?.signedAt ?? null },
      settlement: {
        balanceDue,
        settled,
        unavailable: settlementUnavailable,
        reason: settlementUnavailable ? '정산 조회에 실패했습니다 — 미납 여부를 확인하지 못했습니다.' : null,
      },
      openOrders,
      followUpPlanned: !!summaryDoc?.followUpDate,
      // 🔴 종전엔 퇴원요약 Json 이 "비어 있지 않다"만 셌다 — 처방·조제를 지나지 않은 글자도 "준비됨"이었다.
      //    이제 출처를 가른다: ORDERS(처방 원장) / SUMMARY_TEXT(요약 글자뿐 — 처방 아님) / null(없음)
      dischargeMedsPrepared: dischargeRx.length > 0 || legacyListed > 0,
      dischargeMeds: {
        source: dischargeRx.length > 0 ? 'ORDERS' : legacyListed > 0 ? 'SUMMARY_TEXT' : null,
        ordered: dischargeRx.length,
        internal: internal.length,
        dispensed,
        external: dischargeRx.length - internal.length,
        summaryListed: legacyListed,
      },
      // 🔴 종전엔 퇴원요약 '환자교육' 글자가 비어 있지 않은지만 셌다 — 교육 기록 원장도 보고, 출처를 가른다
      educationDone: educationRecords > 0 || !!summaryDoc?.patientEducation,
      education: {
        records: educationRecords,
        summaryText: !!summaryDoc?.patientEducation,
        source: educationRecords > 0 ? 'RECORDS' : summaryDoc?.patientEducation ? 'SUMMARY_TEXT' : null,
      },
      // 🔴 정산을 모르면 "퇴원 가능"이라 말하지 않는다(차단이 아니라 미주장 — 사람이 확인 후 진행한다)
      readyToDischarge: !!summaryDoc && summaryDoc.status !== 'DRAFT' && settled === true,
    };
  }

  /** 퇴원 예정일 설정/해제 — 재원 중 계획(병동 병상회전 예측·census DC_PLAN). */
  async setExpectedDischarge(id: string, date: string | null) {
    const admission = await this.prisma.admission.findUnique({ where: { id }, select: { status: true } });
    if (!admission) throw new NotFoundException('Admission not found');
    if (admission.status !== 'ADMITTED') throw new BadRequestException('재원 중인 입원만 설정할 수 있습니다.');
    return this.prisma.admission.update({
      where: { id },
      data: { expectedDischargeDate: date ? new Date(date) : null },
      select: { id: true, expectedDischargeDate: true },
    });
  }

  /** 입원 취소 — 잘못 생성된 입원(데이터 오류·실입원 안 함) 취소. 병상 반납+팀/배정 종료를 트랜잭션으로. */
  async cancelAdmission(id: string, reason: string) {
    const admission = await this.prisma.admission.findUnique({ where: { id } });
    if (!admission) throw new NotFoundException('Admission not found');
    if (admission.status !== 'ADMITTED') throw new BadRequestException('재원 중인 입원만 취소할 수 있습니다.');

    const now = new Date();
    const cancelled = await this.prisma.$transaction(async (tx) => {
      await tx.bed.update({ where: { id: admission.bedId }, data: { status: 'AVAILABLE' } });
      await tx.chargeOfCare.updateMany({ where: { admissionId: id, releasedAt: null }, data: { releasedAt: now } });
      await tx.bedAssignment.updateMany({ where: { admissionId: id, releasedAt: null }, data: { releasedAt: now, reason: 'CANCEL' } });
      return tx.admission.update({
        where: { id },
        data: { status: 'CANCELLED', dischargeDate: now, dischargeSummary: `[입원취소] ${reason}` },
        include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } },
      });
    });
    // 입원 취소도 재원 종료다 — 퇴원과 같은 구독점으로 후속을 정리한다(취소 건만 스케줄이 남으면 또 갈라진다)
    this.events?.emit('admission.closed', { admissionId: id, patientId: admission.patientId, reason: 'CANCELLED' });
    this.journey?.emit({ patientId: admission.patientId, eventType: 'ADMISSION_CANCELLED', title: '입원 취소', refType: 'ADMISSION', refId: id }); // 취소 사유는 직원 자유 입력 — 환자 노출 유형이라 싣지 않는다(2026-09-14)
    return cancelled;
  }

  async transfer(id: string, newBedId: string, reason?: string) {
    const admission = await this.prisma.admission.findUnique({ where: { id } });
    if (!admission) throw new NotFoundException('Admission not found');
    // 재원 중(ADMITTED)만 전실 — 퇴원/취소된 입원의 병상을 재점유시키는 desync 방지.
    if (admission.status !== 'ADMITTED') throw new BadRequestException('재원 중인 입원만 전실할 수 있습니다.');
    // 전실(구병상 반납·신병상 선점·배정이력·bedId)을 원자적으로 — 정본 `transferBedInTx`(PACU 퇴실 → 다른 병상도 같은 함수)
    const updated = await this.prisma.$transaction((tx) => transferBedInTx(tx, admission, newBedId, reason ?? 'TRANSFER'));

    // 여정 타임라인: 전실 이력(구 버전은 emit 누락)
    this.journey?.emit({
      patientId: admission.patientId, eventType: 'BED_TRANSFER',
      title: `전실 (${updated.bed?.ward?.name ?? ''})`, department: updated.bed?.ward?.name,
      refType: 'ADMISSION', refId: id,
    });
    return updated;
  }

  async findByPatient(patientId: string) {
    return this.prisma.admission.findMany({
      where: { patientId },
      include: {
        bed: { include: { ward: { select: { name: true, floor: true } } } },
        admittingDoctor: { select: { familyName: true, givenName: true } },
      },
      orderBy: { admitDate: 'desc' },
    });
  }

  /**
   * 현재 입원 환자 목록(입원 관리 화면).
   *
   * 🔴 **환자의 식이가 두 곳에 따로 있다** — `admissions.dietType`(입원 시 지정)과
   *    `diet_orders`(영양팀 식이처방). 연결이 없어 고단백식 처방을 받은 환자가
   *    입원 목록에서 식이 `-` 로 보였다(2026-08-12 실측). **임상 정본은 활성 처방**이다.
   *    같은 병합을 `admission.service.getActiveAdmissions` 에도 넣었다 —
   *    🔴 재원 목록 EP 가 둘이라(`/inpatient`, `/admissions/active/list`) 한쪽만 고치면 갈라진다.
   */
  async getCurrentAdmissions() {
    const admissions = await this.prisma.admission.findMany({
      where: { status: 'ADMITTED' },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        bed: { include: { ward: { select: { name: true, floor: true } } } },
        admittingDoctor: { select: { familyName: true, givenName: true } },
        chargeOfCare: {
          where: { releasedAt: null, role: 'ATTENDING' },
          include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
          take: 1,
        },
      },
      orderBy: { admitDate: 'desc' },
    });

    const patientIds = [...new Set(admissions.map((a) => a.patientId))];
    const dietOrders = patientIds.length
      ? await this.prisma.dietOrder.findMany({
          where: { patientId: { in: patientIds }, isActive: true },
          orderBy: { createdAt: 'desc' },
          select: { patientId: true, dietType: true },
        })
      : [];
    const dietByPatient = new Map<string, string>();
    for (const d of dietOrders) if (!dietByPatient.has(d.patientId)) dietByPatient.set(d.patientId, d.dietType);

    return admissions.map((a) => ({
      ...a,
      dietType: dietByPatient.get(a.patientId) ?? a.dietType ?? null,
      dietSource: dietByPatient.has(a.patientId) ? 'ORDER' : a.dietType ? 'ADMISSION' : null,
    }));
  }

  async getAdmission(id: string) {
    const admission = await this.prisma.admission.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        bed: { include: { ward: { select: { name: true, floor: true } } } },
        admittingDoctor: { select: { familyName: true, givenName: true, department: true } },
        progressNotes: { orderBy: { noteDate: 'desc' }, include: { doctor: { select: { familyName: true, givenName: true } } } },
        chargeOfCare: {
          where: { releasedAt: null, role: 'ATTENDING' },
          include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
          take: 1,
        },
      },
    });
    if (!admission) throw new NotFoundException('Admission not found');
    return admission;
  }

  async addProgressNote(admissionId: string, doctorId: string, data: { content: string; vitalSigns?: Record<string, string | number | null>; noteType?: 'PROGRESS' | 'ADMISSION' }) {
    return this.prisma.progressNote.create({
      data: { admissionId, doctorId, noteDate: todayDateOnly(), content: data.content, vitalSigns: data.vitalSigns, noteType: data.noteType }, // 생략 → 컬럼 기본값(PROGRESS) — 코드에서 기본값을 다시 적지 않는다
    });
  }

  // ── 주치의 관리 ──

  async getAttending(admissionId: string) {
    const current = await this.prisma.chargeOfCare.findFirst({
      where: { admissionId, releasedAt: null },
      include: { doctor: { select: { id: true, familyName: true, givenName: true, department: true } } },
    });
    return { data: current };
  }

  async changeAttending(admissionId: string, dto: { newDoctorId: string; reason: string; handoffNote?: string }, changedBy: string) {
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundException('Admission not found');

    const now = new Date();

    // 현재 주치의 종료
    // 담당의 이관은 이전 담당 해제·신규 배정·입원 갱신·인수인계가 함께 성립해야 한다 —
    // 부분 성공 시 담당의가 둘이거나 없는 상태, 또는 인수인계 없는 이관이 된다.
    // (2026-07 트랜잭션 경계 전수)
    await this.prisma.$transaction(async (tx) => {
      await tx.chargeOfCare.updateMany({ where: { admissionId, releasedAt: null, role: 'ATTENDING' }, data: { releasedAt: now, reason: dto.reason } });

      // 새 주치의 시작
      await tx.chargeOfCare.create({ data: { admissionId, doctorId: dto.newDoctorId, role: 'ATTENDING', assignedAt: now, assignedBy: changedBy } });

      // Admission 캐시 갱신
      await tx.admission.update({ where: { id: admissionId }, data: { attendingDoctorId: dto.newDoctorId } });

      // 인수인계 기록
      if (admission.attendingDoctorId ?? admission.admittingDoctorId) {
        await tx.clinicalHandoff.create({
          data: {
            type: 'SHIFT_CHANGE',
            patientId: admission.patientId,
            fromDoctorId: admission.attendingDoctorId ?? admission.admittingDoctorId,
            toDoctorId: dto.newDoctorId,
            admissionId,
            summary: dto.handoffNote ?? dto.reason,
          },
        });
      }
    });

    return { data: { admissionId, newDoctorId: dto.newDoctorId, reason: dto.reason } };
  }

  async getCareTeam(admissionId: string) {
    const history = await this.prisma.chargeOfCare.findMany({
      where: { admissionId },
      include: { doctor: { select: { id: true, familyName: true, givenName: true, department: true } } },
      orderBy: { assignedAt: 'desc' },
    });
    return { data: history };
  }

  // ── 인수인계 ──

  /**
   * 인수인계 생성. I-PASS 5필드(illness·patientSummary·actionList·situationAwareness·synthesis)는
   * 🔴 2026-08-19 이전 **DTO 에 없어 whitelist 가 조용히 지웠다** — 여기 타입에도 없어서
   *    `data: dto` 가 무엇을 넘기는지 아무도 몰랐다. 타입에 적어 두면 다음에 빠질 때 컴파일이 잡는다.
   */
  async createHandoff(dto: {
    type: string; patientId: string; fromDoctorId: string; toDoctorId: string;
    admissionId?: string; emergencyVisitId?: string; summary: string;
    vitalSigns?: Record<string, string | number | null>; pendingItems?: Record<string, string | number | null>;
    illness?: string; patientSummary?: string;
    actionList?: { action: string; status?: string; deadline?: string }[];
    situationAwareness?: string; synthesis?: string;
  }) {
    // 🔴 (2026-10-04) 입원과 환자가 어긋나면 인계 메모가 다른 환자에게 붙는다 — 입원을 지정했으면 그 입원의 환자여야 한다
    if (dto.admissionId) {
      const adm = await this.prisma.admission.findUnique({ where: { id: dto.admissionId }, select: { patientId: true } });
      if (!adm) throw new NotFoundException('입원을 찾을 수 없습니다');
      if (adm.patientId !== dto.patientId) {
        throw new BadRequestException({ code: 'HANDOFF_PATIENT_MISMATCH', message: '입원의 환자와 인계 환자가 다릅니다.' });
      }
    }
    const handoff = await this.prisma.clinicalHandoff.create({
      data: dto,
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        fromDoctor: { select: { familyName: true, givenName: true } },
      },
    });

    // 🔴 종전엔 create 만 하고 끝 — 인수자가 화면을 열어야만 인계를 알 수 있어 야간 인계가 묻혔다.
    //    인앱 알림(이메일 아님 — 2026-08-03 결정)이 정본 통지 경로다. 실패해도 인계 등록은 유지(비차단).
    //    refId 는 handoff.id(UUID) — 알림 refId 계약.
    try {
      await this.notifications?.notify(dto.toDoctorId, {
        type: 'CLINICAL_HANDOFF',
        title: '🔁 인수인계 도착',
        message: `${handoff.patient.familyName}${handoff.patient.givenName}(${handoff.patient.mrn}) — ${handoff.fromDoctor.familyName}${handoff.fromDoctor.givenName} 님의 인계입니다. 확인 후 인수 처리하세요.`,
        severity: 'WARNING',
        refType: 'CLINICAL_HANDOFF',
        refId: handoff.id,
      });
    } catch (e) {
      this.logger.warn(`인수인계 알림 발신 실패(비차단) handoff=${handoff.id}: ${(e as Error).message}`);
    }

    // W.Channel 연동 훅 — 어댑터가 이 이벤트를 구독해 채널로 릴레이한다(어댑터 미구현 상태에선 무소비).
    this.events?.emit('handoff.created', {
      handoffId: handoff.id,
      handoffType: dto.type,
      patientId: dto.patientId,
      fromUserId: dto.fromDoctorId,
      toUserId: dto.toDoctorId,
      admissionId: dto.admissionId ?? null,
    });

    return { data: handoff };
  }

  async getRecentHandoffs(limit: number, admissionId?: string, doctorId?: string) {
    return (await this.getRecentHandoffsRaw(limit, admissionId, doctorId)).map(withHandoffView);
  }

  private async getRecentHandoffsRaw(limit: number, admissionId?: string, doctorId?: string) {
    const where: Prisma.ClinicalHandoffWhereInput = {};
    if (admissionId) where.admissionId = admissionId;
    // 그 의사가 **주었거나 받은** 인계 — 한쪽만 보면 "내가 넘긴 환자"가 목록에서 사라진다
    if (doctorId) where.OR = [{ fromDoctorId: doctorId }, { toDoctorId: doctorId }];
    return this.prisma.clinicalHandoff.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
        fromDoctor: { select: { id: true, familyName: true, givenName: true, role: true } },
        toDoctor: { select: { id: true, familyName: true, givenName: true } },
      },
    });
  }

  /** 환자별 인수인계 — 이중 래핑 제거(컨트롤러가 `{ data }` 를 씌운다) + 환자 정보 동봉 */
  async getHandoffs(patientId: string) {
    return (await this.prisma.clinicalHandoff.findMany({
      where: { patientId },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
        fromDoctor: { select: { id: true, familyName: true, givenName: true, role: true, department: true } },
        toDoctor: { select: { id: true, familyName: true, givenName: true, department: true } },
      },
      orderBy: { createdAt: 'desc' },
    })).map(withHandoffView);
  }

  /**
   * 인계 조치 항목 완료/되돌림(2026-10-04).
   *  · 인계 당사자(인계자·인수자)만 · ADMIN 예외 — 남의 인계 조치를 대신 끝내지 못하게
   *  · `index` 는 **화면과 같은 규칙**(shared `handoffActionsOf` — 모양이 틀린 칸은 건너뜀)으로 센 위치
   *  · 화면이 본 글자와 지금 글자가 다르면 409(그 사이 바뀜) · 조치 목록을 읽을 수 없으면 409
   *  · 완료 = 상태 + 완료자·시각 · 되돌림 = 그 셋을 지운다(감사 원장에 변이가 남는다)
   *  · 행 잠금 — 두 사람이 동시에 다른 항목을 체크해도 한쪽이 덮어쓰지 않게
   */
  async setHandoffActionStatus(id: string, index: number, dto: { status: string; action: string }, userId: string, role: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM clinical_handoffs WHERE id = ${id}::uuid FOR UPDATE`;
      const h = await tx.clinicalHandoff.findUnique({ where: { id }, select: { actionList: true, fromDoctorId: true, toDoctorId: true } });
      if (!h) throw new NotFoundException('인수인계를 찾을 수 없습니다');
      if (role !== 'ADMIN' && userId !== h.fromDoctorId && userId !== h.toDoctorId) {
        throw new ForbiddenException({ code: 'NOT_HANDOFF_PARTY', message: '인계자·인수자만 조치 항목을 바꿀 수 있습니다.' });
      }
      const raw = h.actionList;
      if (!Array.isArray(raw)) throw new ConflictException({ code: 'ACTION_LIST_UNREADABLE', message: '이 인계의 조치 목록을 읽을 수 없습니다.' });
      const valid = raw.map((x, i) => ({ x, i })).filter(({ x }) => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).action === 'string');
      const target = valid[index];
      if (!target) throw new NotFoundException('조치 항목을 찾을 수 없습니다');
      const item = target.x as Record<string, unknown>;
      if (item.action !== dto.action) {
        throw new ConflictException({ code: 'ACTION_CHANGED', message: '그 사이 조치 목록이 바뀌었습니다. 다시 확인하세요.' });
      }
      let next: Record<string, unknown>;
      if (dto.status === 'DONE') {
        const me = await tx.user.findUnique({ where: { id: userId }, select: { familyName: true, givenName: true } });
        next = { ...item, status: 'DONE', doneAt: new Date().toISOString(), doneById: userId, doneByName: `${me?.familyName ?? ''}${me?.givenName ?? ''}`.trim() || null };
      } else {
        const { doneAt: _a, doneById: _b, doneByName: _c, ...rest } = item;
        next = { ...rest, status: 'PENDING' };
      }
      const list: unknown[] = [...raw];
      list[target.i] = next;
      const updated = await tx.clinicalHandoff.update({ where: { id }, data: { actionList: list as Prisma.InputJsonValue }, select: { id: true, actionList: true } });
      return updated;
    });
  }

  async acknowledgeHandoff(id: string, userId?: string, role?: string) {
    // 🔴 종전엔 소유 검증이 없어 **타인 인계를 대신 확인 처리**할 수 있었다 — acknowledge 는
    //    "지정 인수자가 내용을 확인했다"는 책임 기록이므로 본인만(ADMIN 은 운영 예외).
    if (userId && role !== 'ADMIN') {
      const h = await this.prisma.clinicalHandoff.findUnique({ where: { id }, select: { toDoctorId: true } });
      if (!h) throw new NotFoundException('인수인계를 찾을 수 없습니다');
      if (h.toDoctorId !== userId) {
        throw new BadRequestException({ code: 'NOT_HANDOFF_RECIPIENT', message: '지정 인수자 본인만 인수 확인할 수 있습니다.' });
      }
    }
    // 🔴 (2026-10-07) 다시 누르면 처음 인수 확인 시각이 덮어써졌다 — 책임이 넘어간 시각은 한 번만 남는다(이미 확인이면 그대로 + 표지)
    // 확인한 사람을 남긴다 — 관리자 대리 확인을 본인 확인과 구별(2026-10-26)
    const r = await this.prisma.clinicalHandoff.updateMany({ where: { id, acknowledgedAt: null }, data: { acknowledgedAt: new Date(), acknowledgedBy: userId ?? null } });
    const row = await this.prisma.clinicalHandoff.findUnique({ where: { id }, include: { fromDoctor: { select: { role: true } } } });
    if (!row) throw new NotFoundException('인수인계를 찾을 수 없습니다');
    const view = withHandoffView(row);
    const takeOver = await this.bundledTakeOver(view, r.count === 1, userId, role);
    return { data: { ...view, alreadyAcknowledged: r.count === 0, takeOver } };
  }

  /**
   * 인계 인수 방식 "늘 묶음"(원내 규정 `nursing.handoff.ackTakeOverMode` · 2026-10-26) — 간호 교대 인계의 인수 확인이 곧 담당 인수.
   *  · 이번 호출이 처음 확인했을 때만(다시 눌러 담당을 또 옮기지 않는다) · 지정 인수자 본인일 때만(🔴 관리자 대리 확인은 담당을 넘기지 않는다).
   *  · 확인이 먼저다 — 담당 인수가 실패해도 확인은 남고, 응답이 실패 사유를 말한다(확인을 되돌리지 않는다).
   *  · 🔴 방식을 모르면(설정 조회 실패) 넘기지 않는다 — 짐작으로 담당을 옮기지 않는다.
   */
  private async bundledTakeOver(
    h: { id: string; kind: string; admissionId: string | null; toDoctorId: string },
    firstAck: boolean, userId?: string, role?: string,
  ): Promise<{ mode: HandoffAckMode | null; done: boolean; reason: string | null } | null> {
    if (h.kind !== 'NURSING_SHIFT' || !h.admissionId) return null;
    const { mode } = await readHandoffAckMode(this.config);
    if (mode !== 'ALWAYS_BUNDLED') return { mode, done: false, reason: mode == null ? 'MODE_UNKNOWN' : 'NOT_BUNDLED' };
    if (!firstAck) return { mode, done: false, reason: 'ALREADY_ACKNOWLEDGED' };
    if (!userId || userId !== h.toDoctorId) return { mode, done: false, reason: 'PROXY_ACK' };
    if (role !== 'NURSE') return { mode, done: false, reason: 'NOT_NURSE' };
    try {
      // 교대 경계 조회 실패는 아래 catch 로 — 근무조를 짐작하지 않는다(확인은 남고 담당 인수 실패로 말한다)
      const raw = await this.config?.get('nursing.shift.boundaries');
      const shiftType = shiftWindowAt(new Date(), normalizeShiftBoundaries(raw)).shift;
      await this.prisma.$transaction((tx) => takeOverInTx(tx, userId, h.admissionId!, shiftType));
      return { mode, done: true, reason: null };
    } catch (e) {
      const code = (e as { response?: { code?: string } })?.response?.code ?? null;
      this.logger.warn(`인계 ${h.id} 인수 확인은 기록 — 묶음 담당 인수 실패: ${code ?? (e instanceof Error ? e.message : String(e))}`);
      return { mode, done: false, reason: code ?? 'TAKE_OVER_FAILED' };
    }
  }

  /**
   * 미확인 인수인계.
   *
   * 🔴 `toDoctor` 를 include 하지 않아 **인수인계 화면이 통째로 크래시**했다
   *    (`Cannot read properties of undefined (reading 'familyName')` · 2026-08-12 실측).
   *    교대 인계는 환자 안전의 핵심인데 화면이 아예 열리지 않았다.
   * 🔴 서비스가 `{ data }` 로 감싸는데 컨트롤러가 또 감싸 **이중 래핑**이었다 —
   *    화면이 `Array.isArray` 로 우회하고 있었다. 서버에서 바로잡는다.
   */
  async getPendingHandoffs(doctorId: string) {
    return (await this.prisma.clinicalHandoff.findMany({
      where: { toDoctorId: doctorId, acknowledgedAt: null },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
        fromDoctor: { select: { id: true, familyName: true, givenName: true, role: true, department: true } },
        toDoctor: { select: { id: true, familyName: true, givenName: true, department: true } },
      },
      orderBy: { createdAt: 'desc' },
    })).map(withHandoffView);
  }

  /**
   * 다음 교대 근무 간호사(P1-4·2026-08-04) — 인수자 선택이 전체 간호사 35명 목록이던 것을
   * 근무표(DutyEntry) 기반 제안으로 좁힌다. 근무표 미작성이면 빈 배열(fail-open — 화면은 전체 목록 유지).
   * 다음 교대: DAY→EVENING(당일) → NIGHT(당일) → DAY(익일). 교대 경계는 config(shared 정본).
   */
  async getNextShiftNurses() {
    const raw = await this.config?.get('nursing.shift.boundaries').catch(() => null);
    const b = normalizeShiftBoundaries(raw);
    // 🔴 (2026-09-30) 종전엔 NIGHT 자정 이후(0~7시)에도 "익일"을 더해 **모레** 근무표를 봤다 — 다음 근무조는
    //    이번 근무조가 끝나는 시각의 날짜다. 판정도 실행 환경 시간대(`getHours`)가 아니라 병원 표준시로(운영 서버는 현재 KST 라 맞았지만 환경에 기대지 않는다).
    const w = shiftWindowAt(new Date(), b);
    const current = w.shift;
    const nextShift = current === 'DAY' ? 'EVENING' : current === 'EVENING' ? 'NIGHT' : 'DAY';
    const targetKst = new Date(w.end.getTime() + HOSPITAL_TZ_OFFSET_MIN * 60_000);
    const targetDate = new Date(Date.UTC(targetKst.getUTCFullYear(), targetKst.getUTCMonth(), targetKst.getUTCDate())); // @db.Date=UTC 자정 표현
    const entries = await this.prisma.dutyEntry.findMany({
      where: { date: targetDate, shift: nextShift, role: 'nurse' },
      select: { staffId: true, staffName: true, department: true },
      orderBy: { staffName: 'asc' },
    });
    return { nextShift, entries };
  }

  // ── 회진 ──

  async addRound(admissionId: string, doctorId: string, dto: { roundType: string; notes?: string; assessment?: string; plan?: string; vitalSigns?: Record<string, string | number | null> }) {
    return { data: await this.prisma.round.create({
      data: { admissionId, doctorId, roundType: dto.roundType, roundedAt: new Date(), notes: dto.notes, assessment: dto.assessment, plan: dto.plan, vitalSigns: dto.vitalSigns },
    })};
  }

  async getRounds(admissionId: string) {
    return { data: await this.prisma.round.findMany({
      where: { admissionId },
      include: { doctor: { select: { familyName: true, givenName: true } } },
      orderBy: { roundedAt: 'desc' },
    })};
  }

  async getTodayRounds() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const admitted = await this.prisma.admission.findMany({
      where: { status: 'ADMITTED' },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        bed: { include: { ward: { select: { name: true } } } },
        rounds: { where: { roundedAt: { gte: today } }, select: { roundType: true, roundedAt: true } },
      },
      orderBy: { admitDate: 'asc' },
    });
    return { data: admitted.map(a => ({ ...a, roundedToday: a.rounds.length > 0 })) };
  }

  // ── 병상 이력 ──

  async getBedHistory(admissionId: string) {
    return { data: await this.prisma.bedAssignment.findMany({
      where: { admissionId },
      include: { bed: { include: { ward: { select: { name: true } } } } },
      orderBy: { assignedAt: 'asc' },
    })};
  }

  // ── 중간 정산 ──

  /** 수납 원장 줄과 함께 — 화면이 회차마다 수단·처리자를 말한다(2026-10-22) */
  async getInterimBillings(admissionId: string) {
    const billings = await this.prisma.interimBilling.findMany({
      where: { admissionId },
      orderBy: { sequenceNo: 'asc' },
      include: { payments: { orderBy: { createdAt: 'asc' } }, refunds: { orderBy: { refundedAt: 'asc' } } },
    });
    return { data: billings };
  }

  /**
   * 중간정산 생성 — 마지막 회차(무효 제외) 끝 날짜부터 오늘(KST)까지의 입원료.
   *
   * 🔴 (2026-10-22) 종전 결함:
   *  ① 산식이 퇴원 입원료 청구와 달랐다 — 설정 일당(없으면 50,000)·건보 80% 상수. 이제 같은 정본 `BillingService.quoteInpatientStay`
   *     (수가코드 단가·종별 단가 → 설정 → 상수 · 자격별 급여율 INPATIENT). 단가 출처를 행에 남긴다(DEFAULT_CONSTANT = 근거 없는 상수).
   *  ② `@db.Date` 칸에 `new Date()`(로컬 순간)를 넣어 하루가 밀렸고, 다음 회차가 직전 회차의 **끝 날짜에서** 시작해 경계일을 두 번 셌다.
   *     같은 날 두 번 누르면 `max(1, …)` 때문에 하루치가 또 생겼다. 이제 기간은 [시작, 끝) 박(泊) 수 · 0박이면 409.
   *  ③ 퇴원·취소된 입원에도 만들었다(오늘까지 계속 셌다) → 재원 중(ADMITTED·TRANSFERRED)만.
   *  ④ 동시 생성이 같은 회차·같은 기간을 두 번 만들었다 → (입원, 회차) 유일 · 패자는 409.
   */
  async generateInterimBilling(admissionId: string, actorId?: string) {
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { id: true, patientId: true, status: true, admitDate: true } });
    if (!admission) throw new NotFoundException('Admission not found');
    if (admission.status !== 'ADMITTED' && admission.status !== 'TRANSFERRED') {
      throw new ConflictException({ code: 'INTERIM_NOT_ADMITTED', message: '재원 중인 입원에만 중간정산을 만듭니다 — 퇴원·취소된 입원은 퇴원 정산으로 처리합니다', status: admission.status });
    }
    if (!this.billing) throw new ConflictException({ code: 'INTERIM_PRICING_UNAVAILABLE', message: '입원료 산정 정본(청구 모듈)이 연결되지 않아 중간정산을 만들 수 없습니다' });

    const all = await this.prisma.interimBilling.findMany({ where: { admissionId }, orderBy: { sequenceNo: 'desc' }, select: { sequenceNo: true, periodEnd: true, status: true } });
    const lastLive = all.find((b) => b.status !== 'VOID');
    const periodStart = lastLive ? lastLive.periodEnd : dateOnlyValue(admission.admitDate)!;
    const periodEnd = todayDateOnly();
    const days = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000);
    if (days <= 0) {
      throw new ConflictException({ code: 'INTERIM_NO_NEW_PERIOD', message: '직전 중간정산 이후 새로 정산할 날이 없습니다(같은 날 두 번 만들 수 없습니다)', periodStart });
    }

    const quote = await this.billing.quoteInpatientStay(admissionId, days);
    if (!quote.ok) throw new ConflictException({ code: 'INTERIM_PRICE_UNKNOWN', message: '입원료 수가코드를 찾지 못해 중간정산을 만들 수 없습니다', reason: quote.reason });

    const sequenceNo = (all[0]?.sequenceNo ?? 0) + 1;
    let billing;
    try {
      billing = await this.prisma.interimBilling.create({
        data: {
          admissionId, periodStart, periodEnd, sequenceNo,
          totalAmount: quote.totalAmount, insuranceAmount: quote.insuranceAmount, copayAmount: quote.copayAmount,
          days, dailyRate: quote.dailyRate, stayCode: quote.stayCode, priceBasis: quote.priceBasis, copayRate: quote.copayRate,
          createdBy: actorId ?? null,
          status: 'GENERATED',
        },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictException({ code: 'INTERIM_CONCURRENT', message: '다른 처리가 먼저 같은 회차의 중간정산을 만들었습니다 — 새로 고친 뒤 확인하세요' });
      }
      throw e;
    }

    // ERP export(A-6·발생주의) — 중간정산 발생 이벤트. ref 멱등(ERP 인박스 UNIQUE 중복 무시) · (가)안: 무전표
    void this.emitInterimEvent('billing.interim_recorded', `interim:rec:${billing.id}`, admission.patientId, billing);

    return { data: billing };
  }

  /** 중간정산 ERP outbox 발행 — 환자 매칭키(mrn) 동봉·best-effort(발행 실패해도 정산 무영향) */
  private async emitInterimEvent(event: HisEvent, ref: string, patientId: string, billing: {
    id: string; admissionId: string; sequenceNo: number; periodStart: Date; periodEnd: Date;
    totalAmount: unknown; insuranceAmount: unknown; copayAmount: unknown; paidAmount?: unknown; paidAt?: Date | null; status: string;
    days?: number | null; dailyRate?: unknown; stayCode?: string | null; priceBasis?: string | null; copayRate?: unknown;
    paidBy?: string | null; voidedAt?: Date | null; voidedBy?: string | null; voidReason?: string | null;
  }, payments?: { method: string; amount: number; cardApprovalNo: string | null; cardCompany: string | null; installment: number | null; cashReceiptNo: string | null; processedBy: string | null; createdAt: Date }[], extra?: Record<string, unknown>) {
    if (!this.outbox) return;
    try {
      const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { mrn: true } });
      void this.outbox.enqueue('billing', event, ref, {
        interimBillingId: billing.id, admissionId: billing.admissionId, patientId, chartNo: patient?.mrn ?? null,
        sequenceNo: billing.sequenceNo, periodStart: billing.periodStart, periodEnd: billing.periodEnd,
        totalAmount: Number(billing.totalAmount ?? 0), insuranceAmount: Number(billing.insuranceAmount ?? 0),
        copayAmount: Number(billing.copayAmount ?? 0), paidAmount: Number(billing.paidAmount ?? 0),
        paidAt: billing.paidAt ?? null, status: billing.status,
        // 2026-10-22 추가 칸(덧붙이기만 — 종전 칸 불변) · 산정 근거 · 근거 칸 전 생성분은 null
        days: billing.days ?? null, dailyRate: billing.dailyRate == null ? null : Number(billing.dailyRate),
        stayCode: billing.stayCode ?? null, priceBasis: billing.priceBasis ?? null,
        copayRate: billing.copayRate == null ? null : Number(billing.copayRate),
        ...(payments ? {
          // 수납 수단 원장 — 🔴 종전엔 수단이 없어 ERP 가 어느 계정(현금·카드 미수·예금)으로 받을지 몰랐다
          payments: payments.map((p) => ({ method: p.method, amount: p.amount, cardApprovalNo: p.cardApprovalNo, cardCompany: p.cardCompany, installment: p.installment, cashReceiptNo: p.cashReceiptNo, processedBy: p.processedBy, recordedAt: p.createdAt })),
          paidBy: billing.paidBy ?? null,
        } : {}),
        ...(billing.voidedAt ? { voidedAt: billing.voidedAt, voidedBy: billing.voidedBy ?? null, voidReason: billing.voidReason ?? null } : {}),
        ...(extra ?? {}),
      });
    } catch (e) {
      this.logger.warn(`중간정산 ERP 이벤트 발행 실패(${event}) ${ref}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * 중간정산 수납 — 본인부담 전액 · 수단·처리자·원장 줄(2026-10-22).
   * 🔴 종전엔 수단도 처리자도 원장 줄도 없었다 — 일마감 시재·카드 대사에서 이 돈이 보이지 않았고 ERP 는 받을 계정을 몰랐다.
   *    상태 전이와 원장 줄은 한 트랜잭션(둘 중 하나만 남지 않는다).
   */
  async payInterimBilling(admissionId: string, billingId: string, dto: PayInterimBillingInput, actorId?: string) {
    const billing = await this.prisma.interimBilling.findFirst({
      where: { id: billingId, admissionId },
    });
    if (!billing) throw new NotFoundException('Interim billing not found');
    if (billing.status === 'PAID') throw new BadRequestException('Already paid');
    if (billing.status === 'VOID') throw new ConflictException({ code: 'INTERIM_VOID', message: '무효 처리된 중간정산은 수납할 수 없습니다' });

    // 🔴 (2026-10-14 수납·청구 결함 발굴 P3-2) 본인부담 전액만 · 0원은 수납이 아니다 · 상태 조건부
    const due = Number(billing.copayAmount);
    if (!(due > 0)) throw new ConflictException({ code: 'INTERIM_NOTHING_DUE', message: '받을 본인부담금이 없는 중간정산입니다' });
    const paidAmount = dto.amount ?? due;
    if (!Number.isInteger(paidAmount) || paidAmount !== due) {
      throw new BadRequestException({ code: 'INTERIM_AMOUNT_MISMATCH', message: '중간정산은 본인부담금 전액을 받습니다', details: { amount: paidAmount, due } });
    }
    if (dto.method === 'CARD' && !dto.cardApprovalNo?.trim()) {
      throw new BadRequestException({ code: 'INTERIM_CARD_APPROVAL_REQUIRED', message: '카드 수납은 승인번호가 있어야 합니다 — 카드 대사에 쓰입니다' });
    }

    const paidAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.interimBilling.updateMany({
        where: { id: billingId, status: billing.status },
        data: { status: 'PAID', paidAmount, paidAt, paidBy: actorId ?? null },
      });
      if (r.count === 0) throw new ConflictException({ code: 'INTERIM_CHANGED', message: '다른 처리로 중간정산 상태가 바뀌었습니다 — 새로 고친 뒤 확인하세요' });
      await tx.interimBillingPayment.create({
        data: {
          interimBillingId: billingId, method: dto.method, amount: paidAmount,
          cardApprovalNo: dto.cardApprovalNo?.trim() || null, cardCompany: dto.cardCompany?.trim() || null,
          installment: dto.installment ?? null, cashReceiptNo: dto.cashReceiptNo?.trim() || null,
          processedBy: actorId ?? null, createdAt: paidAt,
        },
      });
      return tx.interimBilling.findUniqueOrThrow({ where: { id: billingId }, include: { payments: { orderBy: { createdAt: 'asc' } } } });
    });

    // ERP export(A-6) — 중간정산 수납 이벤트(현금흐름 · (가)안: 유일한 중간수납 현금 경로). ref 멱등
    const adm = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { patientId: true } });
    if (adm) void this.emitInterimEvent('billing.interim_paid', `interim:paid:${billingId}`, adm.patientId, updated, updated.payments);

    return { data: updated };
  }

  /**
   * 중간정산 무효(2026-10-22) — 잘못 만든 회차를 지우지 않고 무효로 둔다(사유 필수 · 수납 전만 · 마지막 살아 있는 회차만).
   * 마지막 회차만 — 가운데를 무효로 하면 기간에 구멍이 생긴다(다음 회차가 그 구멍을 다시 세지 않는다).
   * 수납된 회차는 무효가 아니라 환불 몫이다(ERP 와 역분개 합의 전 — 여기서 하지 않는다).
   */
  async voidInterimBilling(admissionId: string, billingId: string, reason: string, actorId?: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 4) throw new BadRequestException({ code: 'INTERIM_VOID_REASON_REQUIRED', message: '무효 사유를 4자 이상 적어 주세요' });
    const billing = await this.prisma.interimBilling.findFirst({ where: { id: billingId, admissionId } });
    if (!billing) throw new NotFoundException('Interim billing not found');
    if (billing.status === 'PAID') throw new ConflictException({ code: 'INTERIM_PAID_NOT_VOIDABLE', message: '수납된 중간정산은 무효로 할 수 없습니다 — 환불로 처리합니다' });
    if (billing.status === 'VOID') throw new ConflictException({ code: 'INTERIM_VOID', message: '이미 무효 처리된 중간정산입니다' });
    const later = await this.prisma.interimBilling.count({ where: { admissionId, sequenceNo: { gt: billing.sequenceNo }, status: { not: 'VOID' } } });
    if (later > 0) throw new ConflictException({ code: 'INTERIM_NOT_LATEST', message: '마지막 회차부터 무효로 합니다 — 가운데 회차를 무효로 하면 기간에 구멍이 생깁니다' });

    const voidedAt = new Date();
    const r = await this.prisma.interimBilling.updateMany({
      where: { id: billingId, status: billing.status },
      data: { status: 'VOID', voidedAt, voidedBy: actorId ?? null, voidReason: trimmed },
    });
    if (r.count === 0) throw new ConflictException({ code: 'INTERIM_CHANGED', message: '다른 처리로 중간정산 상태가 바뀌었습니다 — 새로 고친 뒤 확인하세요' });
    const updated = await this.prisma.interimBilling.findUniqueOrThrow({ where: { id: billingId } });
    const adm = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { patientId: true } });
    // ERP — 발생 이벤트를 무효로 알린다(발생은 무전표라 회계 영향 없음 · ERP 가 구독해야 받는다)
    if (adm) void this.emitInterimEvent('billing.interim_voided', `interim:void:${billingId}`, adm.patientId, updated);
    return { data: updated };
  }

  /**
   * 중간정산 환불(2026-10-22 · ERP 회신 R5 계약 — `docs/05-reference/erp-reply-his-interim-settlement-2026-10-22.md` §2).
   *  · 수납된(PAID) 회차만 · 부분 환불 · 누적 환불 ≤ 그 회차 수납액(넘으면 409) · 사유 4자 · 수단 = 중간정산 수단 어휘
   *  · 🔴 동시 환불이 합계를 넘지 않게 회차 행을 잠그고(FOR UPDATE) 다시 합산한다
   *  · 회차 상태는 PAID 그대로(무효가 아니다) · 퇴원 정산 기납부에서 뺀다
   *  · 이벤트 `billing.interim_refunded` — ref `interim:refund:{refundId}` · 본문에 refundId(ERP 멱등 키) · 수납 이벤트는 수납 때 이미 나갔다
   *  · 🔴 (v4.118.0 · ERP 2차 회신 §3-2) 요청 중복 방지 키 필수 — 종전엔 네트워크 재전송이 상한 안에서 두 번째 환불(다른 refundId)이 됐고
   *       ERP 는 그것을 정상 부분 환불과 구별할 수 없었다. 같은 키·같은 내용 = 첫 결과 그대로(새 환불·이벤트 없음) · 같은 키·다른 내용 = 409
   */
  async refundInterimBilling(admissionId: string, billingId: string, dto: { amount: number; method: 'CARD' | 'CASH' | 'TRANSFER'; reason: string }, actorId?: string, requestKey?: string) {
    const key = (requestKey ?? '').trim();
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '환불 요청에는 Idempotency-Key(영문·숫자·-·_ 8~100자)가 필요합니다' });
    }
    const reason = (dto.reason ?? '').trim();
    if (reason.length < 4) throw new BadRequestException({ code: 'INTERIM_REFUND_REASON_REQUIRED', message: '환불 사유를 4자 이상 적어 주세요' });
    if (!Number.isInteger(dto.amount) || dto.amount <= 0) throw new BadRequestException({ code: 'INTERIM_REFUND_AMOUNT_INVALID', message: '환불 금액은 1원 이상의 정수입니다' });
    const billing = await this.prisma.interimBilling.findFirst({ where: { id: billingId, admissionId } });
    if (!billing) throw new NotFoundException('Interim billing not found');
    if (billing.status !== 'PAID') throw new ConflictException({ code: 'INTERIM_NOT_PAID', message: '수납된 중간정산만 환불합니다' });

    type Refund = Prisma.InterimBillingRefundGetPayload<object>;
    // 같은 키 = 같은 요청이어야 한다(회차·금액·수단·사유) — 다르면 재전송이 아니라 키 재사용이다
    const replayOrConflict = (prior: Refund) => {
      const same = prior.interimBillingId === billingId && prior.amount === dto.amount && prior.method === dto.method && prior.reason === reason;
      if (!same) {
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_CONFLICT', message: '같은 요청 키로 다른 내용의 환불을 보냈습니다 — 새 요청이면 새 키를 쓰세요' });
      }
      return { data: prior, meta: { replayed: true } };
    };

    let outcome: { refund: Refund; replayed: boolean };
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        // 🔴 잠근 **뒤에** 합산한다 — 잠그기 전에 읽으면 경합 상대가 그 사이에 넣은 환불을 못 본다
        await tx.$queryRaw`SELECT id FROM interim_billings WHERE id = ${billingId}::uuid FOR UPDATE`;
        // 같은 키가 이미 있으면 새로 쓰지 않는다(잠근 뒤라 같은 회차의 동시 재전송도 여기서 갈린다)
        const prior = await tx.interimBillingRefund.findUnique({ where: { requestKey: key } });
        if (prior) return { refund: replayOrConflict(prior).data, replayed: true };
        const agg = await tx.interimBillingRefund.aggregate({ where: { interimBillingId: billingId }, _sum: { amount: true } });
        const already = agg._sum.amount ?? 0;
        const paid = Number(billing.paidAmount ?? 0);
        if (already + dto.amount > paid) {
          throw new ConflictException({ code: 'INTERIM_REFUND_EXCEEDS_PAID', message: '환불 합계가 이 회차에서 받은 금액을 넘습니다', details: { paid, alreadyRefunded: already, requested: dto.amount } });
        }
        const refund = await tx.interimBillingRefund.create({ data: { interimBillingId: billingId, amount: dto.amount, method: dto.method, reason, refundedBy: actorId ?? null, requestKey: key } });
        return { refund, replayed: false };
      });
    } catch (e) {
      // 다른 회차에 같은 키가 동시에 들어온 경우(회차 잠금 밖) — 유일 인덱스가 막는다 → 먼저 들어간 행으로 판정
      if ((e as { code?: string })?.code === 'P2002') {
        const prior = await this.prisma.interimBillingRefund.findUnique({ where: { requestKey: key } });
        if (prior) return replayOrConflict(prior);
      }
      throw e;
    }
    // 재전송 — 첫 요청이 이미 이벤트를 냈다(다시 내지 않는다)
    if (outcome.replayed) return { data: outcome.refund, meta: { replayed: true } };
    const refund = outcome.refund;

    const adm = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { patientId: true } });
    if (adm) {
      void this.emitInterimEvent('billing.interim_refunded', `interim:refund:${refund.id}`, adm.patientId, billing, undefined, {
        refund: { refundId: refund.id, amount: refund.amount, method: refund.method, reason: refund.reason, refundedBy: refund.refundedBy, refundedAt: refund.refundedAt },
      });
    }
    return { data: refund, meta: { replayed: false } };
  }

  /**
   * 퇴원 정산서(B) — 입원 전체 진료비를 단일 정산으로 통합하고 **중간정산·기수납을 차감**한 잔액 산출.
   * 총진료비 = Σ(입원 진료기록 청구 totalAmount) + Σ(중간정산 totalAmount)
   * 총본인부담 = Σ(청구 patientCopay − 감면) + Σ(중간정산 copayAmount)
   * 기납부 = Σ(청구 paidAmount) + Σ(중간정산 PAID paidAmount)
   * 퇴원 수납 잔액 = max(0, 총본인부담 − 기납부)
   */
  async getDischargeSettlement(admissionId: string) {
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundException('Admission not found');

    // 입원 진료기록(admissionId 연계)들의 청구
    const encounters = await this.prisma.encounter.findMany({ where: { admissionId }, select: { id: true } });
    const encIds = encounters.map((e) => e.id);
    const encBillings = encIds.length
      ? await this.prisma.billing.findMany({
          where: { encounterId: { in: encIds } },
          select: { id: true, encounterId: true, totalAmount: true, patientCopay: true, discountAmount: true, paidAmount: true, status: true },
        })
      : [];
    // 무효(VOID) 회차는 정산에서 뺀다 — 받지도 청구하지도 않은 회차(2026-10-22)
    const interims = await this.prisma.interimBilling.findMany({ where: { admissionId, status: { not: 'VOID' } }, orderBy: { sequenceNo: 'asc' } });

    const num = (v: unknown) => Number(v ?? 0);
    // 청구(처방·진찰 등) — 본인부담은 감면 차감 후 net
    const encCharges = encBillings.reduce((s, b) => s + num(b.totalAmount), 0);
    const encCopay = encBillings.reduce((s, b) => s + Math.max(0, num(b.patientCopay) - num(b.discountAmount)), 0);
    const encPaid = encBillings.reduce((s, b) => s + num(b.paidAmount), 0);
    // 중간정산(일당 입원료 등)
    const interimCharges = interims.reduce((s, b) => s + num(b.totalAmount), 0);
    const interimCopay = interims.reduce((s, b) => s + num(b.copayAmount), 0);
    const interimPaid = interims.reduce((s, b) => s + (b.status === 'PAID' ? num(b.paidAmount) : 0), 0);
    // 2026-10-22 중간정산 환불(ERP R5) — 돌려준 돈은 기납부가 아니다
    const refundAgg = interims.length
      ? await this.prisma.interimBillingRefund.groupBy({ by: ['interimBillingId'], where: { interimBillingId: { in: interims.map((i) => i.id) } }, _sum: { amount: true } })
      : [];
    const refundedBy = new Map(refundAgg.map((r) => [r.interimBillingId, r._sum.amount ?? 0]));
    const interimRefunded = [...refundedBy.values()].reduce((a, b) => a + b, 0);

    // 🔴 이중계상 봉합(청구 심층검토 §1): stayBilling 게이트 ON이면 입원료 정본=Billing(encCharges)이고
    // interim은 대사·수납관리 전용(ERP (가)안 합의). interim charge/copay를 합산에서 제외(2배 방지).
    // 단 interim 수납액(paid)은 alreadyPaid에 유지 — 기수납 이중차감 방지(P1 설계 정합).
    const stayGateOn = String((await this.config?.get('inpatient.stayBilling.enabled').catch(() => 'false')) ?? 'false') === 'true';
    const interimChargesEff = stayGateOn ? 0 : interimCharges;
    const interimCopayEff = stayGateOn ? 0 : interimCopay;

    const totalCharges = encCharges + interimChargesEff;
    const totalCopay = encCopay + interimCopayEff;
    const alreadyPaid = encPaid + interimPaid - interimRefunded; // 중간정산 수납 − 환불 + 기수납(게이트 무관·항상 반영)
    const balanceDue = Math.max(0, totalCopay - alreadyPaid);

    const dayMs = 24 * 60 * 60 * 1000;
    const endRef = admission.dischargeDate ?? new Date();
    const days = stayDays(admission.admitDate, admission.dischargeDate) ?? 1;

    // #8 대사 검증: Billing+InterimBilling 2계통 정합 경고(수납 화면 가시화·자동차단 아님).
    const unpaidInterims = interims.filter((i) => i.status !== 'PAID').length;
    const overpaid = alreadyPaid > totalCopay;
    // P0 이중 계상 해소(2026-07-23) 이전 생성분은 처방비가 InterimBilling에도 합산돼 있을 수 있음 — 혼재 안내
    const legacyMixNote = interims.some((i) => i.createdAt < new Date('2026-07-24'))
      ? ['2026-07-23 이전 생성 중간정산은 구 산식(처방 포함) 혼재 가능 — 총진료비가 과대일 수 있음(감사 보존·소급 재계산 없음)']
      : [];
    const reconciliation = {
      balanced: !overpaid,
      overpaid, // 기납부가 본인부담 초과(환불 검토)
      overpaidAmount: overpaid ? alreadyPaid - totalCopay : 0,
      unpaidInterims, // 미납 중간정산 건수
      warnings: [
        ...(overpaid ? [`기납부(${alreadyPaid})가 본인부담(${totalCopay}) 초과 — 환불 검토`] : []),
        ...(unpaidInterims > 0 ? [`미납 중간정산 ${unpaidInterims}건 — 퇴원 정산에 포함됨`] : []),
        ...legacyMixNote,
      ],
    };
    if (reconciliation.warnings.length) this.logger.warn(`퇴원정산 대사 경고 admission=${admissionId}: ${reconciliation.warnings.join(' / ')}`);

    return {
      data: {
        admissionId,
        status: admission.status,
        admitDate: admission.admitDate,
        dischargeDate: admission.dischargeDate,
        days,
        totalCharges, // 총진료비
        totalCopay, // 총 본인부담(감면 후)
        alreadyPaid, // 기납부(중간정산+기수납)
        balanceDue, // 퇴원 수납 잔액
        reconciliation, // #8 대사 검증 결과
        breakdown: {
          encounters: { count: encBillings.length, charges: encCharges, copay: encCopay, paid: encPaid,
            billingIds: encBillings.map((b) => b.id) },
          interim: {
            count: interims.length, charges: interimCharges, copay: interimCopay, paid: interimPaid, refunded: interimRefunded,
            items: interims.map((i) => ({
              id: i.id, sequenceNo: i.sequenceNo, periodStart: i.periodStart, periodEnd: i.periodEnd,
              copayAmount: num(i.copayAmount), paidAmount: num(i.paidAmount), refundedAmount: refundedBy.get(i.id) ?? 0, status: i.status,
            })),
          },
        },
      },
    };
  }

  /**
   * 퇴원 정산 ERP export(A-6) — 정산 스냅샷을 outbox로 발행(ERP=진료비 SoT의 회계 반영·D-6 연장).
   * ref에 금액을 바인딩해 값-멱등: 동일 정산 재클릭=중복 무시(ERP 인박스 UNIQUE)·정산 갱신(금액 변경)=재발행.
   */
  async exportDischargeSettlement(admissionId: string, actorUserId?: string) {
    if (!this.outbox) throw new BadRequestException('ERP outbox 미구성 — export 불가');
    const settlement = (await this.getDischargeSettlement(admissionId)).data;
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { patientId: true } });
    const patient = admission ? await this.prisma.patient.findUnique({ where: { id: admission.patientId }, select: { mrn: true } }) : null;
    const ref = `dsettle:${admissionId}:${settlement.totalCopay}:${settlement.alreadyPaid}`;
    await this.outbox.enqueue('billing', 'billing.discharge_settlement', ref, {
      admissionId, patientId: admission?.patientId ?? null, chartNo: patient?.mrn ?? null,
      admitDate: settlement.admitDate, dischargeDate: settlement.dischargeDate, days: settlement.days,
      totalCharges: settlement.totalCharges, totalCopay: settlement.totalCopay,
      alreadyPaid: settlement.alreadyPaid, balanceDue: settlement.balanceDue,
      breakdown: settlement.breakdown, reconciliation: settlement.reconciliation,
      exportedBy: actorUserId ?? null, exportedAt: new Date().toISOString(),
    });
    return { exported: true, ref, balanceDue: settlement.balanceDue, warnings: settlement.reconciliation.warnings };
  }

  // ── 통합 타임라인 ──

  async getPatientTimeline(patientId: string, from?: string, to?: string) {
    const where: Prisma.PatientJourneyEventWhereInput = { patientId };
    if (from || to) {
      where.eventAt = {};
      if (from) where.eventAt.gte = new Date(from);
      if (to) where.eventAt.lte = new Date(to + 'T23:59:59Z');
    }

    const events = await this.prisma.patientJourneyEvent.findMany({
      where,
      orderBy: { eventAt: 'asc' },
      take: 200,
    });

    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, mrn: true, familyName: true, givenName: true },
    });

    return {
      data: {
        patient,
        events,
        summary: {
          totalEvents: events.length,
          firstEvent: events[0]?.eventAt ?? null,
          lastEvent: events[events.length - 1]?.eventAt ?? null,
        },
      },
    };
  }

  // ── 입원 바이탈 — 두 원장 정본(2026-10-10 · 종전 플로시트만 → 간호 스테이션 입력이 "없음") ──

  private async admissionRef(admissionId: string) {
    const a = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { id: true, patientId: true, admitDate: true, dischargeDate: true } });
    if (!a) throw new NotFoundException('Admission not found');
    return a;
  }

  /** 행마다 `ledger`(FLOWSHEET·PREVISIT)와 `recordedAt`(측정 시각) — 종전 응답 키 유지 */
  async getVitals(admissionId: string) {
    const rows = await this.admissionVitals.rows([await this.admissionRef(admissionId)], undefined, 30);
    return rows.slice(0, 30).map((r) => ({ ...r, recordedAt: r.at }));
  }

  async getLatestVitals(admissionId: string) {
    const r = (await this.admissionVitals.latestByAdmission([await this.admissionRef(admissionId)])).get(admissionId);
    return r ? { ...r, recordedAt: r.at } : null;
  }

  // ── 섭취/배설 (IntakeOutput) ──

  async getIntakeOutputs(admissionId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // 두 원장 정본(2026-10-10) — 플로시트에 적은 I/O 도 행으로(ledger) · 최근 순
    return (await new AdmissionIoReader(this.prisma).rows([admissionId], { gte: today })).reverse();
  }

  // ── 간호 기록 (NursingNote) ──

  async getNursingNotes(admissionId: string) {
    return this.prisma.nursingNote.findMany({
      where: { admissionId },
      include: { nurse: { select: { familyName: true, givenName: true } } },
      orderBy: { recordedAt: 'desc' },
      take: 20,
    });
  }

  // ── 간호 사정 (NursingAssessment) ──

  async getNursingAssessments(admissionId: string) {
    return this.prisma.nursingAssessment.findMany({
      where: { admissionId },
      include: { nurse: { select: { familyName: true, givenName: true } } },
      orderBy: { assessedAt: 'desc' },
    });
  }

  // ── 투약 기록 (MedicationAdministration) ──

  async getMedicationAdministrations(admissionId: string) {
    const admission = await this.prisma.admission.findUnique({
      where: { id: admissionId },
      select: { patientId: true },
    });
    if (!admission) return [];
    return this.prisma.medicationAdministration.findMany({
      where: { patientId: admission.patientId },
      include: {
        nurse: { select: { familyName: true, givenName: true } },
        // 처방 단위로 묶고 중단할 수 있게(2026-09-30) — 종전 화면은 용량 문자열로 묶어 다른 약이 한 줄로 합쳐졌다
        prescription: { select: { id: true, status: true, discontinuedAt: true, medicationCode: { select: { nameKo: true } } } },
      },
      orderBy: { scheduledAt: 'desc' },
      take: 30,
    });
  }

  // ── 플로우시트 (전체 — 차트용) ──

  /**
   * 차트 활력 추이 — 두 원장 정본(2026-10-10 · 종전 플로시트만 → 간호 스테이션 입력이 추이에서 빠졌다).
   * 오래된 순 · 행마다 `ledger` · 섭취/배설은 I/O 화면 정본(intake_outputs)이 따로 있다.
   */
  async getFlowSheet(admissionId: string) {
    const rows = await this.admissionVitals.rows([await this.admissionRef(admissionId)]);
    return rows.reverse().map((r) => ({ ...r, recordedAt: r.at }));
  }

  // ── 간호 워크스테이션: 바이탈 미체크 환자 ──

  async getVitalUncheckedPatients() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const admissions = await this.prisma.admission.findMany({
      where: { status: 'ADMITTED' },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        bed: { include: { ward: { select: { name: true } } } },
      },
    });
    // 🔴 (2026-10-10) 플로시트만 보면 간호 스테이션에서 오늘 잰 환자도 '미체크'였다 — 두 원장 정본
    const measured = await this.admissionVitals.admissionsWithAny(admissions, { gte: today });

    return admissions
      .filter(a => !measured.has(a.id))
      .map(a => ({
        admissionId: a.id,
        patient: a.patient,
        bed: a.bed,
        admitDate: a.admitDate,
        daysSince: stayDays(a.admitDate) ?? 0,
      }));
  }

  // ── 간호 워크스테이션: 시간별 투약 스케줄 ──

  async getUpcomingMedications() {
    const now = new Date();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    return this.prisma.medicationAdministration.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { gte: now, lte: endOfDay },
      },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        nurse: { select: { familyName: true, givenName: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 20,
    });
  }

  // ── 입원 일지 자동 생성 (Daily Summary) ──

  async getDailySummary(admissionId: string, date?: string) {
    assertDateParam(date, '조회일');
    const targetDate = date ? new Date(date) : new Date();
    const dayStart = new Date(targetDate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate); dayEnd.setHours(23, 59, 59, 999);

    const admission = await this.prisma.admission.findUnique({
      where: { id: admissionId },
      select: { patientId: true, patient: { select: { familyName: true, givenName: true, mrn: true } }, bed: { include: { ward: { select: { name: true } } } }, admitDate: true, dischargeDate: true },
    });
    if (!admission) throw new NotFoundException('Admission not found');

    const [vitals, ios, mars, notes, rounds] = await Promise.all([
      // 두 원장 정본(2026-10-10) — 오래된 순 · 외래 원장 행은 근무조 칸이 없다(shiftType null)
      this.admissionVitals.rows([{ id: admissionId, patientId: admission.patientId, admitDate: admission.admitDate, dischargeDate: admission.dischargeDate }], { gte: dayStart, lt: new Date(dayEnd.getTime() + 1) })
        .then((rows) => rows.reverse().map((r) => ({ systolicBp: r.systolicBp, diastolicBp: r.diastolicBp, heartRate: r.heartRate, temperature: r.temperature, spo2: r.spo2, respiratoryRate: r.respiratoryRate, painScore: r.painScore, recordedAt: r.at, ledger: r.ledger }))),
      new AdmissionIoReader(this.prisma).rows([admissionId], { gte: dayStart, lt: new Date(dayEnd.getTime() + 1) }),
      this.prisma.medicationAdministration.findMany({
        where: { patientId: admission.patientId, scheduledAt: { gte: dayStart, lte: dayEnd } },
        select: { dose: true, route: true, status: true, scheduledAt: true, administeredAt: true },
      }),
      this.prisma.nursingNote.findMany({
        where: { admissionId, recordedAt: { gte: dayStart, lte: dayEnd } },
        select: { noteType: true, focus: true, subjective: true, action: true, shiftType: true, recordedAt: true },
        orderBy: { recordedAt: 'asc' },
      }),
      this.prisma.round.findMany({
        where: { admissionId, roundedAt: { gte: dayStart, lte: dayEnd } },
        select: { roundType: true, assessment: true, plan: true, roundedAt: true, doctor: { select: { familyName: true, givenName: true } } },
      }),
    ]);

    // I/O 합계
    const totalIntake = ios.reduce((s, r) => s + (r.intakeAmount ?? 0), 0);
    const totalOutput = ios.reduce((s, r) => s + (r.outputAmount ?? 0), 0);

    // MAR 통계
    const marAdministered = mars.filter(m => m.status === 'ADMINISTERED').length;
    const marScheduled = mars.filter(m => m.status === 'SCHEDULED').length;
    const marHeld = mars.filter(m => m.status === 'HELD' || m.status === 'REFUSED').length;

    const daysSinceAdmit = stayDays(admission.admitDate) ?? 0;

    return {
      date: targetDate.toISOString().slice(0, 10),
      patient: admission.patient,
      bed: admission.bed,
      dayOfAdmission: daysSinceAdmit,
      vitals: {
        count: vitals.length,
        records: vitals,
        latest: vitals.length > 0 ? vitals[vitals.length - 1] : null,
      },
      io: {
        totalIntake,
        totalOutput,
        balance: totalIntake - totalOutput,
        records: ios.length,
      },
      medications: {
        total: mars.length,
        administered: marAdministered,
        scheduled: marScheduled,
        held: marHeld,
      },
      nursingNotes: {
        count: notes.length,
        records: notes,
      },
      rounds: {
        count: rounds.length,
        records: rounds,
      },
    };
  }
}
