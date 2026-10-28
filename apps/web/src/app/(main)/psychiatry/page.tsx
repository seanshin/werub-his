'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import PatientSelector from '@/components/ui/PatientSelector';
import { SpecialtyPatientListMeta, specialtyPatientMeta } from '@/components/specialty/SpecialtyPatientListMeta';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';
import InvoluntaryAdmissionSection from './InvoluntaryAdmissionSection';
import SeclusionRestraintSection from './SeclusionRestraintSection';
import EctSection from './EctSection';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import ScoreTrendChart from '@/components/specialty/ScoreTrendChart';
import { psychMseRows, psychScaleRows, psychScaleSeries, psychSuicideRows } from '@/lib/specialty/exam-views';
import StatusBadge from '@/components/ui/StatusBadge';
import { kdate } from '@/lib/ui-settings';

const RISK_COLOR: Record<string, string> = { LOW: 'bg-emerald-100 text-emerald-700', MODERATE: 'bg-amber-100 text-amber-700', HIGH: 'bg-red-100 text-red-700' };
const RISK_LABEL: Record<string, string> = { LOW: '낮음', MODERATE: '중간', HIGH: '높음' };
// 임상도구 정본 밴드 level → 색. 밴드가 없으면(=판정 불가) 회색 — 초록(정상)으로 접지 않는다.
const LEVEL_COLOR: Record<string, string> = {
  normal: 'bg-emerald-100 text-emerald-700',
  low: 'bg-lime-100 text-lime-700',
  moderate: 'bg-amber-100 text-amber-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

type PsychTab = 'mse' | 'scores' | 'suicideRisk';

// 평가 여부 3상태 — true='Y' · false='N' · 미평가=미평가(모름을 없음으로 말하지 않는다)
const yesNo = (v: unknown) => (v === true ? 'Y' : v === false ? 'N' : '미평가');

export default function PsychiatryPage() {
  const tAttr = useTAttr();
  const [showLegacy, setShowLegacy] = useState(false);
  const [tab, setTab] = useState<PsychTab>('mse');
  const [patientId, setPatientId] = useState('');

  // ── Dashboard data ──
  const { data: todayData, isLoading: todayLoading, isError, error, refetch } = useQuery({
    queryKey: ['psychiatry-today'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/psychiatry/today'),
  });
  const { data: statsData, isLoading: statsLoading, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['psychiatry-stats'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/psychiatry/stats'),
  });
  const { data: patientsData, isLoading: patientsLoading, isError: patientsIsError, error: patientsError, refetch: refetchPatients } = useQuery({
    queryKey: ['psychiatry-patients'],
    queryFn: () => apiClient.get<{ data: Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> }>('/api/v1/psychiatry/patients'),
  });
  const myPatients = (() => { const r = patientsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> ?? []; })();
  const todayPatients: Record<string, unknown>[] = (() => { const r = todayData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const stats: Record<string, unknown> = (() => { const r = statsData?.data; if (r && typeof r === 'object' && !Array.isArray(r) && 'data' in (r as unknown as Record<string, unknown>)) return (r as unknown as Record<string, unknown>).data as Record<string, unknown>; return (r ?? {}) as Record<string, unknown>; })();

  // ── 개별 환자 조회 — 정본은 `exams/:patientId` 하나다 ──
  //    🔴 종전엔 존재하지 않는 `psychiatry/{mse,scores,suicide-risk}` 를 부르고 404 를 `.catch` 로
  //       삼켜 세 탭이 개통 이래 영구히 "기록 없음"이었다(2026-08-18 W-이연 회수).
  const { data: examsData, isLoading: examsLoading, isError: examsError } = useQuery({
    queryKey: ['psychiatry-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/psychiatry/exams/${patientId}`),
    enabled: !!patientId && showLegacy,
  });

  const exams: Record<string, unknown>[] = (() => { const r = examsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const mseRecords = psychMseRows(exams);
  const scoreRecords = psychScaleRows(exams);
  const scoreSeries = psychScaleSeries(exams);
  const suicideRecords = psychSuicideRows(exams);


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
          <h2 className="text-2xl font-bold text-gray-900"><T k="정신건강의학과 대시보드" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="오늘의 현황 / 환자 목록 / MSE·심리검사 관리" /></p>
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
              <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="정신건강의학과 기록이 있는 환자가 없습니다" /></td></tr>
            ) : myPatients.map((p) => (
              <tr key={p.patientId} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-xs font-medium text-gray-900">{`${p.familyName ?? ''}${p.givenName ?? ''}`}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{p.mrn ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{p.lastDate ? kdate(p.lastDate) : '-'}</td>
                <td className="px-4 py-3">
                  <Link href={`/patients/${p.patientId}?tab=psychiatry`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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
                      <Link href={`/patients/${pid}?tab=psychiatry`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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

      {/* ── 비자의입원(정신건강복지법) — 항상 표시 ── */}
      <div className="mb-5">
        <h2 className="text-sm font-bold text-gray-900 mb-3"><T k="비자의입원 관리" /> <span className="text-xs font-normal text-gray-400">정신건강복지법 §41~50</span></h2>
        <InvoluntaryAdmissionSection patientId={patientId || undefined} />
      </div>

      {/* ── §75 격리·강박 — 항상 표시 ── */}
      <div className="mb-5">
        <SeclusionRestraintSection patientId={patientId || undefined} />
      </div>

      {/* ── ECT(전기경련치료) — 동의서 게이트 ── */}
      <div className="mb-5">
        <EctSection patientId={patientId || undefined} />
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
                { key: 'mse' as PsychTab, label: 'MSE기록' },
                { key: 'scores' as PsychTab, label: '심리검사' },
                { key: 'suicideRisk' as PsychTab, label: '자살위험' },
              ]).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
              ))}
            </div>

            {/* MSE기록 */}
            {tab === 'mse' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="기록일" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">외양/행동</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">말</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">기분/정동</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">사고내용</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">사고과정</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">지각</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">인지</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">병식</th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={9} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : examsLoading ? <LoadingRows cols={9} />
                    : examsError ? <ErrorRow cols={9} />
                    : mseRecords.length === 0 ? <tr><td colSpan={9} className="py-12 text-center text-gray-400"><T k="MSE 기록 없음" /></td></tr>
                    : mseRecords.map((r) => (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-xs text-gray-400">{r.examinedAt ? kdate(r.examinedAt) : '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 max-w-[100px] truncate">{r.appearanceBehavior ?? '미기재'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 max-w-[80px] truncate">{r.speech ?? '미기재'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 max-w-[100px] truncate">{r.moodAffect ?? '미기재'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 max-w-[100px] truncate">{r.thoughtContent ?? '미기재'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 max-w-[100px] truncate">{r.thoughtProcess ?? '미기재'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 max-w-[80px] truncate">{r.perception ?? '미기재'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 max-w-[80px] truncate">{r.cognition ?? '미기재'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{r.insight ?? '미기재'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 심리검사 */}
            {tab === 'scores' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <ScoreTrendChart series={scoreSeries} />
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사일" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사명" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="점수" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="해석" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="비고" /></th>
                    </tr></thead>
                    <tbody>
                      {!patientId ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : examsLoading ? <LoadingRows cols={5} />
                      : examsError ? <ErrorRow cols={5} />
                      : scoreRecords.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="심리검사 기록 없음" /></td></tr>
                      : scoreRecords.map((r) => (
                        <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3 text-xs text-gray-400">{r.testedAt ? kdate(r.testedAt) : '-'}</td>
                          <td className="px-4 py-3 text-xs font-medium text-gray-900">
                            <span className="whitespace-nowrap">{r.testName}</span>
                          </td>
                          <td className="px-4 py-3">
                            {/* 🔴 중증도 절단점을 화면에서 새로 짓지 않는다 — 임상도구 정본(lib/clinical-charts) 밴드가 정한다 */}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${LEVEL_COLOR[r.level ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>
                              {r.score}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-700">{r.interpretation ?? '산출 불가'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{r.recommendation ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 자살위험 */}
            {tab === 'suicideRisk' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="평가일" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="위험도" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">C-SSRS 점수</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">자살사고</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">자살계획</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">안전계획</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="비고" /></th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : examsLoading ? <LoadingRows cols={7} />
                    : examsError ? <ErrorRow cols={7} />
                    : suicideRecords.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="자살위험 평가기록 없음" /></td></tr>
                    : suicideRecords.map((r) => (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-xs text-gray-400">{r.assessedAt ? kdate(r.assessedAt) : '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${RISK_COLOR[r.riskLevel ?? ''] ?? 'bg-gray-100'}`}>
                            {RISK_LABEL[r.riskLevel ?? ''] ?? r.riskLevel ?? '미평가'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-gray-900">{r.cssrsScore ?? '-'}</td>
                        {/* 🔴 미평가를 'N'(없음)으로 단정하지 않는다 — 자살위험 화면에서 '미평가'와 '위험 없음'을
                            뒤바꿔 말하는 것은 최악의 형태다(2026-08-13 W4). */}
                        <td className="px-4 py-3 text-xs text-gray-700">
                          {yesNo(r.suicidalIdeation)}
                          {r.ideationSource === 'PHQ9_ITEM9' && <span className="ml-1 text-[10px] text-gray-400">(PHQ-9 문항9)</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700">{yesNo(r.suicidalPlan)}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{r.safetyPlan === null ? '미기록' : r.safetyPlan ? '수립' : '미수립'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{r.notes ?? '-'}</td>
                      </tr>
                    ))}
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
