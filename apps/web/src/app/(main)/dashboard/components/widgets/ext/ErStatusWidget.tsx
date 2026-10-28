'use client';
import ApiStatsWidget from '../ApiStatsWidget';

// /emergency/stats 는 {current, total, byLevel} — 종전 키(waiting/inProgress/critical)는 서버에 없어
// 3칸이 영구 '-', '전체'는 전 기간 누적이었다(P11). 서버가 주는 사실만 표기한다.
export default function ErStatusWidget() {
  return <ApiStatsWidget widgetId="er-status" endpoint="/api/v1/emergency/stats"
    transform={(d) => ({ ...d, ktas12: (d?.byLevel?.LEVEL_1 ?? 0) + (d?.byLevel?.LEVEL_2 ?? 0), ktas3: d?.byLevel?.LEVEL_3 ?? 0 })}
    stats={[
      { key: 'current', label: '현재 재실', color: 'text-blue-600' },
      { key: 'ktas12', label: 'KTAS 1-2(중증)', color: 'text-red-600' },
      { key: 'ktas3', label: 'KTAS 3', color: 'text-amber-600' },
      { key: 'total', label: '누적 방문(전 기간)' },
    ]} />;
}
