'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MutationError } from '@hospital-run/shared';
import { Storage, PO, Th, Td, EmptyRow, Btn, Input, Select, Label, Card } from './shared-ui';
import { money, kdate } from '@/lib/ui-settings';
import { Money, Unit } from '@/components/ui/display';
import { T, Tf } from '@/components/ui/i18n-text';

export function ReceivingTab() {
  const qc = useQueryClient();
  const [selectedPO, setSelectedPO] = useState<PO | null>(null);
  const [receiving, setReceiving] = useState<Record<string, { receivedQty: string; lotNumber: string; expiryDate: string; storageId: string }>>({});
  const { data } = useQuery({ queryKey: ['inventory-pos'], queryFn: () => apiClient.get<{ data: PO[] }>('/api/v1/inventory/purchase-orders') });
  const { data: storageData } = useQuery({ queryKey: ['inventory-storages'], queryFn: () => apiClient.get<{ data: Storage[] }>('/api/v1/inventory/storages') });
  const receive = useMutation({ mutationFn: () => apiClient.post(`/api/v1/inventory/purchase-orders/${selectedPO!.id}/receive`, { items: Object.entries(receiving).map(([poItemId, v]) => ({ poItemId, receivedQty: Number(v.receivedQty), lotNumber: v.lotNumber || undefined, expiryDate: v.expiryDate || undefined, storageId: v.storageId || undefined })) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-pos'] }); setSelectedPO(null); }, onError: (e: MutationError) => alert(e?.message ?? '입고 처리에 실패했습니다.') });
  const _posRaw2 = data?.data;
  const _posArr = Array.isArray(_posRaw2) ? _posRaw2 : (_posRaw2 as unknown as { data?: PO[] })?.data ?? [];
  const pos: PO[] = _posArr.filter((p: PO) => p.status === 'ORDERED');
  const _storagesRaw2 = storageData?.data;
  const storages: Storage[] = Array.isArray(_storagesRaw2) ? _storagesRaw2 : (_storagesRaw2 as unknown as { data?: Storage[] })?.data ?? [];
  const upd = (poItemId: string, k: string, v: string) => setReceiving(p => ({ ...p, [poItemId]: { ...(p[poItemId] ?? { receivedQty: '', lotNumber: '', expiryDate: '', storageId: '' }), [k]: v } }));
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-500"><Tf k="검수 대기 발주: {건수}건" params={{ 건수: pos.length }} /></span>
      </div>
      {!selectedPO ? (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/50">
              <tr><Th><T k="발주번호" /></Th><Th><T k="거래처" /></Th><Th><T k="품목수" /></Th><Th right><T k="총금액" /></Th><Th><T k="작성일" /></Th><Th></Th></tr>
            </thead>
            <tbody>
              {!pos.length ? <EmptyRow cols={6} msg="발주 확정된 건이 없습니다." /> : pos.map(p => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                  <Td mono>{p.orderNumber}</Td><Td>{p.supplier?.name}</Td><Td>{p.items?.length ?? 0}<Unit><T k="개" /></Unit></Td>
                  <Td right><Money value={p.totalAmount} /></Td>
                  <Td>{kdate(new Date(p.createdAt))}</Td>
                  <td className="px-4 py-3"><Btn sm onClick={() => setSelectedPO(p)}><T k="검수 입력" /></Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card className="p-5">
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm font-semibold text-gray-800">발주번호: {selectedPO.orderNumber} 입고 검수</p>
            <Btn sm variant="ghost" onClick={() => setSelectedPO(null)}><T k="목록으로" /></Btn>
          </div>
          <div className="space-y-3">
            {(selectedPO.items ?? []).map((item, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-4">
                <p className="text-sm font-medium text-gray-800 mb-3">{item.itemName} — 발주수량: {item.orderedQty}</p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div><Label><T k="입고수량" /></Label><Input type="number" placeholder={String(item.orderedQty)} value={receiving[item.id]?.receivedQty ?? ''} onChange={e => upd(item.id, 'receivedQty', e.target.value)} /></div>
                  <div><Label><T k="LOT 번호" /></Label><Input placeholder="LOT-2024-001" value={receiving[item.id]?.lotNumber ?? ''} onChange={e => upd(item.id, 'lotNumber', e.target.value)} /></div>
                  <div><Label><T k="유효기간" /></Label><Input type="date" value={receiving[item.id]?.expiryDate ?? ''} onChange={e => upd(item.id, 'expiryDate', e.target.value)} /></div>
                  <div><Label><T k="보관장소" /></Label><Select value={receiving[item.id]?.storageId ?? ''} onChange={e => upd(item.id, 'storageId', e.target.value)}><option value=""><T k="선택" /></option>{storages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setSelectedPO(null)}><T k="취소" /></Btn>
            <Btn onClick={() => receive.mutate()}><T k="입고 확정" /></Btn>
          </div>
        </Card>
      )}
    </div>
  );
}
