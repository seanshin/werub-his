/**
 * 이식 대기자 상태 어휘 정본 — 🔴 (2026-09-15 U1) 종전엔 스키마 주석(`TransplantWaitlist.status` // WAITING, MATCHED, TRANSPLANTED, REMOVED)에만
 * 적혀 있고 서비스는 아무 문자열이나 저장했다(오타가 대기 통계 `status: 'WAITING'` 집계에서 조용히 빠진다).
 * 전이 규칙은 기획서에 없어 **어휘만** 검증한다(규칙을 지어내지 않는다). 시드(`prisma/seed.ts` WAITING·MATCHED)는 가드가 대조한다.
 */
export const TRANSPLANT_WAITLIST_STATUSES = ['WAITING', 'MATCHED', 'TRANSPLANTED', 'REMOVED'] as const;
export type TransplantWaitlistStatus = (typeof TRANSPLANT_WAITLIST_STATUSES)[number];

export function isTransplantWaitlistStatus(v: unknown): v is TransplantWaitlistStatus {
  return typeof v === 'string' && (TRANSPLANT_WAITLIST_STATUSES as readonly string[]).includes(v);
}
