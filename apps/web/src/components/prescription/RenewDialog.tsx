'use client';

import { useState } from 'react';
import { useRenewPrescription } from '@/hooks/useEncounters';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/**
 * 처방 갱신 창 — 2026-09-30 지속 처방 갱신·만료.
 *
 * 갱신은 **새 결정**이다: 일수·총량을 의사가 정한다(원처방 값을 그대로 복사해 채우지 않는다 — 비어 있으면 보내지 않는다).
 * 원처방은 같은 순간 중단된다(두 줄이 겹쳐 같은 약이 이중 투약되지 않게). 새 처방은 DUR·처방집·사전승인을 다시 지난다.
 */
export function RenewDialog({ prescriptionId, name, current, onClose, onDone }: {
  prescriptionId: string;
  name: string;
  /** 참고로만 보여 준다(입력칸에 넣지 않는다) */
  current?: { dosage?: string | null; frequency?: string | null; duration?: number | null; quantity?: number | null };
  onClose: () => void;
  onDone?: () => void;
}) {
  const tAttr = useTAttr();
  const [days, setDays] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [durBlocked, setDurBlocked] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const mut = useRenewPrescription();
  const d = Number(days); const q = Number(quantity);
  const valid = Number.isInteger(d) && d >= 1 && Number.isInteger(q) && q >= 1;

  const submit = async () => {
    if (!valid) { toast.error(tAttr('갱신 일수와 총량을 1 이상의 정수로 적어 주세요.')); return; }
    try {
      await mut.mutateAsync({ id: prescriptionId, days: d, quantity: q, reason: reason.trim() || undefined, ...(durBlocked ? { overrideDur: true, overrideReason: overrideReason.trim() } : {}) });
      toast.success(tAttr('처방을 갱신했습니다 — 원처방은 중단되었습니다.'));
      onDone?.();
      onClose();
    } catch (e) {
      // DUR 차단이면 사유를 받아 강제 갱신을 한 번 더 할 수 있게(서버가 사유를 다시 검사한다)
      const details = (e as { details?: { durWarnings?: unknown[] } })?.details;
      if (details?.durWarnings && !durBlocked) { setDurBlocked(extractErrorMessage(e) || 'DUR'); return; }
      toast.error(extractErrorMessage(e) || tAttr('처방 갱신에 실패했습니다.'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" data-renew-dialog>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-bold text-gray-900"><T k="처방 갱신" /></h3>
        <p className="mt-1 text-sm font-medium text-gray-800">{name}</p>
        {current && (
          <p className="mt-1 text-xs text-gray-500">
            <T k="원처방" />: {[current.dosage, current.frequency, current.duration != null ? `${current.duration}일` : null, current.quantity != null ? `총 ${current.quantity}` : null].filter(Boolean).join(' · ') || '—'}
          </p>
        )}
        <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800"><T k="새 처방으로 이어집니다 — 원처방은 지금 중단되고, 새 처방은 DUR·처방집·사전승인을 다시 거칩니다." /></p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-gray-500"><T k="갱신 일수 (필수)" />
            <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} data-renew-days className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-gray-500"><T k="총량 (필수)" />
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} data-renew-quantity className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </label>
        </div>
        <label className="mt-3 block text-xs font-semibold text-gray-500"><T k="메모 (선택)" />
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </label>
        {durBlocked && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" data-renew-dur>
            <p className="font-semibold"><T k="DUR 경고로 막혔습니다" /> — {durBlocked}</p>
            <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder={tAttr('강제 갱신 사유(필수)')} className="mt-2 w-full rounded border border-red-200 bg-white px-2 py-1.5 text-xs" />
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm text-gray-700"><T k="닫기" /></button>
          <button type="button" onClick={() => void submit()} disabled={mut.isPending || !valid || (!!durBlocked && !overrideReason.trim())} data-renew-submit
            className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            {mut.isPending ? <T k="갱신 중…" /> : durBlocked ? <T k="사유와 함께 갱신" /> : <Tf k="{d}일 갱신" params={{ d: valid ? d : '—' }} />}
          </button>
        </div>
      </div>
    </div>
  );
}
