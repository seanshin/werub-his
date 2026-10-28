'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Unit, InsuranceBadge, TagChip, PatientName } from '@/components/ui/display';
import Link from 'next/link';
import { usePatients } from '@/hooks/usePatients';
import { useWideScreen, splitIntoColumns } from '@/hooks/useWideScreen';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';
import { format, isValid } from 'date-fns';

function safeFormat(dateVal: string | Date | null | undefined, fmt: string, fallback = '-'): string {
  if (!dateVal) return fallback;
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  return isValid(d) ? format(d, fmt) : fallback;
}
import { getPatientAvatar } from '@/lib/patient-avatar';
import { GENDER_LABEL, INSURANCE_LABEL, USER_ROLE_LABEL } from '@hospital-run/shared';
import { TAG_COLORS, DEFAULT_TAG_COLOR } from '@/lib/patient-constants';
import type { PatientListItem } from '@/types/patient';
import { ImportPatientsModal } from './components/ImportPatientsModal';
import { MergePatientsModal } from './components/MergePatientsModal';
import { DuplicateReviewModal } from './components/DuplicateReviewModal';
import { ListAccessBanner, useListCapabilities } from './components/ListAccessBanner';
import { ListEmptyState } from './components/ListEmptyState';
import { QualityDashboardCard } from './components/QualityDashboardCard';
import { AgeText, AllergyChip, StayChip, VisitCell } from './components/RowExtras';
import { BulkBar, ColumnPicker, PatientLabelsPrint, StaleDraftChip, useListKeyboard, useListPrefs, useRowSelection, type OptionalColumn } from './components/ListTools';
import { sanctionedPrint } from '@/components/print/PrintGuard';
import { SeedBadge } from '@/components/ui/SeedBadge';

const GENDER_COLOR: Record<string, string> = {
  MALE: 'bg-blue-50 text-blue-700',
  FEMALE: 'bg-rose-50 text-rose-700',
  OTHER: 'bg-gray-50 text-gray-600',
  UNKNOWN: 'bg-gray-50 text-gray-600',
};

const INSURANCE_COLOR: Record<string, string> = {
  NHI: 'bg-emerald-50 text-emerald-700',
  MEDICAID: 'bg-violet-50 text-violet-700',
  INDUSTRIAL: 'bg-amber-50 text-amber-700',
  AUTO: 'bg-blue-50 text-blue-700',
  SELF_PAY: 'bg-gray-100 text-gray-600',
};

type ViewMode = 'table' | 'card';
/** 필터 선택지 — 태그는 실제 데이터에서(상위 30 · 전체 종류 수 · 2026-10-20 P2) */
type FilterOptions = { foreignerTotal: number; nationalities: { code: string; count: number }[]; languages: { code: string; count: number }[]; tags?: { tag: string; count: number }[]; tagKinds?: number };

export default function PatientsPage() {
  const tA = useTAttr();
  const tfA = useTfAttr();
  const { user } = useAuthStore();
  // 🔴 사용자 정보가 오기 전에 관리자로 그리지 않는다(종전 `?? 'ADMIN'` — 등록·가져오기·연락처 열이 잠깐 보였다)
  const role = user?.role ?? null;
  // 🔴 권한은 서버 능력표 하나 — 종전엔 화면 로컬 표·역할 데이터 접근 설정(실패는 삼킴)·서버 RBAC 셋이 서로 달랐다
  const { cap, isError: capIsError } = useListCapabilities();
  const showPhone = cap?.contact === 'FULL';
  // 보험 '유형'은 민감정보가 아니라 서버가 늘 보낸다(번호는 신원 권한) — 능력표가 온 뒤에만 열을 그린다
  const showInsurance = !!cap;
  // 알레르기 칸 — 단건 조회와 같은 역할만(서버가 칸을 보낼 때만) · 권한 밖은 열 자체가 없다
  const showAllergy = !!cap?.allergyStatus;
  // 열 고르기·밀도(P4 B7) — 이 역할에 있는 열 중에서만 · 저장은 이 브라우저 편의
  const prefs = useListPrefs();
  const availableCols = ([showAllergy && 'allergy', 'visit', 'encounters', showInsurance && 'insurance', showPhone && 'phone', 'tags'] as const)
    .filter(Boolean) as OptionalColumn[];
  const col = (k: OptionalColumn) => availableCols.includes(k) && !prefs.isHidden(k);
  const cell = prefs.density === 'compact' ? 'px-3 py-1.5' : 'px-5 py-3.5';
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  // 선택 행 일괄(P4 B9) — 라벨 인쇄·CSV(반출 권한) · 페이지를 넘겨도 선택은 남는다
  const selection = useRowSelection();

  // 🔴 검색은 입력이 멈춘 뒤 300ms 에 — 종전엔 글자마다 서버 요청(2026-10-20 P1 R13)
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [showQuality, setShowQuality] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showDupReview, setShowDupReview] = useState(false);
  /** 중복 그룹에서 고른 두 명 — 병합 창에 채워 연다(종전엔 다시 검색해야 했다) */
  const [mergeInitial, setMergeInitial] = useState<{ sourceId: string; targetId: string } | undefined>(undefined);

  // 필터 상태
  const [filterGender, setFilterGender] = useState('');
  const [filterInsurance, setFilterInsurance] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterForeigner, setFilterForeigner] = useState(''); // ''=전체 | Y=외국인 | N=내국인
  const [filterNationality, setFilterNationality] = useState('');
  const [filterLanguage, setFilterLanguage] = useState('');
  const [filterQuality, setFilterQuality] = useState(''); // 품질 드릴다운(대시보드 카드 클릭)
  /** 🏥 원내 환자 — **기본 시야**. 873명 전체보다 "지금 병원에 있는 사람"이 먼저 필요하다(입원·대기·진료중) */
  const [onsiteOnly, setOnsiteOnly] = useState(true);
  /** 내 환자(의사) — 기본 범위가 아니라 사람이 누르는 필터(2026-10-20 P3 B1) */
  const [scopeMine, setScopeMine] = useState(false);
  /** 원내 세부 상태(빈 배열=원내 전체) — 병동은 재원만, 접수데스크는 대기·수납만 보는 식으로 좁힌다 */
  const [onsiteStates, setOnsiteStates] = useState<string[]>([]);
  // 🔴 A5: 목록 정렬 — 백엔드 findAll 은 sort/order 를 이미 받는데 화면이 안 썼다(만든 것≠쓰는 것)
  const [sortField, setSortField] = useState<'familyName' | 'mrn' | 'dateOfBirth' | 'createdAt'>('familyName');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (f: 'familyName' | 'mrn' | 'dateOfBirth' | 'createdAt') => {
    if (sortField === f) setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else { setSortField(f); setSortOrder('asc'); }
    setPage(1);
  };
  const sortArrow = (f: string) => (sortField === f ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '');

  // 넓은 화면에서 목록을 두 덩어리로(구조 분기 — 표는 CSS 로 열을 쪼갤 수 없다)
  const twoColumnList = useWideScreen(1536);
  // 🔴 2열이면 한 화면에 두 배가 들어간다 → 페이지 크기도 함께 키워야 아래 여백이 남지 않는다
  const pageSize = twoColumnList ? 40 : 20;

  const { data, isLoading, isError, error, refetch } = usePatients({
    q: search || undefined,
    gender: filterGender || undefined,
    insuranceType: filterInsurance || undefined,
    status: filterStatus || undefined,
    tags: filterTags.length > 0 ? filterTags.join(',') : undefined,
    foreigner: filterForeigner || undefined,
    nationality: filterNationality || undefined,
    language: filterLanguage || undefined,
    quality: filterQuality || undefined,
    presence: onsiteOnly ? (onsiteStates.length ? onsiteStates.join(',') : 'onsite') : undefined,
    scope: scopeMine && cap?.myScope ? 'mine' : undefined,
    page,
    sort: sortField,
    order: sortOrder,
    // 2열이면 한 화면에 두 배가 들어간다 — 아래 여백을 남기지 않도록 페이지 크기를 함께 키운다
    limit: pageSize,
  });
  const total = data?.pagination?.total ?? 0;
  /** 원내 상태별 건수 — 칩에 실제 수를 붙여 "어디에 몇 명"이 한눈에 */
  const { data: onsiteSummary } = useQuery({
    queryKey: ['patients-onsite-summary'],
    queryFn: () => apiClient.get<{ data: { total: number; states: { key: string; label: string; hint: string; count: number; inAll?: boolean }[] } }>('/api/v1/patients/onsite-summary'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  type OnsiteStateChip = { key: string; label: string; hint: string; count: number; inAll?: boolean };
  const onsiteSummaryData = ((onsiteSummary?.data as unknown as { data?: { total: number; states: OnsiteStateChip[] } })?.data
    ?? onsiteSummary?.data) as { total?: number; states?: OnsiteStateChip[] } | undefined;
  const onsiteStateList = onsiteSummaryData?.states ?? [];
  const onsiteSummaryTotal = onsiteSummaryData?.total ?? 0;
  const _patientsRaw = data?.data;
  const patientList = Array.isArray(_patientsRaw) ? _patientsRaw : (_patientsRaw as unknown as { data?: typeof _patientsRaw })?.data ?? [];

  // 키보드(P4 B8) — `/` 검색 · ↑↓ · Enter 차트 · 창이 열려 있으면 끈다
  const openRow = useCallback((i: number) => {
    const p = (patientList as PatientListItem[])[i];
    if (p) router.push(`/patients/${p.id}`);
  }, [patientList, router]);
  const modalOpen = showImportModal || showMergeModal || showDupReview;
  const kb = useListKeyboard({ count: viewMode === 'table' ? patientList.length : 0, enabled: !modalOpen, onOpen: openRow, searchRef });

  // 환자 마킹(루비/VIP/지인) 요약 — 목록 배지
  const listColumns = splitIntoColumns(patientList, twoColumnList ? 2 : 1);
  const flagIds = (patientList as { id: string }[]).map((p) => p.id).filter(Boolean);
  const { data: flagData, isError: flagIsError, error: flagError, refetch: refetchFlags } = useQuery({
    queryKey: ['patients-flag-summary', flagIds.join(',')],
    queryFn: () => apiClient.get<{ data: Record<string, { ruby: number; vip: number; acq: number }> }>(`/api/v1/patient-flags/summary?ids=${flagIds.join(',')}`),
    enabled: flagIds.length > 0,
  });
  const flagMap = (((flagData?.data as { data?: Record<string, { ruby: number; vip: number; acq: number }> })?.data ?? flagData?.data ?? {}) as Record<string, { ruby: number; vip: number; acq: number }>);

  const toggleFilterTag = (tag: string) => {
    setFilterTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
    setPage(1);
  };

  const { data: filterOptData } = useQuery({
    queryKey: ['patient-filter-options'],
    queryFn: () => apiClient.get<{ data: FilterOptions }>('/api/v1/patients/filter-options'),
    staleTime: 300_000,
  });
  const foreignerOpts = (filterOptData?.data as { data?: FilterOptions })?.data
    ?? (filterOptData?.data as unknown as FilterOptions);

  const hasActiveFilters = filterGender || filterInsurance || filterStatus || filterTags.length > 0 || filterForeigner || filterNationality || filterLanguage || filterQuality || onsiteStates.length > 0;
  // 🔴 종전 배지는 성별·보험·상태·태그·원내 상태만 셌다 — 외국인·국적·언어·품질만 걸면 파란 버튼에 수가 비었다
  const activeFilterCount = [filterGender, filterInsurance, filterStatus, filterForeigner, filterNationality, filterLanguage, filterQuality].filter(Boolean).length
    + filterTags.length + onsiteStates.length;

  const resetFilters = () => {
    setFilterGender('');
    setFilterInsurance('');
    setFilterStatus('');
    setFilterTags([]);
    setFilterForeigner('');
    setFilterNationality('');
    setFilterLanguage('');
    setFilterQuality('');
    // 🔴 원내 상태도 '활성 필터'로 세면서 초기화에서는 빠져 있었다
    setOnsiteStates([]);
    setScopeMine(false);
    setPage(1);
  };
  const emptyConditions = { search, onsiteOnly, filterCount: activeFilterCount + (scopeMine ? 1 : 0) };
  const emptyState = (
    <ListEmptyState conditions={emptyConditions} onShowAll={() => { setOnsiteOnly(false); setPage(1); }} onResetFilters={resetFilters} />
  );

  // CSV 내보내기
  const handleExportCSV = async (ids?: string[]) => {
    try {
      // 🔴 종전엔 목록 EP 에 limit:1000 을 던져 **항상 400** 이었다(DTO Max=100) → 반출 전용 EP 사용
      // 고른 환자만이면 id 만 보낸다(필터와 섞지 않는다 — 고른 그대로 · 서버 감사에 id 가 남는다)
      const res = await apiClient.get<{ data: { data: Record<string, unknown>[]; count: number; truncated: boolean; max: number } }>('/api/v1/patients/export', ids ? { ids: ids.join(',') } : {
        q: search || undefined,
        gender: filterGender || undefined,
        insuranceType: filterInsurance || undefined,
        status: filterStatus || undefined,
        tags: filterTags.length > 0 ? filterTags.join(',') : undefined,
        foreigner: filterForeigner || undefined,
        nationality: filterNationality || undefined,
        language: filterLanguage || undefined,
        quality: filterQuality || undefined,
        presence: onsiteOnly ? (onsiteStates.length ? onsiteStates.join(',') : 'onsite') : undefined,
      });
      const payload = (res?.data as unknown as { data?: { data?: Record<string, unknown>[]; count?: number; truncated?: boolean; max?: number } })?.data ?? res?.data;
      const items = payload?.data ?? [];
      if (items.length === 0) {
        toast.warning(tA('내보낼 환자 데이터가 없습니다.'));
        return;
      }

      const headers = ['MRN', '성', '이름', '생년월일', '성별', '보험유형', '연락처'];
      const rows = items.map((p: Record<string, unknown>) => [
        p.mrn as string,
        p.familyName as string,
        p.givenName as string,
        safeFormat(p.dateOfBirth as string, 'yyyy-MM-dd', ''),
        GENDER_LABEL[p.gender as string] ?? (p.gender as string),
        INSURANCE_LABEL[p.insuranceType as string] ?? (p.insuranceType as string),
        p.phone ? (p.phone as string).replace(/^(\d{3})-?(\d{3,4})-?(\d{4})$/, '$1-****-$3') : '',
      ]);

      const csvContent = [headers.join(','), ...rows.map((r: string[]) => r.join(','))].join('\n');
      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `patients_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(payload?.truncated
        ? tfA('상한 {수}건까지만 내보냈습니다 — 필터로 범위를 좁혀 나눠 받으세요.', { 수: payload.max ?? 0 })
        : tfA('CSV {수}건을 다운로드했습니다.', { 수: items.length }));
    } catch {
      toast.error(tA('내보내기에 실패했습니다.'));
    }
  };

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900"><T k="환자 관리" /></h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {data?.pagination
              ? onsiteOnly
                ? <Tf k="원내 {수}명 — 입원·대기·진료중" params={{ 수: data.pagination.total.toLocaleString() }} />
                : <Tf k="총 {수}명 등록" params={{ 수: data.pagination.total.toLocaleString() }} />
              : <T k="환자 목록을 조회합니다" />}
            {role && <span className="ml-2 text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full" data-patients-role-chip><T k={USER_ROLE_LABEL[role] ?? role} /></span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {cap && (cap.canImport || cap.canMerge || cap.canReviewDuplicates || cap.canExport) && (
            <div className="flex items-center divide-x divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white [&>button]:rounded-none [&>button]:border-0" role="group" aria-label={tA('관리 도구')}>
              {cap.canImport && <button onClick={() => setShowImportModal(true)} className="px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                <T k="가져오기" />
              </button>}
              {cap.canMerge && <button onClick={() => { setMergeInitial(undefined); setShowMergeModal(true); }} className="px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                <T k="병합" />
              </button>}
              {cap.canReviewDuplicates && <button onClick={() => setShowDupReview(true)} className="px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                <T k="중복 검토" />
              </button>}
              {/* 🔴 CSV 는 PHI 대량 반출 — 관리자만. 서버도 /patients/export 가 ADMIN 전용이라 버튼을 숨기는 것에만 기대지 않는다 */}
              {cap.canExport && <button onClick={() => handleExportCSV()} title={tA('현재 필터 조건의 환자 목록을 CSV 로 내려받습니다(감사 기록됨)')} className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                CSV
              </button>}
            </div>
          )}

          {cap?.canRegister && (
            <Link
              href="/patients/new"
              className="flex min-h-[38px] items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 text-sm font-semibold text-white shadow-[0_6px_16px_-8px_rgba(37,99,235,0.8)] transition-colors hover:bg-blue-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" /></svg>
              <T k="환자 등록" />
            </Link>
          )}
        </div>
      </div>

      {/* 데이터 품질 대시보드 */}
      {cap?.canViewQuality && (
        <QualityDashboardCard show={showQuality} onToggle={() => setShowQuality(!showQuality)} activeQuality={filterQuality} onDrill={(q) => { setFilterQuality(filterQuality === q ? '' : q); setShowFilters(true); setPage(1); }} />
      )}

      {/* 목록 범위·연락처 안내 — 서버 능력표에서만 문장을 만든다 */}
      <ListAccessBanner cap={cap} isError={capIsError} />

      {/* 내 환자 (의사/간호사) */}
      {role && role !== 'ADMIN' && <MyPatientsSection />}

      {/* 검색바 + 필터 토글 + 뷰 전환 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1 max-w-md">
          <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
          <input
            ref={searchRef}
            type="text"
            aria-keyshortcuts="/"
            title={tA('/ 키로 검색 칸 · ↑↓ 로 행 이동 · Enter 로 차트 열기')}
            placeholder={cap?.phoneSearch ? tA('이름·MRN·전화번호로 검색...') : tA('이름 또는 MRN으로 검색...')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.04)] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          {/* 숫자로 찾았는데 전화번호 검색 권한이 없으면 — 못 찾은 것과 없는 것을 구분해 말한다 */}
          {data?.searchNote === 'PHONE_SEARCH_NOT_ALLOWED' && (
            <p className="mt-1 text-[11px] text-amber-700" data-patients-search-note><T k="전화번호 검색 권한이 없어 이름·등록번호로만 찾았습니다." /></p>
          )}
        </div>
        {/* 내 환자(의사) — 최근 30일 내 진료·내 담당 입원·오늘 내 예약 */}
        {cap?.myScope && (
          <button
            onClick={() => { setScopeMine((v) => !v); setPage(1); }}
            aria-pressed={scopeMine}
            title={tA('최근 30일 내가 진료한 환자 · 내가 담당하는 입원 환자 · 오늘 내 예약 환자')}
            data-scope-mine
            className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${scopeMine ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            <T k="내 환자" />
          </button>
        )}
        {/* 🏥 원내 — 기본 시야 토글. 끄면 등록 환자 전체를 본다 */}
        <button
          onClick={() => { setOnsiteOnly((v) => !v); setPage(1); }}
          aria-pressed={onsiteOnly}
          title={onsiteOnly
            ? tA('지금 병원에 있는 환자만 보는 중 — 입원(재원) · 오늘 접수해 대기/진료중 · 수납·약국 대기.\n누르면 등록 환자 전체를 봅니다.')
            : tA('등록 환자 전체를 보는 중 — 누르면 지금 병원에 있는 환자만 봅니다(입원·대기·진료중).')}
          className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
            onsiteOnly ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.6" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 21V5.25A1.5 1.5 0 016 3.75h12a1.5 1.5 0 011.5 1.5V21M9 21v-3.75h6V21M12 7.5v3m1.5-1.5h-3" />
          </svg>
          {onsiteOnly && onsiteStates.length > 0
            ? onsiteStateList.filter((st) => onsiteStates.includes(st.key)).map((st) => st.label).join('·')
            : <T k="원내" />}
          {onsiteOnly && total > 0 && (
            <span className="rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold tabular-nums text-white">{total}</span>
          )}
        </button>
        <button
          onClick={() => setShowFilters(!showFilters)}
          data-filter-toggle
          aria-expanded={showFilters}
          className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
            hasActiveFilters
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
          <T k="필터" />
          {hasActiveFilters && (
            <span className="w-5 h-5 bg-blue-600 text-white text-[10px] rounded-full flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>

        {viewMode === 'table' && <ColumnPicker available={availableCols} prefs={prefs} />}

        {/* 뷰 전환 */}
        <div className="flex border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-2 text-sm ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            title={tA('테이블 뷰')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 0v1.5c0 .621-.504 1.125-1.125 1.125" /></svg>
          </button>
          <button
            onClick={() => setViewMode('card')}
            className={`px-3 py-2 text-sm ${viewMode === 'card' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            title={tA('카드 뷰')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>
          </button>
        </div>
      </div>

      {/* 원내 상태 띠 — 필터 패널 안에 숨어 있어 접수·병동이 '어디에 몇 명'을 못 봤다(2026-09-29 정돈). 원내 보기일 때 상시 */}
      {onsiteOnly && (
          <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2" data-onsite-strip>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span
              className="shrink-0 whitespace-nowrap text-xs font-semibold text-emerald-800"
              title={tA('지금 병원 어디에 있는지로 좁힙니다 — 아무것도 고르지 않으면 원내 전체')}
            >
              <T k="원내 상태" />
            </span>
            {!onsiteOnly && <span className="shrink-0 text-[11px] font-medium text-amber-700"><T k="원내 보기 꺼짐 — 미적용" /></span>}
            <button
              onClick={() => { setOnsiteStates([]); setOnsiteOnly(true); setPage(1); }}
              title={tA('원내 전체 — 재원·대기·진료중·수납/약국 대기를 모두 포함')}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                onsiteOnly && onsiteStates.length === 0 ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-emerald-100'
              }`}
            >
              <T k="원내 전체" />{onsiteSummaryTotal > 0 ? ` ${onsiteSummaryTotal}` : ''}
            </button>
            {onsiteStateList.map((st) => {
              const on = onsiteStates.includes(st.key);
              // 예약은 원내가 아니라 '오늘 올 사람' — 구분선으로 갈라 다른 계열 색을 쓴다
              const upcoming = st.inAll === false;
              return (
                <span key={st.key} className="contents">
                {upcoming && <span className="mx-1 h-4 w-px self-center bg-emerald-200" aria-hidden />}
                <button
                  onClick={() => {
                    setOnsiteOnly(true);
                    setOnsiteStates((prev) => (prev.includes(st.key) ? prev.filter((k) => k !== st.key) : [...prev, st.key]));
                    setPage(1);
                  }}
                  title={st.hint}
                  aria-pressed={on}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    on
                      ? upcoming ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white'
                      : st.count === 0 ? 'bg-white text-gray-300'
                      : upcoming ? 'bg-white text-blue-700 hover:bg-blue-50' : 'bg-white text-gray-600 hover:bg-emerald-100'
                  }`}
                >
                  {st.label}
                  <span className={`tabular-nums ${on ? 'text-white/75' : st.count === 0 ? 'text-gray-300' : 'text-gray-400'}`}>{st.count}</span>
                </button>
                </span>
              );
            })}
            {onsiteStates.length > 0 && (
              <button onClick={() => { setOnsiteStates([]); setPage(1); }} className="rounded-full px-2 py-1 text-[11px] text-gray-500 hover:bg-white">
                <T k="상태 초기화" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 필터 패널 */}
      {showFilters && (
        <div className="mb-2 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-gray-900"><T k="상세 필터" /></h4>
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                data-filter-reset
                className="text-xs text-red-500 hover:text-red-700"
              >
                <T k="필터 초기화" />
              </button>
            )}
          </div>

          {/* 🔴 3열 고정이라 태그·환자 구분이 왼쪽 칸만 쓰고 오른쪽이 통째로 비었다 →
              그룹을 폭에 맞춰 흘려 배치(각 그룹은 내용만큼만 차지하고, 남는 폭은 다음 그룹이 채운다) */}
          <div className="flex flex-wrap gap-x-6 gap-y-2.5">
            {/* 성별 */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-400"><T k="성별" /></label>
              <div className="flex gap-1.5 flex-wrap">
                {[{ value: '', label: '전체' }, { value: 'MALE', label: '남' }, { value: 'FEMALE', label: '여' }].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setFilterGender(opt.value); setPage(1); }}
                    className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                      filterGender === opt.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <T k={opt.label} />
                  </button>
                ))}
              </div>
            </div>

            {/* 보험 유형 */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-400"><T k="보험 유형" /></label>
              <div className="flex gap-1.5 flex-wrap">
                {[
                  { value: '', label: '전체' },
                  { value: 'NHI', label: '건보' },
                  { value: 'MEDICAID', label: '의료급여' },
                  { value: 'INDUSTRIAL', label: '산재' },
                  { value: 'AUTO', label: '자보' },
                  { value: 'SELF_PAY', label: '자비' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setFilterInsurance(opt.value); setPage(1); }}
                    className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                      filterInsurance === opt.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <T k={opt.label} />
                  </button>
                ))}
              </div>
            </div>

            {/* 상태 */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-400"><T k="상태" /></label>
              <div className="flex gap-1.5 flex-wrap">
                {[
                  { value: '', label: '전체' },
                  { value: 'active', label: '활성' },
                  { value: 'inactive', label: '비활성' },
                  { value: 'deceased', label: '사망' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setFilterStatus(opt.value); setPage(1); }}
                    className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                      filterStatus === opt.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <T k={opt.label} />
                  </button>
                ))}
              </div>
            </div>

          {/* 환자 구분(내국인/외국인) — 국적·언어 세부는 외국인 선택 시 노출 */}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-400"><T k="환자 구분" /></label>
            <div className="flex gap-1.5 flex-wrap items-center">
              {[
                { value: '', label: '전체' },
                { value: 'N', label: '내국인' },
                { value: 'Y', label: `외국인${foreignerOpts?.foreignerTotal ? ` (${foreignerOpts.foreignerTotal})` : ''}` },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setFilterForeigner(opt.value); setFilterNationality(''); setFilterLanguage(''); setPage(1); }}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                    filterForeigner === opt.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <T k={opt.label} />
                </button>
              ))}
              {filterForeigner === 'Y' && (
                <>
                  <span className="mx-1 h-4 w-px bg-gray-200" />
                  <span className="text-[11px] text-gray-400"><T k="국적" /></span>
                  {(foreignerOpts?.nationalities ?? []).map((n) => (
                    <button
                      key={n.code}
                      onClick={() => { setFilterNationality(filterNationality === n.code ? '' : n.code); setPage(1); }}
                      className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                        filterNationality === n.code ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                      }`}
                    >
                      {n.code} {n.count}
                    </button>
                  ))}
                  <span className="mx-1 h-4 w-px bg-gray-200" />
                  <span className="text-[11px] text-gray-400"><T k="언어" /></span>
                  {(foreignerOpts?.languages ?? []).map((l) => (
                    <button
                      key={l.code}
                      onClick={() => { setFilterLanguage(filterLanguage === l.code ? '' : l.code); setPage(1); }}
                      className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                        filterLanguage === l.code ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
                      }`}
                    >
                      {l.code} {l.count}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* 태그 필터 — 같은 흐름에 두어 환자 구분 오른쪽 빈 폭을 채운다 */}
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-[11px] font-medium text-gray-400"><T k="태그" /></label>
            {/* 🔴 종전 화면 고정 9종(감염주의 등)은 운영 데이터에 해당 환자 0명 — 실제 태그에서 칩을 만든다 */}
            {foreignerOpts?.tags && foreignerOpts.tags.length === 0 && <p className="text-[11px] text-gray-400" data-tags-none><T k="등록된 태그가 없습니다" /></p>}
            {foreignerOpts && !foreignerOpts.tags && <p className="text-[11px] text-gray-400" data-tags-unknown><T k="태그 목록을 불러오지 못했습니다" /></p>}
            <div className="flex gap-1.5 flex-wrap" data-tag-chips>
              {(foreignerOpts?.tags ?? []).map(({ tag, count }) => {
                const color = TAG_COLORS[tag] ?? DEFAULT_TAG_COLOR;
                const isActive = filterTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleFilterTag(tag)}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all ${
                      isActive
                        ? `${color.bg} ${color.text} border-current`
                        : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {tag} <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                );
              })}
              {/* 잘랐으면 잘랐다고 */}
              {foreignerOpts?.tags && foreignerOpts.tagKinds != null && foreignerOpts.tagKinds > foreignerOpts.tags.length && (
                <span className="self-center text-[10px] text-gray-400" data-tags-truncated>
                  <Tf k="많은 순 {보임}개 · 전체 {전체}종" params={{ 보임: foreignerOpts.tags.length, 전체: foreignerOpts.tagKinds }} />
                </span>
              )}
            </div>
          </div>
          </div>
        </div>
      )}

      {/* 🔴 마킹(루비·VIP·지인) 조회가 실패했다 — 배지가 없는 것을 "마킹 없음"으로 읽으면 안 된다 */}
      {flagIsError && (
        <QueryErrorFallback error={flagError} onRetry={() => refetchFlags()} size="compact" className="mb-3" />
      )}

      {/* 선택 행 일괄 — 라벨 인쇄(원장 미등재)·CSV(반출 권한) · 일괄 병합·삭제는 없다 */}
      {viewMode === 'table' && (
        <BulkBar
          count={selection.selected.size}
          onPrintLabels={() => sanctionedPrint('PATIENT_LABELS')}
          onExport={cap?.canExport ? () => handleExportCSV([...selection.selected.keys()]) : undefined}
          onClear={selection.clear}
        />
      )}
      {selection.selected.size > 0 && <PatientLabelsPrint patients={[...selection.selected.values()]} />}

      {/* 테이블 뷰 — 🔴 넓은 화면(≥1536px)에서는 한 페이지를 **두 덩어리로 나눠 나란히** 본다.
          한 열로 두면 오른쪽이 남고 세로 스크롤만 길어진다(순서는 왼쪽 위→아래, 그다음 오른쪽). */}
      {viewMode === 'table' && (
        <div className={listColumns.length > 1 ? 'grid grid-cols-1 gap-4 2xl:grid-cols-2' : ''}>
        {/* 각 열은 @container — 좁은 열(2열 분할·작은 창)에서 한글 배지가 글자 단위로 꺾이지 않게
            컨테이너 폭 기준으로 아이콘/축약형 전환(@[56rem] 미만 = 아이콘) */}
        {listColumns.map((columnRows, colIdx) => (
        <div key={colIdx} className="@container overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/70">
              <tr>
                <th className="w-8 pl-4 pr-0 text-left">
                  {/* 이 쪽(이 열 덩어리) 전체 고르기 */}
                  <input type="checkbox" aria-label={tA('이 목록 전체 선택')} data-select-page
                    checked={columnRows.length > 0 && columnRows.every((p: PatientListItem) => selection.selected.has(p.id))}
                    onChange={(e) => selection.setPage(columnRows as PatientListItem[], e.target.checked)} />
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500">
                  <button onClick={() => toggleSort('mrn')} className="hover:text-gray-800">MRN{sortArrow('mrn')}</button>
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500">
                  <button onClick={() => toggleSort('familyName')} className="hover:text-gray-800"><T k="이름@성명" />{sortArrow('familyName')}</button>
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                  <button onClick={() => toggleSort('dateOfBirth')} className="hover:text-gray-800"><T k="생년월일" />{sortArrow('dateOfBirth')}</button>
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="성별" /></th>
                {col('allergy') && <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="알레르기" /></th>}
                {col('visit') && <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap" title={tA('최근 = 서명된 진료 · 다음 = 지금 이후 예약')}><T k="최근 방문 · 다음 예약" /></th>}
                {col('encounters') && <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                  <span className="adaptive-label" title={tA('서명된 진료 횟수 — 작성 중 기록은 따로 표시')}><T k="서명된 진료" /></span><span className="adaptive-compact"><T k="진료" /></span>
                </th>}
                {col('insurance') && <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="보험" /></th>}
                {col('phone') && <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="연락처" /></th>}
                {col('tags') && <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="태그" /></th>}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="pl-4" />
                    <td className="px-5 py-3.5"><div className="h-4 w-20 bg-gray-100 rounded-lg animate-pulse" /></td>
                    <td className="px-5 py-3.5"><div className="h-4 w-16 bg-gray-100 rounded-lg animate-pulse" /></td>
                    <td className="px-5 py-3.5"><div className="h-4 w-24 bg-gray-100 rounded-lg animate-pulse" /></td>
                    <td className="px-5 py-3.5"><div className="h-4 w-8 bg-gray-100 rounded-lg animate-pulse" /></td>
                    {col('allergy') && <td className="px-5 py-3.5"><div className="h-4 w-16 bg-gray-100 rounded-lg animate-pulse" /></td>}
                    {col('visit') && <td className="px-5 py-3.5"><div className="h-4 w-20 bg-gray-100 rounded-lg animate-pulse" /></td>}
                    {col('encounters') && <td className="px-5 py-3.5"><div className="h-4 w-8 bg-gray-100 rounded-lg animate-pulse" /></td>}
                    {col('insurance') && <td className="px-5 py-3.5"><div className="h-4 w-16 bg-gray-100 rounded-lg animate-pulse" /></td>}
                    {col('phone') && <td className="px-5 py-3.5"><div className="h-4 w-28 bg-gray-100 rounded-lg animate-pulse" /></td>}
                    {col('tags') && <td className="px-5 py-3.5"><div className="h-4 w-20 bg-gray-100 rounded-lg animate-pulse" /></td>}
                  </tr>
                ))
              ) : !columnRows.length ? (
                <tr>
                  <td colSpan={5 + availableCols.filter(col).length} className="px-5 py-16 text-center">
                    <svg className="w-12 h-12 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
                    {emptyState}
                  </td>
                </tr>
              ) : (
                columnRows.map((patient: PatientListItem) => {
                  const patientTags: string[] = Array.isArray(patient.tags) ? patient.tags : [];
                  const rowIndex = (patientList as PatientListItem[]).indexOf(patient);
                  const isActive = kb.active === rowIndex;
                  const isSelected = selection.selected.has(patient.id);
                  return (
                    <tr key={patient.id} data-row-index={rowIndex} data-row-active={isActive || undefined} aria-selected={isSelected}
                      onMouseDown={() => kb.setActive(rowIndex)}
                      className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${isActive ? 'bg-blue-50/60 outline outline-2 -outline-offset-2 outline-blue-300' : isSelected ? 'bg-blue-50/30' : ''} ${patient.isDeceased ? 'opacity-60' : ''}`}>
                      <td className="w-8 pl-4 pr-0">
                        <input type="checkbox" aria-label={tA('선택')} checked={isSelected} onChange={() => selection.toggle(patient)} data-select-row={patient.id} />
                      </td>
                      <td className={cell}>
                        <Link href={`/patients/${patient.id}`} className="whitespace-nowrap font-mono text-[13px] font-medium text-blue-600 transition-colors hover:text-blue-800">
                          {patient.mrn}
                        </Link>
                        {/* 리허설·개발 모드에서만 — 리얼에는 시드가 없어야 한다 */}
                        <SeedBadge id={patient.id} className="ml-1.5" />
                      </td>
                      <td className={cell}>
                        <div className="flex items-center gap-2">
                          {patient.photoUrl ? (
                            <img src={`${process.env.NEXT_PUBLIC_API_URL || ''}${patient.photoUrl}`} alt="" className="w-7 h-7 rounded-full object-cover" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-medium text-gray-500">
                              {patient.familyName?.[0]}
                            </div>
                          )}
                          <span className="font-medium text-gray-900 whitespace-nowrap">
                            <PatientName familyName={patient.familyName} givenName={patient.givenName} koreanName={patient.koreanName} showMrn={false} />
                            {patient.nationality && !['KR', 'KOR'].includes(patient.nationality) && (
                              <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 align-middle" title={[tfA('국적 {값}', { 값: patient.nationality ?? '' }), patient.preferredLanguage ? tfA('언어 {값}', { 값: patient.preferredLanguage }) : null, patient.visaType ? tfA('체류 {값}', { 값: patient.visaType }) : null].filter(Boolean).join(' · ')}>
                                {patient.nationality}{patient.preferredLanguage && patient.preferredLanguage !== 'ko' ? `·${patient.preferredLanguage}` : ''}
                              </span>
                            )}
                          </span>
                          {patient.hasPortalAccount && (
                            <span title={patient.portalActive ? tA('환자포털 계정(활성)') : tA('환자포털 계정(비활성)')}
                              className={`inline-flex items-center justify-center w-4 h-4 rounded ${patient.portalActive ? 'text-blue-600 bg-blue-50' : 'text-gray-400 bg-gray-100'}`}>
                              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 18h.01M8 21h8a1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v16a1 1 0 001 1z" /></svg>
                            </span>
                          )}
                          {patient.hasCertificate && (
                            <span title={tA('전자인증서 발급됨')} className="inline-flex items-center justify-center w-4 h-4 rounded text-emerald-600 bg-emerald-50">
                              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                            </span>
                          )}
                          {patient.isDeceased && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-200 text-gray-500"><T k="사망" /></span>
                          )}
                          <StayChip stay={patient.stay} />
                          {!!flagMap[patient.id]?.ruby && <span title={tA('악성/주의(루비)')} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 whitespace-nowrap">💎{flagMap[patient.id].ruby}</span>}
                          {!!flagMap[patient.id]?.vip && <span title="VIP" className="text-amber-400 text-xs leading-none">⭐</span>}
                          {!!flagMap[patient.id]?.acq && <span title={tA('직원 지인')} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 whitespace-nowrap">👥</span>}
                        </div>
                      </td>
                      <td className={`${cell} text-gray-500 whitespace-nowrap`}>
                        {safeFormat(patient.dateOfBirth, 'yyyy-MM-dd')}
                        <AgeText dateOfBirth={patient.dateOfBirth} />
                      </td>
                      <td className={cell}>
                        <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${GENDER_COLOR[patient.gender] ?? 'bg-gray-50 text-gray-600'}`}>
                          {GENDER_LABEL[patient.gender] ?? patient.gender}
                        </span>
                      </td>
                      {col('allergy') && <td className={cell}><AllergyChip status={patient.allergyStatus} assessedAt={patient.allergyAssessedAt} /></td>}
                      {col('visit') && <td className={cell}><VisitCell lastVisitAt={patient.lastVisitAt} nextAppointment={patient.nextAppointment} /></td>}
                      {col('encounters') && (
                        <td className={cell}>
                          <span className="inline-flex flex-wrap items-center gap-1">
                            <EncounterCountChips counts={patient.encounterCounts} />
                            <StaleDraftChip stale={patient.staleDrafts} mode={cap?.staleDrafts} days={cap?.staleDraftDays} />
                          </span>
                        </td>
                      )}
                      {col('insurance') && (
                        <td className={cell}>
                          <InsuranceBadge type={patient.insuranceType}
                            label={INSURANCE_LABEL[patient.insuranceType] ?? patient.insuranceType}
                            tone={INSURANCE_COLOR[patient.insuranceType] ?? 'bg-gray-100 text-gray-600'} />
                        </td>
                      )}
                      {col('phone') && (
                        <td className={`${cell} text-gray-500 text-xs whitespace-nowrap`}>{patient.phone ?? '-'}</td>
                      )}
                      {col('tags') && <td className={cell}>
                        <div className="flex gap-1 flex-wrap">
                          {patientTags.slice(0, 3).map((tag: string) => {
                            const color = TAG_COLORS[tag] ?? DEFAULT_TAG_COLOR;
                            return <TagChip key={tag} tag={tag} bg={color.bg} text={color.text} />;
                          })}
                          {patientTags.length > 3 && (
                            <span className="text-[10px] text-gray-400">+{patientTags.length - 3}</span>
                          )}
                        </div>
                      </td>}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {/* 페이지 이동은 마지막 열에만(열마다 반복되면 어느 것이 진짜인지 흐려진다) */}
          {colIdx === listColumns.length - 1 && data?.pagination && data.pagination.total > 0 && (
            <PaginationBar page={page} setPage={setPage} pagination={data.pagination} pageSize={pageSize} />
          )}
        </div>
        ))}
        </div>
      )}

      {/* 카드 뷰 */}
      {viewMode === 'card' && (
        <div>
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gray-200" />
                    <div className="space-y-2 flex-1">
                      <div className="h-4 w-20 bg-gray-200 rounded" />
                      <div className="h-3 w-16 bg-gray-200 rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : !patientList.length ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-5 py-16 text-center">
              <svg className="w-12 h-12 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
              {emptyState}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {patientList.map((patient: PatientListItem) => {
                const patientTags: string[] = Array.isArray(patient.tags) ? patient.tags : [];
                return (
                  <Link
                    key={patient.id}
                    href={`/patients/${patient.id}`}
                    className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:shadow-md hover:border-blue-200 transition-all ${patient.isDeceased ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <img src={patient.photoUrl ? `${process.env.NEXT_PUBLIC_API_URL || ''}${patient.photoUrl}` : getPatientAvatar(patient.gender, patient.dateOfBirth)} alt="" className="w-12 h-12 rounded-full object-cover bg-blue-50" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold text-gray-900 truncate"><PatientName familyName={patient.familyName} givenName={patient.givenName} koreanName={patient.koreanName} showMrn={false} /></p>
                          {patient.hasPortalAccount && (
                            <span title={patient.portalActive ? tA('환자포털 계정(활성)') : tA('환자포털 계정(비활성)')}
                              className={`inline-flex items-center justify-center w-4 h-4 rounded flex-shrink-0 ${patient.portalActive ? 'text-blue-600 bg-blue-50' : 'text-gray-400 bg-gray-100'}`}>
                              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 18h.01M8 21h8a1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v16a1 1 0 001 1z" /></svg>
                            </span>
                          )}
                          {patient.hasCertificate && (
                            <span title={tA('전자인증서 발급됨')} className="inline-flex items-center justify-center w-4 h-4 rounded text-emerald-600 bg-emerald-50 flex-shrink-0">
                              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                            </span>
                          )}
                          {patient.isDeceased && (
                            <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-gray-200 text-gray-500 flex-shrink-0"><T k="사망" /></span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">{patient.mrn}</p>
                      </div>
                    </div>
                    <div className="space-y-1 text-xs text-gray-500">
                      <p className="flex flex-wrap items-center gap-1"><StayChip stay={patient.stay} />{showAllergy && <AllergyChip status={patient.allergyStatus} assessedAt={patient.allergyAssessedAt} />}</p>
                      <p>{safeFormat(patient.dateOfBirth, 'yyyy-MM-dd')}<AgeText dateOfBirth={patient.dateOfBirth} /> ({GENDER_LABEL[patient.gender] ?? patient.gender})
                        <span className="ml-2"><EncounterCountChips counts={patient.encounterCounts} /></span>
                        <span className="ml-1"><StaleDraftChip stale={patient.staleDrafts} mode={cap?.staleDrafts} days={cap?.staleDraftDays} asLink={false} /></span>
                      </p>
                    </div>
                    {patientTags.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-2">
                        {patientTags.slice(0, 3).map((tag: string) => {
                          const color = TAG_COLORS[tag] ?? DEFAULT_TAG_COLOR;
                          return (
                            <span key={tag} className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${color.bg} ${color.text}`}>
                              {tag}
                            </span>
                          );
                        })}
                        {patientTags.length > 3 && (
                          <span className="text-[9px] text-gray-400">+{patientTags.length - 3}</span>
                        )}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}

          {data?.pagination && data.pagination.total > 0 && (
            <div className="mt-4">
              <PaginationBar page={page} setPage={setPage} pagination={data.pagination} pageSize={pageSize} />
            </div>
          )}
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <ImportPatientsModal onClose={() => setShowImportModal(false)} />
      )}

      {/* Merge Modal */}
      {showDupReview && (
        <DuplicateReviewModal
          onClose={() => setShowDupReview(false)}
          onMerge={(init) => { setShowDupReview(false); setMergeInitial(init); setShowMergeModal(true); }}
        />
      )}
      {showMergeModal && (
        <MergePatientsModal initial={mergeInitial} onClose={() => { setShowMergeModal(false); setMergeInitial(undefined); }} />
      )}
    </div>
  );
}

// ── Pagination Bar ──
/**
 * 🔴 종전 `Math.ceil(total / 20)` — 넓은 화면(2열)은 페이지 크기가 40 이라 **전체 페이지 수가 두 배로** 보였다.
 *    페이지 크기는 목록을 부른 값과 같은 것을 받는다.
 */
function PaginationBar({ page, setPage, pagination, pageSize }: { page: number; setPage: (p: number | ((p: number) => number)) => void; pagination: { total: number; hasMore: boolean }; pageSize: number }) {
  return (
    <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-sm text-slate-500" data-pagination>
      <span><Tf k="총 {수}명" params={{ 수: <b className="font-semibold text-slate-700 tabular-nums">{pagination.total.toLocaleString()}</b> }} /></span>
      <div className="flex gap-2">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="px-3.5 py-1.5 border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-30 transition-colors text-sm"
        >
          <T k="이전" />
        </button>
        <span className="px-3.5 py-1.5 text-sm tabular-nums" data-page-indicator>{page} / {Math.max(1, Math.ceil(pagination.total / pageSize))}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={!pagination.hasMore}
          className="px-3.5 py-1.5 border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-30 transition-colors text-sm"
        >
          <T k="다음" />
        </button>
      </div>
    </div>
  );
}

// ── Quality Dashboard Card ──
/**
 * 진료 횟수(2026-10-20 P1 R11) — 서명된 진료(SIGNED·AMENDED)와 작성 중(DRAFT)을 따로.
 * 종전 `_count.encounters` 는 작성 중까지 "진료 N회"로 셌다. 응답에 칸이 없으면(옛 서버) 모른다 — 0 으로 그리지 않는다.
 */
function EncounterCountChips({ counts }: { counts?: { signed: number; drafts: number } }) {
  if (!counts) return <span className="text-xs text-gray-300">?</span>;
  if (!counts.signed && !counts.drafts) return <span className="text-xs text-gray-300" data-enc-none>-</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {counts.signed > 0 && <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700" data-enc-signed>{counts.signed}<Unit>회</Unit></span>}
      {counts.drafts > 0 && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500" data-enc-drafts><Tf k="작성 중 {수}" params={{ 수: counts.drafts }} /></span>}
    </span>
  );
}

// ── 내 환자 섹션 ──
const CONTEXT_COLOR: Record<string, string> = {
  appointment: 'text-blue-600', encounter: 'text-gray-500',
  admission: 'text-indigo-600', emergency: 'text-red-600',
};

interface SmartListPatient {
  id: string;
  familyName?: string;
  givenName?: string;
  koreanName?: string | null;
  contextType?: string;
  context?: string;
}

interface SmartListData {
  myPatients?: SmartListPatient[];
  recentPatients?: SmartListPatient[];
  admittedPatients?: SmartListPatient[];
  emergencyPatients?: SmartListPatient[];
  data?: SmartListData;
}

function MyPatientsSection() {
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['patient-smart-list-my'],
    queryFn: () => apiClient.get<{ data: SmartListData }>('/api/v1/patients/smart-list'),
    staleTime: 30000,
  });

  const smart: SmartListData = (data?.data as unknown as SmartListData)?.data ?? data?.data ?? {};
  const sections = [
    { key: 'myPatients', label: '오늘 예약', items: smart.myPatients ?? [], icon: '📋' },
    { key: 'recentPatients', label: '최근 진료', items: smart.recentPatients ?? [], icon: '🕐' },
    { key: 'admittedPatients', label: '담당 입원', items: smart.admittedPatients ?? [], icon: '🏥' },
    { key: 'emergencyPatients', label: '응급실', items: smart.emergencyPatients ?? [], icon: '🚨' },
  ].filter(s => s.items.length > 0);

  // 🔴 조회 실패를 '내 환자 없음'(섹션 통째로 사라짐)으로 말하지 않는다
  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" className="mb-4" />;
  if (sections.length === 0) return null;

  return (
    <div className="mb-4 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50/80 to-indigo-50/60 p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3"><T k="내 환자" /></h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {sections.map(section => (
          <div key={section.key} className="bg-white rounded-xl border border-gray-100 p-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">{section.icon} <T k={section.label} /> ({section.items.length})</p>
            <div className="space-y-1">
              {section.items.slice(0, 5).map((p: SmartListPatient, i: number) => (
                <Link key={`${section.key}-${i}`} href={`/patients/${p.id}`}
                  className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                  <span className="text-xs font-medium text-gray-900"><PatientName familyName={p.familyName} givenName={p.givenName} koreanName={p.koreanName} showMrn={false} /></span>
                  <span className={`text-[10px] ${(p.contextType && CONTEXT_COLOR[p.contextType]) ?? 'text-gray-400'}`}>{p.context}</span>
                </Link>
              ))}
              {section.items.length > 5 && (
                <p className="text-[10px] text-gray-400 text-center">+{section.items.length - 5}<Unit>명</Unit></p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

