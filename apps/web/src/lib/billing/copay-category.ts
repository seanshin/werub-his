// 수진자 자격조회 본인부담 구분 — 표시 라벨/배지 공통 (영수증·수납 화면)

export const COPAY_CATEGORY_LABEL: Record<string, string> = {
  NHI: '건강보험',
  MA_TYPE1: '의료급여 1종',
  MA_TYPE2: '의료급여 2종',
  NEAR_POOR: '차상위',
  SPECIAL_EXEMPTION: '산정특례',
  INDUSTRIAL: '산재보험',
  AUTO: '자동차보험',
  SELF_PAY: '자비',
};

/** insuranceType + copayCategory(자격조회) → 표시 라벨. category 우선. */
export function copayLabel(insuranceType?: string | null, copayCategory?: string | null, specialExemption?: string | null): string {
  const cat = copayCategory && COPAY_CATEGORY_LABEL[copayCategory] ? copayCategory : insuranceType;
  let label = COPAY_CATEGORY_LABEL[cat ?? 'NHI'] ?? (cat ?? '건강보험');
  if (copayCategory === 'SPECIAL_EXEMPTION' && specialExemption) label += ` (${specialExemption})`;
  return label;
}

/** 본인부담 구분(법정 영수증) — 일부부담 / 전액부담. */
export function copayKind(copayCategory?: string | null, eligibilityStatus?: string | null): '일부부담' | '전액부담' {
  if (eligibilityStatus === 'EXPIRED' || eligibilityStatus === 'NOT_FOUND') return '전액부담';
  if (copayCategory === 'SELF_PAY') return '전액부담';
  return '일부부담';
}

/** 자격상실/미발견 경고 메시지(없으면 null). */
export function eligibilityWarning(eligibilityStatus?: string | null): string | null {
  if (eligibilityStatus === 'EXPIRED') return '건강보험 자격이 상실된 환자입니다. 전액 본인부담으로 산정되었습니다.';
  if (eligibilityStatus === 'NOT_FOUND') return '보험 가입정보를 확인할 수 없습니다. 자격 확인 후 정산이 필요할 수 있습니다.';
  return null;
}
