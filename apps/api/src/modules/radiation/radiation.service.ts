import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, ConflictException, Optional } from '@nestjs/common';
import { todayDateOnly } from '../../common/day-range';
import { RADIATION_PLAN_STATUSES } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { radiationDoseSummary } from './radiation-dose';
import { Prisma } from '@prisma/client';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';
import { enforceGate } from '../../common/gate-enforce';
// 게이트 위반 원장(GateViolationLog) — WARN 도, BLOCK 도 남아야 관제가 '0건'의 뜻을 구분한다
import { SafetyGateService } from '../safety-gate/safety-gate.service';
import { mergeTargetMap } from '../../common/qi-targets';

// 선량 허용 오차 코드 기본(%) — 개정 표면 = config radiation.doseTolerance(부분 병합·§7 P1)
const DOSE_TOLERANCE_DEFAULTS = { fractionDeviationPct: 10, cumulativeOverPct: 5, planConsistencyPct: 5 };

@Injectable()
export class RadiationService {
  private readonly logger = new Logger(RadiationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly gates?: SafetyGateService,
  ) {}

  private async doseTolerance() {
    return mergeTargetMap(DOSE_TOLERANCE_DEFAULTS, await this.config?.get('radiation.doseTolerance').catch(() => null));
  }

  // 처방 총선량이 분할선량×분할횟수와 허용오차 내 일치하는지 — 오타(2Gy↔20Gy) 방지.
  private async assertDoseConsistent(totalDose: number, fractionDose: number, totalFractions: number) {
    const expected = fractionDose * totalFractions;
    if (expected <= 0) return;
    const tolPct = (await this.doseTolerance()).planConsistencyPct;
    const diff = Math.abs(totalDose - expected) / expected;
    if (diff > tolPct / 100) {
      throw new BadRequestException({
        code: 'RT_DOSE_MISMATCH',
        message: `총선량(${totalDose}Gy)이 분할선량×횟수(${fractionDose}×${totalFractions}=${expected}Gy)와 ±${tolPct}% 초과 불일치합니다. 처방을 확인하세요.`,
      });
    }
  }

  /* ───── Plans ───── */

  async createPlan(data: {
    patientId: string; diagnosis: string; diagnosisCode?: string;
    intent: string; technique: string; site: string;
    totalDose: number; fractionDose: number; totalFractions: number;
    energy?: string; machine?: string; simulationDate?: string;
    startDate?: string; prescribedBy: string; notes?: string;
  }) {
    await this.assertDoseConsistent(data.totalDose, data.fractionDose, data.totalFractions);
    return this.prisma.radiationPlan.create({
      data: {
        patientId: data.patientId,
        diagnosis: data.diagnosis,
        diagnosisCode: data.diagnosisCode,
        intent: data.intent,
        technique: data.technique,
        site: data.site,
        totalDose: new Prisma.Decimal(data.totalDose),
        fractionDose: new Prisma.Decimal(data.fractionDose),
        totalFractions: data.totalFractions,
        energy: data.energy,
        machine: data.machine,
        simulationDate: data.simulationDate ? new Date(data.simulationDate) : undefined,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        prescribedBy: data.prescribedBy,
        notes: data.notes,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getPlans(params?: { patientId?: string; status?: string }) {
    const where: Record<string, unknown> = {};
    if (params?.patientId) where.patientId = params.patientId;
    if (params?.status) where.status = params.status;
    const plans = await this.prisma.radiationPlan.findMany({
      where,
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        prescriber: { select: { familyName: true, givenName: true } },
        fractions: { select: { status: true, deliveredDose: true } }, // FE 진행률(전달 분획 수) · 누적선량(서버 요약)
        _count: { select: { fractions: true, toxicities: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // 🔴 (2026-10-10) 목록에 선량이 없어 처방 대비 얼마나 조사됐는지 볼 곳이 없었다 — 조사 경로와 같은 규칙으로 요약
    return plans.map((p) => ({ ...p, doseSummary: radiationDoseSummary(p.fractions, p.totalDose) }));
  }

  async getPlanDetail(id: string) {
    const plan = await this.prisma.radiationPlan.findUnique({
      where: { id },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        prescriber: { select: { familyName: true, givenName: true } },
        approver: { select: { familyName: true, givenName: true } },
        fractions: { orderBy: { fractionNumber: 'asc' } },
        toxicities: { orderBy: { week: 'asc' } },
      },
    });
    if (!plan) throw new NotFoundException('방사선 치료 계획을 찾을 수 없습니다');
    return { ...plan, doseSummary: radiationDoseSummary(plan.fractions, plan.totalDose) };
  }

  // 상태 전이는 정의된 값만 허용하고, APPROVED는 이 경로로 위조 불가(approvePlan만이 승인자·시각 기록).
  // 🔴 종전 목록에 `APPROVED` 가 없어, 서버가 승인 시 스스로 넣은 상태를 이 경로로는 되돌릴 수 없었다.
  //    어휘 정본은 shared `RADIATION_PLAN_STATUSES`(화면 라벨표와 같은 표).
  private static readonly PLAN_STATUSES = RADIATION_PLAN_STATUSES;
  /**
   * 계획 상태 수동 변경 — 🔴 (2026-10-10) 종전엔 어떤 상태에서든 아무 상태로 바꿀 수 있었다(완료→치료 중, 취소→계획,
   *    승인 시각이 남은 채 계획으로 되돌림 등). 승인(approvePlan)·분할 생성(→치료 중)은 각자 절차로만 간다.
   *  · 계획 → 보류·취소 · 승인 → 보류·취소 · 치료 중 → 보류·완료(남은 예정 분할이 없을 때)·취소
   *  · 보류 → 재개(보류 전 단계로만 — 승인 전이면 계획, 분할이 있으면 치료 중, 아니면 승인)·취소
   *  · 완료·취소는 끝 — 되돌리지 않는다
   */
  async updatePlanStatus(id: string, status: string) {
    const plan = await this.prisma.radiationPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('방사선 치료 계획을 찾을 수 없습니다');
    if (status === 'APPROVED') throw new BadRequestException('승인은 별도 승인 절차(approvePlan)로만 가능합니다');
    if (!RadiationService.PLAN_STATUSES.includes(status)) throw new BadRequestException(`허용되지 않는 상태: ${status}`);
    const fractions = await this.prisma.radiationFraction.groupBy({ by: ['status'], where: { planId: id }, _count: { _all: true } });
    const count = (st: string) => fractions.find((f) => f.status === st)?._count._all ?? 0;
    const total = fractions.reduce((n, f) => n + f._count._all, 0);
    const resume = !plan.planApprovedAt ? 'PLANNED' : total > 0 ? 'IN_TREATMENT' : 'APPROVED';
    const allowed: Record<string, string[]> = {
      PLANNED: ['ON_HOLD', 'CANCELLED'],
      APPROVED: ['ON_HOLD', 'CANCELLED'],
      IN_TREATMENT: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
      ON_HOLD: [resume, 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    };
    if (!(allowed[plan.status] ?? []).includes(status)) {
      throw new BadRequestException({ code: 'RT_PLAN_TRANSITION', message: '이 상태 변경은 허용되지 않습니다', details: { from: plan.status, to: status, allowed: allowed[plan.status] ?? [] } });
    }
    if (status === 'COMPLETED' && count('SCHEDULED') + count('DELIVERING') > 0) {
      throw new BadRequestException({ code: 'RT_PLAN_FRACTIONS_REMAIN', message: '예정된 분할이 남아 있어 완료할 수 없습니다 — 남은 분할을 취소하거나 조기 종료는 취소로 기록하세요', details: { scheduled: count('SCHEDULED'), delivering: count('DELIVERING') } });
    }
    const r = await this.prisma.radiationPlan.updateMany({ where: { id, status: plan.status }, data: { status } });
    if (r.count === 0) throw new ConflictException('계획 상태가 바뀌었습니다 — 새로고침 후 다시 시도하세요');
    return this.prisma.radiationPlan.findUnique({ where: { id } });
  }

  async approvePlan(id: string, userId: string) {
    const plan = await this.prisma.radiationPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('방사선 치료 계획을 찾을 수 없습니다');
    if (plan.status !== 'PLANNED') throw new BadRequestException(`계획(PLANNED) 상태에서만 승인할 수 있습니다(현재 ${plan.status})`);
    // 4-eyes — 처방자 본인 승인 금지(독립 검증)
    if (plan.prescribedBy && plan.prescribedBy === userId) {
      throw new ForbiddenException({ code: 'RT_SELF_APPROVAL', message: '처방자 본인은 치료계획을 승인할 수 없습니다(독립 검증 필요).' });
    }
    // 승인 시점 선량 정합 재확인
    await this.assertDoseConsistent(Number(plan.totalDose), Number(plan.fractionDose), plan.totalFractions);
    return this.prisma.radiationPlan.update({
      where: { id },
      data: { status: 'APPROVED', planApprovedAt: new Date(), planApprovedBy: userId },
    });
  }

  /* ───── Fractions ───── */

  async generateFractions(planId: string) {
    const plan = await this.prisma.radiationPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('방사선 치료 계획을 찾을 수 없습니다');
    if (!plan.startDate) throw new BadRequestException('시작일이 설정되지 않았습니다');
    // 승인된 계획만 분할 생성(미승인 계획으로 스케줄·조사 방지)
    if (!plan.planApprovedAt) throw new BadRequestException({ code: 'RT_PLAN_NOT_APPROVED', message: '승인된 치료계획만 분할 스케줄을 생성할 수 있습니다.' });
    // 이미 조사(DELIVERED)된 분할이 있으면 재생성 금지(선량 이력 보존 — 과선량 방지의 근거)
    const deliveredCount = await this.prisma.radiationFraction.count({ where: { planId, status: 'DELIVERED' } });
    if (deliveredCount > 0) throw new BadRequestException({ code: 'RT_FRACTIONS_DELIVERED', message: '이미 조사된 분할이 있어 재생성할 수 없습니다(선량 이력 보존).' });

    // 미조사(SCHEDULED/CANCELLED) 분할만 삭제
    await this.prisma.radiationFraction.deleteMany({ where: { planId, status: { in: ['SCHEDULED', 'CANCELLED'] } } });

    const fractions: Prisma.RadiationFractionCreateManyInput[] = [];
    let currentDate = new Date(plan.startDate);
    for (let i = 1; i <= plan.totalFractions; i++) {
      // 주말 건너뛰기
      while (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
      }
      fractions.push({
        planId,
        fractionNumber: i,
        scheduledDate: new Date(currentDate),
        status: 'SCHEDULED',
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    await this.prisma.radiationFraction.createMany({ data: fractions });

    // 종료일 업데이트
    const lastDate = fractions[fractions.length - 1].scheduledDate as Date;
    await this.prisma.radiationPlan.update({
      where: { id: planId },
      data: { endDate: lastDate, status: 'IN_TREATMENT' },
    });

    return this.prisma.radiationFraction.findMany({
      where: { planId },
      orderBy: { fractionNumber: 'asc' },
    });
  }

  async getTodayFractions() {
    const today = todayDateOnly(); // 🔴 @db.Date 비교 — 로컬 자정은 하루 밀린다(정본)
    const tomorrow = new Date(today.getTime() + 86400000);
    const rows = await this.prisma.radiationFraction.findMany({
      where: { scheduledDate: { gte: today, lt: tomorrow } },
      include: {
        plan: {
          select: {
            patientId: true, diagnosis: true, technique: true, site: true,
            fractionDose: true, totalDose: true, totalFractions: true, machine: true,
            patient: { select: { familyName: true, givenName: true, mrn: true } },
          },
        },
      },
      orderBy: { plan: { machine: 'asc' } },
    });
    // 조사 전에 "지금까지 얼마나"를 본다(2026-10-10) — 계획별 기록된 조사선량 합 · 조사 경로와 같은 규칙
    const planIds = [...new Set(rows.map((r) => r.planId))];
    const recorded = planIds.length
      ? await this.prisma.radiationFraction.findMany({ where: { planId: { in: planIds }, deliveredDose: { not: null } }, select: { planId: true, deliveredDose: true } })
      : [];
    return rows.map((r) => ({ ...r, doseSummary: radiationDoseSummary(recorded.filter((x) => x.planId === r.planId), r.plan.totalDose) }));
  }

  async deliverFraction(id: string, data: {
    deliveredDose: number; setupVerified?: boolean;
    coneBeamCT?: boolean; therapistId?: string; notes?: string;
  }, recorderId?: string) {
    const fraction = await this.prisma.radiationFraction.findUnique({
      where: { id },
      include: { plan: true },
    });
    if (!fraction) throw new NotFoundException('분할 치료를 찾을 수 없습니다');
    // 승인된 계획·예정(SCHEDULED) 분할만 조사(미승인/이미조사/취소 분할 조사 방지·이중가산 방지)
    if (!fraction.plan.planApprovedAt) throw new BadRequestException({ code: 'RT_PLAN_NOT_APPROVED', message: '승인된 치료계획의 분할만 조사할 수 있습니다.' });
    // 계획이 취소/보류/완료면 조사 불가 — planApprovedAt만 보면 ON_HOLD/CANCELLED 계획의 SCHEDULED 분할이 조사됨.
    if (!['APPROVED', 'IN_TREATMENT'].includes(fraction.plan.status)) {
      throw new BadRequestException({ code: 'RT_PLAN_NOT_ACTIVE', message: `조사할 수 없는 계획 상태입니다(현재 ${fraction.plan.status}) — 취소/보류/완료 계획` });
    }
    if (fraction.status !== 'SCHEDULED') throw new BadRequestException(`예정(SCHEDULED) 분할만 조사할 수 있습니다(현재 ${fraction.status})`);

    // IGRT 게이트(P3) — 영상유도 필요 기법(IMRT/VMAT/SBRT/SRS/SABR)인데 셋업검증(setupVerified) 미완이면 조사 차단(오부위 RT 방지).
    //  config radiation.igrtEnforce(OFF|WARN|BLOCK·기본 OFF·fallback 'OFF').
    // 🔴 2026-08-26: 종전엔 `=== 'BLOCK'` 하나만 분기해 **WARN 이 OFF 와 완전히 동일**했다
    //    (차단도 기록도 없음). WARN 으로 근거를 모아 BLOCK 으로 승격한다는 규약이 이 게이트에서는
    //    작동할 수 없었다. 3상 정본(`common/gate-enforce`)으로 맞춘다 — BLOCK 동작은 불변.
    const igrtMode = gateMode(await this.config?.get('radiation.igrtEnforce'), 'OFF');
    const igrtTech = String(fraction.plan.technique ?? '').toUpperCase();
    const needsIgrt = ['IMRT', 'VMAT', 'SBRT', 'SRS', 'SABR'].some((t) => igrtTech.includes(t));
    const igrtWarn = await enforceGate({
      gateKey: 'radiation.igrtEnforce',
      mode: igrtMode,
      violated: needsIgrt && data.setupVerified !== true,
      code: 'RT_IGRT_REQUIRED',
      message: `${fraction.plan.technique} 기법은 영상유도 셋업검증(setupVerified)이 완료되어야 조사할 수 있습니다.`,
      refType: 'RadiationFraction', refId: id,
      recorder: this.gates, logger: this.logger,
    });

    const total = Number(fraction.plan.totalDose);
    const perFraction = Number(fraction.plan.fractionDose);

    // 안전 게이트(config radiation.doseEnforce OFF|WARN|BLOCK·기본 BLOCK):
    //  ① 분할선량 편차 ② 누적선량 초과 → 과선량 차단. 허용 오차는 config radiation.doseTolerance(§7 P1).
    const mode = gateMode(await this.config?.get('radiation.doseEnforce'));
    const tol = await this.doseTolerance();
    const blocked: string[] = [];
    if (!(data.deliveredDose > 0)) blocked.push('조사선량은 양수여야 합니다');
    if (perFraction > 0 && Math.abs(data.deliveredDose - perFraction) / perFraction > tol.fractionDeviationPct / 100) {
      blocked.push(`분할선량(${data.deliveredDose}Gy)이 처방(${perFraction}Gy)과 ±${tol.fractionDeviationPct}% 초과 이탈`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 계획 행잠금 — 형제 분할의 동시 조사가 각자 stale 누적을 읽어 누적상한을 우회하는 것 방지(직렬화).
      await tx.$queryRaw`SELECT id FROM radiation_plans WHERE id = ${fraction.planId}::uuid FOR UPDATE`;
      // 원자적 선점 — SCHEDULED인 경우에만 DELIVERED로. 동시 조사·재조사 이중가산 방지.
      const claim = await tx.radiationFraction.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'DELIVERING' } });
      if (claim.count === 0) throw new ConflictException('분할이 이미 조사/변경되었습니다');

      // 🔴 누적선량은 **상태 문자열이 아니라 기록된 선량**으로 센다 —
      //    시드가 조사분획을 `COMPLETED`(정본은 `DELIVERED`)로 넣은 계획에서는 종전 조건이
      //    이미 조사한 8회(16Gy)를 통째로 빠뜨려, 총선량 초과 차단이 헛돌았다(2026-08-18 실측).
      //    환자 몸에 들어간 선량은 상태 라벨과 무관하게 누적된다(취소된 분획도 조사됐다면 포함).
      const delivered = await tx.radiationFraction.findMany({
        where: { planId: fraction.planId, id: { not: id }, deliveredDose: { not: null } },
      });
      const cumulativeRaw = delivered.reduce((sum, f) => sum + (f.deliveredDose ? Number(f.deliveredDose) : 0), 0) + data.deliveredDose;
      if (total > 0 && cumulativeRaw > total * (1 + tol.cumulativeOverPct / 100)) blocked.push(`누적선량(${cumulativeRaw.toFixed(1)}Gy)이 처방 총선량(${total}Gy·허용 +${tol.cumulativeOverPct}%)을 초과`);

      /**
       * 🔴 2026-08-26: 종전엔 BLOCK 이면 예외만 던지고 WARN 이면 응답 `warnings` 만 실었다 —
       *    **어느 쪽도 영속되지 않아** 관제의 "위반 0건"이 '준수'인지 '평가된 적 없음'인지
       *    구분할 방법이 없었다. 이제 두 경우 다 원장에 남긴다.
       *    (`record` 는 트랜잭션 클라이언트가 아닌 `this.prisma` 를 쓰므로 BLOCK 롤백에도 기록이 남는다 —
       *     조사되지 않았다는 사실과 게이트가 걸렸다는 사실은 둘 다 참이어야 한다.)
       */
      await enforceGate({
        gateKey: 'radiation.doseEnforce',
        mode,
        violated: blocked.length > 0,
        code: 'RT_DOSE_EXCEEDED',
        message: blocked.join(' / '),
        blockMessage: `조사 불가: ${blocked.join(' / ')}`, // BLOCK 응답 문구는 종전과 동일(FE 계약 보존)
        refType: 'RadiationFraction', refId: id,
        recorder: this.gates, logger: this.logger,
        extra: { blocked },
      });

      const updated = await tx.radiationFraction.update({
        where: { id },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          deliveredDose: new Prisma.Decimal(data.deliveredDose),
          cumulativeDose: new Prisma.Decimal(cumulativeRaw),
          setupVerified: data.setupVerified,
          coneBeamCT: data.coneBeamCT,
          // 🔴 (2026-10-10) 조사 기록자 = 로그인한 실무자 — 종전엔 본문 therapistId 만 받아 화면이 보내지 않아 늘 비었다(운영 조사 완료 49 중 16만 시드가 채움)
          therapistId: recorderId ?? data.therapistId ?? null,
          notes: data.notes,
        },
      });
      return { updated, warnings: mode === 'WARN' ? blocked : [] };
    });

    // IGRT 게이트가 WARN 으로 통과했다면 그 사실을 응답에도 싣는다(원장에만 있고 화면이 모르면 절반이다)
    const warnings = [...result.warnings, ...(igrtWarn ? [igrtWarn.message] : [])];
    return warnings.length > 0 ? { ...result.updated, warnings } : result.updated;
  }

  /**
   * 분할 취소 — 🔴 (2026-10-10) 종전엔 상태를 보지 않아 **이미 조사한 분할도 '취소'로 바뀌었다**(몸에 들어간 선량이 '취소' 라벨을 단다)
   *    · 예정(SCHEDULED)만 · 사유 필수 · 상태 조건부 갱신
   */
  async cancelFraction(id: string, notes?: string) {
    const fraction = await this.prisma.radiationFraction.findUnique({ where: { id } });
    if (!fraction) throw new NotFoundException('분할 치료를 찾을 수 없습니다');
    if (fraction.status !== 'SCHEDULED') throw new BadRequestException({ code: 'RT_FRACTION_NOT_CANCELLABLE', message: '예정(SCHEDULED) 분할만 취소할 수 있습니다', details: { status: fraction.status } });
    const reason = notes?.trim();
    if (!reason) throw new BadRequestException({ code: 'RT_FRACTION_CANCEL_REASON_REQUIRED', message: '취소 사유가 필요합니다' });
    const r = await this.prisma.radiationFraction.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'CANCELLED', notes: reason } });
    if (r.count === 0) throw new ConflictException('분할이 이미 조사/변경되었습니다');
    return this.prisma.radiationFraction.findUnique({ where: { id } });
  }

  /**
   * '조사 중'(DELIVERING) 고착 분할 정리 — 2026-10-10.
   * 🔴 조사 중은 조사 기록 트랜잭션 안에서만 거치는 상태인데, 운영에 이 상태로 남은 분할이 있었다(시드 생성기 · 종전 결함).
   *    조사 기록·취소가 예정(SCHEDULED)만 받아 **어떤 화면에서도 닫을 수 없었고**, 남은 분할 때문에 계획 완료도 막혔다.
   *  · 조사됨: 치료기 기록의 선량·시각을 사람이 넣는다(선량을 추정하지 않는다 · 시각을 지금으로 채우지 않는다)
   *    — 게이트로 막지 않는다(이미 일어난 조사를 기록하는 일) · 처방 이탈은 경고로 돌려준다
   *  · 조사 안 됨: 취소 + 사유 · 선량 없음
   *  · 실무자(조사자)는 모른다 → therapistId 를 채우지 않는다 · 정리한 사람은 감사 원장(변이 기본 감사)에 남는다
   */
  async resolveStuckFraction(
    id: string,
    data: { outcome: 'DELIVERED' | 'NOT_DELIVERED'; reason: string; deliveredDose?: number; deliveredAt?: string },
    now: Date = new Date(),
  ) {
    const fraction = await this.prisma.radiationFraction.findUnique({ where: { id }, include: { plan: true } });
    if (!fraction) throw new NotFoundException('분할 치료를 찾을 수 없습니다');
    if (fraction.status !== 'DELIVERING') {
      throw new BadRequestException({ code: 'RT_FRACTION_NOT_STUCK', message: "'조사 중'으로 멈춘 분할만 정리합니다", details: { status: fraction.status } });
    }
    const reason = data.reason?.trim();
    if (!reason) throw new BadRequestException({ code: 'RT_FRACTION_RESOLVE_REASON_REQUIRED', message: '정리 사유가 필요합니다' });
    // 메모에는 사유만 — 이 경로로 정리됐다는 사실은 감사 원장의 경로(resolve-stuck)가 말한다(서버가 문장을 조립하지 않는다)
    const note = reason;

    if (data.outcome === 'NOT_DELIVERED') {
      const r = await this.prisma.radiationFraction.updateMany({ where: { id, status: 'DELIVERING' }, data: { status: 'CANCELLED', notes: note } });
      if (r.count === 0) throw new ConflictException('분할이 이미 변경되었습니다');
      return { fraction: await this.prisma.radiationFraction.findUnique({ where: { id } }), warnings: [] as string[] };
    }

    if (!(typeof data.deliveredDose === 'number' && data.deliveredDose > 0)) {
      throw new BadRequestException({ code: 'RT_FRACTION_RESOLVE_DOSE_REQUIRED', message: '조사됨으로 정리하려면 치료기 기록의 조사선량이 필요합니다' });
    }
    if (!data.deliveredAt) throw new BadRequestException({ code: 'RT_FRACTION_RESOLVE_TIME_REQUIRED', message: '조사됨으로 정리하려면 치료기 기록의 조사 시각이 필요합니다' });
    const at = new Date(data.deliveredAt);
    if (Number.isNaN(at.getTime())) throw new BadRequestException({ code: 'RT_FRACTION_RESOLVE_TIME_INVALID', message: '조사 시각 형식이 올바르지 않습니다' });
    if (at.getTime() > now.getTime()) throw new BadRequestException({ code: 'RT_FRACTION_RESOLVE_TIME_FUTURE', message: '조사 시각이 미래입니다' });

    const dose = data.deliveredDose;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM radiation_plans WHERE id = ${fraction.planId}::uuid FOR UPDATE`;
      const others = await tx.radiationFraction.findMany({ where: { planId: fraction.planId, id: { not: id }, deliveredDose: { not: null } } });
      const cumulative = others.reduce((sum, f) => sum + Number(f.deliveredDose), 0) + dose;
      const r = await tx.radiationFraction.updateMany({
        where: { id, status: 'DELIVERING' },
        data: { status: 'DELIVERED', deliveredAt: at, deliveredDose: new Prisma.Decimal(dose), cumulativeDose: new Prisma.Decimal(cumulative), notes: note },
      });
      if (r.count === 0) throw new ConflictException('분할이 이미 변경되었습니다');
      const warnings: string[] = [];
      const perFraction = Number(fraction.plan.fractionDose);
      const total = Number(fraction.plan.totalDose);
      if (perFraction > 0 && dose !== perFraction) warnings.push('FRACTION_DOSE_DIFFERS');
      if (total > 0 && cumulative > total) warnings.push('CUMULATIVE_OVER_PRESCRIBED');
      return { fraction: await tx.radiationFraction.findUnique({ where: { id } }), warnings };
    });
  }

  /* ───── Toxicity ───── */

  async addToxicity(planId: string, data: {
    week: number; skinGrade?: number; mucositisGrade?: number;
    fatigueGrade?: number; nauseaGrade?: number; painGrade?: number;
    otherToxicity?: unknown; weight?: number; ecog?: number;
    notes?: string; assessedBy: string;
  }) {
    return this.prisma.radiationToxicity.create({
      data: {
        planId,
        week: data.week,
        skinGrade: data.skinGrade,
        mucositisGrade: data.mucositisGrade,
        fatigueGrade: data.fatigueGrade,
        nauseaGrade: data.nauseaGrade,
        painGrade: data.painGrade,
        otherToxicity: data.otherToxicity as never,
        weight: data.weight != null ? new Prisma.Decimal(data.weight) : undefined,
        ecog: data.ecog,
        notes: data.notes,
        assessedBy: data.assessedBy,
      },
    });
  }

  async getToxicities(planId: string) {
    return this.prisma.radiationToxicity.findMany({
      where: { planId },
      include: { assessor: { select: { familyName: true, givenName: true } } },
      orderBy: { week: 'asc' },
    });
  }

  /* ───── Machines / Schedule ───── */

  async getMachines() {
    // 방사선 치료에서 machine은 RadiationPlan.machine (문자열)으로 관리
    const plans = await this.prisma.radiationPlan.groupBy({
      by: ['machine'],
      where: { machine: { not: null } },
      _count: true,
    });
    return plans;
  }

  async getMachineSchedule(machineName: string, date: string) {
    const d = new Date(date);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    return this.prisma.radiationFraction.findMany({
      where: {
        scheduledDate: { gte: d, lt: next },
        plan: { machine: machineName },
      },
      include: {
        plan: {
          select: {
            patientId: true, technique: true, site: true, fractionDose: true, totalFractions: true,
            patient: { select: { familyName: true, givenName: true, mrn: true } },
          },
        },
      },
      orderBy: { fractionNumber: 'asc' },
    });
  }

  /* ───── Dashboard / Stats ───── */

  async getDashboard() {
    const today = todayDateOnly(); // 🔴 @db.Date 비교 — 로컬 자정은 하루 밀린다(정본)
    const tomorrow = new Date(today.getTime() + 86400000);

    const [todayCount, inTreatment, planned, completedPlans] = await Promise.all([
      this.prisma.radiationFraction.count({ where: { scheduledDate: { gte: today, lt: tomorrow } } }),
      this.prisma.radiationPlan.count({ where: { status: 'IN_TREATMENT' } }),
      this.prisma.radiationPlan.count({ where: { status: 'PLANNED' } }),
      this.prisma.radiationPlan.count({ where: { status: 'COMPLETED' } }),
    ]);

    return { todayFractions: todayCount, inTreatment, planned, completedPlans };
  }

  async getPatientHistory(patientId: string) {
    return this.prisma.radiationPlan.findMany({
      where: { patientId },
      include: {
        _count: { select: { fractions: true, toxicities: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getStats() {
    const [totalPlans, techniqueCounts, siteCounts] = await Promise.all([
      this.prisma.radiationPlan.count(),
      this.prisma.radiationPlan.groupBy({ by: ['technique'], _count: true }),
      this.prisma.radiationPlan.groupBy({ by: ['site'], _count: true, orderBy: { _count: { site: 'desc' } }, take: 10 }),
    ]);

    const deliveredCount = await this.prisma.radiationFraction.count({ where: { status: 'DELIVERED' } });
    const totalFractions = await this.prisma.radiationFraction.count();
    /**
     * 🔴 (2026-09-16 I4) 분할조사가 한 건도 등록되지 않았으면 완료율은 **0% 가 아니라 산출 불가**다.
     *    종전엔 계획이 없는 상태가 "완료율 0%"(=하나도 못 했다)로 그려졌다 — 다른 사실이다.
     *    분자·분모는 이미 응답에 있으므로(`deliveredCount`/`totalFractions`) 비율만 3상태로 만든다.
     */
    const completionRate = totalFractions > 0 ? Math.round((deliveredCount / totalFractions) * 100) : null;

    return {
      totalPlans, techniqueCounts, siteCounts, deliveredCount, totalFractions, completionRate,
      completionRateUnavailableReason: totalFractions > 0 ? null : '등록된 분할조사 0건 — 완료율을 산출할 수 없습니다',
    };
  }
}
