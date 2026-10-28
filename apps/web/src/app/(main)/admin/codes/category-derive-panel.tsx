'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import type { ServerMessage } from '@hospital-run/shared';
import { ServerText } from '@/components/ui/server-text';

/**
 * 수가 분류 **접두 유도**.
 *
 * 🔴 사람 신고 "수가코드가 다 반영이 안 되었음" → 실측하니 코드는 **166,744건 전부** 있었고,
 *    **분류가 0.03%(55건)만** 채워져 있었다. 분류로 거르면 아무것도 안 보였다.
 *
 * 🔴 규칙을 기억에서 적지 않는다 — **이미 분류가 붙은 행에서 역산**한다.
 *    그리고 그 방법의 한계를 화면이 그대로 말한다(덮는 비율·모호한 접두).
 */
type Suggestion = { prefix: string; category: string; evidence: number; affects: number };
type Report = {
  suggestions: Suggestion[];
  ambiguous: { prefix: string; categories: { category: string; evidence: number }[]; affects: number }[];
  uncategorizedTotal: number;
  coveredBySuggestions: number;
  /** 서버가 센 수가 코드 전체 행수 — 없으면(구 서버) 수를 말하지 않는다 */
  codeTotal?: number;
  notes: string[];
  /** 정본 `{ k, params }`(같은 순서) — 없으면(구 서버) `notes` 원문 */
  notesMsg?: ServerMessage[];
};

export default function CategoryDerivePanel() {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['code-category-suggestions'],
    // 🔴 `queryFn` 안에서 실패를 기본값으로 접지 않는다
    queryFn: () => apiClient.get<{ data: Report }>('/api/v1/codes/procedure/category-suggestions'),
  });
  const rep = data?.data as Report | undefined;

  const applyMut = useMutation({
    mutationFn: () =>
      apiClient.post<{ data: { totalUpdated: number; rejected: string[]; notice: string } }>(
        '/api/v1/codes/procedure/category-suggestions/apply',
        { prefixes: [...picked] },
      ),
    onSuccess: (r) => {
      // `notice` 는 서버가 만든 문장이라 번역하지 않고 그대로 끼운다
      toast.success(tfAttr('{수}건에 분류를 넣었습니다 — {안내}', { 수: r.data.totalUpdated.toLocaleString(), 안내: r.data.notice }));
      setPicked(new Set());
      refetch();
    },
    onError: (e: Error) => toast.error(e?.message || tAttr('적용에 실패했습니다')),
  });

  const toggle = (p: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p); else n.add(p);
      return n;
    });

  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} />;
  if (isLoading || !rep) return <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />;

  const pickedAffects = rep.suggestions.filter((s) => picked.has(s.prefix)).reduce((a, s) => a + s.affects, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900"><T k="수가 분류 — 코드 접두에서 유도" /></h3>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
          {/* 🔴 (2026-09-11) 종전엔 `… > 0 ? 166744 : 0` — 신고 당일 실측을 상수로 박아 **실측처럼** 말했다. 서버가 센 수만 말한다 */}
          {typeof rep.codeTotal === 'number' && (
            <><Tf k="코드는 {수}건 전부 있습니다." params={{ 수: <b>{rep.codeTotal.toLocaleString()}</b> }} />{' '}</>
          )}
          <Tf k="비어 있는 것은 {분류}입니다 — 분류로 거르면 보이지 않아 “반영이 안 된 것”처럼 읽힙니다." params={{ 분류: <b><T k="분류" /></b> }} />
        </p>
        {/* 🔴 방법의 한계를 화면이 그대로 말한다 */}
        {rep.notes.map((n, i) => (
          <p key={i} className="mt-1.5 text-[12px] leading-relaxed text-amber-700"><ServerText msg={rep.notesMsg?.[i]} fallback={n} /></p>
        ))}

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl bg-gray-50 px-3 py-2">
            <p className="text-[11px] text-gray-400"><T k="미분류" /></p>
            <p className="font-mono text-lg font-bold text-gray-800">{rep.uncategorizedTotal.toLocaleString()}</p>
          </div>
          <div className="rounded-xl bg-gray-50 px-3 py-2">
            <p className="text-[11px] text-gray-400"><T k="접두 증거로 덮이는 것" /></p>
            <p className="font-mono text-lg font-bold text-gray-800">{rep.coveredBySuggestions.toLocaleString()}</p>
          </div>
          <div className="rounded-xl bg-gray-50 px-3 py-2">
            <p className="text-[11px] text-gray-400"><T k="선택한 것" /></p>
            <p className="font-mono text-lg font-bold text-blue-700">{pickedAffects.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h4 className="text-[13px] font-bold text-gray-900"><T k="제안 — 증거가 하나로 모이는 접두" /></h4>
        {rep.suggestions.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400"><T k="증거로 채울 수 있는 접두가 없습니다." /></p>
        ) : (
          <table className="mt-3 w-full text-[12px]">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-400">
                <th className="w-8" />
                <th className="py-1.5"><T k="접두" /></th>
                <th><T k="분류" /></th>
                <th className="text-right"><T k="근거(기존 행)" /></th>
                <th className="text-right"><T k="채울 건수" /></th>
              </tr>
            </thead>
            <tbody>
              {rep.suggestions.map((s) => (
                <tr key={s.prefix} className="border-b border-gray-50">
                  <td className="py-1.5">
                    <input type="checkbox" checked={picked.has(s.prefix)} onChange={() => toggle(s.prefix)} />
                  </td>
                  <td className="font-mono font-semibold text-gray-800">{s.prefix}</td>
                  <td className="text-gray-700">{s.category}</td>
                  {/* 🔴 근거의 두께를 함께 낸다 — 5건짜리 근거와 500건짜리 근거는 다른 사실이다 */}
                  <td className="text-right font-mono text-gray-500">{s.evidence}</td>
                  <td className="text-right font-mono text-gray-800">{s.affects.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <p className="mr-auto text-[11px] text-gray-400">
            <Tf k="적용해도 출처가 {출처} 로 남습니다 — 고시 분류가 아닙니다." params={{ 출처: <code className="rounded bg-gray-100 px-1">PREFIX_DERIVED</code> }} />
          </p>
          <button
            type="button"
            onClick={() => applyMut.mutate()}
            disabled={picked.size === 0 || applyMut.isPending}
            className="rounded-xl bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
          >
            {applyMut.isPending ? <T k="적용 중…" /> : <Tf k="선택 {수}개 적용" params={{ 수: picked.size }} />}
          </button>
        </div>
      </div>

      {/* 🔴 모호한 접두를 숨기지 않는다 — 숨기면 "규칙이 깨끗하다"로 읽힌다 */}
      {rep.ambiguous.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-6">
          <h4 className="text-[13px] font-bold text-gray-900">
            <T k="제안하지 않은 접두 — 증거가 두 갈래 이상" />
          </h4>
          <p className="mt-1 text-[12px] text-gray-600">
            <T k="다수결로 정하면 그 추정이 규칙인 척합니다. 고시 원본으로만 확정할 수 있습니다." />
          </p>
          <ul className="mt-2 space-y-1 text-[12px]">
            {rep.ambiguous.map((a) => (
              <li key={a.prefix} className="text-gray-700">
                <span className="font-mono font-semibold">{a.prefix}</span>{' '}
                <span className="text-gray-500">
                  {a.categories.map((c) => `${c.category}(${c.evidence})`).join(' / ')}
                </span>{' '}
                <span className="text-gray-400"><Tf k="— {수}건 영향" params={{ 수: a.affects.toLocaleString() }} /></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
