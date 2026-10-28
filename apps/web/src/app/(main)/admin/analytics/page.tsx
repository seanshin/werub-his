'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Ratio, Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Title, Tooltip, Legend, Filler);

/**
 * 통계/분석 — 🔴 이 화면은 `/executive`(경영 대시보드)와 **같은 서버 EP** 를 본다.
 *   W7 에서 /executive 는 서버의 정직한 계약(`rate:null`·`note`·`label`·`href`·`count`·`{value,n}`)에
 *   맞춰 수렴됐는데 이 화면만 옛 키를 읽어, **같은 사실을 두 화면이 다르게** 말했다(P12).
 *   여기서 null 을 0 으로 접거나(P1) 서버가 이미 계산한 값을 문자열 정규식으로 다시 만들지 않는다.
 */

// ── Types ──
/** 표본 수를 동반하는 값 — n=0 이면 value 는 null(산출 불가) */
/** 🔴 `n` 은 **표본 수이지 분자가 아니다** — 비율 지표는 서버가 numerator/denominator 를 함께 낸다(2026-08-20) */
interface Metric { value: number | null; n: number; numerator?: number; denominator?: number }
interface RevenueDay { date: string; revenue: number; count: number }
interface RevenueMonth { month: string; revenue: number; encounters: number }
interface DeptPerformance { department: string; encounters: number; revenue: number }
/** 🔴 `category` 는 DB enum 영문 원문(MEDICAL·TECHNICAL…) — 화면에 쓸 한글은 서버 `label` 이다 */
interface StaffCategory { category: string; label?: string; count: number }
/** 🔴 서버는 `rate: number | null`(null=산출 불가) + `note`(사유) + `n`(표본)을 보낸다 */
interface KpiItem { name: string; rate: number | null; target: string; actual: string; n?: number; note?: string }
interface BedStatusItem { status: string; _count: number }
interface EquipmentItem { status: string }
interface HourlyItem { hour: number; count: number }
interface DiagnosisItem { code: string; name: string; count: number }
interface InsuranceItem { type: string; amount: number; count: number }
/** 🔴 서버가 `count`(수)와 `href`(근거 목록)를 준다 — 메시지 문자열에서 숫자를 다시 뽑지 않는다.
 *   조회 실패는 `type: '<도메인>:error'` + `severity:'error'` 로 온다(=0건이 아니라 확인 못 함). */
interface ExecAlert { type: string; message: string; severity: string; href?: string; count?: number }

// ── Helpers ──
/** 🔴 값·자릿수는 불변(money 잠금 도메인) — **단위 낱말만** 호출부가 `만원@단위` 로 넘긴다(uiparts 선례) */
const fmt만원 = (v: number | string, unit = '만원') => `${(Number(v) / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}${unit}`;
const fmtNum = (v: number) => v.toLocaleString('ko-KR');
const CHART_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'];

function parseData<T>(raw: unknown, defaultValue: T): T {
  const r = (raw as any)?.data;
  if (Array.isArray(r)) return r as T;
  if (r && typeof r === 'object' && 'data' in r) return (r as any).data as T;
  return (r as T) ?? defaultValue;
}

function parseObj(raw: unknown): Record<string, any> {
  const r = (raw as any)?.data;
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    if ('data' in r && typeof (r as any).data === 'object') return (r as any).data;
    return r as Record<string, any>;
  }
  return {};
}

// ── Date helpers ──
function toDateStr(d: Date) { return d.toISOString().slice(0, 10); }
function getToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
/** 🔴 월요일 시작 주. 종전 `getDate() - getDay() + 1` 은 **일요일(getDay()=0)에 내일**을 가리켜
 *   '이번주' 버튼이 미래 구간(from=내일 > to=오늘)을 만들었다 — 서버는 고쳤는데 FE 만 남아 있었다. */
function getWeekStart() { const d = getToday(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }
function getMonthStart() { const d = getToday(); d.setDate(1); return d; }

/**
 * 서버가 낸 알림 배열에서 도메인 하나의 상태를 읽는다.
 * 🔴 종전엔 `alerts.find(a => a.type === 'chart')?.message.match(/\d+/)` 로 **문자열에서 숫자를 뽑았고**,
 *    필터가 `'chart'` 와만 일치해 서버가 실패를 드러낸 `'chart:error'` 는 걸리지 않아 화면에 "0건"이 떴다.
 *    서버는 `count`(수)·`href`(근거)·`type:'<도메인>:error'`(조회 실패)를 이미 보낸다.
 */
function alertStatus(alerts: ExecAlert[], domain: string): { count: number | null; failed: boolean; href?: string } {
  const failed = alerts.find(a => a.type === `${domain}:error`);
  if (failed) return { count: null, failed: true, href: failed.href };
  const hit = alerts.find(a => a.type === domain);
  // 알림이 없으면 서버가 0건이라 판단해 push 하지 않은 것 — 이건 **진짜 0**이다.
  return { count: hit?.count ?? 0, failed: false, href: hit?.href };
}

export default function AnalyticsPage() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  // 🔴 숫자+단위는 보간 키로 — `${n}${tAttr('건')}` 조각은 영어에서 `12items` 가 된다(`1750people` 과 같은 결함)
  const won = tAttr('만원@단위');
  const cnt = (n: string | number) => tfAttr('{수}건', { 수: n });
  const [tab, setTab] = useState<'경영' | '진료' | '운영'>('경영');
  const [dateFrom, setDateFrom] = useState(toDateStr(getMonthStart()));
  const [dateTo, setDateTo] = useState(toDateStr(getToday()));

  const setQuickDate = (mode: 'today' | 'week' | 'month') => {
    const today = getToday();
    if (mode === 'today') { setDateFrom(toDateStr(today)); setDateTo(toDateStr(today)); }
    else if (mode === 'week') { setDateFrom(toDateStr(getWeekStart())); setDateTo(toDateStr(today)); }
    else { setDateFrom(toDateStr(getMonthStart())); setDateTo(toDateStr(today)); }
  };

  // ── API Queries ──
  const { data: rawOverview, isError, error, refetch } = useQuery({ queryKey: ['exec-overview'], queryFn: () => apiClient.get('/api/v1/executive/overview') });
  const { data: rawWeekly, isError: weeklyErr } = useQuery({ queryKey: ['exec-weekly'], queryFn: () => apiClient.get('/api/v1/executive/revenue/weekly') });
  const { data: rawMonthly, isError: monthlyErr } = useQuery({ queryKey: ['exec-monthly'], queryFn: () => apiClient.get('/api/v1/executive/revenue/monthly') });
  const { data: rawDepts, isError: deptsErr } = useQuery({ queryKey: ['exec-departments'], queryFn: () => apiClient.get('/api/v1/executive/departments') });
  const { data: rawStaff, isError: staffErr } = useQuery({ queryKey: ['exec-staff-summary'], queryFn: () => apiClient.get('/api/v1/executive/staff-summary') });
  const { data: rawKpi, isError: kpiErr } = useQuery({ queryKey: ['exec-kpi'], queryFn: () => apiClient.get('/api/v1/executive/kpi') });
  const { data: rawClaims, isError: claimsErr } = useQuery({ queryKey: ['exec-claims'], queryFn: () => apiClient.get('/api/v1/executive/claims') });
  const { data: rawClinical, isError: clinicalErr } = useQuery({ queryKey: ['exec-clinical'], queryFn: () => apiClient.get('/api/v1/executive/clinical/overview') });
  const { data: rawHourly, isError: hourlyErr } = useQuery({ queryKey: ['exec-hourly', dateFrom], queryFn: () => apiClient.get(`/api/v1/executive/hourly?date=${dateFrom}`) });
  const { data: rawDiagnoses, isError: diagnosesErr } = useQuery({ queryKey: ['exec-diagnoses', dateFrom, dateTo], queryFn: () => apiClient.get(`/api/v1/executive/top-diagnoses?limit=10&from=${dateFrom}&to=${dateTo}`) });
  const { data: rawInsurance, isError: insuranceErr } = useQuery({ queryKey: ['exec-insurance'], queryFn: () => apiClient.get('/api/v1/executive/insurance-breakdown') });
  const { data: rawBeds, isError: bedsErr } = useQuery({ queryKey: ['bed-status'], queryFn: () => apiClient.get('/api/v1/beds/status') });
  const { data: rawEquipment, isError: equipErr } = useQuery({ queryKey: ['equipment'], queryFn: () => apiClient.get('/api/v1/equipment') });
  const { data: rawAlerts, isError: alertsErr } = useQuery({ queryKey: ['exec-alerts'], queryFn: () => apiClient.get('/api/v1/executive/alerts') });

  // ── Parsed data ──
  const eo = parseObj(rawOverview);
  const weekly = parseData<RevenueDay[]>(rawWeekly, []);
  const monthly = parseData<RevenueMonth[]>(rawMonthly, []);
  const depts = parseData<DeptPerformance[]>(rawDepts, []);
  const kpis = parseData<KpiItem[]>(rawKpi, []);
  const claims = parseObj(rawClaims);
  const clinical = parseObj(rawClinical);
  const hourly = parseData<HourlyItem[]>(rawHourly, []);
  const diagnoses = parseData<DiagnosisItem[]>(rawDiagnoses, []);
  const insurance = parseData<InsuranceItem[]>(rawInsurance, []);
  const bedData = parseObj(rawBeds);
  const equipList = parseData<EquipmentItem[]>(rawEquipment, []);
  const alerts = parseData<ExecAlert[]>(rawAlerts, []);

  const staffObj = parseObj(rawStaff);
  const staffCats: StaffCategory[] = Array.isArray(staffObj.categories) ? staffObj.categories : [];
  const staffTotal = staffObj.total ?? staffCats.reduce((s, c) => s + c.count, 0);

  // 🔴 알림 조회가 실패했으면 '미완료 차트 0건'이라고 말하지 않는다(P17).
  const chartAlert = alertsErr ? { count: null, failed: true, href: '/admin/him' } : alertStatus(alerts, 'chart');
  const billingAlert = alertsErr ? { count: null, failed: true, href: '/billing' } : alertStatus(alerts, 'billing');

  const insLabels: Record<string, string> = { NHIS: '건강보험', MEDICAID: '의료급여', VETERAN: '보훈', UNINSURED: '비급여', INDUSTRIAL: '산재', UNKNOWN: '미분류' };

  // ── Chart Data ──
  const weeklyChartData = useMemo(() => ({
    labels: weekly.map(d => d.date?.slice(5) ?? ''),
    datasets: [{
      label: tAttr('매출'),
      data: weekly.map(d => d.revenue ?? 0),
      backgroundColor: '#3b82f6',
      borderRadius: 8,
    }],
  }), [weekly]);

  const monthlyChartData = useMemo(() => ({
    labels: monthly.map(d => d.month ?? ''),
    datasets: [
      {
        type: 'bar' as const,
        label: tAttr('매출'),
        data: monthly.map(d => d.revenue ?? 0),
        backgroundColor: 'rgba(16,185,129,0.6)',
        borderRadius: 6,
        yAxisID: 'y',
        order: 2,
      },
      {
        type: 'line' as const,
        label: tAttr('진료건수'),
        data: monthly.map(d => d.encounters ?? 0),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.08)',
        tension: 0.3,
        pointRadius: 4,
        yAxisID: 'y1',
        order: 1,
      },
    ],
  }), [monthly]);

  const deptChartData = useMemo(() => ({
    labels: depts.map(d => d.department),
    datasets: [{
      label: tAttr('매출'),
      data: depts.map(d => d.revenue ?? 0),
      backgroundColor: CHART_COLORS.slice(0, depts.length),
      borderRadius: 6,
    }],
  }), [depts]);

  const insuranceChartData = useMemo(() => ({
    labels: insurance.map(d => tAttr(insLabels[d.type] ?? d.type)),
    datasets: [{
      data: insurance.map(d => d.amount),
      backgroundColor: CHART_COLORS.slice(0, insurance.length),
      borderWidth: 0,
    }],
  }), [insurance]);

  const hourlyChartData = useMemo(() => ({
    labels: hourly.map(d => `${d.hour}${tAttr('시@단위')}`),
    datasets: [{
      label: tAttr('진료건수'),
      data: hourly.map(d => d.count),
      backgroundColor: '#8b5cf6',
      borderRadius: 6,
    }],
  }), [hourly]);

  const diagnosisChartData = useMemo(() => ({
    labels: diagnoses.map(d => d.name?.length > 10 ? d.name.slice(0, 10) + '...' : d.name),
    datasets: [{
      label: tAttr('건수'),
      data: diagnoses.map(d => d.count),
      backgroundColor: CHART_COLORS.slice(0, diagnoses.length),
      borderRadius: 6,
    }],
  }), [diagnoses]);

  // ── Common chart options ──
  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, ticks: { callback: (v: string | number) => fmt만원(v, won) } } },
  };

  const barOptionsSimple = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true } },
  };

  const horizontalBarOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y' as const,
    plugins: { legend: { display: false } },
    scales: { x: { beginAtZero: true } },
  };

  const doughnutOptions = {
    responsive: true,
    plugins: { legend: { position: 'bottom' as const, labels: { boxWidth: 12, font: { size: 11 } } } },
  };

  const tabs: ('경영' | '진료' | '운영')[] = ['경영', '진료', '운영'];

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="통계 / 분석" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="위루비병원 경영 · 진료 · 운영 통합 대시보드" /></p>
      </div>

      {/* Date Filter */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex gap-1.5">
          <button onClick={() => setQuickDate('today')} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors whitespace-nowrap"><T k="오늘" /></button>
          <button onClick={() => setQuickDate('week')} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors whitespace-nowrap"><T k="이번주" /></button>
          <button onClick={() => setQuickDate('month')} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors whitespace-nowrap"><T k="이번달" /></button>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
          <span className="text-gray-400">~</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-2 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <T k={t} /> <T k="통계" />
          </button>
        ))}
      </div>

      {/* ──────────────── TAB 1: 경영 통계 ──────────────── */}
      {tab === '경영' && (
        <div className="space-y-6">
          {/* Stats Cards */}
          {/* 🔴 서버는 변화율을 `{value,n}` 로 준다 — 표본(n)이 없으면 value=null(=산출 불가)이고
               0% 가 아니다. `change={null}` 을 그냥 숨기면 "비교했는데 변화 없음"으로 오독된다. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SummaryCard
              label="오늘 매출 (발생)"
              value={eo.revenue?.accrued?.value != null ? fmt만원(eo.revenue.accrued.value, won) : (eo.todayRevenue != null ? fmt만원(eo.todayRevenue, won) : '-')}
              change={(eo.revenueChangeMetric as Metric | undefined) ?? { value: eo.revenueChange ?? null, n: 0 }}
              changeSuffix="전주 일평균比"
              sub={eo.revenue?.collected ? `${tAttr('수납확정')} ${fmt만원(eo.revenue.collected.value ?? 0, won)}(${cnt(eo.revenue.collected.n)})` : undefined}
              color="blue"
            />
            <SummaryCard label="미수납 금액 (전체 기간)" value={(eo.unpaid?.amount ?? eo.unpaidAmount) != null ? fmt만원(eo.unpaid?.amount ?? eo.unpaidAmount, won) : '-'} sub={(eo.unpaid?.count ?? eo.unpaidCount) != null ? `${cnt(fmtNum(eo.unpaid?.count ?? eo.unpaidCount))} · ${tAttr('본인부담 잔액')}` : undefined} color="amber" />
            <SummaryCard
              label="진료건수"
              value={eo.todayPatients != null ? cnt(fmtNum(eo.todayPatients)) : '-'}
              change={(eo.patientChangeMetric as Metric | undefined) ?? { value: eo.patientChange ?? null, n: 0 }}
              changeSuffix="전주 일평균比"
              color="emerald"
            />
            {/* 🔴 등록 병상 0 이면 가동률은 0% 가 아니라 산출 불가.
                 서버가 재원(분자)·등록(분모)을 Metric 에 함께 낸다(2026-08-20) — 정본 `<Ratio>` 로 그린다 */}
            <SummaryCard
              label="병상가동률 (재원/등록)"
              value={<Ratio numerator={eo.bedOccupancyPct?.numerator ?? eo.occupiedBeds} denominator={eo.bedOccupancyPct?.denominator ?? eo.totalBeds} unavailableHint="등록 병상 0" />}
              color="violet"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Weekly Revenue Bar */}
            <ChartCard title={tAttr('주간 매출 현황 (최근 7일)')} error={weeklyErr}>
              <div className="h-[260px]">
                <Bar data={weeklyChartData} options={barOptions as any} />
              </div>
            </ChartCard>

            {/* Monthly Revenue + Encounters (mixed) */}
            <ChartCard title={tAttr('월별 매출 · 진료 추이 (5개월)')} error={monthlyErr}>
              <div className="h-[260px]">
                <Bar
                  data={monthlyChartData as any}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
                    scales: {
                      y: { beginAtZero: true, position: 'left', ticks: { callback: (v: string | number) => fmt만원(v, won) } },
                      y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } },
                    },
                  } as any}
                />
              </div>
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Department Stats (horizontal bar) */}
            <ChartCard title={tAttr('진료과별 실적 (매출 기준)')}>
              <div className="h-[260px]">
                <Bar
                  data={deptChartData}
                  options={{
                    ...horizontalBarOptions,
                    scales: { x: { beginAtZero: true, ticks: { callback: (v: string | number) => fmt만원(v, won) } } },
                  } as any}
                />
              </div>
              {depts.length === 0 && <p className="text-center text-xs text-gray-300 py-4"><T k="데이터 없음" /></p>}
            </ChartCard>

            {/* Insurance Breakdown (Doughnut) */}
            <ChartCard title={tAttr('보험유형별 매출 분포')}>
              <div className="max-w-[260px] mx-auto">
                <Doughnut data={insuranceChartData} options={doughnutOptions} />
              </div>
              <p className="text-center text-xs text-gray-400 mt-2"><T k="총" /> {fmtNum(insurance.reduce((s, i) => s + i.count, 0))}<Unit>건</Unit></p>
              {insurance.length === 0 && <p className="text-center text-xs text-gray-300 py-4"><T k="데이터 없음" /></p>}
            </ChartCard>
          </div>
        </div>
      )}

      {/* ──────────────── TAB 2: 진료 통계 ──────────────── */}
      {tab === '진료' && (
        <div className="space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SummaryCard label="오늘 진료" value={clinicalErr ? tAttr('조회 실패') : clinical.todayEncounters != null ? cnt(fmtNum(clinical.todayEncounters)) : '-'} color="blue" />
            <SummaryCard label="대기환자" value={clinicalErr ? tAttr('조회 실패') : clinical.waitingPatients != null ? tfAttr('{수}명', { 수: fmtNum(clinical.waitingPatients) }) : '-'} sub={clinical.waitingBasis} color="amber" />
            {/* 🔴 종전엔 알림 **메시지 문자열**에서 정규식으로 숫자를 뽑았고, 필터가 `'chart'` 와만 맞아
                 서버가 실패를 드러낸 `'chart:error'` 는 못 잡아 "0건"으로 둔갑했다 → count·href 를 쓴다 */}
            <SummaryCard label="미완료차트 (DRAFT 24h)" value={chartAlert.failed ? tAttr('조회 실패') : cnt(fmtNum(chartAlert.count ?? 0))} sub={chartAlert.failed ? tAttr('확인 필요 — 0건이 아님') : undefined} href={chartAlert.href} color="red" />
            {/* 🔴 `type==='billing'` 알림은 **미수납**이다 — 라벨이 '대기오더'라 다른 사실을 말했다 */}
            <SummaryCard label="미수납 (전체 기간)" value={billingAlert.failed ? tAttr('조회 실패') : cnt(fmtNum(billingAlert.count ?? 0))} sub={billingAlert.failed ? tAttr('확인 필요 — 0건이 아님') : undefined} href={billingAlert.href} color="violet" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Hourly Distribution (Bar) */}
            <ChartCard title={tAttr('시간대별 진료 분포')} error={hourlyErr}>
              <div className="h-[260px]">
                <Bar data={hourlyChartData} options={barOptionsSimple as any} />
              </div>
              {hourly.length === 0 && <p className="text-center text-xs text-gray-300 py-4"><T k="데이터 없음" /></p>}
            </ChartCard>

            {/* Top Diagnoses (horizontal bar) */}
            <ChartCard title={tAttr('진단코드 Top 10')} error={diagnosesErr}>
              <div className="h-[260px]">
                <Bar data={diagnosisChartData} options={horizontalBarOptions as any} />
              </div>
              {diagnoses.length === 0 && <p className="text-center text-xs text-gray-300 py-4"><T k="데이터 없음" /></p>}
            </ChartCard>
          </div>

          {/* KPI Section */}
          <ChartCard title={tAttr('KPI 달성 현황')} error={kpiErr}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
              {/* 🔴 종전 `const rate = k.rate ?? 0` — 서버가 "이번달 청구 0건 — 산출 불가"라며 보낸
                   `rate:null` 을 **0% 빨강 막대**로 그렸다. 서버 주석이 고쳤다고 적어둔 바로 그 결함을
                   화면이 되돌린 것이다(P1). null=산출 불가 / 0=진짜 0 을 그대로 구분해 말한다. */}
              {kpis.map((k, i) => {
                const unavailable = k.rate == null;
                const rate = unavailable ? -1 : (k.rate as number); // -1 = 미사용(아래 분기에서 그리지 않는다)
                const color = rate >= 100 ? 'bg-emerald-500' : rate >= 80 ? 'bg-blue-500' : rate >= 60 ? 'bg-amber-500' : 'bg-red-400';
                const textColor = unavailable ? 'text-gray-400' : rate >= 100 ? 'text-emerald-600' : rate >= 80 ? 'text-blue-600' : 'text-amber-600';
                return (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-700 font-medium">{k.name}</span>
                      <span className={`text-xs font-semibold ${textColor}`}>
                        {unavailable ? <T k="산출 불가" /> : <>{rate}<Unit>%</Unit></>}
                      </span>
                    </div>
                    {unavailable ? (
                      // 표본이 없으면 막대를 채우지 않는다 — 빈 빨강 막대는 '미달'로 읽힌다
                      <div className="w-full border border-dashed border-gray-200 rounded-full h-2.5" title={k.note ?? tAttr('표본이 없어 달성률을 낼 수 없습니다')} />
                    ) : (
                      <div className="w-full bg-gray-100 rounded-full h-2.5">
                        <div className={`${color} h-2.5 rounded-full transition-all`} style={{ width: `${Math.min(Math.max(rate, 0), 100)}%` }} />
                      </div>
                    )}
                    <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                      <span><T k="목표" />: {k.target}</span>
                      <span><T k="실적" />: {k.actual}{k.n != null && ` · ${tAttr('표본')} ${k.n}`}</span>
                    </div>
                    {/* 서버가 사유(note)를 보낸다 — 화면이 그 사유를 삼키면 "왜 못 내는지"를 물을 곳이 없다 */}
                    {k.note && <p className="text-[10px] text-gray-400 mt-0.5">{k.note}</p>}
                  </div>
                );
              })}
              {kpis.length === 0 && <p className="col-span-2 text-center text-xs text-gray-300 py-6"><T k="KPI 데이터 없음" /></p>}
            </div>
          </ChartCard>
        </div>
      )}

      {/* ──────────────── TAB 3: 운영 통계 ──────────────── */}
      {tab === '운영' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Staff Doughnut */}
            <ChartCard title={tAttr('인력 현황')} error={staffErr}>
              <div className="max-w-[260px] mx-auto">
                <Doughnut
                  data={{
                    // 🔴 `category` 는 DB enum 영문 원문(MEDICAL·TECHNICAL·ADMIN·SUPPORT)이다.
                    //    서버가 한글 `label`('의료진'…)을 이미 보내는데 화면이 영문을 그렸다.
                    //    못 받으면 원문 코드를 그대로 둔다(임의 번역 금지).
                    labels: staffCats.map(c => tAttr(c.label ?? c.category)),
                    datasets: [{ data: staffCats.map(c => c.count), backgroundColor: CHART_COLORS.slice(0, staffCats.length), borderWidth: 0 }],
                  }}
                  options={doughnutOptions}
                />
              </div>
              <p className="text-center text-xs text-gray-400 mt-2"><T k="총" /> {fmtNum(staffTotal)}<Unit>명</Unit></p>
              {staffCats.length === 0 && <p className="text-center text-xs text-gray-300 pt-4"><T k="데이터 없음" /></p>}
            </ChartCard>

            {/* Bed Doughnut */}
            <ChartCard title={tAttr('병상 현황')} error={bedsErr}>
              {(() => {
                const byStatus: BedStatusItem[] = Array.isArray(bedData.byStatus) ? bedData.byStatus : [];
                // 🔴 '예약'은 진료 예약(Appointment)과 동음이의 — 병상 상태는 `예약@병상`(Reserved). ko 표시는 '예약' 그대로
                const labMap: Record<string, string> = { AVAILABLE: '이용가능', OCCUPIED: '사용중', RESERVED: '예약@병상', MAINTENANCE: '정비' };
                return (
                  <>
                    <div className="max-w-[260px] mx-auto">
                      <Doughnut
                        data={{
                          labels: byStatus.map(b => tAttr(labMap[b.status] ?? b.status)),
                          datasets: [{ data: byStatus.map(b => b._count), backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#9ca3af'], borderWidth: 0 }],
                        }}
                        options={doughnutOptions}
                      />
                    </div>
                    {/* 🔴 응답을 못 받았을 때 `?? 0` 은 "등록 병상이 0개"라는 없는 사실을 만든다 */}
                    <p className="text-center text-xs text-gray-400 mt-2"><T k="총" /> {bedData.total != null ? tfAttr('{수}병상', { 수: fmtNum(bedData.total) }) : tAttr('- (미확인)')}</p>
                    {byStatus.length === 0 && <p className="text-center text-xs text-gray-300 pt-4"><T k="데이터 없음" /></p>}
                  </>
                );
              })()}
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Claims Bar */}
            <ChartCard title={tAttr('청구 현황 (이번달)')} error={claimsErr}>
              <div className="h-[220px]">
                <Bar
                  data={{
                    labels: ['작성 중', '청구 완료', '승인 완료'].map(tAttr),
                    datasets: [{
                      label: tAttr('건수'),
                      data: [Number(claims.draft ?? 0), Number(claims.submitted ?? 0), Number(claims.approved ?? 0)],
                      backgroundColor: ['#9ca3af', '#3b82f6', '#10b981'],
                      borderRadius: 8,
                    }],
                  }}
                  options={barOptionsSimple as any}
                />
              </div>
              {claims.totalClaimed != null && (
                <div className="border-t border-gray-100 pt-3 mt-3 text-center">
                  <p className="text-xs text-gray-400"><T k="총 청구 금액" /></p>
                  <p className="text-lg font-bold text-blue-700">{fmt만원(claims.totalClaimed, won)}</p>
                  {/* 🔴 청구 0건이면 서버가 null 을 보낸다 — `?? '0.0'` 은 "삭감 없음"으로 오독된다(P17) */}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {claims.reductionRate != null ? <><T k="삭감률" /> {claims.reductionRate}<Unit>%</Unit></> : <T k="삭감률 산출 불가" />}
                  </p>
                </div>
              )}
            </ChartCard>

            {/* Info Cards: ICU, PACU, Equipment */}
            <div className="space-y-4">
              {/* 🔴 서버가 `icuOccupancyPct:{value,n}` 를 이미 계산해 보낸다 — FE 가 다시 나눗셈하면
                   반올림 규칙이 갈라지고(정본 둘·P12) 등록 0 을 '-' 로만 말해 사유를 잃는다 */}
              <InfoCard title={tAttr('ICU (중환자실)')} items={[
                { label: '총 병상', value: eo.icuTotal != null ? tfAttr('{수}개@병상', { 수: eo.icuTotal }) : '-' },
                { label: '사용 중', value: eo.icuOccupied != null ? tfAttr('{수}개@병상', { 수: eo.icuOccupied }) : '-' },
                { label: '가동률(사용중/등록)', value: <Ratio numerator={(eo.icuOccupancyPct as Metric | undefined)?.numerator ?? eo.icuOccupied} denominator={(eo.icuOccupancyPct as Metric | undefined)?.denominator ?? eo.icuTotal} unavailableHint="등록 ICU 병상 0" /> },
              ]} />
              <InfoCard title={tAttr('입원 현황')} items={[
                { label: '입원 환자', value: eo.inpatients != null ? tfAttr('{수}명', { 수: fmtNum(eo.inpatients) }) : '-' },
                { label: '일반 병상', value: eo.totalBeds != null ? `${eo.occupiedBeds ?? 0}/${eo.totalBeds}` : '-' },
                { label: '가동률(재원/등록)', value: <Ratio numerator={eo.bedOccupancyPct?.numerator ?? eo.occupiedBeds} denominator={eo.bedOccupancyPct?.denominator ?? eo.totalBeds} unavailableHint="등록 병상 0" /> },
              ]} />
              <InfoCard title={tAttr('장비 현황')} error={equipErr} items={(() => {
                const ec: Record<string, number> = {};
                equipList.forEach(e => { ec[e.status] = (ec[e.status] || 0) + 1; });
                const meta: Record<string, string> = { ACTIVE: '정상 가동', UNDER_MAINTENANCE: '점검 중', BROKEN: '고장', RETIRED: '폐기' };
                return Object.entries(ec).map(([s, c]) => ({ label: meta[s] ?? s, value: tfAttr('{수}대', { 수: c }) }));
              })()} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ──── Sub-components ────

/**
 * 🔴 `change` 를 `number` 에서 `Metric`(=`{value,n}`)으로 바꾼 이유 —
 *    서버는 비교 표본이 없으면 `value:null` 을 보낸다. 종전엔 그 카드가 변화 줄을 **통째로 숨겨서**
 *    "비교했는데 변화가 없다"와 "비교할 표본이 없다"가 화면에서 구별되지 않았다.
 */
function SummaryCard({ label, value, sub, change, changeSuffix, color, href }: {
  label: string; value: React.ReactNode; sub?: string; change?: Metric; changeSuffix?: string; color: string; href?: string;
}) {
  const palette: Record<string, { bg: string; text: string; sub: string }> = {
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-700',    sub: 'text-blue-400' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', sub: 'text-emerald-400' },
    violet:  { bg: 'bg-violet-50',  text: 'text-violet-700',  sub: 'text-violet-400' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   sub: 'text-amber-400' },
    red:     { bg: 'bg-red-50',     text: 'text-red-700',     sub: 'text-red-400' },
  };
  const c = palette[color] ?? palette.blue;
  // 🔴 label·changeSuffix 는 표시어라 여기서 <T> 로 — 종전엔 생문자열로 렌더돼 어떤 언어에서도 한국어였다
  const tfAttr = useTfAttr();
  const body = (
    <>
      <p className={`text-[11px] font-semibold uppercase tracking-wide ${c.text} ${c.bg} inline-block px-2 py-0.5 rounded-full mb-2 whitespace-nowrap`}><T k={label} /></p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {change && (
        change.value == null
          // 🔴 표본 부재는 '±0%'(=변화 없음)가 아니라 산출 불가다
          ? <p className="text-xs mt-1 text-gray-400" title={tfAttr('비교 표본 {수}건', { 수: change.n })}><T k={changeSuffix ?? ''} /> <T k="산출 불가 (표본 없음)" /></p>
          : (
            <p className={`text-xs mt-1 flex items-center gap-1 ${change.value >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              <span>{change.value >= 0 ? '\u25B2' : '\u25BC'}</span>
              <span><T k={changeSuffix ?? '전일 대비'} /> {change.value > 0 ? '+' : ''}{change.value}<Unit>%</Unit></span>
            </p>
          )
      )}
      {sub && <p className={`text-xs mt-1 ${c.sub}`}>{sub}</p>}
    </>
  );
  const cls = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-5 block';
  // 근거 목록으로 갈 길을 둔다 — 서버가 알림에 `href` 를 실어 보낸다(P7)
  return href
    ? <Link href={href} className={`${cls} hover:border-blue-200 transition-colors`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

/**
 * 🔴 `error` 를 받는 이유 — 종전엔 조회가 실패해도 `parseData(..., [])` 폴백으로 빈 배열이 되어
 *    화면이 "데이터 없음"(=진짜 0)이라 말했다. 실패와 0 은 다른 사실이다.
 */
function ChartCard({ title, children, error }: { title: string; children: React.ReactNode; error?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">{title}</h3>
      {error
        ? <p className="text-center text-xs text-red-600 py-8"><Tf k="조회 실패 — 데이터 없음이 아니라 {강조}입니다." params={{ 강조: <b><T k="확인 불가" /></b> }} /></p>
        : children}
    </div>
  );
}

function InfoCard({ title, items, error }: { title: string; items: { label: string; value: React.ReactNode }[]; error?: boolean }) {
  if (error) {
    // 🔴 장비 조회가 실패했는데 빈 카드를 그리면 "고장 장비 0대"로 읽힌다
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">{title}</h4>
        <p className="text-xs text-red-600"><T k="조회 실패 — 확인 필요" /></p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <h4 className="text-sm font-semibold text-gray-900 mb-3">{title}</h4>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <T className="text-gray-500" k={item.label} />
            <span className="font-semibold text-gray-900">{item.value}</span>
          </div>
        ))}
        {items.length === 0 && <span className="text-xs text-gray-300"><T k="데이터 없음" /></span>}
      </div>
    </div>
  );
}
