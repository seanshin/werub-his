'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { FloorPlanSvg, type GeoFloor } from '@/components/space/FloorPlanSvg';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/**
 * 도면 위 AP·측정 표본 배치(2026-10-10) — 표만으로는 "어느 구역에 AP 가 비었는가·표본이 어디 몰렸는가"가 안 보인다.
 *  · 도면 정본 `GET /api/v1/space/geometry`(확정 도면) · 좌표계는 층 도면 m
 *  · AP: 교정됨(남색)·교정 안 됨(회색)·중지(빈 원) · 표본: 유효(초록 점)·무효는 그리지 않는다
 *  · 확정 도면이 없으면 그렇게 말한다(지어 그리지 않는다)
 */
interface MapAp { id: string; bssid: string; label: string; floorKey: string; x: number; y: number; rssiAt1m: number | null; pathLossExponent: number | null; isActive: boolean }
interface MapSample { id: string; floorKey: string; x: number; y: number; voidedAt: string | null }

export function ApFloorMap() {
  const tAttr = useTAttr();
  // AP 등록부 표와 같은 캐시 키·같은 모양(Ap[]) — 표에서 바꾸면 도면도 바뀐다
  const apsQ = useQuery({ queryKey: ['wifi-aps'], queryFn: () => apiClient.get<{ data: MapAp[] }>('/api/v1/location/wifi/access-points').then((r) => r.data) });
  const aps = apsQ.data;
  const geoQ = useQuery({
    queryKey: ['space-geometry'],
    queryFn: () => apiClient.get<{ data: { floors: GeoFloor[]; notice: string | null } | null }>('/api/v1/space/geometry').then((r) => r.data),
  });
  const surveyQ = useQuery({ queryKey: ['wifi-survey'], queryFn: () => apiClient.get<{ data: MapSample[]; meta: unknown }>('/api/v1/location/wifi/survey') });
  const floors = geoQ.data?.floors ?? [];
  const [floorKey, setFloorKey] = useState('');
  const fk = floorKey || floors[0]?.key || '';
  const floor = floors.find((f) => f.key === fk);
  const onFloor = useMemo(() => (aps ?? []).filter((a) => a.floorKey === fk), [aps, fk]);
  const samples = useMemo(() => (surveyQ.data?.data ?? []).filter((s) => s.floorKey === fk && !s.voidedAt), [surveyQ.data, fk]);
  const r = floor ? Math.max(0.6, Math.min(floor.footprint.w, floor.footprint.h) / 60) : 0.6;

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" data-wifi-floor-map id="wifi-floor-map">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-gray-900"><T k="도면 위 배치" /></h2>
        {floors.length > 0 && (
          <select value={fk} onChange={(e) => setFloorKey(e.target.value)} aria-label={tAttr('층')} className="ml-auto min-h-[36px] rounded border border-gray-200 px-2 text-xs" data-wifi-floor-map-select>
            {floors.map((f) => <option key={f.key} value={f.key}>{f.key}</option>)}
          </select>
        )}
      </div>
      {geoQ.isError ? <QueryErrorFallback error={geoQ.error} onRetry={() => geoQ.refetch()} size="compact" />
        : geoQ.isLoading ? <div className="h-48 animate-pulse rounded-xl bg-gray-100" aria-busy="true" />
        : !floor ? <p className="text-xs text-gray-500" data-wifi-floor-map-none><T k="확정 도면이 없어 배치를 그릴 수 없습니다 — 공간 도면을 먼저 확정하십시오." /></p>
        : (
          <>
            <div className="overflow-hidden rounded-xl border border-gray-100">
              <FloorPlanSvg floor={floor} notice={geoQ.data?.notice} labels={false}>
                {samples.map((s) => <circle key={s.id} cx={s.x} cy={s.y} r={r * 0.55} fill="#10b981" opacity={0.75} data-wifi-map-sample={s.id} />)}
                {onFloor.map((a) => {
                  const cal = a.rssiAt1m != null && a.pathLossExponent != null;
                  return (
                    <g key={a.id} data-wifi-map-ap={a.bssid} data-calibrated={cal ? 'yes' : 'no'}>
                      <title>{`${a.label} · ${a.bssid}`}</title>
                      <circle cx={a.x} cy={a.y} r={r} fill={a.isActive ? (cal ? '#3730a3' : '#94a3b8') : 'white'} stroke={a.isActive ? 'white' : '#94a3b8'} strokeWidth={r * 0.3} />
                    </g>
                  );
                })}
              </FloorPlanSvg>
            </div>
            <p className="mt-1 flex flex-wrap gap-3 text-[11px] text-gray-600">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-indigo-800" /><T k="AP(교정됨)" /></span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-400" /><T k="AP(교정 안 됨)" /></span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full border border-slate-400 bg-white" /><T k="AP(중지)" /></span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" /><T k="현장 측정 표본(유효)" /></span>
              <span data-wifi-floor-map-counts><Tf k="이 층 AP {ap}대 · 표본 {표본}개" params={{ ap: onFloor.length, 표본: samples.length }} /></span>
            </p>
            {surveyQ.isError && <p className="mt-1 text-[11px] text-rose-700"><T k="측정 표본을 불러오지 못해 AP 만 그렸습니다" /></p>}
          </>
        )}
    </section>
  );
}
