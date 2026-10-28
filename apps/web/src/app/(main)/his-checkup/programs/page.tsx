'use client';

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';

// ── Constants ──

const CATEGORIES = [
  { key: 'BASIC', label: '기본@검진등급', color: 'bg-gray-100 text-gray-700', dot: 'bg-gray-400' },
  { key: 'PLUS', label: '플러스', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  { key: 'PRECISION', label: '정밀', color: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },
  { key: 'PREMIUM', label: '프리미엄', color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  { key: 'PET_PRECISION', label: 'PET 정밀', color: 'bg-pink-100 text-pink-700', dot: 'bg-pink-500' },
  { key: 'SPECIAL', label: '특화', color: 'bg-teal-100 text-teal-700', dot: 'bg-teal-500' },
] as const;

const GENDERS = [
  // 🔴 '공통' 은 무문맥이면 뜻이 안 서는 말이라 문맥 키를 쓴다(표시는 '공통' 그대로)
  { key: 'ALL', label: '공통@성별' },
  { key: 'MALE', label: '남성' },
  { key: 'FEMALE', label: '여성' },
] as const;

const ITEM_CATEGORIES = [
  { key: 'PHYSICAL', label: '신체계측' },
  { key: 'LAB', label: '검체검사' },
  { key: 'IMAGING', label: '영상검사' },
  { key: 'DIAGNOSTIC', label: '기능검사' },
  { key: 'CONSULT', label: '상담' },
  { key: 'AI', label: `${AI_ORIGIN_TEXT} 분석` },
] as const;

const INTERPRET_DEPTS = [
  '', '영상의학과', '소화기내과', '산부인과', '호흡기내과', '신경과', '심장내과', '병리과',
];

const catMeta = (key: string) => CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[0];
const formatPrice = (n: number) => new Intl.NumberFormat('ko-KR').format(n);

// ── Types ──

interface ProgramItem {
  seq: number;
  category: string;
  name: string;
  codes: string[];
  interpretDept?: string;
}

interface ProgramOption {
  id: string;
  name: string;
  price: number;
  category: string;
  codes: string[];
}

interface CheckupProgram {
  id: string;
  code: string;
  name: string;
  category: string;
  description?: string;
  gender: string;
  ageMin?: number | null;
  ageMax?: number | null;
  price: number;
  discountRate: number;
  duration: number;
  dailyCapacity?: number | null;
  items: ProgramItem[];
  options: ProgramOption[];
  isActive: boolean;
  _count?: { visits: number };
}

type EditorProgram = Omit<CheckupProgram, 'id' | '_count' | 'isActive'> & { id?: string; isActive?: boolean };

const EMPTY_PROGRAM: EditorProgram = {
  code: '',
  name: '',
  category: 'BASIC',
  description: '',
  gender: 'ALL',
  ageMin: null,
  ageMax: null,
  price: 0,
  discountRate: 0,
  duration: 120,
  dailyCapacity: null,
  items: [],
  options: [],
};

// ── Page ──

export default function CheckupProgramsPage() {
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorData, setEditorData] = useState<EditorProgram>(EMPTY_PROGRAM);
  const [editorTab, setEditorTab] = useState<'basic' | 'items' | 'options' | 'settings' | 'cms'>('basic');
  const [catalogPickerOpen, setCatalogPickerOpen] = useState(false);
  const [catalogPickerMode, setCatalogPickerMode] = useState<'item' | 'option'>('item');
  const [catalogSearch, setCatalogSearch] = useState('');

  const { data: res, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['checkup-programs', categoryFilter],
    queryFn: () =>
      apiClient.get<any>('/api/v1/checkup/programs', categoryFilter ? { category: categoryFilter } : undefined),
  });
  const allPrograms: CheckupProgram[] = res?.data ?? [];
  const programs = searchTerm
    ? allPrograms.filter((p) =>
        p.name.includes(searchTerm) || p.code.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    : allPrograms;

  // 마스터 카탈로그
  const { data: catalogRes } = useQuery({
    queryKey: ['checkup-test-catalog-all'],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/test-catalog', { isActive: 'true' }),
  });
  const catalog: { id: string; code: string; name: string; category: string; subCategory?: string; interpretDept?: string; defaultPrice: number; duration: number }[] = catalogRes?.data ?? [];

  // CMS 콘텐츠 (CHECKUP_INFO)
  const { data: cmsRes, refetch: refetchCms } = useQuery({
    queryKey: ['cms-checkup-info'],
    queryFn: () => apiClient.get<any>('/api/v1/hospital-info', { category: 'CHECKUP_INFO' }),
  });
  const cmsItems: { id: string; slug: string; title: string; content: string; metadata: any; sortOrder: number; tags: string[]; isActive: boolean; status: string }[] = cmsRes?.data ?? [];

  // 현재 프로그램과 연결된 CMS 찾기
  const findLinkedCms = (programCode: string, programName: string) => {
    return cmsItems.filter((c) => {
      const meta = c.metadata ?? {};
      return meta.programCode === programCode || c.slug?.includes(programCode.toLowerCase().replace('ck-', 'checkup-'));
    });
  };

  const [cmsEditing, setCmsEditing] = useState<any>(null);
  const [cmsFormOpen, setCmsFormOpen] = useState(false);
  const [cmsForm, setCmsForm] = useState({ slug: '', title: '', content: '', metadata: {} as any, sortOrder: 0, tags: [] as string[] });

  const cmsSaveMutation = useMutation({
    mutationFn: (data: { id?: string; body: any }) =>
      data.id
        ? apiClient.put(`/api/v1/hospital-info/${data.id}`, data.body)
        : apiClient.post('/api/v1/hospital-info', data.body),
    onSuccess: () => {
      refetchCms();
      setCmsEditing(null);
      setCmsFormOpen(false);
      toast.success('CMS 콘텐츠 저장 완료');
    },
    onError: (err: any) => toast.error(err?.message || 'CMS 저장 실패'),
  });

  const cmsDeleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/hospital-info/${id}`),
    onSuccess: () => {
      refetchCms();
      toast.success('CMS 콘텐츠 삭제 완료');
    },
  });

  const openCmsEditor = (cms?: any) => {
    setCmsFormOpen(true);
    if (cms) {
      setCmsEditing(cms);
      setCmsForm({
        slug: cms.slug, title: cms.title, content: cms.content,
        metadata: cms.metadata ?? {}, sortOrder: cms.sortOrder ?? 0,
        tags: cms.tags ?? [],
      });
    } else {
      // 새 CMS 생성 — 프로그램 정보로 프리필
      const slug = `checkup-${editorData.code.toLowerCase().replace('ck-', '')}`;
      setCmsEditing(null);
      setCmsForm({
        slug,
        title: editorData.name,
        content: `${editorData.description ?? editorData.name}\n\n검사 항목:\n${editorData.items.map((i) => `- ${i.name}`).join('\n')}\n\n소요시간: 약 ${editorData.duration}분`,
        metadata: {
          subType: 'PROGRAM',
          programCode: editorData.code,
          programName: editorData.name,
          price: editorData.price,
          duration: `${editorData.duration}분`,
          items: editorData.items.map((i) => i.name),
        },
        sortOrder: 0,
        tags: ['건강검진', editorData.name],
      });
    }
  };

  const handleCmsSave = () => {
    if (!cmsForm.slug || !cmsForm.title) {
      toast.error('슬러그와 제목은 필수입니다');
      return;
    }
    const body = {
      category: 'CHECKUP_INFO',
      slug: cmsForm.slug,
      title: cmsForm.title,
      content: cmsForm.content,
      metadata: cmsForm.metadata,
      sortOrder: cmsForm.sortOrder,
      tags: cmsForm.tags,
    };
    cmsSaveMutation.mutate({ id: cmsEditing?.id, body });
  };

  const filteredCatalog = useMemo(() => {
    if (!catalogSearch) return catalog;
    const q = catalogSearch.toLowerCase();
    return catalog.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [catalog, catalogSearch]);

  const addFromCatalog = (entry: typeof catalog[0]) => {
    if (catalogPickerMode === 'item') {
      const items = [...editorData.items];
      // 이미 있는 코드면 스킵
      if (items.some((i) => i.codes.includes(entry.code))) {
        toast.error(`"${entry.code}" 은(는) 이미 추가됨`);
        return;
      }
      items.push({
        seq: items.length + 1,
        category: entry.category,
        name: entry.name,
        codes: [entry.code],
        interpretDept: entry.interpretDept,
      });
      updateField('items', items);
    } else {
      const options = [...editorData.options];
      if (options.some((o) => o.codes.includes(entry.code))) {
        toast.error(`"${entry.code}" 은(는) 이미 추가됨`);
        return;
      }
      options.push({
        id: `opt-${entry.code.toLowerCase()}`,
        name: entry.name,
        price: entry.defaultPrice,
        category: entry.category,
        codes: [entry.code],
      });
      updateField('options', options);
    }
    toast.success(`"${entry.name}" 추가됨`);
  };

  const saveMutation = useMutation({
    mutationFn: (data: EditorProgram) =>
      data.id
        ? apiClient.put(`/api/v1/checkup/programs/${data.id}`, data)
        : apiClient.post('/api/v1/checkup/programs', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkup-programs'] });
      setEditorOpen(false);
      toast.success(editorData.id ? '프로그램 수정 완료' : '프로그램 생성 완료');
    },
    onError: (err: any) => toast.error(err?.message || '저장 실패'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.put(`/api/v1/checkup/programs/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkup-programs'] });
      toast.success('상태 변경 완료');
    },
  });

  const openEditor = (prog?: CheckupProgram) => {
    if (prog) {
      setEditorData({
        id: prog.id,
        code: prog.code,
        name: prog.name,
        category: prog.category,
        description: prog.description ?? '',
        gender: prog.gender,
        ageMin: prog.ageMin ?? null,
        ageMax: prog.ageMax ?? null,
        price: prog.price,
        discountRate: prog.discountRate,
        duration: prog.duration,
        dailyCapacity: prog.dailyCapacity ?? null,
        items: (prog.items ?? []) as ProgramItem[],
        options: (prog.options ?? []) as ProgramOption[],
      });
    } else {
      setEditorData({ ...EMPTY_PROGRAM, items: [], options: [] });
    }
    setEditorTab('basic');
    setEditorOpen(true);
  };

  const updateField = useCallback(<K extends keyof EditorProgram>(key: K, val: EditorProgram[K]) => {
    setEditorData((prev) => ({ ...prev, [key]: val }));
  }, []);

  const handleSave = () => {
    if (!editorData.code || !editorData.name) {
      toast.error('코드와 프로그램명은 필수입니다');
      return;
    }
    saveMutation.mutate(editorData);
  };

  // ── Items 관리 ──
  const addItem = () => {
    const items = [...editorData.items];
    items.push({
      seq: items.length + 1,
      category: 'LAB',
      name: '',
      codes: [],
    });
    updateField('items', items);
  };

  const updateItem = (idx: number, patch: Partial<ProgramItem>) => {
    const items = [...editorData.items];
    items[idx] = { ...items[idx], ...patch };
    updateField('items', items);
  };

  const removeItem = (idx: number) => {
    const items = editorData.items.filter((_, i) => i !== idx).map((item, i) => ({ ...item, seq: i + 1 }));
    updateField('items', items);
  };

  const moveItem = (idx: number, dir: -1 | 1) => {
    const items = [...editorData.items];
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    [items[idx], items[target]] = [items[target], items[idx]];
    items.forEach((item, i) => (item.seq = i + 1));
    updateField('items', items);
  };

  // ── Options 관리 ──
  const addOption = () => {
    const options = [...editorData.options];
    options.push({
      id: `opt-${Date.now()}`,
      name: '',
      price: 0,
      category: 'LAB',
      codes: [],
    });
    updateField('options', options);
  };

  const updateOption = (idx: number, patch: Partial<ProgramOption>) => {
    const options = [...editorData.options];
    options[idx] = { ...options[idx], ...patch };
    updateField('options', options);
  };

  const removeOption = (idx: number) => {
    updateField('options', editorData.options.filter((_, i) => i !== idx));
  };

  // ── Render ──
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold"><T k="검진 프로그램 관리" /></h1>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder={tAttr('프로그램 검색...')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm w-48"
          />
          <button
            onClick={() => openEditor()}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-medium"
          >
            + <T k="프로그램 생성" />
          </button>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setCategoryFilter('')}
          className={`px-3 py-1.5 rounded-lg text-sm transition ${
            !categoryFilter ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <T k="전체" /> ({allPrograms.length})
        </button>
        {CATEGORIES.map((cat) => {
          const cnt = allPrograms.filter((p) => p.category === cat.key).length;
          return (
            <button
              key={cat.key}
              onClick={() => setCategoryFilter(categoryFilter === cat.key ? '' : cat.key)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                categoryFilter === cat.key ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <T k={cat.label} /> ({cnt})
            </button>
          );
        })}
      </div>

      {/* Programs grid */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400"><T k="로딩 중..." /></div>
      ) : isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : programs.length === 0 ? (
        <EmptyState icon="📋" title="프로그램이 없습니다" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {programs.map((prog) => {
            const cat = catMeta(prog.category);
            return (
              <div
                key={prog.id}
                onClick={() => openEditor(prog)}
                className={`bg-white rounded-xl border p-5 space-y-3 cursor-pointer hover:shadow-md hover:border-blue-200 transition ${
                  !prog.isActive ? 'opacity-50' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${cat.color}`}>
                        <T k={cat.label} />
                      </span>
                      <span className="text-xs text-gray-400">{prog.code}</span>
                      {!prog.isActive && (
                        <span className="px-1.5 py-0.5 bg-red-100 text-red-600 rounded text-[10px] whitespace-nowrap"><T k="비활성" /></span>
                      )}
                    </div>
                    <h3 className="mt-1 text-lg font-semibold truncate">{prog.name}</h3>
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    {prog.gender === 'FEMALE' && <span className="text-pink-500 text-sm whitespace-nowrap"><T k="여성" /></span>}
                    {prog.gender === 'MALE' && <span className="text-blue-500 text-sm whitespace-nowrap"><T k="남성" /></span>}
                    {prog.ageMin != null && <span className="text-xs text-gray-400 whitespace-nowrap">{prog.ageMin}세+</span>}
                  </div>
                </div>

                <p className="text-sm text-gray-500 line-clamp-2">{prog.description}</p>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-lg font-bold text-blue-600">{formatPrice(prog.price)}<Unit>원</Unit></span>
                  <div className="flex items-center gap-3 text-gray-400">
                    {prog.discountRate > 0 && <span className="text-red-500">-{prog.discountRate}<Unit>%</Unit></span>}
                    <span>{prog.duration}<Unit>분</Unit></span>
                    <span>{prog.items?.length ?? 0}항목</span>
                  </div>
                </div>

                {/* Items preview */}
                <div className="flex flex-wrap gap-1">
                  {(prog.items ?? []).slice(0, 6).map((item: any, idx: number) => (
                    <span key={idx} className="px-1.5 py-0.5 bg-gray-50 text-gray-500 rounded text-xs whitespace-nowrap">
                      {item.name}
                    </span>
                  ))}
                  {(prog.items ?? []).length > 6 && (
                    <span className="text-xs text-gray-400 whitespace-nowrap">+{prog.items.length - 6}</span>
                  )}
                </div>

                {/* Options preview */}
                {prog.options && prog.options.length > 0 && (
                  <div className="text-xs text-gray-400">
                    <T k="선택옵션" />: {(prog.options as ProgramOption[]).map((o) => o.name).join(', ')}
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>{prog._count?.visits ?? 0}<Unit>건</Unit> <T k="예약" /></span>
                    {prog.dailyCapacity && <span><T k="일일" /> {prog.dailyCapacity}<Unit>명</Unit></span>}
                  </div>
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleActive.mutate({ id: prog.id, isActive: !prog.isActive })}
                      className={`px-2.5 py-1 rounded text-xs ${
                        prog.isActive
                          ? 'bg-red-50 text-red-600 hover:bg-red-100'
                          : 'bg-green-50 text-green-600 hover:bg-green-100'
                      }`}
                    >
                      <T k={prog.isActive ? '비활성화' : '활성화'} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════ */}
      {/* Editor slide panel */}
      {/* ══════════════════════════════════════════════ */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="flex-1 bg-black/30" onClick={() => setEditorOpen(false)} />

          {/* Panel */}
          <div className="w-full max-w-2xl bg-white shadow-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-5 border-b bg-gray-50 flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-lg font-bold"><T k={editorData.id ? '프로그램 편집' : '프로그램 생성'} /></h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {editorData.code || <T k="코드 미지정" />} · {editorData.items.length}항목 · {editorData.options.length}옵션
                </p>
              </div>
              <button onClick={() => setEditorOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b shrink-0">
              {([
                { key: 'basic', label: '기본 정보' },
                { key: 'items', label: `검사 항목 (${editorData.items.length})` },
                { key: 'options', label: `선택 옵션 (${editorData.options.length})` },
                { key: 'settings', label: '운영 설정' },
                { key: 'cms', label: 'CMS/홈페이지' },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setEditorTab(tab.key)}
                  className={`px-4 py-2.5 text-sm font-medium transition ${
                    editorTab === tab.key
                      ? 'border-b-2 border-blue-600 text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <T k={tab.label} />
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* ── 기본 정보 ── */}
              {editorTab === 'basic' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <FieldGroup label={tAttr('프로그램 코드')} required>
                      <input
                        className="input-field"
                        value={editorData.code}
                        onChange={(e) => updateField('code', e.target.value.toUpperCase())}
                        placeholder="CK-BASIC"
                      />
                    </FieldGroup>
                    <FieldGroup label={tAttr('카테고리')} required>
                      <select className="input-field" value={editorData.category} onChange={(e) => updateField('category', e.target.value)}>
                        {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{tAttr(c.label)}</option>)}
                      </select>
                    </FieldGroup>
                  </div>

                  <FieldGroup label={tAttr('프로그램명')} required>
                    <input
                      className="input-field"
                      value={editorData.name}
                      onChange={(e) => updateField('name', e.target.value)}
                      placeholder={tAttr('기본 종합검진')}
                    />
                  </FieldGroup>

                  <FieldGroup label={tAttr('설명')}>
                    <textarea
                      className="input-field"
                      rows={3}
                      value={editorData.description ?? ''}
                      onChange={(e) => updateField('description', e.target.value)}
                      placeholder={tAttr('프로그램 상세 설명...')}
                    />
                  </FieldGroup>

                  <div className="grid grid-cols-3 gap-4">
                    <FieldGroup label={tAttr('대상 성별')}>
                      <select className="input-field" value={editorData.gender} onChange={(e) => updateField('gender', e.target.value)}>
                        {GENDERS.map((g) => <option key={g.key} value={g.key}>{tAttr(g.label)}</option>)}
                      </select>
                    </FieldGroup>
                    <FieldGroup label={tAttr('최소 연령')}>
                      <input
                        type="number"
                        className="input-field"
                        value={editorData.ageMin ?? ''}
                        onChange={(e) => updateField('ageMin', e.target.value ? parseInt(e.target.value) : null)}
                        placeholder={tAttr('제한 없음')}
                      />
                    </FieldGroup>
                    <FieldGroup label={tAttr('최대 연령')}>
                      <input
                        type="number"
                        className="input-field"
                        value={editorData.ageMax ?? ''}
                        onChange={(e) => updateField('ageMax', e.target.value ? parseInt(e.target.value) : null)}
                        placeholder={tAttr('제한 없음')}
                      />
                    </FieldGroup>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <FieldGroup label={tAttr('정가 (원)')} required>
                      <input
                        type="number"
                        className="input-field"
                        value={editorData.price}
                        onChange={(e) => updateField('price', parseInt(e.target.value) || 0)}
                      />
                    </FieldGroup>
                    <FieldGroup label={tAttr('할인율 (%)')}>
                      <input
                        type="number"
                        className="input-field"
                        min={0}
                        max={100}
                        value={editorData.discountRate}
                        onChange={(e) => updateField('discountRate', parseInt(e.target.value) || 0)}
                      />
                    </FieldGroup>
                    <FieldGroup label={tAttr('실 금액')}>
                      <div className="input-field bg-gray-50 text-blue-600 font-bold">
                        {formatPrice(Math.round(editorData.price * (1 - editorData.discountRate / 100)))}원
                      </div>
                    </FieldGroup>
                  </div>
                </>
              )}

              {/* ── 검사 항목 ── */}
              {editorTab === 'items' && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-500"><T k="검진 시 수행하는 검사 항목을 순서대로 관리합니다" /></p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setCatalogPickerMode('item'); setCatalogSearch(''); setCatalogPickerOpen(true); }}
                        className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700"
                      >
                        <T k="마스터에서 추가" />
                      </button>
                      <button onClick={addItem} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700">
                        + <T k="직접 추가" />
                      </button>
                    </div>
                  </div>

                  {editorData.items.length === 0 && (
                    <div className="text-center py-8 text-gray-300 text-sm"><T k="항목을 추가하세요" /></div>
                  )}

                  <div className="space-y-2">
                    {editorData.items.map((item, idx) => (
                      <div key={idx} className="border rounded-lg p-3 space-y-2 bg-white hover:border-blue-200 transition">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 w-6 text-center font-mono">{item.seq}</span>
                          <select
                            className="border rounded px-2 py-1 text-xs w-24"
                            value={item.category}
                            onChange={(e) => updateItem(idx, { category: e.target.value })}
                          >
                            {ITEM_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{tAttr(c.label)}</option>)}
                          </select>
                          <input
                            className="border rounded px-2 py-1 text-sm flex-1"
                            value={item.name}
                            onChange={(e) => updateItem(idx, { name: e.target.value })}
                            placeholder={tAttr('검사명')}
                          />
                          <div className="flex gap-1">
                            <button onClick={() => moveItem(idx, -1)} disabled={idx === 0} className="px-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">↑</button>
                            <button onClick={() => moveItem(idx, 1)} disabled={idx === editorData.items.length - 1} className="px-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">↓</button>
                            <button onClick={() => removeItem(idx)} className="px-1 text-red-400 hover:text-red-600">✕</button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pl-8">
                          <input
                            className="border rounded px-2 py-1 text-xs flex-1"
                            value={item.codes?.join(', ') ?? ''}
                            onChange={(e) => updateItem(idx, { codes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                            placeholder={tAttr('코드 (콤마 구분: CBC, LFT, FBS)')}
                          />
                          <select
                            className="border rounded px-2 py-1 text-xs w-28"
                            value={item.interpretDept ?? ''}
                            onChange={(e) => updateItem(idx, { interpretDept: e.target.value || undefined })}
                          >
                            <option value="">{tAttr('판독과 없음')}</option>
                            {INTERPRET_DEPTS.filter(Boolean).map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ── 선택 옵션 ── */}
              {editorTab === 'options' && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-500"><T k="접수 시 수검자가 추가 선택할 수 있는 항목입니다" /></p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setCatalogPickerMode('option'); setCatalogSearch(''); setCatalogPickerOpen(true); }}
                        className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700"
                      >
                        <T k="마스터에서 추가" />
                      </button>
                      <button onClick={addOption} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700">
                        + <T k="직접 추가" />
                      </button>
                    </div>
                  </div>

                  {editorData.options.length === 0 && (
                    <EmptyState icon="📋" title="선택 옵션이 없습니다" />
                  )}

                  <div className="space-y-2">
                    {editorData.options.map((opt, idx) => (
                      <div key={idx} className="border rounded-lg p-3 space-y-2 bg-white hover:border-blue-200 transition">
                        <div className="flex items-center gap-2">
                          <select
                            className="border rounded px-2 py-1 text-xs w-24"
                            value={opt.category}
                            onChange={(e) => updateOption(idx, { category: e.target.value })}
                          >
                            {ITEM_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{tAttr(c.label)}</option>)}
                          </select>
                          <input
                            className="border rounded px-2 py-1 text-sm flex-1"
                            value={opt.name}
                            onChange={(e) => updateOption(idx, { name: e.target.value })}
                            placeholder={tAttr('옵션명 (예: 대장내시경)')}
                          />
                          <input
                            type="number"
                            className="border rounded px-2 py-1 text-sm w-28 text-right"
                            value={opt.price}
                            onChange={(e) => updateOption(idx, { price: parseInt(e.target.value) || 0 })}
                            placeholder={tAttr('추가 금액')}
                          />
                          <span className="text-xs text-gray-400">원</span>
                          <button onClick={() => removeOption(idx)} className="px-1 text-red-400 hover:text-red-600">✕</button>
                        </div>
                        <div className="flex items-center gap-2 pl-0">
                          <span className="text-xs text-gray-400 w-16"><T k="코드" />:</span>
                          <input
                            className="border rounded px-2 py-1 text-xs flex-1"
                            value={opt.codes?.join(', ') ?? ''}
                            onChange={(e) => updateOption(idx, { codes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                            placeholder={tAttr('검사 코드 (콤마 구분)')}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {editorData.options.length > 0 && (
                    <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
                      <T k="총 옵션 가격 범위" />: 0원 ~ +{formatPrice(editorData.options.reduce((s, o) => s + o.price, 0))}원
                    </div>
                  )}
                </>
              )}

              {/* ── 운영 설정 ── */}
              {editorTab === 'settings' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <FieldGroup label={tAttr('예상 소요 시간 (분)')}>
                      <input
                        type="number"
                        className="input-field"
                        min={10}
                        value={editorData.duration}
                        onChange={(e) => updateField('duration', parseInt(e.target.value) || 120)}
                      />
                    </FieldGroup>
                    <FieldGroup label={tAttr('일일 최대 수검자 수')}>
                      <input
                        type="number"
                        className="input-field"
                        value={editorData.dailyCapacity ?? ''}
                        onChange={(e) => updateField('dailyCapacity', e.target.value ? parseInt(e.target.value) : null)}
                        placeholder={tAttr('무제한')}
                      />
                    </FieldGroup>
                  </div>

                  {/* Preview */}
                  <div className="border rounded-xl p-4 space-y-3 bg-gray-50">
                    <h4 className="font-semibold text-sm text-gray-700"><T k="프로그램 요약" /></h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <SummaryRow label={tAttr('프로그램')} value={`${editorData.name} (${editorData.code})`} />
                      <SummaryRow label={tAttr('카테고리')} value={catMeta(editorData.category).label} />
                      <SummaryRow label={tAttr('대상')} value={tAttr(GENDERS.find((g) => g.key === editorData.gender)?.label ?? '공통@성별')} />
                      <SummaryRow
                        label={tAttr('연령')}
                        value={
                          editorData.ageMin || editorData.ageMax
                            ? `${editorData.ageMin ?? '제한없음'} ~ ${editorData.ageMax ?? '제한없음'}세`
                            : '전연령'
                        }
                      />
                      <SummaryRow label={tAttr('정가')} value={`${formatPrice(editorData.price)}원`} />
                      <SummaryRow
                        label={tAttr('실 금액')}
                        value={`${formatPrice(Math.round(editorData.price * (1 - editorData.discountRate / 100)))}원${
                          editorData.discountRate > 0 ? ` (-${editorData.discountRate}%)` : ''
                        }`}
                      />
                      <SummaryRow label={tAttr('검사 항목')} value={`${editorData.items.length}개`} />
                      <SummaryRow label={tAttr('선택 옵션')} value={`${editorData.options.length}개`} />
                      <SummaryRow label={tAttr('소요 시간')} value={`${editorData.duration}분`} />
                      <SummaryRow label={tAttr('일일 정원')} value={editorData.dailyCapacity ? `${editorData.dailyCapacity}명` : '무제한'} />
                    </div>

                    {editorData.items.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-gray-500 mb-1"><T k="검사 항목 목록" /></div>
                        <div className="flex flex-wrap gap-1">
                          {editorData.items.map((item, idx) => (
                            <span key={idx} className="px-1.5 py-0.5 bg-white border rounded text-xs text-gray-600 whitespace-nowrap">
                              {item.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* ── CMS/홈페이지 ── */}
              {editorTab === 'cms' && (
                <>
                  {!editorData.id ? (
                    <div className="text-center py-8 text-gray-400 text-sm"><T k="프로그램을 먼저 저장한 후 CMS 콘텐츠를 관리할 수 있습니다" /></div>
                  ) : cmsFormOpen ? (
                    /* CMS 편집 폼 */
                    (() => {
                      const isNew = !cmsEditing?.id;
                      return (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <h4 className="font-semibold text-sm"><T k={isNew ? 'CMS 콘텐츠 생성' : 'CMS 콘텐츠 편집'} /></h4>
                            <button onClick={() => { setCmsEditing(null); setCmsFormOpen(false); setCmsForm({ slug: '', title: '', content: '', metadata: {}, sortOrder: 0, tags: [] }); }} className="text-xs text-gray-400 hover:text-gray-600">← <T k="목록" /></button>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="슬러그 (URL)" /></label>
                              <input className="w-full border rounded-lg px-3 py-2 text-sm font-mono" value={cmsForm.slug} onChange={(e) => setCmsForm({ ...cmsForm, slug: e.target.value })} placeholder="checkup-basic" />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="정렬 순서" /></label>
                              <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" value={cmsForm.sortOrder} onChange={(e) => setCmsForm({ ...cmsForm, sortOrder: parseInt(e.target.value) || 0 })} />
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="제목" /></label>
                            <input className="w-full border rounded-lg px-3 py-2 text-sm" value={cmsForm.title} onChange={(e) => setCmsForm({ ...cmsForm, title: e.target.value })} />
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="내용@본문" /></label>
                            <textarea className="w-full border rounded-lg px-3 py-2 text-sm font-mono" rows={10} value={cmsForm.content} onChange={(e) => setCmsForm({ ...cmsForm, content: e.target.value })} />
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="태그 (콤마 구분)" /></label>
                            <input className="w-full border rounded-lg px-3 py-2 text-sm" value={cmsForm.tags.join(', ')} onChange={(e) => setCmsForm({ ...cmsForm, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="메타데이터 (JSON)" /></label>
                            <textarea className="w-full border rounded-lg px-3 py-2 text-xs font-mono bg-gray-50" rows={5} value={JSON.stringify(cmsForm.metadata, null, 2)} onChange={(e) => { try { setCmsForm({ ...cmsForm, metadata: JSON.parse(e.target.value) }); } catch {} }} />
                          </div>

                          <div className="flex justify-between">
                            <button onClick={() => { setCmsEditing(null); setCmsFormOpen(false); setCmsForm({ slug: '', title: '', content: '', metadata: {}, sortOrder: 0, tags: [] }); }} className="px-4 py-2 bg-gray-100 rounded-lg text-sm"><T k="취소" /></button>
                            <button onClick={handleCmsSave} disabled={cmsSaveMutation.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                              <T k={cmsSaveMutation.isPending ? '저장 중...' : isNew ? 'CMS 생성' : 'CMS 수정'} />
                            </button>
                          </div>

                          {!isNew && (
                            <div className="text-xs text-gray-400 p-2 bg-gray-50 rounded">
                              <T k="홈페이지 URL" />: <code>/checkup/{cmsForm.slug}</code>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    /* CMS 목록 */
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-500"><T k="홈페이지에 표시되는 검진 프로그램 콘텐츠를 관리합니다" /></p>
                        <button onClick={() => openCmsEditor()} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700">+ <T k="CMS 생성" /></button>
                      </div>

                      {(() => {
                        const linked = findLinkedCms(editorData.code ?? '', editorData.name);
                        if (linked.length === 0) {
                          return (
                            <div className="text-center py-8 border rounded-xl border-dashed">
                              <p className="text-gray-400 text-sm"><T k="이 프로그램과 연결된 CMS 콘텐츠가 없습니다" /></p>
                              <button onClick={() => openCmsEditor()} className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><T k="프로그램 정보로 CMS 자동 생성" /></button>
                            </div>
                          );
                        }
                        return (
                          <div className="space-y-2">
                            {linked.map((cms) => (
                              <div key={cms.id} className="border rounded-lg p-4 hover:border-blue-200 transition space-y-2">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="font-medium text-sm">{cms.title}</div>
                                    <div className="text-xs text-gray-400">/{cms.slug} · <T k={cms.status === 'PUBLISHED' ? '게시됨' : cms.status} /></div>
                                  </div>
                                  <div className="flex gap-2">
                                    <button onClick={() => openCmsEditor(cms)} className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200"><T k="편집" /></button>
                                    <button onClick={() => { if (confirm('CMS 콘텐츠를 삭제하시겠습니까?')) cmsDeleteMutation.mutate(cms.id); }} className="px-2.5 py-1 bg-red-50 text-red-600 rounded text-xs hover:bg-red-100"><T k="삭제" /></button>
                                  </div>
                                </div>
                                <p className="text-xs text-gray-500 line-clamp-3">{cms.content}</p>
                                {cms.tags?.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {cms.tags.map((tag: string, i: number) => (
                                      <span key={i} className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] text-gray-500">{tag}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })()}

                      {/* 전체 CHECKUP_INFO 콘텐츠 */}
                      <div className="border-t pt-4 mt-4">
                        <h4 className="text-xs font-medium text-gray-500 mb-2"><T k="전체 검진 CMS 콘텐츠" /> ({cmsItems.length}<Unit>건</Unit>)</h4>
                        <div className="space-y-1">
                          {cmsItems.map((cms) => (
                            <div key={cms.id} className="flex items-center justify-between px-3 py-2 rounded hover:bg-gray-50 text-sm">
                              <div className="flex items-center gap-2">
                                {/* 🔴 색만으로 게시 여부를 말하지 않는다(§4.6) — 의미는 cms.isActive 에서 가져온다 */}
                                <span aria-label={tAttr(cms.isActive ? '게시 중' : '미게시')} title={tAttr(cms.isActive ? '게시 중' : '미게시')}
                                  className={`w-1.5 h-1.5 rounded-full ${cms.isActive ? 'bg-green-400' : 'bg-gray-300'}`} />
                                <span className="font-medium">{cms.title}</span>
                                <code className="text-[10px] text-gray-400">/{cms.slug}</code>
                              </div>
                              <button onClick={() => openCmsEditor(cms)} className="text-xs text-blue-500 hover:text-blue-700"><T k="편집" /></button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t bg-gray-50 flex items-center justify-between shrink-0">
              <div className="text-xs text-gray-400">
                {editorData.items.length}개 항목 · {editorData.options.length}개 옵션
              </div>
              <div className="flex gap-3">
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
                  <T k={saveMutation.isPending ? '저장 중...' : editorData.id ? '수정 저장' : '생성'} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════ */}
      {/* Catalog Picker */}
      {/* ══════════════════════════════════════════════ */}
      {catalogPickerOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl w-full max-w-xl shadow-xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b flex items-center justify-between shrink-0">
              <h3 className="font-bold">
                <T k={catalogPickerMode === 'item' ? '검사항목 마스터에서 추가' : '선택옵션용 검사항목 추가'} />
              </h3>
              <button onClick={() => setCatalogPickerOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="p-3 border-b shrink-0">
              <input
                type="text"
                placeholder={tAttr('검사명 또는 코드 검색...')}
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto divide-y">
              {filteredCatalog.length === 0 && (
                <EmptyState icon="🧪" title="검사항목이 없습니다" />
              )}
              {filteredCatalog.map((entry) => {
                const existingCodes = catalogPickerMode === 'item'
                  ? editorData.items.flatMap((i) => i.codes)
                  : editorData.options.flatMap((o) => o.codes);
                const alreadyAdded = existingCodes.includes(entry.code);
                const cat = ITEM_CATEGORIES.find((c) => c.key === entry.category);

                return (
                  <div
                    key={entry.id}
                    className={`flex items-center justify-between px-4 py-2.5 hover:bg-blue-50/50 transition ${alreadyAdded ? 'opacity-40' : 'cursor-pointer'}`}
                    onClick={() => !alreadyAdded && addFromCatalog(entry)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <code className="text-[11px] bg-gray-100 px-1.5 py-0.5 rounded font-mono shrink-0">{entry.code}</code>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{entry.name}</div>
                        <div className="text-[11px] text-gray-400">
                          <T k={cat?.label ?? ''} /> {entry.subCategory ? `· ${entry.subCategory}` : ''} {entry.interpretDept ? `· ${entry.interpretDept}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 ml-2">
                      {alreadyAdded ? (
                        <span className="text-xs text-gray-400"><T k="추가됨" /></span>
                      ) : (
                        <span className="text-xs text-blue-600 font-medium">
                          {entry.defaultPrice > 0 ? `${formatPrice(entry.defaultPrice)}원` : <>+ <T k="추가" /></>}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-3 border-t text-right shrink-0">
              <button
                onClick={() => setCatalogPickerOpen(false)}
                className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200"
              >
                <T k="닫기" />
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .input-field {
          width: 100%;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
          transition: border-color 0.15s;
        }
        .input-field:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
        }
      `}</style>
    </div>
  );
}

// ── Sub components ──

function FieldGroup({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800">{value}</span>
    </div>
  );
}
