'use client';
import RowListWidget, { asArray } from './RowListWidget';
import { T } from '@/components/ui/i18n-text';

/** 격리 환자 — infection-control/isolation/list (객체) .fromSurveillance[{patientName, isolationType}] */
export default function IsolationWidget() {
  return <RowListWidget widgetId="isolation-list" endpoint="/api/v1/infection-control/isolation/list?limit=8" empty="격리 환자 없음" pick={(d) =>
    asArray(d, 'fromSurveillance').map((it: any) => ({
      key: it.id,
      label: it.patientName ?? <T k="환자" />,
      right: it.isolationType ?? it.infectionType ?? '',
      tone: 'amber' as const,
    }))
  } />;
}
