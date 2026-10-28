/**
 * 유형 칩 상태 판정 — 순수 로직.
 *
 * 규칙이 한 줄이 아니라 함수로 있는 이유: 서버 `counts` 는 **조회한 트랙만** 담는다.
 * 필터가 걸린 상태에서 "0건이면 비활성"을 그대로 적용하면 나머지 유형이 전부 0으로 보여
 * 두 번째 유형을 추가로 고를 수 없게 된다(칩이 죽는다).
 */

export type ChipState = 'selected' | 'available' | 'muted';

/** muted = 이 기간에 기록이 없어 누를 이유가 없는 유형(필터가 없을 때만 판정 가능) */
export function chipState(count: number, isSelected: boolean, filterActive: boolean): ChipState {
  if (isSelected) return 'selected';
  if (!filterActive && count <= 0) return 'muted';
  return 'available';
}

/** 건수는 아는 값일 때만 보여준다 — 모르는 값(필터 중 미조회 트랙)을 0으로 단정하지 않는다 */
export function showChipCount(count: number): boolean {
  return count > 0;
}
