'use client';
import ApiStatsWidget from '../ApiStatsWidget';

// 🔴 서버 /api/v1/billing/daily-summary 는 { date, totalCount, totalRevenue, refundAmount, ... }.
//    위젯이 `count` 를 읽었는데 서버 키는 `totalCount` 라 '건수' 칸이 영구 '-' 였다(P11).
//    환불은 정산의 사실이다 — 수납합계만 보여주면 순액을 오독한다.
export default function DailySettlementWidget() {
  return <ApiStatsWidget widgetId="daily-settlement" endpoint="/api/v1/billing/daily-summary"
    stats={[
      { key: 'totalRevenue', label: '수납합계', color: 'text-blue-600', format: (v: number) => `${Number(v ?? 0).toLocaleString()}원` },
      { key: 'totalCount', label: '건수' },
      { key: 'refundAmount', label: '환불', color: 'text-red-600', format: (v: number) => `${Number(v ?? 0).toLocaleString()}원` },
      { key: 'deferredCount', label: '후불' },
    ]} />;
}
