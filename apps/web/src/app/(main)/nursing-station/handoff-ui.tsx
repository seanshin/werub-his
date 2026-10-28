'use client';

import { handoffIllnessOf, HANDOFF_ILLNESS_LABEL, type HandoffIllness } from '@hospital-run/shared';
import { T, Data, useTAttr } from '@/components/ui/i18n-text';

/** 중증도 색 — 띠(strip)·배지 두 자리에서 쓴다 */
export const ILLNESS_TONE: Record<HandoffIllness, { badge: string; strip: string }> = {
  CRITICAL: { badge: 'bg-rose-100 text-rose-700 ring-rose-200', strip: 'bg-rose-500' },
  UNSTABLE: { badge: 'bg-amber-100 text-amber-800 ring-amber-200', strip: 'bg-amber-400' },
  STABLE: { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', strip: 'bg-emerald-400' },
};
const UNKNOWN_STRIP = 'bg-gray-300';

export function illnessStrip(v: unknown): string {
  const iv = handoffIllnessOf(v);
  return iv.code ? ILLNESS_TONE[iv.code].strip : UNKNOWN_STRIP;
}

/**
 * 중증도 배지 — 🔴 비어 있으면 '안정'이 아니라 "중증도 미기재", 어휘 밖이면 **원문 그대로 + 어휘 밖**.
 *    (인수인계 화면이 시드의 '위중'을 "미기재"로 그려 적힌 값을 없다고 말했다)
 */
export function IllnessBadge({ value, size = 'sm' }: { value: unknown; size?: 'xs' | 'sm' }) {
  const tAttr = useTAttr();
  const iv = handoffIllnessOf(value);
  const pad = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]';
  if (iv.code) {
    return <span className={`inline-flex items-center gap-1 rounded-full font-semibold ring-1 ring-inset whitespace-nowrap ${pad} ${ILLNESS_TONE[iv.code].badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ILLNESS_TONE[iv.code].strip}`} aria-hidden="true" />
      <T k={HANDOFF_ILLNESS_LABEL[iv.code]} />
    </span>;
  }
  if (iv.offVocab) {
    return <span className={`inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200 whitespace-nowrap ${pad}`} title={tAttr('정해진 중증도 어휘(안정·불안정·위급) 밖의 저장값 — 적힌 그대로 보입니다')}>
      <Data>{iv.raw}</Data><span className="text-gray-400">· <T k="어휘 밖" /></span>
    </span>;
  }
  return <span className={`inline-flex items-center rounded-full bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200 whitespace-nowrap ${pad}`}><T k="중증도 미기재" /></span>;
}
