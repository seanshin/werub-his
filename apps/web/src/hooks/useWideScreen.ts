'use client';

import { useEffect, useState } from 'react';

/**
 * 화면 폭 기준 충족 여부 — SSR 안전(서버·최초 렌더는 false).
 * CSS 만으로 처리할 수 없는 **구조 분기**(예: 목록을 두 덩어리로 쪼개 2열로 배치)에만 쓴다.
 * 순수 표현은 Tailwind 브레이크포인트로 처리할 것.
 */
export function useWideScreen(minWidth: number): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const q = window.matchMedia(`(min-width: ${minWidth}px)`);
    const update = () => setWide(q.matches);
    update();
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, [minWidth]);
  return wide;
}

/** 목록을 열 수만큼 **순서를 지키며** 앞뒤로 자른다(1열이면 그대로 한 덩어리) */
export function splitIntoColumns<T>(items: T[], columns: number): T[][] {
  if (columns <= 1 || items.length === 0) return [items];
  const per = Math.ceil(items.length / columns);
  return Array.from({ length: columns }, (_, i) => items.slice(i * per, (i + 1) * per)).filter((c) => c.length > 0);
}
