'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import AutoMappingDashboard, { InlineAiSuggestion } from './auto-mapping-dashboard';
import CodeImportPanel from './code-import-panel';
import CodeDetailPanel from './code-detail-panel';
import CodeSynonymPanel from './code-synonym-panel';
import CodeMaintenancePanel from './code-maintenance-panel';
import CategoryDerivePanel from './category-derive-panel';
import { CodeSearchNotice, PinnedCodes, type CodeSearchMeta } from './code-search-notice';
import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useServerTextAttr } from '@/components/ui/server-text';
import type { ServerMessage } from '@hospital-run/shared';

interface DiagnosisCode {
  id: string;
  codeSystem: string;
  code: string;
  nameKo: string;
  nameEn?: string;
  category?: string;
  icd10Code?: string;
  icd11Code?: string;
}

interface ProcedureCode {
  id: string;
  code: string;
  nameKo: string;
  category?: string;
  unitPrice?: number;
  copayRate?: number;
  insuranceCovered?: boolean;
  modality?: string | null;      // 영상 modality — 조영제/임신 게이트 판정
  usesContrast?: boolean;        // 조영제 사용 검사
}

interface MedicationCode {
  id: string;
  code: string;
  nameKo: string;
  nameEn?: string;
  ingredient?: string;
  manufacturer?: string;
  dosageForm?: string;
  unitPrice?: number;
  insuranceCode?: string | null;     // 보험 제품코드(급여 신호)
  controlSchedule?: string | null;   // 마약류 등급 I~V
  narcoticType?: string | null;      // NARCOTIC|PSYCHOTROPIC|CANNABIS (NIMS)
  psychotropicGroup?: string | null; // 향정 가~라 (NIMS)
  maxSingleDose?: number | string | null;
  maxDailyDose?: number | string | null;
}

interface CodePagination {
  total: number;
  hasMore: boolean;
}

type CodeItem = DiagnosisCode | ProcedureCode | MedicationCode;

type TabKey = 'diagnosis' | 'procedure' | 'medication' | 'nursing' | 'mappings' | 'auto-mapping' | 'import' | 'synonyms' | 'maintenance';

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'diagnosis', label: '진단코드 (KCD/ICD)', icon: <DiagIcon /> },
  { key: 'procedure', label: '수가코드 (EDI)', icon: <ProcIcon /> },
  { key: 'medication', label: '약품코드', icon: <MedIcon /> },
  { key: 'nursing', label: '간호코드', icon: <DiagIcon /> },
  { key: 'mappings', label: '표준매핑', icon: <ProcIcon /> },
  { key: 'auto-mapping', label: '자동매핑', icon: <AutoMapIcon /> },
  { key: 'import', label: '고시 반영', icon: <FileIcon /> },
  { key: 'synonyms', label: '동의어·약어', icon: <TagIcon /> },
  { key: 'maintenance', label: '정비·내보내기', icon: <WrenchIcon /> },
];

export default function CodeMasterPage() {
  const qc = useQueryClient();
  // UI 크롬 언어(P2-7) — 골격(제목·탭·버튼·표머리)만. 🔴 코드 데이터 값(분류명·코드명)은 불변.
  const tAttr = useTAttr();
  const [tab, setTab] = useState<TabKey>('diagnosis');
  const [search, setSearch] = useState('');
  /** 🔴 짧은 영문 약어는 기본이 단어 단위 — 넓히는 것은 **사람이 눌러서만** 한다 */
  const [wide, setWide] = useState(false);
  /** 출처 필터 — HIRA(고시 반영) · LOCAL(원내 등록) · UNKNOWN(표기 없음) */
  const [originFilter, setOriginFilter] = useState('');
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<Record<string, string>>({});
  const [selectedCode, setSelectedCode] = useState<{ table: string; id: string; code: string; name: string } | null>(null);

  // KCD 챕터(대분류) — diagnosis_codes.category 백필값과 일치(dx-chapters-20260707.sql)
  const DIAG_CATEGORIES = ['전체', '감염성·기생충성 질환', '신생물(종양)', '내분비·영양·대사', '정신 및 행동장애', '신경계통', '순환계통', '호흡계통', '소화계통', '근골격계·결합조직', '비뇨생식계통', '임신·출산·산후기', '증상·징후·이상소견', '손상·중독·외인 결과', '건강상태·보건서비스'];
  const PROC_CATEGORIES = ['전체', '진찰료', '검사료', '영상진단료', '처치료', '수술료', '기초검사', '재활치료료', '방사선치료료', '투석치료료', '수혈검사', '수혈료'];
  // 실데이터(HIRA 급여표 약효분류) 상위 분류 — medication_codes.category 값과 일치해야 필터 동작
  const MED_CATEGORIES = ['전체', '혈압강하제', '당뇨병용제', '동맥경화용제', '해열·진통·소염제', '소화성궤양용제', '항생물질(페니실린계 등)', '정신신경용제', '항악성종양제', '안과용제', '기타 순환계용약', '기타 중추신경용약'];
  // 🔴 NOC 가 빠져 있었다 — 목록은 100건에서 잘려 NOC 12건이 어느 경로로도 보이지 않았다(2026-08-14 W8)
  const NURSING_CATEGORIES = ['전체', 'NANDA_I', 'NIC', 'NOC', 'MedDRA', 'ICF'];
  const MAPPING_CATEGORIES = ['전체', 'SNOMED_CT', 'LOINC', 'ICD10PCS', 'ICF', 'MedDRA'];

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post(`/api/v1/codes/${tab}`, body),
    onSuccess: () => { toast.success('코드 추가 완료'); qc.invalidateQueries({ queryKey: ['codes'] }); setShowAddModal(false); setAddForm({}); },
    onError: () => toast.error('코드 추가 실패'),
  });

  /**
   * 🔴 **이 화면에는 중지 버튼이 없다**(2026-08-26 실측 — 부르는 곳 0).
   *    그래서 여기 화면 경고를 붙여도 **도달하지 않는 코드**가 된다.
   *    실제 방어선은 서버다 — `DELETE /api/v1/codes/*` 가 사용처를 확인하고,
   *    사용 중이거나 세지 못했으면 거부한다(`CODE_IN_USE` / `CODE_USAGE_UNKNOWN`).
   *    나중에 중지 버튼을 만들 때 이 뮤테이션에 `force`·`reason` 을 실으면 된다.
   */
  const deleteMut = useMutation({
    mutationFn: ({ id, force, reason }: { id: string; force?: boolean; reason?: string }) =>
      apiClient.del(
        `/api/v1/codes/${tab}/${id}` +
        (force ? `?force=true&reason=${encodeURIComponent(reason ?? '')}` : ''),
      ),
    onSuccess: () => { toast.success('비활성화 완료'); qc.invalidateQueries({ queryKey: ['codes'] }); },
    onError: () => toast.error('비활성화 실패'),
  });

  // ── 속성 편집(안전 게이트 큐레이션) — 수가 modality/조영제·약품 급여/용량상한/마약류·NIMS 분류 ──
  const [editTarget, setEditTarget] = useState<{ kind: 'procedure' | 'medication'; item: ProcedureCode | MedicationCode } | null>(null);
  const [editForm, setEditForm] = useState<Record<string, unknown>>({});
  const updateMut = useMutation({
    mutationFn: ({ kind, id, body }: { kind: string; id: string; body: Record<string, unknown> }) =>
      apiClient.patch(`/api/v1/codes/${kind}/${id}`, body),
    onSuccess: () => { toast.success('속성 저장 완료'); qc.invalidateQueries({ queryKey: ['codes'] }); setEditTarget(null); },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '저장 실패'),
  });
  const openEdit = (kind: 'procedure' | 'medication', item: ProcedureCode | MedicationCode) => {
    setEditTarget({ kind, item });
    if (kind === 'procedure') {
      const p = item as ProcedureCode;
      setEditForm({ modality: p.modality ?? '', usesContrast: !!p.usesContrast, insuranceCovered: p.insuranceCovered !== false });
    } else {
      const m = item as MedicationCode;
      setEditForm({
        insuranceCode: m.insuranceCode ?? '', controlSchedule: m.controlSchedule ?? '',
        narcoticType: m.narcoticType ?? '', psychotropicGroup: m.psychotropicGroup ?? '',
        maxSingleDose: m.maxSingleDose ?? '', maxDailyDose: m.maxDailyDose ?? '',
      });
    }
  };
  const saveEdit = () => {
    if (!editTarget) return;
    const f = editForm;
    const body: Record<string, unknown> = editTarget.kind === 'procedure'
      ? {
          modality: String(f.modality ?? '').trim() || null,
          usesContrast: !!f.usesContrast,
          insuranceCovered: !!f.insuranceCovered,
        }
      : {
          insuranceCode: String(f.insuranceCode ?? '').trim() || null,
          controlSchedule: String(f.controlSchedule ?? '').trim() || null,
          narcoticType: String(f.narcoticType ?? '').trim() || null,
          psychotropicGroup: String(f.psychotropicGroup ?? '').trim() || null,
          maxSingleDose: f.maxSingleDose !== '' && f.maxSingleDose != null ? Number(f.maxSingleDose) : null,
          maxDailyDose: f.maxDailyDose !== '' && f.maxDailyDose != null ? Number(f.maxDailyDose) : null,
        };
    updateMut.mutate({ kind: editTarget.kind, id: editTarget.item.id, body });
  };

  /**
   * 🔴 분류 목록은 **실데이터에서** 온다. 종전엔 화면에 11개를 손으로 적어 뒀는데,
   *    운영에 실제로 있는 `이학요법료`·`치료재료대`·`전혈·혈액대`·`정신요법료`·`마취료` 는
   *    그 목록에 없어 **분류로 도달할 수 없었다.** 그리고 수가 166,744건 중 **분류가 있는 것은 55건**
   *    이라, 어느 분류를 골라도 거의 전부 0건이었다(사람 신고 "수가코드가 다 반영이 안 되었음").
   */
  const { data: catData } = useQuery({
    queryKey: ['code-categories', tab],
    queryFn: () => apiClient.get<{ data: { categories: { name: string; count: number }[]; uncategorized: number; total: number; note: string | null; noteMsg?: ServerMessage | null } }>(
      `/api/v1/codes/${tab}/categories`,
    ),
    enabled: tab === 'diagnosis' || tab === 'procedure' || tab === 'medication',
    staleTime: 5 * 60_000,
  });
  const liveCategories = catData?.data?.categories ?? [];
  const uncategorizedCount = catData?.data?.uncategorized ?? 0;
  // 서버 `noteMsg { k, params }` 가 정본 — 속성 자리라 문자열로 조립한다(구 응답이면 `note` 원문)
  const serverAttr = useServerTextAttr();
  const categoryNote = catData?.data?.note || catData?.data?.noteMsg ? serverAttr(catData?.data?.noteMsg, catData?.data?.note) : null;

  const queryKey = ['codes', tab, search, page, categoryFilter, wide, originFilter];
  /**
   * 🔴 목록 조회는 **코드 목록 탭에서만** 돈다.
   *
   * 2026-08-26 실측: 탭 키를 그대로 경로에 넣는데(`/api/v1/codes/${tab}`) '자동매핑' 탭은
   * 목록 EP 가 아니라 **`Cannot GET /api/v1/codes/auto-mapping` 404** 가 화면 전체에 떴다.
   * 그 탭은 `<AutoMappingDashboard/>` 가 자기 데이터를 따로 부르므로 여기서는 조회하지 않는다.
   */
  const LIST_TABS: TabKey[] = ['diagnosis', 'procedure', 'medication', 'nursing', 'mappings'];
  const listEnabled = LIST_TABS.includes(tab);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    enabled: listEnabled,
    queryFn: () => {
      if (tab === 'nursing') {
        // 페이지네이션으로 전건 도달 — 상한만 두고 자르면 뒤쪽 코드계가 통째로 사라진다
        return apiClient.get<{ data: CodeItem[]; pagination?: CodePagination }>(
          `/api/v1/codes/nursing?q=${encodeURIComponent(search)}&limit=20&page=${page}${categoryFilter ? `&codeSystem=${encodeURIComponent(categoryFilter)}` : ''}`
        );
      }
      if (tab === 'mappings') {
        return apiClient.get<{ data: CodeItem[]; pagination?: CodePagination }>(
          `/api/v1/codes/mappings?${categoryFilter ? `targetSystem=${encodeURIComponent(categoryFilter)}` : ''}${search ? `&sourceCode=${encodeURIComponent(search)}` : ''}`
        );
      }
      return apiClient.get<{ data: CodeItem[]; pagination?: CodePagination; search?: CodeSearchMeta | null; pinned?: CodeItem[] }>(
        `/api/v1/codes/${tab}?q=${encodeURIComponent(search)}&limit=20&page=${page}${categoryFilter ? `&category=${encodeURIComponent(categoryFilter)}` : ''}${wide ? '&wide=true' : ''}${originFilter ? `&origin=${originFilter}` : ''}`
      );
    },
  });

  const _itemsRaw = data?.data;
  const items: CodeItem[] = Array.isArray(_itemsRaw) ? _itemsRaw : (_itemsRaw as unknown as Record<string, unknown>)?.data as CodeItem[] ?? [];
  const pagination = data?.pagination;
  const searchMeta = (data as { search?: CodeSearchMeta | null } | undefined)?.search ?? null;
  const pinnedCodes = ((data as { pinned?: CodeItem[] } | undefined)?.pinned ?? []) as unknown as {
    id: string; code: string; nameKo: string;
  }[];

  // 원내 처방집(포뮬러리) 상호 반영 — 현재 목록 코드들의 승인 상태 + 원클릭 토글
  const fmDomainFor = (item?: CodeItem): string | null => {
    if (tab === 'medication') return 'MEDICATION';
    if (tab === 'nursing') return 'NURSING';
    if (tab === 'procedure') {
      const c = (item as { code?: string } | undefined)?.code ?? '';
      if (/^EB/.test(c) || /^[GH]/.test(c)) return 'IMAGING';
      if (/^6/.test(c)) return 'DIET';
      if (/^[BCDEF]/.test(c)) return 'LAB';
      return 'LAB';
    }
    return null; // diagnosis·mappings는 포뮬러리 비대상
  };
  const fmIds = ['medication', 'procedure', 'nursing'].includes(tab) ? items.map((i) => i.id).filter(Boolean) : [];
  const { data: fmData } = useQuery({
    queryKey: ['codes-fm-status', tab, fmIds.join(',')],
    queryFn: () => apiClient.get<{ data: Record<string, string> }>(`/api/v1/formulary/status?ids=${fmIds.join(',')}`),
    enabled: fmIds.length > 0,
  });
  const fmMap: Record<string, string> = (fmData?.data as unknown as { data?: Record<string, string> })?.data ?? (fmData?.data as Record<string, string>) ?? {};
  const fmToggle = useMutation({
    mutationFn: (item: CodeItem) => apiClient.post('/api/v1/formulary/toggle', { domain: fmDomainFor(item), codeId: item.id }),
    onSuccess: (r: unknown) => {
      const st = (r as { data?: { status?: string } })?.data?.status;
      toast.success(st === 'ACTIVE' ? '원내 처방집에 등재(사용)되었습니다' : '원내 처방집에서 중지되었습니다');
      qc.invalidateQueries({ queryKey: ['codes-fm-status'] });
    },
    onError: () => toast.error('처방집 반영 실패'),
  });
  const fmCell = (item: CodeItem) => {
    if (!fmDomainFor(item)) return null;
    const st = fmMap[item.id];
    return (
      <button
        onClick={(e) => { e.stopPropagation(); fmToggle.mutate(item); }}
        title={tAttr(st === 'ACTIVE' ? '원내 처방집 사용중 — 클릭하면 중지' : st === 'SUSPENDED' ? '중지됨 — 클릭하면 재개' : '비승인 — 클릭하면 등재')}
        className={`px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
          st === 'ACTIVE' ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
          : st === 'SUSPENDED' ? 'bg-gray-100 text-gray-400 hover:bg-gray-200'
          : 'bg-amber-50 text-amber-600 hover:bg-amber-100'
        }`}
      >
        <T k={st === 'ACTIVE' ? '원내@처방집' : st === 'SUSPENDED' ? '중지' : '등재'} />
      </button>
    );
  };

  // 🔴 목록 조회 실패는 **목록 탭에서만** 화면을 대체한다 — 자동매핑 탭까지 덮으면
  //    그 탭의 대시보드가 보이지 않는다(2026-08-26: 404 하나가 화면 전체를 가렸다).
  if (listEnabled && isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-7xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="코드 마스터" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="진단코드, 수가코드, 약품코드 관리" /></p>
        </div>
        <button onClick={() => { setShowAddModal(true); setAddForm({}); }}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700">
          + <T k="코드 추가" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSearch(''); setPage(1); setCategoryFilter(''); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              tab === t.key
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/25'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t.icon}
            <T k={t.label} />
          </button>
        ))}
      </div>

      {/* Auto Mapping Dashboard */}
      {tab === 'auto-mapping' && <AutoMappingDashboard />}
      {tab === 'import' && <CodeImportPanel />}
      {tab === 'synonyms' && <CodeSynonymPanel />}
      {tab === 'maintenance' && (
        <div className="space-y-4">
          <CategoryDerivePanel />
          <CodeMaintenancePanel />
        </div>
      )}

      {/* Search */}
      {tab !== 'auto-mapping' && tab !== 'import' && tab !== 'synonyms' && tab !== 'maintenance' && <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex gap-3 mb-5">
          <div className="relative flex-1">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder={tAttr(tab === 'diagnosis' ? '코드 또는 질병명 검색 (예: J06, 고혈압, diabetes)' : tab === 'procedure' ? '코드 또는 행위명 검색 (예: AA157, CBC)' : '코드 또는 약품명 검색 (예: 타이레놀, 로사르탄)')}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          </div>

          {/* 🔴 검색이 **어떻게** 찾았는지 — 서버 판정을 그대로 말한다 */}
          <CodeSearchNotice
            meta={searchMeta}
            resultCount={pagination?.total ?? items.length}
            wide={wide}
            onWide={(v) => { setWide(v); setPage(1); }}
          />
          <PinnedCodes
            pinned={pinnedCodes}
            onSelect={(c) => setSelectedCode({ table: `${tab}_codes`, id: c.id, code: c.code, name: c.nameKo })}
          />

          {/* 분류별 서브탭 */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {/* 🔴 실데이터 분류(있으면) — 없으면 종전 목록으로 폴백. 손으로 적은 목록은 실제와 갈라진다 */}
            {(liveCategories.length > 0
              ? ['전체', ...liveCategories.map(c => c.name)]
              : (tab === 'diagnosis' ? DIAG_CATEGORIES : tab === 'procedure' ? PROC_CATEGORIES : tab === 'nursing' ? NURSING_CATEGORIES : tab === 'mappings' ? MAPPING_CATEGORIES : MED_CATEGORIES)
            ).map(cat => {
              const isAll = cat === '전체';
              const active = isAll ? !categoryFilter : categoryFilter === cat;
              const n = liveCategories.find(c => c.name === cat)?.count;
              return (
                <button key={cat} onClick={() => { setCategoryFilter(isAll ? '' : cat); setPage(1); }}
                  className={`px-3 py-1 text-[11px] font-medium rounded-full transition-colors ${
                    active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}>{isAll ? <T k="전체" /> : cat}{n != null && <span className="ml-1 opacity-60">{n.toLocaleString()}</span>}</button>
              );
            })}
            {/* 🔴 분류가 비어 있는 코드가 사라지지 않게 — 숨기면 "반영이 안 된 것"으로 읽힌다 */}
            {uncategorizedCount > 0 && (
              <span className="ml-1 text-[11px] text-amber-700" title={categoryNote ?? undefined}>
                <T k="분류 없음" /> {uncategorizedCount.toLocaleString()}<Unit>건</Unit> — <T k="분류로 거르면 보이지 않습니다" />
              </span>
            )}
          </div>

          {/* 🔴 출처 — 원내 등록은 고시 파일에 없는 것이 정상이다. '표기 없음'은 **모른다**는 뜻이고
              기존 행을 일괄로 고시라고 찍지 않았다. */}
          {(tab === 'diagnosis' || tab === 'procedure' || tab === 'medication') && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[11px] text-gray-400 pr-1"><T k="출처" /></span>
              {[
                { key: '', label: '전체' },
                { key: 'LOCAL', label: '원내 등록' },
                { key: 'HIRA', label: '고시 반영' },
                { key: 'UNKNOWN', label: '표기 없음' },
              ].map(o => (
                <button key={o.key || 'all'} onClick={() => { setOriginFilter(o.key); setPage(1); }}
                  className={`px-3 py-1 text-[11px] font-medium rounded-full transition-colors ${
                    originFilter === o.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}><T k={o.label} /></button>
              ))}
              {originFilter === 'UNKNOWN' && (
                <span className="text-[11px] text-gray-400">
                  — <T k="언제·어디서 들어온 코드인지 기록이 없습니다(기존 행을 고시라고 단정하지 않았습니다)" />
                </span>
              )}
            </div>
          )}

          <div className="flex items-center justify-between mt-3">
          {pagination && (
            <span className="flex items-center text-xs text-gray-400 px-3">
              <T k="총" /> {pagination.total}<Unit>건</Unit>
            </span>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {tab === 'diagnosis' && <DiagnosisTable items={items as DiagnosisCode[]} isLoading={isLoading} onSelect={(d) => setSelectedCode({ table: 'diagnosis_codes', id: d.id, code: d.code, name: d.nameKo })} />}
          {tab === 'procedure' && <ProcedureTable fmCell={fmCell} items={items as ProcedureCode[]} isLoading={isLoading} onSelect={(p) => setSelectedCode({ table: 'procedure_codes', id: p.id, code: p.code, name: p.nameKo })} onEdit={(p) => openEdit('procedure', p)} />}
          {tab === 'medication' && <MedicationTable fmCell={fmCell} items={items as MedicationCode[]} isLoading={isLoading} onSelect={(m) => setSelectedCode({ table: 'medication_codes', id: m.id, code: m.code, name: m.nameKo })} onEdit={(m) => openEdit('medication', m)} />}
          {tab === 'nursing' && <NursingTable fmCell={fmCell} items={items as any[]} isLoading={isLoading} />}
          {tab === 'mappings' && <MappingTable items={items as any[]} isLoading={isLoading} onSelect={(m: any) => setSelectedCode({ table: m.sourceTable, id: m.sourceId, code: m.sourceCode, name: m.targetDisplay })} />}
        </div>

        {/* Pagination */}
        {pagination && pagination.total > 20 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30"
            >
              &larr; <T k="이전" />
            </button>
            <span className="text-xs text-gray-400">
              {page} / {Math.ceil(pagination.total / 20)}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!pagination.hasMore}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30"
            >
              <T k="다음" /> &rarr;
            </button>
          </div>
        )}
      </div>}

      {/* 코드 추가 모달 */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900">
              <T k={tab === 'diagnosis' ? '진단코드 추가' : tab === 'procedure' ? '수가코드 추가' : '약품코드 추가'} />
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="코드" /> *</label>
                <input value={addForm.code ?? ''} onChange={e => setAddForm(f => ({ ...f, code: e.target.value }))} placeholder={tab === 'diagnosis' ? 'J06.9' : tab === 'procedure' ? 'MM111' : 'M099901'} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="명칭 (한글)" /> *</label>
                <input value={addForm.nameKo ?? ''} onChange={e => setAddForm(f => ({ ...f, nameKo: e.target.value }))} placeholder={tAttr('코드 한글명')} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              {tab === 'diagnosis' && (<>
                <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="영문명" /></label>
                  <input value={addForm.nameEn ?? ''} onChange={e => setAddForm(f => ({ ...f, nameEn: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="분류" /></label>
                  <input value={addForm.category ?? ''} onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))} placeholder={tAttr('순환기계 질환')} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">ICD-10</label>
                  <input value={addForm.icd10Code ?? ''} onChange={e => setAddForm(f => ({ ...f, icd10Code: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              </>)}
              {tab === 'procedure' && (<>
                <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="분류" /></label>
                  <select value={addForm.category ?? ''} onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                    <option value="">{tAttr('선택')}</option>
                    {['진찰료', '검사료', '영상진단료', '처치료', '수술료', '기초검사', '재활치료료', '방사선치료료', '투석치료료', '수혈검사', '수혈료'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="단가 (원)" /></label>
                  <input type="number" value={addForm.unitPrice ?? ''} onChange={e => setAddForm(f => ({ ...f, unitPrice: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="본인부담률" /></label>
                  <input type="number" step="0.1" value={addForm.copayRate ?? '0.3'} onChange={e => setAddForm(f => ({ ...f, copayRate: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              </>)}
              {tab === 'medication' && (<>
                <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="영문명" /></label>
                  <input value={addForm.nameEn ?? ''} onChange={e => setAddForm(f => ({ ...f, nameEn: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="성분" /></label>
                  <input value={addForm.ingredient ?? ''} onChange={e => setAddForm(f => ({ ...f, ingredient: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="제약사" /></label>
                  <input value={addForm.manufacturer ?? ''} onChange={e => setAddForm(f => ({ ...f, manufacturer: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="제형" /></label>
                  <input value={addForm.dosageForm ?? ''} onChange={e => setAddForm(f => ({ ...f, dosageForm: e.target.value }))} placeholder={tAttr('정/캡슐/주사')} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="단가 (원)" /></label>
                  <input type="number" value={addForm.unitPrice ?? ''} onChange={e => setAddForm(f => ({ ...f, unitPrice: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              </>)}
            </div>

            {/* WeRU.B 매핑 제안 (코드+명칭 입력 시 자동 호출) */}
            {addForm.code && addForm.nameKo && (
              <InlineAiSuggestion
                sourceTable={tab === 'diagnosis' ? 'diagnosis_codes' : tab === 'procedure' ? 'procedure_codes' : 'medication_codes'}
                code={addForm.code}
                nameKo={addForm.nameKo}
                nameEn={addForm.nameEn}
                category={addForm.category}
              />
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={() => createMut.mutate({ ...addForm, unitPrice: addForm.unitPrice ? Number(addForm.unitPrice) : undefined, copayRate: addForm.copayRate ? Number(addForm.copayRate) : undefined })}
                disabled={createMut.isPending || !addForm.code || !addForm.nameKo}
                className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50">
                {createMut.isPending ? <T k="추가 중..." /> : <T k="코드 추가" />}</button>
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* Code Detail Panel */}
      {selectedCode && (
        <CodeDetailPanel
          sourceTable={selectedCode.table}
          sourceId={selectedCode.id}
          sourceCode={selectedCode.code}
          sourceName={selectedCode.name}
          onClose={() => setSelectedCode(null)}
        />
      )}

      {/* 속성 편집 모달 — 안전 게이트 큐레이션(수가 modality/조영제·약품 급여/마약류/용량상한) */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditTarget(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl mx-4 p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-bold text-gray-900"><T k="속성 편집" /></h3>
              <p className="text-xs text-gray-500 mt-0.5"><span className="font-mono">{editTarget.item.code}</span> · {editTarget.item.nameKo}</p>
            </div>

            {editTarget.kind === 'procedure' ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1"><T k="영상 Modality" /> <span className="text-gray-400">— <T k="조영제/임신 게이트 판정(미설정 시 코드/명칭 휴리스틱)" /></span></label>
                  <select value={String(editForm.modality ?? '')} onChange={(e) => setEditForm(f => ({ ...f, modality: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                    <option value="">{tAttr('미설정(휴리스틱)')}</option>
                    {['CT', 'MR', 'CR', 'DX', 'RF', 'XA', 'US', 'MG', 'NM', 'PT'].map(mo => <option key={mo} value={mo}>{mo}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={!!editForm.usesContrast} onChange={(e) => setEditForm(f => ({ ...f, usesContrast: e.target.checked }))} className="rounded" />
                  <T k="조영제 사용 검사" /> <span className="text-xs text-gray-400">(<T k="imaging.contrastEnforce 게이트 대상" />)</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={!!editForm.insuranceCovered} onChange={(e) => setEditForm(f => ({ ...f, insuranceCovered: e.target.checked }))} className="rounded" />
                  <T k="보험 급여 적용" /> <span className="text-xs text-gray-400">(<T k="청구 라인 급여/비급여 구분 소스" />)</span>
                </label>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1"><T k="보험 제품코드(9자리)" /> <span className="text-gray-400">— <T k="급여 등재 신호" /></span></label>
                  <input value={String(editForm.insuranceCode ?? '')} onChange={(e) => setEditForm(f => ({ ...f, insuranceCode: e.target.value }))}
                    placeholder={tAttr('미입력 = 비급여 취급')} className="w-full border rounded-xl px-3 py-2 text-sm font-mono" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1"><T k="마약류 등급" /></label>
                    <select value={String(editForm.controlSchedule ?? '')} onChange={(e) => setEditForm(f => ({ ...f, controlSchedule: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                      <option value="">{tAttr('일반@마약류')}</option>
                      {['I', 'II', 'III', 'IV', 'V'].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1"><T k="NIMS 분류" /></label>
                    <select value={String(editForm.narcoticType ?? '')} onChange={(e) => setEditForm(f => ({ ...f, narcoticType: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                      <option value="">-</option>
                      <option value="NARCOTIC">{tAttr('마약')}</option>
                      <option value="PSYCHOTROPIC">{tAttr('향정')}</option>
                      <option value="CANNABIS">{tAttr('대마')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1"><T k="향정 군" /></label>
                    <select value={String(editForm.psychotropicGroup ?? '')} onChange={(e) => setEditForm(f => ({ ...f, psychotropicGroup: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                      <option value="">-</option>
                      {['가', '나', '다', '라'].map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1"><T k="1회 최대용량" /> <span className="text-gray-400">(<T k="DUR 차단" />)</span></label>
                    <input type="number" min="0" value={String(editForm.maxSingleDose ?? '')} onChange={(e) => setEditForm(f => ({ ...f, maxSingleDose: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1"><T k="1일 최대용량" /></label>
                    <input type="number" min="0" value={String(editForm.maxDailyDose ?? '')} onChange={(e) => setEditForm(f => ({ ...f, maxDailyDose: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" />
                  </div>
                </div>
                <p className="text-[10px] text-gray-400"><T k="마약류 등급 설정 시 CPOE 처방에서 통제원장(NIMS) 자동 발행·사전승인 게이트 판정에 반영됩니다." /></p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={saveEdit} disabled={updateMut.isPending}
                className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50">
                {updateMut.isPending ? <T k="저장 중..." /> : <T k="저장" />}
              </button>
              <button onClick={() => setEditTarget(null)} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DiagnosisTable({ items, isLoading, onSelect }: { items: DiagnosisCode[]; isLoading: boolean; onSelect?: (d: DiagnosisCode) => void }) {
  if (isLoading) return <LoadingRows />;
  if (!items.length) return <EmptyState icon="📋" title="진단코드가 없습니다" />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-100">
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-20"><T k="코드체계" /></th>
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-24"><T k="코드" /></th>
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500"><T k="한글명" /></th>
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500"><T k="영문명" /></th>
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-28"><T k="분류" /></th>
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-20">ICD-10</th>
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-20">ICD-11</th>
        </tr>
      </thead>
      <tbody>
        {items.map((d: DiagnosisCode) => (
          <tr key={d.id} className="border-b border-gray-50 hover:bg-blue-50/30 cursor-pointer" onClick={() => onSelect?.(d)}>
            <td className="py-2 px-3">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                d.codeSystem === 'KCD-8' ? 'bg-blue-100 text-blue-700' :
                d.codeSystem === 'ICD-10' ? 'bg-emerald-100 text-emerald-700' :
                'bg-violet-100 text-violet-700'
              }`}>{d.codeSystem}</span>
            </td>
            <td className="py-2 px-3 font-mono font-medium text-gray-900">{d.code}</td>
            <td className="py-2 px-3 text-gray-900">{d.nameKo}</td>
            <td className="py-2 px-3 text-gray-400 text-xs">{d.nameEn ?? '-'}</td>
            <td className="py-2 px-3 text-xs text-gray-500">{d.category ?? '-'}</td>
            <td className="py-2 px-3 font-mono text-xs text-gray-400">{d.icd10Code ?? '-'}</td>
            <td className="py-2 px-3 font-mono text-xs text-gray-400">{d.icd11Code ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProcedureTable({ items, isLoading, onSelect, fmCell, onEdit }: { items: ProcedureCode[]; isLoading: boolean; onSelect?: (p: ProcedureCode) => void; fmCell?: (item: ProcedureCode) => React.ReactNode; onEdit?: (p: ProcedureCode) => void }) {
  const tAttr = useTAttr();
  if (isLoading) return <LoadingRows />;
  if (!items.length) return <EmptyState icon="💳" title="수가코드가 없습니다" />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-100">
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-24"><T k="EDI 코드" /></th>
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500"><T k="행위명" /></th>
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-24"><T k="분류" /></th>
          <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 w-28"><T k="수가(원)" /></th>
          <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 w-20"><T k="본인부담률" /></th>
          <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 w-20"><T k="보험적용" /></th>
          <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 w-24"><T k="영상속성" /></th>
          <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 w-16"><T k="원내@처방집" /></th>
          <th className="w-12" />
        </tr>
      </thead>
      <tbody>
        {items.map((p: ProcedureCode) => (
          <tr key={p.id} className="border-b border-gray-50 hover:bg-blue-50/30 cursor-pointer" onClick={() => onSelect?.(p)}>
            <td className="py-2 px-3 font-mono font-medium text-gray-900">{p.code}</td>
            <td className="py-2 px-3 text-gray-900">{p.nameKo}</td>
            <td className="py-2 px-3 text-xs text-gray-500">{p.category ?? '-'}</td>
            <td className="py-2 px-3 text-right font-medium text-gray-900">{p.unitPrice?.toLocaleString() ?? '-'}</td>
            <td className="py-2 px-3 text-right text-gray-500">{p.copayRate ? `${(Number(p.copayRate) * 100).toFixed(0)}%` : '-'}</td>
            <td className="py-2 px-3 text-center">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${p.insuranceCovered ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                {p.insuranceCovered ? <T k="급여" /> : <T k="비급여@청구" />}
              </span>
            </td>
            <td className="py-2 px-3 text-center text-[10px]">
              {p.modality && <span className="font-mono text-indigo-600 mr-1">{p.modality}</span>}
              {p.usesContrast && <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 font-medium rounded-full"><T k="조영" /></span>}
              {!p.modality && !p.usesContrast && <span className="text-gray-300">-</span>}
            </td>
            <td className="py-2 px-3 text-center">{fmCell?.(p)}</td>
            <td className="py-2 px-1 text-center">
              {onEdit && (
                <button onClick={(e) => { e.stopPropagation(); onEdit(p); }} title={tAttr('속성 편집(게이트 큐레이션)')}
                  className="text-gray-300 hover:text-blue-600 text-sm">⚙</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MedicationTable({ items, isLoading, onSelect, fmCell, onEdit }: { items: MedicationCode[]; isLoading: boolean; onSelect?: (m: MedicationCode) => void; fmCell?: (item: MedicationCode) => React.ReactNode; onEdit?: (m: MedicationCode) => void }) {
  const tAttr = useTAttr();
  if (isLoading) return <LoadingRows />;
  if (!items.length) return <EmptyState icon="💊" title="약품코드가 없습니다" />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-100">
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-24"><T k="코드" /></th>
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500"><T k="약품명" /></th>
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500"><T k="영문명" /></th>
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-28"><T k="성분" /></th>
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-24"><T k="제약사" /></th>
          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-20"><T k="제형" /></th>
          <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 w-20"><T k="단가(원)" /></th>
          <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 w-24"><T k="안전속성" /></th>
          <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 w-16"><T k="원내@처방집" /></th>
          <th className="w-12" />
        </tr>
      </thead>
      <tbody>
        {items.map((m: MedicationCode) => (
          <tr key={m.id} className="border-b border-gray-50 hover:bg-blue-50/30 cursor-pointer" onClick={() => onSelect?.(m)}>
            <td className="py-2 px-3 font-mono font-medium text-gray-900">{m.code}</td>
            <td className="py-2 px-3 text-gray-900 font-medium">{m.nameKo}</td>
            <td className="py-2 px-3 text-xs text-gray-400">{m.nameEn ?? '-'}</td>
            <td className="py-2 px-3 text-xs text-gray-500">{m.ingredient ?? '-'}</td>
            <td className="py-2 px-3 text-xs text-gray-500">{m.manufacturer ?? '-'}</td>
            <td className="py-2 px-3 text-xs text-gray-500">{m.dosageForm ?? '-'}</td>
            <td className="py-2 px-3 text-right font-medium text-gray-900">{m.unitPrice?.toLocaleString() ?? '-'}</td>
            <td className="py-2 px-3 text-center text-[10px] space-x-1">
              {m.controlSchedule && <span className="px-1.5 py-0.5 bg-rose-50 text-rose-700 font-bold rounded-full" title={`마약류 ${m.controlSchedule}${m.narcoticType ? ` · ${m.narcoticType}` : ''}${m.psychotropicGroup ? ` · 향정 ${m.psychotropicGroup}` : ''}`}><T k="마약류" /></span>}
              {m.insuranceCode && <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 font-medium rounded-full" title={`보험코드 ${m.insuranceCode}`}><T k="급여" /></span>}
              {m.maxSingleDose != null && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 font-medium rounded-full" title={`1회 최대 ${m.maxSingleDose}`}><T k="용량@안전속성" /></span>}
              {!m.controlSchedule && !m.insuranceCode && m.maxSingleDose == null && <span className="text-gray-300">-</span>}
            </td>
            <td className="py-2 px-3 text-center">{fmCell?.(m)}</td>
            <td className="py-2 px-1 text-center">
              {onEdit && (
                <button onClick={(e) => { e.stopPropagation(); onEdit(m); }} title={tAttr('속성 편집(게이트 큐레이션)')}
                  className="text-gray-300 hover:text-blue-600 text-sm">⚙</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3 py-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-8 bg-gray-100 rounded-lg animate-pulse" />
      ))}
    </div>
  );
}

function NursingTable({ items, isLoading, fmCell }: { items: any[]; isLoading: boolean; fmCell?: (item: any) => React.ReactNode }) {
  if (isLoading) return <LoadingRows />;
  if (!items.length) return <EmptyState icon="🩺" title="간호코드가 없습니다" />;

  const SYS_LABEL: Record<string, { label: string; color: string }> = {
    NANDA_I: { label: 'NANDA-I', color: 'bg-rose-100 text-rose-700' },
    NIC: { label: 'NIC', color: 'bg-blue-100 text-blue-700' },
    NOC: { label: 'NOC', color: 'bg-emerald-100 text-emerald-700' },
    MedDRA: { label: 'MedDRA', color: 'bg-amber-100 text-amber-700' },
    ICF: { label: 'ICF', color: 'bg-violet-100 text-violet-700' },
    ICNP: { label: 'ICNP', color: 'bg-indigo-100 text-indigo-700' },
  };

  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b border-gray-200 bg-gray-50/50 text-xs text-gray-500">
        <th className="px-4 py-3 text-left w-[90px]"><T k="체계" /></th>
        <th className="px-4 py-3 text-left w-[80px]"><T k="코드" /></th>
        <th className="px-4 py-3 text-left"><T k="한글명" /></th>
        <th className="px-4 py-3 text-left"><T k="영문명" /></th>
        <th className="px-4 py-3 text-left w-[100px]"><T k="영역" /></th>
        <th className="px-4 py-3 text-center w-[60px]"><T k="원내@처방집" /></th>
      </tr></thead>
      <tbody>
        {items.map((item: any) => {
          const sys = SYS_LABEL[item.codeSystem] ?? { label: item.codeSystem, color: 'bg-gray-100 text-gray-600' };
          return (
            <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="px-4 py-2.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${sys.color}`}>{sys.label}</span></td>
              <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{item.code}</td>
              <td className="px-4 py-2.5 text-gray-900">{item.nameKo}</td>
              <td className="px-4 py-2.5 text-gray-500 text-xs">{item.nameEn ?? '-'}</td>
              <td className="px-4 py-2.5 text-xs text-gray-500">{item.domain ?? '-'}</td>
              <td className="px-4 py-2.5 text-center">{item.codeSystem === 'NIC' ? fmCell?.(item) : null}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MappingTable({ items, isLoading, onSelect }: { items: any[]; isLoading: boolean; onSelect?: (item: any) => void }) {
  if (isLoading) return <LoadingRows />;
  if (!items.length) return <EmptyState icon="📋" title="표준 매핑이 없습니다" />;

  const SYS_COLOR: Record<string, string> = {
    SNOMED_CT: 'bg-blue-100 text-blue-700',
    LOINC: 'bg-emerald-100 text-emerald-700',
    ICD10PCS: 'bg-violet-100 text-violet-700',
    ICF: 'bg-amber-100 text-amber-700',
    MedDRA: 'bg-rose-100 text-rose-700',
  };

  const EQ_LABEL: Record<string, string> = { equivalent: '동등', wider: '포함', narrower: '포함됨', relatedto: '관련', inexact: '부정확' };

  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b border-gray-200 bg-gray-50/50 text-xs text-gray-500">
        <th className="px-4 py-3 text-left w-[80px]"><T k="내부코드" /></th>
        <th className="px-4 py-3 text-left">→</th>
        <th className="px-4 py-3 text-left w-[100px]"><T k="표준체계" /></th>
        <th className="px-4 py-3 text-left w-[100px]"><T k="표준코드" /></th>
        <th className="px-4 py-3 text-left"><T k="표준명칭" /></th>
        <th className="px-4 py-3 text-left w-[60px]"><T k="등가" /></th>
        <th className="px-4 py-3 text-left w-[70px]"><T k="출처" /></th>
      </tr></thead>
      <tbody>
        {items.map((item: any) => (
          <tr key={item.id} onClick={() => onSelect?.(item)} className="border-b border-gray-50 hover:bg-blue-50/50 cursor-pointer">
            <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{item.sourceCode}</td>
            <td className="px-4 py-2.5 text-gray-300">→</td>
            <td className="px-4 py-2.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${SYS_COLOR[item.targetSystem] ?? 'bg-gray-100 text-gray-600'}`}>{item.targetSystem}</span></td>
            <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{item.targetCode}</td>
            <td className="px-4 py-2.5 text-gray-900 text-xs">{item.targetDisplay}</td>
            <td className="px-4 py-2.5 text-[10px] text-gray-500">{EQ_LABEL[item.equivalence] ? <T k={`${EQ_LABEL[item.equivalence]}@매핑`} /> : item.equivalence}</td>
            <td className="px-4 py-2.5 text-[10px] text-gray-400">{item.mapSource}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DiagIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-1.756 4.39A2.25 2.25 0 0115.146 21H8.854a2.25 2.25 0 01-2.098-1.61L5 14.5m14 0H5" /></svg>; }
function ProcIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" /></svg>; }
function MedIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 6v3m0 0v3m0-3h3m-3 0H7.5M6 20.25h12A2.25 2.25 0 0020.25 18V6.75A2.25 2.25 0 0018 4.5H6A2.25 2.25 0 003.75 6.75v11.25A2.25 2.25 0 006 20.25z" /></svg>; }
function WrenchIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" /></svg>; }

function TagIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 6h.008v.008H6V6z" /></svg>; }

function FileIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>; }

function AutoMapIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>; }
