import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { ageOf } from '@hospital-run/shared';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, SurgeryStatus, Laterality } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JourneyService } from '../journey/journey.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { CompleteSurgeryDto } from './dto/surgery.dto';
import { SurgeryAdvancedService } from './surgery-advanced.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { SafetyGateService } from '../safety-gate/safety-gate.service';
import { gateMode, type GateMode } from '../../common/gate-mode';
import { nonEmptyStringArrayOr } from '../../common/qi-targets';
import {
  LATERALITY_REQUIRED_KEYWORDS,
  isLateralityRequired,
  lateralitySpecified,
  type LateralityRequirement,
} from '../../common/laterality-keywords';

@Injectable()
export class SurgeryService {
  private readonly logger = new Logger(SurgeryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly advanced: SurgeryAdvancedService,
    @Optional() private readonly journey?: JourneyService,
    @Optional() private readonly medicalAi?: MedicalAiService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
    @Optional() private readonly config?: ConfigRuntimeService,
    // 🔴 범용 위반 원장. 정본(`SafetyGateService.record`)은 존재했으나 **외부 호출부가 0** 이라
    //    죽어 있었다(운영 GateViolationLog 전체 1행). 게이트가 3상으로 동작하려면 여기가 산다.
    @Optional() private readonly gates?: SafetyGateService,
  ) {}

  /** 게이트 예외에서 사람이 읽을 메시지만 뽑는다(형식이 무엇이든 기록은 남아야 한다) */
  private static gateMessage(e: unknown): string {
    const r = (e as { getResponse?: () => unknown })?.getResponse?.();
    if (typeof r === 'string') return r;
    const m = (r as { message?: unknown })?.message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m)) return m.join(', ');
    return (e as Error)?.message ?? '게이트 위반';
  }

  /**
   * 안전 게이트 3상 집행 정본(수술) — OFF / WARN / BLOCK.
   *
   * 🔴 종전 결함: 호출부가 `if (mode === 'BLOCK')` 만 처리해 **WARN 이 OFF 와 완전히 같았다.**
   *    차단도 하지 않고 기록도 남기지 않았으니, "WARN 으로 켜서 위반 통계를 보고 BLOCK 으로
   *    승격한다"는 이 저장소의 게이트 규약이 근거를 만들 수 없었다(운영 GateViolationLog 전체 1행).
   *    WARN 은 **막지 않되 반드시 남긴다**.
   */
  private async enforceGate(
    gateKey: string,
    mode: GateMode,
    check: () => Promise<unknown>,
    ref: { refType: string; refId: string },
  ): Promise<{ gateKey: string; message: string } | null> {
    if (mode === 'OFF') return null;
    try {
      await check();
      return null;
    } catch (e) {
      const message = SurgeryService.gateMessage(e);
      // 기록은 차단 여부와 무관하다 — 기록이 없으면 승격 판단도 없다.
      await this.gates?.record(gateKey, mode, message, ref.refType, ref.refId);
      if (mode === 'BLOCK') throw e;
      this.logger.warn(`[게이트 ${gateKey}=WARN] ${ref.refType}:${ref.refId} — ${message}`);
      return { gateKey, message };
    }
  }

  /**
   * 오부위수술 방지(IPSG.4) — **좌우 구분 판정**.
   * 키워드 정본은 config `surgery.lateralityKeywords`(위원회 SAFE 개정 표면)이고,
   * 판정 규칙은 `common/laterality-keywords` 하나다(여기서 다시 만들지 않는다).
   */
  private async resolveLaterality(procedureName?: string | null, bodySite?: string | null, laterality?: string | null): Promise<{
    required: LateralityRequirement; specified: boolean; gap: boolean;
  }> {
    const keywords = nonEmptyStringArrayOr(
      await this.config?.get('surgery.lateralityKeywords').catch(() => null),
      LATERALITY_REQUIRED_KEYWORDS,
    );
    const required = isLateralityRequired(procedureName, bodySite, keywords);
    const specified = lateralitySpecified(laterality);
    return { required, specified, gap: required === true && !specified };
  }

  /** AI 수술 합병증 위험도 예측 */
  async predictRiskAI(surgeryId: string) {
    const surgery = await this.prisma.surgery.findUnique({
      where: { id: surgeryId },
      include: { patient: { select: { dateOfBirth: true, gender: true } } },
    });
    if (!surgery) throw new NotFoundException('수술 정보를 찾을 수 없습니다');
    if (!this.medicalAi) return { surgeryId, patientId: surgery.patientId, prediction: null, source: 'FALLBACK' };
    // 🔴 나이를 모르면 예측하지 않는다 — 종전엔 50세로 지어내 그 가정 위의 위험도를 실제처럼 돌려줬다
    const age = ageOf(surgery.patient.dateOfBirth);
    if (age == null) return { surgeryId, patientId: surgery.patientId, prediction: null, source: 'UNAVAILABLE', reason: 'AGE_UNKNOWN' };
    try {
      const prediction = await this.medicalAi.predictComplication({
        age,
        sex: surgery.patient?.gender ?? 'UNKNOWN',
        diagnosis: surgery.procedureName,
        procedure: surgery.procedureCode ?? surgery.procedureName,
      });
      return { surgeryId, patientId: surgery.patientId, prediction, source: 'AI', disclaimer: await this.medicalAi.getDisclaimer() };
    } catch (e) {
      this.logger.warn(`AI 수술 위험 예측 실패: ${e}`);
      return { surgeryId, patientId: surgery.patientId, prediction: null, source: 'FALLBACK' };
    }
  }

  /**
   * 보조 의사 검증 — **모르는 사람을 원장에 박지 않는다.**
   *
   * `Surgery.assistantId` 는 uuid 이고 스키마에 FK 가 없다(관계 미선언). 그래서 서버가 확인하지 않으면
   * 존재하지 않는 id·간호사 계정·퇴직자 id 가 그대로 들어가고, 그 값을 읽는 수술 프로토콜 알림
   * (`protocol.service.afterTransition`)은 아무에게도 닿지 않는 알림을 만든다.
   * 집도의와 같은 사람도 막는다 — 한 사람이 자기 수술의 보조의일 수는 없다(2인 확인의 의미가 사라진다).
   */
  private async resolveAssistantId(assistantId: string | undefined, surgeonId: string): Promise<string | undefined> {
    if (!assistantId) return undefined;
    if (assistantId === surgeonId) {
      throw new BadRequestException({ code: 'ASSISTANT_SAME_AS_SURGEON', message: '집도의와 보조 의사를 같은 사람으로 지정할 수 없습니다.' });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: assistantId },
      select: { id: true, role: true, isActive: true },
    });
    if (!user) {
      throw new BadRequestException({ code: 'ASSISTANT_NOT_FOUND', message: '보조 의사로 지정한 계정을 찾을 수 없습니다.' });
    }
    if (user.role !== 'DOCTOR') {
      throw new BadRequestException({ code: 'ASSISTANT_NOT_DOCTOR', message: '보조 의사는 의사 계정만 지정할 수 있습니다.' });
    }
    if (user.isActive === false) {
      throw new BadRequestException({ code: 'ASSISTANT_INACTIVE', message: '재직 중이 아닌 계정은 보조 의사로 지정할 수 없습니다.' });
    }
    return user.id;
  }

  /** 보조의 이름 붙이기 — 스키마에 관계가 없어(assistantId 평문) 수동 조인. 알 수 없으면 null(추측 금지). */
  private async attachAssistants<T extends { assistantId?: string | null }>(rows: T[]): Promise<(T & { assistant: { id: string; familyName: string; givenName: string; department: string | null } | null })[]> {
    const ids = [...new Set(rows.map((r) => r.assistantId).filter((v): v is string => !!v))];
    const users = ids.length
      ? await this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, familyName: true, givenName: true, department: true },
      })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({ ...r, assistant: (r.assistantId && byId.get(r.assistantId)) || null }));
  }

  async schedule(data: { patientId: string; surgeonId: string; scheduledAt: string; procedureName: string; procedureCode?: string; bodySite?: string; laterality?: Laterality; anesthesiaType?: string; preOpDiagnosis?: string; assistantId?: string }) {
    // 🔴 보조 의사는 이름이 아니라 계정이다 — 검증 실패는 400 으로 되돌린다(조용히 버리지 않는다).
    const assistantId = await this.resolveAssistantId(data.assistantId, data.surgeonId);

    /**
     * 🔴 오부위수술 방지가 **입구에서 끊겨 있었다**. 좌우 게이트는 Sign-In(마취 유도 직전) 한 곳에만
     *    있었고 예약 시점에는 아무 검사도 없었다 — 부위·좌우가 비어 있는 채로 동의서·부위표시·
     *    수술방 배정이 전부 진행된 뒤 수술 직전에야 걸린다(그때는 이미 늦다).
     *    같은 판정을 **예약 시점**에 한 번 더 돌린다. 게이트 모드는 Sign-In 과 같은 키를 쓴다
     *    (`surgery.siteVerify.enforce` — 정본이 둘이 되지 않게).
     *
     * 🔴 좌우를 **모든 수술에 강제하지 않는다** — 근거는 `common/laterality-keywords`
     *    (쌍으로 존재하는 부위 키워드에 걸릴 때만 필수). 판정 근거가 없으면 `null`(모름)이고,
     *    모름을 '필수 아님'으로 접지 않는다.
     */
    const lat = await this.resolveLaterality(data.procedureName, data.bodySite, data.laterality);
    const siteMode = gateMode(await this.config?.get('surgery.siteVerify.enforce'), 'OFF');
    const siteVerification = {
      lateralityRequired: lat.required,
      lateralityRecorded: data.laterality ?? null,
      bodySiteRecorded: data.bodySite ?? null,
      mode: siteMode,
      warning: lat.gap
        ? '좌우 구분이 필요한 술식·부위인데 좌/우(laterality)가 지정되지 않았습니다 — 부위표시(site marking)·동의서 전에 지정하세요(오부위수술 방지).'
        : null,
      // 🔴 '판정 못 했다'와 '필요 없다'는 다른 사실이다. 접지 않고 그대로 낸다.
      note: lat.required === null
        ? '술식명·부위 정보가 없어 좌우 필요 여부를 판정하지 못했습니다(필요 없음이 아닙니다).'
        : null,
    };
    if (lat.gap) {
      if (siteMode === 'BLOCK') {
        await this.gates?.record('surgery.siteVerify.enforce', 'BLOCK', `예약 차단 — ${data.procedureName}: 좌우 미지정`, 'SURGERY_SCHEDULE', data.patientId);
        throw new BadRequestException({
          code: 'SURGERY_LATERALITY_REQUIRED',
          message: '좌우 구분이 필요한 술식입니다 — 수술 부위 좌/우(laterality)를 지정해야 예약할 수 있습니다(오부위수술 방지).',
        });
      }
      if (siteMode === 'WARN') {
        await this.gates?.record('surgery.siteVerify.enforce', 'WARN', `예약 경고 — ${data.procedureName}: 좌우 미지정`, 'SURGERY_SCHEDULE', data.patientId);
      }
      // OFF 여도 화면에는 말한다 — 막지 않는 것과 숨기는 것은 다르다.
      this.logger.warn(`[게이트 surgery.siteVerify.enforce=${siteMode}] 예약 좌우 미지정 — ${data.procedureName}`);
    }
    const surgery = await this.prisma.surgery.create({
      data: {
        patientId: data.patientId,
        surgeonId: data.surgeonId,
        scheduledAt: new Date(data.scheduledAt),
        procedureName: data.procedureName,
        procedureCode: data.procedureCode,
        bodySite: data.bodySite,
        laterality: data.laterality,
        anesthesiaType: data.anesthesiaType,
        preOpDiagnosis: data.preOpDiagnosis,
        assistantId,
      },
      include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } },
    });
    // 여정 프로토콜 자동 생성 트리거(부작용 — 리스너가 인스턴스 보장)
    this.eventEmitter?.emit('surgery.scheduled', { surgeryId: surgery.id, patientId: surgery.patientId });
    // 부위·좌우 판정 결과를 응답에 실어 예약 화면이 그 자리에서 말할 수 있게 한다(경보는 늦을수록 무용하다).
    return { ...surgery, siteVerification };
  }

  async getSchedule(dateFrom?: string, dateTo?: string, patientId?: string) {
    const where: Prisma.SurgeryWhereInput = { status: { not: 'CANCELLED' } };
    if (patientId) where.patientId = patientId; // 환자별 조회(PHI 과다조회 방지) — 차트 수술이력 탭
    if (dateFrom) where.scheduledAt = { ...(where.scheduledAt as Prisma.DateTimeFilter), gte: new Date(dateFrom) };
    if (dateTo) where.scheduledAt = { ...(where.scheduledAt as Prisma.DateTimeFilter), lte: new Date(dateTo + 'T23:59:59Z') };

    const list = await this.prisma.surgery.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        surgeon: { select: { familyName: true, givenName: true } },
      },
    });
    if (!list.length) return list;
    // 수술방 배정 붙이기 — OrSchedule 은 Surgery 와 관계가 없어(surgeryId 평문) 수동 조인(2026-08-04 방 표시)
    const scheds = await this.prisma.orSchedule.findMany({
      where: { surgeryId: { in: list.map((s) => s.id) }, status: { not: 'CANCELLED' } },
      include: { room: { select: { name: true } } },
    });
    const bySurgery = new Map(scheds.map((o) => [o.surgeryId, o]));
    // 🔴 예상 소요시간의 정본은 OrSchedule(수술실 배정) 하나다 — Surgery 에는 그 컬럼이 없다.
    //    예약 화면 목록이 `s.estimatedDuration` 을 찍고 있었으나 서버는 그 키를 보낸 적이 없어
    //    항상 빈칸이었다(P11). 배정된 값을 배정 옆에 붙여 준다 — 미배정이면 orRoom 자체가 null 이다.
    const withRoom = list.map((s) => {
      const os = bySurgery.get(s.id);
      return { ...s, orRoom: os ? { name: os.room.name, startTime: os.startTime, endTime: os.endTime, estimatedDuration: os.estimatedDuration } : null };
    });
    return this.attachAssistants(withRoom);
  }

  async start(id: string) {
    const surgery = await this.prisma.surgery.findUnique({ where: { id } });
    if (!surgery) throw new NotFoundException('Surgery not found');
    if (surgery.status !== 'SCHEDULED') throw new BadRequestException('Surgery not in SCHEDULED state');
    // IPSG.4 — 안전 체크리스트(Sign-In/Time-Out) 필수항목 미완료 시 수술 시작 차단
    await this.advanced.assertChecklistReadyForStart(id);
    const updated = await this.prisma.surgery.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    this.journey?.emit({
      patientId: surgery.patientId, eventType: 'SURGERY_START', refType: 'SURGERY', refId: id, // 여정 P0-5: 방문 단위 귀속
      title: `수술 시작: ${surgery.procedureName}`, department: '수술실',
      occurredAt: updated.startedAt ?? null, // 여정 P1: 수술 원장 시작 시각(버튼 — 절개 시각 아님)
    });
    return updated;
  }

  async complete(id: string, opNote: CompleteSurgeryDto) {
    const surgery = await this.prisma.surgery.findUnique({ where: { id } });
    if (!surgery) throw new NotFoundException('Surgery not found');
    // 진행 중(IN_PROGRESS)에서만 종료 — SCHEDULED→COMPLETED 직행은 Sign-In/Time-Out 시작게이트를
    //  우회하므로 차단(체크리스트 없이 개복·봉합 금지).
    if (surgery.status !== 'IN_PROGRESS') {
      throw new BadRequestException({ code: 'SURGERY_NOT_IN_PROGRESS', message: '진행 중(IN_PROGRESS)인 수술만 종료할 수 있습니다. 먼저 수술을 시작하세요.' });
    }
    /**
     * IPSG.4 안전 게이트 — 3상(OFF|WARN|BLOCK) 집행.
     * 🔴 종전에는 두 게이트 모두 `=== 'BLOCK'` 만 봤다 → **WARN 이 OFF 와 동일**했고
     *    위반이 어디에도 남지 않아 승격 근거가 0 이었다. 이제 WARN 은 막지 않되 원장에 남는다.
     */
    const gateWarnings: { gateKey: string; message: string }[] = [];
    const ref = { refType: 'SURGERY', refId: id };
    // Sign-Out(기구·거즈 계수/검체 라벨). config surgery.signOutEnforce(OFF|WARN|BLOCK·기본 BLOCK).
    const w1 = await this.enforceGate(
      'surgery.signOutEnforce',
      gateMode(await this.config?.get('surgery.signOutEnforce')),
      () => this.advanced.assertChecklistReadyForClose(id),
      ref,
    );
    if (w1) gateWarnings.push(w1);
    // 수술 계수 대조(P2-D) — signOutEnforce와 독립. countStatus=MISMATCH·미해소면 잔류이물 위험.
    //  config surgery.countEnforce(OFF|WARN|BLOCK·기본 OFF, fallback 'OFF').
    const w2 = await this.enforceGate(
      'surgery.countEnforce',
      gateMode(await this.config?.get('surgery.countEnforce'), 'OFF'),
      () => this.advanced.assertCountReconciled(id),
      ref,
    );
    if (w2) gateWarnings.push(w2);

    const allowed = ['preOpDiagnosis', 'postOpDiagnosis', 'opNote', 'findings', 'complications',
      'specimens', 'ebl', 'fluidsGiven', 'implants', 'drains', 'anesthesiaType', 'anesthesiaNote'] as const;
    const data: Record<string, unknown> = {
      status: 'COMPLETED' as SurgeryStatus,
      endedAt: new Date(),
    };
    for (const key of allowed) {
      const val = opNote[key];
      if (val !== undefined && val !== '') data[key] = val;
    }

    const updated = await this.prisma.surgery.update({ where: { id }, data });

    this.journey?.emit({
      patientId: surgery.patientId, eventType: 'SURGERY_COMPLETE',
      title: `수술 완료 (${surgery.procedureName})`,
      department: '수술실', doctorId: surgery.surgeonId,
      refType: 'SURGERY', refId: id, navUrl: `/surgery/${id}`,
      occurredAt: updated.endedAt ?? null, // 여정 P1: 수술 원장 종료 시각
    });

    // 🔴 WARN 으로 통과한 사실은 화면에도 말한다 — 조용히 통과하면 아무도 고치지 않는다.
    return gateWarnings.length ? { ...updated, gateWarnings } : updated;
  }

  async findById(id: string) {
    const surgery = await this.prisma.surgery.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        surgeon: { select: { familyName: true, givenName: true } },
      },
    });
    if (!surgery) throw new NotFoundException('Surgery not found');
    // 보조의는 관계가 없어 수동 조인(계정이 사라졌으면 null — 이름을 지어내지 않는다)
    const [withAssistant] = await this.attachAssistants([surgery]);
    return withAssistant;
  }
}
