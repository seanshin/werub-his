'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState } from '@/components/ui/display';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { useServerTextAttr } from '@/components/ui/server-text';
import type { ServerMessage } from '@hospital-run/shared';

/**
 * 동의어·약어 사전.
 *
 * 🔴 **승인해야 검색이 달라진다.** 등재만으로는 아무 일도 일어나지 않는다 —
 *    화면이 그 사실을 매번 말한다("초기 견본은 원내 표준이 아니다").
 */
type Synonym = {
  id: string;
  sourceTable: string;
  code: string | null;
  term: string;
  expandsTo: string | null;
  kind: string;
  status: string;
  note: string | null;
  reviewedAt: string | null;
};

const KIND_LABEL: Record<string, string> = {
  ABBREVIATION: '약어',
  COLLOQUIAL: '구어',
  ENGLISH: '영문',
  LEGACY: '옛 표기',
  TYPO: '흔한 오타',
};
const STATUS_LABEL: Record<string, string> = {
  PROPOSED: '검토 전',
  APPROVED: '사용 중',
  REJECTED: '반려',
};
const STATUS_STYLE: Record<string, string> = {
  PROPOSED: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-gray-100 text-gray-500 border-gray-200',
};

const TABLES = [
  { key: 'DiagnosisCode', label: '진단' },
  { key: 'ProcedureCode', label: '수가' },
  { key: 'MedicationCode', label: '약품' },
  { key: 'LabTestCode', label: '검사' },
];

export default function CodeSynonymPanel() {
  const qc = useQueryClient();
  const [sourceTable, setSourceTable] = useState('DiagnosisCode');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ term: '', expandsTo: '', code: '', kind: 'ABBREVIATION', note: '' });
  const tAttr = useTAttr();
  const serverAttr = useServerTextAttr();
  const tfAttr = useTfAttr();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['code-synonyms', sourceTable, status, q],
    // 🔴 `queryFn` 안에서 `.catch(() => 기본값)` 을 쓰지 않는다 —
    //    쓰면 `isError` 가 영원히 false 가 되어 아래 오류 화면이 도달 불가 코드가 된다
    queryFn: () =>
      apiClient.get<{ data: Synonym[]; meta: { total: number; pendingReview: number } }>(
        `/api/v1/codes/synonyms?sourceTable=${sourceTable}${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}&limit=200`,
      ),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['code-synonyms'] });
    // 승인하면 코드 검색 결과가 달라진다 — 그 캐시도 함께 버린다
    qc.invalidateQueries({ queryKey: ['codes'] });
  };

  const loadMut = useMutation({
    mutationFn: () =>
      apiClient.post<{ data: { created: number; skipped: number; total: number; notice: string } }>(
        '/api/v1/codes/synonyms/load-builtin',
        {},
      ),
    onSuccess: (r) => {
      const d = r.data;
      toast.success(tfAttr('등재 {등재}건 · 이미 있어 건너뜀 {건너뜀}건 — 승인해야 검색에 반영됩니다', { 등재: d.created, 건너뜀: d.skipped }));
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || tAttr('사전 등재에 실패했습니다')),
  });

  const reviewMut = useMutation({
    mutationFn: (v: { id: string; decision: 'APPROVED' | 'REJECTED' }) =>
      apiClient.post<{ data: Synonym; warning: string | null; warningMsg?: ServerMessage | null }>(
        `/api/v1/codes/synonyms/${v.id}/review`,
        { decision: v.decision },
      ),
    onSuccess: (r, v) => {
      // 서버 `warningMsg` 가 정본 — 토스트는 문자열 자리라 조립해 넘긴다(구 응답이면 `warning` 원문)
      if (r.warningMsg || r.warning) toast.error(serverAttr(r.warningMsg, r.warning));
      else toast.success(tAttr(v.decision === 'APPROVED' ? '승인했습니다 — 이제 검색에 반영됩니다' : '반려했습니다'));
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || tAttr('처리에 실패했습니다')),
  });

  const proposeMut = useMutation({
    mutationFn: () =>
      apiClient.post('/api/v1/codes/synonyms', {
        sourceTable,
        term: form.term.trim(),
        kind: form.kind,
        expandsTo: form.expandsTo.trim() || undefined,
        code: form.code.trim() || undefined,
        note: form.note.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success(tAttr('등록했습니다 — 승인해야 검색에 반영됩니다'));
      setForm({ term: '', expandsTo: '', code: '', kind: 'ABBREVIATION', note: '' });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || tAttr('등록에 실패했습니다')),
  });

  const rows = data?.data ?? [];
  const pending = data?.meta?.pendingReview;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900"><T k="동의어·약어 사전" /></h3>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
          {/* 🔴 예시어(`맹장염`)와 실측 결과 코드명(`벼락`·`일반 성인 의학적 검사`)은 **검색어·코드 데이터 그 자체**라
              번역하지 않는다 — 번역하면 "한국어 검색어가 엉뚱한 한국어 코드명을 냈다"는 사실이 사라진다 */}
          <Tf k="의료진은 {예1}·{예2}처럼 정본 표기와 다른 말로 찾습니다." params={{ 예1: <b>DM</b>, 예2: <b>맹장염</b> }} />{' '}
          <Tf
            k="지금은 그런 말이 {강조}를 냅니다 — 2026-08-26 운영 실측에서 {약어1} 은 {결과1}({원어1}), {약어2} 는 {결과2}({원어2})를 냈습니다."
            params={{
              강조: <b><T k="0건이 아니라 전혀 다른 결과" /></b>,
              약어1: <code className="rounded bg-gray-100 px-1">HTN</code>,
              결과1: <b>&ldquo;벼락&rdquo;</b>,
              원어1: <>lig<b>HTN</b>ing</>,
              약어2: <code className="rounded bg-gray-100 px-1">AMI</code>,
              결과2: <b>&ldquo;일반 성인 의학적 검사&rdquo;</b>,
              원어2: <>ex<b>AMI</b>nation</>,
            }}
          />
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-500">
          🔴 <b><T k="승인한 것만 검색에 반영됩니다." /></b>{' '}
          <T k="등재만으로는 검색이 달라지지 않습니다." />{' '}
          <Tf k="동의어는 {강조} 검색어를 넓힐 뿐이며, 고르는 것은 사람입니다." params={{ 강조: <b><T k="어느 코드인지 지목하지 않고" /></b> }} />
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => loadMut.mutate()}
            disabled={loadMut.isPending}
            className="rounded-xl bg-gray-900 px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            <T k={loadMut.isPending ? '등재 중…' : '기본 약어·구어 사전 등재(검토 전)'} />
          </button>
          {pending !== undefined && (
            <span className="text-[12px] text-amber-700">
              <Tf k="검토 전 {수}건 — 승인해야 검색에 반영됩니다" params={{ 수: pending }} />
            </span>
          )}
        </div>
      </div>

      {/* 등록 */}
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h4 className="text-[13px] font-bold text-gray-900"><T k="동의어 추가" /></h4>
        <div className="mt-3 grid gap-2 sm:grid-cols-5">
          <input
            value={form.term}
            onChange={(e) => setForm({ ...form, term: e.target.value })}
            placeholder={tAttr('찾는 말 (예: DM)')}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={form.expandsTo}
            onChange={(e) => setForm({ ...form, expandsTo: e.target.value })}
            placeholder={tAttr('이 말로도 찾기 (예: 당뇨병)')}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder={tAttr('코드 지목(선택)')}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
          >
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{tAttr(v)}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => proposeMut.mutate()}
            disabled={proposeMut.isPending || !form.term.trim()}
            className="rounded-xl bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
          >
            <T k="등록@버튼" />
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">
          🔴 <Tf k="코드를 지목하면 {강조} 올립니다 — 어느 코드로 볼지를 원내가 정하는 것이라, 확실할 때만 채우세요." params={{ 강조: <b><T k="그 코드를 결과 위에 따로" /></b> }} />{' '}
          <T k="비워 두면 검색어만 넓힙니다." />
        </p>
      </div>

      {/* 목록 */}
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {TABLES.map((t) => (
            <button
              key={t.key}
              onClick={() => setSourceTable(t.key)}
              className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                sourceTable === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
              }`}
            >
              <T k={t.label} />
            </button>
          ))}
          <span className="mx-2 h-4 w-px bg-gray-200" />
          {['', 'PROPOSED', 'APPROVED', 'REJECTED'].map((s) => (
            <button
              key={s || 'all'}
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                status === s ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'
              }`}
            >
              <T k={s ? STATUS_LABEL[s] : '전체'} />
            </button>
          ))}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tAttr('동의어 검색')}
            className="ml-auto rounded-xl border border-gray-200 px-3 py-1.5 text-sm"
          />
        </div>

        <div className="mt-4">
          {isError ? (
            <QueryErrorFallback error={error as Error} onRetry={() => refetch()} />
          ) : isLoading ? (
            <p className="py-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></p>
          ) : rows.length === 0 ? (
            <EmptyState title="등록된 동의어가 없습니다" hint="위 [기본 약어·구어 사전 등재] 를 누르거나 직접 추가하세요" />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-400">
                  <th className="py-2"><T k="찾는 말" /></th>
                  <th><T k="종류" /></th>
                  <th><T k="이 말로도 찾기" /></th>
                  <th><T k="지목 코드" /></th>
                  <th><T k="상태" /></th>
                  <th className="text-right"><T k="처리" /></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50">
                    <td className="py-2 font-semibold text-gray-900">{r.term}</td>
                    <td className="text-gray-500"><T k={KIND_LABEL[r.kind] ?? r.kind} /></td>
                    <td className="text-gray-700">{r.expandsTo ?? <span className="text-gray-300">—</span>}</td>
                    <td className="font-mono text-gray-700">{r.code ?? <span className="font-sans text-gray-300"><T k="지목 없음" /></span>}</td>
                    <td>
                      <span className={`rounded border px-2 py-0.5 text-[11px] ${STATUS_STYLE[r.status]}`}>
                        <T k={STATUS_LABEL[r.status] ?? r.status} />
                      </span>
                      {r.note && <p className="mt-0.5 text-[10px] text-gray-400">{r.note}</p>}
                    </td>
                    <td className="text-right">
                      {r.status !== 'APPROVED' && (
                        <button
                          onClick={() => reviewMut.mutate({ id: r.id, decision: 'APPROVED' })}
                          disabled={reviewMut.isPending}
                          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
                        >
                          <T k="승인@버튼" />
                        </button>
                      )}
                      {r.status !== 'REJECTED' && (
                        <button
                          onClick={() => reviewMut.mutate({ id: r.id, decision: 'REJECTED' })}
                          disabled={reviewMut.isPending}
                          className="ml-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600 disabled:opacity-40"
                        >
                          <T k="반려@버튼" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
