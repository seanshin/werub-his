'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 대체조제 판정(승인·거부) — 2026-09-30.
 * 서버가 **누가·언제·왜**를 남긴다(decidedBy/decidedAt/decisionNote). 거부는 사유 필수(약사가 다음 조치를 정한다) · 승인 메모는 선택.
 * 판정 권한(책임 처방의 본인·관리자)은 서버가 정한다 — 여기서 넓히지 않는다.
 */
export function SubstitutionDecision({ id, onDone }: { id: string; onDone?: () => void }) {
  const tAttr = useTAttr();
  const [mode, setMode] = useState<null | 'approve' | 'reject'>(null);
  const [note, setNote] = useState('');
  const mut = useMutation({
    mutationFn: ({ approve, note: n }: { approve: boolean; note: string }) =>
      apiClient.patch(`/api/v1/pharmacy/substitution/${id}/${approve ? 'approve' : 'reject'}`, n ? { note: n } : {}),
  });
  const submit = async () => {
    const approve = mode === 'approve';
    const n = note.trim();
    if (!approve && !n) { toast.error(tAttr('거부 사유를 적어 주세요.')); return; }
    try {
      await mut.mutateAsync({ approve, note: n });
      toast.success(tAttr(approve ? '대체조제를 승인했습니다' : '대체조제를 거부했습니다'));
      setMode(null); setNote('');
      onDone?.();
    } catch (e) { toast.error(extractErrorMessage(e) || tAttr('대체조제 판정에 실패했습니다.')); }
  };

  if (!mode) {
    return (
      <div className="flex gap-1.5">
        <button type="button" data-sub-approve onClick={() => setMode('approve')} className="min-h-[44px] px-3 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="승인" /></button>
        <button type="button" data-sub-reject onClick={() => setMode('reject')} className="min-h-[44px] px-3 text-xs font-medium bg-red-100 text-red-700 rounded-lg hover:bg-red-200"><T k="거부" /></button>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-72" data-sub-decide={mode}>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} data-sub-note
        placeholder={mode === 'reject' ? tAttr('거부 사유(필수)') : tAttr('승인 메모(선택)')}
        className="rounded-lg border border-gray-200 px-2 py-2 text-xs" />
      <div className="flex gap-1.5">
        <button type="button" onClick={() => void submit()} disabled={mut.isPending || (mode === 'reject' && !note.trim())} data-sub-confirm
          className={`min-h-[44px] flex-1 px-3 text-xs font-semibold rounded-lg text-white disabled:opacity-50 ${mode === 'approve' ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {mode === 'approve' ? <T k="승인 확정" /> : <T k="거부 확정" />}
        </button>
        <button type="button" onClick={() => { setMode(null); setNote(''); }} className="min-h-[44px] px-3 text-xs rounded-lg border border-gray-300 text-gray-700"><T k="닫기" /></button>
      </div>
    </div>
  );
}
