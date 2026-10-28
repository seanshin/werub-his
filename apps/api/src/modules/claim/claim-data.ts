/** 청구 데이터(claimData) 정본 — 두 청구 생성 경로(claim · insurance-claim)가 같은 모양을 남긴다(P2-2·P2-4) */
export interface BillingWithItems {
  totalAmount: number;
  insuranceCovered: number;
  patientCopay: number;
  items?: Array<{ codeId: string; codeName: string; amount: number; quantity: number; unitPrice?: number; insuranceCategory?: string | null }>;
}

/** 심사 결과를 기록할 수 있는 청구 상태 — 제출됨·심사 중, 그리고 이미 심사된 청구의 재심사(금액 정정). DRAFT·PAID 는 아니다 */
export const REVIEWABLE_CLAIM_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED'] as const;

/** 이 청구 파일(건강보험·의료급여 심사)로 가지 않는 보험유형 — 산재(근로복지공단)·자동차보험은 청구처가 다르다 */
export const OTHER_PAYER_TYPES = new Set(['INDUSTRIAL', 'AUTO']);

/**
 * 🔴 (P2-2) `code` 칸은 **마스터 코드**다 — 종전엔 내부 UUID(codeId)를 담아 청구 파일 `<코드>` 로 나갔다.
 *    못 찾은 코드는 `null`(지어내지 않음 · 파일을 만들 때 거부) · codeId 는 따로 남긴다.
 *    보험유형·진료일은 청구 만들 때의 사실을 남긴다(종전엔 보험유형 늘 'NHI'·진료일 = 청구 생성일).
 */
export function buildClaimData(billing: BillingWithItems, facts: { payerType?: string; serviceDate?: string; codeOf: Map<string, string> }) {
  return {
    claimYearMonth: new Date().toISOString().slice(0, 7).replace('-', ''),
    payerType: facts.payerType,
    serviceDate: facts.serviceDate,
    totalAmount: billing.totalAmount,
    insuranceClaimed: billing.insuranceCovered,
    patientCopay: billing.patientCopay,
    items: billing.items?.map((i) => ({ code: facts.codeOf.get(i.codeId) ?? null, codeId: i.codeId, name: i.codeName, amount: i.amount, quantity: i.quantity, unitPrice: i.unitPrice, insuranceCategory: i.insuranceCategory ?? null })),
  };
}

