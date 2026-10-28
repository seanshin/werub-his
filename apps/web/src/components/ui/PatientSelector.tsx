'use client';

import { useState, useRef, useEffect } from 'react';
import { kdate } from '@/lib/ui-settings';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface PatientInfo {
  id: string;
  mrn: string;
  familyName: string;
  givenName: string;
  dateOfBirth?: string;
  gender?: string;
  phone?: string;
  insuranceType?: string;
  context?: string | null;
  contextType?: string;
}

interface SmartListData {
  myPatients: PatientInfo[];
  recentPatients: PatientInfo[];
  admittedPatients: PatientInfo[];
  emergencyPatients: PatientInfo[];
  searchResults: PatientInfo[];
}

interface PatientSelectorProps {
  value?: string;
  onChange: (patientId: string, patient: PatientInfo) => void;
  context?: 'order' | 'schedule' | 'admission' | 'lab' | 'diagnostics' | 'general';
  placeholder?: string;
  showEmergency?: boolean;
  showAdmitted?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  onQueryChange?: (q: string) => void;
}

const SECTION_ICONS: Record<string, string> = {
  myPatients: '',
  recentPatients: '',
  admittedPatients: '',
  emergencyPatients: '',
  searchResults: '',
};
const SECTION_LABELS: Record<string, string> = {
  myPatients: '오늘 내 환자',
  recentPatients: '최근 진료',
  admittedPatients: '담당 입원',
  emergencyPatients: '응급실',
  searchResults: '검색 결과',
};
const CONTEXT_COLORS: Record<string, string> = {
  appointment: 'text-blue-600',
  encounter: 'text-gray-500',
  admission: 'text-indigo-600',
  emergency: 'text-red-600',
  search: 'text-gray-400',
};

export default function PatientSelector({
  value,
  onChange,
  context = 'general',
  placeholder = '환자 검색 (이름, MRN, 전화번호)',
  showEmergency = true,
  showAdmitted = true,
  autoFocus = false,
  disabled = false,
  onQueryChange,
}: PatientSelectorProps) {
  const tAttr = useTAttr();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<PatientInfo | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 외부에서 value가 빈 문자열이 되면 내부 선택 상태 초기화
  useEffect(() => {
    if (!value && selectedPatient) {
      setSelectedPatient(null);
      setSearch('');
    }
  }, [value, selectedPatient]);

  // 🔴 `value` 만 외부에서 주고(프리필·URL 파라미터) 내부 선택 상태가 없으면 칩이
  //    이름 없이 `()` 로 렌더됐다 — **누구를 골랐는지 모르는 채 "선택됨"이라고 주장**하는 화면이다.
  //    이럴 때는 환자를 조회해 이름을 채우고, 조회 전/실패는 그 사실을 말한다(2026-08-18).
  const needsLookup = !!value && !selectedPatient;
  const prefill = useQuery({
    queryKey: ['patient-selector-prefill', value],
    queryFn: () => apiClient.get<{ data: PatientInfo }>(`/api/v1/patients/${value}`),
    enabled: needsLookup,
    staleTime: 60_000,
    retry: false,
  });
  const prefilled: PatientInfo | null = (() => {
    const r = prefill.data?.data as PatientInfo | { data?: PatientInfo } | undefined;
    if (!r) return null;
    return ('data' in (r as Record<string, unknown>) ? (r as { data?: PatientInfo }).data : (r as PatientInfo)) ?? null;
  })();

  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(search), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ['patient-smart-list', debouncedQ, context],
    queryFn: () => apiClient.get<{ data: SmartListData }>(`/api/v1/patients/smart-list${debouncedQ ? `?q=${encodeURIComponent(debouncedQ)}` : ''}${context !== 'general' ? `${debouncedQ ? '&' : '?'}context=${context}` : ''}`),
    enabled: isOpen,
    staleTime: 30000,
  });

  const smartData: SmartListData = (data?.data as unknown as { data?: SmartListData })?.data ?? data?.data ?? { myPatients: [], recentPatients: [], admittedPatients: [], emergencyPatients: [], searchResults: [] };

  // 표시할 섹션 구성 — 검색어 있으면 검색 결과 우선, 없으면 컨텍스트 우선
  const sections: Array<{ key: string; items: PatientInfo[] }> = [];
  if (search.trim()) {
    // 검색어가 있을 때: 검색 결과를 맨 위에
    if (smartData.searchResults.length) sections.push({ key: 'searchResults', items: smartData.searchResults });
    if (smartData.myPatients.length) sections.push({ key: 'myPatients', items: smartData.myPatients });
    if (smartData.recentPatients.length) sections.push({ key: 'recentPatients', items: smartData.recentPatients });
    if (showAdmitted && smartData.admittedPatients.length) sections.push({ key: 'admittedPatients', items: smartData.admittedPatients });
    if (showEmergency && smartData.emergencyPatients.length) sections.push({ key: 'emergencyPatients', items: smartData.emergencyPatients });
  } else {
    // 검색어 없을 때: 기존 순서
    if (smartData.myPatients.length) sections.push({ key: 'myPatients', items: smartData.myPatients });
    if (smartData.recentPatients.length) sections.push({ key: 'recentPatients', items: smartData.recentPatients });
    if (showAdmitted && smartData.admittedPatients.length) sections.push({ key: 'admittedPatients', items: smartData.admittedPatients });
    if (showEmergency && smartData.emergencyPatients.length) sections.push({ key: 'emergencyPatients', items: smartData.emergencyPatients });
    if (smartData.searchResults.length) sections.push({ key: 'searchResults', items: smartData.searchResults });
  }

  const allItems = sections.flatMap(s => s.items);

  // 클릭 외부 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (patient: PatientInfo) => {
    setSelectedPatient(patient);
    setSearch('');
    setIsOpen(false);
    onChange(patient.id, patient);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(Math.min(highlightIdx + 1, allItems.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx(Math.max(highlightIdx - 1, 0)); }
    else if (e.key === 'Enter' && highlightIdx >= 0 && allItems[highlightIdx]) { e.preventDefault(); handleSelect(allItems[highlightIdx]); }
    else if (e.key === 'Escape') { setIsOpen(false); }
  };

  const clearSelection = () => {
    setSelectedPatient(null);
    setSearch('');
    onChange('', {} as PatientInfo);
    inputRef.current?.focus();
  };

  // 선택된 환자 표시
  if (selectedPatient || value) {
    const p = selectedPatient ?? prefilled;
    const unknownName = !p && needsLookup;
    return (
      <div className="flex items-center gap-2 px-3 py-2 border border-indigo-200 bg-indigo-50/50 rounded-lg">
        <div className="flex-1">
          <span className="text-sm font-medium text-gray-900">
            {p ? `${p.familyName ?? ''}${p.givenName ?? ''}` : prefill.isFetching ? <T k="환자 확인 중…" /> : <T k="환자 정보를 불러오지 못했습니다" />}
          </span>
          {/* 이름을 모르면 MRN 자리에 빈 괄호를 그리지 않는다 — 무엇을 모르는지 말한다 */}
          {p?.mrn ? <span className="text-xs text-gray-500 ml-2">({p.mrn})</span>
            : unknownName && !prefill.isFetching ? <span className="text-xs text-red-600 ml-2">ID {String(value).slice(0, 8)}…</span>
            : null}
          {p?.context && <span className={`text-xs ml-2 ${CONTEXT_COLORS[p.contextType ?? ''] ?? 'text-gray-400'}`}>{p.context}</span>}
        </div>
        <button onClick={clearSelection} disabled={disabled} className="p-0.5 rounded hover:bg-indigo-100 text-gray-400 hover:text-gray-600">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef}
          value={search}
          onChange={e => { setSearch(e.target.value); setHighlightIdx(-1); onQueryChange?.(e.target.value); }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          /* 🔴 속성 자리 — 티를 못 그리므로 tAttr(미등록이면 한국어 원문 그대로) */
          placeholder={tAttr(placeholder)}
          disabled={disabled}
          autoFocus={autoFocus}
          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
        />
      </div>

      {isOpen && (
        <div ref={dropdownRef} className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-[400px] overflow-auto">
          {/* 🔴 "없음"과 "못 물어봤음"은 다른 사실이다 — 조회가 실패했는데 결과가 비었다고
              말하면 화면이 "그런 환자는 없다"고 단정하는 셈이 된다(P1). 실패는 실패라고 말하고
              재시도 경로를 남긴다. */}
          {isError ? (
            <div className="px-4 py-6 text-center space-y-2">
              <p className="text-sm text-red-600"><T k="환자를 조회하지 못했습니다 — 결과가 ‘없음’인지 알 수 없습니다." /></p>
              <button type="button" onClick={() => refetch()} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">
                <T k="다시 시도" />
              </button>
            </div>
          ) : isFetching && sections.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              <T k="불러오는 중..." />
            </div>
          ) : sections.length === 0 && !search ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              <T k="환자를 검색하세요" />
            </div>
          ) : sections.length === 0 && search ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              &ldquo;{search}&rdquo; <T k="검색 결과 없음" />
            </div>
          ) : (
            sections.map(section => (
              <div key={section.key}>
                <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 sticky top-0">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                    {SECTION_ICONS[section.key]} <T k={SECTION_LABELS[section.key]} /> ({section.items.length})
                  </span>
                </div>
                {section.items.map((patient, idx) => {
                  const globalIdx = allItems.indexOf(patient);
                  return (
                    <button
                      key={`${section.key}-${patient.id}-${idx}`}
                      onClick={() => handleSelect(patient)}
                      className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
                        globalIdx === highlightIdx ? 'bg-indigo-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-gray-900">{patient.familyName}{patient.givenName}</span>
                          <span className="text-[11px] text-gray-400 font-mono">{patient.mrn}</span>
                          {patient.dateOfBirth && (
                            <span className="text-[10px] text-gray-400 ml-auto shrink-0">
                              {kdate(new Date(patient.dateOfBirth), 'date')}
                            </span>
                          )}
                        </div>
                        {patient.context && (
                          <p className={`text-[11px] mt-0.5 ${CONTEXT_COLORS[patient.contextType ?? ''] ?? 'text-gray-400'}`}>
                            {patient.context}
                          </p>
                        )}
                      </div>
                      {patient.contextType === 'emergency' && (
                        <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
