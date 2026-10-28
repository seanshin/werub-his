'use client';

// BoardMasonry — 순서 보존 최단-컬럼 배치(마소너리).
// 배경: CSS grid는 행 기반이라 한 행에 긴 패널이 있으면 짧은/접힌 패널 아래로 큰 구멍이 생김
// (빈 패널 자동 축소·수동 접기와 결합 시 특히 심함 — 2026-07-07 레이아웃 언밸런스 리포트).
// 설계:
//  - 각 아이템을 ResizeObserver로 실측 → 문서 순서대로 "가장 짧은 컬럼"에 배치(동률=앞 컬럼 → 첫 행은 좌→우 유지)
//  - absolute 포지셔닝이라 재배치 시 DOM 부모가 바뀌지 않음 → 패널 remount 없음(접기 상태·쿼리 캐시 보존)
//  - 첫 실측 전 1프레임은 useLayoutEffect로 페인트 전에 배치 확정(깜빡임 없음)
//  - 접기/펼치기·데이터 로드로 높이가 바뀌면 자동 재배치(top/left 트랜지션으로 부드럽게)

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const GAP = 16; // BOARD_GRID_CLASS gap-4와 동일

interface Item { key: string; node: ReactNode }
interface Pos { top: number; col: number }

export function BoardMasonry({ items, columnCount, className }: { items: Item[]; columnCount: number; className?: string }) {
  const itemRefs = useRef(new Map<string, HTMLDivElement | null>());
  const [positions, setPositions] = useState<Map<string, Pos>>(new Map());
  const [containerH, setContainerH] = useState(0);
  const [measured, setMeasured] = useState(false);
  const rafRef = useRef(0);

  const reflow = () => {
    const colHeights = Array.from({ length: Math.max(1, columnCount) }, () => 0);
    const next = new Map<string, Pos>();
    for (const { key } of items) {
      const el = itemRefs.current.get(key);
      const h = el?.offsetHeight ?? 300; // 미측정 폴백(측정 즉시 교정됨)
      let col = 0;
      for (let i = 1; i < colHeights.length; i++) if (colHeights[i] < colHeights[col]) col = i;
      next.set(key, { top: colHeights[col], col });
      colHeights[col] += h + GAP;
    }
    setPositions(next);
    setContainerH(Math.max(0, Math.max(...colHeights) - GAP));
    setMeasured(true);
  };

  const scheduleReflow = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(reflow);
  };

  // 첫 배치는 페인트 전(레이아웃 이펙트) — 이후 높이 변화는 ResizeObserver가 담당
  useLayoutEffect(() => {
    reflow();
    const ro = new ResizeObserver(scheduleReflow);
    for (const el of itemRefs.current.values()) if (el) ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => i.key).join('|'), columnCount]);

  const n = Math.max(1, columnCount);
  const width = `calc((100% - ${(n - 1) * GAP}px) / ${n})`;

  return (
    <div className={`relative ${className ?? ''}`} style={{ height: containerH || undefined }}>
      {items.map(({ key, node }) => {
        const pos = positions.get(key);
        return (
          <div
            key={key}
            ref={(el) => { itemRefs.current.set(key, el); }}
            className="absolute transition-[top,left] duration-200"
            style={{
              width,
              top: pos?.top ?? 0,
              left: pos ? `calc((100% - ${(n - 1) * GAP}px) / ${n} * ${pos.col} + ${pos.col * GAP}px)` : 0,
              visibility: measured ? 'visible' : 'hidden', // 첫 실측 전 겹침 노출 방지(페인트 전 1회)
            }}
          >
            {node}
          </div>
        );
      })}
    </div>
  );
}

/** BOARD 반응형 컬럼 수(§4·D8과 동일 브레이크포인트): xl→2, 2xl→3, ≥2560px→4 */
export function useBoardColumnCount(): number {
  const [count, setCount] = useState(2); // board는 <xl 미적용(page.tsx 가드)이라 2가 안전 초기값
  useLayoutEffect(() => {
    const queries: [MediaQueryList, number][] = [
      [window.matchMedia('(min-width: 2560px)'), 4],
      [window.matchMedia('(min-width: 1536px)'), 3],
      [window.matchMedia('(min-width: 1280px)'), 2],
    ];
    const update = () => setCount(queries.find(([q]) => q.matches)?.[1] ?? 1);
    update();
    for (const [q] of queries) q.addEventListener('change', update);
    return () => { for (const [q] of queries) q.removeEventListener('change', update); };
  }, []);
  return count;
}
