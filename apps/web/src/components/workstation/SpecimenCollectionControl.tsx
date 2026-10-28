'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { kdate } from '@/lib/ui-settings';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 검체 채취 기록(2026-10-01) — 검사실 **접수와 다른 사건**. 채취한 사람이 채취한 순간에 누른다.
 *  · 기록됨: 채취 시각·채취자·(지난 시각 입력이면) "입력된 시각" 표식
 *  · 기록 없음: [지금 채취] — 채취하며 누름 · [시각 입력] — 지난 시각(미래·발행 전·접수 뒤는 서버가 거절하고 화면이 그 문장을 보인다)
 *  · 🔴 접수된 뒤 기록이 없으면 "채취 기록 없음"이라고 말한다(접수 시각을 채취로 보이지 않는다)
 */
export function SpecimenCollectionControl({
  orderId, collectedAt, collectorName, source, invalidateKeys, compact = false,
}: {
  orderId: string;
  collectedAt?: string | null;
  collectorName?: string | null;
  source?: string | null;
  invalidateKeys: unknown[][];
  compact?: boolean;
}) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [entering, setEntering] = useState(false);
  const [value, setValue] = useState('');
  const save = useMutation({
    mutationFn: (body: { collectedAt?: string }) => apiClient.patch(`/api/v1/workstation/order/${orderId}/specimen-collection`, body),
    onSuccess: () => {
      for (const k of invalidateKeys) qc.invalidateQueries({ queryKey: k });
      setEntering(false);
      toast.success(tAttr('채취를 기록했습니다'));
    },
    // 서버가 거절한 이유(미래·발행 전·접수 뒤·이미 기록)를 그대로 보인다
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('채취를 기록하지 못했습니다')),
  });

  if (collectedAt) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1 text-[11px] text-emerald-800" data-specimen-collected>
        <span aria-hidden>🩸</span>
        <T k="채취" /> <span className="tabular-nums">{kdate(new Date(collectedAt), 'datetimeShort')}</span>
        {collectorName && <span className="text-gray-500">· {collectorName}</span>}
        {source === 'ENTERED_LATER' && <span className="rounded bg-amber-50 px-1 text-[10px] text-amber-700"><T k="입력된 시각" /></span>}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-specimen-pending>
      {!compact && <span className="text-[11px] text-gray-500"><T k="채취 기록 없음" /></span>}
      {entering ? (
        <>
          <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} aria-label={tAttr('채취 시각')}
            className="min-h-[36px] rounded-lg border border-gray-300 px-2 text-xs" />
          <button type="button" disabled={!value || save.isPending}
            onClick={() => save.mutate({ collectedAt: new Date(value).toISOString() })}
            className="min-h-[36px] rounded-lg bg-rose-600 px-3 text-xs font-medium text-white disabled:opacity-50"><T k="저장" /></button>
          <button type="button" onClick={() => setEntering(false)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs text-gray-600"><T k="취소" /></button>
        </>
      ) : (
        <>
          <button type="button" disabled={save.isPending} onClick={() => save.mutate({})}
            className="min-h-[44px] rounded-xl bg-rose-600 px-3 text-xs font-medium text-white shadow-sm hover:bg-rose-700 disabled:opacity-50">
            🩸 <T k="지금 채취" />
          </button>
          <button type="button" onClick={() => setEntering(true)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs text-gray-600 hover:bg-gray-50">
            <T k="시각 입력" />
          </button>
        </>
      )}
    </span>
  );
}
