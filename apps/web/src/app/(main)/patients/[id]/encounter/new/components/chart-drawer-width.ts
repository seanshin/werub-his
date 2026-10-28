/**
 * 참조 패널(환자 차트) 폭 조절 — 순수 로직.
 * 컴포넌트에서 분리한 이유: 배럴 import(api-client 등)를 끌지 않고 단독 테스트 가능하게.
 */
export const DRAWER_MIN_PX = 420;
export const DRAWER_KEEP_PX = 480; // 진료 입력에 남겨둘 최소 폭

/** 화면폭 기준 패널 폭 상한 — 진료 입력 영역을 반드시 남긴다 */
export function drawerMaxWidth(innerWidth: number): number {
  return Math.max(DRAWER_MIN_PX, innerWidth - DRAWER_KEEP_PX);
}

/** 커서 X → 패널 폭(클램프). 패널이 오른쪽에 붙어 있으므로 폭 = 화면폭 - 커서X */
export function drawerWidthFromPointer(clientX: number, innerWidth: number): number {
  return Math.min(Math.max(innerWidth - clientX, DRAWER_MIN_PX), drawerMaxWidth(innerWidth));
}
