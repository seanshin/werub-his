import { apiClient } from '@/lib/api-client';

/** 앰비언트 스크라이브 세션(백엔드 ScribeSession 반영·부분) */
export interface ScribeSession {
  id: string;
  encounterId: string;
  status: string; // RECORDING|UPLOADED|TRANSCRIBING|TRANSCRIBED|DRAFTED|APPLIED|FAILED|DELETED
  audioPath?: string | null;
  transcript?: unknown;
  sttTier?: string | null;
  createdAt?: string;
}

export interface UploadAudioResult {
  session: ScribeSession;
  audioUrl: string;
  bytes: number;
}

export interface VoiceProfileStatus {
  id?: string;
  status: 'ACTIVE' | 'REVOKED' | 'NONE';
  sampleCount?: number;
  consentAt?: string;
}

export type ScribeRole = 'DOCTOR' | 'PATIENT' | 'GUARDIAN' | 'OTHER' | 'UNKNOWN';
export interface LabeledSegment {
  speaker: string;
  role: ScribeRole;
  start: number;
  end: number;
  text: string;
  confident?: boolean;
}

/** autoRecord(NER+SOAP) 응답 — 실측 shape(방어적) */
export interface ScribeDraft {
  chief_complaint?: string;
  soap?: { subjective?: string; objective?: string; assessment?: string; plan?: string } | Record<string, unknown>;
  icd_codes?: string[];
  entities?: Record<string, unknown>;
  orders?: unknown;
  prescriptions?: unknown;
  disclaimer?: string;
  [k: string]: unknown;
}

const base = (encounterId: string) => `/api/v1/encounters/${encounterId}/scribe`;

export const scribeApi = {
  /** 세션 시작(RECORDING 동의 검증 선행 — 미동의 시 400 RECORDING_CONSENT_REQUIRED) */
  startSession: (encounterId: string) =>
    apiClient.post<{ data: ScribeSession }>(`${base(encounterId)}/session`, {}),

  getSession: (encounterId: string, sid: string) =>
    apiClient.get<{ data: ScribeSession }>(`${base(encounterId)}/${sid}`),

  /** 오디오 업로드(P0 base64 · P1 청크로 대체) */
  uploadAudio: (encounterId: string, sid: string, audioBase64: string, mime: string) =>
    apiClient.post<{ data: UploadAudioResult }>(`${base(encounterId)}/${sid}/audio`, { audioBase64, mime }),

  /** 전사 요청(비동기·완료는 getSession 폴링) — 미활성 시 501 TRANSCRIPTION_DISABLED */
  transcribe: (encounterId: string, sid: string, diarize = true) =>
    apiClient.post<{ data: { sessionId: string; jobId: string; status: string } }>(`${base(encounterId)}/${sid}/transcribe`, { diarize }),

  /** 전사→SOAP 초안(NER+SOAP·의사 검토·서명 필수) */
  draft: (encounterId: string, sid: string) =>
    apiClient.post<{ data: ScribeDraft }>(`${base(encounterId)}/${sid}/draft`, {}),

  /**
   * 화자분리 세그먼트 재라벨(D8) — 화자만 서버에 영속(원문 불변). 이게 없으면 `TranscriptViewer` 의
   * 재라벨은 로컬 상태로만 남고 `draft()` 가 읽는 DB `transcript` 는 자동 라벨 그대로 남는다.
   */
  relabelSegment: (encounterId: string, sid: string, index: number, role: ScribeRole) =>
    apiClient.patch<{ data: LabeledSegment }>(`${base(encounterId)}/${sid}/segment/${index}`, { role }),

  voiceProfile: {
    get: () => apiClient.get<{ data: VoiceProfileStatus }>(`/api/v1/scribe/voice-profile`),
    enroll: (consent: boolean, sampleCount = 1) =>
      apiClient.post<{ data: VoiceProfileStatus }>(`/api/v1/scribe/voice-profile`, { consent, sampleCount }),
  },
};
