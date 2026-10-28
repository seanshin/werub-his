'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import AudiogramChart from '@/components/specialty/AudiogramChart';
import { audiogramSeriesOf, latestAudiogramRow } from '@/lib/specialty/audiogram';
import TympanicDiagram from '@/components/specialty/TympanicDiagram';
import NasalDiagram from '@/components/specialty/NasalDiagram';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

const TYMPANOMETRY_LABEL: Record<string, string> = { A: 'A (정상)', B: 'B (삼출)', C: 'C (음압)', As: 'As (이경화)', Ad: 'Ad (고막이완)' };

// otoscopyRight/Left JsonB 는 한글 tympanic_membrane('정상'/'삼출'…)·discharge 키를 가짐.
// 종전엔 존재하지 않는 status/findings 키를 읽어 고막도해가 항상 'normal' 로 표시되던 것을 실제 키 기준으로 매핑.
const TM_STATUS: Record<string, string> = { '정상': 'normal', '삼출': 'effusion', '함몰': 'retracted', '천공': 'perforation', '충혈': 'effusion' };
function otoToDiagram(o: Record<string, unknown> | null) {
  const tm = (o?.tympanic_membrane as string) ?? '';
  const discharge = o?.discharge as string | undefined;
  return {
    status: TM_STATUS[tm] ?? 'normal',
    lightReflex: (o?.lightReflex as boolean) ?? true,
    findings: discharge && discharge !== '없음' ? `분비물: ${discharge}` : undefined,
  };
}

interface SleepStudyForm {
  studyType: string; studyDate: string; ahi: string;
  oxygenSatMin: string; oxygenSatAvg: string; sleepEfficiency: string;
  totalSleepTime: string;
}
const emptySleepForm: SleepStudyForm = { studyType: 'PSG', studyDate: '', ahi: '', oxygenSatMin: '', oxygenSatAvg: '', sleepEfficiency: '', totalSleepTime: '' };

const SEVERITY_LABEL: Record<string, string> = { NORMAL: '정상', MILD: '경증', MODERATE: '중등증', SEVERE: '중증' };
const SEVERITY_COLOR: Record<string, string> = { NORMAL: 'bg-emerald-100 text-emerald-700', MILD: 'bg-yellow-100 text-yellow-700', MODERATE: 'bg-orange-100 text-orange-700', SEVERE: 'bg-red-100 text-red-700' };

type EntSubTab = 'exams' | 'audiogram' | 'sleep';

interface EntTabProps {
  patientId: string;
}

export function EntTab({ patientId }: EntTabProps) {
  const [tab, setTab] = useState<EntSubTab>('exams');
  const [sleepForm, setSleepForm] = useState<SleepStudyForm>(emptySleepForm);
  const [showSleepForm, setShowSleepForm] = useState(false);
  const queryClient = useQueryClient();

  const { data: examsData, isLoading: examsLoading, isError, error, refetch } = useQuery({
    queryKey: ['ent-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/ent/exam/${patientId}`),
    enabled: tab === 'exams' && !!patientId,
  });

  const { data: audioData, isLoading: audioLoading, isError: audioIsError, error: audioError, refetch: refetchAudio } = useQuery({
    queryKey: ['ent-audiogram', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/ent/audiogram/${patientId}`),
    enabled: tab === 'audiogram' && !!patientId,
  });

  const { data: sleepData, isLoading: sleepLoading, isError: sleepIsError, error: sleepError, refetch: refetchSleep } = useQuery({
    queryKey: ['ent-sleep', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/ent/sleep-study/${patientId}`),
    enabled: tab === 'sleep' && !!patientId,
  });

  const sleepMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post('/api/v1/ent/sleep-study', payload),
    onSuccess: () => {
      toast.success('수면검사가 기록되었습니다');
      queryClient.invalidateQueries({ queryKey: ['ent-sleep', patientId] });
      setShowSleepForm(false);
      setSleepForm(emptySleepForm);
    },
    onError: () => toast.error('수면검사 기록에 실패했습니다'),
  });

  const handleSleepSubmit = useCallback(() => {
    if (!sleepForm.ahi || !sleepForm.studyDate) { toast.error('AHI와 검사일은 필수입니다'); return; }
    sleepMutation.mutate({
      patientId,
      studyType: sleepForm.studyType,
      studyDate: sleepForm.studyDate,
      ahi: parseFloat(sleepForm.ahi),
      ...(sleepForm.oxygenSatMin ? { oxygenSatMin: parseInt(sleepForm.oxygenSatMin) } : {}),
      ...(sleepForm.oxygenSatAvg ? { oxygenSatAvg: parseInt(sleepForm.oxygenSatAvg) } : {}),
      ...(sleepForm.sleepEfficiency ? { sleepEfficiency: parseFloat(sleepForm.sleepEfficiency) } : {}),
      ...(sleepForm.totalSleepTime ? { totalSleepTime: parseInt(sleepForm.totalSleepTime) } : {}),
    });
  }, [patientId, sleepForm, sleepMutation]);

  const exams: Record<string, unknown>[] = (() => { const r = examsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const audiograms: Record<string, unknown>[] = (() => { const r = audioData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const sleepStudies: Record<string, unknown>[] = (() => { const r = sleepData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  // 읽기 정본은 `lib/specialty/audiogram` 하나 — 대시보드(`(main)/ent/page.tsx`)와 같은 함수를 쓴다.
  // (같은 개념의 파서가 두 벌이면 한쪽만 고쳐지고 갈라진다 — 실제로 그렇게 갈라져 있었다.)
  const audiogramChartData = useMemo(
    () => { const row = latestAudiogramRow(audiograms); return row ? { ...audiogramSeriesOf(row), examinedAt: row.examinedAt as string | undefined } : null; },
    [audiograms],
  );

  const parseSleepData = (notes: string | null): Record<string, unknown> => {
    if (!notes) return {};
    try { const d = JSON.parse(notes); return d.type === 'SLEEP_STUDY' ? d : {}; } catch { return {}; }
  };

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  return (
    <div>
      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'exams' as EntSubTab, label: '검사기록' },
          { key: 'audiogram' as EntSubTab, label: '청력검사' },
          { key: 'sleep' as EntSubTab, label: '수면검사' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t.label}</button>
        ))}
      </div>

      {/* 검사기록 */}
      {tab === 'exams' && (
        <div className="space-y-4">
        {exams.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <TympanicDiagram
                right={otoToDiagram(exams[0].otoscopyRight as Record<string, unknown> | null)}
                left={otoToDiagram(exams[0].otoscopyLeft as Record<string, unknown> | null)}
              />
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <NasalDiagram
                septum={{ status: 'normal' }}
                leftTurbinates={[{ status: 'normal' }, { status: 'normal' }, { status: 'normal' }]}
                rightTurbinates={[{ status: 'normal' }, { status: 'normal' }, { status: 'normal' }]}
              />
            </div>
          </div>
        )}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="이경(R)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="이경(L)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">PTA(R)</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">PTA(L)</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="고막운동(R)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="고막운동(L)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
            </tr></thead>
            <tbody>
              {examsLoading ? <LoadingRows cols={8} />
              : exams.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="검사기록 없음" /></td></tr>
              : exams.map((e) => {
                const otR = e.otoscopyRight as Record<string, unknown> | null;
                const otL = e.otoscopyLeft as Record<string, unknown> | null;
                return (
                  <tr key={e.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-xs text-gray-700">{otR ? (otR.tympanic_membrane as string) ?? '-' : '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{otL ? (otL.tympanic_membrane as string) ?? '-' : '-'}</td>
                    <td className="px-4 py-3 text-xs font-bold text-gray-900">{e.ptaRight != null ? `${e.ptaRight} dB` : '-'}</td>
                    <td className="px-4 py-3 text-xs font-bold text-gray-900">{e.ptaLeft != null ? `${e.ptaLeft} dB` : '-'}</td>
                    <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 whitespace-nowrap">{TYMPANOMETRY_LABEL[e.tympanometryRight as string] ?? (e.tympanometryRight as string) ?? '-'}</span></td>
                    <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 whitespace-nowrap">{TYMPANOMETRY_LABEL[e.tympanometryLeft as string] ?? (e.tympanometryLeft as string) ?? '-'}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-[150px] truncate">{(e.diagnosis as string) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{e.examinedAt ? kdate(e.examinedAt as string) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* 청력검사 */}
      {tab === 'audiogram' && (
        <div className="space-y-4">
        {audiogramChartData && (audiogramChartData.rightAC.length > 0 || audiogramChartData.leftAC.length > 0) && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            {/* 🔴 이 차트는 **한 회차**다 — 어느 검사인지 밝힌다(서버는 오래된 순으로 준다). */}
            <p className="text-[11px] text-gray-400 mb-2">
              {audiogramChartData.examinedAt ? `${kdate(audiogramChartData.examinedAt)} 검사` : '검사일 미상'}
              {audiograms.length > 1 ? ` · 최근 1회차(전체 ${audiograms.length}회)` : ''}
            </p>
            <AudiogramChart
              rightAC={audiogramChartData.rightAC}
              leftAC={audiogramChartData.leftAC}
              rightBC={audiogramChartData.rightBC.length > 0 ? audiogramChartData.rightBC : undefined}
              leftBC={audiogramChartData.leftBC.length > 0 ? audiogramChartData.leftBC : undefined}
            />
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">PTA (R) dB</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">PTA (L) dB</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="어음분별 (R)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="어음분별 (L)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="청력등급" /></th>
            </tr></thead>
            <tbody>
              {audioIsError ? <tr><td colSpan={6} className="p-3"><QueryErrorFallback error={audioError} onRetry={() => refetchAudio()} size="compact" /></td></tr>
              : audioLoading ? <LoadingRows cols={6} />
              : audiograms.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="청력검사 없음" /></td></tr>
              : audiograms.map((a) => {
                const ptaR = (a.ptaRight as number) ?? 0;
                const ptaL = (a.ptaLeft as number) ?? 0;
                const maxPta = Math.max(ptaR, ptaL);
                const grade = maxPta <= 25 ? '정상' : maxPta <= 40 ? '경도' : maxPta <= 55 ? '중등도' : maxPta <= 70 ? '중등고도' : maxPta <= 90 ? '고도' : '심도';
                const gradeColor = maxPta <= 25 ? 'bg-emerald-100 text-emerald-700' : maxPta <= 55 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
                return (
                  <tr key={a.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-xs text-gray-700">{a.examinedAt ? kdate(a.examinedAt as string) : '-'}</td>
                    <td className="px-4 py-3 text-xs font-bold text-gray-900">{ptaR || '-'}</td>
                    <td className="px-4 py-3 text-xs font-bold text-gray-900">{ptaL || '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{a.speechRight != null ? `${a.speechRight}%` : '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{a.speechLeft != null ? `${a.speechLeft}%` : '-'}</td>
                    <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${gradeColor}`}>{grade}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* 수면검사 */}
      {tab === 'sleep' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowSleepForm(!showSleepForm)}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
              {showSleepForm ? '취소' : '+ 수면검사 기록'}
            </button>
          </div>

          {showSleepForm && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500"><T k="검사유형" /></label>
                  <select value={sleepForm.studyType} onChange={(e) => setSleepForm(prev => ({ ...prev, studyType: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm">
                    <option value="PSG"><T k="PSG (수면다원검사)" /></option>
                    <option value="HSAT"><T k="HSAT (가정용)" /></option>
                    <option value="MSLT"><T k="MSLT (주간졸림)" /></option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500"><T k="검사일" /></label>
                  <input type="date" value={sleepForm.studyDate} onChange={(e) => setSleepForm(prev => ({ ...prev, studyDate: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500"><T k="AHI (회/시간)" /></label>
                  <input type="number" step="0.1" value={sleepForm.ahi} onChange={(e) => setSleepForm(prev => ({ ...prev, ahi: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500"><T k="SpO2 최저 (%)" /></label>
                  <input type="number" value={sleepForm.oxygenSatMin} onChange={(e) => setSleepForm(prev => ({ ...prev, oxygenSatMin: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500"><T k="SpO2 평균 (%)" /></label>
                  <input type="number" value={sleepForm.oxygenSatAvg} onChange={(e) => setSleepForm(prev => ({ ...prev, oxygenSatAvg: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500"><T k="수면효율 (%)" /></label>
                  <input type="number" step="0.1" value={sleepForm.sleepEfficiency} onChange={(e) => setSleepForm(prev => ({ ...prev, sleepEfficiency: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500"><T k="총수면시간 (분)" /></label>
                  <input type="number" value={sleepForm.totalSleepTime} onChange={(e) => setSleepForm(prev => ({ ...prev, totalSleepTime: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
                </div>
              </div>
              {sleepForm.ahi && (
                <div className="text-xs text-gray-600">
                  <T k="자동 판정:" /> <span className={`font-bold ${parseFloat(sleepForm.ahi) < 5 ? 'text-emerald-600' : parseFloat(sleepForm.ahi) < 15 ? 'text-yellow-600' : parseFloat(sleepForm.ahi) < 30 ? 'text-orange-600' : 'text-red-600'}`}>
                    {parseFloat(sleepForm.ahi) < 5 ? '정상' : parseFloat(sleepForm.ahi) < 15 ? '경증' : parseFloat(sleepForm.ahi) < 30 ? '중등증' : '중증'}
                  </span>
                  {parseFloat(sleepForm.ahi) >= 15 && <span className="ml-2 text-blue-600"><T k="CPAP 권고" /></span>}
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={handleSleepSubmit} disabled={sleepMutation.isPending}
                  className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                  {sleepMutation.isPending ? '저장 중...' : '수면검사 저장'}
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">AHI</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="중증도" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="SpO2 최저" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="수면효율" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">CPAP</th>
                {/* 🔴 수면검사 판독의다 — 무문맥 '판독의' 는 pharmlab 이 'Pathologist'(병리 판독의)로
                     선점한 정본이라, 이 표에 쓰면 영어/일본어로 "병리 전문의"가 나간다.
                     crm2 가 이 자리를 위해 만들어 둔 `판독의@판독`(Interpreting physician)을 쓴다. */}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="판독의@판독" /></th>
              </tr></thead>
              <tbody>
                {sleepIsError ? <tr><td colSpan={8} className="p-3"><QueryErrorFallback error={sleepError} onRetry={() => refetchSleep()} size="compact" /></td></tr>
                : sleepLoading ? <LoadingRows cols={8} />
                : sleepStudies.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="수면검사 없음" /></td></tr>
                : sleepStudies.map((s) => {
                  const isNewModel = s.studyType != null;
                  const sd = isNewModel ? s : parseSleepData(s.notes as string | null);
                  const ahi = Number(isNewModel ? s.ahi : sd.ahi) || 0;
                  const severity = (s.severity as string) ?? (ahi < 5 ? 'NORMAL' : ahi < 15 ? 'MILD' : ahi < 30 ? 'MODERATE' : 'SEVERE');
                  const doc = s.interpreter as Record<string, unknown> | undefined;
                  return (
                    <tr key={s.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-xs text-gray-700">{(s.studyDate ?? s.examinedAt) ? kdate(((s.studyDate ?? s.examinedAt) as string)) : '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{(s.studyType as string) ?? 'PSG'}</td>
                      <td className="px-4 py-3 text-xs font-bold text-gray-900">{ahi || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${SEVERITY_COLOR[severity] ?? 'bg-gray-100'}`}>
                          {SEVERITY_LABEL[severity] ?? severity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700">{(isNewModel ? s.oxygenSatMin : sd.oxygenSatMin) != null ? `${isNewModel ? s.oxygenSatMin : sd.oxygenSatMin}%` : '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{(isNewModel ? s.sleepEfficiency : sd.sleepEfficiency) != null ? `${isNewModel ? s.sleepEfficiency : sd.sleepEfficiency}%` : '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{s.cpapRecommended === true ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 whitespace-nowrap"><T k="권고" /></span> : '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{doc ? `${(doc.familyName as string) ?? ''}${(doc.givenName as string) ?? ''}` : '-'}</td>
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
