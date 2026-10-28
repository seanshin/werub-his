'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MutationError } from '@hospital-run/shared';
import { Supplier, Th, Td, EmptyRow, Btn, Input, Select, Label, Card, FormGrid } from './shared-ui';
import { T, useTAttr } from '@/components/ui/i18n-text';

export function SuppliersTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', businessNumber: '', contactName: '', contactPhone: '', contactEmail: '', paymentTerms: '', rating: '3' });
  const { data, isLoading } = useQuery({ queryKey: ['inventory-suppliers'], queryFn: () => apiClient.get<{ data: Supplier[] }>('/api/v1/inventory/suppliers') });
  const add = useMutation({ mutationFn: (b: typeof form) => apiClient.post('/api/v1/inventory/suppliers', b), onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-suppliers'] }); setShowForm(false); }, onError: (e: MutationError) => alert(e?.message ?? '거래처 등록에 실패했습니다.') });
  const _suppRaw = data?.data;
  const suppliers: Supplier[] = Array.isArray(_suppRaw) ? _suppRaw : (_suppRaw as unknown as { data?: Supplier[] })?.data ?? [];
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-500">총 {suppliers.length}<Unit><T k="개" /></Unit> <T k="거래처" /></span>
        <Btn onClick={() => setShowForm(p => !p)}><T k={showForm ? '취소' : '+ 거래처 등록'} /></Btn>
      </div>
      {showForm && (
        <Card className="p-5">
          <p className="text-sm font-semibold text-gray-800 mb-4"><T k="거래처 등록" /></p>
          <FormGrid>
            <div><Label><T k="코드" /></Label><Input value={form.code} onChange={f('code')} placeholder="SUP-001" /></div>
            <div><Label><T k="거래처명" /></Label><Input value={form.name} onChange={f('name')} /></div>
            <div><Label><T k="사업자번호" /></Label><Input value={form.businessNumber} onChange={f('businessNumber')} placeholder="000-00-00000" /></div>
            <div><Label><T k="담당자" /></Label><Input value={form.contactName} onChange={f('contactName')} /></div>
            <div><Label><T k="전화번호" /></Label><Input value={form.contactPhone} onChange={f('contactPhone')} /></div>
            <div><Label><T k="이메일" /></Label><Input type="email" value={form.contactEmail} onChange={f('contactEmail')} /></div>
            <div><Label><T k="결제조건" /></Label><Input value={form.paymentTerms} onChange={f('paymentTerms')} placeholder={tAttr('월말결제 30일')} /></div>
            <div><Label><T k="평점" /></Label><Select value={form.rating} onChange={f('rating')}><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></Select></div>
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
            <tr><Th><T k="코드" /></Th><Th><T k="거래처명" /></Th><Th><T k="사업자번호" /></Th><Th><T k="담당자" /></Th><Th><T k="전화" /></Th><Th><T k="결제조건" /></Th><Th right><T k="평점" /></Th></tr>
          </thead>
          <tbody>
            {isLoading ? <EmptyRow cols={7} msg="로딩 중..." /> : !suppliers.length ? <EmptyRow cols={7} msg="등록된 거래처가 없습니다." /> : suppliers.map(s => (
              <tr key={s.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                <Td mono>{s.code}</Td><Td>{s.name}</Td><Td mono>{s.businessNumber}</Td><Td>{s.contactName}</Td><Td>{s.contactPhone}</Td><Td>{s.paymentTerms}</Td>
                <td className="px-4 py-3 text-right text-sm font-medium text-amber-500">{'★'.repeat(s.rating ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
