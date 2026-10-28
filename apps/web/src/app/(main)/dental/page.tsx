'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import PatientSelector from '@/components/ui/PatientSelector';
import { SpecialtyPatientListMeta, specialtyPatientMeta } from '@/components/specialty/SpecialtyPatientListMeta';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import DentalChartDiagram from '@/components/specialty/DentalChartDiagram';
import type { ToothStatus } from '@/components/specialty/DentalChartDiagram';
import { derivePerio } from '@/lib/dental-perio';
import ToothSurfaceDiagram from '@/components/specialty/ToothSurfaceDiagram';
import PerioChart from '@/components/specialty/PerioChart';
import { money, kdate } from '@/lib/ui-settings';
import StatusBadge from '@/components/ui/StatusBadge';
import { DENTAL_LAB_STATUS_LABEL, nextDentalLabStatus } from '@hospital-run/shared';

const CATEGORY_LABEL: Record<string, string> = { RESTORATION: '수복', RCT: '근관', EXTRACTION: '발치', PROSTHESIS: '보철', IMPLANT: '임플란트', ORTHODONTIC: '교정', PERIO: '치주', SURGERY: '수술', PREVENTIVE: '예방', COSMETIC: '심미' };
const TOOTH_STATUS_LABEL: Record<string, string> = { NORMAL: '정상', CARIES: '우식', MISSING: '결손', CROWN: '크라운', BRIDGE: '브릿지', IMPLANT: '임플란트', RCT: '근관치료', FILLING: '충전', EXTRACTION_NEEDED: '발치필요' };
const TOOTH_STATUS_COLOR: Record<string, string> = { NORMAL: 'bg-emerald-100 text-emerald-700', CARIES: 'bg-red-100 text-red-700', MISSING: 'bg-gray-200 text-gray-600', CROWN: 'bg-amber-100 text-amber-700', BRIDGE: 'bg-violet-100 text-violet-700', IMPLANT: 'bg-blue-100 text-blue-700', RCT: 'bg-orange-100 text-orange-700', FILLING: 'bg-teal-100 text-teal-700', EXTRACTION_NEEDED: 'bg-rose-100 text-rose-700' };

const LAB_STATUS_LABEL: Record<string, string> = DENTAL_LAB_STATUS_LABEL;
const LAB_STATUS_COLOR: Record<string, string> = {
  ORDERED: 'bg-gray-200 text-gray-700', IMPRESSION_TAKEN: 'bg-indigo-100 text-indigo-700',
  SENT: 'bg-amber-100 text-amber-700', IN_FABRICATION: 'bg-orange-100 text-orange-700',
  RECEIVED: 'bg-emerald-100 text-emerald-700', FITTED: 'bg-blue-100 text-blue-700',
  CEMENTED: 'bg-teal-100 text-teal-700',
};

interface LabOrderForm {
  tooth: string; orderType: string; material: string; shade: string;
  labName: string; dueDate: string;
}
const emptyLabForm: LabOrderForm = { tooth: '', orderType: 'CROWN', material: '', shade: '', labName: '', dueDate: '' };

type DentalTab = 'chart' | 'plans' | 'records' | 'labOrders';

export default function DentalPage() {
  const tAttr = useTAttr();
  const [showLegacy, setShowLegacy] = useState(false);
  const [tab, setTab] = useState<DentalTab>('chart');
  const [patientId, setPatientId] = useState('');
  const [labForm, setLabForm] = useState<LabOrderForm>(emptyLabForm);
  const [showLabForm, setShowLabForm] = useState(false);
  const queryClient = useQueryClient();

  // ── Dashboard data ──
  const { data: todayData, isLoading: todayLoading, isError, error, refetch: refetchToday } = useQuery({
    queryKey: ['dental-today'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/dental/today'),
  });
  const { data: statsData, isLoading: statsLoading, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['dental-stats'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/dental/stats'),
  });
  const { data: patientsData, isLoading: patientsLoading, isError: patientsIsError, error: patientsError, refetch: refetchPatients } = useQuery({
    queryKey: ['dental-patients'],
    queryFn: () => apiClient.get<{ data: Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> }>('/api/v1/dental/patients'),
  });
  const myPatients = (() => { const r = patientsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> ?? []; })();

  const todayPatients: Record<string, unknown>[] = (() => { const r = todayData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const stats: Record<string, unknown> = (() => { const r = statsData?.data; if (r && typeof r === 'object' && !Array.isArray(r) && 'data' in (r as unknown as Record<string, unknown>)) return (r as unknown as Record<string, unknown>).data as Record<string, unknown>; return (r ?? {}) as Record<string, unknown>; })();

  // ── Legacy patient chart data ──
  const { data: chartData, isLoading: chartLoading, isError: chartIsError, error: chartError, refetch: refetchChart } = useQuery({
    queryKey: ['dental-chart', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/dental/chart/${patientId}`),
    enabled: tab === 'chart' && !!patientId && showLegacy,
  });

  const { data: plansData, isLoading: plansLoading, isError: plansIsError, error: plansError, refetch: refetchPlans } = useQuery({
    queryKey: ['dental-plans', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/dental/plans/${patientId}`),
    enabled: tab === 'plans' && !!patientId && showLegacy,
  });

  const { data: recordsData, isLoading: recordsLoading, isError: recordsIsError, error: recordsError, refetch: refetchRecords } = useQuery({
    queryKey: ['dental-records', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/dental/records/${patientId}`),
    enabled: tab === 'records' && !!patientId && showLegacy,
  });

  const { data: labOrdersData, isLoading: labOrdersLoading, isError: labOrdersIsError, error: labOrdersError, refetch: refetchLabOrders } = useQuery({
    queryKey: ['dental-lab-orders', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/dental/lab-orders${patientId ? `?patientId=${patientId}` : ''}`),
    enabled: tab === 'labOrders' && showLegacy,
  });

  const labOrderMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post('/api/v1/dental/lab-orders', payload),
    onSuccess: () => {
      toast.success('기공의뢰가 생성되었습니다');
      queryClient.invalidateQueries({ queryKey: ['dental-lab-orders'] });
      setShowLabForm(false);
      setLabForm(emptyLabForm);
    },
    onError: () => toast.error('기공의뢰 생성에 실패했습니다'),
  });

  const labStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/api/v1/dental/lab-orders/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('상태가 변경되었습니다');
      queryClient.invalidateQueries({ queryKey: ['dental-lab-orders'] });
    },
    onError: () => toast.error('상태 변경에 실패했습니다'),
  });

  const handleLabSubmit = useCallback(() => {
    if (!patientId) { toast.error('환자 ID를 입력하세요'); return; }
    if (!labForm.tooth || !labForm.material) { toast.error('치아번호와 재료를 입력하세요'); return; }
    labOrderMutation.mutate({
      patientId,
      tooth: labForm.tooth,
      orderType: labForm.orderType,
      material: labForm.material,
      ...(labForm.shade ? { shade: labForm.shade } : {}),
      ...(labForm.labName ? { labName: labForm.labName } : {}),
      ...(labForm.dueDate ? { dueDate: labForm.dueDate } : {}),
    });
  }, [patientId, labForm, labOrderMutation]);

  const getNextStatus = (current: string): string | null => nextDentalLabStatus(current);

  const charts: Record<string, unknown>[] = (() => { const r = chartData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const plans: Record<string, unknown>[] = (() => { const r = plansData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const records: Record<string, unknown>[] = (() => { const r = recordsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const labOrders: Record<string, unknown>[] = (() => { const r = labOrdersData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  const [selectedTooth, setSelectedTooth] = useState<string | null>(null);

  const teethStatusForDiagram: ToothStatus[] = useMemo(() => {
    const result: ToothStatus[] = [];
    charts.forEach((c) => {
      const teeth = (c.teethStatus as Array<Record<string, unknown>>) ?? [];
      teeth.forEach((t) => {
        // 🔴 상태 없는 치아를 'NORMAL'(건전치)로 그리지 않는다 — 기록되지 않은 것은 그리지 않는다(2026-10-07)
        if (typeof t.status !== 'string' || !t.status || typeof t.tooth !== 'string' || !t.tooth) return;
        result.push({
          tooth: t.tooth,
          status: t.status,
          notes: (t.notes as string) ?? undefined,
          surfaces: (t.surfaces as string[]) ?? undefined,
        });
      });
    });
    return result;
  }, [charts]);

  // 치주 파생 정본 = lib/dental-perio(부서 화면·환자 차트 탭 공용)
  const perio = useMemo(() => derivePerio(charts), [charts]);

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  if (isError) return <QueryErrorFallback error={error} onRetry={refetchToday} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="치과 대시보드" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="오늘의 현황 / 환자 목록 / 치료 관리" /></p>
        </div>
      </div>

      {/* ── 상단: 오늘의 현황 카드 ── */}
      {statsIsError && <QueryErrorFallback error={statsError} onRetry={() => refetchStats()} size="compact" className="mb-4" />}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {statsIsError ? null : statsLoading ? (
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
            {patientsIsError ? <tr><td colSpan={4} className="py-6"><QueryErrorFallback error={patientsError} onRetry={() => refetchPatients()} size="compact" /></td></tr>
            : patientsLoading ? <LoadingRows cols={4} />
            : myPatients.length === 0 ? (
              <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="치과 기록이 있는 환자가 없습니다" /></td></tr>
            ) : myPatients.map((p) => (
              <tr key={p.patientId} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-xs font-medium text-gray-900">{`${p.familyName ?? ''}${p.givenName ?? ''}`}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{p.mrn ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{p.lastDate ? kdate(p.lastDate) : '-'}</td>
                <td className="px-4 py-3">
                  <Link href={`/patients/${p.patientId}?tab=dental`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="치료 내용" /></th>
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
                      <Link href={`/patients/${pid}?tab=dental`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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
                { key: 'chart' as DentalTab, label: '치아차트' },
                { key: 'plans' as DentalTab, label: '치료계획' },
                { key: 'records' as DentalTab, label: '치료기록' },
                { key: 'labOrders' as DentalTab, label: '기공의뢰' },
              ]).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
              ))}
            </div>

            {/* 치아차트 */}
            {tab === 'chart' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <DentalChartDiagram teethStatus={teethStatusForDiagram} selectedTooth={selectedTooth} onToothClick={setSelectedTooth} mode="view" />
                </div>
                {selectedTooth && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <ToothSurfaceDiagram
                      tooth={selectedTooth}
                      surfaces={(() => {
                        // 🔴 실제 이환면(surfaces)을 버리고 교합면(O)만 이환으로 그렸다 — #11 은 근심·설측
                        //    우식인데 화면은 정반대(O 우식·M/L 정상)를 말했다(2026-08-13 W4).
                        //    이환면 기록이 없으면 '정상'이 아니라 '미상'이다.
                        const ts = teethStatusForDiagram.find((t) => t.tooth === selectedTooth);
                        if (!ts) return [];
                        const affected = ts.surfaces ?? [];
                        return ['O', 'B', 'L', 'M', 'D'].map((surface) => ({
                          surface,
                          status: affected.length === 0 ? 'UNKNOWN' : affected.includes(surface) ? ts.status : 'NORMAL',
                        }));
                      })()}
                      onSurfaceClick={(surface) => toast.info(`치아 #${selectedTooth} ${surface}면 선택`)}
                    />
                  </div>
                )}
                {patientId && charts.length > 0 && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    {perio.teeth.length > 0 ? (
                      <PerioChart teeth={perio.teeth} pocketDepths={perio.pocketDepths} bleeding={perio.bleeding} mobility={perio.mobility} />
                    ) : (
                      // 측정이 없으면 '정상 수치'를 그리지 않는다 — 없음을 없다고 말한다
                      <div className="py-8 text-center text-sm text-gray-400"><T k="치주 측정 기록 없음" /></div>
                    )}
                  </div>
                )}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="치아번호" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="표면" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="비고" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="기록일" /></th>
                    </tr></thead>
                    <tbody>
                      {!patientId ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : chartIsError ? <tr><td colSpan={5} className="py-6"><QueryErrorFallback error={chartError} onRetry={() => refetchChart()} size="compact" /></td></tr>
                      : chartLoading ? <LoadingRows cols={5} />
                      : charts.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="치아차트 없음" /></td></tr>
                      : charts.map((c) => {
                        const teeth = (c.teethStatus as Array<Record<string, unknown>>) ?? [];
                        return teeth.map((t, i) => (
                          <tr key={`${c.id as string}-${i}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3 text-xs font-bold text-gray-900">#{(t.tooth as string) ?? '-'}</td>
                            <td className="px-4 py-3">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${TOOTH_STATUS_COLOR[t.status as string] ?? 'bg-gray-100'}`}>{TOOTH_STATUS_LABEL[t.status as string] ?? (t.status as string)}</span>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-700">{((t.surfaces as string[]) ?? []).join(', ') || '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{(t.notes as string) ?? '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-400">{c.chartedAt ? kdate(c.chartedAt as string) : '-'}</td>
                          </tr>
                        ));
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 치료계획 */}
            {tab === 'plans' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="치아" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시술명" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="분류" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="우선" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="비용" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="보험" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : plansIsError ? <tr><td colSpan={7} className="py-6"><QueryErrorFallback error={plansError} onRetry={() => refetchPlans()} size="compact" /></td></tr>
                    : plansLoading ? <LoadingRows cols={7} />
                    : plans.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="치료계획 없음" /></td></tr>
                    : plans.map((p) => (
                      <tr key={p.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-xs font-bold text-gray-900">#{(p.tooth as string)}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{(p.procedure as string)}</td>
                        <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 whitespace-nowrap">{CATEGORY_LABEL[p.category as string] ?? (p.category as string)}</span></td>
                        <td className="px-4 py-3 text-xs font-bold text-gray-900">{(p.priority as number) ?? '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{p.estimatedCost ? `${money(Number(p.estimatedCost))}` : '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{p.insuranceCovered === true ? 'Y' : p.insuranceCovered === false ? 'N' : '-'}</td>
                        <td className="px-4 py-3">
                          <StatusBadge domain="plan" status={p.status as string} className="text-[10px] font-bold whitespace-nowrap" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 치료기록 */}
            {tab === 'records' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="치아" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시술명" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="재료" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="마취" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">X-ray</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="담당의" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : recordsIsError ? <tr><td colSpan={7} className="py-6"><QueryErrorFallback error={recordsError} onRetry={() => refetchRecords()} size="compact" /></td></tr>
                    : recordsLoading ? <LoadingRows cols={7} />
                    : records.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="치료기록 없음" /></td></tr>
                    : records.map((r) => {
                      const doctor = r.treatedByUser as Record<string, unknown> | undefined;
                      return (
                        <tr key={r.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3 text-xs font-bold text-gray-900">#{(r.tooth as string)}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{(r.procedure as string)}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{(r.material as string) ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{(r.anesthesia as string) ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{r.xrayTaken ? 'O' : '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{(doctor?.familyName as string) ?? ''}{(doctor?.givenName as string) ?? ''}</td>
                          <td className="px-4 py-3 text-xs text-gray-400">{r.treatedAt ? kdate(r.treatedAt as string) : '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 기공의뢰 */}
            {tab === 'labOrders' && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <button onClick={() => setShowLabForm(!showLabForm)}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                    {showLabForm ? <T k="취소" /> : <T k="+ 기공의뢰 작성" />}
                  </button>
                </div>
                {showLabForm && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] text-gray-500"><T k="치아번호" /></label>
                        <input type="text" value={labForm.tooth} onChange={(e) => setLabForm(prev => ({ ...prev, tooth: e.target.value }))}
                          placeholder={tAttr('예: 16')} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500"><T k="의뢰유형" /></label>
                        <select value={labForm.orderType} onChange={(e) => setLabForm(prev => ({ ...prev, orderType: e.target.value }))}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm">
                          {['CROWN', 'BRIDGE', 'INLAY', 'ONLAY', 'DENTURE', 'VENEER', 'IMPLANT_ABUTMENT', 'ORTHODONTIC', 'NIGHT_GUARD', 'RETAINER'].map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500"><T k="재료" /></label>
                        <input type="text" value={labForm.material} onChange={(e) => setLabForm(prev => ({ ...prev, material: e.target.value }))}
                          placeholder={tAttr('지르코니아, PFM, 골드')} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] text-gray-500"><T k="쉐이드" /></label>
                        <input type="text" value={labForm.shade} onChange={(e) => setLabForm(prev => ({ ...prev, shade: e.target.value }))}
                          placeholder="A2, B1" className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500"><T k="기공소" /></label>
                        <input type="text" value={labForm.labName} onChange={(e) => setLabForm(prev => ({ ...prev, labName: e.target.value }))}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500"><T k="납기일" /></label>
                        <input type="date" value={labForm.dueDate} onChange={(e) => setLabForm(prev => ({ ...prev, dueDate: e.target.value }))}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button onClick={handleLabSubmit} disabled={labOrderMutation.isPending}
                        className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                        {labOrderMutation.isPending ? <T k="저장 중..." /> : <T k="기공의뢰 저장" />}
                      </button>
                    </div>
                  </div>
                )}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="치아" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="재료" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="쉐이드" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="기공소" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="납기" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="액션" /></th>
                    </tr></thead>
                    <tbody>
                      {labOrdersIsError ? <tr><td colSpan={8} className="py-6"><QueryErrorFallback error={labOrdersError} onRetry={() => refetchLabOrders()} size="compact" /></td></tr>
                      : labOrdersLoading ? <LoadingRows cols={8} />
                      : labOrders.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="기공의뢰 없음" /></td></tr>
                      : labOrders.map((lo) => {
                        const next = getNextStatus(lo.status as string);
                        return (
                          <tr key={lo.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3 text-xs font-bold text-gray-900">#{(lo.tooth as string)}</td>
                            <td className="px-4 py-3 text-xs text-gray-700">{(lo.orderType as string)}</td>
                            <td className="px-4 py-3 text-xs text-gray-700">{(lo.material as string)}</td>
                            <td className="px-4 py-3 text-xs text-gray-500">{(lo.shade as string) ?? '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-500">{(lo.labName as string) ?? '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-400">{lo.dueDate ? kdate(lo.dueDate as string) : '-'}</td>
                            <td className="px-4 py-3">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${LAB_STATUS_COLOR[lo.status as string] ?? 'bg-gray-100'}`}>
                                {LAB_STATUS_LABEL[lo.status as string] ?? (lo.status as string)}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {next && (
                                <button
                                  onClick={() => labStatusMutation.mutate({ id: lo.id as string, status: next })}
                                  disabled={labStatusMutation.isPending}
                                  className="text-[10px] font-medium px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 whitespace-nowrap disabled:opacity-50">
                                  {LAB_STATUS_LABEL[next]}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
