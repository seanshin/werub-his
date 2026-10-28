'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import PatientSelector from '@/components/ui/PatientSelector';
import { SpecialtyPatientListMeta, specialtyPatientMeta } from '@/components/specialty/SpecialtyPatientListMeta';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import BodyMapDiagram from '@/components/specialty/BodyMapDiagram';
import type { Lesion as BodyMapLesion } from '@/components/specialty/BodyMapDiagram';
import BeforeAfterSlider from '@/components/specialty/BeforeAfterSlider';
import StatusBadge from '@/components/ui/StatusBadge';
import { kdate } from '@/lib/ui-settings';

const MORPHOLOGY_LABEL: Record<string, string> = { MACULE: '반점', PAPULE: '구진', NODULE: '결절', PLAQUE: '판', VESICLE: '소수포', BULLA: '대수포', PUSTULE: '농포', ULCER: '궤양', PATCH: '반' };
const TX_TYPE_LABEL: Record<string, string> = { TOPICAL: '외용', SYSTEMIC: '전신', PHOTOTHERAPY: '광선', LASER: '레이저', CRYOTHERAPY: '냉동', EXCISION: '절제', BIOPSY: '조직검사', INJECTION: '주사', CHEMICAL_PEEL: '화학박피', BOTOX: '보톡스', FILLER: '필러', IPL: 'IPL' };
const TX_TYPE_COLOR: Record<string, string> = { TOPICAL: 'bg-emerald-100 text-emerald-700', LASER: 'bg-violet-100 text-violet-700', CRYOTHERAPY: 'bg-blue-100 text-blue-700', EXCISION: 'bg-red-100 text-red-700', BIOPSY: 'bg-amber-100 text-amber-700', INJECTION: 'bg-indigo-100 text-indigo-700', BOTOX: 'bg-pink-100 text-pink-700', FILLER: 'bg-rose-100 text-rose-700' };


type DermTab = 'lesions' | 'treatments' | 'photos';

export default function DermatologyPage() {
  const tAttr = useTAttr();
  const [showLegacy, setShowLegacy] = useState(false);
  const [tab, setTab] = useState<DermTab>('lesions');
  const [patientId, setPatientId] = useState('');

  // ── Dashboard data ──
  const { data: todayData, isLoading: todayLoading, isError, error, refetch: refetchToday } = useQuery({
    queryKey: ['derm-today'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/dermatology/today'),
  });
  const { data: statsData, isLoading: statsLoading, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['derm-stats'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/dermatology/stats'),
  });
  const { data: patientsData, isLoading: patientsLoading, isError: patientsIsError, error: patientsError, refetch: refetchPatients } = useQuery({
    queryKey: ['derm-patients'],
    queryFn: () => apiClient.get<{ data: Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> }>('/api/v1/dermatology/patients'),
  });
  const myPatients = (() => { const r = patientsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> ?? []; })();

  const todayPatients: Record<string, unknown>[] = (() => { const r = todayData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const stats: Record<string, unknown> = (() => { const r = statsData?.data; if (r && typeof r === 'object' && !Array.isArray(r) && 'data' in (r as unknown as Record<string, unknown>)) return (r as unknown as Record<string, unknown>).data as Record<string, unknown>; return (r ?? {}) as Record<string, unknown>; })();

  // ── Legacy patient data ──
  const { data: lesionsData, isLoading: lesionsLoading, isError: lesionsIsError, error: lesionsError, refetch: refetchLesions } = useQuery({
    queryKey: ['derm-lesions', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/dermatology/lesions/${patientId}`),
    enabled: tab === 'lesions' && !!patientId && showLegacy,
  });

  const { data: treatmentsData, isLoading: treatmentsLoading, isError: treatmentsIsError, error: treatmentsError, refetch: refetchTreatments } = useQuery({
    queryKey: ['derm-treatments', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/dermatology/treatments/${patientId}`),
    enabled: (tab === 'treatments' || tab === 'photos') && !!patientId && showLegacy,
  });

  const lesions: Record<string, unknown>[] = (() => { const r = lesionsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const treatments: Record<string, unknown>[] = (() => { const r = treatmentsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  const [bodyMapView, setBodyMapView] = useState<'front' | 'back'>('front');

  // ── 바디맵 일괄 기록(edit 모드) — 부위 클릭으로 병변을 모아 한 번에 저장 ──
  const queryClient = useQueryClient();
  const [bulkMode, setBulkMode] = useState(false);
  const [pendingRegions, setPendingRegions] = useState<{ bodyRegion: string; morphology: string; size?: string }[]>([]);

  const bodyMapMutation = useMutation({
    mutationFn: (regions: { bodyRegion: string; morphology: string; size?: string }[]) =>
      apiClient.post(`/api/v1/dermatology/body-map/${patientId}`, { regions }),
    onSuccess: (res: unknown) => {
      const count = ((res as { data?: { createdCount?: number } })?.data?.createdCount) ?? pendingRegions.length;
      toast.success(`병변 ${count}건이 일괄 기록되었습니다`);
      setPendingRegions([]);
      setBulkMode(false);
      queryClient.invalidateQueries({ queryKey: ['derm-lesions', patientId] });
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '바디맵 일괄 기록에 실패했습니다'),
  });

  const bodyMapLesions: BodyMapLesion[] = useMemo(() => {
    const saved = lesions.map((l) => ({
      id: (l.id as string) ?? '',
      bodyRegion: (l.bodyRegion as string) ?? '',
      morphology: (l.morphology as string) ?? '',
      size: (l.size as string) ?? undefined,
    }));
    const pending = pendingRegions.map((p, i) => ({
      id: `pending-${i}`, bodyRegion: p.bodyRegion, morphology: p.morphology, size: p.size,
    }));
    return [...saved, ...pending];
  }, [lesions, pendingRegions]);

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  if (isError) return <QueryErrorFallback error={error} onRetry={refetchToday} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="피부과 대시보드" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="오늘의 현황 / 환자 목록 / 시술 관리" /></p>
        </div>
      </div>

      {/* ── 상단: 오늘의 현황 카드 ── */}
      {/* 🔴 통계 조회 실패에 0 을 그리지 않는다 */}
      {statsIsError && <QueryErrorFallback error={statsError} onRetry={() => refetchStats()} size="compact" className="mb-6" />}
      {!statsIsError && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="h-4 w-16 bg-gray-100 rounded animate-pulse mb-2" />
              <div className="h-8 w-12 bg-gray-100 rounded animate-pulse" />
            </div>
          ))
        ) : (
          <>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 mb-1"><T k="오늘 예약" /></p>
              <p className="text-2xl font-bold text-gray-900">{Number(stats.todayAppointments ?? stats.totalAppointments ?? todayPatients.length ?? 0)}</p>
              {/* 🔴 노쇼는 총계에는 들어가는데 완료·진행·대기 어디에도 없어 "예약 1 / 나머지 0" 으로 보였다 —
                  의사는 "아직 안 왔다"로 읽지만 이미 노쇼 확정이다. 4칸 합 + 노쇼 = 총계. */}
              {Number(stats.noShow ?? 0) > 0 && (
                <p className="text-[11px] font-bold text-rose-600 mt-0.5"><T k="노쇼" /> {Number(stats.noShow)}</p>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 mb-1"><T k="완료" /></p>
              <p className="text-2xl font-bold text-emerald-600">{Number(stats.completedToday ?? stats.completed ?? 0)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 mb-1"><T k="진행 중" /></p>
              <p className="text-2xl font-bold text-blue-600">{Number(stats.inProgressToday ?? stats.inProgress ?? 0)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 mb-1"><T k="대기" /></p>
              <p className="text-2xl font-bold text-amber-600">{Number(stats.waitingToday ?? stats.waiting ?? 0)}</p>
            </div>
          </>
        )}
      </div>
      )}

      {/* ── 내 환자 목록 ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
          <h3 className="text-sm font-bold text-gray-900"><T k="이 과 기록이 있는 환자" /></h3>
          <SpecialtyPatientListMeta meta={specialtyPatientMeta(patientsData)} />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/30">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자명" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">MRN</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="최근 진료일" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="차트" /></th>
            </tr>
          </thead>
          <tbody>
            {patientsIsError ? (
              <tr><td colSpan={4} className="p-4"><QueryErrorFallback error={patientsError} onRetry={() => refetchPatients()} size="compact" /></td></tr>
            ) : patientsLoading ? <LoadingRows cols={4} />
            : myPatients.length === 0 ? (
              <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="피부과 기록이 있는 환자가 없습니다" /></td></tr>
            ) : myPatients.map((p) => (
              <tr key={p.patientId} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-xs font-medium text-gray-900">{`${p.familyName ?? ''}${p.givenName ?? ''}`}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{p.mrn ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{p.lastDate ? kdate(p.lastDate) : '-'}</td>
                <td className="px-4 py-3">
                  <Link href={`/patients/${p.patientId}?tab=dermatology`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                    <T k="차트 열기" /> &rarr;
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── 중간: 오늘 환자 목록 ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
          <h3 className="text-sm font-bold text-gray-900"><T k="오늘 환자 목록" /></h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/30">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시간" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자명" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시술 내용" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="차트" /></th>
            </tr>
          </thead>
          <tbody>
            {todayLoading ? <LoadingRows cols={5} />
            : todayPatients.length === 0 ? (
              <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="오늘 예약된 환자가 없습니다" /></td></tr>
            ) : todayPatients.map((p, idx) => {
              const pid = (p.patientId ?? p.patient_id ?? (p.patient as unknown as Record<string, unknown>)?.id) as string | undefined;
              const patientObj = p.patient as Record<string, unknown> | undefined;
              const name = patientObj
                ? `${(patientObj.familyName as string) ?? ''}${(patientObj.givenName as string) ?? ''}`
                : (p.patientName as string) ?? '-';
              const time = (p.scheduledAt ?? p.appointmentTime ?? p.time) as string | undefined;
              const timeStr = time ? kdate(time, 'time') : (p.timeSlot as string) ?? '-';
              const treatment = (p.treatment ?? p.procedure ?? p.reason ?? p.chiefComplaint) as string ?? '-';
              // 데이터원 = 오늘 예약(Appointment) → 상태 도메인도 appointment(종전 plan 도메인은
              // SCHEDULED·CONFIRMED·CHECKED_IN·NO_SHOW 를 몰라 영문 원문을 노출했다)
              const status = (p.status as string) ?? '';
              return (
                <tr key={`${pid ?? idx}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-xs text-gray-700">{timeStr}</td>
                  <td className="px-4 py-3 text-xs font-medium text-gray-900">{name}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">{treatment}</td>
                  <td className="px-4 py-3">
                    <StatusBadge domain="appointment" status={status} className="text-[10px] font-bold whitespace-nowrap" />
                  </td>
                  <td className="px-4 py-3">
                    {pid ? (
                      <Link href={`/patients/${pid}?tab=dermatology`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                        <T k="차트 열기" /> &rarr;
                      </Link>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── 하단: 기존 환자 조회 (접기/펼치기) ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <button
          onClick={() => setShowLegacy(!showLegacy)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/50 transition-colors"
        >
          <span className="text-sm font-bold text-gray-700"><T k="개별 환자 조회" /></span>
          <svg className={`w-5 h-5 text-gray-400 transition-transform ${showLegacy ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {showLegacy && (
          <div className="border-t border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-80" data-specialty-patient-picker><PatientSelector value={patientId} onChange={(id) => setPatientId(id)} /></div>
            </div>

            <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
              {([
                { key: 'lesions' as DermTab, label: '병변기록' },
                { key: 'treatments' as DermTab, label: '시술기록' },
                { key: 'photos' as DermTab, label: '사진비교' },
              ]).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
              ))}
            </div>

            {/* 병변기록 */}
            {tab === 'lesions' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <div className="flex justify-center items-center gap-2 mb-3">
                    <button onClick={() => setBodyMapView('front')} className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${bodyMapView === 'front' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><T k="앞면" /></button>
                    <button onClick={() => setBodyMapView('back')} className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${bodyMapView === 'back' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><T k="뒷면" /></button>
                    <span className="w-px h-4 bg-gray-200 mx-1" />
                    <button
                      onClick={() => {
                        if (!bulkMode && !patientId) { toast.warning('환자 ID를 먼저 입력하세요'); return; }
                        if (bulkMode && pendingRegions.length > 0 && !window.confirm('저장하지 않은 병변이 있습니다. 일괄 기록을 종료할까요?')) return;
                        setBulkMode(v => !v);
                        if (bulkMode) setPendingRegions([]);
                      }}
                      className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${bulkMode ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {bulkMode ? <T k="일괄 기록 중" /> : <T k="✏ 일괄 기록" />}
                    </button>
                  </div>
                  {bulkMode && (
                    <p className="text-[11px] text-gray-500 text-center mb-2"><T k="부위를 클릭해 형태·크기를 입력하면 아래 목록에 쌓입니다. 모두 추가한 뒤 한 번에 저장하세요." /></p>
                  )}
                  <BodyMapDiagram
                    lesions={bodyMapLesions}
                    onRegionClick={(region) => { if (!bulkMode) toast.info(`${region} 부위 선택`); }}
                    onAddLesion={bulkMode ? (region, morphology, size) => setPendingRegions(prev => [...prev, { bodyRegion: region, morphology, size: size || undefined }]) : undefined}
                    view={bodyMapView}
                    mode={bulkMode ? 'edit' : 'view'}
                  />
                  {bulkMode && pendingRegions.length > 0 && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {pendingRegions.map((p, i) => (
                          <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-[11px] font-medium">
                            {p.bodyRegion} · {MORPHOLOGY_LABEL[p.morphology] ?? p.morphology}{p.size ? ` · ${p.size}` : ''}
                            <button onClick={() => setPendingRegions(prev => prev.filter((_, idx) => idx !== i))} className="text-emerald-400 hover:text-emerald-700" title={tAttr('제거')}>×</button>
                          </span>
                        ))}
                      </div>
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setPendingRegions([])} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200"><T k="전체 비우기" /></button>
                        <button onClick={() => bodyMapMutation.mutate(pendingRegions)} disabled={bodyMapMutation.isPending}
                          className="px-4 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                          {bodyMapMutation.isPending ? <T k="저장 중..." /> : `병변 ${pendingRegions.length}건 일괄 저장`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {lesions.length > 0 && lesions.some(l => l.dermoscopy || l.pasiScore != null || l.scoradScore != null) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {lesions.filter(l => l.dermoscopy).slice(0, 2).map((l) => {
                      const derm = l.dermoscopy as Record<string, unknown> | null;
                      // 🔴 종전 이 자리에는 총점 하나에서 A·B·C·D·E 항목값을 **산술로 만들어** 칠하는
                      //    코드가 있었다(`abcde >= 1 ? Math.ceil(abcde/2) : 0` …). ABCDE 는 비대칭·경계·
                      //    색상·직경·변화 5개 독립 항목인데 저장된 것은 총점(`abcdeScore` Int) 하나뿐이라,
                      //    실제로 A 가 0 이어도 총점 4면 A 를 2칸 칠했다 = 흑색종 판단 근거 날조(P15).
                      //    항목별 값을 담는 컬럼이 SkinLesion 에 없다 → **총점만 보여주고 없다고 말한다.**
                      const abcde = typeof l.abcdeScore === 'number' ? l.abcdeScore : null;
                      return (
                        <div key={l.id as string} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                          <h4 className="text-sm font-bold text-gray-900 mb-3"><T k="더모스코피" /> - {(l.location as string)}</h4>
                          {derm && (
                            <div className="space-y-2 text-xs text-gray-700 mb-3">
                              {derm.pattern != null ? <div><span className="text-gray-500"><T k="패턴" />:</span> {String(derm.pattern)}</div> : null}
                              {derm.colors != null ? <div><span className="text-gray-500"><T k="색상" />:</span> {Array.isArray(derm.colors) ? (derm.colors as string[]).join(', ') : String(derm.colors)}</div> : null}
                              {derm.structures != null ? <div><span className="text-gray-500"><T k="구조" />:</span> {Array.isArray(derm.structures) ? (derm.structures as string[]).join(', ') : String(derm.structures)}</div> : null}
                            </div>
                          )}
                          <div className="bg-gray-50 rounded-lg p-3">
                            <div className="text-xs text-gray-500 mb-2">ABCDE Score: {abcde == null
                              ? <span className="font-bold text-gray-500">미평가</span>
                              : <span className={`font-bold ${abcde >= 4 ? 'text-red-600' : 'text-emerald-600'}`}>{abcde}/8</span>}
                              {abcde != null && abcde >= 4 && <span className="ml-2 text-red-600">-- 추적 관찰 권고</span>}
                            </div>
                            <p className="text-[10px] text-gray-400">
                              <T k="항목별(A·B·C·D·E) 내역 없음 — 이 기록에는 총점만 저장돼 있습니다" />
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {lesions.some(l => l.pasiScore != null || l.scoradScore != null || l.gagsScore != null || l.breslowThickness != null) && (
                      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                        <h4 className="text-sm font-bold text-gray-900 mb-3"><T k="질환 점수" /></h4>
                        <div className="space-y-3">
                          {lesions.filter(l => l.pasiScore != null).slice(0, 1).map(l => {
                            const v = Number(l.pasiScore); const sev = v <= 5 ? '경증' : v <= 10 ? '중등도' : '중증'; const col = v <= 5 ? 'text-emerald-600' : v <= 10 ? 'text-amber-600' : 'text-red-600';
                            return <div key={`pasi-${l.id}`} className="flex items-center justify-between text-xs"><span className="text-gray-600">PASI (건선)</span><span className={`font-bold ${col}`}>{v} ({sev})</span></div>;
                          })}
                          {lesions.filter(l => l.scoradScore != null).slice(0, 1).map(l => {
                            const v = Number(l.scoradScore); const sev = v < 25 ? '경증' : v < 50 ? '중등도' : '중증'; const col = v < 25 ? 'text-emerald-600' : v < 50 ? 'text-amber-600' : 'text-red-600';
                            return <div key={`scorad-${l.id}`} className="flex items-center justify-between text-xs"><span className="text-gray-600">SCORAD (아토피)</span><span className={`font-bold ${col}`}>{v} ({sev})</span></div>;
                          })}
                          {lesions.filter(l => l.gagsScore != null).slice(0, 1).map(l => {
                            const v = Number(l.gagsScore); const sev = v <= 18 ? '경증' : v <= 30 ? '중등도' : '중증'; const col = v <= 18 ? 'text-emerald-600' : v <= 30 ? 'text-amber-600' : 'text-red-600';
                            return <div key={`gags-${l.id}`} className="flex items-center justify-between text-xs"><span className="text-gray-600">GAGS (여드름)</span><span className={`font-bold ${col}`}>{v} ({sev})</span></div>;
                          })}
                          {lesions.filter(l => l.breslowThickness != null).slice(0, 1).map(l => (
                            <div key={`breslow-${l.id}`} className="text-xs space-y-1">
                              <div className="flex items-center justify-between"><span className="text-gray-600">Breslow 두께</span><span className="font-bold text-gray-900">{Number(l.breslowThickness).toFixed(2)} mm</span></div>
                              {l.clarkLevel != null && <div className="flex items-center justify-between"><span className="text-gray-600">Clark Level</span><span className="font-bold text-gray-900">{['I', 'II', 'III', 'IV', 'V'][Number(l.clarkLevel) - 1] ?? l.clarkLevel}</span></div>}
                              {l.tnmStage != null ? <div className="flex items-center justify-between"><span className="text-gray-600">TNM 병기</span><span className="font-bold text-gray-900">{String(l.tnmStage)}</span></div> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="위치" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부위" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="형태@병변" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="크기" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">ABCDE</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="조직검사" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
                    </tr></thead>
                    <tbody>
                      {!patientId ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : lesionsIsError ? <tr><td colSpan={8} className="p-4"><QueryErrorFallback error={lesionsError} onRetry={() => refetchLesions()} size="compact" /></td></tr>
                      : lesionsLoading ? <LoadingRows cols={8} />
                      : lesions.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="병변기록 없음" /></td></tr>
                      : lesions.map((l) => {
                        // 🔴 종전 `?? 0` 은 **미평가와 "평가했더니 0점"을 같은 초록**으로 만들었다.
                        const score = typeof l.abcdeScore === 'number' ? l.abcdeScore : null;
                        return (
                          <tr key={l.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3 text-xs text-gray-700">{(l.location as string)}</td>
                            <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 whitespace-nowrap">{(l.bodyRegion as string)}</span></td>
                            <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 whitespace-nowrap">{MORPHOLOGY_LABEL[l.morphology as string] ?? (l.morphology as string)}</span></td>
                            <td className="px-4 py-3 text-xs text-gray-700">{(l.size as string) ?? '-'}</td>
                            <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${score == null ? 'bg-gray-100 text-gray-500' : score >= 4 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{score == null ? '미평가' : `${score}/8`}</span></td>
                            <td className="px-4 py-3 text-xs text-gray-700 max-w-[150px] truncate">{(l.diagnosis as string) ?? '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-500">{l.biopsyTaken ? 'O' : '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-400">{l.recordedAt ? kdate(l.recordedAt as string) : '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 시술기록 */}
            {tab === 'treatments' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시술명" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부위" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="약물" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="합병증" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="담당의" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : treatmentsIsError ? <tr><td colSpan={7} className="p-4"><QueryErrorFallback error={treatmentsError} onRetry={() => refetchTreatments()} size="compact" /></td></tr>
                    : treatmentsLoading ? <LoadingRows cols={7} />
                    : treatments.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="시술기록 없음" /></td></tr>
                    : treatments.map((t) => {
                      const doctor = t.treatedByUser as Record<string, unknown> | undefined;
                      return (
                        <tr key={t.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${TX_TYPE_COLOR[t.treatmentType as string] ?? 'bg-gray-100 text-gray-700'}`}>{TX_TYPE_LABEL[t.treatmentType as string] ?? (t.treatmentType as string)}</span></td>
                          <td className="px-4 py-3 text-xs text-gray-700">{(t.procedure as string)}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{(t.area as string) ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{(t.medication as string) ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500 max-w-[150px] truncate">{(t.complications as string) ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{(doctor?.familyName as string) ?? ''}{(doctor?.givenName as string) ?? ''}</td>
                          <td className="px-4 py-3 text-xs text-gray-400">{t.treatedAt ? kdate(t.treatedAt as string) : '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 사진비교 */}
            {tab === 'photos' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                  {!patientId ? <p className="text-center text-gray-400 py-12"><T k="환자 ID를 입력하세요" /></p>
                  : treatmentsIsError ? <QueryErrorFallback error={treatmentsError} onRetry={() => refetchTreatments()} size="compact" />
                  : treatmentsLoading ? <div className="py-12 text-center text-gray-400"><T k="로딩 중..." /></div>
                  : treatments.filter(t => t.beforePhotoUrl || t.afterPhotoUrl).length === 0
                    // 🔴 사진이 없는데 빈 비교 슬라이더를 그려 "비교할 사진이 있는 것"처럼 보였다(2026-10-07)
                    ? <p className="text-center text-gray-400 py-12" data-derm-photos-empty><T k="치료 전·후 사진이 등록된 시술이 없습니다" /></p>
                    : (
                      <div className="space-y-6">
                        {treatments.filter(t => t.beforePhotoUrl || t.afterPhotoUrl).map((t) => (
                          <div key={t.id as string}>
                            <div className="flex items-center justify-between mb-2">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${TX_TYPE_COLOR[t.treatmentType as string] ?? 'bg-gray-100'}`}>{TX_TYPE_LABEL[t.treatmentType as string] ?? (t.treatmentType as string)}</span>
                              <span className="text-xs text-gray-400">{t.treatedAt ? kdate(t.treatedAt as string) : ''}</span>
                            </div>
                            <BeforeAfterSlider beforeUrl={(t.beforePhotoUrl as string) ?? undefined} afterUrl={(t.afterPhotoUrl as string) ?? undefined} beforeLabel={tAttr('치료 전')} afterLabel={tAttr('치료 후')} />
                            <p className="text-xs text-gray-700 mt-2 text-center">{(t.procedure as string)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
