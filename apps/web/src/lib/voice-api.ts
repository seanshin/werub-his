import { apiClient } from '@/lib/api-client';
import type { Outcome } from '@/components/voice-emr/types';

/** VoiceEMR API 클라이언트 — /api/v1/voice/* */
export interface VoiceSessionStart { id: string; mode: string; patient: { name: string; mrn: string; sexAge?: string } }
export interface ChunkResult { text?: string; is_final?: boolean; confidence?: number; dropped_s?: number; translation?: string }
export interface CodeHit { code: string; name: string; score: number }
/** 음성 오더 draft — handoff.payload. 코드는 문자열(id 아님)·처방 폼이 코드→ID 해석·확정. */
export interface VoiceOrderDraft {
  type: 'MEDICATION' | 'LAB' | 'IMAGING';
  code?: string;
  dosage?: string;
  doseUnit?: string;
  frequency?: string;
  route?: string;
  labs?: { code: string | null; term: string | null }[];
  modality?: string;
  bodyPart?: string;
}
/** 확정 응답 — 활력은 서버가 정본에 기록(written), 오더는 정본 CPOE EP 로 위임(handoff) */
export interface VoiceConfirmResult {
  ok: boolean;
  written?: { kind: string; ref?: string };
  idempotent?: boolean;
  handoff?: { ep: string; method: 'POST'; payload: VoiceOrderDraft & Record<string, unknown>; note: string };
}
export interface Phrase { id: string; type: string; pattern: string; action: unknown; enabled: boolean; hitCount: number; priority: number }

export const voiceApi = {
  start: (encounterId: string, mode?: string) =>
    apiClient.post<{ data: VoiceSessionStart }>('/api/v1/voice/session', { encounterId, mode }).then((r) => r.data),

  /** 수술 단위 세션(수술방 차트 구술) — 수술팀만 · 구술만(서버가 판정) */
  startSurgery: (surgeryId: string) =>
    apiClient.post<{ data: VoiceSessionStart }>('/api/v1/voice/session', { surgeryId, mode: 'dictate' }).then((r) => r.data),

  chunk: (sid: string, pcmBase64: string, mode: 'partial' | 'final', sampleRate = 16000, targets?: string) =>
    apiClient.post<{ data: ChunkResult }>(`/api/v1/voice/session/${sid}/chunk`, { pcmBase64, mode, sampleRate, targets }).then((r) => r.data),

  parse: (sid: string, transcript: string, confidence?: number) =>
    apiClient.post<{ data: { outcomes: Outcome[] } }>(`/api/v1/voice/session/${sid}/parse`, { transcript, confidence }).then((r) => r.data.outcomes),

  search: (kind: 'drug' | 'lab', q: string) =>
    apiClient.get<{ data: CodeHit[] }>(`/api/v1/voice/search?kind=${kind}&q=${encodeURIComponent(q)}`).then((r) => r.data),

  confirm: (sid: string, body: { intent: string; slots?: object; resultKind?: string; resultRef?: string; phraseId?: string }) =>
    apiClient.post<{ data: VoiceConfirmResult }>(`/api/v1/voice/session/${sid}/confirm`, body).then((r) => r.data),

  close: (sid: string) => apiClient.del(`/api/v1/voice/session/${sid}`),

  // 개인화
  getProfile: () => apiClient.get<{ data: unknown }>('/api/v1/voice/profile').then((r) => r.data),
  updateProfile: (body: object) => apiClient.patch('/api/v1/voice/profile', body),
  listPhrases: (type?: string) => apiClient.get<{ data: Phrase[] }>(`/api/v1/voice/phrases${type ? `?type=${type}` : ''}`).then((r) => r.data),
  addPhrase: (body: { type: string; pattern: string; action?: object; priority?: number }) => apiClient.post('/api/v1/voice/phrases', body),
  togglePhrase: (id: string, enabled: boolean) => apiClient.patch(`/api/v1/voice/phrases/${id}`, { enabled }),
  deletePhrase: (id: string) => apiClient.del(`/api/v1/voice/phrases/${id}`),

  // 화자 음성 등록(생체인식·성문)
  enrollStatus: () => apiClient.get<{ data: EnrollStatus }>('/api/v1/voice/enroll').then((r) => r.data),
  enrollConsent: (agreed: boolean, version?: string) =>
    apiClient.post<{ data: EnrollStatus }>('/api/v1/voice/enroll/consent', { agreed, version }).then((r) => r.data),
  enrollSample: (pcmBase64: string, sampleRate = 16000, promptId?: string) =>
    apiClient.post<{ data: EnrollSampleResult }>('/api/v1/voice/enroll/sample', { pcmBase64, sampleRate, promptId }).then((r) => r.data),
  enrollComplete: () => apiClient.post<{ data: EnrollStatus }>('/api/v1/voice/enroll/complete', {}).then((r) => r.data),
  enrollRevoke: () => apiClient.del<{ data: EnrollStatus }>('/api/v1/voice/enroll').then((r) => r.data),

  // 다자간 화자분리 테스트
  diarizeSubmit: (audioBase64: string, mime?: string) =>
    apiClient.post<{ data: { jobId: string } }>('/api/v1/voice/diarize-test', { audioBase64, mime }).then((r) => r.data),
  diarizePoll: (jobId: string) =>
    apiClient.get<{ data: DiarizeResult }>(`/api/v1/voice/diarize-test/${encodeURIComponent(jobId)}`).then((r) => r.data),
};

export interface DiarizeSegment { speaker: string; speakerLabel: string; start: number; end: number; text: string }
export interface DiarizeResult {
  jobId: string; status: string; done: boolean; failed?: boolean; error?: string;
  diarized?: boolean; speakerCount?: number; fullText?: string; segments?: DiarizeSegment[];
}

export interface EnrollStatus {
  /** 표시용 상태 — 성문(voiceprintRef)이 없으면 서버가 'enrolled' 를 내려주지 않는다. */
  status: 'none' | 'pending' | 'enrolled' | 'revoked';
  /** DB 에 저장된 원래 상태(정정 전) — 표시는 status 를 쓰고, 불일치 설명에만 쓴다. */
  storedStatus?: string;
  /** AI 서버에 성문이 실제로 있는지. false 면 화자 인식은 동작할 수 없다. */
  voiceprintPresent?: boolean;
  /** 저장 상태는 enrolled 인데 성문이 없는 불일치(과거 fail-open 흔적). */
  voiceprintMissing?: boolean;
  /**
   * 동의는 철회됐는데 AI 서버 성문 파기가 확인되지 않은 상태(저장 상태에서 파생 — 새로고침해도 유지된다).
   * 🔴 철회 ≠ 파기. true 면 "철회·삭제 완료"라고 말하지 않고 재시도를 띄운다.
   */
  remotePurgePending?: boolean;
  /** 철회 호출의 원격 파기 결과(그 호출에만 실림) — 어휘 정본 `VOICEPRINT_PURGE_OUTCOMES` */
  remoteVoiceprintPurge?: 'PURGED' | 'NOT_PRESENT' | 'REMOTE_UNAVAILABLE' | 'REMOTE_FAILED';
  sampleCount: number; minSamples: number; maxSamples: number;
  enrolledAt: string | null;
  consented: boolean; consentAt: string | null; consentVersion: string | null; requiredConsentVersion: string;
  speakerGateEnabled: boolean;
}
export interface EnrollSampleResult {
  accepted: boolean; sampleCount: number; minSamples: number; maxSamples: number;
  serverEnrolled: boolean; serverUnavailable: boolean; quality?: number;
  /** accepted=false 일 때의 사유(성문 서버 미가용/거절) — 표본은 저장되지 않았다. */
  reason?: string; message?: string;
}

// ── 앰비언트 대화 스트림 (P0 — 기획: voice-emr-ambient-conversation.plan.md) ──

export interface AmbientEntities {
  vitals: { type: string; value: number[]; unit: string; raw: string }[];
  medications: { name: string; raw: string }[];
  symptoms: { term: string; negated: boolean }[];
  plan: { kind: string; text: string }[];
}
export interface AmbientUtteranceRow {
  seq: number; startedAt?: string; text: string; editedText?: string | null;
  speaker: 'DOCTOR' | 'PATIENT' | 'UNKNOWN'; speakerSource: string;
  confidence?: number | null; droppedSec?: number | null;
}
export interface AmbientSession { id: string; encounterId?: string; status: string; patient?: { name: string; mrn: string } | null }

export const ambientApi = {
  start: (encounterId: string) =>
    apiClient.post<{ data: AmbientSession }>('/api/v1/scribe/ambient/session', { encounterId }).then((r) => r.data),
  get: (sid: string) =>
    apiClient.get<{ data: AmbientSession & { utterances: AmbientUtteranceRow[] } }>(`/api/v1/scribe/ambient/session/${sid}`).then((r) => r.data),
  addUtterance: (sid: string, body: { seq: number; text: string; speaker?: string; confidence?: number; droppedSec?: number }) =>
    apiClient.post<{ data: { seq: number; entities: AmbientEntities } }>(`/api/v1/scribe/ambient/session/${sid}/utterances`, body).then((r) => r.data),
  patchUtterance: (sid: string, seq: number, body: { text?: string; speaker?: string; deleted?: boolean }) =>
    apiClient.patch<{ data: AmbientUtteranceRow & { entities: AmbientEntities | null } }>(`/api/v1/scribe/ambient/session/${sid}/utterances/${seq}`, body).then((r) => r.data),
  close: (sid: string) =>
    apiClient.post<{ data: { id: string; status: string; utteranceCount: number; droppedTotal: number } }>(`/api/v1/scribe/ambient/session/${sid}/close`, {}).then((r) => r.data),
  analyze: (sid: string) =>
    apiClient.post<{ data: AmbientAnalysis }>(`/api/v1/scribe/ambient/session/${sid}/analyze`, {}).then((r) => r.data),
  apply: (sid: string, body: { field: SoapField; text: string; sourceSeqs?: number[]; engine?: 'RULE' | 'AI' }) =>
    apiClient.post<{ data: { ok: boolean } }>(`/api/v1/scribe/ambient/session/${sid}/apply`, body).then((r) => r.data),
};

export type SoapField = 'subjective' | 'objective' | 'assessment' | 'plan';
export interface SoapSuggestion { field: SoapField; text: string; sourceSeqs: number[]; engine: 'RULE' | 'AI'; note?: string }
/**
 * 분모(D2) — 전부 발화 수. `withEntities+noEntities+lowConfidence+skipped === utterances`.
 * `utterances` 가 0 이면 화면은 "산출 불가"로 말한다(0 은 다른 사실 — CLAUDE.md §1).
 */
export interface AmbientAnalysisCoverage {
  utterances: number;
  withEntities: number;
  noEntities: number;
  lowConfidence: number;
  skipped: number;
}
export interface AmbientAnalysis {
  engine: 'RULE' | 'RULE+AI';
  suggestions: SoapSuggestion[];
  skipped: { seq: number; field: SoapField; detail: string; reason: string }[];
  /** 종전 `utteranceCount`·`lowConfidence` 최상위 필드는 여기로 옮겨졌다(같은 사실에 자리 둘을 두지 않는다) */
  coverage: AmbientAnalysisCoverage;
  droppedTotal: number;
  /** AI 로 보낸 텍스트에서 지운 건수 — `null`=AI 경로로 아무것도 보내지 않았다(0 과 다른 사실) */
  redacted: { names: number; ids: number } | null;
  /** AI 경로가 빠진 이유(빠졌으면) — NAMES_UNAVAILABLE=비식별용 이름을 못 읽어 보내지 않음 · AI_ERROR=호출 실패 */
  aiSkipped: 'NAMES_UNAVAILABLE' | 'AI_ERROR' | null;
}
