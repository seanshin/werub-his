'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiClient } from '@/lib/api-client';
import { Field } from './shared';
import { kstToday } from '@/lib/kst-today';

const maintenanceSchema = z.object({
  type: z.string().min(1),
  status: z.string().optional(),
  description: z.string().min(1, '설명을 입력하세요'),
  performedBy: z.string().optional(),
  vendor: z.string().optional(),
  cost: z.string().optional(),
  performedAt: z.string().min(1),
  partReplaced: z.string().optional(),
  resultNotes: z.string().optional(),
});
type MaintenanceForm = z.infer<typeof maintenanceSchema>;

export function MaintenanceLogModal({ equipmentId, onClose }: { equipmentId: string; onClose: () => void }) {
  const tAttr = useTAttr();
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<MaintenanceForm>({
    resolver: zodResolver(maintenanceSchema),
    defaultValues: { type: 'REPAIR', status: 'COMPLETED', performedAt: kstToday() },
  });

  const onSubmit = async (data: MaintenanceForm) => {
    setSaving(true);
    try {
      await apiClient.post(`/api/v1/equipment/${equipmentId}/maintenance`, data);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg">
        <h3 className="text-sm font-bold text-gray-900 mb-5"><T k="정비/A/S 기록 추가" /></h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1"><T k="유형 *" /></label>
            <select {...register('type')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">
              <option value="INSPECTION">{tAttr('정기점검')}</option>
              <option value="CALIBRATION">{tAttr('교정')}</option>
              <option value="REPAIR">{tAttr('수리')}</option>
              <option value="FAULT_REPORT">{tAttr('고장신고')}</option>
              <option value="AS_REQUEST">{tAttr('A/S 요청')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1"><T k="상태" /></label>
            <select {...register('status')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">
              <option value="REQUESTED">{tAttr('요청')}</option>
              <option value="IN_PROGRESS">{tAttr('진행중')}</option>
              <option value="COMPLETED">{tAttr('완료')}</option>
            </select>
          </div>
          <Field label="설명 *" {...register('description')} placeholder={tAttr('정비/수리 내용')} error={errors.description?.message} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="수행자" {...register('performedBy')} placeholder={tAttr('의공팀 홍길동')} />
            <Field label="외부 업체" {...register('vendor')} placeholder={tAttr('업체명')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="비용(원)" {...register('cost')} type="number" placeholder="0" />
            <Field label="일자 *" {...register('performedAt')} type="date" />
          </div>
          <Field label="교체 부품" {...register('partReplaced')} placeholder={tAttr('교체된 부품명')} />
          <Field label="처리 결과" {...register('resultNotes')} placeholder={tAttr('처리 결과 요약')} />
        </div>
        <div className="flex gap-2 mt-6">
          <button type="button" onClick={onClose} className="flex-1 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50"><T k="취소" /></button>
          <button type="submit" disabled={saving} className="flex-1 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50">
            <T k={saving ? '저장중...' : '저장'} />
          </button>
        </div>
      </form>
    </div>
  );
}
