'use client';

import { useEffect, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { T } from '@/components/ui/i18n-text';

interface CheckupAnalytics {
  byProgram: { status: string; _count: number }[];
  byStatus: { followUpType: string; _count: number }[];
  recentVisits: number;
}

export default function CheckupAnalyticsPage() {
  const [data, setData] = useState<CheckupAnalytics | null>(null);

  useEffect(() => {
    apiClient.fetch<{ data: CheckupAnalytics }>('/api/v1/crm/checkup/analytics')
      .then(r => setData(r.data))
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="프로그램 실적" /></h1>
        <p className="text-sm text-gray-500 mt-1"><T k="프로그램별 예약/완료/매출 분석" /></p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 rounded-2xl border border-gray-100 p-5 text-center">
          <p className="text-3xl font-bold text-blue-700">{data?.recentVisits ?? '-'}</p>
          <p className="text-xs text-gray-500 mt-1"><T k="최근 30일 검진" /></p>
        </div>
        <div className="bg-emerald-50 rounded-2xl border border-gray-100 p-5 text-center">
          <p className="text-3xl font-bold text-emerald-700">{data?.byProgram?.find(s => s.status === 'COMPLETED')?._count ?? '-'}</p>
          <p className="text-xs text-gray-500 mt-1"><T k="완료" /></p>
        </div>
        <div className="bg-amber-50 rounded-2xl border border-gray-100 p-5 text-center">
          <p className="text-3xl font-bold text-amber-700">{data?.byStatus?.length ?? '-'}</p>
          <p className="text-xs text-gray-500 mt-1"><T k="추적 유형" /></p>
        </div>
      </div>

      {data && (
        <>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-bold text-gray-700 mb-4"><T k="검진 상태별 현황" /></h2>
            <div className="space-y-2">
              {data.byProgram.map(s => (
                <div key={s.status} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <span className="text-sm text-gray-700">{s.status}</span>
                  <span className="text-sm font-bold text-gray-900">{s._count}<Unit>건</Unit></span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-bold text-gray-700 mb-4"><T k="추적 유형별 현황" /></h2>
            <div className="space-y-2">
              {data.byStatus.map(s => (
                <div key={s.followUpType} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <span className="text-sm text-gray-700">{s.followUpType}</span>
                  <span className="text-sm font-bold text-gray-900">{s._count}<Unit>건</Unit></span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
