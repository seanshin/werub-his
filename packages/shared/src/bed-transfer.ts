/**
 * 병동 간 전동 요청 → 수락 어휘 정본(2026-09-30) — 기획 `docs/01-plan/features/bed-transfer-request.plan.md`.
 *  REQUESTED(받는 병동 대기) → ACCEPTED(받는 쪽이 병상을 골라 수락 — 그 순간 이동) | REJECTED(사유) | CANCELLED(요청자 취소·입원 종료)
 */
export const BED_TRANSFER_STATUSES = ['REQUESTED', 'ACCEPTED', 'REJECTED', 'CANCELLED'] as const;
export type BedTransferStatus = (typeof BED_TRANSFER_STATUSES)[number];
export const BED_TRANSFER_STATUS_LABEL: Record<BedTransferStatus, string> = {
  REQUESTED: '수락 대기', ACCEPTED: '수락·이동', REJECTED: '거절', CANCELLED: '취소',
};
/** 입원이 끝나 요청이 저절로 닫힐 때의 기록(사람이 판정한 것이 아니다 — decidedById null) */
export const BED_TRANSFER_CLOSED_BY_ADMISSION = 'ADMISSION_CLOSED';
