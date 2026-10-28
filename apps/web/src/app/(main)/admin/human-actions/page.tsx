'use client';

/**
 * 화면 2419 「사람 몫 할 일」(2026-10-26 · 명세 `docs/05-reference/human-actions-2026-10-26.md`).
 *
 * 개발이 끝났고 사람의 결정·입력·확인만 남은 일 H1~H10. 정의·라벨·이동 경로 정본 = shared `human-actions`(서버는 코드와 값만).
 *  · 🔴 체크박스가 없다 — "했다"는 사람이 누르는 것이 아니라 결정 기록·설정·원장이 말한다(서버가 파생)
 *  · 🔴 결정은 실결정만 충족 — 개발 시드는 선택지를 보여 주되 "결정 아님"
 *  · 🔴 확인 불가(조회 실패)는 그대로 말한다 — 미충족·끝남으로 접지 않는다 · 판정 수단 없는 일은 "자동 판정 없음"
 *  · 읽기 전용 — 하는 곳은 각 항목의 링크
 */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  HUMAN_ACTIONS, HUMAN_ACTION_STATE_LABELS, HUMAN_CHECK_LABELS, HUMAN_PHASE_LABELS,
  type HumanActionState, type HumanActionValue, type HumanCheckValue,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate } from '@/components/ui/display';
import { T, Tf } from '@/components/ui/i18n-text';

interface Payload { items: HumanActionValue[]; generatedAt: string }
const unwrap = (r: unknown): Payload | undefined => ((r as { data?: { data?: Payload } })?.data?.data ?? (r as { data?: Payload })?.data);

const STATE_CLS: Record<HumanActionState, string> = {
  DONE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PARTIAL: 'bg-amber-50 text-amber-800 border-amber-200',
  PENDING: 'bg-rose-50 text-rose-700 border-rose-200',
  UNKNOWN: 'bg-gray-100 text-gray-600 border-gray-300',
  MANUAL: 'bg-slate-50 text-slate-600 border-slate-200',
};
const CHECK_MARK: Record<HumanCheckValue['state'], { icon: string; cls: string; label: string }> = {
  MET: { icon: '●', cls: 'text-emerald-600', label: '충족' },
  UNMET: { icon: '○', cls: 'text-rose-600', label: '미충족' },
  UNKNOWN: { icon: '?', cls: 'text-gray-500', label: '확인 불가' },
  INFO: { icon: 'i', cls: 'text-slate-500', label: '참고' },
};

function CheckRow({ c }: { c: HumanCheckValue }) {
  const m = CHECK_MARK[c.state];
  return (
    <li className="flex items-start gap-2 text-xs" data-human-check={c.code} data-human-check-state={c.state}>
      <span className={`mt-0.5 w-4 shrink-0 text-center font-bold ${m.cls}`} aria-label={m.label} title={m.label}>{m.icon}</span>
      <div className="min-w-0">
        <span className="text-gray-800"><T k={HUMAN_CHECK_LABELS[c.code] ?? c.code} /></span>
        {c.target && <code className="ml-1.5 text-[11px] text-gray-500 break-all">{c.target}</code>}
        {c.state === 'UNKNOWN' && <span className="ml-1.5 text-gray-500"><T k="— 조회하지 못해 확인할 수 없습니다" /></span>}
        {c.decision === 'SEED' && (
          // 🔴 시드는 결정이 아니다 — 무엇으로 해 두었는지는 보이되 충족으로 세지 않는다
          <span className="ml-1.5 text-amber-700" data-human-seed><Tf k="개발 시드 {선택} — 결정 아님" params={{ 선택: c.choice ?? '-' }} /></span>
        )}
        {c.decision === 'REAL' && <span className="ml-1.5 text-emerald-700"><Tf k="실결정 {선택}" params={{ 선택: c.choice ?? '-' }} /></span>}
        {c.decision === 'NONE' && <span className="ml-1.5 text-gray-500"><T k="기록 없음" /></span>}
        {c.count != null && <span className="ml-1.5 tabular-nums text-gray-700" data-human-count={c.count}><Tf k="{수}건" params={{ 수: c.count }} /></span>}
        {c.names && c.names.length > 0 && (
          <p className="mt-0.5 text-[11px] text-gray-500" data-human-names>
            {c.names.join(' · ')}
            {c.truncated && <> · <T k="더 있음(잘림)" /></>}
          </p>
        )}
      </div>
    </li>
  );
}

export default function HumanActionsPage() {
  const q = useQuery({ queryKey: ['human-actions'], queryFn: () => apiClient.get('/api/v1/admin/human-actions') });
  const data = unwrap(q.data);
  const byId = new Map((data?.items ?? []).map((i) => [i.id, i]));
  const counts = (data?.items ?? []).reduce<Record<HumanActionState, number>>((a, i) => ({ ...a, [i.state]: a[i.state] + 1 }), { DONE: 0, PARTIAL: 0, PENDING: 0, UNKNOWN: 0, MANUAL: 0 });

  return (
    <div className="space-y-4 p-4" data-human-actions>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="사람 몫 할 일" /></h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            <T k="개발이 끝났고 사람의 결정·입력·확인만 남은 일입니다. 상태는 사람이 체크하는 것이 아니라 결정 기록·설정·원장에서 자동으로 판정합니다 — 각 항목의 링크에서 일을 하면 여기 상태가 바뀝니다." />
          </p>
          <p className="mt-1 text-xs text-gray-500"><T k="결정은 실결정만 충족으로 셉니다(개발 시드는 결정이 아닙니다). 명세 문서: docs/05-reference/human-actions-2026-10-26.md" /></p>
        </div>
        <button type="button" onClick={() => void q.refetch()} disabled={q.isFetching} className="min-h-[40px] rounded-lg border px-3 text-sm disabled:opacity-50">
          <T k="다시 확인" />
        </button>
      </div>

      {q.isError && <QueryErrorFallback error={q.error} onRetry={() => void q.refetch()} />}
      {q.isLoading && <p className="text-sm text-gray-400"><T k="불러오는 중…" /></p>}

      {data && (
        <>
          <div className="flex flex-wrap gap-2 text-xs" data-human-summary>
            {(['PENDING', 'PARTIAL', 'UNKNOWN', 'DONE', 'MANUAL'] as const).map((s) => (
              <span key={s} className={`rounded-full border px-2.5 py-1 ${STATE_CLS[s]}`} data-human-summary-state={s}>
                <T k={HUMAN_ACTION_STATE_LABELS[s]} /> <b className="tabular-nums">{counts[s]}</b>
              </span>
            ))}
            <span className="self-center text-gray-400"><T k="마지막 확인" /> <KDate value={data.generatedAt} mode="datetime" /></span>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {HUMAN_ACTIONS.map((d) => {
              const v = byId.get(d.id);
              const state: HumanActionState | null = v?.state ?? null;
              return (
                <section key={d.id} className="rounded-xl border bg-white p-4" data-human-action={d.id} data-human-state={state ?? 'MISSING'}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] text-gray-500">{d.id} · <T k={HUMAN_PHASE_LABELS[d.phase]} /> · <T k={d.owner} /></p>
                      <h2 className="text-sm font-semibold text-gray-900"><T k={d.title} /></h2>
                      <p className="mt-0.5 text-xs text-gray-500"><T k="막고 있는 것" />: <T k={d.blocks} /></p>
                    </div>
                    {state
                      ? <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${STATE_CLS[state]}`}><T k={HUMAN_ACTION_STATE_LABELS[state]} /></span>
                      // 서버 응답에 이 항목이 없으면(옛 서버) 모른다고
                      : <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-gray-500"><T k="확인 불가" /></span>}
                  </div>
                  {v && v.checks.length > 0 && <ul className="mt-3 space-y-1.5">{v.checks.map((c, i) => <CheckRow key={`${c.code}-${c.target ?? i}`} c={c} />)}</ul>}
                  {!d.derivable && (
                    <p className="mt-3 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600" data-human-manual>
                      <T k="자동으로 판정할 수단이 없습니다 — 사람이 확인합니다(이 화면은 끝났다고 표시하지 않습니다)." />
                    </p>
                  )}
                  {d.manualTail && (
                    <p className="mt-2 text-xs text-amber-800" data-human-manual-tail><T k="그 다음 사람이 할 일" />: <T k={d.manualTail} /></p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {d.links.map((l) => (
                      <Link key={l.href} href={l.href} className="inline-flex min-h-[36px] items-center rounded-lg border border-blue-200 px-2.5 text-xs font-medium text-blue-700 hover:bg-blue-50">
                        <T k={l.label} /> →
                      </Link>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
