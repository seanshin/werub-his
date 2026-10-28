'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 면역억제제 TDM(2026-10-10) — 🔴 EP(`records/:id/tdm`)와 서버 판정(inRange)은 있었는데 부르는 화면이 0 이었다.
 *  · 범위 판정은 서버 값만 그린다 — 목표를 모르면 inRange null = "목표 미기재 · 판정 불가"(정상으로 그리지 않는다)
 *  · 기록 폼은 미선택으로 시작한다 — 약물·채혈 시각을 화면이 고르지 않는다(채혈 시각 필수 — 서버도 400)
 */
export interface TdmRow {
  id: string; drug: string; troughLevel: number | null; peakLevel: number | null;
  targetLow: number | null; targetHigh: number | null; inRange: boolean | null;
  doseAdjustment: string | null; sampledAt: string;
}

export const emptyTdmForm = () => ({ drug: '', troughLevel: '', targetLow: '', targetHigh: '', sampledAt: '', doseAdjustment: '' });
export type TdmForm = ReturnType<typeof emptyTdmForm>;

/** 폼 → 요청 본문. 빈 칸은 보내지 않는다(0 과 미입력을 섞지 않는다). 약물·채혈 시각이 없으면 null */
export function buildTdmBody(f: TdmForm): Record<string, unknown> | null {
  const drug = f.drug.trim();
  if (!drug || !f.sampledAt) return null;
  const sampled = new Date(f.sampledAt);
  if (Number.isNaN(sampled.getTime())) return null;
  const num = (v: string) => (v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const body: Record<string, unknown> = { drug, sampledAt: sampled.toISOString() };
  for (const [k, v] of [['troughLevel', f.troughLevel], ['targetLow', f.targetLow], ['targetHigh', f.targetHigh]] as const) {
    const n = num(v);
    if (n !== undefined) body[k] = n;
  }
  if (f.doseAdjustment.trim()) body.doseAdjustment = f.doseAdjustment.trim();
  return body;
}

export function TdmBadge({ inRange }: { inRange: boolean | null }) {
  const tAttr = useTAttr();
  if (inRange === true) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700"><T k="목표 범위 안" /></span>;
  if (inRange === false) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700"><T k="목표 범위 밖" /></span>;
  return <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500" title={tAttr('목표 범위가 기록되지 않아 판정하지 않았습니다')}><T k="판정 불가(목표 미기재)" /></span>;
}

/**
 * 약물별 추이(2026-10-10) — trough 가 기록된 행만 점으로(미측정은 점을 찍지 않는다 · 0 으로 그리지 않는다).
 * 목표 범위는 **그 행에 기록된** 하한·상한만 띠로(기록 없는 구간에 목표를 이어 그리지 않는다).
 */
export interface TdmPoint { t: number; v: number; low: number | null; high: number | null; inRange: boolean | null }
export function tdmSeries(rows: TdmRow[]): Map<string, TdmPoint[]> {
  const m = new Map<string, TdmPoint[]>();
  for (const r of rows) {
    if (r.troughLevel == null || !Number.isFinite(Number(r.troughLevel))) continue;
    const t = Date.parse(r.sampledAt);
    if (Number.isNaN(t)) continue;
    const arr = m.get(r.drug) ?? [];
    arr.push({ t, v: Number(r.troughLevel), low: r.targetLow, high: r.targetHigh, inRange: r.inRange });
    m.set(r.drug, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.t - b.t);
  return m;
}

export function TdmTrendChart({ drug, points }: { drug: string; points: TdmPoint[] }) {
  if (points.length < 2) return null;
  const W = 280, H = 90, P = 8;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const vals = points.flatMap((p) => [p.v, p.low, p.high]).filter((x): x is number => x != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (t: number) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - lo) / span) * (H - 2 * P);
  return (
    <figure className="rounded-lg border border-gray-100 p-2" data-tdm-trend={drug}>
      <figcaption className="text-[11px] font-semibold text-gray-600">{drug} · trough</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label={`${drug} trough`}>
        {points.map((p, i) => p.low != null && p.high != null && (
          <rect key={`b${i}`} x={x(p.t) - 4} y={y(p.high)} width={8} height={Math.max(1, y(p.low) - y(p.high))} className="fill-emerald-100" data-tdm-band />
        ))}
        <polyline points={points.map((p) => `${x(p.t)},${y(p.v)}`).join(' ')} className="fill-none stroke-indigo-500" strokeWidth={1.5} />
        {points.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r={3} className={p.inRange === false ? 'fill-red-500' : p.inRange === true ? 'fill-emerald-600' : 'fill-gray-400'} />
        ))}
      </svg>
      <p className="text-[10px] text-gray-400"><T k="녹색 띠는 그 채혈에 기록된 목표 범위입니다(기록 없는 채혈에는 띠를 그리지 않습니다)." /></p>
    </figure>
  );
}

export function TransplantTdmPanel({ recordId }: { recordId: string }) {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [form, setForm] = useState<TdmForm>(emptyTdmForm);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['transplant-tdm', recordId],
    queryFn: () => apiClient.get<{ data: TdmRow[] }>(`/api/v1/transplant/records/${recordId}/tdm`),
  });
  const rows = (Array.isArray(data?.data) ? data.data : []) as TdmRow[];
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post<{ data: TdmRow & { outOfRangeWarning?: string } }>(`/api/v1/transplant/records/${recordId}/tdm`, body),
    onSuccess: (res) => {
      const warn = (res as { data?: { outOfRangeWarning?: string } })?.data?.outOfRangeWarning;
      if (warn) toast.warning(tAttr('TDM 목표 범위를 벗어났습니다 — 용량 조정 검토가 필요합니다.'));
      else toast.success(tAttr('TDM 을 기록했습니다.'));
      setForm(emptyTdmForm());
      qc.invalidateQueries({ queryKey: ['transplant-tdm', recordId] });
    },
    onError: (e: { message?: string }) => toast.error(e?.message || tAttr('TDM 기록에 실패했습니다.')),
  });
  const body = buildTdmBody(form);
  const set = (k: keyof TdmForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-3" data-tdm-panel={recordId}>
      <p className="text-xs font-bold text-gray-700"><T k="면역억제제 TDM" /></p>
      {isError ? <QueryErrorFallback error={error} onRetry={refetch} size="compact" />
        : isLoading ? <p className="text-xs text-gray-400"><T k="불러오는 중..." /></p>
        : rows.length === 0 ? <p className="text-xs text-gray-400"><T k="TDM 기록이 없습니다" /></p>
        : (<>
          <div className="grid gap-2 sm:grid-cols-2">
            {[...tdmSeries(rows)].map(([drug, pts]) => <TdmTrendChart key={drug} drug={drug} points={pts} />)}
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500">
              <th className="text-left py-1"><T k="채혈 시각" /></th>
              <th className="text-left py-1"><T k="약물" /></th>
              <th className="text-right py-1">Trough</th>
              <th className="text-right py-1"><T k="목표" /></th>
              <th className="text-left py-1 pl-3"><T k="판정" /></th>
              <th className="text-left py-1"><T k="용량 조정" /></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="py-1"><KDate value={r.sampledAt} mode="datetime" /></td>
                  <td className="py-1">{r.drug}</td>
                  <td className="py-1 text-right">{r.troughLevel ?? '—'}</td>
                  <td className="py-1 text-right">{r.targetLow != null || r.targetHigh != null ? `${r.targetLow ?? '?'}–${r.targetHigh ?? '?'}` : '—'}</td>
                  <td className="py-1 pl-3"><TdmBadge inRange={r.inRange} /></td>
                  <td className="py-1">{r.doseAdjustment ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>)}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
        <label className="text-[11px] text-gray-600"><T k="약물" />
          <input value={form.drug} onChange={set('drug')} placeholder={tAttr('예: tacrolimus')} className="w-full border rounded-lg px-2 py-1.5 text-xs" />
        </label>
        <label className="text-[11px] text-gray-600"><T k="채혈 시각" />
          <input type="datetime-local" value={form.sampledAt} onChange={set('sampledAt')} className="w-full border rounded-lg px-2 py-1.5 text-xs" />
        </label>
        <label className="text-[11px] text-gray-600">Trough
          <input type="number" min={0} step="0.1" value={form.troughLevel} onChange={set('troughLevel')} className="w-full border rounded-lg px-2 py-1.5 text-xs" />
        </label>
        <label className="text-[11px] text-gray-600"><T k="목표 하한" />
          <input type="number" min={0} step="0.1" value={form.targetLow} onChange={set('targetLow')} className="w-full border rounded-lg px-2 py-1.5 text-xs" />
        </label>
        <label className="text-[11px] text-gray-600"><T k="목표 상한" />
          <input type="number" min={0} step="0.1" value={form.targetHigh} onChange={set('targetHigh')} className="w-full border rounded-lg px-2 py-1.5 text-xs" />
        </label>
        <button type="button" disabled={!body || save.isPending} onClick={() => body && save.mutate(body)} data-tdm-save
          className="min-h-[44px] px-3 rounded-lg bg-teal-600 text-white text-xs font-medium disabled:opacity-50">
          <T k={save.isPending ? '저장 중...' : 'TDM 기록'} />
        </button>
      </div>
      <label className="block text-[11px] text-gray-600"><T k="용량 조정" />
        <input value={form.doseAdjustment} onChange={set('doseAdjustment')} className="w-full border rounded-lg px-2 py-1.5 text-xs" />
      </label>
      <p className="text-[10px] text-gray-400"><T k="약물과 채혈 시각을 넣어야 저장됩니다. 목표 범위를 비우면 범위 판정을 하지 않습니다." /></p>
    </div>
  );
}
