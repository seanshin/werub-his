'use client';

import { useEffect, useState } from 'react';
import { localeTimeText } from '@hospital-run/shared';

/**
 * 전광판 갱신 신선도 표시 — 🔴 **전광판은 사람이 리로드하지 않는다**(W9).
 *
 * 네 보드(외래 진료실·ER 흐름·구형 호출·검진) 전부 SSE/폴링이 끊겨도 **마지막에 받은 목록을 그대로 띄운 채
 * 시계만 1초마다 살아 움직였다.** 대기실에서 보면 완벽히 최신 화면이다 — 실제로는 몇 시간 전 대기열일 수 있다.
 * 호출 배너가 안 뜨는 것과 "호출이 없는 것"이 화면에서 같아 보이는 상태(P17: 근거 없이 안심시킴).
 *
 * 이 부품은 **자료를 실제로 받은 시각**만 말한다(현재 시각이 아니라). 임계를 넘기면 경고로 바뀐다.
 * 문구는 계약 테스트가 **정확 비교**로 고정한다 — 부분 문자열 단언은 깨진 출력을 숨긴다.
 */

/** 표시 문구 정본 — 컴포넌트와 테스트가 같은 함수를 본다(로컬 재구현 금지) */
export function freshnessText(updatedAt: number | null, now: number, staleAfterSec: number): string {
  if (updatedAt == null) return '자료를 아직 받지 못했습니다';
  const sec = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (sec > staleAfterSec) {
    const t = localeTimeText(new Date(updatedAt), 'ko-KR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    return `⚠ 갱신 멈춤 · 마지막 ${t}`;
  }
  if (sec <= 3) return '방금 갱신';
  return `갱신 ${sec}초 전`;
}

export function isStale(updatedAt: number | null, now: number, staleAfterSec: number): boolean {
  if (updatedAt == null) return true;
  return Math.floor((now - updatedAt) / 1000) > staleAfterSec;
}

export function FreshnessBadge({ updatedAt, staleAfterSec, className = '' }: {
  /** 자료를 **받은** 시각(epoch ms). 렌더 시각이 아니다 — 이걸 헷갈리면 표시가 늘 '방금'이 된다 */
  updatedAt: number | null;
  staleAfterSec: number;
  className?: string;
}) {
  const [now, setNow] = useState<number | null>(null);
  // 서버 렌더와 첫 클라 렌더의 문구가 갈리지 않게(hydration) 마운트 후에만 시각을 읽는다
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const stale = now == null ? updatedAt == null : isStale(updatedAt, now, staleAfterSec);
  const text = now == null
    ? (updatedAt == null ? '자료를 아직 받지 못했습니다' : '방금 갱신')
    : freshnessText(updatedAt, now, staleAfterSec);

  return (
    <span
      data-testid="freshness"
      className={`${stale ? 'text-amber-300 font-bold' : 'text-gray-500'} ${className}`}
    >
      {text}
    </span>
  );
}
