/**
 * 결제수단 어휘 정본 (2026-08-24 · 시드 흐름 전수 검토 7단계 — 청구·수납)
 *
 * 🔴 실측에서 결제수단 표기가 세 곳에 각각 있었고, 그중 하나는 법정 서식이었다:
 *   · 진료비 영수증(`print/receipt/[billingId]`)은 인라인 삼항이라 CARD·CASH 만 한글이고
 *     **`MIXED`·`TRANSFER`·`DEPOSIT`·`VOUCHER` 는 영문 원문 그대로 인쇄**됐다.
 *     운영에 복합결제 1건이 실재해 그 영수증에는 결제수단이 `MIXED` 로 찍힌다.
 *   · 수납 화면(`billing/page.tsx`)은 로컬 Record 로 6종을 따로 들고 있었다.
 *   · 서버는 `Billing.paymentMethod`(요약 라벨)와 `BillingPayment.method`(원장 라인) 두 곳에 쓴다.
 *
 * 규약: 결제수단 표기는 이 표로만 한다. 화면 로컬 Record 재정의 금지.
 *
 * 🔴 `MIXED` 는 **수단이 아니라 요약 라벨**이다 — 실제 수단별 금액은 수납 원장
 *    (`billing_payments`)에만 있다. 집계는 원장을 읽어야 하고, MIXED 로 집계하면
 *    카드사 대사·현금 시재에서 그 금액이 통째로 사라진다.
 */

/** 수납 원장(`BillingPayment.method`)에 실제로 저장되는 수단 — 이것만이 대사 가능한 값이다 */
export const PAYMENT_METHODS = ['CARD', 'CASH', 'TRANSFER', 'DEPOSIT', 'VOUCHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * 입원 중간정산 수납 수단(2026-10-22) — 카드·현금·계좌이체만. 선수금(DEPOSIT)·검진권(VOUCHER)은 중간정산 대상이 아니다
 * (선수금은 퇴원 정산에서 차감하는 다른 원장 · 검진권은 검진 전용).
 */
export const INTERIM_PAYMENT_METHODS = ['CARD', 'CASH', 'TRANSFER'] as const;
export type InterimPaymentMethod = (typeof INTERIM_PAYMENT_METHODS)[number];

/** 입원 중간정산 상태 — 정본 schema.prisma InterimBilling.status · VOID = 수납 전 무효(사유와 함께 · 지우지 않는다) */
export const INTERIM_BILLING_STATUSES = ['GENERATED', 'NOTIFIED', 'PAID', 'OVERDUE', 'VOID'] as const;
export type InterimBillingStatus = (typeof INTERIM_BILLING_STATUSES)[number];

/** 중간정산 단가 출처 — DEFAULT_CONSTANT 는 설정이 없어 상수로 떨어진 값(근거 없는 단가 · 화면이 그렇다고 말한다) */
export const STAY_PRICE_BASES = ['CODE', 'CONFIG_BED_CLASS', 'CONFIG_DAILY', 'DEFAULT_CONSTANT'] as const;
export type StayPriceBasis = (typeof STAY_PRICE_BASES)[number];

/**
 * 표기 정본. 수단 5종 + 수단이 아닌 두 값을 함께 담는다.
 * · `MIXED` = 한 수납에 두 가지 이상 수단이 섞였다는 **요약**(원장에 라인이 따로 있다)
 * · `UNKNOWN` = 수단이 기록되지 않았다. **"현금"이 아니다** — 모르는 것은 모른다고 적는다
 */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CARD: '신용카드',
  CASH: '현금',
  TRANSFER: '계좌이체',
  DEPOSIT: '선수금',
  VOUCHER: '검진권',
  MIXED: '복합결제',
  UNKNOWN: '수단 미기록',
  REFUND: '환불',
};

/**
 * 환불 원장 라인 표식(2026-10-14 결함 발굴 수납 P1-5) — `billing_payments` 에 **음수 금액**으로 환불한 그 시각에 남긴다.
 * 수단이 아니다(수단별 수납 집계에서 뺀다) · 환자에게 돌려준 돈만(검진권으로 되돌린 몫 제외).
 */
export const REFUND_LEDGER_METHOD = 'REFUND';

/** 화면 색(수납 화면 막대·배지 공용) — 라벨과 갈라지지 않게 한 곳에 둔다 */
export const PAYMENT_METHOD_COLOR: Record<string, string> = {
  CARD: 'bg-blue-500',
  CASH: 'bg-emerald-500',
  TRANSFER: 'bg-violet-500',
  DEPOSIT: 'bg-amber-500',
  VOUCHER: 'bg-pink-500',
  MIXED: 'bg-teal-500',
  UNKNOWN: 'bg-gray-400',
  REFUND: 'bg-red-400',
};

/**
 * 표기 — 모르는 값을 지어내지 않는다.
 * · `null`/빈 값 → '수단 미기록'(수납은 됐는데 수단이 남지 않았다는 사실)
 * · 정본에 없는 값 → 원문 그대로 돌려준다(조용히 삼키면 어휘가 갈라진 것을 아무도 모른다)
 */
export function paymentMethodLabel(method?: string | null): string {
  if (method === undefined || method === null || method === '') return PAYMENT_METHOD_LABEL.UNKNOWN;
  const key = String(method).toUpperCase();
  return PAYMENT_METHOD_LABEL[key] ?? String(method);
}

export function paymentMethodColor(method?: string | null): string {
  if (method === undefined || method === null || method === '') return PAYMENT_METHOD_COLOR.UNKNOWN;
  return PAYMENT_METHOD_COLOR[String(method).toUpperCase()] ?? PAYMENT_METHOD_COLOR.UNKNOWN;
}
