'use client';

import { useState, useCallback } from 'react';
import { Unit } from '@/components/ui/display';
import { obgynPrenatalRows, obgynGynRows, obgynUltrasoundRows, obgynGrowthPoints } from '@/lib/specialty/exam-views';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import PatientSelector from '@/components/ui/PatientSelector';
import { SpecialtyPatientListMeta, specialtyPatientMeta } from '@/components/specialty/SpecialtyPatientListMeta';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import GrowthCurveChart from '@/components/specialty/FetalGrowthChart';
import StatCard from '@/components/ui/StatCard';
import PageHeader from '@/components/ui/PageHeader';
import DeliveryBoard from './DeliveryBoard';
import StatusBadge from '@/components/ui/StatusBadge';
import { kdate } from '@/lib/ui-settings';


type ObgynTab = 'prenatal' | 'gynecology' | 'ultrasound';

export default function ObgynPage() {
  const tAttr = useTAttr();
  const [showLegacy, setShowLegacy] = useState(false);
  const [tab, setTab] = useState<ObgynTab>('prenatal');
  const [patientId, setPatientId] = useState('');

  // ── Dashboard data ──
  const { data: todayData, isLoading: todayLoading, isError: todayError, error: todayErr, refetch: todayRefetch } = useQuery({
    queryKey: ['obgyn-today'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/obgyn/today'),
  });
  const { data: statsData, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['obgyn-stats'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/obgyn/stats'),
  });
  const { data: patientsData, isLoading: patientsLoading, isError: patientsIsError, error: patientsError, refetch: refetchPatients } = useQuery({
    queryKey: ['obgyn-patients'],
    queryFn: () => apiClient.get<{ data: Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> }>('/api/v1/obgyn/patients'),
  });
  const myPatients = (() => { const r = patientsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> ?? []; })();
  const todayPatients: Record<string, unknown>[] = (() => { const r = todayData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const stats: Record<string, unknown> = (() => { const r = statsData?.data; if (r && typeof r === 'object' && !Array.isArray(r) && 'data' in (r as unknown as Record<string, unknown>)) return (r as unknown as Record<string, unknown>).data as Record<string, unknown>; return (r ?? {}) as Record<string, unknown>; })();

  // ── 개별 환자 조회 — 정본은 `exams/:patientId`(examType 으로 분기) 하나다 ──
  //    🔴 종전엔 없는 `obgyn/{prenatal,gynecology,ultrasound}` 를 부르고 404 를 삼켜 세 탭이
  //       개통 이래 영구히 "기록 없음"이었다(2026-08-18 이연 회수).
  const { data: examsData, isLoading: examsLoading, isError: examsError } = useQuery({
    queryKey: ['obgyn-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/obgyn/exams/${patientId}`),
    enabled: !!patientId && showLegacy,
  });

  const exams: Record<string, unknown>[] = (() => { const r = examsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const prenatalRecords = obgynPrenatalRows(exams);
  const gynecologyRecords = obgynGynRows(exams);
  const ultrasoundRecords = obgynUltrasoundRows(exams);
  const growthPoints = obgynGrowthPoints(ultrasoundRecords);


  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );
  // 🔴 조회 실패를 '기록 없음'으로 말하지 않는다 — 둘은 다른 사실이다.
  const ErrorRow = ({ cols }: { cols: number }) => (
    <tr><td colSpan={cols} className="py-12 text-center text-sm text-red-600"><T k="조회에 실패했습니다 — 기록이 없는 것이 아니라 불러오지 못했습니다" /></td></tr>
  );

  if (todayError) return <QueryErrorFallback error={todayErr} onRetry={todayRefetch} />;

  return (
    <div>
      <PageHeader title={tAttr('산부인과 대시보드')} />

      {/* ── 상단: 오늘의 현황 카드 ── 🔴 통계 조회 실패를 "0건"으로 말하지 않는다 */}
      {statsIsError && <div className="mb-6"><QueryErrorFallback error={statsError} onRetry={refetchStats} size="compact" /></div>}
      {!statsIsError && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard title={tAttr('오늘 예약')} value={Number(stats.todayAppointments ?? stats.totalAppointments ?? todayPatients.length ?? 0)} color="gray" />
        <StatCard title={tAttr('완료')} value={Number(stats.completedToday ?? stats.completed ?? 0)} color="emerald" />
        <StatCard title={tAttr('진행 중')} value={Number(stats.inProgressToday ?? stats.inProgress ?? 0)} color="blue" />
        <StatCard title={tAttr('대기')} value={Number(stats.waitingToday ?? stats.waiting ?? 0)} color="amber" />
      </div>
      )}

      {/* ── 분만장 보드 (L&D) ── */}
      <DeliveryBoard />

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
              <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="산부인과 기록이 있는 환자가 없습니다" /></td></tr>
            ) : myPatients.map((p) => (
              <tr key={p.patientId} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-xs font-medium text-gray-900">{`${p.familyName ?? ''}${p.givenName ?? ''}`}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{p.mrn ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{p.lastDate ? kdate(p.lastDate) : '-'}</td>
                <td className="px-4 py-3">
                  <Link href={`/patients/${p.patientId}?tab=obgyn`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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
                      <Link href={`/patients/${pid}?tab=obgyn`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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
                { key: 'prenatal' as ObgynTab, label: '산전기록' },
                { key: 'gynecology' as ObgynTab, label: '부인과' },
                { key: 'ultrasound' as ObgynTab, label: '초음파' },
              ]).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
              ))}
            </div>

            {/* 산전기록 */}
            {tab === 'prenatal' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <GrowthCurveChart data={growthPoints} metric="efw" />
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검진일" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">임신주수</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="분만예정일" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">G/P</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">체중(kg)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">혈압</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">소변</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">자궁저높이</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">태아심박</th>
                    </tr></thead>
                    <tbody>
                      {!patientId ? <tr><td colSpan={9} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : examsLoading ? <LoadingRows cols={9} />
                      : examsError ? <ErrorRow cols={9} />
                      : prenatalRecords.length === 0 ? <tr><td colSpan={9} className="py-12 text-center text-gray-400"><T k="산전기록 없음" /></td></tr>
                      : prenatalRecords.map((r) => (
                        <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3 text-xs text-gray-400">{r.examinedAt ? kdate(r.examinedAt) : '-'}</td>
                          {/* 주수는 "28W3D" 원문을 그대로 — 주 단위로 접으면 일수가 사라진다 */}
                          <td className="px-4 py-3 text-xs font-medium text-gray-900">{r.gestationalAge ?? '미기재'}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{r.edd ? kdate(r.edd) : '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{r.gravida ?? '-'}/{r.para ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{r.currentWeight ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{r.bloodPressure ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">
                            {r.urineProtein === null && r.urineGlucose === null ? '미검' : `단백 ${r.urineProtein ?? '미검'} / 당 ${r.urineGlucose ?? '미검'}`}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-700">{r.fundalHeight ?? '-'}<Unit>cm</Unit></td>
                          <td className="px-4 py-3">
                            {/* 🔴 미측정 태아심박을 0bpm(=사망)으로 말하지 않는다 */}
                            {r.fetalHeartRate === null ? <span className="text-xs text-gray-400">미측정</span> : (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${r.fetalHeartRate < 110 || r.fetalHeartRate > 160 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {r.fetalHeartRate} bpm
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 부인과 */}
            {tab === 'gynecology' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진료일" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단명" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Pap</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">HPV</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">골반초음파</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="계획@진료계획" /></th>
                  </tr></thead>
                  <tbody>
                    {/* 시술/상태 열은 저장 필드가 없어 실제 저장값(Pap·HPV·골반초음파·계획)으로 교체했다 */}
                    {!patientId ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : examsLoading ? <LoadingRows cols={6} />
                    : examsError ? <ErrorRow cols={6} />
                    : gynecologyRecords.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="부인과 기록 없음" /></td></tr>
                    : gynecologyRecords.map((r) => (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-xs text-gray-400">{r.examinedAt ? kdate(r.examinedAt) : '-'}</td>
                        <td className="px-4 py-3 text-xs font-medium text-gray-900">{r.diagnosis ?? '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{r.papSmear ?? '미시행'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{r.hpvTest ?? '미시행'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{r.pelvicUltrasound ?? '미시행'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{r.plan ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 초음파 */}
            {tab === 'ultrasound' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사일" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">BPD(mm)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">FL(mm)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">AC(mm)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">EFW(g)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">AFI</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">태위</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">태반위치</th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : examsLoading ? <LoadingRows cols={8} />
                    : examsError ? <ErrorRow cols={8} />
                    : ultrasoundRecords.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="초음파 기록 없음" /></td></tr>
                    : ultrasoundRecords.map((r) => (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-xs text-gray-400">{r.examinedAt ? kdate(r.examinedAt) : '-'}</td>
                        <td className="px-4 py-3 text-xs font-medium text-gray-900">{r.bpd ?? '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{r.fl ?? '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{r.ac ?? '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{r.efw ?? '-'}</td>
                        <td className="px-4 py-3">
                          {/* 🔴 종전엔 `?? 10` 이라 **재지 않은 AFI 가 정상(초록)** 으로 보였다 */}
                          {r.afi === null ? <span className="text-xs text-gray-400">미측정</span> : (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${r.afi < 5 || r.afi > 25 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {r.afi}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700">{r.presentation ?? '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{r.placentaLocation ?? '-'}</td>
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
