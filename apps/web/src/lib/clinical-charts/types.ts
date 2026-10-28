/**
 * 임상차트 엔진 — 타입 정의 (4 아키타입 + SaMD 공통 메타)
 * 콘텐츠 원천: clinical-charts 17문서 / 정의 계층: 13_차트_템플릿_정의서
 *
 * ⚠️ 모든 차트는 보조도구이며 최종 임상판단은 의사에게 귀속한다.
 *    수치·등급은 verified=false 시작 → 공식 가이드라인 원문 대조 후 true.
 */

export type Risk = 'normal' | 'low' | 'moderate' | 'high' | 'critical';
export type Archetype = 'scoring' | 'lookup' | 'formula' | 'criteria' | 'tree';

/** 위험도 → 표시색 (Tailwind 정적 클래스 매핑은 컴포넌트에서 처리) */
export const RISK_META: Record<Risk, { label: string; hex: string }> = {
  normal: { label: '정상', hex: '#22c55e' },
  low: { label: '낮음', hex: '#84cc16' },
  moderate: { label: '중등도', hex: '#f59e0b' },
  high: { label: '높음', hex: '#f97316' },
  critical: { label: '위험', hex: '#dc2626' },
};

/** 공통 메타 — SaMD 추적성 봉투 */
export interface ClinicalChartMeta {
  chartId: string;
  name: string;
  category: string;
  archetype: Archetype;
  sourceGuideline: string;
  sourceVersion: string;
  /** 공식 원문 대조 검증 완료 여부 — false면 "미검증 참조용" 배지 */
  verified: boolean;
  scope?: string;
  note?: string;
  /** 기존 도메인 모델 존재(예: EWS·낙상) → 이중기록 주의 표기 */
  existingModel?: string;
}

/* ── Scoring ──────────────────────────────────────────────── */
export interface ScoringOption {
  label: string;
  score: number;
}
export interface ScoringCategory {
  key: string;
  label: string;
  options: ScoringOption[];
}
export interface ScoringBand {
  min: number;
  max: number;
  label: string;
  level: Risk;
  recommendation?: string;
}
export interface ScoringDef extends ClinicalChartMeta {
  archetype: 'scoring';
  range: string;
  categories: ScoringCategory[];
  bands: ScoringBand[];
  /** 양성 시 안전 워크플로 연계가 필요한 카테고리 key (예: PHQ-9 자살문항) */
  alertCategories?: string[];
}

/* ── Lookup ───────────────────────────────────────────────── */
export interface LookupOption {
  code: string;
  label: string;
  level: Risk;
  attribute?: string;
  recommendation?: string;
}
export interface LookupDef extends ClinicalChartMeta {
  archetype: 'lookup';
  inputLabel?: string;
  options: LookupOption[];
}

/* ── Formula ──────────────────────────────────────────────── */
export interface FormulaVariable {
  key: string;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
}
export interface FormulaDef extends ClinicalChartMeta {
  archetype: 'formula';
  variables: FormulaVariable[];
  /** 화이트리스트 수식 (변수 key·숫자·+ - * / ( )·sqrt min max round ln 만 허용) */
  expr: string;
  resultUnit?: string;
  resultLabel?: string;
  bands?: ScoringBand[];
  constraints?: string[];
}

/* ── Criteria (기준판정 — 불린 로직) ────────────────────────── */
export interface CriteriaItem {
  key: string;
  label: string;
  hint?: string;
}
export interface CriteriaDef extends ClinicalChartMeta {
  archetype: 'criteria';
  items: CriteriaItem[];
  /** 불린 식 — item key·AND·OR·NOT·괄호만 허용 (예: 'f1 AND f2 AND (f3 OR f4)') */
  expr: string;
  positive: { label: string; level: Risk; recommendation?: string };
  negative: { label: string; level: Risk; recommendation?: string };
}

/* ── Tree (레지멘 — 계층) ───────────────────────────────────── */
export interface RegimenDrug {
  name: string;
  /** 처방 코드 검색 프리필(성분명·한글명) — CPOE 결선 시 code-search 초기 질의(P1) */
  medicationCodeQuery?: string;
  doseBasis: 'BSA' | 'AUC' | 'weight' | 'flat';
  doseValue: number;
  doseUnit: string;           // 'mg/m²' | 'AUC' | 'mg/kg' | 'mg'
  route: string;              // IV | PO | SC
  days: string[];             // ['D1'] 등
  infusion?: string;
  sequence: number;
  cap?: number;               // 회당 상한(mg)
  cumulativeLimit?: string;   // 누적용량 한계(표기용)
  note?: string;
}
export interface TreeDef extends ClinicalChartMeta {
  archetype: 'tree';
  regimen: {
    cancer: string;
    indication?: string;
    intent?: string;          // 근치/완화
    line?: string;            // 1차/2차
    cycleLengthDays: number;
    totalCycles?: string;
    drugs: RegimenDrug[];
    premedication: string[];
    supportive: string[];
  };
}

export type ClinicalChartDef = ScoringDef | LookupDef | FormulaDef | CriteriaDef | TreeDef;

/* ── 결과 ─────────────────────────────────────────────────── */
export interface ScoringResult {
  total: number;
  band?: ScoringBand;
  /** alertCategories 중 점수>0 인 항목 (양성 플래그) */
  flags: string[];
}
export interface LookupResult {
  option?: LookupOption;
}
export interface FormulaResult {
  value: number;
  band?: ScoringBand;
}
export interface CriteriaResult {
  positive: boolean;
  verdict: { label: string; level: Risk; recommendation?: string };
}
export interface RegimenDoseLine {
  drug: RegimenDrug;
  dose?: number;              // 계산 용량(mg) — 입력 부족 시 undefined
  capped: boolean;            // 상한 적용 여부
}
