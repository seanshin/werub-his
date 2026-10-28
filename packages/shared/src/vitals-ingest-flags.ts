/**
 * 🔴 활력 수집 판정 어휘 — **서버와 화면이 같은 것을 쓴다.**
 *
 * 2026-08-20 실측 사고: 서버(`vitals-ingest.service.ts`)는
 * `MEASURED_AT_UNKNOWN` · `MEASURED_AT_DEFAULTED_TO_RECEIPT` · `FUTURE_MEASURED_AT` ·
 * `EXCESSIVE_BACKDATE` 를 내보내는데, 화면은 `FUTURE` · `UNKNOWN_MEASURED_AT` · `FAR_PAST`
 * 라는 **다른 어휘**를 적어 뒀다. **교집합 0** — 모든 플래그가 폴백 문구로 떨어졌다(P11).
 * 게다가 화면 가드가 **화면이 지어낸 어휘를 테스트해서 통과**했다(가드가 다른 이유로 통과).
 *
 * 그래서 값과 문구를 여기 하나로 둔다. 서버 타입은 이 값에서 파생하고, 화면은 이 문구를 쓴다.
 */
export const VITALS_TIME_FLAG = {
  /** 측정 시각을 모른 채 들어왔다 */
  MEASURED_AT_UNKNOWN: 'MEASURED_AT_UNKNOWN',
  /** 모르는 측정 시각 자리에 수신 시각이 박혔다(스키마가 NOT NULL 이라 비워둘 수 없다) */
  MEASURED_AT_DEFAULTED_TO_RECEIPT: 'MEASURED_AT_DEFAULTED_TO_RECEIPT',
  /** 측정 시각이 수신 시각보다 미래다 */
  FUTURE_MEASURED_AT: 'FUTURE_MEASURED_AT',
  /** 과도한 소급(backfill) — 거부하지 않는다. 늦었다는 사실만 드러낸다 */
  EXCESSIVE_BACKDATE: 'EXCESSIVE_BACKDATE',
} as const;

export type VitalsTimeFlag = (typeof VITALS_TIME_FLAG)[keyof typeof VITALS_TIME_FLAG];

/** 사람에게 보여줄 문구 — 🔴 추측하지 않는다. 모르는 플래그는 코드를 그대로 보여준다(아래 헬퍼) */
export const VITALS_TIME_FLAG_TEXT: Record<VitalsTimeFlag, string> = {
  MEASURED_AT_UNKNOWN: '측정 시각을 알 수 없습니다',
  MEASURED_AT_DEFAULTED_TO_RECEIPT: '측정 시각 자리에 수신 시각이 기록되었습니다',
  FUTURE_MEASURED_AT: '측정 시각이 미래로 기록되었습니다',
  EXCESSIVE_BACKDATE: '측정 시각이 비정상적으로 과거입니다(늦은 입력)',
};

/**
 * 플래그 → 문구. 🔴 **모르는 플래그를 숨기지 않는다** — 새 플래그가 서버에 생겼을 때
 * 화면이 조용히 아무 말도 안 하는 것이 이 사고의 원인이었다.
 */
export function vitalsTimeFlagText(flag: string): string {
  return VITALS_TIME_FLAG_TEXT[flag as VitalsTimeFlag] ?? `측정 시각 확인 필요(${flag})`;
}
