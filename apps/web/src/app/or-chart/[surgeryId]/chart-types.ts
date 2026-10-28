/** 수술방 차트 응답(`GET /api/v1/surgery/:id/intraop`) — 서버 OrChartService.getChart 와 같은 모양 */
import type { IntraopEventKind, IntraopVitalPoint, IntraopSummary, OrLayout, OrRole, OrDeviceProfile, SurgeryFlow } from '@hospital-run/shared';

export type ChartEvent = {
  id: string; kind: IntraopEventKind; occurredAt: string; occurredAtSource: 'RECORDED' | 'USER_CLAIMED';
  payload: Record<string, unknown>; recordedAt: string; recordedBy: { id: string; name: string | null };
  voidedAt: string | null; voidedBy: { id: string; name: string | null } | null; voidReason: string | null; lateEntry: boolean;
};

export type OrChart = {
  surgery: {
    id: string; status: string; procedureName: string; bodySite: string | null; laterality: string | null;
    scheduledAt: string; startedAt: string | null; endedAt: string | null;
    anesthesiaType: string | null; asaClass: string | null; airwayType: string | null;
    patient: { id: string; name: string; koreanName?: string | null; mrn: string; dateOfBirth: string | null; gender: string | null } | null;
    surgeon: string | null;
    scrubNurse: { id: string; name: string | null } | null;
    circulatingNurse: { id: string; name: string | null } | null;
  };
  phases: Record<'INDUCTION' | 'INTUBATION' | 'INCISION' | 'CLOSURE' | 'EXTUBATION' | 'START' | 'END', string | null>;
  /** 10단계 흐름(shared surgeryFlowOf — 실시간 모니터와 같은 규칙) */
  flow: SurgeryFlow;
  /** 수술 중 기록 요약(셈만 · AI 아님) */
  summary: IntraopSummary;
  anesthesiaRecordPresent: boolean;
  legacyVitals: IntraopVitalPoint[] | null;
  checklist: { signIn: boolean; timeOut: boolean; signOut: boolean; countStatus: string | null } | null;
  events: ChartEvent[];
  suggestedRole: OrRole | null;
  /** 작성 권한 — 리얼이면 수술팀만(teamOnly) · 리허설·개발은 누구나 · 서버가 같은 판정으로 쓰기를 막는다 */
  writePolicy: { mode: 'DEV' | 'REHEARSAL' | 'REAL'; teamOnly: boolean; onTeam: boolean; canWrite: boolean };
};

export type LayoutResp = { profile: OrDeviceProfile; role: OrRole; layout: OrLayout; source: 'SAVED' | 'DEFAULT' | 'INVALID_SAVED'; updatedAt: string | null };

/** 수술 경과 요약 AI 초안(`POST …/intraop/ai-narrative`) — 저장되지 않는다 */
export type AiNarrative = {
  source: 'AI' | 'UNAVAILABLE'; reason: string | null; text: string | null; facts: string[];
  unverifiedNumbers: string[]; languageMixed: boolean; generatedAt?: string;
};
