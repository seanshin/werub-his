'use client';

import Link from 'next/link';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import { PatientAddModal } from '@/components/workstation/PatientAddModal';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { TherapyCalendarView } from './TherapyCalendarView';
import { pollMs, kdate } from '@/lib/ui-settings';
import { EmptyState, genderText } from '@/components/ui/display';
import { ageOf } from '@hospital-run/shared';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 🔴 두 탭이 **서버에 없는 경로**를 부르고 있었다(2026-08-30 운영 실측 404 · 개통 이래 무동작):
 *   · 항암 `/api/v1/med-admin` — 그런 컨트롤러가 없다. `medication-administrations` 에는
 *     **목록 조회 EP 자체가 없고**(생성·투약확인·보류·거부뿐), 항암 진행은 `/chemo` 가 정본이다.
 *     → **없는 것을 지어내지 않는다.** 탭을 내리고 정본 화면으로 보낸다.
 *   · 방사선 `/api/v1/radiation/today-fractions` — 실재 경로는 `fractions/today`(세그먼트 순서).
 *
 * 🔴 `role` 은 **탭 표시**만 정한다. 서버 가드는 그대로다.
 *    투석·재활은 서버가 `@Roles(DOCTOR, NURSE, ADMIN)` 이라 방사선치료사(LAB_TECH)에게는
 *    조회부터 403 이었다 — 운영 실측상 투석·재활 실무자는 전원 NURSE 이고 LAB_TECH 는 방사선뿐이다.
 */
const TX_STATIONS = [
  { id: 'schedule', label: '전체 일정', icon: '📅', api: '/api/v1/therapy-orders/schedule', dateParam: 'date', roles: null },
  { id: 'rehab', label: '물리치료', icon: '🏋️', api: '/api/v1/rehab/sessions', dateParam: 'date', roles: ['DOCTOR', 'NURSE'] },
  { id: 'ot', label: '작업치료', icon: '🖐️', api: '/api/v1/rehab/sessions', dateParam: 'date', roles: ['DOCTOR', 'NURSE'] },
  { id: 'st', label: '언어치료', icon: '🗣️', api: '/api/v1/rehab/sessions', dateParam: 'date', roles: ['DOCTOR', 'NURSE'] },
  { id: 'dialysis', label: '투석', icon: '💧', api: '/api/v1/dialysis/sessions', dateParam: 'date', roles: ['DOCTOR', 'NURSE'] },
  { id: 'radiation', label: '방사선', icon: '☢️', api: '/api/v1/radiation/fractions/today', dateParam: null, roles: null },
];

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  SCHEDULED: { label: '예정', cls: 'bg-gray-100 text-gray-600' },
  IN_PROGRESS: { label: '진행중', cls: 'bg-amber-100 text-amber-700' },
  COMPLETED: { label: '완료', cls: 'bg-emerald-100 text-emerald-700' },
  DELIVERED: { label: '완료', cls: 'bg-emerald-100 text-emerald-700' },
};

export default function TherapyWorkstationPage() {
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const today = kstToday();
  const role = useAuthStore((st) => st.user?.role);
  /** 🔴 서버가 조회부터 막는 탭은 띄우지 않는다 — 눌러도 403 이라 빈 목록으로 보인다 */
  const stations = TX_STATIONS.filter((s) => !s.roles || role === 'ADMIN' || (role && s.roles.includes(role)));
  const [station, setStation] = useState(() => (role === 'LAB_TECH' ? 'radiation' : 'rehab'));
  const [selectedDate, setSelectedDate] = useState(today);
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [sessionTarget, setSessionTarget] = useState<any>(null);
  const [calledId, setCalledId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');

  // 재활 세션 폼
  const [rehabForm, setRehabForm] = useState({ activities: '', vitals: '', progress: '' });
  // 투석 시작 폼
  const [dialysisStartForm, setDialysisStartForm] = useState({ preWeight: '', preTemp: '', preBpSystolic: '', preBpDiastolic: '', preHr: '' });
  // 투석 완료 폼
  const [dialysisCompleteForm, setDialysisCompleteForm] = useState({ postWeight: '', postTemp: '', postBpSystolic: '', postBpDiastolic: '', postHr: '', actualUf: '', actualDuration: '', ktV: '' });
  // 방사선 폼
  const [radiationForm, setRadiationForm] = useState({ deliveredDose: '', setupVerified: true, coneBeamCT: false });

  // 투석 합병증 체크리스트
  const [dialysisComplications, setDialysisComplications] = useState<string[]>([]);

  const stationInfo = stations.find((s) => s.id === station) ?? stations[0];
  const isRehab = ['rehab', 'ot', 'st'].includes(station);
  const isDialysis = station === 'dialysis';
  const isRadiation = station === 'radiation';

  // 재활 세션 유형 필터
  const rehabTypeFilter: Record<string, string[]> = {
    'rehab': ['운동치료', '도수치료', '열전기', '수치료'],
    'ot': ['작업치료', 'ADL', '인지재활', '손기능'],
    'st': ['언어치료', '조음', '삼킴', '유창성'],
  };

  const { data: queueRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ws-therapy', station, selectedDate],
    queryFn: async () => {
      if (isRehab) {
        const res = await apiClient.get<any>(stationInfo.api, { date: selectedDate });
        const sessions = res?.data ?? [];
        const types = rehabTypeFilter[station] ?? [];
        return types.length > 0
          ? sessions.filter((s: any) => types.some((t) => s.therapyType?.includes(t)))
          : sessions;
      }
      if (isDialysis) {
        const res = await apiClient.get<any>(stationInfo.api, { date: selectedDate });
        return res?.data ?? [];
      }
      if (isRadiation) {
        const res = await apiClient.get<any>(stationInfo.api);
        return res?.data ?? [];
      }
      // schedule 탭
      if (station === 'schedule') {
        const res = await apiClient.get<any>(stationInfo.api, { date: selectedDate });
        return res?.data ?? [];
      }
      return [];
    },
    refetchInterval: pollMs('fast'),
  });
  const queue = queueRes ?? [];

  // 재활 세션 시작
  const rehabStart = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/rehab/sessions/${id}/start`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ws-therapy'] }); toast.success('치료 시작'); },
  });
  // 재활 세션 완료
  const rehabComplete = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiClient.patch(`/api/v1/rehab/sessions/${id}/complete`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ws-therapy'] }); setSessionTarget(null); toast.success('세션 기록 완료'); },
  });
  // 투석 시작
  const dialysisStart = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiClient.patch(`/api/v1/dialysis/sessions/${id}/start`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ws-therapy'] }); setSessionTarget(null); toast.success('투석 시작'); },
  });
  // 투석 완료
  const dialysisComplete = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiClient.patch(`/api/v1/dialysis/sessions/${id}/complete`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ws-therapy'] }); setSessionTarget(null); toast.success('투석 완료 (Kt/V 자동계산)'); },
  });
  // 방사선 전달
  const radiationDeliver = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiClient.patch(`/api/v1/radiation/fractions/${id}/deliver`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ws-therapy'] }); setSessionTarget(null); toast.success('방사선 전달 완료 (누적선량 자동계산)'); },
  });

  // 정본 계산 — 365.25 근사는 생일 경계에서 어긋난다
  const age = (dob: string) => ageOf(dob) ?? '-';

  // 환자 정보 추출 (모듈마다 구조 다름)
  const getPatient = (item: any) => {
    if (isRehab) return item.plan?.patient ?? item.patient;
    if (isDialysis) return item.order?.patient ?? item.patient;
    if (isRadiation) return item.plan?.patient ?? item.patient;
    if (station === 'schedule') return item.order?.prescription?.encounter?.patient;
    return item.patient;
  };
  const getName = (p: any) => p ? `${p.familyName ?? ''}${p.givenName ?? ''}` : '?';
  const getStatus = (item: any) => item.status;
  const getTime = (item: any) => {
    if (isRehab && item.scheduledAt) return kdate(item.scheduledAt, 'time');
    if (isDialysis) return item.shift ?? '';
    if (isRadiation) return item.scheduledDate?.slice(0, 10) ?? '';
    return '';
  };
  const getLabel = (item: any) => {
    if (isRehab) return item.therapyType ?? '';
    if (isDialysis) return `HD ${item.order?.duration ?? 240}분`;
    if (isRadiation) return `Fraction #${item.fractionNumber ?? ''}`;
    if (station === 'schedule') return item.therapyType ?? '';
    return '';
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{stationInfo.icon} {stationInfo.label} 워크스테이션</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {queue.filter((q: any) => q.status !== 'COMPLETED' && q.status !== 'DELIVERED').length}건 예정 · 10초 갱신
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 p-0.5 rounded-lg">
            <button onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-xs rounded-md transition ${viewMode === 'list' ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}><T k="📋 리스트" /></button>
            <button onClick={() => setViewMode('calendar')}
              className={`px-3 py-1.5 text-xs rounded-md transition ${viewMode === 'calendar' ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}><T k="📅 캘린더" /></button>
          </div>
          <button onClick={() => setShowAddPatient(true)}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 shadow-sm">
            <T k="+ 환자 추가" />
          </button>
        </div>
      </div>

      {/* 스테이션 탭 */}
      <div className="flex gap-1.5 flex-wrap">
        {stations.map((s) => (
          <button key={s.id} onClick={() => setStation(s.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
              station === s.id ? 'bg-emerald-100 border-emerald-300 text-emerald-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}>{s.icon} {s.label}</button>
        ))}
        {/* 🔴 항암은 이 화면에 목록 EP 가 없다(서버에 `med-admin` 자체가 없었다) — 정본 화면으로 보낸다 */}
        <Link href="/chemo" className="px-3 py-1.5 rounded-xl text-xs font-medium border border-gray-200 text-gray-500 hover:bg-gray-50">
          <T k="💉 항암 →" />
        </Link>
      </div>

      {/* 날짜 선택 */}
      <div className="flex items-center gap-2">
        <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() - 1); setSelectedDate(d.toISOString().slice(0, 10)); }}
          className="px-2 py-1 bg-gray-100 rounded hover:bg-gray-200 text-sm">◀</button>
        <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm" />
        <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() + 1); setSelectedDate(d.toISOString().slice(0, 10)); }}
          className="px-2 py-1 bg-gray-100 rounded hover:bg-gray-200 text-sm">▶</button>
        <button onClick={() => setSelectedDate(today)} className="px-3 py-1.5 bg-gray-100 rounded-lg text-xs"><T k="오늘" /></button>
      </div>

      {/* Calendar View */}
      {viewMode === 'calendar' && <TherapyCalendarView />}

      {/* 대기열 (리스트 뷰) */}
      {viewMode === 'list' && (isLoading ? (
        <div className="py-16 text-center text-gray-400"><div className="animate-pulse text-3xl mb-2">{stationInfo.icon}</div><T k="로딩 중..." /></div>
      ) : isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : queue.length === 0 ? (
        <EmptyState icon={stationInfo.icon} title="예정된 치료가 없습니다" />
      ) : (
        <div className="space-y-2">
          {queue.map((item: any, idx: number) => {
            const patient = getPatient(item);
            const status = getStatus(item);
            const isDone = status === 'COMPLETED' || status === 'DELIVERED';
            const badge = STATUS_BADGE[status] ?? STATUS_BADGE.SCHEDULED;
            return (
              <div key={item.id} className={`bg-white border rounded-xl p-4 transition ${isDone ? 'opacity-60' : ''} ${calledId === item.id ? 'ring-2 ring-emerald-400 bg-emerald-50/30' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                      calledId === item.id ? 'bg-emerald-600 text-white animate-pulse' : isDone ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-500'
                    }`}>{isDone ? '✓' : idx + 1}</div>
                    <div>
                      <span className="font-semibold text-gray-900">{getName(patient)}</span>
                      <span className="ml-2 text-xs text-gray-400">
                        {genderText(patient?.gender)}/{age(patient?.dateOfBirth)}세 · {patient?.mrn}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-gray-500">{getTime(item)}</span>
                    <span className="text-sm text-gray-600 font-medium">{getLabel(item)}</span>
                    {isRehab && item.plan && (
                      <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] rounded">
                        {item.plan.frequency}
                      </span>
                    )}
                    {isRadiation && item.plan && (
                      <span className="px-1.5 py-0.5 bg-violet-50 text-violet-600 text-[10px] rounded">
                        {item.plan.fractionDose}Gy × {item.plan.totalFractions}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                </div>

                {!isDone && (
                  <div className="flex items-center gap-2 mt-3">
                    {status === 'SCHEDULED' && (
                      <>
                        <button onClick={() => { setCalledId(item.id); toast.success(`${getName(patient)}님 호출`); }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-medium ${calledId === item.id ? 'bg-emerald-700 text-white animate-pulse' : 'border border-emerald-300 text-emerald-600'}`}>
                          {calledId === item.id ? '호출 중...' : '환자 호출'}
                        </button>
                        {isRehab && (
                          <button onClick={() => rehabStart.mutate(item.id)}
                            className="px-3 py-1.5 bg-amber-500 text-white rounded-xl text-xs font-medium"><T k="치료 시작" /></button>
                        )}
                        {isDialysis && (
                          <button onClick={() => { setSessionTarget({ ...item, action: 'dialysis-start' }); setDialysisStartForm({ preWeight: '', preTemp: '', preBpSystolic: '', preBpDiastolic: '', preHr: '' }); }}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-medium"><T k="투석 시작" /></button>
                        )}
                        {isRadiation && (
                          <button onClick={() => { setSessionTarget({ ...item, action: 'radiation' }); setRadiationForm({ deliveredDose: String(item.plan?.fractionDose ?? '2.0'), setupVerified: true, coneBeamCT: false }); }}
                            className="px-3 py-1.5 bg-violet-600 text-white rounded-xl text-xs font-medium"><T k="방사선 전달" /></button>
                        )}
                      </>
                    )}
                    {status === 'IN_PROGRESS' && (
                      <>
                        {isRehab && (
                          <button onClick={() => { setSessionTarget({ ...item, action: 'rehab-complete' }); setRehabForm({ activities: '', vitals: '', progress: '' }); }}
                            className="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-medium shadow-sm"><T k="세션 완료" /></button>
                        )}
                        {isDialysis && (
                          <button onClick={() => { setSessionTarget({ ...item, action: 'dialysis-complete' }); setDialysisCompleteForm({ postWeight: '', postTemp: '', postBpSystolic: '', postBpDiastolic: '', postHr: '', actualUf: '', actualDuration: '', ktV: '' }); }}
                            className="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-medium shadow-sm"><T k="투석 완료" /></button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* ── 세션 모달들 ── */}
      {sessionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSessionTarget(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex-shrink-0">
              <h3 className="font-bold">
                {sessionTarget.action === 'rehab-complete' && '재활 세션 기록'}
                {sessionTarget.action === 'dialysis-start' && '투석 시작 (Pre-dialysis)'}
                {sessionTarget.action === 'dialysis-complete' && '투석 완료 (Post-dialysis)'}
                {sessionTarget.action === 'radiation' && '방사선 전달'}
              </h3>
              <p className="text-sm text-gray-500">{getName(getPatient(sessionTarget))}</p>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1 space-y-3">

              {/* 재활 완료 */}
              {sessionTarget.action === 'rehab-complete' && (
                <>
                  <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="치료 활동" /></label>
                    <textarea className="w-full border rounded-xl px-3 py-2 text-sm" rows={3} placeholder={tAttr('시행한 치료 활동...')}
                      value={rehabForm.activities} onChange={(e) => setRehabForm({ ...rehabForm, activities: e.target.value })} /></div>
                  <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="바이탈" /></label>
                    <input className="w-full border rounded-xl px-3 py-2 text-sm" placeholder="BP, HR, SpO2..."
                      value={rehabForm.vitals} onChange={(e) => setRehabForm({ ...rehabForm, vitals: e.target.value })} /></div>
                  <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="진행 메모" /></label>
                    <textarea className="w-full border rounded-xl px-3 py-2 text-sm" rows={2} placeholder={tAttr('환자 반응, ROM 변화...')}
                      value={rehabForm.progress} onChange={(e) => setRehabForm({ ...rehabForm, progress: e.target.value })} /></div>
                </>
              )}

              {/* 투석 시작 */}
              {sessionTarget.action === 'dialysis-start' && (
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="체중 (kg)" /></label>
                    <input type="number" step="0.1" className="w-full border rounded-xl px-3 py-2 text-sm"
                      value={dialysisStartForm.preWeight} onChange={(e) => setDialysisStartForm({ ...dialysisStartForm, preWeight: e.target.value })} /></div>
                  <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="체온 (°C)" /></label>
                    <input type="number" step="0.1" className="w-full border rounded-xl px-3 py-2 text-sm"
                      value={dialysisStartForm.preTemp} onChange={(e) => setDialysisStartForm({ ...dialysisStartForm, preTemp: e.target.value })} /></div>
                  <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="수축기 혈압" /></label>
                    <input type="number" className="w-full border rounded-xl px-3 py-2 text-sm" placeholder="mmHg"
                      value={dialysisStartForm.preBpSystolic} onChange={(e) => setDialysisStartForm({ ...dialysisStartForm, preBpSystolic: e.target.value })} /></div>
                  <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="이완기 혈압" /></label>
                    <input type="number" className="w-full border rounded-xl px-3 py-2 text-sm" placeholder="mmHg"
                      value={dialysisStartForm.preBpDiastolic} onChange={(e) => setDialysisStartForm({ ...dialysisStartForm, preBpDiastolic: e.target.value })} /></div>
                  <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="심박수" /></label>
                    <input type="number" className="w-full border rounded-xl px-3 py-2 text-sm" placeholder={tAttr('회/분')}
                      value={dialysisStartForm.preHr} onChange={(e) => setDialysisStartForm({ ...dialysisStartForm, preHr: e.target.value })} /></div>
                </div>
              )}

              {/* 투석 완료 */}
              {sessionTarget.action === 'dialysis-complete' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="체중 (kg)" /></label>
                      <input type="number" step="0.1" className="w-full border rounded-xl px-3 py-2 text-sm"
                        value={dialysisCompleteForm.postWeight} onChange={(e) => setDialysisCompleteForm({ ...dialysisCompleteForm, postWeight: e.target.value })} /></div>
                    <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="체온" /></label>
                      <input type="number" step="0.1" className="w-full border rounded-xl px-3 py-2 text-sm"
                        value={dialysisCompleteForm.postTemp} onChange={(e) => setDialysisCompleteForm({ ...dialysisCompleteForm, postTemp: e.target.value })} /></div>
                    <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="수축기 혈압" /></label>
                      <input type="number" className="w-full border rounded-xl px-3 py-2 text-sm"
                        value={dialysisCompleteForm.postBpSystolic} onChange={(e) => setDialysisCompleteForm({ ...dialysisCompleteForm, postBpSystolic: e.target.value })} /></div>
                    <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="이완기 혈압" /></label>
                      <input type="number" className="w-full border rounded-xl px-3 py-2 text-sm"
                        value={dialysisCompleteForm.postBpDiastolic} onChange={(e) => setDialysisCompleteForm({ ...dialysisCompleteForm, postBpDiastolic: e.target.value })} /></div>
                    <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="실제 초여과량 (mL)" /></label>
                      <input type="number" className="w-full border rounded-xl px-3 py-2 text-sm"
                        value={dialysisCompleteForm.actualUf} onChange={(e) => setDialysisCompleteForm({ ...dialysisCompleteForm, actualUf: e.target.value })} /></div>
                    <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="실제 시간 (분)" /></label>
                      <input type="number" className="w-full border rounded-xl px-3 py-2 text-sm"
                        value={dialysisCompleteForm.actualDuration} onChange={(e) => setDialysisCompleteForm({ ...dialysisCompleteForm, actualDuration: e.target.value })} /></div>
                    {/* 🔴 Kt/V 는 장비·검사 실측만 원장에 남는다 — 비우면 '미측정'이지 근사치로 채우지 않는다 */}
                    <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="Kt/V (실측·선택)" /></label>
                      <input type="number" step="0.01" className="w-full border rounded-xl px-3 py-2 text-sm" placeholder={tAttr('미측정이면 비워 둔다')}
                        value={dialysisCompleteForm.ktV} onChange={(e) => setDialysisCompleteForm({ ...dialysisCompleteForm, ktV: e.target.value })} /></div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1.5 block"><T k="합병증 체크리스트" /></label>
                    <div className="flex flex-wrap gap-2">
                      {['저혈압', '근경련', '구역/구토', '두통', '흉통', '가려움', '발열/오한', '부정맥'].map((c) => (
                        <label key={c} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs cursor-pointer border ${
                          dialysisComplications.includes(c) ? 'bg-red-50 border-red-200 text-red-700' : 'bg-gray-50 border-gray-200 text-gray-600'
                        }`}>
                          <input type="checkbox" className="rounded text-red-600 w-3 h-3"
                            checked={dialysisComplications.includes(c)}
                            onChange={() => setDialysisComplications((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c])} />
                          {c}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* 방사선 전달 */}
              {sessionTarget.action === 'radiation' && (
                <>
                  <div><label className="text-xs font-medium text-gray-500 mb-1 block"><T k="전달 선량 (Gy)" /></label>
                    <input type="number" step="0.1" className="w-full border rounded-xl px-3 py-2 text-sm"
                      value={radiationForm.deliveredDose} onChange={(e) => setRadiationForm({ ...radiationForm, deliveredDose: e.target.value })} /></div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="rounded" checked={radiationForm.setupVerified}
                    onChange={(e) => setRadiationForm({ ...radiationForm, setupVerified: e.target.checked })} /> <T k="Setup 확인 완료" /></label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="rounded" checked={radiationForm.coneBeamCT}
                    onChange={(e) => setRadiationForm({ ...radiationForm, coneBeamCT: e.target.checked })} /> <T k="Cone-beam CT 확인" /></label>
                  {sessionTarget.plan && (
                    <div className="p-3 bg-violet-50 rounded-xl text-xs text-violet-700">
                      <div>부위: {sessionTarget.plan.site} | 기법: {sessionTarget.plan.technique}</div>
                      <div>처방: {sessionTarget.plan.fractionDose}Gy × {sessionTarget.plan.totalFractions} = {sessionTarget.plan.totalDose}Gy</div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2 flex-shrink-0">
              <button onClick={() => setSessionTarget(null)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm"><T k="취소" /></button>
              <button onClick={() => {
                if (sessionTarget.action === 'rehab-complete') {
                  // 🔴 DTO 는 activities·vitals 가 객체(@IsObject) — 문자열을 보내 적으면 늘 400 이었다(2026-10-07)
                  rehabComplete.mutate({ id: sessionTarget.id, data: {
                    ...(rehabForm.activities.trim() ? { activities: { text: rehabForm.activities.trim() } } : {}),
                    ...(rehabForm.vitals.trim() ? { vitals: { text: rehabForm.vitals.trim() } } : {}),
                    ...(rehabForm.progress.trim() ? { progress: rehabForm.progress.trim() } : {}),
                  } });
                } else if (sessionTarget.action === 'dialysis-start') {
                  dialysisStart.mutate({ id: sessionTarget.id, data: {
                    preWeight: parseFloat(dialysisStartForm.preWeight) || undefined,
                    preTemp: parseFloat(dialysisStartForm.preTemp) || undefined,
                    preBpSystolic: parseInt(dialysisStartForm.preBpSystolic) || undefined,
                    preBpDiastolic: parseInt(dialysisStartForm.preBpDiastolic) || undefined,
                    preHr: parseInt(dialysisStartForm.preHr) || undefined,
                  }});
                } else if (sessionTarget.action === 'dialysis-complete') {
                  // 🔴 종전엔 `postBpSystolic/Diastolic` 를 보냈는데 서버 DTO 는 `postBp` 문자열 하나라
                  //    **투석 후 혈압이 저장되지 않았다**(whitelist 가 조용히 버림).
                  dialysisComplete.mutate({ id: sessionTarget.id, data: {
                    postWeight: parseFloat(dialysisCompleteForm.postWeight) || undefined,
                    postTemp: parseFloat(dialysisCompleteForm.postTemp) || undefined,
                    postBp: dialysisCompleteForm.postBpSystolic && dialysisCompleteForm.postBpDiastolic
                      ? `${dialysisCompleteForm.postBpSystolic}/${dialysisCompleteForm.postBpDiastolic}` : undefined,
                    postHr: parseInt(dialysisCompleteForm.postHr) || undefined,
                    actualUf: parseInt(dialysisCompleteForm.actualUf) || undefined,
                    actualDuration: parseInt(dialysisCompleteForm.actualDuration) || undefined,
                    ktV: parseFloat(dialysisCompleteForm.ktV) || undefined,
                  }});
                } else if (sessionTarget.action === 'radiation') {
                  radiationDeliver.mutate({ id: sessionTarget.id, data: {
                    deliveredDose: parseFloat(radiationForm.deliveredDose),
                    setupVerified: radiationForm.setupVerified,
                    coneBeamCT: radiationForm.coneBeamCT,
                  }});
                }
              }} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium shadow-sm"><T k="완료@버튼" /></button>
            </div>
          </div>
        </div>
      )}

      {showAddPatient && (
        <PatientAddModal
          stationType="therapy"
          stationId={station}
          onClose={() => setShowAddPatient(false)}
          onAdded={() => queryClient.invalidateQueries({ queryKey: ['ws-therapy'] })}
        />
      )}
    </div>
  );
}
