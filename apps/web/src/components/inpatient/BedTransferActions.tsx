'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 전동 요청 한 건의 처리(수락·거절·취소) — 2026-09-30.
 * 권한은 서버와 같게: 수락·거절 = 간호사·관리자(병상 이동 권한) · 취소 = 요청자·관리자.
 * 역할 검사는 이 부품 안에 둔다(페이지에 두면 역할 스캐너가 목록 조회까지 '게이트 달린 호출'로 본다).
 */
export function BedTransferActions({ item, beds, incoming }: {
  item: { id: string; requestedById: string; targetBed: { id: string } | null };
  beds: { id: string; roomNumber: string; bedNumber: string; status: string }[];
  incoming: boolean;
}) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canDecide = user?.role === 'NURSE' || user?.role === 'ADMIN';
  const canCancel = item.requestedById === user?.id || user?.role === 'ADMIN';
  const [me, setMe] = useState<{ mode: 'accept' | 'reject' | 'cancel'; bedId: string; text: string } | null>(null);
  const act = useMutation({
    mutationFn: (a: { mode: 'accept' | 'reject' | 'cancel'; bedId: string; text: string }) =>
      a.mode === 'accept' ? apiClient.post(`/api/v1/bed-transfers/${item.id}/accept`, { bedId: a.bedId, ...(a.text.trim() ? { note: a.text.trim() } : {}) })
      : a.mode === 'reject' ? apiClient.post(`/api/v1/bed-transfers/${item.id}/reject`, { reason: a.text.trim() })
      : apiClient.post(`/api/v1/bed-transfers/${item.id}/cancel`, a.text.trim() ? { reason: a.text.trim() } : {}),
    onSuccess: (_r, a) => {
      qc.invalidateQueries({ queryKey: ['bed-transfers'] });
      qc.invalidateQueries({ queryKey: ['bed-transfer-wards'] });
      qc.invalidateQueries({ queryKey: ['inpatients'] });
      toast.success(tAttr(a.mode === 'accept' ? '수락했습니다 — 환자가 새 병상으로 옮겨졌습니다.' : a.mode === 'reject' ? '거절했습니다.' : '요청을 취소했습니다.'));
      setMe(null);
    },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('처리에 실패했습니다.')),
  });

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {incoming && canDecide && !me && <>
        <button type="button" onClick={() => setMe({ mode: 'accept', bedId: item.targetBed?.id ?? '', text: '' })} data-bt-accept className="min-h-[44px] rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white"><T k="수락" /></button>
        <button type="button" onClick={() => setMe({ mode: 'reject', bedId: '', text: '' })} data-bt-reject className="min-h-[44px] rounded-lg bg-red-100 px-3 text-xs font-semibold text-red-700"><T k="거절" /></button>
      </>}
      {canCancel && !me && (
        <button type="button" onClick={() => setMe({ mode: 'cancel', bedId: '', text: '' })} data-bt-cancel className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-xs text-gray-700"><T k="요청 취소" /></button>
      )}
      {me && (
        <div className="flex w-full flex-col gap-1.5 sm:w-96" data-bt-acting={me.mode}>
          {me.mode === 'accept' && (
            <select value={me.bedId} onChange={(e) => setMe({ ...me, bedId: e.target.value })} data-bt-accept-bed className="rounded-lg border border-gray-200 px-2 py-2 text-xs">
              <option value="">{tAttr('병상 선택')}</option>
              {/* 전실은 비어 있는(AVAILABLE) 병상만 잡는다 — 예약·청소 중인 병상은 고를 수 없게 보인다 */}
              {beds.map((b) => <option key={b.id} value={b.id} disabled={b.status !== 'AVAILABLE'}>{`${b.roomNumber}-${b.bedNumber}${b.status !== 'AVAILABLE' ? ` (${b.status})` : ''}`}</option>)}
            </select>
          )}
          <input value={me.text} onChange={(e) => setMe({ ...me, text: e.target.value })} maxLength={1000} data-bt-text
            placeholder={me.mode === 'reject' ? tAttr('거절 사유(필수)') : tAttr('메모(선택)')} className="rounded-lg border border-gray-200 px-2 py-2 text-xs" />
          <div className="flex gap-1.5">
            <button type="button" onClick={() => act.mutate(me)} disabled={act.isPending || (me.mode === 'accept' && !me.bedId) || (me.mode === 'reject' && !me.text.trim())} data-bt-confirm
              className="min-h-[44px] flex-1 rounded-lg bg-gray-900 px-3 text-xs font-semibold text-white disabled:opacity-50"><T k="확인" /></button>
            <button type="button" onClick={() => setMe(null)} className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-xs"><T k="닫기" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
