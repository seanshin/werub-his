/**
 * 혈액형 Rh 표기 정본 (2026-08-13 · 화면 점검 W3)
 *
 * 🔴 DB 정본은 `POS`/`NEG`(bloodProduct.rhFactor·PatientBloodTyping.rh — VarChar(3)).
 * 두 가지 실결함이 있었다:
 * 1. `rh === 'NEGATIVE' ? '-' : '+'` — 'NEGATIVE'(8자)는 컬럼에 저장될 수조차 없는 값이라
 *    삼항이 영원히 거짓 → 출고 화면에서 **O− 혈액이 "O+"로** 표시됐다.
 * 2. `rh === 'POS' ? '+' : '-'` — 미입력(null)을 **Rh 음성으로 단정**(P10).
 *
 * 규약: Rh 는 이 함수로만 표기한다. 모르는 값은 '?'로 — 혈액형에서 추정은 금물.
 */
export function rhSign(rh: string | null | undefined): '+' | '-' | '?' {
  if (rh === 'POS') return '+';
  if (rh === 'NEG') return '-';
  return '?';
}

/** ABO+Rh 합성 표기 — 예: 'A' + 'NEG' → 'A-' · ABO 미상은 '?' */
export function bloodTypeText(abo: string | null | undefined, rh: string | null | undefined): string {
  return `${abo ?? '?'}${rhSign(rh)}`;
}

/** 혈액제제 유형 라벨 정본 — bloodProduct.productType */
export const BLOOD_PRODUCT_LABEL: Record<string, string> = {
  PRBC: '농축적혈구',
  FFP: '신선동결혈장',
  PC: '혈소판농축액',
  CRYO: '동결침전',
  WB: '전혈',
  APHERESIS_PLT: '성분채혈혈소판',
};
