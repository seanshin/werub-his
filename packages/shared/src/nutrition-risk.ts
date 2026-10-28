/**
 * 영양위험도(NRS-2002) 판정 정본 — 2026-08-26.
 *
 * 🔴 같은 사실에 정본이 둘이었다(P12).
 *   · 화면(`NutritionAdvanced.tsx`)   : `nrs >= 3` → HIGH,  `nrs === 2` → MODERATE
 *   · 서버(`nutrition-advanced.service`): `nrs >= 5` → HIGH,  `nrs >= 3` → MODERATE
 *
 * 화면은 자기 판정으로 배지를 그리고(고위험 빨강), 그 값을 본문에 실어 보냈다. 본문의 `riskLevel`
 * 은 DTO 에 없는 키라 whitelist 가 지웠으므로 **원장에는 서버 판정이 남았다** — 즉 NRS 3~4 에서
 * 화면은 "고위험", 원장과 급양사 워크리스트(`highRisk`)는 "중위험"이라고 서로 다른 말을 했다.
 *
 * 정본은 **원장에 남는 쪽**(서버 판정)이다. 화면은 저장 전 미리보기에도 이 함수를 쓴다 —
 * 그래야 저장 전후로 배지가 바뀌지 않는다. 임계값을 고치려면 여기 한 곳만 고친다.
 *
 * 🔴 임계값 자체는 원내 정책이다(NRS-2002 원 지침은 "총점 ≥ 3 = 영양불량 위험 있음"까지만 말하고
 *    HIGH/MODERATE 를 나누지 않는다). 등급을 바꾸려면 영양집중지원팀 결정이 필요하며, 그 결정은
 *    이 파일에서 이뤄져야 한다 — 화면이나 서비스에서 각자 고치면 다시 갈라진다.
 */
export type NutritionRiskLevel = 'HIGH' | 'MODERATE' | 'LOW';

/** HIGH 하한(총점 이상이면 고위험) */
export const NRS2002_HIGH_MIN = 5;
/** MODERATE 하한(총점 이상이면 중위험) */
export const NRS2002_MODERATE_MIN = 3;

/**
 * NRS-2002 총점 → 위험등급.
 *
 * 🔴 점수를 모르면 등급도 모른다 — `null` 을 돌려준다. `LOW`(저위험)로 접으면
 *    "평가하지 않은 환자"가 "저위험 환자"가 된다(안전 화면의 초록 = 표본 부재).
 */
export function nrs2002RiskLevel(nrs: number | null | undefined): NutritionRiskLevel | null {
  if (nrs == null || Number.isNaN(nrs)) return null;
  if (nrs >= NRS2002_HIGH_MIN) return 'HIGH';
  if (nrs >= NRS2002_MODERATE_MIN) return 'MODERATE';
  return 'LOW';
}

export const NUTRITION_RISK_LABEL: Record<NutritionRiskLevel, string> = {
  HIGH: '고위험',
  MODERATE: '중위험',
  LOW: '저위험',
};

/** 등급 라벨 — 미평가(`null`)는 "저위험"이 아니라 "미평가"다. */
export function nutritionRiskText(level: string | null | undefined): string {
  if (!level) return '미평가';
  return NUTRITION_RISK_LABEL[level as NutritionRiskLevel] ?? level;
}
