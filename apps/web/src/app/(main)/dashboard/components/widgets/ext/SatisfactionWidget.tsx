'use client';
import ApiStatsWidget from '../ApiStatsWidget';
import { satisfactionSummary } from '@/lib/widget-summaries';
import { RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { T } from '@/components/ui/i18n-text';

// 🔴 서버 /api/v1/satisfaction/stats/department 는 배열 [{department, nps, responseCount, itemScores}].
//    위젯이 averageNps·responses·promoters·detractors 를 평면 키로 읽어 4칸 전부 영구 '-' 였다(P11).
// 🔴 추천/비추천 원수는 응답에 없다(서버가 이미 NPS 로 집계) — FE 가 다시 만들지 않는다(P12).
//    응답이 0건이면 평균 NPS 는 0 이 아니라 '산출 불가'(표본 부재 ≠ 최악의 점수).
export default function SatisfactionWidget() {
  return <ApiStatsWidget widgetId="satisfaction" endpoint="/api/v1/satisfaction/stats/department" transform={satisfactionSummary}
    stats={[
      { key: 'avgNps', label: '평균 NPS(응답가중)', color: 'text-blue-600', format: (v: number | null) => (v == null ? <T k={RATIO_UNAVAILABLE} /> : String(v)) },
      { key: 'responses', label: '응답 수' },
      { key: 'departments', label: '집계 부서' },
      { key: 'worstNps', label: '최저 부서 NPS', color: 'text-red-600', format: (v: number | null) => (v == null ? '-' : String(v)) },
    ]} />;
}
