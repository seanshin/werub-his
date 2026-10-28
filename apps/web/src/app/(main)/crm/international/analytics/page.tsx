'use client';

import { useEffect, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { INTL_CASE_STATUS_LABEL } from '@hospital-run/shared';
import { T } from '@/components/ui/i18n-text';

interface ForeignAnalytics {
  byStatus: { status: string; _count: number }[];
  byNationality: { nationality: string; count: number }[];
  bySource: { source: string; _count: number }[];
}

const STATUS_LABEL = INTL_CASE_STATUS_LABEL; // 정본(intlCase)

export default function InternationalAnalyticsPage() {
  const [data, setData] = useState<ForeignAnalytics | null>(null);

  useEffect(() => {
    apiClient.fetch<{ data: ForeignAnalytics }>('/api/v1/crm/international/analytics')
      .then(r => setData(r.data))
      .catch(() => {});
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="해외환자 실적" /></h1>
        <p className="text-sm text-gray-500 mt-1"><T k="국적별, 유입 경로별, 상태별 분석" /></p>
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-bold text-gray-700 mb-4"><T k="상태별" /></h2>
            <div className="space-y-2">
              {data.byStatus.map(s => (
                <div key={s.status} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <span className="text-sm text-gray-700"><T k={STATUS_LABEL[s.status] ?? s.status} /></span>
                  <span className="text-sm font-bold text-gray-900">{s._count}<Unit>건</Unit></span>
                </div>
              ))}
              {data.byStatus.length === 0 && <p className="text-xs text-gray-400 text-center py-4"><T k="데이터 없음" /></p>}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-bold text-gray-700 mb-4"><T k="국적별" /></h2>
            <div className="space-y-2">
              {data.byNationality.map(n => (
                <div key={n.nationality} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <span className="text-sm text-gray-700">{n.nationality ?? <T k="미지정" />}</span>
                  <span className="text-sm font-bold text-gray-900">{n.count}<Unit>명</Unit></span>
                </div>
              ))}
              {data.byNationality.length === 0 && <p className="text-xs text-gray-400 text-center py-4"><T k="데이터 없음" /></p>}
            </div>
          </div>

          <div className="col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-bold text-gray-700 mb-4"><T k="유입 경로별" /></h2>
            <div className="grid grid-cols-3 gap-3">
              {data.bySource.map(s => (
                <div key={s.source} className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{s._count}</p>
                  <p className="text-xs text-gray-500 mt-1">{s.source}</p>
                </div>
              ))}
              {data.bySource.length === 0 && <p className="col-span-3 text-xs text-gray-400 text-center py-4"><T k="데이터 없음" /></p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
