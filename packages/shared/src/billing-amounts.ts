/**
 * 수납 금액 정본(2026-10-14 결함 발굴 수납·청구).
 * 🔴 '남은 납부 금액'(= 환자가 아직 내야 할 돈)의 정의가 화면마다 달랐다 — Σ본인부담(이미 낸 돈·감면 무시) · Σ(총액−납부)(보험자 부담 포함) ·
 *    감면 무시 · 키오스크만 맞음. 정의는 서버 `pay()` 와 같다: 본인부담 − 감면 − 이미 낸 돈.
 * 본인부담을 모르면 null(0원이라 말하지 않는다) · 음수(이미 더 받음)는 0 이 아니라 그대로 돌려준다 — 화면이 환불 대상임을 말하게.
 */
export interface BillingAmountsLike {
  patientCopay?: number | null;
  discountAmount?: number | null;
  paidAmount?: number | null;
}

export function billingRemaining(b: BillingAmountsLike | null | undefined): number | null {
  if (!b || b.patientCopay == null) return null;
  return b.patientCopay - (b.discountAmount ?? 0) - (b.paidAmount ?? 0);
}

/**
 * 미수(아직 받을 돈) 상태 정본 — 미납·부분 납부·보류. 서버 `journey-console/flow-canon UNPAID_STATUS` 와 같은 집합(가드가 대조한다).
 * 🔴 (2026-10-14 P4-1) 화면마다 다른 집합·다른 식이었다(목록 Σ본인부담 · 보드 Σ(총액−납부, 보험자 부담 포함) · 경영 감면 무시 ·
 *    모바일 총진료비 − 납부 · 포털 감면 무시). 상태는 이 집합, 금액은 `billingOutstanding` 하나.
 */
export const BILLING_OUTSTANDING_STATUSES = ['PENDING', 'PARTIAL', 'DEFERRED'] as const;

/** 한 청구에서 아직 받을 돈 — 남은 금액(본인부담 − 감면 − 이미 낸 돈)이 음수(더 받음)면 0 · 본인부담을 모르면 null */
export function billingOutstanding(b: BillingAmountsLike | null | undefined): number | null {
  const r = billingRemaining(b);
  return r == null ? null : Math.max(0, r);
}
