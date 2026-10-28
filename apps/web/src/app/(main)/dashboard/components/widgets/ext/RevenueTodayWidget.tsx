'use client';
import ApiStatsWidget from '../ApiStatsWidget';
import { cashierTodaySummary } from '@/lib/widget-summaries';

// 🔴 서버 /api/v1/billing/cashier-stats 는 { pendingCount, completedCount, deferredCount, totalRevenue } 를 준다.
//    위젯이 todayRevenue·todayCount·unpaidAmount·unpaidCount 를 읽어 **4칸 전부** 영구 '-' 였다(P11).
// 🔴 이 EP 에 미수납 **금액**은 없다 — 0원으로 지어내지 않는다. 금액 정본은 /executive overview.unpaid.amount.
//    그리고 여기 pendingCount 는 PENDING 만 세므로(= 전 기간 미수납 정본 PENDING+PARTIAL+DEFERRED 와 다른 집합)
//    라벨에 집합을 적어 두 화면이 다른 수를 말하는 것처럼 보이지 않게 한다.
export default function RevenueTodayWidget() {
  return <ApiStatsWidget widgetId="revenue-today" endpoint="/api/v1/billing/cashier-stats" transform={cashierTodaySummary}
    stats={[
      { key: 'todayRevenue', label: '오늘 수납', color: 'text-blue-600', format: (v: number) => `${Number(v ?? 0).toLocaleString()}원` },
      { key: 'todayCount', label: '오늘 수납건' },
      { key: 'pendingCount', label: '미수납(PENDING·전기간)', color: 'text-red-600' },
      { key: 'deferredCount', label: '후불(DEFERRED)', color: 'text-amber-600' },
    ]} />;
}
