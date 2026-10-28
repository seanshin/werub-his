'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * 드롭다운이 **컨테이너 밖으로 나가 잘리지 않게** 여는 방향을 정한다.
 *
 * 🔴 발단(2026-08-26 사람 신고): 차트 헤더의 `🎤 음성 ▾` 메뉴가 `absolute right-0 w-[248px]` 라
 *    **왼쪽으로 248px 뻗었고**, 본문 `<main className="… overflow-x-hidden">` 에 **잘려** 나갔다.
 *    사용자에게는 "사이드바가 메뉴를 덮은 것"으로 보였지만 실제로는 **본문이 잘라낸 것**이었다.
 *
 * 🔴 같은 형태가 5곳에 있었다(음성 허브·VoiceEMR·SMART 런처·알림·워크스테이션) —
 *    **한 곳만 고치면 갈라진다.** 여는 방향 판정은 여기 하나뿐이다.
 *
 * 판정: 기본은 오른쪽 정렬(`right-0`). 그렇게 열면 컨테이너 왼쪽을 넘고, 반대로 열었을 때는
 * 넘지 않는 경우에만 왼쪽 정렬로 뒤집는다. 🔴 **양쪽 다 넘으면 뒤집지 않는다** —
 * 뒤집어도 잘리는데 방향만 바꾸면 사람이 원인을 더 못 찾는다.
 */
export type EdgeAlign = 'left' | 'right';

/** 가장자리 여유(px) — 그림자·테두리가 붙는 만큼 */
const EDGE_GAP = 8;

export function useEdgeSafeAlign(
  open: boolean,
  width: number,
  anchorRef: RefObject<HTMLElement | null>,
): { align: EdgeAlign; alignClass: string } {
  const [align, setAlign] = useState<EdgeAlign>('right');

  useLayoutEffect(() => {
    if (!open) return;
    const el = anchorRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    // 잘라내는 주체는 스크롤 컨테이너다. 본문(main)이 있으면 그것, 없으면 뷰포트.
    const container = el.closest('main');
    const bounds = container
      ? container.getBoundingClientRect()
      : ({ left: 0, right: window.innerWidth } as DOMRect);

    const overflowsLeftIfRightAligned = rect.right - width < bounds.left + EDGE_GAP;
    const overflowsRightIfLeftAligned = rect.left + width > bounds.right - EDGE_GAP;

    // 🔴 뒤집어도 잘리면 뒤집지 않는다(원인 추적을 흐리지 않는다)
    setAlign(overflowsLeftIfRightAligned && !overflowsRightIfLeftAligned ? 'left' : 'right');
  }, [open, width, anchorRef]);

  return { align, alignClass: align === 'right' ? 'right-0' : 'left-0' };
}
