'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/stores/toast-store';
import { handoffActionsOf, handoffIllnessOf } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { KDate, PatientName } from '@/components/ui/display';
import { T, Tf, Data, useTAttr } from '@/components/ui/i18n-text';
import { IllnessBadge, illnessStrip } from './handoff-ui';
import { SHIFT_KEY, who, type BoardResp, type FeedHandoff } from './board-types';

type Scope = 'current' | 'previous' | 'all';

/** 근무 교대 인계 유형 — 간호(NURSING_SHIFT)·의사/공통(SHIFT_CHANGE) · 그 밖은 하번/상번이라 부르지 않는다 */
const SHIFT_TYPES = new Set(['NURSING_SHIFT', 'SHIFT_CHANGE']);

/** `pendingItems` — 간호 인계 폼은 `{ items: string[] }` 로 남긴다. 다른 모양이면 그리지 않는다(지어내지 않는다) */
function pendingItemsOf(v: unknown): string[] {
  const items = (v as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? items.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
}

/** 위중 → 미확인 → 최신 순 — 인계 보드는 "먼저 볼 것"이 위에 */
const RANK: Record<string, number> = { CRITICAL: 0, UNSTABLE: 1 };
function sortFeed(a: FeedHandoff, b: FeedHandoff): number {
  const ra = RANK[handoffIllnessOf(a.illness).code ?? ''] ?? 2;
  const rb = RANK[handoffIllnessOf(b.illness).code ?? ''] ?? 2;
  return ra - rb || Number(!!a.acknowledgedAt) - Number(!!b.acknowledgedAt) || b.createdAt.localeCompare(a.createdAt);
}

export function HandoffBoard({ board, myId, myRole = null, queryKey }: { board: BoardResp; myId: string | null; myRole?: string | null; queryKey: unknown[] }) {
  const tAttr = useTAttr();
  const [scope, setScope] = useState<Scope>('all');
  const [pendingOnly, setPendingOnly] = useState(false);
  const shift = board.shift;
  const feed = board.handoffs;

  // 🔴 구버전 서버(필드 없음)를 "인계 0건"으로 말하지 않는다
  if (!shift || !feed) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
        <T k="이 서버 응답에는 근무조 인계 정보가 없어 인계 보드를 그릴 수 없습니다." />
      </section>
    );
  }

  const items = feed.items
    .filter((h) => scope === 'all' || (scope === 'current' ? h.shift === shift.current : h.shift === shift.previous))
    .filter((h) => !pendingOnly || !h.acknowledgedAt)
    .sort(sortFeed);
  const countOf = (s: Scope) => feed.items.filter((h) => s === 'all' || (s === 'current' ? h.shift === shift.current : h.shift === shift.previous)).length;
  const pendingCount = feed.items.filter((h) => !h.acknowledgedAt).length;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden" aria-label={tAttr('상·하번 인계 메모')}>
      <header className="border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-white px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-gray-900"><T k="상·하번 인계 메모" /></h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              <Tf k="직전 근무조({근무조}) 시작부터 지금까지" params={{ 근무조: tAttr(SHIFT_KEY[shift.previous]) }} /> · <KDate value={shift.previousStart} mode="datetimeShort" /> ~ · I-PASS
            </p>
          </div>
          {pendingCount > 0 && (
            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white"><Tf k="미확인 {수}" params={{ 수: pendingCount }} /></span>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {(['all', 'current', 'previous'] as Scope[]).map((s) => (
            <button key={s} type="button" onClick={() => setScope(s)} aria-pressed={scope === s}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${scope === s ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 ring-1 ring-inset ring-gray-200 hover:bg-gray-50'}`}>
              {s === 'all' ? <T k="전체" /> : <><T k={s === 'current' ? '이번' : '직전'} /> <T k={SHIFT_KEY[s === 'current' ? shift.current : shift.previous]} /></>}
              <span className="ml-1 opacity-70 tabular-nums">{countOf(s)}</span>
            </button>
          ))}
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} className="rounded border-gray-300" />
            <T k="미확인만" />
          </label>
        </div>
      </header>

      <div className="max-h-[calc(100vh-260px)] overflow-y-auto p-3 space-y-2.5">
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center">
            <p className="text-sm text-gray-500">{pendingOnly ? <T k="미확인 인계가 없습니다." /> : <T k="이 구간에 남긴 인계가 없습니다." />}</p>
            <p className="mt-1 text-[11px] text-gray-400"><T k="환자 카드의 '마지막 인계'는 이 구간 밖의 기록도 경과와 함께 보입니다." /></p>
          </div>
        ) : items.map((h) => <HandoffCard key={h.id} h={h} myId={myId} myRole={myRole} queryKey={queryKey} />)}
        {feed.truncated && (
          <p className="text-center text-[11px] text-amber-700">
            <Tf k="최근 {표시}건만 표시 — 이 구간 전체 {전체}건" params={{ 표시: feed.items.length, 전체: feed.total }} />
          </p>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-2.5 text-xs">
        <Link href="/nurse-station" className="font-medium text-indigo-700 hover:underline"><T k="인계 작성·근무조 마감 →" /></Link>
        <Link href="/handoffs" className="text-gray-500 hover:underline"><T k="전체 인계 기록" /></Link>
      </footer>
    </section>
  );
}

function HandoffCard({ h, myId, myRole, queryKey }: { h: FeedHandoff; myId: string | null; myRole: string | null; queryKey: unknown[] }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const acts = handoffActionsOf(h.actionList);
  const pending = pendingItemsOf(h.pendingItems);
  const isMine = !!myId && h.toDoctor?.id === myId;
  // 조치 체크 — 인계 당사자·관리자(서버 setHandoffActionStatus 와 같은 조건)
  const canTick = !!myId && (isMine || h.fromDoctor?.id === myId || myRole === 'ADMIN');
  const setAction = useMutation({
    mutationFn: (v: { index: number; action: string; status: 'DONE' | 'PENDING' }) =>
      apiClient.patch(`/api/v1/handoffs/${h.id}/actions/${v.index}`, { status: v.status, action: v.action }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    // 🔴 그 사이 바뀜(409)·권한 밖(403)을 서버 문장 그대로 — 체크가 된 척하지 않는다(응답 뒤에만 다시 그린다)
    onError: (e) => { toast.error(extractErrorMessage(e) || tAttr('조치 항목을 바꾸지 못했습니다.')); qc.invalidateQueries({ queryKey }); },
  });
  const ack = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/handoffs/${h.id}/acknowledge`),
    onSuccess: () => { toast.success(tAttr('인수 확인했습니다.')); qc.invalidateQueries({ queryKey }); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('인수 확인에 실패했습니다.')),
  });
  const memo = h.patientSummary ?? h.summary;

  return (
    <article className={`relative overflow-hidden rounded-xl border ${h.acknowledgedAt ? 'border-gray-200 bg-white' : 'border-rose-200 bg-rose-50/30'}`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${illnessStrip(h.illness)}`} aria-hidden="true" />
      <div className="pl-4 pr-3 py-2.5">
        {/* 머리 — 병상·환자·중증도·근무조·시각 */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-gray-900 px-1.5 py-0.5 text-[11px] font-bold text-white tabular-nums">{h.room ?? '-'}-{h.bed ?? '-'}</span>
              {h.patientName
                ? <Link href={`/patients/${h.patientId}`} className="text-sm font-semibold text-gray-900 hover:underline"><PatientName name={h.patientName} koreanName={h.patientKoreanName} showMrn={false} maskable /></Link>
                : <span className="text-sm text-gray-400"><T k="(환자 미상)" /></span>}
              <IllnessBadge value={h.illness} size="xs" />
            </div>
            <p className="mt-0.5 text-[11px] text-gray-500">
              <T k={SHIFT_KEY[h.shift]} /> · <KDate value={h.createdAt} mode="time" />
            </p>
            {/* 근무 교대 인계면 인계자=하번·인수자=상번 · 다른 인계(전동·주치의 변경 등)는 인계·인수로만 */}
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
              <span className="rounded bg-gray-100 px-1 text-[10px] font-semibold text-gray-600"><T k={SHIFT_TYPES.has(h.type) ? '하번' : '인계'} /></span>
              <span className="text-gray-700"><Data>{who(h.fromDoctor) || tAttr('(미지정)')}</Data></span>
              <span className="text-gray-300">→</span>
              <span className="rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-700"><T k={SHIFT_TYPES.has(h.type) ? '상번' : '인수'} /></span>
              <span className="font-medium text-gray-800"><Data>{who(h.toDoctor) || tAttr('(미지정)')}</Data></span>
            </p>
          </div>
          {h.acknowledgedAt ? (
            <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              ✓ <T k="인수 확인" /> <KDate value={h.acknowledgedAt} mode="time" />
            </span>
          ) : isMine ? (
            <button type="button" onClick={() => ack.mutate()} disabled={ack.isPending}
              className="shrink-0 min-h-[32px] rounded-lg bg-rose-600 px-2.5 text-[11px] font-bold text-white hover:bg-rose-700 disabled:opacity-50">
              {ack.isPending ? <T k="확인 중…" /> : <T k="내 인계 — 인수 확인" />}
            </button>
          ) : (
            <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700"><T k="미확인" /></span>
          )}
        </div>

        {/* P — 환자 요약(메모) */}
        {memo && <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-gray-800"><Data>{memo}</Data></p>}

        {/* A — 조치 목록 · 미결 항목 */}
        {acts && acts.items.length > 0 && (
          <ul className="mt-2 space-y-1">
            {acts.items.map((a, i) => {
              const done = a.status === 'DONE';
              const box = <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 bg-white'}`} aria-hidden="true">{done ? '✓' : ''}</span>;
              return (
                <li key={i} className="flex items-start gap-1.5 text-xs">
                  {/* 인계 당사자(인계자·인수자)·관리자만 체크한다 — 서버도 같은 조건 */}
                  {canTick ? (
                    <button type="button" role="checkbox" aria-checked={done} disabled={setAction.isPending}
                      onClick={() => setAction.mutate({ index: i, action: a.action, status: done ? 'PENDING' : 'DONE' })}
                      className="-m-1 flex min-h-[28px] items-start gap-1.5 rounded p-1 text-left hover:bg-gray-50 disabled:opacity-50">
                      {box}<span className={done ? 'text-gray-400 line-through' : 'text-gray-700'}><Data>{a.action}</Data></span>
                    </button>
                  ) : (<>{box}<span className={done ? 'text-gray-400 line-through' : 'text-gray-700'}><Data>{a.action}</Data></span></>)}
                  <span className="ml-auto shrink-0 text-right text-[10px] text-gray-400">
                    {a.deadline && <Data>{a.deadline}</Data>}
                    {/* 완료 표시는 누가·언제와 함께 — 옛 기록은 완료자가 없을 수 있다(지어내지 않는다) */}
                    {done && a.doneAt && <span className="block text-emerald-700">✓ <Data>{a.doneByName ?? ''}</Data> <KDate value={a.doneAt} mode="time" /></span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {pending.length > 0 && (
          <div className="mt-2 rounded-lg bg-sky-50 px-2.5 py-1.5">
            <p className="text-[10px] font-semibold text-sky-800"><T k="미결 항목" /></p>
            <ul className="mt-0.5 space-y-0.5 text-xs text-sky-900">{pending.map((p, i) => <li key={i}>· <Data>{p}</Data></li>)}</ul>
          </div>
        )}

        {/* S — 상황 인식 · S — 종합 */}
        {h.situationAwareness && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            <span className="font-semibold">⚠ <T k="상황 인식" /></span> <Data>{h.situationAwareness}</Data>
          </div>
        )}
        {h.synthesis && <p className="mt-1.5 text-[11px] italic text-gray-500"><T k="종합" />: <Data>{h.synthesis}</Data></p>}
      </div>
    </article>
  );
}
