'use client';
import ApiWidget from '../ApiWidget';
import { T } from '@/components/ui/i18n-text';

type Pt = { hour: string; count: number };

/** 시간대별 접수 — /dashboard/charts.hourlyPatients 미니 바 차트 */
export default function ChartHourlyWidget() {
  return <ApiWidget widgetId="chart-hourly" endpoint="/api/v1/dashboard/charts" render={(data) => {
    const pts = ((data as { hourlyPatients?: Pt[] })?.hourlyPatients ?? []) as Pt[];
    if (!pts.length) return <p className="text-xs text-gray-400"><T k="접수 데이터가 없습니다." /></p>;
    const max = Math.max(1, ...pts.map((p) => p.count));
    return (
      <div className="space-y-1">
        {pts.map((p) => (
          <div key={p.hour} className="flex items-center gap-2 text-[11px]">
            <span className="w-10 shrink-0 text-gray-500">{p.hour}</span>
            <div className="flex-1 h-2 rounded bg-gray-100 overflow-hidden">
              <div className="h-2 rounded bg-blue-500" style={{ width: `${(p.count / max) * 100}%` }} />
            </div>
            <span className="w-6 text-right text-gray-600">{p.count}</span>
          </div>
        ))}
      </div>
    );
  }} />;
}
