/**
 * 임상차트 엔진 — 공개 진입점 (레지스트리)
 * 콘텐츠는 코드 정의(정적 TS) + 멱등 — 추가 시 definitions/* 에만 추가.
 */
import type { ClinicalChartDef } from './types';
import { SCORING_DEFS } from './definitions/scoring';
import { LOOKUP_DEFS } from './definitions/lookup';
import { LOOKUP_IMAGING_DEFS } from './definitions/lookup-imaging';
import { LOOKUP_CLINICAL_DEFS } from './definitions/lookup-clinical';
import { LOOKUP_ONC_FN_DEFS } from './definitions/lookup-oncology-function';
import { CRITERIA_DEFS } from './definitions/criteria';
import { REGIMEN_DEFS } from './definitions/regimens';
import { FORMULA_DEFS } from './definitions/formula';

export * from './types';
export { computeScoring, evaluateLookup, computeFormula, evaluateCriteria, computeRegimenDoses, bandFor } from './engine';
export { computeDefHash } from './hash';

export const CLINICAL_CHARTS: ClinicalChartDef[] = [
  ...SCORING_DEFS,
  ...LOOKUP_DEFS,
  ...LOOKUP_IMAGING_DEFS,
  ...LOOKUP_CLINICAL_DEFS,
  ...LOOKUP_ONC_FN_DEFS,
  ...FORMULA_DEFS,
  ...CRITERIA_DEFS,
  ...REGIMEN_DEFS,
];

export const CHART_BY_ID: Record<string, ClinicalChartDef> = Object.fromEntries(
  CLINICAL_CHARTS.map((c) => [c.chartId, c]),
);

export function getChart(chartId: string): ClinicalChartDef | undefined {
  return CHART_BY_ID[chartId];
}

/** 카테고리 → 차트 목록 (UI 그룹핑) */
export function chartsByCategory(): { category: string; charts: ClinicalChartDef[] }[] {
  const map = new Map<string, ClinicalChartDef[]>();
  for (const c of CLINICAL_CHARTS) {
    if (!map.has(c.category)) map.set(c.category, []);
    map.get(c.category)!.push(c);
  }
  return Array.from(map.entries())
    .map(([category, charts]) => ({ category, charts }))
    .sort((a, b) => a.category.localeCompare(b.category, 'ko'));
}

export const ARCHETYPE_LABEL: Record<string, string> = {
  scoring: '점수합산', lookup: '분류/등급', formula: '계산식', criteria: '기준판정', tree: '레지멘',
};
