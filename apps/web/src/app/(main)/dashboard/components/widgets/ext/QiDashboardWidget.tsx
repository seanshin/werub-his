'use client';
import ApiStatsWidget from '../ApiStatsWidget';

// /quality/dashboard 는 지표 객체 배열(latestValue·meetTarget) — 평면 키로 읽으면 전 칸 '-'(P11)
export default function QiDashboardWidget() {
  return <ApiStatsWidget widgetId="qi-dashboard" endpoint="/api/v1/quality/dashboard"
    transform={(d) => {
      const rows: Array<{ meetTarget?: boolean | null; latestValue?: unknown }> = Array.isArray(d) ? d : [];
      const measured = rows.filter(r => r.meetTarget != null);
      return {
        indicators: rows.length,
        metTarget: measured.filter(r => r.meetTarget === true).length,
        belowTarget: measured.filter(r => r.meetTarget === false).length,
        unmeasured: rows.length - measured.length, // 측정 없음 ≠ 미달 — 뭉개지 않는다
      };
    }}
    stats={[
      { key: 'indicators', label: '지표 수' },
      { key: 'metTarget', label: '목표 달성', color: 'text-emerald-600' },
      { key: 'belowTarget', label: '미달', color: 'text-red-600' },
      { key: 'unmeasured', label: '측정 없음', color: 'text-gray-500' },
    ]} />;
}
