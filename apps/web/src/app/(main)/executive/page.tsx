'use client';

import { useState, useCallback, useMemo } from 'react';
import { Ratio, Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import Link from 'next/link';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 경영 대시보드 — 🔴 W7 규약: **표본이 없으면 0% 도 100% 도 아니라 '산출 불가'** 다.
 * 서버가 `{ value, n }`(표본 수 동반)·`rate: number|null`·`unpaid.scope` 를 보내므로
 * 화면은 그것을 **그대로** 말한다. 여기서 null 을 0 으로 접지 않는다.
 */

/** 표본 수를 동반하는 값 — n=0 이면 value 는 null(산출 불가) */
/** 🔴 `n` 은 **표본 수이지 분자가 아니다** — 비율 지표는 서버가 numerator/denominator 를 함께 낸다(2026-08-20) */
interface Metric { value: number | null; n: number; numerator?: number; denominator?: number }
interface RevenueDay { date: string; revenue: number; count?: number }
interface RevenueMonth { month: string; revenue: number; encounters: number }
interface DeptStat { department: string; encounters: number; revenue: number }
interface StaffCategory { category: string; label?: string; count: number }
/** 🔴 종전 타입은 target/actual 을 number 로 선언했으나 서버는 문자열('150명')을 보낸다 */
interface KpiItem { name: string; target: string; actual: string; rate: number | null; n?: number; note?: string }
interface ExecAlert { type?: string; severity: string; message: string; href?: string; count?: number }
interface ClaimsSummary {
  count?: number; draft: number; submitted: number; approved: number;
  totalClaimed: number; reductionRate: string | null; note?: string;
}
interface Overview {
  asOf?: string;
  revenue?: { accrued: Metric; collected: Metric; basis?: string };
  todayRevenue: number;
  revenueChange: number | null;
  revenueChangeMetric?: Metric;
  unpaid?: { amount: number; count: number; scope?: string; basis?: string };
  unpaidAmount: number;
  unpaidCount: number;
  todayPatients: number;
  patientChange: number | null;
  patientChangeMetric?: Metric;
  bedOccupancyPct?: Metric;
  bedOccupancy: number | null;
  totalBeds: number;
  occupiedBeds: number;
  icuTotal: number;
  icuOccupied: number;
  inpatients: number;
}

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

/** `YYYY-MM-DD`(서버 localDateKey=KST 달력) → 로컬 Date. `new Date('YYYY-MM-DD')` 는 UTC 자정이라 밀린다. */
function parseDayKey(key: string): Date {
  const [y, m, d] = String(key).split('-').map(Number);
  return Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d) ? new Date(y, m - 1, d) : new Date(key);
}

function formatKrw(n: number) {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString()}만`;
  return n.toLocaleString();
}

const EXEC_SECTIONS = [
  { id: 'kpi-cards', label: 'KPI 요약 카드' },
  { id: 'charts', label: '매출/진료 차트' },
  { id: 'departments', label: '부서별 실적' },
  { id: 'staff', label: '인력 현황' },
  { id: 'claims', label: '보험 청구 현황' },
  { id: 'alerts', label: '경영 알림' },
  { id: 'kpi-table', label: 'KPI 지표' },
] as const;

const EXEC_STORAGE_KEY = 'exec-dashboard-config';

function loadExecConfig(): { hidden: string[] } {
  if (typeof window === 'undefined') return { hidden: [] };
  try {
    const saved = localStorage.getItem(EXEC_STORAGE_KEY);
    return saved ? JSON.parse(saved) : { hidden: [] };
  } catch { return { hidden: [] }; }
}

export default function ExecutiveDashboardPage() {
  const tAttr = useTAttr();
  const { user } = useAuthStore();
  const today = new Date();
  const greeting = today.getHours() < 12 ? '좋은 아침입니다' : today.getHours() < 18 ? '좋은 오후입니다' : '좋은 저녁입니다';

  const [isEditing, setIsEditing] = useState(false);
  const [hiddenSections, setHiddenSections] = useState<string[]>(() => loadExecConfig().hidden);

  const toggleSection = useCallback((id: string) => {
    setHiddenSections((prev) => {
      const next = prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      if (typeof window !== 'undefined') localStorage.setItem(EXEC_STORAGE_KEY, JSON.stringify({ hidden: next }));
      return next;
    });
  }, []);

  const resetSections = useCallback(() => {
    setHiddenSections([]);
    if (typeof window !== 'undefined') localStorage.removeItem(EXEC_STORAGE_KEY);
  }, []);

  const show = useCallback((id: string) => !hiddenSections.includes(id), [hiddenSections]);

  const { data: overview, isError, error, refetch } = useQuery({
    queryKey: ['exec-overview'],
    queryFn: () => apiClient.get<{ data: Overview }>('/api/v1/executive/overview'),
    refetchInterval: pollMs('slow'),
  });
  const { data: weeklyRev } = useQuery({
    queryKey: ['exec-weekly-revenue'],
    queryFn: () => apiClient.get<{ data: RevenueDay[] }>('/api/v1/executive/revenue/weekly'),
  });
  const { data: monthlyTrend } = useQuery({
    queryKey: ['exec-monthly-trend'],
    queryFn: () => apiClient.get<{ data: RevenueMonth[] }>('/api/v1/executive/revenue/monthly'),
  });
  const { data: deptStats } = useQuery({
    queryKey: ['exec-departments'],
    queryFn: () => apiClient.get<{ data: DeptStat[] }>('/api/v1/executive/departments'),
  });
  const { data: staffData } = useQuery({
    queryKey: ['exec-staff'],
    queryFn: () => apiClient.get<{ data: { total: number; categories: StaffCategory[] } }>('/api/v1/executive/staff-summary'),
  });
  const { data: kpiData } = useQuery({
    queryKey: ['exec-kpi'],
    queryFn: () => apiClient.get<{ data: KpiItem[] }>('/api/v1/executive/kpi'),
  });
  const { data: claimsData } = useQuery({
    queryKey: ['exec-claims'],
    queryFn: () => apiClient.get<{ data: ClaimsSummary }>('/api/v1/executive/claims'),
  });
  const { data: alertsData } = useQuery({
    queryKey: ['exec-alerts'],
    queryFn: () => apiClient.get<{ data: ExecAlert[] }>('/api/v1/executive/alerts'),
  });

  const ov = overview?.data;
  const _weeklyRaw = weeklyRev?.data;
  const weekly: RevenueDay[] = Array.isArray(_weeklyRaw) ? _weeklyRaw : (_weeklyRaw as Record<string, unknown> | undefined)?.data as RevenueDay[] ?? [];
  const _monthlyRaw = monthlyTrend?.data;
  const monthly: RevenueMonth[] = Array.isArray(_monthlyRaw) ? _monthlyRaw : (_monthlyRaw as Record<string, unknown> | undefined)?.data as RevenueMonth[] ?? [];
  const _deptRaw = deptStats?.data;
  const departments: DeptStat[] = Array.isArray(_deptRaw) ? _deptRaw : (_deptRaw as Record<string, unknown> | undefined)?.data as DeptStat[] ?? [];
  const staff = staffData?.data;
  const _kpisRaw = kpiData?.data;
  const kpis: KpiItem[] = Array.isArray(_kpisRaw) ? _kpisRaw : (_kpisRaw as Record<string, unknown> | undefined)?.data as KpiItem[] ?? [];
  const claims = claimsData?.data;
  const _alertsRaw = alertsData?.data;
  const alerts: ExecAlert[] = Array.isArray(_alertsRaw) ? _alertsRaw : (_alertsRaw as Record<string, unknown> | undefined)?.data as ExecAlert[] ?? [];

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const maxWeeklyRev = Math.max(...weekly.map((d: RevenueDay) => d.revenue), 1);
  const maxMonthlyEnc = Math.max(...monthly.map((m: RevenueMonth) => m.encounters), 1);

  // 🔴 종전 로컬 CATEGORY_LABEL(DOCTOR·NURSE·…)은 DB enum(MEDICAL·TECHNICAL·ADMIN·SUPPORT)과
  //    교집합이 0 이라 화면에 영문 원문이 그대로 찍혔다 → 라벨은 서버(`label`)가 낸다.

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="경영 대시보드" /></h2>
          <p className="text-sm text-gray-500 mt-1">
            {greeting}, {user?.familyName}{user?.givenName}님 &middot; {kdate(today, 'dateWeekday')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsEditing(!isEditing)}
            className={`px-3 py-2 text-sm font-medium rounded-xl transition-colors ${
              isEditing ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <T k={isEditing ? '편집 완료' : '섹션 편집'} />
          </button>
          <Link href="/executive/clinical" className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
            <T k="의료 품질 대시보드" /> →
          </Link>
        </div>
      </div>

      {/* 편집 모드 — 섹션 토글 */}
      {isEditing && (
        <div className="bg-white rounded-2xl border-2 border-dashed border-blue-300 shadow-sm p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-900"><T k="섹션 표시/숨기기" /></h3>
            <button onClick={resetSections} className="text-xs text-gray-400 hover:text-gray-600"><T k="초기화" /></button>
          </div>
          <div className="flex flex-wrap gap-2">
            {EXEC_SECTIONS.map((sec) => (
              <button
                key={sec.id}
                onClick={() => toggleSection(sec.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  show(sec.id)
                    ? 'bg-blue-100 text-blue-700 border border-blue-200'
                    : 'bg-gray-100 text-gray-400 border border-gray-200 line-through'
                }`}
              >
                <T k={sec.label} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Top KPI Cards */}
      {show('kpi-cards') && ov && (() => {
        // 🔴 표본 부재(n=0)는 '0%' 가 아니라 '산출 불가'. 초록(positive)으로 칠하지 않는다.
        const revCh: Metric = ov.revenueChangeMetric ?? { value: ov.revenueChange ?? null, n: 0 };
        const patCh: Metric = ov.patientChangeMetric ?? { value: ov.patientChange ?? null, n: 0 };
        const accrued = ov.revenue?.accrued;
        const collected = ov.revenue?.collected;
        const bedPct = ov.bedOccupancyPct ?? { value: ov.bedOccupancy ?? null, n: ov.totalBeds ?? 0 };
        const unpaidAmount = ov.unpaid?.amount ?? ov.unpaidAmount ?? 0;
        const unpaidCount = ov.unpaid?.count ?? ov.unpaidCount ?? 0;
        const changeSub = (m: Metric, suffix: string) =>
          m.value == null
            ? <span title={`비교 표본 ${m.n}건`}><T k="전주比 산출 불가 (표본 없음)" /></span>
            : <>{m.value >= 0 ? '▲' : '▼'} {Math.abs(m.value)}% {suffix}</>;
        return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* 🔴 '매출' 의 정본이 둘이었다(/executive=발생 · /journey-console=수납확정) → 라벨에 기준을 적고 둘 다 보여준다 */}
          <KpiCard
            label={tAttr('오늘 매출 (발생)')}
            value={`${formatKrw(accrued?.value ?? ov.todayRevenue ?? 0)}원`}
            sub={<>
              {changeSub(revCh, '(전주 일평균比)')}
              <span className="block text-gray-400 font-normal">
                청구 {accrued?.n ?? 0}건 · 수납확정 {formatKrw(collected?.value ?? 0)}원({collected?.n ?? 0}건)
              </span>
            </>}
            positive={revCh.value == null ? undefined : revCh.value >= 0}
            icon="💰"
          />
          {/* 🔴 카드는 '오늘 생성분'만 세고 알림은 전체를 세어 같은 화면이 0건과 54건을 동시에 말했다 → 전체 기간으로 통일 */}
          <KpiCard
            label={tAttr('미수납 (전체 기간)')}
            value={`${formatKrw(unpaidAmount)}원`}
            sub={<>{unpaidCount}<Unit>건</Unit> · <T k="본인부담 잔액" /></>}
            href="/billing"
            icon="📋"
          />
          <KpiCard
            label={tAttr('오늘 환자')}
            value={`${ov.todayPatients}명`}
            sub={changeSub(patCh, '(전주 일평균比)')}
            positive={patCh.value == null ? undefined : patCh.value >= 0}
            icon="🏥"
          />
          {/* 🔴 서버가 재원 병상(분자)·등록 병상(분모)을 Metric 에 함께 낸다(2026-08-20) — 분모 없는 퍼센트를 끝냈다 */}
          <KpiCard
            label={tAttr('병상 가동률 (재원/등록)')}
            value={<Ratio numerator={bedPct.numerator ?? ov.occupiedBeds} denominator={bedPct.denominator ?? ov.totalBeds} unavailableHint="등록 병상 0" />}
            sub={<><T k="입원" /> {ov.inpatients}<Unit>명</Unit></>}
            href="/beds"
            icon="🛏️"
          />
        </div>
        );
      })()}

      {/* Charts Row */}
      {show('charts') && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Weekly Revenue Bar Chart */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="주간 매출 추이" /></h3>
          <div className="flex items-end gap-2 h-40">
            {weekly.map((d: RevenueDay, i: number) => {
              const pct = maxWeeklyRev > 0 ? (d.revenue / maxWeeklyRev) * 100 : 0;
              // 서버가 로컬(KST) 달력 키를 준다 — `new Date('YYYY-MM-DD')`(UTC 자정)로 읽으면 요일이 밀릴 수 있다
              const dayName = DAY_LABELS[parseDayKey(d.date).getDay()];
              const isToday = i === weekly.length - 1;
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-medium text-gray-500">{formatKrw(d.revenue)}</span>
                  <div className="w-full flex justify-center">
                    <div
                      className={`w-8 rounded-t-lg transition-all ${isToday ? 'bg-blue-500' : 'bg-blue-200'}`}
                      style={{ height: `${Math.max(pct, 3)}%` }}
                    />
                  </div>
                  <span className={`text-[11px] font-medium ${isToday ? 'text-blue-600' : 'text-gray-400'}`}>{dayName}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Monthly Trend */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="월간 진료건수 추이" /></h3>
          <div className="flex items-end gap-3 h-40">
            {monthly.map((m: RevenueMonth, i: number) => {
              const pct = maxMonthlyEnc > 0 ? (m.encounters / maxMonthlyEnc) * 100 : 0;
              const isLast = i === monthly.length - 1;
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-medium text-gray-500">{m.encounters}<Unit>건</Unit></span>
                  <div className="w-full flex justify-center">
                    <div
                      className={`w-10 rounded-t-lg ${isLast ? 'bg-emerald-400' : 'bg-emerald-200'}`}
                      style={{ height: `${Math.max(pct, 3)}%` }}
                    />
                  </div>
                  <span className={`text-[11px] font-medium ${isLast ? 'text-emerald-600' : 'text-gray-400'}`}>
                    {m.month.slice(5)}월
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}

      {/* Department Stats */}
      {show('departments') && (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
        <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="부서별 실적 (오늘)" /></h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="부서" /></th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500"><T k="진료건수" /></th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500"><T k="매출" /></th>
            </tr>
          </thead>
          <tbody>
            {departments.length === 0 ? (
              <tr><td colSpan={3} className="py-8 text-center text-gray-400 text-sm"><T k="데이터 없음" /></td></tr>
            ) : departments.map((d: DeptStat) => (
              <tr key={d.department} className="border-b border-gray-50 hover:bg-blue-50/30">
                <td className="px-4 py-3 font-medium text-gray-900">{d.department}</td>
                <td className="px-4 py-3 text-right text-gray-700 tabular-nums">{d.encounters}<Unit>건</Unit></td>
                <td className="px-4 py-3 text-right text-gray-700 tabular-nums">{formatKrw(d.revenue)}<Unit>원</Unit></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {/* Bottom Row — Staff / Claims / Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Staff Summary */}
        {show('staff') && <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="인력 현황" /></h3>
          {staff && (
            <>
              <p className="text-lg font-bold text-gray-900 mb-3">총 {staff.total}<Unit>명</Unit></p>
              <div className="space-y-2">
                {staff.categories.map((c: StaffCategory) => (
                  <div key={c.category} className="flex justify-between text-sm">
                    {/* 라벨 정본은 서버(StaffCategory enum) — 못 받으면 원문 코드를 그대로 보여준다(임의 번역 금지) */}
                    <span className="text-gray-600"><T k={c.label ?? c.category} /></span>
                    <span className="font-medium text-gray-900">{c.count}<Unit>명</Unit></span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>}

        {/* Claims */}
        {show('claims') && <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="보험 청구 현황 (이번달)" /></h3>
          {claims && (
            <div className="space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600"><T k="미청구" /></span>
                <span className="font-medium text-blue-600">{claims.draft}<Unit>건</Unit></span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600"><T k="심사중" /></span>
                <span className="font-medium text-amber-600">{claims.submitted}<Unit>건</Unit></span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600"><T k="승인" /></span>
                <span className="font-medium text-emerald-600">{claims.approved}<Unit>건</Unit></span>
              </div>
              <div className="border-t border-gray-100 pt-2.5 mt-2.5">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600"><T k="총 청구액" /></span>
                  <span className="font-medium text-gray-900">{formatKrw(Number(claims.totalClaimed))}<Unit>원</Unit></span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-gray-600"><T k="삭감률" /></span>
                  {/* 🔴 청구 0건의 삭감률은 '0.0%'(=삭감 없음·초록)가 아니라 산출 불가다 */}
                  {claims.reductionRate == null ? (
                    <span className="font-medium text-gray-400"><T k="산출 불가" /></span>
                  ) : (
                    <span className={`font-medium ${parseFloat(String(claims.reductionRate)) <= 3 ? 'text-emerald-600' : 'text-red-600'}`}>{claims.reductionRate}<Unit>%</Unit></span>
                  )}
                </div>
                {claims.note && <p className="text-[11px] text-gray-400 mt-1">{claims.note}</p>}
              </div>
            </div>
          )}
        </div>}

        {/* Alerts */}
        {show('alerts') && <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="경영 알림" /></h3>
          {alerts.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center"><T k="알림 없음" /></p>
          ) : (
            <div className="space-y-2">
              {alerts.map((a: ExecAlert, i: number) => {
                // severity 'error' = 조회 실패(=문제 없음이 아니라 확인 못 함). 🔴 종전엔 실패를 0 으로 삼켜 알림 자체가 없었다.
                const cls = a.severity === 'error' ? 'bg-red-50 text-red-700'
                  : a.severity === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700';
                const icon = a.severity === 'error' ? '⛔' : a.severity === 'warning' ? '⚠️' : 'ℹ️';
                const body = (
                  <>
                    <span>{icon}</span>
                    <span className="font-medium">{a.message}</span>
                    {a.href && <span className="ml-auto text-xs opacity-70"><T k="목록" /> →</span>}
                  </>
                );
                // 🔴 P7 — 숫자만 있고 근거 목록으로 갈 길이 없었다. href 가 있으면 링크로 만든다.
                return a.href ? (
                  <Link key={i} href={a.href} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:brightness-95 ${cls}`}>{body}</Link>
                ) : (
                  <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${cls}`}>{body}</div>
                );
              })}
            </div>
          )}
        </div>}
      </div>

      {/* KPI Table */}
      {show('kpi-table') && (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
        <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="KPI 지표" /></h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="지표" /></th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500"><T k="목표" /></th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500"><T k="실적" /></th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500"><T k="달성률" /></th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-32"><T k="진행@진행률" /></th>
            </tr>
          </thead>
          <tbody>
            {/* 🔴 종전 `k.rate > 0 ? '%' : '-'` 은 두 방향으로 틀렸다:
                 표본 부재(청구 0건)를 100%(초록)로, 진짜 0%(수술 0/50건)를 '-'로 말했다.
                 서버가 rate=null(산출 불가) / rate=0(진짜 0)을 구분해 보낸다 — 그대로 표시한다. */}
            {kpis.map((k: KpiItem) => {
              const unavailable = k.rate == null;
              const rate = k.rate ?? 0;
              const tone = unavailable ? 'text-gray-400' : rate >= 80 ? 'text-emerald-600' : rate >= 50 ? 'text-amber-600' : 'text-red-600';
              const bar = rate >= 80 ? 'bg-emerald-400' : rate >= 50 ? 'bg-amber-400' : 'bg-red-400';
              return (
              <tr key={k.name} className="border-b border-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {k.name}
                  {k.note && <span className="block text-[11px] font-normal text-gray-400">{k.note}</span>}
                </td>
                <td className="px-4 py-3 text-right text-gray-500 tabular-nums">{k.target}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900 tabular-nums">{k.actual}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <span className={`font-semibold ${tone}`}>{unavailable ? <T k="산출 불가" /> : `${rate}%`}</span>
                  {k.n != null && <span className="block text-[10px] text-gray-300"><T k="표본" /> {k.n}</span>}
                </td>
                <td className="px-4 py-3">
                  {unavailable ? (
                    <div className="w-full border border-dashed border-gray-200 rounded-full h-2" title={tAttr('표본이 없어 달성률을 낼 수 없습니다')} />
                  ) : (
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className={`h-2 rounded-full transition-all ${bar}`} style={{ width: `${Math.min(Math.max(rate, 0), 100)}%` }} />
                    </div>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, positive, icon, href }: {
  label: string; value: React.ReactNode; sub: React.ReactNode; positive?: boolean; icon: string; href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-500">{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <p className="text-xl font-bold text-gray-900 mb-1">{value}</p>
      {/* positive 는 **부호를 아는 경우에만** 색을 준다 — 산출 불가(undefined)를 초록으로 칠하지 않는다 */}
      <div className={`text-xs font-medium ${positive === true ? 'text-emerald-600' : positive === false ? 'text-red-500' : 'text-gray-400'}`}>{sub}</div>
    </>
  );
  const cls = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-5 block';
  // 🔴 P7 — 원장이 보는 숫자에서 근거 목록으로 갈 길을 둔다
  return href ? <Link href={href} className={`${cls} hover:border-blue-200 transition-colors`}>{body}</Link> : <div className={cls}>{body}</div>;
}
