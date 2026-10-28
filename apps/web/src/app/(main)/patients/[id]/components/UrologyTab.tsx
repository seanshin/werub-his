'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';
import { Num } from '@/components/ui/display';
import { RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { PSA_DENSITY_UNAVAILABLE_TEXT } from '@/lib/specialty/exam-views';

const IPSS_SEVERITY: Record<string, string> = { MILD: '경증', MODERATE: '중등증', SEVERE: '중증' };
const IPSS_COLOR: Record<string, string> = {
  MILD: 'bg-emerald-100 text-emerald-700',
  MODERATE: 'bg-amber-100 text-amber-700',
  SEVERE: 'bg-red-100 text-red-700',
};

/** IPSS 총점(0-35)에서 중증도 파생 — <8 경증, 8~19 중등도, ≥20 중증. (모델에 별도 severity 필드 없음) */
function ipssSeverity(score: unknown): 'MILD' | 'MODERATE' | 'SEVERE' | null {
  if (score == null) return null;
  const n = Number(score);
  if (Number.isNaN(n)) return null;
  if (n < 8) return 'MILD';
  if (n < 20) return 'MODERATE';
  return 'SEVERE';
}

function psaColor(value: number): string {
  return value < 4.0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700';
}

function psaLabel(value: number): string {
  return value < 4.0 ? '정상' : '이상';
}

export function UrologyTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['urology-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/urology/exams/${patientId}`),
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
      {/* 최근 요약 카드 */}
      {latest && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
            <p className="text-[10px] text-gray-500">IPSS</p>
            <p className="text-2xl font-bold text-gray-900">{latest.ipssScore != null ? `${latest.ipssScore}` : '-'}</p>
            {(() => {
              const sev = ipssSeverity(latest.ipssScore);
              return sev != null ? (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${IPSS_COLOR[sev] ?? 'bg-gray-100'}`}>
                  {IPSS_SEVERITY[sev] ?? sev}
                </span>
              ) : null;
            })()}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
            <p className="text-[10px] text-gray-500">PSA (ng/mL)</p>
            <p className="text-2xl font-bold text-gray-900">{latest.psaValue != null ? `${latest.psaValue}` : '-'}</p>
            {latest.psaValue != null && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${psaColor(Number(latest.psaValue))}`}>
                {psaLabel(Number(latest.psaValue))}
              </span>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
            <p className="text-[10px] text-gray-500"><T k="전립선 크기" /></p>
            <p className="text-2xl font-bold text-gray-900">{latest.prostateVolume != null ? `${latest.prostateVolume}cc` : '-'}</p>
          </div>
          {/* PSA 밀도 — 서버가 같은 검사의 PSA ÷ 용적으로 계산 · 기준선은 원내 정책이라 판정 색 없음(2026-10-10) */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center" data-psad={latest.psaDensity == null ? 'NA' : String(latest.psaDensity)}>
            <p className="text-[10px] text-gray-500"><T k="PSA 밀도" /></p>
            {latest.psaDensity != null
              ? <p className="text-2xl font-bold text-gray-900"><Num value={Number(latest.psaDensity)} domain="psaDensity" /></p>
              : <p className="text-xs text-gray-400 mt-2"><T k={RATIO_UNAVAILABLE} />{typeof latest.psaDensityUnavailable === 'string' && PSA_DENSITY_UNAVAILABLE_TEXT[latest.psaDensityUnavailable] ? <> · <T k={PSA_DENSITY_UNAVAILABLE_TEXT[latest.psaDensityUnavailable]} /></> : null}</p>}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">IPSS</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="중증도" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">PSA</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="정상여부" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="전립선크기" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="PSA 밀도" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
            </tr>
          </thead>
          <tbody>
            {/* 🔴 '기록 없음'과 '못 불러옴'은 다른 사실이다 — 에러를 먼저 판정한다 */}
            {isError ? (
              <tr><td colSpan={8} className="py-8"><QueryErrorFallback error={error} onRetry={refetch} size="compact" /></td></tr>
            ) : isLoading ? <LoadingRows cols={8} />
            : items.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="기록 없음" /></td></tr>
            : items.map((it) => (
              <tr key={it.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-xs font-bold text-gray-900">{it.ipssScore != null ? `${it.ipssScore}` : '-'}</td>
                <td className="px-4 py-3">
                  {(() => {
                    const sev = ipssSeverity(it.ipssScore);
                    return sev != null ? (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${IPSS_COLOR[sev] ?? 'bg-gray-100'}`}>
                        {IPSS_SEVERITY[sev] ?? sev}
                      </span>
                    ) : <span className="text-xs text-gray-400">-</span>;
                  })()}
                </td>
                <td className="px-4 py-3 text-xs font-bold text-gray-900">{it.psaValue != null ? `${it.psaValue}` : '-'}</td>
                <td className="px-4 py-3">
                  {it.psaValue != null ? (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${psaColor(Number(it.psaValue))}`}>
                      {psaLabel(Number(it.psaValue))}
                    </span>
                  ) : <span className="text-xs text-gray-400">-</span>}
                </td>
                <td className="px-4 py-3 text-xs text-gray-700">{it.prostateVolume != null ? `${it.prostateVolume}cc` : '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{it.psaDensity != null ? <Num value={Number(it.psaDensity)} domain="psaDensity" /> : <span className="text-gray-400">-</span>}</td>
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
