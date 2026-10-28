'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { useKdate } from '@/lib/ui-settings';

/**
 * 차트 내 검색(patient-chart-refinement C4 · G1 "11회 방문·수백 줄에서 지난번 그 약 이름을 찾을 방법이 없다").
 *
 * 🔴 **정본은 서버의 의무기록 전문검색 하나다**(`GET /api/v1/medical-records/search?patientId=`) — 이 패널이
 *    탭 데이터를 따로 긁어 모아 검색하지 않는다(정본 옆에 약한 것을 만들지 않는다). 환자 지정 검색은 환자 지목 열람으로 감사된다.
 * 🔴 **자르면 잘랐다고 말한다**(`truncated`) · 결과는 서버 캐시(5분)일 수 있어 **검색 시각**을 함께 보인다.
 * 🔴 서버 headline 의 `<mark>` 는 원문을 이스케이프하지 않고 끼운 것이라 HTML 로 그리지 않는다 — 태그를 걷고 텍스트로 강조한다.
 */

export const CHART_SEARCH_LIMIT = 30;

export interface ChartSearchResult {
  id: string;
  type: string;
  headline: string;
  doctorName: string;
  recordedAt: string;
  status?: string | null;
}

export interface ChartSearchResponse {
  results: ChartSearchResult[];
  total: number;
  truncated?: boolean;
  generatedAt?: string;
}

/** 결과 유형 → 라벨·열 탭(차트 탭 키). 모르는 유형은 원문 코드를 그대로(지어낸 라벨 없음) */
export const CHART_SEARCH_TYPE_META: Record<string, { label: string; tab: string }> = {
  encounter: { label: '진료기록', tab: 'encounters' },
  progress_note: { label: '경과기록', tab: 'timeline' },
  nursing_note: { label: '간호기록', tab: 'nursing' },
  discharge_summary: { label: '퇴원요약', tab: 'admissions' },
  diagnosis: { label: '진단', tab: 'encounters' },
  prescription: { label: '처방', tab: 'medications' },
  lab_result: { label: '검사결과', tab: 'labresults' },
};

/** `<mark>` 를 걷은 순수 텍스트 */
export function stripMark(s: string | null | undefined): string {
  return (s ?? '').replace(/<\/?mark>/gi, '');
}

function Highlighted({ text, q }: { text: string; q: string }) {
  const needle = q.trim();
  if (!needle) return <>{text}</>;
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const hit = lower.indexOf(n, i);
    if (hit < 0) { parts.push(text.slice(i)); break; }
    if (hit > i) parts.push(text.slice(i, hit));
    parts.push(<mark key={k++} className="bg-yellow-100 text-gray-900 rounded px-0.5">{text.slice(hit, hit + needle.length)}</mark>);
    i = hit + needle.length;
  }
  return <>{parts}</>;
}

export function ChartSearchPanel({ patientId, onOpenTab }: { patientId: string; onOpenTab?: (tab: string) => void }) {
  const tAttr = useTAttr();
  const kdate = useKdate();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');

  const enabled = !!patientId && query.trim().length >= 2;
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['chart-search', patientId, query],
    queryFn: () => apiClient.get<{ data: ChartSearchResponse }>(
      `/api/v1/medical-records/search?patientId=${encodeURIComponent(patientId)}&q=${encodeURIComponent(query.trim())}&limit=${CHART_SEARCH_LIMIT}`,
    ),
    enabled,
  });
  const resp = data?.data;

  const submit = () => setQuery(input);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-3" data-testid="chart-search-panel">
      <form
        className="flex gap-2 items-center"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={tAttr('차트 안에서 찾기 — 진단명·약 이름·검사명·기록 본문')}
          aria-label={tAttr('차트 내 검색')}
          className="flex-1 min-w-0 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <button type="submit" className="text-sm px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700">
          <T k="찾기" />
        </button>
        {query && (
          <button type="button" onClick={() => { setInput(''); setQuery(''); }} className="text-xs text-gray-400 hover:text-gray-600 px-1">
            <T k="닫기" />
          </button>
        )}
      </form>

      {query && query.trim().length < 2 && (
        <p className="text-xs text-gray-400 mt-2"><T k="두 글자 이상 입력하세요" /></p>
      )}

      {enabled && (
        <div className="mt-3">
          {isLoading ? (
            <p className="text-xs text-gray-400"><T k="찾는 중…" /></p>
          ) : isError ? (
            <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
          ) : !resp || resp.results.length === 0 ? (
            <EmptyState compact icon="🔍" title="이 환자의 기록에서 일치하는 항목이 없습니다" />
          ) : (
            <>
              <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1.5">
                <span>
                  {resp.truncated
                    ? <Tf k="{전체}건 중 최근 {표시}건만 표시 — 검색어를 좁혀 주세요" params={{ 전체: resp.total, 표시: resp.results.length }} />
                    : <Tf k="{전체}건" params={{ 전체: resp.total }} />}
                </span>
                {resp.generatedAt && (
                  <span title={tAttr('같은 검색어 결과는 최대 5분까지 저장된 결과를 다시 보여줄 수 있습니다')}>
                    <Tf k="검색 시각 {시각}" params={{ 시각: kdate(resp.generatedAt, 'timeSec') }} />
                  </span>
                )}
              </div>
              <ul className="divide-y divide-gray-50 max-h-80 overflow-y-auto" data-testid="chart-search-results">
                {resp.results.map((r) => {
                  const meta = CHART_SEARCH_TYPE_META[r.type];
                  return (
                    <li key={`${r.type}:${r.id}`} className="py-2 flex gap-2 items-start">
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 whitespace-nowrap">
                        {meta ? <T k={meta.label} /> : r.type}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-800 break-words">
                          <Highlighted text={stripMark(r.headline) || '-'} q={query} />
                          {r.type === 'lab_result' && r.status && r.status !== 'VERIFIED' && (
                            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 whitespace-nowrap"><T k="예비 결과" /></span>
                          )}
                          {r.type === 'prescription' && r.status === 'CANCELLED' && (
                            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 whitespace-nowrap"><T k="취소된 처방" /></span>
                          )}
                          {r.type === 'prescription' && r.status === 'DISCONTINUED' && (
                            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 whitespace-nowrap"><T k="중단된 처방" /></span>
                          )}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {kdate(r.recordedAt, 'datetime')}{r.doctorName ? ` · ${r.doctorName}` : ''}
                        </p>
                      </div>
                      {meta && onOpenTab && (
                        <button type="button" onClick={() => onOpenTab(meta.tab)} className="shrink-0 text-[11px] text-blue-600 hover:text-blue-700 whitespace-nowrap">
                          <T k="탭 열기" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
