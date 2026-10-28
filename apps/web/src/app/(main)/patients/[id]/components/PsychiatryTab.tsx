'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

const RISK_COLOR: Record<string, string> = {
  LOW: 'bg-emerald-100 text-emerald-700',
  MODERATE: 'bg-amber-100 text-amber-700',
  HIGH: 'bg-red-100 text-red-700',
};
const RISK_LABEL: Record<string, string> = { LOW: '낮음', MODERATE: '중등', HIGH: '높음' };

export function PsychiatryTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['psychiatry-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/psychiatry/exams/${patientId}`),
    enabled: !!patientId,
  });

  const items: Record<string, unknown>[] = (() => {
    const r = data?.data;
    return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? [];
  })();

  const latest = useMemo(() => items[0] as Record<string, unknown> | undefined, [items]);

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  return (
    <div className="space-y-4">
      {/* 최근 MSE 요약 */}
      {latest && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3"><T k="최근 MSE 요약" /></h3>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <p className="text-gray-500"><T k="기분" /></p>
              <p className="font-medium text-gray-900">{(latest.mood as string) ?? '-'}</p>
            </div>
            <div>
              <p className="text-gray-500"><T k="정동" /></p>
              <p className="font-medium text-gray-900">{(latest.affect as string) ?? '-'}</p>
            </div>
            <div>
              <p className="text-gray-500"><T k="사고" /></p>
              <p className="font-medium text-gray-900">{(latest.thoughtProcess as string) ?? '-'}</p>
            </div>
          </div>
        </div>
      )}

      {/* 점수 카드 */}
      {latest && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
            <p className="text-[10px] text-gray-500">PHQ-9</p>
            <p className="text-2xl font-bold text-blue-600">{latest.phq9 != null ? `${latest.phq9}` : '-'}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
            <p className="text-[10px] text-gray-500">GAD-7</p>
            <p className="text-2xl font-bold text-violet-600">{latest.gad7 != null ? `${latest.gad7}` : '-'}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
            <p className="text-[10px] text-gray-500">자살위험</p>
            <span className={`text-sm font-bold px-3 py-1 rounded-full whitespace-nowrap ${RISK_COLOR[latest.suicideRisk as string] ?? 'bg-gray-100 text-gray-600'}`}>
              {RISK_LABEL[latest.suicideRisk as string] ?? (latest.suicideRisk as string) ?? '-'}
            </span>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="기분" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="정동" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="사고" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">PHQ-9</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">GAD-7</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">자살위험</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
            </tr>
          </thead>
          <tbody>
            {/* 🔴 '기록 없음'과 '못 불러옴'은 다른 사실이다 — 에러를 먼저 판정한다 */}
            {isError ? (
              <tr><td colSpan={7} className="py-8"><QueryErrorFallback error={error} onRetry={refetch} size="compact" /></td></tr>
            ) : isLoading ? <LoadingRows cols={7} />
            : items.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="기록 없음" /></td></tr>
            : items.map((it) => (
              <tr key={it.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-xs text-gray-700">{(it.mood as string) ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{(it.affect as string) ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-700 max-w-[150px] truncate">{(it.thoughtProcess as string) ?? '-'}</td>
                <td className="px-4 py-3 text-xs font-bold text-gray-900">{it.phq9 != null ? `${it.phq9}` : '-'}</td>
                <td className="px-4 py-3 text-xs font-bold text-gray-900">{it.gad7 != null ? `${it.gad7}` : '-'}</td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${RISK_COLOR[it.suicideRisk as string] ?? 'bg-gray-100'}`}>
                    {RISK_LABEL[it.suicideRisk as string] ?? (it.suicideRisk as string) ?? '-'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{it.examinedAt ? kdate(it.examinedAt as string) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
