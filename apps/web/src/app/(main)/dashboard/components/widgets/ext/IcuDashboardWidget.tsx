'use client';
import ApiStatsWidget from '../ApiStatsWidget';
import { Ratio } from '@/components/ui/display';

// 🔴 서버 /api/v1/icu/dashboard 는 { totalBeds, occupied, available, occupancyRate, ventilatorCount, ... }.
//    위젯이 `ventilator` 를 읽었는데 서버 키는 `ventilatorCount` 라 인공호흡기 칸이 영구 '-' 였다(P11).
// 🔴 2026-08-20 — 가동률 칸이 분모 없는 퍼센트였다. 서버가 분자(occupied)·분모(totalBeds)를 이미 주는데
//    `format:(v)=>string` 시그니처가 그 값에 닿지 못했다 → row 를 받아 정본 `<Ratio>` 로 그린다.
//    (서버도 같은 날 `등록 ICU 병상 0 → occupancyRate: 0` 을 `null` 로 봉합했다.)
const n = (v: unknown) => (typeof v === 'number' ? v : null);

export default function IcuDashboardWidget() {
  return <ApiStatsWidget widgetId="icu-dashboard" endpoint="/api/v1/icu/dashboard" stats={[
    { key: 'totalBeds', label: '총 병상' },
    { key: 'occupied', label: '사용 중', color: 'text-blue-600' },
    { key: 'ventilatorCount', label: '인공호흡기', color: 'text-red-600' },
    {
      key: 'occupancyRate',
      label: '가동률(사용중/등록)',
      format: (_v, row) => <Ratio className="text-sm" numerator={n(row?.occupied)} denominator={n(row?.totalBeds)} unavailableHint="등록 ICU 병상 0" />,
    },
  ]} />;
}
