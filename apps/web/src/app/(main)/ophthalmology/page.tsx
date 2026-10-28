'use client';

// 🔴 (2026-10-07) refractionOd/Os 는 JsonB {sphere,cylinder,axis} — `as string` 으로 넘겨 객체가 React 자식이 되어 검사기록 탭이 죽었다. 차트 탭과 같은 포맷터 하나로
import { fmtRefractionObj } from '../patients/[id]/components/OphthalmologyTab';
import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import PatientSelector from '@/components/ui/PatientSelector';
import { SpecialtyPatientListMeta, specialtyPatientMeta } from '@/components/specialty/SpecialtyPatientListMeta';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import EyeDiagram from '@/components/specialty/EyeDiagram';
import IopTrendChart from '@/components/specialty/IopTrendChart';
import type { IopDataPoint } from '@/components/specialty/IopTrendChart';
import FundusChart from '@/components/specialty/FundusChart';
import VisualFieldMap from '@/components/specialty/VisualFieldMap';
import StatCard from '@/components/ui/StatCard';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { kdate } from '@/lib/ui-settings';

type OphTab = 'exams' | 'surgeries' | 'iop' | 'prescriptions';

interface PrescriptionForm {
  prescriptionType: 'GLASSES' | 'CONTACTS';
  odSphere: string; odCylinder: string; odAxis: string; odAdd: string;
  osSphere: string; osCylinder: string; osAxis: string; osAdd: string;
  pd: string; baseCurve: string; diameter: string; brand: string;
}

const emptyPrescriptionForm: PrescriptionForm = {
  prescriptionType: 'GLASSES',
  odSphere: '', odCylinder: '', odAxis: '', odAdd: '',
  osSphere: '', osCylinder: '', osAxis: '', osAdd: '',
  pd: '', baseCurve: '', diameter: '', brand: '',
};


const formatRefraction = (sph?: number | null, cyl?: number | null, axis?: number | null): string => {
  if (sph == null) return '-';
  let s = sph >= 0 ? `+${Number(sph).toFixed(2)}` : Number(sph).toFixed(2);
  if (cyl != null && cyl !== 0) {
    s += ` ${cyl >= 0 ? '+' : ''}${Number(cyl).toFixed(2)}`;
    if (axis != null) s += ` \u00D7 ${axis}`;
  }
  return s;
};

// 🔴 안저 소견은 자유 텍스트("CDR 0.6, 상측 시신경 함몰")다. 등급(정상/이상/병적)으로 **추정하지 않는다** —
//    '정상'만 확정하고 나머지는 '미상'으로 두되, **원문을 그대로 화면에 보여준다**.
//    종전엔 4부위 × 양안을 전부 'normal' 상수로 넘겨 녹내장 소견이 초록 '정상'으로 보였다(2026-08-13 W4).
const fundusGrade = (v: unknown): string => (typeof v === 'string' && v.trim() === '정상' ? 'normal' : 'unknown');
const asRegions = (f: unknown) => {
  const o = (f ?? {}) as Record<string, unknown>;
  return { disc: fundusGrade(o.disc), macula: fundusGrade(o.macula), vessels: fundusGrade(o.vessels), periphery: fundusGrade(o.periphery) };
};
const regionText = (f: unknown, key: string): string => {
  const v = ((f ?? {}) as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v : '기록 없음';
};
const numOrNull = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const FUNDUS_REGIONS: [string, string][] = [['disc', '시신경유두'], ['macula', '황반부'], ['vessels', '혈관'], ['periphery', '주변부']];

export default function OphthalmologyPage() {
  const tAttr = useTAttr();
  const [showLegacy, setShowLegacy] = useState(false);
  const [tab, setTab] = useState<OphTab>('exams');
  const [patientId, setPatientId] = useState('');
  const [rxForm, setRxForm] = useState<PrescriptionForm>(emptyPrescriptionForm);
  const [showRxForm, setShowRxForm] = useState(false);
  const queryClient = useQueryClient();

  // ── Dashboard data ──
  const { data: todayData, isLoading: todayLoading, isError: todayError, error: todayErr, refetch: todayRefetch } = useQuery({
    queryKey: ['oph-today'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/ophthalmology/today'),
  });
  const { data: statsData, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['oph-stats'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/ophthalmology/stats'),
  });
  const { data: patientsData, isLoading: patientsLoading, isError: patientsIsError, error: patientsError, refetch: refetchPatients } = useQuery({
    queryKey: ['oph-patients'],
    queryFn: () => apiClient.get<{ data: Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> }>('/api/v1/ophthalmology/patients'),
  });
  const myPatients = (() => { const r = patientsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> ?? []; })();

  const todayPatients: Record<string, unknown>[] = (() => { const r = todayData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const stats: Record<string, unknown> = (() => { const r = statsData?.data; if (r && typeof r === 'object' && !Array.isArray(r) && 'data' in (r as unknown as Record<string, unknown>)) return (r as unknown as Record<string, unknown>).data as Record<string, unknown>; return (r ?? {}) as Record<string, unknown>; })();

  // ── Legacy patient data ──
  const { data: examsData, isLoading: examsLoading, isError: examsIsError, error: examsError, refetch: refetchExams } = useQuery({
    queryKey: ['oph-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/ophthalmology/exam/${patientId}`),
    enabled: tab === 'exams' && !!patientId && showLegacy,
  });

  const { data: surgeriesData, isLoading: surgeriesLoading, isError: surgeriesIsError, error: surgeriesError, refetch: refetchSurgeries } = useQuery({
    queryKey: ['oph-surgeries', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/ophthalmology/surgery/${patientId}`),
    enabled: tab === 'surgeries' && !!patientId && showLegacy,
  });

  const { data: iopData, isLoading: iopLoading, isError: iopIsError, error: iopError, refetch: refetchIop } = useQuery({
    queryKey: ['oph-iop', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/ophthalmology/iop-trend/${patientId}`),
    enabled: tab === 'iop' && !!patientId && showLegacy,
  });

  const { data: rxData, isLoading: rxLoading, isError: rxIsError, error: rxError, refetch: refetchRx } = useQuery({
    queryKey: ['oph-prescriptions', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/ophthalmology/prescriptions/${patientId}`),
    enabled: tab === 'prescriptions' && !!patientId && showLegacy,
  });

  const rxMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post('/api/v1/ophthalmology/prescriptions', payload),
    onSuccess: () => {
      toast.success('처방전이 생성되었습니다');
      queryClient.invalidateQueries({ queryKey: ['oph-prescriptions', patientId] });
      setShowRxForm(false);
      setRxForm(emptyPrescriptionForm);
    },
    onError: () => toast.error('처방전 생성에 실패했습니다'),
  });

  const handleRxSubmit = useCallback(() => {
    if (!patientId) { toast.error('환자 ID를 입력하세요'); return; }
    const payload: Record<string, unknown> = {
      patientId,
      prescriptionType: rxForm.prescriptionType,
      ...(rxForm.odSphere ? { odSphere: parseFloat(rxForm.odSphere) } : {}),
      ...(rxForm.odCylinder ? { odCylinder: parseFloat(rxForm.odCylinder) } : {}),
      ...(rxForm.odAxis ? { odAxis: parseInt(rxForm.odAxis) } : {}),
      ...(rxForm.odAdd ? { odAdd: parseFloat(rxForm.odAdd) } : {}),
      ...(rxForm.osSphere ? { osSphere: parseFloat(rxForm.osSphere) } : {}),
      ...(rxForm.osCylinder ? { osCylinder: parseFloat(rxForm.osCylinder) } : {}),
      ...(rxForm.osAxis ? { osAxis: parseInt(rxForm.osAxis) } : {}),
      ...(rxForm.osAdd ? { osAdd: parseFloat(rxForm.osAdd) } : {}),
      ...(rxForm.pd ? { pd: parseFloat(rxForm.pd) } : {}),
      ...(rxForm.baseCurve ? { baseCurve: parseFloat(rxForm.baseCurve) } : {}),
      ...(rxForm.diameter ? { diameter: parseFloat(rxForm.diameter) } : {}),
      ...(rxForm.brand ? { brand: rxForm.brand } : {}),
    };
    rxMutation.mutate(payload);
  }, [patientId, rxForm, rxMutation]);

  const exams: Record<string, unknown>[] = (() => { const r = examsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const surgeries: Record<string, unknown>[] = (() => { const r = surgeriesData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const prescriptions: Record<string, unknown>[] = (() => { const r = rxData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const iopTrend: Record<string, unknown>[] = (() => { const r = iopData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  /**
   * 🔴 종전 `Number(d.iopOd ?? 0)` 은 **미측정 안압을 0 mmHg 로 그렸다.** 안압 0 은 임상적으로
   *    불가능한 값(안구가 존재할 수 없다)인데 차트는 급락 선으로 그렸고, 같은 화면 아래 표는
   *    같은 값을 '-' 로 냈다 — 한 화면이 같은 사실을 두 가지로 말했다.
   *    서버 필터는 `iopOd: { not: null }` 뿐이라 `iopOs` 는 비어 올 수 있다. 미측정은 `null` 로 넘기고
   *    차트가 그 점을 건너뛴다.
   */
  const iopChartData: IopDataPoint[] = useMemo(() => iopTrend.map((d) => ({
    date: d.examinedAt ? kdate(d.examinedAt as string, 'monthDay') : '',
    od: numOrNull(d.iopOd),
    os: numOrNull(d.iopOs),
  })), [iopTrend]);

  const latestExam = exams.length > 0 ? exams[0] : null;

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  if (todayError) return <QueryErrorFallback error={todayErr} onRetry={todayRefetch} />;

  return (
    <div>
      <PageHeader title={tAttr('안과 대시보드')} />

      {/* ── 상단: 오늘의 현황 카드 ── 🔴 통계 조회 실패를 "0건"으로 말하지 않는다 */}
      {statsIsError && <div className="mb-6"><QueryErrorFallback error={statsError} onRetry={refetchStats} size="compact" /></div>}
      {!statsIsError && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {/* 🔴 노쇼는 총계에는 들어가는데 완료·진행·대기 어디에도 없어 "예약 1 / 나머지 0" 으로 보였다 —
            의사는 "아직 안 왔다"로 읽지만 이미 노쇼 확정이다. 4칸 합 + 노쇼 = 총계. */}
        <StatCard
          title={tAttr('오늘 예약')}
          value={Number(stats.todayAppointments ?? stats.totalAppointments ?? todayPatients.length ?? 0)}
          subtitle={Number(stats.noShow ?? 0) > 0 ? `노쇼 ${Number(stats.noShow)}` : undefined}
          color="gray"
        />
        <StatCard title={tAttr('완료')} value={Number(stats.completedToday ?? stats.completed ?? 0)} color="emerald" />
        <StatCard title={tAttr('진행 중')} value={Number(stats.inProgressToday ?? stats.inProgress ?? 0)} color="blue" />
        <StatCard title={tAttr('대기')} value={Number(stats.waitingToday ?? stats.waiting ?? 0)} color="amber" />
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
            {patientsIsError ? <tr><td colSpan={4} className="px-4 py-3"><QueryErrorFallback error={patientsError} onRetry={refetchPatients} size="compact" /></td></tr>
            : patientsLoading ? <LoadingRows cols={4} />
            : myPatients.length === 0 ? (
              <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="안과 기록이 있는 환자가 없습니다" /></td></tr>
            ) : myPatients.map((p) => (
              <tr key={p.patientId} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-xs font-medium text-gray-900">{`${p.familyName ?? ''}${p.givenName ?? ''}`}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{p.mrn ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{p.lastDate ? kdate(p.lastDate) : '-'}</td>
                <td className="px-4 py-3">
                  <Link href={`/patients/${p.patientId}?tab=ophthalmology`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사/시술" /></th>
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
                      <Link href={`/patients/${pid}?tab=ophthalmology`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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
                { key: 'exams' as OphTab, label: '검사기록' },
                { key: 'surgeries' as OphTab, label: '수술기록' },
                { key: 'iop' as OphTab, label: '안압추이' },
                { key: 'prescriptions' as OphTab, label: '처방전' },
              ]).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
              ))}
            </div>

            {/* 검사기록 */}
            {tab === 'exams' && (
              <div className="space-y-4">
                {latestExam && (
                  <>
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                      <EyeDiagram
                        od={{ va: (latestExam.vaOdCorrected as string) ?? (latestExam.vaOdUncorrected as string) ?? '-', iop: numOrNull(latestExam.iopOd), refraction: fmtRefractionObj(latestExam.refractionOd) }}
                        os={{ va: (latestExam.vaOsCorrected as string) ?? (latestExam.vaOsUncorrected as string) ?? '-', iop: numOrNull(latestExam.iopOs), refraction: fmtRefractionObj(latestExam.refractionOs) }}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                        <FundusChart od={asRegions(latestExam.fundusOd)} os={asRegions(latestExam.fundusOs)} onRegionClick={(eye, region) => toast.info(`${eye} ${region} 선택`)} />
                        {/* 등급으로 추정할 수 없는 소견 원문 — 그림이 '미상'이어도 임상 내용은 읽을 수 있어야 한다 */}
                        <table className="w-full mt-3 text-[11px]">
                          <thead><tr className="text-gray-400"><th className="text-left font-medium py-1"><T k="부위" /></th><th className="text-left font-medium">우안(OD)</th><th className="text-left font-medium">좌안(OS)</th></tr></thead>
                          <tbody>
                            {FUNDUS_REGIONS.map(([key, label]) => (
                              <tr key={key} className="border-t border-gray-50">
                                <td className="py-1 text-gray-500">{label}</td>
                                <td className="py-1 text-gray-800">{regionText(latestExam.fundusOd, key)}</td>
                                <td className="py-1 text-gray-800">{regionText(latestExam.fundusOs, key)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                        {/* points(8×8 감도 격자)는 서버가 저장하지 않는다 — 가짜 격자 대신 '자료 없음'을 말한다 */}
                        <VisualFieldMap
                          od={{ points: null, md: numOrNull((latestExam.vfOd as Record<string, unknown>)?.md), psd: numOrNull((latestExam.vfOd as Record<string, unknown>)?.psd), vfi: numOrNull((latestExam.vfOd as Record<string, unknown>)?.vfi) }}
                          os={{ points: null, md: numOrNull((latestExam.vfOs as Record<string, unknown>)?.md), psd: numOrNull((latestExam.vfOs as Record<string, unknown>)?.psd), vfi: numOrNull((latestExam.vfOs as Record<string, unknown>)?.vfi) }}
                        />
                      </div>
                    </div>
                  </>
                )}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">시력(OD)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">시력(OS)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">안압(OD)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">안압(OS)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">안저</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사의" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
                    </tr></thead>
                    <tbody>
                      {!patientId ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : examsIsError ? <tr><td colSpan={8} className="px-4 py-3"><QueryErrorFallback error={examsError} onRetry={refetchExams} size="compact" /></td></tr>
                      : examsLoading ? <LoadingRows cols={8} />
                      : exams.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="검사기록 없음" /></td></tr>
                      : exams.map((e) => {
                        const doctor = e.examiner as Record<string, unknown> | undefined;
                        return (
                          <tr key={e.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3 text-xs text-gray-700"><span className="text-gray-400">나안</span> {(e.vaOdUncorrected as string) ?? '-'}<br /><span className="text-gray-400">교정</span> {(e.vaOdCorrected as string) ?? '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-700"><span className="text-gray-400">나안</span> {(e.vaOsUncorrected as string) ?? '-'}<br /><span className="text-gray-400">교정</span> {(e.vaOsCorrected as string) ?? '-'}</td>
                            <td className="px-4 py-3 text-xs font-bold text-gray-900">{e.iopOd != null ? `${e.iopOd} mmHg` : '-'}</td>
                            <td className="px-4 py-3 text-xs font-bold text-gray-900">{e.iopOs != null ? `${e.iopOs} mmHg` : '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-500">{e.fundusOd ? 'O' : '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-700 max-w-[150px] truncate">{(e.diagnosis as string) ?? '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-700">{(doctor?.familyName as string) ?? ''}{(doctor?.givenName as string) ?? ''}</td>
                            <td className="px-4 py-3 text-xs text-gray-400">{e.examinedAt ? kdate(e.examinedAt as string) : '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 수술기록 */}
            {tab === 'surgeries' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="눈" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="수술명" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">IOL</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">술전 시력</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">술후 시력</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="합병증" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="집도의" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : surgeriesIsError ? <tr><td colSpan={8} className="px-4 py-3"><QueryErrorFallback error={surgeriesError} onRetry={refetchSurgeries} size="compact" /></td></tr>
                    : surgeriesLoading ? <LoadingRows cols={8} />
                    : surgeries.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="수술기록 없음" /></td></tr>
                    : surgeries.map((s) => {
                      const doctor = s.operator as Record<string, unknown> | undefined;
                      return (
                        <tr key={s.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 whitespace-nowrap">{(s.eye as string)}</span></td>
                          <td className="px-4 py-3 text-xs text-gray-700">{(s.procedure as string)}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{(s.iolModel as string) ?? '-'}{s.iolPower ? ` (${s.iolPower})` : ''}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{(s.preOpVa as string) ?? '-'}</td>
                          <td className="px-4 py-3 text-xs font-bold text-gray-900">{(s.postOpVa as string) ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500 max-w-[150px] truncate">{(s.complications as string) ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{(doctor?.familyName as string) ?? ''}{(doctor?.givenName as string) ?? ''}</td>
                          <td className="px-4 py-3 text-xs text-gray-400">{s.operatedAt ? kdate(s.operatedAt as string) : '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 처방전 */}
            {tab === 'prescriptions' && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <button onClick={() => setShowRxForm(!showRxForm)} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                    {showRxForm ? <T k="취소" /> : <T k="+ 처방전 작성" />}
                  </button>
                </div>
                {showRxForm && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-sm font-medium text-gray-700"><T k="유형" />:</span>
                      {(['GLASSES', 'CONTACTS'] as const).map(t => (
                        <button key={t} onClick={() => setRxForm(prev => ({ ...prev, prescriptionType: t }))}
                          className={`px-3 py-1.5 text-sm rounded-lg font-medium ${rxForm.prescriptionType === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                          {t === 'GLASSES' ? <T k="안경" /> : <T k="콘택트렌즈" />}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <h4 className="text-sm font-bold text-gray-900"><T k="우안 (OD)" /></h4>
                        <div className="grid grid-cols-2 gap-2">
                          {[{ key: 'odSphere', label: 'SPH' }, { key: 'odCylinder', label: 'CYL' }, { key: 'odAxis', label: 'AXIS' }, { key: 'odAdd', label: 'ADD' }].map(f => (
                            <div key={f.key}><label className="text-[10px] text-gray-500">{f.label}</label><input type="number" step="0.25" value={rxForm[f.key as keyof PrescriptionForm]} onChange={(e) => setRxForm(prev => ({ ...prev, [f.key]: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" /></div>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <h4 className="text-sm font-bold text-gray-900"><T k="좌안 (OS)" /></h4>
                        <div className="grid grid-cols-2 gap-2">
                          {[{ key: 'osSphere', label: 'SPH' }, { key: 'osCylinder', label: 'CYL' }, { key: 'osAxis', label: 'AXIS' }, { key: 'osAdd', label: 'ADD' }].map(f => (
                            <div key={f.key}><label className="text-[10px] text-gray-500">{f.label}</label><input type="number" step="0.25" value={rxForm[f.key as keyof PrescriptionForm]} onChange={(e) => setRxForm(prev => ({ ...prev, [f.key]: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" /></div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      <div><label className="text-[10px] text-gray-500">PD (mm)</label><input type="number" step="0.5" value={rxForm.pd} onChange={(e) => setRxForm(prev => ({ ...prev, pd: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" /></div>
                      {rxForm.prescriptionType === 'CONTACTS' && (
                        <>
                          <div><label className="text-[10px] text-gray-500">BC</label><input type="number" step="0.1" value={rxForm.baseCurve} onChange={(e) => setRxForm(prev => ({ ...prev, baseCurve: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" /></div>
                          <div><label className="text-[10px] text-gray-500">DIA</label><input type="number" step="0.1" value={rxForm.diameter} onChange={(e) => setRxForm(prev => ({ ...prev, diameter: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" /></div>
                          <div><label className="text-[10px] text-gray-500"><T k="브랜드" /></label><input type="text" value={rxForm.brand} onChange={(e) => setRxForm(prev => ({ ...prev, brand: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" /></div>
                        </>
                      )}
                    </div>
                    <div className="flex justify-end">
                      <button onClick={handleRxSubmit} disabled={rxMutation.isPending} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                        {rxMutation.isPending ? <T k="저장 중..." /> : <T k="처방전 저장" />}
                      </button>
                    </div>
                  </div>
                )}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">OD 굴절</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">OS 굴절</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">PD</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="브랜드" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="처방의" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
                    </tr></thead>
                    <tbody>
                      {!patientId ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : rxIsError ? <tr><td colSpan={7} className="px-4 py-3"><QueryErrorFallback error={rxError} onRetry={refetchRx} size="compact" /></td></tr>
                      : rxLoading ? <LoadingRows cols={7} />
                      : prescriptions.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="처방전 없음" /></td></tr>
                      : prescriptions.map((rx) => {
                        const doc = rx.prescriber as Record<string, unknown> | undefined;
                        return (
                          <tr key={rx.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${rx.prescriptionType === 'GLASSES' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>{rx.prescriptionType === 'GLASSES' ? <T k="안경" /> : <T k="콘택트" />}</span></td>
                            <td className="px-4 py-3 text-xs font-mono text-gray-900">{formatRefraction(rx.odSphere as number | null, rx.odCylinder as number | null, rx.odAxis as number | null)}</td>
                            <td className="px-4 py-3 text-xs font-mono text-gray-900">{formatRefraction(rx.osSphere as number | null, rx.osCylinder as number | null, rx.osAxis as number | null)}</td>
                            <td className="px-4 py-3 text-xs text-gray-700">{rx.pd != null ? `${rx.pd}mm` : '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-500">{(rx.brand as string) ?? '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-700">{(doc?.familyName as string) ?? ''}{(doc?.givenName as string) ?? ''}</td>
                            <td className="px-4 py-3 text-xs text-gray-400">{rx.prescribedAt ? kdate(rx.prescribedAt as string) : '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 안압추이 */}
            {tab === 'iop' && (
              <div className="space-y-4">
                {iopChartData.length > 0 && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <IopTrendChart data={iopChartData} />
                  </div>
                )}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">IOP OD (mmHg)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">IOP OS (mmHg)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="측정법" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="경고" /></th>
                    </tr></thead>
                    <tbody>
                      {!patientId ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : iopIsError ? <tr><td colSpan={5} className="px-4 py-3"><QueryErrorFallback error={iopError} onRetry={refetchIop} size="compact" /></td></tr>
                      : iopLoading ? <LoadingRows cols={5} />
                      : iopTrend.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="안압 기록 없음" /></td></tr>
                      : iopTrend.map((d) => {
                        // 🔴 미측정을 0 으로 접지 않는다 — 0 mmHg 는 안압으로 존재할 수 없는 값이다
                        const od = d.iopOd == null || d.iopOd === '' ? null : Number(d.iopOd);
                        const os = d.iopOs == null || d.iopOs === '' ? null : Number(d.iopOs);
                        const high = (od != null && od > 21) || (os != null && os > 21);
                        return (
                          <tr key={d.id as string} className={`border-b border-gray-50 hover:bg-gray-50/50 ${high ? 'bg-red-50/50' : ''}`}>
                            <td className="px-4 py-3 text-xs text-gray-700">{d.examinedAt ? kdate(d.examinedAt as string) : '-'}</td>
                            <td className={`px-4 py-3 text-xs font-bold ${od != null && od > 21 ? 'text-red-600' : 'text-gray-900'}`}>{od != null ? od : '-'}</td>
                            <td className={`px-4 py-3 text-xs font-bold ${os != null && os > 21 ? 'text-red-600' : 'text-gray-900'}`}>{os != null ? os : '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-500">{(d.iopMethod as string) ?? '-'}</td>
                            <td className="px-4 py-3">{high && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">높음</span>}</td>
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
