'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';
import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiClient } from '@/lib/api-client';
import { CONDITION_LABEL, CONDITION_COLOR } from './constants';
import { EquipmentSelect, EquipmentInfo } from './shared';
import { kdate } from '@/lib/ui-settings';
import { kstToday } from '@/lib/kst-today';

const usageSchema = z.object({
  equipmentId: z.string().min(1, '장비를 선택하세요'),
  usedDate: z.string().min(1),
  usedBy: z.string().min(1, '사용자를 입력하세요'),
  department: z.string().optional(),
  patientCount: z.string().optional(),
  usageHours: z.string().optional(),
  condition: z.string(),
  purpose: z.string().optional(),
  issueNotes: z.string().optional(),
});
type UsageForm = z.infer<typeof usageSchema>;

interface UsageLog {
  id: string;
  usedDate: string;
  usedBy: string;
  department?: string;
  patientCount?: number;
  usageHours?: number;
  purpose?: string;
  condition: string;
  equipment?: { name: string; assetNumber?: string };
}

export function UsageLogTab({ equipments, data, onRefresh }: { equipments: EquipmentInfo[]; data: UsageLog[]; onRefresh: () => void }) {
  const tAttr = useTAttr();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<UsageForm>({
    resolver: zodResolver(usageSchema),
    defaultValues: { usedDate: kstToday(), condition: 'NORMAL', equipmentId: '' },
  });

  const onSubmit = async (formData: UsageForm) => {
    setSaving(true);
    try {
      const { equipmentId, ...body } = formData;
      await apiClient.post(`/api/v1/equipment/${equipmentId}/usage-logs`, body);
      setShowForm(false);
      reset();
      onRefresh();
    } finally { setSaving(false); }
  };

  return (
    <div>
      {/* 작성 버튼 */}
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" /></svg>
          <T k="사용일지 작성" />
        </button>
      </div>

      {/* 입력 폼 */}
      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-2xl border border-blue-100 shadow-sm p-5 mb-4">
          <h4 className="text-sm font-bold text-gray-900 mb-4"><T k="사용일지 작성" /></h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <div className="col-span-2">
              <label className="text-[10px] text-gray-500 mb-1 block"><T k="장비 *" /></label>
              <Controller name="equipmentId" control={control} render={({ field }) => <EquipmentSelect equipments={equipments} value={field.value} onChange={field.onChange} />} />
              {errors.equipmentId && <p className="text-xs text-red-500 mt-0.5"><T k={errors.equipmentId.message ?? ''} /></p>}
            </div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="사용일 *" /></label><input type="date" {...register('usedDate')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="사용자 *" /></label><input {...register('usedBy')} placeholder={tAttr('홍길동')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />{errors.usedBy && <p className="text-xs text-red-500 mt-0.5"><T k={errors.usedBy.message ?? ''} /></p>}</div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="부서" /></label><input {...register('department')} placeholder={tAttr('영상의학과')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="환자수" /></label><input type="number" {...register('patientCount')} placeholder="0" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="사용시간(h)" /></label><input type="number" step="0.5" {...register('usageHours')} placeholder="0" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="사용 후 상태" /></label><select {...register('condition')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">
              <option value="NORMAL">{tAttr('정상')}</option><option value="ISSUE">{tAttr('이상감지')}</option><option value="FAULT">{tAttr('고장')}</option>
            </select></div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="사용 목적" /></label><input {...register('purpose')} placeholder={tAttr('CT 촬영')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="이상 소견" /></label><input {...register('issueNotes')} placeholder={tAttr('이상 발견 시 기록')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl disabled:opacity-50"><T k={saving ? '저장중...' : '저장'} /></button>
          </div>
        </form>
      )}

      {/* 목록 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="장비" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="사용일" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="사용자" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부서" /></th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500"><T k="환자수" /></th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500"><T k="시간(h)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="목적" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center text-gray-400 text-sm"><T k="사용일지가 없습니다. 위 버튼을 눌러 작성하세요." /></td></tr>
            ) : data.map((u: UsageLog) => (
              <tr key={u.id} className="border-b border-gray-50 hover:bg-blue-50/30">
                <td className="px-4 py-3"><p className="font-medium text-gray-900 text-xs">{u.equipment?.name}</p><p className="text-[10px] text-gray-400 font-mono">{u.equipment?.assetNumber}</p></td>
                <td className="px-4 py-3 text-xs tabular-nums text-gray-600">{kdate(new Date(u.usedDate))}</td>
                <td className="px-4 py-3 text-gray-700 text-xs">{u.usedBy}</td>
                <td className="px-4 py-3 text-gray-600 text-xs">{u.department ?? '-'}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700 text-xs">{u.patientCount ?? '-'}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700 text-xs">{u.usageHours ?? '-'}</td>
                <td className="px-4 py-3 text-gray-600 text-xs max-w-[150px] truncate">{u.purpose ?? '-'}</td>
                <td className="px-4 py-3"><span className={`text-[11px] font-semibold ${CONDITION_COLOR[u.condition] ?? 'text-gray-500'}`}>{CONDITION_LABEL[u.condition] ?? '-'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
