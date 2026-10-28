'use client';
import { useEffect, useState } from 'react';

/** 넓은 화면(관제 모니터) 판정 — 서버 렌더·첫 그림은 좁은 화면으로 시작한다(넓을 때만 추가 조회를 건다) */
export function useWide(minPx = 1536): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(`(min-width: ${minPx}px)`);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [minPx]);
  return wide;
}
