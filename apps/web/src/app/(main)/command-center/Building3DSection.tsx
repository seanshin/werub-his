'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { isObservedLocation, LOCATION_SOURCE_LABEL, WIFI_FIX_METHOD_LABEL, wifiFixAgeMinutes, type LocationSource, type WifiFixMethod } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { maskPatientName, pollMs } from '@/lib/ui-settings';
import { useHisMode } from '@/lib/his-mode';
import { KDate, Num } from '@/components/ui/display';
import { useAuthStore } from '@/stores/auth-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { useGeometry, type Geometry } from '@/components/space/SpaceViewer';
import type { HeatLevel } from '@/components/space/FloorPlanSvg';
import { BED_COLOR, type BedMark } from '@/components/space/bed-marks';
import type { WifiApMark, WifiFixMark } from '@/components/space/FloorStackWebGL';

// three.js 는 이 구역을 열 때만 내려받는다(코드 분할 · 서버 렌더 제외)
const FloorStackWebGL = dynamic(() => import('@/components/space/FloorStackWebGL'), { ssr: false, loading: () => <div className="h-[560px] w-full animate-pulse rounded-2xl bg-slate-900" /> });

type LoadLevel = 'WITHIN_TARGET' | 'OVER_TARGET' | 'IDLE';
export interface SpaceLoad {
  asOf: string;
  target: { opdWaitMin: number; source: 'CONFIG' | 'FALLBACK' };
  rooms: { spaceNodeId: string; name: string; waiting: number; called: number; inConsultation: number; longestWaitMin: number | null; level: LoadLevel }[];
  stations: { spaceNodeId: string; name: string; waiting: number; inProgress: number }[];
  unplaced: { queueWithoutRoom: number; queueRoomNotLinked: { roomName: string; count: number }[]; stationsNotLinked: number; stationLogsNotPlaced: number };
  queueTotal: number;
  /** 병상 층(2026-10-02) — 도면에 연결된 병상만 · 미연결은 병동별 수 */
  bedRooms?: { spaceNodeId: string; emergency: boolean; beds: { bedId: string; label: string; state: BedMark }[] }[];
  bedsUnlinked?: { ward: string; count: number }[];
  bedsTotal?: number;
}

/** 병상 표식 지도(공간 → 상태 목록) */
export function bedMarks(load: SpaceLoad | undefined): Map<string, BedMark[]> {
  return new Map((load?.bedRooms ?? []).map((r) => [r.spaceNodeId, r.beds.map((b) => b.state)]));
}
/** 서버 현재 위치 판정의 부가 정보 — 판정 규칙·오래된 열린 기록 수·잘림 */
interface PatientLocMeta { rule?: string; since?: string; staleOpen?: number; truncated?: boolean; total?: number }
interface PatientLoc { zoneId: string; source?: LocationSource; granularity?: 'ZONE' | 'FLOOR'; enteredAt?: string | null; patientId?: string; patientName?: string; mrn?: string | null; zoneName?: string | null; floor?: number | null; status?: string | null }
/** 이동 경로 한 줄 — `GET metaverse/patients/:id/trail?date=` */
interface TrailRow { zoneId: string; zoneName?: string | null; floor?: number | null; status?: string | null; enteredAt: string; leftAt: string | null; duration: number | null; source?: string | null }

/** 무선 AP 등록부 한 대 — `GET location/wifi/access-points` */
interface WifiApRow { id: string; label: string; floorKey: string; x: number; y: number; rssiAt1m: number | null; pathLossExponent: number | null; isActive: boolean; dataOrigin: string }
/** 무선 측위 한 건 — `GET location/wifi/live`·`trail` */
interface WifiFixRow { patientId: string | null; patientName?: string | null; observedAt: string; floorKey: string; x: number; y: number; accuracyM: number; apCount: number; quality: 'POINT' | 'CELL'; granularity: 'ZONE' | 'FLOOR'; source: 'OBSERVED_WIFI' | 'SIMULATED'; uncalibrated: boolean; method?: WifiFixMethod }
interface WifiLiveMeta { windowMin: number; truncated: boolean; total: number }
/** 3D 에 넘길 무선 표식 — 시뮬레이션은 켰을 때만 · 추적 환자는 주황 */
export function wifiFixMarks(rows: WifiFixRow[], showSimulated: boolean, tracked: string | null): WifiFixMark[] {
  return rows.filter((r) => r.source === 'OBSERVED_WIFI' || (showSimulated && r.source === 'SIMULATED'))
    .map((r) => ({ floorKey: r.floorKey, x: r.x, y: r.y, accuracyM: r.accuracyM, simulated: r.source === 'SIMULATED', tracked: !!tracked && r.patientId === tracked }));
}

/** 오늘(KST) YYYY-MM-DD — 이동 경로 조회용 */
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/** 환자 위치 원장 조회 권한 — API(`metaverse/patients` @Roles)와 같다. 상황판 자체는 약사·검사도 보지만 위치는 못 본다 */
export const PATIENT_LAYER_ROLES = ['ADMIN', 'DOCTOR', 'NURSE'] as const;

/** 진료실 판정 → 3D 색 — 목표 초과만 주황, 목표 이내는 초록, 대기 없음은 칠하지 않는다(단계를 지어내지 않는다) */
export function roomHeat(load: SpaceLoad | undefined): Map<string, HeatLevel> {
  const m = new Map<string, HeatLevel>();
  for (const r of load?.rooms ?? []) {
    if (r.level === 'OVER_TARGET') m.set(r.spaceNodeId, 'HIGH');
    else if (r.level === 'WITHIN_TARGET') m.set(r.spaceNodeId, 'LOW');
  }
  return m;
}

/** 공간에 놓은 대기 수 / 오늘 대기 전체 — 못 놓은 것이 0 으로 사라지지 않게 */
export function placedQueueCount(load: SpaceLoad): number {
  return load.rooms.reduce((s, r) => s + r.waiting + r.called + r.inConsultation, 0);
}

/**
 * 통합 상황판 — 3D 건물 보기(2026-10-01 · 보조 보기).
 *  ① 진료실·검진 스테이션 부하 — **업무 원장**(대기열·스테이션 기록)으로 색을 칠한다. 기준은 정본 흐름 목표(출처를 밝힌다)뿐.
 *  ② 환자 위치 층 — 관측과 추정을 갈라 그린다(추정은 기본 숨김) · 관측 비율을 밝힌다.
 * 🔴 공간에 못 놓는 것(진료실 미지정·미연결)은 0 으로 사라지지 않고 센다 · 도면이 합성이면 그렇다고 말한다(3D 컴포넌트가 무대에 표시).
 */
export function Building3DSection() {
  const role = useAuthStore((s) => s.user?.role ?? '');
  const canSeePatients = (PATIENT_LAYER_ROLES as readonly string[]).includes(role);
  const [open, setOpen] = useState(false);
  const [floorKey, setFloorKey] = useState<string | null>(null);
  const [showPatients, setShowPatients] = useState(false);
  const [showInferred, setShowInferred] = useState(false);
  // 🔴 시뮬레이션(데모 생성기) 위치 — 리얼 모드가 아니면 기본으로 보인다(관측이 없는 데모에서 아무것도 안 보이면 기능이 없는 것처럼 읽힌다).
  //    리얼 모드엔 시뮬레이션이 원장에 없어야 하고, 기본 숨김이다. 언제나 "실제 위치 아님"을 함께 말한다.
  const { effective: hisMode } = useHisMode({ enabled: open });
  const [simChoice, setSimChoice] = useState<boolean | null>(null);
  const showSimulated = simChoice ?? hisMode !== 'REAL';
  const [tracked, setTracked] = useState<string | null>(null);
  const [showWifi, setShowWifi] = useState(false);

  const geoQ = useGeometry();
  const geo = (geoQ.data?.data ?? null) as Geometry | null;
  const loadQ = useQuery({
    queryKey: ['command-center-space-load'],
    queryFn: () => apiClient.get<{ data: SpaceLoad }>('/api/v1/command-center/space-load'),
    enabled: open,
    refetchInterval: pollMs('normal'),
  });
  const patientsQ = useQuery({
    queryKey: ['command-center-3d-patients'],
    queryFn: () => apiClient.get<{ data: PatientLoc[]; meta?: PatientLocMeta }>('/api/v1/metaverse/patients'),
    enabled: open && canSeePatients && showPatients && !!geo,
    refetchInterval: pollMs('fast'),
  });

  // 무선 AP 측위 층 — 켰을 때만 부른다(AP 등록부·최근 측위·추적 환자 궤적)
  const wifiOn = open && canSeePatients && showWifi && !!geo;
  const apsQ = useQuery({
    queryKey: ['command-center-3d-wifi-aps'],
    queryFn: () => apiClient.get<{ data: WifiApRow[] }>('/api/v1/location/wifi/access-points').then((r) => r.data ?? []),
    enabled: wifiOn,
  });
  const liveQ = useQuery({
    queryKey: ['command-center-3d-wifi-live'],
    queryFn: () => apiClient.get<{ data: WifiFixRow[]; meta: WifiLiveMeta }>('/api/v1/location/wifi/live?minutes=10'),
    enabled: wifiOn,
    refetchInterval: pollMs('fast'),
  });
  const wifiTrailQ = useQuery({
    queryKey: ['command-center-3d-wifi-trail', tracked, kstToday()],
    queryFn: () => apiClient.get<{ data: WifiFixRow[] }>(`/api/v1/location/wifi/trail?patientId=${tracked}&date=${kstToday()}`).then((r) => r.data ?? []),
    enabled: wifiOn && !!tracked,
    refetchInterval: pollMs('fast'),
  });
  const wifiAps: WifiApMark[] | undefined = wifiOn && apsQ.data
    ? apsQ.data.filter((a) => a.isActive).map((a) => ({ floorKey: a.floorKey, x: a.x, y: a.y, calibrated: a.rssiAt1m != null && a.pathLossExponent != null }))
    : undefined;
  const liveRows = (liveQ.data?.data ?? []) as WifiFixRow[];
  const wifiFixes = wifiOn && liveQ.data ? wifiFixMarks(liveRows, showSimulated, tracked) : undefined;
  const wifiTrail = wifiOn && tracked && wifiTrailQ.data ? wifiTrailQ.data.filter((r) => r.source === 'OBSERVED_WIFI' || showSimulated) : undefined;
  const trackedFix = tracked ? liveRows.find((r) => r.patientId === tracked) ?? null : null;

  const load = loadQ.data?.data;
  const heat = useMemo(() => roomHeat(load), [load]);
  const beds = useMemo(() => bedMarks(load), [load]);
  /**
   * 🔴 "현재 위치" 판정은 **서버 정본**(`floor/current-location.ts` — 열린 기록 중 오늘 들어왔거나 재원·응급 진행 중)이다(2026-10-03).
   *    종전엔 이 화면만 "오늘 기록만"으로 걸렀다(2026-10-02 사용자 결정) — 정본이 둘이었고, 여러 날 재원 중인 입원 환자를 숨겼다.
   *    오래된 열린 기록(떠났는지 모름)은 서버가 싣지 않고 수(`meta.staleOpen`)로 준다 — 그 수를 그대로 말한다.
   */
  const patients = useMemo(() => {
    // 🔴 세 갈래 — 관측(QR·스테이션·직원 입력) / 추정(여정 이벤트) / 시뮬레이션(데모 생성기). 시뮬레이션을 추정에 섞지 않는다.
    const byZone = new Map<string, { observed: number; inferred: number; simulated: number }>();
    let floorOnly = 0, observed = 0, inferred = 0, simulated = 0;
    for (const p of (patientsQ.data?.data ?? []) as PatientLoc[]) {
      if (p.granularity === 'FLOOR') { floorOnly++; continue; }
      const cur = byZone.get(p.zoneId) ?? { observed: 0, inferred: 0, simulated: 0 };
      if (isObservedLocation(p.source)) { cur.observed++; observed++; }
      else if (p.source === 'SIMULATED') { cur.simulated++; simulated++; }
      else { cur.inferred++; inferred++; }
      byZone.set(p.zoneId, cur);
    }
    const meta = (patientsQ.data as { meta?: PatientLocMeta } | undefined)?.meta;
    return { byZone, floorOnly, observed, inferred, simulated, staleOpen: meta?.staleOpen ?? null, truncated: meta?.truncated === true };
  }, [patientsQ.data]);

  // 추적 중인 환자의 지금 구역 — 3D 에서 그 방을 강조한다
  const trackedZone = tracked ? ((patientsQ.data?.data ?? []) as PatientLoc[]).find((p) => p.patientId === tracked)?.zoneId ?? null : null;

  return (
    <section id="building-3d" className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-cc-3d>
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-slate-900"><T k="3D 건물 보기" /></h2>
        <span className="text-[11px] text-slate-500"><T k="보조 보기 — 진료실·검진 스테이션 부하를 도면 위에 · 정본은 위 카드" /></span>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="ml-auto min-h-[36px] rounded-lg border border-slate-200 px-3 text-xs hover:bg-slate-50">
          {open ? <T k="접기" /> : <T k="3D 로 열기" />}
        </button>
      </header>

      {open && (
        <div className="mt-3 space-y-3">
          {geoQ.isError ? <QueryErrorFallback error={geoQ.error} onRetry={() => geoQ.refetch()} size="compact" />
            : geoQ.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-slate-100" aria-busy="true" />
            : !geo ? <p className="text-xs text-slate-500"><T k="확정된 도면이 없어 3D 로 그릴 수 없습니다" /></p>
            : (
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
                {/* 🔴 (2026-10-02 실화면) `1fr` 은 최소 폭이 내용 폭이라, 렌더러가 캔버스에 박은 픽셀 폭이 칸을 줄지 못하게 막아
                    섹션이 화면보다 넓어졌다 — 오른쪽 패널(색 기준·진료실·병상·환자 위치)이 화면 밖으로 잘렸다. minmax(0,1fr) */}
                <div className="min-w-0"><FloorStackWebGL floors={[...geo.floors].sort((a, b) => a.level - b.level)} selectedKey={floorKey}
                  onSelectFloor={setFloorKey} notice={geo.notice}
                  heat={heat} beds={beds.size ? beds : undefined} patients={canSeePatients && showPatients ? patients.byZone : undefined} showInferred={showInferred}
                  showSimulated={showSimulated} highlightSpaceNodeId={trackedZone}
                  wifiAps={wifiAps} wifiFixes={wifiFixes} wifiTrail={wifiTrail} /></div>
                <aside className="space-y-3 text-xs" data-cc-3d-aside>
                  {loadQ.isError ? <QueryErrorFallback error={loadQ.error} onRetry={() => loadQ.refetch()} size="compact" />
                    : !load ? <div className="h-24 animate-pulse rounded-xl bg-slate-100" aria-busy="true" />
                    : <LoadPanel load={load} />}
                  <PatientLayer canSee={canSeePatients} show={showPatients} onShow={setShowPatients} showInferred={showInferred} onShowInferred={setShowInferred}
                    showSimulated={showSimulated} onShowSimulated={setSimChoice}
                    counts={patients} isError={patientsQ.isError} error={patientsQ.error} onRetry={() => patientsQ.refetch()} loading={patientsQ.isLoading && showPatients} />
                  {canSeePatients && (
                    <WifiLayer show={showWifi} onShow={setShowWifi} aps={apsQ.data ?? null} error={apsQ.isError ? apsQ.error : liveQ.isError ? liveQ.error : null}
                      live={liveQ.data ? { rows: liveRows, meta: liveQ.data.meta } : null} onRetry={() => { apsQ.refetch(); liveQ.refetch(); }}
                      showSimulated={showSimulated} />
                  )}
                  {canSeePatients && showPatients && !patientsQ.isError && (
                    <PatientTracker rows={(patientsQ.data?.data ?? []) as PatientLoc[]} tracked={tracked}
                      onTrack={(id, zoneId) => { setTracked(id); const f = zoneId ? floorOfZone(geo, zoneId) : null; if (f) setFloorKey(f); }}
                      showInferred={showInferred} showSimulated={showSimulated} wifiFix={showWifi ? trackedFix : undefined} />
                  )}
                </aside>
              </div>
            )}
        </div>
      )}
    </section>
  );
}

function LoadPanel({ load }: { load: SpaceLoad }) {
  const placed = placedQueueCount(load);
  const notLinkedQueue = load.unplaced.queueRoomNotLinked.reduce((s, r) => s + r.count, 0);
  return (
    <div className="space-y-2">
      <p className="text-slate-600" data-cc-3d-target>
        <Tf k="색 기준 — 가장 오래 기다린 대기가 목표 {분}분을 넘으면 주황" params={{ 분: load.target.opdWaitMin }} />
        {' · '}{load.target.source === 'CONFIG' ? <T k="원내 설정값" /> : <span className="text-amber-700"><T k="코드 기본값(원내 미설정)" /></span>}
      </p>
      <div>
        <p className="mb-1 font-semibold text-slate-800"><T k="진료실" /></p>
        {load.rooms.length === 0 ? <p className="text-slate-500"><T k="공간에 놓인 진료실의 오늘 대기가 없습니다" /></p> : (
          <ul className="space-y-1">
            {load.rooms.map((r) => (
              <li key={r.spaceNodeId} className="flex flex-wrap items-center gap-x-2" data-cc-3d-room={r.level}>
                <span className={`h-2 w-2 rounded-full ${r.level === 'OVER_TARGET' ? 'bg-orange-500' : r.level === 'WITHIN_TARGET' ? 'bg-green-500' : 'bg-slate-300'}`} aria-hidden />
                <span className="font-medium text-slate-800">{r.name}</span>
                <span className="text-slate-500"><Tf k="대기 {대기} · 호출 {호출} · 진료 중 {진료}" params={{ 대기: r.waiting, 호출: r.called, 진료: r.inConsultation }} /></span>
                {r.longestWaitMin != null && <span className="text-slate-500"><Tf k="최장 {분}분" params={{ 분: r.longestWaitMin }} /></span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-1 font-semibold text-slate-800"><T k="검진 스테이션" /> <span className="font-normal text-slate-400"><T k="(기준이 없어 색을 칠하지 않음)" /></span></p>
        {load.stations.length === 0 ? <p className="text-slate-500"><T k="공간에 놓인 스테이션의 오늘 대기가 없습니다" /></p> : (
          <ul className="space-y-1">
            {load.stations.map((s) => (
              <li key={s.spaceNodeId}><span className="font-medium text-slate-800">{s.name}</span> <span className="text-slate-500"><Tf k="대기 {대기} · 검사 중 {진행}" params={{ 대기: s.waiting, 진행: s.inProgress }} /></span></li>
            ))}
          </ul>
        )}
      </div>
      <BedPanel load={load} />
      {/* 🔴 공간에 못 놓은 것 — 0 으로 사라지지 않게 분모와 함께 */}
      <div className="rounded-lg bg-amber-50 p-2 text-amber-900" data-cc-3d-unplaced>
        <p><Tf k="오늘 대기 {전체}건 중 도면에 놓은 것 {놓음}건" params={{ 전체: load.queueTotal, 놓음: placed }} /></p>
        {load.unplaced.queueWithoutRoom > 0 && <p><Tf k="진료실 미지정 {수}건(접수 때 진료 일정에 진료실이 없었다)" params={{ 수: load.unplaced.queueWithoutRoom }} /></p>}
        {notLinkedQueue > 0 && <p><Tf k="공간에 연결되지 않은 진료실의 대기 {수}건" params={{ 수: notLinkedQueue }} /> ({load.unplaced.queueRoomNotLinked.slice(0, 3).map((r) => r.roomName).join(', ')}{load.unplaced.queueRoomNotLinked.length > 3 ? ' …' : ''})</p>}
        {load.unplaced.stationsNotLinked > 0 && <p><Tf k="공간에 연결되지 않은 검진 스테이션 {수}곳" params={{ 수: load.unplaced.stationsNotLinked }} /></p>}
      </div>
    </div>
  );
}

function PatientLayer({ canSee, show, onShow, showInferred, onShowInferred, showSimulated, onShowSimulated, counts, isError, error, onRetry, loading }: {
  canSee: boolean; show: boolean; onShow: (v: boolean) => void; showInferred: boolean; onShowInferred: (v: boolean) => void;
  showSimulated: boolean; onShowSimulated: (v: boolean) => void;
  counts: { floorOnly: number; observed: number; inferred: number; simulated: number; staleOpen: number | null; truncated: boolean }; isError: boolean; error: unknown; onRetry: () => void; loading: boolean;
}) {
  if (!canSee) return <p className="text-slate-500" data-cc-3d-patients="no-role"><T k="환자 위치 층은 의사·간호사·관리자만 볼 수 있습니다" /></p>;
  const total = counts.observed + counts.inferred;
  return (
    <div className="space-y-1.5 border-t border-slate-100 pt-2" data-cc-3d-patients>
      <label className="flex items-center gap-2"><input type="checkbox" checked={show} onChange={(e) => onShow(e.target.checked)} /> <T k="환자 위치 표시" /></label>
      {show && (
        <>
          <label className="flex items-center gap-2 pl-5"><input type="checkbox" checked={showInferred} onChange={(e) => onShowInferred(e.target.checked)} /> <T k="추정 위치도 표시(빈 회색 고리)" /></label>
          <label className="flex items-center gap-2 pl-5" data-cc-3d-sim-toggle><input type="checkbox" checked={showSimulated} onChange={(e) => onShowSimulated(e.target.checked)} /> <T k="시뮬레이션 위치 표시(보라 반투명 · 데모 — 실제 위치 아님)" /></label>
          {isError ? <QueryErrorFallback error={error} onRetry={onRetry} size="compact" />
            : loading ? <p className="text-slate-400" aria-busy="true"><T k="불러오는 중…" /></p>
            : (
              <p className="text-slate-600" data-cc-3d-patient-counts>
                <Tf k="관측 {관측}명 · 추정 {추정}명 · 시뮬레이션 {시뮬}명" params={{ 관측: counts.observed, 추정: counts.inferred, 시뮬: counts.simulated }} />
                {total + counts.simulated > 0 && counts.observed / (total + counts.simulated) < 0.5 && <span className="text-amber-700"> · <T k="대부분 추정 위치입니다(이벤트·시뮬레이션) — 실제 위치로 읽지 마십시오" /></span>}
                {counts.observed === 0 && <span className="block text-slate-500" data-cc-3d-no-observed><T k="관측 위치 0 — 실제 실시간 위치는 QR 체크인·검진 스테이션 도착·위치 관측 장치 연동이 있어야 나옵니다" /></span>}
                {counts.floorOnly > 0 && <> · <Tf k="층까지만 아는 {수}명은 방에 그리지 않음" params={{ 수: counts.floorOnly }} /></>}
              </p>
            )}
          {!isError && !loading && (
            <p className="text-slate-500" data-cc-3d-patient-stale>
              <T k="현재 위치로 볼 근거가 있는 기록만 그립니다(오늘 들어왔거나 재원·응급 진행 중) — 외래는 오늘 이미 떠났을 수 있습니다" />
              {counts.staleOpen != null && counts.staleOpen > 0 && <> · <Tf k="오래된 열린 위치 {수}건 — 떠났는지 모름(그리지 않음)" params={{ 수: counts.staleOpen }} /></>}
              {counts.truncated && <> · <T k="위치가 많아 일부만 그렸습니다" /></>}
            </p>
            )}
        </>
      )}
    </div>
  );
}

/**
 * 무선 AP 측위 층(2026-10-09) — AP 표식·최근 10분 측위 점·오차 반경.
 * 🔴 측위는 근사다 — 점마다 오차 반경 원을 함께 그리고, 교정 안 된 AP 수를 말한다 · AP 가 없으면 측위할 수 없다고 말한다(빈 화면을 "환자 없음"으로 읽히지 않게).
 */
function WifiLayer({ show, onShow, aps, error, live, onRetry, showSimulated }: {
  show: boolean; onShow: (v: boolean) => void; aps: WifiApRow[] | null; error: unknown;
  live: { rows: WifiFixRow[]; meta: WifiLiveMeta } | null; onRetry: () => void; showSimulated: boolean;
}) {
  const active = (aps ?? []).filter((a) => a.isActive);
  const uncal = active.filter((a) => a.rssiAt1m == null || a.pathLossExponent == null).length;
  const seeded = active.filter((a) => a.dataOrigin === 'SEED').length;
  const observed = (live?.rows ?? []).filter((r) => r.source === 'OBSERVED_WIFI').length;
  const simulated = (live?.rows ?? []).filter((r) => r.source === 'SIMULATED').length;
  const fingerprint = (live?.rows ?? []).filter((r) => r.method === 'FINGERPRINT_KNN_V1').length;
  return (
    <div className="space-y-1.5 border-t border-slate-100 pt-2" data-cc-3d-wifi>
      <label className="flex items-center gap-2"><input type="checkbox" checked={show} onChange={(e) => onShow(e.target.checked)} /> <T k="무선 AP 측위 표시(AP·측위 점·오차 반경)" /></label>
      {show && (error ? <QueryErrorFallback error={error} onRetry={onRetry} size="compact" />
        : !aps || !live ? <p className="text-slate-400" aria-busy="true"><T k="불러오는 중…" /></p>
        : active.length === 0 ? <p className="text-amber-700" data-cc-3d-wifi-no-ap><T k="등록된 무선 AP 가 없습니다 — AP 를 등록해야 측위할 수 있습니다(관리: 무선 위치)" /></p>
        : (
          <div className="space-y-1 text-slate-600" data-cc-3d-wifi-counts>
            <p><Tf k="AP {수}대" params={{ 수: active.length }} />{uncal > 0 && <> · <Tf k="교정 안 됨 {수}대(기본 전파 모델 — 오차 반경은 근사)" params={{ 수: uncal }} /></>}{seeded > 0 && <> · <Tf k="데모 배치 {수}대(실제 설치 아님)" params={{ 수: seeded }} /></>}</p>
            <p><Tf k="최근 {분}분 측위 — 관측 {관측}명 · 시뮬레이션 {시뮬}명" params={{ 분: live.meta.windowMin, 관측: observed, 시뮬: simulated }} />
              {!showSimulated && simulated > 0 && <> · <T k="시뮬레이션은 숨김" /></>}
              {live.meta.truncated && <> · <T k="측위가 많아 일부만 그렸습니다" /></>}</p>
            <p data-cc-3d-wifi-fingerprint={fingerprint}>{fingerprint > 0
              ? <Tf k="신호 지도(현장 측정 표본)로 잡은 측위 {수}명 · 나머지는 전파 모델" params={{ 수: fingerprint }} />
              : <T k="모두 전파 모델(가중 중심) 측위 — 현장 측정 표본이 있는 층만 신호 지도로 바뀝니다" />}</p>
            {observed === 0 && <p className="text-slate-500" data-cc-3d-wifi-no-observed><T k="무선 관측 0 — 수집기 연동·위치 수집 설정·환자 단말 연결(동의)이 모두 있어야 실제 위치가 나옵니다" /></p>}
            <p className="flex flex-wrap gap-x-2 text-[10px] text-slate-500">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-600" /><T k="관측" /></span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-purple-500" /><T k="시뮬레이션" /></span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" /><T k="추적 중" /></span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-indigo-800" /><T k="AP(교정됨)" /></span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-500" /><T k="AP(교정 안 됨)" /></span>
            </p>
          </div>
        ))}
    </div>
  );
}

const BED_LABEL: Record<BedMark, string> = {
  OCCUPIED: '점유', AVAILABLE: '빈 병상', RESERVED: '예약', CLEANING: '청소 중', MAINTENANCE: '정비', ISOLATION: '격리', MISMATCH: '상태 불일치',
};

/** 병상 — 도면에 놓인 것 요약 · 응급실은 구역별(도면에 구역 칸이 없어 한 공간) · 미연결은 병동별로 센다 */
function BedPanel({ load }: { load: SpaceLoad }) {
  const rooms = load.bedRooms ?? [];
  const all = rooms.flatMap((r) => r.beds);
  const placed = all.length;
  const count = (st: BedMark, xs = all) => xs.filter((b) => b.state === st).length;
  const er = rooms.filter((r) => r.emergency).flatMap((r) => r.beds);
  const erZones = new Map<string, { occ: number; total: number }>();
  for (const b of er) {
    const z = b.label.split('-')[0];
    const cur = erZones.get(z) ?? { occ: 0, total: 0 };
    cur.total++; if (b.state === 'OCCUPIED') cur.occ++;
    erZones.set(z, cur);
  }
  const unlinked = (load.bedsUnlinked ?? []).reduce((s, w) => s + w.count, 0);
  if (load.bedsTotal == null) return null;
  return (
    <div data-cc-3d-beds>
      <p className="mb-1 font-semibold text-slate-800"><T k="병상" /></p>
      <p className="text-slate-600"><Tf k="병상 {전체}개 중 도면에 놓은 것 {놓음}개" params={{ 전체: load.bedsTotal, 놓음: placed }} /></p>
      {placed > 0 && (
        <p className="text-slate-600"><Tf k="점유 {점유} · 빈 병상 {빈} · 청소 중 {청소}" params={{ 점유: count('OCCUPIED'), 빈: count('AVAILABLE'), 청소: count('CLEANING') }} /></p>
      )}
      {erZones.size > 0 && (
        <p className="text-slate-600" data-cc-3d-er>
          <T k="응급실(도면에 구역 칸이 없어 한 공간)" />{': '}
          {[...erZones.entries()].map(([z, v]) => `${z} ${v.occ}/${v.total}`).join(' · ')}
        </p>
      )}
      {count('MISMATCH') > 0 && <p className="text-rose-700" data-cc-3d-mismatch><Tf k="상태 불일치 {수}개(점유로 표시됐지만 활성 배정이 없음)" params={{ 수: count('MISMATCH') }} /></p>}
      {unlinked > 0 && (
        <p className="text-amber-700" data-cc-3d-beds-unlinked>
          <Tf k="도면에 연결되지 않은 병상 {수}개" params={{ 수: unlinked }} /> ({(load.bedsUnlinked ?? []).slice(0, 3).map((w) => `${w.ward} ${w.count}`).join(', ')})
        </p>
      )}
      {placed > 0 && (
        <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
          {(Object.keys(BED_LABEL) as BedMark[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: BED_COLOR[k] }} /><T k={BED_LABEL[k]} /></span>
          ))}
        </p>
      )}
    </div>
  );
}

/** 구역이 놓인 도면 층 키 */
function floorOfZone(geo: Geometry | null, zoneId: string): string | null {
  for (const f of geo?.floors ?? []) if (f.spaces.some((sp) => sp.spaceNodeId === zoneId) || f.spaceNodeId === zoneId) return f.key;
  return null;
}

/**
 * 환자 추적(2026-10-09) — 지금 위치가 있는 환자를 골라 3D 에서 그 방을 강조하고, 오늘 이동 경로를 시간순으로 보인다.
 * 🔴 출처를 줄마다 밝힌다(관측·추정·시뮬레이션) · 이름은 가린다(큰 화면 · 관제 모드와 같은 규칙) · 화면에 보이는 출처만 목록에 싣는다.
 */
function PatientTracker({ rows, tracked, onTrack, showInferred, showSimulated, wifiFix }: {
  rows: PatientLoc[]; tracked: string | null; onTrack: (patientId: string | null, zoneId: string | null) => void; showInferred: boolean; showSimulated: boolean;
  /** 무선 층을 켰을 때만 — undefined 면 말하지 않음 · null 이면 최근 측위 없음 */
  wifiFix?: WifiFixRow | null;
}) {
  const tAttr = useTAttr();
  const [q, setQ] = useState('');
  const visible = rows.filter((r) => r.patientId && r.granularity !== 'FLOOR'
    && (isObservedLocation(r.source) || (r.source === 'SIMULATED' ? showSimulated : showInferred)));
  const needle = q.trim();
  const list = (needle ? visible.filter((r) => (r.patientName ?? '').includes(needle) || (r.mrn ?? '').includes(needle) || (r.zoneName ?? '').includes(needle)) : visible).slice(0, 30);
  const trail = useQuery({
    enabled: !!tracked,
    queryKey: ['command-center-3d-trail', tracked, kstToday()],
    queryFn: () => apiClient.get<{ data: TrailRow[] }>(`/api/v1/metaverse/patients/${tracked}/trail?date=${kstToday()}`).then((r) => r.data ?? []),
    refetchInterval: pollMs('fast'),
  });
  return (
    <div className="space-y-1.5 border-t border-slate-100 pt-2" data-cc-3d-tracker>
      <p className="font-semibold text-slate-700"><T k="환자 추적" /> <span className="font-normal text-slate-400">({visible.length})</span></p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tAttr('이름·등록번호·구역')} aria-label={tAttr('환자 찾기')} className="w-full rounded border border-slate-200 px-2 py-1" />
      {visible.length === 0 ? <p className="text-slate-400" data-cc-3d-tracker-empty><T k="지금 그릴 수 있는 위치가 있는 환자가 없습니다" /></p> : (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto">
          {list.map((r) => (
            <li key={r.patientId}>
              <button type="button" onClick={() => onTrack(tracked === r.patientId ? null : r.patientId!, r.zoneId)} data-cc-3d-track={r.patientId}
                className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left ${tracked === r.patientId ? 'bg-indigo-50 text-indigo-800' : 'hover:bg-slate-50'}`}>
                <span className="font-medium">{maskPatientName(r.patientName ?? '')}</span>
                <span className="text-slate-400">{r.mrn ? `…${r.mrn.slice(-4)}` : ''}</span>
                <span className="ml-auto truncate text-slate-500">{r.zoneName ?? ''}</span>
                <span className={`rounded px-1 text-[10px] ${isObservedLocation(r.source) ? 'bg-blue-50 text-blue-700' : r.source === 'SIMULATED' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>
                  <T k={LOCATION_SOURCE_LABEL[(r.source ?? 'UNKNOWN') as LocationSource] ?? String(r.source)} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {tracked && (
        <div className="rounded-lg bg-slate-50 p-2" data-cc-3d-trail>
          {wifiFix !== undefined && (
            <p className="mb-1 text-slate-600" data-cc-3d-tracked-wifi>
              {wifiFix == null ? <T k="최근 10분 무선 측위 없음" /> : (
                <>
                  <T k="무선 측위" /> ±<Num value={wifiFix.accuracyM} domain="positionMeters" /> · <Tf k="AP {수}대" params={{ 수: wifiFix.apCount }} />
                  {' · '}<T k={LOCATION_SOURCE_LABEL[wifiFix.source]} />
                  {/* 측위 방법 — 신호 지도(현장 측정 표본)와 전파 모델을 구분한다(2026-10-10) */}
                  {wifiFix.method && <span data-cc-3d-wifi-method={wifiFix.method}> · <T k={WIFI_FIX_METHOD_LABEL[wifiFix.method]} /></span>}
                  {wifiFix.uncalibrated && <> · <T k="교정 안 됨" /></>}
                  {wifiFix.granularity === 'FLOOR' && <> · <T k="오차가 커서 층까지만" /></>}
                  {/* 마지막 관측 경과(2026-10-10) — "지금 여기"가 몇 분 전 관측인지 말한다 · 미래·모름은 표시하지 않는다 */}
                  {(() => { const age = wifiFixAgeMinutes(wifiFix.observedAt, Date.now()); return age == null ? null : <span data-cc-3d-wifi-age={age}> · {age === 0 ? <T k="방금 관측" /> : <Tf k="{분}분 전 관측" params={{ 분: age }} />}</span>; })()}
                </>
              )}
            </p>
          )}
          <p className="mb-1 font-semibold text-slate-700"><T k="오늘 이동 경로" /></p>
          {trail.isError ? <QueryErrorFallback error={trail.error} onRetry={() => trail.refetch()} size="compact" />
            : !trail.data ? <p className="text-slate-400" aria-busy="true"><T k="불러오는 중…" /></p>
            : trail.data.length === 0 ? <p className="text-slate-400"><T k="오늘 기록된 이동이 없습니다" /></p>
            : (
              <ol className="space-y-0.5">
                {trail.data.map((t, i) => (
                  <li key={`${t.zoneId}-${t.enteredAt}-${i}`} className="flex gap-1.5" data-cc-3d-trail-row={t.source ?? ''}>
                    <span className="tabular-nums text-slate-500"><KDate value={t.enteredAt} mode="time" /></span>
                    <span className="flex-1 truncate">{t.zoneName ?? ''}</span>
                    <span className="text-slate-400">{t.leftAt ? (t.duration != null ? <Tf k="{분}분" params={{ 분: t.duration }} /> : '') : <T k="지금" />}</span>
                    <span className={`text-[10px] ${isObservedLocation(t.source) ? 'text-blue-700' : t.source === 'SIMULATED' ? 'text-violet-700' : 'text-slate-500'}`}>
                      <T k={LOCATION_SOURCE_LABEL[(t.source ?? 'UNKNOWN') as LocationSource] ?? String(t.source)} />
                    </span>
                  </li>
                ))}
              </ol>
            )}
        </div>
      )}
    </div>
  );
}
