import { Injectable, Logger, Optional, BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AdmissionLegalType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';
import { CreatePsychAdmissionDto, SuitabilityReviewDto, ConvertPsychTypeDto, DischargePsychAdmissionDto, ContinuationReviewDto } from './dto/psychiatry.dto';
import { specialtyTodayList, specialtyTodayStats, specialtyRecordPatients } from '../../common/specialty-board';
// 🔴 여기 있던 private addMonths 를 정본으로 올렸다 — 한 모듈에 갇혀 있어
//    나머지 네 곳이 각자 틀린 계산을 하고 있었다(2026-08-29).
import { addMonths, localDateKey } from '../../common/day-range';

@Injectable()
export class PsychiatryService {
  private readonly logger = new Logger(PsychiatryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  /* ───── Patients ───── */

  /** 기록이 있는 환자 — 최근 기록 순 상한 + 전체 수·잘림(정본 specialtyRecordPatients · 2026-10-10) */
  async getPatients() {
    return specialtyRecordPatients(this.prisma, (a) => this.prisma.psychExam.groupBy(a as never), 'examinedAt');
  }

  /* ───── Exams ───── */

  async getExams(patientId: string) {
    return this.prisma.psychExam.findMany({
      where: { patientId },
      include: { examiner: { select: { familyName: true, givenName: true } } },
      orderBy: { examinedAt: 'desc' },
    });
  }

  async createExam(data: {
    patientId: string; encounterId?: string;
    appearance?: string; behavior?: string; speech?: string;
    mood?: string; affect?: string;
    thoughtContent?: unknown; thoughtProcess?: string;
    perception?: unknown; cognition?: unknown;
    insight?: string;
    phq9?: number; phq9Item9?: number; gad7?: number; mmse?: number;
    audit?: number; cssrs?: unknown; customScales?: unknown;
    suicideRisk?: string; safetyPlan?: unknown;
    diagnosis?: string; plan?: string;
    examinedBy: string;
  }) {
    const created = await this.prisma.psychExam.create({
      data: {
        patientId: data.patientId,
        encounterId: data.encounterId,
        appearance: data.appearance,
        behavior: data.behavior,
        speech: data.speech,
        mood: data.mood,
        affect: data.affect,
        thoughtContent: data.thoughtContent as never,
        thoughtProcess: data.thoughtProcess,
        perception: data.perception as never,
        cognition: data.cognition as never,
        insight: data.insight,
        phq9: data.phq9,
        phq9Item9: data.phq9Item9,
        gad7: data.gad7,
        mmse: data.mmse,
        audit: data.audit,
        cssrs: data.cssrs as never,
        customScales: data.customScales as never,
        suicideRisk: data.suicideRisk,
        safetyPlan: data.safetyPlan as never,
        diagnosis: data.diagnosis,
        plan: data.plan,
        examinedBy: data.examinedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
    // 자살위험 에스컬레이션 — 수동 HIGH 분류뿐 아니라 PHQ-9 문항9(자살 사고) 양성(≥1)도 서버 플로어로 강제 통지.
    // 임상의가 별도 '자살위험 HIGH' 체크를 누락해도 문항9 양성이면 담당의 통지·안전조치가 트리거됨(under-triage 차단).
    const item9Positive = data.phq9Item9 != null && data.phq9Item9 >= 1;
    if (data.suicideRisk === 'HIGH' || item9Positive) {
      this.events?.emit('psych.suicide.high', {
        patientId: data.patientId, examId: created.id,
        suicideRisk: data.suicideRisk ?? null, phq9Item9: data.phq9Item9 ?? null,
        trigger: data.suicideRisk === 'HIGH' ? 'RISK_HIGH' : 'PHQ9_ITEM9',
      });
    }
    return created;
  }

  /* ───── Score Trend ───── */

  async getScoreTrend(patientId: string) {
    const exams = await this.prisma.psychExam.findMany({
      where: { patientId },
      select: {
        examinedAt: true,
        phq9: true,
        gad7: true,
        mmse: true,
      },
      orderBy: { examinedAt: 'asc' },
    });
    return exams.map(e => ({
      date: e.examinedAt,
      phq9: e.phq9,
      gad7: e.gad7,
      mmse: e.mmse,
    }));
  }

  /* ───── Today / Stats ───── */

  async getToday() {
    // 정본 = 오늘 예약(Appointment) — 종전엔 `return []` 리터럴이라 영구 공집합이었다
    return specialtyTodayList(this.prisma, 'psychiatry');
  }

  async getStats() {
    const total = await this.prisma.psychExam.count();
    return { totalExams: total, ...(await specialtyTodayStats(this.prisma, 'psychiatry')) };
  }

  /* ───── 비자의입원(정신건강복지법) ───── */

  private addDays(base: Date, days: number) { return new Date(base.getTime() + days * 86400000); }
  /** 월 가산(월말 오버플로 클램프) — 1/31+1개월=3/3 같은 법정기한 초과 버그 방지. */

  /** 입원유형별 법정 안전장치(심사기한·기간만료) 산출 */
  private computeSafeguards(legalType: AdmissionLegalType, admittedAt: Date) {
    let suitabilityReviewDue: Date | null = null;
    let continuationReviewDue: Date | null = null;
    let legalExpiryAt: Date | null = null;
    if (legalType === 'EMERGENCY') {
      legalExpiryAt = this.addDays(admittedAt, 3); // §50 72시간
    } else if (legalType === 'GUARDIAN' || legalType === 'ADMINISTRATIVE') {
      suitabilityReviewDue = addMonths(admittedAt, 1); // 입원적합성심사 1개월내
      legalExpiryAt = addMonths(admittedAt, 3); // 최초 입원기간 3개월
      continuationReviewDue = addMonths(admittedAt, 3);
    }
    return { suitabilityReviewDue, continuationReviewDue, legalExpiryAt };
  }

  /** 비자의입원 등록 — 유형별 법정요건 게이팅 */
  async createAdmission(dto: CreatePsychAdmissionDto, userId: string) {
    // 보호입원(§43): 보호의무자 2인 + 정신과전문의 진단 필수
    if (dto.legalType === 'GUARDIAN') {
      if (!dto.guardian1Name || !dto.guardian2Name) {
        throw new BadRequestException('보호입원(§43)은 보호의무자 2인의 동의가 필요합니다.');
      }
      if (!dto.psychiatrist1Id) {
        throw new BadRequestException('보호입원(§43)은 정신건강의학과 전문의 진단이 필요합니다.');
      }
    }
    // 동의입원(§42): 보호의무자 1인 필요
    if (dto.legalType === 'CONSENT' && !dto.guardian1Name) {
      throw new BadRequestException('동의입원(§42)은 보호의무자 동의가 필요합니다.');
    }
    const admittedAt = new Date();
    const sg = this.computeSafeguards(dto.legalType, admittedAt);
    return this.prisma.psychiatricAdmission.create({
      data: {
        patientId: dto.patientId,
        admissionId: dto.admissionId,
        legalType: dto.legalType,
        admittedAt,
        diagnosis: dto.diagnosis,
        psychiatrist1Id: dto.psychiatrist1Id,
        psychiatrist2Id: dto.psychiatrist2Id,
        guardian1Name: dto.guardian1Name,
        guardian1Relation: dto.guardian1Relation,
        guardian2Name: dto.guardian2Name,
        guardian2Relation: dto.guardian2Relation,
        suitabilityReviewDue: sg.suitabilityReviewDue,
        continuationReviewDue: sg.continuationReviewDue,
        legalExpiryAt: sg.legalExpiryAt,
        recordedBy: userId,
        notes: dto.notes,
      },
      include: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } },
    });
  }

  /** 활성 비자의입원 목록 + 컴플라이언스 경고 */
  async getActiveAdmissions() {
    const rows = await this.prisma.psychiatricAdmission.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { admittedAt: 'desc' },
      include: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } },
    });
    return rows.map(r => ({ ...r, alerts: this.buildAlerts(r) }));
  }

  /** 법정기한 경고만(대시보드용) */
  async getComplianceAlerts() {
    const active = await this.getActiveAdmissions();
    return active.filter(a => a.alerts.length > 0);
  }

  /** 개별 입원의 법정 경고 산출(만료·심사지연) */
  private buildAlerts(r: { legalType: AdmissionLegalType; legalExpiryAt: Date | null; suitabilityReviewDue: Date | null; suitabilityReviewedAt: Date | null; continuationReviewDue: Date | null }) {
    const now = new Date();
    const alerts: { code: string; message: string; severity: 'ERROR' | 'WARN' }[] = [];
    if (r.legalExpiryAt && r.legalExpiryAt < now) {
      alerts.push({ code: 'LEGAL_EXPIRED', message: `법정 입원기간이 만료되었습니다(${r.legalExpiryAt.toISOString().slice(0, 10)}). 퇴원 또는 연장심사 필요.`, severity: 'ERROR' });
    }
    if (r.suitabilityReviewDue && !r.suitabilityReviewedAt) {
      if (r.suitabilityReviewDue < now) {
        alerts.push({ code: 'SUITABILITY_OVERDUE', message: `입원적합성심사 기한이 지났습니다(${r.suitabilityReviewDue.toISOString().slice(0, 10)}).`, severity: 'ERROR' });
      } else if (this.addDays(now, 7) >= r.suitabilityReviewDue) {
        alerts.push({ code: 'SUITABILITY_DUE', message: `입원적합성심사 기한이 임박했습니다(${r.suitabilityReviewDue.toISOString().slice(0, 10)}).`, severity: 'WARN' });
      }
    }
    if (r.continuationReviewDue) {
      if (r.continuationReviewDue < now) {
        alerts.push({ code: 'CONTINUATION_OVERDUE', message: `계속입원심사 기한이 지났습니다(${r.continuationReviewDue.toISOString().slice(0, 10)}).`, severity: 'ERROR' });
      } else if (this.addDays(now, 14) >= r.continuationReviewDue) {
        // 계속심사는 기한=법정만료라 사전 경고 없이는 만료 후에야 인지 → 14일 전 사전 경고.
        alerts.push({ code: 'CONTINUATION_DUE', message: `계속입원심사 기한이 임박했습니다(${r.continuationReviewDue.toISOString().slice(0, 10)}). 만료 전 심사 청구 필요.`, severity: 'WARN' });
      }
    }
    return alerts;
  }

  /** 환자 비자의입원 상태(배너용) */
  async getPatientAdmissionStatus(patientId: string) {
    const active = await this.prisma.psychiatricAdmission.findFirst({
      where: { patientId, status: 'ACTIVE' },
      orderBy: { admittedAt: 'desc' },
    });
    const involuntary = !!active && active.legalType !== 'VOLUNTARY';
    return { involuntary, admission: active, alerts: active ? this.buildAlerts(active) : [] };
  }

  /** 활성 비자의입원 조회(퇴원건 변경 차단 — 법정 기록 무결성) */
  private async getActiveOrThrow(id: string) {
    const existing = await this.prisma.psychiatricAdmission.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('비자의입원 기록 없음');
    if (existing.status !== 'ACTIVE') throw new BadRequestException('이미 퇴원/종결된 입원은 변경할 수 없습니다.');
    return existing;
  }

  /** 입원적합성심사 결과 기록 — 부적합/퇴원명령 시 퇴원 처리 */
  async recordSuitabilityReview(id: string, dto: SuitabilityReviewDto) {
    await this.getActiveOrThrow(id);
    const result = dto.result.trim();
    const discharge = result === '부적합' || result === '퇴원명령';
    return this.prisma.psychiatricAdmission.update({
      where: { id },
      data: {
        suitabilityReviewedAt: new Date(),
        suitabilityResult: result,
        ...(discharge ? { status: 'DISCHARGED', dischargedAt: new Date() } : {}),
        ...(dto.notes ? { notes: dto.notes } : {}),
      },
    });
  }

  /**
   * 계속입원심사 결과 기록(2026-10-07).
   *  · 🔴 종전엔 결과 없이 호출만으로 3개월 연장했고, 유형을 보지 않아 응급입원(§50 72시간)·자의입원도 3개월로 늘었다
   *  · 계속입원심사 기한이 있는 유형(보호·행정)만 · 결과 '계속입원'일 때만 연장 · '퇴원'이면 퇴원
   *  · 심사 이력은 notes 에 덧붙여 남긴다(덮어쓰지 않는다)
   */
  async recordContinuationReview(id: string, dto: ContinuationReviewDto) {
    const existing = await this.getActiveOrThrow(id);
    if (!existing.continuationReviewDue || !(existing.legalType === 'GUARDIAN' || existing.legalType === 'ADMINISTRATIVE')) {
      throw new BadRequestException({ code: 'CONTINUATION_REVIEW_NOT_APPLICABLE', message: '계속입원심사 대상 유형이 아닙니다 — 보호입원·행정입원만 해당합니다.', details: { legalType: existing.legalType } });
    }
    const now = new Date();
    const stamp = ['[계속입원심사', localDateKey(now), dto.result + ']', dto.notes ?? ''].join(' ').trim();
    const notes = existing.notes ? existing.notes + '\n' + stamp : stamp;
    const data = dto.result === '퇴원'
      ? { status: 'DISCHARGED' as const, dischargedAt: now, notes }
      : {
          continuationReviewDue: addMonths(now, 3), legalExpiryAt: addMonths(now, 3), notes,
          ...(dto.psychiatrist2Id ? { psychiatrist2Id: dto.psychiatrist2Id } : {}),
        };
    return this.prisma.psychiatricAdmission.update({ where: { id }, data });
  }

  /** 입원유형 전환(예: 응급→보호) — 유형별 법정요건 재검증·안전장치 재산출·감사 보존 */
  async convertType(id: string, dto: ConvertPsychTypeDto, _userId: string) {
    const existing = await this.getActiveOrThrow(id);
    // createAdmission과 동일한 유형별 게이팅(전환으로 우회 방지)
    if (dto.legalType === 'GUARDIAN' && (!existing.guardian1Name || !existing.guardian2Name || !existing.psychiatrist1Id)) {
      throw new BadRequestException('보호입원 전환은 보호의무자 2인·전문의 진단이 선행되어야 합니다.');
    }
    if (dto.legalType === 'CONSENT' && !existing.guardian1Name) {
      throw new BadRequestException('동의입원 전환은 보호의무자 동의가 필요합니다.');
    }
    const sg = this.computeSafeguards(dto.legalType, new Date());
    // 이전 유형을 notes에 보존(법적 권한 이력 유실 방지)
    const audit = `[전환 ${existing.legalType}→${dto.legalType}]${dto.notes ? ' ' + dto.notes : ''}`;
    return this.prisma.psychiatricAdmission.update({
      where: { id },
      data: {
        legalType: dto.legalType,
        suitabilityReviewDue: sg.suitabilityReviewDue,
        suitabilityReviewedAt: null,
        continuationReviewDue: sg.continuationReviewDue,
        legalExpiryAt: sg.legalExpiryAt,
        notes: `${existing.notes ?? ''}\n${audit}`.trim(),
      },
    });
  }

  async dischargeAdmission(id: string, dto: DischargePsychAdmissionDto) {
    // 이미 퇴원건 재퇴원 차단 — 원 퇴원일시(법정 재원기간) 덮어쓰기 방지
    await this.getActiveOrThrow(id);
    return this.prisma.psychiatricAdmission.update({
      where: { id },
      data: { status: 'DISCHARGED', dischargedAt: new Date(), ...(dto.notes ? { notes: dto.notes } : {}) },
    });
  }

  /* ───── §75 격리·강박 (정신건강복지법) ───── */

  /** 법정 최대시간(시간) — 격리 12h·강박 4h. 연장 시 동일 단위로 갱신(전문의 대면진찰 전제). */
  private static readonly SECLUSION_LEGAL_HOURS: Record<string, number> = { SECLUSION: 12, RESTRAINT: 4 };

  /**
   * 지시자 정신건강의학과 전문의 검증 — psychiatry.seclusionEnforce(OFF/WARN/BLOCK·기본 WARN).
   * BLOCK: 비전문의 지시 거부. WARN: 허용하되 로그+psychiatristVerified=false 영속(감사).
   */
  private async assertPsychiatrist(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, department: true, familyName: true, givenName: true },
    });
    const verified = user?.role === 'DOCTOR' && !!user.department?.includes('정신');
    if (!verified) {
      const mode = gateMode(await this.config?.get('psychiatry.seclusionEnforce'), 'WARN');
      const who = user ? `${user.familyName}${user.givenName}` : userId;
      const msg = `격리·강박 지시자가 정신건강의학과 의사가 아님: ${who} (role=${user?.role}, dept=${user?.department ?? '-'})`;
      if (mode === 'BLOCK') {
        throw new BadRequestException({ code: 'PSYCH_SECLUSION_NOT_PSYCHIATRIST', message: `§75 위반 차단: ${msg}. 정신건강의학과 전문의 지시가 필요합니다.` });
      }
      if (mode !== 'OFF') this.logger.warn(`§75 gate WARN — ${msg}`);
    }
    return verified;
  }

  async createSeclusion(
    dto: { patientId: string; admissionId?: string; type: string; reason: string; riskType: string; notes?: string },
    userId: string,
  ) {
    if (!['SECLUSION', 'RESTRAINT'].includes(dto.type)) throw new BadRequestException('type은 SECLUSION|RESTRAINT');
    if (!['SELF_HARM', 'HARM_OTHERS', 'BOTH'].includes(dto.riskType)) throw new BadRequestException('riskType은 SELF_HARM|HARM_OTHERS|BOTH');
    const verified = await this.assertPsychiatrist(userId);

    // 동일 환자·동일 유형 중복 지시 차단(시간 리셋 악용 방지)
    const existing = await this.prisma.psychSeclusionOrder.findFirst({
      where: { patientId: dto.patientId, type: dto.type, status: 'ACTIVE' },
      select: { id: true },
    });
    if (existing) throw new BadRequestException('이미 활성 상태의 동일 유형 격리·강박 지시가 있습니다. 연장 또는 해제 후 재지시하세요.');

    const hours = PsychiatryService.SECLUSION_LEGAL_HOURS[dto.type];
    const startedAt = new Date();
    const order = await this.prisma.psychSeclusionOrder.create({
      data: {
        patientId: dto.patientId,
        admissionId: dto.admissionId ?? null,
        type: dto.type,
        reason: dto.reason,
        riskType: dto.riskType,
        orderedById: userId,
        psychiatristVerified: verified,
        startedAt,
        legalMaxUntil: new Date(startedAt.getTime() + hours * 3600_000),
        notes: dto.notes ?? null,
      },
    });
    this.events?.emit('psych.seclusion.started', { orderId: order.id, patientId: dto.patientId, type: dto.type, legalMaxUntil: order.legalMaxUntil });
    return order;
  }

  async getActiveSeclusions() {
    const now = new Date();
    const orders = await this.prisma.psychSeclusionOrder.findMany({
      where: { status: 'ACTIVE' },
      include: {
        monitorings: { orderBy: { checkedAt: 'desc' }, take: 1 },
        extensions: { orderBy: { extendedAt: 'desc' } },
      },
      orderBy: { legalMaxUntil: 'asc' },
    });
    const patients = await this.prisma.patient.findMany({
      where: { id: { in: orders.map((o) => o.patientId) } },
      select: { id: true, familyName: true, givenName: true, mrn: true },
    });
    const pmap = new Map(patients.map((p) => [p.id, p]));
    return orders.map((o) => {
      const lastCheck = o.monitorings[0]?.checkedAt ?? o.startedAt;
      return {
        ...o,
        patient: pmap.get(o.patientId) ?? null,
        legalOverdue: o.legalMaxUntil < now, // 법정 최대시간 초과(즉시 해제 또는 전문의 연장 필요)
        monitoringOverdue: now.getTime() - lastCheck.getTime() > 3600_000, // 관찰 1시간 초과
        remainingMinutes: Math.round((o.legalMaxUntil.getTime() - now.getTime()) / 60000),
      };
    });
  }

  async getPatientSeclusions(patientId: string) {
    return this.prisma.psychSeclusionOrder.findMany({
      where: { patientId },
      include: { monitorings: { orderBy: { checkedAt: 'desc' } }, extensions: true },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }

  private async getActiveSeclusionOrThrow(id: string) {
    const order = await this.prisma.psychSeclusionOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('격리·강박 지시를 찾을 수 없습니다.');
    if (order.status !== 'ACTIVE') throw new BadRequestException('이미 해제된 지시입니다.');
    return order;
  }

  async recordSeclusionMonitoring(
    orderId: string,
    dto: { observation?: string; vitalSigns?: Record<string, unknown>; continued?: boolean },
    userId: string,
  ) {
    const order = await this.getActiveSeclusionOrThrow(orderId);
    /**
     * 🔴 (2026-09-16 H4) 관찰 기록과 그 판단에 따른 해제는 **한 트랜잭션**이다 — G3 가 신체보호대 점검에서
     *    고친 것과 같은 자리이고, 여기(격리·강박)는 법정 최대시간이 걸린 기록이다.
     *    종전엔 "지속 불필요(continued=false)" 기록만 커밋되고 해제가 실패할 수 있었다:
     *    원장은 "더 가둘 필요 없다"고 적혀 있는데 격리 오더는 ACTIVE 로 남는다.
     */
    const at = new Date();
    return this.prisma.$transaction(async (tx) => {
      const monitoring = await tx.psychSeclusionMonitoring.create({
        data: {
          orderId,
          checkedById: userId,
          observation: dto.observation ?? null,
          vitalSigns: (dto.vitalSigns ?? undefined) as object | undefined,
          continued: dto.continued ?? true,
        },
      });
      // 지속 불필요 판단 → 자동 해제(불필요한 격리·강박 최소화 원칙)
      if (dto.continued === false) {
        await tx.psychSeclusionOrder.update({
          where: { id: order.id },
          data: { status: 'RELEASED', releasedAt: at, releasedById: userId },
        });
      }
      return monitoring;
    });
  }

  async extendSeclusion(orderId: string, dto: { reason: string }, userId: string) {
    if (!dto.reason?.trim()) throw new BadRequestException('연장 사유(전문의 대면진찰 소견)가 필요합니다.');
    const order = await this.getActiveSeclusionOrThrow(orderId);
    await this.assertPsychiatrist(userId); // 연장은 전문의 대면진찰 — 동일 게이트
    const hours = PsychiatryService.SECLUSION_LEGAL_HOURS[order.type];
    const base = order.legalMaxUntil > new Date() ? order.legalMaxUntil : new Date();
    const newMaxUntil = new Date(base.getTime() + hours * 3600_000);
    const [, updated] = await this.prisma.$transaction([
      this.prisma.psychSeclusionExtension.create({
        data: { orderId, extendedById: userId, reason: dto.reason, newMaxUntil },
      }),
      this.prisma.psychSeclusionOrder.update({
        where: { id: orderId },
        data: { legalMaxUntil: newMaxUntil, extensionCount: { increment: 1 } },
      }),
    ]);
    return updated;
  }

  async releaseSeclusion(orderId: string, userId: string, notes?: string) {
    const order = await this.getActiveSeclusionOrThrow(orderId);
    const updated = await this.prisma.psychSeclusionOrder.update({
      where: { id: order.id },
      data: {
        status: 'RELEASED', releasedAt: new Date(), releasedById: userId,
        ...(notes ? { notes: `${order.notes ?? ''}\n[해제] ${notes}`.trim() } : {}),
      },
    });
    this.events?.emit('psych.seclusion.released', { orderId, patientId: order.patientId });
    return updated;
  }

  /* ───── ECT(전기경련치료) ───── */

  async createEct(
    dto: { patientId: string; consentFormId?: string; scheduledAt?: string; anesthesiaNote?: string; notes?: string },
    userId: string,
  ) {
    await this.assertPsychiatrist(userId);
    // 동의 게이트 — psychiatry.ectConsentEnforce(기본 BLOCK): 서명된 유효 동의서 없이는 처방 불가
    const mode = gateMode(await this.config?.get('psychiatry.ectConsentEnforce'), 'BLOCK');
    if (mode !== 'OFF') {
      const consent = dto.consentFormId
        ? await this.prisma.consentForm.findUnique({
            where: { id: dto.consentFormId },
            select: { patientId: true, signedAt: true, isValid: true },
          })
        : null;
      const ok = !!consent && consent.patientId === dto.patientId && !!consent.signedAt && consent.isValid;
      if (!ok) {
        const msg = 'ECT는 서명된 유효 동의서(consentFormId) 없이 처방할 수 없습니다.';
        if (mode === 'BLOCK') throw new BadRequestException({ code: 'ECT_CONSENT_REQUIRED', message: msg });
        this.logger.warn(`ECT consent gate WARN — ${msg} patient=${dto.patientId}`);
      }
    }
    return this.prisma.ectSession.create({
      data: {
        patientId: dto.patientId,
        orderedById: userId,
        consentFormId: dto.consentFormId ?? null,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        anesthesiaNote: dto.anesthesiaNote ?? null,
        notes: dto.notes ?? null,
      },
    });
  }

  async getPatientEct(patientId: string) {
    return this.prisma.ectSession.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  async completeEct(id: string, dto: { seizureDurationSec?: number; complications?: string; notes?: string }) {
    const session = await this.prisma.ectSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('ECT 세션을 찾을 수 없습니다.');
    if (session.status !== 'ORDERED') throw new BadRequestException(`${session.status} 상태는 완료 처리할 수 없습니다.`);
    return this.prisma.ectSession.update({
      where: { id },
      data: {
        status: 'COMPLETED', performedAt: new Date(),
        seizureDurationSec: dto.seizureDurationSec ?? null,
        complications: dto.complications ?? null,
        ...(dto.notes ? { notes: dto.notes } : {}),
      },
    });
  }

  async cancelEct(id: string, reason?: string) {
    const session = await this.prisma.ectSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('ECT 세션을 찾을 수 없습니다.');
    if (session.status !== 'ORDERED') throw new BadRequestException(`${session.status} 상태는 취소할 수 없습니다.`);
    return this.prisma.ectSession.update({
      where: { id },
      data: { status: 'CANCELLED', ...(reason ? { notes: `${session.notes ?? ''}\n[취소] ${reason}`.trim() } : {}) },
    });
  }
}
