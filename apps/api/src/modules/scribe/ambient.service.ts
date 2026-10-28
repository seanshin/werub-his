import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { AuditAction, ConsentType, Prisma, ScribeSessionStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { AuditService } from '../audit/audit.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { extractClinicalEntities, ClinicalEntities } from './clinical-ner';
import { consolidate, aiSuggestionsFrom, SoapSuggestion } from './ambient-soap';
import { AddUtteranceDto, PatchUtteranceDto, ApplySuggestionDto } from './dto/ambient.dto';
import { redactForAiEgress } from '../../common/util/ai-phi-redact';
import { loadEgressNames, EgressNamesUnavailableError } from './scribe-egress-names';

/** 분석 응답 — AI 경로가 왜 빠졌는지(빠졌으면). `null`=AI 경로가 돌았거나 애초에 켜져 있지 않았다 */
export type AmbientAiSkipReason = 'NAMES_UNAVAILABLE' | 'AI_ERROR';

/**
 * 앰비언트 대화 스트림 P0 — 라이브 전사 발화 영속·수정·화자 라벨.
 * 기획: docs/01-plan/features/voice-emr-ambient-conversation.plan.md
 * - 세션 정본=ScribeSession(source=AMBIENT) 재사용(동의·보존·파기 규약 승계).
 * - 오디오 미저장 — 발화 텍스트만 영속(§7 프라이버시). STT 청크는 voice-emr EP 재사용.
 * - config `voiceEmr.ambient.enabled` 기본 OFF(파일럿=voiceEmr.pilotUserIds 재사용).
 * - 화자는 추정 라벨(HEURISTIC→MANUAL/DIARIZE 정정)이며 안전 판정 근거가 아님.
 */
@Injectable()
export class AmbientScribeService {
  private readonly logger = new Logger(AmbientScribeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly configRuntime?: ConfigRuntimeService, // 미주입=게이트 OFF(안전)
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly medicalAi?: MedicalAiService, // 전체 분석 AI 경로(부가·미가용 시 규칙 저하)
  ) {}

  private async assertEnabled(userId: string): Promise<void> {
    const enabled = (await this.configRuntime?.get('voiceEmr.ambient.enabled')) === true;
    if (!enabled) {
      throw new ForbiddenException({ code: 'AMBIENT_DISABLED', message: '대화 기록 기능이 비활성 상태입니다.' });
    }
    const pilot = (await this.configRuntime?.get('voiceEmr.pilotUserIds')) as string[] | undefined;
    if (Array.isArray(pilot) && pilot.length > 0 && !pilot.includes('*') && !pilot.includes(userId)) {
      throw new ForbiddenException({ code: 'AMBIENT_NOT_PILOT', message: '대화 기록 파일럿 대상이 아닙니다.' });
    }
  }

  /** 담당의 본인만(IDOR 차단) */
  private async loadOwnedEncounter(encounterId: string, userId: string) {
    const enc = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      select: { id: true, patientId: true, doctorId: true },
    });
    if (!enc) throw new NotFoundException('진료기록을 찾을 수 없습니다');
    if (enc.doctorId !== userId) {
      throw new ForbiddenException({ code: 'AMBIENT_NOT_OWNER', message: '본인 진료의 대화 기록만 접근할 수 있습니다.' });
    }
    return enc;
  }

  /** RECORDING 전용 동의 검증(P-7) — 스크라이브와 동일 규약 */
  private async requireRecordingConsent(patientId: string): Promise<string | null> {
    const consent = await this.prisma.consentForm.findFirst({
      where: { patientId, consentType: ConsentType.RECORDING, isValid: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!consent) {
      throw new BadRequestException({ code: 'RECORDING_CONSENT_REQUIRED', message: '진료 녹음 전용 동의가 필요합니다.' });
    }
    return consent.id;
  }

  /** 세션 소유 로드(RECORDING 상태 요구 옵션) */
  private async loadOwnedSession(sid: string, userId: string, requireActive = false) {
    const s = await this.prisma.scribeSession.findUnique({
      where: { id: sid },
      select: { id: true, doctorId: true, patientId: true, encounterId: true, status: true, source: true },
    });
    if (!s || s.source !== 'AMBIENT') throw new NotFoundException('대화 세션을 찾을 수 없습니다');
    if (s.doctorId !== userId) {
      throw new ForbiddenException({ code: 'AMBIENT_NOT_OWNER', message: '본인 세션만 접근할 수 있습니다.' });
    }
    if (requireActive && s.status !== ScribeSessionStatus.RECORDING) {
      throw new BadRequestException({ code: 'AMBIENT_SESSION_CLOSED', message: '종료된 대화 세션입니다.' });
    }
    return s;
  }

  // ── EP 구현 ──

  async startSession(encounterId: string, userId: string) {
    await this.assertEnabled(userId);
    const enc = await this.loadOwnedEncounter(encounterId, userId);
    const consentId = await this.requireRecordingConsent(enc.patientId);
    const session = await this.prisma.scribeSession.create({
      data: {
        encounterId: enc.id,
        patientId: enc.patientId,
        doctorId: enc.doctorId,
        consentId,
        source: 'AMBIENT',
        sttTier: 'GPU_CHUNK',
        resolverKind: 'HEURISTIC',
      },
      select: { id: true, encounterId: true, patientId: true, status: true, createdAt: true },
    });
    // G3 환자 신원 고정 표기용(패널 헤더)
    const patient = await this.prisma.patient.findUnique({
      where: { id: enc.patientId },
      select: { familyName: true, givenName: true, mrn: true },
    });
    return {
      ...session,
      patient: patient ? { name: `${patient.familyName ?? ''}${patient.givenName ?? ''}`, mrn: patient.mrn } : null,
    };
  }

  async getSession(sid: string, userId: string) {
    const s = await this.loadOwnedSession(sid, userId);
    const utterances = await this.prisma.voiceUtterance.findMany({
      where: { sessionId: sid, deleted: false },
      orderBy: { seq: 'asc' },
      select: {
        seq: true, startedAt: true, text: true, editedText: true, speaker: true,
        speakerSource: true, confidence: true, droppedSec: true,
      },
    });
    return { id: s.id, status: s.status, utterances };
  }

  /** 발화 확정 저장 — (sessionId,seq) 멱등 upsert. 응답에 규칙 NER 동봉(패널 칩·P1 반영 준비). */
  async addUtterance(sid: string, userId: string, dto: AddUtteranceDto): Promise<{ seq: number; entities: ClinicalEntities }> {
    // 마스터 킬스위치·파일럿 재확인 — 세션 시작 후 운영자가 ambient.enabled 를 OFF(예: 환자 녹음 동의
    // 철회·프라이버시 사고) 하면 발화 저장을 즉시 중단해야 한다. FE 는 이미 AMBIENT_DISABLED 를 처리한다.
    await this.assertEnabled(userId);
    await this.loadOwnedSession(sid, userId, true);
    const text = dto.text.trim();
    if (!text) throw new BadRequestException({ code: 'AMBIENT_EMPTY_TEXT', message: '빈 발화는 저장할 수 없습니다.' });
    await this.prisma.voiceUtterance.upsert({
      where: { sessionId_seq: { sessionId: sid, seq: dto.seq } },
      create: {
        sessionId: sid,
        seq: dto.seq,
        text,
        speaker: dto.speaker ?? 'UNKNOWN',
        speakerSource: 'HEURISTIC',
        confidence: dto.confidence ?? null,
        droppedSec: dto.droppedSec ?? null,
      },
      update: { text, confidence: dto.confidence ?? null, droppedSec: dto.droppedSec ?? null }, // 재전송=최종본 갱신(화자 수동값 보존)
    });
    return { seq: dto.seq, entities: extractClinicalEntities(text) };
  }

  /** 수정·화자 토글·소프트 삭제 — 원문 보존(editedText)·수동 화자=MANUAL 승격 */
  async patchUtterance(sid: string, seq: number, userId: string, dto: PatchUtteranceDto) {
    await this.loadOwnedSession(sid, userId);
    const u = await this.prisma.voiceUtterance.findUnique({ where: { sessionId_seq: { sessionId: sid, seq } } });
    if (!u) throw new NotFoundException('발화를 찾을 수 없습니다');
    const updated = await this.prisma.voiceUtterance.update({
      where: { sessionId_seq: { sessionId: sid, seq } },
      data: {
        ...(dto.text !== undefined ? { editedText: dto.text.trim() || null } : {}),
        ...(dto.speaker !== undefined ? { speaker: dto.speaker, speakerSource: 'MANUAL' } : {}),
        ...(dto.deleted !== undefined ? { deleted: dto.deleted } : {}),
      },
      select: { seq: true, text: true, editedText: true, speaker: true, speakerSource: true, deleted: true },
    });
    const effective = updated.editedText ?? updated.text;
    return { ...updated, entities: updated.deleted ? null : extractClinicalEntities(effective) };
  }

  /**
   * 전체 분석 — 발화 → 필드별 SOAP 제안 카드(경로 B).
   * 규칙 경로는 항상 산출(결정적·출처 seq 추적 · D2 정돈: 주호소·반복 병합·활력 최신값·계획 묶음). AI 경로는
   * `voiceEmr.ambient.aiDraft.enabled` + 서버 가용 시 **부가**로 덧붙인다(미가용=규칙만·503 아님).
   * 어떤 경로도 기록을 확정하지 않음(DRAFT-only). 응답의 `coverage` 가 분모(발화 수 5분류·합=전체)다.
   */
  async analyze(sid: string, userId: string) {
    const s = await this.loadOwnedSession(sid, userId);
    const utts = await this.prisma.voiceUtterance.findMany({
      where: { sessionId: sid, deleted: false },
      orderBy: { seq: 'asc' },
      select: { seq: true, text: true, editedText: true, speaker: true, confidence: true, droppedSec: true },
    });
    const confFloor = ((await this.configRuntime?.get('voiceEmr.ambient.confidenceFloor')) as number | undefined) ?? 0.5;
    // 저신뢰 발화는 분석 입력에서 제외(환각 유입 차단·§6). 제외분은 개수로 보고.
    const usable = utts.filter((u) => (u.confidence ?? 1) >= confFloor);
    const lowConfidence = utts.length - usable.length;
    const input = usable.map((u) => ({ seq: u.seq, text: u.editedText ?? u.text, speaker: u.speaker }));

    const { suggestions: ruleSug, skipped, coverage, structure } = consolidate(input, { lowConfidence });
    const suggestions: SoapSuggestion[] = [...ruleSug];

    let engine: 'RULE' | 'RULE+AI' = 'RULE';
    /** AI 로 보낸 텍스트에서 지운 건수 — `null`=AI 경로로 아무것도 보내지 않았다(0 과 다른 사실) */
    let redacted: { names: number; ids: number } | null = null;
    let aiSkipped: AmbientAiSkipReason | null = null;
    const aiEnabled = (await this.configRuntime?.get('voiceEmr.ambient.aiDraft.enabled')) === true;
    if (aiEnabled && this.medicalAi && input.length > 0) {
      const roleLabel: Record<string, string> = { DOCTOR: '의사', PATIENT: '환자', UNKNOWN: '화자' };
      const conversation = input.map((u) => `${roleLabel[String(u.speaker)] ?? '화자'}: ${u.text}`).join('\n');
      /**
       * 🔴 D5 — 대화 원문은 **비식별을 지난 뒤에만** AI 서버로 나간다(§13.2 P0-3).
       *    이름은 세션이 아는 환자·의사만 지운다(추측 금지 · 정본 `redactForAiEgress`).
       *    이름 조회가 실패하면 **보내지 않는다** — "이름 없음"으로 접어 실명 대화를 보내는 것이 이 결함의 본체였다.
       */
      let names: Awaited<ReturnType<typeof loadEgressNames>> | null = null;
      try {
        names = await loadEgressNames(this.prisma, { patientId: s.patientId, doctorId: s.doctorId });
      } catch (e) {
        if (!(e instanceof EgressNamesUnavailableError)) throw e;
        aiSkipped = 'NAMES_UNAVAILABLE';
        this.logger.warn(`ambient analyze AI 경로 생략 — 비식별용 이름 조회 실패(${e.missing.join(',')}) sid=${sid}`);
      }
      if (names) {
        const red = redactForAiEgress(conversation, {
          patientNames: names.patientNames,
          staffNames: names.staffNames,
          recordNumbers: names.recordNumbers,
          rehydrateTo: names.rehydrateTo,
        });
        redacted = { names: red.counts.names, ids: red.counts.identifiers };
        try {
          const ai = red.rehydrate(await this.medicalAi.autoRecord({ conversation: red.text }));
          const aiSug = aiSuggestionsFrom(ai, input.map((u) => u.seq));
          if (aiSug.length) { suggestions.push(...aiSug); engine = 'RULE+AI'; }
        } catch (e) {
          aiSkipped = 'AI_ERROR';
          this.logger.warn(`ambient analyze AI 경로 실패 — 규칙 제안만 반환: ${e instanceof Error ? e.message : e}`);
        }
      }
    }

    const droppedTotal = utts.reduce((n, u) => n + (u.droppedSec ?? 0), 0);
    await this.audit?.safeLog({
      userId, action: AuditAction.READ, resourceType: 'AmbientAnalyze', resourceId: s.patientId,
      changes: { ambientAnalyze: { old: null, new: { sessionId: sid, utterances: utts.length, suggestions: suggestions.length, engine, redacted, aiSkipped } } },
    });
    // 종전 `utteranceCount`·`lowConfidence` 최상위 필드는 `coverage` 로 옮겼다(같은 사실에 자리 둘을 두지 않는다)
    return { engine, suggestions, skipped, coverage, structure, droppedTotal, redacted, aiSkipped };
  }

  /**
   * 제안 반영 기록(provenance) — 실제 SOAP 텍스트 쓰기는 기존 encounter 저장 경로(FE append).
   * 여기서는 **무엇이 어디에 어느 발화로부터 반영됐는지**를 감사·Encounter 프로비넌스로 남긴다.
   */
  async applySuggestion(sid: string, userId: string, dto: ApplySuggestionDto) {
    const s = await this.loadOwnedSession(sid, userId);
    /**
     * 🔴 프로비넌스(Encounter)와 세션 상태·반영 스냅샷은 **한 트랜잭션**에서 움직인다.
     *    따로 쓰면 "진료기록은 AI 초안 표식이 붙었는데 세션은 아무 일도 없던 것처럼" 갈라진다.
     *
     * 🔴 **상태 전이는 종료된 세션에서만**(TRANSCRIBED/DRAFTED → APPLIED).
     *    녹음 중(RECORDING)에 반영하면 그대로 둔다 — 여기서 APPLIED 로 올리면
     *    `closeSession` 이 RECORDING 을 요구하므로 **종료 자체가 막힌다**(반영 한 번이 녹음을 끊는다).
     *    실 흐름은 정지→close(TRANSCRIBED)→분석→반영이라 이 전이가 실제로 일어난다.
     *    FAILED/DELETED 는 되살리지 않는다.
     *
     * 🔴 `draftSnapshot` 에 **반영된 초안 텍스트**를 필드별로 누적한다. 앰비언트 경로에는
     *    `draft()` 가 만드는 스냅샷이 없어서, 이게 없으면 서명 시 편집거리를 **잴 재료가 없다**
     *    (`Encounter.aiEditDistance` 가 영원히 null 이 된다). 기존 키는 덮지 않고 병합한다.
     */
    const applied = await this.prisma.$transaction(async (tx) => {
      const cur = await tx.scribeSession.findUnique({
        where: { id: s.id },
        select: { status: true, draftSnapshot: true },
      });
      const snapRaw = cur?.draftSnapshot;
      const snap: Record<string, unknown> =
        snapRaw && typeof snapRaw === 'object' && !Array.isArray(snapRaw) ? { ...(snapRaw as Record<string, unknown>) } : {};
      const prevRaw = snap.appliedFields;
      const fields: Record<string, string> =
        prevRaw && typeof prevRaw === 'object' && !Array.isArray(prevRaw) ? { ...(prevRaw as Record<string, string>) } : {};
      fields[dto.field] = fields[dto.field] ? `${fields[dto.field]}\n${dto.text}` : dto.text;
      snap.appliedFields = fields;

      const canTransition =
        cur?.status === ScribeSessionStatus.TRANSCRIBED || cur?.status === ScribeSessionStatus.DRAFTED;

      await tx.encounter.update({
        where: { id: s.encounterId },
        data: { aiScribed: true, scribeSessionId: s.id },
      });
      await tx.scribeSession.update({
        where: { id: s.id },
        data: {
          draftSnapshot: snap as Prisma.InputJsonValue,
          ...(canTransition ? { status: ScribeSessionStatus.APPLIED } : {}),
        },
      });
      return { statusBefore: cur?.status ?? null, status: canTransition ? ScribeSessionStatus.APPLIED : (cur?.status ?? null) };
    });
    await this.audit?.safeLog({
      userId, action: AuditAction.UPDATE, resourceType: 'AmbientSoapApply', resourceId: s.patientId,
      changes: { ambientSoapApply: { old: { sessionStatus: applied.statusBefore }, new: { sessionId: sid, field: dto.field, engine: dto.engine ?? 'RULE', sourceSeqs: dto.sourceSeqs ?? [], textLength: dto.text.length, sessionStatus: applied.status } } },
    });
    return { ok: true, field: dto.field, sessionStatus: applied.status };
  }

  /**
   * 종료 — 발화 스냅샷을 세션 transcript(화자분리 세그먼트 호환 포맷)로 고정·상태 TRANSCRIBED.
   * 전체 분석(analyze)은 이 발화들을 그대로 소비(스크라이브 draft 파이프라인과 동일 재료).
   */
  async closeSession(sid: string, userId: string) {
    const s = await this.loadOwnedSession(sid, userId, true);
    const utterances = await this.prisma.voiceUtterance.findMany({
      where: { sessionId: sid, deleted: false },
      orderBy: { seq: 'asc' },
      select: { seq: true, text: true, editedText: true, speaker: true, droppedSec: true },
    });
    const transcript = utterances.map((u) => ({
      seq: u.seq,
      speaker: u.speaker,
      text: u.editedText ?? u.text,
      ...(u.droppedSec ? { droppedSec: u.droppedSec } : {}),
    }));
    const droppedTotal = utterances.reduce((n, u) => n + (u.droppedSec ?? 0), 0);
    await this.prisma.scribeSession.update({
      where: { id: s.id },
      data: { status: ScribeSessionStatus.TRANSCRIBED, transcript },
    });
    this.logger.log(`ambient session closed sid=${sid} utterances=${utterances.length}`);
    return { id: s.id, status: ScribeSessionStatus.TRANSCRIBED, utteranceCount: utterances.length, droppedTotal };
  }
}
