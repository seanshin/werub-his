/**
 * 본인부담상한제 순수 계산 — 소득분위별 연간 상한(건강보험법 제44조)·사전급여 캡.
 */

// 소득분위별 연간 상한액(2026 기준, 원)
export const COPAY_CAP_TABLE: Record<number, number> = {
  1: 800_000, 2: 1_000_000, 3: 1_500_000, 4: 2_000_000, 5: 2_500_000,
  6: 3_000_000, 7: 4_000_000, 8: 5_000_000, 9: 5_800_000, 10: 7_800_000,
};

export function annualCapFor(decile: number): number {
  return COPAY_CAP_TABLE[decile] ?? 2_500_000;
}

/** YTD 누적 본인부담 대비 상한 상태 */
export function copayCapState(decile: number, totalCopayYTD: number) {
  const annualCap = annualCapFor(decile);
  return { annualCap, totalCopayYTD, remaining: Math.max(0, annualCap - totalCopayYTD), exceeds: totalCopayYTD > annualCap };
}

/**
 * 사전급여 캡 적용 — 금회 본인부담이 잔여 상한 초과 시 초과분을 본인부담에서 제외.
 * @returns { patientCopay(캡 적용후), capExcess(사전급여·NHIS부담) }
 */
export function applyCopayCap(currentCopay: number, remaining: number): { patientCopay: number; capExcess: number } {
  if (currentCopay <= 0 || currentCopay <= remaining) return { patientCopay: currentCopay, capExcess: 0 };
  const capped = Math.max(0, remaining);
  return { patientCopay: capped, capExcess: currentCopay - capped };
}
