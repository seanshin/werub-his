'use client';

import { useMemo } from 'react';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T } from '@/components/ui/i18n-text';

interface CcResult {
  id: string;
  chartId: string;
  chartName: string;
  archetype: string;
  sourceVersion?: string | null;
  resultLabel?: string | null;
  resultLevel?: string | null;
  resultValue?: string | number | null;
  recommendation?: string | null;
  flags?: string[];
  performedByName: string;
  performedAt: string;
}

const RISK_CLASS: Record<string, string> = {
  normal: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  low: 'bg-lime-100 text-lime-700 border-lime-200',
  moderate: 'bg-amber-100 text-amber-700 border-amber-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  critical: 'bg-red-100 text-red-700 border-red-200',
};
const RISK_HEX: Record<string, string> = {
  normal: '#22c55e', low: '#84cc16', moderate: '#f59e0b', high: '#f97316', critical: '#dc2626',
};
const ARCHETYPE_LABEL: Record<string, string> = { scoring: '점수합산', lookup: '분류/등급', formula: '계산식', tree: '트리' };

function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const w = 120, h = 28, pad = 3;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(pad + i * step).toFixed(1)} ${(h - pad - ((v - min) / span) * (h - pad * 2)).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} className="shrink-0">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
      {points.map((v, i) => (
        <circle key={i} cx={pad + i * step} cy={h - pad - ((v - min) / span) * (h - pad * 2)} r={1.8} fill={color} />
      ))}
    </svg>
  );
}

export function ClinicalToolsTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['clinical-tools-results', patientId],
    queryFn: () => apiClient.get<{ data: CcResult[] }>('/api/v1/clinical-chart-results', { patientId }),
  });

  const rows: CcResult[] = useMemo(() => {
    const r = data?.data;
    return Array.isArray(r) ? r : (r as { data?: CcResult[] } | undefined)?.data ?? [];
  }, [data]);

  // chartId 별 그룹 (performedAt desc)
  const groups = useMemo(() => {
    const map = new Map<string, CcResult[]>();
    for (const r of rows) {
      if (!map.has(r.chartId)) map.set(r.chartId, []);
      map.get(r.chartId)!.push(r);
    }
    return Array.from(map.entries()).map(([chartId, list]) => ({
      chartId,
      list: [...list].sort((a, b) => new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime()),
    }));
  }, [rows]);

  if (isLoading) return <div className="space-y-3">{[...Array(2)].map((_, i) => <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />)}</div>;
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  if (groups.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-10 text-center text-gray-400">
        <p className="text-3xl mb-2">🩺</p>
        <T k="저장된 임상도구 결과가 없습니다. (임상 도구 화면에서 환자 선택 후 저장)" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">
        <T k="임상도구 산출 기록(보조도구·최종 임상판단 의사 귀속). 출처·수행자·시각이 함께 기록됩니다." />
      </p>
      {groups.map(({ chartId, list }) => {
        const latest = list[0];
        // 추이(오래된→최신, 숫자 결과만)
        const numeric = [...list].reverse().map((r) => (r.resultValue != null ? Number(r.resultValue) : NaN)).filter((n) => !Number.isNaN(n));
        const level = latest.resultLevel ?? '';
        return (
          <div key={chartId} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-gray-900">{latest.chartName}</h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">{ARCHETYPE_LABEL[latest.archetype] ?? latest.archetype}</span>
              </div>
              <span className="text-[11px] text-gray-400">{list.length}<Unit>건</Unit> <T k="기록" /></span>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xl font-extrabold text-gray-900">
                  {latest.resultValue != null ? (Number.isInteger(Number(latest.resultValue)) ? Number(latest.resultValue) : Number(latest.resultValue).toFixed(2)) : (latest.resultLabel ?? '-')}
                </span>
                {latest.resultLabel && latest.resultValue != null && <span className="text-sm text-gray-500">{latest.resultLabel}</span>}
                {level && RISK_CLASS[level] && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${RISK_CLASS[level]}`}>
                    {level === 'normal' ? '정상' : level === 'low' ? '낮음' : level === 'moderate' ? '중등도' : level === 'high' ? '높음' : '위험'}
                  </span>
                )}
              </div>
              {numeric.length >= 2 && <Sparkline points={numeric} color={RISK_HEX[level] ?? '#3b82f6'} />}
            </div>

            {latest.recommendation && <p className="text-xs text-gray-600 mt-1.5">→ {latest.recommendation}</p>}
            {latest.flags && latest.flags.length > 0 && (
              <div className="mt-2 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-700 font-medium">⚠️ 양성 플래그: {latest.flags.join(', ')}</div>
            )}

            {/* 최근 이력 */}
            <div className="mt-3 pt-2 border-t border-gray-50 space-y-1">
              {list.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-700 font-medium">
                    {r.resultValue != null ? `${Number.isInteger(Number(r.resultValue)) ? Number(r.resultValue) : Number(r.resultValue).toFixed(2)} ` : ''}{r.resultLabel ?? ''}
                  </span>
                  <span className="text-gray-400">{r.performedByName} · {kdate(r.performedAt, 'datetime')}{r.sourceVersion ? ` · ${r.sourceVersion}` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
