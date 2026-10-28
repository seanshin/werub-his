'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

const FITZPATRICK_LABEL: Record<string, string> = {
  I: 'I (매우 밝음)', II: 'II (밝음)', III: 'III (보통)', IV: 'IV (올리브)', V: 'V (갈색)', VI: 'VI (어두움)',
};
// fitzpatrickType 은 Int(1~6) — roman 키로 매핑(미매핑이면 raw 숫자만 노출되던 것 교정)
const FITZ_ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const fmtFitzpatrick = (v: unknown): string => {
  if (v == null) return '-';
  const roman = typeof v === 'number' ? FITZ_ROMAN[v] : String(v);
  return FITZPATRICK_LABEL[roman] ?? String(v);
};

export function PlasticTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['plastic-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/plastic/exams/${patientId}`),
    enabled: !!patientId,
  });

  const items: Record<string, unknown>[] = (() => {
    const r = data?.data;
    return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? [];
  })();

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부위" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시술명" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="재료" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Fitzpatrick</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="소요시간" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
            </tr>
          </thead>
          <tbody>
            {/* 🔴 '기록 없음'과 '못 불러옴'은 다른 사실이다 — 에러를 먼저 판정한다 */}
            {isError ? (
              <tr><td colSpan={6} className="py-8"><QueryErrorFallback error={error} onRetry={refetch} size="compact" /></td></tr>
            ) : isLoading ? <LoadingRows cols={6} />
            : items.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="기록 없음" /></td></tr>
            : items.map((it) => (
              <tr key={it.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-xs font-bold text-gray-900">{(it.bodyPart as string) ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{(it.procedure as string) ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{(it.material as string) ?? '-'}</td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 whitespace-nowrap">
                    {fmtFitzpatrick(it.fitzpatrickType)}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-700">{it.duration != null ? `${it.duration}분` : '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{it.examinedAt ? kdate(it.examinedAt as string) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
