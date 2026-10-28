'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

const TYPE_LABEL: Record<string, string> = { PRENATAL: '산전', GYNECOLOGY: '부인과', LABOR: '분만', POSTPARTUM: '산후' };
const TYPE_COLOR: Record<string, string> = {
  PRENATAL: 'bg-pink-100 text-pink-700',
  GYNECOLOGY: 'bg-violet-100 text-violet-700',
  LABOR: 'bg-rose-100 text-rose-700',
  POSTPARTUM: 'bg-amber-100 text-amber-700',
};

type ObGynSubTab = 'all' | 'prenatal' | 'gynecology';

/** 임신주수 문자열("28W3D")에서 주(week) 숫자만 파싱. 차트 정렬·표시용. */
function parseWeeks(ga: unknown): number {
  if (ga == null) return NaN;
  const n = parseInt(String(ga), 10);
  return Number.isNaN(n) ? NaN : n;
}

export function ObGynTab({ patientId }: { patientId: string }) {
  const [tab, setTab] = useState<ObGynSubTab>('all');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['obgyn-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/obgyn/exams/${patientId}`),
    enabled: !!patientId,
  });

  const allItems: Record<string, unknown>[] = (() => {
    const r = data?.data;
    return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? [];
  })();

  const prenatalItems = useMemo(() => allItems.filter(it => (it.examType as string) === 'PRENATAL'), [allItems]);
  const gynItems = useMemo(() => allItems.filter(it => (it.examType as string) === 'GYNECOLOGY'), [allItems]);
  const postnatalItems = useMemo(() => allItems.filter(it => (it.examType as string) === 'POSTPARTUM'), [allItems]);

  const items = tab === 'prenatal' ? prenatalItems : tab === 'gynecology' ? gynItems : allItems;

  // Pregnancy timeline (prenatal items sorted by gestational weeks)
  const pregnancyTimeline = useMemo(() => {
    return prenatalItems
      .filter(it => it.gestationalAge != null)
      .sort((a, b) => parseWeeks(a.gestationalAge) - parseWeeks(b.gestationalAge));
  }, [prenatalItems]);

  // Weight trend
  const weightTrend = useMemo(() => {
    return prenatalItems
      .filter(it => it.currentWeight != null && it.examinedAt)
      .sort((a, b) => new Date(a.examinedAt as string).getTime() - new Date(b.examinedAt as string).getTime())
      .map(it => ({ date: (it.examinedAt as string)?.slice(5, 10), weight: Number(it.currentWeight), weeks: parseWeeks(it.gestationalAge) || 0 }));
  }, [prenatalItems]);

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-pink-600">{prenatalItems.length}</div>
          <div className="text-[10px] text-gray-500"><T k="산전 검사" /></div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-violet-600">{gynItems.length}</div>
          <div className="text-[10px] text-gray-500"><T k="부인과 검사" /></div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-amber-600">{postnatalItems.length}</div>
          <div className="text-[10px] text-gray-500"><T k="산후 관리" /></div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-gray-900">{pregnancyTimeline.length > 0 ? `${pregnancyTimeline[pregnancyTimeline.length - 1].gestationalAge}` : '-'}</div>
          <div className="text-[10px] text-gray-500"><T k="최근 주수" /></div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1.5">
        {([
          { k: 'all' as const, l: `전체 (${allItems.length})` },
          { k: 'prenatal' as const, l: `산전 (${prenatalItems.length})` },
          { k: 'gynecology' as const, l: `부인과 (${gynItems.length})` },
        ]).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              tab === t.k ? 'bg-pink-600 text-white border-pink-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}>{t.l}</button>
        ))}
      </div>

      {/* Pregnancy Weight Trend */}
      {weightTrend.length >= 2 && tab !== 'gynecology' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h3 className="text-xs font-semibold text-gray-700 mb-2"><T k="임신 중 체중 추이" /></h3>
          <div className="flex items-end gap-1 h-16">
            {weightTrend.map((w, i) => {
              const minW = Math.min(...weightTrend.map(wt => wt.weight));
              const maxW = Math.max(...weightTrend.map(wt => wt.weight));
              const range = maxW - minW || 1;
              return (
                <div key={i} className="flex-1 flex flex-col items-center">
                  <div className="bg-pink-300 rounded-t-sm w-full transition-all"
                    style={{ height: `${Math.max(8, ((w.weight - minW) / range) * 50)}px` }}
                    title={`${w.weeks}주: ${w.weight}kg`} />
                  <span className="text-[8px] text-gray-400 mt-0.5">{w.weeks}w</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pregnancy Timeline */}
      {pregnancyTimeline.length > 0 && tab === 'prenatal' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h3 className="text-xs font-semibold text-gray-700 mb-3"><T k="산전 검진 타임라인" /></h3>
          <div className="flex items-center gap-0.5 overflow-x-auto pb-2">
            {pregnancyTimeline.map((it, i) => {
              const weeks = parseWeeks(it.gestationalAge);
              const fhr = it.fetalHeartRate;
              return (
                <div key={i} className="flex flex-col items-center min-w-[50px]">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold ${
                    weeks >= 37 ? 'bg-emerald-100 text-emerald-700' : weeks >= 28 ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'
                  }`}>{Number.isNaN(weeks) ? '-' : weeks}</div>
                  <div className="w-px h-3 bg-gray-200" />
                  <div className="text-[8px] text-gray-500">{fhr ? `${fhr}bpm` : ''}</div>
                  <div className="text-[8px] text-gray-400">{(it.examinedAt as string)?.slice(5, 10)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Exam Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사유형" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="임신주수" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="체중(kg)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="혈압" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="태아심박" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
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
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${TYPE_COLOR[it.examType as string] ?? 'bg-gray-100'}`}>
                    {TYPE_LABEL[it.examType as string] ?? (it.examType as string) ?? '-'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs font-bold text-gray-900">{it.gestationalAge != null ? `${it.gestationalAge}` : '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{it.currentWeight != null ? `${it.currentWeight}` : '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{it.bloodPressure ? `${it.bloodPressure}` : '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{it.fetalHeartRate != null ? `${it.fetalHeartRate} bpm` : '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-700 max-w-[200px] truncate">{(it.diagnosis as string) ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{it.examinedAt ? kdate(it.examinedAt as string) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
