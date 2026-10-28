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
import AudiogramChart from '@/components/specialty/AudiogramChart';
import { audiogramSeriesOf, latestAudiogramRow } from '@/lib/specialty/audiogram';
import TympanicDiagram from '@/components/specialty/TympanicDiagram';
import NasalDiagram from '@/components/specialty/NasalDiagram';
import StatusBadge from '@/components/ui/StatusBadge';
import { kdate } from '@/lib/ui-settings';

const TYMPANOMETRY_LABEL: Record<string, string> = { A: 'A (정상)', B: 'B (삼출)', C: 'C (음압)', As: 'As (이경화)', Ad: 'Ad (고막이완)' };

interface SleepStudyForm {
  studyType: string; studyDate: string; ahi: string;
  oxygenSatMin: string; oxygenSatAvg: string; sleepEfficiency: string;
  totalSleepTime: string; cpap: '' | 'YES' | 'NO';
}
// 쓰기 폼은 미선택에서 시작한다(2026-10-07) — 종전 검사유형 PSG·보청기 양측/BTE 가 미리 골라져 있었다
const emptySleepForm: SleepStudyForm = { studyType: '', studyDate: '', ahi: '', oxygenSatMin: '', oxygenSatAvg: '', sleepEfficiency: '', totalSleepTime: '', cpap: '' };

interface HearingAidForm { ear: string; type: string; model: string; notes: string }
const emptyHaForm: HearingAidForm = { ear: '', type: '', model: '', notes: '' };
const EAR_LABEL: Record<string, string> = { LEFT: '좌측', RIGHT: '우측', BOTH: '양측' };
const HA_TYPE_LABEL: Record<string, string> = { BTE: 'BTE (귀걸이형)', RIC: 'RIC (리시버 분리형)', ITE: 'ITE (외이형)', ITC: 'ITC (외이도형)', CIC: 'CIC (고막형)', BAHA: 'BAHA (골전도)' };

const SEVERITY_LABEL: Record<string, string> = { NORMAL: '정상', MILD: '경증', MODERATE: '중등증', SEVERE: '중증', UNKNOWN: '미판정' };
const SEVERITY_COLOR: Record<string, string> = { NORMAL: 'bg-emerald-100 text-emerald-700', MILD: 'bg-yellow-100 text-yellow-700', MODERATE: 'bg-orange-100 text-orange-700', SEVERE: 'bg-red-100 text-red-700', UNKNOWN: 'bg-gray-100 text-gray-500' };


type EntTab = 'exams' | 'audiogram' | 'sleep' | 'hearingAid';

// 🔴 고막 소견의 저장 키는 `tympanic_membrane`(한글 값)인데 다이어그램은 `status`(영문 enum)를 읽어
//    **교집합이 없었다** → 폴백 'normal' 이 100% 성립해 삼출성 중이염이 진주색 '정상'으로 그려졌다.
//    라벨↔코드는 같은 어휘(정상·함몰·팽윤·천공·삼출)라 역매핑은 추정이 아니다. 그 밖의 값은 '미상'.
const TM_STATUS_BY_LABEL: Record<string, string> = {
  정상: 'normal', 함몰: 'retracted', 팽윤: 'bulging', 팽륜: 'bulging', 천공: 'perforation', 삼출: 'effusion',
};
const otoscopy = (raw: unknown) => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const label = typeof o.tympanic_membrane === 'string' ? o.tympanic_membrane.trim() : '';
  const status = TM_STATUS_BY_LABEL[label] ?? (typeof o.status === 'string' ? o.status : '') ?? '';
  const findings = [label && !TM_STATUS_BY_LABEL[label] ? label : '', o.discharge ? `분비물 ${o.discharge}` : '', o.bulging === true ? '팽륜(+)' : '', typeof o.findings === 'string' ? o.findings : '']
    .filter(Boolean).join(' · ');
  return {
    status: status || 'unknown',
    lightReflex: typeof o.lightReflex === 'boolean' ? o.lightReflex : null,
    findings: findings || undefined,
  };
};
// 비강 내시경은 자유 텍스트("우측 만곡 (경도)")라 그림 등급으로 옮길 수 없다 — 미상으로 두고 원문을 보여준다.
const nasalText = (raw: unknown): { label: string; value: string }[] => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const flat = (v: unknown): string =>
    v == null ? '' : typeof v === 'object' ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k === 'right' ? '우' : k === 'left' ? '좌' : k}: ${String(x)}`).join(' · ') : String(v);
  return [
    { label: '비중격', value: flat(o.septum) || '기록 없음' },
    { label: '비갑개', value: flat(o.turbinate) || '기록 없음' },
    { label: '용종', value: flat(o.polyp) || '기록 없음' },
    { label: '분비물', value: flat(o.discharge) || '기록 없음' },
  ];
};
const UNKNOWN_TURBINATES = [{ status: 'unknown' }, { status: 'unknown' }, { status: 'unknown' }];

export default function EntPage() {
  const tAttr = useTAttr();
  const [showLegacy, setShowLegacy] = useState(false);
  const [tab, setTab] = useState<EntTab>('exams');
  const [patientId, setPatientId] = useState('');
  const [sleepForm, setSleepForm] = useState<SleepStudyForm>(emptySleepForm);
  const [showSleepForm, setShowSleepForm] = useState(false);
  const [haForm, setHaForm] = useState<HearingAidForm>(emptyHaForm);
  const [showHaForm, setShowHaForm] = useState(false);
  const queryClient = useQueryClient();

  // ── Dashboard data ──
  const { data: todayData, isLoading: todayLoading, isError, error, refetch: refetchToday } = useQuery({
    queryKey: ['ent-today'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/ent/today'),
  });
  const { data: statsData, isLoading: statsLoading, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['ent-stats'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/ent/stats'),
  });
  const { data: patientsData, isLoading: patientsLoading, isError: patientsIsError, error: patientsError, refetch: refetchPatients } = useQuery({
    queryKey: ['ent-patients'],
    queryFn: () => apiClient.get<{ data: Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> }>('/api/v1/ent/patients'),
  });
  const myPatients = (() => { const r = patientsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> ?? []; })();

  const todayPatients: Record<string, unknown>[] = (() => { const r = todayData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const stats: Record<string, unknown> = (() => { const r = statsData?.data; if (r && typeof r === 'object' && !Array.isArray(r) && 'data' in (r as unknown as Record<string, unknown>)) return (r as unknown as Record<string, unknown>).data as Record<string, unknown>; return (r ?? {}) as Record<string, unknown>; })();

  // ── Legacy patient data ──
  const { data: examsData, isLoading: examsLoading, isError: examsIsError, error: examsError, refetch: refetchExams } = useQuery({
    queryKey: ['ent-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/ent/exam/${patientId}`),
    enabled: tab === 'exams' && !!patientId && showLegacy,
  });

  const { data: audioData, isLoading: audioLoading, isError: audioIsError, error: audioError, refetch: refetchAudio } = useQuery({
    queryKey: ['ent-audiogram', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/ent/audiogram/${patientId}`),
    enabled: tab === 'audiogram' && !!patientId && showLegacy,
  });

  const { data: sleepData, isLoading: sleepLoading, isError: sleepIsError, error: sleepError, refetch: refetchSleep } = useQuery({
    queryKey: ['ent-sleep', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/ent/sleep-study/${patientId}`),
    enabled: tab === 'sleep' && !!patientId && showLegacy,
  });

  const { data: haData, isLoading: haLoading, isError: haIsError, error: haError, refetch: refetchHa } = useQuery({
    queryKey: ['ent-hearing-aid', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/ent/hearing-aid/${patientId}`),
    enabled: tab === 'hearingAid' && !!patientId && showLegacy,
  });

  const haMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post('/api/v1/ent/hearing-aid', payload),
    onSuccess: () => {
      toast.success('보청기 처방이 기록되었습니다');
      queryClient.invalidateQueries({ queryKey: ['ent-hearing-aid', patientId] });
      setShowHaForm(false);
      setHaForm(emptyHaForm);
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '보청기 처방 기록에 실패했습니다'),
  });

  const handleHaSubmit = useCallback(() => {
    if (!patientId) { toast.error('환자 ID를 입력하세요'); return; }
    if (!haForm.ear || !haForm.type) { toast.error(tAttr('착용 귀와 유형을 고르세요')); return; }
    haMutation.mutate({
      patientId,
      ear: haForm.ear,
      type: haForm.type,
      model: haForm.model || undefined,
      notes: haForm.notes || undefined,
    });
  }, [patientId, haForm, haMutation, tAttr]);

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
    if (!patientId) { toast.error('환자 ID를 입력하세요'); return; }
    if (!sleepForm.ahi || !sleepForm.studyDate || !sleepForm.studyType) { toast.error(tAttr('검사유형·검사일·AHI 는 필수입니다')); return; }
    sleepMutation.mutate({
      patientId,
      studyType: sleepForm.studyType,
      studyDate: sleepForm.studyDate,
      ahi: parseFloat(sleepForm.ahi),
      ...(sleepForm.oxygenSatMin ? { oxygenSatMin: parseInt(sleepForm.oxygenSatMin) } : {}),
      ...(sleepForm.oxygenSatAvg ? { oxygenSatAvg: parseInt(sleepForm.oxygenSatAvg) } : {}),
      ...(sleepForm.sleepEfficiency ? { sleepEfficiency: parseFloat(sleepForm.sleepEfficiency) } : {}),
      ...(sleepForm.totalSleepTime ? { totalSleepTime: parseInt(sleepForm.totalSleepTime) } : {}),
      ...(sleepForm.cpap ? { cpapRecommended: sleepForm.cpap === 'YES' } : {}),
    });
  }, [patientId, sleepForm, sleepMutation, tAttr]);

  const exams: Record<string, unknown>[] = (() => { const r = examsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const audiograms: Record<string, unknown>[] = (() => { const r = audioData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const sleepStudies: Record<string, unknown>[] = (() => { const r = sleepData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const hearingAids: Record<string, unknown>[] = (() => { const r = haData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  /**
   * 🔴 청력도가 개통 이래 한 번도 그려진 적이 없었다 — **두 겹으로** 죽어 있었다.
   *   ① 어휘: 서버는 `audiogramRight`/`audiogramLeft` 를 주는데 화면은 `rightAC`/`acRight`/`rightBC`…
   *      를 읽었다 → 교집합 0(FE 가 지어낸 어휘). ② 값 키: 저장 정본은 `[{freq, ac, bc?}]` 인데
   *      파서는 `db` 를 요구해 전건 탈락. 읽기 정본은 `lib/specialty/audiogram` 하나다.
   */
  const audiogramChartData = useMemo(
    () => { const row = latestAudiogramRow(audiograms); return row ? { ...audiogramSeriesOf(row), examinedAt: row.examinedAt as string | undefined } : null; },
    [audiograms],
  );

  const parseSleepData = (notes: string | null): Record<string, unknown> => {
    if (!notes) return {};
    try { const d = JSON.parse(notes); return d.type === 'SLEEP_STUDY' ? d : {}; } catch { return {}; }
  };

  if (isError) return <QueryErrorFallback error={error} onRetry={refetchToday} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="이비인후과 대시보드" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="오늘의 현황 / 환자 목록 / 검사 관리" /></p>
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
              <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="이비인후과 기록이 있는 환자가 없습니다" /></td></tr>
            ) : myPatients.map((p) => (
              <tr key={p.patientId} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-xs font-medium text-gray-900">{`${p.familyName ?? ''}${p.givenName ?? ''}`}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{p.mrn ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{p.lastDate ? kdate(p.lastDate) : '-'}</td>
                <td className="px-4 py-3">
                  <Link href={`/patients/${p.patientId}?tab=ent`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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
                      <Link href={`/patients/${pid}?tab=ent`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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
                { key: 'exams' as EntTab, label: '검사기록' },
                { key: 'audiogram' as EntTab, label: '청력검사' },
                { key: 'sleep' as EntTab, label: '수면검사' },
                { key: 'hearingAid' as EntTab, label: '보청기' },
              ]).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
              ))}
            </div>

            {/* 검사기록 */}
            {tab === 'exams' && (
              <div className="space-y-4">
                {patientId && exams.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                      <TympanicDiagram right={otoscopy(exams[0].otoscopyRight)} left={otoscopy(exams[0].otoscopyLeft)} />
                    </div>
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                      {/* 등급 매핑이 없는 자유 텍스트 소견 — 그림은 '미상'으로 두고 원문을 그대로 읽게 한다 */}
                      <NasalDiagram septum={{ status: 'unknown' }} leftTurbinates={UNKNOWN_TURBINATES} rightTurbinates={UNKNOWN_TURBINATES} />
                      <dl className="mt-3 space-y-1 text-[11px]">
                        {nasalText(exams[0].nasalEndoscopy).map((r) => (
                          <div key={r.label} className="flex gap-2 border-t border-gray-50 pt-1">
                            <dt className="w-14 shrink-0 text-gray-400">{r.label}</dt>
                            <dd className="text-gray-800">{r.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </div>
                )}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">이경(R)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">이경(L)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">PTA(R)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">PTA(L)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">고막운동(R)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">고막운동(L)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
                    </tr></thead>
                    <tbody>
                      {!patientId ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : examsIsError ? <tr><td colSpan={8} className="py-6"><QueryErrorFallback error={examsError} onRetry={() => refetchExams()} size="compact" /></td></tr>
                      : examsLoading ? <LoadingRows cols={8} />
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
                    {/* 🔴 이 차트는 **한 회차**다 — 어느 검사인지 밝히지 않으면 전체 요약으로 읽힌다.
                        (서버는 오래된 순으로 주므로 종전 `rows[0]` 은 가장 오래된 청력도였다) */}
                    <p className="text-[11px] text-gray-400 mb-2">
                      {audiogramChartData.examinedAt ? `${kdate(audiogramChartData.examinedAt)} 검사` : '검사일 미상'}
                      {audiograms.length > 1 ? ` · 최근 1회차(전체 ${audiograms.length}회)` : ''}
                    </p>
                    <AudiogramChart rightAC={audiogramChartData.rightAC} leftAC={audiogramChartData.leftAC} rightBC={audiogramChartData.rightBC.length > 0 ? audiogramChartData.rightBC : undefined} leftBC={audiogramChartData.leftBC.length > 0 ? audiogramChartData.leftBC : undefined} />
                  </div>
                )}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">PTA (R) dB</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">PTA (L) dB</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">어음분별 (R)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">어음분별 (L)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">청력등급</th>
                    </tr></thead>
                    <tbody>
                      {!patientId ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : audioIsError ? <tr><td colSpan={6} className="py-6"><QueryErrorFallback error={audioError} onRetry={() => refetchAudio()} size="compact" /></td></tr>
                      : audioLoading ? <LoadingRows cols={6} />
                      : audiograms.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="청력검사 없음" /></td></tr>
                      : audiograms.map((a) => {
                        // 🔴 종전 `(a.ptaRight as number) ?? 0` 은 **미측정을 0dB(= 정상 초록)로 접었다.**
                        //    같은 행 PTA 칸은 '-' 를 내고 있어 한 행에서 '-' 와 '정상'이 동시에 나왔다.
                        //    미측정은 다른 사실이다 — 등급을 매기지 않고 '미측정'이라고 말한다.
                        const ptaR = typeof a.ptaRight === 'number' ? a.ptaRight : null;
                        const ptaL = typeof a.ptaLeft === 'number' ? a.ptaLeft : null;
                        const measured = [ptaR, ptaL].filter((v): v is number => v != null);
                        const maxPta = measured.length > 0 ? Math.max(...measured) : null;
                        const grade = maxPta == null ? '미측정'
                          : maxPta <= 25 ? '정상' : maxPta <= 40 ? '경도' : maxPta <= 55 ? '중등도' : maxPta <= 70 ? '중등고도' : maxPta <= 90 ? '고도' : '심도';
                        const gradeColor = maxPta == null ? 'bg-gray-100 text-gray-500'
                          : maxPta <= 25 ? 'bg-emerald-100 text-emerald-700' : maxPta <= 55 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
                        // 한쪽만 측정됐으면 등급이 그 한쪽만 본 것임을 밝힌다(양측 판정으로 읽히지 않게)
                        const gradeNote = maxPta != null && measured.length === 1 ? (ptaR != null ? ' (우측만)' : ' (좌측만)') : '';
                        return (
                          <tr key={a.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3 text-xs text-gray-700">{a.examinedAt ? kdate(a.examinedAt as string) : '-'}</td>
                            <td className="px-4 py-3 text-xs font-bold text-gray-900">{ptaR != null ? ptaR : '-'}</td>
                            <td className="px-4 py-3 text-xs font-bold text-gray-900">{ptaL != null ? ptaL : '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-700">{a.speechRight != null ? `${a.speechRight}%` : '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-700">{a.speechLeft != null ? `${a.speechLeft}%` : '-'}</td>
                            <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${gradeColor}`}>{grade}{gradeNote}</span></td>
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
                  <button onClick={() => setShowSleepForm(!showSleepForm)} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                    {showSleepForm ? <T k="취소" /> : <T k="+ 수면검사 기록" />}
                  </button>
                </div>
                {showSleepForm && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div><label className="text-[10px] text-gray-500"><T k="검사유형" /></label><select value={sleepForm.studyType} onChange={(e) => setSleepForm(prev => ({ ...prev, studyType: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"><option value="">{tAttr('-- 선택 --')}</option><option value="PSG">{tAttr('PSG (수면다원검사)')}</option><option value="HSAT">{tAttr('HSAT (가정용)')}</option><option value="MSLT">{tAttr('MSLT (주간졸림)')}</option></select></div>
                      <div><label className="text-[10px] text-gray-500"><T k="검사일" /></label><input type="date" value={sleepForm.studyDate} onChange={(e) => setSleepForm(prev => ({ ...prev, studyDate: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" /></div>
                      <div><label className="text-[10px] text-gray-500"><T k="AHI (회/시간)" /></label><input type="number" step="0.1" value={sleepForm.ahi} onChange={(e) => setSleepForm(prev => ({ ...prev, ahi: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" /></div>
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      <div><label className="text-[10px] text-gray-500"><T k="SpO2 최저 (%)" /></label><input type="number" value={sleepForm.oxygenSatMin} onChange={(e) => setSleepForm(prev => ({ ...prev, oxygenSatMin: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" /></div>
                      <div><label className="text-[10px] text-gray-500"><T k="SpO2 평균 (%)" /></label><input type="number" value={sleepForm.oxygenSatAvg} onChange={(e) => setSleepForm(prev => ({ ...prev, oxygenSatAvg: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" /></div>
                      <div><label className="text-[10px] text-gray-500"><T k="수면효율 (%)" /></label><input type="number" step="0.1" value={sleepForm.sleepEfficiency} onChange={(e) => setSleepForm(prev => ({ ...prev, sleepEfficiency: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" /></div>
                      <div><label className="text-[10px] text-gray-500"><T k="총수면시간 (분)" /></label><input type="number" value={sleepForm.totalSleepTime} onChange={(e) => setSleepForm(prev => ({ ...prev, totalSleepTime: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" /></div>
                    </div>
                    {sleepForm.ahi && (
                      <div className="text-xs text-gray-600">
                        <T k="자동 판정" />: <span className={`font-bold ${parseFloat(sleepForm.ahi) < 5 ? 'text-emerald-600' : parseFloat(sleepForm.ahi) < 15 ? 'text-yellow-600' : parseFloat(sleepForm.ahi) < 30 ? 'text-orange-600' : 'text-red-600'}`}>
                          {parseFloat(sleepForm.ahi) < 5 ? '정상' : parseFloat(sleepForm.ahi) < 15 ? '경증' : parseFloat(sleepForm.ahi) < 30 ? '중등증' : '중증'}
                        </span>
                        {parseFloat(sleepForm.ahi) >= 15 && <span className="ml-2 text-blue-600"><T k="AHI 15 이상 — CPAP 고려 구간(권고 여부는 의사가 고릅니다)" /></span>}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs" role="radiogroup" aria-label={tAttr('CPAP 권고')}>
                      <span className="text-gray-500">CPAP</span>
                      {(['YES', 'NO'] as const).map((v) => (
                        <button key={v} type="button" role="radio" aria-checked={sleepForm.cpap === v} data-cpap={v}
                          onClick={() => setSleepForm(prev => ({ ...prev, cpap: prev.cpap === v ? '' : v }))}
                          className={`min-h-[36px] px-3 rounded-lg border ${sleepForm.cpap === v ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 text-gray-600'}`}>
                          <T k={v === 'YES' ? '권고' : '비권고'} />
                        </button>
                      ))}
                      {!sleepForm.cpap && <span className="text-gray-400"><T k="미기록" /></span>}
                    </div>
                    <div className="flex justify-end">
                      <button onClick={handleSleepSubmit} disabled={sleepMutation.isPending} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                        {sleepMutation.isPending ? <T k="저장 중..." /> : <T k="수면검사 저장" />}
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
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">SpO2 최저</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">수면효율</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">CPAP</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="판독의@판독" /></th>
                    </tr></thead>
                    <tbody>
                      {!patientId ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : sleepIsError ? <tr><td colSpan={8} className="py-6"><QueryErrorFallback error={sleepError} onRetry={() => refetchSleep()} size="compact" /></td></tr>
                      : sleepLoading ? <LoadingRows cols={8} />
                      : sleepStudies.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="수면검사 없음" /></td></tr>
                      : sleepStudies.map((s) => {
                        const isNewModel = s.studyType != null;
                        const sd = isNewModel ? s : parseSleepData(s.notes as string | null);
                        // 🔴 종전 `Number(...) || 0` 은 **AHI 미기록을 0(= '정상' 초록)으로** 만들었다.
                        //    수면무호흡 미평가와 "재봤더니 정상"은 다른 사실이다.
                        const rawAhi = isNewModel ? s.ahi : sd.ahi;
                        const ahiNum = rawAhi == null || rawAhi === '' ? null : Number(rawAhi);
                        const ahi = ahiNum != null && Number.isFinite(ahiNum) ? ahiNum : null;
                        const severity = (s.severity as string)
                          ?? (ahi == null ? 'UNKNOWN' : ahi < 5 ? 'NORMAL' : ahi < 15 ? 'MILD' : ahi < 30 ? 'MODERATE' : 'SEVERE');
                        const doc = s.interpreter as Record<string, unknown> | undefined;
                        return (
                          <tr key={s.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3 text-xs text-gray-700">{(s.studyDate ?? s.examinedAt) ? kdate(((s.studyDate ?? s.examinedAt) as string)) : '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-700">{(s.studyType as string | null) ?? '-'}</td>
                            <td className="px-4 py-3 text-xs font-bold text-gray-900">{ahi != null ? ahi : '-'}</td>
                            <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${SEVERITY_COLOR[severity] ?? 'bg-gray-100'}`}>{SEVERITY_LABEL[severity] ?? severity}</span></td>
                            <td className="px-4 py-3 text-xs text-gray-700">{(isNewModel ? s.oxygenSatMin : sd.oxygenSatMin) != null ? `${isNewModel ? s.oxygenSatMin : sd.oxygenSatMin}%` : '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-700">{(isNewModel ? s.sleepEfficiency : sd.sleepEfficiency) != null ? `${isNewModel ? s.sleepEfficiency : sd.sleepEfficiency}%` : '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-700">{s.cpapRecommended === true ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 whitespace-nowrap"><T k="권고" /></span> : s.cpapRecommended === false ? <T k="비권고" /> : <span className="text-gray-400"><T k="미기록" /></span>}</td>
                            <td className="px-4 py-3 text-xs text-gray-700">{doc ? `${(doc.familyName as string) ?? ''}${(doc.givenName as string) ?? ''}` : '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 보청기 처방 */}
            {tab === 'hearingAid' && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <button onClick={() => setShowHaForm(!showHaForm)} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                    {showHaForm ? <T k="취소" /> : <T k="+ 보청기 처방" />}
                  </button>
                </div>
                {showHaForm && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div><label className="text-[10px] text-gray-500"><T k="착용 귀" /></label><select value={haForm.ear} onChange={(e) => setHaForm(prev => ({ ...prev, ear: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"><option value="">{tAttr('-- 선택 --')}</option>{Object.entries(EAR_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                      <div><label className="text-[10px] text-gray-500"><T k="유형" /></label><select value={haForm.type} onChange={(e) => setHaForm(prev => ({ ...prev, type: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"><option value="">{tAttr('-- 선택 --')}</option>{Object.entries(HA_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                      <div><label className="text-[10px] text-gray-500"><T k="모델명" /></label><input type="text" value={haForm.model} onChange={(e) => setHaForm(prev => ({ ...prev, model: e.target.value }))} placeholder={tAttr('예: Phonak Audeo P90')} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" /></div>
                    </div>
                    <div><label className="text-[10px] text-gray-500"><T k="비고 (피팅 메모·게인 설정 등)" /></label><textarea rows={2} value={haForm.notes} onChange={(e) => setHaForm(prev => ({ ...prev, notes: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" /></div>
                    <div className="flex justify-end">
                      <button onClick={handleHaSubmit} disabled={haMutation.isPending} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                        {haMutation.isPending ? <T k="저장 중..." /> : <T k="처방 저장" />}
                      </button>
                    </div>
                  </div>
                )}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="처방일" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="귀" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="모델" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="비고" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="처방의" /></th>
                    </tr></thead>
                    <tbody>
                      {!patientId ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : haIsError ? <tr><td colSpan={6} className="py-6"><QueryErrorFallback error={haError} onRetry={() => refetchHa()} size="compact" /></td></tr>
                      : haLoading ? <LoadingRows cols={6} />
                      : hearingAids.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="보청기 처방 없음" /></td></tr>
                      : hearingAids.map((h) => {
                        const doc = h.prescriber as Record<string, unknown> | undefined;
                        return (
                          <tr key={h.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3 text-xs text-gray-700">{h.prescribedAt ? kdate(h.prescribedAt as string) : '-'}</td>
                            <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${h.ear === 'BOTH' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>{EAR_LABEL[h.ear as string] ?? (h.ear as string)}</span></td>
                            <td className="px-4 py-3 text-xs text-gray-700">{HA_TYPE_LABEL[h.type as string] ?? (h.type as string) ?? '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-700">{(h.model as string) ?? '-'}</td>
                            <td className="px-4 py-3 text-xs text-gray-500 max-w-[220px] truncate">{(h.notes as string) ?? '-'}</td>
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
        )}
      </div>
    </div>
  );
}
