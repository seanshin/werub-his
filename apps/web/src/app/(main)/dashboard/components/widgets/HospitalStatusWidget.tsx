'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { T, Tf } from '@/components/ui/i18n-text';
import { alertComposition, criticalActions, fmtInt } from '@/app/(main)/command-center/command-center-view';
import { canSeeCommandCenter } from '@/app/(main)/command-center/journey-access';
import { useAuthStore } from '@/stores/auth-store';

type Section = { ok: boolean; summary?: Record<string, unknown>; error?: string };
type Summary = { sections: Record<string, Section>; kpi?: { alertsUnavailable?: string[] }; generatedAt: string };

/**
 * 병원 상황 요약(2026-10-02 · 상황판↔대시보드 역할 분리).
 *
 * 대시보드는 "**내가** 지금 처리할 것", 상황판은 "**병원이** 지금 어떤 상태인가"다.
 * 🔴 종전 대시보드는 병원 전체 위젯(응급·ICU·감염·QI·병상·관리자 패널)을 **자기 데이터로 따로** 그렸다 —
 *    상황판과 같은 사실에 정본이 둘이었다(P12). 이 위젯은 상황판과 **같은 응답·같은 판정 함수**(criticalActions)만 쓴다.
 *    쿼리 키도 상황판과 같아 캐시를 함께 쓴다.
 */
export default function HospitalStatusWidget() {
  // 레지스트리 roles 가 이미 걸러 주지만, 저장된 배치·역할 변경으로 들어와도 403 을 부르지 않는다(위젯 스스로도 판정)
  const role = useAuthStore((st) => st.user?.role);
  const allowed = canSeeCommandCenter(role);
  const q = useQuery({
    enabled: allowed,
    queryKey: ['command-center-summary'],
    queryFn: () => apiClient.get<{ data: Summary }>('/api/v1/command-center/summary').then((r) => {
      const raw = r.data as unknown;
      return ((raw as { data?: Summary })?.data ?? (raw as Summary));
    }),
    refetchInterval: pollMs('normal'), retry: 1, staleTime: 5000,
  });

  if (!allowed) {
    return <p className="text-xs text-slate-500" data-hospital-status="gated"><T k="병원 전체 현황은 통합 상황판 권한이 있는 역할에게만 보입니다" /></p>;
  }
  if (q.isLoading) return <div className="h-16 animate-pulse rounded-lg bg-gray-100" />;
  if (q.isError || !q.data) {
    return (
      <div className="flex h-full flex-col gap-2" data-hospital-status="error">
        <p className="text-xs text-amber-700"><T k="병원 상황을 불러오지 못했습니다 — 이상 없음이 아니라 확인 불가입니다" /></p>
        <Link href="/command-center" className="mt-auto text-[11px] text-blue-600 hover:underline"><T k="통합 상황판 열기" /> →</Link>
      </div>
    );
  }

  const actions = criticalActions(q.data.sections ?? {});
  const comp = alertComposition(actions);
  const unavailable = q.data.kpi?.alertsUnavailable ?? [];
  return (
    <div className="flex h-full flex-col gap-2" data-hospital-status="ok">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        {comp.dangerKinds > 0 && (
          <span className="rounded-full bg-rose-600 px-2.5 py-0.5 font-semibold text-white" data-hs-danger>
            <Tf k="위험 {종}종 {건}건" params={{ 종: comp.dangerKinds, 건: fmtInt(comp.dangerCount) }} />
          </span>
        )}
        {comp.warnKinds > 0 && (
          <span className="rounded-full bg-amber-400 px-2.5 py-0.5 font-semibold text-amber-950">
            <Tf k="주의 {종}종 {건}건" params={{ 종: comp.warnKinds, 건: fmtInt(comp.warnCount) }} />
          </span>
        )}
        {actions.length === 0 && (
          // 🔴 "이상 없음"이라 하지 않는다 — 조치 기준에 걸린 항목이 없다는 것뿐
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-600"><T k="지금 조치 기준에 걸린 항목 없음" /></span>
        )}
        {unavailable.length > 0 && (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-700 ring-1 ring-amber-200" title={unavailable.join(', ')}><T k="부분 집계" /></span>
        )}
      </div>
      {actions.length > 0 && (
        <ul className="space-y-1 text-[12px]">
          {actions.slice(0, 3).map((a) => (
            <li key={a.key}>
              <Link href={a.href} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-slate-50">
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.tone === 'danger' ? 'bg-rose-500' : 'bg-amber-400'}`} />
                  <T k={a.label} />
                </span>
                <span className={`shrink-0 font-semibold tabular-nums ${a.tone === 'danger' ? 'text-rose-600' : 'text-amber-600'}`}>{fmtInt(a.count)}</span>
              </Link>
            </li>
          ))}
          {actions.length > 3 && <li className="px-1.5 text-[11px] text-slate-400"><Tf k="외 {n}종" params={{ n: actions.length - 3 }} /></li>}
        </ul>
      )}
      <Link href="/command-center" className="mt-auto text-[11px] font-medium text-blue-600 hover:underline" data-hs-link>
        <T k="병원 전체는 통합 상황판에서" /> →
      </Link>
    </div>
  );
}
