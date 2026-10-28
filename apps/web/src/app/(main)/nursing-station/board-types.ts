/** 간호 스테이션 보드 응답(`GET /api/v1/nursing/station-board`) — 서버 `getStationBoard` 와 같은 모양 */
import type { NursingShift } from '@hospital-run/shared';

export type Ews = { score: number; risk: string; escalation: boolean; at: string } | null;
export type Fall = { risk: string; score: number; at?: string } | null;

export type BoardUser = { id: string; familyName?: string | null; givenName?: string | null } | null;

/** 입원별 마지막 인계(창 밖이어도) — 경과와 함께 그린다 */
export type RowHandoff = {
  id: string; at: string; acknowledgedAt: string | null; illness: string | null;
  memo: string | null; openActions: number | null; inWindow: boolean;
} | null;

export type Row = {
  admissionId: string; patientId: string; name: string; koreanName?: string | null; mrn: string;
  ward: string; wardId: string | null; room: string; bed: string; losDays: number;
  ews: Ews; fall: Fall; meds: { due: number; overdue: number };
  lastNoteAt: string | null; unsignedNotes: number; highRisk: boolean; isolation?: string[];
  handoff?: RowHandoff;
  /** 지금 담당 간호사(해제 안 된 배정) — 없으면 null · 구버전 응답엔 키 없음 */
  nurse?: { id: string; name: string; shiftType: string; assignedAt: string; isPrimary: boolean } | null;
  /** 이번 근무조 기록 유무(수) — 충분성 판정 아님 · 투약은 근무조 시작~지금 예정분 */
  shiftRecord?: { notes: number; vitals: number; io: number; medsDue: number; medsPending: number; handoffs: number };
  /** 마지막 활력(활력 정본) — 측정 없으면 null */
  lastVitalsAt?: string | null;
  /** 미확인 위급값(정본 열린 상태) */
  criticalOpen?: { id: string; testName: string; value: string; unit: string; status: string; notifiedAt: string }[];
  /** 오늘~내일 예정·진행 중 가장 이른 수술 */
  surgery?: { id: string; scheduledAt: string; procedureName: string; status: string } | null;
  /** 활성 NPO 식이 오더 */
  npo?: { since: string | null } | null;
  expectedDischargeAt?: string | null;
  transferPending?: { id: string; targetWard: string | null; requestedAt: string } | null;
};

export type RosterNurse = { userId: string; name: string; department: string; handoffsToAck: number };
export type Assignee = { userId: string; name: string; patients: number; handoffsWritten: number; handoffsUnacked: number; handoffsToAck: number };
export type Staffing = {
  current: { shift: NursingShift; date: string; roster: RosterNurse[] };
  next: { shift: NursingShift; date: string; roster: RosterNurse[] };
  rosterLatestDate: string | null;
  /** WARD = 사람이 연결한 근무표 부서로 거름 · HOSPITAL = 병원 전체(병동을 안 골랐거나 연결 안 됨) */
  rosterScope: 'WARD' | 'HOSPITAL';
  wardDepartments?: string[] | null;
  /** 병동을 골랐는데 연결이 없다 */
  wardUnmapped?: boolean;
  /** 연결 편집 선택지 — 근무표에 나온 간호 부서 */
  rosterDepartments?: string[];
  assignees: Assignee[];
};

export type FeedHandoff = {
  id: string; type: string; admissionId: string | null; patientId: string;
  illness: string | null; summary: string; patientSummary: string | null;
  actionList: unknown; situationAwareness: string | null; synthesis: string | null; pendingItems: unknown;
  acknowledgedAt: string | null; createdAt: string;
  fromDoctor: BoardUser; toDoctor: BoardUser;
  shift: NursingShift; room: string | null; bed: string | null; ward: string | null; patientName: string | null; patientKoreanName?: string | null; mrn: string | null;
};

export type BoardShift = { current: NursingShift; start: string; end: string; previous: NursingShift; previousStart: string; now: string };

export type BoardResp = {
  wards: { id: string; name: string }[];
  patients: Row[];
  summary: {
    total: number; highRisk: number; medsOverdue: number; unsignedNotes: number; isolated?: number; handoffPending?: number;
    handoffsInWindow?: number; handoffsInWindowPending?: number;
    shiftWithoutNote?: number; shiftWithoutVitals?: number; shiftWithoutHandoff?: number; shiftMedsPending?: number;
    vitalsStaleHours?: number | null; vitalsStale?: number | null; vitalsNever?: number;
    criticalOpenPatients?: number; surgeryUpcoming?: number; npo?: number; dischargeToday?: number; transferPending?: number;
  };
  /** 구버전 서버 응답에는 없다 — 없으면 인계 보드가 "확인 불가"를 말한다 */
  shift?: BoardShift;
  handoffs?: { items: FeedHandoff[]; total: number; truncated: boolean; since: string; limit: number };
  staffing?: Staffing;
};

/** 근무조 이름 — '주간'은 Week 와 겹쳐 문맥 키로 */
export const SHIFT_KEY: Record<NursingShift, string> = { DAY: '주간@근무조', EVENING: '초번', NIGHT: '야간' };

export const who = (u: BoardUser | undefined): string => `${u?.familyName ?? ''}${u?.givenName ?? ''}`.trim();
