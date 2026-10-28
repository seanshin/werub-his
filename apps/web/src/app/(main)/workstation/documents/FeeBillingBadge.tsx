'use client';

/**
 * 서류 수수료 ↔ 수납 연결 상태(2026-10-10 · 결정 `documents.fee.billingLink`).
 * 상태는 서버가 **수납 원장에서 파생**한다 — 화면은 받은 그대로 말한다(지어내지 않는다).
 *  · 꺼짐(설정 미정) · 발급 때 수납에 올림 · 진료 연결 없음(창구 따로 수납) · 수수료 없음
 *  · 올리지 못함(그 진료 수납이 없거나 이미 납부 진행 — 재시도 가능) · 미수 · 수납 완료 · 일부 수납 · 취소
 *  · 값이 없으면 "모름"(0·미수로 접지 않는다)
 */
import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

export type FeeBillingState =
  | 'OFF' | 'AWAITING_ISSUE' | 'NO_FEE' | 'NO_ENCOUNTER' | 'NOT_LINKED'
  | 'UNPAID' | 'PAID' | 'PARTIAL' | 'CANCELLED' | 'OTHER';
export type FeeBilling = { mode: 'OFF' | 'BILLING_ITEM'; state: FeeBillingState; billingId: string | null; billingStatus: string | null };

export const FEE_BILLING_LABEL: Record<FeeBillingState, string> = {
  OFF: '수납 연결 꺼짐(설정 미정)',
  AWAITING_ISSUE: '발급 때 수납에 올림',
  NO_FEE: '수수료 없음',
  NO_ENCOUNTER: '진료 연결 없음 — 창구에서 따로 수납',
  NOT_LINKED: '수납에 올리지 못함',
  UNPAID: '수납 항목 생성됨 · 미수',
  PAID: '수납 완료',
  PARTIAL: '일부 수납',
  CANCELLED: '수납 취소됨',
  OTHER: '수납 상태 확인 필요',
};
const TONE: Record<FeeBillingState, string> = {
  OFF: 'bg-gray-50 text-gray-600 border-gray-200',
  AWAITING_ISSUE: 'bg-sky-50 text-sky-800 border-sky-200',
  NO_FEE: 'bg-gray-50 text-gray-600 border-gray-200',
  NO_ENCOUNTER: 'bg-amber-50 text-amber-800 border-amber-200',
  NOT_LINKED: 'bg-rose-50 text-rose-800 border-rose-200',
  UNPAID: 'bg-amber-50 text-amber-800 border-amber-200',
  PAID: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  PARTIAL: 'bg-amber-50 text-amber-800 border-amber-200',
  CANCELLED: 'bg-gray-100 text-gray-600 border-gray-300',
  OTHER: 'bg-gray-50 text-gray-700 border-gray-300',
};

/** 결과 코드(재시도 응답) → 안내 */
const RETRY_RESULT: Record<string, string> = {
  ADDED: '수납에 올렸습니다',
  ALREADY: '이미 수납에 올라 있습니다',
  NO_BILLING: '그 진료의 수납이 아직 없습니다 — 진료 수납이 만들어진 뒤 다시 시도하세요',
  BILLING_NOT_OPEN: '그 진료 수납은 이미 납부가 진행됐습니다 — 창구에서 따로 수납하세요',
  OFF: '수납 연결이 꺼져 있습니다(설정 미정)',
  NO_ENCOUNTER: '진료 연결 없는 서류입니다 — 창구에서 따로 수납하세요',
  NO_FEE: '수수료가 없습니다',
  AWAITING_ISSUE: '발급 전입니다',
};

export function FeeBillingBadge({ value, requestId, canRetry, onChanged }: {
  value: FeeBilling | null | undefined;
  requestId?: string;
  canRetry?: boolean;
  onChanged?: () => void;
}) {
  const tAttr = useTAttr();
  const [busy, setBusy] = useState(false);
  if (!value) {
    return <span className="inline-flex rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500" data-fee-billing="UNKNOWN"><T k="수납 연결 상태 모름" /></span>;
  }
  const retry = async () => {
    if (!canRetry || !requestId) return; // 처리 역할만 — 원무(접수만)는 서버도 403
    setBusy(true);
    try {
      const r = await apiClient.post<{ data: { result: string } }>(`/api/v1/staff/document-requests/${requestId}/fee-billing`, {});
      const code = (r as { data?: { result?: string } })?.data?.result ?? '';
      const msg = RETRY_RESULT[code];
      if (code === 'ADDED' || code === 'ALREADY') toast.success(tAttr(msg));
      else toast.warning(msg ? tAttr(msg) : code);
      onChanged?.();
    } catch (e) {
      toast.error((e as { message?: string })?.message || tAttr('수납에 올리지 못했습니다'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] ${TONE[value.state] ?? TONE.OTHER}`} data-fee-billing={value.state}>
        <T k={FEE_BILLING_LABEL[value.state] ?? FEE_BILLING_LABEL.OTHER} />
      </span>
      {value.state === 'NOT_LINKED' && canRetry && requestId && (
        <button type="button" onClick={retry} disabled={busy} data-fee-billing-retry
          className="min-h-[44px] rounded-lg border border-rose-300 bg-white px-3 text-xs font-medium text-rose-800 hover:bg-rose-50 disabled:opacity-50">
          <T k={busy ? '올리는 중…' : '수납에 다시 올리기'} />
        </button>
      )}
    </span>
  );
}
