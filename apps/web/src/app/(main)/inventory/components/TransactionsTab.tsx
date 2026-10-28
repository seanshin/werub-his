'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MutationError, InventoryItem } from '@hospital-run/shared';
import { Transaction, statusBadge, Th, Td, EmptyRow, Btn, Input, Select, Label, Card, FormGrid } from './shared-ui';
import { ReasonInput } from '@/components/ui/ReasonInput';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { kdate } from '@/lib/ui-settings';

export function TransactionsTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ itemId: '', type: 'IN', quantity: '', reason: '' });
  const { data: txData, isLoading } = useQuery({ queryKey: ['inventory-tx'], queryFn: () => apiClient.get<{ data: Transaction[] }>('/api/v1/inventory/transactions') });
  const { data: itemData } = useQuery({ queryKey: ['inventory'], queryFn: () => apiClient.get<{ data: InventoryItem[] }>('/api/v1/inventory') });
  const add = useMutation({ mutationFn: (b: typeof form) => apiClient.post(`/api/v1/inventory/${b.itemId}/transaction`, { type: b.type, quantity: Number(b.quantity), reason: b.reason }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-tx'] }); setShowForm(false); }, onError: (e: MutationError) => alert(e?.message ?? e?.error?.message ?? '입출고 처리에 실패했습니다.') });
  const _txRaw = txData?.data;
  const txs: Transaction[] = Array.isArray(_txRaw) ? _txRaw : (_txRaw as unknown as { data?: Transaction[] })?.data ?? [];
  const _itemsRaw2 = itemData?.data;
  const items: InventoryItem[] = Array.isArray(_itemsRaw2) ? _itemsRaw2 : (_itemsRaw2 as unknown as { data?: InventoryItem[] })?.data ?? [];
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-500">총 {txs.length}<Unit><T k="건" /></Unit></span>
        <Btn onClick={() => setShowForm(p => !p)}><T k={showForm ? '취소' : '+ 입출고 등록'} /></Btn>
      </div>
      {showForm && (
        <Card className="p-5">
          <p className="text-sm font-semibold text-gray-800 mb-4"><T k="입출고 등록" /></p>
          <FormGrid>
            <div><Label><T k="품목" /></Label><Select value={form.itemId} onChange={f('itemId')}><option value=""><T k="선택" /></option>{items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
            <div><Label><T k="유형" /></Label><Select value={form.type} onChange={f('type')}><option value="IN"><T k="입고" /></option><option value="OUT"><T k="출고" /></option><option value="ADJUST"><T k="조정" /></option><option value="RETURN"><T k="반납" /></option></Select></div>
            <div><Label><T k="수량" /></Label><Input type="number" value={form.quantity} onChange={f('quantity')} /></div>
            {/* 사유 = 입력 보조(프리셋)만 제안하고 자유 입력을 막지 않는다 — reason-presets.ts §inventoryTxn */}
            <div className="col-span-2 md:col-span-3"><Label><T k="사유" /></Label>
              <ReasonInput domain="inventoryTxn" value={form.reason} onChange={(v) => setForm(p => ({ ...p, reason: v }))}
                placeholder={tAttr('입출고 사유 입력')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </FormGrid>
          <div className="mt-4 flex gap-2 justify-end">
            <Btn variant="ghost" onClick={() => setShowForm(false)}><T k="취소" /></Btn>
            <Btn onClick={() => add.mutate(form)}><T k="등록" /></Btn>
          </div>
        </Card>
      )}
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/50">
            <tr><Th><T k="일시" /></Th><Th><T k="품목" /></Th><Th><T k="유형" /></Th><Th right><T k="수량" /></Th><Th><T k="사유/부서/참조" /></Th><Th><T k="보관장소" /></Th></tr>
          </thead>
          <tbody>
            {isLoading ? <EmptyRow cols={6} msg="로딩 중..." /> : !txs.length ? <EmptyRow cols={6} msg="내역이 없습니다. 입출고를 등록하세요." /> : txs.map((t: Transaction & { item?: { name: string; code: string }; department?: string; referenceNumber?: string; storage?: { name: string } }) => {
              const isIn = ['IN', 'RETURN', 'RECEIVE'].includes(t.type);
              return (
                <tr key={t.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                  <Td>{kdate(t.createdAt, 'datetimeShort')}</Td>
                  <Td>{t.item?.name ?? t.itemName ?? '-'} <span className="text-[10px] text-gray-400 font-mono">{t.item?.code ?? ''}</span></Td>
                  <td className="px-4 py-3">{statusBadge(t.type)}</td>
                  <td className={`px-4 py-3 text-sm text-right font-bold tabular-nums ${isIn ? 'text-blue-600' : 'text-rose-600'}`}>{isIn ? '+' : '-'}{t.quantity?.toLocaleString()}</td>
                  <Td>{t.reason ?? '-'}{t.department ? ` (${t.department})` : ''}{t.referenceNumber ? ` [${t.referenceNumber}]` : ''}</Td>
                  <Td>{t.storage?.name ?? '-'}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
