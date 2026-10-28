'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MutationError } from '@hospital-run/shared';
import { Storage, Th, Td, EmptyRow, Btn, Input, Select, Label, Card, FormGrid } from './shared-ui';
import { T, useTAttr } from '@/components/ui/i18n-text';

export function StoragesTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', type: '', location: '', temperature: '', managerName: '' });
  const { data, isLoading } = useQuery({ queryKey: ['inventory-storages'], queryFn: () => apiClient.get<{ data: Storage[] }>('/api/v1/inventory/storages') });
  const add = useMutation({ mutationFn: (b: typeof form) => apiClient.post('/api/v1/inventory/storages', b), onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-storages'] }); setShowForm(false); }, onError: (e: MutationError) => alert(e?.message ?? '보관장소 등록에 실패했습니다.') });
  const del = useMutation({ mutationFn: (id: string) => apiClient.del(`/api/v1/inventory/storages/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-storages'] }), onError: (e: MutationError) => alert(e?.message ?? '보관장소 삭제에 실패했습니다.') });
  const _storagesRaw = data?.data;
  const storages: Storage[] = Array.isArray(_storagesRaw) ? _storagesRaw : (_storagesRaw as unknown as { data?: Storage[] })?.data ?? [];
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-500">총 {storages.length}<Unit><T k="개" /></Unit> <T k="장소" /></span>
        <Btn onClick={() => setShowForm(p => !p)}><T k={showForm ? '취소' : '+ 보관장소 등록'} /></Btn>
      </div>
      {showForm && (
        <Card className="p-5">
          <p className="text-sm font-semibold text-gray-800 mb-4"><T k="보관장소 등록" /></p>
          <FormGrid>
            <div><Label><T k="코드" /></Label><Input value={form.code} onChange={f('code')} placeholder="STG-001" /></div>
            <div><Label><T k="명칭" /></Label><Input value={form.name} onChange={f('name')} placeholder={tAttr('중앙창고 A구역')} /></div>
            <div><Label><T k="유형" /></Label><Select value={form.type} onChange={f('type')}><option value=""><T k="선택" /></option><option><T k="창고" /></option><option><T k="냉장" /></option><option><T k="냉동" /></option><option><T k="약국" /></option></Select></div>
            <div><Label><T k="위치" /></Label><Input value={form.location} onChange={f('location')} placeholder={tAttr('본관 B1')} /></div>
            <div><Label><T k="온도조건" /></Label><Input value={form.temperature} onChange={f('temperature')} placeholder="2~8°C" /></div>
            <div><Label><T k="담당자" /></Label><Input value={form.managerName} onChange={f('managerName')} /></div>
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
            <tr><Th><T k="코드" /></Th><Th><T k="명칭" /></Th><Th><T k="유형" /></Th><Th><T k="위치" /></Th><Th><T k="온도" /></Th><Th><T k="담당자" /></Th><Th></Th></tr>
          </thead>
          <tbody>
            {isLoading ? <EmptyRow cols={7} msg="로딩 중..." /> : !storages.length ? <EmptyRow cols={7} msg="등록된 보관장소가 없습니다." /> : storages.map(s => (
              <tr key={s.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                <Td mono>{s.code}</Td><Td>{s.name}</Td><Td>{s.type}</Td><Td>{s.location}</Td><Td>{s.temperature}</Td><Td>{s.managerName}</Td>
                <td className="px-4 py-3"><Btn sm variant="danger" onClick={() => del.mutate(s.id)}><T k="삭제" /></Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
