/**
 * 오더 실시간 추적 정본(2026-10-06 · `/orders` 실시간 추적·환자별 매트릭스).
 *
 * 🔴 단계 자체는 서버 `journey/clinical-lens.ts` `orderStages`(도메인 원장의 단계 시각)가 정본이다 — 여기는 그 **어휘·라벨**과
 *    단계 → 추적 국면(대기·진행·결과 미확인·완료·취소) 판정만 갖는다. 화면 두 곳(여정 의료진 관점·오더 추적)이 같은 표를 쓴다.
 * 🔴 "지연"은 원내 정책이다 — 기준(`orders.tracking.attentionMin`)이 없으면 경과만 말하고 판정하지 않는다.
 */

export const ORDER_STAGE_KEYS = [
  'ORDERED', 'RECEIVED', 'COLLECTED', 'STARTED', 'ACQUIRED', 'RESULTED', 'REPORTED', 'VERIFIED',
  'DISPENSED', 'ISSUED', 'COMPLETED', 'ACKNOWLEDGED', 'CANCELLED',
] as const;
export type OrderStageKey = (typeof ORDER_STAGE_KEYS)[number];

export const ORDER_STAGE_LABEL: Record<OrderStageKey, string> = {
  ORDERED: '발행', RECEIVED: '접수', COLLECTED: '채취', STARTED: '시행', ACQUIRED: '촬영', RESULTED: '결과', REPORTED: '판독',
  VERIFIED: '검증', DISPENSED: '조제', ISSUED: '불출', COMPLETED: '완료', ACKNOWLEDGED: '의사 확인', CANCELLED: '취소',
};

/** 오더 부서(OrderDepartment) — 업무 순서 */
export const ORDER_DEPTS = ['LAB', 'IMAGING', 'PHARMACY', 'THERAPY'] as const;
export type OrderDept = (typeof ORDER_DEPTS)[number];
export const ORDER_DEPT_LABEL: Record<OrderDept, string> = { LAB: '검사', IMAGING: '영상', PHARMACY: '약제', THERAPY: '치료' };

/** 추적 국면 — 보드의 열 */
export const ORDER_TRACK_PHASES = ['WAITING', 'IN_PROCESS', 'RESULT_UNACK', 'DONE', 'CANCELLED'] as const;
export type OrderTrackPhase = (typeof ORDER_TRACK_PHASES)[number];
export const ORDER_TRACK_PHASE_LABEL: Record<OrderTrackPhase, string> = {
  WAITING: '접수 대기', IN_PROCESS: '진행 중', RESULT_UNACK: '결과 미확인', DONE: '완료', CANCELLED: '취소',
};
/** 활성 국면 — 아직 누군가 처리해야 하는 것(결과 미확인은 의사 몫) */
export const ACTIVE_TRACK_PHASES: readonly OrderTrackPhase[] = ['WAITING', 'IN_PROCESS', 'RESULT_UNACK'];

/** 결과를 의사가 확인하는 부서 — 검사·영상(결과 확인함과 같은 조건) */
const RESULT_ACK_DEPTS = new Set(['LAB', 'IMAGING']);

export interface TrackStage { key: OrderStageKey; at: string | null }

/**
 * 국면 판정 — 상태 원장(Order.status)과 확인 시각(acknowledgedAt)에서만.
 * 결과 미확인 = 검사·영상이 완료(결과 도착)됐는데 의사 확인 시각이 없음(결과 확인함과 같은 조건).
 */
export function orderTrackPhaseOf(o: { department: string; status: string; stages: TrackStage[] }): OrderTrackPhase {
  if (o.status === 'CANCELLED') return 'CANCELLED';
  if (o.status === 'ORDERED') return 'WAITING';
  if (o.status === 'RECEIVED' || o.status === 'IN_PROGRESS') return 'IN_PROCESS';
  if (RESULT_ACK_DEPTS.has(o.department) && !o.stages.find((s) => s.key === 'ACKNOWLEDGED')?.at) return 'RESULT_UNACK';
  return 'DONE';
}

/** 지금 단계 = 시각이 있는 마지막 단계(취소 제외 · 단계 순서 기준) · 다음 단계 = 그 뒤 첫 빈 단계 */
export function currentAndNextStage(stages: TrackStage[]): { current: TrackStage | null; next: OrderStageKey | null } {
  const flow = stages.filter((s) => s.key !== 'CANCELLED');
  let idx = -1;
  flow.forEach((s, i) => { if (s.at) idx = i; });
  const current = idx >= 0 ? flow[idx] : null;
  const next = flow.slice(idx + 1).find((s) => !s.at)?.key ?? null;
  return { current, next };
}

/**
 * 주의 기준(원내 정책) — 긴급도별 분(발행 이후 경과). 미설정이면 null(판정하지 않는다).
 * config `orders.tracking.attentionMin` 예 `{"STAT":30,"URGENT":60,"ROUTINE":240}` — 모르는 키·숫자 아닌 값은 버린다.
 */
export function attentionThresholdsOf(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (['STAT', 'URGENT', 'ROUTINE', 'PRN', 'STANDING'].includes(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

// ─────────────────────────── 위원회 기준(오더) ───────────────────────────

/** 점검 종류 — 이 화면의 기록으로 셀 수 있는 것만. 없으면 null(기준 표시만) */
export type OrderStandardCheck = 'ATTENTION' | 'DUR_OVERRIDE' | 'CRITICAL_UNACK';

/**
 * 오더에 걸리는 위원회 기준 표면 — 담당 위원회·결정은 **거버넌스 정본**(committee_surface_maps · decision_actions)에서 읽는다.
 * 🔴 여기는 "어떤 표면이 오더에 걸리는가"와 "무엇으로 점검하는가"만 — 권고 값·담당을 지어 적지 않는다.
 */
export const ORDER_GOVERNANCE_STANDARDS: { surfaceKey: string; label: string; depts: OrderDept[]; check: OrderStandardCheck | null }[] = [
  { surfaceKey: 'config:orders.tracking.attentionMin', label: '오더 처리 주의 기준(긴급도별 분)', depts: ['LAB', 'IMAGING', 'PHARMACY', 'THERAPY'], check: 'ATTENTION' },
  { surfaceKey: 'config:dur.enforce', label: 'DUR 게이트(병용·임부 금기 등)', depts: ['PHARMACY'], check: 'DUR_OVERRIDE' },
  { surfaceKey: 'master:reference-range', label: '검사 참고치·위급값 범위', depts: ['LAB'], check: 'CRITICAL_UNACK' },
  { surfaceKey: 'config:formulary.enforce', label: '원내 처방집 시행', depts: ['LAB', 'IMAGING', 'PHARMACY', 'THERAPY'], check: null },
  { surfaceKey: 'config:cdss.enforce', label: 'CDSS 게이트(알레르기·신기능·연령)', depts: ['PHARMACY'], check: null },
  { surfaceKey: 'config:nursing.bcma.enforce', label: '투약 바코드 확인(BCMA)', depts: ['PHARMACY'], check: null },
  { surfaceKey: 'config:imaging.contrastEnforce', label: '영상 조영제 안전', depts: ['IMAGING'], check: null },
  { surfaceKey: 'config:imaging.pregnancyEnforce', label: '영상 임신 확인', depts: ['IMAGING'], check: null },
];

export const ORDER_STANDARD_CHECK_LABEL: Record<OrderStandardCheck, string> = {
  ATTENTION: '주의 기준을 넘긴 처리 중 오더',
  DUR_OVERRIDE: 'DUR 경고 후 무시(사유 기록)',
  CRITICAL_UNACK: '위급 결과 의사 미확인',
};

// ─────────────────────────── 환자별 확인 사항(기록에서 규칙으로) ───────────────────────────

export type OrderNoteLevel = 'URGENT' | 'ATTENTION' | 'INFO';
export type OrderNoteCode = 'STAT_ACTIVE' | 'CRITICAL_UNACK' | 'ATTENTION_OVER' | 'RESULT_UNACK' | 'DUR_OVERRIDDEN' | 'CARRIED_OVER' | 'WAITING';
export interface OrderNote { code: OrderNoteCode; level: OrderNoteLevel; count: number; minutes: number | null }

/** 문구 — {수}·{분}(분은 화면이 경과 표기로 바꾼다) */
export const ORDER_NOTE_LABEL: Record<OrderNoteCode, string> = {
  STAT_ACTIVE: 'STAT {수}건 처리 중',
  CRITICAL_UNACK: '위급 결과 {수}건 — 의사 확인 전',
  ATTENTION_OVER: '원내 주의 기준을 넘긴 오더 {수}건',
  RESULT_UNACK: '결과 {수}건 — 의사 확인 전',
  DUR_OVERRIDDEN: 'DUR 경고를 무시하고 낸 처방 {수}건(사유 기록) — 약사 검토 확인',
  CARRIED_OVER: '이전 날 발행·미완료 {수}건',
  WAITING: '접수 대기 {수}건',
};

export interface NoteInputOrder {
  department: string; priority: string; phase: OrderTrackPhase; critical: boolean; attention: boolean | null;
  sinceOrderedMin: number | null; carriedOver: boolean; dur?: { warned: boolean; overridden: boolean } | null;
}

/**
 * 환자 한 명의 확인 사항 — **기록에서 규칙으로 센 사실**만(임상 판단·처방 권고가 아니다).
 * 🔴 "지연"은 원내 주의 기준이 있을 때만(ATTENTION_OVER) — 기준이 없으면 경과(분)만 사실로 싣는다.
 * 순서: 긴급(STAT·위급) → 주의 → 참고. 해당 없는 항목은 싣지 않는다(0건을 나열하지 않는다).
 */
export function patientOrderNotes(orders: NoteInputOrder[]): OrderNote[] {
  const active = orders.filter((o) => (ACTIVE_TRACK_PHASES as readonly string[]).includes(o.phase));
  const maxMin = (xs: NoteInputOrder[]) => (xs.some((o) => o.sinceOrderedMin != null) ? Math.max(...xs.map((o) => o.sinceOrderedMin ?? 0)) : null);
  const out: OrderNote[] = [];
  const push = (code: OrderNoteCode, level: OrderNoteLevel, xs: NoteInputOrder[], withMin = false) => {
    if (xs.length) out.push({ code, level, count: xs.length, minutes: withMin ? maxMin(xs) : null });
  };
  push('STAT_ACTIVE', 'URGENT', active.filter((o) => o.priority === 'STAT'), true);
  push('CRITICAL_UNACK', 'URGENT', orders.filter((o) => o.critical && o.phase === 'RESULT_UNACK'));
  push('ATTENTION_OVER', 'ATTENTION', active.filter((o) => o.attention === true), true);
  push('RESULT_UNACK', 'ATTENTION', orders.filter((o) => !o.critical && o.phase === 'RESULT_UNACK'));
  push('DUR_OVERRIDDEN', 'ATTENTION', orders.filter((o) => o.dur?.overridden === true));
  push('CARRIED_OVER', 'INFO', active.filter((o) => o.carriedOver), true);
  push('WAITING', 'INFO', orders.filter((o) => o.phase === 'WAITING'), true);
  return out;
}
