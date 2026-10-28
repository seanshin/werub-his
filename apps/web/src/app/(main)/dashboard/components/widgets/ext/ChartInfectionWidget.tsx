'use client';
import ApiWidget from '../ApiWidget';
import { T } from '@/components/ui/i18n-text';

type Analytics = {
  totalCases?: number;
  confirmedCases?: number;
  activeIsolations?: number;
  highRiskContacts?: number;
  byDisease?: Record<string, number>;
};

/** 감염관리 현황 — /infection-control/analytics 요약 + 질환별 분포 */
export default function ChartInfectionWidget() {
  return <ApiWidget widgetId="chart-infection" endpoint="/api/v1/infection-control/analytics" render={(data) => {
    const a = (data ?? {}) as Analytics;
    const diseases = Object.entries(a.byDisease ?? {});
    const max = Math.max(1, ...diseases.map(([, v]) => v));
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          <Stat label="총 사례" value={a.totalCases ?? 0} />
          <Stat label="확진" value={a.confirmedCases ?? 0} tone="rose" />
          <Stat label="격리중" value={a.activeIsolations ?? 0} tone="amber" />
          <Stat label="고위험 접촉" value={a.highRiskContacts ?? 0} tone="amber" />
        </div>
        {diseases.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-gray-100">
            {diseases.slice(0, 6).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-[11px]">
                <span className="w-14 shrink-0 truncate text-gray-500">{k}</span>
                <div className="flex-1 h-2 rounded bg-gray-100 overflow-hidden"><div className="h-2 rounded bg-rose-500" style={{ width: `${(v / max) * 100}%` }} /></div>
                <span className="w-5 text-right text-gray-600">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }} />;
}

function Stat({ label, value, tone = 'gray' }: { label: string; value: number; tone?: 'gray' | 'rose' | 'amber' }) {
  const color = tone === 'rose' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-600' : 'text-gray-800';
  return (
    <div className="flex justify-between rounded bg-gray-50 px-2 py-1">
      <span className="text-gray-500"><T k={label} /></span>
      <b className={color}>{value}</b>
    </div>
  );
}
