/**
 * 처방 상태 → FHIR R4 `MedicationRequest.status` 정본(2026-09-30 오더 중단 설계).
 *
 * 🔴 반출 경로마다 따로 적어 갈라졌다 — 두 곳은 **모든 처방을 'active'** 로 내보냈고(취소된 약까지),
 *    한 곳은 ACTIVE 가 아니면 전부 'cancelled' 였다(중단을 취소로). 모르는 값은 'unknown'(지어내지 않는다).
 *   ACTIVE → active · CANCELLED → cancelled(발효 전 무효) · DISCONTINUED → stopped(그 시각 이후 멈춤)
 */
export type FhirMedicationRequestStatus = 'active' | 'cancelled' | 'stopped' | 'unknown';

export function fhirMedicationRequestStatus(status: string | null | undefined): FhirMedicationRequestStatus {
  switch (status) {
    case 'ACTIVE': return 'active';
    case 'CANCELLED': return 'cancelled';
    case 'DISCONTINUED': return 'stopped';
    default: return 'unknown';
  }
}
