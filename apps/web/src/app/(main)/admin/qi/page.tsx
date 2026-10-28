'use client';

import Link from 'next/link';
import type React from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

import { EmptyState, Ratio, Unit, useDurationText } from '@/components/ui/display';
import { formatNum, QI_MEASUREMENT_SOURCE_LABEL, ratioText } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';
import AccreditationSection from '../../quality/AccreditationSection';

/**
 * 🔴 대기 지표는 **null 이 될 수 있다**(W8 Q3) — 서버가 "산출 불가"를 null 로 말한다.
 *    `?? 0` 으로 받으면 "대기 0분·초과 0%" 가 되어 화면이 다시 거짓말한다. 반드시 '—' 로 표시한다.
 */
interface QiMetrics {
  outpatient?: {
    totalVisits?: number;
    avgWaitMinutes?: number | null; maxWaitMinutes?: number | null;
    waitOver30Min?: number | null; waitOver30MinRate?: number | null;
    waitSampleN?: number; waitUnmeasuredN?: number; waitBasis?: string;
    encounterSignRate?: number | null; encounterN?: number;
    // 🔴 2026-08-20 — 서버가 분자를 안 줘서 화면이 분모 없는 퍼센트를 그리던 것. 이제 함께 온다.
    encounterSignNumerator?: number; encounterSignDenominator?: number;
  };
  emergency?: {
    totalVisits?: number; avgStayHours?: number; stayOver6Hours?: number; stayOver6HoursRate?: number | null;
    stayOver6HoursNumerator?: number; stayOver6HoursDenominator?: number;
    doorToDoctor?: number; admissionRate?: number | null;
    admissionNumerator?: number; admissionDenominator?: number;
    ktasDistribution?: Record<string, number>;
  };
  inpatient?: {
    totalAdmissions?: number; avgLengthOfStay?: number; longStay?: number;
    readmission30Days?: number; readmissionRate?: number | null;
    // 🔴 재입원율의 분모는 **퇴원 건**이지 입원 전량이 아니다 — 화면이 totalAdmissions 로 나누고 있었다(정본이 둘)
    readmissionNumerator?: number; readmissionDenominator?: number; dischargedCount?: number;
    bedOccupancyRate?: number | null; bedOccupancyNumerator?: number; bedOccupancyDenominator?: number;
  };
  surgery?: { totalSurgeries?: number; avgOpTimeMinutes?: number; cancelledSurgeries?: number; cancellationRate?: number | null; cancellationNumerator?: number; cancellationDenominator?: number };
  safety?: { totalPrescriptions?: number; durChecked?: number; durAlerts?: number; durAlertsBasis?: string; durOverridden?: number; statOrders?: number };
}

/** 값이 null/undefined 면 '—'(산출 불가). 0 은 진짜 0 이라 그대로 보여준다. */
function orDash(v: number | null | undefined, fmt: (n: number) => string): string {
  return v == null ? '—' : fmt(v);
}

/* ═══════════════════════════════════════════════════════════════
   QI EP 배선 (W8 이연 회수 · 2026-08-14)

   🔴 `/admin/qi` 는 `qi/metrics` **하나만** 부르고 있었고, 나머지 8종
      (target-achievement · accreditation · psi · hsmr · adequacy · benchmark ·
       indicator-dashboard · readmission-rate)은 **부르는 화면이 0건**이었다.
      "EP 를 만들면 부르는 화면까지가 한 벌" — 새 화면을 만들지 않고 이 화면을 탭으로 넓힌다.

   🔴 서버는 이미 정직하다 — `available:false`+`reason`(적정성·PSI·HSMR·벤치마크),
      `sampleWindowNote`·`periodHasMeasurements`(목표달성·지표대시보드),
      `complianceRate:null`+`complianceRateBasis`(인증), `rate:null`(재입원율),
      `byDepartmentUnavailableReason`.
      **화면이 그 필드를 소비해야** 정직해진다. `?? 0` 폴백 금지 —
      "산출 불가"를 0 으로 접으면 서버가 애써 말한 사실이 화면에서 사라진다(P1·P17).
   ═══════════════════════════════════════════════════════════════ */

type QiTab = 'metrics' | 'targets' | 'accreditation' | 'surgery' | 'readmission' | 'safety' | 'benchmark';

const QI_TABS: { key: QiTab; label: string }[] = [
  { key: 'metrics', label: '운영 지표' },
  { key: 'targets', label: '목표 달성률·지표' },
  { key: 'accreditation', label: '인증 체크리스트' },
  { key: 'surgery', label: '수술 안전 (IPSG.4)' },
  { key: 'readmission', label: '재입원율' },
  { key: 'safety', label: '환자안전·사망비' },
  { key: 'benchmark', label: '적정성·벤치마크' },
];

/** 서버가 `available:false` 로 "이건 산출 대상이 아니다"라고 말할 때의 정본 표시 */
function UnavailableNotice({ title, reason, extra }: { title: React.ReactNode; reason?: string; extra?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
      <p className="text-sm font-semibold text-gray-800">{title} — <T k="산출 불가" /></p>
      {/* 🔴 0·빈 표가 아니라 **왜 없는지**를 그대로 보여준다. 근거 없는 초록·0건이 W7 의 P17 이었다 */}
      <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{reason ?? <T k="서버가 사유를 제공하지 않았습니다." />}</p>
      {extra}
    </div>
  );
}

/** 조회 상태 공통 껍데기 — 실패를 '없음'으로 접지 않는다 */
function TabShell<T>({ q, children }: {
  q: { data?: { data: T }; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };
  children: (d: T) => React.ReactNode;
}) {
  const tAttr = useTAttr();
  if (q.isLoading) return <div className="grid grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-28 bg-gray-100 rounded-2xl animate-pulse" />)}</div>;
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={q.refetch} />;
  const d = q.data?.data;
  if (!d) return <EmptyState icon="📊" title="응답이 비어 있습니다." />;
  return <>{children(d)}</>;
}

const useQi = <T,>(key: string, path: string, params?: Record<string, string>) =>
  useQuery({
    queryKey: ['qi', key, params],
    queryFn: () => apiClient.get<{ data: T }>(`/api/v1/qi/${path}`, params),
  });

/* ─── 목표 달성률 + 월별 지표 대시보드 ─── */
interface TargetAchievement {
  period: string;
  periodHasMeasurements: boolean;
  latestAvailablePeriod: string | null;
  sampleWindowNote: string;
  items: Array<{ name: string; current: number | null; target: number; unit?: string; direction?: string; achieved: boolean | null; achievementRate: number | null }>;
  summary: { total: number; judged: number; achieved: number; notAchieved: number; unmeasured: number; undetermined: number; overallRate: number | null };
}
interface IndicatorDashboard {
  period: string;
  indicators: Array<{ indicatorId: string; name: string; category?: string; current: number | null; target: number; unit?: string; achieved: boolean | null; achievementPercent: number | null; trend: Array<{ period: string; value: number }>; latestAvailablePeriod: string | null; latestAvailableValue: number | null; benchmark: number | null }>;
  measuredCount: number;
  periodHasMeasurements: boolean;
  latestAvailablePeriod: string | null;
  sampleWindowNote: string;
  benchmarkAvailable: boolean;
  benchmarkReason: string;
}

function TargetsTab({ period }: { period: string }) {
  const tAttr = useTAttr();
  const ta = useQi<TargetAchievement>('target-achievement', 'target-achievement', { period });
  const dash = useQi<IndicatorDashboard>('indicator-dashboard', 'indicator-dashboard', { period });

  return (
    <div className="space-y-6">
      <TabShell q={ta}>{(d) => (
        <Section title={<><T k="목표 달성률" /> ({d.period})</>}>
          {/* 🔴 표본 창을 화면이 그대로 말한다 — 보드와 이 화면이 다른 답을 낼 때 원인은 '기간'이었다 */}
          <p className="text-xs text-gray-500 mb-4">{d.sampleWindowNote}</p>
          <div className="grid grid-cols-5 gap-4 mb-4">
            <Stat label={<T k="전체 지표" />} value={d.summary.total} />
            <Stat label={<T k="판정 완료" />} value={d.summary.judged} />
            <Stat label={<T k="달성" />} value={d.summary.achieved} />
            <Stat label={<T k="미달" />} value={d.summary.notAchieved} warn={d.summary.notAchieved > 0} />
            {/* 🔴 판정 지표가 없으면 0% 가 아니라 '산출 불가' */}
            <Stat label={<T k="종합 달성률" />} value={ratioText(d.summary.achieved, d.summary.judged, { decimals: 0 })} />
          </div>
          {d.summary.unmeasured > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">
              미측정 {d.summary.unmeasured}건은 <b>미달이 아니라 분모 밖</b>입니다{d.summary.undetermined > 0 ? ` · 판정 불가 ${d.summary.undetermined}건` : ''}.
            </p>
          )}
          {d.items.length === 0 ? <EmptyState icon="🎯" title="등재된 지표가 없습니다." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100 text-xs text-gray-500">
                  <th className="text-left py-2"><T k="지표" /></th><th className="text-right py-2"><T k="실적" /></th><th className="text-right py-2"><T k="목표" /></th><th className="text-right py-2"><T k="달성률" /></th><th className="text-center py-2"><T k="판정@지표" /></th>
                </tr></thead>
                <tbody>
                  {d.items.map((it, i) => (
                    <tr key={`${it.name}-${i}`} className="border-b border-gray-50">
                      <td className="py-2">{it.name}</td>
                      {/* 🔴 미측정은 0 이 아니라 '—' */}
                      <td className="py-2 text-right">{it.current == null ? <span className="text-gray-400"><T k="미측정" /></span> : <>{it.current}<Unit>{it.unit ?? ''}</Unit></>}</td>
                      <td className="py-2 text-right text-gray-500">{it.target}<Unit>{it.unit ?? ''}</Unit></td>
                      <td className="py-2 text-right">{it.achievementRate == null ? <span className="text-gray-400">—</span> : `${it.achievementRate}%`}</td>
                      <td className="py-2 text-center">
                        {it.achieved == null
                          ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"><T k="판정 불가" /></span>
                          : it.achieved
                            ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700"><T k="달성" /></span>
                            : <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700"><T k="미달" /></span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}</TabShell>

      <TabShell q={dash}>{(d) => (
        <Section title={<><T k="월별 지표 대시보드" /> ({d.period})</>}>
          <p className="text-xs text-gray-500 mb-4">{d.sampleWindowNote}</p>
          {!d.periodHasMeasurements && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">
              <T k="이 달의 측정이 없습니다 —" /> <b><T k="옛 값을 이번 달 실적으로 대체하지 않습니다" /></b>
              {d.latestAvailablePeriod ? ` (가장 최근 측정: ${d.latestAvailablePeriod})` : ''}.
            </p>
          )}
          {d.indicators.length === 0 ? <EmptyState icon="📈" title="등재된 지표가 없습니다." /> : (
            <div className="grid grid-cols-2 gap-4">
              {d.indicators.map((ind) => (
                <div key={ind.indicatorId} className="rounded-xl border border-gray-100 p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{ind.name}</p>
                      {ind.category && <p className="text-[11px] text-gray-400">{ind.category}</p>}
                    </div>
                    <p className={`text-xl font-bold ${ind.current == null ? 'text-gray-300' : ind.achieved === false ? 'text-rose-600' : 'text-gray-900'}`}>
                      {ind.current == null ? '—' : <>{ind.current}<Unit>{ind.unit ?? ''}</Unit></>}
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">
                    <T k="목표" /> {ind.target}{ind.unit ?? ''}
                    {/* 🔴 벤치마크는 출처가 등재돼야 숫자가 된다 — null 을 0 으로 그리지 않는다 */}
                    {' · '}<T k="전국 비교" /> {ind.benchmark == null ? <T k="미등재" /> : ind.benchmark}
                  </p>
                  {ind.current == null && ind.latestAvailablePeriod && (
                    <p className="mt-1 text-[11px] text-amber-700"><T k="이 달 미측정 — 마지막 측정" /> {ind.latestAvailablePeriod}: {ind.latestAvailableValue}</p>
                  )}
                  {ind.trend.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-gray-400"><T k="추이" /> {ind.trend.map(t => `${t.period.slice(5)} ${t.value}`).join(' → ')}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {!d.benchmarkAvailable && <p className="text-xs text-gray-400 mt-4">{d.benchmarkReason}</p>}
        </Section>
      )}</TabShell>
    </div>
  );
}

/* ─── 수술 안전 (IPSG.4) — 미이행 워크리스트 ───

   🔴 여기는 **알림이 아니라 목록**이다. 운영 알림 읽음률은 8.6%(348건 중 30건)라 건당 알림은
      소음이 되고 진짜 위급 알림까지 죽인다. 미이행 체크리스트는 초 단위 사건이 아니라 잔여
      작업이며, 잔여 작업의 정본 표현은 **줄어드는 목록**이다. 크론은 하루 1회 집계 1건만 상신한다.
   🔴 모든 수치는 **분모와 함께** 적는다 — "미이행 8건"은 전체가 8건인지 46건인지 말하지 못한다. */
interface SurgerySafetySummary {
  available: boolean;
  reason: string | null;
  period: { from: string; to: string };
  checklist: {
    denominator: number; complete: number; incomplete: number; noChecklistRow: number;
    byPhase: Array<{ phase: string; label: string; missing: number }>;
    compliancePct: number | null; basis: string;
  };
  siteVerification: {
    denominator: number; lateralityRequired: number; lateralityUndetermined: number;
    gaps: number; verifiedPct: number | null; basis: string;
  };
  count: { denominator: number; mismatchUnresolved: number };
  gateModes: { siteVerify: string; signOut: string; count: string };
  gateNote: string | null;
}
interface SurgerySafetyWorklist {
  period: { from: string; to: string };
  scanned: number;
  flagged: number;
  basis: string;
  items: Array<{
    surgeryId: string; procedureName: string; bodySite: string | null; laterality: string | null;
    lateralityRequired: boolean | null; status: string; scheduledAt: string;
    patient: { id: string; mrn: string; name: string } | null; surgeon: string | null;
    issues: Array<{ code: string; label: string; severity: string }>;
  }>;
}

const GATE_MODE_CLS: Record<string, string> = {
  OFF: 'bg-gray-100 text-gray-500', WARN: 'bg-amber-50 text-amber-700', BLOCK: 'bg-emerald-50 text-emerald-700',
};

function SurgerySafetyTab({ from, to }: { from: string; to: string }) {
  const tAttr = useTAttr();
  const sum = useQi<SurgerySafetySummary>('surgery-safety-summary', 'surgery-safety/summary', { from, to });
  const wl = useQi<SurgerySafetyWorklist>('surgery-safety-worklist', 'surgery-safety/worklist', { from, to, kind: 'ALL' });

  return (
    <div className="space-y-6">
      <TabShell q={sum}>{(d) => !d.available ? (
        <UnavailableNotice title={<T k="수술 안전(IPSG.4)" />} reason={d.reason ?? undefined} />
      ) : (
        <Section title={<><T k="수술 안전 체크리스트 이행" /> ({d.period.from} ~ {d.period.to})</>}>
          <div className="grid grid-cols-5 gap-4 mb-3">
            <Stat label={<T k="대상 수술(분모)" />} value={d.checklist.denominator} />
            <Stat label={<T k="3단계 완료" />} value={d.checklist.complete} />
            <Stat label={<T k="미이행" />} value={d.checklist.incomplete} warn={d.checklist.incomplete > 0} />
            <Stat label={<T k="기록 자체 없음" />} value={d.checklist.noChecklistRow} warn={d.checklist.noChecklistRow > 0} />
            {/* 🔴 대상이 0건이면 100% 가 아니라 '산출 불가' */}
            <Stat label={<T k="이행률" />} value={ratioText(d.checklist.complete, d.checklist.denominator, { decimals: 0 })} />
          </div>
          <p className="text-xs text-gray-500 mb-4">{d.checklist.basis}</p>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {d.checklist.byPhase.map(p => (
              <div key={p.phase} className="rounded-xl border border-gray-100 px-3 py-2">
                <p className="text-[11px] text-gray-500">{p.label}</p>
                <p className={`text-sm font-semibold ${p.missing > 0 ? 'text-rose-600' : 'text-gray-800'}`}><T k="미완료" /> {p.missing} / {d.checklist.denominator}</p>
              </div>
            ))}
          </div>

          <h4 className="text-sm font-semibold text-gray-800 mb-2"><T k="부위·좌우 확인(오부위수술 방지)" /></h4>
          <div className="grid grid-cols-5 gap-4 mb-3">
            <Stat label={<T k="예약 수술(분모)" />} value={d.siteVerification.denominator} />
            <Stat label={<T k="좌우 필요 술식" />} value={d.siteVerification.lateralityRequired} />
            <Stat label={<T k="좌우 미지정" />} value={d.siteVerification.gaps} warn={d.siteVerification.gaps > 0} />
            {/* 🔴 '판정 불가'를 '필요 없음'에 합치지 않는다 */}
            <Stat label={<T k="판정 불가" />} value={d.siteVerification.lateralityUndetermined} />
            {/* 분모는 BE 정의 그대로 = 좌우 구분 필요 술식(lateralityRequired) — 예약 수술 전체가 아니다 */}
            <Stat label={<T k="확인율" />} value={ratioText(d.siteVerification.lateralityRequired - d.siteVerification.gaps, d.siteVerification.lateralityRequired, { decimals: 0 })} />
          </div>
          <p className="text-xs text-gray-500 mb-4">{d.siteVerification.basis}</p>

          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-xs text-gray-500"><T k="게이트 모드:" /></span>
            {([['오부위 방지', d.gateModes.siteVerify], ['Sign-Out', d.gateModes.signOut], ['계수 대조', d.gateModes.count]] as const).map(([label, mode]) => (
              <span key={label} className={`text-[11px] px-2 py-0.5 rounded-full ${GATE_MODE_CLS[mode] ?? 'bg-gray-100 text-gray-500'}`}><T k={label} /> {mode}</span>
            ))}
          </div>
          {/* 🔴 게이트가 꺼져 있으면 '위반 0'이 준수라는 뜻이 아니다 — 화면이 그렇게 말해 준다 */}
          {d.gateNote && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{d.gateNote}</p>}
          {d.count.mismatchUnresolved > 0 && (
            <p className="mt-2 text-xs text-rose-700 bg-rose-50 rounded-lg px-3 py-2">
              <T k="기구·거즈 계수 불일치 미해소" /> {d.count.mismatchUnresolved}건 / <T k="대상@분모" /> {d.count.denominator}건 — <T k="잔류이물 위험" />
            </p>
          )}
        </Section>
      )}</TabShell>

      <TabShell q={wl}>{(d) => (
        <Section title={<T k="미이행 워크리스트" />}>
          <p className="text-xs text-gray-500 mb-3">{d.basis}</p>
          {d.items.length === 0 ? (
            d.scanned === 0
              // 🔴 대상이 0건인 것과 '전부 이행'은 다른 사실이다
              ? <EmptyState icon="🗓️" title="기간 내 대상 수술이 없습니다 — 미이행 여부 산출 불가." />
              : <EmptyState icon="✅" title={`대상 ${d.scanned}건 모두 이행 — 미이행 없음.`} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100 text-xs text-gray-500">
                  <th className="text-left py-2"><T k="예정일@수술" /></th><th className="text-left py-2"><T k="환자" /></th><th className="text-left py-2"><T k="술식" /></th>
                  <th className="text-left py-2"><T k="부위 / 좌우" /></th><th className="text-left py-2"><T k="미이행 항목" /></th>
                </tr></thead>
                <tbody>
                  {d.items.map(it => (
                    <tr key={it.surgeryId} className="border-b border-gray-50 align-top">
                      <td className="py-2 text-xs text-gray-500 whitespace-nowrap">{it.scheduledAt.slice(0, 10)}</td>
                      <td className="py-2 text-xs">{it.patient ? `${it.patient.name} (${it.patient.mrn})` : <span className="text-gray-300">—</span>}</td>
                      <td className="py-2">
                        <Link href={`/surgery/${it.surgeryId}`} className="text-blue-600 hover:underline">{it.procedureName}</Link>
                        <span className="ml-1 text-[11px] text-gray-400">{it.surgeon ?? ''}</span>
                      </td>
                      <td className="py-2 text-xs text-gray-600">
                        {it.bodySite ?? <span className="text-gray-300"><T k="미기재" /></span>}
                        {' / '}
                        {it.laterality ?? <span className="text-gray-300"><T k="미지정" /></span>}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {it.issues.map(is => (
                            <span key={is.code} className={`text-[10px] px-2 py-0.5 rounded-full ${is.severity === 'HIGH' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{is.label}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}</TabShell>
    </div>
  );
}

/* ─── 인증 체크리스트 ─── */
interface Accreditation {
  available: boolean;
  reason?: string;
  items: Array<{ id: string; standard: string; chapter?: string | null; name: string; status: string; evidence?: string | null; evidenceSource?: { label: string; link: string; source: string } | null; lastReviewed?: string | null }>;
  summary: { total: number; compliant: number; partial: number; nonCompliant: number; pending: number };
  complianceRate: number | null;
  complianceRateBasis: string;
  catalog?: Array<{ id: string; standard: string; chapter: string; name: string }>;
  /** 카탈로그엔 있는데 등재되지 않은 기준 — 적합률 분모 밖이다 */
  unregisteredCatalog?: Array<{ id: string; standard: string; chapter: string; name: string }>;
  unregisteredNote?: string | null;
}

const ACC_STATUS: Record<string, { label: string; cls: string }> = {
  COMPLIANT: { label: '적합@인증', cls: 'bg-emerald-50 text-emerald-700' },
  PARTIAL: { label: '부분 적합', cls: 'bg-amber-50 text-amber-700' },
  NON_COMPLIANT: { label: '부적합@인증', cls: 'bg-rose-50 text-rose-700' },
  PENDING: { label: '미작성', cls: 'bg-gray-100 text-gray-500' },
};

/**
 * 🔴 2026-10-08 QI 흐름 — 인증 자체 평가의 정본은 새 원장(기준·평가 이력·자가/확인 구분 · `quality-flow/accreditation`)이다.
 *    아래 체크리스트(8항목 · 덮어쓰기 · 이력 없음)는 지우지 않고 이전 방식이라고 밝힌다(정본이 둘이면 갈라진다 — 새 기록은 위에 남긴다).
 */
function AccreditationTab() {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" data-admin-qi-accreditation-ledger>
        <p className="mb-2 text-sm font-bold text-gray-900"><T k="인증 자체 평가(기준·평가 이력)" /></p>
        <AccreditationSection />
      </section>
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800" data-admin-qi-legacy-checklist>
        <T k="아래는 이전 체크리스트입니다 — 판정을 덮어써 이력이 남지 않습니다. 새 평가는 위 인증 자체 평가에 기록하십시오." />
      </p>
      <LegacyAccreditationChecklist />
    </div>
  );
}

function LegacyAccreditationChecklist() {
  const q = useQi<Accreditation>('accreditation', 'accreditation');
  const tAttr = useTAttr();
  return (
    <TabShell q={q}>{(d) => !d.available ? (
      <UnavailableNotice
        title={<T k="인증 체크리스트" />}
        reason={d.reason}
        extra={d.catalog && d.catalog.length > 0 ? (
          <div className="mt-4">
            {/* 🔴 이건 '현황'이 아니라 등재할 때 참조하는 **목록**이다 — 판정처럼 보이지 않게 적는다 */}
            <p className="text-[11px] font-medium text-gray-500 mb-1.5"><T k="등재 시 참조할 기준 항목(판정 아님)" /></p>
            <ul className="text-[11px] text-gray-500 space-y-0.5">
              {d.catalog.map(c => <li key={c.id}>· {c.standard} {c.chapter} — {c.name}</li>)}
            </ul>
          </div>
        ) : undefined}
      />
    ) : (
      <Section title={<T k="JCI / KoHIAS 인증 체크리스트" />}>
        <div className="grid grid-cols-5 gap-4 mb-4">
          <Stat label={<T k="전체" />} value={d.summary.total} />
          <Stat label={<T k="적합@인증" />} value={d.summary.compliant} />
          <Stat label={<T k="부분 적합" />} value={d.summary.partial} />
          <Stat label={<T k="부적합@인증" />} value={d.summary.nonCompliant} warn={d.summary.nonCompliant > 0} />
          {/* 🔴 판정 완료가 없으면 0% 가 아니라 '산출 불가' · 미작성은 분모에서 뺀다 */}
          <Stat label={<T k="적합률" />} value={ratioText(d.summary.compliant, d.summary.compliant + d.summary.partial + d.summary.nonCompliant, { decimals: 0 })} />
        </div>
        <p className="text-xs text-gray-500 mb-4">{d.complianceRateBasis}</p>
        {/* 🔴 등재된 것만 초록으로 보여주면 **빠진 기준**이 안 보인다(IPSG.4 가 통째로 없었다) */}
        {d.unregisteredCatalog && d.unregisteredCatalog.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-xs font-medium text-amber-800"><T k="미등재 기준 항목" /> {d.unregisteredCatalog.length}건 — <T k="위 적합률 분모 밖" /></p>
            <ul className="mt-1 text-[11px] text-amber-700 space-y-0.5">
              {d.unregisteredCatalog.map(c => <li key={c.id}>· {c.standard} {c.chapter} — {c.name}</li>)}
            </ul>
            {d.unregisteredNote && <p className="mt-1.5 text-[11px] text-amber-600">{d.unregisteredNote}</p>}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-500">
              {/* 🔴 인증 '기준'(JCI 3장 …) 열이다 — 무문맥 '기준' 은 시점 접두어(As of)라 문맥 키를 쓴다 */}
              <th className="text-left py-2"><T k="기준@인증" /></th><th className="text-left py-2"><T k="항목" /></th><th className="text-center py-2"><T k="판정@지표" /></th><th className="text-left py-2"><T k="근거" /></th><th className="text-left py-2"><T k="검토일" /></th>
            </tr></thead>
            <tbody>
              {d.items.map((it) => {
                const s = ACC_STATUS[it.status] ?? { label: it.status, cls: 'bg-gray-100 text-gray-500' };
                return (
                  <tr key={it.id} className="border-b border-gray-50">
                    <td className="py-2 text-xs text-gray-500">{it.standard} {it.chapter}</td>
                    <td className="py-2">{it.name}</td>
                    <td className="py-2 text-center"><span className={`text-[10px] px-2 py-0.5 rounded-full ${s.cls}`}><T k={s.label} /></span></td>
                    {/* 🔴 근거가 없으면 '미작성' — 빈칸이 '문제 없음'으로 읽히지 않게. 실측 근거 원천(B3)은 링크로 병기(자동 판정 아님) */}
                    <td className="py-2 text-xs text-gray-600">
                      {it.evidence ?? <span className="text-gray-300"><T k="미작성" /></span>}
                      {it.evidenceSource && (
                        <a href={it.evidenceSource.link} className="mt-0.5 block text-[11px] text-blue-600 hover:underline">
                          📊 {it.evidenceSource.label} →
                        </a>
                      )}
                    </td>
                    <td className="py-2 text-xs text-gray-400">{it.lastReviewed?.slice(0, 10) ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    )}</TabShell>
  );
}

/* ─── 재입원율 ─── */
interface Readmission {
  period: string; totalDischarges: number; readmissions: number;
  rate: number | null; target: number | null; targetSource?: string | null; achievement: 'ACHIEVED' | 'NOT_ACHIEVED' | null;
  byDepartment: Array<{ department: string; discharges: number; readmissions: number; rate: number | null }>;
  byDepartmentBasis?: string;
}

function ReadmissionTab({ period }: { period: string }) {
  const tAttr = useTAttr();
  const q = useQi<Readmission>('readmission-rate', 'readmission-rate', { period });
  return (
    <TabShell q={q}>{(d) => (
      <Section title={<><T k="30일 재입원율" /> ({d.period})</>}>
        <div className="grid grid-cols-4 gap-4">
          <Stat label={<T k="퇴원 건수(분모)" />} value={d.totalDischarges} />
          <Stat label={<T k="30일 내 재입원" />} value={d.readmissions} />
          {/* 🔴 퇴원이 0건이면 재입원율은 0% 가 아니라 '산출 불가' */}
          <Stat label={<T k="재입원율" />} value={<Ratio numerator={d.readmissions} denominator={d.totalDischarges} unavailableHint="이 달 퇴원 0건" />} warn={d.achievement === 'NOT_ACHIEVED'} />
          {/* 🔴 표본이 없는 달을 '달성'이라 적지 않는다 */}
          <Stat
            label={d.target == null ? <><T k="목표" />(<T k="질 지표 원장에 미등록" />)</> : <><T k="목표" />({d.target}% <T k="이하" />)</>}
            value={d.achievement == null ? <T k="판정 불가" /> : d.achievement === 'ACHIEVED' ? <T k="달성" /> : <T k="미달" />}
            warn={d.achievement === 'NOT_ACHIEVED'}
          />
        </div>
        {d.totalDischarges === 0 && (
          <p className="mt-3 text-xs text-gray-500"><T k="이 달 퇴원 건이 없어 분모가 없습니다 — 0% 가 아니라 산출할 수 없는 것입니다." /></p>
        )}
        {d.byDepartment.length > 0 ? (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-800"><T k="부서별 분해" /></h4>
              {d.byDepartmentBasis && <span className="text-[11px] text-gray-400">{d.byDepartmentBasis}</span>}
            </div>
            <table className="mt-2 w-full text-sm">
              <thead><tr className="border-b border-gray-100 text-xs text-gray-500">
                <th className="text-left py-1.5"><T k="진료과" /></th><th className="text-right py-1.5"><T k="퇴원(분모)" /></th><th className="text-right py-1.5"><T k="재입원(분자)" /></th><th className="text-right py-1.5"><T k="재입원율" /></th>
              </tr></thead>
              <tbody>
                {d.byDepartment.map((dep) => (
                  <tr key={dep.department} className="border-b border-gray-50">
                    <td className="py-1.5">{dep.department}</td>
                    <td className="py-1.5 text-right text-gray-500">{dep.discharges}</td>
                    <td className="py-1.5 text-right text-gray-500">{dep.readmissions}</td>
                    <td className={`py-1.5 text-right font-medium ${dep.rate != null && d.target != null && dep.rate > d.target ? 'text-red-600' : 'text-gray-700'}`}>
                      {/* 🔴 산출 불가 문구는 정본 <Ratio> 가 만든다(자체 구현 금지·분자/분모만 넘긴다) */}
                      <Ratio numerator={dep.readmissions} denominator={dep.discharges} unavailableHint="퇴원 0건" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          d.totalDischarges > 0 && <p className="mt-3 text-xs text-gray-400"><T k="부서별 분해: 주치의 진료과 미기재로 분해 불가" /></p>
        )}
      </Section>
    )}</TabShell>
  );
}

/* ─── 환자안전지표(PSI) + 표준화 사망비(HSMR) ─── */
interface Psi { available: boolean; reason?: string; calculatedAt?: string; indicators: unknown[]; baseCounts?: { admissions: number; surgeries: number } }
interface Hsmr { period: string; available: boolean; reason?: string; totalAdmissions: number; observedDeaths: number | null; expectedDeaths: number | null; hsmr: number | null; interpretation: string | null }

function SafetyTab({ period }: { period: string }) {
  const tAttr = useTAttr();
  const psi = useQi<Psi>('psi', 'psi');
  const hsmr = useQi<Hsmr>('hsmr', 'hsmr', { period });

  return (
    <div className="space-y-6">
      <TabShell q={psi}>{(d) => !d.available ? (
        <UnavailableNotice
          title={<T k="환자안전지표 (PSI)" />}
          reason={d.reason}
          extra={d.baseCounts ? (
            <p className="mt-3 text-[11px] text-gray-500">
              {/* 실집계인 기초 건수만 — 이건 PSI 가 아니라 분모 후보다 */}
              <T k="실집계 기초: 입원" /> {d.baseCounts.admissions}건 · <T k="수술" /> {d.baseCounts.surgeries}건 (<T k="PSI 값 아님" />)
            </p>
          ) : undefined}
        />
      ) : (
        <Section title={<T k="환자안전지표 (PSI)" />}><EmptyState icon="🛡" title="지표 목록이 비어 있습니다." /></Section>
      )}</TabShell>

      <TabShell q={hsmr}>{(d) => !d.available ? (
        <UnavailableNotice
          title={<><T k="표준화 사망비" /> (HSMR · {d.period})</>}
          reason={d.reason}
          extra={<p className="mt-3 text-[11px] text-gray-500"><T k="실집계 기초: 이 달 입원" /> {d.totalAdmissions}건 (<T k="관찰·기대 사망은 원천 부재" />)</p>}
        />
      ) : (
        <Section title={<><T k="표준화 사망비" /> (HSMR · {d.period})</>}>
          <div className="grid grid-cols-4 gap-4">
            <Stat label={<T k="입원" />} value={d.totalAdmissions} />
            <Stat label={<T k="관찰 사망" />} value={d.observedDeaths ?? '—'} />
            <Stat label={<T k="기대 사망" />} value={d.expectedDeaths ?? '—'} />
            <Stat label="HSMR" value={d.hsmr ?? <T k="산출 불가" />} />
          </div>
          {d.interpretation && <p className="text-xs text-gray-500 mt-3">{d.interpretation}</p>}
        </Section>
      )}</TabShell>
    </div>
  );
}

/* ─── HIRA 적정성 평가 + 전국 벤치마크 ─── */
/** 2026-10-09 — 등재된 '적정성 평가' 분류 질 지표의 최신 정본 측정(출처 함께 · 외부 통보 결과는 EXTERNAL) */
interface AdequacyRow { indicatorId: string; name: string; unit: string | null; period: string | null; value: number | null; source: string | null; target: number; achieved: boolean | null }
interface Adequacy { available: boolean; reason?: string; indicators: AdequacyRow[]; totalCount: number }
interface Benchmark { available: boolean; reason?: string; benchmarks: unknown[]; comparedAt?: string }

function BenchmarkTab() {
  const adq = useQi<Adequacy>('adequacy', 'adequacy');
  const bm = useQi<Benchmark>('benchmark', 'benchmark');

  return (
    <div className="space-y-6">
      <TabShell q={adq}>{(d) => !d.available
        ? <UnavailableNotice title={<T k="HIRA 적정성 평가" />} reason={d.reason} />
        : (
          <Section title={<T k="HIRA 적정성 평가" />}>
            <p className="mb-2 text-[11px] text-gray-500"><T k="질 지표 원장에서 '적정성 평가' 분류로 등재한 지표입니다 — 값은 산출이 아니라 기록된 측정(외부 통보 결과는 출처 '외부 결과')입니다." /></p>
            <table className="w-full text-xs" data-qi-adequacy>
              <thead><tr className="text-left text-gray-500"><th className="py-1"><T k="지표명" /></th><th><T k="기간" /></th><th><T k="값" /></th><th><T k="출처" /></th><th><T k="판정" /></th></tr></thead>
              <tbody>
                {d.indicators.map((r) => (
                  <tr key={r.indicatorId} className="border-t border-gray-100" data-qi-adequacy-row={r.source ?? 'NONE'}>
                    <td className="py-1">{r.name}</td>
                    <td>{r.period ?? '—'}</td>
                    <td className="tabular-nums">{r.value == null ? <span className="text-gray-400"><T k="미측정" /></span> : `${formatNum(r.value, 'qiValue')}${r.unit ? ` ${r.unit}` : ''}`}</td>
                    <td>{r.source ? <T k={QI_MEASUREMENT_SOURCE_LABEL[r.source as keyof typeof QI_MEASUREMENT_SOURCE_LABEL] ?? r.source} /> : '—'}</td>
                    <td>{r.value == null ? '—' : r.achieved == null ? <T k="판정 불가" /> : <T k={r.achieved ? '달성' : '미달'} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
      </TabShell>
      <TabShell q={bm}>{(d) => !d.available
        ? <UnavailableNotice title={<T k="전국 벤치마크 비교" />} reason={d.reason} />
        : <Section title={<T k="전국 벤치마크 비교" />}><p className="text-sm text-gray-600"><T k="등재 비교" /> {d.benchmarks.length}건</p></Section>}
      </TabShell>
    </div>
  );
}

export default function QiDashboardPage() {
  const fmtDur = useDurationText();
  const tAttr = useTAttr();
  const now = new Date();
  const [tab, setTab] = useState<QiTab>('metrics');
  const [from, setFrom] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
  const [to, setTo] = useState(now.toISOString().split('T')[0]);
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['qi-metrics', from, to],
    queryFn: () => apiClient.get<{ data: QiMetrics }>('/api/v1/qi/metrics', { from, to }),
    enabled: !!from && !!to && tab === 'metrics',
  });

  const m = data?.data;

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="질관리 지표 (QI)" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="병원 운영 핵심 지표를 모니터링합니다." /></p>
        </div>
        {tab === 'metrics' || tab === 'surgery' ? (
          <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm" />
            <span className="text-gray-400">~</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm" />
          </div>
        ) : tab === 'accreditation' || tab === 'benchmark' ? null : (
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm" />
        )}
      </div>

      {/* 탭 — 새 화면을 만들지 않고 미배선 EP 8종을 이 화면으로 들인다 */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {QI_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.key ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <T k={t.label} />
          </button>
        ))}
      </div>

      {tab === 'targets' && <TargetsTab period={period} />}
      {tab === 'accreditation' && <AccreditationTab />}
      {tab === 'surgery' && <SurgerySafetyTab from={from} to={to} />}
      {tab === 'readmission' && <ReadmissionTab period={period} />}
      {tab === 'safety' && <SafetyTab period={period} />}
      {tab === 'benchmark' && <BenchmarkTab />}

      {tab === 'metrics' && (isLoading ? (
        <div className="grid grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-32 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : !m ? (
        <EmptyState icon="📊" title="데이터가 없습니다." />
      ) : (
        <div className="space-y-6">
          {/* 요약 카드 */}
          <div className="grid grid-cols-4 gap-4">
            <MetricCard title={<T k="외래" />} value={`${m.outpatient?.totalVisits ?? 0}건`} sub={`평균 대기 ${orDash(m.outpatient?.avgWaitMinutes, fmtDur)}`} color="blue" />
            {/* 🔴 (2026-09-16 J3) 서버가 표본 0 이면 null(산출 불가) 을 보낸다 — 같은 화면의 정본 `orDash` 로 그린다(`?? 0` 은 '평균 체류 0분'이라는 실적이 된다) */}
            <MetricCard title={<T k="응급실" />} value={`${m.emergency?.totalVisits ?? 0}건`} sub={`평균 체류 ${orDash(m.emergency?.avgStayHours, (h) => fmtDur(Math.round(h * 60), '0분'))}`} color="red" />
            <MetricCard title={<T k="입원" />} value={`${m.inpatient?.totalAdmissions ?? 0}건`} sub={`평균 재원 ${orDash(m.inpatient?.avgLengthOfStay, (d) => `${d}일`)}`} color="indigo" />
            <MetricCard title={<T k="수술" />} value={`${m.surgery?.totalSurgeries ?? 0}건`} sub={`평균 ${orDash(m.surgery?.avgOpTimeMinutes, fmtDur)}`} color="emerald" />
          </div>

          {/* 경고 */}
          {(() => {
            const alerts: { metric: string; value: number; threshold: number }[] = [];
            // 🔴 산출 불가(null)는 "기준 이내"가 아니다 — 경고를 만들지도, 안심시키지도 않는다(W8 Q3).
            const w30 = m.outpatient?.waitOver30MinRate;
            if (w30 != null && w30 > 10) alerts.push({ metric: '30분 초과 대기율', value: w30, threshold: 10 });
            if ((m.emergency?.stayOver6HoursRate ?? 0) > 10) alerts.push({ metric: 'ER 6시간 초과 체류율', value: m.emergency?.stayOver6HoursRate ?? 0, threshold: 10 });
            if ((m.inpatient?.readmissionRate ?? 0) > 5) alerts.push({ metric: '30일 재입원율', value: m.inpatient?.readmissionRate ?? 0, threshold: 5 });
            if ((m.surgery?.cancellationRate ?? 0) > 5) alerts.push({ metric: '수술 취소율', value: m.surgery?.cancellationRate ?? 0, threshold: 5 });
            if (alerts.length === 0) return null;
            return (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <h3 className="text-sm font-bold text-red-800 mb-2"><T k="기준 초과 항목" /></h3>
                {alerts.map((a, i) => (
                  <p key={i} className="text-sm text-red-700"><T k={a.metric} />: <span className="font-bold">{a.value}<Unit>%</Unit></span> (<T k="기준:" /> {a.threshold}<Unit>%</Unit>)</p>
                ))}
              </div>
            );
          })()}

          {/* 외래 */}
          <Section title={<T k="외래 진료" />}>
            <div className="grid grid-cols-4 gap-4">
              <Stat label={<T k="총 접수" />} value={m.outpatient?.totalVisits} />
              <Stat label={<T k="평균 대기" />} value={orDash(m.outpatient?.avgWaitMinutes, fmtDur)} warn={(m.outpatient?.avgWaitMinutes ?? 0) > 30} />
              <Stat label={<T k="최대 대기" />} value={orDash(m.outpatient?.maxWaitMinutes, fmtDur)} />
              {/* 🔴 분모를 함께 보여준다 — 종전엔 분자(startedAt 보유)와 분모(접수 전량)가 달라
                  1/672=0.1% 로 77배 축소됐고, 임계 10% 에 구조적으로 도달할 수 없었다(W8 Q3). */}
              <Stat
                label={<T k="30분 초과" />}
                value={<Ratio
                  numerator={m.outpatient?.waitOver30Min}
                  denominator={m.outpatient?.waitSampleN}
                  unavailableHint="대기 시각이 측정된 건 없음"
                />}
                warn={m.outpatient?.waitOver30MinRate != null && m.outpatient.waitOver30MinRate > 10}
              />
              {/* 🔴 서버가 서명 건수(분자)를 함께 준다 — 90% 가 10건 중 9건인지 1,000건 중 900건인지 화면이 말한다 */}
              <Stat label={<T k="진료 서명률" />} value={<Ratio numerator={m.outpatient?.encounterSignNumerator} denominator={m.outpatient?.encounterSignDenominator ?? m.outpatient?.encounterN} unavailableHint="기간 내 진료 없음" />} warn={m.outpatient?.encounterSignRate != null && m.outpatient.encounterSignRate < 90} />
            </div>
            {m.outpatient?.waitBasis && (
              <p className="text-xs text-gray-400 mt-3"><T k="대기 지표 근거:" /> {m.outpatient.waitBasis}</p>
            )}
          </Section>

          {/* 응급실 */}
          <Section title={<T k="응급실" />}>
            <div className="grid grid-cols-4 gap-4">
              <Stat label={<T k="총 방문" />} value={m.emergency?.totalVisits} />
              <Stat label={<T k="평균 체류" />} value={orDash(m.emergency?.avgStayHours, (h) => fmtDur(Math.round(h * 60), '0분'))} warn={m.emergency?.avgStayHours != null && m.emergency.avgStayHours > 4} />
              {/* 🔴 방문 0건이면 '6h 초과 0건(0%)'은 "체류 문제 없음"으로 읽힌다 — 분모와 함께 낸다 */}
              <Stat label={<T k="6h 초과" />} value={<Ratio numerator={m.emergency?.stayOver6Hours} denominator={m.emergency?.totalVisits} unavailableHint="기간 내 응급 방문 없음" />} warn={m.emergency?.stayOver6HoursRate != null && m.emergency.stayOver6HoursRate > 10} />
              <Stat label="Door-to-Doctor" value={orDash(m.emergency?.doorToDoctor, (n) => fmtDur(n))} warn={m.emergency?.doorToDoctor != null && m.emergency.doorToDoctor > 15} />
              {/* 🔴 서버가 입원 전환 건수(분자)를 함께 준다(2026-08-20) — 분모 없는 퍼센트를 끝냈다 */}
              <Stat label={<T k="입원 전환@지표" />} value={<Ratio numerator={m.emergency?.admissionNumerator} denominator={m.emergency?.admissionDenominator} unavailableHint="기간 내 응급 방문 없음" />} />
            </div>
            {m.emergency?.ktasDistribution && (
              <div className="mt-3">
                <p className="text-xs text-gray-500 mb-1"><T k="KTAS 분포" /></p>
                <div className="flex gap-2">
                  {Object.entries(m.emergency.ktasDistribution).map(([k, v]) => (
                    <span key={k} className="text-xs bg-gray-100 px-2 py-1 rounded">{k}: {v as number}<Unit>건</Unit></span>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* 입원 */}
          <Section title={<T k="입원" />}>
            <div className="grid grid-cols-4 gap-4">
              <Stat label={<T k="총 입원" />} value={m.inpatient?.totalAdmissions} />
              <Stat label={<T k="평균 재원" />} value={`${m.inpatient?.avgLengthOfStay}일`} />
              <Stat label={<T k="장기 재원 (14일+)" />} value={`${m.inpatient?.longStay}건`} />
              {/* 🔴 재입원율의 분모는 **퇴원 건**이다(입원 전량이 아니다) — 서버가 내는 분모를 그대로 쓴다.
                  종전 화면은 totalAdmissions 로 나눠 같은 사실에 정본이 둘이었다(P12). */}
              <Stat label={<T k="30일 재입원" />} value={<Ratio numerator={m.inpatient?.readmissionNumerator ?? m.inpatient?.readmission30Days} denominator={m.inpatient?.readmissionDenominator} unavailableHint="기간 내 퇴원 없음" />} warn={m.inpatient?.readmissionRate != null && m.inpatient.readmissionRate > 5} />
              {/* 🔴 서버가 재원 병상(분자)·등록 병상(분모)을 함께 준다(2026-08-20) */}
              <Stat label={<T k="병상 가동(재원/등록)" />} value={<Ratio numerator={m.inpatient?.bedOccupancyNumerator} denominator={m.inpatient?.bedOccupancyDenominator} unavailableHint="등록 병상 0" />} />
            </div>
          </Section>

          {/* 수술 */}
          <Section title={<T k="수술" />}>
            <div className="grid grid-cols-4 gap-4">
              <Stat label={<T k="총 수술" />} value={m.surgery?.totalSurgeries} />
              <Stat label={<T k="평균 시간" />} value={fmtDur(m.surgery?.avgOpTimeMinutes)} />
              {/* 🔴 수술 0건이면 취소율은 0%(=안전)가 아니라 산출 불가다 — 분모와 함께 낸다 */}
              <Stat label={<T k="취소" />} value={<Ratio numerator={m.surgery?.cancelledSurgeries} denominator={m.surgery?.totalSurgeries} unavailableHint="기간 내 수술 없음" />} warn={m.surgery?.cancellationRate != null && m.surgery.cancellationRate > 5} />
            </div>
          </Section>

          {/* 안전 */}
          <Section title={<T k="처방 안전" />}>
            <div className="grid grid-cols-4 gap-4">
              <Stat label={<T k="총 처방" />} value={m.safety?.totalPrescriptions} />
              {/* 🔴 'DUR 검사'와 'DUR 경고'는 다른 사실이다 — 종전엔 검사 건수를 경고 건수로 표시했다(W8 Q2) */}
              <Stat label={<T k="DUR 검사" />} value={`${m.safety?.durChecked ?? 0}건`} />
              <Stat label={<T k="DUR 경고" />} value={`${m.safety?.durAlerts ?? 0}건`} />
              <Stat label={<T k="DUR 무시" />} value={`${m.safety?.durOverridden ?? 0}건`} warn={(m.safety?.durOverridden ?? 0) > 0} />
              <Stat label={<T k="STAT 오더" />} value={`${m.safety?.statOrders ?? 0}건`} />
            </div>
            {m.safety?.durAlertsBasis && <p className="text-xs text-gray-400 mt-3">{m.safety.durAlertsBasis}</p>}
          </Section>
        </div>
      ))}
    </div>
  );
}

function MetricCard({ title, value, sub, color }: { title: React.ReactNode; value: string; sub: string; color: string }) {
  const colors: Record<string, string> = { blue: 'text-blue-600', red: 'text-red-600', indigo: 'text-indigo-600', emerald: 'text-emerald-600' };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-xs text-gray-500 mb-1">{title}</p>
      <p className={`text-2xl font-bold ${colors[color] ?? 'text-gray-900'}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-1">{sub}</p>
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Stat({ label, value, warn }: { label: React.ReactNode; value: React.ReactNode; warn?: boolean }) {
  return (
    /* 🔴 이 화면의 6개 그리드가 이 하나를 쓴다 — 여기 한 곳이 전역 규칙이다.
       값이 `<Ratio>` 라 길어질 수 있어 한 줄 고정하고, 늘어난 카드는 수직 중앙 정렬. */
    <div className="flex flex-col justify-center">
      <p className="text-xs leading-tight text-gray-500">{label}</p>
      <p className={`overflow-x-auto whitespace-nowrap text-lg font-bold ${warn ? 'text-red-600' : 'text-gray-900'}`}>{value ?? '—'}</p>
    </div>
  );
}
