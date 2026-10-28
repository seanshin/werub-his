'use client';
import RowListWidget, { asArray } from './RowListWidget';
import { Tf } from '@/components/ui/i18n-text';

/** 다빈도 상병 — executive/top-diagnoses {code, name, count} */
export default function ChartTopDxWidget() {
  return <RowListWidget widgetId="chart-top-dx" endpoint="/api/v1/executive/top-diagnoses" empty="상병 데이터 없음" pick={(d) =>
    asArray(d).map((it: any) => ({
      key: it.code,
      label: it.name ?? it.code ?? '-',
      right: <Tf k="{수}건" params={{ 수: it.count ?? 0 }} />,
    }))
  } />;
}
