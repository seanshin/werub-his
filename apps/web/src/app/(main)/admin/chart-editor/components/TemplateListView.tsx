'use client';

import { useState, useMemo } from 'react';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useDepartments } from '@/lib/use-departments';
import { ChartTemplate, Preset, ROLE_OPTIONS, CATEGORY_OPTIONS, roleLabel, categoryLabel, uid } from './shared';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

type TabType = 'all' | 'personal';

function formatDate(dateStr: string | undefined) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return kdate(d, 'date');
  } catch {
    return '';
  }
}

export function TemplateListView({
  onEdit,
  onNew,
}: {
  onEdit: (t: ChartTemplate) => void;
  onNew: (t: ChartTemplate) => void;
}) {
  const tAttr = useTAttr();
  const { names: deptOptions } = useDepartments({ category: 'CLINICAL' });
  const qc = useQueryClient();
  const [dept, setDept] = useState('');
  const [role, setRole] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [showPresets, setShowPresets] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('all');

  const { data: templates = [], isLoading } = useQuery<ChartTemplate[]>({
    queryKey: ['chart-templates', dept, role],
    queryFn: () =>
      apiClient.fetch('/api/v1/chart-templates', {
        params: { department: dept || undefined, role: role || undefined },
      }).then((r: unknown) => { const res = r as { data: ChartTemplate[] | { data: ChartTemplate[] } }; const raw = res.data; return Array.isArray(raw) ? raw : (raw as { data: ChartTemplate[] })?.data ?? []; }),
    enabled: activeTab === 'all',
  });

  const { data: personalTemplates = [], isLoading: personalLoading } = useQuery<ChartTemplate[]>({
    queryKey: ['chart-templates-personal'],
    queryFn: () =>
      apiClient.fetch('/api/v1/chart-templates/my-personal')
        .then((r: unknown) => { const res = r as { data: ChartTemplate[] | { data: ChartTemplate[] } }; const raw = res.data; return Array.isArray(raw) ? raw : (raw as { data: ChartTemplate[] })?.data ?? []; }),
    enabled: activeTab === 'personal',
  });

  const { data: mySettings } = useQuery({
    queryKey: ['chart-template-settings'],
    queryFn: () =>
      apiClient.fetch('/api/v1/chart-templates/my-settings')
        .then((r: unknown) => {
          const res = r as { data: { data?: Record<string, unknown> } & Record<string, unknown> };
          return res.data?.data ?? res.data ?? {};
        }),
  });

  const { data: presets = [] } = useQuery<Preset[]>({
    queryKey: ['chart-template-presets'],
    queryFn: () =>
      apiClient.fetch('/api/v1/chart-templates/presets').then((r: unknown) => { const res = r as { data: Preset[] | { data: Preset[] } }; const raw = res.data; return Array.isArray(raw) ? raw : (raw as { data: Preset[] })?.data ?? []; }),
    enabled: showPresets,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.fetch(`/api/v1/chart-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['chart-templates'] }); qc.invalidateQueries({ queryKey: ['chart-templates-personal'] }); },
    onError: (err: unknown) => toast.error((err as { message?: string })?.message || tAttr('삭제에 실패했습니다.')),
  });

  const cloneMut = useMutation({
    mutationFn: (id: string) => apiClient.fetch(`/api/v1/chart-templates/${id}/clone`, { method: 'POST' }).then((r: unknown) => (r as { data: ChartTemplate }).data),
    onSuccess: (t: ChartTemplate) => {
      // 🔴 E12 — 개인 템플릿의 복사본이 전체 공개로 떨어지던 것을 서버에서 봉합. 결과를 그대로 알린다.
      toast.success(t.isPersonal ? tAttr('내 개인 템플릿으로 복사했습니다.') : tAttr('공용 템플릿으로 복사했습니다.'));
      qc.invalidateQueries({ queryKey: ['chart-templates'] });
      qc.invalidateQueries({ queryKey: ['chart-templates-personal'] });
      onEdit(t);
    },
    onError: (err: unknown) => toast.error((err as { message?: string })?.message || tAttr('복사에 실패했습니다.')),
  });

  const personalizeMut = useMutation({
    mutationFn: (id: string) =>
      apiClient.fetch(`/api/v1/chart-templates/${id}/personalize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).then((r: unknown) => { const res = r as { data: { data?: ChartTemplate } & ChartTemplate }; return res.data?.data ?? res.data; }),
    onSuccess: (t: ChartTemplate) => { qc.invalidateQueries({ queryKey: ['chart-templates-personal'] }); setActiveTab('personal'); onEdit(t); },
  });

  const setDefaultMut = useMutation({
    mutationFn: (templateId: string) => apiClient.fetch('/api/v1/chart-templates/my-settings/default', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chart-template-settings'] }),
  });

  const toggleFavMut = useMutation({
    mutationFn: (templateId: string) => apiClient.fetch('/api/v1/chart-templates/my-settings/favorite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chart-template-settings'] }),
  });

  const fromPresetMut = useMutation({
    mutationFn: ({ presetKey, name }: { presetKey: string; name: string }) =>
      apiClient.fetch('/api/v1/chart-templates/from-preset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presetKey, name: name || undefined }) }).then((r: unknown) => (r as { data: ChartTemplate }).data),
    onSuccess: (t: ChartTemplate) => { qc.invalidateQueries({ queryKey: ['chart-templates'] }); onNew(t); },
  });

  const createBlank = () => {
    // 🔴 E10 — 종전 기본값이 한글('의사'·'일반')이라, 새로 만든 템플릿은 진료 화면 목록(영문 enum 조회)에
    //    영원히 뜨지 않았다. 관리자 목록에만 보여 "만들어졌다"고 착각하게 만든 잠재 결함.
    const blank: ChartTemplate = {
      id: '', name: '새 템플릿', department: '내과', role: 'DOCTOR', category: 'OUTPATIENT',
      layout: 'tabs', sections: [{ id: uid(), title: '섹션 1', fields: [], columns: 1 }], createdAt: '',
    };
    onNew(blank);
  };

  const settings = mySettings as { defaultTemplateId?: string; favoriteTemplateIds?: string[] } | undefined;
  const defaultTemplateId = settings?.defaultTemplateId ?? null;
  const favoriteIds: string[] = settings?.favoriteTemplateIds ?? [];
  const isFavorite = (id: string) => favoriteIds.includes(id);
  const isDefault = (id: string) => defaultTemplateId === id;

  const rawTemplates = activeTab === 'personal' ? personalTemplates : templates;
  const currentLoading = activeTab === 'personal' ? personalLoading : isLoading;

  // Client-side search and category filter
  const currentTemplates = useMemo(() => {
    let result = rawTemplates;
    if (category) {
      result = result.filter((t) => t.category === category);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((t) =>
        t.name.toLowerCase().includes(q) ||
        t.department.toLowerCase().includes(q) ||
        t.role.toLowerCase().includes(q) || roleLabel(t.role).includes(q) ||
        t.category.toLowerCase().includes(q) || categoryLabel(t.category).includes(q)
      );
    }
    return result;
  }, [rawTemplates, category, search]);

  const renderTemplateCard = (t: ChartTemplate) => {
    const fieldCount = t.sections.reduce((acc, s) => acc + s.fields.length, 0);
    const lastModified = t.updatedAt || t.createdAt;
    const usageCount = t.usageCount ?? 0;
    return (
      <div key={t.id} className="rounded-2xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {isDefault(t.id) && <span className="text-yellow-500 text-sm" title={tAttr('기본 템플릿')}>{'\u2605'}</span>}
              {isFavorite(t.id) && <span className="text-red-400 text-sm" title={tAttr('즐겨찾기')}>{'\u2764'}</span>}
              {t.isPersonal && <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full"><T k="개인" /></span>}
              <p className="font-semibold text-gray-900 text-sm truncate">{t.name}</p>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{t.department} · {roleLabel(t.role)} · {categoryLabel(t.category)}</p>
          </div>
          <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full shrink-0">{t.layout}</span>
        </div>

        <div className="flex items-center gap-3 text-xs text-gray-400 mb-3">
          <span><T k="섹션" /> {t.sections.length}<Unit>개</Unit></span>
          <span><T k="필드" /> {fieldCount}<Unit>개</Unit></span>
          {/* 🔴 E11 — 영향 범위를 보여주지 않은 채 confirm() 하나로 지웠다. 실사용 횟수를 함께 보인다. */}
          <span className={usageCount > 0 ? 'text-gray-600 font-medium' : ''}>
            <T k="사용" /> {usageCount}<Unit>회</Unit>
          </span>
          {lastModified && <span>{formatDate(lastModified)}</span>}
        </div>

        <div className="flex gap-1 mb-2">
          <button onClick={() => setDefaultMut.mutate(t.id)} className={`py-1 px-2 rounded-lg text-[10px] border transition-colors ${isDefault(t.id) ? 'bg-yellow-50 border-yellow-300 text-yellow-700' : 'border-gray-200 text-gray-400 hover:border-yellow-300 hover:text-yellow-600'}`}>
            {isDefault(t.id) ? <>{'\u2605'} <T k="기본" /></> : <>{'\u2606'} <T k="기본설정" /></>}
          </button>
          <button onClick={() => toggleFavMut.mutate(t.id)} className={`py-1 px-2 rounded-lg text-[10px] border transition-colors ${isFavorite(t.id) ? 'bg-red-50 border-red-200 text-red-500' : 'border-gray-200 text-gray-400 hover:border-red-200 hover:text-red-400'}`}>
            {isFavorite(t.id) ? <>{'\u2764'} <T k="즐겨찾기" /></> : <>{'\u2661'} <T k="즐겨찾기" /></>}
          </button>
          {!t.isPersonal && (
            <button onClick={() => personalizeMut.mutate(t.id)} className="py-1 px-2 rounded-lg text-[10px] border border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors"><T k="개인화" /></button>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={() => onEdit(t)} className="flex-1 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700"><T k="편집" /></button>
          <button onClick={() => cloneMut.mutate(t.id)}
            title={t.isPersonal ? tAttr('개인 템플릿의 복사본도 내 개인 템플릿입니다') : tAttr('공용 템플릿으로 복사됩니다')}
            className="py-1.5 px-3 rounded-lg border border-gray-300 text-xs hover:bg-gray-50"><T k="복사" /></button>
          <button
            onClick={() => {
              const msg = usageCount > 0
                ? `"${t.name}" 을(를) 삭제할까요?\n\n이 템플릿은 지금까지 ${usageCount}회 사용됐습니다. 삭제하면 진료 화면 목록에서 사라집니다(작성된 기록은 남습니다).`
                : `"${t.name}" 을(를) 삭제할까요? (사용 이력 없음)`;
              if (confirm(msg)) deleteMut.mutate(t.id);
            }}
            className="py-1.5 px-3 rounded-lg border border-red-200 text-red-500 text-xs hover:bg-red-50"><T k="삭제" /></button>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="차트 템플릿 편집기" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="진료 차트 레이아웃을 디자인하세요" /></p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowPresets(true)} className="px-4 py-2 rounded-xl border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"><T k="프리셋에서 생성" /></button>
          <button onClick={createBlank} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm hover:bg-blue-700"><T k="+ 새 템플릿" /></button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        <button onClick={() => setActiveTab('all')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'all' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><T k="전체 템플릿" /></button>
        <button onClick={() => setActiveTab('personal')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'personal' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><T k="내 템플릿" /></button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tAttr('이름, 부서, 역할로 검색...')}
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-gray-300 text-sm focus:outline-none focus:border-blue-400"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&#x1F50D;</span>
        </div>
        {activeTab === 'all' && (
          <>
            <select value={dept} onChange={(e) => setDept(e.target.value === '전체' ? '' : e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-300 text-sm">
              {['전체', ...deptOptions].map((d) => <option key={d} value={d === '전체' ? '' : d}>{d === '전체' ? tAttr('전체') : d}</option>)}
            </select>
            {/* 🔴 종전엔 한글 라벨을 그대로 서버 필터로 보내 역할 검색이 항상 0건이었다(role 은 영문 enum) */}
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-300 text-sm">
              {ROLE_OPTIONS.map((r) => <option key={r.value || '__all'} value={r.value}>{r.value ? tAttr(r.label) : tAttr('역할 전체')}</option>)}
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-300 text-sm">
              <option value="">{tAttr('카테고리 전체')}</option>
              {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{tAttr(c.label)}</option>)}
            </select>
          </>
        )}
        {(search || category) && (
          <button onClick={() => { setSearch(''); setCategory(''); }}
            className="text-xs text-gray-400 hover:text-gray-600"><T k="초기화" /></button>
        )}
      </div>

      {currentLoading ? (
        <p className="text-sm text-gray-400"><T k="불러오는 중..." /></p>
      ) : currentTemplates.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-4xl mb-3">{activeTab === 'personal' ? '\uD83D\uDC64' : '\uD83D\uDCCB'}</p>
          <p className="text-sm">
            {search || category
              ? <T k="검색 결과가 없습니다." />
              : activeTab === 'personal'
                ? <T k={'개인 템플릿이 없습니다. 전체 템플릿에서 "개인화" 버튼을 클릭하세요.'} />
                : <T k="템플릿이 없습니다. 새로 만들거나 프리셋을 사용하세요." />}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400">{currentTemplates.length}<Unit>개</Unit> <T k="템플릿" /></p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {currentTemplates.map((t) => renderTemplateCard(t))}
          </div>
        </>
      )}

      {showPresets && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg">
            <h2 className="font-bold text-gray-900 mb-4"><T k="프리셋 선택" /></h2>
            <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder={tAttr('템플릿 이름 (선택)')} className="w-full mb-4 px-3 py-2 rounded-xl border border-gray-300 text-sm" />
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {presets.map((p) => (
                <button key={p.key} onClick={() => fromPresetMut.mutate({ presetKey: p.key, name: presetName })} className="w-full text-left p-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50 text-sm">
                  <p className="font-medium text-gray-800">{p.name}</p>
                  <p className="text-xs text-gray-500">{p.department} · {p.role} · <T k="섹션" /> {p.sectionCount} · <T k="필드" /> {p.fieldCount}</p>
                </button>
              ))}
              {presets.length === 0 && <p className="text-sm text-gray-400 text-center py-4"><T k="프리셋을 불러오는 중..." /></p>}
            </div>
            <button onClick={() => setShowPresets(false)} className="mt-4 w-full py-2 rounded-xl border border-gray-300 text-sm hover:bg-gray-50"><T k="닫기" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
