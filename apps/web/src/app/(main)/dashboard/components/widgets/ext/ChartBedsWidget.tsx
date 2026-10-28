'use client';
import ApiWidget from '../ApiWidget';
import { Unit } from '@/components/ui/display';
import { RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { T } from '@/components/ui/i18n-text';

/** 🔴 등록 병상 0 이면 서버가 `rate: null`(산출 불가)을 준다 — `?? 0` 으로 접으면 "가동률 0%"가 된다 */
type Trend = { date: string; rate: number | null; occupied: number };

/** 병상 가동률 — /dashboard/bed-occupancy {totalBeds, trend[]} 미니 바 */
export default function ChartBedsWidget() {
  return <ApiWidget widgetId="chart-beds" endpoint="/api/v1/dashboard/bed-occupancy" render={(data) => {
    const d = data as { totalBeds?: number; trend?: Trend[] };
    const trend = (d?.trend ?? []) as Trend[];
    if (!trend.length) return <p className="text-xs text-gray-400"><T k="병상 데이터가 없습니다." /></p>;
    const latest = trend[trend.length - 1];
    return (
      <div className="space-y-1.5">
        {/* 🔴 '산출 불가' 문구는 shared 정본(`RATIO_UNAVAILABLE`) — 화면이 손으로 적으면 어휘가 갈라진다 */}
        <div className="text-xs text-gray-600"><T k="가동률" /> <b className="text-gray-900">{latest?.rate == null ? <span className="text-gray-400">{RATIO_UNAVAILABLE}</span> : <>{latest.rate}<Unit>%</Unit></>}</b> · <T k="재원" /> {latest?.occupied ?? 0}/{d?.totalBeds ?? 0}</div>
        {trend.slice(-7).map((t) => (
          <div key={t.date} className="flex items-center gap-2 text-[11px]">
            <span className="w-12 shrink-0 text-gray-500">{t.date}</span>
            <div className="flex-1 h-2 rounded bg-gray-100 overflow-hidden">{t.rate != null && <div className={`h-2 rounded ${t.rate >= 90 ? 'bg-rose-500' : t.rate >= 75 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${t.rate}%` }} />}</div>
            <span className="w-8 text-right text-gray-600">{t.rate == null ? <span className="text-gray-400">—</span> : <>{t.rate}<Unit>%</Unit></>}</span>
          </div>
        ))}
      </div>
    );
  }} />;
}
