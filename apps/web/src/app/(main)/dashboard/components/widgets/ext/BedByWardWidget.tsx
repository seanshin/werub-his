'use client';
import { ratioText } from '@hospital-run/shared';
import RowListWidget, { asArray } from './RowListWidget';
import { T } from '@/components/ui/i18n-text';

/**
 * 병동별 병상 — beds/wards {name, beds:[{status, patient}]} → 재원/전체.
 * 🔴 병상이 0인 병동을 `0%`(=여유 있음)로 그리던 것을 정본 `ratioText` 로 수렴 — 분모 0 이면 '산출 불가'.
 */
export default function BedByWardWidget() {
  return <RowListWidget widgetId="bed-by-ward" endpoint="/api/v1/beds/wards" empty="병동 데이터 없음" pick={(d) =>
    asArray(d).map((w: any) => {
      const beds = Array.isArray(w.beds) ? w.beds : [];
      const total = beds.length;
      const occupied = beds.filter((b: any) => b.patient || b.status === 'OCCUPIED').length;
      const rate = total ? Math.round((occupied / total) * 100) : 0;
      return {
        key: w.id,
        label: w.name ?? <T k="병동" />,
        right: ratioText(occupied, total),
        tone: (rate >= 90 ? 'rose' : rate >= 75 ? 'amber' : 'gray') as 'rose' | 'amber' | 'gray',
      };
    })
  } />;
}
