'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate } from '@/components/ui/display';
import { COMMITTEE_AUTHORITIES, DECISION_DOMAINS, DECISION_MECHANISM_META, DECISION_SUBDOMAINS, decisionSubdomainOf, decisionSubdomainMeta } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';
import type { DecisionItem, DecisionLogEntry, DecisionsPayload } from '../types';
import { LAYER_TITLE_SHORT } from '../types';
import { DevApplyChip, LogEntryLine } from '../engine-parts';
import { Rich } from '../rich';
import { DecisionRegisterPrint, registerLines } from '../print-sheet';
import { usePrintIssue } from '@/components/print/usePrintIssue';

/**
 * 결정 대장(문서) — 2026-10-11 사용자 "이미 의사결정된 의사결정과정에 대해서도 로그 형태로 구성되고 문서 형태로 정리정돈".
 *
 * 🔴 이 문서가 지키는 것:
 *  · **실결정과 개발 시드를 섞지 않는다** — 시드 기록은 따로 묶고 "실결정 아님"을 표제에 적는다
 *  · 실결정은 **현재 효력(선택·근거·권한·집행·정한 설정)과 경과(이력)** 를 함께 — 지금 값만 적으면 어떻게 여기 왔는지가 사라진다
 *  · 이력은 원장 그대로(덧붙이기만) · 🔴 다 못 읽으면 못 읽었다고 적는다
 *  · 미결은 건수와 제목만 — 결정은 결정 화면에서 한다
 */
const LOG_PAGE = 500;
const LOG_MAX_PAGES = 10;

async function fetchAllLog(): Promise<{ rows: DecisionLogEntry[]; truncated: boolean; total: number }> {
  const rows: DecisionLogEntry[] = [];
  let cursor: string | null = null;
  let total = 0;
  for (let i = 0; i < LOG_MAX_PAGES; i++) {
    const r: { data: { items: DecisionLogEntry[]; total: number; nextCursor: string | null } } = await apiClient.get(
      `/api/v1/admin/decisions/log?limit=${LOG_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    rows.push(...r.data.items);
    total = r.data.total;
    cursor = r.data.nextCursor;
    if (!cursor) return { rows, truncated: false, total };
  }
  return { rows, truncated: true, total };
}

export default function DecisionRegisterPage() {
  const tAttr = useTAttr();
  const q = useQuery({ queryKey: ['human-decisions'], queryFn: () => apiClient.get<{ data: DecisionsPayload }>('/api/v1/admin/decisions') });
  const logQ = useQuery({ queryKey: ['decision-log-register'], queryFn: fetchAllLog });
  /** 🔴 인쇄 = 서버 발급(발급 원장 동결·진위확인 QR) — 발급 실패·해시 불일치면 인쇄하지 않는다(2026-10-12 기획 P0) */
  const lines = useMemo(() => registerLines(q.data?.data.items ?? []), [q.data]);
  const pr = usePrintIssue('DECISION_REGISTER', {}, lines, () => { void q.refetch(); });

  if (q.isError) return <div className="w-full px-6 py-6"><QueryErrorFallback error={q.error} onRetry={q.refetch} /></div>;
  if (q.isLoading || !q.data) return <div className="w-full px-6 py-6 text-sm text-gray-400"><T k="불러오는 중…" /></div>;
  const payload = q.data.data;
  const items = payload.items;
  const real = items.filter((i) => i.decided);
  const seeded = items.filter((i) => !i.decided && i.seeded);
  const open = items.filter((i) => !i.decided && !i.seeded);
  const domains = [...DECISION_DOMAINS.map((d) => ({ key: d.key as string, label: d.label })), { key: 'OTHER', label: '기타' }];
  const domOf = (i: DecisionItem) => i.domain ?? 'OTHER';
  /** 영역 안 세부 분류(2026-10-12 사용자 요청) — 영역을 모르면 지어내지 않고 '기타' 한 묶음 */
  const subOf = (i: DecisionItem) => (i.domain ? decisionSubdomainOf(i.key, i.track, i.layer, i.domain) : null) ?? 'OTHER';
  const subsOf = (rows: DecisionItem[]) => [...DECISION_SUBDOMAINS.map((x) => x.key), 'OTHER']
    .map((k) => ({ key: k, label: decisionSubdomainMeta(k)?.label ?? '기타', description: decisionSubdomainMeta(k)?.description ?? '', rows: rows.filter((i) => subOf(i) === k) }))
    .filter((g) => g.rows.length);
  /** 결정별 이력 — 오래된 것부터 */
  const logBy = new Map<string, DecisionLogEntry[]>();
  for (const e of [...(logQ.data?.rows ?? [])].reverse()) logBy.set(e.decisionKey, [...(logBy.get(e.decisionKey) ?? []), e]);
  const choiceLabel = (d: DecisionItem) => (d.record ? d.options.find((o) => o.value === d.record!.choice)?.label ?? d.record.choice : '—');
  const eng = payload.summary.engine;

  const pct = (n: number) => (items.length ? (n / items.length) * 100 : 0);
  const dot = (cls: string) => <span className={`h-1.5 w-1.5 rounded-full ${cls}`} aria-hidden />;
  /** 절 머리 — 번호·제목·건수(결정 화면 목록 머리와 같은 모양) */
  const sectionHead = (no: number, title: string, n: number, dotCls: string) => (
    <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 pb-2">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white tabular-nums">{no}</span>
      <span className="text-[16px] font-extrabold tracking-tight text-gray-900"><T k={title} /></span>
      <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 tabular-nums">{dot(dotCls)}{n}</span>
    </h2>
  );
  const subHead = (label: string, n: number) => (
    <h3 className="flex items-center gap-2 text-[13px] font-bold text-gray-800">
      <T k={label} /><span className="font-normal text-gray-400 tabular-nums">{n}</span>
    </h3>
  );
  /** 세부 분류 머리 — 영역 머리보다 한 단 낮게(왼쪽 색 막대) */
  const subSubHead = (g: { key: string; label: string; description: string; rows: DecisionItem[] }, tone: string) => (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]" data-register-sub={g.key}>
      <span className={`inline-block h-3 w-1 self-center rounded-full ${tone}`} aria-hidden />
      <span className="font-semibold text-gray-800"><T k={g.label} /></span>
      <span className="text-gray-400 tabular-nums">{g.rows.length}</span>
      {g.description && <span className="text-[11px] text-gray-400"><T k={g.description} /></span>}
    </p>
  );
  const docLink = (d: DecisionItem) => (
    <Link href={`/admin/decisions/${encodeURIComponent(d.key)}`} className="min-h-[36px] inline-flex items-center rounded-lg px-2 text-[12px] text-gray-500 hover:bg-gray-100 hover:text-gray-900 whitespace-nowrap print:hidden">
      <T k="설명자료" />
    </Link>
  );
  const sep = <span className="text-gray-300" aria-hidden>·</span>;

  return (
    <div className="w-full px-6 py-6 space-y-4 break-keep print:p-0" data-register-page>
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/admin/decisions" className="min-h-[44px] inline-flex items-center text-sm text-gray-500 hover:text-gray-700">← <T k="결정 등록부" />(2415)</Link>
        <button onClick={() => void pr.start()} disabled={pr.issuing} className="min-h-[44px] px-4 rounded-lg bg-indigo-600 text-white text-[12px] font-semibold shadow-sm hover:bg-indigo-700 disabled:opacity-60" data-print-issue-button>
          {pr.issuing ? <T k="발급 중…" /> : <T k="발급 후 인쇄" />}
        </button>
      </div>
      {pr.bar}

      <article className="space-y-6 leading-relaxed" data-register>
        {/* 머리 — 다른 탭과 같은 카드 */}
        <header className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-6 py-5 print:border-0 print:bg-none print:px-0">
          <p className="text-[11px] font-bold tracking-widest text-slate-400"><T k="결정 대장" /></p>
          <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-slate-900"><T k="중요 결정 — 현재 효력과 경과" /></h1>
          {/* 구성 막대 — 실결정·개발 시드·미결(분모 = 결정 대상 전체 · 0 이면 빈 막대) */}
          <div className="mt-4 flex h-2 w-full max-w-3xl overflow-hidden rounded-full bg-gray-200" aria-hidden>
            <span className="bg-emerald-500" style={{ width: `${pct(real.length)}%` }} />
            <span className="bg-violet-400" style={{ width: `${pct(seeded.length)}%` }} />
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[12px]" data-register-summary>
            <div className="flex items-baseline gap-1.5"><dt className="text-gray-500"><T k="결정 대상" /></dt><dd className="font-bold tabular-nums">{items.length}</dd></div>
            <div className="flex items-baseline gap-1.5"><dt className="inline-flex items-center gap-1 text-gray-500">{dot('bg-emerald-500')}<T k="실결정" /></dt><dd className="font-bold tabular-nums" data-register-real>{real.length}</dd></div>
            <div className="flex items-baseline gap-1.5"><dt className="inline-flex items-center gap-1 text-gray-500">{dot('bg-violet-400')}<T k="개발 시드(실결정 아님)" /></dt><dd className="font-bold tabular-nums" data-register-seeded>{seeded.length}</dd></div>
            <div className="flex items-baseline gap-1.5"><dt className="inline-flex items-center gap-1 text-gray-500">{dot('bg-gray-300')}<T k="미결" /></dt><dd className="font-bold tabular-nums">{open.length}</dd></div>
          </dl>
          <dl className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${eng?.reviewNeeded ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-gray-200 bg-white text-gray-600'}`}>
              <dt><T k="재검토 필요" /></dt><dd className="font-bold tabular-nums">{eng?.reviewNeeded ?? tAttr('확인 불가')}</dd>
            </div>
            <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${eng?.configDrift ? 'border-orange-200 bg-orange-50 text-orange-900' : 'border-gray-200 bg-white text-gray-600'}`}>
              <dt><T k="설정이 결정과 다름" /></dt><dd className="font-bold tabular-nums">{eng?.configDrift ?? '—'}</dd>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-gray-600">
              <dt><T k="설정 보호" /></dt><dd className="font-bold">{eng?.protectionMode ?? tAttr('확인 불가')}</dd>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-gray-600">
              <dt><T k="자료 기준 시각" /></dt><dd><KDate value={payload.measuredAt} mode="datetime" /></dd>
            </div>
          </dl>
          {logQ.isError && <p className="mt-3 rounded-lg bg-amber-50/80 px-3 py-1.5 text-[12px] text-amber-900" data-register-log-error><T k="결정 이력을 읽지 못했습니다 — 아래 경과는 비어 보여도 이력이 없다는 뜻이 아닙니다." /></p>}
          {logQ.data?.truncated && <p className="mt-3 rounded-lg bg-amber-50/80 px-3 py-1.5 text-[12px] text-amber-900" data-register-log-truncated><T k="이력이 많아 일부만 실었습니다" /> — {logQ.data.rows.length}/{logQ.data.total}</p>}
        </header>

        {/* 1. 실결정 — 현재 효력 + 경과 */}
        <section className="space-y-4" data-register-section="REAL">
          {sectionHead(1, '실결정 — 현재 효력과 경과', real.length, 'bg-emerald-500')}
          {real.length === 0 && (
            <p className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-3 text-[13px] text-gray-600" data-register-real-none>
              <T k="실결정이 아직 없습니다 — 지금 결정은 모두 개발 시드입니다(아래 2). 권한자 의사결정·위원회 의결이 있으면 여기 실립니다." />
            </p>
          )}
          {domains.map((dm) => {
            const rows = real.filter((i) => domOf(i) === dm.key);
            if (!rows.length) return null;
            return (
              <div key={dm.key} className="space-y-3">
                {subHead(dm.label, rows.length)}
                {subsOf(rows).map((g) => (
                <div key={g.key} className="space-y-2 pl-1 sm:pl-3">
                {subSubHead(g, 'bg-emerald-400')}
                <ul className="space-y-3">
                  {g.rows.map((d) => (
                    <li key={d.key} className="break-inside-avoid rounded-xl border border-gray-200/80 bg-white shadow-sm print:shadow-none" data-register-entry={d.key}>
                      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-gray-100 px-4 py-3">
                        <div className="min-w-[16rem] flex-1">
                          <p className="text-[14px] font-semibold leading-snug text-gray-900"><Rich text={d.title} /></p>
                          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-gray-500">
                            <T k={LAYER_TITLE_SHORT[d.layer]} />
                            {d.mechanism && <>{sep}<span data-register-mechanism><T k={DECISION_MECHANISM_META[d.mechanism].label} /></span></>}
                            {d.committee && <>{sep}<span className="text-teal-700">{COMMITTEE_AUTHORITIES[d.committee.lead].name}</span></>}
                            {d.record?.committeeDecision && <>{sep}<span className="tabular-nums">{d.record.committeeDecision.decisionNo}</span></>}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          {!!d.needsReview?.length && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900"><T k="재검토 필요" /></span>}
                          <DevApplyChip dev={d.devApply} />
                          <span className="max-w-[18rem] truncate rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-900" title={choiceLabel(d)}>{choiceLabel(d)}</span>
                          {docLink(d)}
                        </div>
                      </div>
                      <div className="grid gap-x-6 gap-y-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <dl className="grid grid-cols-[6.5rem_1fr] content-start gap-y-1 text-[12px]">
                          <dt className="text-gray-500"><T k="결정" /></dt><dd className="font-semibold">{choiceLabel(d)}</dd>
                          <dt className="text-gray-500"><T k="결정 주체" /></dt>
                          <dd><T k={LAYER_TITLE_SHORT[d.layer]} />{d.committee ? ` · ${COMMITTEE_AUTHORITIES[d.committee.lead].name}` : ''}{d.record?.committeeDecision ? ` · ${d.record.committeeDecision.decisionNo}` : ''}</dd>
                          <dt className="text-gray-500"><T k="근거" /></dt><dd>{d.record?.legalReviewRef}</dd>
                          <dt className="text-gray-500"><T k="권한" /></dt><dd>{d.record?.authorityClaim}</dd>
                          <dt className="text-gray-500"><T k="결정 시각" /></dt><dd><KDate value={d.record?.decidedAt} mode="datetime" /></dd>
                          <dt className="text-gray-500"><T k="집행" /></dt><dd>{d.enactment.label}{d.enactment.detail ? ` — ${d.enactment.detail}` : ''}</dd>
                          {d.settings === null && (<><dt className="text-gray-500"><T k="정한 설정" /></dt><dd className="text-amber-900"><T k="설정을 조회하지 못했습니다 — 바꾸는 설정이 없다는 뜻이 아닙니다." /></dd></>)}
                          {!!d.settings?.length && (<>
                            <dt className="text-gray-500"><T k="정한 설정" /></dt>
                            <dd className="space-y-0.5" data-register-settings>{d.settings.map((g) => (
                              <span key={g.key} className={`block font-mono text-[11px] ${g.matchesDecision === false ? 'text-orange-900 font-semibold' : 'text-gray-700'}`}>
                                {g.key}{g.decidedSets ? ` = ${JSON.stringify(g.decidedValue)}` : ''} ({tAttr('현재')} {JSON.stringify(g.current)}{g.matchesDecision === false ? ` · ${tAttr('결정과 다름')}` : ''})
                              </span>
                            ))}</dd>
                          </>)}
                          {!!d.needsReview?.length && (<>
                            <dt className="text-amber-900"><T k="재검토 필요" /></dt>
                            <dd className="text-amber-900">{d.needsReview.map((k) => items.find((x) => x.key === k)?.title ?? k).join(' · ')}</dd>
                          </>)}
                        </dl>
                        <div className="min-w-0 lg:border-l lg:border-gray-100 lg:pl-6">
                          <p className="mb-1 flex items-center gap-2 text-[11px] font-bold text-gray-600">
                            <T k="경과" /><span className="font-normal text-gray-400 tabular-nums">{(logBy.get(d.key) ?? []).length}</span>
                          </p>
                          <ol>{(logBy.get(d.key) ?? []).map((e) => <LogEntryLine key={e.id} e={e} items={items} />)}</ol>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                </div>
                ))}
              </div>
            );
          })}
        </section>

        {/* 2. 개발 시드 — 실결정 아님 */}
        <section className="space-y-3" data-register-section="SEED">
          {sectionHead(2, '개발 시드 — 실결정 아님', seeded.length, 'bg-violet-400')}
          <p className="rounded-lg bg-violet-50/70 px-3 py-1.5 text-[12px] text-violet-900"><T k="개발·리허설용으로 정해 둔 값입니다. 결정 수·선행 조건·개원 준비에 세지 않습니다. 결정별 경과는 각 결정 문서에 있습니다." /></p>
          <div className="space-y-4">
            {domains.map((dm) => {
              const rows = seeded.filter((i) => domOf(i) === dm.key);
              if (!rows.length) return null;
              return (
                <div key={dm.key} className="overflow-hidden rounded-xl border border-gray-200/80 bg-white" data-register-seed-domain={dm.key}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-100 bg-gray-50/70 px-4 py-2.5">
                    {subHead(dm.label, rows.length)}
                    <span className="flex flex-wrap gap-1.5 text-[11px] text-gray-500">
                      {subsOf(rows).map((g) => <span key={g.key} className="rounded-full border border-gray-200 bg-white px-2 py-0.5"><T k={g.label} /> <span className="tabular-nums">{g.rows.length}</span></span>)}
                    </span>
                  </div>
                  {subsOf(rows).map((g) => (
                  <div key={g.key} className="break-inside-avoid border-t border-gray-100 first:border-t-0">
                  <div className="px-4 pt-3 pb-1">{subSubHead(g, 'bg-violet-400')}</div>
                  <div className="overflow-x-auto">
                  {/* 🔴 칸 너비 고정 — 칸이 좁아져 글자가 한 자씩 세로로 꺾이던 것(2026-10-12 사용자 화면) */}
                  <table className="w-full min-w-[56rem] table-fixed text-[12px]" data-register-seed-table>
                    <colgroup><col className="w-[36%]" /><col className="w-[26%]" /><col className="w-[18%]" /><col className="w-[14%]" /><col className="w-[6%]" /></colgroup>
                    <thead><tr className="text-left text-[11px] text-gray-500 whitespace-nowrap"><th className="px-4 py-1.5 font-medium"><T k="결정" /></th><th className="py-1.5 pr-3 font-medium"><T k="시드 선택" /></th><th className="py-1.5 pr-3 font-medium"><T k="결정 방식" /></th><th className="py-1.5 pr-3 font-medium"><T k="주관" /></th><th className="px-4 py-1.5 text-right font-medium"><T k="이력" /></th></tr></thead>
                    <tbody>
                      {g.rows.map((d) => (
                        <tr key={d.key} className="border-t border-gray-100 align-top hover:bg-gray-50/60" data-register-seed-row={d.key}>
                          <td className="px-4 py-1.5"><Link href={`/admin/decisions/${encodeURIComponent(d.key)}`} className="font-medium text-gray-900 hover:underline"><Rich text={d.title} /></Link></td>
                          <td className="py-1.5 pr-3"><span className="inline-block rounded-lg bg-violet-50 px-2 py-0.5 text-[11px] text-violet-900">{choiceLabel(d)}</span></td>
                          <td className="py-1.5 pr-3 text-gray-600">{d.mechanism ? <T k={DECISION_MECHANISM_META[d.mechanism].label} /> : '—'}</td>
                          <td className="py-1.5 pr-3 text-gray-600">{d.committee ? COMMITTEE_AUTHORITIES[d.committee.lead].name : <T k={LAYER_TITLE_SHORT[d.layer]} />}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums text-gray-500">{d.logCount ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                  </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>

        {/* 3. 미결 — 건수와 제목만(결정은 결정 화면에서) */}
        <section className="space-y-3" data-register-section="OPEN">
          {sectionHead(3, '미결', open.length, 'bg-gray-300')}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {domains.map((dm) => {
              const rows = open.filter((i) => domOf(i) === dm.key);
              if (!rows.length) return null;
              return (
                <div key={dm.key} className="break-inside-avoid rounded-xl border border-gray-200/80 bg-white px-4 py-3">
                  {subHead(dm.label, rows.length)}
                  {subsOf(rows).map((g) => (
                  <div key={g.key} className="mt-3">
                  {subSubHead({ ...g, description: '' }, 'bg-gray-300')}
                  <ul className="mt-1 space-y-1 pl-3 text-[12px] text-gray-700">
                    {g.rows.map((d) => (
                      <li key={d.key} className="flex items-start gap-2" data-register-open-row={d.key}>
                        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" aria-hidden />
                        <Link href={`/admin/decisions/${encodeURIComponent(d.key)}`} className="hover:underline"><Rich text={d.title} /></Link>
                      </li>
                    ))}
                  </ul>
                  </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>

        <footer className="rounded-xl border border-gray-200 bg-gray-50/70 px-4 py-3 text-[11px] text-gray-500 print:bg-transparent">
          <p>{payload.caveat}</p>
          <p className="mt-1"><T k="이력은 덧붙이기만 합니다 — 고치거나 지우지 않습니다. 원장 시작(2026-10-11) 전 기록은 그때 남아 있던 한 줄씩만 옮겼습니다." /></p>
        </footer>
      </article>
      {/* 🔴 인쇄는 화면을 찍지 않고 인쇄 전용 문서로(2026-10-12 — 종전엔 빈 종이) */}
      <DecisionRegisterPrint items={items} measuredAt={payload.measuredAt} {...pr.state} />
    </div>
  );
}
