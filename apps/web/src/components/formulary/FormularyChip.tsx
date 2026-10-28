'use client';

/**
 * 세트·템플릿 편집기의 원내 처방집 상태 표시(2026-10-21 임상 규칙·템플릿 P4 A8).
 *
 * 🔴 종전 편집기는 처방집을 몰랐다 — 처방집 밖 약을 세트에 넣어도 표시가 없고, 적용 순간 처방 게이트(경고)에서야 드러났다.
 *    판정은 서버 `formulary/status-of`(처방 게이트와 같은 규칙) — 화면이 따로 판정하지 않는다. 막지는 않는다(처방집 결정 몫).
 *  · 코드가 없는 항목은 대조할 수 없다 — 칩을 그리지 않는다(미해석 표시는 따로 있다)
 *  · 조회 실패는 "확인 불가"(등재로도 미등재로도 말하지 않는다)
 */
import { useQueries } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { T } from '@/components/ui/i18n-text';

export type FormularyDomainKey = 'MEDICATION' | 'LAB' | 'IMAGING';
type StatusRes = { domain: string; mode: 'OFF' | 'WARN' | 'BLOCK'; enforceable: boolean; statuses: Record<string, 'LISTED' | 'SUSPENDED' | 'NOT_LISTED'> };
export type FormularyLookup = (domain: FormularyDomainKey | null, codeId: string | null | undefined) =>
  { state: 'NONE' } | { state: 'UNKNOWN' } | { state: 'LOADING' } | { state: 'KNOWN'; status: 'LISTED' | 'SUSPENDED' | 'NOT_LISTED'; mode: 'OFF' | 'WARN' | 'BLOCK' };

const unwrap = (r: unknown): StatusRes | undefined => ((r as { data?: { data?: StatusRes } })?.data?.data ?? (r as { data?: StatusRes })?.data);

/** 영역별로 코드 묶음을 한 번씩 조회한다 */
export function useFormularyStatus(entries: Array<{ domain: FormularyDomainKey | null; codeId?: string | null }>): { lookup: FormularyLookup; counts: { notListed: number; suspended: number; unknown: number } } {
  const byDomain = new Map<FormularyDomainKey, string[]>();
  for (const e of entries) {
    if (!e.domain || !e.codeId) continue;
    const list = byDomain.get(e.domain) ?? [];
    if (!list.includes(e.codeId)) list.push(e.codeId);
    byDomain.set(e.domain, list);
  }
  const domains = [...byDomain.keys()].sort();
  const qs = useQueries({
    queries: domains.map((d) => ({
      queryKey: ['formulary-status-of', d, [...(byDomain.get(d) ?? [])].sort().join(',')],
      queryFn: () => apiClient.post('/api/v1/formulary/status-of', { domain: d, codeIds: (byDomain.get(d) ?? []).slice(0, 200) }),
      staleTime: 60_000,
    })),
  });
  const result = new Map(domains.map((d, i) => [d, qs[i]]));
  const lookup: FormularyLookup = (domain, codeId) => {
    if (!domain || !codeId) return { state: 'NONE' };
    const q = result.get(domain);
    if (!q || q.isLoading) return { state: 'LOADING' };
    const r = unwrap(q.data);
    if (q.isError || !r || !r.statuses[codeId]) return { state: 'UNKNOWN' };
    return { state: 'KNOWN', status: r.statuses[codeId], mode: r.mode };
  };
  const counts = { notListed: 0, suspended: 0, unknown: 0 };
  for (const e of entries) {
    const l = lookup(e.domain, e.codeId);
    if (l.state === 'UNKNOWN') counts.unknown += 1;
    else if (l.state === 'KNOWN' && l.status === 'NOT_LISTED') counts.notListed += 1;
    else if (l.state === 'KNOWN' && l.status === 'SUSPENDED') counts.suspended += 1;
  }
  return { lookup, counts };
}

const MODE_NOTE: Record<'OFF' | 'WARN' | 'BLOCK', string> = { OFF: '시행 꺼짐', WARN: '처방 때 경고', BLOCK: '처방 때 차단' };

export function FormularyChip({ r }: { r: ReturnType<FormularyLookup> }) {
  if (r.state === 'NONE' || r.state === 'LOADING') return null;
  if (r.state === 'UNKNOWN') return <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600" data-formulary="UNKNOWN"><T k="처방집 확인 불가" /></span>;
  if (r.status === 'LISTED') return <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700" data-formulary="LISTED"><T k="처방집 등재" /></span>;
  const cls = r.status === 'SUSPENDED' ? 'bg-red-50 text-red-700' : r.mode === 'OFF' ? 'bg-gray-100 text-gray-600' : 'bg-amber-50 text-amber-800';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] ${cls}`} data-formulary={r.status} data-formulary-mode={r.mode}>
      <T k={r.status === 'SUSPENDED' ? '처방집 사용중지' : '처방집 미등재'} /> · <T k={MODE_NOTE[r.mode]} />
    </span>
  );
}

/** 편집기 머리 요약 — 미등재·사용중지·확인 불가 수(없으면 그리지 않는다) */
export function FormularySummary({ counts }: { counts: { notListed: number; suspended: number; unknown: number } }) {
  if (!counts.notListed && !counts.suspended && !counts.unknown) return null;
  return (
    <p className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-900" data-formulary-summary>
      <T k="원내 처방집" />: {counts.notListed > 0 && <><T k="미등재" /> {counts.notListed} </>}
      {counts.suspended > 0 && <><T k="사용중지" /> {counts.suspended} </>}
      {counts.unknown > 0 && <><T k="확인 불가" /> {counts.unknown}</>}
    </p>
  );
}
