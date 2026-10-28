'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import PatientSelector from '@/components/ui/PatientSelector';
import { SpecialtyPatientListMeta, specialtyPatientMeta } from '@/components/specialty/SpecialtyPatientListMeta';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import ScoreTrendChart from '@/components/specialty/ScoreTrendChart';
import { uroExamRows, uroPsaRows, uroIpssRows, uroPsaSeries, uroIpssSeries, ipssSeverity, PSA_DENSITY_UNAVAILABLE_TEXT } from '@/lib/specialty/exam-views';
import { Num } from '@/components/ui/display';
import { RATIO_UNAVAILABLE } from '@hospital-run/shared';
import StatusBadge from '@/components/ui/StatusBadge';
import { kdate } from '@/lib/ui-settings';

const IPSS_SEVERITY: Record<string, { label: string; color: string }> = {
  MILD: { label: '경증(0-7)', color: 'bg-emerald-100 text-emerald-700' },
  MODERATE: { label: '중등도(8-19)', color: 'bg-amber-100 text-amber-700' },
  SEVERE: { label: '중증(20-35)', color: 'bg-red-100 text-red-700' },
};

type UroTab = 'exams' | 'psa' | 'ipss' | 'procedures';

// UrologyProcedure.procedureType — 모델 주석의 어휘 그대로(지어내지 않는다). 미등재 값은 원문 노출
const PROCEDURE_LABEL: Record<string, string> = {
  CYSTOSCOPY: '방광경', PROSTATE_BIOPSY: '전립선 생검', ESWL: '체외충격파쇄석술',
  TURP: '경요도전립선절제술', URETEROSCOPY: '요관내시경', CATHETERIZATION: '도뇨', OTHER: '기타',
};

export default function UrologyPage() {
  const tAttr = useTAttr();
  const [showLegacy, setShowLegacy] = useState(false);
  const [tab, setTab] = useState<UroTab>('exams');
  const [patientId, setPatientId] = useState('');

  // ── Dashboard data ──
  const { data: todayData, isLoading: todayLoading, isError, error, refetch } = useQuery({
    queryKey: ['urology-today'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/urology/today'),
  });
  const { data: statsData, isLoading: statsLoading, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['urology-stats'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/urology/stats'),
  });
  const { data: patientsData, isLoading: patientsLoading, isError: patientsIsError, error: patientsError, refetch: refetchPatients } = useQuery({
    queryKey: ['urology-patients'],
    queryFn: () => apiClient.get<{ data: Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> }>('/api/v1/urology/patients'),
  });
  const myPatients = (() => { const r = patientsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> ?? []; })();
  const todayPatients: Record<string, unknown>[] = (() => { const r = todayData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const stats: Record<string, unknown> = (() => { const r = statsData?.data; if (r && typeof r === 'object' && !Array.isArray(r) && 'data' in (r as unknown as Record<string, unknown>)) return (r as unknown as Record<string, unknown>).data as Record<string, unknown>; return (r ?? {}) as Record<string, unknown>; })();

  // ── 개별 환자 조회 — 정본은 `exams/:patientId` 하나다 ──
  //    🔴 종전엔 없는 `urology/{psa,ipss}` 를 부르고 404 를 삼켜 두 탭이 영구히 "기록 없음"이었고,
  //       검사기록 탭은 EP 는 맞았지만 평면 컬럼(maxFlowRate…)을 읽어 **전 칸이 빈** 채였다
  //       (실제 저장은 `urodynamics` JSONB). 2026-08-18 이연 회수.
  const { data: examsData, isLoading: examsLoading, isError: examsError } = useQuery({
    queryKey: ['urology-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/urology/exams/${patientId}`),
    enabled: !!patientId && showLegacy,
  });

  // 시술기록(방광경·전립선 생검·ESWL 등) — EP·모델(`UrologyProcedure`)은 있는데 **부르는 화면이 없었다.**
  // `urology_procedures` 0행은 시드 부재가 아니라 조회·기록 화면 부재였다(이 탭은 조회만 배선한다).
  const { data: procData, isLoading: procLoading, isError: procError } = useQuery({
    queryKey: ['urology-procedures', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/urology/procedures/${patientId}`),
    enabled: !!patientId && showLegacy && tab === 'procedures',
  });
  const procedures: Record<string, unknown>[] = (() => { const r = procData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  const rawExams: Record<string, unknown>[] = (() => { const r = examsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const exams = uroExamRows(rawExams);
  const psaRecords = uroPsaRows(rawExams);
  const ipssRecords = uroIpssRows(rawExams);
  const psaSeries = uroPsaSeries(psaRecords);
  const ipssSeries = uroIpssSeries(ipssRecords);


  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );
  // 🔴 조회 실패를 '기록 없음'으로 말하지 않는다 — 둘은 다른 사실이다.
  const ErrorRow = ({ cols }: { cols: number }) => (
    <tr><td colSpan={cols} className="py-12 text-center text-sm text-red-600"><T k="조회에 실패했습니다 — 기록이 없는 것이 아니라 불러오지 못했습니다" /></td></tr>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="비뇨의학과 대시보드" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="오늘의 현황 / 환자 목록 / 검사·추이 관리" /></p>
        </div>
      </div>

      {/* ── 상단: 오늘의 현황 카드 ── 🔴 통계 조회 실패를 "0건"으로 말하지 않는다 */}
      {statsIsError && <div className="mb-6"><QueryErrorFallback error={statsError} onRetry={refetchStats} size="compact" /></div>}
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
            {patientsIsError ? <tr><td colSpan={4} className="px-4 py-3"><QueryErrorFallback error={patientsError} onRetry={refetchPatients} size="compact" /></td></tr>
            : patientsLoading ? <LoadingRows cols={4} />
            : myPatients.length === 0 ? (
              <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="비뇨의학과 기록이 있는 환자가 없습니다" /></td></tr>
            ) : myPatients.map((p) => (
              <tr key={p.patientId} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-xs font-medium text-gray-900">{`${p.familyName ?? ''}${p.givenName ?? ''}`}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{p.mrn ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{p.lastDate ? kdate(p.lastDate) : '-'}</td>
                <td className="px-4 py-3">
                  <Link href={`/patients/${p.patientId}?tab=urology`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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
                      <Link href={`/patients/${pid}?tab=urology`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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
                { key: 'exams' as UroTab, label: '검사기록' },
                { key: 'psa' as UroTab, label: 'PSA추이' },
                { key: 'ipss' as UroTab, label: 'IPSS추이' },
                { key: 'procedures' as UroTab, label: '시술기록' },
              ]).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
              ))}
            </div>

            {/* 검사기록 (Urodynamics) */}
            {tab === 'exams' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사일" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">최대유속(mL/s)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">평균유속(mL/s)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">배뇨량(mL)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">잔뇨량(mL)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">전립선 용적(mL)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : examsLoading ? <LoadingRows cols={7} />
                    : examsError ? <ErrorRow cols={7} />
                    : exams.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="검사기록 없음" /></td></tr>
                    : exams.map((r) => (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-xs text-gray-400">{r.examinedAt ? kdate(r.examinedAt) : '-'}</td>
                        <td className="px-4 py-3">
                          {/* 🔴 미측정을 0(=요폐)으로 만들지 않는다. 진짜 0 은 0 으로 말한다. */}
                          {r.maxFlowRate === null ? <span className="text-xs text-gray-400">미측정</span> : (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${r.maxFlowRate < 10 ? 'bg-red-100 text-red-700' : r.maxFlowRate < 15 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {r.maxFlowRate}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-gray-900">{r.avgFlowRate ?? '미측정'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{r.voidedVolume ?? '미측정'}</td>
                        <td className="px-4 py-3">
                          {r.residualVolume === null ? <span className="text-xs text-gray-400">미측정</span> : (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${r.residualVolume > 100 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {r.residualVolume}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700">{r.prostateVolume ?? '미측정'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{r.diagnosis ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* PSA추이 */}
            {tab === 'psa' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <ScoreTrendChart series={psaSeries} />
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사일" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">PSA (ng/mL)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">기준선 (4.0)</th>
                      {/* PSA 밀도 — 서버 계산(같은 검사의 용적) · 판정 기준선은 원내 정책이라 색을 칠하지 않는다 */}
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="PSA 밀도" /></th>
                    </tr></thead>
                    <tbody>
                      {/* Free PSA 열은 저장 필드가 없어 제거했다 — 늘 '-' 인 칸은 '측정하지 않았다'로 읽힌다 */}
                      {!patientId ? <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : examsLoading ? <LoadingRows cols={4} />
                      : examsError ? <ErrorRow cols={4} />
                      : psaRecords.length === 0 ? <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="PSA 기록 없음" /></td></tr>
                      : psaRecords.map((r) => {
                        const elevated = r.psaValue > 4.0;
                        return (
                          <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3 text-xs text-gray-400">{r.testedAt ? kdate(r.testedAt) : '-'}</td>
                            <td className="px-4 py-3">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${elevated ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {r.psaValue}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${elevated ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {elevated ? '초과' : '정상'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-700" data-psad={r.psaDensity ?? 'NA'}>
                              {r.psaDensity != null
                                ? <Num value={r.psaDensity} domain="psaDensity" />
                                : <span className="text-gray-400"><T k={RATIO_UNAVAILABLE} />{r.psaDensityUnavailable && PSA_DENSITY_UNAVAILABLE_TEXT[r.psaDensityUnavailable] ? <> · <T k={PSA_DENSITY_UNAVAILABLE_TEXT[r.psaDensityUnavailable]} /></> : null}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* IPSS추이 */}
            {tab === 'ipss' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <ScoreTrendChart series={ipssSeries} />
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="평가일" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">IPSS 합계</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="중증도" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">QoL</th>
                    </tr></thead>
                    <tbody>
                      {/* Q1-Q7 열은 문항별 저장이 없어 제거했다(합계·QoL 만 저장한다) */}
                      {!patientId ? <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : examsLoading ? <LoadingRows cols={4} />
                      : examsError ? <ErrorRow cols={4} />
                      : ipssRecords.length === 0 ? <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="IPSS 기록 없음" /></td></tr>
                      : ipssRecords.map((r) => {
                        const sev = IPSS_SEVERITY[ipssSeverity(r.totalScore)];
                        return (
                          <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3 text-xs text-gray-400">{r.assessedAt ? kdate(r.assessedAt) : '-'}</td>
                            <td className="px-4 py-3 text-xs font-bold text-gray-900">{r.totalScore}</td>
                            <td className="px-4 py-3">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${sev.color}`}>
                                {sev.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-700">{r.qolScore ?? '미평가'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 시술기록 — UrologyProcedure(procedures/:patientId) */}
            {tab === 'procedures' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시술일" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시술" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="적응증" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="마취" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="소견" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검체" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="합병증" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시술의" /></th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : procLoading ? <LoadingRows cols={8} />
                    : procError ? <ErrorRow cols={8} />
                    : procedures.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="시술기록 없음" /></td></tr>
                    : procedures.map((p) => {
                      const doc = p.performer as Record<string, unknown> | undefined;
                      const type = (p.procedureType as string) ?? '';
                      return (
                        <tr key={p.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3 text-xs text-gray-400">{p.performedAt ? kdate(p.performedAt as string) : '-'}</td>
                          <td className="px-4 py-3 text-xs font-medium text-gray-900">{PROCEDURE_LABEL[type] ?? (type || '-')}</td>
                          <td className="px-4 py-3 text-xs text-gray-700 max-w-[160px] truncate">{(p.indication as string) ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{(p.anesthesia as string) ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-700 max-w-[180px] truncate">{(p.findings as string) ?? '-'}</td>
                          {/* 🔴 검체 채취 여부는 3상태다 — 미기록을 '없음'으로 접으면 병리 연계 누락이 보이지 않는다 */}
                          <td className="px-4 py-3 text-xs">
                            {p.specimenTaken == null
                              ? <span className="text-gray-400">미기록</span>
                              : p.specimenTaken === true
                                ? <span className="font-bold text-amber-700">채취</span>
                                : <span className="text-gray-500">없음</span>}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-700 max-w-[150px] truncate">{(p.complications as string) ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{doc ? `${(doc.familyName as string) ?? ''}${(doc.givenName as string) ?? ''}` : '-'}</td>
                        </tr>
                      );
                    })}
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
