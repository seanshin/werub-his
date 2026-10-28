import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import {
  AuditAction,
  ConsentType,
  Prisma,
  ScribeSessionStatus,
  ScribeVoiceProfileStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { AuditService } from '../audit/audit.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { ScribeAiClient } from './scribe-ai.client';
import { SpeakerResolver } from './speaker-resolver';
import { extractClinicalEntities, entitiesToSoap } from './clinical-ner';
import { EnrollVoiceProfileDto, RelabelScribeSegmentDto, UploadScribeAudioDto } from './dto/scribe.dto';
import { signingSecret } from '../../common/util/signing-secret';
import { redactForAiEgress } from '../../common/util/ai-phi-redact';
import { loadEgressNames, EgressNamesUnavailableError } from './scribe-egress-names';

/**
 * SOAP 초안 생성 파이프라인 버전 — `ScribeSession.aiPromptVersion` 에 기록한다(§11 프로비넌스).
 *
 * 🔴 **두 갈래를 한 이름으로 부르지 않는다.** AI 경로(WeRU.B `/api/medical/auto-record`)와
 *    규칙 저하 경로(`entitiesToSoap` · 프롬프트 자체가 없다)는 다른 방법으로 만든 초안이다.
 *    한 상수로 뭉치면 나중에 "이 초안이 무엇으로 만들어졌는가"를 되물을 수 없다.
 */
export const SCRIBE_DRAFT_PROMPT_VERSION_AI = 'scribe-soap-ai-v1';
export const SCRIBE_DRAFT_PROMPT_VERSION_RULE = 'scribe-soap-rule-v1';

/**
 * 상류(WeRU.B)가 **실제로 돌려준** 모델 이름만 꺼낸다.
 * 🔴 없으면 `null` — 지어내지 않는다(이 저장소는 `model: 'qwen2.5'` 하드코딩으로 한 번 데었다).
 *    스키마 `ai_model` 은 VarChar(64) 라 넘치면 저장이 깨진다 → 앞 64자만.
 */
export function pickAiModelName(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const v = o.model_used ?? o.model;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, 64) : null;
}

const MIME_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};
const EXT_MIME: Record<string, string> = {
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
};
const DEFAULT_MAX_AUDIO_MB = 10; // 서버 json 한도 15mb ÷ base64 팽창(~1.37) ≈ 11MB → 10MB 안전. P1 청크로 확대.

/**
 * 앰비언트 진료 스크라이브 — P0 스캐폴드.
 * - 세션 lifecycle(동의 게이트·소유 검증)·오디오 PHI 저장(HMAC 스트리밍)·의료진 음성 프로파일.
 * - 전사/초안(STT 어댑터)은 P1(Track B). 여기선 501 스텁.
 * - config `scribe.enabled` 기본 OFF → 게이트 미충족 시 403(무중단).
 */
@Injectable()
export class ScribeService {
  private readonly logger = new Logger(ScribeService.name);
  private static readonly FNAME_RE = /^scribe-\d+-[a-f0-9]+\.(webm|ogg|m4a|wav)$/;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: ScribeAiClient,
    private readonly resolver: SpeakerResolver,
    @Optional() private readonly configRuntime?: ConfigRuntimeService, // 미주입=게이트 OFF(안전)
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly medicalAi?: MedicalAiService, // draft(전사→SOAP·NER) 재사용
  ) {}

  // ── 게이트·검증 ──

  /** config `scribe.enabled`(+파일럿) 게이트. 미충족 시 403(무중단 회귀). */
  private async assertEnabled(userId: string): Promise<void> {
    const enabled = (await this.configRuntime?.get('scribe.enabled')) === true;
    if (!enabled) {
      throw new ForbiddenException({ code: 'SCRIBE_DISABLED', message: '스크라이브 기능이 비활성 상태입니다.' });
    }
    const pilot = (await this.configRuntime?.get('scribe.pilotUserIds')) as string[] | undefined;
    if (Array.isArray(pilot) && pilot.length > 0 && !pilot.includes(userId)) {
      throw new ForbiddenException({ code: 'SCRIBE_NOT_PILOT', message: '스크라이브 파일럿 대상이 아닙니다.' });
    }
  }

  /** 담당의 본인만(IDOR 차단). encounter 로드 + doctorId 일치 확인. */
  private async loadOwnedEncounter(encounterId: string, userId: string) {
    const enc = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      select: { id: true, patientId: true, doctorId: true },
    });
    if (!enc) throw new NotFoundException('진료기록을 찾을 수 없습니다');
    if (enc.doctorId !== userId) {
      throw new ForbiddenException({ code: 'SCRIBE_NOT_OWNER', message: '본인 진료의 스크라이브만 접근할 수 있습니다.' });
    }
    return enc;
  }

  /** RECORDING 전용 동의 검증(P-7). 없으면 녹음 불가. */
  private async requireRecordingConsent(patientId: string): Promise<string | null> {
    const consent = await this.prisma.consentForm.findFirst({
      where: { patientId, consentType: ConsentType.RECORDING, isValid: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!consent) {
      throw new BadRequestException({
        code: 'RECORDING_CONSENT_REQUIRED',
        message: '진료 녹음 전용 동의가 필요합니다.',
      });
    }
    return consent.id;
  }

  // ── 세션 lifecycle ──

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
        status: ScribeSessionStatus.RECORDING,
      },
    });
    await this.audit?.safeLog({
      userId,
      action: AuditAction.CREATE,
      resourceType: 'ScribeSession',
      resourceId: session.id,
    });
    return session;
  }

  async getSession(encounterId: string, sid: string, userId: string) {
    await this.assertEnabled(userId);
    await this.loadOwnedEncounter(encounterId, userId);
    let s = await this.prisma.scribeSession.findUnique({ where: { id: sid } });
    if (!s || s.encounterId !== encounterId) throw new NotFoundException('세션을 찾을 수 없습니다');
    // 전사 진행 중이면 잡을 1회 폴링해 완료/실패 반영(논블로킹·FE 폴링 주도)
    if (s.status === ScribeSessionStatus.TRANSCRIBING && s.jobId) {
      s = await this.finalizeTranscriptionIfDone(s.id, s.jobId, s.doctorId);
    }
    return s;
  }

  /**
   * 화자분리 세그먼트 재라벨(D8) — 의사가 `TranscriptViewer` 에서 고른 화자를 **서버에 영속**시킨다.
   *
   * 🔴 무엇이 틀려 있었나(§13.2 P2 · voice-emr-ambient-conversation.plan.md): `TranscriptViewer.onRelabel` 이
   *    로컬 React 상태만 바꿨다 — `scribe-api.ts` 에 PATCH 가 없어 서버 `ScribeSession.transcript` 는 자동
   *    라벨 그대로였고, `draft()` 는 그 DB 값을 읽으므로 **의사가 고친 화자가 초안에 들어가지 않았다.**
   *
   * 🔴 원문은 못 바꾼다 — `RelabelScribeSegmentDto` 에 `text` 필드가 아예 없다(전사 원문 보존 규약).
   *    이 메서드는 세그먼트의 `role` 만 교체하고 `text`·`start`·`end`·`speaker` 는 그대로 둔다.
   */
  async relabelSegment(encounterId: string, sid: string, index: number, userId: string, dto: RelabelScribeSegmentDto) {
    await this.assertEnabled(userId);
    await this.loadOwnedEncounter(encounterId, userId);
    const s = await this.prisma.scribeSession.findUnique({ where: { id: sid } });
    if (!s || s.encounterId !== encounterId) throw new NotFoundException('세션을 찾을 수 없습니다');
    const segs = Array.isArray(s.transcript) ? [...(s.transcript as Array<Record<string, unknown>>)] : [];
    if (!segs.length) throw new BadRequestException({ code: 'NO_TRANSCRIPT', message: '전사가 준비되지 않았습니다.' });
    if (index < 0 || index >= segs.length) {
      throw new BadRequestException({ code: 'SEGMENT_NOT_FOUND', message: '해당 구간을 찾을 수 없습니다.' });
    }
    const before = segs[index]?.role;
    // 화자만 교체 — text/start/end/speaker(원 화자 식별자)는 손대지 않는다(원문 보존)
    segs[index] = { ...segs[index], role: dto.role, roleSource: 'MANUAL' };
    await this.prisma.scribeSession.update({
      where: { id: sid },
      data: { transcript: segs as unknown as Prisma.InputJsonValue },
    });
    await this.audit?.safeLog({
      userId,
      action: AuditAction.UPDATE,
      resourceType: 'ScribeSegmentRelabel',
      resourceId: sid,
      changes: { role: { old: before ?? null, new: dto.role } },
    });
    return segs[index];
  }

  /** 오디오 업로드(P0 base64) → storage/scribe/… 저장 + 서명 URL 반환. */
  async uploadAudio(encounterId: string, sid: string, userId: string, dto: UploadScribeAudioDto) {
    await this.assertEnabled(userId);
    await this.loadOwnedEncounter(encounterId, userId);
    const s = await this.prisma.scribeSession.findUnique({ where: { id: sid } });
    if (!s || s.encounterId !== encounterId) throw new NotFoundException('세션을 찾을 수 없습니다');
    // 상태 가드: 파기/삭제(동의 철회)·전사 이후 세션은 재업로드 금지(부활 차단)
    if (s.status !== ScribeSessionStatus.RECORDING && s.status !== ScribeSessionStatus.UPLOADED) {
      throw new BadRequestException({ code: 'SCRIBE_BAD_STATE', message: `업로드할 수 없는 세션 상태입니다 (${s.status}).` });
    }
    // 동의 재검증(P-7): 세션 시작 후 철회됐으면 PHI 오디오 저장 차단
    await this.requireRecordingConsent(s.patientId);

    const mime = (dto.mime ?? 'audio/webm').toLowerCase();
    const ext = MIME_EXT[mime];
    if (!ext) throw new BadRequestException('지원하지 않는 오디오 형식입니다 (webm/ogg/m4a/wav)');
    const b64 = dto.audioBase64.replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) throw new BadRequestException('오디오 데이터가 비어 있습니다');
    const maxMb = Number(await this.configRuntime?.get('scribe.audio.maxUploadMb')) || DEFAULT_MAX_AUDIO_MB;
    if (buf.length > maxMb * 1024 * 1024) {
      throw new BadRequestException(`오디오가 너무 큽니다 (${maxMb}MB 제한·서버 json 15mb 정합·긴 진료는 P1 청크 업로드)`);
    }

    const { promises: fs } = await import('fs');
    const { join } = await import('path');
    const dir = join(process.cwd(), 'storage', 'scribe', encounterId);
    await fs.mkdir(dir, { recursive: true });
    // 재업로드 시 이전 원음 파기(고아 PHI 잔류 방지)
    if (s.audioPath) await fs.unlink(join(process.cwd(), s.audioPath)).catch(() => undefined);
    const fname = `scribe-${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`;
    await fs.writeFile(join(dir, fname), buf);

    const updated = await this.prisma.scribeSession.update({
      where: { id: sid },
      data: { audioPath: `storage/scribe/${encounterId}/${fname}`, status: ScribeSessionStatus.UPLOADED },
    });
    await this.audit?.safeLog({
      userId,
      action: AuditAction.CREATE,
      resourceType: 'ScribeSessionAudio',
      resourceId: sid,
    });
    return { session: updated, audioUrl: this.audioSignedUrl(encounterId, fname), bytes: buf.length };
  }

  async deleteSession(encounterId: string, sid: string, userId: string) {
    await this.assertEnabled(userId);
    await this.loadOwnedEncounter(encounterId, userId);
    const s = await this.prisma.scribeSession.findUnique({ where: { id: sid } });
    if (!s || s.encounterId !== encounterId) throw new NotFoundException('세션을 찾을 수 없습니다');
    if (s.legalHold) throw new BadRequestException({ code: 'LEGAL_HOLD', message: '보존명령 중인 세션은 삭제할 수 없습니다.' });

    if (s.audioPath) {
      const { promises: fs } = await import('fs');
      const { join } = await import('path');
      await fs.unlink(join(process.cwd(), s.audioPath)).catch(() => undefined);
    }
    const updated = await this.prisma.scribeSession.update({
      where: { id: sid },
      data: { status: ScribeSessionStatus.DELETED, audioPath: null, audioDeletedAt: new Date() },
    });
    // 법정 보존 대상 — safeLog 아닌 log()(throw)
    await this.audit?.log({
      userId,
      action: AuditAction.DELETE,
      resourceType: 'ScribeSession',
      resourceId: sid,
    });
    return updated;
  }

  // ── 전사·화자분리(P1·Track B) ──
  // 경로: IMAC_BATCH(/api/meeting/analyze diarize·기본). 워커/GPU 자원 장애 시 FAILED→FE 수동 폴백(무중단).
  // ⚠️ diarize 응답 스키마 미확정(D-2) — parseTranscription 방어적, 실 응답 캡처 후 정본화.

  /** 전사 제출(비동기·논블로킹) — 잡 제출 후 즉시 반환. 완료는 getSession 폴링에서 finalize. */
  async transcribe(encounterId: string, sid: string, userId: string, diarize = true) {
    await this.assertEnabled(userId);
    await this.loadOwnedEncounter(encounterId, userId);
    const s = await this.prisma.scribeSession.findUnique({ where: { id: sid } });
    if (!s || s.encounterId !== encounterId) throw new NotFoundException('세션을 찾을 수 없습니다');
    if (!s.audioPath) throw new BadRequestException({ code: 'NO_AUDIO', message: '업로드된 오디오가 없습니다.' });
    // 멱등: 이미 전사 진행 중이면 재제출 금지
    if (s.status === ScribeSessionStatus.TRANSCRIBING && s.jobId) {
      return { sessionId: sid, jobId: s.jobId, status: s.status };
    }
    // 완료된 전사/초안 위에 재전사 금지(의사 수정 라벨·draft 덮어쓰기 방지)
    if (s.status !== ScribeSessionStatus.UPLOADED && s.status !== ScribeSessionStatus.FAILED) {
      throw new BadRequestException({ code: 'SCRIBE_BAD_STATE', message: `전사할 수 없는 세션 상태입니다 (${s.status}).` });
    }
    // 동의 재검증(P-7): 세션 시작 후 철회됐으면 외부 전사 차단
    await this.requireRecordingConsent(s.patientId);
    // 전사 전달방식(§4.4(1)·D-9): 개발=WeRU.B S3 경유(허용), 운영=내부 스토리지(HIS 서명URL fetch·PHI 잔류).
    //   기본 OFF — 개발에서 flip ON. 미활성 시 전사 불가(진료·수동 작성은 무중단).
    const txEnabled = (await this.configRuntime?.get('scribe.transcription.enabled')) === true;
    if (!txEnabled) {
      throw new HttpException(
        { code: 'TRANSCRIPTION_DISABLED', message: '전사 미활성 — 외부 오디오 전달 DPA·전달방식(D-9) 선결.' },
        HttpStatus.NOT_IMPLEMENTED,
      );
    }

    const { promises: fs } = await import('fs');
    const { join } = await import('path');
    const buf = await fs.readFile(join(process.cwd(), s.audioPath)).catch(() => {
      throw new BadRequestException({ code: 'AUDIO_MISSING', message: '오디오 파일이 없습니다.' });
    });
    const fname = s.audioPath.split('/').pop() ?? 'scribe.webm';
    const ext = fname.split('.').pop() ?? 'webm';
    const mime = EXT_MIME[ext] ?? 'audio/webm';

    try {
      const fileUrl = await this.aiClient.uploadAudio(buf, fname, mime);
      const jobId = await this.aiClient.submitTranscription(fileUrl, diarize);
      const updated = await this.prisma.scribeSession.update({
        where: { id: sid },
        data: { status: ScribeSessionStatus.TRANSCRIBING, jobId, sttTier: 'IMAC_BATCH' },
      });
      await this.audit?.safeLog({ userId, action: AuditAction.CREATE, resourceType: 'ScribeTranscribe', resourceId: sid });
      return { sessionId: sid, jobId, status: updated.status };
    } catch (e) {
      await this.prisma.scribeSession.update({ where: { id: sid }, data: { status: ScribeSessionStatus.FAILED } });
      throw e; // 논블로킹: FE가 수동 폴백. (WeRU.B STT 자원 장애 등)
    }
  }

  /** 잡 완료 시 전사 파싱·화자확정·저장(1회 폴링에서 호출). */
  private async finalizeTranscriptionIfDone(sid: string, jobId: string, doctorId: string) {
    const { status, error, raw, httpStatus } = await this.aiClient.pollJob(jobId);
    // 🔴 r3 B3: 상류 비-2xx(`http_error`)도 실패다 — 'unknown'(진행 중)으로 두면 TRANSCRIBING 에 영원히 멈춘다.
    if (status === 'failed' || status === 'error' || status === 'http_error') {
      this.logger.warn(`scribe transcribe failed sid=${sid}: ${error}${httpStatus ? ` (upstream HTTP ${httpStatus})` : ''}`);
      return this.prisma.scribeSession.update({ where: { id: sid }, data: { status: ScribeSessionStatus.FAILED } });
    }
    if (status !== 'done' && status !== 'completed') {
      return this.prisma.scribeSession.findUniqueOrThrow({ where: { id: sid } }); // 아직 진행 중
    }
    const t = this.aiClient.parseTranscription(raw);
    // 🔴 r3 B4: 세그먼트 0개를 "전사 완료"로 말하지 않는다 — "무음이었다"와 "파서가 못 읽었다"(D-2 스키마 미확정)가
    //    같은 모양이 된다(P16). 기존 어휘 FAILED 로 두어 재전사·수동 작성으로 가게 한다. 사유 컬럼이 없어 로그에 남긴다.
    if (!t.segments.length) {
      const keys = raw && typeof raw === 'object' ? Object.keys(raw as Record<string, unknown>).join(',') : typeof raw;
      this.logger.warn(`scribe transcribe produced 0 segments sid=${sid} (UNPARSED_OR_EMPTY · raw keys: ${keys})`);
      return this.prisma.scribeSession.update({ where: { id: sid }, data: { status: ScribeSessionStatus.FAILED } });
    }
    // 화자확정: 임베딩+의사 프로파일 있으면 A(대조), 아니면 C(휴리스틱)
    const profile = await this.prisma.scribeVoiceProfile.findUnique({ where: { doctorId } });
    const docEmb = (profile?.status === ScribeVoiceProfileStatus.ACTIVE && Array.isArray(profile.embedding)
      ? (profile.embedding as unknown as number[])
      : null);
    const labeled =
      t.hasEmbeddings && docEmb ? this.resolver.resolveByEmbedding(t.segments, docEmb) : this.resolver.resolveByHeuristic(t.segments);
    const resolverKind = t.hasEmbeddings && docEmb ? 'EMBEDDING' : 'HEURISTIC';
    return this.prisma.scribeSession.update({
      where: { id: sid },
      data: {
        status: ScribeSessionStatus.TRANSCRIBED,
        transcript: labeled as unknown as Prisma.InputJsonValue,
        resolverKind,
      },
    });
  }

  // ── SOAP 초안(전사→NER+SOAP·MedicalAiService 재사용·거버넌스 동봉) ──

  async draft(encounterId: string, sid: string, userId: string) {
    await this.assertEnabled(userId);
    await this.loadOwnedEncounter(encounterId, userId);
    const s = await this.prisma.scribeSession.findUnique({ where: { id: sid } });
    if (!s || s.encounterId !== encounterId) throw new NotFoundException('세션을 찾을 수 없습니다');
    const segs = Array.isArray(s.transcript) ? (s.transcript as Array<{ role?: string; text?: string }>) : [];
    if (!segs.length) throw new BadRequestException({ code: 'NO_TRANSCRIPT', message: '전사가 준비되지 않았습니다.' });

    const roleLabel: Record<string, string> = { DOCTOR: '의사', PATIENT: '환자', GUARDIAN: '보호자', OTHER: '기타' };
    const conversation = segs.map((x) => `${roleLabel[x.role ?? 'OTHER'] ?? '화자'}: ${x.text ?? ''}`).join('\n');

    // S3 규칙 기반 구조화 추출(결정적·AI 무관) — AI 있으면 부가, 없으면 이걸로 저하 draft.
    const entities = extractClinicalEntities(conversation);

    let result: Record<string, unknown>;
    /**
     * 🔴 **무엇이 이 초안을 만들었는가**를 세션에 남긴다(종전 writer 0 — 필드가 죽어 있었다).
     *    모델 이름은 **상류가 말한 것만** 쓴다. 안 알려주면 `null` 이고, 그건 "모델을 모른다"는 사실이다.
     */
    let aiModel: string | null = null;
    let promptVersion: string = SCRIBE_DRAFT_PROMPT_VERSION_RULE;
    /**
     * 🔴 D5 — 전사 원문은 **비식별을 지난 뒤에만** AI 서버로 나간다(§13.2 P0-3). 종전 주석의 "PHI 비식별"은
     *    상류가 해 준다는 뜻이었고 이 모듈은 `redact*` 를 한 번도 부르지 않았다 — 실명 대화가 그대로 나갔다.
     *    이름은 세션이 아는 환자·의사만(추측 금지). 이름 조회가 실패하면 AI 경로를 **타지 않고** 그 사실을 초안에 남긴다.
     */
    let names: Awaited<ReturnType<typeof loadEgressNames>> | null = null;
    let aiSkipped: 'NAMES_UNAVAILABLE' | null = null;
    if (this.medicalAi) {
      try {
        names = await loadEgressNames(this.prisma, { patientId: s.patientId, doctorId: s.doctorId });
      } catch (e) {
        if (!(e instanceof EgressNamesUnavailableError)) throw e;
        aiSkipped = 'NAMES_UNAVAILABLE';
        this.logger.warn(`scribe draft AI 경로 생략 — 비식별용 이름 조회 실패(${e.missing.join(',')}) sid=${sid}`);
      }
    }
    if (this.medicalAi && names) {
      const red = redactForAiEgress(conversation, {
        patientNames: names.patientNames,
        staffNames: names.staffNames,
        recordNumbers: names.recordNumbers,
        rehydrateTo: names.rehydrateTo,
      });
      const ai = red.rehydrate((await this.medicalAi.autoRecord({ conversation: red.text })) as Record<string, unknown>); // NER+SOAP·disclaimer
      result = { ...ai, structuredEntities: entities, redacted: { names: red.counts.names, ids: red.counts.identifiers } };
      promptVersion = SCRIBE_DRAFT_PROMPT_VERSION_AI;
      aiModel = pickAiModelName(ai);
    } else {
      // AI 미가용(또는 비식별용 이름 조회 실패) → 규칙 기반 SOAP 초안으로 저하(503 대신). A(평가)는 의사 작성. P-1: 초안만.
      const soap = entitiesToSoap(entities);
      result = {
        soap,
        structuredEntities: entities,
        source: 'rule',
        disclaimer: 'AI 미가용 — 규칙 기반 구조화 초안입니다. 반드시 의료진이 검토·보완 후 서명하세요.',
        ...(aiSkipped ? { aiSkipped } : {}),
      };
    }

    await this.prisma.scribeSession.update({
      where: { id: sid },
      data: {
        status: ScribeSessionStatus.DRAFTED,
        draftSnapshot: result as Prisma.InputJsonValue,
        aiModel, // null = 상류가 모델을 밝히지 않았다(규칙 저하 경로 포함)
        aiPromptVersion: promptVersion,
      },
    });
    await this.audit?.safeLog({ userId, action: AuditAction.CREATE, resourceType: 'ScribeDraft', resourceId: sid });
    // Encounter 서명은 기존 경로(step-up+블록체인) — AI는 DRAFT까지만(P-1)
    return result;
  }

  // ── 오디오 HMAC 스트리밍(무가드 EP에서 호출) ──

  private audioToken(encounterId: string, fname: string, exp: number): string {
    return createHmac('sha256', signingSecret('scribe-audio'))
      .update(`scribe-audio:${encounterId}/${fname}:${exp}`)
      .digest('hex')
      .slice(0, 32);
  }

  private audioSignedUrl(encounterId: string, fname: string): string {
    const exp = Date.now() + 60 * 60 * 1000; // 1시간
    return `/api/v1/encounters/${encounterId}/scribe/audio/${fname}?exp=${exp}&token=${this.audioToken(encounterId, fname, exp)}`;
  }

  /** 파일 경로+메타 반환(range 스트리밍은 컨트롤러). 파일명 화이트리스트·토큰 검증. */
  async resolveAudioFile(encounterId: string, fname: string, exp: string, token: string) {
    // kill-switch: 게이트 OFF면 발급된 서명 URL이라도 원음 서빙 즉시 차단(무중단 롤백 존중)
    if ((await this.configRuntime?.get('scribe.enabled')) !== true) throw new NotFoundException('오디오를 찾을 수 없습니다');
    if (!ScribeService.FNAME_RE.test(fname)) throw new NotFoundException('오디오를 찾을 수 없습니다');
    const expNum = Number(exp);
    if (!Number.isFinite(expNum) || expNum < Date.now()) {
      throw new NotFoundException('링크가 만료되었습니다. 다시 발급하세요.');
    }
    const expected = this.audioToken(encounterId, fname, expNum);
    const a = Buffer.from(expected);
    const b = Buffer.from(String(token ?? ''));
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new NotFoundException('오디오를 찾을 수 없습니다');
    const { join } = await import('path');
    const ext = fname.split('.').pop() ?? 'webm';
    return {
      absPath: join(process.cwd(), 'storage', 'scribe', encounterId, fname),
      mimeType: EXT_MIME[ext] ?? 'application/octet-stream',
    };
  }

  // ── 의료진 음성 프로파일(특정화자 인식·본인만) ──

  async getVoiceProfile(userId: string) {
    await this.assertEnabled(userId);
    const p = await this.prisma.scribeVoiceProfile.findUnique({
      where: { doctorId: userId },
      select: { id: true, sampleCount: true, status: true, consentAt: true, createdAt: true, updatedAt: true },
    });
    return p ?? { status: 'NONE' as const };
  }

  async enrollVoiceProfile(userId: string, dto: EnrollVoiceProfileDto) {
    await this.assertEnabled(userId);
    if (dto.consent !== true) {
      throw new BadRequestException({ code: 'BIOMETRIC_CONSENT_REQUIRED', message: '생체정보 등록 동의가 필요합니다.' });
    }
    // P0: 임베딩 추출은 P1(Track B). 여기선 자리표시(placeholder)로 프로파일만 생성/갱신.
    const profile = await this.prisma.scribeVoiceProfile.upsert({
      where: { doctorId: userId },
      create: {
        doctorId: userId,
        sampleCount: dto.sampleCount ?? 1,
        consentAt: new Date(),
        status: ScribeVoiceProfileStatus.ACTIVE,
      },
      update: {
        sampleCount: dto.sampleCount ?? 1,
        status: ScribeVoiceProfileStatus.ACTIVE,
        revokedAt: null,
      },
    });
    await this.audit?.log({
      userId,
      action: AuditAction.CREATE,
      resourceType: 'ScribeVoiceProfile',
      resourceId: profile.id,
    });
    return { id: profile.id, status: profile.status, sampleCount: profile.sampleCount };
  }

  async revokeVoiceProfile(userId: string) {
    await this.assertEnabled(userId);
    const existing = await this.prisma.scribeVoiceProfile.findUnique({ where: { doctorId: userId } });
    if (!existing) throw new NotFoundException('등록된 음성 프로파일이 없습니다');
    await this.prisma.scribeVoiceProfile.update({
      where: { doctorId: userId },
      data: { status: ScribeVoiceProfileStatus.REVOKED, embedding: Prisma.DbNull, revokedAt: new Date() },
    });
    // 생체정보 파기 — log()(throw)
    await this.audit?.log({
      userId,
      action: AuditAction.DELETE,
      resourceType: 'ScribeVoiceProfile',
      resourceId: existing.id,
    });
    return { status: 'REVOKED' as const };
  }
}
