'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

// ── Types ──

interface MyCode {
  id: string;
  codeId: string;
  displayName?: string;
  category: string;
  codeType: string;
  isPinned: boolean;
  useCount: number;
  defaultDosage?: string;
  defaultFrequency?: string;
  defaultDuration?: number;
  defaultRoute?: string;
  codeDetail?: { nameKo?: string; code?: string; nameEn?: string };
}

interface MyCodeStats {
  medications?: MyCode[];
  labs?: MyCode[];
}

interface PrescriptionSet {
  id: string;
  name: string;
  description?: string;
  category?: string;
  items: SetItem[];
  useCount: number;
  isActive: boolean;
}

interface SetItem {
  codeId: string;
  codeType: string;
  name: string;
  dosage?: string;
  frequency?: string;
  duration?: number;
  route?: string;
}

interface CatalogItem {
  id: string;
  codeId: string;
  codeType: string;
  subcategory?: string;
  defaultDosage?: string;
  defaultFrequency?: string;
  defaultDuration?: number;
  defaultRoute?: string;
  guideNote?: string;
  codeDetail?: { nameKo?: string; code?: string; nameEn?: string; unitPrice?: number };
}

interface SearchResult {
  id: string;
  code: string;
  nameKo: string;
  nameEn?: string;
  source: 'MY_LIST' | 'DEPT_CATALOG' | 'ALL';
  myDefaults?: { dosage?: string; frequency?: string; duration?: number; route?: string } | null;
  deptGuide?: { defaultDosage?: string; defaultFrequency?: string; guideNote?: string } | null;
}

// ── Helper: unwrap nested data ──
function unwrap<T>(raw: any): T {
  if (raw?.data?.data !== undefined) return raw.data.data;
  if (raw?.data !== undefined) return raw.data;
  return raw;
}

// ── Tabs ──
const TABS = [
  { key: 'codes', label: '내 코드 목록' },
  { key: 'sets', label: '처방 세트' },
  { key: 'catalog', label: '과 카탈로그' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const CATEGORIES = [
  { value: '', label: '전체' },
  { value: 'MEDICATION', label: '약물' },
  { value: 'LAB', label: '검사' },
  { value: 'IMAGING', label: '영상' },
];

// ── Page ──

export default function MyCodesPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('codes');
  const [category, setCategory] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ dosage: string; frequency: string; route: string; duration: string }>({ dosage: '', frequency: '', route: '', duration: '' });
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSetModal, setShowSetModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<'MEDICATION' | 'LAB' | 'IMAGING'>('MEDICATION');
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());

  // ── Queries ──

  const { data: codesRaw, isLoading: codesLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-codes', category],
    queryFn: () => apiClient.get('/api/v1/my-codes', { category: category || undefined }),
    enabled: tab === 'codes',
  });

  const { data: statsRaw } = useQuery({
    queryKey: ['my-codes-stats'],
    queryFn: () => apiClient.get('/api/v1/my-codes/stats'),
    enabled: tab === 'codes',
  });

  const { data: setsRaw, isLoading: setsLoading } = useQuery({
    queryKey: ['my-codes-sets'],
    queryFn: () => apiClient.get('/api/v1/my-codes/sets'),
    enabled: tab === 'sets',
  });

  const { data: catalogRaw, isLoading: catalogLoading } = useQuery({
    queryKey: ['dept-catalog'],
    queryFn: () => apiClient.get('/api/v1/dept-catalog', { department: '내과' }),
    enabled: tab === 'catalog',
  });

  const { data: searchRaw, isLoading: searchLoading } = useQuery({
    queryKey: ['code-search', searchQuery, searchType],
    queryFn: () => apiClient.get('/api/v1/code-search', { q: searchQuery, type: searchType }),
    enabled: showAddModal && searchQuery.length >= 1,
  });

  const codes: MyCode[] = (() => {
    const d = unwrap<any>(codesRaw);
    return Array.isArray(d) ? d : d?.data ?? [];
  })();
  const stats: MyCodeStats | null = unwrap<MyCodeStats>(statsRaw) ?? null;
  const sets: PrescriptionSet[] = unwrap<PrescriptionSet[]>(setsRaw) ?? [];
  const catalogItems: CatalogItem[] = (() => {
    const d = unwrap<any>(catalogRaw);
    return Array.isArray(d) ? d : d?.data ?? [];
  })();
  const searchResults: SearchResult[] = (() => {
    const d = unwrap<any>(searchRaw);
    return Array.isArray(d) ? d : d?.data ?? [];
  })();

  // ── Mutations ──

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/my-codes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-codes'] }); toast.success(tAttr('코드가 제거되었습니다')); },
  });

  const pinMut = useMutation({
    mutationFn: ({ id, isPinned }: { id: string; isPinned: boolean }) => apiClient.patch(`/api/v1/my-codes/${id}`, { isPinned }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-codes'] }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiClient.patch(`/api/v1/my-codes/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-codes'] });
      setEditingId(null);
      toast.success(tAttr('수정되었습니다'));
    },
  });

  const addCodeMut = useMutation({
    mutationFn: (body: any) => apiClient.post('/api/v1/my-codes', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-codes'] });
      toast.success(tAttr('코드가 추가되었습니다'));
    },
    onError: () => toast.error(tAttr('이미 등록된 코드이거나 추가에 실패했습니다')),
  });

  const createSetMut = useMutation({
    mutationFn: (body: any) => apiClient.post('/api/v1/my-codes/sets', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-codes-sets'] });
      setShowSetModal(false);
      toast.success(tAttr('처방 세트가 생성되었습니다'));
    },
  });

  const deleteSetMut = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/my-codes/sets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-codes-sets'] });
      toast.success(tAttr('처방 세트가 삭제되었습니다'));
    },
  });

  const useSetMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/my-codes/sets/${id}/use`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-codes-sets'] });
      toast.success(tAttr('세트가 적용되었습니다'));
    },
  });

  const importMut = useMutation({
    mutationFn: (body: { department: string; codeIds: string[] }) => apiClient.post('/api/v1/my-codes/import-catalog', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-codes'] });
      setSelectedCatalogIds(new Set());
      toast.success(tAttr('카탈로그에서 가져왔습니다'));
    },
  });

  // ── Handlers ──

  const startEdit = useCallback((c: MyCode) => {
    setEditingId(c.id);
    setEditForm({
      dosage: c.defaultDosage ?? '',
      frequency: c.defaultFrequency ?? '',
      route: c.defaultRoute ?? '',
      duration: c.defaultDuration?.toString() ?? '',
    });
  }, []);

  const saveEdit = useCallback((id: string) => {
    updateMut.mutate({
      id,
      data: {
        defaultDosage: editForm.dosage || undefined,
        defaultFrequency: editForm.frequency || undefined,
        defaultRoute: editForm.route || undefined,
        defaultDuration: editForm.duration ? parseInt(editForm.duration) : undefined,
      },
    });
  }, [editForm, updateMut]);

  const toggleCatalogId = useCallback((codeId: string) => {
    setSelectedCatalogIds(prev => {
      const next = new Set(prev);
      if (next.has(codeId)) next.delete(codeId);
      else next.add(codeId);
      return next;
    });
  }, []);

  // ── Skeleton ──
  const Skeleton = ({ rows = 5 }: { rows?: number }) => (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />
      ))}
    </div>
  );

  // ── Category badge ──
  const CategoryBadge = ({ cat }: { cat: string }) => {
    const cls = cat === 'MEDICATION' ? 'bg-blue-100 text-blue-700' : cat === 'LAB' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700';
    const label = cat === 'MEDICATION' ? '약물' : cat === 'LAB' ? '검사@직군' : '영상';
    return <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}><T k={label} /></span>;
  };

  // ── Source badge ──
  const SourceBadge = ({ source }: { source: string }) => {
    if (source === 'MY_LIST') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 whitespace-nowrap">MY</span>;
    if (source === 'DEPT_CATALOG') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 whitespace-nowrap">DEPT</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 whitespace-nowrap">ALL</span>;
  };

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="내 처방 목록" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="자주 사용하는 약물/검사 코드를 관리합니다. 처방 검색 시 우선 표시됩니다." /></p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <T k={t.label} />
          </button>
        ))}
      </div>

      {/* Tab 1: 내 코드 목록 */}
      {tab === 'codes' && isError && <QueryErrorFallback error={error} onRetry={refetch} />}
      {tab === 'codes' && !isError && (
        <>
          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-xs text-gray-500 mb-3 font-medium"><T k="최다 사용 약물 Top5" /></p>
                <div className="space-y-2">
                  {(stats.medications ?? []).slice(0, 5).map((m, i) => (
                    <div key={m.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-4">{i + 1}</span>
                        <span className="text-gray-700">{m.displayName ?? m.codeDetail?.nameKo ?? m.codeId}</span>
                      </div>
                      <span className="text-xs text-gray-400 tabular-nums">{m.useCount}<Unit>회</Unit></span>
                    </div>
                  ))}
                  {(stats.medications ?? []).length === 0 && <p className="text-xs text-gray-400"><T k="데이터 없음" /></p>}
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-xs text-gray-500 mb-3 font-medium"><T k="최다 사용 검사 Top5" /></p>
                <div className="space-y-2">
                  {(stats.labs ?? []).slice(0, 5).map((m, i) => (
                    <div key={m.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-4">{i + 1}</span>
                        <span className="text-gray-700">{m.displayName ?? m.codeDetail?.nameKo ?? m.codeId}</span>
                      </div>
                      <span className="text-xs text-gray-400 tabular-nums">{m.useCount}<Unit>회</Unit></span>
                    </div>
                  ))}
                  {(stats.labs ?? []).length === 0 && <p className="text-xs text-gray-400"><T k="데이터 없음" /></p>}
                </div>
              </div>
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white"
              >
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{tAttr(c.label === '검사' ? '검사@직군' : c.label)}</option>)}
              </select>
              <span className="text-sm text-gray-400">{codes.length}<Unit>개</Unit></span>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
            >
              <T k="+ 코드 추가" />
            </button>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-center px-3 py-3 font-medium text-gray-500 w-12"><T k="고정" /></th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="코드" /></th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="약물/검사명" /></th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="기본 용법" /></th>
                  <th className="text-center px-3 py-3 font-medium text-gray-500 w-16"><T k="사용" /></th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 w-28"><T k="작업" /></th>
                </tr>
              </thead>
              <tbody>
                {codesLoading ? (
                  <tr><td colSpan={6}><Skeleton rows={5} /></td></tr>
                ) : codes.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400"><T k="등록된 코드가 없습니다. [+ 코드 추가] 버튼으로 추가하세요." /></td></tr>
                ) : codes.map((c) => (
                  <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-3 py-3 text-center">
                      <button onClick={() => pinMut.mutate({ id: c.id, isPinned: !c.isPinned })} className="text-lg leading-none" title={tAttr(c.isPinned ? '고정 해제' : '고정')}>
                        {c.isPinned ? '\u2B50' : '\u2606'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400 font-mono">{c.codeDetail?.code ?? c.codeId.slice(0, 8)}</span>
                      <span className="ml-2"><CategoryBadge cat={c.category} /></span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{c.displayName ?? c.codeDetail?.nameKo ?? c.codeId}</span>
                    </td>
                    <td className="px-4 py-3">
                      {editingId === c.id ? (
                        <div className="flex items-center gap-1.5">
                          <input value={editForm.dosage} onChange={e => setEditForm(p => ({ ...p, dosage: e.target.value }))} placeholder={tAttr('용량')} className="w-16 px-1.5 py-1 text-xs border rounded" />
                          <input value={editForm.frequency} onChange={e => setEditForm(p => ({ ...p, frequency: e.target.value }))} placeholder={tAttr('용법')} className="w-16 px-1.5 py-1 text-xs border rounded" />
                          <input value={editForm.route} onChange={e => setEditForm(p => ({ ...p, route: e.target.value }))} placeholder={tAttr('경로')} className="w-14 px-1.5 py-1 text-xs border rounded" />
                          <input value={editForm.duration} onChange={e => setEditForm(p => ({ ...p, duration: e.target.value }))} placeholder={tAttr('일')} className="w-10 px-1.5 py-1 text-xs border rounded" />
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500">{[c.defaultDosage, c.defaultFrequency, c.defaultRoute].filter(Boolean).join(' / ') || '\u2014'}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-gray-400 tabular-nums">{c.useCount}<Unit>회</Unit></td>
                    <td className="px-4 py-3 text-right">
                      {editingId === c.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => saveEdit(c.id)} className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100"><T k="저장" /></button>
                          <button onClick={() => setEditingId(null)} className="px-2 py-1 text-xs bg-gray-50 text-gray-500 rounded hover:bg-gray-100"><T k="취소" /></button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => startEdit(c)} className="px-2 py-1 text-xs bg-gray-50 text-gray-600 rounded hover:bg-gray-100" title={tAttr('편집')}>&#x270F;&#xFE0E;</button>
                          <button onClick={() => deleteMut.mutate(c.id)} className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100"><T k="제거" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Tab 2: 처방 세트 */}
      {tab === 'sets' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-gray-400">{sets.length}<Unit>개</Unit> <T k="세트" /></span>
            <button
              onClick={() => setShowSetModal(true)}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
            >
              <T k="+ 새 세트 만들기" />
            </button>
          </div>

          {setsLoading ? <Skeleton rows={4} /> : sets.length === 0 ? (
            <EmptyState icon="💊" title="처방 세트가 없습니다." hint="자주 쓰는 처방 조합을 세트로 만들어 보세요." className="bg-white rounded-2xl border border-gray-100 shadow-sm" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {sets.map(s => (
                <div key={s.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-semibold text-gray-900">{s.name}</h3>
                      {s.description && <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>}
                    </div>
                    {s.category && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 whitespace-nowrap">{s.category}</span>}
                  </div>
                  <div className="text-xs text-gray-400 mb-3">
                    {(s.items ?? []).length}<Unit>개</Unit> <T k="항목" /> &middot; {s.useCount}<Unit>회</Unit> <T k="사용" />
                  </div>
                  {(s.items ?? []).length > 0 && (
                    <div className="mb-3 space-y-1">
                      {(s.items ?? []).slice(0, 4).map((item, i) => (
                        <div key={i} className="text-xs text-gray-600 flex items-center gap-1.5">
                          <span className="w-1 h-1 rounded-full bg-gray-300 shrink-0" />
                          <span>{item.name}</span>
                          {item.dosage && <span className="text-gray-400">{item.dosage}</span>}
                        </div>
                      ))}
                      {(s.items ?? []).length > 4 && <p className="text-[10px] text-gray-400 pl-2.5">+{(s.items ?? []).length - 4}<Unit>개</Unit> <T k="더" /></p>}
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-2 border-t border-gray-50">
                    <button onClick={() => useSetMut.mutate(s.id)} className="px-3 py-1.5 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 font-medium"><T k="적용" /></button>
                    <button onClick={() => deleteSetMut.mutate(s.id)} className="px-3 py-1.5 text-xs bg-red-50 text-red-600 rounded-lg hover:bg-red-100"><T k="삭제" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Tab 3: 과 카탈로그 */}
      {tab === 'catalog' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500"><T k="진료과 권장 코드를 내 목록으로 가져옵니다." /></p>
            <button
              onClick={() => {
                if (selectedCatalogIds.size === 0) { toast.error(tAttr('항목을 선택하세요')); return; }
                importMut.mutate({ department: '내과', codeIds: Array.from(selectedCatalogIds) });
              }}
              disabled={selectedCatalogIds.size === 0 || importMut.isPending}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <T k="선택 가져오기" /> ({selectedCatalogIds.size})
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={catalogItems.length > 0 && selectedCatalogIds.size === catalogItems.length}
                      onChange={() => {
                        if (selectedCatalogIds.size === catalogItems.length) setSelectedCatalogIds(new Set());
                        else setSelectedCatalogIds(new Set(catalogItems.map(c => c.codeId)));
                      }}
                      className="rounded"
                    />
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="코드" /></th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="이름@성명" /></th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="분류" /></th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="기본 설정" /></th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="안내" /></th>
                </tr>
              </thead>
              <tbody>
                {catalogLoading ? (
                  <tr><td colSpan={6}><Skeleton rows={6} /></td></tr>
                ) : catalogItems.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400"><T k="카탈로그 항목이 없습니다." /></td></tr>
                ) : catalogItems.map((c) => (
                  <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedCatalogIds.has(c.codeId)}
                        onChange={() => toggleCatalogId(c.codeId)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">{c.codeDetail?.code ?? c.codeId.slice(0, 8)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{c.codeDetail?.nameKo ?? c.codeId}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${c.codeType === 'MEDICATION_CODE' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                        <T k={c.codeType === 'MEDICATION_CODE' ? '약물' : '검사/시술'} />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{[c.defaultDosage, c.defaultFrequency, c.defaultRoute].filter(Boolean).join(' / ') || '\u2014'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 max-w-[200px] truncate">{c.guideNote || '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Code Search Modal ── */}
      {showAddModal && (
        <CodeSearchModal
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchType={searchType}
          setSearchType={setSearchType}
          searchResults={searchResults}
          searchLoading={searchLoading}
          onAdd={(result) => {
            addCodeMut.mutate({
              category: searchType,
              codeId: result.id,
              codeType: searchType === 'MEDICATION' ? 'MEDICATION_CODE' : 'PROCEDURE_CODE',
              displayName: result.nameKo,
              defaultDosage: result.myDefaults?.dosage ?? result.deptGuide?.defaultDosage,
              defaultFrequency: result.myDefaults?.frequency ?? result.deptGuide?.defaultFrequency,
            });
          }}
          onClose={() => { setShowAddModal(false); setSearchQuery(''); }}
          SourceBadge={SourceBadge}
        />
      )}

      {/* ── Set Create Modal ── */}
      {showSetModal && (
        <SetCreateModal
          onSave={(data) => createSetMut.mutate(data)}
          onClose={() => setShowSetModal(false)}
          isPending={createSetMut.isPending}
        />
      )}
    </div>
  );
}

// ── Code Search Modal Component ──

function CodeSearchModal({
  searchQuery, setSearchQuery, searchType, setSearchType, searchResults, searchLoading, onAdd, onClose, SourceBadge,
}: {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchType: 'MEDICATION' | 'LAB' | 'IMAGING';
  setSearchType: (t: 'MEDICATION' | 'LAB' | 'IMAGING') => void;
  searchResults: SearchResult[];
  searchLoading: boolean;
  onAdd: (result: SearchResult) => void;
  onClose: () => void;
  SourceBadge: React.FC<{ source: string }>;
}) {
  const tAttr = useTAttr();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<{ alias: string; dosage: string; frequency: string; route: string; duration: string; pinned: boolean }>({
    alias: '', dosage: '', frequency: '', route: '', duration: '', pinned: false,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-bold text-gray-900"><T k="코드 검색" /></h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
          </div>
          <div className="flex gap-2">
            <select
              value={searchType}
              onChange={e => setSearchType(e.target.value as any)}
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white"
            >
              <option value="MEDICATION">{tAttr('약물')}</option>
              <option value="LAB">{tAttr('검사@직군')}</option>
              <option value="IMAGING">{tAttr('영상')}</option>
            </select>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={tAttr('약물명, 코드, 성분명으로 검색...')}
              className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {searchLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              <T k={searchQuery.length >= 1 ? '검색 결과가 없습니다.' : '검색어를 입력하세요.'} />
            </div>
          ) : (
            <div className="space-y-1">
              {searchResults.map(r => (
                <div key={r.id}>
                  <button
                    onClick={() => {
                      if (expandedId === r.id) { setExpandedId(null); return; }
                      setExpandedId(r.id);
                      setDefaults({
                        alias: '',
                        dosage: r.myDefaults?.dosage ?? r.deptGuide?.defaultDosage ?? '',
                        frequency: r.myDefaults?.frequency ?? r.deptGuide?.defaultFrequency ?? '',
                        route: '', duration: '', pinned: false,
                      });
                    }}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-gray-50 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <SourceBadge source={r.source} />
                      <span className="font-medium text-gray-900 text-sm">{r.nameKo}</span>
                      <span className="text-xs text-gray-400 font-mono">{r.code}</span>
                    </div>
                    <span className="text-xs text-gray-400">{expandedId === r.id ? '\u25B2' : '\u25BC'}</span>
                  </button>

                  {expandedId === r.id && (
                    <div className="mx-4 mb-2 p-4 bg-gray-50 rounded-xl space-y-3">
                      {r.deptGuide?.guideNote && (
                        <p className="text-xs text-green-700 bg-green-50 px-3 py-1.5 rounded-lg">{r.deptGuide.guideNote}</p>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-gray-500 block mb-0.5"><T k="별명" /></label>
                          <input value={defaults.alias} onChange={e => setDefaults(p => ({ ...p, alias: e.target.value }))} className="w-full px-2 py-1.5 text-xs border rounded-lg" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 block mb-0.5"><T k="용량" /></label>
                          <input value={defaults.dosage} onChange={e => setDefaults(p => ({ ...p, dosage: e.target.value }))} className="w-full px-2 py-1.5 text-xs border rounded-lg" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 block mb-0.5"><T k="용법" /></label>
                          <input value={defaults.frequency} onChange={e => setDefaults(p => ({ ...p, frequency: e.target.value }))} className="w-full px-2 py-1.5 text-xs border rounded-lg" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 block mb-0.5"><T k="경로" /></label>
                          <input value={defaults.route} onChange={e => setDefaults(p => ({ ...p, route: e.target.value }))} className="w-full px-2 py-1.5 text-xs border rounded-lg" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 block mb-0.5"><T k="기간 (일)" /></label>
                          <input value={defaults.duration} onChange={e => setDefaults(p => ({ ...p, duration: e.target.value }))} type="number" className="w-full px-2 py-1.5 text-xs border rounded-lg" />
                        </div>
                        <div className="flex items-end pb-1">
                          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                            <input type="checkbox" checked={defaults.pinned} onChange={e => setDefaults(p => ({ ...p, pinned: e.target.checked }))} className="rounded" />
                            <T k="고정 (상단 표시)" />
                          </label>
                        </div>
                      </div>
                      <button
                        onClick={() => onAdd(r)}
                        className="w-full py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium"
                      >
                        <T k="내 목록에 추가" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Set Create Modal Component ──

function SetCreateModal({
  onSave, onClose, isPending,
}: {
  onSave: (data: { name: string; description?: string; category?: string; items: SetItem[] }) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const tAttr = useTAttr();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [items, setItems] = useState<SetItem[]>([]);
  const [itemName, setItemName] = useState('');
  const [itemDosage, setItemDosage] = useState('');
  const [itemFrequency, setItemFrequency] = useState('');
  const [itemRoute, setItemRoute] = useState('');
  const [itemDuration, setItemDuration] = useState('');

  const addItem = () => {
    if (!itemName.trim()) return;
    setItems(prev => [...prev, {
      codeId: '', codeType: 'MEDICATION_CODE', name: itemName.trim(),
      dosage: itemDosage || undefined, frequency: itemFrequency || undefined,
      route: itemRoute || undefined, duration: itemDuration ? parseInt(itemDuration) : undefined,
    }]);
    setItemName(''); setItemDosage(''); setItemFrequency(''); setItemRoute(''); setItemDuration('');
  };

  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

  const handleSave = () => {
    if (!name.trim()) { toast.error(tAttr('세트 이름을 입력하세요')); return; }
    onSave({ name: name.trim(), description: description || undefined, category: category || undefined, items });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900"><T k="새 처방 세트" /></h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1"><T k="세트 이름 *" /></label>
            {/* 🔴 '예: …' 예시는 사용자가 **한국어로 입력하는 자유 텍스트**의 보기다. 번역하면
                "영어로 적어도 된다"는 거짓 신호가 되므로 원문 유지(chart2 헤더의 같은 판단). */}
            <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" placeholder="예: 고혈압 기본 처방" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1"><T k="설명" /></label>
            <input value={description} onChange={e => setDescription(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" placeholder={tAttr('세트에 대한 간단한 설명')} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1"><T k="카테고리" /></label>
            <input value={category} onChange={e => setCategory(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" placeholder="예: 내과, 고혈압" />
          </div>

          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-500 mb-2 font-medium"><T k="처방 항목" /> ({items.length}<Unit>개</Unit>)</p>

            {items.length > 0 && (
              <div className="space-y-1 mb-3">
                {items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-700 font-medium">{item.name}</span>
                      {item.dosage && <span className="text-gray-400">{item.dosage}</span>}
                      {item.frequency && <span className="text-gray-400">{item.frequency}</span>}
                    </div>
                    <button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600">&times;</button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mb-2">
              <input value={itemName} onChange={e => setItemName(e.target.value)} placeholder={tAttr('약물/검사명 *')} className="col-span-2 px-2 py-1.5 text-xs border rounded-lg" />
              <input value={itemDosage} onChange={e => setItemDosage(e.target.value)} placeholder={tAttr('용량')} className="px-2 py-1.5 text-xs border rounded-lg" />
              <input value={itemFrequency} onChange={e => setItemFrequency(e.target.value)} placeholder={tAttr('용법')} className="px-2 py-1.5 text-xs border rounded-lg" />
              <input value={itemRoute} onChange={e => setItemRoute(e.target.value)} placeholder={tAttr('경로')} className="px-2 py-1.5 text-xs border rounded-lg" />
              <input value={itemDuration} onChange={e => setItemDuration(e.target.value)} placeholder={tAttr('기간 (일)')} type="number" className="px-2 py-1.5 text-xs border rounded-lg" />
            </div>
            <button onClick={addItem} className="w-full py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="+ 항목 추가" /></button>
          </div>
        </div>

        <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200"><T k="취소" /></button>
          <button onClick={handleSave} disabled={isPending} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium disabled:opacity-50">
            <T k={isPending ? '저장 중...' : '저장'} />
          </button>
        </div>
      </div>
    </div>
  );
}
