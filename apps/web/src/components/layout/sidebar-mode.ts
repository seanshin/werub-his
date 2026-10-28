/**
 * 사이드바 접힘(아이콘 줄) 규칙 — (main)/layout 이 쓴다(2026-09-29 · 좁은 화면 자동 축소).
 *
 * - 'auto' : 화면이 좁으면(< 1280) 접고, 넓으면 펼친다.
 * - 'rail' / 'full' : 사용자가 버튼으로 고른 것 — 화면 폭과 무관하게 따른다.
 * - 모바일 서랍으로 연 상태(drawerOpen)는 늘 펼친다(좁은 서랍 안에서 또 접으면 쓸 수 없다).
 * 버튼을 누른 결과가 자동 판단과 같으면 'auto' 로 돌려 둔다 — 그래야 창을 넓히거나 좁힐 때 다시 따라간다.
 */
export type SidebarMode = 'auto' | 'rail' | 'full';

export const SIDEBAR_MODE_KEY = 'ui.sidebarMode';

export function isRailCollapsed(mode: SidebarMode, narrow: boolean, drawerOpen: boolean): boolean {
  if (drawerOpen) return false;
  return mode === 'rail' || (mode === 'auto' && narrow);
}

export function nextSidebarMode(collapsedNow: boolean, narrow: boolean): SidebarMode {
  // 펼치려 한다: 좁은 화면이면 자동과 반대이므로 'full' 을 기억, 넓은 화면이면 자동이 곧 펼침
  if (collapsedNow) return narrow ? 'full' : 'auto';
  // 접으려 한다: 좁은 화면이면 자동이 곧 접힘, 넓은 화면이면 'rail' 을 기억
  return narrow ? 'auto' : 'rail';
}

export function parseSidebarMode(v: string | null | undefined): SidebarMode {
  return v === 'rail' || v === 'full' ? v : 'auto';
}
