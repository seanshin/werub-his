'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MutationError, InventoryItem } from '@hospital-run/shared';
import { Transaction, statusBadge, Th, Td, EmptyRow, Btn, Card } from './shared-ui';

import { EmptyState } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { kdate } from '@/lib/ui-settings';

const TX_TYPE_LABEL: Record<string, string> = { IN: '입고', OUT: '출고', ADJUST: '조정', RETURN: '반품', TRANSFER: '이동', ISSUE: '불출', RECEIVE: '입고검수', DISPOSAL: '폐기', EXPIRED: '만료' };

const itemSchema = z.object({
  code: z.string().min(1, '품목코드를 입력하세요'),
  name: z.string().min(1, '품목명을 입력하세요'),
  specification: z.string().optional(),
  category: z.string().min(1, '분류를 선택하세요'),
  unit: z.string().min(1, '단위를 입력하세요'),
  safetyStock: z.string().optional(),
});
type ItemForm = z.infer<typeof itemSchema>;

export function ItemsTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors }, reset } = useForm<ItemForm>({
    resolver: zodResolver(itemSchema),
  });
  const { data, isLoading } = useQuery({ queryKey: ['inventory'], queryFn: () => apiClient.get<{ data: InventoryItem[] }>('/api/v1/inventory') });
  const { data: histData } = useQuery({ queryKey: ['item-history', selectedItem], queryFn: () => apiClient.get<{ data: Transaction[] }>(`/api/v1/inventory/${selectedItem}/transactions`), enabled: !!selectedItem });
  const add = useMutation({ mutationFn: (b: ItemForm) => apiClient.post('/api/v1/inventory', b), onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); setShowForm(false); reset(); }, onError: (e: MutationError) => alert(e?.message ?? '품목 등록에 실패했습니다.') });
  const _itemsRaw = data?.data;
  const items: InventoryItem[] = Array.isArray(_itemsRaw) ? _itemsRaw : (_itemsRaw as unknown as { data?: InventoryItem[] })?.data ?? [];
  const _histRaw = histData?.data;
  const history: Transaction[] = Array.isArray(_histRaw) ? _histRaw : (_histRaw as unknown as { data?: Transaction[] })?.data ?? [];

  const inputClass = (name: keyof ItemForm) =>
    `w-full px-3 py-2 border ${errors[name] ? 'border-red-300' : 'border-gray-200'} rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent`;

  const onSubmit = (data: ItemForm) => add.mutate(data);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-500"><Tf k="총 {개수}개 품목" params={{ 개수: items.length }} /> {selectedItem && <T k="— 클릭한 품목의 히스토리 표시 중" />}</span>
        <div className="flex gap-2">
          {selectedItem && <Btn variant="ghost" sm onClick={() => setSelectedItem(null)}><T k="히스토리 닫기" /></Btn>}
          <Btn onClick={() => setShowForm(p => !p)}><T k={showForm ? '취소' : '+ 품목 등록'} /></Btn>
        </div>
      </div>
      {showForm && (
        <Card className="p-5">
          <p className="text-sm font-semibold text-gray-800 mb-4"><T k="신규 품목 등록" /></p>
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1"><T k="품목코드 *" /></label>
                <input {...register('code')} placeholder="INV-019" className={inputClass('code')} />
                {errors.code && <p className="text-xs text-red-500 mt-0.5">{errors.code.message}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1"><T k="품목명 *" /></label>
                <input {...register('name')} placeholder={tAttr('의료용 장갑')} className={inputClass('name')} />
                {errors.name && <p className="text-xs text-red-500 mt-0.5">{errors.name.message}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1"><T k="규격" /></label>
                <input {...register('specification')} placeholder="S/M/L" className={inputClass('specification')} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1"><T k="분류 *" /></label>
                <select {...register('category')} className={inputClass('category')}>
                  <option value=""><T k="선택" /></option>
                  <option value="소모품"><T k="소모품" /></option><option value="수술소모품"><T k="수술소모품" /></option><option value="검사소모품"><T k="검사소모품" /></option><option value="의약품"><T k="의약품" /></option><option value="의료기기"><T k="의료기기" /></option>
                </select>
                {errors.category && <p className="text-xs text-red-500 mt-0.5">{errors.category.message}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1"><T k="단위 *" /></label>
                <input {...register('unit')} placeholder={tAttr('개')} className={inputClass('unit')} />
                {errors.unit && <p className="text-xs text-red-500 mt-0.5">{errors.unit.message}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1"><T k="안전재고" /></label>
                <input type="number" {...register('safetyStock')} placeholder="100" className={inputClass('safetyStock')} />
              </div>
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <Btn variant="ghost" onClick={() => setShowForm(false)}><T k="취소" /></Btn>
              <button type="submit" className="px-4 py-2 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"><T k="등록" /></button>
            </div>
          </form>
        </Card>
      )}

      <div className={selectedItem ? 'grid grid-cols-1 lg:grid-cols-5 gap-4' : ''}>
        {/* 품목 테이블 */}
        <div className={selectedItem ? 'lg:col-span-3' : ''}>
          <Card>
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/50">
                <tr><Th><T k="코드" /></Th><Th><T k="품목명" /></Th><Th><T k="규격" /></Th><Th><T k="분류" /></Th><Th><T k="단위" /></Th><Th right><T k="현재고" /></Th><Th right><T k="안전재고" /></Th><Th><T k="상태" /></Th></tr>
              </thead>
              <tbody>
                {isLoading ? <EmptyRow cols={8} msg="로딩 중..." /> : !items.length ? <EmptyRow cols={8} msg="등록된 품목이 없습니다." /> : items.map(i => {
                  const low = i.currentStock <= i.safetyStock;
                  const isSelected = i.id === selectedItem;
                  return (
                    <tr key={i.id} onClick={() => setSelectedItem(isSelected ? null : i.id)}
                      className={`border-b border-gray-50 transition-colors cursor-pointer ${isSelected ? 'bg-blue-50 ring-1 ring-blue-200' : low ? 'bg-rose-50/20 hover:bg-rose-50/40' : 'hover:bg-blue-50/30'}`}>
                      <Td mono>{i.code}</Td><Td>{i.name}</Td><Td>{i.specification}</Td><Td>{i.category}</Td><Td>{i.unit}</Td>
                      <td className={`px-4 py-3 text-sm text-right font-semibold ${low ? 'text-rose-600' : 'text-gray-900'}`}>{i.currentStock?.toLocaleString()}</td>
                      <Td right>{i.safetyStock?.toLocaleString()}</Td>
                      <td className="px-4 py-3">{statusBadge(low ? 'LOW' : 'NORMAL')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>

        {/* 히스토리 패널 */}
        {selectedItem && (
          <div className="lg:col-span-2">
            <Card className="p-4">
              <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <T k="재고 변동 히스토리" />
              </h4>
              {history.length === 0 ? (
                <EmptyState icon="📝" title="변동 이력이 없습니다." />
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {history.map((tx: Transaction & { department?: string; referenceNumber?: string; storage?: { name: string } }) => {
                    const isIn = ['IN', 'RETURN', 'RECEIVE'].includes(tx.type);
                    return (
                      <div key={tx.id} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-gray-50">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isIn ? 'bg-blue-50 text-blue-600' : 'bg-rose-50 text-rose-600'}`}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isIn ? "M12 4v16m0-16l-4 4m4-4l4 4" : "M12 20V4m0 16l-4-4m4 4l4-4"} />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${isIn ? 'text-blue-600' : 'text-rose-600'}`}>
                              <T k={TX_TYPE_LABEL[tx.type] ?? tx.type} />
                            </span>
                            <span className={`text-sm font-bold tabular-nums ${isIn ? 'text-blue-700' : 'text-rose-700'}`}>
                              {isIn ? '+' : '-'}{tx.quantity?.toLocaleString()}
                            </span>
                          </div>
                          {tx.reason && <p className="text-xs text-gray-500 mt-0.5">{tx.reason}</p>}
                          {tx.department && <p className="text-[10px] text-gray-400">부서: {tx.department}</p>}
                          {tx.referenceNumber && <p className="text-[10px] text-gray-400 font-mono">ref: {tx.referenceNumber}</p>}
                          {tx.storage && <p className="text-[10px] text-gray-400">장소: {tx.storage.name}</p>}
                        </div>
                        <div className="text-[10px] text-gray-400 tabular-nums whitespace-nowrap">
                          {kdate(tx.createdAt, 'datetimeShort')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
