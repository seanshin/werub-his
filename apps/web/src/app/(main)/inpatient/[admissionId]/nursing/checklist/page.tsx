'use client';
import { NurseOnlyGuard } from '@/components/nursing/NurseOnlyGuard';
import { Unit } from '@/components/ui/display';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { kdate } from '@/lib/ui-settings';

interface ChecklistItem { item: string; checked: boolean; checkedAt?: string | null; note?: string | null }
interface Checklist {
  id: string; templateType: string; shiftType?: string;
  items: ChecklistItem[]; totalItems: number; checkedItems: number;
  completedAt?: string | null; createdAt: string;
  nurse?: { familyName?: string; givenName?: string };
}

const TEMPLATE_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  SHIFT_HANDOFF:    { label: '근무교대',   icon: '🔄', color: 'blue' },
  SAFETY_IPSG:      { label: '환자안전',   icon: '🛡️', color: 'emerald' },
  PRE_OP:           { label: '수술 전',    icon: '🏥', color: 'amber' },
  POST_OP:          { label: '수술 후',    icon: '💊', color: 'purple' },
  FALL_PREVENTION:  { label: '낙상예방',   icon: '⚠️', color: 'orange' },
  PRESSURE_ULCER:   { label: '욕창예방',   icon: '🩹', color: 'rose' },
};

export default function ChecklistPage() {
  const { admissionId } = useParams();
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const canEdit = user?.role === 'NURSE' || user?.role === 'ADMIN';
  const [selectedType, setSelectedType] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['nursing-checklists', admissionId],
    queryFn: () => apiClient.get<any>(`/api/v1/admissions/${admissionId}/checklists`),
    enabled: !!admissionId,
  });
  const checklists: Checklist[] = (data?.data?.data ?? data?.data ?? []) as Checklist[];

  const createChecklist = useMutation({
    mutationFn: (templateType: string) => apiClient.post(`/api/v1/admissions/${admissionId}/checklists`, { templateType }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nursing-checklists'] }); toast.success(tAttr('체크리스트 생성')); },
    onError: () => toast.error(tAttr('생성 실패')),
  });

  const toggleItem = useMutation({
    mutationFn: ({ checklistId, index, checked }: { checklistId: string; index: number; checked: boolean }) =>
      apiClient.patch(`/api/v1/admissions/${admissionId}/checklists/${checklistId}/items/${index}`, { checked }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nursing-checklists'] }),
  });

  const filtered = selectedType ? checklists.filter(c => c.templateType === selectedType) : checklists;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/inpatient/${admissionId}/nursing/timeline`} className="text-sm text-blue-600 hover:underline">← <T k="타임라인" /></Link>
          <h1 className="text-xl font-bold text-gray-900 mt-1"><T k="간호 체크리스트" /></h1>
        </div>
      </div>

      {/* 새 체크리스트 생성 — 간호사만 */}
      {canEdit ? (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-bold text-gray-700 mb-3"><T k="새 체크리스트 생성" /></h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {Object.entries(TEMPLATE_CONFIG).map(([key, cfg]) => (
            <button key={key} onClick={() => createChecklist.mutate(key)} disabled={createChecklist.isPending}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border border-${cfg.color}-200 bg-${cfg.color}-50 hover:bg-${cfg.color}-100 transition text-center`}>
              <span className="text-lg">{cfg.icon}</span>
              <span className="text-[11px] font-medium text-gray-700"><T k={cfg.label} /></span>
            </button>
          ))}
        </div>
      </div>
      ) : (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <span className="text-xs text-blue-600 font-medium"><T k="읽기전용 — 체크리스트 생성은 간호사만 가능합니다" /></span>
        </div>
      )}

      {/* 필터 */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setSelectedType('')} className={`px-3 py-1.5 text-xs font-medium rounded-full ${!selectedType ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}><T k="전체" /></button>
        {Object.entries(TEMPLATE_CONFIG).map(([key, cfg]) => (
          <button key={key} onClick={() => setSelectedType(key)} className={`px-3 py-1.5 text-xs font-medium rounded-full ${selectedType === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {cfg.icon} <T k={cfg.label} />
          </button>
        ))}
      </div>

      {/* 체크리스트 목록 */}
      {isLoading ? <div className="h-40 bg-gray-100 rounded-xl animate-pulse" /> :
        isError ? <QueryErrorFallback error={error} onRetry={refetch} /> :
        filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2">✅</p>
            <p><T k="체크리스트가 없습니다. 위에서 생성해 주세요." /></p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map(cl => {
              const cfg = TEMPLATE_CONFIG[cl.templateType] ?? { label: cl.templateType, icon: '📋', color: 'gray' };
              const pct = cl.totalItems > 0 ? Math.round((cl.checkedItems / cl.totalItems) * 100) : 0;
              return (
                <div key={cl.id} className={`bg-white border rounded-2xl overflow-hidden ${cl.completedAt ? 'border-green-200' : 'border-gray-200'}`}>
                  {/* 헤더 */}
                  <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{cfg.icon}</span>
                      <span className="text-sm font-bold text-gray-900"><T k={cfg.label} /></span>
                      {cl.completedAt && <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold"><T k="완료" /></span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{cl.nurse ? `${cl.nurse.familyName}${cl.nurse.givenName}` : ''}</span>
                      <span className="text-xs text-gray-500">{cl.checkedItems}/{cl.totalItems}</span>
                    </div>
                  </div>

                  {/* 진행률 */}
                  <div className="px-5 pt-3">
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 text-right">{pct}<Unit>%</Unit></p>
                  </div>

                  {/* 항목 */}
                  <div className="px-5 pb-4 space-y-1">
                    {(cl.items as ChecklistItem[]).map((item, idx) => (
                      <label key={idx} className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition ${item.checked ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
                        <input type="checkbox" checked={item.checked}
                          onChange={() => toggleItem.mutate({ checklistId: cl.id, index: idx, checked: !item.checked })}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        <span className={`text-sm ${item.checked ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{item.item}</span>
                        {item.checkedAt && <span className="text-[10px] text-gray-300 ml-auto">{kdate(item.checkedAt, 'time')}</span>}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
