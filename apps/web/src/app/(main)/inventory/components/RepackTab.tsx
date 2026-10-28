'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { InventoryItem } from '@hospital-run/shared';
import { RepackOrder, Badge, statusBadge, Th, Td, EmptyRow, Btn, Input, Select, Label, Card, FormGrid } from './shared-ui';
import { kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

const REPACK_TYPE: Record<string, string> = { SPLIT: '소분', KIT: '키트구성', REPACK: '재포장' };

export function RepackTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'KIT', targetItemName: '', targetQty: '', targetUnit: '세트', instructions: '', items: [{ itemId: '', quantity: '' }] as { itemId: string; quantity: string }[] });
  const { data, isLoading } = useQuery({ queryKey: ['repack-orders'], queryFn: () => apiClient.get<{ data: RepackOrder[] }>('/api/v1/inventory/repack-orders') });
  const { data: itemsData } = useQuery({ queryKey: ['inventory'], queryFn: () => apiClient.get<{ data: InventoryItem[] }>('/api/v1/inventory') });
  const _ordersRaw = data?.data;
  const orders: RepackOrder[] = Array.isArray(_ordersRaw) ? _ordersRaw : (_ordersRaw as unknown as { data?: RepackOrder[] })?.data ?? [];
  const _itemsRaw5 = itemsData?.data;
  const items: InventoryItem[] = Array.isArray(_itemsRaw5) ? _itemsRaw5 : (_itemsRaw5 as unknown as { data?: InventoryItem[] })?.data ?? [];
  const create = useMutation({ mutationFn: (b: Record<string, unknown>) => apiClient.post('/api/v1/inventory/repack-orders', b), onSuccess: () => { qc.invalidateQueries({ queryKey: ['repack-orders'] }); setShowForm(false); } });
  const updateStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: string; performedBy?: string }) => apiClient.patch(`/api/v1/inventory/repack-orders/${id}/status`, { status }), onSuccess: () => qc.invalidateQueries({ queryKey: ['repack-orders'] }) });
  const complete = useMutation({ mutationFn: (id: string) => apiClient.post(`/api/v1/inventory/repack-orders/${id}/complete`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['repack-orders'] }) });

  const addItem = () => setForm(p => ({ ...p, items: [...p.items, { itemId: '', quantity: '' }] }));
  const setItem = (idx: number, field: string, val: string) => setForm(p => { const ni = [...p.items]; ni[idx] = { ...ni[idx], [field]: val }; return { ...p, items: ni }; });

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); create.mutate({ ...form, items: form.items.filter(i => i.itemId && i.quantity).map(i => ({ itemId: i.itemId, quantity: Number(i.quantity) })) }); };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">총 {orders.length}<Unit><T k="건" /></Unit></p>
        <Btn onClick={() => setShowForm(!showForm)}><T k="+ 재포장 지시서" /></Btn>
      </div>
      {showForm && (
        <Card className="p-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormGrid>
              <div><Label><T k="유형 *" /></Label><Select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}><option value="SPLIT"><T k="소분" /></option><option value="KIT"><T k="키트구성" /></option><option value="REPACK"><T k="재포장" /></option></Select></div>
              <div><Label><T k="결과물 명칭 *" /></Label><Input value={form.targetItemName} onChange={e => setForm(p => ({ ...p, targetItemName: e.target.value }))} required placeholder={tAttr('IV 준비 세트 (성인)')} /></div>
              <div><Label><T k="생산 수량 *" /></Label><Input type="number" value={form.targetQty} onChange={e => setForm(p => ({ ...p, targetQty: e.target.value }))} required /></div>
              <div><Label><T k="단위" /></Label><Input value={form.targetUnit} onChange={e => setForm(p => ({ ...p, targetUnit: e.target.value }))} /></div>
              <div className="col-span-2"><Label><T k="작업 지시" /></Label><Input value={form.instructions} onChange={e => setForm(p => ({ ...p, instructions: e.target.value }))} placeholder={tAttr('각 품목 1개씩 비닐 파우치에 밀봉')} /></div>
            </FormGrid>
            <div>
              <Label><T k="투입 품목" /></Label>
              <div className="space-y-2">
                {form.items.map((fi, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_120px] gap-2">
                    <Select value={fi.itemId} onChange={e => setItem(idx, 'itemId', e.target.value)}><option value=""><T k="-- 품목 선택 --" /></option>{items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}</Select>
                    <Input type="number" value={fi.quantity} onChange={e => setItem(idx, 'quantity', e.target.value)} placeholder={tAttr('수량')} />
                  </div>
                ))}
                <button type="button" onClick={addItem} className="text-xs text-blue-600 hover:text-blue-700"><T k="+ 품목 추가" /></button>
              </div>
            </div>
            <div className="flex gap-2"><Btn variant="ghost" onClick={() => setShowForm(false)}><T k="취소" /></Btn><Btn onClick={() => {}}><T k="저장" /></Btn></div>
          </form>
        </Card>
      )}
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/50">
            <tr><Th><T k="번호" /></Th><Th><T k="유형" /></Th><Th><T k="결과물" /></Th><Th right><T k="수량" /></Th><Th><T k="상태" /></Th><Th><T k="작업자" /></Th><Th><T k="일자" /></Th><Th></Th></tr>
          </thead>
          <tbody>
            {isLoading ? <EmptyRow cols={8} msg="로딩 중..." /> : !orders.length ? <EmptyRow cols={8} msg="재포장 지시서가 없습니다." /> : orders.map(o => (
              <tr key={o.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                <Td mono>{o.orderNumber}</Td>
                <Td><Badge label={REPACK_TYPE[o.type] ?? o.type} color="bg-indigo-50 text-indigo-700" /></Td>
                <Td>{o.targetItemName}</Td>
                <Td right>{o.targetQty} {o.targetUnit}</Td>
                <Td>{statusBadge(o.status)}</Td>
                <Td>{o.performedBy ?? '-'}</Td>
                <Td>{kdate(new Date(o.createdAt))}</Td>
                <Td>
                  <div className="flex gap-1">
                    {o.status === 'DRAFT' && <Btn sm variant="primary" onClick={() => updateStatus.mutate({ id: o.id, status: 'IN_PROGRESS' })}><T k="시작" /></Btn>}
                    {o.status === 'IN_PROGRESS' && <Btn sm variant="primary" onClick={() => complete.mutate(o.id)}><T k="완료" /></Btn>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
