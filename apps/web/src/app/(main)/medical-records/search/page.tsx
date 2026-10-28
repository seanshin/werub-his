'use client';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { sanitizeHtml } from '@/lib/sanitize';

import { EmptyState, Unit } from '@/components/ui/display';

const TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  encounter: { label: '진료기록', cls: 'bg-indigo-100 text-indigo-700' },
  progress_note: { label: '경과기록', cls: 'bg-blue-100 text-blue-700' },
  nursing_note: { label: '간호일지', cls: 'bg-purple-100 text-purple-700' },
  discharge_summary: { label: '퇴원요약', cls: 'bg-emerald-100 text-emerald-700' },
};

interface MedicalRecordResult {
  type: string;
  patientName: string;
  doctorName: string;
  recordedAt?: string;
  headline?: string;
}

export default function MedicalRecordSearchPage() {
  const tAttr = useTAttr();
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['medical-record-search', searchQuery, typeFilter, dateFrom, dateTo],
    queryFn: () => apiClient.get<{ data: { results: MedicalRecordResult[]; total: number } }>('/api/v1/medical-records/search', {
      q: searchQuery, type: typeFilter || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
    }),
    enabled: searchQuery.length >= 2,
  });

  const results = data?.data?.results ?? [];
  const total = data?.data?.total ?? 0;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(query);
  };

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900"><T k="의무기록 검색" /></h1>

      <form onSubmit={handleSearch} className="flex gap-3">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tAttr('검색어를 입력하세요 (2자 이상)')} className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
        <button type="submit" disabled={query.length < 2} className="px-6 py-2.5 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 disabled:opacity-50"><T k="검색" /></button>
      </form>

      <div className="flex gap-3 items-center">
        <div className="flex gap-1">
          {['', 'encounter', 'progress_note', 'nursing_note', 'discharge_summary'].map(t => (
            <button key={t} onClick={() => { setTypeFilter(t); setSearchQuery(query); }} className={`px-3 py-1.5 text-xs rounded-lg font-medium ${typeFilter === t ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
              <T k={t ? (TYPE_LABEL[t]?.label ?? t) : '전체'} />
            </button>
          ))}
        </div>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-2 py-1 border border-gray-200 rounded-lg text-xs" />
        <span className="text-gray-400 text-xs">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-2 py-1 border border-gray-200 rounded-lg text-xs" />
      </div>

      {/* 🔴 검색어는 사용자 입력(데이터) — 문장 틀만 번역하고 자리표시자로 끼운다 */}
      {searchQuery && (
        <p className="text-xs text-gray-500">{isFetching ? <T k="검색중..." /> : <Tf k="&quot;{검색어}&quot; 검색 결과: {건수}" params={{ 검색어: searchQuery, 건수: <>{total}<Unit>건</Unit></> }} />}</p>
      )}

      {isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : isLoading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : results.length === 0 && searchQuery ? (
        <EmptyState icon="🔍" title="검색 결과가 없습니다" />
      ) : (
        <div className="space-y-3">
          {results.map((r: MedicalRecordResult, i: number) => {
            const typeCfg = TYPE_LABEL[r.type] ?? { label: r.type, cls: 'bg-gray-100 text-gray-600' };
            return (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${typeCfg.cls}`}><T k={typeCfg.label} /></span>
                  <span className="text-xs text-gray-500">{r.patientName}</span>
                  <span className="text-xs text-gray-400">| {r.doctorName}</span>
                  <span className="text-[11px] text-gray-400 ml-auto">{r.recordedAt?.split('T')[0]}</span>
                </div>
                <p className="text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: sanitizeHtml(r.headline || '-') }} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
