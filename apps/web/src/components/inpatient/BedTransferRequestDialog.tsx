'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useTransferWards } from './bed-transfer-common';

/**
 * 병동 간 전동 **요청** — 2026-09-30.
 * 받는 병동·사유(필수)·원하는 병상(선택). 병상은 받는 쪽이 수락하면서 정한다 — 요청만으로는 옮기지 않고 병상을 잡지도 않는다.
 * 같은 병동 안 이동은 요청이 필요 없어 병동 목록에서 뺀다(병상 이동 버튼으로).
 */
export function BedTransferRequestDialog({ admissionId, currentWardId, patientName, onClose }: {
  admissionId: string; currentWardId: string | null; patientName: string; onClose: () => void;
}) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const wardsQ = useTransferWards();
  const [wardId, setWardId] = useState('');
  const [bedId, setBedId] = useState('');
  const [reason, setReason] = useState('');
  const mut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/bed-transfers', { admissionId, targetWardId: wardId, reason: reason.trim(), ...(bedId ? { targetBedId: bedId } : {}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bed-transfers'] });
      toast.success(tAttr('전동을 요청했습니다 — 받는 병동이 수락하면 옮겨집니다.'));
      onClose();
    },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('전동 요청에 실패했습니다.')),
  });
  const wards = (wardsQ.data ?? []).filter((w) => w.id !== currentWardId);
  const ward = wards.find((w) => w.id === wardId);
  const free = (ward?.beds ?? []).filter((b) => b.status === 'AVAILABLE');
  const valid = !!wardId && !!reason.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" data-bed-transfer-dialog>
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-bold text-gray-900"><T k="병동 간 전동 요청" /></h3>
        <p className="text-sm text-gray-700">{patientName}</p>
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800"><T k="받는 병동이 병상을 골라 수락하면 그때 옮겨집니다. 요청만으로는 병상을 잡지 않습니다." /></p>
        {wardsQ.isError ? <QueryErrorFallback error={wardsQ.error} onRetry={() => wardsQ.refetch()} size="compact" /> : (
          <>
            <label className="block text-xs font-semibold text-gray-500"><T k="받는 병동 (필수)" />
              <select value={wardId} onChange={(e) => { setWardId(e.target.value); setBedId(''); }} data-bt-ward className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm">
                <option value="">{wardsQ.isLoading ? tAttr('불러오는 중…') : tAttr('병동 선택')}</option>
                {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            {ward && (
              <label className="block text-xs font-semibold text-gray-500"><T k="원하는 병상 (선택)" />
                <select value={bedId} onChange={(e) => setBedId(e.target.value)} data-bt-bed className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm">
                  <option value="">{tAttr('받는 병동이 정함')}</option>
                  {free.map((b) => <option key={b.id} value={b.id}>{`${b.roomNumber}-${b.bedNumber}`}</option>)}
                </select>
                {free.length === 0 && <span className="mt-1 block text-[11px] text-amber-700"><T k="지금 비어 있는 병상이 없습니다 — 받는 병동이 비는 대로 정합니다." /></span>}
              </label>
            )}
          </>
        )}
        <label className="block text-xs font-semibold text-gray-500"><T k="사유 (필수)" />
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} data-bt-reason className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm text-gray-700"><T k="닫기" /></button>
          <button type="button" onClick={() => mut.mutate()} disabled={!valid || mut.isPending} data-bt-submit className="min-h-[44px] rounded-lg bg-amber-600 px-4 text-sm font-bold text-white disabled:opacity-50">
            <T k="전동 요청" />
          </button>
        </div>
      </div>
    </div>
  );
}
