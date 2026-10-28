'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import EyeDiagram from '@/components/specialty/EyeDiagram';
import IopTrendChart from '@/components/specialty/IopTrendChart';
import type { IopDataPoint } from '@/components/specialty/IopTrendChart';
import FundusChart from '@/components/specialty/FundusChart';
import VisualFieldMap from '@/components/specialty/VisualFieldMap';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

type OphSubTab = 'exams' | 'surgeries' | 'iop' | 'prescriptions';

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

// refractionOd/Os 는 JsonB({sphere,cylinder,axis}) — raw 캐스팅(as string)하면 '[object Object]' 렌더되던 것을
// 기존 포맷터로 변환. 객체 아님/null 은 undefined(EyeDiagram 미표시).
export const fmtRefractionObj = (v: unknown): string | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as { sphere?: number | null; cylinder?: number | null; axis?: number | null };
  const out = formatRefraction(r.sphere, r.cylinder, r.axis);
  return out === '-' ? undefined : out;
};

interface OphthalmologyTabProps {
  patientId: string;
}

/** 미측정은 null — 0 mmHg 로 접지 않는다(대시보드 `(main)/ophthalmology/page.tsx` 와 같은 규칙). */
const numOrNull = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export function OphthalmologyTab({ patientId }: OphthalmologyTabProps) {
  const [tab, setTab] = useState<OphSubTab>('exams');
  const [rxForm, setRxForm] = useState<PrescriptionForm>(emptyPrescriptionForm);
  const [showRxForm, setShowRxForm] = useState(false);
  const queryClient = useQueryClient();

  const { data: examsData, isLoading: examsLoading, isError, error, refetch } = useQuery({
    queryKey: ['oph-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/ophthalmology/exam/${patientId}`),
    enabled: tab === 'exams' && !!patientId,
  });

  const { data: surgeriesData, isLoading: surgeriesLoading, isError: surgeriesIsError, error: surgeriesError, refetch: refetchSurgeries } = useQuery({
    queryKey: ['oph-surgeries', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/ophthalmology/surgery/${patientId}`),
    enabled: tab === 'surgeries' && !!patientId,
  });

  const { data: iopData, isLoading: iopLoading, isError: iopIsError, error: iopError, refetch: refetchIop } = useQuery({
    queryKey: ['oph-iop', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/ophthalmology/iop-trend/${patientId}`),
    enabled: tab === 'iop' && !!patientId,
  });

  const { data: rxData, isLoading: rxLoading, isError: rxIsError, error: rxError, refetch: refetchRx } = useQuery({
    queryKey: ['oph-prescriptions', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/ophthalmology/prescriptions/${patientId}`),
    enabled: tab === 'prescriptions' && !!patientId,
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

  // 🔴 미측정 안압을 0 mmHg 로 그리지 않는다(0 은 안구가 존재할 수 없는 값) — 대시보드와 같은 규칙
  const iopChartData: IopDataPoint[] = useMemo(() => iopTrend.map((d) => ({
    date: d.examinedAt ? kdate(d.examinedAt as string, 'monthDay') : '',
    od: numOrNull(d.iopOd),
    os: numOrNull(d.iopOs),
  })), [iopTrend]);

  const latestExam = exams.length > 0 ? exams[0] : null;

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  return (
    <div>
      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'exams' as OphSubTab, label: '검사기록' },
          { key: 'surgeries' as OphSubTab, label: '수술기록' },
          { key: 'iop' as OphSubTab, label: '안압추이' },
          { key: 'prescriptions' as OphSubTab, label: '처방전' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t.label}</button>
        ))}
      </div>

      {/* 검사기록 */}
      {tab === 'exams' && (
        <div className="space-y-4">
        {latestExam && (
          <>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <EyeDiagram
                od={{
                  va: (latestExam.vaOdCorrected as string) ?? (latestExam.vaOdUncorrected as string) ?? '-',
                  // 🔴 EyeDiagram 은 `iop: number | null` 을 받아 미측정을 '미측정'으로 그린다 —
                  //    `?? 0` 이 그 정직한 분기를 **도달 불가**로 만들고 0 mmHg 를 그리고 있었다.
                  iop: numOrNull(latestExam.iopOd),
                  refraction: fmtRefractionObj(latestExam.refractionOd),
                }}
                os={{
                  va: (latestExam.vaOsCorrected as string) ?? (latestExam.vaOsUncorrected as string) ?? '-',
                  iop: numOrNull(latestExam.iopOs),
                  refraction: fmtRefractionObj(latestExam.refractionOs),
                }}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <FundusChart
                  od={{ disc: 'normal', macula: 'normal', vessels: 'normal', periphery: 'normal' }}
                  os={{ disc: 'normal', macula: 'normal', vessels: 'normal', periphery: 'normal' }}
                  onRegionClick={(eye, region) => toast.info(`${eye} ${region} 선택`)}
                />
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <VisualFieldMap
                  od={{ points: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 3)), md: -2.1, psd: 1.8, vfi: 97 }}
                  os={{ points: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 3)), md: -1.5, psd: 1.4, vfi: 98 }}
                />
              </div>
            </div>
          </>
        )}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시력(OD)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시력(OS)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="안압(OD)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="안압(OS)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="안저" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사의" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
            </tr></thead>
            <tbody>
              {examsLoading ? <LoadingRows cols={8} />
              : exams.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="검사기록 없음" /></td></tr>
              : exams.map((e) => {
                const doctor = e.examiner as Record<string, unknown> | undefined;
                return (
                  <tr key={e.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-xs text-gray-700">
                      <span className="text-gray-400"><T k="나안" /></span> {(e.vaOdUncorrected as string) ?? '-'}
                      <br /><span className="text-gray-400"><T k="교정" /></span> {(e.vaOdCorrected as string) ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      <span className="text-gray-400"><T k="나안" /></span> {(e.vaOsUncorrected as string) ?? '-'}
                      <br /><span className="text-gray-400"><T k="교정" /></span> {(e.vaOsCorrected as string) ?? '-'}
                    </td>
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
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="술전 시력" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="술후 시력" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="합병증" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="집도의" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
            </tr></thead>
            <tbody>
              {surgeriesIsError ? <tr><td colSpan={8} className="p-4"><QueryErrorFallback error={surgeriesError} onRetry={() => refetchSurgeries()} size="compact" /></td></tr>
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
            <button onClick={() => setShowRxForm(!showRxForm)}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
              {showRxForm ? '취소' : '+ 처방전 작성'}
            </button>
          </div>

          {showRxForm && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-sm font-medium text-gray-700"><T k="유형:" /></span>
                {(['GLASSES', 'CONTACTS'] as const).map(t => (
                  <button key={t} onClick={() => setRxForm(prev => ({ ...prev, prescriptionType: t }))}
                    className={`px-3 py-1.5 text-sm rounded-lg font-medium ${rxForm.prescriptionType === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {t === 'GLASSES' ? '안경' : '콘택트렌즈'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-gray-900"><T k="우안 (OD)" /></h4>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'odSphere', label: 'SPH' }, { key: 'odCylinder', label: 'CYL' },
                      { key: 'odAxis', label: 'AXIS' }, { key: 'odAdd', label: 'ADD' },
                    ].map(f => (
                      <div key={f.key}>
                        <label className="text-[10px] text-gray-500">{f.label}</label>
                        <input type="number" step="0.25" value={rxForm[f.key as keyof PrescriptionForm]} onChange={(e) => setRxForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-gray-900"><T k="좌안 (OS)" /></h4>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'osSphere', label: 'SPH' }, { key: 'osCylinder', label: 'CYL' },
                      { key: 'osAxis', label: 'AXIS' }, { key: 'osAdd', label: 'ADD' },
                    ].map(f => (
                      <div key={f.key}>
                        <label className="text-[10px] text-gray-500">{f.label}</label>
                        <input type="number" step="0.25" value={rxForm[f.key as keyof PrescriptionForm]} onChange={(e) => setRxForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500">PD (mm)</label>
                  <input type="number" step="0.5" value={rxForm.pd} onChange={(e) => setRxForm(prev => ({ ...prev, pd: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                </div>
                {rxForm.prescriptionType === 'CONTACTS' && (
                  <>
                    <div>
                      <label className="text-[10px] text-gray-500">BC</label>
                      <input type="number" step="0.1" value={rxForm.baseCurve} onChange={(e) => setRxForm(prev => ({ ...prev, baseCurve: e.target.value }))}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">DIA</label>
                      <input type="number" step="0.1" value={rxForm.diameter} onChange={(e) => setRxForm(prev => ({ ...prev, diameter: e.target.value }))}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500"><T k="브랜드" /></label>
                      <input type="text" value={rxForm.brand} onChange={(e) => setRxForm(prev => ({ ...prev, brand: e.target.value }))}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                    </div>
                  </>
                )}
              </div>
              <div className="flex justify-end">
                <button onClick={handleRxSubmit} disabled={rxMutation.isPending}
                  className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                  {rxMutation.isPending ? '저장 중...' : '처방전 저장'}
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="OD 굴절" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="OS 굴절" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">PD</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="브랜드" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="처방의" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
              </tr></thead>
              <tbody>
                {rxIsError ? <tr><td colSpan={7} className="p-4"><QueryErrorFallback error={rxError} onRetry={() => refetchRx()} size="compact" /></td></tr>
                : rxLoading ? <LoadingRows cols={7} />
                : prescriptions.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="처방전 없음" /></td></tr>
                : prescriptions.map((rx) => {
                  const doc = rx.prescriber as Record<string, unknown> | undefined;
                  return (
                    <tr key={rx.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${rx.prescriptionType === 'GLASSES' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                          {rx.prescriptionType === 'GLASSES' ? '안경' : '콘택트'}
                        </span>
                      </td>
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
              {iopIsError ? <tr><td colSpan={5} className="p-4"><QueryErrorFallback error={iopError} onRetry={() => refetchIop()} size="compact" /></td></tr>
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
                    <td className="px-4 py-3">{high && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap"><T k="높음" /></span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </div>
  );
}
