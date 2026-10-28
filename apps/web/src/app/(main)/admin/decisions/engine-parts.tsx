'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate } from '@/components/ui/display';
import { kdate } from '@/lib/ui-settings';
import {
  DECISION_LOG_KINDS, DECISION_LOG_KIND_LABEL, DECISION_MECHANISM_META, DECISION_SETTING_SOURCE_LABEL,
  type DecisionLogKind, type DecisionMechanism,
} from '@hospital-run/shared';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { useAuthStore } from '@/stores/auth-store';
import { extractErrorMessage } from '@/lib/error-utils';
import { DEV_APPLY_STATUS_LABEL, type DevApplyStatus } from '@hospital-run/shared';
import type { DecisionItem, DecisionLogEntry, DecisionSettingDetail } from './types';
import { Rich } from './rich';

/**
 * 결정 엔진 화면 부품(2026-10-11) — 이력 원장 · 영향 미리보기.
 * 🔴 원장은 일어난 사건만 그린다 — 판정(재검토 필요·결정과 다름)은 서버가 원장과 현재 값에서 파생해 준 것을 쓴다.
 */


const fmt = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

/** 선택 값 → 등록부 선택지 라벨(모르면 값 그대로 — 지어내지 않는다) */
function choiceLabel(items: DecisionItem[] | undefined, key: string, v: string | null) {
  if (v == null) return null;
  return items?.find((i) => i.key === key)?.options.find((o) => o.value === v)?.label ?? v;
}

/** 이력 종류 색 — 점·글자(칩 대신 · 결정 목록과 같은 시각 언어) */
const LOG_KIND_DOT: Record<string, string> = {
  BACKFILL: 'bg-gray-400', SEED_RECORDED: 'bg-violet-500', RECORDED: 'bg-emerald-500', COMMITTEE_RESOLVED: 'bg-teal-500',
  UPSTREAM_CHANGED: 'bg-amber-500', REVIEW_CONFIRMED: 'bg-sky-500', CONFIG_OVERRIDE: 'bg-orange-500', CONFIG_OVERRIDE_BLOCKED: 'bg-red-500',
};
const LOG_KIND_TEXT: Record<string, string> = {
  BACKFILL: 'text-gray-600', SEED_RECORDED: 'text-violet-700', RECORDED: 'text-emerald-700', COMMITTEE_RESOLVED: 'text-teal-700',
  UPSTREAM_CHANGED: 'text-amber-800', REVIEW_CONFIRMED: 'text-sky-700', CONFIG_OVERRIDE: 'text-orange-800', CONFIG_OVERRIDE_BLOCKED: 'text-red-700',
};

/**
 * 이력 한 줄 — 타임라인 모양(2026-10-11 정돈): 왼쪽 색 점과 세로선 · 카드(제목 · 종류 · 시각 / 무엇에서 무엇으로 / 원인 / 근거·권한)
 */
export function LogEntryLine({ e, items, showTitle }: { e: DecisionLogEntry; items?: DecisionItem[]; showTitle?: boolean }) {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const kind = e.kind as DecisionLogKind;
  const sourceTitle = e.sourceKey ? items?.find((i) => i.key === e.sourceKey)?.title ?? null : null;
  const meta: ReactNode[] = [];
  if (e.basisRef) meta.push(<span key="b"><T k="근거" /> {e.basisRef}</span>);
  if (e.authorityClaim) meta.push(<span key="a"><T k="권한" /> {e.authorityClaim}</span>);
  if (e.actorUserId == null && e.kind === 'UPSTREAM_CHANGED') meta.push(<span key="s"><T k="시스템이 남긴 사건" /></span>);
  return (
    <li className="relative flex gap-3" data-log-entry={e.id} data-log-kind={e.kind}>
      <span className="flex w-3 shrink-0 flex-col items-center" aria-hidden>
        <span className={`mt-3 h-2.5 w-2.5 rounded-full ring-4 ring-white ${LOG_KIND_DOT[e.kind] ?? 'bg-gray-400'}`} />
        <span className="w-px flex-1 bg-gray-200" />
      </span>
      <div className="mb-2 min-w-0 flex-1 rounded-xl border border-gray-200/80 bg-white px-4 py-2.5 text-[12px] transition hover:border-gray-300">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {showTitle && (
            <Link href={`/admin/decisions/${encodeURIComponent(e.decisionKey)}`} className="text-[13px] font-semibold text-gray-900 hover:underline">
              <Rich text={e.title ?? e.decisionKey} />
            </Link>
          )}
          <span className={`text-[11px] font-semibold ${LOG_KIND_TEXT[e.kind] ?? 'text-gray-600'}`}><T k={DECISION_LOG_KIND_LABEL[kind] ?? e.kind} /></span>
          <span className="ml-auto text-[11px] text-gray-400 tabular-nums"><KDate value={e.occurredAt} mode="datetime" /></span>
        </p>
        {(e.kind === 'RECORDED' || e.kind === 'COMMITTEE_RESOLVED' || e.kind === 'SEED_RECORDED' || e.kind === 'BACKFILL') && (
          <p className="mt-1 text-[13px] text-gray-800" data-log-choice>
            {e.prevChoice != null && <><span className="text-gray-400">{choiceLabel(items, e.decisionKey, e.prevChoice)}</span> → </>}
            <b>{choiceLabel(items, e.decisionKey, e.choice)}</b>
          </p>
        )}
        {e.kind === 'UPSTREAM_CHANGED' && (
          <p className="mt-1 text-amber-900" data-log-upstream>
            <T k="선행 결정" /> {sourceTitle ?? e.sourceKey}: {choiceLabel(items, e.sourceKey ?? '', (d.upstreamPrev as string) ?? null) ?? '—'} → <b>{choiceLabel(items, e.sourceKey ?? '', (d.upstreamNext as string) ?? null)}</b>
            {d.upstreamNegative === true && <> · <b><T k="이 결정은 적용 근거를 잃었다(자동으로 되돌리지 않음)" /></b></>}
          </p>
        )}
        {(e.kind === 'CONFIG_OVERRIDE' || e.kind === 'CONFIG_OVERRIDE_BLOCKED') && (
          <p className="mt-1 text-orange-900" data-log-config>
            <T k="설정" /> <code className="font-mono">{e.sourceKey}</code>: {fmt(d.prev)} → <b>{fmt(d.value)}</b> · <T k="결정 값" /> {fmt(d.decidedValue)}
            {d.matchesDecision === true ? <> · <T k="결정과 같음" /></> : <> · <b><T k="결정과 다름" /></b></>}
          </p>
        )}
        {typeof d.note === 'string' && <p className="mt-1 text-gray-600">{d.note}</p>}
        {meta.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-gray-500">
            {meta.flatMap((m, i) => (i ? [<span key={`sep${i}`} className="text-gray-300" aria-hidden>·</span>, m] : [m]))}
          </p>
        )}
      </div>
    </li>
  );
}

/** 결정 하나의 경과 — 오래된 것부터(문서는 경과 순서로 읽는다) */
export function DecisionTimeline({ decisionKey, items }: { decisionKey: string; items?: DecisionItem[] }) {
  const q = useQuery({
    queryKey: ['decision-log', decisionKey],
    queryFn: () => apiClient.get<{ data: DecisionLogEntry[] }>(`/api/v1/admin/decisions/${encodeURIComponent(decisionKey)}/log`),
  });
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={q.refetch} />;
  if (q.isLoading) return <p className="text-[12px] text-gray-400"><T k="불러오는 중…" /></p>;
  const rows = q.data?.data ?? [];
  if (!rows.length) return <p className="text-[12px] text-gray-500" data-timeline-empty><T k="이력이 없습니다 — 아직 아무도 의사결정하지 않았습니다." /></p>;
  return (
    <ol data-timeline={decisionKey}>
      {rows.map((e) => <LogEntryLine key={e.id} e={e} items={items} />)}
    </ol>
  );
}

/** 결정 이력 탭 — 최신부터 · 종류 거르기 · 🔴 자르면 "더 보기"(남은 수 함께) */
export function DecisionLogView({ items }: { items: DecisionItem[] }) {
  const tAttr = useTAttr();
  const [kind, setKind] = useState<string>('ALL');
  const q = useInfiniteQuery({
    queryKey: ['decision-log-all', kind],
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) => apiClient.get<{ data: { items: DecisionLogEntry[]; total: number; nextCursor: string | null } }>(
      `/api/v1/admin/decisions/log?limit=100${kind !== 'ALL' ? `&kind=${kind}` : ''}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => last.data.nextCursor ?? undefined,
  });
  const pages = q.data?.pages ?? [];
  const rows = pages.flatMap((p) => p.data.items);
  const total = pages[0]?.data.total ?? null;
  /** 날짜(한국 시각)별 묶음 — 같은 날 사건을 한 머리 아래 */
  const groups: Array<{ day: string; rows: DecisionLogEntry[] }> = [];
  for (const e of rows) {
    const day = kdate(e.occurredAt, 'date');
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.rows.push(e); else groups.push({ day, rows: [e] });
  }
  return (
    <div className="space-y-3" data-log-view>
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-4 space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xl font-extrabold tracking-tight text-slate-900"><T k="결정 이력" /></span>
              {total != null && <span className="text-[12px] text-slate-500 tabular-nums">{total}<T k="건" /></span>}
            </p>
            <p className="mt-0.5 text-[12px] text-slate-600">
              <T k="이력은 덧붙이기만 합니다 — 고치거나 지우지 않습니다. 원장 시작(2026-10-11) 전 기록은 그때 남아 있던 한 줄씩만 옮겼습니다." />
            </p>
          </div>
          <Link href="/admin/decisions/register" className="min-h-[44px] inline-flex items-center rounded-lg bg-indigo-600 px-4 text-[12px] font-semibold text-white shadow-sm hover:bg-indigo-700" data-register-link>
            <T k="결정 대장(문서)" /> →
          </Link>
          <Link href="/admin/decisions/checks" className="min-h-[44px] inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 text-[12px] font-semibold text-gray-700 hover:bg-gray-50" data-checks-link>
            <T k="사람 확인 문서" /> →
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(['ALL', ...DECISION_LOG_KINDS] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} data-log-filter={k}
              className={`min-h-[36px] inline-flex items-center gap-1.5 rounded-full px-3 text-[11px] font-medium border transition ${kind === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'}`}>
              {k !== 'ALL' && <span className={`h-1.5 w-1.5 rounded-full ${LOG_KIND_DOT[k]}`} aria-hidden />}
              {k === 'ALL' ? tAttr('전체') : tAttr(DECISION_LOG_KIND_LABEL[k])}
            </button>
          ))}
        </div>
      </div>
      {q.isError ? <QueryErrorFallback error={q.error} onRetry={q.refetch} />
        : q.isLoading ? <p className="text-[12px] text-gray-400"><T k="불러오는 중…" /></p>
        : rows.length === 0 ? <p className="text-[12px] text-gray-500 px-2" data-log-empty><T k="이 종류의 이력이 없습니다" /></p>
        : (
          <>
            {groups.map((g) => (
              <section key={g.day} data-log-day={g.day}>
                <p className="sticky top-0 z-[1] mb-1 bg-gray-50/95 px-2 py-1 text-[12px] font-bold text-gray-700 backdrop-blur">
                  {g.day} <span className="font-normal text-gray-400 tabular-nums">· {g.rows.length}</span>
                </p>
                <ol>{g.rows.map((e) => <LogEntryLine key={e.id} e={e} items={items} showTitle />)}</ol>
              </section>
            ))}
            <div className="flex flex-wrap items-center gap-3 px-2">
              <p className="text-[11px] text-gray-500" data-log-shown><T k="표시" /> {rows.length} / {total ?? '—'}</p>
              {q.hasNextPage && (
                <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} data-log-more
                  className="min-h-[44px] px-4 rounded-lg border border-gray-300 bg-white text-[12px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50">
                  <T k="더 보기" />
                </button>
              )}
            </div>
          </>
        )}
    </div>
  );
}

interface Impact {
  configChanges: Array<{ key: string; current: unknown; next: unknown; changes: boolean }>;
  appliesNow: boolean; approvalPath: string; protectedKeys: string[]; protectionMode: string;
  downstream: Array<{ key: string; title: string; decided: boolean; choice: string | null; effect: 'REVIEW' | 'BLOCKS' | 'UNLOCKS'; loseBasis: boolean }>;
  upstream: Array<{ key: string; title: string; decided: boolean; choice: string | null; satisfied: boolean }>;
}

/** 🔴 고르기 전에 — 이 선택이 바꾸는 설정·후행 결정·선행 충족(저장하지 않는다) */
export function DecisionImpactPreview({ decisionKey, choice }: { decisionKey: string; choice: string }) {
  const q = useQuery({
    queryKey: ['decision-impact', decisionKey, choice],
    queryFn: () => apiClient.get<{ data: Impact }>(`/api/v1/admin/decisions/${encodeURIComponent(decisionKey)}/impact?choice=${encodeURIComponent(choice)}`),
    enabled: !!choice,
  });
  if (!choice) return null;
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={q.refetch} />;
  if (q.isLoading || !q.data) return <p className="text-[11px] text-gray-400"><T k="영향을 계산하는 중…" /></p>;
  const im = q.data.data;
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-2 text-[11px] text-indigo-950 space-y-1" data-impact>
      <p className="font-semibold"><T k="이 선택의 영향(의사결정 전 미리보기)" /></p>
      {im.configChanges.length === 0
        ? <p data-impact-config-none><T k="바꾸는 설정 없음" /></p>
        : im.configChanges.map((c) => (
          <p key={c.key} data-impact-config={c.key}>
            <T k="설정" /> <code className="font-mono">{c.key}</code>: {fmt(c.current)} → <b>{fmt(c.next)}</b>
            {!c.changes && <> (<T k="지금과 같음" />)</>}
            {!im.appliesNow && <> · <span className="text-amber-900"><T k="이 경로는 의사결정만으로 바뀌지 않는다(의결·배포 후)" /></span></>}
          </p>
        ))}
      {im.upstream.filter((u) => !u.satisfied).map((u) => (
        <p key={u.key} className="text-amber-900" data-impact-upstream={u.key}>🔴 <T k="선행 미충족" />: {u.title} — <T k="의사결정해도 적용되지 않는다" /></p>
      ))}
      {im.downstream.map((x) => (
        <p key={x.key} data-impact-downstream={x.key} data-impact-effect={x.effect}>
          <T k="후행" />: {x.title} — {x.effect === 'REVIEW'
            ? <b className="text-amber-900"><T k={x.loseBasis ? '실결정이 적용 근거를 잃는다(재검토 필요 · 자동으로 되돌리지 않음)' : '실결정이 재검토 대상이 된다'} /></b>
            : x.effect === 'BLOCKS' ? <T k="이 선택이면 열리지 않는다" /> : <T k="결정할 수 있게 열린다" />}
        </p>
      ))}
      {im.protectedKeys.length > 0 && (
        <p className="text-gray-700" data-impact-protect>
          <T k="의사결정 뒤 보호되는 설정" />: {im.protectedKeys.join(' · ')} · <T k="보호 수준" /> {im.protectionMode}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 결정 방식·설정 상세(2026-10-11)
// ─────────────────────────────────────────────────────────────────────────────

export const MECHANISM_STYLE: Record<string, string> = {
  AUTO_APPLY: 'bg-emerald-50 text-emerald-900 border-emerald-300',
  COMMITTEE_APPLY: 'bg-teal-50 text-teal-900 border-teal-300',
  COMMITTEE_RECORD: 'bg-slate-50 text-slate-800 border-slate-300',
  CONFIRM_ONLY: 'bg-sky-50 text-sky-900 border-sky-300',
  MIXED: 'bg-amber-50 text-amber-900 border-amber-300',
  DEV_APPLY: 'bg-purple-50 text-purple-900 border-purple-300',
  PER_EVENT: 'bg-gray-50 text-gray-700 border-gray-300',
  UNBOUND: 'bg-red-50 text-red-800 border-red-300',
};

export function MechanismBadge({ mechanism, variant = 'chip' }: { mechanism?: DecisionMechanism; variant?: 'chip' | 'text' }) {
  if (!mechanism) return null;
  const m = DECISION_MECHANISM_META[mechanism];
  if (variant === 'text') {
    // 행 메타 줄 — 칩 대신 글자(색은 자동 반영만 강조)
    return (
      <span className={m.auto ? 'text-emerald-700' : mechanism === 'UNBOUND' ? 'text-red-700' : 'text-gray-500'} data-row-mechanism={mechanism} title={m.effect}>
        {m.auto ? '⚙ ' : ''}<T k={m.label} />
      </span>
    );
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${MECHANISM_STYLE[mechanism]}`} data-row-mechanism={mechanism} title={m.effect}>
      {m.auto ? '⚙ ' : ''}<T k={m.label} />
    </span>
  );
}

/** 결정 방식 설명 — 누가 정하고, 정하면 무엇이 일어나는가 */
export function MechanismExplain({ mechanism }: { mechanism?: DecisionMechanism }) {
  if (!mechanism) return null;
  const m = DECISION_MECHANISM_META[mechanism];
  return (
    <div className={`rounded-lg border px-3 py-2 text-[11px] ${MECHANISM_STYLE[mechanism]}`} data-mechanism-explain={mechanism}>
      <p className="font-semibold"><T k="결정 방식" />: <T k={m.label} /> {m.auto && <span className="ml-1 text-[10px] font-bold">⚙ <T k="자동 반영" /></span>}</p>
      <p><T k="누가" />: <T k={m.who} /></p>
      <p><T k="정하면" />: <T k={m.effect} /></p>
    </div>
  );
}

const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
function allowedText(a: unknown, tAttr: (s: string) => string): string {
  if (a == null) return tAttr('규칙 없음');
  if (a === 'DATE') return tAttr('날짜(YYYY-MM-DD)');
  if (Array.isArray(a)) return a.map((x) => String(x)).join(' · ');
  const r = a as { int?: [number, number] };
  return r.int ? `${tAttr('정수')} ${r.int[0]}~${r.int[1]}` : JSON.stringify(a);
}

/**
 * 설정 상세 — 이 결정이 건드리는 설정마다:
 *   설명 · 현재 값(출처) · 코드 기본값 · 허용 값 · 선택지별로 정하는 값(● 지금과 같은 값 · ✓ 기록된 선택) · 결정 값과 일치 · 마지막 변경
 * 🔴 "지금과 같은 선택지"는 값이 정확히 같을 때만 표시한다(근사·라벨 추정 없음).
 */
export function SettingDetailTable({ settings, recordChoice }: { settings: DecisionSettingDetail[] | null | undefined; recordChoice?: string | null }) {
  const tAttr = useTAttr();
  if (settings === null) return <p className="text-[11px] text-amber-900" data-settings-unknown><T k="설정을 조회하지 못했습니다 — 바꾸는 설정이 없다는 뜻이 아닙니다." /></p>;
  if (!settings?.length) return <p className="text-[11px] text-gray-500" data-settings-none><T k="이 결정은 시스템 설정을 바꾸지 않습니다." /></p>;
  return (
    <div className="space-y-2" data-settings-table>
      {settings.map((s) => (
        <div key={s.key} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px]" data-setting={s.key} data-setting-role={s.role}>
          <p className="flex flex-wrap items-center gap-x-2">
            <code className="font-mono font-semibold text-gray-900">{s.key}</code>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${s.role === 'SETS' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
              <T k={s.role === 'SETS' ? '이 결정이 바꾸는 설정' : '바꾸지 않음 — 이 결정이 기대는 설정'} />
            </span>
            {s.category && <span className="text-gray-400">{s.category}</span>}
            {!s.registered && <span className="text-amber-900"><T k="설정 목록 미등재" /></span>}
          </p>
          {s.description && <p className="mt-0.5 text-gray-600">{s.description}</p>}
          <dl className="mt-1 grid grid-cols-[6.5rem_1fr] gap-y-0.5">
            <dt className="text-gray-500"><T k="현재 값" /></dt>
            <dd data-setting-current><b>{show(s.current)}</b> <span className="text-gray-500">(<T k={DECISION_SETTING_SOURCE_LABEL[s.source]} />)</span></dd>
            <dt className="text-gray-500"><T k="코드 기본값" /></dt><dd>{show(s.defaultValue)}</dd>
            <dt className="text-gray-500"><T k="허용 값" /></dt><dd data-setting-allowed>{allowedText(s.allowed, tAttr)}</dd>
            {s.decidedSets && (<>
              <dt className="text-gray-500"><T k="결정 값" /></dt>
              <dd data-setting-decided={String(s.matchesDecision)} className={s.matchesDecision === false ? 'text-orange-900 font-semibold' : ''}>
                {show(s.decidedValue)} · {s.matchesDecision ? <T k="일치" /> : <T k="결정과 다름" />}
              </dd>
            </>)}
            <dt className="text-gray-500"><T k="마지막 변경" /></dt>
            <dd>{s.updatedAt ? <><KDate value={s.updatedAt} mode="datetime" />{s.updatedByName ? ` · ${s.updatedByName}` : ''}</> : <T k="저장된 적 없음(기본값·미설정)" />}</dd>
          </dl>
          {s.role === 'SETS' && (
            <table className="mt-1.5 w-full" data-setting-options>
              <thead><tr className="text-left text-gray-500"><th className="font-normal py-0.5"><T k="선택지" /></th><th className="font-normal"><T k="정하는 값" /></th><th className="font-normal" /></tr></thead>
              <tbody>
                {s.options.map((o) => (
                  <tr key={o.value} className="border-t border-gray-100" data-setting-option={o.value}>
                    <td className="py-0.5 pr-2">{o.label}</td>
                    <td className="pr-2">{o.sets ? show(o.setValue) : <span className="text-gray-400"><T k="바꾸지 않음" /></span>}</td>
                    <td className="whitespace-nowrap">
                      {s.currentOption === o.value && <span className="mr-1 text-emerald-800" data-setting-now>● <T k="지금 값" /></span>}
                      {recordChoice === o.value && <span className="text-indigo-800" data-setting-recorded>✓ <T k="결정된 선택" /></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * 개발 반영 이행 칩(기획 P2-2) — 🔴 반영 대기를 반영됨과 같은 색으로 그리지 않는다 · 미결은 그리지 않는다(시드는 이행이 아니다)
 * `status: null` = 이력 조회 실패 — "확인 불가"로 말한다(미결로 접지 않는다)
 */
const DEV_APPLY_STYLE: Record<DevApplyStatus, string> = {
  UNDECIDED: '',
  PENDING_DEV: 'border border-amber-300 bg-amber-50 text-amber-900',
  REVERT_NEEDED: 'bg-rose-600 text-white',
  ENACTED: 'bg-emerald-100 text-emerald-900',
  NOT_REQUIRED: 'bg-slate-100 text-slate-700',
};
export function DevApplyChip({ dev }: { dev: DecisionItem['devApply'] }) {
  if (!dev) return null;
  if (dev.status === null) return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600" data-row-devapply="UNKNOWN"><T k="개발 반영 확인 불가" /></span>;
  if (dev.status === 'UNDECIDED') return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${DEV_APPLY_STYLE[dev.status]}`} data-row-devapply={dev.status}>
      <T k={DEV_APPLY_STATUS_LABEL[dev.status]} />{dev.status === 'ENACTED' && dev.version ? ` ${dev.version}` : null}
    </span>
  );
}

/** 의사결정 작업대 — 판정표상 코드가 이미 특정 선택대로 돌면, 고른 선택이 그것과 다를 때 그 자리에서 말한다 */
export function ImplementedChoiceNotice({ item, choice }: { item: DecisionItem; choice: string }) {
  const impl = item.devApply?.implementedChoice;
  if (!impl || !choice) return null;
  const label = item.options.find((o) => o.value === impl)?.label ?? impl;
  return choice === impl ? (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-700" data-implemented-notice="SAME">
      <Tf k="코드가 이미 이 선택대로 동작합니다(판정표) — 의사결정 뒤 개발 반영 기록에서 확인을 남기세요: {선택}" params={{ 선택: label }} />
    </p>
  ) : (
    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-800" data-implemented-notice="DIFF">
      <Tf k="이미 구현된 동작을 되돌려야 합니다 — 코드는 지금 다른 선택대로 동작합니다(판정표): {선택}" params={{ 선택: label }} />
    </p>
  );
}

/**
 * 결정 문서 — 개발 반영 이행과 반영 기록(관리자 · 사람 결정 D5 전 기본값).
 * 🔴 되돌림 필요는 시스템이 남긴다 · 반영 확인은 릴리즈 버전 필수 · 실결정이 없으면 기록하지 않는다(시드는 결정이 아니다)
 */
export function DevApplyPanel({ item }: { item: DecisionItem }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';
  const [kind, setKind] = useState<'DEV_ENACTED' | 'DEV_NOT_REQUIRED' | ''>('');
  const [version, setVersion] = useState('');
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/admin/decisions/${encodeURIComponent(item.key)}/dev-enactment`, { kind, note, ...(kind === 'DEV_ENACTED' ? { version } : {}) }),
    onSuccess: () => { setKind(''); setVersion(''); setNote(''); void qc.invalidateQueries({ queryKey: ['human-decisions'] }); },
  });
  const dev = item.devApply;
  if (!dev) return null;
  const canRecord = isAdmin && item.decided && dev.status !== null;
  const ready = kind !== '' && note.trim().length >= 2 && (kind !== 'DEV_ENACTED' || /^v\d+\.\d+\.\d+$/.test(version.trim()));
  return (
    <section className="rounded-2xl border border-gray-200 bg-white px-5 py-4 print:hidden" data-devapply-panel={dev.status ?? 'UNKNOWN'}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-bold text-gray-900"><T k="개발 반영" /></h3>
        <DevApplyChip dev={dev} />
        {dev.status === 'UNDECIDED' && <span className="text-[12px] text-gray-500"><T k="실결정이 없어 이행 상태가 없습니다(개발 시드는 결정이 아닙니다)" /></span>}
        {dev.since && dev.status !== 'UNDECIDED' && <span className="text-[11px] text-gray-500"><T k="의사결정" /> <KDate value={dev.since} mode="date" /></span>}
      </div>
      {dev.implementedChoice && (
        <p className="mt-1 text-[12px] text-gray-600" data-devapply-implemented>
          <Tf k="판정표: 코드는 지금 이 선택대로 동작합니다 — {선택}" params={{ 선택: item.options.find((o) => o.value === dev.implementedChoice)?.label ?? dev.implementedChoice }} />
        </p>
      )}
      {canRecord ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[auto_8rem_1fr_auto] sm:items-start">
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="min-h-[40px] rounded-lg border px-2 text-[12px]" aria-label={tAttr('기록 종류')}>
            <option value=""><T k="기록 종류 선택" /></option>
            <option value="DEV_ENACTED">{tAttr('개발 반영 확인')}</option>
            <option value="DEV_NOT_REQUIRED">{tAttr('개발 불필요(현행)')}</option>
          </select>
          <input value={version} onChange={(e) => setVersion(e.target.value)} disabled={kind !== 'DEV_ENACTED'} placeholder="v4.75.0"
            className="min-h-[40px] rounded-lg border px-2 text-[12px] disabled:bg-gray-50" aria-label={tAttr('릴리즈 버전')} />
          <input value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[40px] rounded-lg border px-2 text-[12px]" aria-label={tAttr('근거')} placeholder={tAttr('근거 — 커밋·릴리즈 문서·판정표')} />
          <button type="button" disabled={!ready || save.isPending} onClick={() => save.mutate()} className="min-h-[40px] rounded-lg bg-gray-900 px-3 text-[12px] font-semibold text-white disabled:opacity-40" data-devapply-save>
            <T k="반영 기록" />
          </button>
          {save.isError && <p className="text-[12px] text-red-700 sm:col-span-4">{extractErrorMessage(save.error)}</p>}
        </div>
      ) : (
        item.decided && dev.status !== null && <p className="mt-2 text-[11px] text-gray-500"><T k="반영 기록은 관리자가 남깁니다." /></p>
      )}
    </section>
  );
}
