'use client';

import { useQuery } from '@tanstack/react-query';
import { Ratio, Unit } from '@/components/ui/display';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T } from '@/components/ui/i18n-text';

interface TransferStats {
  total: number;
  recentMonth: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  topOrgs: [string, number][];
}

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: '요청', ACCEPTED: '수락', IN_TRANSIT: '이송중',
  COMPLETED: '완료', REJECTED: '거절', CANCELLED: '취소',
};

const TYPE_LABEL: Record<string, string> = {
  OUTGOING_REFERRAL: '발신', INCOMING_REFERRAL: '수신', RETURN: '회송', CROSS_CONSULT: '교차진료',
};

const STATUS_COLOR: Record<string, string> = {
  REQUESTED: 'bg-yellow-500', ACCEPTED: 'bg-blue-500', IN_TRANSIT: 'bg-purple-500',
  COMPLETED: 'bg-emerald-500', REJECTED: 'bg-red-500', CANCELLED: 'bg-gray-400',
};

const TYPE_COLOR: Record<string, string> = {
  OUTGOING_REFERRAL: 'bg-blue-500', INCOMING_REFERRAL: 'bg-violet-500', RETURN: 'bg-amber-500', CROSS_CONSULT: 'bg-teal-500',
};

export default function TransferStatsPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['transfer-stats'],
    queryFn: () => apiClient.get<{ data: TransferStats }>('/api/v1/transfer/stats'),
  });
  const stats: TransferStats = (data as any)?.data?.data ?? (data as any)?.data ?? { total: 0, recentMonth: 0, byStatus: {}, byType: {}, topOrgs: [] };

  const completed = stats.byStatus?.COMPLETED ?? 0;
  const rejected = stats.byStatus?.REJECTED ?? 0;
  /* 🔴 분모 0 은 0% 가 아니라 '산출 불가'다 — 미완료(0%)와 대상 없음을 뒤바꿔 말하지 않는다(2026-09-02) */
  const maxStatusCount = Math.max(1, ...Object.values(stats.byStatus ?? {}));
  const maxTypeCount = Math.max(1, ...Object.values(stats.byType ?? {}));
  const maxOrgCount = Math.max(1, ...(stats.topOrgs ?? []).map(o => o[1]));

  // 🔴 에러 분기가 먼저 — 통계 조회 실패를 "전체 0건·반려율 0%"로 말하지 않는다
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (isLoading) return <div className="py-12 text-center text-gray-400 animate-pulse"><T k="로딩 중..." /></div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="전원 통계" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="전원 현황 및 기관별 분석" /></p>
        </div>
        <Link href="/transfer" className="text-sm text-blue-600 hover:underline">&larr; <T k="전원 대시보드" /></Link>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border p-5 text-center">
          <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
          <div className="text-xs text-gray-500 mt-1"><T k="전체 전원" /></div>
        </div>
        <div className="bg-white rounded-2xl border p-5 text-center">
          <div className="text-3xl font-bold text-blue-600">{stats.recentMonth}</div>
          <div className="text-xs text-gray-500 mt-1"><T k="최근 30일" /></div>
        </div>
        <div className="bg-white rounded-2xl border p-5 text-center">
          <div className="text-3xl font-bold text-emerald-600">{completed}</div>
          <div className="text-xs text-gray-500 mt-1"><T k="완료" /></div>
        </div>
        <div className="bg-white rounded-2xl border p-5 text-center">
          <div className="text-3xl font-bold text-red-600"><Ratio numerator={rejected} denominator={stats.total} pctOnly unavailableHint="전원 요청 없음" /></div>
          <div className="text-xs text-gray-500 mt-1"><T k="거절률" /></div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* 상태별 분포 */}
        <div className="bg-white rounded-2xl border p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="상태별 분포" /></h3>
          <div className="space-y-3">
            {Object.entries(stats.byStatus ?? {}).map(([status, count]) => (
              <div key={status}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600"><T k={STATUS_LABEL[status] ?? status} /></span>
                  <span className="font-bold text-gray-700">{count}</span>
                </div>
                <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className={`h-full rounded-full ${STATUS_COLOR[status] ?? 'bg-gray-400'}`} style={{ width: `${(count / maxStatusCount) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 유형별 분포 */}
        <div className="bg-white rounded-2xl border p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="유형별 분포" /></h3>
          <div className="space-y-3">
            {Object.entries(stats.byType ?? {}).map(([type, count]) => (
              <div key={type}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600"><T k={TYPE_LABEL[type] ?? type} /></span>
                  <span className="font-bold text-gray-700">{count}</span>
                </div>
                <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className={`h-full rounded-full ${TYPE_COLOR[type] ?? 'bg-gray-400'}`} style={{ width: `${(count / maxTypeCount) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 기관별 Top 10 */}
        <div className="bg-white rounded-2xl border p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="기관별 Top 10" /></h3>
          {(stats.topOrgs ?? []).length === 0 ? (
            <div className="text-xs text-gray-400 py-4 text-center"><T k="데이터 없음" /></div>
          ) : (
            <div className="space-y-3">
              {(stats.topOrgs ?? []).map(([org, count], i) => (
                <div key={org}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600 truncate max-w-[140px]">{i + 1}. {org}</span>
                    <span className="font-bold text-gray-700">{count}</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(count / maxOrgCount) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
