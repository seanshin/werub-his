'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { neuroSeries, neuroDelta, type NeuroPoint } from '@/lib/specialty/neuro-trend';
import { toast } from '@/stores/toast-store';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

function gcsColor(total: number): string {
  if (total >= 15) return 'bg-emerald-100 text-emerald-700';
  if (total >= 9) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

/** 동공 표시 — JsonB {size, reactive} 또는 문자열(레거시). 예: "3mm +" (대광반사 +/−). */
function fmtPupil(p: unknown): string {
  if (p == null) return '-';
  if (typeof p === 'string') return p || '-';
  if (typeof p === 'object') {
    const o = p as { size?: number; reactive?: boolean };
    if (o.size == null && o.reactive == null) return '-';
    const sz = o.size != null ? `${o.size}mm` : '';
    const rx = o.reactive == null ? '' : o.reactive ? ' +' : ' −';
    return (sz + rx).trim() || '-';
  }
  return String(p);
}

export function NeurosurgeryTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['neurosurgery-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/neurosurgery/exams/${patientId}`),
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

  const formatGcs = (it: Record<string, unknown>) => {
    const e = it.gcsEye as number | undefined;
    const v = it.gcsVerbal as number | undefined;
    const m = it.gcsMotor as number | undefined;
    const stored = typeof it.gcsTotal === 'number' ? it.gcsTotal : null;
    if (e == null && v == null && m == null && stored == null) return null;
    // 🔴 (2026-10-10) 총점은 저장값(gcsTotal)이 정본 — 종전 `?? 0` 합산은 V 미측정(삽관)을 과소평가해
    //    임상에서 불가능한 GCS(<3)를 빨간 중증으로 그렸다(부서 화면은 08-13 에 고쳤는데 차트 탭이 남아 있었다)
    const total = stored ?? (e != null && v != null && m != null ? e + v + m : null);
    return { e: e ?? '-', v: v ?? '-', m: m ?? '-', total };
  };

  const trend = neuroSeries(items);
  return (
    <div className="space-y-4">
      {/* 추이(2026-10-10) — 기록된 점수만 · 판정선 없음(원내 기준 없음) · 변화량은 첫 기록 대비 */}
      {(trend.gcs.length > 1 || trend.nihss.length > 1) && (
        <div className="grid gap-3 sm:grid-cols-2" data-neuro-trend>
          <NeuroSpark label="GCS" points={trend.gcs} range={[3, 15]} />
          <NeuroSpark label="NIHSS" points={trend.nihss} range={[0, 42]} />
        </div>
      )}
      {/* 최근 요약 카드 */}
      {latest && (
        <div className="grid grid-cols-4 gap-3">
          {(() => {
            const gcs = formatGcs(latest);
            return (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
                <p className="text-[10px] text-gray-500">GCS</p>
                {gcs ? (
                  <>
                    {gcs.total == null
                      ? <span className="text-lg font-bold text-gray-400">—</span>
                      : <span className={`text-lg font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${gcsColor(gcs.total)}`}>{`${gcs.total}`}</span>}
                    <p className="text-[10px] text-gray-400 mt-1">E{gcs.e}/V{gcs.v}/M{gcs.m}</p>
                  </>
                ) : <p className="text-lg font-bold text-gray-400">-</p>}
              </div>
            );
          })()}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
            <p className="text-[10px] text-gray-500"><T k="동공 (좌/우)" /></p>
            <p className="text-lg font-bold text-gray-900">{fmtPupil(latest.pupilLeft)}/{fmtPupil(latest.pupilRight)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
            <p className="text-[10px] text-gray-500">ASIA</p>
            <p className="text-lg font-bold text-blue-600">{(latest.asiaScale as string) ?? '-'}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
            <p className="text-[10px] text-gray-500">NIHSS</p>
            <p className="text-lg font-bold text-violet-600">{latest.nihss != null ? `${latest.nihss}` : '-'}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">GCS (E/V/M=합계)</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="동공 (좌/우)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">ASIA</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">NIHSS</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
            </tr>
          </thead>
          <tbody>
            {/* 🔴 '기록 없음'과 '못 불러옴'은 다른 사실이다 — 에러를 먼저 판정한다 */}
            {isError ? (
              <tr><td colSpan={6} className="py-8"><QueryErrorFallback error={error} onRetry={refetch} size="compact" /></td></tr>
            ) : isLoading ? <LoadingRows cols={6} />
            : items.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="기록 없음" /></td></tr>
            : items.map((it) => {
              const gcs = formatGcs(it);
              return (
                <tr key={it.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    {gcs ? (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${gcs.total == null ? 'bg-gray-100 text-gray-500' : gcsColor(gcs.total)}`}>
                        E{gcs.e}/V{gcs.v}/M{gcs.m}={gcs.total ?? '—'}
                      </span>
                    ) : <span className="text-xs text-gray-400">-</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700">{fmtPupil(it.pupilLeft)}/{fmtPupil(it.pupilRight)}</td>
                  <td className="px-4 py-3 text-xs font-bold text-gray-900">{(it.asiaScale as string) ?? '-'}</td>
                  <td className="px-4 py-3 text-xs font-bold text-gray-900">{it.nihss != null ? `${it.nihss}` : '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-700 max-w-[200px] truncate">{(it.diagnosis as string) ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{it.examinedAt ? kdate(it.examinedAt as string) : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 점수 추이 미니 차트 — 척도의 정의 범위를 축으로(GCS 3–15 · NIHSS 0–42) */
function NeuroSpark({ label, points, range }: { label: string; points: NeuroPoint[]; range: [number, number] }) {
  if (points.length < 2) return <div className="rounded-xl border border-gray-100 bg-white p-3 text-[11px] text-gray-400" data-neuro-spark={label}>{label} · <T k="추이를 그릴 기록이 둘 미만입니다" /></div>;
  const W = 240, H = 60, P = 6;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const x = (t: number) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - range[0]) / (range[1] - range[0])) * (H - 2 * P);
  const d = neuroDelta(points);
  return (
    <figure className="rounded-xl border border-gray-100 bg-white p-3" data-neuro-spark={label}>
      <figcaption className="flex justify-between text-[11px] text-gray-600">
        <span className="font-semibold">{label}</span>
        {d != null && <span data-neuro-delta={d}><T k="첫 기록 대비" /> {d > 0 ? `+${d}` : d}</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full" role="img" aria-label={`${label}`}>
        <polyline points={points.map((p) => `${x(p.t)},${y(p.v)}`).join(' ')} className="fill-none stroke-violet-500" strokeWidth={1.5} />
        {points.map((p) => <circle key={p.at} cx={x(p.t)} cy={y(p.v)} r={2.5} className="fill-violet-600"><title>{`${kdate(p.at)} · ${p.v}`}</title></circle>)}
      </svg>
    </figure>
  );
}
