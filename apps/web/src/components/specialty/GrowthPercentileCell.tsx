'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 성장 백분위 칸(2026-10-10).
 * 🔴 서버는 백분위를 기준표로 계산한 적이 없다 — 저장된 값은 과거 입력·시드 값이다(`percentileBasis: 'UNVERIFIED'`).
 *    그래서 ① 경보 색(<3·>97 빨강)을 칠하지 않고 ② '입력값' 표식과 출처 미확인을 함께 말한다.
 *    기준표(LMS)가 등록되고 서버가 계산하면 basis 가 바뀐다 — 그때 판정 색을 다시 검토한다.
 */
export function GrowthPercentileCell({ value, basis }: { value: unknown; basis: unknown }) {
  const tAttr = useTAttr();
  if (value == null || value === '') return <span className="text-xs text-gray-400">-</span>;
  const unverified = basis !== 'COMPUTED';
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 whitespace-nowrap"
      data-percentile-basis={unverified ? 'UNVERIFIED' : 'COMPUTED'}
      title={unverified ? tAttr('기준표로 계산한 값이 아닙니다(출처 미확인) — 판정에 쓰지 마세요') : undefined}
    >
      {`${Number(value)}%`}
      {unverified && <span className="text-[9px] text-amber-700"><T k="입력값" /></span>}
    </span>
  );
}
