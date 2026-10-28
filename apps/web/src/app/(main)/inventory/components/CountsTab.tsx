'use client';
import { ReasonInput } from '@/components/ui/ReasonInput';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MutationError, InventoryItem } from '@hospital-run/shared';
import { Storage, Badge, Th, Td, EmptyRow, Btn, Input, Select, Label, Card, FormGrid } from './shared-ui';
import { kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

type InventoryCount = { id: string; countNumber: string; title: string; status: string; scheduledDate: string; completedDate: string | null; storage: { name: string } | null; _count: { items: number }; createdAt: string };
type CountItem = { id: string; itemId: string; systemQty: number; countedQty: number | null; difference: number | null; reason: string | null; isAdjusted: boolean; item: { id: string; code: string; name: string; unit: string; category: string } };

export function CountsTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedCount, setSelectedCount] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', storageId: '', category: '', scheduledDate: '' });
  const [countInputs, setCountInputs] = useState<Record<string, { countedQty: string; reason: string }>>({});
  const { data, isLoading } = useQuery({ queryKey: ['inventory-counts'], queryFn: () => apiClient.get<{ data: InventoryCount[] }>('/api/v1/inventory/counts') });
  const { data: detailData } = useQuery({ queryKey: ['inventory-count-detail', selectedCount], queryFn: () => apiClient.get<{ data: InventoryCount & { items: CountItem[] } }>(`/api/v1/inventory/counts/${selectedCount}`), enabled: !!selectedCount });
  const { data: storageData } = useQuery({ queryKey: ['inventory-storages'], queryFn: () => apiClient.get<{ data: Storage[] }>('/api/v1/inventory/storages') });
  const create = useMutation({ mutationFn: (b: typeof form) => apiClient.post('/api/v1/inventory/counts', b), onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-counts'] }); setShowForm(false); setForm({ title: '', storageId: '', category: '', scheduledDate: '' }); }, onError: (e: MutationError) => alert(e?.message ?? '실사 생성에 실패했습니다.') });
  const updateItems = useMutation({ mutationFn: (items: { itemId: string; countedQty: number; reason?: string }[]) => apiClient.patch(`/api/v1/inventory/counts/${selectedCount}/items`, { items }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-count-detail', selectedCount] }); qc.invalidateQueries({ queryKey: ['inventory-counts'] }); }, onError: (e: MutationError) => alert(e?.message ?? '실사 결과 저장에 실패했습니다.') });
  const complete = useMutation({ mutationFn: (id: string) => apiClient.post(`/api/v1/inventory/counts/${id}/complete`, {}), onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-counts'] }); qc.invalidateQueries({ queryKey: ['inventory-count-detail', selectedCount] }); setSelectedCount(null); }, onError: (e: MutationError) => alert(e?.message ?? '실사 완료 처리에 실패했습니다.') });

  const _countsRaw = data?.data;
  const counts: InventoryCount[] = Array.isArray(_countsRaw) ? _countsRaw : (_countsRaw as unknown as { data?: InventoryCount[] })?.data ?? [];
  const detail = detailData?.data;
  const detailItems: CountItem[] = detail?.items ?? [];
  const _storagesRaw3 = storageData?.data;
  const storages: Storage[] = Array.isArray(_storagesRaw3) ? _storagesRaw3 : (_storagesRaw3 as unknown as { data?: Storage[] })?.data ?? [];
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  const handleSaveCount = () => {
    const items = Object.entries(countInputs)
      .filter(([, v]) => v.countedQty !== '')
      .map(([itemId, v]) => ({ itemId, countedQty: Number(v.countedQty), reason: v.reason || undefined }));
    if (items.length === 0) { alert('실사 수량을 입력해주세요.'); return; }
    updateItems.mutate(items);
  };

  const countStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      DRAFT: 'bg-gray-100 text-gray-600', IN_PROGRESS: 'bg-amber-50 text-amber-700', COMPLETED: 'bg-emerald-50 text-emerald-700', CANCELLED: 'bg-rose-50 text-rose-700',
    };
    const label: Record<string, string> = { DRAFT: '초안', IN_PROGRESS: '진행중', COMPLETED: '완료', CANCELLED: '취소' };
    return <Badge label={label[status] ?? status} color={map[status] ?? 'bg-gray-100 text-gray-500'} />;
  };

  if (selectedCount && detail) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{detail.title}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{detail.countNumber} | 예정일: {kdate(new Date(detail.scheduledDate))} | {countStatusBadge(detail.status)}</p>
          </div>
          <div className="flex gap-2">
            <Btn variant="ghost" sm onClick={() => { setSelectedCount(null); setCountInputs({}); }}><T k="목록으로" /></Btn>
            {detail.status !== 'COMPLETED' && (
              <>
                <Btn sm onClick={handleSaveCount}><T k="결과 저장" /></Btn>
                <Btn sm variant="danger" onClick={() => { if (confirm('실사를 완료하고 재고를 조정하시겠습니까?')) complete.mutate(selectedCount); }}><T k="실사 완료" /></Btn>
              </>
            )}
          </div>
        </div>
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/50">
              <tr><Th><T k="코드" /></Th><Th><T k="품목명" /></Th><Th><T k="분류" /></Th><Th><T k="단위" /></Th><Th right><T k="시스템수량" /></Th><Th right><T k="실사수량" /></Th><Th right><T k="차이" /></Th><Th><T k="사유" /></Th><Th><T k="조정" /></Th></tr>
            </thead>
            <tbody>
              {detailItems.map(ci => {
                const diff = countInputs[ci.itemId]?.countedQty !== undefined && countInputs[ci.itemId]?.countedQty !== ''
                  ? Number(countInputs[ci.itemId].countedQty) - ci.systemQty
                  : ci.difference;
                const hasDiff = diff !== null && diff !== 0;
                return (
                  <tr key={ci.id} className={`border-b border-gray-50 ${hasDiff ? (diff! > 0 ? 'bg-blue-50/30' : 'bg-rose-50/30') : ''}`}>
                    <Td mono>{ci.item.code}</Td>
                    <Td>{ci.item.name}</Td>
                    <Td>{ci.item.category}</Td>
                    <Td>{ci.item.unit}</Td>
                    <Td right>{ci.systemQty.toLocaleString()}</Td>
                    <td className="px-4 py-2">
                      {detail.status === 'COMPLETED' ? (
                        <span className="text-sm text-right block">{ci.countedQty?.toLocaleString() ?? '-'}</span>
                      ) : (
                        <Input type="number" className="w-24 text-right"
                          value={countInputs[ci.itemId]?.countedQty ?? (ci.countedQty !== null ? String(ci.countedQty) : '')}
                          placeholder={String(ci.systemQty)}
                          onChange={e => setCountInputs(p => ({ ...p, [ci.itemId]: { ...p[ci.itemId], countedQty: e.target.value, reason: p[ci.itemId]?.reason ?? '' } }))} />
                      )}
                    </td>
                    <td className={`px-4 py-3 text-sm text-right font-bold tabular-nums ${diff === null ? 'text-gray-400' : diff > 0 ? 'text-blue-600' : diff < 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                      {diff !== null && diff !== undefined ? (diff > 0 ? `+${diff}` : diff) : '-'}
                    </td>
                    <td className="px-4 py-2">
                      {detail.status === 'COMPLETED' ? (
                        <span className="text-xs text-gray-500">{ci.reason ?? '-'}</span>
                      ) : (
                        <ReasonInput domain="inventoryCount"
                          className="w-32 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          value={countInputs[ci.itemId]?.reason ?? (ci.reason ?? '')}
                          placeholder={tAttr('사유')}
                          onChange={v => setCountInputs(p => ({ ...p, [ci.itemId]: { ...p[ci.itemId], countedQty: p[ci.itemId]?.countedQty ?? '', reason: v } }))} />
                      )}
                    </td>
                    <td className="px-4 py-3">{ci.isAdjusted ? <Badge label="조정완료" color="bg-emerald-50 text-emerald-700" /> : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-500">총 {counts.length}<Unit><T k="건" /></Unit></span>
        <Btn onClick={() => setShowForm(p => !p)}><T k={showForm ? '취소' : '+ 실사 생성'} /></Btn>
      </div>
      {showForm && (
        <Card className="p-5">
          <p className="text-sm font-semibold text-gray-800 mb-4"><T k="실사 생성" /></p>
          <FormGrid>
            <div><Label><T k="제목 *" /></Label><Input value={form.title} onChange={f('title')} placeholder={tAttr('2026년 5월 정기실사')} /></div>
            <div><Label><T k="보관장소" /></Label>
              <Select value={form.storageId} onChange={f('storageId')}>
                <option value=""><T k="전체" /></option>
                {storages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <div><Label><T k="카테고리" /></Label>
              <Select value={form.category} onChange={f('category')}>
                <option value=""><T k="전체" /></option>
                <option value="소모품"><T k="소모품" /></option><option value="수술소모품"><T k="수술소모품" /></option><option value="검사소모품"><T k="검사소모품" /></option><option value="의약품"><T k="의약품" /></option><option value="의료기기"><T k="의료기기" /></option>
              </Select>
            </div>
            <div><Label><T k="예정일 *" /></Label><Input type="date" value={form.scheduledDate} onChange={f('scheduledDate')} /></div>
          </FormGrid>
          <div className="mt-4 flex gap-2 justify-end">
            <Btn variant="ghost" onClick={() => setShowForm(false)}><T k="취소" /></Btn>
            <Btn onClick={() => create.mutate(form)}><T k="생성" /></Btn>
          </div>
        </Card>
      )}
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/50">
            <tr><Th><T k="번호" /></Th><Th><T k="제목" /></Th><Th><T k="보관장소" /></Th><Th><T k="상태" /></Th><Th right><T k="품목수" /></Th><Th><T k="예정일" /></Th><Th><T k="완료일" /></Th><Th></Th></tr>
          </thead>
          <tbody>
            {isLoading ? <EmptyRow cols={8} msg="로딩 중..." /> : !counts.length ? <EmptyRow cols={8} msg="실사 내역이 없습니다." /> : counts.map(c => (
              <tr key={c.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                <Td mono>{c.countNumber}</Td>
                <Td>{c.title}</Td>
                <Td>{c.storage?.name ?? <T k="전체" />}</Td>
                <td className="px-4 py-3">{countStatusBadge(c.status)}</td>
                <Td right>{c._count?.items ?? 0}</Td>
                <Td>{kdate(new Date(c.scheduledDate))}</Td>
                <Td>{c.completedDate ? kdate(c.completedDate) : '-'}</Td>
                <td className="px-4 py-3">
                  <Btn sm onClick={() => setSelectedCount(c.id)}><T k={c.status === 'COMPLETED' ? '조회' : '입력'} /></Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
