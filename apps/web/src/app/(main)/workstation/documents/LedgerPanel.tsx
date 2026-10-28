'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { EmptyState, KDate, Money } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { kstToday } from '@/lib/kst-today';
import { kdate } from '@/lib/ui-settings';
import { toCsv } from './issuance-stages';

/**
 * 발급 대장(2026-10-10) — 기간을 고르고 본다 · CSV 로 내려받는다.
 * 🔴 대장은 상한(서버)으로 잘릴 수 있다 — 잘렸으면 화면과 CSV 모두 그렇다고 말한다(잘린 대장을 전체처럼 내보내지 않는다).
 */
type Row = { id: string; issueNo: string | null; type: string; copies: number; fee: number | null; issuedAt: string | null; patient: { mrn?: string; name: string } };
type Ledger = { items: Row[]; total: number; truncated: boolean };

const monthStart = () => `${kstToday().slice(0, 7)}-01`;

export function LedgerPanel({ typeLabel }: { typeLabel: Record<string, string> }) {
  const tAttr = useTAttr();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(kstToday());
  const valid = !!from && !!to && from <= to;
  const q = useQuery({
    queryKey: ['doc-ledger', from, to],
    enabled: valid,
    queryFn: async () => {
      // 병원 표준시 하루 — 서버가 종료일을 그날 끝까지 포함한다
      const qs = new URLSearchParams({ from: `${from}T00:00:00+09:00`, to: `${to}T00:00:00+09:00` });
      const r = await apiClient.get<{ data: Ledger }>(`/api/v1/staff/document-requests/ledger?${qs.toString()}`);
      const d = (r as { data?: unknown })?.data as Ledger | { data: Ledger };
      return ('items' in (d as object) ? d : (d as { data: Ledger }).data) as Ledger;
    },
  });

  const download = () => {
    if (!q.data) return;
    const header = [tAttr('발급번호'), tAttr('발급 시각'), tAttr('등록번호'), tAttr('환자'), tAttr('서류'), tAttr('부수'), tAttr('수수료')];
    const rows = q.data.items.map((r) => [r.issueNo, kdate(r.issuedAt, 'datetime', ''), r.patient.mrn ?? '', r.patient.name, tAttr(typeLabel[r.type] ?? r.type), r.copies, r.fee ?? '']);
    if (q.data.truncated) rows.push([tAttr('※ 상한으로 잘린 대장입니다'), `${q.data.items.length}/${q.data.total}`, '', '', '', '', '']);
    const url = URL.createObjectURL(new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `issuance-ledger_${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mb-4 rounded-xl border bg-white p-4" data-doc-ledger>
      <div className="flex flex-wrap items-end gap-2">
        <h3 className="text-sm font-bold text-gray-800"><T k="발급 대장" /></h3>
        <label className="text-xs text-gray-500"><T k="시작일" /><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ml-1 min-h-[36px] rounded border px-2 text-xs" data-doc-ledger-from /></label>
        <label className="text-xs text-gray-500"><T k="종료일" /><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ml-1 min-h-[36px] rounded border px-2 text-xs" data-doc-ledger-to /></label>
        <button type="button" onClick={download} disabled={!q.data || q.data.items.length === 0} data-doc-ledger-csv
          className="ml-auto min-h-[44px] rounded-lg border border-indigo-200 px-3 text-sm text-indigo-700 disabled:opacity-40"><T k="CSV 내려받기" /></button>
      </div>
      {!valid ? <p className="mt-2 text-xs text-rose-700" data-doc-ledger-invalid><T k="시작일이 종료일보다 늦습니다" /></p>
        : q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />
        : q.isLoading || !q.data ? <div className="mt-2 h-16 animate-pulse rounded-lg bg-gray-50" />
        : q.data.items.length === 0 ? <EmptyState icon="📒" title="이 기간에 발급한 서류가 없습니다" compact />
        : (
          <div className="mt-2 max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b text-left text-gray-500">
                <th className="py-1"><T k="발급번호" /></th><th><T k="발급 시각" /></th><th><T k="환자" /></th><th><T k="서류" /></th><th><T k="부수" /></th><th><T k="수수료" /></th>
              </tr></thead>
              <tbody>
                {q.data.items.map((r) => (
                  <tr key={r.id} className="border-b last:border-0" data-doc-ledger-row={r.id}>
                    <td className="py-1 font-mono">{r.issueNo ?? '—'}</td>
                    <td>{r.issuedAt ? <KDate value={r.issuedAt} mode="datetime" /> : '—'}</td>
                    <td>{r.patient.name} <span className="text-gray-500">{r.patient.mrn}</span></td>
                    <td><T k={typeLabel[r.type] ?? r.type} /></td>
                    <td>{r.copies}</td>
                    <td><Money value={r.fee} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {q.data.truncated && <p className="mt-1 text-[11px] text-amber-700" data-doc-ledger-truncated><Tf k="최근 {shown}건만 보입니다(전체 {total}건) — CSV 도 같습니다" params={{ shown: q.data.items.length, total: q.data.total }} /></p>}
          </div>
        )}
    </div>
  );
}
