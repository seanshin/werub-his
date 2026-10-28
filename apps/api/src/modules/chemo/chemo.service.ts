import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { dayRange, todayDateOnly } from '../../common/day-range';
import { joinPatientName } from '@hospital-run/shared';
import { CompoundingService } from '../compounding/compounding.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { PreAuthGateService } from '../pre-auth/pre-auth-gate.service';
import type { CreateRegimenDto, CreateCourseDto, RegimenDrugDto } from './dto/chemo.dto';

/** nadir 게이트 검사 항목 스냅샷 */
export interface GateCheck {
  name: string;
  loinc: string[];
  value: string | null;
  unit: string | null;
  normalized: number | null; // /µL 환산값
  min: number;
  measuredAt: Date | null;
  pass: boolean;
  reason?: string;
}

/** 점검 우회 이력 상한 — 넘으면 잘림을 말한다 */
export const GATE_OVERRIDE_LIMIT = 200;

const CYCLE_TRANSITIONS: Record<string, string[]> = {
  PLANNED: ['GATE_HOLD', 'IN_PROGRESS', 'SKIPPED'],
  GATE_HOLD: ['IN_PROGRESS', 'PLANNED', 'SKIPPED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  SKIPPED: [],
};

/**
 * 항암 프로토콜 사이클 엔진 — 2026-07 전체검토 R4(B-2).
 * 레지멘 정본(day-based 약물) → 코스(BSA 스냅샷·감량률) → 사이클 상태기계.
 * 사이클 시작 시 nadir 랩 게이트(config chemo.cycleGate OFF|WARN|BLOCK) 통과 후
 * CHEMO 무균조제 지시 자동 생성(감량 반영 용량), 후속 D-day는 치료일정 항목으로 전개.
 */
@Injectable()
export class ChemoService {
  private readonly logger = new Logger(ChemoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly compounding: CompoundingService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly preAuthGate?: PreAuthGateService,
  ) {}

  private async cfg(key: string, def: string): Promise<string> {
    const v = await this.config?.get(key).catch(() => null);
    return v != null && String(v).length > 0 ? String(v) : def;
  }

  // ── 레지멘 정본 ──

  private validateDrugs(drugs: RegimenDrugDto[]) {
    if (!drugs?.length) throw new BadRequestException('약물 구성이 비어 있습니다');
    for (const d of drugs) {
      if (d.dosePerM2 == null && d.fixedDose == null)
        throw new BadRequestException(`${d.drugName}: dosePerM2 또는 fixedDose 중 하나는 필수입니다`);
      const offsets = Array.isArray(d.dayOffsets) ? d.dayOffsets : [];
      if (!offsets.length || offsets.some((o) => !Number.isInteger(o) || o < 1))
        throw new BadRequestException(`${d.drugName}: dayOffsets는 1 이상의 정수 배열이어야 합니다`);
    }
  }

  async createRegimen(dto: CreateRegimenDto, userId?: string) {
    this.validateDrugs(dto.drugs);
    return this.prisma.chemoRegimen.create({
      data: {
        code: dto.code.trim().toUpperCase(),
        name: dto.name,
        cycleLengthDays: dto.cycleLengthDays ?? 21,
        defaultCycles: dto.defaultCycles ?? 6,
        diagnosisHint: dto.diagnosisHint,
        emetogenicity: dto.emetogenicity,
        notes: dto.notes,
        createdBy: userId,
        drugs: {
          create: dto.drugs.map((d, i) => ({
            role: d.role ?? 'CHEMO',
            drugName: d.drugName,
            medicationCodeId: d.medicationCodeId,
            dosePerM2: d.dosePerM2,
            fixedDose: d.fixedDose,
            capMg: d.capMg,
            bandMg: d.bandMg,
            dayOffsets: d.dayOffsets,
            infusionNote: d.infusionNote,
            sortOrder: d.sortOrder ?? i,
          })),
        },
      },
      include: { drugs: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async updateRegimen(id: string, dto: Partial<CreateRegimenDto>, _userId?: string) {
    const existing = await this.prisma.chemoRegimen.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('레지멘을 찾을 수 없습니다');
    if (dto.drugs) this.validateDrugs(dto.drugs);
    return this.prisma.$transaction(async (tx) => {
      if (dto.drugs) {
        await tx.chemoRegimenDrug.deleteMany({ where: { regimenId: id } });
        await tx.chemoRegimenDrug.createMany({
          data: dto.drugs.map((d, i) => ({
            regimenId: id,
            role: d.role ?? 'CHEMO',
            drugName: d.drugName,
            medicationCodeId: d.medicationCodeId,
            dosePerM2: d.dosePerM2,
            fixedDose: d.fixedDose,
            capMg: d.capMg,
            bandMg: d.bandMg,
            dayOffsets: d.dayOffsets,
            infusionNote: d.infusionNote,
            sortOrder: d.sortOrder ?? i,
          })),
        });
      }
      return tx.chemoRegimen.update({
        where: { id },
        data: {
          name: dto.name,
          cycleLengthDays: dto.cycleLengthDays,
          defaultCycles: dto.defaultCycles,
          diagnosisHint: dto.diagnosisHint,
          emetogenicity: dto.emetogenicity,
          status: dto.status,
          notes: dto.notes,
        },
        include: { drugs: { orderBy: { sortOrder: 'asc' } } },
      });
    });
  }

  async listRegimens(status?: string) {
    return this.prisma.chemoRegimen.findMany({
      where: status ? { status } : undefined,
      include: { drugs: { orderBy: { sortOrder: 'asc' } }, _count: { select: { courses: true } } },
      orderBy: { code: 'asc' },
    });
  }

  // ── 코스 ──

  /** 최근 신체계측(PreVisitVitals) — dto 미지정 시 BSA 소스 */
  private async latestBody(patientId: string): Promise<{ heightCm?: number; weightKg?: number }> {
    const v = await this.prisma.preVisitVitals.findFirst({
      where: { patientId, height: { not: null }, weight: { not: null } },
      orderBy: { measuredAt: 'desc' },
      select: { height: true, weight: true },
    });
    return { heightCm: v?.height ? Number(v.height) : undefined, weightKg: v?.weight ? Number(v.weight) : undefined };
  }

  async createCourse(dto: CreateCourseDto, userId?: string) {
    const regimen = await this.prisma.chemoRegimen.findUnique({ where: { id: dto.regimenId }, include: { drugs: true } });
    if (!regimen) throw new NotFoundException('레지멘을 찾을 수 없습니다');
    if (regimen.status !== 'ACTIVE') throw new BadRequestException('ACTIVE 상태의 레지멘만 코스를 시작할 수 있습니다');

    let { heightCm, weightKg } = dto;
    if (!heightCm || !weightKg) {
      const body = await this.latestBody(dto.patientId);
      heightCm = heightCm ?? body.heightCm;
      weightKg = weightKg ?? body.weightKg;
    }
    if (!heightCm || !weightKg)
      throw new BadRequestException('신체계측(키·몸무게)이 없습니다 — 최근 바이탈 기록이 없으면 직접 입력하세요');

    const bsa = this.compounding.computeBsa(heightCm, weightKg);
    const plannedCycles = dto.plannedCycles ?? regimen.defaultCycles;
    if (plannedCycles < 1 || plannedCycles > 30) throw new BadRequestException('사이클 수는 1~30 범위여야 합니다');
    const startDate = new Date(dto.startDate);
    if (Number.isNaN(startDate.getTime())) throw new BadRequestException('startDate가 유효하지 않습니다');

    // 사전승인 게이트 — 항암 레지멘(코스 개시) 발행 전 결재 확인(플래그 게이트·레지멘 레벨 1회). OFF·승인존재 시 통과.
    await this.preAuthGate?.assertGate('CHEMO_REGIMEN', {
      patientId: dto.patientId, encounterId: dto.encounterId, requestedByUserId: userId,
      draft: { regimenId: dto.regimenId, regimenName: regimen.name },
    });

    return this.prisma.$transaction(async (tx) => {
      // 사이클 D1 캘린더 — 치료일정 인스턴스로 전개(포털 D-1 리마인더·일정 뷰 재사용)
      const schedule = await tx.patientTreatmentSchedule.create({
        data: {
          patientId: dto.patientId,
          encounterId: dto.encounterId,
          name: `항암 ${regimen.name} (${regimen.code})`,
          anchorDate: startDate,
          createdBy: userId,
          items: {
            create: Array.from({ length: plannedCycles }, (_, i) => ({
              plannedAt: new Date(startDate.getTime() + i * regimen.cycleLengthDays * 86400_000),
              itemType: 'MEDICATION_CYCLE',
              title: `C${i + 1}D1 ${regimen.code}`,
              status: 'PLANNED',
            })),
          },
        },
      });
      const course = await tx.chemoCourse.create({
        data: {
          patientId: dto.patientId,
          regimenId: regimen.id,
          encounterId: dto.encounterId,
          registryId: dto.registryId,
          plannedCycles,
          heightCm,
          weightKg,
          bsa,
          doseReductionPct: dto.doseReductionPct ?? 0,
          startDate,
          scheduleId: schedule.id,
          createdBy: userId,
          cycles: {
            create: Array.from({ length: plannedCycles }, (_, i) => ({
              cycleNumber: i + 1,
              plannedDate: new Date(startDate.getTime() + i * regimen.cycleLengthDays * 86400_000),
            })),
          },
        },
        include: { regimen: { include: { drugs: { orderBy: { sortOrder: 'asc' } } } }, cycles: { orderBy: { cycleNumber: 'asc' } } },
      });
      return course;
    });
  }

  async listCourses(patientId?: string, status?: string) {
    return this.prisma.chemoCourse.findMany({
      where: { ...(patientId ? { patientId } : {}), ...(status ? { status } : {}) },
      include: {
        patient: { select: { mrn: true, familyName: true, givenName: true } },
        regimen: { select: { code: true, name: true, cycleLengthDays: true } },
        cycles: { orderBy: { cycleNumber: 'asc' }, select: { id: true, cycleNumber: true, plannedDate: true, status: true, delayDays: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getCourse(id: string) {
    const course = await this.prisma.chemoCourse.findUnique({
      where: { id },
      include: {
        patient: { select: { mrn: true, familyName: true, givenName: true, dateOfBirth: true } },
        regimen: { include: { drugs: { orderBy: { sortOrder: 'asc' } } } },
        cycles: { orderBy: { cycleNumber: 'asc' } },
      },
    });
    if (!course) throw new NotFoundException('항암 코스를 찾을 수 없습니다');
    return course;
  }

  async updateCourse(id: string, dto: { doseReductionPct?: number; stopReason?: string }, _userId?: string) {
    const course = await this.prisma.chemoCourse.findUnique({ where: { id }, select: { status: true } });
    if (!course) throw new NotFoundException('항암 코스를 찾을 수 없습니다');
    if (dto.doseReductionPct != null && (dto.doseReductionPct < 0 || dto.doseReductionPct > 100))
      throw new BadRequestException('감량률은 0~100(%) 범위여야 합니다');
    if (dto.stopReason && course.status !== 'ACTIVE') throw new BadRequestException('ACTIVE 코스만 중단할 수 있습니다');
    // 🔴 (2026-10-10) 종결된 코스의 감량률을 바꾸면 이미 투여한 기록의 근거가 바뀐다 — ACTIVE 만
    if (dto.doseReductionPct != null && course.status !== 'ACTIVE') throw new BadRequestException({ code: 'CHEMO_COURSE_NOT_ACTIVE', message: '진행 중(ACTIVE) 코스만 감량률을 바꿀 수 있습니다' });
    const stopReason = dto.stopReason?.trim();
    if (dto.stopReason != null && !stopReason) throw new BadRequestException({ code: 'CHEMO_STOP_REASON_REQUIRED', message: '중단 사유가 비어 있습니다' });
    // 상태 조건부 갱신 — 동시에 완료·중단이 겹치면 늦은 쪽이 덮어쓰지 않게
    const r = await this.prisma.chemoCourse.updateMany({
      where: { id, status: 'ACTIVE' },
      data: {
        ...(dto.doseReductionPct != null ? { doseReductionPct: dto.doseReductionPct } : {}),
        ...(stopReason ? { status: 'STOPPED', stopReason } : {}),
      },
    });
    if (r.count === 0) throw new ConflictException({ code: 'CHEMO_COURSE_STATE_CHANGED', message: '코스 상태가 바뀌었습니다 — 새로고침 후 다시 시도하세요' });
    return this.prisma.chemoCourse.findUnique({ where: { id } });
  }

  // ── nadir 랩 게이트 ──

  /** 단위 정규화 — 10³/µL 계열 표기를 /µL로 환산 */
  private normalizeCount(value: string, unit: string | null): number | null {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return null;
    const u = (unit ?? '').toLowerCase();
    if (/10\s*[*^]?\s*3|x\s*10³|10³|k\/|thou/.test(u)) return n * 1000;
    return n;
  }

  private async latestLab(patientId: string, loincCodes: string[], since: Date) {
    return this.prisma.labResultItem.findFirst({
      where: {
        loincCode: { in: loincCodes },
        labResult: { patientId, completedAt: { gte: since } },
      },
      orderBy: { labResult: { completedAt: 'desc' } },
      select: { value: true, unit: true, labResult: { select: { completedAt: true } } },
    });
  }

  /** 사이클 시작 전 nadir 게이트 — ANC·혈소판 최근 결과 확인 */
  async checkCycleGate(cycleId: string) {
    const cycle = await this.prisma.chemoCycle.findUnique({
      where: { id: cycleId },
      include: { course: { select: { patientId: true } } },
    });
    if (!cycle) throw new NotFoundException('사이클을 찾을 수 없습니다');

    const mode = (await this.cfg('chemo.cycleGate', 'OFF')).toUpperCase(); // OFF|WARN|BLOCK
    const ancMin = Number(await this.cfg('chemo.gate.ancMin', '1500'));
    const pltMin = Number(await this.cfg('chemo.gate.pltMin', '100000'));
    const maxAgeDays = Number(await this.cfg('chemo.gate.labMaxAgeDays', '7'));
    const ancLoinc = (await this.cfg('chemo.gate.ancLoinc', '751-8,26499-4')).split(',').map((s) => s.trim());
    const pltLoinc = (await this.cfg('chemo.gate.pltLoinc', '777-3,26515-7')).split(',').map((s) => s.trim());
    const since = new Date(Date.now() - maxAgeDays * 86400_000);

    const checks: GateCheck[] = [];
    for (const spec of [
      { name: 'ANC(절대호중구수)', loinc: ancLoinc, min: ancMin },
      { name: '혈소판', loinc: pltLoinc, min: pltMin },
    ]) {
      const item = await this.latestLab(cycle.course.patientId, spec.loinc, since);
      if (!item) {
        checks.push({ ...spec, value: null, unit: null, normalized: null, measuredAt: null, pass: false, reason: `최근 ${maxAgeDays}일 내 결과 없음` });
        continue;
      }
      const normalized = this.normalizeCount(item.value, item.unit);
      const pass = normalized != null && normalized >= spec.min;
      checks.push({
        ...spec,
        value: item.value,
        unit: item.unit,
        normalized,
        measuredAt: item.labResult.completedAt,
        pass,
        reason: pass ? undefined : normalized == null ? '수치 해석 불가' : `기준(${spec.min.toLocaleString()}/µL) 미만`,
      });
    }
    return { mode, pass: checks.every((c) => c.pass), checks };
  }

  // ── 사이클 상태기계 ──

  private assertCycleTransition(current: string, next: string) {
    if (!CYCLE_TRANSITIONS[current]?.includes(next))
      throw new BadRequestException({ code: 'CHEMO_CYCLE_TRANSITION', message: `사이클 전이 불가: ${current} → ${next}` });
  }

  /**
   * 사이클 시작 — 게이트 통과 시 D1 약물 무균조제(CHEMO) 지시 자동 생성,
   * D2+ 약물은 치료일정 항목으로 전개. BLOCK 모드 미통과 시 GATE_HOLD 전환.
   */
  async startCycle(cycleId: string, userId: string, opts?: { overrideGate?: boolean; overrideReason?: string }) {
    const cycle = await this.prisma.chemoCycle.findUnique({
      where: { id: cycleId },
      include: { course: { include: { regimen: { include: { drugs: { orderBy: { sortOrder: 'asc' } } } } } } },
    });
    if (!cycle) throw new NotFoundException('사이클을 찾을 수 없습니다');
    this.assertCycleTransition(cycle.status, 'IN_PROGRESS');
    const { course } = cycle;
    if (course.status !== 'ACTIVE') throw new BadRequestException('ACTIVE 코스의 사이클만 시작할 수 있습니다');
    const prevIncomplete = await this.prisma.chemoCycle.count({
      where: { courseId: course.id, cycleNumber: { lt: cycle.cycleNumber }, status: { notIn: ['COMPLETED', 'SKIPPED'] } },
    });
    if (prevIncomplete > 0) throw new BadRequestException('이전 사이클이 완료되지 않았습니다');

    const gate = await this.checkCycleGate(cycleId);
    let gateWarning: string | undefined;
    // 🔴 (2026-10-10) BLOCK 게이트 오버라이드는 사유가 있어야 한다 — 종전엔 사유 없이 넘길 수 있었고, 사유를 줘도 **어디에도 저장되지 않았다**
    //    (응답에만 실리고, 저장 자리 `delayReason: cycle.delayReason` 은 같은 값을 다시 쓰는 무동작이었다)
    const overrideReason = opts?.overrideReason?.trim() || null;
    if (!gate.pass && gate.mode === 'BLOCK' && opts?.overrideGate && !overrideReason) {
      throw new BadRequestException({ code: 'CHEMO_GATE_OVERRIDE_REASON_REQUIRED', message: 'nadir 게이트를 넘겨 시작하려면 사유가 필요합니다' });
    }
    if (!gate.pass && gate.mode === 'BLOCK' && !opts?.overrideGate) {
      await this.prisma.chemoCycle.update({
        where: { id: cycleId },
        data: { status: 'GATE_HOLD', gateResult: JSON.parse(JSON.stringify(gate)) },
      });
      const failed = gate.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.reason}`).join(' · ');
      throw new BadRequestException({ code: 'CHEMO_GATE_HOLD', message: `nadir 게이트 미통과 — ${failed}`, gate });
    }
    if (!gate.pass && gate.mode !== 'OFF') {
      gateWarning = `게이트 미통과 상태로 시작(${gate.mode}${opts?.overrideGate ? '·의사 오버라이드' : ''})${opts?.overrideReason ? ` — ${opts.overrideReason}` : ''}`;
    }

    const reduction = cycle.doseReductionPct ?? course.doseReductionPct;
    const drugs = course.regimen.drugs;
    const d1 = drugs.filter((d) => (d.dayOffsets as number[]).includes(1));
    const later = drugs.flatMap((d) => (d.dayOffsets as number[]).filter((o) => o > 1).map((o) => ({ drug: d, offset: o })));

    // D1 무균조제 지시 — CHEMO 역할만 감량 적용
    const components = d1.map((d, i) => {
      const factor = d.role === 'CHEMO' ? 1 - reduction / 100 : 1;
      let amount: number;
      let calcNote = '';
      if (d.dosePerM2 != null) {
        const r = this.compounding.computeChemoDose({
          heightCm: Number(course.heightCm),
          weightKg: Number(course.weightKg),
          dosePerM2: Number(d.dosePerM2) * factor,
          capMg: d.capMg != null ? Number(d.capMg) : undefined,
          bandMg: d.bandMg != null ? Number(d.bandMg) : undefined,
        });
        amount = r.finalDose;
        calcNote = `${d.dosePerM2}mg/m²×BSA ${r.bsa}${factor < 1 ? `×감량${reduction}%` : ''}${r.capped ? '·상한적용' : ''}${r.banded ? '·밴딩' : ''}`;
      } else {
        amount = Math.round(Number(d.fixedDose) * factor * 100) / 100;
        calcNote = `고정 ${d.fixedDose}mg${factor < 1 ? `×감량${reduction}%` : ''}`;
      }
      return {
        role: d.role === 'CHEMO' ? 'DRUG' : d.role,
        name: `${d.drugName}${d.infusionNote ? ` (${d.infusionNote})` : ''}`,
        medicationCodeId: d.medicationCodeId ?? undefined,
        orderedAmount: amount,
        amountUnit: 'mg',
        sortOrder: i,
        _calc: calcNote,
      };
    });

    /**
     * 🔴 (2026-09-16 J4) 조제 지시는 트랜잭션 **밖**에서 만들어진다(I2 가 그렇게 뒀다 — 교차 서비스·자체 트랜잭션).
     *    그래서 `createOrder` 는 성공했는데 아래 `$transaction` 이 실패하면 **사이클은 PLANNED 로 남고**
     *    조제 지시만 고아로 떠 있다. 다시 시작을 누르면 전이 검사를 통과해 **조제 지시가 한 벌 더** 생긴다
     *    (약제부에 같은 항암 조제가 둘 — 되돌릴 수 없는 쪽이다). I2 가 "교차 서비스 계약이라 사람 판단"으로
     *    남긴 자리인데, **계약을 바꾸지 않고** 호출 쪽에서 자연키로 고아를 찾아 재사용하면 된다.
     *
     *    자연키 = 환자 + `<레지멘> C<사이클>D1` (같은 사이클에 한 벌만 존재해야 하는 값). 어느 사이클도
     *    링크하지 않은(고아) 살아 있는 지시만 재사용한다 — 취소된 것과 이미 다른 사이클이 쓰는 것은 제외.
     *    화면의 D1 캘린더 매칭(`title: { startsWith: 'C<n>D1 ' }`)이 이미 같은 자연키를 쓴다.
     */
    const orderNotePrefix = `${course.regimen.code} C${cycle.cycleNumber}D1`;
    let compoundingOrder: { id: string } | null = null;
    if (d1.length) {
      // `ChemoCycle.compoundingOrderId` 는 관계가 선언돼 있지 않은 평범한 컬럼이라(스키마 14108)
      // `cycles: { none: {} }` 로 걸 수 없다 — 후보를 뽑고 참조 여부를 따로 본다.
      const candidates = await this.prisma.compoundingOrder.findMany({
        where: {
          sourceType: 'CHEMO',
          patientId: course.patientId,
          status: { not: 'CANCELLED' },
          notes: { startsWith: orderNotePrefix },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      const linked = candidates.length
        ? new Set(
            (
              await this.prisma.chemoCycle.findMany({
                where: { compoundingOrderId: { in: candidates.map((c) => c.id) } },
                select: { compoundingOrderId: true },
              })
            ).map((r) => r.compoundingOrderId),
          )
        : new Set<string | null>();
      const orphan = candidates.find((c) => !linked.has(c.id)) ?? null;
      // 🔴 로그는 `logger.` 와 같은 줄에 둔다 — 줄을 나누면 조립 한국어 문장으로 세인다(I2 가 같은 자리에서 걸렸다)
      if (orphan) this.logger.warn(`항암 D1 조제 지시 재사용(직전 개시 중간 실패) cycle=${cycleId} order=${orphan.id}`);
      compoundingOrder =
        orphan ??
        (await this.compounding.createOrder(
          {
            sourceType: 'CHEMO',
            patientId: course.patientId,
            priority: 'URGENT',
            dueAt: new Date().toISOString(),
            notes: `${orderNotePrefix}${reduction > 0 ? ` (감량 ${reduction}%)` : ''} — ${components.map((c) => `${c.name} ${c.orderedAmount}mg [${c._calc}]`).join(', ')}`,
            components: components.map(({ _calc, ...c }) => c),
          },
          userId,
        ));
    }

    /**
     * 🔴 (2026-09-16 I2) 일정 전개·사이클 개시·D1 연결을 한 트랜잭션에서 쓴다. 종전엔 셋이 따로 나가
     *    중간 실패 시 "D2+ 일정은 깔렸는데 사이클은 미개시"(다음 시도가 같은 일정을 또 깐다) 또는
     *    "사이클은 진행 중인데 D1 캘린더 항목이 무균조제에 연결 안 됨"이 남았다.
     *    무균조제 지시 생성(외부 서비스·자체 트랜잭션)은 트랜잭션 **밖**에 그대로 둔다.
     */
    const updated = await this.prisma.$transaction(async (tx) => {
      // D2+ 약물 — 치료일정 항목 전개(실제 시작일 기준)
      if (later.length && course.scheduleId) {
        const today = new Date();
        await tx.patientScheduleItem.createMany({
          data: later.map(({ drug, offset }) => ({
            scheduleId: course.scheduleId!,
            plannedAt: new Date(today.getTime() + (offset - 1) * 86400_000),
            itemType: 'MEDICATION_CYCLE',
            title: `C${cycle.cycleNumber}D${offset} ${drug.drugName}`,
            status: 'PLANNED',
            notes: `${course.regimen.code} 사이클 내 D${offset} 투여분`,
          })),
        });
      }

      const row = await tx.chemoCycle.update({
        where: { id: cycleId },
        data: {
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          // 미통과로 시작했으면 누가·언제·왜를 게이트 결과와 함께 남긴다(사이클 원장 · 스키마 변경 없이 gateResult 안에)
          gateResult: JSON.parse(JSON.stringify(gateWarning
            ? { ...gate, startedDespiteFail: { by: userId, at: new Date().toISOString(), override: !!opts?.overrideGate, reason: overrideReason } }
            : gate)),
          compoundingOrderId: compoundingOrder?.id ?? null,
        },
      });
      // 캘린더 D1 항목을 실행 객체(무균조제)에 연결 — LINKED 전환
      if (course.scheduleId) {
        await tx.patientScheduleItem.updateMany({
          where: { scheduleId: course.scheduleId, status: 'PLANNED', title: { startsWith: `C${cycle.cycleNumber}D1 ` } },
          data: { status: 'LINKED', refType: 'CompoundingOrder', refId: compoundingOrder?.id ?? null },
        });
      }
      return row;
    });
    this.eventEmitter.emit('chemo.cycle.started', {
      courseId: course.id,
      cycleId,
      patientId: course.patientId,
      regimenCode: course.regimen.code,
      cycleNumber: cycle.cycleNumber,
      compoundingOrderId: compoundingOrder?.id ?? null,
    });
    return { cycle: updated, compoundingOrder, gate, ...(gateWarning ? { warning: gateWarning } : {}) };
  }

  /**
   * 점검 우회 이력 — nadir 게이트를 **통과하지 못한 채** 시작된 사이클(2026-10-10).
   * 원장은 사이클의 `gateResult`(시작 순간 스냅샷) — 별도 표 없음.
   * - 게이트가 꺼져(OFF) 있던 시작은 우회가 아니다(검사하지 않았다) → 제외.
   * - 2026-10-10 이전 시작분은 누가·왜(`startedDespiteFail`)가 남지 않았다 → `recorded: false` 로 말하고 지어내지 않는다.
   * 상한 + 전체 수(잘림 고지).
   */
  async gateOverrides(q: { from?: string; to?: string; patientId?: string }) {
    const range = dayRange(q.from, q.to);
    const where = {
      startedAt: range ? { not: null, ...range } : { not: null },
      AND: [{ gateResult: { path: ['pass'], equals: false } }, { NOT: { gateResult: { path: ['mode'], equals: 'OFF' } } }],
      ...(q.patientId ? { course: { patientId: q.patientId } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.chemoCycle.count({ where }),
      this.prisma.chemoCycle.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: GATE_OVERRIDE_LIMIT,
        select: {
          id: true, cycleNumber: true, startedAt: true, status: true, gateResult: true,
          course: { select: { id: true, patientId: true, patient: { select: { mrn: true, familyName: true, givenName: true } }, regimen: { select: { code: true, name: true } } } },
        },
      }),
    ]);
    const items = rows.map((r) => {
      const g = (r.gateResult ?? {}) as { mode?: string; checks?: GateCheck[]; startedDespiteFail?: { by?: string; at?: string; override?: boolean; reason?: string | null } };
      const sdf = g.startedDespiteFail ?? null;
      return {
        cycleId: r.id,
        courseId: r.course.id,
        cycleNumber: r.cycleNumber,
        status: r.status,
        startedAt: r.startedAt,
        patientId: r.course.patientId,
        patientMrn: r.course.patient.mrn,
        patientName: joinPatientName(r.course.patient.familyName, r.course.patient.givenName) || null,
        regimenCode: r.course.regimen.code,
        regimenName: r.course.regimen.name,
        mode: g.mode ?? null,
        failedChecks: (g.checks ?? []).filter((c) => !c.pass).map((c) => ({ name: c.name, value: c.value, unit: c.unit, min: c.min, reason: c.reason ?? null })),
        recorded: !!sdf,
        override: sdf ? !!sdf.override : null,
        reason: sdf?.reason ?? null,
        byId: sdf?.by ?? null,
        byName: null as string | null,
      };
    });
    const ids = [...new Set(items.map((i) => i.byId).filter((x): x is string => !!x))];
    if (ids.length) {
      const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, familyName: true, givenName: true } });
      const nm = new Map(users.map((u) => [u.id, joinPatientName(u.familyName, u.givenName) || null]));
      for (const i of items) if (i.byId) i.byName = nm.get(i.byId) ?? null;
    }
    return { items, total, limit: GATE_OVERRIDE_LIMIT, truncated: total > items.length };
  }

  /** 사이클 지연 — 본 사이클과 이후 PLANNED 사이클 연쇄 이동 */
  async delayCycle(cycleId: string, days: number, reason: string, _userId?: string) {
    if (!Number.isInteger(days) || days < 1 || days > 60) throw new BadRequestException('지연 일수는 1~60일 범위여야 합니다');
    if (!reason?.trim()) throw new BadRequestException('지연 사유는 필수입니다');
    const cycle = await this.prisma.chemoCycle.findUnique({
      where: { id: cycleId },
      select: { id: true, courseId: true, cycleNumber: true, status: true, course: { select: { scheduleId: true } } },
    });
    if (!cycle) throw new NotFoundException('사이클을 찾을 수 없습니다');
    if (!['PLANNED', 'GATE_HOLD'].includes(cycle.status)) throw new BadRequestException('PLANNED/GATE_HOLD 사이클만 지연할 수 있습니다');

    const affected = await this.prisma.chemoCycle.findMany({
      where: { courseId: cycle.courseId, cycleNumber: { gte: cycle.cycleNumber }, status: { in: ['PLANNED', 'GATE_HOLD'] } },
      select: { id: true, plannedDate: true, cycleNumber: true },
    });
    await this.prisma.$transaction(
      affected.map((c) =>
        this.prisma.chemoCycle.update({
          where: { id: c.id },
          data: {
            plannedDate: new Date(c.plannedDate.getTime() + days * 86400_000),
            ...(c.id === cycleId
              ? { delayDays: { increment: days }, delayReason: reason, ...(cycle.status === 'GATE_HOLD' ? { status: 'PLANNED' } : {}) }
              : {}),
          },
        }),
      ),
    );
    // 치료일정 캘린더(CnD1 항목)도 동반 이동 — 사이클과 캘린더의 날짜 이원화 방지
    if (cycle.course.scheduleId) {
      for (const c of affected) {
        await this.prisma.patientScheduleItem.updateMany({
          where: { scheduleId: cycle.course.scheduleId, status: 'PLANNED', title: { startsWith: `C${c.cycleNumber}D1 ` } },
          data: { plannedAt: new Date(c.plannedDate.getTime() + days * 86400_000) },
        });
      }
    }
    return { delayed: affected.length, days, reason };
  }

  async updateCycle(cycleId: string, dto: { doseReductionPct?: number | null }, _userId?: string) {
    const cycle = await this.prisma.chemoCycle.findUnique({ where: { id: cycleId }, select: { status: true } });
    if (!cycle) throw new NotFoundException('사이클을 찾을 수 없습니다');
    if (!['PLANNED', 'GATE_HOLD'].includes(cycle.status)) throw new BadRequestException('시작 전 사이클만 감량률을 조정할 수 있습니다');
    if (dto.doseReductionPct != null && (dto.doseReductionPct < 0 || dto.doseReductionPct > 100))
      throw new BadRequestException('감량률은 0~100(%) 범위여야 합니다');
    return this.prisma.chemoCycle.update({ where: { id: cycleId }, data: { doseReductionPct: dto.doseReductionPct } });
  }

  /** 사이클 완료 — 마지막 사이클이면 코스 완료 + 암등록 치료요약 기록 */
  async completeCycle(cycleId: string, _userId?: string) {
    const cycle = await this.prisma.chemoCycle.findUnique({
      where: { id: cycleId },
      include: { course: { include: { regimen: { select: { code: true, name: true } } } } },
    });
    if (!cycle) throw new NotFoundException('사이클을 찾을 수 없습니다');
    this.assertCycleTransition(cycle.status, 'COMPLETED');

    /**
     * 🔴 (2026-09-16 K1) 사이클 완료와 코스 종결이 따로 커밋됐다 — 마지막 사이클을 끝낸 뒤 코스 갱신이
     *    실패하면 **코스는 ACTIVE 로 영구히 남는다**(`CYCLE_TRANSITIONS.COMPLETED = []` 라 재시도는
     *    '전이 불가'로 막히고, 남은 사이클도 0 이라 이 경로로는 다시 닫을 수 없다).
     *    J4 가 고친 `startCycle`(사이클↔조제 지시)의 같은 파일 쌍둥이 — 사이클과 코스는 한 트랜잭션이다.
     */
    const { updated, courseCompleted, done } = await this.prisma.$transaction(async (tx) => {
      const cycleRow = await tx.chemoCycle.update({
        where: { id: cycleId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      const remaining = await tx.chemoCycle.count({
        where: { courseId: cycle.courseId, status: { notIn: ['COMPLETED', 'SKIPPED'] } },
      });
      if (remaining > 0) return { updated: cycleRow, courseCompleted: false, done: 0 };
      const doneCount = await tx.chemoCycle.count({ where: { courseId: cycle.courseId, status: 'COMPLETED' } });
      await tx.chemoCourse.update({ where: { id: cycle.courseId }, data: { status: 'COMPLETED' } });
      return { updated: cycleRow, courseCompleted: true, done: doneCount };
    });
    if (courseCompleted) {
      if (cycle.course.registryId) {
        // 암등록 치료요약은 외부 원장 성격의 부가 기록 — 실패해도 코스 종결은 유지(비차단)
        await this.prisma.cancerTreatment
          .create({
            data: {
              registryId: cycle.course.registryId,
              treatmentType: 'CHEMOTHERAPY',
              startDate: cycle.course.startDate,
              endDate: todayDateOnly(),
              regimen: `${cycle.course.regimen.name} (${cycle.course.regimen.code})`,
              cycles: done,
              note: '사이클 엔진 자동 기록',
            },
          })
          .catch((e) => this.logger.warn(`암등록 치료요약 기록 실패(비차단): ${e instanceof Error ? e.message : e}`));
      }
    }
    return { cycle: updated, courseCompleted };
  }
}
