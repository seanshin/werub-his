'use client';
import ApiWidget from '../ApiWidget';
import { T } from '@/components/ui/i18n-text';

type Dept = { department?: string; name?: string; label?: string; count?: number; value?: number };

/** 진료과별 환자 — /dashboard/charts.departmentPatients 미니 바 */
export default function ChartDeptWidget() {
  return <ApiWidget widgetId="chart-dept" endpoint="/api/v1/dashboard/charts" render={(data) => {
    const pts = ((data as { departmentPatients?: Dept[] })?.departmentPatients ?? []) as Dept[];
    if (!pts.length) return <p className="text-xs text-gray-400"><T k="진료과 데이터가 없습니다." /></p>;
    const val = (d: Dept) => d.count ?? d.value ?? 0;
    const max = Math.max(1, ...pts.map(val));
    return (
      <div className="space-y-1">
        {pts.slice(0, 10).map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span className="w-20 shrink-0 truncate text-gray-600">{d.department ?? d.name ?? d.label ?? '-'}</span>
            <div className="flex-1 h-2 rounded bg-gray-100 overflow-hidden"><div className="h-2 rounded bg-indigo-500" style={{ width: `${(val(d) / max) * 100}%` }} /></div>
            <span className="w-6 text-right text-gray-600">{val(d)}</span>
          </div>
        ))}
      </div>
    );
  }} />;
}
