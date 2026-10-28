'use client';

/**
 * 상단 바 밀도 — **화면 폭 구간이 아니라 실제 남은 자리**로 접는다(2026-09-29 사람 요청 2차).
 *
 * 🔴 1차는 폭 구간(xl·2xl)으로 접었는데, 같은 창 폭이어도 브라우저 확대·사이드바 상태·칩 글자 길이(언어)에 따라
 *    자리가 모자라 칩 글자가 세로로 쪼개졌다(스크린샷 실측). 폭 구간은 "자리가 있는가"를 모른다.
 * 규칙: 상단 바를 실제로 재서, 검색칸이 최소 폭보다 좁아지거나 무엇이 넘치면 한 단계 더 접는다.
 *   0 전부 펼침 → 1 칩 설명 글자 숨김 → 2 언어·의료코드·화면번호를 ⚙ 로 → 3 역할 칩·이름 숨김(아이콘만)
 * 폭이 넓어지면 0 부터 다시 재어 필요한 만큼만 접는다(그리기 전에 끝나 깜빡이지 않는다).
 */
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export const TOPBAR_MAX_DENSITY = 3;
/** 검색칸이 이보다 좁아지면 "자리가 모자라다" — 검색 문구가 한두 글자로 잘리는 폭 */
export const TOPBAR_MIN_SEARCH_PX = 200;

const DensityContext = createContext(0);
export const TopBarDensityProvider = DensityContext.Provider;
/** 칩이 설명 글자를 그릴지 — 상단 바 밖(설정 화면 등)에서는 0(전부 펼침) */
export function useTopBarDensity(): number {
  return useContext(DensityContext);
}

/** 넘침 판정 — 순수 함수(재기 쉬운 값만 받는다) */
export function isCramped(m: { headerScroll: number; headerClient: number; searchVisible: boolean; searchWidth: number }): boolean {
  if (m.headerScroll > m.headerClient + 1) return true;
  return m.searchVisible && m.searchWidth < TOPBAR_MIN_SEARCH_PX;
}

export function useFitDensity(headerRef: RefObject<HTMLElement | null>, searchRef: RefObject<HTMLElement | null>): number {
  const [level, setLevel] = useState(0);
  const lastWidth = useRef(0);

  const cramped = useCallback(() => {
    const h = headerRef.current;
    if (!h) return false;
    const s = searchRef.current;
    const searchVisible = !!s && s.offsetParent !== null && getComputedStyle(s).display !== 'none';
    return isCramped({ headerScroll: h.scrollWidth, headerClient: h.clientWidth, searchVisible, searchWidth: s?.offsetWidth ?? 0 });
  }, [headerRef, searchRef]);

  // 그린 뒤·칠하기 전: 모자라면 한 단계 더 접는다(최대 3번 다시 그린다)
  useLayoutEffect(() => {
    if (level < TOPBAR_MAX_DENSITY && cramped()) setLevel((l) => Math.min(TOPBAR_MAX_DENSITY, l + 1));
  });

  useLayoutEffect(() => {
    const h = headerRef.current;
    if (!h || typeof ResizeObserver === 'undefined') return;
    lastWidth.current = h.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = h.clientWidth;
      if (w > lastWidth.current + 1) setLevel(0);          // 넓어짐 → 처음부터 다시 잰다
      else if (cramped()) setLevel((l) => Math.min(TOPBAR_MAX_DENSITY, l + 1)); // 좁아짐·내용 증가
      lastWidth.current = w;
    });
    ro.observe(h);
    // 칩 내용이 늦게 도착해 길어지는 경우(모드·워크스테이션 조회) — 자식 크기 변화도 본다
    for (const c of Array.from(h.children)) ro.observe(c);
    return () => ro.disconnect();
  }, [headerRef, cramped]);

  return level;
}
