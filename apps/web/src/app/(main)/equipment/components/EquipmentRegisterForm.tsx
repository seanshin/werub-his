'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiClient } from '@/lib/api-client';

const equipmentSchema = z.object({
  assetNumber: z.string().min(1, '자산번호를 입력하세요'),
  name: z.string().min(1, '장비명을 입력하세요'),
  category: z.string().min(1, '분류를 입력하세요'),
  location: z.string().optional(),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  purchaseDate: z.string().optional(),
  purchasePrice: z.string().optional(),
  warrantyExpiry: z.string().optional(),
  nextInspection: z.string().optional(),
  supplierName: z.string().optional(),
  supplierContact: z.string().optional(),
  supplierPhone: z.string().optional(),
  asContactName: z.string().optional(),
  asContactPhone: z.string().optional(),
  notes: z.string().optional(),
});
type EquipmentForm = z.infer<typeof equipmentSchema>;

export function EquipmentRegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const tAttr = useTAttr();
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<EquipmentForm>({
    resolver: zodResolver(equipmentSchema),
  });

  const onSubmit = async (data: EquipmentForm) => {
    setSaving(true);
    try {
      await apiClient.post('/api/v1/equipment', data);
      onSuccess();
    } finally { setSaving(false); }
  };

  const inputClass = (name: keyof EquipmentForm) =>
    `w-full px-3 py-2 border ${errors[name] ? 'border-red-300' : 'border-gray-200'} rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent`;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 max-w-3xl">
      <h3 className="text-sm font-bold text-gray-900 mb-5"><T k="신규 장비 등록" /></h3>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="자산번호 *" /></label>
          <input {...register('assetNumber')} placeholder="EQ-2026-001" className={inputClass('assetNumber')} />
          {errors.assetNumber && <p className="text-xs text-red-500 mt-0.5"><T k={errors.assetNumber.message ?? ''} /></p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="장비명 *" /></label>
          <input {...register('name')} placeholder={tAttr('장비명')} className={inputClass('name')} />
          {errors.name && <p className="text-xs text-red-500 mt-0.5"><T k={errors.name.message ?? ''} /></p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="분류 *" /></label>
          <input {...register('category')} placeholder={tAttr('진단장비, 수술장비, 치료장비...')} className={inputClass('category')} />
          {errors.category && <p className="text-xs text-red-500 mt-0.5"><T k={errors.category.message ?? ''} /></p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="위치" /></label>
          <input {...register('location')} placeholder={tAttr('1층 영상의학과')} className={inputClass('location')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="제조사" /></label>
          <input {...register('manufacturer')} placeholder={tAttr('제조사명')} className={inputClass('manufacturer')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="모델" /></label>
          <input {...register('model')} placeholder={tAttr('모델명')} className={inputClass('model')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="시리얼번호" /></label>
          <input {...register('serialNumber')} placeholder="S/N" className={inputClass('serialNumber')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="구매일" /></label>
          <input type="date" {...register('purchaseDate')} className={inputClass('purchaseDate')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="구매금액(원)" /></label>
          <input type="number" {...register('purchasePrice')} placeholder="0" className={inputClass('purchasePrice')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="보증만료일" /></label>
          <input type="date" {...register('warrantyExpiry')} className={inputClass('warrantyExpiry')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="다음점검일" /></label>
          <input type="date" {...register('nextInspection')} className={inputClass('nextInspection')} />
        </div>
      </div>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3"><T k="공급업체 / A/S 정보" /></p>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="공급업체명" /></label>
          <input {...register('supplierName')} placeholder={tAttr('주식회사 ○○○')} className={inputClass('supplierName')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="공급 담당자" /></label>
          <input {...register('supplierContact')} placeholder={tAttr('담당자명')} className={inputClass('supplierContact')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="공급업체 연락처" /></label>
          <input {...register('supplierPhone')} placeholder="02-0000-0000" className={inputClass('supplierPhone')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="A/S 담당자" /></label>
          <input {...register('asContactName')} placeholder={tAttr('A/S 담당자명')} className={inputClass('asContactName')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="A/S 연락처" /></label>
          <input {...register('asContactPhone')} placeholder="02-0000-0000" className={inputClass('asContactPhone')} />
        </div>
      </div>
      <div className="mb-6">
        <label className="block text-xs font-medium text-gray-700 mb-1"><T k="비고" /></label>
        <textarea {...register('notes')} rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
      </div>
      <button type="submit" disabled={saving} className="px-6 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50">
        <T k={saving ? '등록중...' : '장비 등록'} />
      </button>
    </form>
  );
}
