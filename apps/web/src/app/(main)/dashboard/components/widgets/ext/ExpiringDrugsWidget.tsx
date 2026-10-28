'use client';
import RowListWidget, { asArray } from './RowListWidget';
import { T } from '@/components/ui/i18n-text';
import { KDate } from '@/components/ui/display';

/** 유효기간 임박 — pharmacy/inventory/expiring {medicationCode:{nameKo}, expirationDate, remainingQty} */
export default function ExpiringDrugsWidget() {
  return <RowListWidget widgetId="expiring-drugs" endpoint="/api/v1/pharmacy/inventory/expiring?limit=8" empty="임박 재고 없음" pick={(d) =>
    asArray(d).map((it: any) => ({
      key: it.id,
      label: it.medicationCode?.nameKo ?? it.medicationCode?.code ?? <T k="약품" />,
      // 🔴 (2026-10-02) `toISOString().slice(0,10)` 은 UTC 날짜 — 유효기간이 하루 앞당겨 보일 수 있다 → 표시 정본
      right: it.expirationDate ? <KDate value={it.expirationDate} /> : '',
      tone: 'amber' as const,
    }))
  } />;
}
