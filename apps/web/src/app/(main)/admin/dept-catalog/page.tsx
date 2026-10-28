'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useDepartments, DeptLoadError } from '@/lib/use-departments';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

// 진료과 목록 정본 = 마스터(useDepartments) — 종전 로컬 10과는 마스터 36과의 부분집합이라 카탈로그를 못 만드는 과가 있었다

interface DeptCatalogItem {
  id: string;
  codeType: string;
  subcategory?: string;
  defaultDosage?: string;
  defaultFrequency?: string;
  defaultRoute?: string;
  guideNote?: string;
  codeDetail?: { code?: string; nameKo?: string };
}

export default function DeptCatalogPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [dept, setDept] = useState('내과');
  const { names: departments, isError: deptListError, refetch: refetchDepts } = useDepartments({ category: 'CLINICAL', include: [dept] });
  const [codeType, setCodeType] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ codeId: '', codeType: 'MEDICATION_CODE', subcategory: '', defaultDosage: '', defaultFrequency: '', guideNote: '' });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dept-catalog', dept, codeType],
    queryFn: () => apiClient.get<{ data: DeptCatalogItem[] }>('/api/v1/dept-catalog', { department: dept, codeType: codeType || undefined }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/dept-catalog/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dept-catalog'] }); toast.success('제거됨'); },
  });

  const _itemsRaw = data?.data;
  const items: DeptCatalogItem[] = Array.isArray(_itemsRaw) ? _itemsRaw : (_itemsRaw as unknown as Record<string, unknown>)?.data as DeptCatalogItem[] ?? [];

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="진료과 코드 카탈로그" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="진료과별 표준 약물/검사/영상 코드와 처방 가이드를 관리합니다." /></p>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <select value={dept} onChange={e => setDept(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm">
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        {deptListError && <DeptLoadError onRetry={refetchDepts} />}
        <select value={codeType} onChange={e => setCodeType(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm">
          <option value="">{tAttr('전체')}</option>
          <option value="MEDICATION_CODE">{tAttr('약물')}</option>
          <option value="PROCEDURE_CODE">{tAttr('검사/영상')}</option>
        </select>
        <span className="text-sm text-gray-400">{items.length}<Unit>개</Unit></span>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="코드" /></th>
              <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="이름" /></th>
              <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="분류" /></th>
              <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="기본 용법" /></th>
              <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="가이드" /></th>
              <th className="text-right px-4 py-3 font-medium text-gray-500"><T k="작업" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400"><T k="로딩 중..." /></td></tr>
            : items.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400"><T k="등록된 코드가 없습니다" /></td></tr>
            : items.map((item: DeptCatalogItem) => (
              <tr key={item.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{item.codeDetail?.code ?? '—'}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{item.codeDetail?.nameKo ?? '—'}</td>
                <td className="px-4 py-3"><span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{item.subcategory ?? item.codeType}</span></td>
                <td className="px-4 py-3 text-xs text-gray-500">{[item.defaultDosage, item.defaultFrequency, item.defaultRoute].filter(Boolean).join(' / ') || '—'}</td>
                <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{item.guideNote ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => deleteMut.mutate(item.id)} className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100"><T k="제거" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
