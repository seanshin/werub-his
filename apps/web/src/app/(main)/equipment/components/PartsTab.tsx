'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';
import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiClient } from '@/lib/api-client';
import { EquipmentSelect, EquipmentInfo } from './shared';
import { money } from '@/lib/ui-settings';

const partSchema = z.object({
  equipmentId: z.string().min(1, '장비를 선택하세요'),
  partName: z.string().min(1, '부품명을 입력하세요'),
  partNumber: z.string().optional(),
  currentStock: z.string().min(1, '현재고를 입력하세요'),
  minStock: z.string().optional(),
  unitPrice: z.string().optional(),
  supplier: z.string().optional(),
});
type PartForm = z.infer<typeof partSchema>;

interface LowStockPart {
  equipment_name: string;
  asset_number: string;
  part_name: string;
  part_number?: string;
  current_stock: number;
  min_stock: number;
  supplier?: string;
  unit_price?: number | string;
}

export function PartsTab({ equipments, lowStockData, onRefresh }: { equipments: EquipmentInfo[]; lowStockData: LowStockPart[]; onRefresh: () => void }) {
  const tAttr = useTAttr();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<PartForm>({
    resolver: zodResolver(partSchema),
    defaultValues: { equipmentId: '' },
  });

  const onSubmit = async (formData: PartForm) => {
    setSaving(true);
    try {
      const { equipmentId, ...body } = formData;
      await apiClient.post(`/api/v1/equipment/${equipmentId}/parts`, body);
      setShowForm(false);
      reset();
      onRefresh();
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" /></svg>
          <T k="부품 등록" />
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-2xl border border-blue-100 shadow-sm p-5 mb-4">
          <h4 className="text-sm font-bold text-gray-900 mb-4"><T k="부품 등록" /></h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="col-span-2">
              <label className="text-[10px] text-gray-500 mb-1 block"><T k="장비 *" /></label>
              <Controller name="equipmentId" control={control} render={({ field }) => <EquipmentSelect equipments={equipments} value={field.value} onChange={field.onChange} />} />
              {errors.equipmentId && <p className="text-xs text-red-500 mt-0.5"><T k={errors.equipmentId.message ?? ''} /></p>}
            </div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="부품명 *" /></label><input {...register('partName')} placeholder="X-ray Tube" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />{errors.partName && <p className="text-xs text-red-500 mt-0.5"><T k={errors.partName.message ?? ''} /></p>}</div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="부품번호" /></label><input {...register('partNumber')} placeholder="PT-001" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="현재고 *" /></label><input type="number" {...register('currentStock')} placeholder="0" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />{errors.currentStock && <p className="text-xs text-red-500 mt-0.5"><T k={errors.currentStock.message ?? ''} /></p>}</div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="안전재고" /></label><input type="number" {...register('minStock')} placeholder="1" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="단가(원)" /></label><input type="number" {...register('unitPrice')} placeholder="0" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="공급처" /></label><input {...register('supplier')} placeholder={tAttr('공급업체명')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl disabled:opacity-50"><T k={saving ? '저장중...' : '등록'} /></button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-900"><T k="부족 부품 현황" /></h3>
          <p className="text-[11px] text-gray-400 mt-0.5"><T k="현재 재고가 안전재고 이하인 부품" /></p>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="장비" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부품명" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부품번호" /></th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500"><T k="현재고" /></th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500"><T k="안전재고" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="공급처" /></th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500"><T k="단가" /></th>
            </tr>
          </thead>
          <tbody>
            {lowStockData.length === 0 ? (
              <tr><td colSpan={7} className="py-12 text-center text-gray-400 text-sm"><T k="부족 부품 없음 (정상). 위 버튼으로 부품을 등록하세요." /></td></tr>
            ) : lowStockData.map((p: LowStockPart, i: number) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="px-4 py-3"><p className="font-medium text-gray-900 text-xs">{p.equipment_name}</p><p className="text-[10px] text-gray-400 font-mono">{p.asset_number}</p></td>
                <td className="px-4 py-3 font-medium text-gray-900 text-xs">{p.part_name}</td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{p.part_number ?? '-'}</td>
                <td className="px-4 py-3 text-right tabular-nums font-bold text-red-600">{p.current_stock}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{p.min_stock}</td>
                <td className="px-4 py-3 text-gray-600 text-xs">{p.supplier ?? '-'}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700 text-xs">{p.unit_price ? `${money(Number(p.unit_price))}` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
