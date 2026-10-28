'use client';

/**
 * 병원 공간 뷰어(메타버스) — 확정 도면 위 환자 동선·혼잡도·자산. 기획 spatial-flow-vision-3d P2.
 *
 * 🔴 정직 표기:
 *   - 지표는 **관측/추정을 나눠** 말한다(현재 위치의 대부분은 이벤트 번역 추정이다 — P0 실측).
 *   - 관측 비율은 분모와 함께(`<Ratio>` — 분모 0 = 산출 불가) · 정원 미설정 구역은 혼잡도에서 따로 센다.
 *   - 격자 배치 탭은 **도면이 아니다** — 그 사실을 탭 안에서 말한다.
 *   - 조회 실패는 0 이 아니다(각 지표가 실패를 따로 말한다).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LOCATION_SOURCE_LABEL, isObservedLocation, type LocationSource } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { Duration, EmptyState, Ratio, Unit } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf } from '@/components/ui/i18n-text';
import { SpaceViewer, useGeometry } from '@/components/space/SpaceViewer';

interface Zone { id: string; name: string; zoneType: string; roomNumber?: string }
interface FloorData { floor: number; name: string; zones: Zone[] }
interface Structure { hospitalName: string; totalZones: number; floors: FloorData[] }

interface PatientLoc {
  id: string;
  patientName: string;
  mrn?: string;
  zoneId: string;
  zoneName?: string;
  zoneType?: string;
  floor?: number;
  status: string;
  duration: number;
  source?: LocationSource;
  granularity?: 'ZONE' | 'FLOOR';
}

interface HeatmapItem {
  zoneId: string;
  zoneName?: string;
  floor?: number;
  currentCount: number;
  observedCount?: number;
  /** 정원 미설정 = null(점유율 산출 불가 — 종전 10 을 지어냈다) */
  capacity: number | null;
  occupancy: number | null;
  level: string;
}

/** 위치 출처 배지 — 추정을 관측처럼 그리지 않는다 */
function SourceBadge({ source }: { source?: LocationSource }) {
  if (!source) return null;
  const observed = isObservedLocation(source);
  return (
    <span className={`ml-1 text-[9px] px-1 py-0.5 rounded border whitespace-nowrap ${observed ? 'border-emerald-300 text-emerald-700' : 'border-dashed border-gray-300 text-gray-500'}`}>
      <T k={LOCATION_SOURCE_LABEL[source]} />
    </span>
  );
}

const ZONE_COLORS: Record<string, string> = {
  LOBBY: '#e0e7ff', RECEPTION: '#dbeafe', CLINIC: '#dcfce7', WAITING: '#fef9c3',
  LAB: '#f3e8ff', IMAGING: '#cffafe', PHARMACY: '#fce7f3', CASHIER: '#fed7aa',
  WARD: '#e0f2fe', SURGERY: '#fecaca', ER: '#fee2e2', ICU: '#fecdd3',
  ELEVATOR: '#f3f4f6', OTHER: '#f9fafb',
};

const STATUS_LABEL: Record<string, string> = {
  WAITING: '대기', IN_CONSULTATION: '진료 중', IN_LAB: '검사 중',
  IN_IMAGING: '영상 촬영', IN_SURGERY: '수술 중', MOVING: '이동 중',
  RESTING: '안정', DISCHARGED: '퇴원',
};

const LEVEL_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-500', HIGH: 'bg-orange-400', MEDIUM: 'bg-yellow-400', LOW: 'bg-emerald-400',
  UNKNOWN: 'bg-gray-300', // 정원 미설정 — 초록(여유)으로 그리지 않는다
};

type ViewTab = 'drawing' | 'patients' | 'heatmap' | 'dwell' | 'map';
type SourceFilter = 'ALL' | 'OBSERVED' | 'INFERRED';
const SOURCE_FILTER_LABEL: Record<SourceFilter, string> = { ALL: '전체', OBSERVED: '관측만', INFERRED: '추정·기타' };

interface DwellStat { n: number; p50: number | null; p90: number | null; open: number; invalid: number }
interface DwellData {
  windowDays: number;
  minSample: number;
  zones: { zoneId: string; name: string | null; floor: number | null; observed: DwellStat; inferred: DwellStat }[];
  rankedZones: number;
  totals: { observed: number; inferred: number };
  excluded: { simulated: number; unknown: number; floorOnly: number };
}

/** p50/p90 한 칸 — 표본 부족이면 값 대신 "표본 부족 n/최소"(0 으로도 폴백으로도 그리지 않는다) */
function DwellCells({ s, min, muted = false }: { s: DwellStat; min: number; muted?: boolean }) {
  const tone = muted ? 'text-gray-500' : 'text-gray-900';
  if (s.p50 == null) {
    return (
      <td colSpan={2} className="px-3 py-2 text-center text-[11px] text-gray-400">
        <Tf k="표본 부족 ({n}/{최소})" params={{ n: s.n, 최소: min }} />
      </td>
    );
  }
  return (<>
    <td className={`px-3 py-2 text-right ${tone}`}><Duration minutes={s.p50} /></td>
    <td className={`px-3 py-2 text-right font-semibold ${tone}`}><Duration minutes={s.p90} /></td>
  </>);
}

function Kpi({ label, children, sub, tone = 'slate' }: { label: React.ReactNode; children: React.ReactNode; sub?: React.ReactNode; tone?: 'slate' | 'blue' | 'amber' | 'violet' }) {
  const ring = { slate: 'from-slate-50', blue: 'from-blue-50', amber: 'from-amber-50', violet: 'from-violet-50' }[tone];
  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${ring} to-white p-4`}>
      <p className="text-[11px] font-medium text-gray-500">{label}</p>
      <div className="mt-1 text-2xl font-bold text-gray-900">{children}</div>
      {sub && <div className="mt-1 text-[11px] text-gray-500">{sub}</div>}
    </div>
  );
}

export default function MetaversePage() {
  const [tab, setTab] = useState<ViewTab>('drawing');
  const [selectedFloor, setSelectedFloor] = useState<number>(1);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('ALL');

  const geoQ = useGeometry();
  const geo = geoQ.data?.data ?? null;

  const structureQ = useQuery({
    queryKey: ['metaverse-structure'],
    queryFn: () => apiClient.get<{ data: Structure }>('/api/v1/metaverse/structure'),
    enabled: tab === 'map',
  });
  const structure = (structureQ.data?.data ?? null) as Structure | null;

  // 전 층 한 번에(지표·목록·격자 공용) — 층 필터는 화면에서
  const patientsQ = useQuery({
    queryKey: ['metaverse-patients-all'],
    queryFn: () => apiClient.get<{ data: PatientLoc[]; meta?: { staleOpen?: number; truncated?: boolean } }>('/api/v1/metaverse/patients'),
    refetchInterval: pollMs('fast'),
  });
  const patients = (patientsQ.data?.data ?? []) as PatientLoc[];
  // 서버 현재 위치 판정(2026-10-03) — 오래된 열린 기록은 싣지 않고 수로 준다
  const locMeta = (patientsQ.data as { meta?: { staleOpen?: number; truncated?: boolean } } | undefined)?.meta;

  const heatQ = useQuery({
    queryKey: ['metaverse-heatmap'],
    queryFn: () => apiClient.get<{ data: HeatmapItem[] }>('/api/v1/metaverse/heatmap'),
    refetchInterval: pollMs('fast'),
  });
  const heatmap = (heatQ.data?.data ?? []) as HeatmapItem[];

  const [dwellDays, setDwellDays] = useState(7);
  const dwellQ = useQuery({
    queryKey: ['metaverse-dwell', dwellDays],
    queryFn: () => apiClient.get<{ data: DwellData }>(`/api/v1/metaverse/dwell?days=${dwellDays}`),
    enabled: tab === 'dwell',
  });
  const dwell = (dwellQ.data?.data ?? null) as DwellData | null;

  const stats = useMemo(() => {
    let observed = 0, inferred = 0, zoneUnknown = 0, simulated = 0;
    for (const p of patients) {
      if (p.granularity === 'FLOOR') zoneUnknown++;
      if (p.source === 'SIMULATED') simulated++;
      else if (isObservedLocation(p.source)) observed++;
      else inferred++;
    }
    return { observed, inferred, zoneUnknown, simulated, total: patients.length };
  }, [patients]);
  const crowded = heatmap.filter((h) => h.level === 'HIGH' || h.level === 'CRITICAL').length;
  const noCapacity = heatmap.filter((h) => h.capacity == null).length;

  const listed = patients.filter((p) =>
    sourceFilter === 'ALL' ? true : sourceFilter === 'OBSERVED' ? isObservedLocation(p.source) : !isObservedLocation(p.source));

  const currentFloor = structure?.floors?.find((f) => f.floor === selectedFloor);
  const patientsInZone = selectedZone ? patients.filter((p) => p.zoneId === selectedZone) : [];

  return (
    <div className="space-y-5">
      {/* 머리 */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-3xl border bg-gradient-to-r from-indigo-50 via-white to-sky-50 p-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="메타버스 병원 뷰어" /></h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-gray-600">
            {geoQ.isError ? <span className="text-red-600"><T k="조회 실패" /></span>
              : geo ? (
                <span className={`rounded-full border px-2 py-0.5 ${geo.synthetic ? 'border-red-300 text-red-700' : 'border-emerald-300 text-emerald-700'}`}>
                  {geo.synthetic ? <T k="합성 도면" /> : <T k="확정 도면" />}
                </span>
              ) : !geoQ.isLoading && <span className="rounded-full border border-gray-300 px-2 py-0.5"><T k="확정 도면 없음" /></span>}
            <span><T k="10초 갱신" /></span>
          </div>
        </div>
        <div className="flex overflow-hidden rounded-xl border bg-white shadow-sm" role="tablist">
          {([
            { k: 'drawing' as const, l: '도면 뷰어' },
            { k: 'patients' as const, l: '환자 위치 ({수})' },
            { k: 'heatmap' as const, l: '혼잡도' },
            { k: 'dwell' as const, l: '체류 분석' },
            { k: 'map' as const, l: '구역 격자' },
          ]).map((t) => (
            <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}
              className={`min-h-[40px] px-4 text-xs font-medium transition ${tab === t.k ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              <Tf k={t.l} params={{ 수: patients.length }} />
            </button>
          ))}
        </div>
      </div>

      {/* 지표 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={<T k="현재 위치 환자" />} tone="blue"
          sub={patientsQ.isError ? <T k="조회 실패" /> : <Tf k="관측 {관측} · 추정 {추정} · 구역 미상 {미상}" params={{ 관측: stats.observed, 추정: stats.inferred, 미상: stats.zoneUnknown }} />}>
          {patientsQ.isError ? '—' : stats.total}
        </Kpi>
        <Kpi label={<T k="관측 비율" />} tone="violet" sub={<T k="QR·스테이션으로 확인된 위치의 비율(시뮬레이션 제외)" />}>
          {patientsQ.isError ? '—' : <Ratio numerator={stats.observed} denominator={stats.total - stats.simulated} pctOnly unavailableHint="현재 위치 없음" />}
        </Kpi>
        <Kpi label={<T k="혼잡 구역" />} tone="amber"
          sub={heatQ.isError ? <T k="조회 실패" /> : <Tf k="정원 미설정 {수}곳(산정 제외)" params={{ 수: noCapacity }} />}>
          {heatQ.isError ? '—' : crowded}
        </Kpi>
        <Kpi label={<T k="도면" />}>
          {geo ? <Tf k="{층}개 층" params={{ 층: geo.floors.length }} /> : '—'}
          {geo && <span className="ml-1 text-sm font-medium text-gray-500"><Tf k="공간 {수}" params={{ 수: geo.floors.reduce((n, f) => n + f.spaces.length, 0) }} /></span>}
        </Kpi>
      </div>

      {patientsQ.isError && <QueryErrorFallback error={patientsQ.error} onRetry={() => patientsQ.refetch()} size="compact" />}
      {!patientsQ.isError && patientsQ.data && (
        <p className="text-[11px] text-gray-500" data-mv-current-rule>
          <T k="현재 위치로 볼 근거가 있는 기록만 보입니다(오늘 들어왔거나 재원·응급 진행 중) — 외래는 오늘 이미 떠났을 수 있습니다" />
          {(locMeta?.staleOpen ?? 0) > 0 && <> · <Tf k="오래된 열린 위치 {수}건 — 떠났는지 모름(그리지 않음)" params={{ 수: locMeta!.staleOpen! }} /></>}
          {locMeta?.truncated && <> · <T k="위치가 많아 일부만 그렸습니다" /></>}
        </p>
      )}

      {/* 도면 뷰어(P2) */}
      {tab === 'drawing' && <SpaceViewer />}

      {/* 환자 목록 */}
      {tab === 'patients' && (
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5 border-b bg-gray-50 px-4 py-2">
            {(Object.keys(SOURCE_FILTER_LABEL) as SourceFilter[]).map((k) => (
              <button key={k} onClick={() => setSourceFilter(k)}
                className={`min-h-[32px] rounded-full border px-3 text-[11px] ${sourceFilter === k ? 'border-indigo-600 bg-indigo-600 text-white' : 'bg-white text-gray-600'}`}>
                <T k={SOURCE_FILTER_LABEL[k]} />
              </button>
            ))}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50/60">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="위치" /></th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500"><T k="체류" /></th>
              </tr>
            </thead>
            <tbody>
              {listed.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-12 text-center text-gray-400"><T k="현재 위치 환자 없음" /></td></tr>
              ) : listed.map((p) => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-gray-900">{p.patientName}</span>
                    <span className="ml-1 text-[10px] text-gray-400">{p.mrn}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-700">
                    {p.zoneName}{p.granularity === 'FLOOR' && <span className="ml-1 text-[9px] text-gray-400">(<T k="구역 미상" />)</span>}
                    <SourceBadge source={p.source} />
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="whitespace-nowrap rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                      {STATUS_LABEL[p.status] ? <T k={STATUS_LABEL[p.status]} /> : p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-gray-500">{p.duration}<Unit>분</Unit></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 혼잡도 */}
      {tab === 'heatmap' && (
        <div className="space-y-3">
          {heatQ.isError && <QueryErrorFallback error={heatQ.error} onRetry={() => heatQ.refetch()} />}
          {!heatQ.isError && heatmap.length === 0 && <EmptyState icon="📊" title="혼잡도 데이터가 없습니다" />}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {heatmap.map((h) => (
              <div key={h.zoneId} className="rounded-2xl border bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <span className="truncate text-xs font-semibold text-gray-800">{h.zoneName}</span>
                  <span className={`h-2.5 w-2.5 rounded-full ${LEVEL_COLOR[h.level] ?? LEVEL_COLOR.UNKNOWN}`} />
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <span className="text-lg font-bold text-gray-900">{h.currentCount}</span>
                    {h.capacity != null && <span className="text-[10px] text-gray-400">/{h.capacity}</span>}
                  </div>
                  {h.occupancy == null ? (
                    <span className="text-[10px] text-gray-400"><T k="정원 미설정" /></span>
                  ) : (
                    <span className={`text-xs font-bold ${h.occupancy >= 90 ? 'text-red-600' : h.occupancy >= 70 ? 'text-orange-600' : h.occupancy >= 40 ? 'text-yellow-600' : 'text-emerald-600'}`}>{h.occupancy}%</span>
                  )}
                </div>
                {h.occupancy != null && (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div className={`h-full rounded-full ${LEVEL_COLOR[h.level]}`} style={{ width: `${h.occupancy}%` }} />
                  </div>
                )}
                {h.observedCount != null && (
                  <div className="mt-1 text-[10px] text-gray-500">
                    <Tf k="관측 {관측}명 · 추정·기타 {추정}명" params={{ 관측: h.observedCount, 추정: h.currentCount - h.observedCount }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 체류 분석(P4b) — 관측·추정 분리 · 표본 부족은 값을 그리지 않는다 */}
      {tab === 'dwell' && (
        <div className="space-y-3 rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] text-gray-600">
              <T k="떠난 시각이 기록된 체류만 셉니다. 병목 순위는 관측 체류 p90 으로만 매기고, 추정(이벤트로 번역한 위치)은 체류가 아니라 이벤트 간격이라 따로 보입니다." />
            </p>
            <div className="flex gap-1" role="group">
              {[1, 7, 30].map((d) => (
                <button key={d} onClick={() => setDwellDays(d)} aria-pressed={dwellDays === d}
                  className={`min-h-[40px] rounded-lg border px-3 text-xs ${dwellDays === d ? 'border-indigo-600 bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                  <Tf k="최근 {일}일" params={{ 일: d }} />
                </button>
              ))}
            </div>
          </div>
          {dwellQ.isError && <QueryErrorFallback error={dwellQ.error} onRetry={() => dwellQ.refetch()} />}
          {dwell && (<>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
              <span><Tf k="관측 체류 {n}건" params={{ n: dwell.totals.observed }} /></span>
              <span><Tf k="추정 체류 {n}건" params={{ n: dwell.totals.inferred }} /></span>
              <span><Tf k="순위 산출 구역 {n}곳(관측 {최소}건 이상)" params={{ n: dwell.rankedZones, 최소: dwell.minSample }} /></span>
              <span><Tf k="제외: 시뮬레이션 {s} · 출처 미상 {u} · 층 단위(구역 모름) {f}" params={{ s: dwell.excluded.simulated, u: dwell.excluded.unknown, f: dwell.excluded.floorOnly }} /></span>
            </div>
            {dwell.zones.length === 0 ? (
              <EmptyState icon="⏱️" title="이 기간에 체류 기록이 없습니다" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[11px] text-gray-500">
                    <tr>
                      <th rowSpan={2} className="px-3 py-2 text-left"><T k="구역" /></th>
                      <th colSpan={3} className="border-l px-3 py-1 text-center text-blue-700"><T k="관측" /></th>
                      <th colSpan={3} className="border-l px-3 py-1 text-center"><T k="추정(참고)" /></th>
                    </tr>
                    <tr>
                      <th className="border-l px-3 py-1 text-right"><T k="건수" /></th><th className="px-3 py-1 text-right">p50</th><th className="px-3 py-1 text-right">p90</th>
                      <th className="border-l px-3 py-1 text-right"><T k="건수" /></th><th className="px-3 py-1 text-right">p50</th><th className="px-3 py-1 text-right">p90</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {dwell.zones.map((z) => (
                      <tr key={z.zoneId}>
                        <td className="px-3 py-2">
                          <span className="font-medium text-gray-800">{z.name ?? z.zoneId.slice(0, 8)}</span>
                          {z.floor != null && <span className="ml-1 text-[11px] text-gray-400">{z.floor < 0 ? `B${-z.floor}` : `${z.floor}F`}</span>}
                          {(z.observed.invalid + z.inferred.invalid) > 0 && (
                            <span className="ml-2 text-[10px] text-amber-600"><Tf k="시각 역전 {n}건 제외" params={{ n: z.observed.invalid + z.inferred.invalid }} /></span>
                          )}
                        </td>
                        <td className="border-l px-3 py-2 text-right">{z.observed.n}</td>
                        <DwellCells s={z.observed} min={dwell.minSample} />
                        <td className="border-l px-3 py-2 text-right text-gray-500">{z.inferred.n}</td>
                        <DwellCells s={z.inferred} min={dwell.minSample} muted />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>)}
        </div>
      )}

      {/* 구역 격자(도면 아님) */}
      {tab === 'map' && (
        <div className="space-y-3 rounded-2xl border bg-white p-5 shadow-sm">
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <T k="구역을 격자로 늘어놓은 목록입니다 — 실제 배치(도면)가 아닙니다. 배치는 도면 뷰어에서 봅니다." />
          </p>
          {structureQ.isError && <QueryErrorFallback error={structureQ.error} onRetry={() => structureQ.refetch()} size="compact" />}
          {structure && (
            <div className="flex flex-wrap gap-1.5">
              {structure.floors.map((f) => (
                <button key={f.floor} onClick={() => { setSelectedFloor(f.floor); setSelectedZone(null); }}
                  className={`min-h-[32px] rounded-full border px-3 text-xs ${selectedFloor === f.floor ? 'border-indigo-600 bg-indigo-600 text-white' : 'bg-white text-gray-600'}`}>{f.name}</button>
              ))}
            </div>
          )}
          {currentFloor && (
            <div className="grid grid-cols-4 gap-2 md:grid-cols-6 lg:grid-cols-8">
              {currentFloor.zones.map((zone) => {
                const n = patients.filter((p) => p.zoneId === zone.id).length;
                const isSelected = selectedZone === zone.id;
                return (
                  <button key={zone.id} onClick={() => setSelectedZone(isSelected ? null : zone.id)}
                    className={`relative rounded-xl border-2 p-3 text-center transition-all ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-transparent hover:border-gray-300'}`}
                    style={{ backgroundColor: ZONE_COLORS[zone.zoneType] ?? ZONE_COLORS.OTHER }}>
                    <div className="truncate text-[10px] font-semibold text-gray-800">{zone.name}</div>
                    {zone.roomNumber && <div className="text-[9px] text-gray-500">{zone.roomNumber}</div>}
                    {n > 0 && <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-bold text-white">{n}</div>}
                  </button>
                );
              })}
            </div>
          )}
          {selectedZone && currentFloor && (
            <div className="border-t pt-3">
              <h4 className="mb-2 text-xs font-bold text-gray-700">
                <Tf k="{구역} — 환자 {수}명" params={{ 구역: currentFloor.zones.find((z) => z.id === selectedZone)?.name ?? '', 수: patientsInZone.length }} />
              </h4>
              {patientsInZone.length === 0 ? (
                <p className="text-xs text-gray-400"><T k="현재 환자 없음" /></p>
              ) : patientsInZone.map((p) => (
                <div key={p.id} className="mb-1 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                  <div><span className="text-sm font-medium text-gray-900">{p.patientName}</span><SourceBadge source={p.source} /></div>
                  <span className="text-[10px] text-gray-500">{p.duration}<Unit>분</Unit></span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
