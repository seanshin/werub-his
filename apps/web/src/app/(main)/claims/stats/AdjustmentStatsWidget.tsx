'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { money } from '@/lib/ui-settings';
import { Money, Unit } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';

// 삭감 패턴 통계 (R3-3) — 사유코드별·상태별 분포
interface Stats {
  total: { count: number; amount: number };
  byCode: { adjustCode: string; count: number; amount: number }[];
  byStatus: { status: string; count: number; amount: number }[];
}
const STATUS_KO: Record<string, string> = { ACCEPTED: '수용', APPEALING: '이의신청', REWORK: '재작업', RESOLVED: '해소' };
const unwrap = <T,>(r: unknown): T => {
  const raw = (r as { data?: unknown })?.data as { data?: T } | T | undefined;
  return ((raw as { data?: T })?.data ?? raw) as T;
};

export default function AdjustmentStatsWidget() {
  const { data } = useQuery({
    queryKey: ['claim-adjustment-stats'],
    queryFn: () => apiClient.get('/api/v1/claims/adjustments/stats').then((r) => unwrap<Stats>(r)),
  });

  if (!data || data.total.count === 0) return null;
  const maxAmount = Math.max(...data.byCode.map((c) => c.amount), 1);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-900"><T k="심사 삭감 패턴" /> <span className="text-xs font-normal text-gray-400"><T k="(사유코드별)" /></span></h3>
        <span className="text-xs text-gray-500">총 {data.total.count}<Unit>건</Unit> · <strong className="text-rose-600"><Money value={data.total.amount} /></strong></span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-xs text-gray-400 mb-2"><T k="사유코드별 삭감액 (상위)" /></p>
          <div className="space-y-1.5">
            {data.byCode.slice(0, 8).map((c) => (
              <div key={c.adjustCode} className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-700 w-16 shrink-0">{c.adjustCode}</span>
                <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                  <div className="h-full bg-rose-400 rounded" style={{ width: `${(c.amount / maxAmount) * 100}%` }} />
                </div>
                <span className="text-[11px] text-gray-500 w-24 text-right shrink-0"><Money value={c.amount} /> ({c.count})</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs text-gray-400 mb-2"><T k="상태 분포" /></p>
          <div className="flex flex-wrap gap-2">
            {data.byStatus.map((s) => (
              <div key={s.status} className="flex items-baseline gap-1.5 bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-lg font-bold text-gray-900">{s.count}</span>
                <span className="text-[11px] text-gray-500"><T k={STATUS_KO[s.status] ?? s.status} /></span>
                <span className="text-[10px] text-gray-400">(<Money value={s.amount} />)</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
