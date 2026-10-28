'use client';
import { useEffect, useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { freshnessRelative } from '@hospital-run/shared';
import { T, Tf } from '@/components/ui/i18n-text';

/**
 * 데이터 신선도 배지 — TanStack Query의 dataUpdatedAt(ms) 기준 상대시각 + 신선도 색.
 * 🟢 신선(<staleMs) · 🟡 지연(<2×staleMs) · 🔴 오래됨/오류. 폴링 보드의 신뢰성 표시.
 */
export function FreshnessBadge({ updatedAt, isFetching, isError, staleMs = 35000, label = '갱신' }: {
  updatedAt?: number; isFetching?: boolean; isError?: boolean; staleMs?: number; label?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  if (!updatedAt && !isError) return null;
  const age = updatedAt ? now - updatedAt : Infinity;
  const tone = isError || age > staleMs * 2 ? { dot: 'bg-rose-500', text: 'text-rose-600' }
    : age > staleMs ? { dot: 'bg-amber-400', text: 'text-amber-600' }
    : { dot: 'bg-emerald-500', text: 'text-emerald-600' };

  /**
   * 🔴 종전엔 템플릿 리터럴로 조립해 **화면 언어를 바꿔도 `갱신 23초 전` 이 한국어로 남았다**
   *    (2026-09-10 운영 실측 · 한 화면에 8곳). 숫자와 단위의 순서·띄어쓰기가 언어마다 달라
   *    조각으로는 배선할 수 없어서, 임계값은 shared 정본이 정하고 표시는 자리표시자로 담는다.
   */
  const rel = freshnessRelative(age);

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" title={updatedAt ? kdate(updatedAt, 'datetimeSec') : ''}>
      <span className={`relative flex h-2 w-2`}>
        {isFetching && !isError && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${tone.dot} opacity-60`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${tone.dot}`} />
      </span>
      <span className={tone.text}>
        <T k={label} />{' '}
        {isError ? <T k="오류" /> : <Tf k={rel.key} params={rel.params} />}
      </span>
    </span>
  );
}
