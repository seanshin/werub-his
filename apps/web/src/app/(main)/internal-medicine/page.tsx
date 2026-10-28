'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import PatientSelector from '@/components/ui/PatientSelector';
import { SpecialtyPatientListMeta, specialtyPatientMeta } from '@/components/specialty/SpecialtyPatientListMeta';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import ScoreTrendChart from '@/components/specialty/ScoreTrendChart';
import StatCard from '@/components/ui/StatCard';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { kdate } from '@/lib/ui-settings';
// 🔴 세부과 컬럼·점수추이 정본은 `lib/specialty/internal-medicine-views` 하나다.
//    종전엔 이 파일과 `patients/[id]/components/InternalMedicineTab.tsx` 가 각자 정의해 갈라졌고,
//    이쪽 14칸이 서버에 없는 필드명이라 값이 있어도 항상 `-` 였다(2026-08-26 수렴).
import {
  IM_SUBSPECIALTY_VIEWS, imViewOf, imCellValue, imTrendSeries, type Subspecialty,
} from '@/lib/specialty/internal-medicine-views';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function InternalMedicinePage() {
  const tAttr = useTAttr();
  const [subspecialty, setSubspecialty] = useState<Subspecialty>('CARDIOLOGY');
  const [showLegacy, setShowLegacy] = useState(false);
  const [patientId, setPatientId] = useState('');

  const currentDef = imViewOf(subspecialty);

  /* ── Dashboard data ── */
  const { data: statsData, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['im-stats'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/internal-medicine/stats'),
  });
  const stats: Record<string, unknown> = (() => {
    const r = statsData?.data;
    if (r && typeof r === 'object' && !Array.isArray(r) && 'data' in (r as unknown as Record<string, unknown>))
      return (r as unknown as Record<string, unknown>).data as Record<string, unknown>;
    return (r ?? {}) as Record<string, unknown>;
  })();

  const { data: patientsData, isLoading: patientsLoading, isError: patientsError, error: patientsErr, refetch: patientsRefetch } = useQuery({
    queryKey: ['im-patients'],
    queryFn: () =>
      apiClient
        .get<{ data: Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> }>('/api/v1/internal-medicine/patients'),
  });
  const myPatients = (() => {
    const r = patientsData?.data;
    return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> ?? [];
  })();

  const { data: todayData, isLoading: todayLoading, isError: todayIsError, error: todayError, refetch: refetchToday } = useQuery({
    queryKey: ['im-today'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/internal-medicine/today'),
  });
  const todayPatients: Record<string, unknown>[] = (() => {
    const r = todayData?.data;
    return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? [];
  })();

  /* ── Per-patient exam data ── */
  const { data: examData, isLoading: examLoading, isError: examIsError, error: examError, refetch: refetchExams } = useQuery({
    queryKey: ['im-exams', patientId, subspecialty],
    queryFn: () =>
      apiClient
        .get<{ data: Record<string, unknown>[] }>(`/api/v1/internal-medicine/exams/${patientId}`, { subspecialty: subspecialty as string }),
    enabled: !!patientId && showLegacy,
  });
  const exams: Record<string, unknown>[] = (() => {
    const r = examData?.data;
    return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? [];
  })();

  // 🔴 BE score-trend 는 `{점수필드…, examinedAt}` 의 **flat 배열**이다(시리즈 그룹맵이 아니다).
  //    종전엔 `trendMap['MELD']` 처럼 표시명으로 읽어 언제나 `undefined → []` → filter 가 전부 걸러내
  //    **점수 추이 차트가 개통 이래 한 번도 렌더된 적이 없었다.** 정본 `imTrendSeries` 로 그룹화한다.
  const { data: trendData, isError: trendIsError, error: trendError, refetch: refetchTrend } = useQuery({
    queryKey: ['im-trend', patientId, subspecialty],
    queryFn: () =>
      apiClient
        .get<{ data: Record<string, unknown>[] }>(`/api/v1/internal-medicine/score-trend/${patientId}`, { subspecialty: subspecialty as string }),
    enabled: !!patientId && showLegacy,
  });
  const trendRows: Record<string, unknown>[] = (() => {
    const r = trendData?.data;
    return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? [];
  })();

  const trendSeries = useMemo(() => imTrendSeries(trendRows, currentDef), [trendRows, currentDef]);

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i}>
          <td colSpan={cols} className="px-4 py-3">
            <div className="h-4 bg-gray-100 rounded animate-pulse" />
          </td>
        </tr>
      ))}
    </>
  );

  if (patientsError) return <QueryErrorFallback error={patientsErr} onRetry={patientsRefetch} />;

  return (
    <div>
      {/* Header */}
      <PageHeader title={tAttr('내과 대시보드')} />

      {/* ── Subspecialty Tabs ── */}
      <div className="flex gap-1 mb-6 bg-gray-100/80 p-1 rounded-xl overflow-x-auto">
        {IM_SUBSPECIALTY_VIEWS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSubspecialty(s.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
              subspecialty === s.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Stats Cards ── */}
      {/* 🔴 통계 조회 실패에 0 을 그리지 않는다 — 0건은 다른 사실이다 */}
      {statsIsError && <QueryErrorFallback error={statsError} onRetry={() => refetchStats()} size="compact" className="mb-6" />}
      {!statsIsError && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard title={tAttr('총 검사')} value={Number(stats.totalExams ?? 0)} color="gray" />
        <StatCard title={tAttr('오늘')} value={Number(stats.todayExams ?? todayPatients.length ?? 0)} color="blue" />
        <StatCard title={tAttr('완료')} value={Number(stats.completedToday ?? stats.completed ?? 0)} color="emerald" />
        <StatCard title={tAttr('대기')} value={Number(stats.waitingToday ?? stats.waiting ?? 0)} color="amber" />
      </div>
      )}

      {/* ── My Patients ── */}
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
            {patientsLoading ? (
              <LoadingRows cols={4} />
            ) : myPatients.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-12 text-center text-gray-400">
                  <T k="내과 기록이 있는 환자가 없습니다" />
                </td>
              </tr>
            ) : (
              myPatients.map((p) => (
                <tr key={p.patientId} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-xs font-medium text-gray-900">{`${p.familyName ?? ''}${p.givenName ?? ''}`}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">{p.mrn ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {p.lastDate ? kdate(p.lastDate) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/patients/${p.patientId}?tab=internal-medicine`}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      <T k="차트 열기" /> &rarr;
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Today Patients ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
          <h3 className="text-sm font-bold text-gray-900"><T k="오늘 환자 목록" /></h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/30">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시간" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자명" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="세부과" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="주소@주호소" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="차트" /></th>
            </tr>
          </thead>
          <tbody>
            {todayIsError ? (
              <tr>
                <td colSpan={6} className="p-4">
                  <QueryErrorFallback error={todayError} onRetry={() => refetchToday()} size="compact" />
                </td>
              </tr>
            ) : todayLoading ? (
              <LoadingRows cols={6} />
            ) : todayPatients.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-400">
                  <T k="오늘 예약된 환자가 없습니다" />
                </td>
              </tr>
            ) : (
              todayPatients.map((p, idx) => {
                const pid = (p.patientId ?? p.patient_id ?? (p.patient as unknown as Record<string, unknown>)?.id) as string | undefined;
                const patientObj = p.patient as Record<string, unknown> | undefined;
                const name = patientObj
                  ? `${(patientObj.familyName as string) ?? ''}${(patientObj.givenName as string) ?? ''}`
                  : (p.patientName as string) ?? '-';
                const time = (p.scheduledAt ?? p.appointmentTime ?? p.time) as string | undefined;
                const timeStr = time
                  ? kdate(time, 'time')
                  : (p.timeSlot as string) ?? '-';
                const subLabel = IM_SUBSPECIALTY_VIEWS.find((s) => s.key === (p.subspecialty as string))?.label ?? (p.subspecialty as string) ?? '-';
                const chief = (p.chiefComplaint ?? p.reason) as string ?? '-';
                // 데이터원 = 오늘 예약(Appointment) → 상태 도메인도 appointment(종전 plan 도메인은
              // SCHEDULED·CONFIRMED·CHECKED_IN·NO_SHOW 를 몰라 영문 원문을 노출했다)
              const status = (p.status as string) ?? '';
                return (
                  <tr key={`${pid ?? idx}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-xs text-gray-700">{timeStr}</td>
                    <td className="px-4 py-3 text-xs font-medium text-gray-900">{name}</td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 whitespace-nowrap">
                        {subLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-[150px] truncate">{chief}</td>
                    <td className="px-4 py-3">
                      <StatusBadge domain="appointment" status={status} className="text-[10px] font-bold whitespace-nowrap" />
                    </td>
                    <td className="px-4 py-3">
                      {pid ? (
                        <Link href={`/patients/${pid}?tab=internal-medicine`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                          <T k="차트 열기" /> &rarr;
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Collapsible: Per-patient detail ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <button
          onClick={() => setShowLegacy(!showLegacy)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/50 transition-colors"
        >
          <span className="text-sm font-bold text-gray-700"><T k="개별 환자 조회" /></span>
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${showLegacy ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {showLegacy && (
          <div className="border-t border-gray-100 p-4">
            {/* Patient ID input */}
            <div className="flex items-center gap-2 mb-4">
              <div className="w-80" data-specialty-patient-picker><PatientSelector value={patientId} onChange={(id) => setPatientId(id)} /></div>
            </div>

            {/* Score trend chart */}
            {patientId && trendIsError && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
                <h4 className="text-sm font-bold text-gray-900 mb-3">{currentDef.label} <T k="점수 추이" /></h4>
                <QueryErrorFallback error={trendError} onRetry={() => refetchTrend()} size="compact" />
              </div>
            )}
            {patientId && !trendIsError && trendSeries.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
                <h4 className="text-sm font-bold text-gray-900 mb-3">
                  {currentDef.label} <T k="점수 추이" />
                </h4>
                <ScoreTrendChart series={trendSeries} />
              </div>
            )}

            {/* Exam table with subspecialty-specific columns */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    {currentDef.columns.map((col) => (
                      <th key={col.key} className="px-4 py-3 text-left text-xs font-medium text-gray-500">
                        {col.label}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="담당의" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
                  </tr>
                </thead>
                <tbody>
                  {!patientId ? (
                    <tr>
                      <td colSpan={currentDef.columns.length + 2} className="py-12 text-center text-gray-400">
                        <T k="환자 ID를 입력하세요" />
                      </td>
                    </tr>
                  ) : examIsError ? (
                    <tr>
                      <td colSpan={currentDef.columns.length + 2} className="p-4">
                        <QueryErrorFallback error={examError} onRetry={() => refetchExams()} size="compact" />
                      </td>
                    </tr>
                  ) : examLoading ? (
                    <LoadingRows cols={currentDef.columns.length + 2} />
                  ) : exams.length === 0 ? (
                    <tr>
                      <td colSpan={currentDef.columns.length + 2} className="py-12 text-center text-gray-400">
                        {currentDef.label} <T k="기록 없음" />
                      </td>
                    </tr>
                  ) : (
                    exams.map((ex) => {
                      const doctor = ex.examiner as Record<string, unknown> | undefined;
                      return (
                        <tr key={ex.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                          {currentDef.columns.map((col) => (
                            <td key={col.key} className="px-4 py-3 text-xs text-gray-700">
                              {imCellValue(ex, col)}
                            </td>
                          ))}
                          <td className="px-4 py-3 text-xs text-gray-700 max-w-[150px] truncate">
                            {(ex.diagnosis as string) ?? '-'}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-700">
                            {doctor ? `${(doctor.familyName as string) ?? ''}${(doctor.givenName as string) ?? ''}` : '-'}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400">
                            {/* 실필드는 `examinedAt` — 종전 `examDate` 는 모델에 없어 날짜 열이 전 행 '-' 였다 */}
                            {ex.examinedAt ? kdate(ex.examinedAt as string) : '-'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
