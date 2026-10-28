'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import ScoreTrendChart from '@/components/specialty/ScoreTrendChart';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';
// 세부과 컬럼·점수추이 정본은 `lib/specialty/internal-medicine-views` 하나다(대시보드와 공유).
import {
  IM_SUBSPECIALTY_VIEWS, imViewOf, imCellValue, imTrendSeries, type Subspecialty,
} from '@/lib/specialty/internal-medicine-views';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function InternalMedicineTab({ patientId }: { patientId: string }) {
  const [sub, setSub] = useState<Subspecialty>('CARDIOLOGY');
  const currentDef = imViewOf(sub);

  /* ── Exam data ── */
  const { data: examData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['im-exams', patientId, sub],
    queryFn: () =>
      apiClient
        .get<{ data: Record<string, unknown>[] }>(`/api/v1/internal-medicine/exams/${patientId}`, { subspecialty: sub as string }),
    enabled: !!patientId,
  });

  const items: Record<string, unknown>[] = (() => {
    const r = examData?.data;
    return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? [];
  })();

  /* ── Score trend ── */
  // BE score-trend 는 점수필드+examinedAt 의 flat 배열(시리즈 그룹맵 아님)을 반환.
  // 종전엔 FE가 trendMap[표시명] 을 기대해 항상 빈배열 → 추이 차트가 전혀 안 뜨던 것을, scoreSeriesConfig.field 로 클라이언트 그룹화.
  const { data: trendData, isError: trendIsError, error: trendError, refetch: refetchTrend } = useQuery({
    queryKey: ['im-trend', patientId, sub],
    queryFn: () =>
      apiClient
        .get<{ data: Record<string, unknown>[] }>(`/api/v1/internal-medicine/score-trend/${patientId}`, { subspecialty: sub as string }),
    enabled: !!patientId,
  });

  const trendRows: Record<string, unknown>[] = (() => {
    const r = trendData?.data;
    return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? [];
  })();

  const trendSeries = useMemo(() => imTrendSeries(trendRows, currentDef), [trendRows, currentDef]);

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i}>
          <td colSpan={cols} className="px-4 py-3">
            <div className="h-4 bg-gray-100 rounded animate-pulse" />
          </td>
        </tr>
      ))}
    </>
  );

  return (
    <div className="space-y-4">
      {/* Subspecialty sub-tabs */}
      <div className="flex gap-1 bg-gray-100/80 p-1 rounded-xl overflow-x-auto">
        {IM_SUBSPECIALTY_VIEWS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSub(s.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
              sub === s.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Score trend chart */}
      {trendIsError ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">{currentDef.label} 점수 추이</h3>
          <QueryErrorFallback error={trendError} onRetry={() => refetchTrend()} size="compact" />
        </div>
      ) : trendSeries.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">{currentDef.label} 점수 추이</h3>
          <ScoreTrendChart series={trendSeries} />
        </div>
      )}

      {/* Exam table with subspecialty-specific columns */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              {currentDef.columns.map((col) => (
                <th key={col.key} className="px-4 py-3 text-left text-xs font-medium text-gray-500">
                  {col.label}
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
            </tr>
          </thead>
          <tbody>
            {isError ? (
              <tr>
                <td colSpan={currentDef.columns.length + 2} className="py-6">
                  <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
                </td>
              </tr>
            ) : isLoading ? (
              <LoadingRows cols={currentDef.columns.length + 2} />
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={currentDef.columns.length + 2} className="py-12 text-center text-gray-400">
                  {currentDef.label} 기록 없음
                </td>
              </tr>
            ) : (
              items.map((ex) => (
                <tr key={ex.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                  {currentDef.columns.map((col) => (
                    <td key={col.key} className="px-4 py-3 text-xs text-gray-700">
                      {imCellValue(ex, col)}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-xs text-gray-700 max-w-[200px] truncate">
                    {(ex.diagnosis as string) ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {ex.examinedAt ? kdate(ex.examinedAt as string) : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
