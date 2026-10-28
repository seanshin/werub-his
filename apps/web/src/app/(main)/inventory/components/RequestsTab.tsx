'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MutationError, InventoryItem } from '@hospital-run/shared';
import { Request, statusBadge, Th, Td, EmptyRow, Btn, Input, Select, Label, Card } from './shared-ui';
import { kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

export function RequestsTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [dept, setDept] = useState('');
  const [reqItems, setReqItems] = useState([{ itemId: '', quantity: '' }]);
  const { data, isLoading } = useQuery({ queryKey: ['inventory-requests'], queryFn: () => apiClient.get<{ data: Request[] }>('/api/v1/inventory/requests') });
  const { data: itemData } = useQuery({ queryKey: ['inventory'], queryFn: () => apiClient.get<{ data: InventoryItem[] }>('/api/v1/inventory') });
  const create = useMutation({ mutationFn: () => apiClient.post('/api/v1/inventory/requests', { department: dept, items: reqItems.filter(r => r.itemId && r.quantity).map(r => ({ itemId: r.itemId, requestedQty: Number(r.quantity) })) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-requests'] }); setShowForm(false); }, onError: (e: MutationError) => alert(e?.message ?? '불출 요청에 실패했습니다.') });
  const approve = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/inventory/requests/${id}/approve`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-requests'] }), onError: (e: MutationError) => alert(e?.message ?? '승인에 실패했습니다.') });
  const issue = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/inventory/requests/${id}/issue`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-requests'] }), onError: (e: MutationError) => alert(e?.message ?? e?.error?.message ?? '불출 처리에 실패했습니다.') });
  const _reqRaw = data?.data;
  const requests: Request[] = Array.isArray(_reqRaw) ? _reqRaw : (_reqRaw as unknown as { data?: Request[] })?.data ?? [];
  const _itemsRaw4 = itemData?.data;
  const items: InventoryItem[] = Array.isArray(_itemsRaw4) ? _itemsRaw4 : (_itemsRaw4 as unknown as { data?: InventoryItem[] })?.data ?? [];
  const addRow = () => setReqItems(p => [...p, { itemId: '', quantity: '' }]);
  const updateRow = (i: number, k: string, v: string) => setReqItems(p => p.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-500">총 {requests.length}<Unit><T k="건" /></Unit></span>
        <Btn onClick={() => setShowForm(p => !p)}><T k={showForm ? '취소' : '+ 불출 요청'} /></Btn>
      </div>
      {showForm && (
        <Card className="p-5">
          <p className="text-sm font-semibold text-gray-800 mb-4"><T k="부서 불출 요청" /></p>
          <div className="mb-4"><Label><T k="요청 부서" /></Label><Input value={dept} onChange={e => setDept(e.target.value)} placeholder={tAttr('내과 병동')} /></div>
          <div className="space-y-2">
            {reqItems.map((row, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                <Select value={row.itemId} onChange={e => updateRow(i, 'itemId', e.target.value)}><option value=""><T k="품목 선택" /></option>{items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}</Select>
                <Input type="number" placeholder={tAttr('수량')} value={row.quantity} onChange={e => updateRow(i, 'quantity', e.target.value)} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2 justify-between">
            <Btn sm variant="ghost" onClick={addRow}><T k="+ 품목 추가" /></Btn>
            <div className="flex gap-2"><Btn variant="ghost" onClick={() => setShowForm(false)}><T k="취소" /></Btn><Btn onClick={() => create.mutate()}><T k="요청 등록" /></Btn></div>
          </div>
        </Card>
      )}
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/50">
            <tr><Th><T k="요청번호" /></Th><Th><T k="부서" /></Th><Th><T k="상태" /></Th><Th><T k="품목" /></Th><Th><T k="요청일" /></Th><Th><T k="처리" /></Th></tr>
          </thead>
          <tbody>
            {isLoading ? <EmptyRow cols={6} msg="로딩 중..." /> : !requests.length ? <EmptyRow cols={6} msg="불출 요청이 없습니다." /> : requests.map(r => (
              <tr key={r.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                <Td mono>{r.requestNumber}</Td><Td>{r.department}</Td>
                <td className="px-4 py-3">{statusBadge(r.status)}</td>
                <Td>{r.items?.map(i => i.itemName).join(', ')}</Td>
                <Td>{kdate(new Date(r.createdAt))}</Td>
                <td className="px-4 py-3 flex gap-1">
                  {r.status === 'REQUESTED' && <Btn sm onClick={() => approve.mutate(r.id)}><T k="승인" /></Btn>}
                  {r.status === 'APPROVED' && <Btn sm onClick={() => issue.mutate(r.id)}><T k="불출" /></Btn>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
