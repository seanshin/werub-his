// 건강검진권 — 법정 하한/상한 상수 (코드 SoT, 변경불가)
// VoucherPolicy(관리자 설정)는 이 값으로 클램프된다. 위반 설정은 저장 거부.
// ⚠️ 실제 수치는 법무/약관 확정 후 교체(설계 §13 미결). 현재는 보수적 잠정값.

export const LEGAL_FLOORS = {
  /** 유효기간 최소(개월) — 신유형 상품권 표준약관 기준(잠정) */
  MIN_VALIDITY_MONTHS: 60,
  /** 미사용 환불 청구 가능 최소(개월) */
  MIN_REFUND_WINDOW_MONTHS: 60,
  /** 잔액 환불 의무 비율 하한(%) — 일정사용 시 잔액환불(신유형 상품권) */
  MIN_BALANCE_REFUND_RATE: 60,
  /** 유치 수수료율 행정 상한(%) — 해외 딜러(제휴계약). 시도 신고값으로 교체 */
  MAX_COMMISSION_RATE_CAP: 30,
  /** 국내 유치업자 수수료율 행정 상한(%) — 의료해외진출법 유치 수수료 규제(잠정·법무확정 후 교체). 해외보다 엄격 */
  MAX_DOMESTIC_COMMISSION_RATE_CAP: 15,
  /** 내국인 재판매 불가(코드 강제 — 정책 토글 무시). 외국인환자 한정. */
  FOREIGNER_ONLY_LOCKED: true,
} as const;

/** 정책 미설정 시 코드 기본값(법정 하한 충족) */
export const DEFAULT_POLICY = {
  version: 0,
  active: true,
  enabledForms: ['PROGRAM', 'AMOUNT'] as string[],
  serialPrefix: 'WGC',
  validityMonths: LEGAL_FLOORS.MIN_VALIDITY_MONTHS,
  refundWindowMonths: LEGAL_FLOORS.MIN_REFUND_WINDOW_MONTHS,
  balanceRefundRate: LEGAL_FLOORS.MIN_BALANCE_REFUND_RATE,
  maxCommissionRate: LEGAL_FLOORS.MAX_COMMISSION_RATE_CAP,
  domesticMaxCommissionRate: LEGAL_FLOORS.MAX_DOMESTIC_COMMISSION_RATE_CAP,
  maxHierarchyDepth: 2,
  prepaymentRequired: true,
  foreignerOnly: true,
  allowedCategories: ['BASIC', 'PLUS', 'PRECISION', 'PREMIUM', 'SPECIAL'] as string[],
  anchorChainType: 'INTERNAL',
  anchorIntervalMin: 60,
  diffPolicy: 'RESIDUAL_VOUCHER',
};

/** 정책 클램프 검증 — 위반 시 사유 배열 반환(빈배열=통과) */
export function validatePolicyAgainstLegal(p: {
  validityMonths: number;
  refundWindowMonths: number;
  balanceRefundRate: number;
  maxCommissionRate: number;
  domesticMaxCommissionRate?: number;
}): string[] {
  const errs: string[] = [];
  if (p.validityMonths < LEGAL_FLOORS.MIN_VALIDITY_MONTHS)
    errs.push(`유효기간은 ${LEGAL_FLOORS.MIN_VALIDITY_MONTHS}개월 이상이어야 합니다`);
  if (p.refundWindowMonths < LEGAL_FLOORS.MIN_REFUND_WINDOW_MONTHS)
    errs.push(`환불 청구기간은 ${LEGAL_FLOORS.MIN_REFUND_WINDOW_MONTHS}개월 이상이어야 합니다`);
  if (p.balanceRefundRate < LEGAL_FLOORS.MIN_BALANCE_REFUND_RATE)
    errs.push(`잔액 환불 비율은 ${LEGAL_FLOORS.MIN_BALANCE_REFUND_RATE}% 이상이어야 합니다`);
  if (p.maxCommissionRate > LEGAL_FLOORS.MAX_COMMISSION_RATE_CAP)
    errs.push(`해외 수수료율 상한은 ${LEGAL_FLOORS.MAX_COMMISSION_RATE_CAP}%를 초과할 수 없습니다`);
  const domestic = p.domesticMaxCommissionRate ?? LEGAL_FLOORS.MAX_DOMESTIC_COMMISSION_RATE_CAP;
  if (domestic > LEGAL_FLOORS.MAX_DOMESTIC_COMMISSION_RATE_CAP)
    errs.push(`국내 유치업자 수수료율 상한은 ${LEGAL_FLOORS.MAX_DOMESTIC_COMMISSION_RATE_CAP}%를 초과할 수 없습니다`);
  if (domestic > p.maxCommissionRate)
    errs.push('국내 수수료율 상한은 해외 상한 이하여야 합니다(국내가 더 엄격)');
  return errs;
}

/** 딜러 유형별 적용 수수료 상한 — DOMESTIC=국내 상한, OVERSEAS=해외 상한 */
export function commissionCapFor(policy: { maxCommissionRate: number; domesticMaxCommissionRate: number }, dealerType: string): number {
  return dealerType === 'DOMESTIC' ? policy.domesticMaxCommissionRate : policy.maxCommissionRate;
}

export const VOUCHER_ERROR = {
  NOT_FOUND: 'VOUCHER_NOT_FOUND',
  EXPIRED: 'VOUCHER_EXPIRED',
  NOT_FOREIGNER: 'NOT_FOREIGNER',
  DOUBLE_REDEEM: 'DOUBLE_REDEEM',
  POLICY_BELOW_LEGAL_FLOOR: 'POLICY_BELOW_LEGAL_FLOOR',
  INVALID_STATE: 'VOUCHER_INVALID_STATE',
  ACTIVATION_MISMATCH: 'ACTIVATION_MISMATCH',
} as const;
