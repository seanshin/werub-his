'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { COMMITTEE_AUTHORITIES, COMMITTEE_DECISION_STAGES, DIRECT_DECISION_PATH } from '@hospital-run/shared';
import { KDate } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import type { DecisionItem } from './types';
import { GO_LIVE_LABEL, LAYER_TITLE_SHORT, PATH_LABEL, STAGE_NO } from './types';
import { Rich } from './rich';
import { DecisionImpactPreview, DecisionTimeline, ImplementedChoiceNotice, MechanismBadge, MechanismExplain, SettingDetailTable } from './engine-parts';

/**
 * 의사결정 작업대(2026-10-11 사용자 "화면을 충분하게 세련되게 · 좌우 공간을 충분히 · 주요 설명자료와 의사결정 과정이 한눈에").
 *
 *   머리   — 제목 · 층/방식/주관 위원회/개시 전 필수/지금 상태 배지 · 문서 링크 · 닫기
 *   과정   — 의사결정 단계(위원회 ①~⑦ · 다른 층 검토→의사결정→집행) 지금 위치 · 선행 결정 충족 여부 · 열리는 후속 결정 수
 *   본문 3열 — ① 핵심 설명(지금 상태·왜·법적 검토·막는 것/여는 것·남는 일) ② 선택지 비교(고르는 곳 · 정하는 설정 값 · 영향) ③ 의사결정 입력
 *   바닥   — 늘 보이는 의사결정 단추와 빠진 입력 안내
 * 🔴 설명 문구는 등록부·서버가 준 그대로(여기서 새로 지어내지 않는다) — 전체 문서는 설명자료 페이지(같은 등록부 필드).
 */

/** 머리 — 이 결정이 무엇이고 지금 어디에 있는가 */
export function DecideHeader({ item, onClose }: { item: DecisionItem; onClose: () => void }) {
  const tAttr = useTAttr();
  const state = item.decided ? 'DECIDED' : item.seeded ? 'SEEDED' : 'OPEN';
  return (
    <header className="shrink-0 border-b border-gray-200 bg-white px-6 py-4" data-decide-header>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold tracking-wide text-gray-400">
            {item.layer === 'LICENSE_HOLDER' ? <T k="허가 결정" /> : item.layer === 'INTERNAL_COMMITTEE' ? <T k="위원회 결정" /> : <T k="업무 판단" />}
            <span className="ml-2 font-mono font-normal">{item.key}</span>
          </p>
          <h2 className="mt-0.5 text-xl font-extrabold leading-snug text-gray-900"><Rich text={item.title} /></h2>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]" data-decide-badges>
            <span className="px-2 py-0.5 rounded-full border border-gray-300 bg-white text-gray-700"><T k={LAYER_TITLE_SHORT[item.layer]} /></span>
            <MechanismBadge mechanism={item.mechanism} />
            {item.committee && (
              <span className="px-2 py-0.5 rounded-full border border-teal-200 bg-teal-50 text-teal-900">
                {COMMITTEE_AUTHORITIES[item.committee.lead].name}{item.committee.joint.length ? ` +${item.committee.joint.length}` : ''}
              </span>
            )}
            {item.goLive === 'REQUIRED_BEFORE' && <span className="px-2 py-0.5 rounded-full border border-rose-200 bg-rose-50 text-rose-800"><T k={GO_LIVE_LABEL.REQUIRED_BEFORE} /></span>}
            <span className={`px-2 py-0.5 rounded-full border ${state === 'DECIDED' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : state === 'SEEDED' ? 'border-violet-300 bg-violet-50 text-violet-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`} data-decide-state={state}>
              {state === 'DECIDED' ? <><T k="결정됨" /> · <KDate value={item.record?.decidedAt} /></> : state === 'SEEDED' ? <T k="개발 시드(실결정 아님)" /> : <T k="미결" />}
            </span>
            {!!item.needsReview?.length && <span className="px-2 py-0.5 rounded-full border border-amber-400 bg-amber-100 text-amber-900"><T k="재검토 필요" /></span>}
            <span className="text-gray-500">· <T k="허가권" /> {item.authority}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={`/admin/decisions/${encodeURIComponent(item.key)}`} target="_blank" rel="noopener" data-decide-briefing-link
            className="min-h-[40px] inline-flex items-center px-3 rounded-lg border border-gray-300 text-[12px] text-gray-700 hover:bg-gray-50">
            <T k="설명자료 전체·인쇄" /> ↗
          </Link>
          <button type="button" onClick={onClose} aria-label={tAttr('닫기')} className="min-h-[40px] min-w-[40px] rounded-lg text-xl text-gray-500 hover:bg-gray-100">×</button>
        </div>
      </div>
    </header>
  );
}

/** 과정 — 단계 띠 + 선행 결정 + 열리는 후속 */
export function DecideProcess({ item, items }: { item: DecisionItem; items: DecisionItem[] }) {
  const committee = item.layer === 'INTERNAL_COMMITTEE';
  const stage = item.stage?.stage ?? 'PREPARE';
  const steps = committee
    ? COMMITTEE_DECISION_STAGES.map((s, i) => ({ key: s.key, label: `${STAGE_NO[i]} ${s.label}`, desc: s.description, next: s.nextAction }))
    : DIRECT_DECISION_PATH.map((s, i) => ({ key: ['PREPARE', 'RECORDED', 'ENACTED'][i], label: s.label, desc: '', next: '' }));
  const cur = Math.max(0, steps.findIndex((s) => s.key === stage));
  const titleOf = (k: string) => items.find((x) => x.key === k)?.title ?? k;
  const blocked = new Map(item.blockedBy.map((b) => [b.key, b.reason]));
  const deps = item.dependsOn ?? [];
  return (
    <section className="shrink-0 border-b border-gray-200 bg-gradient-to-r from-indigo-50/80 via-white to-white px-6 py-3" data-decide-process aria-label="의사결정 과정">
      <ol className="flex flex-wrap items-stretch gap-1.5">
        {steps.map((s, i) => {
          const done = i < cur; const now = i === cur; const verify = s.key === 'VERIFIED';
          return (
            <li key={s.key} className="flex items-center gap-1.5" data-decide-step={s.key} data-decide-step-state={now ? 'NOW' : done ? 'DONE' : 'TODO'}>
              <span title={s.desc} className={`rounded-lg border px-2.5 py-1 text-[12px] ${now ? 'border-indigo-700 bg-indigo-700 text-white font-bold shadow-sm' : done ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-500'}`}>
                {done ? '✓ ' : ''}<T k={s.label} />{verify && <span className="ml-1 text-[10px] opacity-80">(<T k="사람 확인" />)</span>}
              </span>
              {i < steps.length - 1 && <span className="text-gray-300" aria-hidden>→</span>}
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        {committee && steps[cur]?.next && <span className="text-indigo-900" data-decide-next><b><T k="다음 할 일" /></b> · <T k={steps[cur].next} /></span>}
        {deps.length > 0 && (
          <span className="flex flex-wrap items-center gap-1" data-decide-deps>
            <b className="text-gray-700"><T k="선행 결정" /></b>
            {deps.map((k) => (
              <span key={k} className={`px-1.5 py-0.5 rounded border ${blocked.has(k) ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-800'}`} data-decide-dep={k} title={blocked.get(k) ?? ''}>
                {blocked.has(k) ? '⏳' : '✓'} {titleOf(k)}
              </span>
            ))}
          </span>
        )}
        {item.unlocks.length > 0 && <span className="text-gray-700" data-decide-unlocks><b><T k="이 결정이 여는 후속 결정" /></b> {item.unlocks.length}<T k="건" /></span>}
      </div>
    </section>
  );
}

function Card({ title, tone = 'plain', children, attr }: { title: string; tone?: 'plain' | 'warn' | 'info'; children: ReactNode; attr?: string }) {
  const toneCls = tone === 'warn' ? 'border-amber-200 bg-amber-50/70' : tone === 'info' ? 'border-indigo-100 bg-indigo-50/40' : 'border-gray-200 bg-white';
  return (
    <section className={`rounded-xl border px-4 py-3 ${toneCls}`} {...(attr ? { [`data-decide-card`]: attr } : {})}>
      <h3 className="text-[12px] font-bold text-gray-800 mb-1.5"><T k={title} /></h3>
      <div className="text-[13px] leading-relaxed text-gray-800">{children}</div>
    </section>
  );
}

/** ① 핵심 설명 — 읽고 나서 고른다(등록부 필드 그대로) */
export function DecideSummary({ item }: { item: DecisionItem }) {
  return (
    <div className="space-y-3" data-decide-summary>
      <Card title="현재 상황(의사결정 이전)" tone="info" attr="status"><Rich text={item.statusQuo} />
        <p className="mt-1 text-[11px] text-gray-500">🔴 <T k="결정하지 않는 것도 결정입니다 — 위 상태가 계속됩니다." /></p>
      </Card>
      <Card title="왜 결정이 필요한가" attr="why"><Rich text={item.why} /></Card>
      {item.legalReview.length > 0 && (
        <Card title={item.layer === 'LICENSE_HOLDER' ? '검토를 요청하는 법적 항목' : '관련 법적 항목'} attr="legal">
          <ol className="list-decimal pl-4 space-y-0.5">{item.legalReview.map((l, i) => <li key={i}><Rich text={l} /></li>)}</ol>
        </Card>
      )}
      {(item.blocks || !!item.opens?.length || item.unlocks.length > 0) && (
        <Card title="이 결정이 나면 무엇이 열리는가" attr="opens">
          {item.blocks && <p><T k="지금 막고 있는 것" />: <b>{item.blocks}</b></p>}
          {!!item.opens?.length && <ul className="list-disc pl-4 mt-1 space-y-0.5">{item.opens.map((o, i) => <li key={i}><Rich text={o} /></li>)}</ul>}
          {item.unlocks.length > 0 && <p className="mt-1 text-[12px] text-gray-600"><T k="풀리는 후속 결정" />: {item.unlocks.map((u) => u.title).join(' · ')}</p>}
        </Card>
      )}
      {item.blockedBy.length > 0 && (
        <Card title="먼저 정해져야 하는 것" tone="warn" attr="blocked">
          <p className="text-amber-900">🔴 <T k="아래가 정해지기 전에는 이 결정을 의사결정해도" /> <b><T k="적용되지 않습니다" /></b>.</p>
          <ul className="mt-1 space-y-0.5">{item.blockedBy.map((b) => <li key={b.key}>· <b>{b.title}</b> — {b.reason}</li>)}</ul>
        </Card>
      )}
      {item.afterDecision && <Card title="결정을 기록한 뒤에도 남는 일" attr="after"><Rich text={item.afterDecision} />
        <p className="mt-1 text-[11px] text-gray-500"><T k={PATH_LABEL[item.approvalPath].note} /></p></Card>}
      {!!item.verifyHow?.length && (
        <details className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px]" data-decide-card="verify">
          <summary className="cursor-pointer text-[12px] font-bold text-gray-800 min-h-[32px] flex items-center"><T k="이 자료의 주장을 직접 확인하는 방법" /></summary>
          <ul className="mt-1 space-y-0.5 text-gray-700">{item.verifyHow.map((v, i) => <li key={i}>· <Rich text={v} /></li>)}</ul>
        </details>
      )}
    </div>
  );
}

/** ② 선택지 비교 — 카드를 눌러 고른다 · 각 선택이 정하는 설정 값 · 지금 값/현재 결정 표시 · 고른 선택의 영향 */
export function DecideOptions({ item, items, choice, onChoose }: { item: DecisionItem; items: DecisionItem[]; choice: string; onChoose: (v: string) => void }) {
  const sets = (item.settings ?? []).filter((s) => s.role === 'SETS');
  return (
    <div className="space-y-3" data-decide-options>
      <MechanismExplain mechanism={item.mechanism} />
      <div className="grid gap-2.5 2xl:grid-cols-2">
        {item.options.map((o) => {
          const on = choice === o.value;
          const recorded = item.record?.choice === o.value;
          return (
            <label key={o.value} data-decide-option={o.value}
              className={`relative block cursor-pointer rounded-xl border-2 px-4 py-3 transition ${on ? 'border-indigo-600 bg-indigo-50/70 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
              <span className="flex items-start gap-2.5">
                <input type="radio" name="decision-choice" className="mt-1" checked={on} onChange={() => onChoose(o.value)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold text-gray-900">{o.label}</span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-gray-700"><Rich text={o.effect} /></span>
                  {sets.map((s) => {
                    const so = s.options.find((x) => x.value === o.value);
                    return (
                      <span key={s.key} className="mt-1.5 block text-[11px] text-gray-600" data-decide-option-sets={s.key}>
                        <code className="font-mono">{s.key}</code> → {so?.sets ? <b className="text-gray-900">{JSON.stringify(so.setValue)}</b> : <T k="바꾸지 않음" />}
                        {s.currentOption === o.value && <span className="ml-1.5 text-emerald-700">● <T k="지금 값" /></span>}
                      </span>
                    );
                  })}
                </span>
              </span>
              {recorded && (
                <span className={`absolute right-3 top-3 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${item.seeded ? 'bg-violet-100 text-violet-800' : 'bg-emerald-600 text-white'}`} data-decide-option-recorded>
                  {item.seeded ? <T k="개발 시드" /> : <T k="현재 결정" />}
                </span>
              )}
            </label>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-500">🔴 <T k="시스템은" /> <b><T k="어느 선택이 옳다고 권고하지 않습니다" /></b> — <T k="결과를 적을 뿐입니다." /></p>
      <ImplementedChoiceNotice item={item} choice={choice} />
      <DecisionImpactPreview decisionKey={item.key} choice={choice} />
      <details className="rounded-xl border border-gray-200 bg-white px-4 py-2" data-decide-more="settings" open={!!item.settings?.length}>
        <summary className="cursor-pointer text-[12px] font-bold text-gray-800 min-h-[32px] flex items-center"><T k="설정 상세" /></summary>
        <div className="mt-1"><SettingDetailTable settings={item.settings} recordChoice={item.record?.choice ?? null} /></div>
      </details>
      <details className="rounded-xl border border-gray-200 bg-white px-4 py-2" data-decide-more="log">
        <summary className="cursor-pointer text-[12px] font-bold text-gray-800 min-h-[32px] flex items-center"><T k="결정 경과(이력)" />{item.logCount != null ? ` ${item.logCount}` : ''}</summary>
        <div className="mt-1"><DecisionTimeline decisionKey={item.key} items={items} /></div>
      </details>
    </div>
  );
}
