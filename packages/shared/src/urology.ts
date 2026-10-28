import { roundBy } from './numeric-policy';

/**
 * PSA 밀도(PSAD) — PSA(ng/mL) ÷ 전립선 용적(mL) · 같은 검사 행의 두 값으로만(2026-10-10).
 * 🔴 둘 중 하나라도 없거나 용적이 0 이하면 `null`(산출 불가) — 다른 날의 용적을 끌어와 나누지 않는다.
 * 🔴 판정 기준선(예: 0.15)은 원내 정책이라 여기 두지 않는다 — 값만 낸다.
 */
export function psaDensity(psa: number | string | null | undefined, prostateVolume: number | string | null | undefined): number | null {
  if (psa == null || prostateVolume == null || psa === '' || prostateVolume === '') return null;
  const p = Number(psa);
  const v = Number(prostateVolume);
  if (!Number.isFinite(p) || !Number.isFinite(v) || p < 0 || v <= 0) return null;
  return roundBy(p / v, 'psaDensity');
}

/** PSA 밀도 산출 불가 이유 — 화면이 그대로 말한다 */
export function psaDensityUnavailableReason(psa: unknown, prostateVolume: unknown): 'NO_PSA' | 'NO_VOLUME' | 'INVALID_VOLUME' | null {
  if (psa == null || psa === '') return 'NO_PSA';
  if (prostateVolume == null || prostateVolume === '') return 'NO_VOLUME';
  const v = Number(prostateVolume);
  if (!Number.isFinite(v) || v <= 0) return 'INVALID_VOLUME';
  return null;
}
