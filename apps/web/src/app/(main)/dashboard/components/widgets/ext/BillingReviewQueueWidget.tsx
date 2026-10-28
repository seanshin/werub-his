'use client';

import RowListWidget, { asArray, type Row } from './RowListWidget';
import { kdate } from '@/lib/ui-settings';

/**
 * 청구 검토 대기 — BE `GET /api/v1/billing/review-queue`(최근 7일).
 * 응급청구 실패(ER_BILLING_FAILED) · 정정 검토(BILLING_AMEND_REVIEW) ·
 * 자동 청구 생성 실패(BILLING_CREATE_FAILED)를 통합해 수납/원무에 노출.
 * 🔴 종류 정본은 서버(`BillingService.REVIEW_QUEUE_KINDS`) — 라벨을 화면에서 다시 정하지 않는다.
 */
export default function BillingReviewQueueWidget() {
  return (
    <RowListWidget
      widgetId="billing-review-queue"
      endpoint="/api/v1/billing/review-queue"
      empty="검토 대기 항목 없음"
      pick={(data): Row[] =>
        asArray(data, 'items').map((it: any) => ({
          key: it.id,
          label: `${it.kindLabel} · ${it.patientName}${it.mrn ? ` (${it.mrn})` : ''}`,
          right: it.at ?kdate(it.at, 'monthDay') : '',
          // 실패 계열(응급청구·자동생성)은 rose, 검토 계열은 amber
          tone: it.kind.endsWith('_FAILED') ? 'rose' : 'amber',
        }))
      }
    />
  );
}
