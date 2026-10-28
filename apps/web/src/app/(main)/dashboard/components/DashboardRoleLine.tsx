'use client';
import Link from 'next/link';
import { T } from '@/components/ui/i18n-text';
import { canSeeCommandCenter, canSeeExecutive } from '@/app/(main)/command-center/journey-access';

/**
 * 대시보드 머리의 역할 한 줄(2026-10-02 · 상황판↔대시보드 역할 분리).
 * 대시보드 = **내 업무**. 병원 전체·경영은 그 정본 화면으로 — 못 여는 역할에겐 길을 내지 않는다.
 */
export function DashboardRoleLine({ role }: { role?: string | null }) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-white/70" data-dashboard-role>
      <span className="font-semibold text-white/90"><T k="내 업무" /></span>
      {canSeeCommandCenter(role) && (
        <Link href="/command-center" className="underline-offset-2 hover:text-white hover:underline"><T k="병원 전체는 통합 상황판" /> →</Link>
      )}
      {canSeeExecutive(role) && (
        <Link href="/executive" className="underline-offset-2 hover:text-white hover:underline"><T k="추이·경영은 경영 대시보드" /> →</Link>
      )}
    </p>
  );
}
