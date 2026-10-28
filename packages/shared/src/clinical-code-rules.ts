/**
 * 처방 판정의 **코드 규칙**(편집 불가) 목록 — 2026-10-21 임상 규칙·템플릿 P1(`clinical-rules-templates-review-2026-10.plan.md` A1).
 *
 * 처방 경고는 두 가지로 판정한다 — ① DUR 룰 표(`dur_rules` · 관리 화면에서 편집) ② 아래 코드 규칙(판정 코드에 박혀 있어 화면에서 바꿀 수 없다).
 * 관리 화면이 "편집하지 못하는 판정이 있다"를 말하도록 목록을 하나 둔다. 문구는 이 정본에서만(화면·서버가 따로 적지 않는다).
 * 가드: 판정 코드의 경고 유형과 이 목록을 기계 대조한다(`clinical-code-rules.spec`).
 */
export type CodeRuleEngine = 'DUR' | 'CDSS';

export interface ClinicalCodeRule {
  key: string;
  engine: CodeRuleEngine;
  /** 판정 코드가 내는 경고 유형(DUR `DurWarning.type` · CDSS `CdssCheck.category`) */
  emits: string;
  label: string;
  /** 무엇을 보고 판정하는가 — 데이터 출처 */
  source: string;
}

export const CLINICAL_CODE_RULES: readonly ClinicalCodeRule[] = [
  { key: 'DUR_DUPLICATE', engine: 'DUR', emits: 'DUPLICATE', label: '동일 성분 중복', source: '주성분 코드(없으면 성분명)' },
  { key: 'DUR_THERAPEUTIC_DUP', engine: 'DUR', emits: 'THERAPEUTIC_DUPLICATION', label: '효능군(약효분류) 중복', source: '약품 마스터 약효분류' },
  { key: 'DUR_PREGNANCY', engine: 'DUR', emits: 'PREGNANCY', label: '임부 금기·주의', source: '약품 마스터 임부 등급' },
  { key: 'DUR_MASTER_MAX_DOSE', engine: 'DUR', emits: 'MAX_DOSE', label: '허가 일일 최대용량', source: '약품 마스터 최대용량(값이 없으면 판정하지 않음)' },
  { key: 'DUR_ALLERGY', engine: 'DUR', emits: 'ALLERGY', label: '환자 알레르기', source: '알레르기 원장 + 환자 정보의 알레르기' },
  { key: 'DUR_HIGH_ALERT', engine: 'DUR', emits: 'HIGH_ALERT', label: '고위험 약물', source: '약품 마스터 고위험 분류' },
  { key: 'DUR_LASA', engine: 'DUR', emits: 'LASA', label: '이름·모양 유사 약물(LASA)', source: '약품 마스터 LASA 묶음' },
  { key: 'CDSS_ALLERGY', engine: 'CDSS', emits: 'ALLERGY', label: '알레르기(보완 점검)', source: '알레르기 원장(약물 성분명 대조)' },
  { key: 'CDSS_RENAL', engine: 'CDSS', emits: 'RENAL', label: '신기능 용량', source: '최근 크레아티닌·eGFR' },
  { key: 'CDSS_AGE', engine: 'CDSS', emits: 'AGE', label: '연령 적합성(보완 점검)', source: '환자 나이 + 판정 코드의 약물 목록' },
  { key: 'CDSS_DIAGNOSIS', engine: 'CDSS', emits: 'DIAGNOSIS', label: '진단-처방 적합성', source: '진료 진단(진료 맥락이 있을 때만)' },
  { key: 'CDSS_GUIDELINE', engine: 'CDSS', emits: 'GUIDELINE', label: '가이드라인 권고', source: '진료 진단(진료 맥락이 있을 때만)' },
];

/** DUR 룰 표의 유형 — 관리 화면 라벨 정본(서버 DTO `IsIn` 과 기계 대조) */
export const DUR_RULE_TYPES = ['INTERACTION', 'AGE', 'MAX_DOSE', 'BEERS', 'PEDIATRIC_DOSE'] as const;
export type DurRuleType = (typeof DUR_RULE_TYPES)[number];
export const DUR_RULE_TYPE_LABEL: Record<DurRuleType, string> = {
  INTERACTION: '병용 금기·주의',
  AGE: '연령 금기',
  MAX_DOSE: '성분 일일 상한',
  BEERS: '노인 주의(Beers)',
  PEDIATRIC_DOSE: '소아 체중 기반 용량',
};
/** 룰셋 키(판정 루프) ↔ 표 유형 */
export const DUR_RULESET_KEY: Record<DurRuleType, 'interaction' | 'age' | 'maxDose' | 'beers' | 'pediatric'> = {
  INTERACTION: 'interaction', AGE: 'age', MAX_DOSE: 'maxDose', BEERS: 'beers', PEDIATRIC_DOSE: 'pediatric',
};
