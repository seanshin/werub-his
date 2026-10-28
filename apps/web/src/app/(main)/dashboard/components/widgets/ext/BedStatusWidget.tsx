'use client';
import ApiStatsWidget from '../ApiStatsWidget';
import { bedStatusSummary, type BedStatusSummary } from '@/lib/widget-summaries';
import { Ratio } from '@/components/ui/display';

// 🔴 서버 /api/v1/beds/status 는 { total, byStatus:[{status,_count}] } 를 준다.
//    위젯이 occupied·available·occupancyRate 를 평면 키로 읽어 4칸 중 3칸이 영구 '-' 였다(P11).
//    가동률은 등록 병상 0 이면 0% 가 아니라 '산출 불가'(/executive bedOccupancyPct 와 같은 규약).
// 🔴 2026-08-20 — 가동률 칸이 `72%` 처럼 **분모 없는 퍼센트**였다(2병상 중 1개도 50%).
//    `format` 이 응답 전체(row)를 받게 되어, 정본 `<Ratio>` 로 `사용중 / 등록 (p%)` 를 그린다.
export default function BedStatusWidget() {
  return <ApiStatsWidget widgetId="bed-status" endpoint="/api/v1/beds/status" transform={bedStatusSummary}
    stats={[
      { key: 'total', label: '총 병상' },
      { key: 'occupied', label: '사용 중', color: 'text-blue-600' },
      { key: 'available', label: '가용', color: 'text-emerald-600' },
      {
        key: 'occupancyRate',
        label: '가동률(사용중/등록)',
        format: (_v, row) => {
          const s = row as unknown as BedStatusSummary | undefined;
          return <Ratio className="text-sm" numerator={s?.occupied} denominator={s?.total} unavailableHint="등록 병상 0" />;
        },
      },
    ]} />;
}
