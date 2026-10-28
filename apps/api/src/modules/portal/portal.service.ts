import { JourneyService } from '../journey/journey.service';
import { Injectable, UnauthorizedException, NotFoundException, BadRequestException, ForbiddenException, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { DOC_MAX_COPIES, PORTAL_BLOCKED_DOC_TYPES, computeFeeWith, loadFeeRules } from '../medical-record-issuance/fee-rules';
import { publicKeyProblem } from '../../common/util/signature-verify';
import { PATIENT_FACING_OMIT } from '../../common/patient-select';
import { dayRange, localDateTimeKey, requireDateParam, todayDateOnly } from '../../common/day-range';
import { stayDays, isCriticalFlag, PATIENT_VISIBLE_JOURNEY_EVENT_TYPES, isPatientVisibleJourneyEvent, patientJourneyDescription, journeyEventDisplay } from '@hospital-run/shared';
import { billingOutstanding, labReleaseState, visitSummaryIncludesDiagnosis, COST_ESTIMATE_RECENT_SAMPLE, joinPatientName } from '@hospital-run/shared';
import { UNPAID_STATUS } from '../journey-console/flow-canon';
import { paymentEventsInRange } from '../billing/payment-events';
import { checkupItemPriority, estimatedWaitMinutes as estimatedWaitMinutes_, rankNextStations } from '@hospital-run/shared';
import { escapeHtml as esc } from '../../common/util/html-escape';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { currentFormRevision } from '../form-engine/form-engine.service';
import { AdmissionVitalsReader } from '../vitals/admission-vitals.reader';
import type { CheckupReserveDto } from './dto/portal.dto';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { readHospitalConfig, readHospitalFacts, hospitalHoursLines, HOSPITAL_UNSET_KO } from '../config/hospital-facts';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { aiUnavailable } from '../medical-ai/ai-grounding';
import { ClinicScheduleService } from '../clinic-schedule/clinic-schedule.service';
import { AllergyService } from '../allergy/allergy.service';
import { TelehealthService } from '../telehealth/telehealth.service';
import { ScheduleService } from '../schedule/schedule.service';
import { CreateAppointmentDto } from '../schedule/dto/create-appointment.dto';
import { AvailabilityQueryDto } from '../schedule/dto/appointment-query.dto';
import { AppointmentType } from '@prisma/client';
import { WaitingQueueService } from '../waiting-queue/waiting-queue.service';
import { parseFrequencySlots } from './frequency-slots.util';
import { signingSecret } from '../../common/util/signing-secret';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { promptList } from '../medical-ai/ai-grounding';
import {
  getTelehealthDepartmentPolicy,
  isTelehealthDepartmentEligible,
  filterTelehealthDepartments,
} from '../../common/telehealth-department-policy';
import { DEFAULT_GUARDIAN_SCOPE, BTG_GUARDIAN_SCOPE, type GuardianScope } from './guardian-scope';
import { CRITICAL_ALERT_OPEN_STATUSES } from '../lab/critical-value-alert-states';
import { SpaceModelService } from '../space-model/space-model.service';
import { ModuleRef } from '@nestjs/core';
import { BillingService } from '../billing/billing.service';

const PORTAL_SESSION_TTL_MINUTES = 30;

// 보호자 위임 열람 시 별도 동의 없이는 제외되는 민감 진료과 (기획서 §3.3)
const SENSITIVE_DEPARTMENTS = ['정신건강의학과', '산부인과', '비뇨의학과'];

// ── Journey Hub 내부 전용 타입 ───────────────────────────────

/** 포털 여정 타임라인 행(P3) — label·track 은 shared 표시 정본의 유형별 고정 문구(자유 title 은 싣지 않는다) */
export interface PortalJourneyTimelineItem {
  id: string;
  eventType: string;
  eventAt: Date;
  description: string | null;
  severity: string | null;
  refType: string | null;
  occurredAt: Date | null;
  occurredAtSource: string;
  occurredAtPrecision: string | null;
  createdAt: Date;
  label: string | null;
  track: string | null;
}

/** buildCheckupStatus / buildOutpatientStatus 의 queue 파라미터
 *  WaitingQueue findFirst({ include: { doctor: { select: { id, familyName, givenName } } } }) 반환 형태 */
interface JourneyQueue {
  id: string;
  queueNumber: number;
  status: string;
  departmentName: string;
  doctorId: string;
  checkedInAt: Date;
  calledAt: Date | null;
  startedAt: Date | null;
  doctor: { id: string; familyName: string; givenName: string } | null;
}

/** CheckupVisit 개별 검사 결과 항목 (CheckupResultItem) */
interface CheckupItem {
  id: string;
  category: string;
  testName: string;
  value: string | null;
  unit: string | null;
  referenceRange: string | null;
  finding: string;
  completedAt: Date | null;
}

/** buildCheckupStatus 의 checkup 파라미터
 *  CheckupVisit findFirst({ include: { program, items } }) 반환 형태 */
interface JourneyCheckup {
  id: string;
  checkedInAt: Date | null;
  program: { name: string; category: string; duration: number } | null;
  items: CheckupItem[];
}

/** buildInpatientStatus 의 admission 파라미터
 *  Admission findFirst({ include: { bed: { include: ward }, attendingDoctor, admittingDoctor } }) 반환 형태 */
interface JourneyAdmission {
  id: string;
  admitDate: Date;
  bed: {
    roomNumber: string;
    bedNumber: string;
    ward: { name: string } | null;
  } | null;
  attendingDoctor: { id: string; familyName: string; givenName: string } | null;
  admittingDoctor: { id: string; familyName: string; givenName: string } | null;
}

/** buildPostDischargeStatus 의 discharge 파라미터
 *  Admission findFirst({ include: { attendingDoctor, dischargeSummaryDoc } }) 반환 형태
 *  dischargeMedications 는 Prisma JsonValue 이므로 unknown 허용 */
interface JourneyDischarge {
  id: string;
  dischargeDate: Date | null;
  attendingDoctor: { familyName: string; givenName: string } | null;
  dischargeSummaryDoc: {
    dischargeDiagnosis: string | null;
    followUpPlan: string | null;
    followUpDate: Date | null;
    dischargeMedications: unknown;
  } | null;
}

/**
 * 환자 앱에 나가는 인증서 필드 — **발급과 목록이 같은 집합을 쓴다**(2026-09-16 G3).
 * 🔴 정본이 둘이면 갈라진다: 종전엔 목록만 `select` 였고 발급은 모델을 통째로 돌려줘,
 *    같은 인증서가 경로에 따라 내부 운영 값(`certHash`·`fingerprint`·`pinFailCount` 등)까지 실려 나갔다.
 */
const PATIENT_CERTIFICATE_SELECT = {
  id: true,
  serialNumber: true,
  status: true,
  issuedAt: true,
  expiresAt: true,
  algorithm: true,
  subjectDn: true,
  createdAt: true,
} as const;

/**
 * 🔴 검사 결과 한 항목의 환자 공개 모양 — 결과 목록·건강 요약·추이가 **같은 규칙**을 쓴다(2026-10-20 포털 P3 B8).
 *  · 결정 `portal.labResultRelease` = VALUES_NOW_JUDGMENT_AFTER_REVIEW — 수치는 바로, 판정(flag)은 의사가 결과를 확인(Order.acknowledgedAt)한 뒤에만
 *  · 위급값 폐루프(별도 결정 `policy.criticalValue.patientNotify`) — 담당의가 위급값 경보를 닫기 전에는 수치도 가린다(종전 그대로)
 *  · 🔴 종전: 위급값 가림이 결과 목록에만 있어 건강 요약·검사 추이가 같은 위급값을 그대로 보였다
 */
export function releasedLabItem(
  it: { testName: string; value: string | null; unit: string | null; flag: string | null },
  ctx: { reviewed: boolean; openCriticalNames?: Set<string> },
) {
  const masked = isCriticalFlag(it.flag) && !!ctx.openCriticalNames?.has(it.testName);
  return {
    value: masked ? '담당의 확인 중' : (it.value ?? ''),
    unit: masked ? '' : (it.unit ?? ''),
    // 판정은 의료진 확인 뒤 — 확인 전에는 비운다(정상이라고도 말하지 않는다)
    flag: ctx.reviewed ? (it.flag ?? '') : '',
    pendingReview: masked || undefined,
    judgmentPending: !ctx.reviewed || undefined,
  };
}

@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);
  private readonly jwtSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly configRuntime: ConfigRuntimeService,
    private readonly clinicSchedule: ClinicScheduleService,
    private readonly waitingQueue: WaitingQueueService,
    private readonly schedule: ScheduleService,
    private readonly allergyService: AllergyService,
    private readonly telehealth: TelehealthService,
    @Optional() private readonly medicalAi?: MedicalAiService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly spaceModel?: SpaceModelService,
    /** 여정 정본 발행기(2026-10-01 P0-6 — 직접 쓰기 이관) */
    @Optional() private readonly journey?: JourneyService,
    // 🔴 수납 계산 정본(BillingService)은 ModuleRef 로 늦게 찾는다 — BillingModule import 는 부트 순환(2026-07-07 장애 · portal.module 주석)
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {
    this.jwtSecret = signingSecret('portal');
  }

  /** R10: 셀프 체크인 — 오늘 진료 의사 목록 */
  async getClinicScheduleToday(department?: string) {
    return this.clinicSchedule.findToday(department);
  }

  /** R10: 포털 셀프 체크인 (본인 접수) */
  async selfCheckIn(patientId: string, body: { departmentName: string; doctorId?: string; visitType?: string; reason?: string }) {
    if (!body.departmentName) throw new BadRequestException('진료과를 선택하세요.');
    return this.waitingQueue.checkIn({
      patientId,
      departmentName: body.departmentName,
      doctorId: body.doctorId || undefined,
      visitType: body.visitType || 'FOLLOW_UP',
      reason: body.reason || undefined,
      type: 'WALK_IN',
    });
  }

  /** AI 도우미 — 환자 자유 질문 */
  async aiAsk(patientId: string, question: string) {
    if (!this.medicalAi) return { answer: '현재 AI 서비스를 이용할 수 없습니다.' };
    try {
      const result = await this.medicalAi.clinicalQa({ question, patientContext: `환자 포털에서 환자가 직접 질문합니다. 쉬운 한국어로 환자가 이해할 수 있게 답변하세요.` });
      const answer = typeof result === 'string' ? result : result?.answer ?? '';
      if (!answer || answer.includes('Error:') || answer.includes('BadStatusLine')) {
        return { answer: '죄송합니다, 일시적으로 AI 응답을 받지 못했습니다. 잠시 후 다시 시도해주세요.' };
      }
      return { answer };
    } catch {
      return { answer: '죄송합니다, AI 응답에 실패했습니다. 잠시 후 다시 시도해주세요.' };
    }
  }

  /**
   * ── 🔴 AI 건강 스코어는 **폐지**한다(수치를 만들지 않는다). ──
   *
   * 원 결함(2026-08-18 적발 · P15-b · **환자에게 직접 노출**): LLM 에게
   * `진료 횟수 N회 / 검사 횟수 M회 / 활성 문제` 만 주고 **0~100 건강점수**와
   * **영양·운동·정신건강 항목별 점수**를 요구해, 그 숫자를 환자 포털 게이지에
   * `양호 / 보통 / 주의` 색등급으로 그렸다.
   *
   * 왜 "근거를 갖춰 살리는" 쪽이 아니라 폐지인가:
   *   ① **진료·검사 '횟수'는 건강 지표가 아니다.** 잘 관리돼 자주 오는 환자와 중증 환자가 같은 입력을 만든다.
   *      횟수→점수 사이에 어떤 방향성도 정의된 적이 없다(많을수록 나쁨? 좋음? 정본이 없다).
   *   ② **영양·운동·정신건강은 HIS 에 자료 자체가 없다.** 그 항목 점수는 전부 생성물이다.
   *   ③ 0~100 척도의 건강점수는 **검증된 산출 도구(validated instrument)** 가 있어야 성립한다.
   *      여기엔 없다. 없는 도구를 LLM 으로 대신하면 그건 측정이 아니라 창작이고,
   *      환자는 그 숫자를 자기 건강 등급으로 읽는다.
   *   ④ 이 저장소 규칙: **확실하지 않으면 침묵한다 · 표본 부재의 정답은 폴백이 아니라 "산출 불가"** 다.
   *
   * EP 는 남기되(구 클라이언트가 붙어 있다) **AI 를 부르지 않고** 산출 불가를 명시한다.
   * 대신 환자가 실제로 확인할 수 있는 **사실 카운트**(진료·검사·활성 문제 수)는 그대로 돌려준다 —
   * 그건 점수가 아니라 셀 수 있는 사실이다. 화면은 숫자 점수 대신 이 사실을 보여준다.
   */
  async getHealthScore(patientId: string) {
    const [encounterCount, labCount, activeProblemCount] = await Promise.all([
      this.prisma.encounter.count({ where: { patientId } }),
      this.prisma.labResult.count({ where: { patientId } }),
      this.prisma.problemList.count({ where: { patientId, status: 'ACTIVE' } }),
    ]);
    return {
      patientId,
      score: null,
      categories: null,
      encounterCount,
      labCount,
      activeProblemCount,
      ...aiUnavailable(
        'NO_VALIDATED_INSTRUMENT',
        '건강 점수는 산출하지 않습니다 — 진료·검사 횟수만으로 0~100점을 매길 수 있는 검증된 산출 도구가 없고, 영양·운동·정신건강은 병원 기록에 자료가 없습니다. 점수 대신 기록된 사실만 표시합니다.',
      ),
    };
  }

  /**
   * AI 재진 권고 — 만성질환·마지막 진료 기반 다음 방문 시기 제안.
   * 🔴 마지막 진료도 활성 문제도 없으면 **호출하지 않는다**(종전엔 '없음/없음'을 보내고도 권고를 받았다).
   */
  async getFollowupRecommendation(patientId: string) {
    if (!this.medicalAi) return { patientId, recommendation: null, ...aiUnavailable('SOURCE_UNREACHABLE', 'AI 보조가 비활성화되어 있습니다.') };
    const [lastEncounter, problems] = await Promise.all([
      this.prisma.encounter.findFirst({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, chiefComplaint: true, assessment: true },
      }),
      this.prisma.problemList.findMany({
        where: { patientId, status: 'ACTIVE' },
        select: { description: true },
      }),
    ]);
    if (!lastEncounter && !problems.length) {
      return {
        patientId,
        recommendation: null,
        ...aiUnavailable('NO_SOURCE_DATA', '진료 기록과 활성 문제가 없어 다음 방문 시기를 권고할 근거가 없습니다.'),
      };
    }
    try {
      const result = await this.medicalAi.clinicalQa({
        question: `아래는 환자의 실제 기록입니다. 이 기록만 근거로 다음 재진 시기와 필요한 검사를 한국어로 추천해주세요. 기록에 없는 내용은 추정하지 마세요.\n\n마지막 진료: ${lastEncounter?.createdAt?.toISOString().slice(0, 10) ?? '기록 없음'}\n주호소: ${lastEncounter?.chiefComplaint ?? '기록 없음'}\n평가: ${lastEncounter?.assessment ?? '기록 없음'}\n활성 문제: ${promptList(problems.map((p) => p.description))}`,
      });
      return { patientId, recommendation: result, lastVisit: lastEncounter?.createdAt ?? null, source: 'AI' };
    } catch (e) {
      this.logger.warn(`AI 재진 권고 실패: ${e}`);
      return { patientId, recommendation: null, source: 'FALLBACK', error: '권고 서비스 일시 불가' };
    }
  }

  /** 환자 본인 인증 (MRN + 생년월일) → JWT 발급 */
  async authenticate(mrn: string, dateOfBirth: string, ipAddress?: string, userAgent?: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { mrn, dateOfBirth: new Date(dateOfBirth), validTo: null },
      select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true, phone: true, insuranceType: true },
    });
    if (!patient) throw new UnauthorizedException('환자 정보를 찾을 수 없습니다. MRN과 생년월일을 확인해주세요.');

    // JWT 토큰 생성 (30분 만료)
    const expiresAt = new Date(Date.now() + PORTAL_SESSION_TTL_MINUTES * 60 * 1000);
    const token = jwt.sign(
      { sub: patient.id, mrn: patient.mrn, type: 'portal' },
      this.jwtSecret,
      { expiresIn: `${PORTAL_SESSION_TTL_MINUTES}m` },
    );

    // 세션 저장
    await this.prisma.portalSession.create({
      data: {
        patientId: patient.id,
        token,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ? userAgent.substring(0, 500) : null,
        expiresAt,
      },
    });

    // 감사 로그
    await this.logAudit(patient.id, 'LOGIN', '/api/v1/portal/auth', ipAddress);

    this.logger.log(`Portal login: mrn=${patient.mrn}`); // PHI: 이름 미기록(MRN 로 추적, 2026-07 로그 PHI 전수)
    return { patient, token, expiresAt };
  }

  /** JWT 토큰 검증 → patientId 반환 */
  async verifyToken(token: string): Promise<string> {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as any;
      if (payload.type !== 'portal') throw new Error('Invalid token type');

      // DB 세션 확인 (활성 + 미만료)
      const session = await this.prisma.portalSession.findFirst({
        where: { token, isActive: true, expiresAt: { gt: new Date() } },
      });
      if (!session) throw new Error('Session expired or revoked');

      // 마지막 활동 시간 업데이트
      await this.prisma.portalSession.update({
        where: { id: session.id },
        data: { lastActiveAt: new Date() },
      }).catch(() => {});

      return payload.sub;
    } catch (e) {
      throw new UnauthorizedException('포털 인증이 만료되었습니다. 다시 로그인해주세요.');
    }
  }

  /**
   * 통합 인증 해석 — 포털 토큰 또는 보호자(위임) 토큰
   * 보호자 토큰이면 피부양자 patientId + 접근범위/감사정보 반환
   */
  async resolveAuth(token: string): Promise<{ patientId: string; guardian?: { accountId: string; guardianPatientId: string; scope: Record<string, boolean>; guardianshipId: string } }> {
    let payload: any;
    try { payload = jwt.verify(token, this.jwtSecret); } catch { throw new UnauthorizedException('포털 인증이 만료되었습니다. 다시 로그인해주세요.'); }

    if (payload.type === 'guardian') {
      // 위임 관계 유효성 재확인 (승인 + 미만료)
      const g = await this.prisma.patientGuardian.findUnique({ where: { id: payload.guardianshipId } });
      if (!g || !g.isApproved) throw new UnauthorizedException('유효하지 않은 보호자 위임입니다.');
      if (g.expiresAt && g.expiresAt < new Date()) throw new UnauthorizedException('보호자 위임 기간이 만료되었습니다.');
      return {
        patientId: payload.targetPid,
        guardian: { accountId: payload.sub, guardianPatientId: payload.pid, scope: (payload.scope ?? {}) as Record<string, boolean>, guardianshipId: g.id },
      };
    }

    // 일반 포털 토큰
    return { patientId: await this.verifyToken(token) };
  }

  /** 로그아웃 (세션 무효화) */
  async logout(token: string) {
    await this.prisma.portalSession.updateMany({
      where: { token },
      data: { isActive: false },
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  보호자 위임 (Guardian Proxy Access)
  // ══════════════════════════════════════════════════════════════

  /** patientId → PatientAccount 조회 */
  private async accountByPatient(patientId: string) {
    const acc = await this.prisma.patientAccount.findUnique({ where: { patientId } });
    if (!acc) throw new NotFoundException('환자 계정을 찾을 수 없습니다.');
    return acc;
  }

  /** 내 보호자/피부양자 목록 */
  async getGuardianRelations(patientId: string) {
    const account = await this.accountByPatient(patientId);
    const sel = { id: true, patientId: true, patient: { select: { familyName: true, givenName: true, mrn: true, dateOfBirth: true, gender: true } } };
    const [asGuardian, asDependent] = await Promise.all([
      // 내가 보호자 → 피부양자 목록
      this.prisma.patientGuardian.findMany({
        where: { guardianAccountId: account.id },
        include: { dependent: { select: sel } },
        orderBy: { createdAt: 'desc' },
      }),
      // 내가 피부양자 → 나를 보는 보호자 목록
      this.prisma.patientGuardian.findMany({
        where: { dependentAccountId: account.id },
        include: { guardian: { select: sel } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { asGuardian, asDependent };
  }

  /** 보호자 등록 요청 (피부양자 MRN으로) */
  async requestGuardian(patientId: string, data: { dependentMrn: string; relationship: string; legalBasis: string; documentUrl?: string }) {
    const account = await this.accountByPatient(patientId);
    const dependentPatient = await this.prisma.patient.findUnique({ where: { mrn: data.dependentMrn }, include: { account: true } });
    if (!dependentPatient?.account) throw new NotFoundException('해당 환자번호의 포털 계정을 찾을 수 없습니다.');
    if (dependentPatient.account.id === account.id) throw new BadRequestException('본인은 등록할 수 없습니다.');

    const existing = await this.prisma.patientGuardian.findUnique({
      where: { guardianAccountId_dependentAccountId: { guardianAccountId: account.id, dependentAccountId: dependentPatient.account.id } },
    });
    if (existing) throw new BadRequestException('이미 등록된 보호자 관계입니다.');

    const relation = await this.prisma.patientGuardian.create({
      data: {
        guardianAccountId: account.id,
        dependentAccountId: dependentPatient.account.id,
        relationship: data.relationship,
        legalBasis: data.legalBasis,
        documentUrl: data.documentUrl,
        isApproved: false,
      },
    });
    return { id: relation.id, status: 'PENDING', message: '보호자 등록 요청이 접수되었습니다. 병원 승인 후 이용 가능합니다.' };
  }

  /** 보호자 관계 해제 */
  async removeGuardian(patientId: string, guardianshipId: string) {
    const account = await this.accountByPatient(patientId);
    const relation = await this.prisma.patientGuardian.findUnique({ where: { id: guardianshipId } });
    if (!relation) throw new NotFoundException('보호자 관계를 찾을 수 없습니다.');
    if (relation.guardianAccountId !== account.id && relation.dependentAccountId !== account.id) {
      throw new ForbiddenException('본인의 보호자 관계만 해제할 수 있습니다.');
    }
    await this.prisma.patientGuardian.delete({ where: { id: guardianshipId } });
    return { removed: true };
  }

  /** 피부양자로 전환 → 보호자(위임) JWT 발급 (30분 TTL) */
  async switchToGuardian(patientId: string, guardianshipId: string) {
    const account = await this.accountByPatient(patientId);
    const relation = await this.prisma.patientGuardian.findUnique({
      where: { id: guardianshipId },
      include: { dependent: { select: { id: true, patientId: true, patient: { select: { familyName: true, givenName: true, mrn: true } } } } },
    });
    if (!relation) throw new NotFoundException('보호자 관계를 찾을 수 없습니다.');
    if (relation.guardianAccountId !== account.id) throw new ForbiddenException('보호자 본인만 전환할 수 있습니다.');
    if (!relation.isApproved) throw new ForbiddenException('아직 승인되지 않은 보호자 관계입니다.');
    if (relation.expiresAt && relation.expiresAt < new Date()) throw new ForbiddenException('보호자 위임 기간이 만료되었습니다.');

    // 🔴 기본값 정본 — 키를 여기서 손으로 적으면 `imaging` 처럼 **아무 데서도 만들어지지 않는 키**가 생긴다
    const scope = (relation.accessScope as GuardianScope | null) ?? DEFAULT_GUARDIAN_SCOPE;
    const token = jwt.sign(
      { sub: account.id, pid: patientId, type: 'guardian', targetPid: relation.dependent.patientId, scope, guardianshipId: relation.id },
      this.jwtSecret,
      { expiresIn: '30m' },
    );
    // 피부양자에게 열람 시작 감사 기록
    await this.logAudit(relation.dependent.patientId, 'GUARDIAN_SWITCH', '/portal/guardians/switch', null, `GUARDIAN:${account.id}`);
    const d = relation.dependent.patient;
    return { token, dependent: { patientId: relation.dependent.patientId, name: `${d.familyName}${d.givenName}`, mrn: d.mrn, scope } };
  }

  /** 내 정보에 대한 보호자 열람 이력 (피부양자 본인 확인용) */
  async getGuardianAuditLog(patientId: string) {
    const logs = await this.prisma.portalAuditLog.findMany({
      where: { patientId, detail: { startsWith: 'GUARDIAN:' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return logs.map((l) => ({ action: l.action, endpoint: l.endpoint, accessedAt: l.createdAt, guardianAccountId: l.detail?.replace('GUARDIAN:', '') }));
  }

  /**
   * Break-the-Glass — 응급 긴급 열람 (기획서 §9.3)
   * 승인 전 24시간 임시 MEDICAL 접근(민감정보 제외) 부여 + 관리자 즉시 알림 + 사후 검토
   */
  async breakTheGlass(patientId: string, data: { dependentMrn: string; reason: string }) {
    if (!data.reason || data.reason.trim().length < 5) throw new BadRequestException('긴급 열람 사유를 구체적으로 입력해주세요.');
    const account = await this.accountByPatient(patientId);
    const dependentPatient = await this.prisma.patient.findUnique({ where: { mrn: data.dependentMrn }, include: { account: true } });
    if (!dependentPatient?.account) throw new NotFoundException('해당 환자번호의 포털 계정을 찾을 수 없습니다.');
    if (dependentPatient.account.id === account.id) throw new BadRequestException('본인은 대상이 될 수 없습니다.');

    const btgScope = BTG_GUARDIAN_SCOPE;
    const expiresAt = new Date(Date.now() + 24 * 3600000);

    // 기존 관계가 있으면(미승인) BTG 임시 승인으로 갱신, 없으면 생성. 이미 정식 승인된 관계면 그대로 사용.
    const existing = await this.prisma.patientGuardian.findUnique({
      where: { guardianAccountId_dependentAccountId: { guardianAccountId: account.id, dependentAccountId: dependentPatient.account.id } },
    });
    let relation;
    if (existing?.isApproved) {
      relation = existing;
    } else if (existing) {
      relation = await this.prisma.patientGuardian.update({
        where: { id: existing.id },
        data: { isApproved: true, approvedAt: new Date(), legalBasis: 'BREAK_THE_GLASS', accessScope: btgScope, expiresAt },
      });
    } else {
      relation = await this.prisma.patientGuardian.create({
        data: {
          guardianAccountId: account.id,
          dependentAccountId: dependentPatient.account.id,
          relationship: '긴급(BTG)',
          legalBasis: 'BREAK_THE_GLASS',
          accessScope: btgScope,
          isApproved: true,
          approvedAt: new Date(),
          expiresAt,
        },
      });
    }

    // 관리자 즉시 알림 (사후 서류 검토 요구)
    const guardianName = `${(await this.prisma.patient.findUnique({ where: { id: patientId }, select: { familyName: true, givenName: true } }))?.familyName ?? ''}`;
    const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } }); // 스카우트: take:5 상한·비활성 미필터로 관리자 누락 → 전원
    /**
     * 🔴 통보 실패를 지우지 않는다(2026-08-21).
     *
     *    종전 `.catch(() => undefined)` 는 **실패했다는 사실조차** 남기지 않았고, 화면은
     *    "긴급 열람은 관리자에게 즉시 통보되며…"라고 단언한 채 토큰을 내줬다.
     *    BTG 는 사후 검토가 전제인 열람이다 — 아무도 통보받지 못했다면 **감시 없는 열람**이 된다.
     *    열람 자체를 막지는 않되(막으면 방치된다), 몇 명에게 닿았는지를 감사·응답·화면이 말한다.
     */
    const notifyResults = await Promise.allSettled(admins.map((a) => this.prisma.notification.create({
      data: {
        userId: a.id, type: 'GUARDIAN_BTG', severity: 'CRITICAL',
        title: '⚠️ 보호자 긴급 열람(Break-the-Glass) 발생',
        message: `보호자(${guardianName})가 ${dependentPatient.mrn} 환자 정보에 긴급 열람을 요청했습니다. 사유: ${data.reason} — 24시간 내 서류 확인 필요`,
        refType: 'GUARDIAN', refId: relation.id,
      },
    })));
    const notifiedAdmins = notifyResults.filter((r) => r.status === 'fulfilled').length;
    const notifyFailed = notifyResults.length - notifiedAdmins;
    if (notifiedAdmins === 0) {
      this.logger.error(
        `🔴 BTG 관리자 통보 0건 — 사후 검토자가 없다(관리자 ${admins.length}명·실패 ${notifyFailed}건). guardianship=${relation.id} mrn=${dependentPatient.mrn}`,
      );
    } else if (notifyFailed > 0) {
      this.logger.warn(`BTG 관리자 통보 부분 실패 ${notifyFailed}/${admins.length} — guardianship=${relation.id}`);
    }

    // 감사 기록 (사유 + 통보 도달 수 — '보냈다'가 아니라 '몇 명에게 남았다')
    await this.logAudit(
      dependentPatient.id, 'GUARDIAN_BTG', '/portal/guardians/break-the-glass', null,
      `GUARDIAN:${account.id}|BTG:${data.reason}|NOTIFY:${notifiedAdmins}/${admins.length}`,
    );

    // 즉시 전환 토큰 발급
    const token = jwt.sign(
      { sub: account.id, pid: patientId, type: 'guardian', targetPid: dependentPatient.id, scope: btgScope, guardianshipId: relation.id },
      this.jwtSecret,
      { expiresIn: '24h' },
    );
    return {
      guardianshipId: relation.id, token, expiresAt,
      dependent: { name: `${dependentPatient.familyName}${dependentPatient.givenName}`, mrn: dependentPatient.mrn, scope: btgScope },
      // 화면이 "관리자에게 즉시 통보됩니다"를 사실로 말할 수 있는 근거 — 0이면 그렇게 말하면 안 된다
      oversight: { notifiedAdmins, notifyFailed, adminCount: admins.length },
    };
  }

  /** 감사 로그 기록 */
  async logAudit(patientId: string, action: string, endpoint: string, ipAddress?: string | null, detail?: string) {
    await this.prisma.portalAuditLog.create({
      data: { patientId, action, endpoint, ipAddress: ipAddress ?? null, detail: detail ?? null },
    }).catch(() => {});
  }

  /** 예약 목록 */
  async getAppointments(patientId: string) {
    return this.prisma.appointment.findMany({
      where: { patientId, status: { in: ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN'] } },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true, scheduledAt: true, duration: true, status: true, type: true, reason: true,
        doctor: { select: { familyName: true, givenName: true, department: true } },
      },
    });
  }

  /**
   * 과거 진료 목록.
   * 🔴 (2026-10-20 포털 P3 B2 · 결정 `portal.visitSummaryScope` = GENERAL) 종전엔 의사 소견 원문(assessment·plan)을 그대로 실었다 —
   *    일반 수준 공개로 정해 원문은 싣지 않는다(전체 기록은 사본 발급 신청). 감별·배제 진단도 싣지 않는다.
   */
  async getEncounters(patientId: string, opts?: { hideSensitive?: boolean }) {
    const encounters = await this.prisma.encounter.findMany({
      where: { patientId, status: 'SIGNED' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, createdAt: true,
        doctor: { select: { familyName: true, givenName: true, department: true } },
        diagnoses: { orderBy: { rank: 'asc' }, select: { type: true, certainty: true, diagnosisCode: { select: { code: true, nameKo: true, nameEn: true } } } },
      },
    });
    // 보호자 위임 열람 시 민감 진료과 기록 제외 (정신과/산부인과/비뇨의학과 등)
    const visible = opts?.hideSensitive
      ? encounters.filter((e) => !SENSITIVE_DEPARTMENTS.includes(e.doctor?.department ?? ''))
      : encounters;
    return visible.map((e) => ({ ...e, diagnoses: e.diagnoses.filter(visitSummaryIncludesDiagnosis) }));
  }

  /**
   * 진료 후 요약(AVS) — 서명된 진료 한 건(2026-10-20 포털 P3 B2 · 결정 `portal.visitSummaryScope` = GENERAL).
   *  · 일반 수준: 진단명(감별·배제 제외 · 추정은 추정으로)·처방 약·검사/처치 이름·다음 예약·병원 연락처
   *  · 🔴 의사 소견 원문은 싣지 않는다 · 작성 중(DRAFT)·정정 대기(AMENDED) 기록은 404 — 서명본에서만
   *  · 보호자 위임 열람은 민감 진료과 기록을 404 로(목록과 같은 규칙)
   */
  async getVisitSummary(patientId: string, encounterId: string, opts?: { hideSensitive?: boolean }) {
    const e = await this.prisma.encounter.findFirst({
      where: { id: encounterId, patientId, status: 'SIGNED' },
      select: {
        id: true, createdAt: true, signedAt: true,
        doctor: { select: { familyName: true, givenName: true, department: true } },
        diagnoses: { orderBy: { rank: 'asc' }, select: { type: true, certainty: true, diagnosisCode: { select: { code: true, nameKo: true } } } },
        prescriptions: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: { createdAt: 'asc' },
          select: {
            type: true, status: true, dosage: true, frequency: true, duration: true, route: true, instructions: true, dischargeMed: true,
            medicationCode: { select: { nameKo: true } },
            procedureCode: { select: { nameKo: true } },
          },
        },
      },
    });
    if (!e) throw new NotFoundException('진료 요약을 찾을 수 없습니다.');
    if (opts?.hideSensitive && SENSITIVE_DEPARTMENTS.includes(e.doctor?.department ?? '')) {
      throw new NotFoundException('진료 요약을 찾을 수 없습니다.');
    }
    const [nextAppointment, contact] = await Promise.all([
      this.prisma.appointment.findFirst({
        where: { patientId, status: { in: ['SCHEDULED', 'CONFIRMED'] }, scheduledAt: { gt: new Date() } },
        orderBy: { scheduledAt: 'asc' },
        select: { id: true, scheduledAt: true, doctor: { select: { familyName: true, givenName: true, department: true } } },
      }),
      readHospitalConfig(this.prisma, ['hospital.phone'] as const),
    ]);
    const meds = e.prescriptions.filter((p) => p.type === 'MEDICATION');
    return {
      encounterId: e.id,
      visitedAt: e.createdAt,
      signedAt: e.signedAt,
      department: e.doctor?.department ?? null,
      doctorName: e.doctor ? joinPatientName(e.doctor.familyName, e.doctor.givenName) : null, // 이름 정본(외국 이름 띄어쓰기)
      scope: 'GENERAL' as const,
      diagnoses: e.diagnoses.filter(visitSummaryIncludesDiagnosis).map((d) => ({
        name: d.diagnosisCode?.nameKo ?? null,
        code: d.diagnosisCode?.code ?? null,
        primary: d.type === 'PRIMARY',
        provisional: d.certainty === 'PROVISIONAL',
      })),
      medications: meds.map((p) => ({
        name: p.medicationCode?.nameKo ?? null,
        dosage: p.dosage, frequency: p.frequency, durationDays: p.duration, route: p.route, instructions: p.instructions,
        discontinued: p.status === 'DISCONTINUED',
        dischargeMed: p.dischargeMed,
      })),
      // 검사·처치는 이름만(결과는 검사 결과 화면이 공개 규칙대로 보인다)
      orders: e.prescriptions.filter((p) => p.type !== 'MEDICATION').map((p) => ({ type: p.type, name: p.procedureCode?.nameKo ?? null })),
      nextAppointment: nextAppointment
        ? {
            id: nextAppointment.id, scheduledAt: nextAppointment.scheduledAt,
            department: nextAppointment.doctor?.department ?? null,
            doctorName: nextAppointment.doctor ? joinPatientName(nextAppointment.doctor.familyName, nextAppointment.doctor.givenName) : null,
          }
        : null,
      hospitalPhone: contact['hospital.phone'],
    };
  }

  /** 검사 결과 */
  async getLabResults(patientId: string) {
    // 1. 일반 검사 결과 (LabResult)
    const labResults = await this.prisma.labResult.findMany({
      where: { patientId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      take: 30,
      select: {
        id: true, completedAt: true, notes: true,
        order: { select: { acknowledgedAt: true } }, // 의사 결과 확인 — 판정 공개 시점(결정 portal.labResultRelease)
        items: { select: { testName: true, value: true, unit: true, normalMin: true, normalMax: true, flag: true } },
      },
    });

    // 2. 검진 결과 (CheckupResultItem → LabResult 형태로 변환)
    // 서명 게이트: 검진 요약(summary)에 의사 서명(signedAt)이 있는 검진만 노출 — 검토 전(IN_PROGRESS/EXAM_COMPLETE/REVIEW)
    //  미검토·미교정 원시값이 환자에게 노출되어 불필요한 불안·오해를 유발하던 결함 방지.
    const checkupVisits = await this.prisma.checkupVisit.findMany({
      where: { patientId, summary: { is: { signedAt: { not: null } } } },
      include: {
        program: { select: { name: true } },
        summary: { select: { signedAt: true } },
        items: {
          where: { finding: { not: 'PENDING' } },
          orderBy: { completedAt: 'desc' },
          select: { testName: true, value: true, unit: true, referenceRange: true, finding: true, category: true, completedAt: true },
        },
      },
      orderBy: { scheduledDate: 'desc' },
      take: 5,
    });

    // 위급값 폐루프 게이트: 담당의 미확인(PENDING) CriticalValueAlert 가 있는 위급값은 수치를 가리고 "담당의 확인 중"으로 표기.
    //  근거: 위급값은 담당의 확인 응답까지 받는 폐루프(미확인 시 3단 상향)인데, 환자 모바일 단순표시가 이를 우회해
    //  의료진보다 환자가 먼저 수치를 아는 역전을 유발. 완전 차단은 문의 유발 → 대기상태 표기+수치 마스킹(LIS 권고 채택).
    //  🔴 ESCALATED 도 미확인이다 — PENDING 만 보면 상향 보고된 위급값의 수치 마스킹이 풀린다(CRITICAL_ALERT_OPEN_STATUSES)
    const pendingByLab = await this.openCriticalByLab(labResults.map(lr => lr.id));

    // FE 계약(LabResult { id, orderName, orderedAt, items: { name, value, unit, flag } })에 맞춰 정규화
    const normalizedLabs = labResults.map(lr => {
      const reviewedAt = lr.order?.acknowledgedAt ?? null;
      return {
        id: lr.id,
        orderName: lr.notes ?? '검사 결과',
        orderedAt: lr.completedAt,
        // 🔴 (2026-10-20 B8) 공개 상태 — 의료진 확인 전이면 판정 없이 수치만(화면이 "의료진 확인 전"을 말한다)
        release: labReleaseState(reviewedAt),
        reviewedAt,
        // 🔴 W9(2026-08-14): 위급 flag 정본은 `isCriticalFlag`(HH·LL·AA…) — 종전 'CRITICAL' 비교는 한 번도 발동하지 않았다(lab-critical-mask.spec.ts)
        items: lr.items.map(it => ({ name: it.testName, ...releasedLabItem(it, { reviewed: reviewedAt != null, openCriticalNames: pendingByLab.get(lr.id) }) })),
      };
    });

    const checkupAsLab = checkupVisits
      .filter(v => v.items.length > 0)
      .map(v => ({
        id: `checkup-${v.id}`,
        orderName: `${v.program?.name ?? '건강검진'} 결과`,
        orderedAt: v.items[0]?.completedAt ?? v.checkedInAt,
        // 검진은 의사 종합판정 서명이 곧 의료진 확인이다(서명 전 검진은 위 조회에서 빠진다 — 교정 전 값일 수 있어 종전 그대로)
        release: labReleaseState(v.summary?.signedAt ?? null),
        reviewedAt: v.summary?.signedAt ?? null,
        items: v.items.map(i => ({
          name: i.testName,
          value: i.value ?? '',
          unit: i.unit ?? '',
          // 🔴 W9(2026-08-14): 종전 `ABNORMAL → 'HIGH'`. CheckupResultItem.finding 은 정상/이상만 말할 뿐
          //    **방향(높음/낮음)을 모른다**. 그런데 포털은 그것을 'HIGH'(높음)라고 단정해 보여줬다 —
          //    운영 실측에서 HDL 67·LDL 147 이 나란히 "HIGH" 로 나갔고, 낮아서 이상인 항목(빈혈 Hb 등)도
          //    환자에게 "높음"이라 말하게 된다(P10 이진삼항 단정 + 임상 오정보).
          //    또 'HIGH'/'NORMAL' 은 shared lab-flags 정본 집합(N·H·L·HH·LL·A·AA…)에 없는 토큰이고,
          //    포털 화면은 flag 문자열을 그대로 노출한다 — 환자가 "HIGH" 라는 생값을 읽었다.
          //    방향을 모르면 방향을 말하지 않는다 → 'A'(정성 이상)·'AA'(정성 위급)·'N'(정상).
          flag: i.finding === 'ABNORMAL' ? 'A' : i.finding === 'CRITICAL' ? 'AA' : i.finding === 'NORMAL' ? 'N' : '',
        })),
      }));

    return [...checkupAsLab, ...normalizedLabs];
  }

  /** 담당의가 아직 닫지 않은 위급값 경보 — 결과 id → 검사명 집합(위급값 수치 가림 · 결과 목록·건강 요약·추이 공용) */
  private async openCriticalByLab(labResultIds: string[]): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    if (!labResultIds.length) return out;
    const alerts = await this.prisma.criticalValueAlert.findMany({
      where: { labResultId: { in: [...new Set(labResultIds)] }, status: { in: CRITICAL_ALERT_OPEN_STATUSES } },
      select: { labResultId: true, testName: true },
    });
    for (const a of alerts) {
      if (!out.has(a.labResultId)) out.set(a.labResultId, new Set());
      out.get(a.labResultId)!.add(a.testName);
    }
    return out;
  }

  /** 기초검사 결과 */
  async getDiagnosticTests(patientId: string) {
    const rows = await this.prisma.diagnosticTest.findMany({
      where: { patientId, status: 'COMPLETED' },
      orderBy: { performedAt: 'desc' },
      take: 20,
      select: { id: true, testType: true, testName: true, performedAt: true, conclusion: true, findings: true, reviewStatus: true, reviewedAt: true },
    });
    // 🔴 (2026-10-20 B8 · 결정 portal.labResultRelease) 결론·소견은 판독 검토 승인(APPROVED) 뒤에만 — 종전엔 검토 전 결론이 그대로 보였다.
    //    승인 시각이 비어 있으면 지어내지 않는다(null).
    return rows.map(({ reviewStatus, reviewedAt, ...r }) => {
      const reviewed = reviewStatus === 'APPROVED';
      return {
        ...r,
        conclusion: reviewed ? r.conclusion : null,
        findings: reviewed ? r.findings : null,
        release: reviewed ? 'REVIEWED' as const : 'AWAITING_REVIEW' as const,
        reviewedAt: reviewed ? reviewedAt : null,
      };
    });
  }

  /** 수납 내역 */
  async getBillings(patientId: string, opts?: { hideSensitive?: boolean }) {
    const billings = await this.prisma.billing.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, totalAmount: true, insuranceCovered: true, patientCopay: true, discountAmount: true, status: true, paidAmount: true, paidAt: true, createdAt: true,
        refundAmount: true, // 🔴 (2026-10-19 포털 R1) 부분 환불이 카드에 없어 '납부 17,000원'만 보였다 — 연간 합계(환불 차감)와 어긋나 보인 이유
        encounter: { select: { doctor: { select: { familyName: true, givenName: true, department: true } } } },
      },
    });
    // 보호자 위임 열람 시 민감 진료과 수납 제외
    if (opts?.hideSensitive) {
      return billings.filter((b) => !SENSITIVE_DEPARTMENTS.includes(b.encounter?.doctor?.department ?? ''));
    }
    return billings;
  }

  // ── Phase 1 추가 API ──

  /**
   * 예약 진료 예상 본인부담(2026-10-20 포털 P3 B6 · 결정 `portal.costEstimate` = SHOW_AS_ESTIMATE).
   *  · 다가오는 본인 예약만(SCHEDULED·CONFIRMED) — 남의 예약·지난 예약은 404
   *  · 계산은 수납 정본(BillingService.estimateVisitCopay) — 못 찾으면 503(지어낸 금액을 내지 않는다)
   *  · 응답은 늘 `estimate: true` — 확정 금액이 아니다(화면이 "예측 자료"를 붙인다)
   */
  async getAppointmentCostEstimate(patientId: string, appointmentId: string) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, patientId, status: { in: ['SCHEDULED', 'CONFIRMED'] } },
      select: { id: true, type: true, departmentName: true, doctor: { select: { department: true } } },
    });
    if (!appt) throw new NotFoundException('예약을 찾을 수 없습니다.');
    let billing: BillingService | null = null;
    try { billing = this.moduleRef?.get(BillingService, { strict: false }) ?? null; } catch { billing = null; }
    if (!billing) throw new ServiceUnavailableException({ code: 'COST_ESTIMATE_UNAVAILABLE', message: '진료비 계산을 지금 할 수 없습니다.' });
    const est = await billing.estimateVisitCopay(patientId, { type: appt.type, department: appt.departmentName ?? appt.doctor?.department ?? null }, COST_ESTIMATE_RECENT_SAMPLE);
    return { appointmentId: appt.id, estimate: true as const, ...est };
  }

  /**
   * 예약 진료실까지 길안내(포털 B1 남은 몫 · 2026-10-26) — **접수 전**.
   *  · 접수 뒤에는 대기표 길안내(`/guide/:queueId`)가 정본 — 이 예약의 오늘 대기열이 있으면 그 id 만 돌려준다(경로를 두 번 계산하지 않는다)
   *  · 🔴 예약 원장의 진료실 칸은 운영에서 늘 비어 있다 → 진료실 = 접수와 **같은 규칙**의 진료표 칸(`resolveScheduledRoom`)
   *       = "예정"(접수 때 바뀔 수 있다)이라고 응답이 말한다 · 진료표에 없으면 null(지어내지 않는다)
   *  · 경로 = 대기표와 같은 공개 응답(통제 구역 제외 · 계산 불가면 이유)
   *  · 접수 창구 = 공간 유형 RECEPTION 전부(이름·층) — 🔴 어느 창구인지 고르지 않는다(검진 접수/원무 접수를 짐작하지 않는다)
   *  · 지난 예약·끝난 예약은 404(길안내 대상 아님)
   */
  async getAppointmentRoute(patientId: string, appointmentId: string, from: string | undefined, accessibleOnly: boolean) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, patientId, status: { in: ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN'] } },
      select: { id: true, doctorId: true, scheduledAt: true, departmentName: true, status: true },
    });
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    if (!appt || appt.scheduledAt < todayStart) throw new NotFoundException('예약을 찾을 수 없습니다.');

    // 접수 뒤 — 대기표 길안내가 정본
    const queue = await this.prisma.waitingQueue.findFirst({
      where: { appointmentId: appt.id, createdAt: { gte: todayStart }, status: { in: ['WAITING', 'CALLED', 'IN_CONSULTATION'] } },
      select: { id: true }, orderBy: { createdAt: 'desc' },
    });
    if (queue) return { appointmentId: appt.id, checkedIn: true as const, queueId: queue.id };

    const roomName = await this.waitingQueue.resolveScheduledRoom(appt.doctorId, appt.scheduledAt);
    const receptions = await this.prisma.spaceNode.findMany({
      where: { spaceType: 'RECEPTION', isActive: true },
      select: { name: true, floor: true }, orderBy: [{ floor: 'asc' }, { name: 'asc' }],
    });
    const route = await this.waitingQueue.routeToRoom(roomName, from, accessibleOnly);
    return {
      appointmentId: appt.id,
      checkedIn: false as const,
      scheduledAt: appt.scheduledAt,
      departmentName: appt.departmentName,
      // 진료표 기준 예정 진료실 — 접수 때 바뀔 수 있다(basis 로 밝힌다)
      room: roomName ? { name: roomName, basis: 'CLINIC_SCHEDULE' as const } : null,
      receptions,
      route,
    };
  }

  /** 예약 변경 (날짜/시간) — 충돌·근무/휴진/정원 검증 포함(ScheduleService 위임·CONFIRMED도 대상) */
  async rescheduleAppointment(patientId: string, appointmentId: string, newDate: string) {
    return this.schedule.rescheduleByPatient(appointmentId, patientId, newDate);
  }

  /** 예약 취소 — 대기자 자동안내·알림 이벤트 포함(ScheduleService 위임·CONFIRMED도 대상) */
  async cancelAppointment(patientId: string, appointmentId: string, reason?: string) {
    return this.schedule.cancelByPatient(appointmentId, patientId, reason);
  }

  /** 포털 셀프예약 — 가용 슬롯 조회(§G5) */
  async getAppointmentAvailability(query: { departmentName?: string; doctorId?: string; date: string; duration?: number }) {
    if ((await this.configRuntime.get('portal.selfBooking')) !== true) {
      throw new UnauthorizedException('포털 셀프 예약이 활성화되지 않았습니다.');
    }
    /**
     * 🔴 컨트롤러가 `@Query('date')` 로 **개별 인자**를 받아 `AvailabilityQueryDto` 의
     *    `@IsDateString()` 검증이 통째로 건너뛰어진다(§규약 8 — 인라인 파라미터는 ValidationPipe 스킵).
     *    그래서 `date` 없이 부르면 위임된 서비스의 `date.split(...)` 에서 터져 **500** 이 났다
     *    (운영 실측). 위임하기 전에 여기서 400 으로 말한다.
     */
    requireDateParam(query.date, '조회할 날짜');
    const res = await this.schedule.getAvailability(query as AvailabilityQueryDto);
    // 🔴 (2026-09-15) 종일 세션+반일 휴진(`closureReview`)은 휴진한 반나절이 어느 쪽인지 시간표가 말하지 않는다.
    //    직원은 검증 경고를 보고 판단하지만 환자 셀프 예약은 그걸 확인할 사람이 없다 — 슬롯을 내놓지 않고 세션에 사유를 남긴다(모르면 안전측).
    return {
      ...res,
      data: {
        ...res.data,
        sessions: res.data.sessions.map((s) =>
          s.closureReview ? { ...s, slots: s.slots.map((sl) => ({ ...sl, available: false })) } : s,
        ),
      },
    };
  }

  /** 포털 셀프 신규예약 — 본인 patientId 고정·가용성 서버 재검증·신청(SCHEDULED·병원 확정 대기) */
  async createAppointment(patientId: string, dto: { departmentName?: string; doctorId?: string; scheduledAt: string; duration?: number; type?: string; reason?: string }) {
    if ((await this.configRuntime.get('portal.selfBooking')) !== true) {
      throw new UnauthorizedException('포털 셀프 예약이 활성화되지 않았습니다.');
    }
    return this.schedule.create(
      {
        patientId,
        departmentName: dto.departmentName,
        doctorId: dto.doctorId,
        scheduledAt: dto.scheduledAt,
        duration: dto.duration,
        type: dto.type as AppointmentType | undefined,
        reason: dto.reason,
        bookedVia: 'PORTAL',
      } as CreateAppointmentDto,
      null, // 포털 셀프예약은 스태프 생성자 없음
    );
  }

  /** 포털 대기자 등록(§G6) — 만석 시 본인 대기 등록 */
  async registerAppointmentWaitlist(patientId: string, dto: { departmentName: string; doctorId?: string; preferredFrom?: string; preferredTo?: string; note?: string }) {
    if ((await this.configRuntime.get('portal.selfBooking')) !== true) {
      throw new UnauthorizedException('포털 셀프 예약이 활성화되지 않았습니다.');
    }
    return this.schedule.registerWaitlist({ patientId, ...dto }, null);
  }

  /** 대기 현황 */
  async getWaitingStatus(patientId: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const queues = await this.prisma.waitingQueue.findMany({
      where: { patientId, createdAt: { gte: today }, status: { in: ['WAITING', 'CALLED'] } },
      select: {
        id: true, queueNumber: true, departmentName: true, status: true, createdAt: true,
        roomName: true, // (2026-10-19 포털 B1) 길안내 버튼 — 진료실이 정해졌을 때만 보인다
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = [];
    for (const q of queues) {
      const ahead = await this.prisma.waitingQueue.count({
        where: {
          departmentName: q.departmentName,
          status: 'WAITING',
          createdAt: { gte: today },
          queueNumber: { lt: q.queueNumber },
        },
      });
      // 🔴 `ahead * 8` — 환자에게 보여주는 예상 대기를 **상수 8분/명으로 날조**하던 것(P15).
      //    화면 실사용 점검 W8(2026-08-14). 측정한 적 없는 값이고, 관측된 사실처럼 읽힌다.
      //    같은 날 전광판·접수 화면의 상수 15분 폴백도 같은 이유로 걷어냈다.
      //    실측 근거: 외래 완료 462건 중 진료 시작 시각이 있는 것은 13건뿐이라
      //    이 병원의 회전율을 뒷받침할 표본이 사실상 없다 — 모르면 null 이다.
      //    (앞 대기 인원 `aheadCount` 는 실제로 센 값이므로 그대로 낸다.)
      result.push({ ...q, aheadCount: ahead, estimatedMinutes: null });
    }
    return result;
  }

  // ── Phase 3 ──

  /** 예방접종 이력 */
  async getVaccinations(patientId: string) {
    return this.prisma.vaccination.findMany({
      where: { patientId },
      orderBy: { administeredAt: 'desc' },
      select: {
        id: true,
        vaccineName: true,
        vaccineCode: true,
        doseNumber: true,
        administeredAt: true,
        nextDueAt: true,
        administeredBy: true,
        location: true,
        lotNumber: true,
        notes: true,
      },
    });
  }

  /** 건강 메모 */
  async getHealthMemos(patientId: string) {
    return this.prisma.healthMemo.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }
  async createHealthMemo(patientId: string, data: { category?: string; content: string }) {
    return this.prisma.healthMemo.create({ data: { patientId, category: data.category ?? 'GENERAL', content: data.content } });
  }
  async deleteHealthMemo(patientId: string, id: string) {
    const memo = await this.prisma.healthMemo.findUnique({ where: { id } });
    if (!memo || memo.patientId !== patientId) throw new NotFoundException('메모를 찾을 수 없습니다.');
    return this.prisma.healthMemo.delete({ where: { id } });
  }

  /** 만족도 평가 */
  async getSatisfactionSurveys(patientId: string) {
    return this.prisma.satisfactionSurvey.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' }, take: 20 });
  }
  async submitSatisfaction(patientId: string, data: { encounterId?: string; overallRating: number; waitRating?: number; staffRating?: number; facilityRating?: number; comment?: string }) {
    return this.prisma.satisfactionSurvey.create({ data: { patientId, ...data } });
  }

  /** 수술 전 체크리스트 (환자용) */
  async getPatientSurgeryChecklists(patientId: string) {
    return this.prisma.surgery.findMany({
      where: { patientId, status: 'SCHEDULED' },
      select: { id: true, procedureName: true, scheduledAt: true, status: true },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  /** 실비보험 청구서류 안내 (정적) */
  getInsuranceClaimGuide() {
    return {
      title: '실비보험 청구 안내',
      steps: [
        { step: 1, title: '서류 준비', description: '진료비 영수증, 진료비 세부내역서, 진단서 (필요 시)' },
        { step: 2, title: '서류 발급', description: '포털 > 서류 탭에서 온라인 신청 또는 원무과 방문' },
        { step: 3, title: '보험사 제출', description: '보험사 앱/팩스/방문 제출 (보험사별 상이)' },
        { step: 4, title: '보험금 수령', description: '심사 후 3-7 영업일 내 입금' },
      ],
      requiredDocuments: [
        { name: '진료비 영수증', where: '자동 발급 (포털 진료비 탭)' },
        { name: '진료비 세부내역서', where: '서류 신청 (포털 서류 탭)' },
        { name: '진단서', where: '서류 신청 (의사 확인 필요)', note: '입원/수술 시 필수' },
        { name: '통원확인서', where: '서류 신청', note: '통원 치료 시' },
      ],
      tips: [
        '발급일로부터 90일 이내 제출 권장',
        '보험사별 필요 서류가 다를 수 있으니 사전 확인',
        '실손보험금은 실제 본인 부담금 한도 내 지급',
      ],
    };
  }

  /** 담당의 메시지 목록 */
  async getMessages(patientId: string) {
    return this.prisma.patientMessage.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { doctor: { select: { id: true, familyName: true, givenName: true, department: true } } },
    });
  }

  /** 담당의에게 메시지 보내기 */
  async sendMessage(patientId: string, content: string, doctorId?: string) {
    // doctorId가 없으면 최근 진료 의사를 찾음
    let targetDoctorId = doctorId;
    if (!targetDoctorId) {
      const lastEncounter = await this.prisma.encounter.findFirst({
        where: { patientId }, orderBy: { createdAt: 'desc' }, select: { doctorId: true },
      });
      targetDoctorId = lastEncounter?.doctorId ?? undefined;
    }
    const created = await this.prisma.patientMessage.create({
      data: { patientId, doctorId: targetDoctorId, sender: 'PATIENT', content },
    });
    this.announcePatientMessage(created);
    return created;
  }

  /**
   * 🔴 (2026-09-14) 환자 메시지를 쓰기만 하고 아무에게도 알리지 않았다 — 직원 측 조회 EP·화면도 0 이었다.
   *    직원 측(`patient-message` 모듈)이 지정 의사 알림·여정 이벤트를 붙인다. 발행 실패가 환자 전송을 막지 않는다.
   */
  private announcePatientMessage(m: { id: string; patientId: string; doctorId: string | null }) {
    try {
      this.events?.emit('patient.message_sent', { patientId: m.patientId, messageId: m.id, doctorId: m.doctorId });
    } catch (e) {
      this.logger.warn(`patient.message_sent emit failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * 미수납 목록.
   * 🔴 (2026-10-14 P4-1) 종전엔 보류(DEFERRED)를 빼고 감면을 싣지 않아 앱이 `총진료비 − 납부`(공단 부담 포함)를 미수로 그렸다.
   *    정본 집합(UNPAID_STATUS) · 감면 포함 · 남은 금액 `outstanding`(shared billingOutstanding)을 서버가 싣는다.
   */
  async getUnpaidBillings(patientId: string) {
    const rows = await this.prisma.billing.findMany({
      where: { patientId, status: { in: UNPAID_STATUS } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, totalAmount: true, insuranceCovered: true, patientCopay: true, discountAmount: true, paidAmount: true, status: true, createdAt: true },
    });
    return rows.map((b) => ({ ...b, outstanding: billingOutstanding(b) })).filter((b) => (b.outstanding ?? 0) > 0);
  }

  /** 내 동의서 목록 */
  async getPatientConsents(patientId: string) {
    return this.prisma.consentForm.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, templateName: true, consentType: true, status: true, createdAt: true, signedAt: true, risks: true, alternatives: true },
    });
  }

  /** 동의서 전자 서명 (환자 본인 확인) — ConsentService를 통해 이벤트 발행 */
  async signConsent(patientId: string, consentId: string, signature: string) {
    const consent = await this.prisma.consentForm.findUnique({ where: { id: consentId } });
    if (!consent) throw new NotFoundException('동의서를 찾을 수 없습니다.');
    if (consent.patientId !== patientId) throw new NotFoundException('본인의 동의서가 아닙니다.');
    if (consent.status === 'SIGNED') return consent;

    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { familyName: true, givenName: true } });
    const patientName = patient ? `${patient.familyName}${patient.givenName}` : patientId;

    // 서명 요구사항 확인
    const SIGN_REQ: Record<string, string[]> = {
      SURGERY: ['PATIENT', 'DOCTOR', 'WITNESS'], ANESTHESIA: ['PATIENT', 'DOCTOR'],
      PROCEDURE: ['PATIENT', 'DOCTOR'], TRANSFUSION: ['PATIENT', 'NURSE'],
      RESEARCH: ['PATIENT', 'DOCTOR', 'WITNESS'], DNR: ['PATIENT', 'DOCTOR', 'WITNESS'],
      TREATMENT: ['PATIENT'], GENERAL: ['PATIENT'],
    };
    const reqSigners = SIGN_REQ[consent.consentType ?? 'GENERAL'] ?? ['PATIENT'];
    const needsMore = reqSigners.length > 1;

    /**
     * 🔴 (2026-09-16 K1) 같은 행에 서명 기록과 완료 처리를 **두 번 나눠 썼다** — 두 번째가 실패하면
     *    환자 서명은 남고 동의서는 PENDING 으로 굳는다(단독 서명 서식인데 법정 서식이 미완료로 남는다).
     *    한 번의 서명은 한 번의 쓰기다.
     */
    const signedAt = new Date();
    const result = await this.prisma.consentForm.update({
      where: { id: consentId },
      data: {
        patientSignature: signature, patientSignedAt: signedAt, patientSignedBy: patientName,
        ...(needsMore ? {} : { signedBy: patientName, signedAt, status: 'SIGNED', isValid: true }),
      },
    });

    // 여정 이벤트 — 정본 발행기 경유(2026-10-01 여정 P0-6·P0-7: 종전 직접 쓰기 + `.catch(() => {})` 로 실패를 삼켰다)
    this.journey?.emit({ patientId, eventType: 'CONSENT_SIGNED', refType: 'ConsentForm', refId: consent.id, title: '동의서 서명', description: `${consent.templateName} 동의서 서명 완료`, severity: 'INFO' });

    // 🔴 W9(2026-08-14): 종전 이 자리에는 "EventEmitter를 통해 의사에게 알림 발행" 이라는 **주석만** 있고
    //    발행 코드가 없었다(P14 주석 조건 미구현). 즉 환자가 포털에서 수술·마취·DNR 동의서에 서명해도
    //    담당의는 아무 통지를 받지 못했고, 다음 서명자(의사·입회인)를 기다리는 동의서는
    //    누구도 모르는 채 PENDING 으로 남는다. refId 는 @db.Uuid 계약이라 consent.id(uuid)만 넣는다.
    if (consent.doctorId) {
      this.prisma.notification.create({
        data: {
          userId: consent.doctorId,
          type: 'CONSENT_SIGNED',
          severity: needsMore ? 'WARNING' : 'INFO',
          title: needsMore ? '동의서 환자 서명 완료 — 의료진 서명 필요' : '동의서 환자 서명 완료',
          message: `${patientName} 환자가 '${consent.templateName}' 에 서명했습니다.${needsMore ? ` 남은 서명: ${reqSigners.filter((r) => r !== 'PATIENT').join('·')}` : ''}`,
          refType: 'CONSENT',
          refId: consent.id,
        },
      }).catch(() => {});
    }

    return result;
  }

  /** 내 알레르기 목록 */
  /** 알레르기 문진 상태(NKA 안전) — 포털에서 "미문진"과 "무알레르기 확인" 구별 */
  async getAllergyStatus(patientId: string) {
    return this.allergyService.getStatus(patientId);
  }

  async getAllergies(patientId: string) {
    // 🔴 select 가 없어 Allergy 전 컬럼이 나갔다 — `notes`(임상 자유기재)·`recordedBy`(직원 UUID) 포함.
    //    화면은 allergen·reaction·severity 만 쓴다(web `_health/HealthTab`·mobile `health`).
    return this.prisma.allergy.findMany({
      where: { patientId, isActive: true },
      omit: PATIENT_FACING_OMIT.allergy,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 내 문진표 목록 */
  async getQuestionnaires(patientId: string) {
    return this.prisma.questionnaireToken.findMany({
      where: { patientId },
      include: { formSchema: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 환자 MRN 조회 (PACS 프록시용) */
  async getPatientMrn(patientId: string): Promise<string> {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { mrn: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다.');
    return patient.mrn;
  }

  /** 내 정보 조회 */
  async getProfile(patientId: string) {
    return this.prisma.patient.findUnique({
      where: { id: patientId },
      select: {
        id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true,
        gender: true, phone: true, email: true, address: true, insuranceType: true,
      },
    });
  }

  /** 내 정보 변경 (연락처/주소) */
  async updateProfile(patientId: string, data: { phone?: string; email?: string; address?: string; occupation?: string; maritalStatus?: string; religion?: string; preferredLanguage?: string }) {
    // 의료법상 환자 자가입력 금지 대상(성명/생년월일/성별/보험/진료기록)은 제외.
    // 행정·인구학 정보는 포털 자가수정 허용.
    const allowed: Record<string, string | undefined> = {};
    if (data.phone !== undefined) allowed.phone = data.phone?.slice(0, 20); // 컬럼 VarChar(20) — DTO MaxLength(20) 가 먼저 막는다(종전 30 은 21~30자 500)
    if (data.email !== undefined) allowed.email = data.email?.slice(0, 200);
    if (data.address !== undefined) allowed.address = data.address?.slice(0, 500);
    if (data.occupation !== undefined) allowed.occupation = data.occupation?.slice(0, 100);
    if (data.maritalStatus !== undefined) allowed.maritalStatus = data.maritalStatus?.slice(0, 20);
    if (data.religion !== undefined) allowed.religion = data.religion?.slice(0, 50);
    if (data.preferredLanguage !== undefined) allowed.preferredLanguage = data.preferredLanguage?.slice(0, 10);
    return this.prisma.patient.update({
      where: { id: patientId },
      data: allowed,
      select: { id: true, phone: true, email: true, address: true, occupation: true, maritalStatus: true, religion: true, preferredLanguage: true },
    });
  }

  /** 검사 결과 트렌드 (주요 항목 추이) */
  async getLabTrends(patientId: string, testNames?: string[]) {
    const defaultTests = ['혈당', '혈색소(Hb)', '총콜레스테롤', '중성지방', 'HDL', 'LDL', 'AST', 'ALT', '크레아티닌', 'HbA1c'];
    const targetTests = testNames?.length ? testNames : defaultTests;

    // 🔴 W9(2026-08-14): 종전 이 쿼리에는 **orderBy 도, 날짜도 없었다**.
    //    화면(검사 추이 카드)은 배열의 마지막 원소를 "최근값"으로 삼아 ↑/↓ 화살표를 그리는데,
    //    정렬 없는 Prisma/Postgres 반환 순서는 보장되지 않는다 — 즉 "AST 22 ↓" 가 실은
    //    1년 전 값일 수 있고, VACUUM/UPDATE 후 조용히 뒤집힌다(추이의 방향을 뒤집는 건 임상 오정보).
    //    또 `take: 200` 이 전 항목 합산이라 정렬 없이는 **최신 결과가 잘려나갈 수** 있었다.
    //    시각(completedAt)을 함께 내려 화면이 시간축을 가질 수 있게 한다.
    const results = await this.prisma.labResultItem.findMany({
      where: {
        testName: { in: targetTests },
        labResult: { patientId, status: 'COMPLETED' },
      },
      select: {
        testName: true, value: true, unit: true, flag: true,
        labResult: { select: { id: true, completedAt: true, order: { select: { acknowledgedAt: true } } } },
      },
      orderBy: { labResult: { completedAt: 'asc' } },
      take: 200,
    });
    const openCritical = await this.openCriticalByLab(results.map((r) => r.labResult.id));

    // 검사항목별 그룹핑 (완료 시각 오름차순 — 마지막 원소가 최신) · 공개 규칙은 결과 목록과 같다(releasedLabItem)
    const grouped = new Map<string, { value: string; unit: string; flag: string | null; measuredAt: Date | null; judgmentPending?: true; pendingReview?: true }[]>();
    for (const r of results) {
      if (!grouped.has(r.testName)) grouped.set(r.testName, []);
      const rel = releasedLabItem(r, { reviewed: r.labResult.order?.acknowledgedAt != null, openCriticalNames: openCritical.get(r.labResult.id) });
      grouped.get(r.testName)!.push({ value: rel.value, unit: rel.unit, flag: rel.flag || null, measuredAt: r.labResult?.completedAt ?? null, judgmentPending: rel.judgmentPending, pendingReview: rel.pendingReview });
    }

    return Array.from(grouped.entries()).map(([name, data]) => ({ testName: name, data }));
  }

  /** 연말정산 의료비 내역 (연도별) */
  async getMedicalExpenses(patientId: string, year: number) {
    // KST 경계 명시 — date-only 는 UTC 자정으로 파싱돼 1/1 오전 0~9시(KST) 결제분이
    // 연말정산에서 누락됐다(세무 자료). +09:00 으로 KST 연 경계 고정. (2026-07 타임존 전수)
    const startDate = new Date(`${year}-01-01T00:00:00+09:00`);
    const endDate = new Date(`${year + 1}-01-01T00:00:00+09:00`);

    // 🔴 (2026-10-14 수납·청구 결함 발굴 P2-5) 종전엔 완납(PAID) 청구만, 완납일에, 납부액 그대로 셌다 —
    //    부분 납부·분납 회차는 빠지고, 부분 환불은 빼지 않았다(세무 자료). 정본 `paymentEvents` 로 돈이 오간 날에 센다.
    const { events, billings } = await this.paymentEvents(patientId, startDate, endDate);
    const total = billings.reduce((s, b) => ({
      totalAmount: s.totalAmount + (b.totalAmount ?? 0),
      insuranceCovered: s.insuranceCovered + (b.insuranceCovered ?? 0),
      copay: s.copay + (b.patientCopay ?? 0),
      paid: s.paid,
    }), { totalAmount: 0, insuranceCovered: 0, copay: 0, paid: events.reduce((t, e) => t + e.amount, 0) });

    const monthly = Array.from({ length: 12 }, (_, i) => {
      const m = events.filter((e) => e.at.getMonth() === i);
      return { month: i + 1, count: new Set(m.map((e) => e.billingId)).size, paid: m.reduce((t, e) => t + e.amount, 0) };
    }).filter(m => m.count > 0);

    return { year, summary: total, visitCount: billings.length, monthly };
  }

  /** 정본 `billing/payment-events.ts paymentEventsInRange` — 원무 납입확인서와 같은 함수(P4-5) */
  private paymentEvents(patientId: string, start: Date, end: Date) {
    return paymentEventsInRange(this.prisma, patientId, start, end);
  }

  /** 현재 복용약 목록 (최근 처방에서 추출) */
  async getCurrentMedications(patientId: string) {
    const since = new Date(); since.setDate(since.getDate() - 30);
    const prescriptions = await this.prisma.prescription.findMany({
      where: {
        encounter: { patientId },
        type: 'MEDICATION',
        status: 'ACTIVE',
        createdAt: { gte: since },
      },
      select: {
        id: true, medicationCodeId: true, // F-7: 약 단위 explain 진입 키(설계 §0 — 비파괴·필드 추가만)
        dosage: true, frequency: true, duration: true, route: true, createdAt: true,
        medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, code: true } },
        encounter: { select: { doctor: { select: { familyName: true, givenName: true, department: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const seen = new Set<string>();
    return prescriptions
      .filter(p => {
        const name = p.medicationCode?.nameKo ?? p.medicationCode?.code ?? '';
        if (!name || seen.has(name)) return false; // 명칭 dedup 유지 — 대표 행(최신 처방)의 id가 노출됨
        seen.add(name);
        return true;
      })
      .map(p => ({
        id: p.id,
        medicationCodeId: p.medicationCodeId,
        name: p.medicationCode?.nameKo ?? p.medicationCode?.nameEn ?? '',
        code: p.medicationCode?.code ?? '',
        dosage: p.dosage, frequency: p.frequency, duration: p.duration, route: p.route,
        prescribedAt: p.createdAt,
        doctor: p.encounter?.doctor ? `${p.encounter.doctor.familyName}${p.encounter.doctor.givenName}` : null,
        department: p.encounter?.doctor?.department ?? null,
      }));
  }

  /** 병원 공지사항 */
  async getNotices() {
    // SystemConfig에서 공지사항 조회 또는 기본 안내
    const configs = await this.prisma.systemConfig.findMany({
      where: { category: 'notice', value: { not: { equals: null as any } } },
      select: { key: true, value: true, label: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });

    if (configs.length > 0) {
      return configs.map(c => ({
        id: c.key,
        title: c.label,
        content: typeof c.value === 'string' ? c.value : JSON.stringify(c.value),
        date: c.updatedAt.toISOString(),
      }));
    }

    // 기본 공지
    // 🔴 진료시간은 정본 `hospital.hours.*`·`hospital.emergency`(DB 행만)에서 — 종전엔 '평일 09:00~18:00 …' 상수를
    //    병원 사실로 환자에게 공지했다(CMS 정본 평일 ~17:30 과 어긋남 · P15). 하나도 설정돼 있지 않으면 이 공지는 싣지 않는다
    //    (시간을 지어내지 않는다). 조회 실패는 전파한다.
    const hours = hospitalHoursLines(await readHospitalFacts(this.prisma));
    return [
      ...(hours.length ? [{ id: 'default-1', title: '진료 시간 안내', content: hours.join(' / '), date: new Date().toISOString() }] : []),
      // 🔴 (2026-09-14) 주차 320대·한우리식당·메디치노·빈소 5실·장례식장 `02-1234-5670` 기본 공지 4건을 지웠다 — 근거 없는 상수를
      //    병원 사실로 환자에게 공지하던 자리(P15 · 같은 상수를 A3 에서 예약 챗·시설 안내 화면에서도 걷었다).
      //    시설 안내는 병원 정보 CMS(`HospitalInfoContent`)가 정본이다.
    ];
  }

  /** 영수증 데이터 (PDF용) */
  async getReceipt(patientId: string, billingId: string) {
    const billing = await this.prisma.billing.findFirst({
      where: { id: billingId, patientId },
      include: {
        encounter: {
          select: {
            createdAt: true,
            doctor: { select: { familyName: true, givenName: true, department: true } },
            diagnoses: { select: { diagnosisCode: { select: { code: true, nameKo: true, nameEn: true } } } },
          },
        },
      },
    });
    if (!billing) throw new NotFoundException('수납 내역을 찾을 수 없습니다.');

    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { familyName: true, givenName: true, mrn: true, dateOfBirth: true, insuranceType: true },
    });

    // 🔴 기관명은 정본(DB 행만) — 종전엔 미설정·비문자 값이면 'Hospital RUN' 을 영수증에 찍었다(날조).
    //    환자가 받는 문서라 미설정은 **미설정이라고** 찍는다(화면이 문자열을 그대로 보간한다 — null 이면 "null" 이 찍힌다).
    const { 'hospital.name': hospitalName } = await readHospitalConfig(this.prisma, ['hospital.name'] as const);

    return {
      hospitalName: hospitalName ?? HOSPITAL_UNSET_KO['hospital.name'],
      receiptNo: `R-${billing.id.slice(0, 8).toUpperCase()}`,
      issuedAt: new Date().toISOString(),
      patient: { name: `${patient?.familyName}${patient?.givenName}`, mrn: patient?.mrn, dob: patient?.dateOfBirth, insurance: patient?.insuranceType },
      billing: {
        date: billing.createdAt.toISOString(),
        totalAmount: billing.totalAmount,
        insuranceCovered: billing.insuranceCovered,
        patientCopay: billing.patientCopay,
        paidAmount: billing.paidAmount,
        status: billing.status,
      },
      encounter: billing.encounter ? {
        date: billing.encounter.createdAt.toISOString(),
        doctor: `${billing.encounter.doctor.familyName}${billing.encounter.doctor.givenName}`,
        department: billing.encounter.doctor.department,
        diagnoses: billing.encounter.diagnoses.map((d) => `${d.diagnosisCode.nameKo} (${d.diagnosisCode.code})`),
      } : null,
    };
  }

  // ── Portal v2 Phase 1: Health Dashboard ──

  /**
   * 환자에게 "복용약"으로 보여줄 수 있는 처방만 — 🔴 W9(2026-08-14).
   *
   * Prescription 은 약·검사·영상 오더를 **한 테이블에 담는다**(type = MEDICATION|LAB|IMAGING…).
   * 포털의 복약 관련 조회 5곳이 type 을 걸지 않아, 환자 P2026-0006 의 화면에는
   * **LAB 8건 + IMAGING 1건**이 "활성 처방 9건"·"오늘 복용 일정 ☀️아침 식후 ×9"로 떴다.
   * medicationCodeId 가 없으니 이름은 전부 null(빈 체크박스 9개)이고, 그중 하나는
   * 2025-03-27 자 오더였다. 같은 앱의 `/portal/medications`(type 필터 있음)는 같은 순간 0건 —
   * 한 환자가 같은 앱에서 "복용약 9종"과 "복용약 없음"을 동시에 본다(P12 정본이 둘).
   * 복약 체크·복약 리마인더도 이 목록을 쓴다 = 검사 오더에 "복용함"을 기록하게 된다.
   */
  private static readonly MEDICATION_RX_WHERE = { status: 'ACTIVE', type: 'MEDICATION' } as const;

  /** 건강 대시보드 — 바이탈/처방/문제목록/다음예약/알레르기/최근검사 */
  async getHealthDashboard(patientId: string) {
    const [vitals, activeRx, problems, nextAppt, allergies, recentLabs] = await Promise.all([
      this.prisma.preVisitVitals.findFirst({
        where: { patientId },
        orderBy: { measuredAt: 'desc' },
      }),
      this.prisma.prescription.findMany({
        where: { ...PortalService.MEDICATION_RX_WHERE, encounter: { patientId } },
        include: { medicationCode: { select: { nameKo: true } } },
        take: 10,
      }),
      this.prisma.problemList.findMany({
        where: { patientId, status: 'ACTIVE' },
        include: { diagnosisCode: { select: { code: true, nameKo: true, nameEn: true } } },
        take: 5,
      }),
      this.prisma.appointment.findFirst({
        where: { patientId, status: 'SCHEDULED', scheduledAt: { gte: new Date() } },
        orderBy: { scheduledAt: 'asc' },
        select: {
          id: true, scheduledAt: true, type: true, reason: true,
          doctor: { select: { familyName: true, givenName: true, department: true } },
        },
      }),
      this.prisma.allergy.findMany({
        where: { patientId, isActive: true },
        omit: PATIENT_FACING_OMIT.allergy, // 내원 전 안내 카드 — 직원 메모·기록자 UUID 는 환자 몫이 아니다
        take: 5,
      }),
      this.prisma.labResult.findMany({
        where: { patientId, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          completedAt: true,
          order: { select: { acknowledgedAt: true } },
          items: {
            select: { testName: true, value: true, unit: true, normalMin: true, normalMax: true, flag: true },
          },
        },
      }),
    ]);
    const openCritical = await this.openCriticalByLab(recentLabs.map((l) => l.id));

    return {
      vitals,
      activeRx: activeRx.map(rx => ({
        id: rx.id,
        name: rx.medicationCode?.nameKo || rx.medicationCodeId,
        dosage: rx.dosage,
        frequency: rx.frequency,
        route: rx.route,
      })),
      problems: problems.map(p => ({
        id: p.id,
        description: p.description,
        status: p.status,
        severity: p.severity,
        onsetDate: p.onsetDate,
        diagnosis: p.diagnosisCode ? `${p.diagnosisCode.nameKo} (${p.diagnosisCode.code})` : null,
      })),
      nextAppointment: nextAppt,
      allergies,
      // 🔴 (2026-10-20 B8) 결과 목록과 같은 공개 규칙 — 종전엔 위급값·확인 전 판정이 여기서 그대로 나갔다
      recentLabs: recentLabs.map(lab => ({
        id: lab.id,
        completedAt: lab.completedAt,
        release: labReleaseState(lab.order?.acknowledgedAt ?? null),
        reviewedAt: lab.order?.acknowledgedAt ?? null,
        items: lab.items.map(item => {
          const rel = releasedLabItem(item, { reviewed: lab.order?.acknowledgedAt != null, openCriticalNames: openCritical.get(lab.id) });
          return {
            testName: item.testName,
            value: rel.value,
            unit: rel.unit,
            referenceRange: item.normalMin != null && item.normalMax != null
              ? `${item.normalMin}–${item.normalMax}` : null,
            flag: rel.flag || null,
            judgmentPending: rel.judgmentPending,
            pendingReview: rel.pendingReview,
          };
        }),
      })),
    };
  }

  // ── Portal v2 Phase 2: Medication Schedule + Check ──

  /** 오늘의 복약 스케줄 — checks(슬롯별 오늘 체크 상태) 동봉(F-2). 기존 flat 형태 유지(모바일 호환) */
  async getMedicationSchedule(patientId: string) {
    const today = todayDateOnly(); // 🔴 slotDate 는 @db.Date — 로컬 자정은 하루 밀린다(정본)
    const [rxList, logs] = await Promise.all([
      this.prisma.prescription.findMany({
        where: { ...PortalService.MEDICATION_RX_WHERE, encounter: { patientId } },
        include: { medicationCode: { select: { nameKo: true, nameEn: true } } },
      }),
      this.prisma.medicationCheckLog.findMany({
        where: { patientId, slotDate: today },
        select: { prescriptionId: true, slot: true, taken: true },
      }),
    ]);

    return rxList.map(rx => ({
      id: rx.id,
      name: rx.medicationCode?.nameKo || rx.medicationCodeId,
      dosage: rx.dosage,
      frequency: rx.frequency,
      route: rx.route,
      slots: parseFrequencySlots(rx.frequency),
      checks: Object.fromEntries(logs.filter(l => l.prescriptionId === rx.id).map(l => [l.slot, l.taken])),
    }));
  }

  /** 복약 체크 (복용 완료 기록) — MedicationCheckLog upsert(F-2) + 기존 감사 로그 유지 */
  async checkMedication(patientId: string, dto: { prescriptionId: string; slot: string; taken: boolean }) {
    // 처방이 해당 환자의 것인지 확인
    const rx = await this.prisma.prescription.findFirst({
      where: { id: dto.prescriptionId, ...PortalService.MEDICATION_RX_WHERE, encounter: { patientId } },
    });
    if (!rx) throw new NotFoundException('처방을 찾을 수 없습니다.');

    const today = todayDateOnly(); // 🔴 slotDate 는 @db.Date — 로컬 자정은 하루 밀린다(정본)
    const now = new Date();
    await this.prisma.medicationCheckLog.upsert({
      where: { prescriptionId_slotDate_slot: { prescriptionId: dto.prescriptionId, slotDate: today, slot: dto.slot } },
      create: { patientId, prescriptionId: dto.prescriptionId, slotDate: today, slot: dto.slot, taken: dto.taken, checkedAt: now },
      update: { taken: dto.taken, checkedAt: now },
    });

    // 포털 감사 로그에 복약 체크 기록
    await this.logAudit(
      patientId,
      'MEDICATION_CHECK',
      '/api/v1/portal/medication-check',
      null,
      JSON.stringify({ prescriptionId: dto.prescriptionId, slot: dto.slot, taken: dto.taken, checkedAt: now.toISOString() }),
    );

    return {
      success: true,
      prescriptionId: dto.prescriptionId,
      slot: dto.slot,
      taken: dto.taken,
      checkedAt: now.toISOString(),
    };
  }

  // ── Portal v2 Phase 3: Annual Billing Summary ──

  /** 연간 수납 요약 (월별 통계) */
  async getAnnualBillingSummary(patientId: string, year: number) {
    // 🔴 (P2-5) 연 경계는 병원 시간대(KST) — getMedicalExpenses 와 같은 기준 · 낸 돈은 정본 `paymentEvents`
    //    (종전 `paidAmount ?? patientCopay` — 안 낸 본인부담을 낸 돈처럼 · 부분 환불 미차감 · 부분 납부 누락)
    const startDate = new Date(`${year}-01-01T00:00:00+09:00`);
    const endDate = new Date(`${year + 1}-01-01T00:00:00+09:00`);
    const { events, billings } = await this.paymentEvents(patientId, startDate, endDate);

    return {
      year,
      totalVisits: billings.length,
      totalAmount: billings.reduce((s, b) => s + (b.totalAmount ?? 0), 0),
      totalInsurance: billings.reduce((s, b) => s + (b.insuranceCovered ?? 0), 0),
      totalCopay: events.reduce((t, e) => t + e.amount, 0),
      monthly: Array.from({ length: 12 }, (_, i) => {
        const m = events.filter((e) => e.at.getMonth() === i);
        return {
          month: i + 1,
          count: new Set(m.map((e) => e.billingId)).size,
          amount: m.reduce((t, e) => t + e.amount, 0),
        };
      }),
    };
  }

  // ── Portal v2 Phase 3: Family Account Switch ──

  /** 가족 계정 전환 */
  async switchFamily(patientId: string, linkedPatientId: string) {
    const relation = await this.prisma.patientFamily.findFirst({
      where: { patientId, linkedPatientId },
    });
    if (!relation) throw new NotFoundException('가족 관계를 찾을 수 없습니다.');

    // 연결된 환자가 실존하는지 확인
    const linkedPatient = await this.prisma.patient.findUnique({
      where: { id: linkedPatientId },
      select: { id: true, mrn: true, familyName: true, givenName: true },
    });
    if (!linkedPatient) throw new NotFoundException('연결된 환자 정보를 찾을 수 없습니다.');

    // 새로운 포털 JWT 발급
    const expiresAt = new Date(Date.now() + PORTAL_SESSION_TTL_MINUTES * 60 * 1000);
    const token = jwt.sign(
      { sub: linkedPatientId, mrn: linkedPatient.mrn, type: 'portal' },
      this.jwtSecret,
      { expiresIn: `${PORTAL_SESSION_TTL_MINUTES}m` },
    );

    await this.prisma.portalSession.create({
      data: {
        patientId: linkedPatientId,
        token,
        expiresAt,
      },
    });

    await this.logAudit(patientId, 'FAMILY_SWITCH', '/api/v1/portal/family/switch', null, `전환 대상: ${linkedPatient.familyName}${linkedPatient.givenName}`);

    return {
      switched: true,
      patientId: linkedPatientId,
      relationship: relation.relationship,
      patient: linkedPatient,
      token,
      expiresAt,
    };
  }

  // ── Portal v2 Phase 6: Audit Log ──

  /** 내 의무기록 접근 로그 (BTG + 일반 감사로그) */
  async getPatientAuditLog(patientId: string, page = 1, limit = 30) {
    const skip = (page - 1) * limit;

    // 1. Break The Glass 접근 로그 (긴급 접근)
    const [btgLogs, btgTotal] = await Promise.all([
      this.prisma.breakTheGlassAccess.findMany({
        where: { patientId },
        orderBy: { accessedAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { familyName: true, givenName: true, department: true } } },
      }),
      this.prisma.breakTheGlassAccess.count({ where: { patientId } }),
    ]);

    // 2. 일반 감사 로그 (resourceType=Patient)
    const [auditLogs, auditTotal] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { resourceType: 'Patient', resourceId: patientId },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { familyName: true, givenName: true, department: true } } },
      }),
      this.prisma.auditLog.count({ where: { resourceType: 'Patient', resourceId: patientId } }),
    ]);

    return {
      btgAccesses: btgLogs.map(log => ({
        id: log.id,
        accessedBy: `${log.user.familyName}${log.user.givenName}`,
        department: log.user.department,
        reason: log.reason,
        resourceType: log.resourceType,
        accessedAt: log.accessedAt,
        isApproved: log.isApproved,
      })),
      accessLogs: auditLogs.map(log => ({
        id: log.id,
        action: log.action,
        accessedBy: `${log.user.familyName}${log.user.givenName}`,
        department: log.user.department,
        timestamp: log.timestamp,
      })),
      pagination: {
        page,
        limit,
        btgTotal,
        auditTotal,
      },
    };
  }

  // ── 서류 발급 신청 ──

  /** 서류 발급 신청 */
  async requestDocument(patientId: string, dto: { type: string; purpose?: string; periodFrom?: string; periodTo?: string; deliveryMethod?: string; copies?: number; note?: string; recordTypes?: string[]; encounterId?: string }) {
    // 🔴 (2026-10-10) 금액은 수수료 규칙 정본(fee-rules · 원내 개정 config 포함) 하나로 — 종전 여기 따로 둔 금액표(TYPE_FEES)는
    //    원내 개정이 반영되지 않았고, 표에 없는 종류는 조용히 0원으로 접수됐다(모바일이 없는 코드를 보내 전량 0원이던 선례).
    //    신청 시점 금액은 **견적**이다(사본은 매수를 모른다) — 발급 때 매수·부수로 다시 센다(issuance.resolveFee).
    const { rules, source } = await loadFeeRules(this.prisma);
    if (!rules[dto.type]) throw new BadRequestException({ code: 'UNKNOWN_DOC_TYPE', message: '지원하지 않는 서류 종류입니다.', details: { type: dto.type } });
    if (PORTAL_BLOCKED_DOC_TYPES.includes(dto.type)) {
      throw new BadRequestException({ code: 'DOC_TYPE_DESK_ONLY', message: '이 서류는 포털에서 신청할 수 없습니다 — 원무 창구에서 접수합니다.' });
    }
    const copies = Math.max(1, Math.min(DOC_MAX_COPIES, Math.trunc(dto.copies ?? 1)));
    // 진단서 관련 진료 — 본인 진료만 허용(타 환자 encounter 차단)
    let encounterId: string | undefined;
    if (dto.encounterId) {
      const enc = await this.prisma.encounter.findFirst({ where: { id: dto.encounterId, patientId }, select: { id: true } });
      encounterId = enc?.id;
    }
    const estimate = computeFeeWith(rules, source, dto.type, 0, copies);
    const created = await this.prisma.documentRequest.create({
      data: {
        patientId,
        type: dto.type,
        purpose: dto.purpose,
        periodFrom: dto.periodFrom ? new Date(dto.periodFrom) : null,
        periodTo: dto.periodTo ? new Date(dto.periodTo) : null,
        deliveryMethod: dto.deliveryMethod ?? 'PORTAL',
        copies,
        note: dto.note,
        recordTypes: Array.isArray(dto.recordTypes) && dto.recordTypes.length ? dto.recordTypes : undefined,
        encounterId,
        slaDueAt: new Date(Date.now() + 3 * 86400000), // 처리 기한 3일(P0=표시 · 원내 규정 미확정 — 사람 결정)
        fee: estimate.total,
        feeBreakdown: estimate as unknown as object,
      },
    });
    return created;
  }

  /** 서류 발급 신청 내역 조회 */
  async getDocumentRequests(patientId: string) {
    // 🔴 전 컬럼이 나갔다 — 처리·기안·대리자격 검증 **직원 UUID** 3종과 신청 계정 id.
    //    거절 사유(`rejectReason`)는 환자가 알아야 하므로 그대로 둔다.
    return this.prisma.documentRequest.findMany({
      where: { patientId },
      omit: PATIENT_FACING_OMIT.documentRequest,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  /** 서류 발급 상세 조회 */
  async getDocumentRequest(patientId: string, id: string) {
    const req = await this.prisma.documentRequest.findFirst({
      where: { id, patientId },
      omit: PATIENT_FACING_OMIT.documentRequest,
    });
    if (!req) throw new NotFoundException('서류 신청을 찾을 수 없습니다.');
    return req;
  }

  // ── Phase 4: 메시지 답장 ──

  /** 메시지에 답장 */
  async replyToMessage(patientId: string, messageId: string, content: string) {
    const original = await this.prisma.patientMessage.findUnique({ where: { id: messageId } });
    if (!original || original.patientId !== patientId) {
      throw new NotFoundException('메시지를 찾을 수 없습니다.');
    }
    const created = await this.prisma.patientMessage.create({
      data: {
        patientId,
        doctorId: original.doctorId,
        sender: 'PATIENT',
        content: `RE: ${content}`,
      },
    });
    this.announcePatientMessage(created);
    return created;
  }

  // ── Phase 5: 인증서 발급 요청 ──

  /** 인증서 발급 요청 — 정책에 따라 자동승인 또는 PENDING */
  async requestCertificate(patientId: string, data: { publicKey: string; algorithm: string }) {
    // sign 단독발급 전환 게이트 — HIS 자체 환자 인증서 minting 차단(sign 위임).
    if ((await this.configRuntime.get('blockchain.selfIssuanceEnabled')) === false) {
      throw new ForbiddenException({
        error: 'SELF_ISSUANCE_DISABLED',
        message: 'HIS 자체 인증서 발급이 폐지되었습니다 — sign(HSM-앵커 CA)에 발급 위임.',
      });
    }
    // 🔴 (2026-09-15 N2) 공개키 형식 입구 검증 — 포털 화면이 `base64('portal-patient-<시각>')` 를 공개키라며 보내
    //    **개인키가 어디에도 없는 인증서**가 발급됐다. 지어낸 값은 기존 인증서를 폐기하기 전에 거부한다.
    const keyProblem = publicKeyProblem(data.publicKey, data.algorithm);
    if (keyProblem) {
      throw new BadRequestException({ code: 'PUBLIC_KEY_INVALID', message: '공개키 형식이 올바르지 않습니다(SPKI 공개키·지원 알고리즘 ECDSA-P256/RSA-2048)', details: { reason: keyProblem } });
    }
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다.');

    // 정책 기반 상태 결정
    const policy = (await this.configRuntime.get('blockchain.patientCertPolicy')) as string ?? 'auto-all';
    let status = 'PENDING';

    if (policy === 'auto-all') {
      status = 'ACTIVE';
    } else if (policy === 'auto-verified' || policy === 'auto-email') {
      // 환자 계정의 인증 상태 확인
      const account = await this.prisma.patientAccount.findUnique({ where: { patientId } });
      if (policy === 'auto-verified' && account?.phoneVerified) {
        status = 'ACTIVE';
      } else if (policy === 'auto-email' && account?.emailVerified) {
        status = 'ACTIVE';
      }
    }

    // 자동승인(ACTIVE)인 경우 기존 ACTIVE 인증서 폐기 (1인 1인증서)
    if (status === 'ACTIVE') {
      const existing = await this.prisma.blockchainCertificate.findFirst({
        where: { patientId, ownerType: 'PATIENT', status: 'ACTIVE' },
      });
      if (existing) {
        await this.prisma.blockchainCertificate.update({
          where: { id: existing.id },
          data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: '새 인증서 자동 발급으로 교체' },
        });
      }
    }

    const serialNumber = `PAT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const crypto = await import('crypto');
    const certHash = crypto.createHash('sha256').update(`${serialNumber}:${data.publicKey}`).digest('hex');
    const fingerprint = crypto.createHash('sha256').update(data.publicKey).digest('hex');

    return this.prisma.blockchainCertificate.create({
      data: {
        ownerType: 'PATIENT',
        patientId,
        serialNumber,
        subjectDn: `CN=${patient.familyName}${patient.givenName},O=HospitalRUN,OU=Patient`,
        publicKey: data.publicKey,
        algorithm: data.algorithm,
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 86400000),
        status,
        patientMrn: patient.mrn,
        certHash,
        fingerprint,
      },
      /**
       * 🔴 (2026-09-16 G3) 발급만 **모델을 통째로** 돌려줬다 — 바로 아래 형제(내 인증서 목록)는 이미
       *    `select` 로 좁혀 놓았는데 같은 사실이 경로마다 다른 모양으로 나갔다(P12).
       *    통째로 돌려주면 `certHash`·`fingerprint`·`previousCertId`·`keyCustody`·`attestationRef`·
       *    `pinFailCount`/`pinLockedUntil` 같은 **내부 운영 값**이 환자 앱 응답에 실린다.
       *    목록과 같은 집합으로 맞춘다(화면이 읽는 필드는 그대로).
       */
      select: PATIENT_CERTIFICATE_SELECT,
    });
  }

  /** 내 인증서 목록 */
  async getPatientCertificates(patientId: string) {
    return this.prisma.blockchainCertificate.findMany({
      where: { patientId, ownerType: 'PATIENT' },
      orderBy: { createdAt: 'desc' },
      select: PATIENT_CERTIFICATE_SELECT,
    });
  }

  // ── 관리자: 서류 처리 ──

  /** 서류 목록 (관리자) */
  async getDocumentRequestsAdmin(status?: string) {
    const where: Prisma.DocumentRequestWhereInput = {};
    if (status) where.status = status;
    return this.prisma.documentRequest.findMany({
      where,
      include: { patient: { select: { familyName: true, givenName: true, mrn: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** 서류 상태 변경 (관리자) */
  /**
   * 🔴 (2026-10-10) 막음 — 상태 문자열을 그대로 써서 **동결·서명·발급 없이 READY(발급완료)·DELIVERED(수령)** 를 만들 수 있었다
   *    (발급번호 없는 '발급완료' · 사유 어휘 밖 반려 · 되살리기). 부르는 화면이 0 이다.
   *    처리는 정본 EP `staff/document-requests/:id/{snapshot,author,sign,issue,deliver,reject}` 로만 한다.
   */
  async updateDocumentStatus(_id: string, _dto: { status: string; rejectReason?: string }, _processedBy: string): Promise<never> {
    throw new BadRequestException({
      code: 'USE_ISSUANCE_WORKFLOW',
      message: '서류 상태를 직접 바꾸지 않습니다 — 서류 발급 화면(동결·작성·서명·발급·수령·반려)에서 처리하세요.',
    });
  }

  // ═══════════════════════════════════════════
  // 검진 결과 (수검자 포털)
  // ═══════════════════════════════════════════

  async getCheckupVisits(patientId: string) {
    return this.prisma.checkupVisit.findMany({
      where: {
        patientId,
        status: { in: ['COMPLETED', 'DELIVERED'] },
      },
      include: {
        program: { select: { code: true, name: true, category: true } },
        summary: {
          select: { overallGrade: true, sections: true, signedAt: true },
        },
      },
      orderBy: { scheduledDate: 'desc' },
      take: 20,
    });
  }

  async getCheckupVisitDetail(visitId: string, patientId: string) {
    const visit = await this.prisma.checkupVisit.findFirst({
      where: { id: visitId, patientId },
      include: {
        program: true,
        items: {
          where: { finding: { not: 'PENDING' } },
          orderBy: { createdAt: 'asc' },
        },
        summary: {
          include: {
            doctor: { select: { familyName: true, givenName: true } },
          },
        },
        followUps: {
          select: { description: true, dueDate: true, followUpType: true, completedAt: true },
        },
        referrals: {
          select: { toDepartment: true, reason: true, urgency: true, status: true },
        },
      },
    });

    if (!visit) throw new BadRequestException('검진 결과를 찾을 수 없습니다');

    // 서명 게이트: 의사 서명(summary.signedAt) 전에는 원시 검사항목·요약을 노출하지 않음(미검토 결과 환자 노출 방지).
    //  방문 존재/상태는 노출하되 결과 데이터는 마스킹하고 resultReady=false로 FE가 '결과 준비중' 안내.
    if (!visit.summary?.signedAt) {
      return { ...visit, items: [], summary: null, resultReady: false };
    }
    return { ...visit, resultReady: true };
  }

  async getCheckupSummary(visitId: string, patientId: string) {
    const visit = await this.prisma.checkupVisit.findFirst({
      where: { id: visitId, patientId },
      select: { id: true },
    });
    if (!visit) throw new BadRequestException('검진 결과를 찾을 수 없습니다');

    const summary = await this.prisma.checkupSummary.findUnique({
      where: { visitId },
      include: {
        doctor: { select: { familyName: true, givenName: true } },
      },
    });
    // 서명 게이트: 미서명(초안) 요약은 포털에 노출하지 않음(검토 전 판정 노출 방지).
    if (!summary?.signedAt) return null;
    return summary;
  }

  // ── 검진 예약/문진/비교 (포털) ──

  async getCheckupCapacity(from: string, to: string) {
    // 🔴 검증 없이 넘겨 `Invalid Date` 가 Prisma `groupBy` 로 들어가 500 이 났다(운영 실측)
    const fromDate = requireDateParam(from, '조회 시작일');
    const toDate = requireDateParam(to, '조회 종료일');
    toDate.setDate(toDate.getDate() + 1);

    const programs = await this.prisma.checkupProgram.findMany({
      where: { isActive: true },
      select: { dailyCapacity: true },
    });
    const totalCapacity = programs.reduce((sum, p) => sum + (p.dailyCapacity ?? 0), 0) || 40;

    const visits = await this.prisma.checkupVisit.groupBy({
      by: ['scheduledDate'],
      where: {
        scheduledDate: { gte: fromDate, lt: toDate },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
      _count: true,
    });

    const visitMap = new Map(visits.map((v) => [
      new Date(v.scheduledDate).toISOString().slice(0, 10),
      v._count,
    ]));

    const result = [];
    const cursor = new Date(fromDate);
    while (cursor < toDate) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const reserved = visitMap.get(dateStr) ?? 0;
      // 주말 제외
      const dayOfWeek = cursor.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      result.push({
        date: dateStr,
        capacity: isWeekend ? 0 : totalCapacity,
        reserved,
        available: isWeekend ? 0 : Math.max(0, totalCapacity - reserved),
        isWeekend,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return result;
  }

  async getPublicCheckupPrograms() {
    return this.prisma.checkupProgram.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, category: true, description: true, gender: true, ageMin: true, ageMax: true, price: true, discountRate: true, duration: true, items: true, options: true },
      orderBy: [{ category: 'asc' }, { price: 'asc' }],
    });
  }

  async reserveCheckup(patientId: string, body: CheckupReserveDto) {
    const program = await this.prisma.checkupProgram.findUnique({ where: { id: body.programId } });
    if (!program || !program.isActive) throw new BadRequestException('프로그램을 찾을 수 없습니다');

    let totalPrice = program.price;
    if (program.discountRate > 0) totalPrice = Math.round(totalPrice * (1 - program.discountRate / 100));

    return this.prisma.checkupVisit.create({
      data: {
        patientId,
        programId: body.programId,
        scheduledDate: new Date(body.scheduledDate),
        selectedOptions: body.selectedOptions as any,
        totalPrice,
      },
      include: { program: { select: { code: true, name: true } } },
    });
  }

  async cancelCheckupVisit(visitId: string, patientId: string) {
    const visit = await this.prisma.checkupVisit.findFirst({ where: { id: visitId, patientId } });
    if (!visit) throw new BadRequestException('예약을 찾을 수 없습니다');
    if (visit.status !== 'RESERVED') throw new BadRequestException('예약 상태에서만 취소 가능합니다');

    return this.prisma.checkupVisit.update({
      where: { id: visitId },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
  }

  async getCheckupQuestionnaire(visitId: string, patientId: string) {
    const visit = await this.prisma.checkupVisit.findFirst({
      where: { id: visitId, patientId },
      select: { id: true, programId: true },
    });
    if (!visit) throw new BadRequestException('검진 방문을 찾을 수 없습니다');

    const response = await this.prisma.checkupQuestionnaireResponse.findUnique({
      where: { visitId },
      include: { questionnaire: { select: { id: true, title: true, sections: true } } },
    });

    let template = await this.prisma.checkupQuestionnaire.findFirst({
      where: { programId: visit.programId, isActive: true },
    });
    if (!template) {
      template = await this.prisma.checkupQuestionnaire.findFirst({
        where: { programId: null, isActive: true },
      });
    }

    return { template, response };
  }

  async saveCheckupQuestionnaire(visitId: string, patientId: string, body: { questionnaireId: string; answers: unknown }) {
    const visit = await this.prisma.checkupVisit.findFirst({ where: { id: visitId, patientId } });
    if (!visit) throw new BadRequestException('검진 방문을 찾을 수 없습니다');

    const existing = await this.prisma.checkupQuestionnaireResponse.findUnique({ where: { visitId } });
    if (existing) {
      return this.prisma.checkupQuestionnaireResponse.update({
        where: { visitId },
        data: { answers: body.answers as any, completedAt: new Date() },
      });
    }
    return this.prisma.checkupQuestionnaireResponse.create({
      data: {
        questionnaireId: body.questionnaireId,
        visitId,
        patientId,
        answers: body.answers as any,
        completedAt: new Date(),
      },
    });
  }

  async getCheckupComparison(patientId: string) {
    const visits = await this.prisma.checkupVisit.findMany({
      where: { patientId, status: { in: ['COMPLETED', 'DELIVERED'] } },
      include: {
        program: { select: { code: true, name: true } },
        items: { where: { finding: { not: 'PENDING' } }, select: { testName: true, value: true, unit: true, finding: true } },
        summary: { select: { overallGrade: true, sections: true } },
      },
      orderBy: { scheduledDate: 'asc' },
      take: 5,
    });

    const testMap: Record<string, { testName: string; unit?: string; dataPoints: { date: string; value: string; finding: string }[] }> = {};
    for (const v of visits) {
      const date = v.scheduledDate instanceof Date ? v.scheduledDate.toISOString().slice(0, 10) : String(v.scheduledDate).slice(0, 10);
      for (const item of v.items) {
        if (!item.value) continue;
        if (!testMap[item.testName]) testMap[item.testName] = { testName: item.testName, unit: item.unit ?? undefined, dataPoints: [] };
        testMap[item.testName].dataPoints.push({ date, value: item.value, finding: item.finding });
      }
    }
    const trends = Object.values(testMap).filter((t) => t.dataPoints.length >= 2);
    const gradeTimeline = visits.map((v) => ({
      date: v.scheduledDate instanceof Date ? v.scheduledDate.toISOString().slice(0, 10) : String(v.scheduledDate).slice(0, 10),
      program: v.program.name,
      overallGrade: v.summary?.overallGrade ?? null,
    }));

    return { trends, gradeTimeline };
  }

  async getCheckupResultHtml(visitId: string, patientId: string): Promise<string> {
    const visit = await this.prisma.checkupVisit.findFirst({
      where: { id: visitId, patientId, status: { in: ['COMPLETED', 'DELIVERED'] } },
      include: {
        patient: { select: { mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } },
        program: { select: { name: true } },
        items: { where: { finding: { not: 'PENDING' } }, orderBy: { createdAt: 'asc' } },
        summary: { include: { doctor: { select: { familyName: true, givenName: true } } } },
      },
    });
    if (!visit) throw new BadRequestException('검진 결과를 찾을 수 없습니다');

    // XSS 방어: text/html 로 브라우저에 직접 렌더(인쇄 window.open)되므로 사용자/DB 유래 필드는 이스케이프.
    // 특히 doctorOpinion·recommendations·testName 등 자유입력이 스크립트 벡터.
    const gender = visit.patient.gender === 'MALE' ? '남' : '여';
    const resultRows = visit.items.map((r) => {
      const flagStyle = r.finding === 'ABNORMAL' || r.finding === 'CRITICAL' ? 'color:red;font-weight:bold' : '';
      return `<tr><td>${esc(r.testName)}</td><td style="${flagStyle}">${esc(r.value ?? '-')} ${esc(r.unit ?? '')}</td><td>${esc(r.referenceRange ?? '-')}</td><td style="${flagStyle}">${r.finding === 'NORMAL' ? '정상' : r.finding === 'CRITICAL' ? '위험' : '이상'}</td></tr>`;
    }).join('');

    const summary = visit.summary as any;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: sans-serif; padding: 40px; font-size: 12px; }
      h1 { text-align: center; font-size: 18px; } h2 { font-size: 14px; margin-top: 20px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; font-size: 11px; }
      th { background: #f5f5f5; } .info { background: #f9f9f9; padding: 10px; margin-bottom: 16px; }
      @media print { body { padding: 20px; } }
    </style></head><body>
      <h1>건강검진 결과서</h1>
      <div class="info">${esc(visit.patient.familyName)}${esc(visit.patient.givenName)} | ${esc(visit.patient.mrn)} | ${gender} | ${visit.patient.dateOfBirth?.toISOString().slice(0, 10) ?? ''}</div>
      <p>프로그램: ${esc(visit.program.name)} | 검진일: ${visit.scheduledDate?.toISOString().slice(0, 10) ?? ''}</p>
      ${summary ? `<h2>종합판정: ${esc(summary.overallGrade ?? '-')}</h2><p>${esc(summary.doctorOpinion ?? '')}</p>` : ''}
      <h2>검사 결과</h2>
      <table><thead><tr><th>검사명</th><th>결과</th><th>참고치</th><th>판정</th></tr></thead><tbody>${resultRows}</tbody></table>
      ${summary?.recommendations ? `<h2>권고사항</h2><ul>${(summary.recommendations as string[]).map((r: string) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      ${summary?.doctor ? `<p style="text-align:right;margin-top:24px">담당의: ${esc(summary.doctor.familyName)}${esc(summary.doctor.givenName)} | ${summary.signedAt ? new Date(summary.signedAt).toLocaleDateString('ko-KR') : ''}</p>` : ''}
      <div style="margin-top:40px;border-top:1px solid #ccc;padding-top:8px;font-size:10px;color:#999;text-align:center">발급: ${localDateTimeKey(new Date(), { seconds: true })}</div>
    </body></html>`;
  }

  // ── 원격진료 ──

  async getTelehealthSessions(patientId: string) {
    // 🔴 include 만 있고 select 가 없어 전 컬럼이 나갔다 — 직원 메모(`notes`)·약사 검토·간호기록 id·
    //    녹화본 주소까지. 화면이 쓰는 것은 status·sessionType·scheduledAt·chiefComplaint·roomId·
    //    patientRating·doctor 뿐이다(web `_services/ServicesTab`·mobile `telehealth`).
    return this.prisma.telehealthSession.findMany({
      where: { patientId },
      omit: PATIENT_FACING_OMIT.telehealthSession,
      include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
      orderBy: { scheduledAt: 'desc' },
      take: 20,
    });
  }

  async getTelehealthSession(id: string, patientId: string) {
    const session = await this.prisma.telehealthSession.findFirst({
      where: { id, patientId },
      omit: PATIENT_FACING_OMIT.telehealthSession,
      include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
    });
    if (!session) throw new NotFoundException('원격진료를 찾을 수 없습니다');
    return session;
  }

  async joinTelehealth(id: string, patientId: string) {
    const session = await this.prisma.telehealthSession.findFirst({ where: { id, patientId } });
    if (!session) throw new NotFoundException('원격진료를 찾을 수 없습니다');
    // 🔴 쓰기 응답도 같은 표면이다 — update 는 **갱신된 전 행**을 돌려준다(직원 메모가 그대로 실렸다)
    return this.prisma.telehealthSession.update({ where: { id }, data: { status: 'WAITING' }, omit: PATIENT_FACING_OMIT.telehealthSession });
  }

  /**
   * 화상 진료 입장 토큰 — **본인 세션인지 먼저 확인**한다.
   * `TelehealthService.getPatientJitsiToken` 은 sessionId 만 받으므로(직원 문맥 전제),
   * 환자 문맥에서는 여기서 결속을 확인하지 않으면 남의 세션 방에 들어갈 수 있다(IDOR).
   */
  async getTelehealthPatientToken(id: string, patientId: string) {
    const session = await this.prisma.telehealthSession.findFirst({ where: { id, patientId } });
    if (!session) throw new NotFoundException('원격진료를 찾을 수 없습니다');
    return this.telehealth.getPatientJitsiToken(id);
  }

  async sendTelehealthMessage(id: string, patientId: string, message: string) {
    const session = await this.prisma.telehealthSession.findFirst({ where: { id, patientId } });
    if (!session) throw new NotFoundException('원격진료를 찾을 수 없습니다');
    return this.prisma.telehealthSession.update({ where: { id }, data: { patientMessage: message, status: 'WAITING' }, omit: PATIENT_FACING_OMIT.telehealthSession });
  }

  async rateTelehealth(id: string, patientId: string, rating: number, feedback?: string) {
    const session = await this.prisma.telehealthSession.findFirst({ where: { id, patientId } });
    if (!session) throw new NotFoundException('원격진료를 찾을 수 없습니다');
    return this.prisma.telehealthSession.update({ where: { id }, data: { patientRating: rating, patientFeedback: feedback }, omit: PATIENT_FACING_OMIT.telehealthSession });
  }

  // ── 원격진료 예약 ──

  async getTelehealthDepartments() {
    const doctors = await this.prisma.user.findMany({
      where: { role: 'DOCTOR', isActive: true, department: { not: null } },
      select: { department: true },
      distinct: ['department'],
    });
    const all = doctors.map(d => d.department).filter(Boolean) as string[];
    // 관리자가 '선택한 진료과만 허용'으로 설정했다면 예약 화면에도 그 과만 보여야 한다.
    // 미설정(null)이면 전체 허용 — 목록을 줄이지 않는다(정본: common/telehealth-department-policy).
    const policy = await getTelehealthDepartmentPolicy(this.prisma);
    return filterTelehealthDepartments(policy, all);
  }

  async getTelehealthDoctors(department: string) {
    const policy = await getTelehealthDepartmentPolicy(this.prisma);
    if (!isTelehealthDepartmentEligible(policy, department)) return [];
    return this.prisma.user.findMany({
      where: { role: 'DOCTOR', department, isActive: true },
      select: { id: true, familyName: true, givenName: true, department: true, specialty: true },
    });
  }

  async getTelehealthSlots(doctorId: string, date: string) {
    /**
     * 🔴 둘 다 **필수인데 검증이 없었다** — 빠지면 `new Date(undefined)` = `Invalid Date` 가
     *    그대로 Prisma 로 들어가 **500 INTERNAL_ERROR** 가 났다(모바일 예약 화면 실측).
     *    사용자는 "서버 오류"만 보고 자기 입력 문제인 줄 모른다 —
     *    **날짜 파싱 실패는 500 이 아니라 400 이다**(§규약 7).
     */
    if (!doctorId) throw new BadRequestException('담당의를 선택해주세요');
    const d = requireDateParam(date, '조회할 날짜');
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0);
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 0);

    // 이미 예약된 시간
    const booked = await this.prisma.telehealthSession.findMany({
      where: { doctorId, scheduledAt: { gte: dayStart, lt: dayEnd }, status: { not: 'CANCELLED' } },
      select: { scheduledAt: true },
    });
    const bookedTimes = new Set(booked.map(b => b.scheduledAt.toISOString()));

    // 30분 단위 슬롯 생성
    const slots: { time: string; available: boolean }[] = [];
    const cursor = new Date(dayStart);
    while (cursor < dayEnd) {
      const iso = cursor.toISOString();
      slots.push({ time: iso, available: !bookedTimes.has(iso) && cursor > new Date() });
      cursor.setMinutes(cursor.getMinutes() + 30);
    }
    return slots;
  }

  async bookTelehealth(patientId: string, data: { doctorId: string; scheduledAt: string; sessionType: string; chiefComplaint?: string }) {
    // 🔴 담당의는 서버가 검증한다 — 화면이 고른 값을 그대로 믿으면 의사가 아닌 계정 id 로도
    //    예약이 잡히고(세션이 어느 의사 목록에도 안 뜬다), 진료과 설정도 무력화된다.
    if (!data.doctorId) throw new BadRequestException('담당의를 선택해주세요');
    const doctor = await this.prisma.user.findUnique({
      where: { id: data.doctorId },
      select: { id: true, role: true, isActive: true, department: true },
    });
    if (!doctor || doctor.role !== 'DOCTOR' || !doctor.isActive) {
      throw new BadRequestException('선택한 담당의로는 예약할 수 없습니다');
    }
    const policy = await getTelehealthDepartmentPolicy(this.prisma);
    if (!isTelehealthDepartmentEligible(policy, doctor.department)) {
      throw new ForbiddenException(`${doctor.department}는 현재 비대면 진료를 제공하지 않습니다`);
    }
    const { randomBytes } = await import('crypto');
    const roomId = `th-${randomBytes(8).toString('hex')}`;
    return this.prisma.telehealthSession.create({
      data: {
        patientId,
        doctorId: doctor.id,
        scheduledAt: new Date(data.scheduledAt),
        sessionType: data.sessionType,
        chiefComplaint: data.chiefComplaint,
        roomId,
      },
      omit: PATIENT_FACING_OMIT.telehealthSession,
      include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
    });
  }

  async cancelTelehealth(id: string, patientId: string) {
    const session = await this.prisma.telehealthSession.findFirst({ where: { id, patientId } });
    if (!session) throw new NotFoundException('원격진료를 찾을 수 없습니다');
    return this.prisma.telehealthSession.update({ where: { id }, data: { status: 'CANCELLED' }, omit: PATIENT_FACING_OMIT.telehealthSession });
  }

  // ══════════════════════════════════════════════════════════════
  //  환자 여정 통합 API (Journey Hub)
  // ══════════════════════════════════════════════════════════════


  /**
   * 환자 현재 상태 자동 판별 + 상태별 데이터 통합 반환
   * - OUTPATIENT_WAITING: 접수 후 대기 중
   * - OUTPATIENT_IN_PROGRESS: 진료/검사 진행 중
   * - INPATIENT: 입원 중
   * - POST_DISCHARGE: 퇴원 후 (최근 30일)
   * - IDLE: 예약 없음 / 건강관리 모드
   */
  async getJourneyStatus(patientId: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    // 1. 현재 입원 중?
    const activeAdmission = await this.prisma.admission.findFirst({
      where: { patientId, status: 'ADMITTED' },
      include: {
        bed: { include: { ward: true } },
        attendingDoctor: { select: { id: true, familyName: true, givenName: true } },
        admittingDoctor: { select: { id: true, familyName: true, givenName: true } },
      },
      orderBy: { admitDate: 'desc' },
    });

    if (activeAdmission) {
      // 퇴원 준비 중인지 확인 (퇴원 요약서 작성됨 OR 퇴원 예정일 D-1)
      const dischargeSummary = await this.prisma.dischargeSummary.findFirst({
        where: { admissionId: activeAdmission.id },
        select: { status: true, dischargeDate: true, dischargeDiagnosis: true, followUpPlan: true, followUpDate: true, dischargeMedications: true, dietaryInstructions: true, activityRestrictions: true, patientEducation: true },
      });
      const isPreDischarge = dischargeSummary?.status === 'SIGNED' || dischargeSummary?.status === 'AMENDED';
      if (isPreDischarge) {
        return this.buildPreDischargeStatus(patientId, activeAdmission, dischargeSummary!);
      }
      return this.buildInpatientStatus(patientId, activeAdmission);
    }

    // 2. 오늘 대기열 존재?
    const activeQueue = await this.prisma.waitingQueue.findFirst({
      where: {
        patientId,
        createdAt: { gte: today, lt: tomorrow },
        status: { in: ['WAITING', 'CALLED', 'IN_CONSULTATION'] },
      },
      include: {
        doctor: { select: { id: true, familyName: true, givenName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (activeQueue) {
      // 검진 진행 중인지 확인 — 오늘 예약된 검진만
      const activeCheckup = await this.prisma.checkupVisit.findFirst({
        where: { patientId, status: { in: ['CHECKED_IN', 'IN_PROGRESS'] }, scheduledDate: { gte: today, lt: tomorrow } },
        include: {
          program: { select: { name: true, category: true, duration: true } },
          items: { orderBy: { completedAt: 'asc' } },
        },
        orderBy: { checkedInAt: 'desc' },
      });

      if (activeCheckup) {
        return this.buildCheckupStatus(patientId, activeQueue, activeCheckup, today, tomorrow);
      }

      return this.buildOutpatientStatus(patientId, activeQueue, today, tomorrow);
    }

    // 2-b. 대기열 없이도 오늘 검진 진행 중?
    const activeCheckupNoQueue = await this.prisma.checkupVisit.findFirst({
      where: { patientId, status: { in: ['CHECKED_IN', 'IN_PROGRESS'] }, scheduledDate: { gte: today, lt: tomorrow } },
      include: {
        program: { select: { name: true, category: true, duration: true } },
        items: { orderBy: { completedAt: 'asc' } },
      },
    });
    if (activeCheckupNoQueue) {
      return this.buildCheckupStatus(patientId, null, activeCheckupNoQueue, today, tomorrow);
    }

    // 3. 최근 퇴원 (30일 이내)?
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentDischarge = await this.prisma.admission.findFirst({
      where: { patientId, status: 'DISCHARGED', dischargeDate: { gte: thirtyDaysAgo } },
      include: {
        attendingDoctor: { select: { familyName: true, givenName: true } },
        dischargeSummaryDoc: { select: { dischargeDiagnosis: true, followUpPlan: true, followUpDate: true, dischargeMedications: true } },
      },
      orderBy: { dischargeDate: 'desc' },
    });

    if (recentDischarge) {
      return this.buildPostDischargeStatus(patientId, recentDischarge);
    }

    // 4. 예약 D-7 이내? → PRE_VISIT
    const sevenDaysLater = new Date(); sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
    const upcomingAppointment = await this.prisma.appointment.findFirst({
      where: { patientId, status: 'SCHEDULED', scheduledAt: { gte: today, lte: sevenDaysLater } },
      include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
      orderBy: { scheduledAt: 'asc' },
    });
    if (upcomingAppointment) {
      return this.buildPreVisitStatus(patientId, upcomingAppointment);
    }

    // 5. IDLE — 예정 예약 + 건강관리
    return this.buildIdleStatus(patientId);
  }

  private async buildCheckupStatus(patientId: string, queue: JourneyQueue | null, checkup: JourneyCheckup, today: Date, tomorrow: Date) {
    const items: CheckupItem[] = checkup.items ?? [];
    const completed = items.filter((i: CheckupItem) => i.finding !== 'PENDING');
    const pending = items.filter((i: CheckupItem) => i.finding === 'PENDING');
    const abnormal = items.filter((i: CheckupItem) => i.finding === 'ABNORMAL' || i.finding === 'CRITICAL');
    const elapsedMin = checkup.checkedInAt ? Math.ceil((Date.now() - new Date(checkup.checkedInAt).getTime()) / 60000) : 0;

    const journeyEvents = await this.prisma.patientJourneyEvent.findMany({
      where: { patientId, eventAt: { gte: today } },
      orderBy: { eventAt: 'asc' },
      take: 30,
    });

    /**
     * 검사실 위치·대기 — 🔴 2026-08-14(W6) 수리.
     *
     * 종전: `congestionMap` 은 **진료과명**(내과·외과…)으로 만든 외래 대기열인데
     * 조회는 **검사실명**('채혈실'·'골밀도실')으로 했다 — 키가 겹칠 수 없으니
     * `?? Math.floor(Math.random() * 5)` 폴백이 **유일한 경로**였다. 즉 환자앱은
     * 검진 내내 "3명 대기 · 예상 15분 · 혼잡"을 **난수로** 보여줬고, 새로고침마다
     * 값이 바뀌었다. 환자가 그 숫자를 보고 다음 검사실을 고른다.
     *
     * 지금: 검진 스테이션 대기열(`CheckupStationLog` — 도착했고 아직 안 끝난 건)이
     * 방 단위 실측 정본이다. 스테이션이 매핑되지 않는 항목은 **모른다고 말한다**
     * (`waitingCount: null` · `congestionLevel: 'UNKNOWN'`).
     * 평균 소요시간도 `ck_stations.avgMinutes` 를 쓴다(하드코딩 표는 층 정보만 남긴다).
     */
    /**
     * 검사 항목 → 검진 스테이션(검사 논리). 🔴 (P0-5 · 2026-09-28) 종전 이 표가 **층·위치 텍스트**까지 들고 있었다
     * ('2층 채혈실'·'1층 영상의학과') — 공간 정본(SpaceNode: 검진센터 B1)·시설 안내(7층)와 세 갈래로 갈라져
     * 환자 앱이 다른 층을 안내했다. 위치는 이제 **스테이션의 공간 연결**(`ck_stations.space_node_id`)에서만 온다 —
     * 연결 안 된 스테이션은 `location: null`(모른다고 말한다).
     */
    const ROOM_STATION: Record<string, string | null> = {
      '채혈실': 'ck-blood',
      '초음파실': 'ck-ultrasound',
      '영상의학과': 'ck-xray',
      '내시경실': 'ck-endoscopy',
      '골밀도실': null, // 스테이션 미등재
      '심전도실': 'ck-ecg',
      '건강검진센터': 'ck-physical',
    };

    function getRoomKey(item: CheckupItem): string {
      if (item.category === 'LAB') return '채혈실';
      if (item.category === 'IMAGING' && item.testName?.includes('초음파')) return '초음파실';
      if (item.category === 'IMAGING') return '영상의학과';
      if (item.testName?.includes('내시경')) return '내시경실';
      if (item.testName?.includes('골밀도')) return '골밀도실';
      if (item.testName?.includes('심전도') || item.testName?.includes('ECG')) return '심전도실';
      return '건강검진센터';
    }

    /**
     * 스테이션별 실대기(오늘 도착·미완료) + 평균 소요시간 + 공간.
     *
     * 🔴 2026-08-21 — 조회 실패를 `[]` 로 접으면 **모든 방이 "0명 대기 · 여유(LOW)"** 가 됐다.
     *    실패는 '한산'이 아니라 **모름**이다. 스테이션 목록 조회도 같다(종전 `.catch(() => [])` → 평균·위치를 "없음"으로 번역).
     */
    const [queueRes, stationRes] = await Promise.all([
      this.prisma.checkupStationLog.groupBy({
        by: ['stationId'],
        where: { arrivedAt: { gte: today }, completedAt: null },
        _count: true,
      }).then((v) => ({ ok: true as const, v: v as { stationId: string; _count: number }[] }))
        .catch((e) => {
          this.logger.error(`검진 스테이션 대기 조회 실패 — 혼잡도를 UNKNOWN 으로 낸다: ${(e as Error).message}`);
          return { ok: false as const, v: [] as { stationId: string; _count: number }[] };
        }),
      this.prisma.checkupStation.findMany({
        select: { stationId: true, avgMinutes: true, spaceNode: { select: { id: true, name: true, floor: true } } },
      }).then((v) => ({ ok: true as const, v }))
        .catch((e) => {
          this.logger.error(`검진 스테이션 조회 실패 — 위치·평균 소요를 모름으로 낸다: ${(e as Error).message}`);
          return { ok: false as const, v: [] as { stationId: string; avgMinutes: number; spaceNode: { id: string; name: string; floor: number | null } | null }[] };
        }),
    ]);
    const waitByStation = new Map(queueRes.v.map((r) => [r.stationId, r._count]));
    const stationBy = new Map(stationRes.v.map((st) => [st.stationId, st]));
    const floorLabel = (f: number | null | undefined) => (f == null ? null : f < 0 ? `B${-f}` : `${f}F`);
    // P4 이동 거리 — 마지막으로 완료한 검사실(공간 연결된 것)에서 확정 도면 경로(m). 동점 처리·표시에만 · 모르면 null
    const lastDone = await this.prisma.checkupStationLog.findFirst({
      where: { visitId: checkup.id, completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: { station: { select: { spaceNodeId: true } } },
    });
    const distances = this.spaceModel
      ? await this.spaceModel.walkDistances(lastDone?.station?.spaceNodeId ?? null, stationRes.v.map((st) => st.spaceNode?.id).filter((x): x is string => !!x))
      : new Map<string, number | null>();

    const pendingWithCongestion = pending.map((i: CheckupItem) => {
      const roomKey = getRoomKey(i);
      const sid = ROOM_STATION[roomKey] ?? null;
      const st = sid ? stationBy.get(sid) : undefined;
      // 스테이션을 모르면(또는 대기 조회가 실패하면) 대기도 모른다 — 0 으로도, 난수로도 채우지 않는다.
      const waitingCount = sid && queueRes.ok ? (waitByStation.get(sid) ?? 0) : null;
      const avgTestMinutes = st ? st.avgMinutes : null;
      const estimatedWaitMinutes = estimatedWaitMinutes_({ waitingCount, avgMinutes: avgTestMinutes });
      const congestionLevel =
        waitingCount == null ? 'UNKNOWN' : waitingCount === 0 ? 'LOW' : waitingCount <= 3 ? 'MEDIUM' : 'HIGH';
      return {
        testName: i.testName,
        category: i.category,
        roomKey,
        location: st?.spaceNode?.name ?? null, // 공간 미연결 = 모름
        floor: floorLabel(st?.spaceNode?.floor),
        waitingCount,
        estimatedWaitMinutes,
        avgTestMinutes,
        congestionLevel,
        // 정렬용 — 응답에는 남겨도 무해(순서 근거를 말할 수 있다)
        key: i.testName ?? roomKey,
        priority: checkupItemPriority({ category: i.category, name: i.testName }),
        avgMinutes: avgTestMinutes,
        distanceM: st?.spaceNode ? distances.get(st.spaceNode.id) ?? null : null,
      };
    });

    // 추천 순서 — 정본 shared `rankNextStations`(워크스테이션과 같은 규칙: 검사 순서 → 예상 대기 · 미상은 뒤로)
    const recommended = rankNextStations(pendingWithCongestion);

    return {
      phase: 'CHECKUP_IN_PROGRESS',
      checkup: {
        visitId: checkup.id,
        programName: checkup.program?.name ?? '건강검진',
        category: checkup.program?.category ?? 'BASIC',
        estimatedDuration: checkup.program?.duration ?? 180,
        checkedInAt: checkup.checkedInAt,
        elapsedMinutes: elapsedMin,
        progress: {
          total: items.length,
          completed: completed.length,
          pending: pending.length,
          percent: items.length > 0 ? Math.round((completed.length / items.length) * 100) : 0,
        },
      },
      nextRecommended: recommended[0] ?? null,
      pendingItems: recommended,
      completedItems: completed.map((i: CheckupItem) => ({
        testName: i.testName,
        category: i.category,
        value: i.value,
        unit: i.unit,
        referenceRange: i.referenceRange,
        finding: i.finding,
        completedAt: i.completedAt,
      })),
      abnormalItems: abnormal.map((i: CheckupItem) => ({
        testName: i.testName,
        value: i.value,
        unit: i.unit,
        referenceRange: i.referenceRange,
        finding: i.finding,
      })),
      queue: queue ? {
        queueNumber: queue.queueNumber,
        departmentName: queue.departmentName,
      } : null,
      // 🔴 (2026-09-14) 환자 응답 — 노출 유형만·설명은 안전 유형만(타임라인 EP 와 같은 shared 정본)
      timeline: journeyEvents.filter((e) => isPatientVisibleJourneyEvent(e.eventType)).map(e => ({
        type: e.eventType,
        at: e.eventAt,
        description: patientJourneyDescription(e.eventType, e.description),
        severity: e.severity,
      })),
    };
  }

  private async buildOutpatientStatus(patientId: string, queue: JourneyQueue, today: Date, tomorrow: Date) {
    const aheadCount = await this.prisma.waitingQueue.count({
      where: {
        departmentName: queue.departmentName,
        doctorId: queue.doctorId,
        createdAt: { gte: today, lt: tomorrow },
        status: 'WAITING',
        queueNumber: { lt: queue.queueNumber },
      },
    });

    const [journeyEvents, todayAppointments, pendingLabOrders, pendingImagingOrders, pendingDiagnosticTests] = await Promise.all([
      this.prisma.patientJourneyEvent.findMany({
        where: { patientId, eventAt: { gte: today } },
        orderBy: { eventAt: 'asc' },
        take: 30,
      }),
      this.prisma.appointment.findMany({
        where: { patientId, scheduledAt: { gte: today, lt: tomorrow }, status: { not: 'CANCELLED' } },
        include: { doctor: { select: { familyName: true, givenName: true } } },
        orderBy: { scheduledAt: 'asc' },
      }),
      // 미완료 검사 오더
      this.prisma.order.findMany({
        where: { department: 'LAB', status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] }, labResult: { patientId } },
        include: { labResult: { select: { id: true, status: true, items: { select: { testName: true }, take: 3 } } } },
        orderBy: { createdAt: 'asc' },
      }),
      // 미완료 영상 오더
      this.prisma.order.findMany({
        where: { department: 'IMAGING', status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] }, imagingResult: { patientId } },
        include: { imagingResult: { select: { id: true, modality: true, bodyPart: true, status: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      // 미완료 기초검사
      this.prisma.diagnosticTest.findMany({
        where: { patientId, status: { in: ['ORDERED', 'SCHEDULED'] } },
        select: { id: true, testType: true, testName: true, status: true, scheduledAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // 완료된 검사 (오늘)
    const completedLabs = await this.prisma.labResult.findMany({
      where: { patientId, status: 'COMPLETED', completedAt: { gte: today } },
      include: { items: { select: { testName: true, value: true, unit: true, flag: true }, take: 5 } },
      orderBy: { completedAt: 'desc' },
      take: 5,
    });

    const phase = queue.status === 'WAITING' ? 'OUTPATIENT_WAITING'
      : queue.status === 'CALLED' ? 'OUTPATIENT_CALLED'
      : 'OUTPATIENT_IN_CONSULTATION';

    return {
      phase,
      queue: {
        id: queue.id,
        queueNumber: queue.queueNumber,
        status: queue.status,
        departmentName: queue.departmentName,
        doctor: queue.doctor,
        aheadCount,
        // 🔴 W9(2026-08-14): `aheadCount * 8` — 어제 `getWaitingStatus` 에서 걷어낸 **상수 8분/명 날조**가
        //    여정 API 에 그대로 살아 있었다(한 곳만 고치면 갈라진다). 같은 환자앱이 같은 대기를 두고
        //    한 화면에선 '모름', 다른 화면에선 '약 N분'이라 말하던 상태.
        //    실측 근거는 그때와 동일 — 진료 시작 시각이 있는 외래 완료가 462건 중 13건뿐이라
        //    회전율 표본이 없다. 모르면 null 이다(앞 대기 인원 aheadCount 는 실제로 센 값).
        estimatedWaitMinutes: null,
        checkedInAt: queue.checkedInAt,
        calledAt: queue.calledAt,
        startedAt: queue.startedAt,
      },
      todayAppointments,
      pendingOrders: {
        lab: pendingLabOrders.map(o => ({
          id: o.id, status: o.status, priority: o.priority,
          testNames: o.labResult?.items?.map(i => i.testName) ?? [],
          labStatus: o.labResult?.status ?? null,
          location: '2층 진단검사의학과 (채혈실)',
        })),
        imaging: pendingImagingOrders.map(o => ({
          id: o.id, status: o.status, priority: o.priority,
          modality: o.imagingResult?.modality ?? null,
          bodyPart: o.imagingResult?.bodyPart ?? null,
          location: '1층 영상의학과',
        })),
        diagnostic: pendingDiagnosticTests.map(t => ({
          id: t.id, testType: t.testType, testName: t.testName,
          status: t.status, scheduledAt: t.scheduledAt,
          location: t.testType === 'ECG' ? '2층 심전도실' : t.testType === 'EEG' ? '3층 뇌파검사실' : '2층 기능검사실',
        })),
      },
      completedLabs: completedLabs.map(r => ({
        id: r.id,
        completedAt: r.completedAt,
        items: r.items,
      })),
      // 🔴 (2026-09-14) 환자 응답 — 노출 유형만·설명은 안전 유형만(타임라인 EP 와 같은 shared 정본)
      timeline: journeyEvents.filter((e) => isPatientVisibleJourneyEvent(e.eventType)).map(e => ({
        type: e.eventType,
        at: e.eventAt,
        description: patientJourneyDescription(e.eventType, e.description),
        severity: e.severity,
      })),
    };
  }

  private async buildInpatientStatus(patientId: string, admission: JourneyAdmission) {
    const admissionId = admission.id;
    const daysSinceAdmit = stayDays(admission.admitDate) ?? 0;

    // PatientAccount ID 조회 (알림 조회용)
    const account = await this.prisma.patientAccount.findFirst({ where: { patientId }, select: { id: true } });

    const [recentVitals, todayMeds, recentLabs, recentNotes, nextSurgery, unreadNotifications] = await Promise.all([
      /**
       * 🔴 입원 환자에게 **입원 전 외래 측정치**를 "최근 활력"으로 보여주던 것 —
       *    화면 실사용 점검 W9(2026-08-14).
       *
       *    `PreVisitVitals` 는 **외래 진료 전 접수 단계**에서 재는 값이다. 입원 병동의 활력은
       *    간호 플로우시트(`FlowSheetEntry`)에 쌓인다. 종전 코드는 입원 대시보드에서
       *    `preVisitVitals` 를 최신순으로 뽑아, 실측상 **입원 66일차 환자에게 입원 하루 전 값**을
       *    현재 상태처럼 제시했다. 환자는 그 숫자를 지금 자기 몸 상태로 읽는다(P1·P12).
       *
       *    정본은 이 입원 건(`admissionId`)의 플로우시트다. 아직 기록이 없으면
       *    **옛 외래 값으로 메우지 않고 null** 을 낸다 — 표본 부재의 정답은 폴백이 아니다.
       */
      // 🔴 (2026-10-10) 이 입원 건의 활력 = 입원 활력 읽기 정본(플로시트 + 재원 기간 안 간호 스테이션 입력).
      //    입원 **전** 외래 측정은 여전히 들어오지 않는다(재원 기간 조건) · 모르면 null.
      new AdmissionVitalsReader(this.prisma)
        .latestByAdmission([{ id: admissionId, patientId, admitDate: admission.admitDate, dischargeDate: null }])
        .then((m) => {
          const v = m.get(admissionId);
          return v ? {
            systolicBp: v.systolicBp, diastolicBp: v.diastolicBp, heartRate: v.heartRate, temperature: v.temperature, spo2: v.spo2,
            recordedAt: v.at, measuredAt: v.at, source: v.ledger === 'FLOWSHEET' ? 'INPATIENT_FLOWSHEET' as const : 'INPATIENT_STATION' as const,
          } : null;
        }),
      this.prisma.medicationAdministration.findMany({
        where: { patientId, scheduledAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
        include: { prescription: { include: { medicationCode: { select: { nameKo: true } } } } },
        orderBy: { scheduledAt: 'asc' },
        take: 20,
      }),
      this.prisma.labResult.findMany({
        where: { patientId, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        take: 10,
        include: { items: { select: { testName: true, value: true, unit: true, normalMin: true, normalMax: true, flag: true } } },
      }),
      this.prisma.progressNote.findMany({
        where: { admissionId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, content: true, createdAt: true, doctor: { select: { familyName: true, givenName: true } } },
      }),
      this.prisma.surgery.findFirst({
        where: { patientId, status: 'SCHEDULED' },
        orderBy: { scheduledAt: 'asc' },
        select: { id: true, procedureName: true, scheduledAt: true, status: true },
      }),
      account ? this.prisma.patientNotification.count({ where: { accountId: account.id, isRead: false } }) : Promise.resolve(0),
    ]);

    return {
      phase: 'INPATIENT',
      admission: {
        id: admissionId,
        admitDate: admission.admitDate,
        daysSinceAdmit,
        ward: admission.bed?.ward?.name ?? null,
        room: admission.bed?.roomNumber ?? null,
        bed: admission.bed?.bedNumber ?? null,
        attendingDoctor: admission.attendingDoctor,
        admittingDoctor: admission.admittingDoctor,
      },
      vitals: recentVitals,
      todayMedications: todayMeds.map(m => ({
        id: m.id,
        drugName: m.prescription?.medicationCode?.nameKo ?? null,
        dose: m.dose,
        scheduledAt: m.scheduledAt,
        status: m.status,
      })),
      recentLabResults: recentLabs.map(r => ({
        id: r.id,
        completedAt: r.completedAt,
        items: r.items,
      })),
      recentProgressNotes: recentNotes,
      nextSurgery,
      unreadNotifications,
    };
  }

  private async buildPostDischargeStatus(patientId: string, discharge: JourneyDischarge) {
    const daysSinceDischarge = discharge.dischargeDate
      ? Math.ceil((Date.now() - new Date(discharge.dischargeDate).getTime()) / 86400000)
      : 0;

    const [nextAppointment, activeMeds, healthDashboard] = await Promise.all([
      this.prisma.appointment.findFirst({
        where: { patientId, status: 'SCHEDULED', scheduledAt: { gte: new Date() } },
        include: { doctor: { select: { familyName: true, givenName: true } } },
        orderBy: { scheduledAt: 'asc' },
      }),
      this.prisma.prescription.findMany({
        where: { ...PortalService.MEDICATION_RX_WHERE, encounter: { patientId } },
        include: { medicationCode: { select: { nameKo: true } } },
        take: 20,
      }),
      this.getHealthDashboard(patientId),
    ]);

    return {
      phase: 'POST_DISCHARGE',
      discharge: {
        admissionId: discharge.id,
        dischargeDate: discharge.dischargeDate,
        daysSinceDischarge,
        attendingDoctor: discharge.attendingDoctor,
        diagnosis: discharge.dischargeSummaryDoc?.dischargeDiagnosis ?? null,
        followUpPlan: discharge.dischargeSummaryDoc?.followUpPlan ?? null,
        followUpDate: discharge.dischargeSummaryDoc?.followUpDate ?? null,
        dischargeMedications: discharge.dischargeSummaryDoc?.dischargeMedications ?? null,
      },
      nextAppointment,
      activeMedications: activeMeds.map(p => ({
        id: p.id,
        drugName: p.medicationCode?.nameKo ?? null,
        dosage: p.dosage,
        frequency: p.frequency,
      })),
      healthDashboard,
    };
  }

  private async buildPreVisitStatus(patientId: string, appointment: any) {
    const scheduledAt = new Date(appointment.scheduledAt);
    const daysUntil = Math.ceil((scheduledAt.getTime() - Date.now()) / 86400000);

    // 준비 체크리스트 데이터
    const [pendingConsents, pendingQuestionnaires, activeMeds, healthDashboard] = await Promise.all([
      // 🔴 (2026-09-15) 종전 `.catch(() => 0)` — 조회 실패가 "미서명 동의서 0건"(체크리스트 완료)으로 보였다. 실패=null
      this.prisma.registrationConsent?.count({
        where: { patientId, agreed: false },
      }).catch((e) => { this.logger.warn(`내원 전 체크리스트 동의서 조회 실패 — 확인 불가로 낸다: ${e instanceof Error ? e.message : String(e)}`); return null; }),
      this.prisma.questionnaireToken.count({
        where: { patientId, status: { in: ['SENT', 'OPENED'] }, expiresAt: { gte: new Date() } },
      }),
      this.prisma.prescription.findMany({
        where: { ...PortalService.MEDICATION_RX_WHERE, encounter: { patientId } },
        include: { medicationCode: { select: { nameKo: true } } },
        take: 10,
      }),
      this.getHealthDashboard(patientId),
    ]);

    // 검사 오더 확인 (금식 필요 여부)
    const pendingLabOrders = await this.prisma.order.findMany({
      where: {
        department: 'LAB',
        status: 'ORDERED',
        labResult: { patientId },
      },
      select: { id: true, notes: true },
      take: 5,
    });
    const hasFastingTest = pendingLabOrders.some(o => o.notes?.includes('금식') || o.notes?.includes('공복'));

    return {
      phase: 'PRE_VISIT',
      appointment: {
        id: appointment.id,
        scheduledAt: appointment.scheduledAt,
        daysUntil,
        doctor: appointment.doctor,
        department: appointment.doctor?.department ?? null,
        type: appointment.type ?? null,
        reason: appointment.reason ?? null,
      },
      checklist: {
        consentPending: pendingConsents ?? null,
        questionnairePending: pendingQuestionnaires,
        hasFastingTest,
        medicationCount: activeMeds.length,
      },
      activeMedications: activeMeds.map(p => ({
        id: p.id,
        drugName: p.medicationCode?.nameKo ?? null,
        dosage: p.dosage,
        frequency: p.frequency,
      })),
      healthDashboard,
    };
  }

  private async buildPreDischargeStatus(patientId: string, admission: any, dischargeSummary: any) {
    const daysSinceAdmit = stayDays(admission.admitDate) ?? 0;

    const [nextAppointment, todayMeds, interimBillings, satisfactionDone] = await Promise.all([
      this.prisma.appointment.findFirst({
        where: { patientId, status: 'SCHEDULED', scheduledAt: { gte: new Date() } },
        include: { doctor: { select: { familyName: true, givenName: true } } },
        orderBy: { scheduledAt: 'asc' },
      }),
      this.prisma.medicationAdministration.findMany({
        where: { patientId, scheduledAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
        include: { prescription: { include: { medicationCode: { select: { nameKo: true } } } } },
        orderBy: { scheduledAt: 'asc' },
        take: 20,
      }),
      this.prisma.interimBilling.findMany({
        // 무효(VOID) 회차는 받지도 청구하지도 않은 것 — 환자에게 보이지 않는다(2026-10-22)
        where: { admissionId: admission.id, status: { not: 'VOID' } },
        orderBy: { periodEnd: 'desc' },
        take: 5,
        select: { id: true, totalAmount: true, paidAmount: true, status: true },
      }),
      // 🔴 W9: 종전 `satisfactionSurveyDone: false` 상수. 이번 입원 이후 제출한 만족도 평가를 실제로 센다.
      this.prisma.satisfactionSurvey.count({ where: { patientId, createdAt: { gte: admission.admitDate } } }),
    ]);

    const totalBilled = interimBillings.reduce((s, b) => s + Number(b.totalAmount ?? 0), 0);
    const totalPaid = interimBillings.reduce((s, b) => s + Number(b.paidAmount ?? 0), 0);

    return {
      phase: 'PRE_DISCHARGE',
      admission: {
        id: admission.id,
        admitDate: admission.admitDate,
        daysSinceAdmit,
        ward: admission.bed?.ward?.name ?? null,
        room: admission.bed?.roomNumber ?? null,
        attendingDoctor: admission.attendingDoctor,
      },
      dischargeSummary: {
        dischargeDate: dischargeSummary.dischargeDate,
        diagnosis: dischargeSummary.dischargeDiagnosis,
        followUpPlan: dischargeSummary.followUpPlan,
        followUpDate: dischargeSummary.followUpDate,
        medications: dischargeSummary.dischargeMedications,
        dietaryInstructions: dischargeSummary.dietaryInstructions,
        activityRestrictions: dischargeSummary.activityRestrictions,
        patientEducation: dischargeSummary.patientEducation,
      },
      checklist: {
        dischargeSummarySigned: true, // 이 분기는 SIGNED/AMENDED 일 때만 호출된다(호출부 조건)
        // 🔴 W9(2026-08-14): 종전 `medicationReceived: false` — 퇴원약 수령 여부를 기록하는 정본이
        //    HIS 에 없는데도 화면에 **"수령 안 함"으로 단정**해 내려주고 있었다(P1: 모르는 것을 아는 척).
        //    모르면 null 로 말하고, 화면은 '확인 필요'로 그린다. 정본이 생기면 여기서 읽는다.
        medicationReceived: null,
        followUpBooked: !!nextAppointment,
        // 🔴 W9: 중간정산이 아예 없으면(totalBilled=0) 정산할 것이 없는지, 아직 안 올라온 것인지 모른다 → null
        billingSettled: totalBilled > 0 ? totalPaid >= totalBilled : null,
        satisfactionSurveyDone: satisfactionDone > 0,
      },
      nextAppointment,
      billing: { total: totalBilled, paid: totalPaid, remaining: totalBilled - totalPaid },
      todayMedications: todayMeds.map(m => ({
        id: m.id,
        drugName: m.prescription?.medicationCode?.nameKo ?? null,
        dose: m.dose,
        scheduledAt: m.scheduledAt,
        status: m.status,
      })),
    };
  }

  private async buildIdleStatus(patientId: string) {
    const account = await this.prisma.patientAccount.findFirst({ where: { patientId }, select: { id: true } });

    const [nextAppointment, activeMeds, recentEncounter, healthDashboard, unreadNotifications] = await Promise.all([
      this.prisma.appointment.findFirst({
        where: { patientId, status: 'SCHEDULED', scheduledAt: { gte: new Date() } },
        include: { doctor: { select: { familyName: true, givenName: true } } },
        orderBy: { scheduledAt: 'asc' },
      }),
      this.prisma.prescription.findMany({
        where: { ...PortalService.MEDICATION_RX_WHERE, encounter: { patientId } },
        include: { medicationCode: { select: { nameKo: true } } },
        take: 10,
      }),
      this.prisma.encounter.findFirst({
        where: { patientId, status: 'SIGNED' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, chiefComplaint: true },
      }),
      this.getHealthDashboard(patientId),
      account ? this.prisma.patientNotification.count({ where: { accountId: account.id, isRead: false } }) : Promise.resolve(0),
    ]);

    return {
      phase: 'IDLE',
      nextAppointment,
      activeMedications: activeMeds.map(p => ({
        id: p.id,
        drugName: p.medicationCode?.nameKo ?? null,
        dosage: p.dosage,
        frequency: p.frequency,
      })),
      lastEncounter: recentEncounter,
      healthDashboard,
      unreadNotifications,
    };
  }

  /**
   * 환자 여정 타임라인 (환자용)
   * 직원용 journey/timeline의 환자 뷰 — 본인 데이터만 접근
   *
   * (2026-10-01 여정 P3 · 포털 검토)
   *  · 행마다 `label`·`track` — shared 표시 정본(`journeyEventDisplay`)의 **유형별 고정 문구**. 모바일은 shared 를 import 하지 않으므로
   *    서버가 싣는다. 종전 모바일은 `description` 만 그렸는데 설명 안전 유형 밖은 null 이라 **대부분의 행이 빈 줄**이었다.
   *    자유 `title` 은 싣지 않는다(직원 코드·처분값이 섞인다 — 예 `응급 처분 변경: ADMISSION → …`).
   *  · 시각 — `occurredAt`(발생·null 가능)·출처·정밀도·`createdAt`(기록 시각)을 그대로 싣는다. 발생 시각이 없으면 화면은 날짜만 말한다.
   *  · 잘림 — `take: N+1` 로 더 있는지 보고 `truncated` 로 말한다(종전엔 ≤100 에서 조용히 잘랐다).
   *    `opts.withMeta` 일 때만 `{ items, truncated }` 를 돌려준다 — 배열을 기대하는 기존 호출부·스펙은 그대로.
   */
  async getJourneyTimeline(patientId: string, from?: string, to?: string, limit?: number): Promise<PortalJourneyTimelineItem[]>;
  async getJourneyTimeline(patientId: string, from: string | undefined, to: string | undefined, limit: number | undefined, opts: { withMeta: true }): Promise<{ items: PortalJourneyTimelineItem[]; truncated: boolean }>;
  async getJourneyTimeline(patientId: string, from?: string, to?: string, limit = 50, opts?: { withMeta?: boolean }) {
    // 🔴 (2026-10-01 P3 · A9) 날짜 경계는 정본 `dayRange`(KST) — 종전 `new Date(from)`·`lte: new Date(to)` 는
    //    date-only 를 UTC 자정으로 읽어 9시간 밀렸고 `to` 의 그날 하루가 통째로 빠졌다.
    //    모바일은 지금 시각 포함 ISO(`toISOString()`)를 보낸다 — `dayRange` 는 시각이 있는 값은 **그 순간 그대로** 쓰고
    //    date-only 일 때만 KST 자정·'그날 끝까지(lt 다음 날)' 로 푼다. 그래서 두 형식을 같은 정본으로 받는다(못 읽으면 400).
    const range = dayRange(from, to);
    const take = Math.min(Math.max(Number.isFinite(limit) ? limit : 50, 1), 100);

    const rows = await this.prisma.patientJourneyEvent.findMany({
      // 🔴 (2026-09-14) 유형 필터가 없어 직원 내부 이벤트(암등록 후보·청구 심사·청구 생성 실패 오류 메시지)가 환자에게 나갔다.
      //    환자 노출 유형만(shared 정본 · 어휘 밖은 제외) · 내부 식별자가 섞일 수 있는 metadata 는 환자 응답에서 뺀다(소비처 mobile 은 쓰지 않는다).
      where: {
        patientId,
        eventType: { in: [...PATIENT_VISIBLE_JOURNEY_EVENT_TYPES] },
        ...(range ? { eventAt: range } : {}),
      },
      orderBy: [{ eventAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      select: {
        id: true, eventType: true, eventAt: true, description: true,
        severity: true, refType: true,
        occurredAt: true, occurredAtSource: true, occurredAtPrecision: true, createdAt: true,
      },
    });
    const truncated = rows.length > take;
    const events = rows.slice(0, take);

    // 🔴 (P3 · B10) ER_CHECKOUT 설명은 `처분: <코드>`(emergency.service checkout) — 설명 안전 유형이라 원 코드(`ADMISSION`)가 환자에게 나갔다.
    //    처분 어휘 정본 = Prisma `EmergencyDisposition`(DTO `EmergencyDispositionFull` 7종). 환자 말로 바꾸고,
    //    사망(DEATH)·어휘 밖·형식 밖은 설명을 싣지 않는다(코드를 보이지 않는다 — fail-closed).
    const ER_CHECKOUT_PATIENT_TEXT: Readonly<Record<string, string>> = {
      DISCHARGE: '퇴실 후 귀가', ADMISSION: '퇴실 후 입원', TRANSFER: '퇴실 후 다른 병원으로 전원',
      OBSERVATION: '퇴실 후 관찰', SURGERY: '퇴실 후 수술', LEAVE_AMA: '퇴실(자의 퇴원)',
    };
    const erCheckoutText = (desc: string | null): string | null => {
      const m = desc ? /^처분:\s*([A-Z_]+)\s*$/.exec(desc) : null;
      return m ? ER_CHECKOUT_PATIENT_TEXT[m[1]] ?? null : null;
    };

    // 🔴 (2026-09-14) 설명은 원문으로 싣지 않는다 — 처방·오더·응급·영상·퇴원 등 과거 행 설명에 직원 자유 입력(오더 메모·판독 소견·사유)이
    //    저장돼 있다(소급 수정 안 함). 설명 안전 유형만 통과(shared `patientJourneyDescription` · fail-closed).
    const items: PortalJourneyTimelineItem[] = events.map((e) => {
      const safe = patientJourneyDescription(e.eventType, e.description);
      const display = journeyEventDisplay(e.eventType);
      return {
        ...e,
        description: e.eventType === 'ER_CHECKOUT' ? erCheckoutText(safe) : safe,
        label: display?.label ?? null,
        track: display?.track ?? null,
      };
    });
    return opts?.withMeta ? { items, truncated } : items;
  }

  // ── F-3 입원 생활 (기획 patient-portal-enhancement §3.3 · config portal.inpatientLife 게이트) ──

  /** config OFF면 404 — FE는 카드 미렌더(기능 부재와 동일 취급) */
  /** 세션 능력표 — 입원 생활(식이·중간 정산) 설정 */
  /** 포털 첫 안내 상태 — 계정이 있으면 계정 기록, 없으면 기기 몫(서버는 모른다) */
  async getOnboardingState(accountId: string | null): Promise<{ scope: 'ACCOUNT' | 'DEVICE'; completedAt: string | null }> {
    if (!accountId) return { scope: 'DEVICE', completedAt: null };
    const a = await this.prisma.patientAccount.findUnique({ where: { id: accountId }, select: { onboardingCompletedAt: true } });
    return { scope: 'ACCOUNT', completedAt: a?.onboardingCompletedAt?.toISOString() ?? null };
  }

  /** 포털 첫 안내 완료 — 처음 한 번만 시각을 남긴다(이미 있으면 그대로 · 다시 보기는 기록을 바꾸지 않는다) */
  async completeOnboarding(accountId: string | null): Promise<{ recorded: boolean; scope: 'ACCOUNT' | 'DEVICE'; completedAt: string | null }> {
    if (!accountId) return { recorded: false, scope: 'DEVICE', completedAt: null };
    const now = new Date();
    const { count } = await this.prisma.patientAccount.updateMany({ where: { id: accountId, onboardingCompletedAt: null }, data: { onboardingCompletedAt: now } });
    if (count === 1) return { recorded: true, scope: 'ACCOUNT', completedAt: now.toISOString() };
    const a = await this.prisma.patientAccount.findUnique({ where: { id: accountId }, select: { onboardingCompletedAt: true } });
    if (!a) throw new NotFoundException('계정을 찾을 수 없습니다.');
    return { recorded: false, scope: 'ACCOUNT', completedAt: a.onboardingCompletedAt?.toISOString() ?? null };
  }

  async isInpatientLifeEnabled(): Promise<boolean> {
    return (await this.configRuntime.get('portal.inpatientLife')) === true;
  }

  private async assertInpatientLifeEnabled() {
    if ((await this.configRuntime.get('portal.inpatientLife')) !== true) {
      // 화면이 "기능 꺼짐(카드 없음)"과 "조회 실패"를 가를 수 있게 고정 코드로 말한다(2026-10-19)
      throw new NotFoundException({ code: 'PORTAL_INPATIENT_LIFE_DISABLED', message: '입원 생활 조회가 비활성화되어 있습니다.' });
    }
  }

  /** 본인 활성 입원 조회(없으면 404) — 두 EP 공통 스코프 가드 */
  private async findActiveAdmissionOrThrow(patientId: string) {
    const adm = await this.prisma.admission.findFirst({
      where: { patientId, status: 'ADMITTED' },
      select: { id: true },
    });
    if (!adm) throw new NotFoundException('입원 정보가 없습니다.');
    return adm;
  }

  /** 입원 식이 정보 — 오늘·내일 끼니(식이 종류·배송 상태) + 활성 식이 처방. 메뉴 텍스트는 데이터 부재(설계 §2.1) */
  async getInpatientMeals(patientId: string) {
    await this.assertInpatientLifeEnabled();
    const adm = await this.findActiveAdmissionOrThrow(patientId);
    // 🔴 mealOrder.date 는 @db.Date — 로컬 자정(setHours)은 하루 밀린다. 정본 todayDateOnly()로 오늘~내일(배타 이틀 뒤).
    const today = todayDateOnly();
    const dayAfterTomorrow = new Date(today.getTime() + 2 * 86400000);
    const [diet, meals] = await Promise.all([
      this.prisma.dietOrder.findFirst({
        where: { admissionId: adm.id, isActive: true },
        orderBy: { createdAt: 'desc' },
        select: { dietType: true, calorieTarget: true, restrictions: true, texture: true, notes: true },
      }),
      this.prisma.mealOrder.findMany({
        where: { admissionId: adm.id, date: { gte: today, lt: dayAfterTomorrow } },
        orderBy: [{ date: 'asc' }, { mealType: 'asc' }],
        select: { date: true, mealType: true, dietType: true, status: true, allergies: true },
      }),
    ]);
    return { diet, meals };
  }

  /** 입원비 중간정산 — ERP interim invoice. chartNo(=mrn)는 세션 환자에서 서버 주입(IDOR 방지·파라미터 없음)
   *  ERP 호출은 billing.service.getErpInvoice와 동일 스펙을 인라인 — BillingModule import는 순환(Voucher→PatientAuth 경유)으로 부트 실패라 금지 */
  async getInpatientInterimBill(patientId: string) {
    await this.assertInpatientLifeEnabled();
    await this.findActiveAdmissionOrThrow(patientId);
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { mrn: true } });
    if (!patient) throw new NotFoundException('환자 정보를 찾을 수 없습니다.');
    const base = (await this.configRuntime.get('erp.webhookUrl')) as string;
    const key = (await this.configRuntime.get('erp.integrationKey')) as string;
    if (!base) return { available: false };
    try {
      const qs = new URLSearchParams({ chartNo: patient.mrn, interim: 'true' });
      const res = await fetch(`${base.replace(/\/$/, '')}/api/v1/integration/billing/invoice?${qs.toString()}`, {
        headers: { 'X-Integration-Key': key ?? '' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { available: false };
      const raw = (await res.json()) as Record<string, unknown>;
      if (raw.available === false) return { available: false };
      return {
        available: true,
        invoice: {
          asOf: raw.as_of,
          total: raw.total,
          insurerShare: raw.insurer_share,
          patientShare: raw.patient_share,
          nonCovered: raw.non_covered,
          prepaid: raw.prepaid,
          balanceDue: raw.balance_due,
        },
        notice: '확정 금액이 아닙니다. 최종 진료비는 퇴원 수납 시 확정됩니다.',
      };
    } catch {
      return { available: false };
    }
  }

  /**
   * 입원 상세 (환자용) — 일별 요약 포함
   */
  async getInpatientDetail(patientId: string) {
    // 🔴 아래 `...admission` 이 Admission 전 컬럼을 그대로 펼친다 — 병상·담당의 내부 UUID 포함.
    //    화면은 bed.ward.name·bed.roomNumber·bed.bedNumber 와 attendingDoctor 이름만 쓴다(mobile `journey/inpatient-detail`).
    const admission = await this.prisma.admission.findFirst({
      where: { patientId, status: 'ADMITTED' },
      omit: PATIENT_FACING_OMIT.admission,
      include: {
        bed: { include: { ward: true } },
        attendingDoctor: { select: { familyName: true, givenName: true } },
        // 🔴 (2026-10-20 B2 · 결정 portal.visitSummaryScope = GENERAL) 의사 소견(assessment)·회진 기록 원문(notes·plan)은 싣지 않는다 —
        //    종전엔 작성 중(DRAFT) 진료기록의 평가까지 환자 앱에 나갔다. 일시·담당만.
        encounters: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, chiefComplaint: true, createdAt: true, status: true },
        },
        rounds: {
          orderBy: { roundedAt: 'desc' },
          take: 5,
          select: { id: true, roundedAt: true, doctor: { select: { familyName: true, givenName: true } } },
        },
      },
    });

    if (!admission) return null;

    const [labResults, surgeries, interimBillings] = await Promise.all([
      this.prisma.labResult.findMany({
        // 채취 시각이 없는 결과(채취 미기록 · 2026-10-01 이후 접수 시각으로 채우지 않는다)는 결과 시각으로 입원 기간을 가른다
        where: { patientId, status: 'COMPLETED', OR: [{ collectedAt: { gte: admission.admitDate } }, { collectedAt: null, completedAt: { gte: admission.admitDate } }] },
        orderBy: { completedAt: 'desc' },
        take: 20,
        include: {
          order: { select: { acknowledgedAt: true } },
          items: { select: { testName: true, value: true, unit: true, normalMin: true, normalMax: true, flag: true } },
        },
      }),
      this.prisma.surgery.findMany({
        where: { patientId, scheduledAt: { gte: admission.admitDate } },
        orderBy: { scheduledAt: 'desc' },
        select: { id: true, procedureName: true, scheduledAt: true, startedAt: true, endedAt: true, status: true },
      }),
      this.prisma.interimBilling.findMany({
        // 무효(VOID) 회차는 받지도 청구하지도 않은 것 — 환자에게 보이지 않는다(2026-10-22)
        where: { admissionId: admission.id, status: { not: 'VOID' } },
        orderBy: { periodEnd: 'desc' },
        select: { id: true, periodStart: true, periodEnd: true, totalAmount: true, paidAmount: true, status: true },
      }),
    ]);

    // 🔴 (2026-10-20 B8) 결과 목록과 같은 공개 규칙 — 종전엔 위급값 가림·의료진 확인 전 판정 비움이 여기서 빠졌다
    const openCritical = await this.openCriticalByLab(labResults.map((r) => r.id));
    return {
      ...admission,
      labResults: labResults.map(r => {
        const reviewed = r.order?.acknowledgedAt != null;
        return {
          id: r.id, completedAt: r.completedAt,
          release: labReleaseState(r.order?.acknowledgedAt ?? null), reviewedAt: r.order?.acknowledgedAt ?? null,
          items: r.items.map((it) => ({ testName: it.testName, normalMin: it.normalMin, normalMax: it.normalMax, ...releasedLabItem(it, { reviewed, openCriticalNames: openCritical.get(r.id) }) })),
        };
      }),
      surgeries,
      interimBillings,
      daysSinceAdmit: stayDays(admission.admitDate) ?? 0,
    };
  }

  /**
   * 문진표 — 활성 문진표 조회 (QuestionnaireToken 기반)
   */
  async getActiveQuestionnaires(patientId: string) {
    // 미완료 문진표 토큰 조회
    const tokens = await this.prisma.questionnaireToken.findMany({
      where: {
        patientId,
        status: { in: ['SENT', 'OPENED', 'IN_PROGRESS'] },
        expiresAt: { gte: new Date() },
      },
      include: {
        formSchema: { select: { id: true, name: true, description: true, category: true, estimatedMinutes: true, schema: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (tokens.length > 0) {
      return tokens.map(t => ({
        tokenId: t.id,
        token: t.token,
        appointmentId: t.appointmentId,
        status: t.status,
        formSchema: t.formSchema,
        expiresAt: t.expiresAt,
        sentVia: t.sentVia,
      }));
    }

    // 토큰이 없으면 오늘 예약 기반으로 안내
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    const appointments = await this.prisma.appointment.findMany({
      where: { patientId, scheduledAt: { gte: today, lt: tomorrow }, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
      select: { id: true, doctor: { select: { familyName: true, givenName: true } } },
    });

    return appointments.map(a => ({
      tokenId: null,
      appointmentId: a.id,
      doctor: a.doctor ? `${a.doctor.familyName}${a.doctor.givenName}` : null,
      status: 'PENDING',
      message: '오늘 진료를 위한 문진표를 작성해주세요.',
    }));
  }

  /**
   * 문진표 제출 (FormSubmission 생성 + QuestionnaireToken 완료 처리)
   */
  async submitQuestionnaire(patientId: string, data: { tokenId?: string; formSchemaId?: string; responses: Record<string, any> }) {
    // 토큰 기반 제출
    if (data.tokenId) {
      const token = await this.prisma.questionnaireToken.findFirst({
        where: { id: data.tokenId, patientId },
      });
      if (!token) throw new NotFoundException('문진표를 찾을 수 없습니다');

      const submission = await this.prisma.formSubmission.create({
        data: {
          formSchemaId: token.formSchemaId,
          patientId,
          data: data.responses as any,
          submittedBy: patientId,
          formSchemaRevision: await currentFormRevision(this.prisma, token.formSchemaId),
        },
      });

      await this.prisma.questionnaireToken.update({
        where: { id: token.id },
        data: { status: 'COMPLETED', completedAt: new Date(), submissionId: submission.id },
      });

      return submission;
    }

    // 직접 제출 (formSchemaId 필수)
    if (!data.formSchemaId) throw new BadRequestException('tokenId 또는 formSchemaId가 필요합니다');

    return this.prisma.formSubmission.create({
      data: {
        formSchemaId: data.formSchemaId,
        patientId,
        data: data.responses as any,
        submittedBy: patientId,
        formSchemaRevision: await currentFormRevision(this.prisma, data.formSchemaId),
      },
    });
  }
}
