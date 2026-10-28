'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Duration, EmptyState } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { SpecimenCollectionControl } from './SpecimenCollectionControl';

interface PendingItem {
  orderId: string;
  priority: string;
  orderedAt: string;
  waitingMin: number;
  testName: string | null;
  testCode: string | null;
  patient: { id: string; mrn: string; familyName: string; givenName: string } | null;
  ward: { id: string; name: string } | null;
  room: string | null;
}

/**
 * 병동 채혈 대기(2026-10-01) — 재원 환자의 검사 오더 중 아직 채취도 접수도 안 된 것.
 * 🔴 종전엔 병동 간호사가 볼 검사 오더 목록이 없었다(검사실 큐뿐) — 채취를 남길 자리가 없어, 검사실 접수 순간이 채취로 기록됐다.
 * 채취하며 [지금 채취] · 이미 채취했으면 [시각 입력](입력된 시각으로 남는다). 기록되면 목록에서 빠진다(줄어드는 목록).
 */
export function WardSpecimenPendingPanel() {
  const tAttr = useTAttr();
  const [ward, setWard] = useState<string>('ALL');
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ward-specimen-pending'],
    queryFn: () => apiClient.get<{ data: PendingItem[]; meta?: { truncated?: boolean; limit?: number } }>('/api/v1/workstation/specimen-collection/pending'),
    refetchInterval: 30_000,
  });
  const items = data?.data ?? [];
  const wards = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) if (i.ward) m.set(i.ward.id, i.ward.name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);
  const shown = ward === 'ALL' ? items : items.filter((i) => i.ward?.id === ward);

  return (
    <section className="rounded-2xl border border-rose-100 bg-white p-4" aria-label={tAttr('병동 채혈 대기')} data-ward-specimen-pending>
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-900">🩸 <T k="병동 채혈 대기" /> {!isLoading && !isError && <span className="font-normal text-gray-400">({items.length})</span>}</h2>
        <span className="text-[11px] text-gray-500"><T k="재원 환자의 접수 전 검사 — 채취한 순간을 남깁니다(검사실 접수와 다른 시각)" /></span>
        {wards.length > 1 && (
          <select value={ward} onChange={(e) => setWard(e.target.value)} aria-label={tAttr('병동')} className="ml-auto min-h-[32px] rounded-lg border border-gray-200 px-2 text-xs">
            <option value="ALL">{tAttr('전체 병동')}</option>
            {wards.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
      </header>
      {isLoading ? (
        <div className="space-y-2" aria-busy="true">{[0, 1].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100" />)}</div>
      ) : isError ? (
        <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
      ) : shown.length === 0 ? (
        <EmptyState compact icon="✅" title="채취를 기다리는 검사 오더가 없습니다" />
      ) : (
        <ol className="divide-y divide-gray-50">
          {shown.map((i) => (
            <li key={i.orderId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              {i.priority === 'STAT' && <span className="rounded bg-rose-600 px-1.5 text-[10px] font-semibold text-white">STAT</span>}
              <span className="min-w-[140px]">
                <span className="text-sm font-medium text-gray-900">{i.patient ? `${i.patient.familyName}${i.patient.givenName}` : '-'}</span>
                <span className="ml-1 text-[11px] text-gray-400">{i.patient?.mrn}</span>
                <span className="block text-[11px] text-gray-500">{[i.ward?.name, i.room].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="min-w-[120px] text-sm text-gray-700">{i.testName ?? i.testCode ?? <T k="이름 없음" />}</span>
              <span className="text-[11px] text-gray-500"><T k="오더 후" /> <Duration minutes={i.waitingMin} /></span>
              <span className="ml-auto">
                <SpecimenCollectionControl orderId={i.orderId} compact invalidateKeys={[['ward-specimen-pending'], ['ws-lab-queue']]} />
              </span>
            </li>
          ))}
        </ol>
      )}
      {data?.meta?.truncated && (
        <p className="mt-2 text-[11px] text-amber-700"><Tf k="오래된 순 {수}건만 표시합니다" params={{ 수: data.meta.limit ?? items.length }} /></p>
      )}
    </section>
  );
}
