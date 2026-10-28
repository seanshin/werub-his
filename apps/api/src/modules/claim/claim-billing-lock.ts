/**
 * 수납(Billing) 한 건에 청구(Claim)를 만드는 **모든 경로가 함께 쓰는 잠금 키**(2026-09-28 재판정 a13360).
 *
 * 🔴 청구를 만드는 경로는 둘이다 — `ClaimService.generateClaims`(화면 `/claims` '청구 생성' 일괄)와
 *    `InsuranceClaimService.create`(수납 한 건 청구). 둘 다 "이미 있나 읽고 → 만든다"(check-then-act)였고
 *    `billingId` 에는 유니크가 없으며 `claimNumber @unique` 는 `String?` 이라 생성 시 비어 있다
 *    (NULL 끼리는 유니크에서 충돌하지 않는다) — **DB 는 심판이 되지 못한다.**
 *    한쪽만 잠그면 다른 쪽과는 여전히 경합한다(형제 경로를 잊는 것이 이 저장소의 반복 패턴이다).
 *    그래서 키는 여기 하나만 둔다.
 */
export function claimBillingLockKey(billingId: string): string {
  return `claim:billing:${billingId}`;
}
