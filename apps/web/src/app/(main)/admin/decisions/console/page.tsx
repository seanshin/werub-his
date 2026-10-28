'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import {
  LAYER_ORDER, LAYER_TITLE_SHORT, PATH_LABEL, GO_LIVE_LABEL, DUE_LABEL, ENACT_STYLE,
  type DecisionItem, type DecisionsPayload, type EnactmentState, type Layer,
} from '../types';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 사람 결정 **관리 콘솔** — 독자가 다르다.
 *
 * `/admin/decisions` 는 **결정하는 곳**이다(허가권자·위원이 브리핑을 읽고 기록한다).
 * 여기는 **관리하는 곳**이다(전산·기획·간사가 진행을 본다).
 *
 * 🔴 이 화면이 답해야 하는 질문은 넷이고, 그 순서대로 짰다:
 *   ① 지금 개시를 막고 있는 것은 무엇인가
 *   ② 지금 결정할 수 있는 것은 무엇인가
 *   ③ **결정했는데 아직 반영되지 않은 것**은 무엇인가
 *   ④ 누가 들고 있는가 · 언제까지인가
 *
 * 🔴 **층별 진행률을 합치지 않는다.** 합치면 "위원회가 다 의결했으니 90%" 같은 거짓 안심이 생긴다.
 * 🔴 **`반영대기`를 `반영됨`과 같은 색으로 그리지 않는다.** 합치면 "20건 결정 완료"가
 *    실제로는 아무것도 바뀌지 않은 상태를 가린다.
 */
type Bucket = 'BLOCKING' | 'READY' | 'PENDING_ENACT' | 'FAILED' | 'DONE' | 'WAITING';

const BUCKET_META: Record<Bucket, { title: string; hint: string; tone: string }> = {
  BLOCKING: { title: '개시를 막고 있다', hint: '개시 전 필수인데 아직 결정되지 않았다', tone: 'border-red-300 bg-red-50' },
  READY: { title: '지금 결정할 수 있다', hint: '선행 조건이 충족됐다 — 사람이 고르기만 하면 된다', tone: 'border-blue-300 bg-blue-50' },
  FAILED: { title: '반영 실패', hint: '🔴 결정은 됐는데 집행이 실패했다 — 사유를 보고 고쳐야 한다', tone: 'border-red-400 bg-red-50' },
  PENDING_ENACT: { title: '결정했는데 아직 반영되지 않았다', hint: '의결·배포·게이트 등으로 남아 있다 — "완료"가 아니다', tone: 'border-amber-300 bg-amber-50' },
  WAITING: { title: '선행 조건 대기', hint: '상위 층이 정해져야 이 결정이 열린다', tone: 'border-gray-300 bg-gray-50' },
  DONE: { title: '반영됨', hint: '결정되고 시스템에 반영됐다', tone: 'border-emerald-300 bg-emerald-50' },
};

function bucketOf(d: DecisionItem): Bucket {
  const st = d.enactment?.state as EnactmentState | undefined;
  if (st === 'FAILED') return 'FAILED';
  if (d.decided) return st === 'ENACTED' || st === 'MANUAL_CONFIRMED' ? 'DONE' : 'PENDING_ENACT';
  if (d.blockedBy.length) return 'WAITING';
  if (d.goLive === 'REQUIRED_BEFORE') return 'BLOCKING';
  return d.readyToDecide ? 'READY' : 'WAITING';
}

const ORDER: Bucket[] = ['BLOCKING', 'FAILED', 'READY', 'PENDING_ENACT', 'WAITING', 'DONE'];

export default function DecisionConsolePage() {
  const tAttr = useTAttr();
  const [layer, setLayer] = useState<Layer | 'ALL'>('ALL');
  const [owner, setOwner] = useState<string>('ALL');
  const [q, setQ] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['decisions'],
    // 🔴 `.catch(() => 기본값)` 를 쓰지 않는다 — 그러면 isError 가 영원히 false 가 되어
    //    QueryErrorFallback 이 도달 불가 코드가 된다(이 저장소에서 212파일이 그랬다)
    queryFn: async () => (await apiClient.get<{ data: DecisionsPayload }>('/api/v1/admin/decisions')).data,
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const owners = useMemo(() => [...new Set(items.map((i) => i.owner))].sort(), [items]);

  const filtered = useMemo(() => items.filter((i) =>
    (layer === 'ALL' || i.layer === layer)
    && (owner === 'ALL' || i.owner === owner)
    && (!q.trim() || `${i.title} ${i.key} ${i.owner}`.toLowerCase().includes(q.trim().toLowerCase()))
  ), [items, layer, owner, q]);

  const buckets = useMemo(() => {
    const m = new Map<Bucket, DecisionItem[]>();
    for (const b of ORDER) m.set(b, []);
    for (const d of filtered) m.get(bucketOf(d))!.push(d);
    return m;
  }, [filtered]);

  if (isLoading) return <div className="p-6 text-sm text-gray-500"><T k="불러오는 중…" /></div>;
  if (isError || !data) return <QueryErrorFallback error={error} onRetry={() => refetch()} />;

  return (
    <div className="p-6 space-y-5">
      <header>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900"><T k="사람 결정 관리 콘솔" /></h1>
          <Link href="/admin/decisions" className="text-xs text-blue-600 hover:underline"><T k="← 결정 화면(브리핑·의사결정)" /></Link>
        </div>
        <p className="mt-1 text-[12px] text-gray-500">
          <T k="여기는" /> <b><T k="진행을 관리하는 곳" /></b><T k="이다. 결정 자체는 허가권자·위원이 결정 화면에서 한다." />
        </p>
      </header>

      {/* 🔴 층별로 따로 낸다 — 합치면 거짓 안심이 생긴다 */}
      <section className="grid gap-2 sm:grid-cols-3">
        {LAYER_ORDER.map((l) => {
          const g = items.filter((i) => i.layer === l);
          const done = g.filter((i) => bucketOf(i) === 'DONE').length;
          const pend = g.filter((i) => bucketOf(i) === 'PENDING_ENACT').length;
          return (
            <div key={l} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <p className="text-[11px] font-bold text-gray-500"><T k={LAYER_TITLE_SHORT[l]} /></p>
              <p className="mt-0.5 text-lg font-bold text-gray-900">
                {done}<span className="text-sm font-bold text-gray-400">/{g.length}</span>
                <span className="ml-1 text-[11px] font-medium text-gray-400"><T k="반영됨" /></span>
              </p>
              {/* 🔴 반영대기를 반영됨에 더하지 않는다 — 별도로 말한다 */}
              {pend > 0 && <p className="text-[11px] font-medium text-amber-700"><T k="결정했으나 미반영" /> {pend}<T k="건" /></p>}
            </div>
          );
        })}
      </section>

      <section className="flex flex-wrap items-center gap-2 text-xs">
        <select value={layer} onChange={(e) => setLayer(e.target.value as Layer | 'ALL')} className="rounded-lg border border-gray-300 px-2 py-1.5">
          <option value="ALL">{tAttr('전체 층')}</option>
          {LAYER_ORDER.map((l) => <option key={l} value={l}>{tAttr(LAYER_TITLE_SHORT[l])}</option>)}
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5">
          <option value="ALL">{tAttr('전체 담당')}</option>
          {owners.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tAttr('제목·키·담당 검색')}
          className="min-w-[200px] flex-1 rounded-lg border border-gray-300 px-2 py-1.5" />
        <span className="text-gray-400">{filtered.length}/{items.length}<T k="건" /></span>
      </section>

      {ORDER.map((b) => {
        const list = buckets.get(b)!;
        if (!list.length) return null;
        const meta = BUCKET_META[b];
        return (
          <section key={b} className={`rounded-xl border ${meta.tone} p-4`}>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-sm font-bold text-gray-900"><T k={meta.title} /></h2>
              <span className="text-sm font-bold text-gray-600">{list.length}</span>
              <span className="text-[11px] text-gray-600"><T k={meta.hint} /></span>
            </div>
            <ul className="space-y-1.5">
              {list.map((d) => (
                <li key={d.key} className="rounded-lg border border-white/70 bg-white/80 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link href={`/admin/decisions/${d.key}`} className="text-[13px] font-semibold text-gray-900 hover:underline">
                      {d.title}
                    </Link>
                    <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">
                      <T k={LAYER_TITLE_SHORT[d.layer]} />
                    </span>
                    <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">
                      <T k={PATH_LABEL[d.approvalPath].label} />
                    </span>
                    {/* 🔴 담당·기한 — 없으면 34건은 아무의 일도 아니다 */}
                    <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-700">
                      {d.owner}
                    </span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${
                      d.dueBy === 'BEFORE_GO_LIVE' ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 bg-gray-50 text-gray-600'
                    }`}>
                      <T k={DUE_LABEL[d.dueBy]} />
                    </span>
                    {d.goLive === 'REQUIRED_BEFORE' && (
                      <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                        <T k={GO_LIVE_LABEL[d.goLive]} />
                      </span>
                    )}
                    {d.enactment && d.enactment.state !== 'UNDECIDED' && (
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${ENACT_STYLE[d.enactment.state]}`}>
                        {d.enactment.label}
                      </span>
                    )}
                  </div>
                  {/* 🔴 왜 여기 있는지 말한다 — 목록만 있으면 사람이 다시 조사해야 한다 */}
                  {d.enactment?.detail && (
                    <p className="mt-0.5 text-[11px] text-gray-600">{d.enactment.detail}</p>
                  )}
                  {d.blockedBy.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-gray-600">
                      <T k="막고 있는 것:" /> {d.blockedBy.map((b2) => b2.title).join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
