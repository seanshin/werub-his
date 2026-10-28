'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';

import Link from 'next/link';
import { Money, Unit, Ratio } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs, money } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { claimCounts, type ClaimCounts } from '@/lib/claims-summary';

interface BedStatusData {
  totalBeds?: number;
  total?: number;
  occupiedBeds?: number;
  occupied?: number;
}

interface BillingItem {
  totalAmount?: number;
  amount?: number;
}

interface BillingData {
  items?: BillingItem[];
  total?: number;
  count?: number;
}

// 응급 정본 = /emergency/stats — current(미종결 재실)·byLevel(triageLevel 분포).
// 종전엔 /emergency 전체 목록의 length(전 기간 누적 110)를 "응급 환자"로 표시했고(P1-ⓐ),
// KTAS 분포는 존재하지 않는 필드(ktasLevel — 실제는 triageLevel)를 읽어 영원히 숨었다(P11).
interface EmergencyStats {
  current?: number;
  total?: number;
  byLevel?: Record<string, number>;
}

// 서버 /claims/summary 는 groupBy 배열 — claimCounts 정본 파서로 해석(P11·2026-08-13)

interface SurgeryItem {
  scheduledAt?: string;
  scheduledDate?: string;
  date?: string;
  status?: string;
  procedureName?: string;
}

interface DashboardSummary {
  totalPatients?: number;
  totalEncounters?: number;
  todayAppointments?: number;
  todayEncounters?: number;
  pendingBillings?: number;
  pendingOrders?: number;
  financialSummary?: { totalRevenue?: number; totalBilled?: number; paidAmount?: number };
}

export default function AdminDashboard() {
  const tt = useTAttr();
  const { data: summaryData, isError: summaryIsError, error: summaryError, refetch: refetchSummary } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiClient.get<{ data: DashboardSummary }>('/api/v1/dashboard/summary'),
    refetchInterval: pollMs('fast'),
  });

  const _sumRaw = summaryData?.data as DashboardSummary | { data: DashboardSummary } | null;
  const summary: DashboardSummary | null = (_sumRaw as { data?: DashboardSummary })?.data ?? _sumRaw as DashboardSummary | null;

  const { data: bedsData, isError: bedsIsError, error: bedsError, refetch: refetchBeds } = useQuery({
    queryKey: ['beds-status'],
    queryFn: () => apiClient.get<{ data: BedStatusData }>('/api/v1/beds/status'),
    refetchInterval: pollMs('fast'),
  });

  const { data: inpatientData, isError: inpatientIsError, error: inpatientError, refetch: refetchInpatient } = useQuery({
    queryKey: ['inpatient-dashboard'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> | unknown[] }>('/api/v1/inpatient'),
    refetchInterval: pollMs('fast'),
  });

  const { data: billingsData, isError: billingsIsError, error: billingsError, refetch: refetchBillings } = useQuery({
    queryKey: ['billings-pending'],
    queryFn: () => apiClient.get<{ data: BillingData | BillingItem[] }>('/api/v1/billings?status=PENDING&limit=500'),
    refetchInterval: pollMs('fast'),
  });

  const { data: emergencyData, isError: emergencyIsError, error: emergencyError, refetch: refetchEmergency } = useQuery({
    queryKey: ['emergency-dashboard-stats'],
    queryFn: () => apiClient.get<{ data: EmergencyStats }>('/api/v1/emergency/stats'),
    refetchInterval: pollMs('fast'),
  });

  const { data: claimsSummaryData, isError: claimsIsError, error: claimsError, refetch: refetchClaims } = useQuery({
    queryKey: ['claims-summary'],
    queryFn: () => apiClient.get<{ data: unknown }>('/api/v1/claims/summary'),
    refetchInterval: pollMs('normal'),
  });

  const { data: adminSurgeryData, isError: surgeryIsError, error: surgeryError, refetch: refetchSurgery } = useQuery({
    queryKey: ['admin-surgery-schedule'],
    queryFn: () => apiClient.get<{ data: SurgeryItem[] }>('/api/v1/surgery/schedule'),
    refetchInterval: pollMs('normal'),
  });

  const _bedsRaw = bedsData?.data as BedStatusData | { data: BedStatusData } | null;
  const beds = (_bedsRaw as { data?: BedStatusData })?.data ?? _bedsRaw as BedStatusData | null;
  const _ipRaw = inpatientData?.data as Record<string, unknown> | unknown[] | null;
  const inpatients = (_ipRaw as { data?: unknown })?.data ?? _ipRaw;
  const _billRaw = billingsData?.data as BillingData | BillingItem[] | null;
  const billings = (_billRaw as { data?: BillingData | BillingItem[] })?.data ?? _billRaw;
  const _emRaw = emergencyData?.data as EmergencyStats | null;
  const emergency = (_emRaw as { data?: EmergencyStats })?.data ?? _emRaw;

  const totalBeds: number | string = beds?.totalBeds ?? beds?.total ?? (Array.isArray(beds) ? beds.length : '-');
  // byStatus에서 OCCUPIED 찾기
  const _bedsWithStatus = beds as (BedStatusData & { byStatus?: { status: string; _count: number }[] }) | null;
  const _occupiedFromStatus = Array.isArray(_bedsWithStatus?.byStatus) ? (_bedsWithStatus.byStatus.find((s) => s.status === 'OCCUPIED')?._count ?? 0) : null;
  const occupiedBeds: number | string = beds?.occupiedBeds ?? beds?.occupied ?? _occupiedFromStatus ?? (Array.isArray(beds) ? (beds as { status: string }[]).filter((b) => b.status === 'OCCUPIED').length : '-');
  const occupancyRate: number | string = typeof totalBeds === 'number' && typeof occupiedBeds === 'number' && totalBeds > 0
    ? Math.round((occupiedBeds / totalBeds) * 100)
    : '-';

  const admittedCount: number | string = Array.isArray(inpatients) ? inpatients.length : ((inpatients as Record<string, number>)?.total ?? (inpatients as Record<string, number>)?.count ?? '-');
  const emergencyCount: number | string = (emergency as EmergencyStats)?.current ?? '-';

  const pendingBillingItems: BillingItem[] = Array.isArray(billings) ? billings : ((billings as BillingData)?.items ?? []);
  // 🔴 배열 length 는 페이지 상한(기본 20)에 눌린다 — 총 건수는 서버 pagination.total 정본
  const _billPagination = (_billRaw as { pagination?: { total?: number } })?.pagination;
  const pendingBillingCount: number | string = _billPagination?.total
    ?? (Array.isArray(billings) ? billings.length : ((billings as BillingData)?.total ?? (billings as BillingData)?.count ?? pendingBillingItems.length));
  const pendingBillingAmount = pendingBillingItems.reduce((sum: number, b: BillingItem) => sum + (b.totalAmount ?? b.amount ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* 🔴 종전 '관리자 업무' 머리 블록은 위 요약 띠와 같은 값(오늘 예약·오늘 진료·대기 오더)을 한 화면에 두 번,
          '현재 입원'은 세 번 그렸다(2026-09-29 정돈) — 같은 사실은 한 자리에서만 말한다. */}

      {/* Revenue + Hospital Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue Widget */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <h3 className="text-[13px] font-semibold text-slate-700"><T k="수납 현황" /></h3>
          </div>
          {summaryIsError && <QueryErrorFallback error={summaryError} onRetry={() => refetchSummary()} size="compact" className="mb-2" />}
          {billingsIsError && <QueryErrorFallback error={billingsError} onRetry={() => refetchBillings()} size="compact" className="mb-2" />}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500"><T k="오늘 매출" /></span>
              <span className="text-lg font-bold text-emerald-600">
                {summary?.financialSummary?.paidAmount != null ? <Money value={summary.financialSummary.paidAmount} /> : '-'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500"><T k="미수납 건수" /></span>
              <span className="text-lg font-bold text-amber-600">{pendingBillingCount != null ? <>{pendingBillingCount}<Unit><T k="건" /></Unit></> : '-'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500"><T k="미수납 총액" /></span>
              <span className="text-lg font-bold text-red-600">
                {pendingBillingAmount > 0 ? <Money value={pendingBillingAmount} /> : '-'}
              </span>
            </div>
          </div>
          <Link href="/billing" className="mt-4 block text-center text-xs text-blue-600 hover:text-blue-700 font-medium">
            <T k="수납 관리 바로가기" /> &rarr;
          </Link>
        </div>

        {/* Hospital Status Widget */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>
            <h3 className="text-[13px] font-semibold text-slate-700"><T k="병원 현황" /></h3>
          </div>
          {bedsIsError && <QueryErrorFallback error={bedsError} onRetry={() => refetchBeds()} size="compact" className="mb-2" />}
          {emergencyIsError && <QueryErrorFallback error={emergencyError} onRetry={() => refetchEmergency()} size="compact" className="mb-2" />}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500"><T k="병상 점유율" /></span>
              <span className="text-lg font-bold text-blue-600">
                {typeof totalBeds === 'number' && typeof occupiedBeds === 'number'
                  ? <Ratio numerator={occupiedBeds} denominator={totalBeds} pctOnly decimals={0} unavailableHint="등록 병상 없음" />
                  : <Ratio numerator={null} denominator={null} unavailableHint="병상 집계 없음" />}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500"><T k="현재 입원" /></span>
              <span className="text-sm font-semibold text-gray-900">{admittedCount != null ? <>{admittedCount}<Unit><T k="명" /></Unit></> : '-'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500"><T k="응급 환자" /></span>
              <span className="text-sm font-semibold text-gray-900">{emergencyCount != null ? <>{emergencyCount}<Unit><T k="건" /></Unit></> : '-'}</span>
            </div>
            {/* KTAS breakdown — stats.byLevel(triageLevel) 정본 */}
            {(() => {
              const byLevel = (emergency as EmergencyStats)?.byLevel ?? {};
              const ktas1 = byLevel.LEVEL_1 ?? 0;
              const ktas2 = byLevel.LEVEL_2 ?? 0;
              const ktas3 = byLevel.LEVEL_3 ?? 0;
              const ktas45 = (byLevel.LEVEL_4 ?? 0) + (byLevel.LEVEL_5 ?? 0);
              if (ktas1 + ktas2 + ktas3 + ktas45 === 0) return null;
              return (
                <div className="flex items-center gap-2 pt-2">
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">KTAS1: {ktas1}</span>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">KTAS2: {ktas2}</span>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">KTAS3: {ktas3}</span>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">KTAS4-5: {ktas45}</span>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Admission + Claims + Surgery */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Admission Status */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>
            <h3 className="text-[13px] font-semibold text-slate-700"><T k="입퇴원 현황" /></h3>
          </div>
          {inpatientIsError && <QueryErrorFallback error={inpatientError} onRetry={() => refetchInpatient()} size="compact" className="mb-2" />}
          {bedsIsError && <QueryErrorFallback error={bedsError} onRetry={() => refetchBeds()} size="compact" className="mb-2" />}
          {(() => {
            const inpatientList = Array.isArray(inpatients) ? inpatients : ((inpatients as Record<string, unknown[]>)?.items ?? []);
            const currentCount = Array.isArray(inpatients) ? inpatients.length : ((inpatients as Record<string, number>)?.total ?? (inpatients as Record<string, number>)?.count ?? 0);
            // 🔴 total-occupied 는 청소중·정비중을 '가용'으로 센다(W2 병상 KPI 와 같은 병) — AVAILABLE 만 가용이다
            const availBeds = Array.isArray(_bedsWithStatus?.byStatus)
              ? (_bedsWithStatus.byStatus.find((st) => st.status === 'AVAILABLE')?._count ?? 0)
              : '-';
            return (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500"><T k="현재 입원" /></span>
                  <span className="text-lg font-bold text-indigo-600">{currentCount}<Unit><T k="명" /></Unit></span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500"><T k="가용 병상" /></span>
                  <span className="text-lg font-bold text-emerald-600">{availBeds != null ? <>{availBeds}<Unit><T k="개" /></Unit></> : '-'}</span>
                </div>
              </div>
            );
          })()}
          <Link href="/inpatient" className="mt-4 block text-center text-xs text-blue-600 hover:text-blue-700 font-medium">
            <T k="입원 관리 바로가기" /> &rarr;
          </Link>
        </div>

        {/* Insurance Claims */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" /></svg>
            <h3 className="text-[13px] font-semibold text-slate-700"><T k="보험 청구" /></h3>
          </div>
          {claimsIsError ? <QueryErrorFallback error={claimsError} onRetry={() => refetchClaims()} size="compact" /> : (() => {
            // 서버는 groupBy 배열 — 평면 객체로 읽으면 실제 청구 4건이 있어도 전 칸 0 이었다(P11)
            const _claimsRaw = claimsSummaryData?.data as unknown;
            const claims: ClaimCounts = claimCounts((_claimsRaw as { data?: unknown })?.data ?? _claimsRaw);
            return (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500"><T k="미청구" /></span>
                  <span className="text-sm font-bold text-red-600">{claims.pending}<Unit><T k="건" /></Unit></span>
                </div>
                <div className="flex justify-between items-center">
                  {/* 🔴 (2026-10-14 P4-4) SUBMITTED 는 심평원 전송 채널이 없어 '심사 중'이 아니다 — 제출 기록이다 */}
                  <span className="text-xs text-gray-500"><T k="제출됨" /></span>
                  <span className="text-sm font-bold text-amber-600">{claims.reviewing}<Unit><T k="건" /></Unit></span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500"><T k="인정" /></span>
                  <span className="text-sm font-bold text-emerald-600">{claims.approved}<Unit><T k="건" /></Unit></span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500"><T k="반려" /></span>
                  <span className="text-sm font-bold text-rose-600">{claims.rejected}<Unit><T k="건" /></Unit></span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500"><T k="지급" /></span>
                  <span className="text-sm font-bold text-blue-600">{claims.paid}<Unit><T k="건" /></Unit></span>
                </div>
              </div>
            );
          })()}
          <Link href="/claims" className="mt-4 block text-center text-xs text-blue-600 hover:text-blue-700 font-medium">
            <T k="청구 관리 바로가기" /> &rarr;
          </Link>
        </div>

        {/* Surgery Status */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>
            <h3 className="text-[13px] font-semibold text-slate-700"><T k="수술 현황" /></h3>
          </div>
          {surgeryIsError ? <QueryErrorFallback error={surgeryError} onRetry={() => refetchSurgery()} size="compact" /> : (() => {
            const _surgRaw = adminSurgeryData?.data as SurgeryItem[] | { data: SurgeryItem[] } | null | undefined;
            const allSurgeries: SurgeryItem[] = Array.isArray(_surgRaw) ? _surgRaw : Array.isArray((_surgRaw as { data?: SurgeryItem[] })?.data) ? (_surgRaw as { data: SurgeryItem[] }).data : [];
            // 🔴 toISOString(UTC) 날짜 비교는 KST 아침 수술(전일 23:30Z)을 어제로 밀어낸다 — 로컬 달력 날짜로
            const localDay = (d: string | Date) => { const t = new Date(d); return Number.isNaN(t.getTime()) ? '' : `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
            const today = localDay(new Date());
            const todaySurgeries = allSurgeries.filter((s: SurgeryItem) => localDay(String(s.scheduledAt ?? s.scheduledDate ?? s.date ?? '')) === today);
            const inProgress = todaySurgeries.filter((s: SurgeryItem) => s.status === 'IN_PROGRESS').length;
            const scheduled = todaySurgeries.filter((s: SurgeryItem) => s.status === 'SCHEDULED' || s.status === 'PENDING').length;
            const completed = todaySurgeries.filter((s: SurgeryItem) => s.status === 'COMPLETED').length;
            return (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500"><T k="오늘 수술" /></span>
                  <span className="text-lg font-bold text-rose-600">{todaySurgeries.length}<Unit><T k="건" /></Unit></span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700"><T k="진행" /> {inProgress}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"><T k="예정" /> {scheduled}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700"><T k="완료" /> {completed}</span>
                </div>
              </div>
            );
          })()}
          <Link href="/surgery" className="mt-4 block text-center text-xs text-blue-600 hover:text-blue-700 font-medium">
            <T k="수술 관리 바로가기" /> &rarr;
          </Link>
        </div>
      </div>

      {/* 내 대기 환자는 별도 위젯(my-queue)이 관리자 기본 배치에 있다 — 여기서 또 그리면 같은 목록이 두 번 나온다(2026-09-29) */}
    </div>
  );
}
