/**
 * 만성질환 진단↔관리목표 가이드라인 — 서버 단일 정의(FE 상수 중복 제거).
 * 문제중심 차트(P2)·CDSS·목가상읍이 이 정의 1곳에서 파생.
 * comparator: lt(미만 양호)·lte(이하)·gte(이상, 예 eGFR)
 */
export type Comparator = 'lt' | 'lte' | 'gte';
export interface GuidelineIndicator { code: string; label: string; unit: string; target: number; comparator: Comparator }
export interface GuidelineCondition { condition: string; label: string; diagnosisPrefixes: string[]; indicators: GuidelineIndicator[] }

export const CHRONIC_GUIDELINE: GuidelineCondition[] = [
  { condition: 'DM', label: '당뇨', diagnosisPrefixes: ['E10', 'E11', 'E13', 'E14'], indicators: [
    { code: 'HBA1C', label: '당화혈색소', unit: '%', target: 7, comparator: 'lt' },
    { code: 'FBS', label: '공복혈당', unit: 'mg/dL', target: 130, comparator: 'lt' },
  ] },
  { condition: 'HTN', label: '고혈압', diagnosisPrefixes: ['I10', 'I11', 'I12', 'I13', 'I15'], indicators: [
    { code: 'SBP', label: '수축기혈압', unit: 'mmHg', target: 140, comparator: 'lt' },
    { code: 'DBP', label: '이완기혈압', unit: 'mmHg', target: 90, comparator: 'lt' },
  ] },
  { condition: 'DYSLIPID', label: '이상지질', diagnosisPrefixes: ['E78'], indicators: [
    { code: 'LDL', label: 'LDL 콜레스테롤', unit: 'mg/dL', target: 100, comparator: 'lt' },
    { code: 'TG', label: '중성지방', unit: 'mg/dL', target: 150, comparator: 'lt' },
  ] },
  { condition: 'CKD', label: '만성콩팥병', diagnosisPrefixes: ['N18'], indicators: [
    { code: 'EGFR', label: 'eGFR', unit: 'mL/min', target: 60, comparator: 'gte' },
    { code: 'CR', label: '크레아티닌', unit: 'mg/dL', target: 1.2, comparator: 'lte' },
  ] },
];

/** 목표 달성 여부 — comparator 기준 */
export function meetsTarget(value: number, target: number, comparator: Comparator): boolean {
  return comparator === 'lt' ? value < target : comparator === 'lte' ? value <= target : value >= target;
}

/** 진단코드 → 매칭 만성 조건(prefix) */
export function conditionForDiagnosis(code: string): GuidelineCondition | undefined {
  const up = (code || '').toUpperCase();
  return CHRONIC_GUIDELINE.find((g) => g.diagnosisPrefixes.some((p) => up.startsWith(p)));
}
