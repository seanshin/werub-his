'use client';
import { ReasonInput } from '@/components/ui/ReasonInput';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { money } from '@/lib/ui-settings';

import { EmptyState, Money } from '@/components/ui/display';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

// 심사 삭감 조정 라인 (R3-3) — 사유코드별 라인 기록·정합 경고·재작업 큐
interface Adjustment {
  id: string; lineRef?: string | null; itemName?: string | null;
  adjustCode: string; adjustReason?: string | null; amount: number; status: string; createdAt: string;
}
const STATUS: Record<string, { ko: string; cls: string }> = {
  ACCEPTED: { ko: '수용', cls: 'bg-gray-100 text-gray-600' },
  APPEALING: { ko: '이의신청', cls: 'bg-amber-100 text-amber-700' },
  REWORK: { ko: '재작업', cls: 'bg-blue-100 text-blue-700' },
  RESOLVED: { ko: '해소', cls: 'bg-emerald-100 text-emerald-700' },
};
const unwrap = <T,>(r: unknown): T => {
  const raw = (r as { data?: unknown })?.data as { data?: T } | T | undefined;
  return ((raw as { data?: T })?.data ?? raw) as T;
};
const emptyLine = () => ({ adjustCode: '', itemName: '', adjustReason: '', amount: '' });

export default function ClaimAdjustmentSection({ claimId, reducedAmount }: { claimId: string; reducedAmount?: number }) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const qc = useQueryClient();
  const [lines, setLines] = useState<ReturnType<typeof emptyLine>[]>([emptyLine()]);
  const [open, setOpen] = useState(false);

  const list = useQuery({
    queryKey: ['claim-adjustments', claimId],
    queryFn: () => apiClient.get(`/api/v1/claims/${claimId}/adjustments`).then((r) => unwrap<Adjustment[]>(r) ?? []),
  });

  const add = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/claims/${claimId}/adjustments`, {
      lines: lines
        .filter((l) => l.adjustCode.trim() && Number(l.amount) > 0)
        .map((l) => ({ adjustCode: l.adjustCode.trim(), itemName: l.itemName || undefined, adjustReason: l.adjustReason || undefined, amount: Number(l.amount) })),
    }),
    onSuccess: (r) => {
      const d = unwrap<{ created: number; warning?: string }>(r);
      toast.success(tfAttr('조정 라인 {건수}건 기록', { 건수: d.created }));
      if (d.warning) toast.error(d.warning);
      setLines([emptyLine()]); setOpen(false);
      qc.invalidateQueries({ queryKey: ['claim-adjustments', claimId] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('기록 실패')),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/api/v1/claims/adjustments/${id}/status`, { status }),
    onSuccess: () => { toast.success(tAttr('상태 변경')); qc.invalidateQueries({ queryKey: ['claim-adjustments', claimId] }); },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('변경 실패')),
  });

  const items = list.data ?? [];
  const lineSum = items.reduce((s, a) => s + a.amount, 0);
  const mismatch = reducedAmount != null && reducedAmount > 0 && lineSum !== reducedAmount;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900"><T k="심사 삭감 조정" /> <span className="text-xs font-normal text-gray-400"><T k="(사유코드 라인·재작업 큐)" /></span></h2>
        <button onClick={() => setOpen((v) => !v)} className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <T k={open ? '닫기' : '+ 조정 라인 기록'} />
        </button>
      </div>

      {reducedAmount != null && reducedAmount > 0 && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-xs ${mismatch ? 'bg-rose-50 text-rose-700' : 'bg-gray-50 text-gray-500'}`}>
          <Tf k="청구 삭감 총액 {삭감총액} · 라인 합계 {라인합계}" params={{ 삭감총액: <strong><Money value={reducedAmount} /></strong>, 라인합계: <strong><Money value={lineSum} /></strong> }} />
          {mismatch && <> — <Tf k="차이 {차이} (라인 누락/중복 확인)" params={{ 차이: money(Math.abs(reducedAmount - lineSum)) }} /></>}
        </div>
      )}

      {open && (
        <div className="mb-4 rounded-lg bg-gray-50 p-3 space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input value={l.adjustCode} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, adjustCode: e.target.value } : x))} placeholder={tAttr('사유코드*')} maxLength={20} className="col-span-2 px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
              <input value={l.itemName} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, itemName: e.target.value } : x))} placeholder={tAttr('항목명')} maxLength={200} className="col-span-4 px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
              <div className="col-span-3"><ReasonInput domain="claimAdjust" maxLength={300} value={l.adjustReason} onChange={(v) => setLines(lines.map((x, j) => j === i ? { ...x, adjustReason: v } : x))} placeholder="사유" className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg" /></div>
              <input type="number" value={l.amount} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} placeholder={tAttr('금액*')} className="col-span-2 px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
              <button onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1} className="col-span-1 text-xs text-rose-500 disabled:opacity-30"><T k="삭제" /></button>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <button onClick={() => setLines([...lines, emptyLine()])} className="text-xs text-blue-600"><T k="+ 라인 추가" /></button>
            <button disabled={add.isPending || !lines.some((l) => l.adjustCode.trim() && Number(l.amount) > 0)} onClick={() => add.mutate()}
              className="ml-auto px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg disabled:opacity-40"><T k="기록@버튼" /></button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState icon="📝" title="기록된 조정 라인이 없습니다" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500 text-left">
                <th className="py-2"><T k="사유코드" /></th><th className="py-2"><T k="항목" /></th><th className="py-2"><T k="사유" /></th>
                <th className="py-2 text-right"><T k="금액" /></th><th className="py-2 text-center"><T k="상태" /></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b border-gray-50">
                  <td className="py-2 text-xs font-medium text-gray-800">{a.adjustCode}</td>
                  <td className="py-2 text-xs text-gray-600">{a.itemName ?? '—'}</td>
                  <td className="py-2 text-xs text-gray-500">{a.adjustReason ?? '—'}</td>
                  <td className="py-2 text-xs text-right text-rose-600">-<Money value={a.amount} /></td>
                  <td className="py-2 text-center">
                    <select value={a.status} onChange={(e) => setStatus.mutate({ id: a.id, status: e.target.value })}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border-0 cursor-pointer ${STATUS[a.status]?.cls ?? ''}`}>
                      {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{tAttr(v.ko)}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
