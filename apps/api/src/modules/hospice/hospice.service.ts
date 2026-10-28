import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ControlledSubstanceService } from '../controlled-substance/controlled-substance.service';
import { assertStateTransition, stateChangedConflict, TransitionMap } from '../../common/state-transition';

/** 호스피스 등록 상태 어휘 — 스키마 주석(HospiceRegistration.status) 그대로 */
export type HospiceStatus = 'ACTIVE' | 'DISCHARGED' | 'DECEASED';

/**
 * 퇴원 후 사망은 일어나는 일이라 DISCHARGED→DECEASED 는 연다. 사망은 되돌릴 수 없다.
 * 재등록은 새 등록으로 한다(같은 행을 ACTIVE 로 되살리지 않는다).
 */
export const HOSPICE_TRANSITIONS: TransitionMap<HospiceStatus> = {
  ACTIVE: ['DISCHARGED', 'DECEASED'],
  DISCHARGED: ['DECEASED'],
  DECEASED: [],
};
export const HOSPICE_TX_CTX = { code: 'HOSPICE', message: '지금 상태에서는 할 수 없는 호스피스 등록 처리입니다' };

@Injectable()
export class HospiceService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly controlledSubstance?: ControlledSubstanceService,
  ) {}

  /**
   * 완화의료 마약류(오피오이드) 처방 발행(P3) — 통증관리를 자유텍스트가 아니라 마약류 관리대장
   * (ControlledSubstanceLog)으로 정합 발행. 이후 검증·불출·투약·NIMS·2인확인은 controlled-substance 워크플로우가 담당.
   */
  async prescribeOpioid(registrationId: string, data: { drugName: string; deaSchedule: string; narcoticType?: string; quantity: number; unit: string; drugCode?: string; notes?: string }, userId: string) {
    const reg = await this.prisma.hospiceRegistration.findUnique({ where: { id: registrationId }, select: { patientId: true } });
    if (!reg) throw new NotFoundException('호스피스 등록을 찾을 수 없습니다');
    if (!this.controlledSubstance) throw new BadRequestException('마약류 관리 서비스를 사용할 수 없습니다');
    return this.controlledSubstance.prescribe({
      patientId: reg.patientId,
      drugName: data.drugName,
      drugCode: data.drugCode,
      deaSchedule: data.deaSchedule,
      narcoticType: data.narcoticType,
      quantity: data.quantity,
      unit: data.unit,
      prescribedBy: userId,
      notes: `완화의료 통증관리${data.notes ? `: ${data.notes}` : ''}`,
    });
  }

  // ── 등록 ──

  async register(data: { patientId: string; registeredBy: string; ppsScore: number; primaryDiagnosis: string; prognosis?: string; hospiceType: string; goals?: string; dnrStatus?: boolean; admissionId?: string }) {
    return this.prisma.hospiceRegistration.create({
      data: { ...data, registeredAt: new Date() },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getRegistrations(status?: string) {
    return this.prisma.hospiceRegistration.findMany({
      where: status ? { status } : {},
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true, dateOfBirth: true } },
        registrar: { select: { familyName: true, givenName: true } },
        _count: { select: { assessments: true, conferences: true } },
      },
      orderBy: { registeredAt: 'desc' },
    });
  }

  async getRegistration(id: string) {
    const reg = await this.prisma.hospiceRegistration.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true, dateOfBirth: true, gender: true } },
        assessments: { orderBy: { assessedAt: 'desc' }, take: 10, include: { assessor: { select: { familyName: true, givenName: true } } } },
        conferences: { orderBy: { conferenceDate: 'desc' }, take: 5, include: { facilitator: { select: { familyName: true, givenName: true } } } },
      },
    });
    if (!reg) throw new NotFoundException('호스피스 등록을 찾을 수 없습니다');
    return reg;
  }

  async updateStatus(id: string, status: string, occurredAt?: string) {
    // 🔴 인라인 @Body('status') 는 ValidationPipe 를 건너뛴다 → 오타 상태가 VarChar 에 그대로 저장되고
    //    아래 DISCHARGED/DECEASED 분기가 조용히 안 타 dischargedAt/deceasedAt 이 미설정된다(nursing 관용구와 동일).
    if (!['ACTIVE', 'DISCHARGED', 'DECEASED'].includes(status)) {
      throw new BadRequestException('잘못된 상태(ACTIVE·DISCHARGED·DECEASED)');
    }
    // 🔴 (2026-09-15 D1) 종전엔 현재 상태를 보지 않았다 — **사망(DECEASED) 등록이 ACTIVE 로 되돌아갔고**,
    //    같은 상태를 다시 보내면 사망·퇴원 시각이 오늘로 덮어써졌다(일어난 사실을 고쳐 쓴다).
    const next = status as HospiceStatus;
    const cur = await this.prisma.hospiceRegistration.findUnique({ where: { id }, select: { status: true } });
    if (!cur) throw new NotFoundException('호스피스 등록을 찾을 수 없습니다');
    const from = cur.status as HospiceStatus;
    if (from === next) return this.prisma.hospiceRegistration.findUnique({ where: { id } });
    assertStateTransition(HOSPICE_TRANSITIONS, from, next, HOSPICE_TX_CTX);
    const data: Record<string, unknown> = { status };
    // 🔴 (2026-10-10) 퇴원·사망 시각은 일어난 시각이다 — 종전엔 버튼을 누른 시각을 박았다(사망 시각은 법정 기록)
    if (status === 'DISCHARGED' || status === 'DECEASED') {
      const at = occurredAt ? new Date(occurredAt) : null;
      if (!at || Number.isNaN(at.getTime())) throw new BadRequestException({ code: 'HOSPICE_OCCURRED_AT_REQUIRED', message: status === 'DECEASED' ? '사망 시각이 필요합니다' : '퇴원 시각이 필요합니다' });
      if (at.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException({ code: 'HOSPICE_OCCURRED_AT_FUTURE', message: '시각이 미래입니다' });
      const reg = await this.prisma.hospiceRegistration.findUnique({ where: { id }, select: { registeredAt: true } });
      if (reg?.registeredAt && at < reg.registeredAt) throw new BadRequestException({ code: 'HOSPICE_OCCURRED_AT_BEFORE_REGISTRATION', message: '등록 이전 시각입니다' });
      if (status === 'DISCHARGED') data.dischargedAt = at;
      else data.deceasedAt = at;
    }
    const upd = await this.prisma.hospiceRegistration.updateMany({ where: { id, status: from }, data: data as never });
    if (upd.count === 0) stateChangedConflict(HOSPICE_TX_CTX, from);
    return this.prisma.hospiceRegistration.findUnique({ where: { id } });
  }

  // ── ESAS 증상 평가 ──

  async createAssessment(data: {
    registrationId: string; assessorId: string;
    pain: number; tiredness: number; nausea: number; depression: number;
    anxiety: number; drowsiness: number; appetite: number; wellbeing: number;
    shortnessOfBreath: number; otherSymptom?: string; otherScore?: number;
    painType?: string; whoStep?: number; painMedication?: string; notes?: string;
  }) {
    const totalScore = data.pain + data.tiredness + data.nausea + data.depression +
      data.anxiety + data.drowsiness + data.appetite + data.wellbeing +
      data.shortnessOfBreath + (data.otherScore ?? 0);
    const created = await this.prisma.hospiceSymptomAssessment.create({
      data: { ...data, totalScore, assessedAt: new Date() },
    });
    // 심한 통증(ESAS pain≥7) 경보(P3) — 완화의료 통증 재평가·오피오이드 조정 트리거. 기존: 방치 감지 없음.
    if (data.pain >= 7) {
      this.events?.emit('hospice.severe_pain', { registrationId: data.registrationId, assessmentId: created.id, pain: data.pain });
    }
    return created;
  }

  async getAssessments(registrationId: string) {
    return this.prisma.hospiceSymptomAssessment.findMany({
      where: { registrationId },
      include: { assessor: { select: { familyName: true, givenName: true } } },
      orderBy: { assessedAt: 'desc' },
    });
  }

  // ── 사전의료의향서 ──

  /**
   * 사전연명의료 문서 등록 — 🔴 (2026-10-10) 연명의료계획서(POLST)는 의사가 작성한다: 의사 계정만 · 작성 의사 = 로그인한 의사
   *    (종전엔 간호사도 등록할 수 있었고 작성 의사는 본문이 정한 아무 id 였다). 사전연명의료의향서(AD)는 작성자가 환자 본인이라 의사를 붙이지 않는다.
   */
  async createDirective(data: { patientId: string; documentType: string; cprDecision?: string; ventilatorDecision?: string; dialysisDecision?: string; transfusionDecision?: string; chemotherapyDecision?: string; hospiceConsent?: boolean; organDonation?: boolean; doctorId?: string }, actor?: { id: string; role?: string }) {
    const { doctorId: _ignored, ...rest } = data;
    if (data.documentType === 'POLST' && actor && actor.role !== 'DOCTOR' && actor.role !== 'ADMIN') {
      throw new ForbiddenException({ code: 'POLST_DOCTOR_ONLY', message: '연명의료계획서는 의사가 작성·등록합니다' });
    }
    return this.prisma.advanceDirective.create({
      data: { ...rest, doctorId: data.documentType === 'POLST' ? actor?.id ?? null : null, registeredAt: new Date() },
    });
  }

  /**
   * 기본은 유효(ACTIVE) 문서만(안전 표시줄 등 소비처 그대로). `includeRevoked` 면 철회된 문서도 — 철회 기록자·사유와 함께
   * (2026-10-10 전에 철회된 행은 기록자·사유 null = 모름).
   */
  async getDirectives(patientId: string, includeRevoked = false) {
    return this.prisma.advanceDirective.findMany({
      where: includeRevoked ? { patientId } : { patientId, status: 'ACTIVE' },
      orderBy: { registeredAt: 'desc' },
      ...(includeRevoked ? { include: { revokedBy: { select: { familyName: true, givenName: true } } } } : {}),
    });
  }

  /**
   * 사전의료의향서 철회 — 이미 철회된 것을 다시 철회하지 않는다(철회 시각·기록자·사유는 일어난 사실이다).
   * 🔴 (2026-10-10) 종전엔 누가·왜 철회했는지 남지 않았다 — 사유 필수 · 기록자 = 로그인한 사람.
   */
  async revokeDirective(id: string, reason: string, actorId: string) {
    const why = (reason ?? '').trim();
    if (!why) throw new BadRequestException({ code: 'DIRECTIVE_REVOKE_REASON_REQUIRED', message: '철회 사유를 적어야 합니다' });
    const cur = await this.prisma.advanceDirective.findUnique({ where: { id }, select: { status: true } });
    if (!cur) throw new NotFoundException('사전의료의향서를 찾을 수 없습니다');
    if (cur.status === 'REVOKED') return this.prisma.advanceDirective.findUnique({ where: { id } });
    const upd = await this.prisma.advanceDirective.updateMany({
      where: { id, status: cur.status },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedById: actorId, revokeReason: why },
    });
    if (upd.count === 0) stateChangedConflict(HOSPICE_TX_CTX, cur.status);
    return this.prisma.advanceDirective.findUnique({ where: { id } });
  }

  // ── 돌봄 회의 ──

  async createConference(data: { registrationId: string; facilitatorId: string; conferenceType: string; attendees: unknown[]; currentStatus?: string; careGoals?: string; painManagement?: string; psychosocial?: string; spiritual?: string; familyConcerns?: string; actionItems?: unknown[]; nextConferenceDate?: string }) {
    return this.prisma.hospiceCareConference.create({
      data: {
        registrationId: data.registrationId,
        facilitatorId: data.facilitatorId,
        conferenceDate: new Date(),
        conferenceType: data.conferenceType,
        attendees: data.attendees as never,
        currentStatus: data.currentStatus,
        careGoals: data.careGoals,
        painManagement: data.painManagement,
        psychosocial: data.psychosocial,
        spiritual: data.spiritual,
        familyConcerns: data.familyConcerns,
        actionItems: data.actionItems as never,
        nextConferenceDate: data.nextConferenceDate ? new Date(data.nextConferenceDate) : undefined,
      },
    });
  }

  async getConferences(registrationId: string) {
    return this.prisma.hospiceCareConference.findMany({
      where: { registrationId },
      include: { facilitator: { select: { familyName: true, givenName: true } } },
      orderBy: { conferenceDate: 'desc' },
    });
  }

  // ── 통계 ──

  async getStats() {
    const [active, total, deceased] = await Promise.all([
      this.prisma.hospiceRegistration.count({ where: { status: 'ACTIVE' } }),
      this.prisma.hospiceRegistration.count(),
      this.prisma.hospiceRegistration.count({ where: { status: 'DECEASED' } }),
    ]);
    return { active, total, deceased, discharged: total - active - deceased };
  }
}
