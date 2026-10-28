'use client';
import ApiWidget from '../ApiWidget';
import { T } from '@/components/ui/i18n-text';

type Pt = { date: string; count: number };

/** 7일 진료 추이 — /dashboard/charts.dailyEncounters 미니 바 차트 */
export default function ChartWeeklyWidget() {
  return <ApiWidget widgetId="chart-weekly" endpoint="/api/v1/dashboard/charts" render={(data) => {
    const pts = ((data as { dailyEncounters?: Pt[] })?.dailyEncounters ?? []) as Pt[];
    if (!pts.length) return <p className="text-xs text-gray-400"><T k="진료 추이 데이터가 없습니다." /></p>;
    const max = Math.max(1, ...pts.map((p) => p.count));
    return (
      <div className="space-y-1">
        {pts.map((p) => (
          <div key={p.date} className="flex items-center gap-2 text-[11px]">
            <span className="w-12 shrink-0 text-gray-500">{p.date}</span>
            <div className="flex-1 h-2 rounded bg-gray-100 overflow-hidden">
              <div className="h-2 rounded bg-emerald-500" style={{ width: `${(p.count / max) * 100}%` }} />
            </div>
            <span className="w-7 text-right text-gray-600">{p.count}</span>
          </div>
        ))}
      </div>
    );
  }} />;
}
