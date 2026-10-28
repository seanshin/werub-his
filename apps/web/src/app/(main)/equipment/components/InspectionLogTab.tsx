'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';
import { useState } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiClient } from '@/lib/api-client';
import { INSP_TYPE_LABEL, RESULT_COLOR } from './constants';
import { EquipmentSelect } from './shared';
import { kdate } from '@/lib/ui-settings';
import { kstToday } from '@/lib/kst-today';

interface Equipment {
  id: string;
  name: string;
  assetNumber?: string;
}

interface CheckItem {
  item: string;
  result: string;
  notes: string;
}

interface InspectionLog {
  id: string;
  inspectionDate: string;
  inspectorName: string;
  inspectionType: string;
  overallResult: string;
  findings?: string;
  nextInspectionDate?: string;
  checkItems?: CheckItem[];
  equipment?: { name: string; assetNumber?: string };
}

const inspectionSchema = z.object({
  equipmentId: z.string().min(1, '장비를 선택하세요'),
  inspectionDate: z.string().min(1),
  inspectorName: z.string().min(1, '점검자를 입력하세요'),
  inspectionType: z.string(),
  overallResult: z.string(),
  checkItems: z.array(z.object({
    item: z.string(),
    result: z.string(),
    notes: z.string(),
  })),
  findings: z.string().optional(),
  nextInspectionDate: z.string().optional(),
});
type InspectionForm = z.infer<typeof inspectionSchema>;

/**
 * 🔴 점검 항목의 초기값은 **미선택**이다 — 종전엔 5항목 전부 `PASS` 로 시작해
 *    **점검하지 않아도 전부 합격이 저장됐다**(P16 — 실행하지 않고 성공 상태만 기록).
 *    쓰기 폼의 초기값은 미선택(임상 UX §2 — 간호초기평가 '전부 정상' 사고와 동일 유형).
 *    해당 없음은 N/A 로 명시 선택한다 — 미점검과 해당없음은 다른 사실이다.
 */
const DEFAULT_CHECK_ITEMS: CheckItem[] = [
  { item: '외관 상태', result: '', notes: '' },
  { item: '작동 확인', result: '', notes: '' },
  { item: '안전장치', result: '', notes: '' },
  { item: '전기/접지', result: '', notes: '' },
  { item: '교정 상태', result: '', notes: '' },
];

export function InspectionLogTab({ equipments, data, onRefresh }: { equipments: Equipment[]; data: InspectionLog[]; onRefresh: () => void }) {
  const tAttr = useTAttr();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<InspectionForm>({
    resolver: zodResolver(inspectionSchema),
    defaultValues: {
      equipmentId: '', inspectionDate: kstToday(),
      inspectorName: '', inspectionType: 'MONTHLY', overallResult: 'PASS',
      checkItems: DEFAULT_CHECK_ITEMS, findings: '', nextInspectionDate: '',
    },
  });
  const { fields } = useFieldArray({ control, name: 'checkItems' });
  const [unjudgedError, setUnjudgedError] = useState<string | null>(null);

  const onSubmit = async (formData: InspectionForm) => {
    // 🔴 판정 없는 항목이 있으면 저장하지 않는다 — 무엇이 비었는지 나열한다(사라지는 알림이 아니라 그 자리에서).
    //    막는 이유: 점검일지는 판정의 기록이다 — 미판정 항목이 섞인 일지는 기록이 아니라 빈 종이다.
    const unjudged = formData.checkItems.filter((c) => c.item.trim() && !c.result).map((c) => c.item);
    if (unjudged.length > 0) {
      setUnjudgedError(`판정하지 않은 항목: ${unjudged.join(' · ')} — 적합/부적합/N/A 를 선택해야 저장됩니다`);
      return;
    }
    setUnjudgedError(null);
    setSaving(true);
    try {
      const { equipmentId, ...body } = formData;
      await apiClient.post(`/api/v1/equipment/${equipmentId}/inspection-logs`, body);
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
          <T k="점검일지 작성" />
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-2xl border border-blue-100 shadow-sm p-5 mb-4">
          <h4 className="text-sm font-bold text-gray-900 mb-4"><T k="점검일지 작성" /></h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="col-span-2">
              <label className="text-[10px] text-gray-500 mb-1 block"><T k="장비 *" /></label>
              <Controller name="equipmentId" control={control} render={({ field }) => <EquipmentSelect equipments={equipments} value={field.value} onChange={field.onChange} />} />
              {errors.equipmentId && <p className="text-xs text-red-500 mt-0.5"><T k={errors.equipmentId.message ?? ''} /></p>}
            </div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="점검일 *" /></label><input type="date" {...register('inspectionDate')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="점검자 *" /></label><input {...register('inspectorName')} placeholder={tAttr('의공팀 홍길동')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />{errors.inspectorName && <p className="text-xs text-red-500 mt-0.5"><T k={errors.inspectorName.message ?? ''} /></p>}</div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="유형" /></label><select {...register('inspectionType')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">
              <option value="DAILY">{tAttr('일일')}</option><option value="WEEKLY">{tAttr('주간')}</option><option value="MONTHLY">{tAttr('월간')}</option><option value="QUARTERLY">{tAttr('분기')}</option><option value="ANNUAL">{tAttr('연간')}</option>
            </select></div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="종합결과" /></label><select {...register('overallResult')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">
              <option value="PASS">{tAttr('적합(PASS)')}</option><option value="CONDITIONAL">{tAttr('조건부')}</option><option value="FAIL">{tAttr('부적합(FAIL)')}</option>
            </select></div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="다음점검일" /></label><input type="date" {...register('nextInspectionDate')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
            <div><label className="text-[10px] text-gray-500 mb-1 block"><T k="소견" /></label><input {...register('findings')} placeholder={tAttr('점검 소견')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
          </div>
          <p className="text-[10px] font-semibold text-gray-500 mb-2"><T k="점검 항목 체크리스트" /></p>
          <div className="space-y-1 mb-4">
            {fields.map((field, i) => (
              <div key={field.id} className="grid grid-cols-[1fr_100px_1fr] gap-2">
                <input {...register(`checkItems.${i}.item`)} placeholder={tAttr('점검항목')} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
                <select {...register(`checkItems.${i}.result`)} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs">
                  <option value="">{tAttr('미점검 — 선택')}</option>
                  <option value="PASS">{tAttr('적합')}</option><option value="FAIL">{tAttr('부적합')}</option><option value="NA">N/A</option>
                </select>
                <input {...register(`checkItems.${i}.notes`)} placeholder={tAttr('비고')} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
              </div>
            ))}
          </div>
          {unjudgedError && <p className="text-xs text-red-600 mb-2">{unjudgedError}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl disabled:opacity-50"><T k={saving ? '저장중...' : '저장'} /></button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="장비" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="점검일" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="점검자" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="결과" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="점검항목" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="소견" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="다음점검" /></th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center text-gray-400 text-sm"><T k="점검일지가 없습니다. 위 버튼을 눌러 작성하세요." /></td></tr>
            ) : data.map((l: InspectionLog) => {
              const items = Array.isArray(l.checkItems) ? l.checkItems : [];
              const passCount = items.filter((i: CheckItem) => i.result === 'PASS').length;
              return (
                <tr key={l.id} className="border-b border-gray-50 hover:bg-blue-50/30">
                  <td className="px-4 py-3"><p className="font-medium text-gray-900 text-xs">{l.equipment?.name}</p><p className="text-[10px] text-gray-400 font-mono">{l.equipment?.assetNumber}</p></td>
                  <td className="px-4 py-3 text-xs tabular-nums text-gray-600">{kdate(new Date(l.inspectionDate))}</td>
                  <td className="px-4 py-3 text-gray-700 text-xs">{l.inspectorName}</td>
                  <td className="px-4 py-3"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600"><T k={INSP_TYPE_LABEL[l.inspectionType] ?? l.inspectionType} /></span></td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${RESULT_COLOR[l.overallResult] ?? 'bg-gray-100 text-gray-500'}`}>{l.overallResult}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-600">{passCount}/{items.length} <T k="통과" /></td>
                  <td className="px-4 py-3 text-xs text-gray-600 max-w-[150px] truncate">{l.findings ?? '-'}</td>
                  <td className="px-4 py-3 text-xs tabular-nums text-gray-500">{l.nextInspectionDate ? kdate(l.nextInspectionDate) : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
