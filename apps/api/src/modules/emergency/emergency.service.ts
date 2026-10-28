import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { ageOf, EMERGENCY_VISIT_STATUS_LABEL } from '@hospital-run/shared';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { JourneyService } from '../journey/journey.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { EncounterService } from '../encounter/encounter.service';
import { AdmissionService } from '../admission/admission.service';
import { PatientSafetyService } from '../patient-safety/patient-safety.service';
import { NotificationService } from '../notification/notification.service';
import { AuditService } from '../audit/audit.service';
import { ascendingBoundsOr, mergeTargetMap, KTAS_REASSESS_MIN } from '../../common/qi-targets';
import { assertStateTransition, stateChangedConflict, TransitionMap, TransitionContext } from '../../common/state-transition';
import { ErBedService } from './er-bed.service';
import {
  CreateTriageDto,
  UpdateEmergencyStatusDto,
  RecordVitalSignsDto,
  TransferToAdmissionDto,
  KtasLevel,
  EmergencyQueueItemDto,
  EmergencyStatsDto,
} from './dto/emergency.dto';

// KTAS 재평가 간격 폴백은 common/qi-targets 로 승격(ER 베드 보드와 공유·이중 선언 금지)

// NEDOCS 등급 경계(2~6등급 진입 점수) — 개정 표면 = config `qi.targets.nedocsBounds`. 라벨·산식 계수는 불변.
const NEDOCS_BOUNDS = [20, 60, 100, 140, 180];

/**
 * 처분 기록 없이 시한 경과로 자동 종결된 응급 방문의 표식 — **처분 자체는 비워 둔다**.
 * 어휘(`EmergencyDisposition`)에 '미상'이 없으므로 귀가로 적지 않는다(D3·2026-09-15).
 */
export const AUTO_CLOSE_NO_DISPOSITION_NOTE = 'AUTO_CLOSE_NO_DISPOSITION';
const NEDOCS_LEVELS = [
  { grade: 1, label: '정상', tone: 'ok' },
  { grade: 2, label: '분주', tone: 'ok' },
  { grade: 3, label: '매우 분주', tone: 'warn' },
  { grade: 4, label: '과밀', tone: 'warn' },
  { grade: 5, label: '심각 과밀', tone: 'danger' },
  { grade: 6, label: '위험 과밀', tone: 'danger' },
] as const;

/**
 * ER 방문 상태 어휘 — 정본은 shared `EMERGENCY_VISIT_STATUS_LABEL`(8상태). 여기서 파생해 라벨과 갈라지지 않게 한다.
 * 전이 표는 **되돌릴 수 없는 것 하나만** 못박는다: `COMPLETED` 는 종착이다(처분·입원 연계·베드 해제·청구가 끝난 상태).
 * 그 밖의 재실 상태끼리는 실제 진료가 왕복하므로(관찰↔처치·결과대기↔처치) 막지 않는다 —
 * 겪지 않은 순서를 지어내 강제하면 거짓 데이터가 된다.
 */
export type EmergencyVisitStatus = string;
const ER_ACTIVE_STATUSES = Object.keys(EMERGENCY_VISIT_STATUS_LABEL).filter((s) => s !== 'COMPLETED');
export const EMERGENCY_VISIT_TRANSITIONS: TransitionMap<EmergencyVisitStatus> = Object.fromEntries(
  Object.keys(EMERGENCY_VISIT_STATUS_LABEL).map((from) => [
    from,
    from === 'COMPLETED' ? [] : [...ER_ACTIVE_STATUSES.filter((t) => t !== from), 'COMPLETED'],
  ]),
);
export const EMERGENCY_VISIT_TX_CTX: TransitionContext = {
  code: 'ER_VISIT',
  message: '종결된 응급 방문은 되돌릴 수 없습니다',
};

@Injectable()
export class EmergencyService {
  private readonly logger = new Logger(EmergencyService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly journey?: JourneyService,
    @Optional() private readonly medicalAi?: MedicalAiService,
    @Optional() private readonly encounters?: EncounterService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
    @Optional() private readonly admissions?: AdmissionService,
    @Optional() private readonly patientSafety?: PatientSafetyService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly notifications?: NotificationService,
    // 동일 모듈 provider — @Optional 은 스펙의 수기 생성(new EmergencyService(...)) 호환용
    @Optional() private readonly erBeds?: ErBedService,
    // 처분 변경 시 **변경 전 스냅샷 보존처**. 없으면 변경을 거부한다(보존 없는 덮어쓰기 금지).
    @Optional() private readonly audit?: AuditService,
  ) {}

  // 처치 기록 — 치료 노트 저장 + 상태 IN_TREATMENT 전이(멱등: 노트 append 아닌 최신값 반영)
  async recordTreatment(visitId: string, userId: string, note?: string) {
    const visit = await this.prisma.emergencyVisit.findUnique({ where: { id: visitId }, select: { id: true, status: true, patientId: true, treatmentStartedAt: true } });
    if (!visit) throw new NotFoundException('응급 방문을 찾을 수 없습니다');
    const updated = await this.prisma.emergencyVisit.update({
      where: { id: visitId },
      data: {
        treatmentNote: note,
        treatmentStartedAt: new Date(),
        // 이미 처분/완료 단계면 상태 되돌리지 않음
        ...(['PENDING_DISPOSITION', 'COMPLETED', 'UNDER_OBSERVATION'].includes(visit.status) ? {} : { status: 'IN_TREATMENT' }),
      },
      select: { id: true, status: true, treatmentNote: true, treatmentStartedAt: true },
    });
    // 여정 ER_TREATMENT_START — 위치 매핑(journey.service)·타임라인은 이 이름을 기다리는데 발행 지점이 0 이었다.
    // 처치 기록은 멱등 갱신이라 **처음 시작한 때만** 남긴다(노트 수정마다 "처치 시작"이 쌓이지 않게).
    if (!visit.treatmentStartedAt) {
      this.journey?.emit({
        patientId: visit.patientId, eventType: 'ER_TREATMENT_START',
        title: '응급 처치 시작', department: '응급의학과',
        refType: 'EmergencyVisit', refId: visitId,
        occurredAt: updated.treatmentStartedAt ?? null, // 여정 P1: 도메인 시각(없으면 미상 — 지어내지 않는다)
      });
    }
    return updated;
  }

  // 코드 알림 방송 — 활성 응급 의료진(DOCTOR/NURSE)에게 위급 알림 전파
  async broadcastCodeAlert(userId: string, code?: string, location?: string) {
    if (!code) throw new BadRequestException('code는 필수입니다');
    const loc = location || '응급실';
    let notified = 0;
    if (this.notifications) {
      const staff = await this.prisma.user.findMany({
        where: { isActive: true, role: { in: ['DOCTOR', 'NURSE'] } },
        select: { id: true },
        take: 500,
      });
      // 🔴 종전엔 refId 에 코드 문자열('CODE BLUE')을 넘겼다. refId 는 @db.Uuid 라 Prisma 가
      //    P2023 으로 죽었고, 아래 catch 가 그걸 삼켜 **한 명도 못 받았는데 "N명 통보"** 로 남았다
      //    (운영 실측: CODE_ALERT 알림 0건). 코드는 제목·본문에 이미 있으므로 링크는 붙이지 않는다.
      const results = await Promise.all(
        staff.map((s) =>
          this.notifications!.notify(s.id, {
            type: 'CODE_ALERT',
            title: `🚨 ${code} 발동`,
            message: `${loc}에서 ${code}가 발동되었습니다. 즉시 대응 바랍니다.`,
            severity: 'critical',
            refType: 'emergency_code',
          }).then(() => true).catch((e) => { this.logger.error(`[CODE-ALERT] 통보 실패 user=${s.id}: ${(e as Error).message}`); return false; }),
        ),
      );
      // 실제로 도달한 인원만 센다 — 발송 시도 수를 통보 수로 보고하면 실패가 성공으로 보인다
      notified = results.filter(Boolean).length;
      if (notified < staff.length) {
        this.logger.error(`🔴 [CODE-ALERT] ${code} 통보 일부 실패: ${staff.length - notified}/${staff.length}`);
      }
    }
    this.logger.warn(`[CODE-ALERT] ${code} @ ${loc} by ${userId} → ${notified} staff notified`);
    return { code, location: loc, notified, at: new Date().toISOString() };
  }

  /**
   * 응급 수납 자동화(A) — 처분 시 ER_CONSULT 진료기록을 보장·서명 → encounter.signed 리스너가 청구 생성.
   * 멱등: arrivalAt 이후 동일 환자 ER_CONSULT가 있으면 재사용(재처분 시 중복 청구 방지).
   * 비차단(실패해도 처분은 진행). EncounterService 미주입(단위테스트) 시 스킵.
   */
  private async ensureErEncounterBilled(
    visit: { id: string; patientId: string; chiefComplaint: string | null; triageLevel: string; arrivalAt: Date },
    userId: string,
    note?: string,
  ): Promise<void> {
    if (!this.encounters) return;
    try {
      const existing = await this.prisma.encounter.findFirst({
        where: { patientId: visit.patientId, visitType: 'ER_CONSULT', createdAt: { gte: visit.arrivalAt } },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        if (existing.status === 'DRAFT') await this.encounters.sign(existing.id, userId); // 미서명이면 서명→청구
        return; // 이미(또는 방금) 서명 → 청구 존재
      }
      const created = await this.encounters.create(
        {
          patientId: visit.patientId,
          visitType: 'ER_CONSULT',
          subjective: visit.chiefComplaint ?? '응급 진료',
          assessment: `KTAS ${visit.triageLevel}`,
          plan: note ?? '응급 처치 후 처분',
        },
        userId,
      );
      await this.encounters.sign(created.id, userId); // DRAFT→SIGNED→encounter.signed→billing 자동 생성
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.logger.warn(`응급 청구 자동 생성 실패(visit ${visit.id}): ${reason}`);
      // 알림화(논블로킹): silent 실패 대신 이벤트+저니 발행 → 운영/수납에서 수동 보정 가시화.
      this.eventEmitter?.emit('emergency.billing_failed', { visitId: visit.id, patientId: visit.patientId, reason });
      this.journey?.emit({
        patientId: visit.patientId, eventType: 'ER_BILLING_FAILED', refType: 'EmergencyVisit', refId: visit.id, // 여정 P0-5: 방문 단위 귀속
        title: '응급 청구 자동생성 실패', description: `수동 확인·청구 필요 (${reason.slice(0, 80)})`,
      });
    }
  }

  /** AI 트리아지 재평가 — 증상 기반 KTAS 레벨 추천 */
  async aiTriageReassessment(visitId: string) {
    const visit = await this.prisma.emergencyVisit.findUnique({
      where: { id: visitId },
      include: { patient: { select: { dateOfBirth: true, gender: true } } },
    });
    if (!visit) throw new NotFoundException('응급 방문을 찾을 수 없습니다');
    if (!this.medicalAi) return { visitId, patientId: visit.patientId, suggestion: null, source: 'FALLBACK' };
    try {
      const result = await this.medicalAi.triage(visit.chiefComplaint ?? '', {
        age: ageOf(visit.patient.dateOfBirth) ?? undefined,
        sex: visit.patient?.gender ?? undefined,
      });
      return { visitId, patientId: visit.patientId, currentLevel: visit.triageLevel, suggestion: result, source: 'AI' };
    } catch (e) {
      this.logger.warn(`AI 트리아지 재평가 실패: ${e}`);
      return { visitId, patientId: visit.patientId, suggestion: null, source: 'FALLBACK' };
    }
  }

  /**
   * 응급 접수 + 중증도 분류(KTAS).
   *
   * 🔴 `triageLevel` 은 **필수**다 — 등급이 확정된 순간이 분류가 끝난 순간이다.
   *    그런데 개통 이래 이 경로는 등급만 저장하고 **분류 시각·분류자를 남기지 않았고**
   *    상태를 `PENDING_TRIAGE`(분류 대기)로 두면서 여정에는 "트리아지 완료"를 발행했다
   *    (P16 — 실행하지 않고 성공 상태만 기록). `triagedAt`/`triageNurseId` 를 쓰는 런타임
   *    코드가 **하나도 없었다**(유일한 쓰기가 시드 생성기 `dev-demo`).
   *    그 결과 운영에서 실측된 것:
   *      · 공개 전광판이 분류 끝난 환자를 '도착' 단계에 세운다(`currentStage` 0)
   *      · 여정 관제 카드가 `ER_ARRIVED` 에 멈춰 KTAS 목표 초과 시 **TRIAGE_DELAY 거짓 경보**
   *      · door-to-triage 지표가 **시드가 박은 10분만** 잰다(실건은 분모에서 조용히 제외·위반율 0%)
   *      · 누가 분류했는지 원장에 없다(응급의료법 중증도 분류는 법정 기록)
   *    분류 사실을 원장에 남긴다 — 등급을 정한 주체와 시각은 **추정이 아니라 이 요청이 아는 사실**이다.
   */
  async createTriage(dto: CreateTriageDto, userId?: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: dto.patientId },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const isNonEmergency = dto.triageLevel === 'LEVEL_5';
    const triagedAt = new Date();
    // 도착 시각을 알면 그것을 쓴다. 모르면 접수 시각(=분류 시각)이며, 그때 door-to-triage 는
    // 0분이 아니라 **산출 불가**다(분석이 동시 기록 건을 분모에서 가른다).
    // 🔴 미래 도착은 사실이 아니다 — 조용히 고치지 않고 거절한다.
    const claimedArrival = dto.arrivalAt ? new Date(dto.arrivalAt) : null;
    if (claimedArrival && Number.isNaN(claimedArrival.getTime())) {
      throw new BadRequestException('도착 시각 형식이 올바르지 않습니다');
    }
    if (claimedArrival && claimedArrival.getTime() > triagedAt.getTime()) {
      throw new BadRequestException('도착 시각이 분류 시각보다 미래일 수 없습니다');
    }
    const emergencyVisit = await this.prisma.emergencyVisit.create({
      data: {
        patientId: dto.patientId,
        triageLevel: dto.triageLevel,
        chiefComplaint: dto.chiefComplaint,
        arrivalAt: claimedArrival ?? triagedAt,
        triageNote: dto.notes || null,
        // 🔴 등급이 확정됐으므로 '분류 대기'가 아니다. 상태 어휘는 스키마 정본(TRIAGED)을 쓴다.
        status: 'TRIAGED',
        triagedAt,
        // 분류자를 모르면 박지 않는다(모르는 것을 지어내지 않는다) — 가드가 EP 배선을 강제한다.
        triageNurseId: userId ?? null,
        isNonEmergency,
      },
      include: {
        patient: { select: { familyName: true, givenName: true } },
      },
    });

    this.journey?.emit({
      patientId: dto.patientId, eventType: 'ER_ARRIVAL', refType: 'EmergencyVisit', refId: emergencyVisit.id, // 여정 P0-5: 방문 단위 귀속
      title: '응급실 도착',
      // 🔴 (2026-09-14) 환자 노출 유형 — 직원 자유 입력(메모·사유·소견)을 설명에 싣지 않는다(포털 타임라인에 그대로 나갔다). 원문은 원 기록이 정본.
      department: '응급의학과', severity: 'WARNING',
      // 여정 P1: 도착 시각 — 직원이 입력한 과거 시각이면 `USER_CLAIMED`(관측이 아니라 주장), 아니면 접수 순간
      occurredAt: emergencyVisit.arrivalAt, occurredAtSource: claimedArrival ? 'USER_CLAIMED' : 'DOMAIN_FIELD',
    });
    this.journey?.emit({
      patientId: dto.patientId, eventType: 'ER_TRIAGE', occurredAt: triagedAt, refType: 'EmergencyVisit', refId: emergencyVisit.id, // 여정 P0-5: 방문 단위 귀속
      title: `트리아지 완료 (${dto.triageLevel})`,
      department: '응급의학과', severity: dto.triageLevel === 'LEVEL_1' ? 'CRITICAL' : 'WARNING',
    });
    // 여정 프로토콜(ER) 자동 생성 트리거(부작용 — 리스너가 인스턴스 보장)
    this.eventEmitter?.emit('emergency.created', { emergencyVisitId: emergencyVisit.id, patientId: dto.patientId });

    return emergencyVisit;
  }

  async recordVitalSigns(emergencyVisitId: string, dto: RecordVitalSignsDto, userId?: string) {
    const visit = await this.prisma.emergencyVisit.findUnique({
      where: { id: emergencyVisitId },
    });
    if (!visit) throw new NotFoundException('Emergency visit not found');

    // Create vital signs data as JSON
    const vitalData = {
      systolicBP: dto.systolicBP,
      diastolicBP: dto.diastolicBP,
      heartRate: dto.heartRate,
      respiratoryRate: dto.respiratoryRate,
      spO2: dto.spO2,
      temperature: dto.temperature,
      consciousness: dto.consciousness,
      recordedAt: new Date(),
    };

    const updated = await this.prisma.emergencyVisit.update({
      where: { id: emergencyVisitId },
      data: { vitalSigns: vitalData },
    });

    // NEWS2 이력화+에스컬레이션(P3) — 최신값 덮어쓰기(vitalSigns)는 유지하되, EarlyWarningScore로 추이·조기경보를
    //  확보(병동·ICU와 통일). 기존: ER 활력이 단일 JSON 덮어쓰기라 추이 소실·조기경보 미연동.
    const nurseId = userId ?? visit.doctorId ?? undefined;
    const rr = dto.respiratoryRate, sp = dto.spO2, sbp = dto.systolicBP, hr = dto.heartRate, temp = dto.temperature, cons = dto.consciousness;
    if (this.patientSafety && nurseId && rr != null && sp != null && sbp != null && hr != null && temp != null && cons) {
      try {
        await this.patientSafety.calculateAndSaveEws(visit.patientId, nurseId, {
          respiratoryRate: rr, spO2: sp, supplementalO2: false, spO2Scale: 1,
          systolicBp: sbp, heartRate: hr, consciousness: cons, temperature: temp,
        });
      } catch (e) {
        this.logger.warn(`ER EWS 자동 산출 실패(비차단): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return updated;
  }

  async getAllVisits() {
    return this.prisma.emergencyVisit.findMany({
      include: {
        patient: {
          select: {
            id: true, familyName: true, givenName: true, dateOfBirth: true,
            mrn: true, gender: true, bloodType: true, phone: true,
            insuranceType: true, allergies: true,
          },
        },
        // 🔴 현행 처분 기록을 함께 준다 — 이게 없으면 처분 변경 화면이 **빈 칸에서** 다시 쓰게 되고,
        //    보이지 않는 귀가지침·전원기관이 조용히 지워진다(보이는 것과 저장되는 것이 달라진다).
        dispositionRecord: true,
      },
      orderBy: [{ triageLevel: 'asc' }, { arrivalAt: 'desc' }],
    });
  }

  async getStats() {
    const all = await this.prisma.emergencyVisit.findMany();
    const current = all.filter(v => !v.disposition).length;
    const byLevel = all.reduce((acc, v) => {
      if (!v.disposition) acc[v.triageLevel] = (acc[v.triageLevel] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return { current, total: all.length, byLevel };
  }

  async getEmergencyQueue(): Promise<EmergencyQueueItemDto[]> {
    const visits = await this.prisma.emergencyVisit.findMany({
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
      },
      orderBy: [
        { triageLevel: 'asc' }, // LEVEL_1 first (Immediate)
        { arrivalAt: 'asc' }, // Then by arrival time
      ],
    });

    return visits.map(v => {
      const waitingMinutes = Math.floor(
        (new Date().getTime() - v.arrivalAt.getTime()) / (1000 * 60),
      );
      return {
        id: v.id,
        patientId: v.patientId,
        // 🔴 응급실 워크리스트는 **환자를 특정할 수 있어야** 한다. 이름이 없으면 없다고 말한다
        //    (응급은 신원 미상 환자가 실제로 온다 — 빈 문자열로 지우면 카드가 무명이 된다).
        patientName: `${v.patient.familyName ?? ''}${v.patient.givenName ?? ''}`.trim() || '(신원 미상)',
        mrn: v.patient.mrn,
        chiefComplaint: v.chiefComplaint,
        triageLevel: v.triageLevel as KtasLevel,
        arrivalAt: v.arrivalAt,
        waitingMinutes,
        disposition: v.disposition ?? null,
      };
    });
  }

  /**
   * 🔴 §6 회수(2026-08-25): 이 EP 는 FE 호출부 0 인 고아인데 **처분을 원장·결정자 없이** 필드에만 쓰고
   *    있었다 — 5단계가 만든 `dispositionRecordMissing`(결정자 미상) 지표가 세던 바로 그 경로다.
   *    삭제하지 않는다(기존 기능 삭제는 사람 확인) — 대신 **정본 `makeDisposition` 으로 위임**해
   *    누가 부르든 원장·결정자·멱등 규칙이 지켜지게 한다. 정본 EP 는 POST /visits/:visitId/disposition.
   */
  async updateEmergencyStatus(visitId: string, userId: string, dto: UpdateEmergencyStatusDto) {
    const visit = await this.prisma.emergencyVisit.findUnique({
      where: { id: visitId },
    });
    if (!visit) throw new NotFoundException('Emergency visit not found');

    // 여정 사건은 정본(makeDisposition)이 남긴다 — 🔴 (P2) 종전엔 여기서 결과와 무관하게 한 번 더 발행해
    //    같은 결정을 다시 눌러도(UNCHANGED) 처분 사건이 쌓였고, 변경이면 변경 사건과 이중으로 남았다.
    await this.makeDisposition(visitId, userId, {
      disposition: dto.status,
      revisionReason: dto.notes,
    });

    return this.prisma.emergencyVisit.update({
      where: { id: visitId },
      data: {
        // disposition·dispositionAt 은 makeDisposition 이 정본 규칙(멱등·시각 보존)으로 썼다 — 여기서 다시 쓰지 않는다
        treatmentNote: dto.notes || null,
      },
      include: {
        patient: { select: { familyName: true, givenName: true } },
      },
    });
  }

  async getEmergencyDetail(visitId: string) {
    const visit = await this.prisma.emergencyVisit.findUnique({
      where: { id: visitId },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, dateOfBirth: true } },
      },
    });

    if (!visit) throw new NotFoundException('Emergency visit not found');
    return visit;
  }

  async getEmergencyAnalytics(
    startDate?: Date,
    endDate?: Date,
  ): Promise<EmergencyStatsDto> {
    const whereClause: any = {};
    if (startDate || endDate) {
      whereClause.arrivalAt = {};
      if (startDate) whereClause.arrivalAt.gte = startDate;
      if (endDate) whereClause.arrivalAt.lte = endDate;
    }

    const visits = await this.prisma.emergencyVisit.findMany({
      where: whereClause,
    });

    const byTriageLevel = visits.reduce(
      (acc, v) => {
        acc[v.triageLevel] = (acc[v.triageLevel] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const byDisposition = visits.reduce(
      (acc, v) => {
        const disposition = v.disposition || 'PENDING';
        acc[disposition] = (acc[disposition] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const discharged = visits.filter(v => v.disposition === 'DISCHARGE').length;
    const admitted = visits.filter(v => v.admissionId).length;

    // Calculate average treatment time
    const treatedVisits = visits.filter(v => v.dispositionAt && v.arrivalAt);
    /**
     * 🔴 (2026-09-16 I4) 표본 0 에서 `0` 을 돌려주던 것을 `null` 로 봉합한다.
     *    "평균 진료시간 0분"은 **측정된 0** 과 같은 모양이라, 응급 방문이 한 건도 없는 기간을
     *    "0분만에 끝났다"고 말했다. 표본 부재의 정답은 폴백이 아니라 `null`(산출 불가)이고,
     *    분모(표본 수)를 함께 낸다 — QI·executive 가 이미 쓰는 같은 규약.
     */
    const avgTreatmentTime = treatedVisits.length
      ? Math.round(
          treatedVisits.reduce((sum, v) => {
            return sum + (v.dispositionAt!.getTime() - v.arrivalAt.getTime()) / 60000;
          }, 0) / treatedVisits.length,
        )
      : null;

    /**
     * 🔴 `avgWaitingTime` 은 **상수 `0` 이었다** — 계산 자체가 없었다(P15: 지어낸 경영·운영 지표).
     *    필드 이름이 약속한 것은 도착→진료 시작 대기이므로 `treatmentStartedAt` 로 실제로 잰다.
     *    진료가 시작된 건만 분모이고(대기 중인 환자는 아직 대기시간이 확정되지 않았다),
     *    그런 건이 하나도 없으면 `null`(산출 불가)이다.
     */
    const waitedVisits = visits.filter(v => v.treatmentStartedAt && v.arrivalAt);
    const avgWaitingTime = waitedVisits.length
      ? Math.round(
          waitedVisits.reduce(
            (sum, v) => sum + (v.treatmentStartedAt!.getTime() - v.arrivalAt.getTime()) / 60000,
            0,
          ) / waitedVisits.length,
        )
      : null;

    return {
      totalPatients: visits.length,
      byTriageLevel,
      byDisposition,
      avgWaitingTime,
      /** 대기시간 평균의 **분모** — 화면이 "몇 건 기준"인지 말할 수 있게 함께 낸다 */
      waitingSampleN: waitedVisits.length,
      avgTreatmentTime,
      /** 진료시간 평균의 **분모** */
      treatmentSampleN: treatedVisits.length,
      // 분모(기간 내 방문)가 0 이면 비율은 0% 가 아니라 산출 불가다.
      dischargeRate: visits.length ? (discharged / visits.length) * 100 : null,
      admissionRate: visits.length ? (admitted / visits.length) * 100 : null,
      /** 두 비율의 공통 분모 */
      rateDenominator: visits.length,
      unavailableReason: visits.length ? null : '기간 내 응급 방문 0건 — 비율을 산출할 수 없습니다',
    };
  }

  async transferToAdmission(visitId: string, bedId: string, admittingDoctorId: string, userId: string) {
    const visit = await this.prisma.emergencyVisit.findUnique({
      where: { id: visitId },
    });
    if (!visit) throw new NotFoundException('Emergency visit not found');
    if (!this.admissions) throw new BadRequestException('입원 처리 서비스를 사용할 수 없습니다.');

    /**
     * 🔴 (2026-09-16 K1) 입원 생성·처분 원장·방문 종결이 따로 커밋된다. 뒤쪽이 실패하면 입원은 이미
     *    생겼는데 방문은 COMPLETED 가 아니고 연계도 끊긴 채 남는다 — 그런데 다시 부르면
     *    `AdmissionService.create` 의 **입원 중복가드**가 막아 **이 경로로는 영영 마무리할 수 없다.**
     *    이미 이 방문에 붙은 입원이 있으면 새로 만들지 않고 그것으로 이어서 마무리한다(재시도 가능).
     */

    // 정합 admit — 병상 비관적 선점(AVAILABLE/RESERVED→OCCUPIED)·입원 중복가드·ChargeOfCare/BedAssignment·여정을
    // AdmissionService.create로 위임(/inpatient·워크스테이션 경로와 동일 정합). 구현: prisma.admission.create 직접호출은
    // 병상 미선점(이중점유)·주치의/병상이력 누락·여정 누락 문제가 있었음.
    const existingAdmission = visit.admissionId
      ? await this.prisma.admission.findUnique({ where: { id: visit.admissionId }, select: { id: true } })
      : null;
    const admission = existingAdmission ?? await this.admissions.create(
      visit.patientId,
      bedId,
      admittingDoctorId,
      new Date().toISOString(),
      `응급 경유 입원: ${visit.chiefComplaint ?? ''}`,
    );

    // 응급 방문 ↔ 입원 연계 + 처분 확정(disposition ADMISSION)
    // 🔴 §6 회수(2026-08-25): 종전엔 disposition **필드만** 쓰고 원장(EmergencyDispositionRecord)을
    //    안 남겨 **입원 처분의 결정자가 아무 데도 없었다**(부록 E 후보 — 표본 1건이 이 경로 산물).
    //    정본 makeDisposition 으로 위임 — 결정자 = 이 전환을 실행한 사용자(userId).
    await this.makeDisposition(visitId, userId, {
      disposition: 'ADMISSION',
      admissionId: admission.id,
    });
    // P1(D4): 병상 배정 완료=ER 퇴실 — 방문 종결(COMPLETED)로 boarding 이 관제에 잔류하지 않는다
    // 퇴실 시각(D9) = 이 전환을 처리한 시각(RECORDED) — 병동 위치가 응급 위치를 이어받으므로 위치 닫기 이벤트는 내지 않는다
    await this.prisma.emergencyVisit.update({
      where: { id: visitId },
      data: {
        admissionId: admission.id,
        status: 'COMPLETED',
        departedAt: new Date(),
        departedAtSource: 'RECORDED',
      },
    });
    await this.erBeds?.releaseByVisit(visitId, 'DISPOSITION'); // ER 베드 자동 해제 → CLEANING(비차단)

    // SBAR/I-PASS 핸드오프(P3) — ER→입원 전이 시 인수인계 기록(chain of custody). 인수자 acknowledge 전 미확인.
    //  기존: 전이 시 ClinicalHandoff 미생성 → pending 오더·최근 활력·미완 처치가 누락 전달될 위험. 비차단.
    try {
      const illness = ['LEVEL_1', 'LEVEL_2'].includes(visit.triageLevel) ? 'CRITICAL' : visit.triageLevel === 'LEVEL_3' ? 'UNSTABLE' : 'STABLE';
      await this.prisma.clinicalHandoff.create({
        data: {
          type: 'ER_TO_ADMISSION',
          patientId: visit.patientId,
          fromDoctorId: visit.doctorId ?? admittingDoctorId,
          toDoctorId: admittingDoctorId,
          emergencyVisitId: visitId,
          admissionId: admission.id,
          summary: `응급 경유 입원 인수인계 — ${visit.chiefComplaint ?? ''} (KTAS ${visit.triageLevel})`,
          illness,
          situationAwareness: visit.chiefComplaint,
          vitalSigns: (visit.vitalSigns ?? undefined) as never,
        },
      });
    } catch (e) {
      this.logger.warn(`ER→입원 핸드오프 생성 실패(비차단): ${e instanceof Error ? e.message : String(e)}`);
    }

    // 응급 경유 입원 — ER 진료분 청구 자동(멱등·비차단)
    await this.ensureErEncounterBilled(visit, admittingDoctorId, `응급 경유 입원: ${visit.chiefComplaint ?? ''}`);
    return admission;
  }

  /**
   * 상태 전환.
   *
   * 🔴 (2026-09-16 E1) 종전엔 어휘만 검사하고(DTO `@IsIn`) **전이는 보지 않았다** — `COMPLETED`(퇴실 종결)
   *    방문을 `PENDING_TRIAGE` 로 되돌릴 수 있었다. 종결 시점에 처분 원장·입원 연계·ER 베드 해제·ER 진료 청구가
   *    이미 일어나 있으므로, 되살린 방문은 그 기록들과 모순된 채 보드·QI 분모에 다시 올라오고 묵은 방문
   *    자동 종결 크론(`status != COMPLETED`)의 대상이 된다. **일어난 사실은 소급하지 않는다.**
   *    (재개가 필요하면 새 방문을 연다 — 이 EP 로 조용히 되돌리지 않는다.)
   */
  async updateVisitStatus(visitId: string, newStatus: string) {
    const visit = await this.prisma.emergencyVisit.findUnique({ where: { id: visitId } });
    if (!visit) throw new NotFoundException('응급 방문을 찾을 수 없습니다');
    // 같은 상태 재요청은 쓰기 없이 멱등 — 일어난 사실의 시각을 덮어쓰지 않는다
    if (visit.status === newStatus) return visit;
    assertStateTransition(
      EMERGENCY_VISIT_TRANSITIONS,
      visit.status as EmergencyVisitStatus,
      newStatus as EmergencyVisitStatus,
      EMERGENCY_VISIT_TX_CTX,
    );
    const upd = await this.prisma.emergencyVisit.updateMany({
      where: { id: visitId, status: visit.status },
      data: { status: newStatus },
    });
    if (upd.count === 0) stateChangedConflict(EMERGENCY_VISIT_TX_CTX, visit.status);
    return this.prisma.emergencyVisit.findUnique({ where: { id: visitId } });
  }

  /** KTAS 재분류 */
  async reassess(visitId: string, userId: string, data: { newLevel: string; reason: string; vitals?: Record<string, unknown> }) {
    const visit = await this.prisma.emergencyVisit.findUnique({ where: { id: visitId } });
    if (!visit) throw new NotFoundException('응급 방문을 찾을 수 없습니다');

    /**
     * 🔴 (2026-09-16 H4) 재분류 원장과 방문의 실제 중증도는 **한 트랜잭션**이다. 종전엔 원장을 먼저
     *    커밋하고 방문을 따로 고쳤다 — 뒤가 실패하면 **원장은 "KTAS 를 올렸다"고 적혀 있는데
     *    베드보드·대기열은 옛 등급으로 환자를 줄 세운다**(중증도는 진료 순서를 정한다).
     */
    return this.prisma.$transaction(async (tx) => {
      const reassessment = await tx.emergencyReassessment.create({
        data: {
          visitId,
          previousLevel: visit.triageLevel,
          newLevel: data.newLevel,
          reason: data.reason,
          vitals: data.vitals ? JSON.parse(JSON.stringify(data.vitals)) : undefined,
          assessedBy: userId,
        },
      });
      await tx.emergencyVisit.update({
        where: { id: visitId },
        data: { triageLevel: data.newLevel as never },
      });
      return reassessment;
    });
  }

  /**
   * 처분 결정 — **처분은 바뀐다**(관찰→입원, 전원 결정 후 취소, 입원 대기 중 자의퇴원 …).
   *
   * 🔴 개통 이래 이 메서드는 `.create()` 하나였고 `EmergencyDispositionRecord.visitId` 는 `@unique` 다
   *    (운영 인덱스 `emergency_dispositions_visit_id_key` 확인). 그래서 **같은 방문의 두 번째 처분은
   *    Prisma P2002 → 전역 필터가 HttpException 이 아니라고 판단 → 500 `INTERNAL_ERROR`** 였다.
   *    화면은 "처분 결정 실패" 한 줄만 띄웠고, 원장에는 **최초 결정 1건만** 남았다.
   *    `dischargeFromEmergency`(응급 퇴원)도 이 메서드를 타므로 관찰 처분 뒤 퇴원이 통째로 막혔다.
   *
   * 여기서 하는 것:
   *   ① 동일 내용 재전송(더블클릭·재시도)은 **멱등** — 새로 쓰지 않고 기존 기록을 돌려준다.
   *   ② 내용이 다르면 **처분 변경**으로 처리한다. 변경 전 스냅샷을 통째로 감사(AuditLog·해시체인+앵커)에
   *      남기고 여정 타임라인에도 흔적을 남긴 뒤 현행 기록을 갱신한다 — 이전 결정이 소리 없이 사라지지 않는다.
   *   ③ 동시 결정(check-then-act 경합)으로 create 가 P2002 를 맞으면 변경 경로로 재수렴한다.
   *
   * 🔴 이것은 **잠정 조치**다. 저장소 정본 패턴(`LabResultAmendment.previousItems`·`PreOrderRevision.snapshot`)은
   *    변경 이력을 **전용 테이블**에 둔다. 처분도 `EmergencyDispositionRevision` 이 있어야 화면에서 이력을
   *    보여줄 수 있다 — 스키마는 코디네이터 소유라 여기서 만들지 않았다(보고).
   */
  async makeDisposition(visitId: string, userId: string, data: {
    disposition: string;
    dischargeInstructions?: string;
    followUpDate?: string;
    admissionId?: string;
    transferTo?: string;
    transferReason?: string;
    revisionReason?: string;
  }) {
    const visit = await this.prisma.emergencyVisit.findUnique({ where: { id: visitId } });
    if (!visit) throw new NotFoundException('응급 방문을 찾을 수 없습니다');

    // 🔴 부재 필드는 undefined 가 아니라 null 로 쓴다 — 처분이 바뀌면(전원→퇴원) 이전 결정의 전원기관·
    //    전원사유가 새 결정에 얹혀 남는다. "누구에게 전원한다"가 퇴원 기록에 붙어 있으면 그것이 곧 오정보다.
    const next = {
      disposition: data.disposition,
      dischargeInstructions: data.dischargeInstructions ?? null,
      followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
      admissionId: data.admissionId ?? null,
      transferTo: data.transferTo ?? null,
      transferReason: data.transferReason ?? null,
    };

    const existing = await this.prisma.emergencyDispositionRecord.findUnique({ where: { visitId } });
    let record: Record<string, unknown>;
    let outcome: 'CREATED' | 'REVISED' | 'UNCHANGED';

    /**
     * 방문(상태)에 처분을 반영한다.
     *
     * 🔴 아무것도 결정되지 않았으면 결정 시각을 다시 찍지 않는다 — 더블클릭이 결정 시각을
     *    현재로 밀면 ER 체류·처분 소요 지표가 조용히 좋아진다.
     * 🔴 (2026-09-16 I2) 단 **원장에는 결정이 있는데 방문의 결정 시각이 비어 있으면** 원장의
     *    `decidedAt` 으로 채운다 — 종전에 원장 쓰기만 커밋되고 방문 갱신이 실패한 뒤 재시도하면
     *    같은 결정이라 UNCHANGED 로 접히면서 시각을 영영 못 찍었다(지금 시각을 지어내지 않고
     *    **일어난 시각**을 원장에서 가져온다).
     */
    const visitData = (kind: 'CREATED' | 'REVISED' | 'UNCHANGED', decidedAt?: unknown) => ({
      disposition: data.disposition as never,
      ...(kind === 'UNCHANGED'
        ? (visit.dispositionAt || !(decidedAt instanceof Date) ? {} : { dispositionAt: decidedAt })
        : { dispositionAt: new Date() }),
      dispositionNote: data.dischargeInstructions ?? data.transferReason ?? undefined,
    });

    // 🔴 (2026-09-16 I2) 원장(처분 기록)과 상태(방문)를 한 트랜잭션에서 쓴다. 종전엔 기록을 먼저
    //    커밋하고 방문 갱신이 따로 나가, 중간 실패 시 "원장은 결정, 방문은 미결정"으로 갈라졌다.
    if (!existing) {
      try {
        record = await this.prisma.$transaction(async (tx) => {
          const created = await tx.emergencyDispositionRecord.create({
            data: { visitId, decidedBy: userId, ...next },
          });
          await tx.emergencyVisit.update({ where: { id: visitId }, data: visitData('CREATED') });
          return created;
        });
        outcome = 'CREATED';
      } catch (e) {
        // 동시 결정 경합 — findUnique 시점엔 없었지만 create 시점엔 있었다. 변경 경로로 재수렴.
        if (!EmergencyService.isUniqueViolation(e)) throw e;
        const raced = await this.prisma.emergencyDispositionRecord.findUnique({ where: { visitId } });
        if (!raced) throw e;
        if (EmergencyService.sameDisposition(raced, next)) {
          record = raced;
          outcome = 'UNCHANGED';
          await this.prisma.emergencyVisit.update({ where: { id: visitId }, data: visitData('UNCHANGED', raced.decidedAt) });
        } else {
          record = await this.reviseDisposition(visit, raced, next, userId, data.revisionReason, visitData('REVISED'));
          outcome = 'REVISED';
        }
      }
    } else if (EmergencyService.sameDisposition(existing, next)) {
      record = existing; // 멱등 — 같은 결정을 다시 눌렀다.
      outcome = 'UNCHANGED';
      await this.prisma.emergencyVisit.update({ where: { id: visitId }, data: visitData('UNCHANGED', existing.decidedAt) });
    } else {
      record = await this.reviseDisposition(visit, existing, next, userId, data.revisionReason, visitData('REVISED'));
      outcome = 'REVISED';
    }

    // 🔴 (여정 P2) 최초 결정을 여정에 남긴다 — 종전엔 정본 EP(POST visits/:id/disposition)의 **최초 결정이 발행되지 않았다**
    //    (변경만 reviseDisposition 이 남겼다). 같은 결정 재클릭(UNCHANGED)은 사건이 아니다.
    if (outcome === 'CREATED') {
      this.journey?.emit({
        patientId: visit.patientId, eventType: 'ER_DISPOSITION', refType: 'EmergencyVisit', refId: visitId,
        title: '응급 처분 결정', department: '응급의학과', severity: 'WARNING',
        occurredAt: record.decidedAt instanceof Date ? record.decidedAt : null, outcome: data.disposition,
      });
    }

    // 응급 수납 자동화(A): 사망 외 처분 시 ER 진료기록 보장·서명 → 청구 자동(멱등·비차단)
    if (data.disposition !== 'DEATH') {
      await this.ensureErEncounterBilled(visit, userId, data.dischargeInstructions ?? data.transferReason ?? undefined);
    }

    // ER 베드 자동 해제(P1·D4): 사망만 결정 시점에 해제+종결(안치 이동). 그 외는 결정≠퇴실 —
    // 입원=admit 성공 시, 퇴원/전원=퇴실(checkout) 시 해제한다.
    if (data.disposition === 'DEATH') {
      // 퇴실 시각(D9) = 사망 처분 처리 시각(안치 이동 — 종전 규칙: 사망만 결정 시점에 종결)
      const departedAt = new Date();
      await this.prisma.emergencyVisit.update({ where: { id: visitId }, data: { status: 'COMPLETED', departedAt, departedAtSource: 'RECORDED' } });
      await this.erBeds?.releaseByVisit(visitId, 'DISPOSITION');
      this.emitDeparted(visit.patientId, visitId, departedAt, 'DEATH');
    }

    // 화면이 "결정"과 "변경"과 "이미 같은 결정"을 구분해 말할 수 있어야 한다 — 셋을 한 문장으로 묶으면 거짓말이 된다.
    return { ...record, outcome };
  }

  /** Prisma 유니크 위반(P2002) 판정 — 인스턴스 비교는 @prisma/client 이중 로딩에서 깨져 code 로 본다. */
  private static isUniqueViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
  }

  /** 처분 필드 정본 — 스냅샷·동일성 비교·갱신이 같은 목록을 쓴다(한 곳만 고치면 갈라진다). */
  private static readonly DISPOSITION_FIELDS = [
    'disposition', 'dischargeInstructions', 'followUpDate', 'admissionId', 'transferTo', 'transferReason',
  ] as const;

  /** 동일 결정인가 — 날짜는 epoch 로, 미기재는 null 로 정규화해 비교한다. */
  private static sameDisposition(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const norm = (v: unknown) => (v instanceof Date ? v.getTime() : v ?? null);
    return EmergencyService.DISPOSITION_FIELDS.every((f) => norm(a[f]) === norm(b[f]));
  }

  /**
   * 처분 변경 — 변경 전 기록을 감사에 통째로 보존한 뒤 현행 기록을 갱신한다.
   *
   * 🔴 감사 기록이 **먼저**다. 갱신부터 하면 감사 쓰기가 실패했을 때 이전 결정이 흔적 없이 사라진다.
   *    감사 실패 시 갱신하지 않고 던진다 — 보존 없는 덮어쓰기는 이 저장소가 금지하는 것이다.
   */
  private async reviseDisposition(
    visit: { id: string; patientId: string },
    previous: Record<string, unknown>,
    next: Record<string, unknown>,
    userId: string,
    revisionReason?: string,
    /** 같은 트랜잭션에서 방문(상태)에 반영할 값 — 원장만 바뀌고 방문이 뒤처지는 것을 막는다(I2) */
    visitPatch?: Record<string, unknown>,
  ) {
    const decidedAt = new Date();
    const snapshot: Record<string, { old: unknown; new: unknown }> = {};
    for (const f of EmergencyService.DISPOSITION_FIELDS) {
      snapshot[f] = { old: previous[f] ?? null, new: next[f] ?? null };
    }
    // 누가·언제 결정했던 것을 덮는지까지 남긴다 — 갱신하면 decidedBy/decidedAt 이 새 값으로 바뀐다.
    snapshot.decidedBy = { old: previous.decidedBy ?? null, new: userId };
    snapshot.decidedAt = { old: previous.decidedAt ?? null, new: decidedAt };
    snapshot.revisionReason = { old: null, new: revisionReason ?? null };

    if (!this.audit) {
      // 감사 서비스가 주입되지 않은 배선이면 이전 결정을 보존할 곳이 없다 — 덮어쓰지 않는다.
      throw new BadRequestException('처분 변경 이력을 남길 수 없어 변경을 거부했습니다(감사 배선 확인 필요)');
    }
    await this.audit.log({
      userId,
      action: AuditAction.UPDATE,
      resourceType: 'EmergencyDisposition',
      resourceId: visit.patientId, // 감사 열람 규약: 환자 지목 조회로 찾을 수 있어야 한다
      changes: snapshot,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.emergencyDispositionRecord.update({
        where: { visitId: visit.id },
        data: { ...next, decidedBy: userId, decidedAt },
      });
      if (visitPatch) await tx.emergencyVisit.update({ where: { id: visit.id }, data: visitPatch as never });
      return row;
    });

    this.journey?.emit({
      patientId: visit.patientId,
      eventType: 'ER_DISPOSITION', refType: 'EmergencyVisit', refId: visit.id, // 여정 P0-5: 방문 단위 귀속
      occurredAt: decidedAt, // 여정 P1: 결정 시각(원장과 같은 값)
      transition: 'REVISED', outcome: String(next.disposition), // 여정 P2: 변경은 새 사건(앞 결정을 supersedes 로 가리킨다)
      title: `응급 처분 변경: ${String(previous.disposition ?? '-')} → ${String(next.disposition)}`,
      // 🔴 (2026-09-14) 환자 노출 유형 — 직원 자유 입력(메모·사유·소견)을 설명에 싣지 않는다(포털 타임라인에 그대로 나갔다). 원문은 원 기록이 정본.
      department: '응급의학과',
      severity: 'WARNING',
    });
    this.logger.warn(
      `응급 처분 변경: visit=${visit.id} ${String(previous.disposition)}→${String(next.disposition)} by=${userId}`,
    );
    return updated;
  }

  /**
   * 퇴실 확정(P1·§4.5) — 결정(disposition)과 분리된 물리적 퇴실. 상태 COMPLETED + ER 베드 해제.
   * 수납 미완료여도 퇴실 가능(임상 흐름은 수납에 비종속 — 미수납은 수납 화면 몫).
   */
  /**
   * 퇴실 확정 — 🔴 (2026-10-03 결정 D9 = 퇴실 시각 칸) 종전엔 상태만 바꾸고 시각을 남기지 않아 응급 체류(ED LOS)를 잴 수 없었다.
   * 퇴실 시각 = 비우면 처리 시각(RECORDED) · 직원이 넣으면 그 시각(USER_CLAIMED — 입력값으로 표식).
   * 도착 이전·미래(2분 넘게)는 거부한다 — 확실히 틀린 시각을 원장에 박지 않는다.
   */
  async checkout(visitId: string, userId: string, departedAtInput?: string | null) {
    const visit = await this.prisma.emergencyVisit.findUnique({
      where: { id: visitId }, select: { id: true, patientId: true, status: true, disposition: true, arrivalAt: true },
    });
    if (!visit) throw new NotFoundException('응급 방문을 찾을 수 없습니다');
    if (visit.status === 'COMPLETED') throw new BadRequestException('이미 종결된 방문입니다');
    if (!visit.disposition) throw new BadRequestException('처분 결정(퇴원·입원·전원) 후 퇴실할 수 있습니다');

    const now = new Date();
    let departedAt = now;
    let departedAtSource: 'RECORDED' | 'USER_CLAIMED' = 'RECORDED';
    if (departedAtInput) {
      const t = new Date(departedAtInput);
      if (Number.isNaN(t.getTime())) throw new BadRequestException('퇴실 시각 형식이 올바르지 않습니다');
      if (t.getTime() > now.getTime() + EmergencyService.DEPARTURE_FUTURE_SKEW_MS) throw new BadRequestException('퇴실 시각이 지금보다 뒤입니다');
      if (t.getTime() < visit.arrivalAt.getTime()) throw new BadRequestException('퇴실 시각이 도착 시각보다 앞입니다');
      departedAt = t;
      departedAtSource = 'USER_CLAIMED';
    }

    await this.prisma.emergencyVisit.update({ where: { id: visitId }, data: { status: 'COMPLETED', departedAt, departedAtSource } });
    const released = await this.erBeds?.releaseByVisit(visitId, 'DISPOSITION');
    this.journey?.emit({
      patientId: visit.patientId, eventType: 'ER_CHECKOUT', refType: 'EmergencyVisit', refId: visitId, // 여정 P0-5: 방문 단위 귀속
      title: '응급실 퇴실', description: `처분: ${visit.disposition}`,
      department: '응급의학과', severity: 'INFO', outcome: visit.disposition, // 여정 P2: 처분 값
      // 퇴실 원장 시각(D9) — 직원이 넣은 시각이면 관측이 아니라 입력값
      occurredAt: departedAt, occurredAtSource: departedAtSource === 'USER_CLAIMED' ? 'USER_CLAIMED' : 'DOMAIN_FIELD',
    });
    this.emitDeparted(visit.patientId, visitId, departedAt, String(visit.disposition));
    this.logger.log(`응급 퇴실: visit=${visitId} by=${userId} bedReleased=${released ?? false}`);
    return { checkedOut: true, visitId, disposition: visit.disposition, bedReleased: released ?? false, departedAt: departedAt.toISOString(), departedAtSource };
  }

  /** 직원이 넣은 퇴실 시각이 지금보다 이만큼 뒤까지는 시계 차이로 본다 */
  static readonly DEPARTURE_FUTURE_SKEW_MS = 2 * 60_000;

  /** 응급실을 떠났다는 도메인 사실 — 위치 원장이 그 시각으로 닫는다(입원 전환은 내지 않는다: 병동 위치가 이어받는다) */
  private emitDeparted(patientId: string, visitId: string, departedAt: Date, reason: string) {
    try {
      this.eventEmitter?.emit('emergency.departed', { visitId, patientId, departedAt: departedAt.toISOString(), reason });
    } catch (e) {
      this.logger.warn(`응급 퇴실 이벤트 발행 실패 visit=${visitId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 응급 퇴원 (귀가지침 + 외래예약) */
  async dischargeFromEmergency(visitId: string, userId: string, data: {
    instructions: string;
    followUpDepartment?: string;
    followUpDate?: string;
    prescriptions?: string;
  }) {
    const visit = await this.prisma.emergencyVisit.findUnique({
      where: { id: visitId },
      include: { patient: { select: { id: true, familyName: true, givenName: true } } },
    });
    if (!visit) throw new NotFoundException('응급 방문을 찾을 수 없습니다');

    // 처분 결정
    await this.makeDisposition(visitId, userId, {
      disposition: 'DISCHARGE',
      dischargeInstructions: data.instructions,
      followUpDate: data.followUpDate,
    });

    return {
      visitId,
      patient: visit.patient,
      instructions: data.instructions,
      followUpDepartment: data.followUpDepartment,
      followUpDate: data.followUpDate,
      dischargedAt: new Date(),
    };
  }

  /** 간호 초기평가 (ABC/GCS/통증) */
  async createNursingAssessment(visitId: string, userId: string, data: {
    airway: string; breathing: string; circulation: string;
    gcsEye?: number; gcsVerbal?: number; gcsMotor?: number;
    painScale?: number; painLocation?: string;
  }) {
    return this.prisma.emergencyNursingAssessment.create({
      data: { visitId, ...data, assessedBy: userId },
    });
  }

  /** 응급실(ED) 보드 — 재실 환자 KTAS 분포·체류시간·입원대기(boarding) 실시간 (ORM only) */
  async getBoard() {
    const now = Date.now();
    const active = await this.prisma.emergencyVisit.findMany({
      where: { status: { not: 'COMPLETED' } },
      orderBy: [{ triageLevel: 'asc' }, { arrivalAt: 'asc' }],
      select: {
        id: true, patientId: true, triageLevel: true, status: true, chiefComplaint: true,
        arrivalAt: true, disposition: true, dispositionAt: true, admissionId: true, bedId: true,
        patient: { select: { familyName: true, givenName: true, mrn: true } },
      },
    });
    // ER 베드 컬럼·구역 점유 타일(P1) — 베드 라벨 조인 + 구역 요약
    const erBeds = await this.prisma.bed.findMany({
      where: { ward: { type: 'EMERGENCY', isActive: true } },
      select: { id: true, roomNumber: true, bedNumber: true, status: true },
    });
    const bedLabel = new Map(erBeds.map((b) => [b.id, `${b.roomNumber}-${b.bedNumber}`]));
    const bedSummary = Object.values(
      erBeds.reduce<Record<string, { zone: string; total: number; occupied: number; cleaning: number }>>((acc, b) => {
        const z = (acc[b.roomNumber] ??= { zone: b.roomNumber, total: 0, occupied: 0, cleaning: 0 });
        z.total++;
        if (b.status === 'OCCUPIED') z.occupied++;
        if (b.status === 'CLEANING') z.cleaning++;
        return acc;
      }, {}),
    );
    // KTAS 재평가주기(P3) — 레벨별 목표 재평가 간격 초과 감시. 마지막 재평가(없으면 내원) 경과 대비.
    const visitIds = active.map((v) => v.id);
    const reassessments = visitIds.length
      ? await this.prisma.emergencyReassessment.findMany({ where: { visitId: { in: visitIds } }, orderBy: { assessedAt: 'desc' }, select: { visitId: true, assessedAt: true } })
      : [];
    const lastReassess = new Map<string, Date>();
    for (const r of reassessments) if (!lastReassess.has(r.visitId)) lastReassess.set(r.visitId, r.assessedAt);
    const reassessTargets = mergeTargetMap(KTAS_REASSESS_MIN, await this.config?.get('qi.targets.ktasReassessMin').catch(() => null));
    const visits = active.map((v) => {
      const target = reassessTargets[v.triageLevel] ?? 60;
      const lastAt = lastReassess.get(v.id) ?? new Date(v.arrivalAt);
      const sinceReassessMins = Math.floor((now - lastAt.getTime()) / 60000);
      return {
        id: v.id, patientId: v.patientId,
        name: `${v.patient.familyName}${v.patient.givenName}`, mrn: v.patient.mrn,
        ktas: v.triageLevel, status: v.status, chiefComplaint: v.chiefComplaint,
        arrivalAt: v.arrivalAt, losMins: Math.floor((now - new Date(v.arrivalAt).getTime()) / 60000),
        disposition: v.disposition ?? null,
        boarding: v.disposition === 'ADMISSION' && v.status !== 'COMPLETED',
        sinceReassessMins, reassessOverdue: sinceReassessMins > target,
        bed: v.bedId ? bedLabel.get(v.bedId) ?? null : null,
      };
    });
    const ktas: Record<string, number> = { LEVEL_1: 0, LEVEL_2: 0, LEVEL_3: 0, LEVEL_4: 0, LEVEL_5: 0 };
    for (const v of visits) ktas[v.ktas] = (ktas[v.ktas] ?? 0) + 1;
    const summary = {
      active: visits.length,
      ktas,
      longStay: visits.filter((v) => v.losMins >= 360).length, // 6시간 초과 체류
      pendingTriage: visits.filter((v) => v.status === 'PENDING_TRIAGE').length,
      boarding: visits.filter((v) => v.boarding).length,
      reassessOverdue: visits.filter((v) => v.reassessOverdue).length, // KTAS 재평가 기한 초과(P3)
    };
    return { summary, visits, bedSummary };
  }
  /* ══════════ ER 잔여 3종 (2026-07-23) — NEDOCS·119 사전통보·MCI ══════════ */

  /**
   * NEDOCS 과밀도 지수 — 표준 산식(Weiss 2004):
   *   -20 + 85.8×(총 재실/ED병상) + 600×(입원대기/총 병원병상) + 13.3×(호흡기 환자)
   *   + 0.93×(최장 입원대기 h) + 5.64×(최장 대기 h)
   * ED 병상수=응급병동(ward.type=EMERGENCY) 실 베드 수 우선(ER 베드 보드 P1 — 이제 모델에 응급 구분이 있다),
   * 0 이면 config emergency.edBedCount 폴백(기본 20) — 관제가 실제와 다른 병상수로 거짓말하지 않게.
   * 등급: <20 정상 / 20~60 busy / 60~100 extremely busy / 100~140 overcrowded / 140~180 severe / >180 dangerous.
   */
  async getNedocs() {
    const now = Date.now();
    const [active, totalHospitalBeds] = await Promise.all([
      this.prisma.emergencyVisit.findMany({
        where: { status: { not: 'COMPLETED' } },
        select: { arrivalAt: true, status: true, disposition: true, dispositionAt: true, onVentilator: true },
      }),
      this.prisma.bed.count(),
    ]);
    const realErBeds = await this.prisma.bed.count({
      where: { ward: { type: 'EMERGENCY', isActive: true }, status: { not: 'MAINTENANCE' } },
    });
    const edBeds = realErBeds > 0
      ? realErBeds
      : Math.max(1, Number((await this.config?.get('emergency.edBedCount').catch(() => null)) ?? 20));
    const hospitalBeds = Math.max(1, totalHospitalBeds);

    const patients = active.length;
    const boarding = active.filter((v) => v.disposition === 'ADMISSION');
    const ventilated = active.filter((v) => v.onVentilator).length;
    const longestAdmitHours = boarding.length
      ? Math.max(...boarding.map((v) => (now - new Date(v.dispositionAt ?? v.arrivalAt).getTime()) / 3600_000))
      : 0;
    const waiting = active.filter((v) => v.status === 'PENDING_TRIAGE' || v.status === 'TRIAGED');
    const longestWaitHours = waiting.length
      ? Math.max(...waiting.map((v) => (now - new Date(v.arrivalAt).getTime()) / 3600_000))
      : 0;

    const score = Math.max(0, Math.round(
      -20
      + 85.8 * (patients / edBeds)
      + 600 * (boarding.length / hospitalBeds)
      + 13.3 * ventilated
      + 0.93 * longestAdmitHours
      + 5.64 * longestWaitHours,
    ));
    const bounds = ascendingBoundsOr(await this.config?.get('qi.targets.nedocsBounds').catch(() => null), NEDOCS_BOUNDS);
    let gradeIdx = 0;
    while (gradeIdx < bounds.length && score >= bounds[gradeIdx]) gradeIdx++;
    const level = NEDOCS_LEVELS[gradeIdx];
    return {
      score, ...level,
      inputs: {
        patients, edBeds, boarding: boarding.length, hospitalBeds, ventilated,
        longestAdmitHours: Math.round(longestAdmitHours * 10) / 10,
        longestWaitHours: Math.round(longestWaitHours * 10) / 10,
      },
      computedAt: new Date().toISOString(),
    };
  }

  /* ── 119/전원 사전통보 ── */

  /** 사전통보 수신(서버-서버·직원 수기 공용) — ETA는 분(etaMinutes) 또는 시각(etaAt) */
  async createPrenotification(dto: {
    source?: string; unitId?: string; etaMinutes?: number; patientAge?: number; patientGender?: string;
    chiefComplaint: string; severityHint?: string; vitals?: Record<string, unknown>; note?: string;
  }) {
    if (!dto.chiefComplaint?.trim()) throw new BadRequestException('주호소(chiefComplaint)는 필수입니다');
    const etaAt = dto.etaMinutes != null ? new Date(Date.now() + Math.min(Math.max(0, dto.etaMinutes), 720) * 60_000) : null; // 0~720분 상한(오버플로 방어)
    const rec = await this.prisma.emergencyPrenotification.create({
      data: {
        source: dto.source ?? 'EMS_119', unitId: dto.unitId ?? null,
        etaMinutes: dto.etaMinutes ?? null, etaAt,
        patientAge: dto.patientAge ?? null, patientGender: dto.patientGender ?? null,
        chiefComplaint: dto.chiefComplaint.trim(), severityHint: dto.severityHint ?? null,
        vitals: (dto.vitals ?? undefined) as never, note: dto.note ?? null,
      },
    });
    return rec;
  }

  /** 진행 중 사전통보 목록(EN_ROUTE) — ETA 경과 파생 */
  async listPrenotifications() {
    const rows = await this.prisma.emergencyPrenotification.findMany({
      where: { status: 'EN_ROUTE' },
      orderBy: [{ etaAt: 'asc' }, { receivedAt: 'asc' }],
      take: 50,
    });
    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      etaRemainingMins: r.etaAt ? Math.round((r.etaAt.getTime() - now) / 60_000) : null, // 음수=지연
    }));
  }

  /** 도착 처리 — 트리아지 visit과 연결(멱등: 이미 ARRIVED면 그대로 반환) */
  async markPrenotificationArrived(id: string, visitId?: string) {
    const rec = await this.prisma.emergencyPrenotification.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('사전통보를 찾을 수 없습니다');
    if (rec.status === 'ARRIVED') return rec;
    if (rec.status === 'CANCELLED') throw new BadRequestException('취소된 통보입니다');
    return this.prisma.emergencyPrenotification.update({
      where: { id },
      data: { status: 'ARRIVED', arrivedAt: new Date(), linkedVisitId: visitId ?? null },
    });
  }

  async cancelPrenotification(id: string, reason?: string) {
    const rec = await this.prisma.emergencyPrenotification.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('사전통보를 찾을 수 없습니다');
    return this.prisma.emergencyPrenotification.update({
      where: { id },
      data: { status: 'CANCELLED', note: reason ? `${rec.note ?? ''}\n[취소] ${reason}`.trim() : rec.note },
    });
  }

  /* ── MCI(다수사상자/재난) ── */

  /** MCI 활성화 — 동시 ACTIVE 1건(중복 활성 차단) */
  async activateMci(userId: string, dto: { title: string; type?: string; expectedCasualties?: number; note?: string }) {
    if (!dto.title?.trim()) throw new BadRequestException('이벤트명(title)은 필수입니다');
    const existing = await this.prisma.mciEvent.findFirst({ where: { status: 'ACTIVE' } });
    if (existing) throw new BadRequestException(`이미 활성 MCI가 있습니다: ${existing.title}`);
    return this.prisma.mciEvent.create({
      data: {
        title: dto.title.trim(), type: dto.type ?? 'MCI',
        expectedCasualties: dto.expectedCasualties ?? null, note: dto.note ?? null,
        activatedBy: userId,
      },
    });
  }

  /** 활성 MCI + 사상자 현황(태깅된 visit KTAS 분포) */
  async getActiveMci() {
    const event = await this.prisma.mciEvent.findFirst({ where: { status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' } });
    if (!event) return { active: false as const };
    const casualties = await this.prisma.emergencyVisit.findMany({
      where: { mciEventId: event.id },
      select: { id: true, triageLevel: true, status: true, disposition: true },
    });
    const byKtas: Record<string, number> = {};
    for (const c of casualties) byKtas[c.triageLevel] = (byKtas[c.triageLevel] ?? 0) + 1;
    return {
      active: true as const, event,
      casualties: {
        total: casualties.length, byKtas,
        inTreatment: casualties.filter((c) => c.status !== 'COMPLETED').length,
        admitted: casualties.filter((c) => c.disposition === 'ADMISSION').length,
      },
    };
  }

  /** 사상자 태깅 — 기존 visit을 활성 MCI에 연결(트리아지 후 태깅 흐름) */
  async tagMciCasualty(visitId: string) {
    const event = await this.prisma.mciEvent.findFirst({ where: { status: 'ACTIVE' } });
    if (!event) throw new BadRequestException('활성 MCI 이벤트가 없습니다');
    const visit = await this.prisma.emergencyVisit.findUnique({ where: { id: visitId }, select: { id: true } });
    if (!visit) throw new NotFoundException('응급 방문을 찾을 수 없습니다');
    return this.prisma.emergencyVisit.update({ where: { id: visitId }, data: { mciEventId: event.id } });
  }

  async closeMci(userId: string, id: string, note?: string) {
    const event = await this.prisma.mciEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('MCI 이벤트를 찾을 수 없습니다');
    if (event.status === 'CLOSED') return event;
    return this.prisma.mciEvent.update({
      where: { id },
      data: { status: 'CLOSED', closedBy: userId, closedAt: new Date(), note: note ?? event.note },
    });
  }

  /**
   * 묵은 미종결 방문 자동 종결 — config `emergency.staleVisitAutoCloseHours`(0=OFF 기본).
   * 장기 미완료 방문이 NEDOCS 재실/최장대기를 왜곡하는 것을 방지(처분 미지정은 DISCHARGE).
   * 종전 수동 SQL 정리를 관리 기능으로 전환 — 임계는 관리 UI(진료 설정)에서 무재시작 변경.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async autoCloseStaleVisits() {
    // 🔴 (2026-09-14) 조회 실패를 0(=OFF)으로 번역하지 않는다 — "설정 안 함"과 "못 읽음"은 다른 사실이다.
    //    실패면 오늘은 건너뛰고 그 사실을 남긴다(자동 종결은 안전측이라 막히는 쪽으로 접는다).
    let raw: unknown;
    try {
      raw = await this.config?.get('emergency.staleVisitAutoCloseHours');
    } catch (e) {
      this.logger.warn(`묵은 응급 방문 자동 종결 건너뜀 — 임계 설정을 읽지 못했습니다: ${(e as Error).message}`);
      return { closed: 0, hours: null, skipped: 'CONFIG_LOOKUP_FAILED' as const };
    }
    const hours = Number(raw ?? 0);
    if (!hours || hours <= 0) return { closed: 0, hours: 0 };
    const cutoff = new Date(Date.now() - hours * 3600_000);
    const stale = await this.prisma.emergencyVisit.findMany({
      where: { status: { not: 'COMPLETED' }, arrivalAt: { lt: cutoff } },
      select: { id: true, disposition: true },
    });
    for (const v of stale) {
      /**
       * 🔴 (2026-09-15 D3) 종전 `disposition: v.disposition ?? 'DISCHARGE'` — **처분이 기록된 적 없는 환자**를
       *    자동 종결하면서 '귀가'로 적었다. 귀가·입원·전원·사망은 응급 통계(QI)와 환자 기록이 읽는 사실이고,
       *    시한 경과로 닫았다는 것은 그 중 어느 것도 말해 주지 않는다(`EmergencyDisposition` 에 '미상'이 없다).
       *    처분은 비워 두고(null 유지) 종결 사유만 남긴다 — 미기록은 0 이 아니라 공백이다.
       */
      await this.prisma.emergencyVisit.update({
        where: { id: v.id },
        data: v.disposition
          ? { status: 'COMPLETED', disposition: v.disposition, dispositionAt: new Date() }
          : { status: 'COMPLETED', dispositionNote: AUTO_CLOSE_NO_DISPOSITION_NOTE },
      });
      await this.erBeds?.releaseByVisit(v.id, 'AUTO_CLOSE'); // ER 베드 잔류 정리(P1·D4)
    }
    if (stale.length) this.logger.log(`묵은 응급 방문 자동 종결: ${stale.length}건 (기준 ${hours}h)`);
    return { closed: stale.length, hours };
  }

  /**
   * KTAS 재평가 지연 담당의 알림(P3) — config `er.reassessNotify.enabled` 기본 OFF(보드 배지가 1차).
   * 탐지와 상신은 분리 불가 원칙 — 탐지(보드 배지)만 있고 상신이 없던 갭을 크론으로 잇는다.
   * dedupe: 같은 방문 60분 내 재알림 금지(refId=visitId·@db.Uuid 계약 준수).
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reassessOverdueNotifySweep(): Promise<{ notified: number }> {
    if ((await this.config?.get('er.reassessNotify.enabled').catch(() => false)) !== true) return { notified: 0 };
    const board = await this.getBoard();
    const overdue = board.visits.filter((v) => v.reassessOverdue && v.status !== 'PENDING_TRIAGE');
    let notified = 0;
    for (const v of overdue) {
      const visit = await this.prisma.emergencyVisit.findUnique({ where: { id: v.id }, select: { doctorId: true } });
      if (!visit?.doctorId) continue; // 담당의 미지정은 수신자 없음 — 배지로만
      const recent = await this.prisma.notification.findFirst({
        where: { refId: v.id, type: 'ER_REASSESS_OVERDUE', createdAt: { gte: new Date(Date.now() - 60 * 60000) } },
        select: { id: true },
      });
      if (recent) continue;
      await this.notifications?.notify(visit.doctorId, {
        type: 'ER_REASSESS_OVERDUE',
        title: `KTAS 재평가 지연 — ${v.name} (${v.bed ?? '미배정'})`,
        message: `마지막 재평가 후 ${v.sinceReassessMins}분 경과 — ${v.ktas.replace('LEVEL_', 'KTAS ')} 목표 간격을 초과했습니다.`,
        severity: 'WARNING', refType: 'EMERGENCY_VISIT', refId: v.id,
      }).catch((e) => this.logger.warn(`재평가 지연 알림 실패(비차단): ${e instanceof Error ? e.message : String(e)}`));
      notified++;
    }
    if (notified) this.logger.log(`KTAS 재평가 지연 알림: ${notified}건`);
    return { notified };
  }

  /** EN_ROUTE 사전통보 24h 자동만료 — 도착/취소 없이 방치된 통보 정리(상시 위생·config 불요) */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async expireStalePrenotifications() {
    const cutoff = new Date(Date.now() - 24 * 3600_000);
    const r = await this.prisma.emergencyPrenotification.updateMany({
      where: { status: 'EN_ROUTE', receivedAt: { lt: cutoff } },
      data: { status: 'CANCELLED', note: '[자동만료 24h]' },
    });
    if (r.count) this.logger.log(`사전통보 자동만료: ${r.count}건`);
    return { expired: r.count };
  }

}
