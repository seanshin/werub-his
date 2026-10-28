'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface TemplateItem {
  name: string;
  unit: string;
  refRange: string;
  decimalPlaces?: number;
}

interface Template {
  id: string;
  procedureCode: string;
  testName: string;
  stationId: string;
  items: TemplateItem[];
  isActive: boolean;
}

const STATION_LABELS: Record<string, string> = {
  'lab-phlebotomy': '채혈실', 'lab-hematology': '혈액검사', 'lab-chemistry': '생화학',
  'lab-urinalysis': '소변검사', 'lab-microbiology': '미생물',
  'img-xray': '일반촬영', 'img-ct': 'CT', 'img-mri': 'MRI', 'img-ultrasound': '초음파',
  'diag-ecg': '심전도', 'diag-pft': '폐기능', 'diag-endoscopy': '내시경',
};

export default function TemplatesPage() {
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const [stationFilter, setStationFilter] = useState('');
  const [editTarget, setEditTarget] = useState<Template | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    procedureCode: '', testName: '', stationId: 'lab-hematology',
    items: [{ name: '', unit: '', refRange: '', decimalPlaces: 0 }] as TemplateItem[],
  });

  const { data: res, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ws-templates', stationFilter],
    queryFn: () => apiClient.get<any>('/api/v1/workstation/templates', stationFilter ? { stationId: stationFilter } : undefined),
  });
  const templates: Template[] = res?.data ?? [];

  const createMut = useMutation({
    mutationFn: (data: any) => apiClient.post('/api/v1/workstation/templates', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ws-templates'] }); setShowCreate(false); toast.success('템플릿 생성 완료'); },
    onError: () => toast.error('생성 실패'),
  });

  const updateMut = useMutation({
    mutationFn: ({ code, data }: { code: string; data: any }) => apiClient.put(`/api/v1/workstation/templates/${code}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ws-templates'] }); setEditTarget(null); toast.success('수정 완료'); },
  });

  const deleteMut = useMutation({
    mutationFn: (code: string) => apiClient.del(`/api/v1/workstation/templates/${code}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ws-templates'] }); toast.success('비활성화 완료'); },
  });

  const addItem = () => setForm({ ...form, items: [...form.items, { name: '', unit: '', refRange: '', decimalPlaces: 0 }] });
  const updateItem = (idx: number, field: string, value: any) => {
    const items = [...form.items];
    (items[idx] as any)[field] = value;
    setForm({ ...form, items });
  };
  const removeItem = (idx: number) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });

  const startEdit = (t: Template) => {
    setEditTarget(t);
    setForm({ procedureCode: t.procedureCode, testName: t.testName, stationId: t.stationId, items: [...t.items] });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="검사항목 템플릿 관리" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="검사 코드별 입력 항목(이름/단위/참고범위)을 관리합니다" /></p>
        </div>
        <button onClick={() => { setShowCreate(true); setForm({ procedureCode: '', testName: '', stationId: 'lab-hematology', items: [{ name: '', unit: '', refRange: '', decimalPlaces: 0 }] }); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700"><T k="+ 템플릿 추가" /></button>
      </div>

      {/* 스테이션 필터 */}
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setStationFilter('')}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${!stationFilter ? 'bg-gray-800 text-white border-gray-800' : 'bg-white border-gray-200 text-gray-500'}`}><T k="전체" /></button>
        {Object.entries(STATION_LABELS).map(([id, label]) => (
          <button key={id} onClick={() => setStationFilter(stationFilter === id ? '' : id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${stationFilter === id ? 'bg-gray-800 text-white border-gray-800' : 'bg-white border-gray-200 text-gray-500'}`}>{label}</button>
        ))}
      </div>

      {/* 템플릿 목록 */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-400"><T k="로딩 중..." /></div>
      ) : isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="bg-white border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="font-semibold text-gray-900">{t.testName}</span>
                  <span className="ml-2 px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-mono">{t.procedureCode}</span>
                  <span className="ml-2 text-xs text-gray-400">{STATION_LABELS[t.stationId] ?? t.stationId}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => startEdit(t)} className="px-3 py-1 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200"><T k="수정@행위" /></button>
                  <button onClick={() => { if (confirm('비활성화?')) deleteMut.mutate(t.procedureCode); }}
                    className="px-3 py-1 bg-red-50 text-red-600 rounded-lg text-xs hover:bg-red-100"><T k="삭제" /></button>
                </div>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b">
                    <th className="text-left py-1"><T k="항목명" /></th>
                    <th className="text-left py-1 w-20"><T k="단위" /></th>
                    <th className="text-left py-1 w-28"><T k="참고범위" /></th>
                  </tr>
                </thead>
                <tbody>
                  {(t.items as TemplateItem[]).map((item, idx) => (
                    <tr key={idx} className="border-b border-gray-50">
                      <td className="py-1 font-medium text-gray-700">{item.name}</td>
                      <td className="py-1 text-gray-500">{item.unit}</td>
                      <td className="py-1 text-gray-500 font-mono">{item.refRange}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-xs text-gray-400 mt-2">{(t.items as any[]).length}항목</div>
            </div>
          ))}
          {templates.length === 0 && <EmptyState icon="📄" title="템플릿이 없습니다" />}
        </div>
      )}

      {/* 생성/수정 모달 */}
      {(showCreate || editTarget) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setShowCreate(false); setEditTarget(null); }}>
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex-shrink-0">
              <h3 className="font-bold">{editTarget ? '템플릿 수정' : '새 템플릿'}</h3>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="검사코드 *" /></label>
                  <input className="w-full border rounded-xl px-3 py-2 text-sm font-mono" placeholder="CBC" disabled={!!editTarget}
                    value={form.procedureCode} onChange={(e) => setForm({ ...form, procedureCode: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="검사명 *" /></label>
                  <input className="w-full border rounded-xl px-3 py-2 text-sm" placeholder={tAttr('일반혈액검사')}
                    value={form.testName} onChange={(e) => setForm({ ...form, testName: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="스테이션" /></label>
                  <select className="w-full border rounded-xl px-3 py-2 text-sm" value={form.stationId}
                    onChange={(e) => setForm({ ...form, stationId: e.target.value })}>
                    {Object.entries(STATION_LABELS).map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-2 block"><T k="검사 항목" /></label>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b">
                      <th className="text-left py-1"><T k="항목명 *" /></th>
                      <th className="text-left py-1 w-20"><T k="단위" /></th>
                      <th className="text-left py-1 w-28"><T k="참고범위" /></th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((item, idx) => (
                      <tr key={idx} className="border-b border-gray-50">
                        <td className="py-1"><input className="w-full border rounded px-2 py-1" placeholder="WBC" value={item.name} onChange={(e) => updateItem(idx, 'name', e.target.value)} /></td>
                        <td className="py-1"><input className="w-full border rounded px-2 py-1" placeholder="/μL" value={item.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)} /></td>
                        <td className="py-1"><input className="w-full border rounded px-2 py-1 font-mono" placeholder="4000-10000" value={item.refRange} onChange={(e) => updateItem(idx, 'refRange', e.target.value)} /></td>
                        <td className="py-1 text-center"><button onClick={() => removeItem(idx)} className="text-gray-300 hover:text-red-500">×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={addItem} className="mt-2 text-xs text-blue-600 hover:underline"><T k="+ 항목 추가" /></button>
              </div>
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2 flex-shrink-0">
              <button onClick={() => { setShowCreate(false); setEditTarget(null); }} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm"><T k="취소" /></button>
              <button onClick={() => {
                const payload = { ...form, items: form.items.filter((i) => i.name) };
                if (editTarget) updateMut.mutate({ code: form.procedureCode, data: payload });
                else createMut.mutate(payload);
              }}
                disabled={!form.procedureCode || !form.testName || form.items.filter((i) => i.name).length === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                {editTarget ? '수정' : '생성'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
