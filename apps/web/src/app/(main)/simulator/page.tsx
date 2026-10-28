'use client';

import { useState } from 'react';
import { Unit, useDurationText } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs } from '@/lib/ui-settings';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { isObservedLocation } from '@hospital-run/shared';

const EVENT_TYPES = [
  { value: 'EMERGENCY_ARRIVAL', label: '응급 환자 도착' },
  { value: 'SCHEDULED_VISIT', label: '예약 내원' },
  { value: 'LAB_ORDER', label: '검사 오더' },
  { value: 'ADMISSION', label: '입원' },
  { value: 'DISCHARGE', label: '퇴원' },
  { value: 'SURGERY_START', label: '수술 시작' },
];

export default function SimulatorPage() {
  const fmtDur = useDurationText();
  const queryClient = useQueryClient();
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [speed, setSpeed] = useState(1);
  const [eventType, setEventType] = useState('EMERGENCY_ARRIVAL');
  const [patientCount, setPatientCount] = useState(10);
  const [duration, setDuration] = useState(60);
  const [activeTab, setActiveTab] = useState<'simulator' | 'floor'>('simulator');
  const [selectedFloor, setSelectedFloor] = useState<string | null>(null);

  // 시뮬레이터 상태
  const { data: statusRes, isLoading: statusLoading, isError, error, refetch } = useQuery({
    queryKey: ['simulator-status'],
    queryFn: () => apiClient.get<any>('/api/v1/simulator/status'),
    refetchInterval: 3000,
  });
  const status = statusRes?.data;

  // 플로어 목록
  // 🔴 (2026-09-28) 이 탭의 조회 4개가 전부 응답 모양과 어긋나 있었다 — 서버는 `{ floors }`·`{ zones }`·`{ entities }`·`{ stats }` 로
  //    감싸 주는데 화면은 배열·평면 객체로 읽어, 탭을 열면 `floors.map` 에서 터졌다(통계는 JSON 을 그대로 찍었다).
  const { data: floorsRes, isError: floorsError, error: floorsErr, refetch: refetchFloors } = useQuery({
    queryKey: ['floor-plans'],
    queryFn: () => apiClient.get<any>('/api/floor/plans'),
  });
  const floors: any[] = floorsRes?.data?.floors ?? [];

  // 선택된 층 데이터
  const { data: floorDataRes } = useQuery({
    queryKey: ['floor-data', selectedFloor],
    queryFn: () => apiClient.get<any>(`/api/floor/plans/${selectedFloor}`),
    enabled: !!selectedFloor,
  });
  const { data: entitiesRes } = useQuery({
    queryKey: ['floor-entities', selectedFloor],
    queryFn: () => apiClient.get<any>(`/api/floor/entities/${selectedFloor}`),
    enabled: !!selectedFloor,
    refetchInterval: 5000,
  });
  const { data: zonesRes } = useQuery({
    queryKey: ['floor-zones', selectedFloor],
    queryFn: () => apiClient.get<any>(`/api/floor/zones/${selectedFloor}`),
    enabled: !!selectedFloor,
  });
  const { data: statsRes } = useQuery({
    queryKey: ['floor-stats', selectedFloor],
    queryFn: () => apiClient.get<any>(`/api/floor/stats/${selectedFloor}`),
    enabled: !!selectedFloor,
    refetchInterval: pollMs('fast'),
  });

  const floorData = floorDataRes?.data;
  const entities: any[] = entitiesRes?.data?.entities ?? [];
  const zoneUnknown: number = entitiesRes?.data?.patientsZoneUnknown ?? 0;
  const zones: any[] = zonesRes?.data?.zones ?? [];
  const floorStats: any[] | null = statsRes?.data?.stats ?? null;

  // 시뮬레이터 액션
  const startSim = useMutation({
    mutationFn: () => apiClient.post<any>('/api/v1/simulator/start', { patientCount, durationMinutes: duration }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['simulator-status'] }); toast.success(tAttr('시뮬레이션 시작')); },
    onError: () => toast.error(tAttr('시뮬레이션 시작 실패')),
  });
  const stopSim = useMutation({
    mutationFn: () => apiClient.post('/api/v1/simulator/stop'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['simulator-status'] }); toast.success(tAttr('시뮬레이션 중지')); },
  });
  const pauseSim = useMutation({
    mutationFn: () => apiClient.post('/api/v1/simulator/pause'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['simulator-status'] }); toast.success(tAttr('일시정지')); },
  });
  const resumeSim = useMutation({
    mutationFn: () => apiClient.post('/api/v1/simulator/resume'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['simulator-status'] }); toast.success(tAttr('재개')); },
  });
  const setSpeedMut = useMutation({
    mutationFn: (s: number) => apiClient.patch('/api/v1/simulator/speed', { speed: s }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['simulator-status'] }); toast.success(tAttr('속도 변경')); },
  });
  const injectEvent = useMutation({
    mutationFn: () => apiClient.post<any>('/api/v1/simulator/inject', { type: eventType }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['simulator-status'] }); toast.success(tAttr('이벤트 주입 완료')); },
    onError: () => toast.error(tAttr('이벤트 주입 실패')),
  });

  const isRunning = status?.status === 'running';
  const isPaused = status?.status === 'paused';

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="병원 시뮬레이터" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="시뮬레이션 + 플로어맵" /></p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-0.5">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'simulator' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            <T k="시뮬레이터" />
          </button>
          <button
            onClick={() => setActiveTab('floor')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'floor' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            <T k="플로어맵" />
          </button>
        </div>
      </div>

      {activeTab === 'simulator' && (
        <>
          {/* 🔴 원장 격리(2026-09-28) — 서버가 writesLedger:false 일 때만 이렇게 말한다 */}
          {status?.writesLedger === false && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
              <T k="시뮬레이션은 서버 메모리 안에서만 돕니다 — 가상 환자를 쓰고, 환자 여정·위치 원장에는 아무것도 쓰지 않습니다. 멈추거나 서버가 재시작되면 사라집니다." />
            </p>
          )}
          {/* 상태 표시 */}
          <div className="bg-gradient-to-r from-slate-700 to-slate-800 rounded-2xl p-5 text-white">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
              <div className="text-center">
                <p className="text-xl font-bold">
                  {statusLoading ? '-' : (
                    <span className={isRunning ? 'text-emerald-400' : isPaused ? 'text-amber-400' : 'text-gray-400'}>
                      {isRunning ? <T k="실행중" /> : isPaused ? <T k="일시정지" /> : <T k="정지" />}
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-400 mt-0.5"><T k="상태" /></p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold">{status?.simulatedTime ?? '--:--'}</p>
                <p className="text-xs text-slate-400 mt-0.5"><T k="시뮬 시각" /></p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold">{status?.speed ?? 1}x</p>
                <p className="text-xs text-slate-400 mt-0.5"><T k="속도" /></p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold">{status?.totalEntities ?? 0}</p>
                <p className="text-xs text-slate-400 mt-0.5"><T k="활성 환자" /></p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-emerald-300">{status?.metrics?.throughput ?? 0}</p>
                <p className="text-xs text-slate-400 mt-0.5"><T k="처리 완료" /></p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold">{status?.eventCount ?? 0}</p>
                <p className="text-xs text-slate-400 mt-0.5"><T k="이벤트" /></p>
              </div>
            </div>
            {(status?.progress ?? 0) > 0 && (
              <div className="mt-3">
                <div className="w-full h-1.5 bg-slate-600 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400 rounded-full" style={{ width: `${status.progress}%` }} />
                </div>
                <p className="text-[10px] text-slate-400 mt-1 text-right"><Tf k="진행 {값}" params={{ 값: <>{status.progress}<Unit>%</Unit></> }} /></p>
              </div>
            )}
          </div>

          {/* 운영 지표 (신규) */}
          {status?.metrics && (
            <div className="bg-white border rounded-2xl p-5">
              <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="운영 지표 (실시간)" /></h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <MetricCard label="대기 환자" value={status.metrics.waiting} tone="text-amber-600" />
                <MetricCard label="진료/처치 중" value={status.metrics.treating} tone="text-blue-600" />
                <MetricCard label="응급실 재실" value={status.metrics.erCensus} tone="text-rose-600" />
                <MetricCard label="평균 체류(분)" value={status.metrics.avgTimeInSystemMin} tone="text-gray-800" />
              </div>
              {/* 병목 */}
              {status.metrics.bottleneck && (
                <p className="text-xs text-gray-500 mb-3">🔺 <Tf k="최대 혼잡: {구역} ({수}) · 피크 {피크}" params={{ 구역: <span className="font-semibold text-rose-600">{status.metrics.bottleneck.zone}</span>, 수: <>{status.metrics.bottleneck.count}<Unit>명</Unit></>, 피크: <>{status.metrics.peakZoneOccupancy}<Unit>명</Unit></> }} /></p>
              )}
              {/* 타입별 처리량·체류 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                {(['OUTPATIENT', 'EMERGENCY', 'INPATIENT'] as const).map((t) => {
                  const m = status.metrics.byType?.[t];
                  const lbl = t === 'OUTPATIENT' ? '외래' : t === 'EMERGENCY' ? '응급' : '입원';
                  return (
                    <div key={t} className="bg-gray-50 rounded-lg p-2 text-xs">
                      <p className="font-semibold text-gray-700"><T k={lbl} /></p>
                      <p className="text-gray-500">{m?.avgLosMin != null
                        ? <Tf k="재실 {재실} · 완료 {완료} · 평균 {평균}" params={{ 재실: m?.active ?? 0, 완료: m?.discharged ?? 0, 평균: fmtDur(m.avgLosMin) }} />
                        : <Tf k="재실 {재실} · 완료 {완료}" params={{ 재실: m?.active ?? 0, 완료: m?.discharged ?? 0 }} />}</p>
                    </div>
                  );
                })}
              </div>
              {/* 존 점유 바 */}
              {status.metrics.zoneOccupancy?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-600"><T k="존 점유(혼잡순)" /></p>
                  {status.metrics.zoneOccupancy.slice(0, 8).map((z: { zone: string; count: number }) => {
                    const maxC = status.metrics.zoneOccupancy[0].count || 1;
                    return (
                      <div key={z.zone} className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-500 w-20 truncate font-mono">{z.zone}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${z.count === maxC ? 'bg-rose-400' : 'bg-blue-300'}`} style={{ width: `${(z.count / maxC) * 100}%` }} /></div>
                        <span className="text-[11px] font-medium text-gray-700 w-6 text-right">{z.count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* 컨트롤 */}
            <div className="bg-white border rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-gray-900"><T k="시뮬레이션 설정" /></h3>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block"><T k="환자 수" /></label>
                  <input
                    type="number"
                    value={patientCount}
                    onChange={(e) => setPatientCount(Number(e.target.value))}
                    className="w-full border rounded-xl px-3 py-2 text-sm"
                    min={1}
                    max={100}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block"><T k="시간(분)" /></label>
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="w-full border rounded-xl px-3 py-2 text-sm"
                    min={1}
                    max={480}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block"><T k="속도" /></label>
                <div className="flex gap-1">
                  {[0.5, 1, 2, 5, 10].map((s) => (
                    <button
                      key={s}
                      onClick={() => { setSpeed(s); setSpeedMut.mutate(s); }}
                      className={`min-h-[44px] flex-1 py-2 rounded-xl text-xs font-medium border transition ${
                        (status?.speed ?? speed) === s
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                {!isRunning && !isPaused && (
                  <button
                    onClick={() => startSim.mutate()}
                    disabled={startSim.isPending}
                    className="min-h-[44px] flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <T k="시작" />
                  </button>
                )}
                {isRunning && (
                  <>
                    <button
                      onClick={() => pauseSim.mutate()}
                      className="min-h-[44px] flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600"
                    >
                      <T k="일시정지" />
                    </button>
                    <button
                      onClick={() => stopSim.mutate()}
                      className="min-h-[44px] flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700"
                    >
                      <T k="중지" />
                    </button>
                  </>
                )}
                {isPaused && (
                  <>
                    <button
                      onClick={() => resumeSim.mutate()}
                      className="min-h-[44px] flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700"
                    >
                      <T k="재개" />
                    </button>
                    <button
                      onClick={() => stopSim.mutate()}
                      className="min-h-[44px] flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700"
                    >
                      <T k="중지" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* 이벤트 주입 */}
            <div className="bg-white border rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-gray-900"><T k="이벤트 수동 주입" /></h3>

              <div>
                <label className="text-xs text-gray-500 mb-1 block"><T k="이벤트 유형" /></label>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  className="w-full border rounded-xl px-3 py-2 text-sm"
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{tAttr(t.label)}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => injectEvent.mutate()}
                disabled={injectEvent.isPending || (!isRunning && !isPaused)}
                className="min-h-[44px] w-full px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                <T k="이벤트 주입" />
              </button>

              {/* 최근 이벤트 */}
              {status?.recentEvents && status.recentEvents.length > 0 && (
                <div className="space-y-1.5 mt-3">
                  <p className="text-xs text-gray-500 font-medium"><T k="최근 이벤트" /></p>
                  {status.recentEvents.slice(0, 6).map((evt: any, i: number) => (
                    <div key={i} className="p-2 bg-gray-50 rounded-lg text-xs flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-700 truncate">{evt.name && <span className="text-gray-400">{evt.name} · </span>}{evt.title ?? evt.eventType}</span>
                      <span className={`shrink-0 ${evt.severity === 'CRITICAL' ? 'text-rose-500' : evt.severity === 'WARNING' ? 'text-amber-500' : 'text-gray-400'}`}>{evt.at ?? ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === 'floor' && (
        <>
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <T k="플로어맵은 실제 위치 원장을 보여줍니다 — 시뮬레이션 환자는 여기에 나타나지 않습니다." />
          </p>
          {/* 층 선택 */}
          <div className="flex gap-2 flex-wrap">
            {floorsError && <QueryErrorFallback error={floorsErr} onRetry={() => refetchFloors()} />}
            {/* 🔴 층은 공간 정본(공간 노드·도면)에서 온다 — 종전 문구 "시뮬레이터를 시작하면 자동 생성"은 사실이 아니었다 */}
            {!floorsError && floorsRes && floors.length === 0 && (
              <p className="text-sm text-gray-400"><T k="등록된 층이 없습니다 — 층은 공간 도면(공간 모델)에서 옵니다." /></p>
            )}
            {floors.map((f: any) => (
              <button
                key={f.id}
                onClick={() => setSelectedFloor(f.id)}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition ${
                  selectedFloor === f.id
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {f.name ?? f.label ?? tfAttr('{층}층', { 층: f.floor ?? f.id })}
              </button>
            ))}
          </div>

          {selectedFloor && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* 플로어맵 그리드 */}
              <div className="lg:col-span-2 bg-white border rounded-2xl p-5">
                <h3 className="text-sm font-bold text-gray-900 mb-3">
                  {floorData?.name ?? <T k="층 평면도" />}
                </h3>

                {/* 구역 그리드 */}
                <div className="grid grid-cols-4 gap-2">
                  {zones.length > 0 ? zones.map((zone: any) => {
                    const zoneEntities = entities.filter((e: any) => e.zoneId === zone.id);
                    const patients = zoneEntities.filter((e: any) => e.type === 'patient' || e.entityType === 'PATIENT');
                    const staff = zoneEntities.filter((e: any) => e.type === 'staff' || e.entityType === 'STAFF');

                    return (
                      <div
                        key={zone.id}
                        className={`border rounded-xl p-3 text-center ${
                          patients.length > 0 ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'
                        }`}
                      >
                        <p className="text-xs font-semibold text-gray-700 truncate">{zone.name ?? zone.label}</p>
                        <div className="flex items-center justify-center gap-2 mt-1.5">
                          {patients.length > 0 && (
                            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                              <Tf k="환자 {수}" params={{ 수: patients.length }} />
                            </span>
                          )}
                          {staff.length > 0 && (
                            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                              <Tf k="의료진 {수}" params={{ 수: staff.length }} />
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="col-span-4 py-12 text-center text-gray-400">
                      <div className="text-4xl mb-3">🏥</div>
                      <p className="text-sm"><T k="구역 데이터가 없습니다" /></p>
                    </div>
                  )}
                </div>

                {/* 엔티티 목록 */}
                {entities.length > 0 && (
                  <div className="mt-4 space-y-1">
                    <p className="text-xs text-gray-500 font-medium mb-2"><Tf k="현재 위치 ({수})" params={{ 수: <>{entities.length}<Unit>명</Unit></> }} /></p>
                    <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto">
                      {entities.slice(0, 20).map((e: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 p-1.5 bg-gray-50 rounded-lg text-xs">
                          {/* 🔴 색만으로 환자/직원을 말하지 않는다(§4.6) — 의미는 e.type·e.entityType 에서 가져온다 */}
                          <span
                            aria-label={(e.type === 'patient' || e.entityType === 'PATIENT') ? tAttr('환자') : tAttr('직원')}
                            title={(e.type === 'patient' || e.entityType === 'PATIENT') ? tAttr('환자') : tAttr('직원')}
                            className={`w-2 h-2 rounded-full ${
                            (e.type === 'patient' || e.entityType === 'PATIENT') ? 'bg-blue-500' : 'bg-emerald-500'
                          }`} />
                          <span className="text-gray-700 truncate">{e.label}</span>
                          {/* 관측이 아닌 위치(이벤트 추정 등)는 같은 모양으로 그리지 않는다 */}
                          {e.type === 'patient' && !isObservedLocation(e.locationSource) && (
                            <span className="text-[10px] text-gray-400"><T k="추정" /></span>
                          )}
                          <span className="text-gray-400 ml-auto truncate">{zones.find((z: any) => z.id === e.zoneId)?.name ?? ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 통계 */}
              <div className="bg-white border rounded-2xl p-5 space-y-4">
                <h3 className="text-sm font-bold text-gray-900"><T k="층 통계" /></h3>
                {zoneUnknown > 0 && (
                  <p className="text-[11px] text-gray-500"><Tf k="층까지만 아는 위치 {수}명(구역 칸에 그리지 않음)" params={{ 수: zoneUnknown }} /></p>
                )}
                {floorStats && floorStats.length > 0 ? (
                  <div className="space-y-2">
                    {/* 정원은 그리지 않는다 — 서버가 미설정 정원을 1 로 둔다(지어낸 값) */}
                    {floorStats.map((s: any) => (
                      <div key={s.zoneId} className="flex items-center justify-between gap-2 p-2 bg-gray-50 rounded-lg">
                        <span className="truncate text-xs text-gray-600">{s.zoneName}</span>
                        <span className="whitespace-nowrap text-xs text-gray-900">
                          <Tf k="현재 {현재} · 오늘 {오늘}" params={{ 현재: s.currentCount, 오늘: s.todayTotal }} />
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 text-center py-8"><T k="통계 데이터 없음" /></p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3 text-center">
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      {/* label 은 원문 키로 받아 여기서 번역한다 — 호출부가 번역해 넘기면 이중 번역이 된다 */}
      <p className="text-[11px] text-gray-500 mt-0.5"><T k={label} /></p>
    </div>
  );
}
