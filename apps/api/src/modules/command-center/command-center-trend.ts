/**
 * 통합 상황판 지표 이력 — 순수 정의(2026-10-02 · 상황판 디자인 F 추세선).
 *
 * 🔴 추세선은 **서버가 남긴 이력**으로만 그린다. 이력 없이 그리면 값을 지어낸다.
 *    여기 있는 지표는 상황판 상단 띠(KpiStrip)가 그리는 것과 **같은 원천**(getSummary 의 kpi·섹션 요약)이다.
 *    섹션 조회가 실패한 칸은 0 이 아니라 null — 추세선은 그 칸을 잇지 않고 끊는다.
 */
export const TREND_BUCKET_MINUTES = 5;
/** 보존 일수 — 파생 지표라 원장이 아니다(지난 행은 기록 크론이 지운다) */
export const TREND_RETENTION_DAYS = 30;
/** 조회 창 상한(시간) */
export const TREND_MAX_HOURS = 168;

type Section = { ok: boolean; summary?: Record<string, unknown> };
type SummaryLike = {
  sections: Record<string, Section>;
  kpi: { census: number | null; erActive: number | null; criticalPending: number | null; occupancyNumerator?: number | null; occupancyDenominator?: number | null };
};

export interface TrendMetric {
  /** 화면 지표 키(KpiStrip 의 delta 키와 같다) */
  key: string;
  /** 이 값이 오는 섹션 — 역할이 그 섹션을 볼 수 없으면 추세도 주지 않는다(요약 EP 와 같은 필터) */
  section: string;
  pick: (s: SummaryLike) => number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const secNum = (s: SummaryLike, section: string, key: string): number | null =>
  s.sections[section]?.ok ? num(s.sections[section].summary?.[key]) : null;

/** 🔴 키 정본 — 화면(KpiStrip)·이력 행·조회 응답이 이 표 하나를 쓴다 */
export const TREND_METRICS: TrendMetric[] = [
  { key: 'kpi.census', section: 'nursing', pick: (s) => (s.sections.nursing?.ok ? num(s.kpi.census) : null) },
  { key: 'kpi.occupancyNumerator', section: 'bed', pick: (s) => (s.sections.bed?.ok ? num(s.kpi.occupancyNumerator) : null) },
  { key: 'kpi.occupancyDenominator', section: 'bed', pick: (s) => (s.sections.bed?.ok ? num(s.kpi.occupancyDenominator) : null) },
  { key: 'kpi.erActive', section: 'emergency', pick: (s) => (s.sections.emergency?.ok ? num(s.kpi.erActive) : null) },
  { key: 'kpi.criticalPending', section: 'diagnostics', pick: (s) => (s.sections.diagnostics?.ok ? num(s.kpi.criticalPending) : null) },
  { key: 'receptionBilling.waiting', section: 'receptionBilling', pick: (s) => secNum(s, 'receptionBilling', 'waiting') },
  { key: 'pharmacy.pending', section: 'pharmacy', pick: (s) => secNum(s, 'pharmacy', 'pending') },
  { key: 'diagnostics.imagingUnread', section: 'diagnostics', pick: (s) => secNum(s, 'diagnostics', 'imagingUnread') },
  { key: 'receptionBilling.outstandingAmount', section: 'receptionBilling', pick: (s) => secNum(s, 'receptionBilling', 'outstandingAmount') },
];

/** 5분 칸 시작 시각(내림) */
export function bucketOf(at: Date, minutes = TREND_BUCKET_MINUTES): Date {
  const ms = minutes * 60_000;
  return new Date(Math.floor(at.getTime() / ms) * ms);
}

/** 집계 한 번 → 이력 한 행의 값 · 실패 섹션 이름 */
export function snapshotOf(summary: SummaryLike): { values: Record<string, number | null>; failedSections: string[] } {
  const values: Record<string, number | null> = {};
  for (const m of TREND_METRICS) values[m.key] = m.pick(summary);
  const failedSections = Object.entries(summary.sections).filter(([, v]) => !v.ok).map(([k]) => k).sort();
  return { values, failedSections };
}

/** 역할이 볼 수 있는 지표만 남긴다(요약 EP 의 섹션 필터와 같은 규칙 · role 없음 = 전부) */
export function metricsForRole(role: string | undefined, sectionRoles: Record<string, string[]>): TrendMetric[] {
  return TREND_METRICS.filter((m) => !role || (sectionRoles[m.section] ?? []).includes(role));
}
