import { Injectable, Logger, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { requireDateParam } from '../../common/day-range';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { REHAB_EXECUTOR_PROFESSIONS } from '@hospital-run/shared';
import { assertTherapyExecutor } from '../../common/therapy-executor';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';
import { mergeTargetMap } from '../../common/qi-targets';
import { therapyBillingCode } from './rehab-billing';

interface RehabGateCheck {
  rule: 'FALL_RISK' | 'HOLD_VITALS';
  level: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class RehabService {
  private readonly logger = new Logger(RehabService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly configRuntime?: ConfigRuntimeService,
  ) {}

  /* ───── Assessments ───── */

  async createAssessment(data: {
    patientId: string; admissionId?: string; assessmentType: string;
    diagnosis: string; onsetDate?: string;
    barthel?: number; fim?: number; mmt?: unknown; rom?: unknown;
    berg?: number; mmse?: number; vas?: number;
    gait?: string; swallow?: string; goals?: unknown;
    notes?: string; assessedBy: string;
  }) {
    return this.prisma.rehabAssessment.create({
      data: {
        patientId: data.patientId,
        admissionId: data.admissionId,
        assessmentType: data.assessmentType,
        diagnosis: data.diagnosis,
        onsetDate: data.onsetDate ? new Date(data.onsetDate) : undefined,
        barthel: data.barthel,
        fim: data.fim,
        mmt: data.mmt as never,
        rom: data.rom as never,
        berg: data.berg,
        mmse: data.mmse,
        vas: data.vas,
        gait: data.gait,
        swallow: data.swallow,
        goals: data.goals as never,
        notes: data.notes,
        assessedBy: data.assessedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  /**
   * 재활 평가 조회. `patientId` 없으면 최근 목록(부서 화면 '재활평가' 탭).
   * 🔴 종전엔 환자별 EP 만 있어 목록 화면이 404 를 받았고, FE 의 `.catch(()=>[])` 가 그 실패를
   *    삼켜 **평가 3건이 있는데 "평가 기록 없음"** 이라고 말했다(2026-08-13 W4).
   */
  async getAssessments(patientId?: string, limit = 100) {
    return this.prisma.rehabAssessment.findMany({
      where: patientId ? { patientId } : {},
      include: {
        assessor: { select: { familyName: true, givenName: true } },
        // 목록에서는 누구의 평가인지 보여야 한다(환자별 조회는 이미 문맥이 있어 무해)
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      },
      orderBy: { assessedAt: 'desc' },
      take: limit,
    });
  }

  /* ───── Plans ───── */

  async createPlan(data: {
    patientId: string; diagnosis: string; startDate: string;
    endDate?: string; frequency: string; therapies: unknown;
    prescribedBy: string; notes?: string;
  }) {
    return this.prisma.rehabPlan.create({
      data: {
        patientId: data.patientId,
        diagnosis: data.diagnosis,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        frequency: data.frequency,
        therapies: data.therapies as never,
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
    return this.prisma.rehabPlan.findMany({
      where,
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        prescriber: { select: { familyName: true, givenName: true } },
        _count: { select: { sessions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPlanDetail(id: string) {
    const plan = await this.prisma.rehabPlan.findUnique({
      where: { id },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        prescriber: { select: { familyName: true, givenName: true } },
        sessions: {
          orderBy: { scheduledAt: 'asc' },
          include: { therapist: { select: { familyName: true, givenName: true } } },
        },
      },
    });
    if (!plan) throw new NotFoundException('재활 계획을 찾을 수 없습니다');
    return plan;
  }

  async updatePlan(id: string, data: { status?: string; endDate?: string; notes?: string; frequency?: string }) {
    const plan = await this.prisma.rehabPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('재활 계획을 찾을 수 없습니다');
    return this.prisma.rehabPlan.update({
      where: { id },
      data: {
        ...(data.status && { status: data.status }),
        ...(data.endDate && { endDate: new Date(data.endDate) }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.frequency && { frequency: data.frequency }),
      },
    });
  }

  /* ───── Sessions ───── */

  async createSession(data: {
    planId: string; patientId: string; therapyType: string;
    therapistId: string; scheduledAt: string; notes?: string;
  }) {
    return this.prisma.rehabSession.create({
      data: {
        planId: data.planId,
        patientId: data.patientId,
        therapyType: data.therapyType,
        therapistId: data.therapistId,
        scheduledAt: new Date(data.scheduledAt),
        notes: data.notes,
      },
      include: { therapist: { select: { familyName: true, givenName: true } } },
    });
  }

  async generateSessions(data: { planId: string; startDate: string; weeks: number; therapistId: string }) {
    // 🔴 (2026-09-15 P3) `rehab_sessions.therapist_id` 는 NOT NULL 인데 미지정이면 `null` 을 넣어 **500** 이었다.
    //    치료사를 지어내 채우지 않는다(요청자·계획 작성자로 대신하면 남의 이름으로 일정이 선다) — 400 으로 말한다.
    if (!data.therapistId) {
      throw new BadRequestException({ code: 'REHAB_THERAPIST_REQUIRED', message: '세션을 생성하려면 담당 치료사가 필요합니다' });
    }
    const plan = await this.prisma.rehabPlan.findUnique({ where: { id: data.planId } });
    if (!plan) throw new NotFoundException('재활 계획을 찾을 수 없습니다');
    if (plan.status !== 'ACTIVE') throw new BadRequestException('비활성 계획입니다');

    // frequency 파싱: "주3회" → 3, "주5회" → 5, "매일" → 7
    const freq = plan.frequency;
    const freqMatch = freq.match(/(\d+)/);
    const perWeek = freq.includes('매일') ? 7 : (freqMatch ? parseInt(freqMatch[1]) : 3);

    // 치료 유형 (첫 번째)
    const therapies = plan.therapies as any[];
    const therapyType = typeof therapies[0] === 'string' ? therapies[0] : therapies[0]?.type ?? '운동치료';

    // 요일 매핑
    const dayMap: Record<number, number[]> = {
      3: [1, 3, 5],       // 월수금
      2: [2, 4],           // 화목
      5: [1, 2, 3, 4, 5],  // 평일
      7: [0, 1, 2, 3, 4, 5, 6], // 매일
    };
    const allowedDays = dayMap[perWeek] ?? dayMap[3];

    const start = new Date(data.startDate);
    const endDate = new Date(start);
    endDate.setDate(endDate.getDate() + data.weeks * 7);

    const sessions: any[] = [];
    const current = new Date(start);
    let sessionNo = 1;

    while (current <= endDate) {
      if (allowedDays.includes(current.getDay())) {
        sessions.push({
          planId: data.planId,
          patientId: plan.patientId,
          therapyType,
          therapistId: data.therapistId,
          scheduledAt: new Date(current.getTime() + 9 * 3600000), // 기본 09:00
          status: 'SCHEDULED',
        });
        sessionNo++;
      }
      current.setDate(current.getDate() + 1);
    }

    await this.prisma.rehabSession.createMany({ data: sessions });
    return { created: sessions.length, planId: data.planId, weeks: data.weeks };
  }

  async getSessions(params?: { date?: string; therapistId?: string; patientId?: string }) {
    const where: Record<string, unknown> = {};
    if (params?.therapistId) where.therapistId = params.therapistId;
    if (params?.patientId) where.patientId = params.patientId;
    if (params?.date) {
      const d = new Date(params.date);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      where.scheduledAt = { gte: d, lt: next };
    }
    return this.prisma.rehabSession.findMany({
      where,
      include: {
        plan: {
          select: {
            diagnosis: true, frequency: true,
            patient: { select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true } },
          },
        },
        therapist: { select: { familyName: true, givenName: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  /**
   * 시행 전 안전게이트 — 낙상위험(Berg)·활력징후 hold parameter. rehab.sessionGate(OFF/WARN/BLOCK·기본 OFF).
   * 평가 결과는 저장만 되고 시행에 미소비되던 갭(R7) 해소: 저장된 최신 Berg/보행 평가와 최근 활력징후를 실제 대조.
   */
  private async evaluateSessionGate(patientId: string): Promise<RehabGateCheck[]> {
    const checks: RehabGateCheck[] = [];
    // 판정 기준 개정 표면 = config rehab.holdCriteria(§7 P1) — 아래 상수는 폴백(fail-safe)
    const c = mergeTargetMap(
      { bergHighRisk: 21, bergMediumMax: 40, sbpHigh: 180, sbpLow: 90, hrHigh: 120, hrLow: 50, spo2Low: 90, tempHigh: 38, vitalsWindowHours: 72 },
      await this.configRuntime?.get('rehab.holdCriteria').catch(() => null),
    );

    // 낙상위험 — 최신 재활평가 Berg Balance Scale(0~56)
    const assess = await this.prisma.rehabAssessment.findFirst({
      where: { patientId },
      orderBy: { assessedAt: 'desc' },
      select: { berg: true, gait: true, assessedAt: true },
    });
    if (assess?.berg != null) {
      if (assess.berg < c.bergHighRisk) {
        checks.push({
          rule: 'FALL_RISK', level: 'ERROR',
          message: `낙상 고위험 — Berg ${assess.berg}점(<${c.bergHighRisk}). 보조자 동반·안전조치 확인 전 치료 보류`,
          data: { berg: assess.berg, gait: assess.gait, assessedAt: assess.assessedAt },
        });
      } else if (assess.berg <= c.bergMediumMax) {
        checks.push({
          rule: 'FALL_RISK', level: 'WARNING',
          message: `낙상 중위험 — Berg ${assess.berg}점(${c.bergHighRisk}~${c.bergMediumMax}). 보행 치료 시 보조 필요`,
          data: { berg: assess.berg, gait: assess.gait },
        });
      }
    }

    // hold parameter — 최근 활력징후(심장재활 포함 공통 중단 기준)
    const vitals = await this.prisma.preVisitVitals.findFirst({
      where: { patientId, measuredAt: { gte: new Date(Date.now() - c.vitalsWindowHours * 3600_000) } },
      orderBy: { measuredAt: 'desc' },
      select: { systolicBp: true, heartRate: true, spo2: true, temperature: true, measuredAt: true },
    });
    if (!vitals) {
      checks.push({ rule: 'HOLD_VITALS', level: 'INFO', message: `최근 ${c.vitalsWindowHours}시간 활력징후 없음 — 치료 전 측정 권장(hold 판정 불가)` });
    } else {
      const holds: string[] = [];
      if (vitals.systolicBp != null && vitals.systolicBp > c.sbpHigh) holds.push(`SBP ${vitals.systolicBp} > ${c.sbpHigh}`);
      if (vitals.systolicBp != null && vitals.systolicBp < c.sbpLow) holds.push(`SBP ${vitals.systolicBp} < ${c.sbpLow}`);
      if (vitals.heartRate != null && vitals.heartRate > c.hrHigh) holds.push(`HR ${vitals.heartRate} > ${c.hrHigh}`);
      if (vitals.heartRate != null && vitals.heartRate < c.hrLow) holds.push(`HR ${vitals.heartRate} < ${c.hrLow}`);
      if (vitals.spo2 != null && vitals.spo2 < c.spo2Low) holds.push(`SpO₂ ${vitals.spo2}% < ${c.spo2Low}%`);
      if (vitals.temperature != null && Number(vitals.temperature) >= c.tempHigh) holds.push(`체온 ${vitals.temperature}℃ ≥ ${c.tempHigh}℃`);
      if (holds.length) {
        checks.push({
          rule: 'HOLD_VITALS', level: 'ERROR',
          message: `치료 중단 기준(hold) 해당: ${holds.join(', ')} — 재측정·의사 확인 후 시행`,
          data: { holds, measuredAt: vitals.measuredAt },
        });
      }
    }
    return checks;
  }

  async startSession(id: string, opts?: { overrideGate?: boolean; overrideReason?: string; userId?: string }) {
    await assertTherapyExecutor(this.prisma, opts?.userId, REHAB_EXECUTOR_PROFESSIONS);
    const session = await this.prisma.rehabSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('세션을 찾을 수 없습니다');

    const mode = gateMode(await this.configRuntime?.get('rehab.sessionGate'), 'OFF');
    let safetyChecks: object | undefined;
    if (mode !== 'OFF') {
      const checks = await this.evaluateSessionGate(session.patientId);
      for (const c of checks) {
        if (c.level !== 'INFO') this.logger.warn(`rehab session gate [${c.rule}] ${c.level} session=${id}: ${c.message}`);
      }
      const errors = checks.filter((c) => c.level === 'ERROR');
      if (mode === 'BLOCK' && errors.length > 0 && !opts?.overrideGate) {
        throw new BadRequestException({
          code: 'REHAB_SESSION_HOLD',
          message: `재활치료 안전게이트 보류: ${errors.map((c) => c.message).join(' / ')} — 사유와 함께 overrideGate: true로 강제 시행할 수 있습니다.`,
          checks,
        });
      }
      safetyChecks = {
        evaluatedAt: new Date().toISOString(),
        checks,
        ...(errors.length > 0 && opts?.overrideGate
          ? { overridden: true, overrideReason: opts?.overrideReason ?? '(사유 미입력)', overriddenBy: opts?.userId }
          : {}),
      };
    }

    return this.prisma.rehabSession.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS', startTime: new Date(),
        ...(safetyChecks ? { safetyChecks: safetyChecks as never } : {}),
      },
    });
  }


  async completeSession(id: string, data: {
    activities?: unknown; vitals?: unknown; progress?: string;
    duration?: number; notes?: string;
  }, userId?: string) {
    await assertTherapyExecutor(this.prisma, userId, REHAB_EXECUTOR_PROFESSIONS);
    const session = await this.prisma.rehabSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('세션을 찾을 수 없습니다');

    // 청구코드 매핑: therapyType → EDI 수가 → 명칭·단가 해석
    const code = therapyBillingCode(session.therapyType);
    const proc = await this.prisma.procedureCode.findFirst({ where: { code }, select: { code: true, nameKo: true, unitPrice: true } });

    // 치료 시간 — 사람이 적은 값이 우선, 없으면 실제 시작~완료로 잰다(시작 기록이 없으면 비운다 · 지어내지 않는다)
    const endTime = new Date();
    const measured = session.startTime ? Math.floor((endTime.getTime() - session.startTime.getTime()) / 60000) : null;
    const duration = data.duration ?? (measured != null && measured > 0 ? measured : undefined);

    return this.prisma.rehabSession.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        endTime,
        activities: data.activities as never,
        vitals: data.vitals as never,
        progress: data.progress,
        duration,
        notes: data.notes,
        billingCode: proc?.code ?? code,
        billingCodeName: proc?.nameKo ?? null,
        billingUnitPrice: proc?.unitPrice ?? null,
      },
    });
  }

  /* ───── Dashboard / Stats ───── */

  async getTherapistSchedule(therapistId: string, date: string) {
    // 🔴 `date` 무검증 → `Invalid Date` 가 Prisma 로 들어가 **500**(운영 실측)
    const d = requireDateParam(date, '조회할 날짜');
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    return this.prisma.rehabSession.findMany({
      where: { therapistId, scheduledAt: { gte: d, lt: next } },
      include: {
        plan: { select: { diagnosis: true, patientId: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async getDashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [todaySessions, activePlans, recentAssessments] = await Promise.all([
      this.prisma.rehabSession.count({ where: { scheduledAt: { gte: today, lt: tomorrow } } }),
      this.prisma.rehabPlan.count({ where: { status: 'ACTIVE' } }),
      this.prisma.rehabAssessment.count({ where: { assessedAt: { gte: new Date(Date.now() - 7 * 86400000) } } }),
    ]);

    const statusCounts = await this.prisma.rehabSession.groupBy({
      by: ['status'],
      where: { scheduledAt: { gte: today, lt: tomorrow } },
      _count: true,
    });

    return { todaySessions, activePlans, recentAssessments, statusCounts };
  }

  async getPatientProgress(patientId: string) {
    const assessments = await this.prisma.rehabAssessment.findMany({
      where: { patientId },
      select: { assessedAt: true, barthel: true, fim: true, berg: true, mmse: true, vas: true },
      orderBy: { assessedAt: 'asc' },
    });
    const sessionStats = await this.prisma.rehabSession.groupBy({
      by: ['status'],
      where: { patientId },
      _count: true,
    });
    return { assessments, sessionStats };
  }

  async getStats() {
    const [totalPlans, activePlans, completedSessions, therapyTypeCounts] = await Promise.all([
      this.prisma.rehabPlan.count(),
      this.prisma.rehabPlan.count({ where: { status: 'ACTIVE' } }),
      this.prisma.rehabSession.count({ where: { status: 'COMPLETED' } }),
      this.prisma.rehabSession.groupBy({ by: ['therapyType'], _count: true }),
    ]);
    return { totalPlans, activePlans, completedSessions, therapyTypeCounts };
  }
}
