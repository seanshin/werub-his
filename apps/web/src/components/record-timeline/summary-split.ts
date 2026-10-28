/**
 * 시계열 목록 ↔ 하단 정리 영역의 분할 비율 — 순수 로직.
 * 컴포넌트에서 분리한 이유: 드래그 클램프 규칙을 단독 테스트하고, 목록이 사라지지 않는 하한을 고정하기 위해.
 */
export const SUMMARY_MIN_RATIO = 0.15; // 정리 영역 최소(접기 대신 얇게)
export const SUMMARY_MAX_RATIO = 0.7;  // 목록이 최소 30% 는 남아야 경과 비교가 가능
export const SUMMARY_DEFAULT_RATIO = 0.3;

/** 비율 클램프 */
export function clampSummaryRatio(r: number): number {
  if (!Number.isFinite(r)) return SUMMARY_DEFAULT_RATIO;
  return Math.min(Math.max(r, SUMMARY_MIN_RATIO), SUMMARY_MAX_RATIO);
}

/**
 * 커서 Y → 정리 영역 비율. 분할선을 위로 끌면 정리 영역이 커진다.
 * containerTop/Height 는 컨테이너의 화면 좌표(getBoundingClientRect).
 */
export function summaryRatioFromPointer(clientY: number, containerTop: number, containerHeight: number): number {
  if (containerHeight <= 0) return SUMMARY_DEFAULT_RATIO;
  const fromBottom = containerTop + containerHeight - clientY;
  return clampSummaryRatio(fromBottom / containerHeight);
}

/** 저장값 복원 — 손상값·범위 밖은 기본값으로 */
export function parseSummaryRatio(raw: string | null): number {
  if (!raw) return SUMMARY_DEFAULT_RATIO;
  const n = Number(raw);
  return Number.isFinite(n) ? clampSummaryRatio(n) : SUMMARY_DEFAULT_RATIO;
}
