'use client';
import ApiStatsWidget from '../ApiStatsWidget';
import { adrSummary } from '@/lib/widget-summaries';

// 🔴 서버 /api/v1/pharmacy/adr/stats 는 groupBy 배열 [{suspectedDrugCode, severity, _count:{id}}].
//    위젯이 total·thisMonth·serious·resolved 를 평면 키로 읽어 4칸 전부 영구 '-' 였다(P11).
// 🔴 `thisMonth`(발생월)·`resolved`(outcome) 는 이 groupBy 에 원천적으로 없다 — 0 으로 채우면
//    "이번달 ADR 없음"이라는 없는 사실을 만든다. 파생 가능한 축(중증도·의심약물)으로 바꾼다.
export default function AdrStatsWidget() {
  return <ApiStatsWidget widgetId="adr-stats" endpoint="/api/v1/pharmacy/adr/stats" transform={adrSummary}
    stats={[
      { key: 'total', label: '전체 ADR' },
      { key: 'severe', label: '중증·사망', color: 'text-red-600' },
      { key: 'moderate', label: '중등도', color: 'text-amber-600' },
      { key: 'drugs', label: '의심약물 수', color: 'text-indigo-600' },
    ]} />;
}
