'use client';
import RowListWidget, { asArray } from './RowListWidget';
import { T } from '@/components/ui/i18n-text';
import { useDurationText } from '@/components/ui/display';

/** 응급 대기 — emergency/queue {patientName, triageLevel, waitingMinutes} */
export default function ErQueueWidget() {
  const fmtDur = useDurationText();
  return <RowListWidget widgetId="er-queue" endpoint="/api/v1/emergency/queue?limit=8" empty="응급 대기 없음" pick={(d) =>
    asArray(d).map((it: any) => ({
      key: it.id,
      label: it.patientName ?? <T k="환자" />,
      right: `KTAS${it.triageLevel ?? '-'}·${fmtDur(it.waitingMinutes ?? 0)}`,
      tone: (it.triageLevel <= 2 ? 'rose' : it.triageLevel === 3 ? 'amber' : 'gray') as 'rose' | 'amber' | 'gray',
    }))
  } />;
}
