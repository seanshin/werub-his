/**
 * 결정 이력 원장 어휘 — 2026-10-11 사용자 "엔진 형태로 세팅 후에 변경되고, 전후 관계에도 영향을 주고,
 * 보호하거나 설정에 영향을 줄 수 있어야 함 · 이미 의사결정된 과정도 로그 형태로 · 문서 형태로 정리".
 *
 * 🔴 원장은 **일어난 사건**만 쌓는다 — 판정(재검토 필요·설정이 결정과 다름)은 원장과 현재 값에서 **파생**한다
 *    (판정을 원장에 박으면 판정 규칙이 바뀌어도 과거 행이 옛 판정을 계속 말한다).
 */

export const DECISION_LOG_KINDS = [
  'BACKFILL',            // 원장 시작 전 기록을 옮김(그 이전 이력은 없다)
  'SEED_RECORDED',       // 개발 시드가 기록(실결정 아님)
  'RECORDED',            // 결정 화면에서 권한자가 기록
  'COMMITTEE_RESOLVED',  // 위원회 의결이 등록부 기록이 됨
  'UPSTREAM_CHANGED',    // 선행 결정이 바뀜 — 이 결정은 재검토 대상(시스템이 남김)
  'REVIEW_CONFIRMED',    // 선행 변경 뒤 사람이 "이 결정은 그대로 유효" 확인
  'CONFIG_OVERRIDE',     // 결정에 묶인 설정을 결정 경로 밖에서 바꿈(허용·기록)
  'CONFIG_OVERRIDE_BLOCKED', // 결정에 묶인 설정을 바꾸려다 보호 게이트에 막힘
  // ── 개발 반영 추적(2026-10-12 기획 decision-print-remaining P2) — 결정 방식 "개발 반영"(DEV_APPLY)에만
  'DEV_ENACTED',         // 개발이 실결정 선택대로 반영했다(릴리즈 버전·근거 필수 · 사람이 남김)
  'DEV_NOT_REQUIRED',    // 실결정 = 현행이라 개발할 것이 없다(근거 필수 · 사람이 남김)
  'DEV_REVERT_NEEDED',   // 🔴 실결정 ≠ 이미 구현된 시드 동작 — 되돌려야 한다(실결정 기록 순간 시스템이 남김)
] as const;
export type DecisionLogKind = (typeof DECISION_LOG_KINDS)[number];

export const DECISION_LOG_KIND_LABEL: Record<DecisionLogKind, string> = {
  BACKFILL: '원장 시작 전 기록',
  SEED_RECORDED: '개발 시드(실결정 아님)',
  RECORDED: '의사결정',
  COMMITTEE_RESOLVED: '위원회 의결',
  UPSTREAM_CHANGED: '선행 결정 변경',
  REVIEW_CONFIRMED: '재검토 확인',
  CONFIG_OVERRIDE: '설정 직접 변경',
  CONFIG_OVERRIDE_BLOCKED: '설정 변경 차단',
  DEV_ENACTED: '개발 반영 확인',
  DEV_NOT_REQUIRED: '개발 불필요(현행)',
  DEV_REVERT_NEEDED: '되돌림 필요',
};

/** 결정의 선택을 바꾼 사건(현재 효력을 만든 것) — 문서의 "결정 경과" 줄 */
export const DECISION_CHOICE_KINDS: readonly DecisionLogKind[] = ['BACKFILL', 'SEED_RECORDED', 'RECORDED', 'COMMITTEE_RESOLVED'];

/**
 * 결정에 묶인 설정 보호 게이트 — 3상(OFF/WARN/BLOCK) · 기본 WARN.
 *  · OFF   = 기록도 하지 않는다
 *  · WARN  = 바꾸게 두되 결정 이력에 "설정 직접 변경"으로 남기고 화면이 "결정과 다름"을 말한다
 *  · BLOCK = **실결정**(시드 아님)에 묶인 설정은 결정 경로(결정 기록·위원회 의결)로만 바뀐다
 * 🔴 기본을 BLOCK 으로 두지 않는다 — 막으면 사람은 시스템 밖에서 일한다(먼저 기록을 모아 승격한다).
 */
export const DECISION_CONFIG_GUARD_KEY = 'governance.decisionConfigGuard';
export const DECISION_CONFIG_GUARD_DEFAULT = 'WARN' as const;

/**
 * 재검토 필요 판정 — 내 실결정보다 **나중에** 선행(dependsOn) 실결정이 기록됐고, 그 뒤 재검토 확인이 없으면.
 *  · 시각은 ISO 문자열 · 없는 값은 판정에 넣지 않는다(지어내지 않는다)
 */
export function upstreamChangedAfter(input: {
  myDecidedAt: string | null | undefined;
  lastReviewConfirmedAt: string | null | undefined;
  upstream: Array<{ key: string; decidedAt: string | null | undefined }>;
}): string[] {
  if (!input.myDecidedAt) return [];
  const since = Math.max(Date.parse(input.myDecidedAt), input.lastReviewConfirmedAt ? Date.parse(input.lastReviewConfirmedAt) : -Infinity);
  if (!Number.isFinite(since)) return [];
  return input.upstream
    .filter((u) => !!u.decidedAt && Number.isFinite(Date.parse(u.decidedAt)) && Date.parse(u.decidedAt!) > since)
    .map((u) => u.key);
}

/**
 * 개발 반영 결정의 이행 상태 — 2026-10-12 기획 P2-2. 🔴 원장 사건에서 **파생**한다(상태를 저장하지 않는다).
 *  · UNDECIDED      실결정 없음(🔴 시드는 이행 상태를 만들지 않는다 — 시드는 결정이 아니다)
 *  · PENDING_DEV    실결정 있음 · 그 선택에 대한 반영 확인/불필요 기록 없음
 *  · REVERT_NEEDED  실결정이 이미 구현된 시드 동작과 다르다 — 그 뒤 반영 확인 없음
 *  · ENACTED        그 선택대로 개발 반영 확인(릴리즈 버전)
 *  · NOT_REQUIRED   그 선택 = 현행이라 할 일 없음
 * 🔴 "반영 대기"를 "반영됨"과 같은 색으로 그리지 않는다 · 체류일은 사실로만(지연 판정은 하지 않는다)
 */
export const DEV_APPLY_STATUSES = ['UNDECIDED', 'PENDING_DEV', 'REVERT_NEEDED', 'ENACTED', 'NOT_REQUIRED'] as const;
export type DevApplyStatus = (typeof DEV_APPLY_STATUSES)[number];
export const DEV_APPLY_STATUS_LABEL: Record<DevApplyStatus, string> = {
  UNDECIDED: '미결(이행 없음)',
  PENDING_DEV: '반영 대기(개발)',
  REVERT_NEEDED: '되돌림 필요',
  ENACTED: '반영됨',
  NOT_REQUIRED: '반영 불필요(현행)',
};

export interface DevApplyEvent { kind: string; choice: string | null; occurredAt: string; version?: string | null }

/** 릴리즈 버전 형식 — 반영 확인의 근거(가드가 RELEASE 문서와 대조) */
export const RELEASE_VERSION_RE = /^v\d+\.\d+\.\d+$/;

export function devApplyStatusOf(input: {
  /** 실결정(시드 아님) — 없으면 null */
  decision: { choice: string; decidedAt: string } | null;
  events: readonly DevApplyEvent[];
}): { status: DevApplyStatus; version: string | null; since: string | null } {
  const d = input.decision;
  if (!d) return { status: 'UNDECIDED', version: null, since: null };
  const t0 = Date.parse(d.decidedAt);
  // 지금 선택에 대한, 결정 이후 사건만 — 옛 선택의 반영 확인은 지금 결정의 이행이 아니다
  const ev = input.events
    .filter((e) => e.choice === d.choice && (!Number.isFinite(t0) || Date.parse(e.occurredAt) >= t0))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  let status: DevApplyStatus = 'PENDING_DEV';
  let version: string | null = null;
  for (const e of ev) {
    if (e.kind === 'DEV_REVERT_NEEDED') { status = 'REVERT_NEEDED'; version = null; }
    else if (e.kind === 'DEV_ENACTED') { status = 'ENACTED'; version = e.version ?? null; }
    else if (e.kind === 'DEV_NOT_REQUIRED' && status !== 'REVERT_NEEDED') { status = 'NOT_REQUIRED'; version = null; }
  }
  return { status, version, since: d.decidedAt };
}
