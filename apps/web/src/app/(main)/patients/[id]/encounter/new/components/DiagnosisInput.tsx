'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Term } from '@/components/ui/term';
import { T, useTAttr } from '@/components/ui/i18n-text';

export type DiagnosisType = 'PRIMARY' | 'SECONDARY' | 'DIFFERENTIAL';
export type DiagnosisCertainty = 'CONFIRMED' | 'PROVISIONAL' | 'RULE_OUT' | 'EXCLUDED';

export interface DiagnosisItem {
  diagnosisCodeId: string;
  code: string;
  nameKo: string;
  /** 표시 전용(용어 토글) — 저장 payload 에는 넣지 않는다(diagnosisCodeId·type·certainty 만) */
  nameEn?: string | null;
  type: DiagnosisType;
  certainty: DiagnosisCertainty;
  /** HIRA 상병마스터 제한 — 주상병 사용 불가 */
  notPrimary?: boolean;
  /** 성별 제한(M/F) */
  sexRestriction?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
}

interface DxCode {
  id: string;
  code: string;
  nameKo: string;
  nameEn?: string | null;
  notPrimary?: boolean;
  sexRestriction?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
}


// KCD-8 표준 22개 챕터(대분류) — 트리 탐색 1단계
const KCD_CHAPTERS: { from: string; to: string; label: string }[] = [
  { from: 'A00', to: 'B99', label: '감염성·기생충성 질환' },
  { from: 'C00', to: 'D48', label: '신생물(종양)' },
  { from: 'D50', to: 'D89', label: '혈액·조혈기관·면역' },
  { from: 'E00', to: 'E90', label: '내분비·영양·대사' },
  { from: 'F00', to: 'F99', label: '정신 및 행동장애' },
  { from: 'G00', to: 'G99', label: '신경계통' },
  { from: 'H00', to: 'H59', label: '눈 및 눈부속기' },
  { from: 'H60', to: 'H95', label: '귀 및 유돌' },
  { from: 'I00', to: 'I99', label: '순환계통' },
  { from: 'J00', to: 'J99', label: '호흡계통' },
  { from: 'K00', to: 'K93', label: '소화계통' },
  { from: 'L00', to: 'L99', label: '피부·피하조직' },
  { from: 'M00', to: 'M99', label: '근골격계·결합조직' },
  { from: 'N00', to: 'N99', label: '비뇨생식계통' },
  { from: 'O00', to: 'O99', label: '임신·출산·산후기' },
  { from: 'P00', to: 'P96', label: '출생전후기 병태' },
  { from: 'Q00', to: 'Q99', label: '선천기형·염색체이상' },
  { from: 'R00', to: 'R99', label: '증상·징후·이상소견' },
  { from: 'S00', to: 'T98', label: '손상·중독·외인 결과' },
  { from: 'U00', to: 'U99', label: '특수목적 코드' },
  { from: 'V01', to: 'Y98', label: '이환·사망의 외인' },
  { from: 'Z00', to: 'Z99', label: '건강상태·보건서비스' },
];

/**
 * 구조화 진단 입력 — KCD 검색 + 코드/한글명 표시 + 주상병(단일) 지정.
 * value 는 EncounterDiagnosis 저장용 배열. 주상병은 라디오로 정확히 1개 선택.
 * SOAP 'A'(자유텍스트)와 병행 — 저장 시 diagnoses[] 로 전송(청구 상병코드 생성).
 */
export function DiagnosisInput({
  value,
  onChange,
  patientSex,
  patientAge,
}: {
  value: DiagnosisItem[];
  onChange: (v: DiagnosisItem[]) => void;
  /** 환자 성별(MALE/FEMALE) — 성별 제한 상병 경고용(선택) */
  patientSex?: string;
  /** 환자 나이(세) — 연령 제한 상병 경고용(선택) */
  patientAge?: number;
}) {
  const tAttr = useTAttr();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  // 트리 탐색(분류) — KCD 22챕터 → 3자리 분류 → 세분류 코드
  const [treeOpen, setTreeOpen] = useState(false);
  const [chapter, setChapter] = useState<{ from: string; to: string; label: string } | null>(null);
  const [group, setGroup] = useState<{ prefix: string; name: string } | null>(null);
  // 추가 시 적용할 구분·확실도 — 트리/검색/브라우즈 공통(연속 추가 시 유지)
  const [addType, setAddType] = useState<'AUTO' | DiagnosisType>('AUTO');
  const [addCertainty, setAddCertainty] = useState<DiagnosisCertainty>('CONFIRMED');

  // 상병코드는 KCD(한국표준질병사인분류)로 제한 — EDI 청구 정합. ICD-10/11 혼입 방지.
  // 빈 질의 = 브라우즈(코드순 100건) — 클릭만으로 전체 탐색 시작(검사 검색과 동일 패턴)
  const browsing = q.trim().length === 0;
  const { data, isError: searchIsError, error: searchError, refetch: refetchSearch } = useQuery({
    queryKey: ['dx-code-search', q],
    queryFn: () =>
      apiClient
        .get<{ data: DxCode[] }>(`/api/v1/codes/diagnosis?q=${encodeURIComponent(q)}&codeSystem=KCD-8&limit=${browsing ? 100 : 20}`),
    enabled: open,
    staleTime: 60_000,
  });
  const results = data?.data ?? [];

  // 트리 2단계: 챕터 내 3자리 분류 그룹
  const { data: groupData, isLoading: groupsLoading, isError: groupsIsError, error: groupsError, refetch: refetchGroups } = useQuery({
    queryKey: ['dx-groups', chapter?.from],
    queryFn: () => apiClient.get<{ data: { prefix: string; name: string; count: number }[] }>(`/api/v1/codes/diagnosis-groups?from=${chapter!.from}&to=${chapter!.to}`),
    enabled: treeOpen && !!chapter,
    staleTime: 10 * 60 * 1000,
  });
  const _gRaw = groupData?.data;
  const groups = (Array.isArray(_gRaw) ? _gRaw : (_gRaw as { data?: { prefix: string; name: string; count: number }[] } | undefined)?.data ?? []) as { prefix: string; name: string; count: number }[];

  // 트리 3단계: 그룹 내 세분류 코드(기존 검색 EP 재사용 — code startsWith 매칭)
  const { data: groupCodesData, isLoading: codesLoading, isError: codesIsError, error: codesError, refetch: refetchGroupCodes } = useQuery({
    queryKey: ['dx-group-codes', group?.prefix],
    queryFn: () => apiClient.get<{ data: DxCode[] }>(`/api/v1/codes/diagnosis?q=${group!.prefix}&codeSystem=KCD-8&limit=100`),
    enabled: treeOpen && !!group,
    staleTime: 10 * 60 * 1000,
  });
  const groupCodes = (groupCodesData?.data ?? []).filter((c) => c.code.startsWith(group?.prefix ?? '\u0000'));

  const add = (c: DxCode, forceType?: DiagnosisType) => {
    if (value.some((v) => v.diagnosisCodeId === c.id)) {
      setQ('');
      return;
    }
    // 추가 구분: 행 버튼 오버라이드 > 선택기 > AUTO(첫 항목 주상병·이후 부상병)
    const type: DiagnosisType = forceType ?? (addType === 'AUTO' ? (value.length === 0 ? 'PRIMARY' : 'SECONDARY') : addType);
    let next: DiagnosisItem[] = [
      ...(type === 'PRIMARY' ? value.map((v) => (v.type === 'PRIMARY' ? { ...v, type: 'SECONDARY' as DiagnosisType } : v)) : value),
      { diagnosisCodeId: c.id, code: c.code, nameKo: c.nameKo, nameEn: c.nameEn, type, certainty: addCertainty,
        notPrimary: c.notPrimary, sexRestriction: c.sexRestriction, ageMin: c.ageMin, ageMax: c.ageMax },
    ];
    // 주상병 정확히 1개 보장(감별만 넣는 경우 등)
    if (!next.some((d) => d.type === 'PRIMARY')) next = next.map((v, i) => (i === 0 ? { ...v, type: 'PRIMARY' } : v));
    onChange(next);
    setQ('');
  };

  const setCertainty = (idx: number, certainty: DiagnosisCertainty) =>
    onChange(value.map((v, i) => (i === idx ? { ...v, certainty } : v)));

  const setPrimary = (idx: number) =>
    onChange(
      value.map((v, i) => ({
        ...v,
        // 단일 주상병: 선택된 것만 PRIMARY, 기존 주상병은 부상병으로 강등(감별은 유지)
        type: i === idx ? 'PRIMARY' : v.type === 'PRIMARY' ? 'SECONDARY' : v.type,
      })),
    );

  const setType = (idx: number, type: DiagnosisType) => {
    if (type === 'PRIMARY') return setPrimary(idx); // 주상병 단일성 보장(기존 주상병 강등)
    const next = value.map((v, i) => (i === idx ? { ...v, type } : v));
    // 주상병이 사라졌으면 첫 다른 항목을 주상병으로 승격(항상 정확히 1개)
    if (!next.some((d) => d.type === 'PRIMARY')) {
      const j = next.findIndex((_, i) => i !== idx);
      if (j >= 0) next[j] = { ...next[j], type: 'PRIMARY' };
      else next[idx] = { ...next[idx], type: 'PRIMARY' }; // 유일 항목이면 주상병 유지
    }
    onChange(next);
  };

  const remove = (idx: number) => {
    const next = value.filter((_, i) => i !== idx);
    // 주상병을 지웠으면 첫 항목을 주상병으로 승격
    if (next.length && !next.some((d) => d.type === 'PRIMARY')) next[0] = { ...next[0], type: 'PRIMARY' };
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-700"><T k="진단(상병)" /></span>
        <span className="text-[10px] text-gray-400"><T k="주상병 1개 · KCD · 확실도(확진/의증/R-O/배제) · 감별·배제는 청구 제외" /></span>
      </div>

      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((d, i) => (
            <li key={d.diagnosisCodeId} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-2 py-1.5">
              <label className="flex items-center gap-1 cursor-pointer" title={tAttr("주상병 지정")}>
                <input
                  type="radio"
                  name="primary-dx"
                  checked={d.type === 'PRIMARY'}
                  onChange={() => setPrimary(i)}
                  className="accent-blue-600"
                />
              </label>
              <select
                value={d.type}
                onChange={(e) => setType(i, e.target.value as DiagnosisType)}
                title={tAttr("구분: 주상병(1개)·부상병·감별 — 감별은 청구 제외")}
                className={`px-1 py-0.5 rounded text-[10px] font-medium border-0 cursor-pointer focus:ring-1 focus:ring-blue-400 ${
                  d.type === 'PRIMARY'
                    ? 'bg-blue-100 text-blue-700'
                    : d.type === 'DIFFERENTIAL'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                <option value="PRIMARY"><T k="주상병" /></option>
                <option value="SECONDARY"><T k="부상병" /></option>
                <option value="DIFFERENTIAL"><T k="감별" /></option>
              </select>
              <select
                value={d.certainty}
                onChange={(e) => setCertainty(i, e.target.value as DiagnosisCertainty)}
                title={tAttr("확실도: 확진·의증·R/O·배제 — 의증/R-O 주상병은 심사 삭감 경고, 배제는 청구 제외")}
                className={`px-1 py-0.5 rounded text-[10px] font-medium border-0 cursor-pointer focus:ring-1 focus:ring-blue-400 ${
                  d.certainty === 'CONFIRMED'
                    ? 'bg-green-100 text-green-700'
                    : d.certainty === 'PROVISIONAL'
                    ? 'bg-orange-100 text-orange-700'
                    : d.certainty === 'RULE_OUT'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                <option value="CONFIRMED"><T k="확진" /></option>
                <option value="PROVISIONAL"><T k="의증" /></option>
                <option value="RULE_OUT">R/O</option>
                <option value="EXCLUDED"><T k="배제" /></option>
              </select>
              <span className="font-mono text-gray-500">{d.code}</span>
              <span className={`truncate flex-1 ${d.certainty === 'EXCLUDED' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                <Term nameKo={d.nameKo} nameEn={d.nameEn} />
                {d.certainty === 'PROVISIONAL' && <span className="text-orange-500 no-underline"> <T k="의증" /></span>}
                {d.certainty === 'RULE_OUT' && <span className="text-red-500 no-underline"> (R/O)</span>}
              </span>
              {d.type === 'PRIMARY' && d.notPrimary && (
                <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold whitespace-nowrap" title={tAttr("HIRA 상병마스터: 주상병으로 사용할 수 없는 상병 — 부상병으로 변경 권고(심사 반려 위험)")}><T k="주상병 불가" /></span>
              )}
              {d.sexRestriction && patientSex && ((d.sexRestriction === 'M' && patientSex !== 'MALE') || (d.sexRestriction === 'F' && patientSex !== 'FEMALE')) && (
                <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold whitespace-nowrap" title={`${d.sexRestriction === 'M' ? '남성' : '여성'} 전용 상병 — 환자 성별과 불일치`}><T k="성별 부적합" /></span>
              )}
              {patientAge != null && ((d.ageMin != null && patientAge < d.ageMin) || (d.ageMax != null && patientAge > d.ageMax)) && (
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-bold whitespace-nowrap" title={`적용 연령 ${d.ageMin ?? 0}~${d.ageMax ?? '∞'}세 — 환자 나이(${patientAge}세) 범위 밖`}><T k="연령 부적합" /></span>
              )}
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-gray-400 hover:text-red-500 text-sm leading-none"
                title={tAttr("삭제")}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide shrink-0">추가 시</span>
          <select value={addType} onChange={(e) => setAddType(e.target.value as 'AUTO' | DiagnosisType)}
            title={tAttr("검색·분류탐색에서 추가할 때 적용할 구분(연속 추가 시 유지)")}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium border-0 cursor-pointer focus:ring-1 focus:ring-blue-400 ${
              addType === 'PRIMARY' ? 'bg-blue-100 text-blue-700' : addType === 'DIFFERENTIAL' ? 'bg-amber-100 text-amber-700' : addType === 'SECONDARY' ? 'bg-gray-200 text-gray-600' : 'bg-gray-100 text-gray-500'
            }`}>
            <option value="AUTO">자동(첫 항목=주상병)</option>
            <option value="PRIMARY"><T k="주상병으로" /></option>
            <option value="SECONDARY"><T k="부상병으로" /></option>
            <option value="DIFFERENTIAL"><T k="감별로" /></option>
          </select>
          <select value={addCertainty} onChange={(e) => setAddCertainty(e.target.value as DiagnosisCertainty)}
            title={tAttr("추가할 때 적용할 확실도")}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium border-0 cursor-pointer focus:ring-1 focus:ring-blue-400 ${
              addCertainty === 'CONFIRMED' ? 'bg-green-100 text-green-700' : addCertainty === 'PROVISIONAL' ? 'bg-orange-100 text-orange-700' : addCertainty === 'RULE_OUT' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-500'
            }`}>
            <option value="CONFIRMED"><T k="확진" /></option>
            <option value="PROVISIONAL"><T k="의증" /></option>
            <option value="RULE_OUT">R/O</option>
            <option value="EXCLUDED"><T k="배제" /></option>
          </select>
          {(addType !== 'AUTO' || addCertainty !== 'CONFIRMED') && (
            <button type="button" onClick={() => { setAddType('AUTO'); setAddCertainty('CONFIRMED'); }}
              className="text-[10px] text-gray-400 hover:text-gray-600 underline"><T k="기본으로" /></button>
          )}
        </div>
        <div className="flex gap-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => { setOpen(true); setTreeOpen(false); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={tAttr("진단 코드 검색 (예: I10, 고혈압) — 클릭하면 목록 표시…")}
          className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button type="button" onClick={() => { setTreeOpen((v) => !v); setOpen(false); }}
          aria-pressed={treeOpen}
          title={tAttr("KCD 분류 체계로 탐색(대분류→분류→세분류)")}
          className={`shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${treeOpen ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
          <T k="⊞ 분류 탐색" />
        </button>
        </div>

        {treeOpen && (
          <div className="mt-1.5 border border-gray-200 rounded-lg bg-white">
            {/* breadcrumb */}
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-100 text-[11px] bg-gray-50 rounded-t-lg">
              <button type="button" onClick={() => { setChapter(null); setGroup(null); }}
                className={`hover:text-blue-600 ${!chapter ? 'font-bold text-gray-700' : 'text-gray-400'}`}><T k="KCD 대분류" /></button>
              {chapter && (<>
                <span className="text-gray-300">›</span>
                <button type="button" onClick={() => setGroup(null)}
                  className={`hover:text-blue-600 ${!group ? 'font-bold text-gray-700' : 'text-gray-400'}`}>{chapter.from}–{chapter.to} {chapter.label}</button>
              </>)}
              {group && (<>
                <span className="text-gray-300">›</span>
                <span className="font-bold text-gray-700">{group.prefix} {group.name.slice(0, 18)}</span>
              </>)}
              <span className="ml-auto text-gray-300"><T k="클릭하면 진단에 추가됩니다" /></span>
            </div>

            <div className="max-h-72 overflow-y-auto p-2">
              {!chapter && (
                <div className="grid grid-cols-2 gap-1">
                  {KCD_CHAPTERS.map((ch) => (
                    <button key={ch.from} type="button" onClick={() => { setChapter(ch); setGroup(null); }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-blue-50 text-gray-700">
                      <span className="font-mono text-[10px] text-gray-400 shrink-0">{ch.from}–{ch.to}</span>
                      <span className="truncate">{ch.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {chapter && !group && (
                groupsIsError ? <QueryErrorFallback error={groupsError} onRetry={() => refetchGroups()} size="compact" /> :
                groupsLoading ? <p className="text-xs text-gray-400 py-4 text-center"><T k="불러오는 중…" /></p> :
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-0.5">
                  {groups.map((g) => (
                    <button key={g.prefix} type="button" onClick={() => setGroup({ prefix: g.prefix, name: g.name })}
                      className="flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs text-left hover:bg-blue-50">
                      <span className="font-mono text-blue-600 shrink-0">{g.prefix}</span>
                      <span className="text-gray-700 truncate flex-1">{g.name}</span>
                      <span className="text-[10px] text-gray-300 shrink-0">{g.count}</span>
                    </button>
                  ))}
                </div>
              )}
              {group && (
                codesIsError ? <QueryErrorFallback error={codesError} onRetry={() => refetchGroupCodes()} size="compact" /> :
                codesLoading ? <p className="text-xs text-gray-400 py-4 text-center"><T k="불러오는 중…" /></p> :
                <div className="space-y-0.5">
                  {groupCodes.map((c) => {
                    const added = value.some((v) => v.diagnosisCodeId === c.id);
                    return (
                    <div key={c.id} className={`flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs ${added ? 'text-gray-300' : 'hover:bg-blue-50 text-gray-700'}`}>
                      <button type="button" disabled={added} onClick={() => add(c)}
                        title="클릭하면 위 '추가 시' 구분으로 추가"
                        className="flex items-center gap-2 flex-1 min-w-0 text-left disabled:cursor-default">
                        <span className={`font-mono shrink-0 ${added ? 'text-gray-300' : 'text-blue-600'}`}>{c.code}</span>
                        <span className="truncate"><Term nameKo={c.nameKo} nameEn={c.nameEn} /></span>
                      </button>
                      {c.notPrimary && <span className="text-[9px] px-1 rounded bg-gray-100 text-gray-400 shrink-0"><T k="주상병불가" /></span>}
                      {added ? (
                        <span className="text-[9px] text-gray-300 shrink-0"><T k="추가됨" /></span>
                      ) : (
                        <button type="button" onClick={() => add(c, 'PRIMARY')}
                          title={tAttr("주상병으로 바로 추가(기존 주상병은 부상병으로)")}
                          className="shrink-0 px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold hover:bg-blue-100">주</button>
                      )}
                    </div>
                    );
                  })}
                  {(() => {
                    // 세분류 조회는 limit=100 — 그룹 전체 건수보다 적으면 잘림 안내
                    const total = groups.find((g) => g.prefix === group.prefix)?.count ?? 0;
                    return total > groupCodes.length ? (
                      <p className="px-2.5 py-1.5 text-[10px] text-gray-400">
                        전체 {total}건 중 {groupCodes.length}건 표시 — 검색으로 좁혀보세요
                      </p>
                    ) : null;
                  })()}
                </div>
              )}
            </div>
          </div>
        )}
        {value.length === 0 && !q.trim() && (
          <p className="mt-1 text-[10px] text-gray-400">
            상병을 검색해 추가하면 각 행에서 <b className="text-gray-500">구분(주상병·부상병·감별)</b>과 <b className="text-gray-500">확실도(확진·의증·R/O·배제)</b>를 지정할 수 있습니다.
          </p>
        )}
        {/* 🔴 상병 검색 실패를 "해당 상병 없음"(드롭다운 미표시)으로 접지 않는다 */}
        {open && searchIsError && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg p-2">
            <QueryErrorFallback error={searchError} onRetry={() => refetchSearch()} size="compact" />
          </div>
        )}
        {open && !searchIsError && results.length > 0 && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-auto">
            {browsing && (
              <div className="sticky top-0 bg-gray-50 border-b border-gray-100 px-3 py-1 text-[10px] text-gray-400 z-10">
                상위 {results.length}건(코드순) — 전체 18,000+ 상병은 상병명·코드로 검색하세요
              </div>
            )}
            {results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => add(c)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-2"
              >
                <span className="font-mono text-blue-600 shrink-0">{c.code}</span>
                <span className="text-gray-700 truncate"><Term nameKo={c.nameKo} nameEn={c.nameEn} /></span>
                {c.notPrimary && <span className="ml-auto shrink-0 text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-400"><T k="주상병불가" /></span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
