'use client';

import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Money } from '@/components/ui/display';

/**
 * 처방 입력 공용 부품 — 진료화면(차트)과 CPOE 새 처방 모달이 **같은 것**을 쓴다.
 *
 * 두 화면이 각자 구현하던 탓에 계속 어긋났다(모달에는 식이·활동·간호지시 탭이 없었고,
 * 약품 검색은 성분·포뮬러리·급여·약가를 못 보여줬다). 유형 정의·검색·프리셋을 여기 한 곳에 둔다.
 *
 * 유형은 입력 방식이 둘로 갈린다:
 *  - **코드 기반**(약·검사·영상·식이): 마스터 코드를 검색해 고른다
 *  - **프리셋 기반**(치료·활동·간호지시): 표준 항목을 다중 선택한다(간호는 NIC 표준 코드)
 */

export type OrderTab = 'MEDICATION' | 'LAB' | 'IMAGING' | 'THERAPY' | 'DIET' | 'ACTIVITY' | 'NURSING';

export const ORDER_TABS: { key: OrderTab; label: string; icon: string }[] = [
  { key: 'MEDICATION', label: '약처방', icon: '💊' },
  { key: 'LAB', label: '검사', icon: '🧪' },
  { key: 'IMAGING', label: '영상', icon: '📷' },
  { key: 'THERAPY', label: '치료', icon: '🏋️' },
  { key: 'DIET', label: '식이', icon: '🍚' },
  { key: 'ACTIVITY', label: '활동', icon: '🚶' },
  { key: 'NURSING', label: '간호지시', icon: '🩺' },
];

/** 마스터 코드를 검색해 고르는 유형 */
export const CODE_BASED_TABS: OrderTab[] = ['MEDICATION', 'LAB', 'IMAGING', 'DIET'];
/** 표준 항목을 다중 선택하는 유형 */
export const PRESET_BASED_TABS: OrderTab[] = ['THERAPY', 'ACTIVITY', 'NURSING'];

export const isCodeBased = (t: string) => CODE_BASED_TABS.includes(t as OrderTab);
export const isPresetBased = (t: string) => PRESET_BASED_TABS.includes(t as OrderTab);

export interface CodeItem {
  id: string;
  code: string;
  nameKo: string;
  nameEn?: string;
  ingredient?: string;
  dosageForm?: string;
  /** 약효분류(식약처 분류 한글명) — 드롭다운 카테고리 그룹핑 */
  category?: string | null;
  unitPrice?: number | null;
  insuranceCode?: string;
  highAlertFlag?: boolean;
  highAlertCategory?: string | null;
  /** 원내 처방집 승인 상태(ACTIVE=승인·SUSPENDED=중지·null=비승인·undefined=폴백검색이라 미상) */
  formularyStatus?: string | null;
  source?: string;
  /** 내 목록 기본값 — 선택 시 용법 자동 채움(차트·CPOE 공통) */
  myDefaults?: { dosage?: string; frequency?: string; duration?: number; route?: string };
  /** 과 카탈로그 가이드 — 기본 용법 + 안내문 */
  deptGuide?: { defaultDosage?: string; defaultFrequency?: string; defaultRoute?: string; guideNote?: string };
  /**
   * 🔴 프리필 기본값이 제형과 모순인 경우(2026-08-14 W7). 서버가 판정해 보낸다.
   * 실측: 덱사메타손 **주사**를 `1C PO 28일`, 신선동결혈장(FFP) **혈액제제**를 `1T PO 30일` 로
   * "권장"하던 값이 개인 약속처방(⭐고정·38회 사용)에 등재돼 이 폼을 채우고 있었다.
   */
  dosageIssues?: { code: string; message: string }[];
  hasDosageIssue?: boolean;
}

/**
 * 약품 급여 판정 — **약가(unitPrice) 보유** 기준.
 * 표준코드 임포트가 전 품목에 insuranceCode 를 채워 넣어 presence 판정이 무력화됐다
 * (비급여 미등재 ~2천 품목이 급여로 오표기). 수가(검사·영상)는 insuranceCode 판정을 유지한다.
 */
export const isDrugCovered = (c: { unitPrice?: number | null }) => c.unitPrice != null && c.unitPrice > 0;

export const CODE_SEARCH_PLACEHOLDER: Record<string, string> = {
  MEDICATION: '약품명 또는 코드 검색 (클릭하면 목록 표시)...',
  LAB: '검사명 또는 코드 검색 (클릭하면 목록 표시)...',
  IMAGING: '영상 검사명 또는 코드 검색 (클릭하면 목록 표시)...',
  DIET: '식이 처방 검색 (저염식, 당뇨식 등)...',
};

export const CODE_SEARCH_LABEL: Record<string, string> = {
  MEDICATION: '약품 검색',
  LAB: '검사 검색',
  IMAGING: '영상 검색',
  DIET: '식이 검색 (예: 저염식, 당뇨식)',
};

/**
 * 코드 검색 — 통합 검색(핀→내 목록→과 카탈로그→전체) 우선, 실패 시 기존 코드 API 폴백.
 * 빈 질의도 검색한다(둘러보기) — 사용자가 이름을 모를 때 목록에서 고를 수 있어야 한다.
 */
export function useCodeSearch(activeTab: string) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CodeItem[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  /**
   * 🔴 (2026-09-15 F3) 두 검색 경로가 모두 실패하면 `setResults([])` 만 해서, 이미 열린 목록이
   *    "검색 결과가 없습니다." 를 띄웠다 — 처방하려는 약이 원내에 없다고 말하는 것과 같다(실패를 없음으로·P1).
   *    실패는 따로 들고 나가고, 목록은 실패를 실패로 그린다.
   */
  const [failed, setFailed] = useState(false);

  const search = useCallback(async (q: string) => {
    setSearching(true);
    setFailed(false);
    try {
      const res = await apiClient.get<{ data: CodeItem[] }>('/api/v1/code-search', { q, type: activeTab });
      const raw = res.data;
      // 전체 필드를 그대로 보존한다 — 부분 매핑이 insuranceCode·unitPrice 를 떨궈
      // 급여약이 '비급여'로 오표기되던 버그가 있었다.
      setResults(Array.isArray(raw) ? raw : ((raw as Record<string, unknown> | undefined)?.data as CodeItem[]) ?? []);
      setOpen(true);
    } catch {
      try {
        const endpoint = activeTab === 'MEDICATION' ? '/api/v1/codes/medication' : '/api/v1/codes/procedure';
        const res = await apiClient.get<{ data: CodeItem[] }>(endpoint, { q });
        const raw = res.data;
        setResults(Array.isArray(raw) ? raw : ((raw as Record<string, unknown> | undefined)?.data as CodeItem[]) ?? []);
        setOpen(true);
      } catch { setResults([]); setFailed(true); setOpen(true); }
    } finally {
      setSearching(false);
    }
  }, [activeTab]);

  const reset = useCallback(() => { setQuery(''); setResults([]); setOpen(false); setFailed(false); }, []);

  return { query, setQuery, results, open, setOpen, searching, failed, search, reset };
}

/** 검색 결과 목록 — 성분·원내 처방집·급여·약가를 함께 보여준다(고를 때 필요한 판단 재료) */
export function CodeSearchDropdown({
  activeTab, results, query, onSelect, onRequestFormulary, searching, failed,
}: {
  activeTab: string;
  results: CodeItem[];
  query: string;
  /** 검색 실패 여부 — 필수(빠뜨리면 실패가 "결과 없음"으로 그려진다) */
  failed: boolean;
  onSelect: (c: CodeItem) => void;
  onRequestFormulary?: (c: CodeItem) => void;
  searching?: boolean;
}) {
  if (results.length === 0) {
    if (!searching && failed) {
      return (
        <div role="alert" className="absolute z-20 mt-1 w-full rounded-xl border border-red-200 bg-red-50 p-4 text-center shadow-lg">
          <p className="text-sm text-red-700">검색하지 못했습니다 — 결과가 없는 것이 아닙니다. 다시 입력해 재시도하세요.</p>
        </div>
      );
    }
    if (!searching && query.length >= 2) {
      return (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-gray-200 bg-white p-4 text-center shadow-lg">
          <p className="text-sm text-gray-400">검색 결과가 없습니다.</p>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="absolute z-20 mt-1 max-h-[420px] w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
      {!query.trim() && (
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 px-4 py-1.5 text-[11px] text-gray-400">
          {activeTab === 'MEDICATION'
            ? `전체 24,022품목 중 ${results.length}건 표시 — 약품명·성분·코드로 검색해 좁히세요`
            : `상위 ${results.length}건(가나다순) — 전체 목록은 검사·시술명이나 코드로 검색하세요`}
        </div>
      )}
      {results.map((code, idx) => (
        <div key={code.id}>
          {activeTab === 'MEDICATION' && code.category && code.category !== results[idx - 1]?.category && (
            <div className="border-y border-blue-100/60 bg-blue-50/60 px-4 py-1 text-[11px] font-semibold text-blue-700">{code.category}</div>
          )}
          <button
            onClick={() => onSelect(code)}
            className="w-full px-4 py-2.5 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-blue-50"
          >
            <div className="flex w-full items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                {code.source === 'MY_LIST' && <span className="whitespace-nowrap rounded bg-yellow-100 px-1 py-0.5 text-[9px] font-bold text-yellow-700">내 목록</span>}
                {code.source === 'DEPT_CATALOG' && <span className="whitespace-nowrap rounded bg-indigo-100 px-1 py-0.5 text-[9px] font-bold text-indigo-700">과 카탈로그</span>}
                <span className="text-sm font-medium text-gray-900">{code.nameKo}</span>
                <span className="text-xs text-gray-400">{code.code}</span>
                {code.ingredient && <span className="ml-1 text-[10px] text-gray-400">({code.ingredient})</span>}
              </div>
              <div className="ml-2 flex shrink-0 items-center gap-1.5">
                {code.highAlertFlag && (
                  <span className="whitespace-nowrap rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold text-white" title="ISMP 고위험 약물 — 투약 전 2인 확인">⛔고위험</span>
                )}
                {code.formularyStatus === 'ACTIVE' ? (
                  <span className="whitespace-nowrap rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600" title="원내 처방집 승인(위원회)">원내</span>
                ) : code.formularyStatus === 'SUSPENDED' ? (
                  <span className="whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-400" title="위원회 일시 중지 항목">중지</span>
                ) : code.formularyStatus === undefined ? (
                  // 폴백 검색에는 formularyStatus 가 없다 — 비승인으로 오표기하지 않는다
                  <span className="whitespace-nowrap rounded bg-gray-50 px-1.5 py-0.5 text-[9px] font-medium text-gray-400" title="원내 처방집 승인 상태 확인 불가(폴백 검색)">상태 미상</span>
                ) : (
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); onRequestFormulary?.(code); }}
                    className="cursor-pointer whitespace-nowrap rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 hover:bg-amber-100"
                    title={onRequestFormulary ? '원내 처방집 비승인 — 클릭하면 위원회 등재 요청' : '원내 처방집 비승인'}
                  >
                    비승인{onRequestFormulary ? '·등재요청' : ''}
                  </span>
                )}
                {(activeTab === 'MEDICATION' ? isDrugCovered(code) : !!code.insuranceCode) ? (
                  <span className="whitespace-nowrap rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-600">급여</span>
                ) : (
                  <span className="whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-medium text-red-600">비급여</span>
                )}
                {code.unitPrice != null && code.unitPrice > 0 && (
                  <span className="whitespace-nowrap font-mono text-[10px] text-gray-500"><Money value={code.unitPrice} /></span>
                )}
              </div>
            </div>
            {code.myDefaults?.dosage && (
              <p className="ml-1 mt-0.5 text-[10px] text-yellow-600">기본: {code.myDefaults.dosage} {code.myDefaults.frequency} {code.myDefaults.route}</p>
            )}
            {!code.myDefaults && code.deptGuide?.guideNote && (
              <p className="ml-1 mt-0.5 text-[10px] text-indigo-500">{code.deptGuide.guideNote}</p>
            )}
            {code.nameEn && ( // 한/영 병용 P2(D5): 조건부 가드 제거 — 자주 쓰는 약일수록 영문명이 사라지던 역설 해소
              <p className="mt-0.5 text-xs text-gray-400">{code.nameEn}</p>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── 프리셋(치료·활동·간호지시) ──────────────────────────────── */

export interface PresetItem { code: string; name: string; station?: string }

export const THERAPY_PRESETS: PresetItem[] = [
  { code: 'PT_EXERCISE', name: '운동치료', station: 'tx-pt' },
  { code: 'PT_MANUAL', name: '도수치료', station: 'tx-pt' },
  { code: 'PT_MODALITY', name: '열전기치료', station: 'tx-pt' },
  { code: 'OT_ADL', name: '작업치료', station: 'tx-ot' },
  { code: 'OT_COGNITIVE', name: '인지재활', station: 'tx-ot' },
  { code: 'ST_SPEECH', name: '언어치료', station: 'tx-st' },
  { code: 'ST_SWALLOW', name: '삼킴치료', station: 'tx-st' },
  { code: 'HD_SESSION', name: '혈액투석', station: 'tx-dialysis' },
  { code: 'PD_SESSION', name: '복막투석', station: 'tx-dialysis' },
  { code: 'CHEMO_IV', name: '항암주사', station: 'tx-chemo' },
  { code: 'RT_FRACTION', name: '방사선치료', station: 'tx-radiation' },
  { code: 'PT_GAIT', name: '보행치료', station: 'tx-pt' },
  { code: 'PT_TRACTION', name: '견인치료', station: 'tx-pt' },
  { code: 'PT_ESWT', name: '체외충격파', station: 'tx-pt' },
  { code: 'PT_FES', name: '전기자극치료', station: 'tx-pt' },
  { code: 'PT_LYMPH', name: '림프부종치료', station: 'tx-pt' },
  { code: 'REHAB_PULMO', name: '호흡재활', station: 'tx-pt' },
  { code: 'REHAB_CARDIAC', name: '심장재활', station: 'tx-pt' },
];

export const ACTIVITY_PRESETS: PresetItem[] = [
  { code: 'ACT_ABR', name: '절대안정 (ABR)' },
  { code: 'ACT_BR', name: '침상안정 (BR)' },
  { code: 'ACT_HOB30', name: '침상머리 30° 거상' },
  { code: 'ACT_SIT', name: '좌위 허용' },
  { code: 'ACT_BRP', name: '화장실 보행만 허용' },
  { code: 'ACT_ROOM', name: '병실 내 보행' },
  { code: 'ACT_AMB', name: '자유 보행' },
  { code: 'ACT_WC', name: '휠체어 이동' },
  { code: 'ACT_FALL', name: '낙상 주의' },
  { code: 'ACT_NWB_R', name: '체중부하 금지(우)' },
  { code: 'ACT_NWB_L', name: '체중부하 금지(좌)' },
  { code: 'ACT_PWB', name: '부분 체중부하' },
  { code: 'ACT_CRUTCH', name: '목발 보행' },
  { code: 'ACT_BRACE', name: '보조기 착용 보행' },
  { code: 'ACT_HOB_FLAT', name: '두부 거상 금지' },
  { code: 'ACT_NO_SHOWER', name: '샤워·목욕 금지' },
  { code: 'ACT_NO_STRAIN', name: '격렬한 활동 금지' },
];

/** NIC 로드 실패 시 폴백 — 간호지시가 아예 비어 보이지 않게 */
export const NURSING_FALLBACK_PRESETS: PresetItem[] = [
  { code: 'NRS_VS_Q4H', name: '활력징후 q4h' },
  { code: 'NRS_IO', name: 'I/O 측정' },
  { code: 'NRS_BST', name: '혈당측정 (BST)' },
  { code: 'NRS_POS_Q2H', name: '체위변경 q2h' },
  { code: 'NRS_PU', name: '욕창 간호' },
  { code: 'NRS_FOLEY', name: '유치도뇨 관리' },
  { code: 'NRS_O2', name: '산소 투여' },
  { code: 'NRS_SUCTION', name: '흡인 간호' },
  { code: 'NRS_ISO', name: '격리 간호' },
  { code: 'NRS_DRESSING', name: '상처 드레싱' },
];

interface NicCode { code: string; nameKo: string; domain?: string | null }

/**
 * 간호지시 표준 코드(NIC).
 *
 * 🔴 폴백(`NURSING_FALLBACK_PRESETS`)은 "빈 목록"이 아니라 **실제로 처방 가능한 10항목**이다.
 * 그래서 조회 실패를 삼키면 화면이 폴백을 **정본인 척** 보여준다 — 없앨 수 없는 폴백이라면
 * 최소한 "지금 보이는 건 정본이 아니다" 를 소비처가 말할 수 있어야 한다.
 * 그러려면 훅이 실패를 밖으로 내보내야 한다(`queryFn` 안에서 접지 않는다).
 */
export function useNicCodes() {
  const { data, isError, error, isLoading, refetch } = useQuery({
    queryKey: ['nic-codes'],
    queryFn: () => apiClient.get<{ data: NicCode[] }>('/api/v1/codes/nursing', { codeSystem: 'NIC' }),
    staleTime: 10 * 60 * 1000,
  });
  const raw = data?.data;
  const list: NicCode[] = Array.isArray(raw) ? raw : ((raw as { data?: NicCode[] } | undefined)?.data ?? []);
  const domains = [...new Set(list.map((n) => n.domain).filter((d): d is string => !!d))];
  /** 표시 중인 간호지시 목록이 NIC 정본이 아니라 내장 폴백인가 */
  const usingFallback = !isLoading && list.length === 0;
  return { list, domains, isError, error, isLoading, refetch, usingFallback };
}

/** 유형별 프리셋 목록 — 간호는 NIC 우선, 없으면 폴백 */
export function presetsFor(tab: string, nic: { code: string; nameKo: string }[]): PresetItem[] {
  if (tab === 'THERAPY') return THERAPY_PRESETS;
  if (tab === 'ACTIVITY') return ACTIVITY_PRESETS;
  if (tab === 'NURSING') return nic.length ? nic.map((n) => ({ code: `NIC ${n.code}`, name: n.nameKo })) : NURSING_FALLBACK_PRESETS;
  return [];
}

/** 프리셋 다중 선택 — 여러 항목을 골라 **각각 개별 처방**으로 등록한다(개별 중단 가능) */
export function PresetPicker({
  items, selected, onToggle, columns = 3,
}: {
  items: PresetItem[];
  selected: PresetItem[];
  onToggle: (p: PresetItem) => void;
  columns?: number;
}) {
  return (
    <div className={`grid gap-2 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
      {items.map((t) => {
        const on = selected.some((p) => p.code === t.code);
        return (
          <button
            key={t.code}
            type="button"
            onClick={() => onToggle(t)}
            className={`rounded-xl border px-3 py-2 text-left text-xs font-medium transition ${
              on ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {on && <span className="mr-1">✓</span>}{t.name}
          </button>
        );
      })}
    </div>
  );
}
