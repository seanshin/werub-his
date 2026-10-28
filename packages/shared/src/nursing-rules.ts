/**
 * 간호 원내 규정 정본(2026-10-26) — 통증 재평가 규정 · 인계 "인수 확인 ↔ 담당 인수" 방식.
 *
 * 🔴 둘 다 원내가 정할 일이다(재평가 기준·기한은 간호부 규정 · 인수 확인과 담당 인수를 묶을지는 병동 운영 방식).
 *    그래서 코드가 정하지 않고 관리 화면(`/admin/nursing-rules`)에서 고른 값을 서버·화면이 같이 읽는다.
 *  · 통증 재평가 — 🔴 기본값 없음. 비어 있으면 **미설정**(재평가 목록을 만들지 않고 그렇다고 말한다 · 기준 점수를 지어내지 않는다).
 *  · 인수 방식 — 비어 있으면 코드 기본값 `OFFER_BOTH`(종전 동작)로 동작하되 화면이 "코드 기본값"이라고 말한다.
 *  · 범용 설정 저장(`PUT /config/:key`)도 같은 값 검사(`nursingRuleSettingInvalidReason`)를 지난다.
 */

import { RESTRAINT_CHECK_INTERVAL_KEY, normalizeRestraintCheckInterval } from './morse';

/**
 * 개발 시드 설정 표식(2026-10-27) — 개발 시드가 넣은 설정 행은 label 이 이 문자열로 시작한다.
 * 그 값으로 데모는 돌지만 원내 규정이 아니다(출처 SEED). 사람이 저장하면 설정 저장이 label 을 등재 설명으로 되돌려 표식이 사라진다.
 */
export const DEV_SEED_CONFIG_LABEL = '개발 시드(DEV-SEED)';
export const isDevSeedConfigLabel = (label: string | null | undefined) => typeof label === 'string' && label.startsWith(DEV_SEED_CONFIG_LABEL);

// ── 통증 재평가 ─────────────────────────────────────────────

export const PAIN_REASSESS_RULE_KEY = 'nursing.pain.reassessRule';
export const PAIN_REASSESS_MINUTES_RANGE = { min: 15, max: 480 } as const;
/** 재평가 목록이 보는 사건 창(시간) — 그보다 오래된 미재평가 사건은 목록에 싣지 않는다(화면이 말한다) */
export const PAIN_REASSESS_WINDOW_HOURS = 24;

export interface PainReassessRule {
  /** NRS 이 점수 이상이면 재평가 대상(1~10) */
  thresholdScore: number;
  /** 기준 이상 통증 기록 뒤 재평가 기한(분) */
  withinMinutes: number;
  /** 진통제 투여 뒤 재평가 기한(분) — null 이면 진통제 투여는 재평가 사건이 아니다 */
  afterAnalgesicMinutes: number | null;
}

const isMinutes = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= PAIN_REASSESS_MINUTES_RANGE.min && v <= PAIN_REASSESS_MINUTES_RANGE.max;

/** 저장값 → 규정. 형식 밖이면 null(규정을 지어내지 않는다 — 미설정과 같다) */
export function normalizePainReassessRule(raw: unknown): PainReassessRule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const t = r.thresholdScore;
  if (typeof t !== 'number' || !Number.isInteger(t) || t < 1 || t > 10) return null;
  if (!isMinutes(r.withinMinutes)) return null;
  const a = r.afterAnalgesicMinutes ?? null;
  if (a !== null && !isMinutes(a)) return null;
  return { thresholdScore: t, withinMinutes: r.withinMinutes, afterAnalgesicMinutes: a };
}

// ── 인계 인수 방식 ──────────────────────────────────────────

export const HANDOFF_ACK_MODE_KEY = 'nursing.handoff.ackTakeOverMode';
export const HANDOFF_ACK_MODES = ['OFFER_BOTH', 'ALWAYS_BUNDLED', 'SEPARATE'] as const;
export type HandoffAckMode = (typeof HANDOFF_ACK_MODES)[number];
/** 비어 있을 때 동작(종전 동작 그대로) — 원내 규정이 아니다 */
export const HANDOFF_ACK_MODE_CODE_DEFAULT: HandoffAckMode = 'OFFER_BOTH';

export const HANDOFF_ACK_MODE_LABEL: Record<HandoffAckMode, string> = {
  OFFER_BOTH: '둘 다 제공(인수자가 고른다)',
  ALWAYS_BUNDLED: '늘 묶음(인수 확인 = 담당 인수)',
  SEPARATE: '묶지 않음(담당은 따로)',
};
export const HANDOFF_ACK_MODE_DESC: Record<HandoffAckMode, string> = {
  OFFER_BOTH: '간호 교대 인계에 "인수 확인 + 담당 인수"와 "인수 확인" 단추를 둘 다 둔다. 담당을 넘겨받을지는 인수 간호사가 그때 고른다.',
  ALWAYS_BUNDLED: '간호 교대 인계는 인수 확인을 누르면 서버가 같은 순간 담당도 넘긴다(이전 담당 간호사 배정 해제). 관리자 대리 확인은 담당을 넘기지 않는다.',
  SEPARATE: '인수 확인은 내용을 읽었다는 기록만 남긴다. 담당은 환자 목록의 "내가 담당"으로 따로 넘겨받는다.',
};

export function normalizeHandoffAckMode(raw: unknown): HandoffAckMode | null {
  return typeof raw === 'string' && (HANDOFF_ACK_MODES as readonly string[]).includes(raw) ? (raw as HandoffAckMode) : null;
}

/**
 * 규정 출처 — 원내 설정 · 개발 시드(원내 규정 아님 · 그 값으로 동작) · 코드 기본값(원내 규정 미설정) · 미설정(기본값 없음) · 설정 조회 실패.
 * 🔴 SEED 는 원내 결정이 아니다 — 데모가 결정된 모양으로 돌게 할 뿐(사람 몫 H11·H12 미충족 · 관리자가 저장하면 원내 설정이 된다).
 */
export type NursingRuleSource = 'CONFIGURED' | 'SEED' | 'CODE_DEFAULT' | 'UNSET' | 'UNKNOWN';
export const NURSING_RULE_SOURCE_LABEL: Record<NursingRuleSource, string> = {
  CONFIGURED: '원내 설정',
  SEED: '개발 시드 — 원내 규정 아님',
  CODE_DEFAULT: '코드 기본값 — 원내 규정 미설정',
  UNSET: '미설정',
  UNKNOWN: '설정 조회 실패 — 확인 불가',
};

/** 범용 설정 저장 값 검사 — 이 파일의 키가 아니면 undefined(판정하지 않음) · null 은 늘 허용(미설정으로 되돌림) */
export function nursingRuleSettingInvalidReason(key: string, value: unknown): string | null | undefined {
  if (key === PAIN_REASSESS_RULE_KEY) {
    if (value === null) return null;
    return normalizePainReassessRule(value)
      ? null
      : `{ thresholdScore: 1~10 정수, withinMinutes: ${PAIN_REASSESS_MINUTES_RANGE.min}~${PAIN_REASSESS_MINUTES_RANGE.max} 정수, afterAnalgesicMinutes: 같은 범위 정수 또는 null }`;
  }
  if (key === RESTRAINT_CHECK_INTERVAL_KEY) {
    if (value === null) return null;
    return normalizeRestraintCheckInterval(value) != null && typeof value === 'number' ? null : '15~480 정수여야 합니다';
  }
  if (key === RISK_REASSESS_INTERVAL_KEY) {
    if (value === null) return null;
    return normalizeRiskReassessIntervals(value) ? null : `{ FALL_RISK·PRESSURE_ULCER: { HIGH·MODERATE·LOW: ${RISK_REASSESS_HOURS_RANGE.min}~${RISK_REASSESS_HOURS_RANGE.max} 정수 } } · 고위험 ≤ 중위험 ≤ 저위험`;
  }
  if (key === HANDOFF_ACK_MODE_KEY) {
    if (value === null) return null;
    return normalizeHandoffAckMode(value) ? null : `허용 값: ${HANDOFF_ACK_MODES.join(' · ')}`;
  }
  return undefined;
}

// ── 진통제 판정 ─────────────────────────────────────────────

/** 진통제로 보는 약품 효능 분류(약품 코드 `category`) — 마약성 진통제는 고위험 분류 OPIOID 로도 본다 */
export const ANALGESIC_MED_CATEGORIES = ['해열·진통·소염제', '진통·진양·수렴·소염제', '마약(합성)', '마약(아편알칼로이드)'] as const;

/**
 * 투약 약품이 진통제인가 — true · false · null(분류를 모른다: 약품 코드가 연결되지 않았거나 분류가 비었다).
 * 🔴 모르는 것을 "진통제 아님"으로 접지 않는다 — 호출부가 따로 센다.
 */
export function isAnalgesicMed(m: { category?: string | null; highAlertCategory?: string | null } | null | undefined): boolean | null {
  if (!m) return null;
  if (m.highAlertCategory === 'OPIOID') return true;
  if (m.category == null || m.category.trim() === '') return m.highAlertCategory ? false : null;
  return (ANALGESIC_MED_CATEGORIES as readonly string[]).includes(m.category.trim());
}

// ── 재평가 판정 ─────────────────────────────────────────────

export interface PainRecordEvent { at: Date; score: number }
export interface AnalgesicEvent { at: Date; name: string | null }
export type PainReassessTrigger =
  | { kind: 'PAIN_SCORE'; at: Date; score: number }
  | { kind: 'ANALGESIC'; at: Date; name: string | null };
export interface PainReassessDue {
  trigger: PainReassessTrigger;
  dueAt: Date;
  status: 'DUE' | 'OVERDUE';
  /** 지연이면 기한에서 지난 분 · 아니면 기한까지 남은 분 */
  minutes: number;
}

/**
 * 한 재원의 재평가 대기 — 아직 재평가되지 않은 사건 중 기한이 가장 이른 것. 없으면 null.
 *  · 사건: 기준 이상 통증 기록 · (규정이 켜면) 진통제 투여.
 *  · 재평가 = 사건 **뒤**에 남은 통증 기록(점수 무관). 같은 시각 기록은 재평가가 아니다.
 *  · 마지막 통증 기록이 기준 이상이면 그 기록 자체가 새 사건이다.
 */
export function painReassessDue(rule: PainReassessRule, pain: PainRecordEvent[], analgesics: AnalgesicEvent[], now: Date): PainReassessDue | null {
  const last = pain.reduce<PainRecordEvent | null>((m, p) => (!m || p.at > m.at ? p : m), null);
  const open: Array<{ trigger: PainReassessTrigger; dueAt: Date }> = [];
  if (last && last.score >= rule.thresholdScore) {
    open.push({ trigger: { kind: 'PAIN_SCORE', at: last.at, score: last.score }, dueAt: new Date(last.at.getTime() + rule.withinMinutes * 60_000) });
  }
  if (rule.afterAnalgesicMinutes != null) {
    for (const a of analgesics) {
      if (last && a.at < last.at) continue;
      open.push({ trigger: { kind: 'ANALGESIC', at: a.at, name: a.name }, dueAt: new Date(a.at.getTime() + rule.afterAnalgesicMinutes * 60_000) });
    }
  }
  if (!open.length) return null;
  open.sort((x, y) => x.dueAt.getTime() - y.dueAt.getTime());
  const first = open[0];
  const diff = Math.round((now.getTime() - first.dueAt.getTime()) / 60_000);
  return diff >= 0
    ? { ...first, status: 'OVERDUE', minutes: diff }
    : { ...first, status: 'DUE', minutes: -diff };
}

// ── 재평가 준수율(QI 지표 · 2026-10-27) ─────────────────────

export interface PainReassessOutcome {
  /** 기한 안 재평가 */ onTime: number;
  /** 기한 뒤 재평가 */ late: number;
  /** 재평가 없음(기한 지남) */ never: number;
  /** 기한이 아직 안 옴(재평가 없음) — 분모 제외 */ pending: number;
  /** 기한 전에 재원이 끝남(재평가 없음) — 기회 없음 · 분모 제외 */ endedBeforeDue: number;
}

/**
 * 한 재원의 통증 재평가 결과(기간 안 사건) — 지표 "통증 재평가 기한 내 수행률".
 *  · 사건: 기간 [from, to) 안 기준 이상 통증 기록 · (규정이 켜면) 진통제 투여 — **사건마다** 센다(목록과 달리 마지막 하나가 아니다)
 *  · 재평가: 사건 **뒤** 첫 통증 기록(점수 무관 · 같은 시각은 아님) — 기한(사건 + 규정 분) 안이면 onTime
 *  · 재평가가 없고 기한이 아직 안 왔으면 pending, 기한 전에 재원이 끝났으면 endedBeforeDue — 둘 다 분모에서 뺀다
 */
export function painReassessOutcomes(
  rule: PainReassessRule, pain: PainRecordEvent[], analgesics: AnalgesicEvent[],
  range: { from: Date; to: Date }, now: Date, stayEnd: Date | null,
): PainReassessOutcome {
  const out: PainReassessOutcome = { onTime: 0, late: 0, never: 0, pending: 0, endedBeforeDue: 0 };
  const times = pain.map((p) => p.at.getTime()).sort((a, b) => a - b);
  const inRange = (t: Date) => t >= range.from && t < range.to;
  const events: Array<{ at: number; minutes: number }> = [];
  for (const p of pain) if (inRange(p.at) && p.score >= rule.thresholdScore) events.push({ at: p.at.getTime(), minutes: rule.withinMinutes });
  if (rule.afterAnalgesicMinutes != null) for (const a of analgesics) if (inRange(a.at)) events.push({ at: a.at.getTime(), minutes: rule.afterAnalgesicMinutes });
  for (const e of events) {
    const due = e.at + e.minutes * 60_000;
    const next = times.find((t) => t > e.at);
    if (next != null) { if (next <= due) out.onTime++; else out.late++; continue; }
    if (now.getTime() < due) out.pending++;
    else if (stayEnd && stayEnd.getTime() < due) out.endedBeforeDue++;
    else out.never++;
  }
  return out;
}

// ── 낙상·욕창 위험 재평가 주기(2026-10-27) ──────────────────

export const RISK_REASSESS_INTERVAL_KEY = 'nursing.riskReassess.intervalHours';
export const RISK_ASSESSMENT_TYPES = ['FALL_RISK', 'PRESSURE_ULCER'] as const;
export type RiskAssessmentType = (typeof RISK_ASSESSMENT_TYPES)[number];
export const RISK_LEVELS = ['HIGH', 'MODERATE', 'LOW'] as const;
export type RiskLevelKey = (typeof RISK_LEVELS)[number];
export type RiskReassessIntervals = Record<RiskAssessmentType, Record<RiskLevelKey, number>>;
export const RISK_REASSESS_HOURS_RANGE = { min: 1, max: 168 } as const;
/**
 * 코드 기본값(종전 상수 그대로) — 🔴 원내 규정이 아니다. 비어 있으면 이 값으로 **일정은 계속 만든다**(끄는 쪽이 덜 안전)
 * 화면은 "코드 기본값 — 원내 규정 미설정"이라고 말한다.
 */
export const RISK_REASSESS_INTERVAL_DEFAULT: RiskReassessIntervals = {
  FALL_RISK: { HIGH: 2, MODERATE: 4, LOW: 8 },
  PRESSURE_ULCER: { HIGH: 4, MODERATE: 8, LOW: 24 },
};
export const RISK_ASSESSMENT_TYPE_LABEL: Record<RiskAssessmentType, string> = { FALL_RISK: '낙상(Morse)', PRESSURE_ULCER: '욕창(Braden)' };
export const RISK_LEVEL_LABEL: Record<RiskLevelKey, string> = { HIGH: '고위험', MODERATE: '중위험', LOW: '저위험' };

/**
 * 저장값 → 주기 표. 두 유형·세 등급 전부 1~168 정수이고 **위험이 높을수록 주기가 같거나 짧아야** 한다(고위험을 더 드물게 보는 표는 받지 않는다).
 * 형식 밖이면 null(호출부가 코드 기본값으로).
 */
export function normalizeRiskReassessIntervals(raw: unknown): RiskReassessIntervals | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {} as RiskReassessIntervals;
  for (const t of RISK_ASSESSMENT_TYPES) {
    const row = (raw as Record<string, unknown>)[t];
    if (!row || typeof row !== 'object') return null;
    const v = {} as Record<RiskLevelKey, number>;
    for (const l of RISK_LEVELS) {
      const n = (row as Record<string, unknown>)[l];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < RISK_REASSESS_HOURS_RANGE.min || n > RISK_REASSESS_HOURS_RANGE.max) return null;
      v[l] = n;
    }
    if (!(v.HIGH <= v.MODERATE && v.MODERATE <= v.LOW)) return null;
    out[t] = v;
  }
  return out;
}

/** 위험 평가 결과(지표 "낙상·욕창 위험 재평가 기한 내 수행률") — 판정 규칙은 통증 재평가와 같다 */
export interface RiskAssessmentEvent { at: Date; level: RiskLevelKey }
/**
 * 한 재원·한 유형의 재평가 결과 — 기간 안 평가마다: 기한 = 평가 + 그 등급 주기 · 다음 평가가 기한 안이면 onTime.
 * 다음 평가가 없고 기한이 아직 안 왔거나 기한 전에 재원이 끝났으면 분모 제외(pending·endedBeforeDue).
 */
export function riskReassessOutcomes(
  intervals: Record<RiskLevelKey, number>, events: RiskAssessmentEvent[],
  range: { from: Date; to: Date }, now: Date, stayEnd: Date | null,
): PainReassessOutcome {
  const out: PainReassessOutcome = { onTime: 0, late: 0, never: 0, pending: 0, endedBeforeDue: 0 };
  const times = events.map((e) => e.at.getTime()).sort((a, b) => a - b);
  for (const e of events) {
    if (!(e.at >= range.from && e.at < range.to)) continue;
    const due = e.at.getTime() + intervals[e.level] * 3_600_000;
    const next = times.find((t) => t > e.at.getTime());
    if (next != null) { if (next <= due) out.onTime++; else out.late++; continue; }
    if (now.getTime() < due) out.pending++;
    else if (stayEnd && stayEnd.getTime() < due) out.endedBeforeDue++;
    else out.never++;
  }
  return out;
}
