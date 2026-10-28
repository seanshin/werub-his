'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import AdjustmentStatsWidget from './AdjustmentStatsWidget';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { money } from '@/lib/ui-settings';
import { Money, Unit } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';

type AnyRecord = Record<string, unknown>;

interface ClaimStat {
  status?: string; claimDate?: string; createdAt?: string; reviewedAt?: string;
  claimedAmount?: number; approvedAmount?: number; reducedAmount?: number;
}

export default function ClaimsStatsPage() {
  const [year, setYear] = useState(new Date().getFullYear());

  // 청구 목록에서 통계 계산
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['claims-all', year],
    queryFn: () => apiClient.get<AnyRecord>('/api/v1/claims'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const _raw = data?.data as AnyRecord;
  const allClaims: ClaimStat[] = Array.isArray(_raw) ? (_raw as ClaimStat[]) : (((_raw?.data ?? []) as ClaimStat[]));

  // 월별 집계
  const monthlyData = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const monthClaims = allClaims.filter(c => {
      const d = new Date(String(c.claimDate ?? c.createdAt ?? ''));
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    });
    // 🔴 미심사(DRAFT/SUBMITTED) 건은 approvedAmount 가 없다 — `claimed - approved` 로 세면
    //    아직 심사받지도 않은 청구가 전액 '삭감'으로 잡힌다(실측 삭감 30,000원 → 화면 369,000원·12배).
    //    삭감은 서버가 주는 reducedAmount 가 정본이고, 인정률 분모는 **심사 완료분**이다.
    const reviewed = monthClaims.filter((c: ClaimStat) => c.reviewedAt || ['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'PAID'].includes(String(c.status)));
    const claimed = monthClaims.reduce((s: number, c: ClaimStat) => s + (c.claimedAmount ?? 0), 0);
    const approved = monthClaims.reduce((s: number, c: ClaimStat) => s + (c.approvedAmount ?? 0), 0);
    const reduced = monthClaims.reduce((s: number, c: ClaimStat) => s + (c.reducedAmount ?? 0), 0);
    const reviewedClaimed = reviewed.reduce((s: number, c: ClaimStat) => s + (c.claimedAmount ?? 0), 0);
    return { month, count: monthClaims.length, claimed, approved, reduced, reviewedClaimed };
  });

  const totalClaimed = monthlyData.reduce((s, m) => s + m.claimed, 0);
  const totalApproved = monthlyData.reduce((s, m) => s + m.approved, 0);
  const totalReduced = monthlyData.reduce((s, m) => s + m.reduced, 0);
  const totalReviewedClaimed = monthlyData.reduce((s, m) => s + m.reviewedClaimed, 0);
  // 인정률 분모 = 심사 완료분. 심사 대기가 쌓일수록 0%로 수렴하던 것 해소. 표본 0이면 산출 불가.
  const approvalRate = totalReviewedClaimed > 0 ? Math.round((totalApproved / totalReviewedClaimed) * 100) : null;

  // 상태별 집계
  const statusCounts: Record<string, number> = {};
  allClaims.forEach(c => { const s = c.status ?? ''; statusCounts[s] = (statusCounts[s] ?? 0) + 1; });

  // 최대값 (차트용)
  const maxClaimed = Math.max(...monthlyData.map(m => m.claimed), 1);

  return (
    <div className="">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="청구 통계" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="월별 보험 청구 현황 분석" /></p>
        </div>
        <div className="flex items-center gap-3">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="px-3 py-2 border rounded-lg text-sm">
            {[2026, 2025, 2024].map(y => <option key={y} value={y}>{y}<Unit>년</Unit></option>)}
          </select>
          <Link href="/claims" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200">
            <T k="청구 목록" />
          </Link>
        </div>
      </div>

      <AdjustmentStatsWidget />

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
          <p className="text-xs text-gray-400 mb-1"><T k="총 청구액" /></p>
          <p className="text-xl font-bold text-gray-900">{totalClaimed.toLocaleString()}<span className="text-xs text-gray-400">원</span></p>
        </div>
        <div className="bg-emerald-50 rounded-2xl border border-emerald-200 p-5 text-center">
          <p className="text-xs text-emerald-500 mb-1"><T k="인정액" /></p>
          <p className="text-xl font-bold text-emerald-600">{totalApproved.toLocaleString()}<span className="text-xs text-gray-400">원</span></p>
        </div>
        <div className="bg-red-50 rounded-2xl border border-red-200 p-5 text-center">
          <p className="text-xs text-red-500 mb-1"><T k="삭감액" /></p>
          <p className="text-xl font-bold text-red-600">{totalReduced.toLocaleString()}<span className="text-xs text-gray-400">원</span></p>
        </div>
        <div className="bg-blue-50 rounded-2xl border border-blue-200 p-5 text-center">
          <p className="text-xs text-blue-500 mb-1"><T k="인정률" /></p>
          <p className="text-xl font-bold text-blue-600">{approvalRate == null ? <span className="text-sm text-gray-400"><T k="산출 불가" /></span> : <>{approvalRate}<span className="text-xs text-gray-400">%</span></>}</p>
        </div>
      </div>

      {/* 월별 차트 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
        <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="월별 청구/인정 추이" /></h3>
        <div className="flex items-end gap-2 h-48">
          {monthlyData.map(m => (
            <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex gap-0.5" style={{ height: '160px' }}>
                {/* 청구액 바 */}
                <div className="flex-1 flex flex-col justify-end">
                  <div className="bg-blue-200 rounded-t-sm transition-all"
                    style={{ height: `${Math.max(2, (m.claimed / maxClaimed) * 150)}px` }}
                    title={`청구: ${money(m.claimed)}`} />
                </div>
                {/* 인정액 바 */}
                <div className="flex-1 flex flex-col justify-end">
                  <div className="bg-emerald-400 rounded-t-sm transition-all"
                    style={{ height: `${Math.max(2, (m.approved / maxClaimed) * 150)}px` }}
                    title={`인정: ${money(m.approved)}`} />
                </div>
              </div>
              <span className="text-[10px] text-gray-400">{m.month}월</span>
            </div>
          ))}
        </div>
        <div className="flex justify-center gap-6 mt-3">
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-blue-200" /><span className="text-xs text-gray-500"><T k="청구액" /></span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-emerald-400" /><span className="text-xs text-gray-500"><T k="인정액" /></span></div>
        </div>
      </div>

      {/* 상태별 분포 + 월별 상세 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 상태별 분포 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="상태별 분포" /></h3>
          <div className="space-y-3">
            {Object.entries(statusCounts).map(([status, count]) => {
              const total = allClaims.length || 1;
              const pct = Math.round((count / total) * 100);
              const colors: Record<string, string> = {
                DRAFT: 'bg-gray-200', SUBMITTED: 'bg-blue-400', UNDER_REVIEW: 'bg-amber-400',
                APPROVED: 'bg-emerald-400', PARTIALLY_APPROVED: 'bg-teal-400', REJECTED: 'bg-red-400', PAID: 'bg-green-500',
              };
              const labels: Record<string, string> = {
                DRAFT: '작성중', SUBMITTED: '제출', UNDER_REVIEW: '심사중', // 정본(CLAIM_STATUS_LABEL) DRAFT=작성중
                APPROVED: '인정', PARTIALLY_APPROVED: '부분인정', REJECTED: '반려', PAID: '지급완료',
              };
              return (
                <div key={status}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600"><T k={labels[status] ?? status} /></span>
                    <span className="font-bold text-gray-900">{count}<Unit>건</Unit> ({pct}<Unit>%</Unit>)</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${colors[status] ?? 'bg-gray-300'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 월별 상세 테이블 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="월별 상세" /></h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left text-gray-500">월</th>
                <th className="py-2 text-right text-gray-500"><T k="건수" /></th>
                <th className="py-2 text-right text-gray-500"><T k="청구액" /></th>
                <th className="py-2 text-right text-gray-500"><T k="인정액" /></th>
                <th className="py-2 text-right text-gray-500"><T k="삭감액" /></th>
              </tr>
            </thead>
            <tbody>
              {monthlyData.filter(m => m.count > 0).map(m => (
                <tr key={m.month} className="border-b border-gray-50">
                  <td className="py-2 text-gray-700">{m.month}월</td>
                  <td className="py-2 text-right font-mono">{m.count}</td>
                  <td className="py-2 text-right font-mono">{m.claimed.toLocaleString()}</td>
                  <td className="py-2 text-right font-mono text-emerald-600">{m.approved.toLocaleString()}</td>
                  <td className="py-2 text-right font-mono text-red-600">{m.reduced > 0 ? m.reduced.toLocaleString() : '-'}</td>
                </tr>
              ))}
              {monthlyData.every(m => m.count === 0) && (
                <tr><td colSpan={5} className="py-8 text-center text-gray-400">{year}<Unit>년</Unit> <T k="청구 데이터가 없습니다" /></td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-800 font-bold">
                <td className="py-2"><T k="합계" /></td>
                <td className="py-2 text-right">{allClaims.length}</td>
                <td className="py-2 text-right">{totalClaimed.toLocaleString()}</td>
                <td className="py-2 text-right text-emerald-600">{totalApproved.toLocaleString()}</td>
                <td className="py-2 text-right text-red-600">{totalReduced > 0 ? totalReduced.toLocaleString() : '-'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-gray-400 text-sm"><T k="통계 데이터 로딩 중..." /></div>
      )}

      {/* HIRA 급여 분석 섹션 */}
      <HiraAnalysisSection year={year} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HIRA 급여 분석 섹션
   ═══════════════════════════════════════════════════════════════ */

// 🔴 서버(`getNonCoveredSummary`)가 돌려주는 키는 `itemName`/`codeType`/`averagePrice` 다.
//   FE 가 `name`/`code` 만 읽고 있어 상위 10 목록이 **전 행 '비급여'** 로 보였다(P11 계약 불일치).
interface NonCoveredItem { itemName?: string; codeType?: string; code?: string; name?: string; totalAmount?: number; count?: number; averagePrice?: number; avgPrice?: number }
interface CopayCapPatient { patientId?: string; mrn?: string; name?: string; insuranceType?: string; totalCopay?: number }

function HiraAnalysisSection({ year }: { year: number }) {
  // 🔴 `/api/v1/billing/hira-non-covered-report` 호출을 **삭제**했다(2026-08-20 · queryFn 정직화 축).
  //   이유: 그 EP 의 산출은 아래 `non-covered-summary` 와 **같은 groupBy·같은 필터**라
  //   화면에 함께 그리면 같은 사실의 정본이 둘이 된다(P12). 두 EP 의 연도 경계가 서로 다르므로
  //   (report=`new Date(year,0,1)` 서버 로컬 KST · summary=`'YYYY-01-01'` UTC) 값이 실제로 갈릴 수 있다.
  //   유일하게 report 만 주는 값은 `nonCoveredRatio` 다. 2026-09-21(갈래 H) 부터 서버가 분모
  //   `summary.totalRevenueAmount` 를 함께 싣고, 그 해 수납이 없으면 `null` + `nonCoveredRatioUnavailableReason:
  //   'NO_REVENUE_SAMPLE'` 을 준다(종전엔 분모 미동봉 + 분모 0 에 `0%` 였다). 그래도 여기서 그리지 않는
  //   이유는 위 P12(같은 사실의 정본 둘)가 그대로라서다 —
  //   보고서 산출 EP(연 1회 제출용)는 대시보드 타일이 아니라 **제출·다운로드 화면**과 한 벌로 배선해야 한다.
  const { data: summaryData, isError: summaryIsError, error: summaryError, refetch: refetchSummary } = useQuery({
    queryKey: ['hira-non-covered-summary', year],
    queryFn: () => apiClient.get<{ data: NonCoveredItem[] }>('/api/v1/billing/non-covered-summary', {
      from: `${year}-01-01`, to: `${year}-12-31`,
    }),
  });

  const { data: capData, isError: capIsError, error: capError, refetch: refetchCap } = useQuery({
    queryKey: ['hira-copay-cap-patients', year],
    queryFn: () => apiClient.get<{ data: CopayCapPatient[] }>('/api/v1/billing/copayment-cap-patients', { year: String(year) }),
  });

  const nonCoveredItems: NonCoveredItem[] = (() => {
    const d = summaryData?.data;
    if (Array.isArray(d)) return d;
    if (d && typeof d === 'object' && 'data' in d) return (d as { data: NonCoveredItem[] }).data ?? [];
    return [];
  })();

  const capPatients: CopayCapPatient[] = (() => {
    const d = capData?.data;
    if (Array.isArray(d)) return d;
    if (d && typeof d === 'object' && 'data' in d) return (d as { data: CopayCapPatient[] }).data ?? [];
    return [];
  })();

  const totalNonCovered = nonCoveredItems.reduce((s, i) => s + (i.totalAmount ?? 0), 0);

  return (
    <div className="mt-8 space-y-6">
      <div className="border-t border-gray-200 pt-6">
        <h3 className="text-lg font-bold text-gray-900 mb-1"><T k="HIRA 급여 분석" /></h3>
        <p className="text-xs text-gray-500 mb-4"><T k="건강보험심사평가원 비급여 보고 및 본인부담상한 분석" /></p>
        {/* 🔴 조회 실패를 "0원 / 0종 / 0명"으로 말하지 않는다 */}
        {summaryIsError && <QueryErrorFallback error={summaryError} onRetry={refetchSummary} size="compact" className="mb-2" />}
        {capIsError && <QueryErrorFallback error={capError} onRetry={refetchCap} size="compact" className="mb-2" />}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
          <p className="text-xs text-gray-400 mb-1"><T k="비급여 총액" /></p>
          <p className="text-xl font-bold text-gray-900">{summaryIsError ? <T k="조회 실패" /> : <>{totalNonCovered.toLocaleString()}<span className="text-xs text-gray-400">원</span></>}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
          <p className="text-xs text-gray-400 mb-1"><T k="비급여 항목 수" /></p>
          <p className="text-xl font-bold text-violet-600">{summaryIsError ? <T k="조회 실패" /> : <>{nonCoveredItems.length}<span className="text-xs text-gray-400">종</span></>}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
          <p className="text-xs text-gray-400 mb-1"><T k="상한 초과 환자" /></p>
          <p className="text-xl font-bold text-red-600">{capIsError ? <T k="조회 실패" /> : <>{capPatients.length}<span className="text-xs text-gray-400">명</span></>}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 비급여 항목별 매출 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h4 className="text-sm font-bold text-gray-900 mb-3"><T k="비급여 항목별 매출 (상위 10)" /></h4>
          {summaryIsError ? (
            <QueryErrorFallback error={summaryError} onRetry={refetchSummary} size="compact" />
          ) : nonCoveredItems.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center"><T k="데이터 없음" /></p>
          ) : (
            <div className="space-y-2">
              {nonCoveredItems.slice(0, 10).map((item, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-gray-400 w-4">{i + 1}</span>
                    <span className="text-xs text-gray-700 truncate"><T k={item.itemName ?? item.name ?? item.code ?? '항목명 미상'} /></span>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-xs font-semibold text-gray-900"><Money value={(item.totalAmount ?? 0)} /></span>
                    <span className="text-[10px] text-gray-400 ml-1">({item.count ?? 0}<Unit>건</Unit>)</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 본인부담 상한 초과 환자 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h4 className="text-sm font-bold text-gray-900 mb-3"><T k="본인부담 상한 초과 환자" /></h4>
          {capIsError ? (
            <QueryErrorFallback error={capError} onRetry={refetchCap} size="compact" />
          ) : capPatients.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center"><T k="상한 초과 환자 없음" /></p>
          ) : (
            <div className="space-y-2">
              {capPatients.slice(0, 10).map((p, i) => (
                <div key={i} className="flex items-center justify-between bg-red-50/50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-900">{p.name}</span>
                    <span className="text-[10px] text-gray-400">{p.mrn}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{p.insuranceType}</span>
                  </div>
                  <span className="text-xs font-bold text-red-600"><Money value={(p.totalCopay ?? 0)} /></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
