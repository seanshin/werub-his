'use client';

import { T, Tf } from '@/components/ui/i18n-text';
import type { VitalsRuleState } from '@/lib/vital-flags';

/**
 * 활력 이상 표시 기준의 출처 — 색의 뜻(위급/주의)과 함께 한 줄로(2026-10-01 · 화면 공용).
 * 로딩 중은 말하지 않는다 · 확인 불가는 "코드 기본값으로 표시"라고 밝힌다 · 버려진 개정 키를 숨기지 않는다.
 */
export function VitalsRuleNote({ rule, className = '' }: { rule?: Pick<VitalsRuleState, 'source' | 'droppedKeys' | 'invertedKeys' | 'state'> | null; className?: string }) {
  if (!rule || rule.state === 'loading') return null;
  const dropped = [...(rule.droppedKeys ?? []), ...(rule.invertedKeys ?? [])];
  return (
    <p className={`text-[10px] text-gray-500 ${className}`}>
      <span className="text-red-600 font-bold">■</span> <T k="위급" /> · <span className="text-amber-700 font-bold">■</span> <T k="주의" /> —{' '}
      {rule.state === 'error'
        ? <T k="이상 표시 기준을 확인하지 못했습니다 — 코드 기본값으로 표시합니다" />
        : rule.source === 'CONFIGURED' ? <T k="이상 표시 기준: 환자안전위 개정 반영" /> : <T k="이상 표시 기준: 코드 기본값(원내 개정 없음)" />}
      {dropped.length > 0 && <span className="ml-1 text-rose-700"><Tf k="· 적용되지 않은 개정 항목: {항목}" params={{ 항목: dropped.join(', ') }} /></span>}
    </p>
  );
}
