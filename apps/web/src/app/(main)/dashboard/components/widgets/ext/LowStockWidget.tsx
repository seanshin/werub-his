'use client';
import RowListWidget, { asArray } from './RowListWidget';
import { T } from '@/components/ui/i18n-text';

/** 재고 부족 — pharmacy/inventory/low-stock {nameKo, batches:[{remainingQty}]} */
export default function LowStockWidget() {
  return <RowListWidget widgetId="low-stock" endpoint="/api/v1/pharmacy/inventory/low-stock?limit=8" empty="부족 재고 없음" pick={(d) =>
    asArray(d).map((it: any) => {
      const qty = Array.isArray(it.batches) ? it.batches.reduce((s: number, b: any) => s + (b.remainingQty ?? 0), 0) : 0;
      return {
        key: it.id,
        label: it.nameKo ?? it.code ?? <T k="약품" />,
        right: `${qty}개`,
        tone: 'rose' as const,
      };
    })
  } />;
}
