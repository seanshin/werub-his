'use client';

import { useState, useCallback } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import PatientSelector from '@/components/ui/PatientSelector';
import { SpecialtyPatientListMeta, specialtyPatientMeta } from '@/components/specialty/SpecialtyPatientListMeta';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { GrowthPercentileCell } from '@/components/specialty/GrowthPercentileCell';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import GrowthCurveChart, { type GrowthSex } from '@/components/specialty/GrowthCurveChart';
import { growthPointsOf, growthSexOf, devResultView } from '@/lib/specialty/pediatrics-views';
import StatCard from '@/components/ui/StatCard';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { kdate } from '@/lib/ui-settings';

/**
 * 🔴 종전 이 자리에 `DENVER_LABEL`(선언만 되고 **한 번도 쓰이지 않음**)과 `DENVER_COLOR`(로컬 Record 재정의)가 있었다.
 *    셀은 `{r.grossMotor ?? '-'}` 라 소아과 의사에게 `NORMAL`/`DELAY` 가 **영문 원문 그대로** 보였고,
 *    진료 입력 화면이 저장하는 `SUSPECT`/`DELAYED` 는 `DENVER_COLOR` 에 없어 회색으로 떨어졌다.
 *    어휘·색 정본은 `lib/specialty/pediatrics-views` 하나(`devResultView`)다.
 */

type PediTab = 'growth' | 'immunization' | 'development';

/** 발달평가 결과 셀 — 미평가는 회색 `-`(정상으로 접지 않는다), 미지 어휘는 원문 그대로. */
function DevCell({ value }: { value: unknown }) {
  const v = devResultView(value);
  if (!v) return <span className="text-xs text-gray-400">-</span>;
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${v.cls}`}>{v.label}</span>;
}

export default function PediatricsPage() {
  const tAttr = useTAttr();
  const [showLegacy, setShowLegacy] = useState(false);
  const [tab, setTab] = useState<PediTab>('growth');
  const [patientId, setPatientId] = useState('');

  // ── Dashboard data ──
  const { data: todayData, isLoading: todayLoading, isError: todayError, error: todayErr, refetch: todayRefetch } = useQuery({
    queryKey: ['pediatrics-today'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/pediatrics/today'),
  });
  const { data: statsData, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['pediatrics-stats'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/pediatrics/stats'),
  });
  const { data: patientsData, isLoading: patientsLoading, isError: patientsIsError, error: patientsError, refetch: refetchPatients } = useQuery({
    queryKey: ['pediatrics-patients'],
    queryFn: () => apiClient.get<{ data: Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> }>('/api/v1/pediatrics/patients'),
  });
  const myPatients = (() => { const r = patientsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> ?? []; })();
  const todayPatients: Record<string, unknown>[] = (() => { const r = todayData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const stats: Record<string, unknown> = (() => { const r = statsData?.data; if (r && typeof r === 'object' && !Array.isArray(r) && 'data' in (r as unknown as Record<string, unknown>)) return (r as unknown as Record<string, unknown>).data as Record<string, unknown>; return (r ?? {}) as Record<string, unknown>; })();

  // ── Legacy patient data ──
  const { data: growthData, isLoading: growthLoading, isError: growthIsError, error: growthError, refetch: refetchGrowth } = useQuery({
    queryKey: ['pediatrics-growth', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/pediatrics/growth/${patientId}`),
    enabled: tab === 'growth' && !!patientId && showLegacy,
  });
  const { data: immunizationData, isLoading: immunizationLoading, isError: immunizationIsError, error: immunizationError, refetch: refetchImmunization } = useQuery({
    queryKey: ['pediatrics-immunization', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/pediatrics/immunizations/${patientId}`),
    enabled: tab === 'immunization' && !!patientId && showLegacy,
  });
  const { data: developmentData, isLoading: developmentLoading, isError: developmentIsError, error: developmentError, refetch: refetchDevelopment } = useQuery({
    queryKey: ['pediatrics-development', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/pediatrics/developmental/${patientId}`),
    enabled: tab === 'development' && !!patientId && showLegacy,
  });

  const growthRecords: Record<string, unknown>[] = (() => { const r = growthData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  // 🔴 종전 `<GrowthCurveChart data={[]} gender="male" />` — 계측이 곡선에 하나도 안 찍혔고,
  //    성별이 하드코딩이라 **여아 환자도 남아 백분위 곡선** 위에 그려졌다(2026-08-26).
  const growthPoints = growthPointsOf(growthRecords);
  // 성별은 서버가 성장기록과 함께 준다. 모르면 `null` — 차트가 참조곡선을 그리지 않고 그 사실을 말한다.
  const growthSex: GrowthSex = growthSexOf(growthRecords[0]);
  const immunizations: Record<string, unknown>[] = (() => { const r = immunizationData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const developments: Record<string, unknown>[] = (() => { const r = developmentData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();


  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  if (todayError) return <QueryErrorFallback error={todayErr} onRetry={todayRefetch} />;

  return (
    <div>
      <PageHeader title={tAttr('소아청소년과 대시보드')} />

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
              <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="소아청소년과 기록이 있는 환자가 없습니다" /></td></tr>
            ) : myPatients.map((p) => (
              <tr key={p.patientId} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-xs font-medium text-gray-900">{`${p.familyName ?? ''}${p.givenName ?? ''}`}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{p.mrn ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{p.lastDate ? kdate(p.lastDate) : '-'}</td>
                <td className="px-4 py-3">
                  <Link href={`/patients/${p.patientId}?tab=pediatrics`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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
                      <Link href={`/patients/${pid}?tab=pediatrics`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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
                { key: 'growth' as PediTab, label: '성장기록' },
                { key: 'immunization' as PediTab, label: '예방접종' },
                { key: 'development' as PediTab, label: '발달평가' },
              ]).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
              ))}
            </div>

            {/* 성장기록 */}
            {tab === 'growth' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <GrowthCurveChart data={growthPoints} type="weight" gender={growthSex} />
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="측정일" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">체중(kg)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">신장(cm)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">두위(cm)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">BMI</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">체중 백분위</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">신장 백분위</th>
                    </tr></thead>
                    <tbody>
                      {!patientId ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : growthIsError ? <tr><td colSpan={7} className="py-6"><QueryErrorFallback error={growthError} onRetry={() => refetchGrowth()} size="compact" /></td></tr>
                      : growthLoading ? <LoadingRows cols={7} />
                      : growthRecords.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="성장기록 없음" /></td></tr>
                      : growthRecords.map((r) => (
                        <tr key={r.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3 text-xs text-gray-400">{r.measuredAt ? kdate(r.measuredAt as string) : '-'}</td>
                          <td className="px-4 py-3 text-xs font-medium text-gray-900">{(r.weight as number) ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{(r.height as number) ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{(r.headCirc as number) ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{(r.bmi as number) ?? '-'}</td>
                          <td className="px-4 py-3">
                            <GrowthPercentileCell value={r.weightPercentile} basis={r.percentileBasis} />
                          </td>
                          <td className="px-4 py-3">
                            <GrowthPercentileCell value={r.heightPercentile} basis={r.percentileBasis} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 예방접종 */}
            {tab === 'immunization' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="백신명" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="차수@접종" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="접종일" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="접종부위" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="다음접종일" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : immunizationIsError ? <tr><td colSpan={6} className="py-6"><QueryErrorFallback error={immunizationError} onRetry={() => refetchImmunization()} size="compact" /></td></tr>
                    : immunizationLoading ? <LoadingRows cols={6} />
                    : immunizations.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="예방접종 기록 없음" /></td></tr>
                    : immunizations.map((r) => (
                      <tr key={r.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-xs font-medium text-gray-900">{(r.vaccineName as string) ?? '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{(r.doseNumber as number) ?? '-'}차</td>
                        <td className="px-4 py-3 text-xs text-gray-400">{r.givenAt ? kdate(r.givenAt as string) : '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{(r.site as string) ?? '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-400">{r.nextDueDate ? kdate(r.nextDueDate as string) : '-'}</td>
                        <td className="px-4 py-3">
                          <StatusBadge domain="plan" status={(r.status as string) ?? ''} className="text-[10px] font-bold whitespace-nowrap" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 발달평가 */}
            {tab === 'development' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="평가일" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="월령" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">대근육</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">소근육</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">언어</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">사회성</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">종합판정</th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : developmentIsError ? <tr><td colSpan={7} className="py-6"><QueryErrorFallback error={developmentError} onRetry={() => refetchDevelopment()} size="compact" /></td></tr>
                    : developmentLoading ? <LoadingRows cols={7} />
                    : developments.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="발달평가 기록 없음" /></td></tr>
                    : developments.map((r) => (
                      <tr key={r.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-xs text-gray-400">{r.assessedAt ? kdate(r.assessedAt as string) : '-'}</td>
                        <td className="px-4 py-3 text-xs font-medium text-gray-900">{(r.ageMonths as number) ?? '-'}<Unit>개월</Unit></td>
                        <td className="px-4 py-3">
                          <DevCell value={r.grossMotor} />
                        </td>
                        <td className="px-4 py-3">
                          <DevCell value={r.fineMotor} />
                        </td>
                        <td className="px-4 py-3">
                          <DevCell value={r.language} />
                        </td>
                        <td className="px-4 py-3">
                          <DevCell value={r.socialPersonal} />
                        </td>
                        <td className="px-4 py-3">
                          <DevCell value={r.overallResult} />
                        </td>
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
