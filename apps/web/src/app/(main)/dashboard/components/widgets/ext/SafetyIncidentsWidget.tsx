'use client';
import ApiStatsWidget from '../ApiStatsWidget';

/**
 * 안전사건 요약 위젯.
 *
 * 🔴 4칸 중 3칸이 영구 `-` 였다(2026-08-14·W7·P11).
 *    위젯은 `falls`·`medication`·`thisMonth` 를 읽는데 `/api/v1/safety/incidents/stats`
 *    응답 키는 `{total, rcaCompleted, byType, bySeverity, byStatus, monthly}` 뿐이라
 *    세 키 모두 존재하지 않아 `val ?? '-'` 로 렌더됐다(FE↔서버 계약 불일치).
 *    → 서버가 실제로 계산해 내려주도록 고치고, 라벨에 **기간**을 밝힌다
 *      (`/safety` 는 전 기간 누적, `/safety-quality-board` 는 최근 30일이라 수가 다르다).
 */
export default function SafetyIncidentsWidget() {
  return (
    <ApiStatsWidget
      widgetId="safety-incidents"
      endpoint="/api/v1/safety/incidents/stats"
      stats={[
        { key: 'total', label: '전체 사건(누적)' },
        { key: 'falls', label: '낙상(누적)', color: 'text-amber-600' },
        { key: 'medication', label: '투약(누적)', color: 'text-red-600' },
        { key: 'thisMonth', label: '이번달 발생' },
      ]}
    />
  );
}
