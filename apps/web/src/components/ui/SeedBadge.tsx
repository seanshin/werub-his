'use client';

import { isSeedUuid } from '@hospital-run/shared';
import { useHisMode } from '@/lib/his-mode';

/**
 * 시드(가상) 데이터 배지 — 리허설·개발 모드에서만 붙는다.
 *
 * 🔴 **이 배지는 "없으면 실데이터"라는 뜻이 아니다.** 시드 표식은 넷인데(결정적 UUID 접두 ·
 *    해시 UUID · 컬럼 · 시각 군집) 여기서 판정하는 것은 **접두 하나뿐**이다.
 *    2026-08-25 시드 흐름 검토에서 간호 기록 표본이 73%→99.3% 로 뒤집힌 것이 바로
 *    해시 UUID 를 못 세서였다 — 그래서 배지의 title 에 그 한계를 적는다.
 *
 * 🔴 리얼 모드에서는 아무것도 그리지 않는다(리얼에는 시드가 없어야 한다).
 */
export function SeedBadge({ id, className = '' }: { id: unknown; className?: string }) {
  const { showSeedBadge } = useHisMode();
  if (!showSeedBadge || !isSeedUuid(id)) return null;
  return (
    <span
      title="시드(가상) 데이터 — 결정적 UUID 접두로 판정. 배지가 없다고 실데이터라는 뜻은 아니다(해시형 시드는 이 판정으로 잡히지 않는다)."
      className={`inline-flex items-center rounded bg-violet-50 px-1.5 py-0.5 align-middle text-[9px] font-bold text-violet-600 ${className}`}
    >
      시드
    </span>
  );
}
