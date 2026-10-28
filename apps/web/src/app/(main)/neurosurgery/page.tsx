'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import PatientSelector from '@/components/ui/PatientSelector';
import { SpecialtyPatientListMeta, specialtyPatientMeta } from '@/components/specialty/SpecialtyPatientListMeta';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import DermatomeMap, { type MotorExamEntry } from '@/components/specialty/DermatomeMap';
import StatCard from '@/components/ui/StatCard';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { kdate } from '@/lib/ui-settings';
// '산출 불가' 문구는 shared 정본 하나 — 화면마다 손으로 적으면 어휘가 갈라진다.
import { RATIO_UNAVAILABLE } from '@hospital-run/shared';

// GRADE_COLOR 는 MRC 도수근력 0~5 등급 색. (종전 `GCS_LEVELS` 상수는 이름과 달리 척추분절 목록이었고
//  선언 후 한 번도 쓰이지 않았다 — 사실과 다른 이름은 다음 사람을 속이므로 삭제했다. 2026-08-26)
const GRADE_COLOR: Record<string, string> = { '0': 'bg-red-100 text-red-700', '1': 'bg-red-50 text-red-600', '2': 'bg-amber-100 text-amber-700', '3': 'bg-yellow-100 text-yellow-700', '4': 'bg-blue-100 text-blue-700', '5': 'bg-emerald-100 text-emerald-700' };

type NeuroTab = 'neuroExam' | 'gcs' | 'motorMap';

/** MRC 등급 — 숫자만 통과. **0 은 유효한 측정값**(근수축 없음)이므로 버리지 않는다. */
const grade = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** `NeuroExam.motorExam` JsonB `[{level,left,right}]` → 근력 항목. 형태가 다르면 빈 목록(지어내지 않는다). */
function motorLevels(raw: unknown): MotorExamEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => e != null && typeof e === 'object')
    .map((e) => ({ level: String(e.level ?? ''), left: grade(e.left), right: grade(e.right) }))
    .filter((e) => e.level !== '' && (e.left != null || e.right != null));
}

// 동공: JSON `{size, reactive}` — 없는 평면 필드(pupilLeftSize 등)를 읽어 전 칸이 비어 있었다
const pupilText = (raw: unknown): string => {
  const o = raw as { size?: unknown; reactive?: unknown } | null | undefined;
  if (!o || typeof o !== 'object') return '미검사';
  const size = typeof o.size === 'number' ? `${o.size}mm` : '-';
  const react = o.reactive === true ? '반응(+)' : o.reactive === false ? '무반응(-)' : '-';
  return `${size} / ${react}`;
};
// Babinski: Json — 문자열/객체/불리언 어느 형태로 오든 3상태(양성·음성·미검사)로만 말한다
const babinskiText = (raw: unknown): { positive: boolean | null; label: string } => {
  if (raw == null) return { positive: null, label: '미검사' };
  const flat = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  if (/\+|POSITIVE|양성/i.test(flat)) return { positive: true, label: '양성(+)' };
  if (/-|NEGATIVE|음성/i.test(flat)) return { positive: false, label: '음성(-)' };
  return { positive: null, label: '미검사' };
};
const jsonText = (raw: unknown): string => {
  if (raw == null) return '-';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ') || '-';
  }
  return String(raw);
};

export default function NeurosurgeryPage() {
  const tAttr = useTAttr();
  const [showLegacy, setShowLegacy] = useState(false);
  const [tab, setTab] = useState<NeuroTab>('neuroExam');
  const [patientId, setPatientId] = useState('');

  // ── Dashboard data ──
  const { data: todayData, isLoading: todayLoading, isError: todayError, error: todayErr, refetch: todayRefetch } = useQuery({
    queryKey: ['neurosurgery-today'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/neurosurgery/today'),
  });
  const { data: statsData, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['neurosurgery-stats'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/neurosurgery/stats'),
  });
  const { data: patientsData, isLoading: patientsLoading, isError: patientsIsError, error: patientsError, refetch: refetchPatients } = useQuery({
    queryKey: ['neurosurgery-patients'],
    queryFn: () => apiClient.get<{ data: Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> }>('/api/v1/neurosurgery/patients'),
  });
  const myPatients = (() => { const r = patientsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> ?? []; })();
  const todayPatients: Record<string, unknown>[] = (() => { const r = todayData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const stats: Record<string, unknown> = (() => { const r = statsData?.data; if (r && typeof r === 'object' && !Array.isArray(r) && 'data' in (r as unknown as Record<string, unknown>)) return (r as unknown as Record<string, unknown>).data as Record<string, unknown>; return (r ?? {}) as Record<string, unknown>; })();

  // ── 개별 환자 조회 ──
  // 🔴 2026-08-26: 종전 3탭이 각각 `neuro-exam/:id`·`gcs/:id`·`motor-map/:id` 를 불렀는데
  //    **셋 다 컨트롤러에 없는 경로**였다(216행이 개통 이래 조회 불가). 정본은 두 개뿐이다:
  //      · `exams/:patientId`     → 신경검사 + 근력맵(motorExam JsonB `[{level,left,right}]`)
  //      · `gcs-trend/:patientId` → `{date, eye, verbal, motor, total}`
  //    정형·산부인과가 2026-08-18 에 같은 형태로 회수됐고 신경외과만 빠져 있었다.
  const { data: examData, isLoading: examLoading, isError: examIsError, error: examError, refetch: refetchExams } = useQuery({
    queryKey: ['neurosurgery-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/neurosurgery/exams/${patientId}`),
    enabled: (tab === 'neuroExam' || tab === 'motorMap') && !!patientId && showLegacy,
  });
  const { data: gcsData, isLoading: gcsLoading, isError: gcsIsError, error: gcsError, refetch: refetchGcs } = useQuery({
    queryKey: ['neurosurgery-gcs-trend', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/neurosurgery/gcs-trend/${patientId}`),
    enabled: tab === 'gcs' && !!patientId && showLegacy,
  });

  const neuroExams: Record<string, unknown>[] = (() => { const r = examData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const gcsRecords: Record<string, unknown>[] = (() => { const r = gcsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const examLoadingState = examLoading;
  // 근력맵 = 같은 exam 행의 `motorExam` JsonB. 값이 없는 검사는 행으로 만들지 않는다(빈 행은 "쟀는데 정상"으로 읽힌다).
  const motorMaps = neuroExams
    .map((r) => ({ id: r.id as string, examinedAt: r.examinedAt, levels: motorLevels(r.motorExam), notes: r.plan }))
    .filter((m) => m.levels.length > 0);
  // 피부분절도 = 가장 최근 검사의 근력값(없으면 빈 입력 — DermatomeMap 은 빈 입력에 '-' 를 그린다)
  const latestMotorExam = motorMaps[0]?.levels ?? [];


  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  if (todayError) return <QueryErrorFallback error={todayErr} onRetry={todayRefetch} />;

  return (
    <div>
      <PageHeader title={tAttr('신경외과 대시보드')} />

      {/* ── 상단: 오늘의 현황 카드 ── */}
      {statsIsError && <QueryErrorFallback error={statsError} onRetry={() => refetchStats()} size="compact" className="mb-4" />}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard title={tAttr('오늘 예약')} value={Number(stats.todayAppointments ?? stats.totalAppointments ?? todayPatients.length ?? 0)} color="gray" />
        <StatCard title={tAttr('완료')} value={Number(stats.completedToday ?? stats.completed ?? 0)} color="emerald" />
        <StatCard title={tAttr('진행 중')} value={Number(stats.inProgressToday ?? stats.inProgress ?? 0)} color="blue" />
        <StatCard title={tAttr('대기')} value={Number(stats.waitingToday ?? stats.waiting ?? 0)} color="amber" />
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
              <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="신경외과 기록이 있는 환자가 없습니다" /></td></tr>
            ) : myPatients.map((p) => (
              <tr key={p.patientId} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-xs font-medium text-gray-900">{`${p.familyName ?? ''}${p.givenName ?? ''}`}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{p.mrn ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{p.lastDate ? kdate(p.lastDate) : '-'}</td>
                <td className="px-4 py-3">
                  <Link href={`/patients/${p.patientId}?tab=neurosurgery`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                    <T k="차트 열기" /> &rarr;
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── 오늘 환자 목록 ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
          <h3 className="text-sm font-bold text-gray-900"><T k="오늘 환자 목록" /></h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/30">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시간" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자명" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진료 내용" /></th>
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
                      <Link href={`/patients/${pid}?tab=neurosurgery`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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

      {/* ── 하단: 개별 환자 조회 (접기/펼치기) ── */}
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
                { key: 'neuroExam' as NeuroTab, label: '신경검사' },
                { key: 'gcs' as NeuroTab, label: 'GCS추이' },
                { key: 'motorMap' as NeuroTab, label: '근력맵' },
              ]).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
              ))}
            </div>

            {/* 신경검사 */}
            {tab === 'neuroExam' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  {/* 🔴 종전 `motorExam={[]}` 하드코딩 — 기록된 근력값이 그림에 반영되지 않았다. 최근 검사 기준. */}
                  <DermatomeMap motorExam={latestMotorExam} />
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사일" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">GCS 합계</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">동공(좌)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">동공(우)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">DTR</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Babinski</th>
                      {/* NIHSS·ASIA — 원장에 저장되는데 이 표에 칸이 없었다(2026-10-10) */}
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">NIHSS</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">ASIA</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="소견" /></th>
                    </tr></thead>
                    <tbody>
                      {!patientId ? <tr><td colSpan={9} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : examIsError ? <tr><td colSpan={9} className="py-6"><QueryErrorFallback error={examError} onRetry={() => refetchExams()} size="compact" /></td></tr>
                      : examLoadingState ? <LoadingRows cols={9} />
                      : neuroExams.length === 0 ? <tr><td colSpan={9} className="py-12 text-center text-gray-400"><T k="신경검사 기록 없음" /></td></tr>
                      : neuroExams.map((r) => {
                        // 🔴 GCS 총점은 저장값(gcsTotal)이 정본 — 성분 합산은 삽관 환자(V 미측정)를 과소평가하고
                        //    극단적으로 임상에서 불가능한 'GCS 0'(빨간 Severe)을 만든다(2026-08-13 W4).
                        const parts = [r.gcsEye, r.gcsVerbal, r.gcsMotor].map((v) => (typeof v === 'number' ? v : null));
                        const gcsTotal = typeof r.gcsTotal === 'number' ? r.gcsTotal
                          : parts.every((v) => v != null) ? (parts as number[]).reduce((a, b) => a + b, 0) : null;
                        const bab = babinskiText(r.babinski);
                        return (
                          <tr key={r.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3 text-xs text-gray-400">{r.examinedAt ? kdate(r.examinedAt as string) : '-'}</td>
                            <td className="px-4 py-3">
                              {gcsTotal == null ? <span className="text-xs text-gray-400">미측정</span> : (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${gcsTotal <= 8 ? 'bg-red-100 text-red-700' : gcsTotal <= 12 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                  {gcsTotal} (E{parts[0] ?? '-'} V{parts[1] ?? '-'} M{parts[2] ?? '-'})
                                </span>
                              )}
                            </td>
                            {/* 동공은 JSON({size,reactive}) — 종전엔 없는 평면 필드를 읽어 좌·우 모두 '-mm / -' 였다 */}
                            <td className="px-4 py-3 text-xs text-gray-700">{pupilText(r.pupilLeft)}</td>
                            <td className="px-4 py-3 text-xs text-gray-700">{pupilText(r.pupilRight)}</td>
                            <td className="px-4 py-3 text-xs text-gray-700">{jsonText(r.reflexes)}</td>
                            <td className="px-4 py-3">
                              {/* 🔴 babinski 는 Json 인데 문자열 '+'/'POSITIVE' 와 비교해 **참이 될 수 없었다**
                                  → 병적 반사도 초록 '정상'(W3 혈액 Rh 반전과 같은 병). 미검사는 회색으로. */}
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${bab.positive == null ? 'bg-gray-100 text-gray-500' : bab.positive ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {bab.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs font-bold text-gray-900" data-nihss>{typeof r.nihss === 'number' ? r.nihss : <span className="font-normal text-gray-400">—</span>}</td>
                            <td className="px-4 py-3 text-xs font-bold text-gray-900" data-asia>{(r.asiaScale as string) || <span className="font-normal text-gray-400">—</span>}</td>
                            <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{(r.diagnosis as string) ?? '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* GCS추이 */}
            {tab === 'gcs' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="일시" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Eye</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Verbal</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Motor</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="합계" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="중증도" /></th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : gcsIsError ? <tr><td colSpan={6} className="py-6"><QueryErrorFallback error={gcsError} onRetry={() => refetchGcs()} size="compact" /></td></tr>
                    : gcsLoading ? <LoadingRows cols={6} />
                    : gcsRecords.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="GCS 기록 없음" /></td></tr>
                    : gcsRecords.map((r, i) => {
                      // 🔴 GCS 총점은 저장값(total)이 정본 — 성분 `?? 0` 합산은 삽관 환자(V 미측정)를 과소평가하고
                      //    **임상에서 불가능한 GCS 0~2 를 빨간 'Severe' 로 단정**한다(GCS 최솟값은 3).
                      //    같은 파일 신경검사 탭은 2026-08-13 에 이미 고쳤는데 이 탭만 옛 코드로 남아 있었다(2026-08-26 수렴).
                      const parts = [r.eye, r.verbal, r.motor].map((v) => (typeof v === 'number' ? v : null));
                      const total = typeof r.total === 'number' ? r.total
                        : parts.every((v) => v != null) ? (parts as number[]).reduce((a, b) => a + b, 0) : null;
                      const severity = total == null ? null : total <= 8 ? 'Severe' : total <= 12 ? 'Moderate' : 'Mild';
                      const sevColor = total == null ? 'bg-gray-100 text-gray-500'
                        : total <= 8 ? 'bg-red-100 text-red-700' : total <= 12 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700';
                      return (
                        <tr key={`${String(r.date ?? '')}-${i}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                          {/* gcs-trend 응답의 시각 필드는 `date`(examinedAt) — 종전엔 없는 `recordedAt` 을 읽어 전 행이 '-' 였다 */}
                          <td className="px-4 py-3 text-xs text-gray-400">{r.date ? kdate(r.date as string) : '-'}</td>
                          <td className="px-4 py-3 text-xs font-medium text-gray-900">{parts[0] ?? '-'}</td>
                          <td className="px-4 py-3 text-xs font-medium text-gray-900">{parts[1] ?? '-'}</td>
                          <td className="px-4 py-3 text-xs font-medium text-gray-900">{parts[2] ?? '-'}</td>
                          <td className="px-4 py-3 text-xs font-bold text-gray-900">{total ?? <span className="font-normal text-gray-400">미측정</span>}</td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${sevColor}`}>
                              {severity ?? RATIO_UNAVAILABLE}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 근력맵 */}
            {tab === 'motorMap' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사일" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="신경근" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="좌측 등급" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="우측 등급" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="비고" /></th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : examIsError ? <tr><td colSpan={5} className="py-6"><QueryErrorFallback error={examError} onRetry={() => refetchExams()} size="compact" /></td></tr>
                    : examLoadingState ? <LoadingRows cols={5} />
                    : motorMaps.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-gray-400">{neuroExams.length === 0 ? <T k="신경검사 기록 없음" /> : <T k="신경검사 기록은 있으나 근력검사가 기록되지 않았습니다" />}</td></tr>
                    : motorMaps.flatMap((r) => r.levels.map((lv, i) => (
                        <tr key={`${r.id}-${i}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                          {i === 0 && <td rowSpan={r.levels.length} className="px-4 py-3 text-xs text-gray-400">{r.examinedAt ? kdate(r.examinedAt as string) : '-'}</td>}
                          <td className="px-4 py-3 text-xs font-medium text-gray-900">{lv.level}</td>
                          {/* 미측정은 '-'(회색) — `?? '-'` 만 붙이면 `undefined/5` 로 새어 나가고, 0 은 "근수축 없음"이라 사실이다 */}
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${lv.left == null ? 'bg-gray-100 text-gray-500' : GRADE_COLOR[String(lv.left)] ?? 'bg-gray-100'}`}>
                              {lv.left == null ? '미측정' : `${lv.left}/5`}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${lv.right == null ? 'bg-gray-100 text-gray-500' : GRADE_COLOR[String(lv.right)] ?? 'bg-gray-100'}`}>
                              {lv.right == null ? '미측정' : `${lv.right}/5`}
                            </span>
                          </td>
                          {i === 0 && <td rowSpan={r.levels.length} className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{(r.notes as string) ?? '-'}</td>}
                        </tr>
                      )))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
