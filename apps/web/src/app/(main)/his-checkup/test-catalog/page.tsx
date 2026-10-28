'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

const CATEGORIES = [
  { key: 'PHYSICAL', label: '신체계측', color: 'bg-emerald-100 text-emerald-700' },
  { key: 'LAB', label: '검체검사', color: 'bg-blue-100 text-blue-700' },
  { key: 'IMAGING', label: '영상검사', color: 'bg-purple-100 text-purple-700' },
  { key: 'DIAGNOSTIC', label: '기능검사', color: 'bg-amber-100 text-amber-700' },
  { key: 'CONSULT', label: '상담', color: 'bg-gray-100 text-gray-700' },
  { key: 'AI', label: 'AI', color: 'bg-cyan-100 text-cyan-700' },
] as const;

const catMeta = (key: string) => CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[0];
const formatPrice = (n: number) => new Intl.NumberFormat('ko-KR').format(n);

interface TestItem {
  id: string;
  code: string;
  name: string;
  category: string;
  subCategory?: string;
  interpretDept?: string;
  unit?: string;
  referenceRange?: string;
  defaultPrice: number;
  duration: number;
  description?: string;
  isActive: boolean;
  sortOrder: number;
}

type EditorItem = Omit<TestItem, 'id' | 'isActive'> & { id?: string };

const EMPTY_ITEM: EditorItem = {
  code: '', name: '', category: 'LAB', subCategory: '', interpretDept: '',
  unit: '', referenceRange: '', defaultPrice: 0, duration: 5, description: '', sortOrder: 0,
};

export default function TestCatalogPage() {
  const queryClient = useQueryClient();
  const tAttr = useTAttr();
  const [catFilter, setCatFilter] = useState('');
  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorData, setEditorData] = useState<EditorItem>(EMPTY_ITEM);

  const { data: res, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['checkup-test-catalog', catFilter],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/test-catalog', catFilter ? { category: catFilter } : undefined),
  });
  const allItems: TestItem[] = res?.data ?? [];

  const { data: usageRes } = useQuery({
    queryKey: ['checkup-test-usage'],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/test-catalog/usage'),
  });
  const usageCounts: Record<string, number> = usageRes?.data ?? {};

  const items = useMemo(() => {
    if (!search) return allItems;
    const q = search.toLowerCase();
    return allItems.filter(
      (t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q) || t.subCategory?.toLowerCase().includes(q),
    );
  }, [allItems, search]);

  // 카테고리별 그룹
  const grouped = useMemo(() => {
    const map: Record<string, TestItem[]> = {};
    for (const item of items) {
      (map[item.category] ??= []).push(item);
    }
    return map;
  }, [items]);

  const subCategories = useMemo(() => {
    const set = new Set<string>();
    allItems.forEach((t) => t.subCategory && set.add(t.subCategory));
    return Array.from(set).sort();
  }, [allItems]);

  const saveMutation = useMutation({
    mutationFn: (data: EditorItem) =>
      data.id
        ? apiClient.put(`/api/v1/checkup/test-catalog/${data.id}`, data)
        : apiClient.post('/api/v1/checkup/test-catalog', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkup-test-catalog'] });
      setEditorOpen(false);
      toast.success(editorData.id ? '검사항목 수정 완료' : '검사항목 생성 완료');
    },
    onError: (err: any) => toast.error(err?.message || '저장 실패'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.put(`/api/v1/checkup/test-catalog/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkup-test-catalog'] });
      toast.success('상태 변경');
    },
  });

  const openEditor = (item?: TestItem) => {
    if (item) {
      setEditorData({
        id: item.id, code: item.code, name: item.name, category: item.category,
        subCategory: item.subCategory ?? '', interpretDept: item.interpretDept ?? '',
        unit: item.unit ?? '', referenceRange: item.referenceRange ?? '',
        defaultPrice: item.defaultPrice, duration: item.duration,
        description: item.description ?? '', sortOrder: item.sortOrder,
      });
    } else {
      setEditorData({ ...EMPTY_ITEM });
    }
    setEditorOpen(true);
  };

  const handleSave = () => {
    if (!editorData.code || !editorData.name) {
      toast.error('코드와 검사명은 필수입니다');
      return;
    }
    saveMutation.mutate(editorData);
  };

  const updateField = <K extends keyof EditorItem>(key: K, val: EditorItem[K]) => {
    setEditorData((prev) => ({ ...prev, [key]: val }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold"><T k="검사항목 관리" /></h1>
          <p className="text-sm text-gray-400 mt-0.5"><T k="검진 프로그램에서 사용하는 검사항목 마스터 카탈로그" /></p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder={tAttr('검사명 또는 코드 검색...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm w-56"
          />
          <button
            onClick={() => openEditor()}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-medium"
          >
            <T k="+ 검사항목 추가" />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-7 gap-2">
        <button
          onClick={() => setCatFilter('')}
          className={`p-3 rounded-xl text-center transition ${!catFilter ? 'bg-gray-800 text-white' : 'bg-gray-50 hover:bg-gray-100'}`}
        >
          <div className="text-2xl font-black">{allItems.length}</div>
          <div className="text-[11px] font-medium mt-0.5"><T k="전체" /></div>
        </button>
        {CATEGORIES.map((cat) => {
          const cnt = allItems.filter((t) => t.category === cat.key).length;
          return (
            <button
              key={cat.key}
              onClick={() => setCatFilter(catFilter === cat.key ? '' : cat.key)}
              className={`p-3 rounded-xl text-center transition ${
                catFilter === cat.key ? 'bg-gray-800 text-white' : 'bg-gray-50 hover:bg-gray-100'
              }`}
            >
              <div className="text-2xl font-black">{cnt}</div>
              <div className="text-[11px] font-medium mt-0.5"><T k={cat.label} /></div>
            </button>
          );
        })}
      </div>

      {/* Items table grouped by category */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400"><T k="로딩 중..." /></div>
      ) : isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : items.length === 0 ? (
        <EmptyState icon="🧪" title="검사항목이 없습니다" />
      ) : (
        Object.entries(grouped).map(([category, catItems]) => {
          const cat = catMeta(category);
          // subCategory로 그룹
          const subGroups: Record<string, TestItem[]> = {};
          for (const item of catItems) {
            const sub = item.subCategory || '기타';
            (subGroups[sub] ??= []).push(item);
          }

          return (
            <div key={category} className="bg-white rounded-xl border overflow-hidden">
              <div className="p-3 border-b bg-gray-50 flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${cat.color}`}><T k={cat.label} /></span>
                <span className="text-sm text-gray-500">{catItems.length}<Unit>개</Unit> <T k="항목" /></span>
              </div>

              {Object.entries(subGroups).map(([sub, subItems]) => (
                <div key={sub}>
                  <div className="px-4 py-1.5 bg-gray-50/50 text-xs font-medium text-gray-400 border-b">{sub}</div>
                  <table className="w-full text-sm">
                    <tbody className="divide-y">
                      {subItems.map((item) => (
                        <tr
                          key={item.id}
                          onClick={() => openEditor(item)}
                          className={`hover:bg-blue-50/50 cursor-pointer transition ${!item.isActive ? 'opacity-40' : ''}`}
                        >
                          <td className="px-4 py-2.5 w-28">
                            <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">{item.code}</code>
                          </td>
                          <td className="px-4 py-2.5 font-medium">{item.name}</td>
                          <td className="px-4 py-2.5 text-gray-400 text-xs w-24">{item.interpretDept || '-'}</td>
                          <td className="px-4 py-2.5 text-gray-400 text-xs w-20">{item.unit || '-'}</td>
                          <td className="px-4 py-2.5 text-gray-400 text-xs w-28">{item.referenceRange || '-'}</td>
                          <td className="px-4 py-2.5 text-right text-xs w-20">
                            {item.defaultPrice > 0 ? `${formatPrice(item.defaultPrice)}원` : '-'}
                          </td>
                          <td className="px-4 py-2.5 text-center text-xs w-14">{item.duration}<Unit>분</Unit></td>
                          <td className="px-4 py-2.5 text-center w-20">
                            {usageCounts[item.code] ? (
                              <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium whitespace-nowrap">
                                {usageCounts[item.code]}개 프로그램
                              </span>
                            ) : (
                              <span className="text-[10px] text-gray-300"><T k="미사용" /></span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 w-16" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => toggleActive.mutate({ id: item.id, isActive: !item.isActive })}
                              className={`text-[10px] px-1.5 py-0.5 rounded ${
                                item.isActive ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'
                              }`}
                            >
                              <T k={item.isActive ? '비활성' : '활성'} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          );
        })
      )}

      {/* ══════════════════════════════════════════════ */}
      {/* Editor modal */}
      {/* ══════════════════════════════════════════════ */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b flex items-center justify-between">
              <h3 className="text-lg font-bold"><T k={editorData.id ? '검사항목 편집' : '검사항목 추가'} /></h3>
              <button onClick={() => setEditorOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><T k="검사 코드" /> <span className="text-red-500">*</span></label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                    value={editorData.code}
                    onChange={(e) => updateField('code', e.target.value.toUpperCase())}
                    placeholder="CBC_18"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><T k="카테고리" /> <span className="text-red-500">*</span></label>
                  <select className="w-full border rounded-lg px-3 py-2 text-sm" value={editorData.category} onChange={(e) => updateField('category', e.target.value)}>
                    {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{tAttr(c.label)}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><T k="검사명" /> <span className="text-red-500">*</span></label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={editorData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="일반혈액검사 (18항목)"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><T k="세부 분류" /></label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={editorData.subCategory ?? ''}
                    onChange={(e) => updateField('subCategory', e.target.value)}
                    placeholder="혈액, 초음파, CT..."
                    list="sub-categories"
                  />
                  <datalist id="sub-categories">
                    {subCategories.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><T k="판독 담당과" /></label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={editorData.interpretDept ?? ''}
                    onChange={(e) => updateField('interpretDept', e.target.value)}
                    placeholder="영상의학과"
                    list="interpret-depts"
                  />
                  <datalist id="interpret-depts">
                    {['영상의학과','소화기내과','산부인과','호흡기내과','신경과','순환기내과','핵의학과','안과','정형외과','병리과']
                      .map((d) => <option key={d} value={d} />)}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><T k="결과 단위" /></label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={editorData.unit ?? ''}
                    onChange={(e) => updateField('unit', e.target.value)}
                    placeholder="mg/dL, mmHg..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><T k="참고치" /></label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={editorData.referenceRange ?? ''}
                    onChange={(e) => updateField('referenceRange', e.target.value)}
                    placeholder="70~110"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><T k="기본 단가 (원)" /></label>
                  <input
                    type="number"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={editorData.defaultPrice}
                    onChange={(e) => updateField('defaultPrice', parseInt(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><T k="소요 시간 (분)" /></label>
                  <input
                    type="number"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={editorData.duration}
                    onChange={(e) => updateField('duration', parseInt(e.target.value) || 5)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><T k="정렬 순서" /></label>
                  <input
                    type="number"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={editorData.sortOrder}
                    onChange={(e) => updateField('sortOrder', parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><T k="설명" /></label>
                <textarea
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  rows={2}
                  value={editorData.description ?? ''}
                  onChange={(e) => updateField('description', e.target.value)}
                  placeholder={tAttr('검사 상세 설명...')}
                />
              </div>

              {editorData.id && usageCounts[editorData.code] && (
                <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-600">
                  이 검사항목은 현재 <strong>{usageCounts[editorData.code]}<Unit>개</Unit></strong> 프로그램에서 사용 중입니다
                </div>
              )}
            </div>

            <div className="p-5 border-t flex justify-end gap-3">
              <button
                onClick={() => setEditorOpen(false)}
                className="px-5 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm hover:bg-gray-200"
              >
                <T k="취소" />
              </button>
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm hover:bg-blue-700 font-medium disabled:opacity-50"
              >
                <T k={saveMutation.isPending ? '저장 중...' : editorData.id ? '수정@버튼' : '추가'} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
