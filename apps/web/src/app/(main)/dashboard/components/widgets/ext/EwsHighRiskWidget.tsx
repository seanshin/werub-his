'use client';
import RowListWidget, { asArray } from './RowListWidget';
import { T, Tf } from '@/components/ui/i18n-text';

/** EWS 고위험 — safety/ews/high-risk {totalScore, riskLevel, patient:{familyName,givenName}} */
export default function EwsHighRiskWidget() {
  return <RowListWidget widgetId="ews-high-risk" endpoint="/api/v1/safety/ews/high-risk?limit=5" empty="고위험 환자 없음" pick={(d) =>
    asArray(d).map((it: any) => ({
      key: it.id,
      label: `${it.patient?.familyName ?? ''}${it.patient?.givenName ?? ''}` || <T k="환자" />,
      right: <Tf k="{점수}점" params={{ 점수: it.totalScore ?? 0 }} />,
      tone: (it.riskLevel === 'HIGH' ? 'rose' : 'amber') as 'rose' | 'amber',
    }))
  } />;
}
