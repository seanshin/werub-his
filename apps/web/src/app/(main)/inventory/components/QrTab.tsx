'use client';

import { useState } from 'react';
import { sanctionedPrint } from '@/components/print/PrintGuard';
import { Unit } from '@/components/ui/display';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { escapeHtml } from '@/lib/escape-html';
import { qrDataUrl } from '@/components/ui/QrImage';
import { InventoryItem } from '@hospital-run/shared';
import { Storage, QrLabel, Badge, Th, Td, EmptyRow, Btn, Input, Select, Label, Card, FormGrid } from './shared-ui';
import { kdate } from '@/lib/ui-settings';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';

const qrSchema = z.object({
  labelType: z.string().min(1),
  referenceId: z.string().optional(),
  referenceName: z.string().min(1, '대상 명칭을 입력하세요'),
  referenceCode: z.string().optional(),
});
type QrForm = z.infer<typeof qrSchema>;

const QR_TYPE_LABEL: Record<string, string> = { ITEM: '품목', LOT: 'LOT', REPACK: '재포장', KIT: '키트', STORAGE: '보관장소' };

export function QrTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['qr-labels', filter], queryFn: () => apiClient.get<{ data: QrLabel[] }>(`/api/v1/inventory/qr-labels${filter ? `?labelType=${filter}` : ''}`) });
  const { data: itemsData } = useQuery({ queryKey: ['inventory'], queryFn: () => apiClient.get<{ data: InventoryItem[] }>('/api/v1/inventory') });
  const { data: storagesData } = useQuery({ queryKey: ['inv-storages'], queryFn: () => apiClient.get<{ data: Storage[] }>('/api/v1/inventory/storages') });
  const _labelsRaw = data?.data;
  const labels: QrLabel[] = Array.isArray(_labelsRaw) ? _labelsRaw : (_labelsRaw as unknown as Record<string, unknown>)?.data as QrLabel[] ?? [];
  const _itemsRaw6 = itemsData?.data;
  const items: InventoryItem[] = Array.isArray(_itemsRaw6) ? _itemsRaw6 : (_itemsRaw6 as unknown as Record<string, unknown>)?.data as InventoryItem[] ?? [];
  const _storagesRaw4 = storagesData?.data;
  const storages: Storage[] = Array.isArray(_storagesRaw4) ? _storagesRaw4 : (_storagesRaw4 as unknown as Record<string, unknown>)?.data as Storage[] ?? [];
  const { register, handleSubmit: rhfSubmit, reset, formState: { errors } } = useForm<QrForm>({
    resolver: zodResolver(qrSchema),
    defaultValues: { labelType: 'ITEM', referenceId: '', referenceName: '', referenceCode: '' },
  });

  const create = useMutation({ mutationFn: (b: Record<string, unknown>) => apiClient.post('/api/v1/inventory/qr-labels', b), onSuccess: () => { qc.invalidateQueries({ queryKey: ['qr-labels'] }); setShowForm(false); reset(); } });
  const bulkCreate = useMutation({ mutationFn: (b: Record<string, unknown>) => apiClient.post('/api/v1/inventory/qr-labels/bulk', b), onSuccess: () => qc.invalidateQueries({ queryKey: ['qr-labels'] }) });
  const markPrint = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/inventory/qr-labels/${id}/print`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['qr-labels'] }) });

  const handleCreate = (data: QrForm) => {
    const qrData = JSON.stringify({ t: data.labelType, id: data.referenceId, c: data.referenceCode, n: data.referenceName, d: kstToday(), h: 'HR' });
    create.mutate({ ...data, qrData });
  };

  const handleBulkItems = () => {
    const lbls = items.map(i => ({ labelType: 'ITEM', referenceId: i.id, referenceName: i.name, referenceCode: i.code, qrData: JSON.stringify({ t: 'ITEM', id: i.id, c: i.code, n: i.name, h: 'HR' }) }));
    bulkCreate.mutate({ labels: lbls });
  };

  const handleBulkStorages = () => {
    const lbls = storages.map(s => ({ labelType: 'STORAGE', referenceId: s.id, referenceName: s.name, referenceCode: s.code, qrData: JSON.stringify({ t: 'STORAGE', id: s.id, c: s.code, n: s.name, h: 'HR' }) }));
    bulkCreate.mutate({ labels: lbls });
  };

  // 🔴 외부 QR API 의존 봉합 — 로컬 생성. 팝업은 클릭 제스처 안에서 먼저 연다(팝업 차단 회피).
  const handlePrint = async (label: QrLabel) => {
    markPrint.mutate(label.id);
    const w = window.open('', '_blank', 'width=400,height=500');
    const qrUrl = await qrDataUrl(label.qrData, 200, 1);
    if (w && !qrUrl) { w.document.write('<div style="font-family:sans-serif;padding:20px;color:#dc2626">QR 생성 실패 — 라벨을 인쇄하지 마세요.</div>'); return; }
    if (w && qrUrl) {
      w.document.write(`<html><head><title>QR 라벨</title><style>body{font-family:sans-serif;text-align:center;padding:20px} .label{border:2px solid #333;padding:20px;display:inline-block;border-radius:8px} .name{font-size:16px;font-weight:bold;margin:10px 0 5px} .code{font-size:12px;color:#666} @media print{body{margin:0}}</style></head><body><div class="label"><img src="${escapeHtml(qrUrl)}" width="200" height="200" /><div class="name">${escapeHtml(label.referenceName ?? '')}</div><div class="code">${escapeHtml(label.referenceCode ?? '')}</div><div class="code">${escapeHtml(QR_TYPE_LABEL[label.labelType] ?? label.labelType)}</div></div><script>setTimeout(()=>window.print(),500)</script></body></html>`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="flex gap-1">
          {[{ id: '', label: '전체' }, ...Object.entries(QR_TYPE_LABEL).map(([id, label]) => ({ id, label }))].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={`px-3 py-1.5 text-xs font-medium rounded-lg ${filter === f.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><T k={f.label} /></button>
          ))}
        </div>
        <div className="flex gap-2">
          <Btn sm variant="ghost" onClick={handleBulkItems}><T k="품목 QR 일괄생성" /></Btn>
          <Btn sm variant="ghost" onClick={handleBulkStorages}><T k="보관장소 QR 일괄" /></Btn>
          <Btn sm onClick={() => setShowForm(!showForm)}><T k="+ QR 생성" /></Btn>
        </div>
      </div>
      {showForm && (
        <Card className="p-5">
          <form onSubmit={rhfSubmit(handleCreate)} className="space-y-3">
            <FormGrid>
              <div><Label><T k="유형" /></Label><Select {...register('labelType')}>
                {Object.entries(QR_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select></div>
              <div>
                <Label><T k="대상 명칭 *" /></Label><Input {...register('referenceName')} placeholder={tAttr('일회용 주사기 3mL')} />
                {errors.referenceName && <p className="text-xs text-red-500 mt-0.5">{errors.referenceName.message}</p>}
              </div>
              <div><Label><T k="코드" /></Label><Input {...register('referenceCode')} placeholder="INV-001" /></div>
            </FormGrid>
            <div className="flex gap-2"><Btn variant="ghost" onClick={() => setShowForm(false)}><T k="취소" /></Btn><button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 shadow-sm"><T k="생성" /></button></div>
          </form>
        </Card>
      )}
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/50">
            <tr><Th><T k="유형" /></Th><Th><T k="대상" /></Th><Th><T k="코드" /></Th><Th right><T k="인쇄횟수" /></Th><Th><T k="생성일" /></Th><Th></Th></tr>
          </thead>
          <tbody>
            {isLoading ? <EmptyRow cols={6} msg="로딩 중..." /> : !labels.length ? <EmptyRow cols={6} msg="QR 라벨이 없습니다." /> : labels.map(l => (
              <tr key={l.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                <Td><Badge label={QR_TYPE_LABEL[l.labelType] ?? l.labelType} color="bg-indigo-50 text-indigo-700" /></Td>
                <Td>{l.referenceName}</Td>
                <Td mono>{l.referenceCode ?? '-'}</Td>
                <Td right>{l.printCount}<Unit><T k="회" /></Unit></Td>
                <Td>{kdate(new Date(l.createdAt))}</Td>
                <Td><Btn sm variant="primary" onClick={() => void handlePrint(l)}><T k="인쇄" /></Btn></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
