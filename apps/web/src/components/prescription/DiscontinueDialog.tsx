'use client';

import { useState } from 'react';
import { useDiscontinuePrescription } from '@/hooks/useEncounters';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 처방 중단 창 — 2026-09-30 오더 중단 설계.
 *
 * 취소(무효)와 중단은 다른 사실이다: 중단은 **지금 이후**를 멈추고, 이미 조제·투약된 것은 기록·청구에 그대로 남는다.
 * 사유는 비워 둘 수 없다(서버도 400). 어휘를 지어내 고르게 하지 않는다 — 자유 기술(정본은 입력 보조만).
 * 시각이 지났는데 기록되지 않은 투약은 지우지 않는다 — 간호사가 줬는지·빠뜨렸는지 기록할 자리를 남긴다.
 */
export function DiscontinueDialog({ prescriptionId, name, onClose, onDone, note }: {
  prescriptionId: string;
  name: string;
  onClose: () => void;
  onDone?: (r: { cancelledOrders: number; removedFutureMar: number; alreadyDiscontinued: boolean }) => void;
  /** 왜 이 창이 열렸는지(예: 취소가 거부됨) — 호출부가 사실을 한 줄로 */
  note?: string;
}) {
  const tAttr = useTAttr();
  const [reason, setReason] = useState('');
  const mut = useDiscontinuePrescription();

  const submit = async () => {
    if (!reason.trim()) { toast.error(tAttr('중단 사유를 적어 주세요.')); return; }
    try {
      const res = await mut.mutateAsync({ id: prescriptionId, reason: reason.trim() });
      const d = (res?.data ?? res) as { alreadyDiscontinued?: boolean; cancelledOrders?: number; removedFutureMar?: number };
      toast.success(d?.alreadyDiscontinued ? tAttr('이미 중단된 처방입니다.') : tAttr('처방을 중단했습니다.'));
      onDone?.({ cancelledOrders: d?.cancelledOrders ?? 0, removedFutureMar: d?.removedFutureMar ?? 0, alreadyDiscontinued: !!d?.alreadyDiscontinued });
      onClose();
    } catch (e) {
      toast.error(extractErrorMessage(e) || tAttr('처방 중단에 실패했습니다.'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" data-discontinue-dialog>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-bold text-gray-900"><T k="처방 중단" /></h3>
        <p className="mt-1 text-sm font-medium text-gray-800">{name}</p>
        {note && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{note}</p>}
        <ul className="mt-3 space-y-1 text-xs text-gray-600">
          <li>· <T k="지금 이후를 멈춥니다 — 이미 조제·투약된 기록과 청구는 그대로 남습니다." /></li>
          <li>· <T k="아직 접수되지 않은 오더는 취소되고, 앞으로 예정된 투약은 지워집니다." /></li>
          <li>· <T k="시각이 지났는데 기록되지 않은 투약은 남깁니다 — 간호사가 시행·누락을 기록합니다." /></li>
        </ul>
        <label className="mt-3 block text-xs font-semibold text-gray-500" htmlFor="dc-reason"><T k="중단 사유 (필수)" /></label>
        <textarea id="dc-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} data-discontinue-reason
          placeholder={tAttr('예: 부작용(발진) · 치료 종료 · 다른 약으로 변경')}
          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm text-gray-700"><T k="닫기" /></button>
          <button type="button" onClick={() => void submit()} disabled={mut.isPending || !reason.trim()} data-discontinue-submit
            className="min-h-[44px] rounded-lg bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">
            {mut.isPending ? <T k="중단 중…" /> : <T k="중단" />}
          </button>
        </div>
      </div>
    </div>
  );
}
