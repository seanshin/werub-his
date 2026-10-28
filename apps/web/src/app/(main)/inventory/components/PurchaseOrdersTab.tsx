'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MutationError, InventoryItem } from '@hospital-run/shared';
import { Supplier, PO, statusBadge, Th, Td, EmptyRow, Btn, Input, Select, Label, Card } from './shared-ui';
import { money, kdate } from '@/lib/ui-settings';
import { Money, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

export function PurchaseOrdersTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [poItems, setPoItems] = useState([{ itemId: '', quantity: '', unitPrice: '' }]);
  const { data, isLoading } = useQuery({ queryKey: ['inventory-pos'], queryFn: () => apiClient.get<{ data: PO[] }>('/api/v1/inventory/purchase-orders') });
  const { data: supData } = useQuery({ queryKey: ['inventory-suppliers'], queryFn: () => apiClient.get<{ data: Supplier[] }>('/api/v1/inventory/suppliers') });
  const { data: itemData } = useQuery({ queryKey: ['inventory'], queryFn: () => apiClient.get<{ data: InventoryItem[] }>('/api/v1/inventory') });
  const create = useMutation({ mutationFn: () => apiClient.post('/api/v1/inventory/purchase-orders', { supplierId, items: poItems.map(i => ({ itemId: i.itemId, orderedQty: Number(i.quantity), unitPrice: Number(i.unitPrice) })) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-pos'] }); setShowForm(false); }, onError: (e: MutationError) => alert(e?.message ?? '발주서 저장에 실패했습니다.') });
  const updateStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/api/v1/inventory/purchase-orders/${id}/status`, { status }), onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-pos'] }), onError: (e: MutationError) => alert(e?.message ?? '발주 상태 변경에 실패했습니다.') });
  const _posRaw = data?.data;
  const pos: PO[] = Array.isArray(_posRaw) ? _posRaw : (_posRaw as unknown as Record<string, unknown>)?.data as PO[] ?? [];
  const _suppRaw2 = supData?.data;
  const suppliers: Supplier[] = Array.isArray(_suppRaw2) ? _suppRaw2 : (_suppRaw2 as unknown as Record<string, unknown>)?.data as Supplier[] ?? [];
  const _itemsRaw3 = itemData?.data;
  const items: InventoryItem[] = Array.isArray(_itemsRaw3) ? _itemsRaw3 : (_itemsRaw3 as unknown as Record<string, unknown>)?.data as InventoryItem[] ?? [];
  const addRow = () => setPoItems(p => [...p, { itemId: '', quantity: '', unitPrice: '' }]);
  const updateRow = (i: number, k: string, v: string) => setPoItems(p => p.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  const statusActions: Record<string, { label: string; next: string }> = { DRAFT: { label: '제출', next: 'SUBMITTED' }, SUBMITTED: { label: '승인', next: 'APPROVED' }, APPROVED: { label: '발주', next: 'ORDERED' } };
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-500">총 {pos.length}<Unit><T k="건" /></Unit></span>
        <Btn onClick={() => setShowForm(p => !p)}><T k={showForm ? '취소' : '+ 발주서 작성'} /></Btn>
      </div>
      {showForm && (
        <Card className="p-5">
          <p className="text-sm font-semibold text-gray-800 mb-4"><T k="발주서 작성" /></p>
          <div className="mb-4"><Label><T k="거래처" /></Label><Select value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value=""><T k="거래처 선택" /></option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
          <div className="space-y-2">
            {poItems.map((row, i) => (
              <div key={i} className="grid grid-cols-3 gap-2">
                <Select value={row.itemId} onChange={e => updateRow(i, 'itemId', e.target.value)}><option value=""><T k="품목 선택" /></option>{items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}</Select>
                <Input type="number" placeholder={tAttr('수량')} value={row.quantity} onChange={e => updateRow(i, 'quantity', e.target.value)} />
                <Input type="number" placeholder={tAttr('단가(원)')} value={row.unitPrice} onChange={e => updateRow(i, 'unitPrice', e.target.value)} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2 justify-between">
            <Btn sm variant="ghost" onClick={addRow}><T k="+ 품목 추가" /></Btn>
            <div className="flex gap-2"><Btn variant="ghost" onClick={() => setShowForm(false)}><T k="취소" /></Btn><Btn onClick={() => create.mutate()}><T k="발주서 저장" /></Btn></div>
          </div>
        </Card>
      )}
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/50">
            <tr><Th><T k="발주번호" /></Th><Th><T k="거래처" /></Th><Th><T k="상태" /></Th><Th><T k="품목수" /></Th><Th right><T k="총금액" /></Th><Th><T k="작성일" /></Th><Th><T k="처리" /></Th></tr>
          </thead>
          <tbody>
            {isLoading ? <EmptyRow cols={7} msg="로딩 중..." /> : !pos.length ? <EmptyRow cols={7} msg="발주 내역이 없습니다." /> : pos.map(p => (
              <tr key={p.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                <Td mono>{p.orderNumber}</Td><Td>{p.supplier?.name}</Td>
                <td className="px-4 py-3">{statusBadge(p.status)}</td>
                <Td>{p.items?.length ?? 0}<Unit><T k="개" /></Unit></Td>
                <Td right><Money value={p.totalAmount} /></Td>
                <Td>{kdate(new Date(p.createdAt))}</Td>
                <td className="px-4 py-3">
                  {statusActions[p.status] && (
                    <Btn sm onClick={() => updateStatus.mutate({ id: p.id, status: statusActions[p.status].next })}><T k={statusActions[p.status].label} /></Btn>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
