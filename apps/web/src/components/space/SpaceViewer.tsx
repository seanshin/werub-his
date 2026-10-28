'use client';

/**
 * 동선 뷰어 — 확정 도면 위에 환자 위치·혼잡도·자산 배치를 겹친다(2D 정본 + 3D 적층). 기획 spatial-flow-vision-3d P2.
 *
 * 🔴 정직 표기:
 *   - 확정 도면이 없으면 그리지 않는다(격자 자동배치를 도면처럼 그리지 않는다) — 그 사실과 가져오기 화면을 말한다.
 *   - 환자 추정 위치(이벤트 번역)는 **기본 꺼짐**. 켜면 빈 점선 점으로 — 관측과 다른 모양.
 *   - 층까지만 아는 위치는 방에 그리지 않고 "구역 미상 N명"으로 따로 말한다.
 *   - 자산 레이어는 관리자에게만 불러온다(배치 원장 API 가 관리자 전용 — 다른 역할에 403 배너를 띄우지 않는다).
 *   - 조회 실패는 "0명·0건"이 아니다.
 */
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { LOCATION_SOURCE_LABEL, isObservedLocation, type LocationSource, type RouteStep } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { useAuthStore } from '@/stores/auth-store';
import { EmptyState } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf } from '@/components/ui/i18n-text';
import { FloorPlanSvg, SPACE_CATEGORY_STYLE, type GeoFloor, type GeoSpace, type HeatLevel, type SpaceCategory } from './FloorPlanSvg';
// three.js 는 3D 를 열 때만 내려받는다(코드 분할 · 서버 렌더 제외)
const FloorStackWebGL = dynamic(() => import('./FloorStackWebGL'), { ssr: false, loading: () => <div className="h-[620px] w-full animate-pulse rounded-2xl bg-slate-900" /> });
import { RouteSteps } from './RouteSteps';
import { AssetPlacementPanel, placementMarkers, type PlacementRow, type PlacingState } from './AssetPlacementPanel';
import type { AssetMarker } from './space-scene';

export interface Geometry {
  importId: string;
  source: 'SYNTHETIC' | 'DRAWING';
  synthetic: boolean;
  notice: string | null;
  confirmedAt: string | null;
  floors: GeoFloor[];
}
interface PatientLoc { zoneId: string; source?: LocationSource; granularity?: 'ZONE' | 'FLOOR' }
interface HeatItem { zoneId: string; level: string; currentCount: number; observedCount?: number; capacity: number | null }
interface RouteResult { available: boolean; reason?: string; walkM?: number; steps?: RouteStep[]; segments?: { floor: string; points: [number, number][] }[] }
/** 길찾기 실패 이유(서버 코드) → 문장 */
const ROUTE_REASON: Record<string, string> = {
  NO_GEOMETRY: '확정된 도면이 없습니다',
  TARGET_NOT_IN_DRAWING: '이 공간은 도면에 없습니다',
  START_UNKNOWN: '출발점을 찾을 수 없습니다',
  NO_PATH: '조건에 맞는 경로가 없습니다',
};

/** 범례 칸 하나 — 색은 평면도와 같은 정본(`SPACE_CATEGORY_STYLE`) */
function Swatch({ cat, children }: { cat: SpaceCategory; children: React.ReactNode }) {
  const st = SPACE_CATEGORY_STYLE[cat];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-[3px] border" style={{ background: st.fill, borderColor: st.edge }} />
      {children}
    </span>
  );
}

export function useGeometry() {
  return useQuery({
    queryKey: ['space-geometry'],
    queryFn: () => apiClient.get<{ data: Geometry | null }>('/api/v1/space/geometry'),
  });
}

export function SpaceViewer() {
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [floorKey, setFloorKey] = useState<string | null>(null);
  const [showInferred, setShowInferred] = useState(false);
  const [showHeat, setShowHeat] = useState(false);
  const [showAssets, setShowAssets] = useState(false);
  const [picked, setPicked] = useState<GeoSpace | null>(null);
  // 자산 배치 편집(관리자) — 방을 누른 지점(확정 도면일 때만 좌표로 쓴다)·선택한 자산·배치 중인 자산
  const [editAssets, setEditAssets] = useState(false);
  const [pickedPoint, setPickedPoint] = useState<[number, number] | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<AssetMarker | null>(null);
  const [placing, setPlacing] = useState<PlacingState | null>(null);
  const assetLayer = isAdmin && (showAssets || editAssets);
  const selectRoom = (sp: GeoSpace, point?: [number, number]) => { setPicked(sp); setPickedPoint(point ?? null); setSelectedAsset(null); };
  const [routeFrom, setRouteFrom] = useState('');
  const [routeAccessible, setRouteAccessible] = useState(false);
  const [routeRestricted, setRouteRestricted] = useState(false);
  const [routeTo, setRouteTo] = useState<string | null>(null);

  const geoQ = useGeometry();
  const geo = (geoQ.data?.data ?? null) as Geometry | null;
  const patientsQ = useQuery({
    queryKey: ['space-viewer-patients'],
    queryFn: () => apiClient.get<{ data: PatientLoc[] }>('/api/v1/metaverse/patients'),
    enabled: !!geo,
    refetchInterval: pollMs('fast'),
  });
  const heatQ = useQuery({
    queryKey: ['space-viewer-heat'],
    queryFn: () => apiClient.get<{ data: HeatItem[] }>('/api/v1/metaverse/heatmap'),
    enabled: !!geo && showHeat,
    refetchInterval: pollMs('fast'),
  });
  const assetsQ = useQuery({
    queryKey: ['space-viewer-assets'],
    queryFn: () => apiClient.get<{ data: PlacementRow[] }>('/api/v1/space-assets/placements'),
    enabled: !!geo && assetLayer,
  });

  const entrancesQ = useQuery({
    queryKey: ['space-entrances'],
    queryFn: () => apiClient.get<{ data: { id: string; name: string; floor: string; main: boolean }[] }>('/api/v1/space/entrances'),
    enabled: !!geo,
  });
  const routeQ = useQuery({
    queryKey: ['space-route', routeTo, routeFrom, routeAccessible, routeRestricted],
    queryFn: () => apiClient.get<{ data: RouteResult }>('/api/v1/space/route', {
      dest: routeTo!, ...(routeFrom ? { origin: `entrance:${routeFrom}` } : {}),
      ...(routeAccessible ? { accessible: 'true' } : {}), ...(routeRestricted ? { restricted: 'true' } : {}),
    }),
    enabled: !!geo && !!routeTo,
  });
  const route = (routeQ.data?.data ?? null) as RouteResult | null;
  const routeByFloor = useMemo(() => new Map((route?.available ? route.segments ?? [] : []).map((sg) => [sg.floor, sg.points] as const)), [route]);

  const patients = useMemo(() => {
    const m = new Map<string, { observed: number; inferred: number }>();
    const floorOnly = new Map<string, number>();
    for (const p of (patientsQ.data?.data ?? []) as PatientLoc[]) {
      if (p.granularity === 'FLOOR') { floorOnly.set(p.zoneId, (floorOnly.get(p.zoneId) ?? 0) + 1); continue; }
      const cur = m.get(p.zoneId) ?? { observed: 0, inferred: 0 };
      if (isObservedLocation(p.source)) cur.observed++; else cur.inferred++;
      m.set(p.zoneId, cur);
    }
    return { byZone: m, floorOnly };
  }, [patientsQ.data]);
  const heat = useMemo(() => {
    if (!showHeat) return undefined;
    return new Map(((heatQ.data?.data ?? []) as HeatItem[]).map((h) => [h.zoneId, h.level as HeatLevel]));
  }, [heatQ.data, showHeat]);
  const assetRows = useMemo(() => (assetLayer ? ((assetsQ.data?.data ?? []) as PlacementRow[]) : []), [assetsQ.data, assetLayer]);
  const assetMarkers = useMemo(() => (assetLayer ? placementMarkers(assetRows) : undefined), [assetRows, assetLayer]);
  const suggestSet = useMemo(() => (placing ? new Set(placing.suggestions.map((x) => x.spaceNodeId)) : undefined), [placing]);
  const assets = useMemo(() => {
    if (!assetLayer) return undefined;
    const m = new Map<string, number>();
    for (const r of (assetsQ.data?.data ?? []) as PlacementRow[]) if (r.space) m.set(r.space.id, (m.get(r.space.id) ?? 0) + 1);
    return m;
  }, [assetsQ.data, assetLayer]);

  if (geoQ.isError) return <QueryErrorFallback error={geoQ.error} onRetry={() => geoQ.refetch()} size="compact" />;
  if (geoQ.isLoading) return <p className="text-sm text-gray-500"><T k="불러오는 중…" /></p>;
  if (!geo) {
    return (
      <div className="space-y-2">
        <EmptyState icon="🗺️" title="확정된 도면이 없습니다" compact />
        <p className="text-center text-[12px] text-gray-500">
          <T k="도면을 올리고 확정하면 이 화면에 평면도가 그려집니다. 격자 배치는 도면이 아니라서 여기에 그리지 않습니다." />
          {isAdmin && <> · <a className="text-blue-600 underline" href="/admin/space-model"><T k="공간 도면" /></a></>}
        </p>
      </div>
    );
  }

  const floors = [...geo.floors].sort((a, b) => a.level - b.level);
  const cur = floors.find((f) => f.key === floorKey) ?? floors.find((f) => f.level === 1) ?? floors[0];
  const zoneUnknownHere = cur.spaceNodeId ? patients.floorOnly.get(cur.spaceNodeId) ?? 0 : 0;
  const pickedPatients = picked?.spaceNodeId ? patients.byZone.get(picked.spaceNodeId) : undefined;

  const Pill = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button onClick={onClick} aria-pressed={on}
      className={`min-h-[36px] rounded-full border px-3 text-xs transition ${on ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
      {children}
    </button>
  );

  const aside = (
    <aside className="space-y-3">
      {editAssets && isAdmin && (
        <AssetPlacementPanel synthetic={geo.synthetic} placing={placing} setPlacing={setPlacing} picked={picked} pickedPoint={pickedPoint}
          selectedAsset={selectedAsset} setSelectedAsset={setSelectedAsset} rows={assetRows} />
      )}
      <div className="rounded-2xl border bg-white p-3 text-sm shadow-sm">
        {picked ? (
          <div className="space-y-1">
            <p className="font-semibold">{picked.name}{picked.number && !picked.name.includes(picked.number) ? ` ${picked.number}` : ''}</p>
            {!picked.spaceNodeId && <p className="text-[12px] text-gray-500"><T k="공간 모델에 연결되지 않은 공간(도면에만 있음)" /></p>}
            {pickedPatients && (
              <p className="text-[12px]">
                <T k={LOCATION_SOURCE_LABEL.OBSERVED_QR} />·<T k={LOCATION_SOURCE_LABEL.OBSERVED_STATION} />·<T k={LOCATION_SOURCE_LABEL.OBSERVED_WIFI} /> {pickedPatients.observed} · <T k={LOCATION_SOURCE_LABEL.INFERRED_EVENT} /> {pickedPatients.inferred}
              </p>
            )}
            {picked.restricted && <p className="text-[12px] text-red-700"><T k="출입 통제 구역" /></p>}
            {picked.spaceNodeId && (
              <div className="mt-2 space-y-1.5 border-t pt-2">
                <p className="text-[12px] font-semibold"><T k="길찾기" /></p>
                <select className="min-h-[36px] w-full rounded border px-2 text-[12px]" value={routeFrom} onChange={(e) => setRouteFrom(e.target.value)} aria-label="from">
                  {(entrancesQ.data?.data ?? []).map((e) => <option key={e.id} value={e.main ? '' : e.id}>{e.floor} {e.name}</option>)}
                </select>
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={routeAccessible} onChange={(e) => setRouteAccessible(e.target.checked)} /><T k="휠체어(엘리베이터만)" /></label>
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={routeRestricted} onChange={(e) => setRouteRestricted(e.target.checked)} /><T k="통제 구역 통과 허용(직원)" /></label>
                <button className="min-h-[36px] w-full rounded bg-blue-600 text-[12px] text-white" onClick={() => setRouteTo(picked.spaceNodeId)}><T k="여기까지 경로" /></button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-gray-500"><T k="방을 누르면 정보가 보입니다" /></p>
        )}
      </div>
      {routeTo && (
        <div className="space-y-2 rounded-2xl border bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold"><T k="경로" /></p>
            <button className="text-[11px] text-gray-500 underline" onClick={() => setRouteTo(null)}><T k="지우기" /></button>
          </div>
          {routeQ.isError ? <QueryErrorFallback error={routeQ.error} onRetry={() => routeQ.refetch()} size="compact" />
            : routeQ.isLoading ? <p className="text-[12px] text-gray-500"><T k="불러오는 중…" /></p>
            : route && !route.available ? <p className="text-[12px] text-amber-700"><T k={ROUTE_REASON[route.reason ?? ''] ?? '경로를 구할 수 없습니다'} /></p>
            : route && (<>
              <p className="text-[11px] text-gray-500"><Tf k="걷는 거리 약 {거리}m · 층 {층}개" params={{ 거리: route.walkM ?? 0, 층: routeByFloor.size }} /></p>
              <RouteSteps steps={route.steps ?? []} />
            </>)}
        </div>
      )}
      <div className="space-y-1.5 rounded-2xl border bg-white p-3 text-[11px] text-gray-600 shadow-sm">
        <p className="font-semibold text-gray-700"><T k="범례" /></p>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 pb-1">
          <Swatch cat="CLINIC"><T k="외래 진료" /></Swatch>
          <Swatch cat="WAIT"><T k="대기·로비" /></Swatch>
          <Swatch cat="DIAG"><T k="검사·영상" /></Swatch>
          <Swatch cat="ACUTE"><T k="응급·수술·중환" /></Swatch>
          <Swatch cat="WARD"><T k="병실" /></Swatch>
          <Swatch cat="STAFF"><T k="직원·간호" /></Swatch>
          <Swatch cat="TOILET"><T k="화장실" /></Swatch>
          <Swatch cat="SUPPORT"><T k="지원·설비" /></Swatch>
          <Swatch cat="CORE"><T k="엘리베이터·계단" /></Swatch>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-[3px] border border-rose-300" style={{ background: 'repeating-linear-gradient(-45deg, transparent 0 3px, rgba(225,29,72,0.45) 3px 4px)' }} />
            <T k="출입 통제" />
          </span>
        </div>
        <p><span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-600 align-middle" /> <T k="관측(QR·스테이션)" /></p>
        <p><span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-slate-500 align-middle" /> <T k="이벤트로 추정(기본 꺼짐)" /></p>
        {showHeat && <p><span className="inline-block h-2.5 w-2.5 bg-gray-300 align-middle" /> <T k="정원 미설정" /></p>}
        {assets && <p><span className="inline-block h-2.5 w-3 rounded-sm bg-violet-600 align-middle" /> <T k="배치된 자산 수" /></p>}
        <p><span className="inline-block h-2 w-2 rounded-full bg-green-600 align-middle" /> <T k="출입구" /> · <span className="inline-block h-2 w-2 rounded-full bg-red-600 align-middle" /> <T k="통제 구역 문" /></p>
      </div>
    </aside>
  );

  return (
    <div className="space-y-3">
      {geo.notice && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700"><T k={geo.notice} /></p>
      )}
      {/* 도구 막대 */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-white px-3 py-2 shadow-sm">
        <div className="flex overflow-hidden rounded-xl border">
          {(['2d', '3d'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
              className={`min-h-[36px] px-4 text-xs font-medium ${mode === m ? 'bg-slate-900 text-white' : 'bg-white text-gray-600'}`}>
              {m === '2d' ? <T k="2D 평면도" /> : <T k="3D 적층" />}
            </button>
          ))}
        </div>
        <span className="mx-1 h-6 w-px bg-gray-200" />
        <Pill on={showInferred} onClick={() => setShowInferred((v) => !v)}><T k="추정 위치도 표시" /></Pill>
        <Pill on={showHeat} onClick={() => setShowHeat((v) => !v)}><T k="혼잡도" /></Pill>
        {isAdmin && <Pill on={showAssets} onClick={() => setShowAssets((v) => !v)}><T k="자산 배치" /></Pill>}
        {isAdmin && <Pill on={editAssets} onClick={() => { setEditAssets((v) => !v); setPlacing(null); setSelectedAsset(null); }}><T k="배치 편집" /></Pill>}
      </div>

      {patientsQ.isError && <QueryErrorFallback error={patientsQ.error} onRetry={() => patientsQ.refetch()} size="compact" />}
      {showHeat && heatQ.isError && <QueryErrorFallback error={heatQ.error} onRetry={() => heatQ.refetch()} size="compact" />}
      {assetLayer && assetsQ.isError && <QueryErrorFallback error={assetsQ.error} onRetry={() => assetsQ.refetch()} size="compact" />}

      {mode === '2d' ? (
        <div className="grid gap-3 lg:grid-cols-[64px_1fr_270px]">
          {/* 층 레일 — 엘리베이터 패널처럼 위층이 위 */}
          <nav className="flex gap-1.5 lg:flex-col" aria-label="floors">
            {[...floors].reverse().map((f) => (
              <button key={f.key} onClick={() => { setFloorKey(f.key); setPicked(null); }} aria-current={cur.key === f.key}
                className={`min-h-[44px] flex-1 rounded-xl border text-sm font-bold transition lg:flex-none ${cur.key === f.key ? 'border-indigo-600 bg-indigo-600 text-white shadow' : 'bg-white text-gray-700 hover:bg-indigo-50'}`}>
                {f.key}
              </button>
            ))}
          </nav>
          <div className="rounded-2xl border bg-white p-2 shadow-sm">
            <div className="flex items-center justify-between px-2 pb-1">
              <p className="text-sm font-semibold text-gray-800">{cur.title}</p>
              {zoneUnknownHere > 0 && <p className="text-[11px] text-amber-700"><Tf k="이 층 구역 미상 {수}명(층까지만 앎 — 방에 그리지 않음)" params={{ 수: zoneUnknownHere }} /></p>}
            </div>
            <FloorPlanSvg floor={cur} notice={geo.notice} patients={patients.byZone} showInferred={showInferred} heat={heat} assets={assets}
              highlight={picked?.spaceNodeId ? new Set([picked.spaceNodeId]) : undefined} onSelect={(sp) => selectRoom(sp)} route={routeByFloor.get(cur.key)} />
          </div>
          {aside}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1fr_270px]">
          <FloorStackWebGL floors={floors} selectedKey={floorKey ?? cur.key} onSelectFloor={(k) => { setFloorKey(k); setPicked(null); }} notice={geo.notice}
            patients={patients.byZone} showInferred={showInferred} heat={heat} routeByFloor={routeByFloor}
            onSelectSpace={selectRoom} highlightSpaceNodeId={picked?.spaceNodeId ?? null}
            assets={assetMarkers} onSelectAsset={(m) => { setSelectedAsset(m); setPicked(null); if (!editAssets) setEditAssets(true); }}
            selectedAssetKey={selectedAsset ? `${selectedAsset.kind}:${selectedAsset.assetId}` : null}
            suggestSpaceNodeIds={suggestSet} placing={!!placing}
            focusAssetKey={selectedAsset ? `${selectedAsset.kind}:${selectedAsset.assetId}` : null} />
          {aside}
        </div>
      )}
      <p className="text-[11px] text-gray-500"><T k="3D 는 보조 보기입니다 — 드래그로 회전·기울이기 · 층 버튼으로 강조. 모든 정보는 2D 평면도에 있습니다." /></p>
    </div>
  );
}
