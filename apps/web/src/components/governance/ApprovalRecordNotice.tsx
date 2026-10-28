'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/**
 * 사용 중(ACTIVE) 카탈로그 항목의 **승인 기록 없음** 고지(2026-10-21 임상 규칙 교차검증 R4) + 승인 기록 남기기(P2).
 *
 * 🔴 종전 상태 전이는 초안 → 사용 중 직행에서 승인자를 남기지 않았다 — 운영 약속처방 26/26 이 승인자 없이 사용 중이었다.
 *    P2 부터 사용 중으로 바꾸는 사람이 승인 기록이 되지만, 이미 사용 중인 것은 **데이터를 고치지 않는다**.
 *    관리자가 근거(위원회 의결 번호 등)와 함께 기록을 남긴다 — 기록하는 사람이 승인자가 되고 근거는 감사 기록에 남는다.
 *    목록을 못 받았으면(undefined) 아무것도 말하지 않는다 — 모르는 것을 0 으로 그리지 않는다.
 */
export function ApprovalRecordNotice({ items, what, recordPath, onRecorded }: {
  items: Array<{ id?: string; name?: string; status: string; approvedBy?: string | null }> | undefined;
  /** 항목 종류 — 번역된 노드(`<T k="약속처방" />`)로 받는다 */
  what: React.ReactNode;
  /** 승인 기록 EP 경로 — 주면 관리자에게 기록 단추가 생긴다 */
  recordPath?: (id: string) => string;
  onRecorded?: () => void;
}) {
  const tA = useTAttr();
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';
  const [open, setOpen] = useState(false);
  const [basis, setBasis] = useState<Record<string, string>>({});
  const record = useMutation({
    mutationFn: (id: string) => apiClient.post(recordPath!(id), { basis: (basis[id] ?? '').trim() }),
    onSuccess: () => { toast.success(tA('승인 기록을 남겼습니다')); onRecorded?.(); },
    onError: (e) => toast.error((e as { message?: string })?.message ?? tA('승인 기록을 남기지 못했습니다')),
  });
  if (!items) return null;
  const active = items.filter((i) => i.status === 'ACTIVE');
  const missingRows = active.filter((i) => !i.approvedBy);
  const missing = missingRows.length;
  if (!missing) return null;
  const canRecord = isAdmin && !!recordPath;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900" data-approval-missing={missing}>
      <p className="font-semibold"><Tf k="사용 중인 {종류} {사용}건 중 {없음}건에 승인 기록이 없습니다" params={{ 종류: what, 사용: active.length, 없음: missing }} /></p>
      <p><T k="승인 절차 없이 사용 중이 된 항목입니다 — 지금은 사용 중으로 바꾸는 사람이 승인 기록이 됩니다. 이미 사용 중인 것은 고치지 않고, 관리자가 근거와 함께 승인 기록을 남깁니다." /></p>
      {canRecord && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-1 text-[12px] font-semibold text-amber-900 underline" data-approval-open>
          <T k="승인 기록 남기기" />
        </button>
      )}
      {canRecord && open && (
        <ul className="mt-2 space-y-1" data-approval-list>
          {missingRows.filter((r) => r.id).map((r) => {
            const b = (basis[r.id!] ?? '').trim();
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2 py-1" data-approval-row={r.id}>
                <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{r.name ?? r.id}</span>
                <input value={basis[r.id!] ?? ''} onChange={(e) => setBasis((m) => ({ ...m, [r.id!]: e.target.value }))}
                  placeholder={tA('승인 근거(위원회 의결 번호 등)')} aria-label={tA('승인 근거')}
                  className="min-h-[36px] w-64 rounded-lg border border-gray-300 px-2 text-[12px]" data-approval-basis={r.id} />
                <button type="button" disabled={b.length < 4 || record.isPending} onClick={() => record.mutate(r.id!)}
                  className="min-h-[36px] rounded-lg bg-amber-700 px-3 text-[12px] font-semibold text-white disabled:opacity-40" data-approval-save={r.id}>
                  <T k="기록" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
