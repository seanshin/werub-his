'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { DECISION_DOMAINS, DECISION_MECHANISM_META, decisionSubdomainMeta, decisionSubdomainOf, sortDecisionsForRegister } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { sanctionedPrint } from '@/components/print/PrintGuard';
import { PrintDoc, CheckCell, breakKey, useDocHash } from '@/components/print/PrintSheet';
import { T, useTAttr } from '@/components/ui/i18n-text';
import type { DecisionItem, DecisionsPayload } from '../types';
import { LAYER_TITLE_SHORT } from '../types';
import { Rich } from '../rich';
import { goLiveDecisionOrder, PRINT_CHECK_TARGETS } from './model';

/**
 * 사람 확인 문서(2026-10-12 기획 `decision-print-remaining` P3) — 시스템이 판정하지 못하는 것을 사람이 종이로 확인한다.
 *  ① 개시 전 필수 의사결정 순서표(G5) — 선행 관계 순서 · 개발 반영 여부 · 🔴 리드타임은 사람이 적는 빈 칸(지어내지 않는다)
 *  ② 세부 분류 배치 확인표(G9) — 18 분류 배치는 개발이 고른 것이다 · 맞음 ☐ / 옮길 분류(사람이 적는다)
 *  ③ 인쇄본 출력 점검표(G10) — 실제 프린터·휴대폰 스캔으로만 확인할 수 있는 것
 * 셋 다 발급 원장에 오르지 않는 점검 양식이다(발급 대상 아님 — QR 없음).
 */
type Tab = 'ORDER' | 'SUBDOMAIN' | 'PRINT';
const TABS: Array<{ k: Tab; label: string }> = [
  { k: 'ORDER', label: '개시 전 필수 의사결정 순서표' },
  { k: 'SUBDOMAIN', label: '세부 분류 배치 확인표' },
  { k: 'PRINT', label: '인쇄본 출력 점검표' },
];

const STATE = (i: DecisionItem) => (i.decided ? '실결정' : i.seeded ? '시드' : '미결');

export default function DecisionChecksPage() {
  const tAttr = useTAttr();
  const [tab, setTab] = useState<Tab>('ORDER');
  const q = useQuery({ queryKey: ['human-decisions'], queryFn: () => apiClient.get<{ data: DecisionsPayload }>('/api/v1/admin/decisions') });
  const items = q.data?.data.items ?? [];
  const order = useMemo(() => goLiveDecisionOrder(items), [items]);
  const bySub = useMemo(() => {
    const sorted = sortDecisionsForRegister(items);
    const groups: Array<{ dom: string; sub: string; rows: DecisionItem[] }> = [];
    for (const i of sorted) {
      const dom = i.domain ? DECISION_DOMAINS.find((d) => d.key === i.domain)?.label ?? '기타' : '기타';
      const sub = (i.domain ? decisionSubdomainMeta(decisionSubdomainOf(i.key, i.track, i.layer, i.domain) ?? '')?.label : null) ?? '기타';
      const last = groups[groups.length - 1];
      if (last && last.dom === dom && last.sub === sub) last.rows.push(i); else groups.push({ dom, sub, rows: [i] });
    }
    return groups;
  }, [items]);
  const text = tab === 'ORDER' ? order.map((o) => `${o.item.key}|${o.step ?? ''}`).join('\n')
    : tab === 'SUBDOMAIN' ? bySub.flatMap((g) => g.rows.map((r) => `${g.sub}|${r.key}`)).join('\n')
    : PRINT_CHECK_TARGETS.map((t) => t.name).join('\n');
  const hash = useDocHash(text);

  if (q.isError) return <div className="w-full px-6 py-6"><QueryErrorFallback error={q.error} onRetry={q.refetch} /></div>;
  if (q.isLoading || !q.data) return <div className="w-full px-6 py-6 text-sm text-gray-400"><T k="불러오는 중…" /></div>;
  const devApply = (i: DecisionItem) => i.mechanism === 'DEV_APPLY';

  return (
    <div className="w-full space-y-4 px-6 py-6 break-keep" data-checks-page>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/decisions" className="min-h-[44px] inline-flex items-center text-sm text-gray-500 hover:text-gray-700">← <T k="결정 등록부" />(2415)</Link>
        <button type="button" onClick={() => sanctionedPrint(`checks:${tab}`)} className="min-h-[44px] rounded-lg bg-gray-900 px-4 text-[12px] font-semibold text-white" data-checks-print={tab}><T k="이 문서 인쇄" /></button>
      </div>
      <header className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-6 py-5">
        <p className="text-[11px] font-bold tracking-widest text-slate-400"><T k="사람 확인 문서" /></p>
        <h1 className="mt-1 text-[20px] font-extrabold text-gray-900"><T k="시스템이 판정하지 못하는 것을 사람이 확인한다" /></h1>
        <p className="mt-1 text-[12px] text-gray-500"><T k="세 문서 모두 점검 양식입니다 — 발급 원장에 오르지 않고 QR 이 없습니다. 확인 칸은 사람이 체크·서명합니다." /></p>
      </header>
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.k} type="button" role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}
            className={`min-h-[40px] rounded-lg px-3 text-[12px] font-semibold ${tab === t.k ? 'bg-slate-900 text-white' : 'border border-gray-200 bg-white text-gray-700'}`} data-checks-tab={t.k}>
            <T k={t.label} />
          </button>
        ))}
      </div>

      {tab === 'ORDER' && (
        <section className="space-y-2" data-checks-order>
          <p className="text-[12px] text-gray-600"><T k="선행 결정이 먼저입니다. 같은 차례 안에서는 허가권자 → 위원회 → 직원 순입니다. 리드타임은 시스템이 모릅니다 — 사람이 적습니다." /></p>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-[12px]">
              <thead className="bg-gray-50 text-left text-gray-500"><tr>
                <th className="px-3 py-2"><T k="차례" /></th><th className="px-3 py-2"><T k="결정" /></th><th className="px-3 py-2"><T k="층" /></th>
                <th className="px-3 py-2"><T k="개발 반영" /></th><th className="px-3 py-2"><T k="선행" /></th><th className="px-3 py-2"><T k="상태" /></th>
              </tr></thead>
              <tbody>
                {order.map((o) => (
                  <tr key={o.item.key} className="border-t border-gray-100" data-order-row={o.item.key} data-order-step={o.step ?? 'CYCLE'}>
                    <td className="px-3 py-2 tabular-nums">{o.step ?? <span className="text-rose-700"><T k="순환" /></span>}</td>
                    <td className="px-3 py-2"><Rich text={o.item.title} /><br /><span className="font-mono text-[10px] text-gray-400">{o.item.key}</span></td>
                    <td className="px-3 py-2"><T k={LAYER_TITLE_SHORT[o.item.layer]} /></td>
                    <td className="px-3 py-2">{devApply(o.item) ? <T k="개발 반영" /> : <T k={o.item.mechanism ? DECISION_MECHANISM_META[o.item.mechanism].label : '—'} />}</td>
                    <td className="px-3 py-2 font-mono text-[10px]">{[...o.deps, ...o.outsideDeps.map((d) => `${d}(${tAttr('필수 밖')})`)].join(', ') || '—'}</td>
                    <td className="px-3 py-2"><T k={STATE(o.item)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {tab === 'SUBDOMAIN' && (
        <section className="space-y-3" data-checks-subdomain>
          <p className="text-[12px] text-gray-600"><T k="세부 분류 18의 배치는 개발이 고른 것입니다. 맞지 않으면 옮길 분류를 적어 주십시오 — 예외 표 한 줄로 옮깁니다." /></p>
          {bySub.map((g) => (
            <div key={`${g.dom}/${g.sub}`} className="rounded-xl border border-gray-200 bg-white px-4 py-3" data-sub-group={g.sub}>
              <p className="text-[12px] font-bold text-gray-800">{tAttr(g.dom)} › {tAttr(g.sub)} <span className="font-normal text-gray-400">{g.rows.length}</span></p>
              <ul className="mt-1 space-y-0.5 text-[12px] text-gray-700">{g.rows.map((r) => <li key={r.key}><Rich text={r.title} /> <span className="font-mono text-[10px] text-gray-400">{r.key}</span></li>)}</ul>
            </div>
          ))}
        </section>
      )}
      {tab === 'PRINT' && (
        <section className="space-y-2" data-checks-print-list>
          <p className="text-[12px] text-gray-600"><T k="실제 프린터로 찍고 휴대폰으로 스캔해야만 알 수 있습니다 — 쪽 넘김·QR(여백) 잘림·스캔·글자 깨짐을 문서마다 확인합니다." /></p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {PRINT_CHECK_TARGETS.map((t) => (
              <li key={t.name} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-[12px]" data-print-target={t.name}>
                <b><T k={t.name} /></b> <span className="font-mono text-[10px] text-gray-400">{t.where}</span><br /><span className="text-gray-500"><T k={t.issue} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 인쇄 — 고른 문서 하나만 인쇄 전용 문서로 그린다(점검 양식 · 발급 대상 아님) */}
      {tab === 'ORDER' && (
        <PrintDoc attr="CHECKS-ORDER" kind={<T k="사람 확인 문서" />} code="HIS-GOLIVE-DECISION-ORDER v1" title={<T k="개시 전 필수 의사결정 순서표" />}
          subtitle={<><T k="대상" /> {order.length}</>} qr={{}} hash={hash} unissued="NOT_ISSUED"
          legend={<T k="차례: 선행 결정이 먼저 · 리드타임·담당·목표일은 사람이 적습니다 · 확인 칸은 검토자가 체크·서명합니다" />}>
          <table data-print-order>
            <colgroup><col style={{ width: '5%' }} /><col style={{ width: '33%' }} /><col style={{ width: '9%' }} /><col style={{ width: '9%' }} /><col style={{ width: '16%' }} /><col style={{ width: '7%' }} /><col style={{ width: '9%' }} /><col style={{ width: '12%' }} /></colgroup>
            <thead><tr><th><T k="차례" /></th><th><T k="결정 · 키" /></th><th><T k="층" /></th><th><T k="개발 반영" /></th><th><T k="선행" /></th><th><T k="상태" /></th><th><T k="리드타임" /></th><th><T k="확인" /></th></tr></thead>
            <tbody>
              {order.map((o) => (
                <tr key={o.item.key} data-print-row={o.item.key}>
                  <td>{o.step ?? <T k="순환" />}</td>
                  <td>{o.item.title.replace(/\*\*/g, '')}<br /><span className="dps-key">{breakKey(o.item.key)}</span></td>
                  <td><T k={LAYER_TITLE_SHORT[o.item.layer]} /></td>
                  <td>{devApply(o.item) ? '○' : '—'}</td>
                  <td><span className="dps-key">{[...o.deps, ...o.outsideDeps].map((d) => breakKey(d)).flatMap((x, i) => (i ? [', ', x] : [x]))}</span></td>
                  <td><T k={STATE(o.item)} /></td>
                  <td data-print-leadtime />
                  <td data-print-check><CheckCell /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </PrintDoc>
      )}
      {tab === 'SUBDOMAIN' && (
        <PrintDoc attr="CHECKS-SUBDOMAIN" kind={<T k="사람 확인 문서" />} code="HIS-DECISION-SUBDOMAIN-CHECK v1" title={<T k="세부 분류 배치 확인표" />}
          subtitle={<><T k="결정" /> {items.length}</>} qr={{}} hash={hash} unissued="NOT_ISSUED"
          legend={<T k="맞으면 ☐ 체크 · 맞지 않으면 옮길 분류를 적습니다(예외 표 한 줄로 옮깁니다)" />}>
          <table data-print-subdomain>
            <colgroup><col style={{ width: '58%' }} /><col style={{ width: '22%' }} /><col style={{ width: '20%' }} /></colgroup>
            <thead><tr><th><T k="결정 · 키" /></th><th><T k="옮길 분류" /></th><th><T k="맞음" /></th></tr></thead>
            <tbody>
              {bySub.flatMap((g) => [
                <tr key={`g:${g.dom}/${g.sub}`} className="dps-group" data-print-group={g.sub}><td colSpan={3}>{tAttr(g.dom)} › {tAttr(g.sub)} ({g.rows.length})</td></tr>,
                ...g.rows.map((r) => (
                  <tr key={r.key} data-print-row={r.key}>
                    <td>{r.title.replace(/\*\*/g, '')}<br /><span className="dps-key">{breakKey(r.key)}</span></td>
                    <td />
                    <td data-print-check><CheckCell /></td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </PrintDoc>
      )}
      {tab === 'PRINT' && (
        <PrintDoc attr="CHECKS-PRINT" kind={<T k="사람 확인 문서" />} code="HIS-PRINT-CHECKLIST v1" title={<T k="인쇄본 출력 점검표" />}
          subtitle={<><T k="대상" /> {PRINT_CHECK_TARGETS.length}</>} qr={{}} hash={hash} unissued="NOT_ISSUED" landscape
          legend={<T k="실제 프린터로 찍고 휴대폰으로 스캔해 확인합니다 · 서버 발급 문서는 QR 을 찍어 진위확인 화면이 열리는지까지" />}>
          <table data-print-checklist>
            <colgroup><col style={{ width: '20%' }} /><col style={{ width: '22%' }} /><col style={{ width: '18%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} /></colgroup>
            <thead><tr><th><T k="인쇄본" /></th><th><T k="화면" /></th><th><T k="진위확인" /></th><th><T k="쪽 넘김" /></th><th><T k="QR·여백 잘림 없음" /></th><th><T k="휴대폰 스캔" /></th><th><T k="글자 깨짐 없음" /></th><th><T k="비고" /></th></tr></thead>
            <tbody>
              {PRINT_CHECK_TARGETS.map((t) => (
                <tr key={t.name} data-print-row={t.name}>
                  <td><T k={t.name} /></td><td><span className="dps-key">{t.where}</span></td><td><T k={t.issue} /></td>
                  <td>☐</td><td>☐</td><td>☐</td><td>☐</td><td />
                </tr>
              ))}
            </tbody>
          </table>
        </PrintDoc>
      )}
    </div>
  );
}
