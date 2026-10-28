'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiClient } from '@/lib/api-client';
import { useAdminWrite, adminWriteNotice } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

// ── Types ──
interface ConsentComponent {
  id?: string;
  type: string;
  text?: string;
  label?: string;
  level?: string;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  options?: string[];
  minRequired?: number;
  role?: string;
}

interface ConsentTemplateVersion {
  id: string;
  version: string;
  isLatest: boolean;
  changeLog?: string;
  createdAt: string;
}

interface ConsentTemplate {
  id: string;
  type: string;
  name: string;
  language: string; // 언어별 동의서 — patient.supportedLanguages 기준
  version: string;
  description?: string;
  content: { sections?: ConsentComponent[] };
  components?: ConsentComponent[];
  requiredFields: string[];
  legalChecks?: Record<string, boolean>;
  isActive: boolean;
  isLatest: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  variables?: { docNumber?: string; aiDraft?: boolean | string; aiDraftFallbacks?: number };
}

// ── Constants ──
const CONSENT_TYPES = [
  { value: 'SURGERY', label: '수술', color: 'bg-red-100 text-red-700', icon: '🔪' },
  { value: 'ANESTHESIA', label: '마취', color: 'bg-purple-100 text-purple-700', icon: '💉' },
  { value: 'TRANSFUSION', label: '수혈', color: 'bg-rose-100 text-rose-700', icon: '🩸' },
  { value: 'PROCEDURE', label: '시술', color: 'bg-blue-100 text-blue-700', icon: '🩺' },
  { value: 'RESEARCH', label: '연구참여', color: 'bg-amber-100 text-amber-700', icon: '🔬' },
  { value: 'DNR', label: 'DNR', color: 'bg-gray-200 text-gray-700', icon: '📋' },
  { value: 'TREATMENT', label: '치료', color: 'bg-emerald-100 text-emerald-700', icon: '💊' },
  { value: 'GENERAL', label: '일반', color: 'bg-slate-100 text-slate-700', icon: '📝' },
];

const LEGAL_CHECK_LABELS: Record<string, string> = {
  hasPatientSignature: '환자 서명란',
  hasDoctorSignature: '의사 서명란',
  hasDateField: '날짜 필드',
  hasComplicationInfo: '합병증/위험 설명',
  hasAlternativeInfo: '대안적 치료 설명',
  hasVoluntaryConsent: '자발적 동의 확인',
};

// ── Component Palette ──
const COMPONENT_TYPES = [
  { type: 'heading', label: '섹션 제목', icon: 'H' },
  { type: 'paragraph', label: '설명문', icon: '¶' },
  { type: 'divider', label: '구분선', icon: '─' },
  { type: 'text_input', label: '텍스트 입력', icon: 'T' },
  { type: 'textarea', label: '여러 줄 입력', icon: '≡' },
  { type: 'date_input', label: '날짜', icon: '📅' },
  { type: 'checkbox', label: '체크박스', icon: '☑' },
  { type: 'checkbox_group', label: '체크 그룹', icon: '☐' },
  { type: 'signature', label: '서명란', icon: '✍' },
  { type: 'page_break', label: '페이지 구분', icon: '⏎' },
];

// ── Schema ──
const templateSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1, '템플릿명을 입력하세요'),
  language: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
});
type TemplateFormData = z.infer<typeof templateSchema>;

// ── Main ──
export default function ConsentTemplatesPage() {
  const tAttr = useTAttr();
  const canWrite = useAdminWrite();
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState('');
  const [langFilter, setLangFilter] = useState('');
  const [showLangManager, setShowLangManager] = useState(false);
  const [langRows, setLangRows] = useState<{ code: string; label: string }[]>([]);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'list' | 'create' | 'edit' | 'preview' | 'versions'>('list');
  const [selectedTemplate, setSelectedTemplate] = useState<ConsentTemplate | null>(null);
  const [components, setComponents] = useState<ConsentComponent[]>([]);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['consent-templates', typeFilter, search, langFilter],
    queryFn: () => apiClient.get<{ data: ConsentTemplate[] }>('/api/v1/consent-templates', {
      type: typeFilter || undefined, search: search || undefined, language: langFilter || undefined,
    }),
  });

  // 지원 언어 마스터(config patient.supportedLanguages) — 동의서 언어판·등록화면 선호언어의 단일 소스
  const { data: langCfg, isError: langIsError, error: langError, refetch: refetchLangs } = useQuery({
    queryKey: ['supported-languages'],
    queryFn: () => apiClient.get<{ data: { code: string; label: string }[] }>('/api/v1/config/patient.supportedLanguages'),
    staleTime: 300_000,
  });
  const supportedLangs: { code: string; label: string }[] = Array.isArray(langCfg?.data)
    ? (langCfg!.data as { code: string; label: string }[]).filter(l => l?.code)
    : [{ code: 'ko', label: '한국어' }, { code: 'en', label: 'English' }];
  const langLabel = (code: string) => supportedLangs.find(l => l.code === code)?.label ?? code;

  const saveLangsMutation = useMutation({
    mutationFn: (rows: { code: string; label: string }[]) =>
      apiClient.put('/api/v1/config/patient.supportedLanguages', { value: rows }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['supported-languages'] }); setShowLangManager(false); },
  });

  const { register, handleSubmit, formState: { errors }, reset, setValue } = useForm<TemplateFormData>({
    resolver: zodResolver(templateSchema),
    defaultValues: { type: 'SURGERY', name: '', language: 'ko', version: '1.0', description: '' },
  });

  const createMutation = useMutation({
    mutationFn: (d: TemplateFormData & { content: { sections: ConsentComponent[] }; components: ConsentComponent[]; requiredFields: string[] }) => apiClient.post('/api/v1/consent-templates', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['consent-templates'] }); setMode('list'); reset(); setComponents([]); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }: { id: string; content: { sections: ConsentComponent[] }; components: ConsentComponent[]; requiredFields: string[] }) => apiClient.put(`/api/v1/consent-templates/${id}`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['consent-templates'] }); setMode('list'); setSelectedTemplate(null); },
  });

  const cloneMutation = useMutation({
    mutationFn: ({ id, language, aiDraft }: { id: string; language?: string; aiDraft?: boolean }) =>
      apiClient.post(`/api/v1/consent-templates/${id}/clone`, language ? { language, aiDraft } : {}),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['consent-templates'] });
      setMenuOpen(null);
      if (v.aiDraft) alert('AI 번역 초안 생성을 시작했습니다.\n번역은 백그라운드로 진행되며(수십 초), 완료 후 목록에서 내용을 검토·수정한 뒤 활성화하세요.\n법적 문서이므로 검토 없이 활성화하지 마세요.');
    },
    onError: (e: unknown) => alert((e as { message?: string })?.message ?? '생성 실패'),
  });

  const bulkTranslateMutation = useMutation({
    mutationFn: (language: string) => apiClient.post('/api/v1/consent-templates/bulk-translate', { language }),
    onSuccess: (res: unknown) => {
      const d = ((res as { data?: { queued?: number; skippedExisting?: number } })?.data) ?? {};
      alert(`일괄 AI 초안 생성 시작 — 대상 ${d.queued ?? 0}건(기존 언어판 ${d.skippedExisting ?? 0}건 제외).\n백그라운드로 순차 번역됩니다. 잠시 후 목록을 새로고침해 검토·활성화하세요.`);
      qc.invalidateQueries({ queryKey: ['consent-templates'] });
    },
    onError: (e: unknown) => alert((e as { message?: string })?.message ?? '일괄 생성 실패'),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/consent-templates/${id}/toggle`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['consent-templates'] }); setMenuOpen(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/consent-templates/${id}/toggle`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['consent-templates'] }); setMenuOpen(null); },
  });

  const _raw = data?.data;
  const templates: ConsentTemplate[] = Array.isArray(_raw) ? _raw : (_raw as Record<string, unknown> | undefined)?.data as ConsentTemplate[] ?? [];

  const getTypeInfo = (type: string) => CONSENT_TYPES.find(c => c.value === type) ?? { value: type, label: type, color: 'bg-gray-100 text-gray-600', icon: '📄' };

  // ── 컴포넌트 빌더 헬퍼 ──
  const addComponent = (type: string) => {
    const defaults: Record<string, ConsentComponent> = {
      heading: { type: 'heading', text: '새 섹션', level: 'h2' },
      paragraph: { type: 'paragraph', text: '설명문을 입력하세요.' },
      divider: { type: 'divider' },
      text_input: { type: 'text_input', label: '입력 항목', placeholder: '', required: false },
      textarea: { type: 'textarea', label: '상세 설명', rows: 3, required: false },
      date_input: { type: 'date_input', label: '날짜', required: true },
      checkbox: { type: 'checkbox', label: '확인 항목', required: false },
      checkbox_group: { type: 'checkbox_group', label: '확인 그룹', options: ['항목 1', '항목 2'], minRequired: 0 },
      signature: { type: 'signature', label: '서명', role: 'patient' },
      page_break: { type: 'page_break' },
    };
    setComponents([...components, { ...defaults[type], id: `c_${Date.now()}` }]);
  };

  const removeComponent = (idx: number) => setComponents(components.filter((_, i) => i !== idx));
  const moveComponent = (idx: number, dir: -1 | 1) => {
    const next = [...components];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setComponents(next);
  };
  const updateComponent = (idx: number, field: string, value: string | boolean | string[]) => {
    const next = [...components];
    next[idx] = { ...next[idx], [field]: value };
    setComponents(next);
  };

  const handleCreate = (formData: TemplateFormData) => {
    const contentFromComponents = { sections: components };
    const requiredFields = components.filter((c) => c.required).map((c) => c.label ?? '');
    createMutation.mutate({ ...formData, content: contentFromComponents, components, requiredFields });
  };

  const handleUpdate = () => {
    if (!selectedTemplate) return;
    const contentFromComponents = { sections: components };
    const requiredFields = components.filter((c) => c.required).map((c) => c.label ?? '');
    updateMutation.mutate({ id: selectedTemplate.id, content: contentFromComponents, components, requiredFields });
  };

  const startEdit = (t: ConsentTemplate) => {
    setSelectedTemplate(t);
    setValue('type', t.type);
    setValue('name', t.name);
    setValue('language', t.language ?? 'ko');
    setValue('version', t.version);
    setValue('description', t.description ?? '');
    setComponents(t.components ?? t.content?.sections ?? []);
    setMode('edit');
  };

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  // ── Render: 버전 이력 ──
  if (mode === 'versions' && selectedTemplate) {
    return <VersionHistory template={selectedTemplate} onBack={() => { setMode('list'); setSelectedTemplate(null); }} />;
  }

  // ── Render: 미리보기 ──
  if (mode === 'preview' && selectedTemplate) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <button onClick={() => setMode('list')} className="text-sm text-gray-500 hover:text-indigo-600">&larr; <T k="돌아가기" /></button>
        <div className="bg-white rounded-2xl shadow-sm border p-8">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold">{selectedTemplate.name}</h1>
            <p className="text-xs text-gray-400">v{selectedTemplate.version} | {getTypeInfo(selectedTemplate.type).label}</p>
          </div>
          <PreviewRenderer components={selectedTemplate.components ?? selectedTemplate.content?.sections ?? []} docNumber={selectedTemplate.variables?.docNumber} version={selectedTemplate.version} />
          {selectedTemplate.legalChecks && (
            <div className="mt-6 pt-4 border-t">
              <p className="text-xs font-semibold text-gray-500 mb-2"><T k="법적 요구사항 검증" /></p>
              <div className="grid grid-cols-2 gap-1">
                {Object.entries(selectedTemplate.legalChecks).map(([k, v]) => (
                  <span key={k} className={`text-xs ${v ? 'text-emerald-600' : 'text-red-500'}`}>
                    {v ? '✓' : '✗'} <T k={LEGAL_CHECK_LABELS[k] ?? k} />
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Render: 생성/편집 ──
  if (mode === 'create' || mode === 'edit') {
    return (
      <div className="space-y-4">
        <button onClick={() => { setMode('list'); setSelectedTemplate(null); setComponents([]); reset(); }} className="text-sm text-gray-500 hover:text-indigo-600">&larr; <T k="돌아가기" /></button>
        <h1 className="text-xl font-bold text-gray-900">{mode === 'create' ? <T k="새 템플릿 생성" /> : <><T k="편집" />: {selectedTemplate?.name}</>}</h1>

        <form onSubmit={mode === 'create' ? handleSubmit(handleCreate) : undefined} className="grid grid-cols-[240px_1fr] gap-4 min-h-[600px]">
          {/* Left: Component Palette */}
          <div className="bg-white rounded-xl border p-4 space-y-3 h-fit sticky top-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide"><T k="컴포넌트" /></p>
            {COMPONENT_TYPES.map(ct => (
              <button key={ct.type} type="button" onClick={() => addComponent(ct.type)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-lg hover:bg-indigo-50 hover:text-indigo-700 transition-colors border border-transparent hover:border-indigo-200">
                <span className="w-6 h-6 flex items-center justify-center text-xs bg-gray-100 rounded font-mono">{ct.icon}</span>
                <T k={ct.label} />
              </button>
            ))}

            <div className="border-t pt-3 mt-3 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide"><T k="기본 정보" /></p>
              <div>
                <label className="text-[11px] text-gray-500"><T k="유형" /></label>
                <select {...register('type')} className="w-full px-2 py-1.5 border rounded-lg text-xs mt-0.5">
                  {CONSENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {tAttr(t.label)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-gray-500"><T k="언어" /></label>
                <select {...register('language')} className="w-full px-2 py-1.5 border rounded-lg text-xs mt-0.5">
                  {supportedLangs.map(l => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-gray-500"><T k="템플릿명" /></label>
                <input {...register('name')} className={`w-full px-2 py-1.5 border rounded-lg text-xs mt-0.5 ${errors.name ? 'border-red-300' : ''}`} />
              </div>
              <div>
                <label className="text-[11px] text-gray-500"><T k="설명" /></label>
                <input {...register('description')} className="w-full px-2 py-1.5 border rounded-lg text-xs mt-0.5" placeholder={tAttr('템플릿 용도 설명')} />
              </div>
            </div>
          </div>

          {/* Right: Canvas */}
          <div className="bg-white rounded-xl border p-6 space-y-3">
            {components.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <p className="text-4xl mb-2">📋</p>
                <p className="text-sm"><T k="왼쪽 팔레트에서 컴포넌트를 추가하세요" /></p>
              </div>
            ) : (
              components.map((comp, idx) => (
                <div key={comp.id ?? idx} className="group relative border border-gray-200 rounded-lg p-3 hover:border-indigo-300 transition-colors">
                  {/* Component Controls */}
                  <div className="absolute -top-2 right-2 hidden group-hover:flex gap-1 bg-white border rounded-lg px-1 py-0.5 shadow-sm z-10">
                    <button type="button" onClick={() => moveComponent(idx, -1)} className="text-[10px] px-1 text-gray-400 hover:text-gray-700" title={tAttr('위로')}>▲</button>
                    <button type="button" onClick={() => moveComponent(idx, 1)} className="text-[10px] px-1 text-gray-400 hover:text-gray-700" title={tAttr('아래로')}>▼</button>
                    <button type="button" onClick={() => removeComponent(idx)} className="text-[10px] px-1 text-red-400 hover:text-red-600" title={tAttr('삭제')}>✕</button>
                  </div>

                  <ComponentEditor comp={comp} onChange={(field, value) => updateComponent(idx, field, value)} />
                </div>
              ))
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-4 border-t mt-6">
              {mode === 'create' ? (
                <button type="submit" disabled={createMutation.isPending || components.length === 0}
                  className="min-h-[44px] px-3 py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  <T k={createMutation.isPending ? '생성중...' : '템플릿 생성'} />
                </button>
              ) : (
                <button type="button" onClick={handleUpdate} disabled={updateMutation.isPending}
                  className="min-h-[44px] px-3 py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  <T k={updateMutation.isPending ? '저장중...' : '변경사항 저장 (새 버전)'} />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    );
  }

  // ── Render: 목록 ──
  return (
    <div className="space-y-5">
      <Link href="/consent" className="text-sm text-gray-500 hover:text-indigo-600">&larr; <T k="동의서 목록" /></Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="동의서 템플릿 관리" /></h1>
          <p className="text-sm text-gray-500 mt-1">총 {templates.length}<Unit>개</Unit> 템플릿</p>
        </div>
        {/* 🔴 이 화면의 쓰기 EP 는 전부 `@Roles(ADMIN)` 이다(운영 실측: 의사 계정 목록 200 / 생성·버전·언어설정 403).
            임상 직군에게는 조회 화면이므로 nav 는 그대로 두되, 누를 수 없는 버튼을 띄우지 않는다. */}
        {!canWrite && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">{adminWriteNotice('템플릿 편집·언어 설정')}</p>}
        {canWrite && <div className="flex items-center gap-2">
          <button onClick={() => {
              const codes = supportedLangs.filter(l => l.code !== 'ko').map(l => l.code).join(', ');
              const lang = window.prompt(`일괄 AI 초안을 생성할 언어 코드를 입력하세요 (${codes})\n대상: 해당 언어판이 없는 활성 한국어 템플릿 전체`, 'en');
              if (lang?.trim()) bulkTranslateMutation.mutate(lang.trim());
            }}
            disabled={bulkTranslateMutation.isPending}
            className="min-h-[44px] px-3 py-2 bg-white border border-gray-200 text-gray-700 text-xs font-medium rounded-xl hover:bg-gray-50 disabled:opacity-50">
            <T k="🤖 일괄 초안 생성" />
          </button>
          <button onClick={() => { setLangRows(supportedLangs); setShowLangManager(true); }}
            className="px-4 py-2.5 bg-white border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50">
            <T k="🌐 지원 언어 관리" />
          </button>
          <button onClick={() => { setMode('create'); reset({ type: 'SURGERY', name: '', language: 'ko', version: '1.0', description: '' }); setComponents([]); }}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 shadow-sm transition-all hover:shadow-md">
            <T k="+ 새 템플릿" />
          </button>
        </div>}
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={tAttr('템플릿 검색...')}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setTypeFilter('')} className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${typeFilter === '' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><T k="전체" /></button>
          {CONSENT_TYPES.map(t => (
            <button key={t.value} onClick={() => setTypeFilter(t.value)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${typeFilter === t.value ? 'bg-indigo-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {t.icon} <T k={t.label} />
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setLangFilter('')} className={`px-2.5 py-1.5 text-xs rounded-lg font-medium ${langFilter === '' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}><T k="모든 언어" /></button>
          {supportedLangs.map(l => (
            <button key={l.code} onClick={() => setLangFilter(l.code)}
              className={`px-2.5 py-1.5 text-xs rounded-lg font-medium ${langFilter === l.code ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Template Cards */}
      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-300">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-gray-500"><T k="등록된 템플릿이 없습니다" /></p>
          {canWrite && <button onClick={() => setMode('create')} className="mt-3 text-sm text-indigo-600 hover:underline"><T k="첫 번째 템플릿 만들기" /></button>}
        </div>
      ) : (
        <div className="grid gap-3">
          {templates.map(t => {
            const typeInfo = getTypeInfo(t.type);
            const legalPassed = t.legalChecks ? Object.values(t.legalChecks).filter(Boolean).length : 0;
            const legalTotal = t.legalChecks ? Object.values(t.legalChecks).length : 0;

            return (
              <div key={t.id} className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-all group">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${typeInfo.color}`}>{typeInfo.icon} <T k={typeInfo.label} /></span>
                      {t.variables?.docNumber && <span className="text-[10px] text-gray-500 font-mono bg-gray-100 px-1.5 py-0.5 rounded">{t.variables.docNumber}</span>}
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700">{langLabel(t.language ?? 'ko')}</span>
                      {t.variables?.aiDraft === 'PENDING' && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 animate-pulse"><T k="🤖 번역 중..." /></span>}
                      {t.variables?.aiDraft === true && !t.isActive && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700"><T k="🤖 AI 초안 — 검토 필요" />{typeof t.variables?.aiDraftFallbacks === 'number' ? ` (원문 잔존 ${t.variables.aiDraftFallbacks})` : ''}</span>}
                      {t.variables?.aiDraft === true && t.isActive && <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500"><T k="🤖 AI 번역본" /></span>}
                      <span className="text-[11px] text-gray-400 font-mono">v{t.version}</span>
                      {t.isActive ? (
                        <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-0.5"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" /> <T k="활성" /></span>
                      ) : (
                        <span className="text-[11px] text-gray-400"><T k="비활성" /></span>
                      )}
                    </div>
                    <h3 className="text-base font-semibold text-gray-900">{t.name}</h3>
                    {t.description && <p className="text-sm text-gray-500 mt-0.5">{t.description}</p>}

                    <div className="flex items-center gap-4 mt-3 text-[11px] text-gray-400">
                      <span><T k="사용" /> {t.usageCount}<Unit>건</Unit></span>
                      <span><T k="수정" /> {t.updatedAt?.split('T')[0]}</span>
                      {legalTotal > 0 && (
                        <span className={legalPassed === legalTotal ? 'text-emerald-500' : 'text-amber-500'}>
                          <T k="법적요건" /> {legalPassed}/{legalTotal}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {canWrite && <button onClick={() => startEdit(t)} className="px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 font-medium"><T k="편집" /></button>}
                    <button onClick={() => { setSelectedTemplate(t); setMode('preview'); }} className="px-3 py-1.5 text-xs bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 font-medium"><T k="미리보기" /></button>
                    {canWrite && <div className="relative">
                      <button onClick={() => setMenuOpen(menuOpen === t.id ? null : t.id)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><circle cx="10" cy="4" r="2"/><circle cx="10" cy="10" r="2"/><circle cx="10" cy="16" r="2"/></svg>
                      </button>
                      {menuOpen === t.id && (
                        <div className="absolute right-0 top-8 w-40 bg-white border rounded-xl shadow-lg z-20 py-1">
                          <button onClick={() => cloneMutation.mutate({ id: t.id })} className="w-full text-left min-h-[44px] px-3 py-2 text-xs font-medium hover:bg-gray-50"><T k="복제" /></button>
                          <div className="px-4 py-1.5">
                            <p className="text-[10px] text-gray-400 mb-1"><T k="언어판 생성 — AI 번역 초안(비활성·검토 후 활성화)" /></p>
                            <div className="flex flex-wrap gap-1">
                              {supportedLangs.filter(l => l.code !== (t.language ?? 'ko')).map(l => (
                                <button key={l.code} onClick={() => cloneMutation.mutate({ id: t.id, language: l.code, aiDraft: true })}
                                  disabled={cloneMutation.isPending}
                                  className="min-h-[44px] px-3 py-2 text-xs font-medium bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100 disabled:opacity-50">🤖 {l.code}</button>
                              ))}
                            </div>
                          </div>
                          <button onClick={() => { setSelectedTemplate(t); setMode('versions'); setMenuOpen(null); }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50"><T k="버전 이력" /></button>
                          <button onClick={() => toggleMutation.mutate(t.id)} className="w-full text-left min-h-[44px] px-3 py-2 text-xs font-medium hover:bg-gray-50">
                            <T k={t.isActive ? '비활성화' : '활성화'} />
                          </button>
                          <hr className="my-1" />
                          <button onClick={() => { if (confirm(`"${t.name}" 템플릿을 비활성화할까요?`)) deleteMutation.mutate(t.id); }}
                            className="w-full text-left min-h-[44px] px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"><T k="비활성화" /></button>
                        </div>
                      )}
                    </div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 지원 언어 관리 — config patient.supportedLanguages (등록화면 선호언어·언어판 목록의 단일 소스) */}
      {showLangManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowLangManager(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl mx-4 p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="font-bold text-gray-900"><T k="지원 언어 관리" /></h3>
              <p className="text-xs text-gray-500 mt-0.5"><T k="외국인 등록 선호언어 목록과 동의서 언어판 선택지에 즉시 반영됩니다 (저장=ADMIN)" /></p>
            </div>
            {/* 🔴 마스터 조회 실패 상태로 저장하면 ko/en 폴백이 실제 설정을 덮어쓴다 — 편집을 막는다 */}
            {langIsError && <QueryErrorFallback error={langError} onRetry={() => refetchLangs()} size="compact" />}
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {!langIsError && langRows.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={l.code} onChange={e => setLangRows(rows => rows.map((r, j) => j === i ? { ...r, code: e.target.value.trim().toLowerCase() } : r))}
                    placeholder={tAttr('코드(예: uz)')} className="w-20 px-2 py-1.5 border rounded-lg text-xs font-mono" />
                  <input value={l.label} onChange={e => setLangRows(rows => rows.map((r, j) => j === i ? { ...r, label: e.target.value } : r))}
                    placeholder={tAttr('표기명(예: Oʻzbekcha)')} className="flex-1 px-2 py-1.5 border rounded-lg text-xs" />
                  <button onClick={() => setLangRows(rows => rows.filter((_, j) => j !== i))}
                    disabled={l.code === 'ko'} title={l.code === 'ko' ? tAttr('한국어는 삭제 불가') : tAttr('삭제')}
                    className="text-gray-300 hover:text-red-500 disabled:opacity-30 text-sm px-1">✕</button>
                </div>
              ))}
            </div>
            <button onClick={() => setLangRows(rows => [...rows, { code: '', label: '' }])} disabled={langIsError}
              className="w-full py-1.5 border border-dashed rounded-lg text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-40"><T k="+ 언어 추가" /></button>
            <div className="flex gap-2 pt-1">
              <button onClick={() => saveLangsMutation.mutate(langRows.filter(l => l.code && l.label))}
                disabled={saveLangsMutation.isPending || langIsError}
                className="flex-1 min-h-[44px] px-3 py-2 bg-indigo-600 text-white text-xs font-medium rounded-xl disabled:opacity-50">
                <T k={saveLangsMutation.isPending ? '저장 중...' : '저장'} />
              </button>
              <button onClick={() => setShowLangManager(false)} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 컴포넌트 편집기 ──
function ComponentEditor({ comp, onChange }: { comp: ConsentComponent; onChange: (field: string, value: string | boolean | string[]) => void }) {
  const tAttr = useTAttr();
  switch (comp.type) {
    case 'heading':
      return (
        <div className="flex items-center gap-2">
          <select value={comp.level} onChange={e => onChange('level', e.target.value)} className="px-2 py-1 border rounded text-xs w-16">
            <option value="h2">H2</option><option value="h3">H3</option>
          </select>
          <input value={comp.text} onChange={e => onChange('text', e.target.value)} className="flex-1 px-2 py-1 border rounded text-sm font-semibold" placeholder={tAttr('섹션 제목')} />
        </div>
      );
    case 'paragraph':
      return <textarea value={comp.text} onChange={e => onChange('text', e.target.value)} rows={2} className="w-full px-2 py-1 border rounded text-sm" placeholder={tAttr('설명문...')} />;
    case 'divider':
      return <hr className="border-gray-300 border-dashed" />;
    case 'text_input':
    case 'textarea':
    case 'date_input':
      return (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 w-12"><T k={comp.type === 'textarea' ? '텍스트' : comp.type === 'date_input' ? '날짜' : '입력'} /></span>
          <input value={comp.label} onChange={e => onChange('label', e.target.value)} className="flex-1 px-2 py-1 border rounded text-sm" placeholder={tAttr('라벨')} />
          {comp.type === 'text_input' && <input value={comp.placeholder ?? ''} onChange={e => onChange('placeholder', e.target.value)} className="flex-1 px-2 py-1 border rounded text-xs text-gray-400" placeholder="placeholder" />}
          <label className="flex items-center gap-1 text-xs text-gray-500">
            <input type="checkbox" checked={comp.required ?? false} onChange={e => onChange('required', e.target.checked)} className="rounded" /> <T k="필수" />
          </label>
        </div>
      );
    case 'checkbox':
      return (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 w-12"><T k="체크" /></span>
          <input value={comp.label} onChange={e => onChange('label', e.target.value)} className="flex-1 px-2 py-1 border rounded text-sm" placeholder={tAttr('확인 항목')} />
          <label className="flex items-center gap-1 text-xs text-gray-500">
            <input type="checkbox" checked={comp.required ?? false} onChange={e => onChange('required', e.target.checked)} className="rounded" /> <T k="필수" />
          </label>
        </div>
      );
    case 'checkbox_group':
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400 w-12"><T k="그룹" /></span>
            <input value={comp.label} onChange={e => onChange('label', e.target.value)} className="flex-1 px-2 py-1 border rounded text-sm" placeholder={tAttr('그룹명')} />
          </div>
          <input value={(comp.options ?? []).join(', ')} onChange={e => onChange('options', e.target.value.split(',').map((s: string) => s.trim()))}
            className="w-full px-2 py-1 border rounded text-xs text-gray-500" placeholder={tAttr('옵션 (쉼표 구분)')} />
        </div>
      );
    case 'signature':
      return (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 w-12"><T k="서명" /></span>
          <input value={comp.label} onChange={e => onChange('label', e.target.value)} className="flex-1 px-2 py-1 border rounded text-sm" placeholder={tAttr('서명란 라벨')} />
          <select value={comp.role} onChange={e => onChange('role', e.target.value)} className="px-2 py-1 border rounded text-xs">
            <option value="patient">{tAttr('환자')}</option><option value="guardian">{tAttr('보호자')}</option>
            <option value="doctor">{tAttr('의사')}</option><option value="witness">{tAttr('증인')}</option>
          </select>
        </div>
      );
    case 'page_break':
      return <div className="text-center text-[10px] text-gray-400 border-t-2 border-dashed border-gray-300 pt-1"><T k="--- 페이지 구분 ---" /></div>;
    default:
      return <p className="text-xs text-gray-400"><T k="알 수 없는 컴포넌트" />: {comp.type}</p>;
  }
}

// ── 미리보기 렌더러 ──
/**
 * 🔴 이 렌더러가 그리는 것은 **동의서 본문(법정 문서의 지면)** 이다 — 전환하지 않았다.
 *    (`____년 __월 __일`·`본 동의서는 원본 1부…`·병원명 머리글·서명란 역할 표기)
 *    화면 크롬인 빈 상태만 전환한다.
 */
function PreviewRenderer({ components, docNumber, version }: { components: ConsentComponent[]; docNumber?: string; version?: string }) {
  const tAttr = useTAttr();
  if (!Array.isArray(components) || components.length === 0) return <EmptyState icon="📋" title="컴포넌트가 없습니다" />;

  // 페이지 분리
  const pages: ConsentComponent[][] = [[]];
  components.forEach(c => {
    if (c.type === 'page_break') pages.push([]);
    else pages[pages.length - 1].push(c);
  });

  return (
    <div className="space-y-6">
      {pages.map((page, pi) => (
        <div key={pi} className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 relative" style={{ minHeight: 400 }}>
          {/* 문서 헤더 */}
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-200">
            <div className="text-[10px] text-gray-400">
              {docNumber && <span className="font-mono font-semibold text-gray-600 mr-2">{docNumber}</span>}
              {version && <span>v{version}</span>}
            </div>
            <div className="text-[10px] text-gray-400">
              위루비병원 | 페이지 {pi + 1}/{pages.length}
            </div>
          </div>

          {/* 컴포넌트 렌더링 */}
          <div className="space-y-3">
            {page.map((c: ConsentComponent, i: number) => {
              switch (c.type) {
                case 'heading': return <h2 key={i} className={c.level === 'h3' ? 'text-base font-semibold border-b pb-1 mt-4' : 'text-lg font-bold border-b-2 pb-2 mt-2'}>{c.text}</h2>;
                case 'paragraph': return <p key={i} className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.text}</p>;
                case 'divider': return <hr key={i} className="border-gray-300 my-2" />;
                case 'text_input': return (
                  <div key={i} className="flex items-center gap-3">
                    <label className="text-sm font-medium min-w-[120px]">{c.label}{c.required && <span className="text-red-500">*</span>}</label>
                    <div className="flex-1 border-b border-gray-300 pb-1 text-sm text-gray-400">{c.placeholder || '________________'}</div>
                  </div>
                );
                case 'textarea': return (
                  <div key={i}>
                    <label className="text-sm font-medium">{c.label}{c.required && <span className="text-red-500">*</span>}</label>
                    <div className="mt-1 border border-gray-300 rounded-lg h-20 flex items-center justify-center text-xs text-gray-400">텍스트 입력 영역</div>
                  </div>
                );
                case 'date_input': return (
                  <div key={i} className="flex items-center gap-3">
                    <label className="text-sm font-medium min-w-[120px]">{c.label}{c.required && <span className="text-red-500">*</span>}</label>
                    <div className="border-b border-gray-300 pb-1 text-sm text-gray-400 w-40">____년 __월 __일</div>
                  </div>
                );
                case 'checkbox': return (
                  <label key={i} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" disabled className="mt-0.5 rounded" />
                    <span>{c.label}{c.required && <span className="text-red-500">*</span>}</span>
                  </label>
                );
                case 'checkbox_group': return (
                  <div key={i} className="space-y-1">
                    <p className="text-sm font-medium">{c.label}</p>
                    {(c.options ?? []).map((opt: string, oi: number) => (
                      <label key={oi} className="flex items-center gap-2 text-sm ml-4"><input type="checkbox" disabled className="rounded" />{opt}</label>
                    ))}
                  </div>
                );
                case 'signature': return (
                  <div key={i} className="flex flex-col items-center mt-6">
                    <div className="w-48 border-b-2 border-gray-400 pb-8" />
                    <p className="text-xs text-gray-500 mt-1">{c.label} ({c.role === 'patient' ? '환자' : c.role === 'guardian' ? '보호자' : c.role === 'doctor' ? '설명 의사' : '증인'})</p>
                  </div>
                );
                default: return null;
              }
            })}
          </div>

          {/* 페이지 하단 */}
          <div className="absolute bottom-3 left-8 right-8 flex justify-between text-[9px] text-gray-300 border-t border-gray-100 pt-1">
            <span>본 동의서는 원본 1부, 사본 1부를 작성하여 환자에게 사본을 교부합니다.</span>
            <span>{docNumber || ''}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 버전 이력 ──
function VersionHistory({ template, onBack }: { template: ConsentTemplate; onBack: () => void }) {
  /**
   * 🔴 2026-09-16 J2(실로그인 프로브): 이 EP 는 `@Roles(ADMIN)` 인데 nav 는 이 화면을 임상 역할에 연다.
   *    종전엔 `isError` 를 받지 않아 403 이 **빈 버전 목록**으로 그려졌다 — "이력이 없다"는 다른 사실이다(§1).
   *    조회 실패는 실패라고 말한다. (관리 메뉴 전체가 서버는 ADMIN 전용인데 화면에 보이는 것은 별건으로 기록)
   */
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['consent-template-versions', template.id],
    queryFn: () => apiClient.get<{ data: ConsentTemplateVersion[] }>(`/api/v1/consent-templates/${template.id}/versions`),
  });

  const versions: ConsentTemplateVersion[] = Array.isArray(data?.data) ? data.data : (data?.data as Record<string, unknown> | undefined)?.data as ConsentTemplateVersion[] ?? [];

  return (
    <div className="max-w-3xl space-y-4">
      <button onClick={onBack} className="text-sm text-gray-500 hover:text-indigo-600">&larr; <T k="돌아가기" /></button>
      <h1 className="text-xl font-bold"><T k="버전 이력" />: {template.name}</h1>

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : isError ? (
        <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
      ) : (
        <div className="space-y-2">
          {versions.map((v: ConsentTemplateVersion, i: number) => (
            <div key={v.id} className={`p-4 rounded-xl border ${i === 0 ? 'border-indigo-200 bg-indigo-50/30' : 'border-gray-100 bg-white'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">v{v.version}</span>
                    {i === 0 && <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium"><T k="현재" /></span>}
                    {!v.isLatest && i > 0 && <span className="text-[10px] text-gray-400"><T k="이전 버전" /></span>}
                  </div>
                  {v.changeLog && <p className="text-xs text-gray-500 mt-0.5">{v.changeLog}</p>}
                </div>
                <span className="text-xs text-gray-400">{v.createdAt?.split('T')[0]}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
