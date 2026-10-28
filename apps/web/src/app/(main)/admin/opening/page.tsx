'use client';

/**
 * 개원·운영 단계 (3167) — 병원 업무 이름과 흐름으로.
 *
 * 🔴 이 화면이 하지 않는 것:
 *  ① **완료를 판정하지 않는다.** 연결된 정본이 말해주는 것만 "완료로 읽힘"이라 쓰고,
 *     연결도 기록도 없는 항목은 **"기록 없음"** 이다 — 안 한 것과 모르는 것은 다른 사실이다.
 *  ② **막지 않는다.** 선행 항목은 순서를 보여줄 뿐 뒤 항목을 잠그지 않는다(막으면 우회한다).
 *  ③ **전수라고 말하지 않는다.** 캐비아트를 상시 노출한다.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import {
  AI_ORIGIN_TEXT, type ServerMessage,
  EVIDENCE_EGRESS_NOTICE, EVIDENCE_FIELD_LABEL, extractedCount,
  type EvidenceExtractResult,
} from '@hospital-run/shared';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { ServerText } from '@/components/ui/server-text';

type Stage = 'BEFORE' | 'AT' | 'AFTER';

interface Task {
  /** 🔴 어디서 온 항목인가 — 섞으면 기관이 정한 것을 법정 의무로 읽는다(그 역도 마찬가지) */
  origin: 'REGISTRY' | 'INSTITUTION';
  phase: string; key: string; title: string; owner: string; authority?: string;
  /** 🔴 어느 나라의 항목인가 — 선행을 국가 간에 걸지 않으려면 화면도 이 값을 알아야 한다 */
  countries: string[];
  goLiveKey?: string; decisionKey?: string; committeeCode?: string;
  dependsOn?: string[]; dueBy: string; cycle?: string; note?: string;
  state: 'DERIVED' | 'RECORDED' | 'NOT_RECORDED' | 'NOT_APPLICABLE';
  /** `detailMsg` 가 정본(서버 `{ k, params }`) — `detail` 은 구 응답용 한국어 파생 */
  derived: { source: string; status: string; detail: string | null; detailMsg?: ServerMessage | null; href: string } | null;
  waitingOn: Array<{ key: string; title: string }>;
  record: {
    state: string; evidenceRef: string | null; evidenceDate: string | null;
    note: string | null; recordedAt: string;
    attachments: { id: string; fileName: string; url: string; mimeType: string; sizeBytes: number }[];
  } | null;
}

interface Phase {
  phase: string; label: string; note: string; stage: Stage;
  total: number; knownDone: number; unknown: number; notApplicable: number;
  /** 🔴 분모 중 기관이 추가한 것 — 안 밝히면 법정 항목 분모로 읽힌다 */
  institutional: number;
  tasks: Task[];
}

interface CycleRow {
  code: string; name: string; cycle: string | null;
  periodLabel: string | null;
  periodLabelMsg?: ServerMessage | null;
  /** 🔴 `null` = 판정 대상 아님(수시·미설정) — `false` 와 다른 사실이다 */
  heldThisPeriod: boolean | null;
  lastHeldAt: string | null;
  reason: string | null;
}

interface CycleCompliance {
  rows: CycleRow[];
  summary: { judged: number; withRecord: number; withoutRecord: number; notJudged: number };
  caveat: string;
}

interface Overview {
  phases: Phase[];
  country: string;
  countryNote: string;
  countries: { code: string; label: string }[];
  /** 🔴 설정에서 온 값인가 — 아니면 기본값으로 떨어진 것이다 */
  countryFromConfig: boolean;
  /** 정본에 없는 활성 위원회 — 지우면 위원 명부가 함께 사라진다 */
  codelessCommittees: { name: string; members: number }[];
  dueLabel: Record<string, string>;
  caveat: string;
  /** 🔴 기관이 내려둔 항목 — 목록에서 빠졌지만 없는 것이 아니다 */
  inactiveCustom: { key: string; title: string; phase: string; reason: string | null }[];
  cycleLabel: Record<string, string>;
  phaseOptions: { phase: string; label: string; stage: Stage }[];
  measuredAt: string;
}

const STAGE_LABEL: Record<Stage, string> = { BEFORE: '개원 전', AT: '개원', AFTER: '개원 후' };
const STAGE_NOTE: Record<Stage, string> = {
  BEFORE: '문 열기 전에 끝나야 하는 것들',
  AT: '개원일과 실제로 한 바퀴 돌았는지',
  AFTER: '문 연 뒤에 계속 돌아가는 것들',
};

/** 🔴 상태 어휘 — 화면이 재해석하지 않는다. "완료"라고 단정하는 말을 쓰지 않는다 */
const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  READY: { label: '완료로 읽힘', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  DONE: { label: '완료로 읽힘', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  IN_PROGRESS: { label: '진행 중', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  NOT_READY: { label: '미준비', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  BLOCKED: { label: '막힘', cls: 'bg-red-50 text-red-700 border-red-300' },
};

const SOURCE_LABEL: Record<string, string> = {
  GO_LIVE: '운영 전환 관제',
  DECISION: '결정 등록부',
  COMMITTEE: '위원회 대장',
};

function unwrap<T>(r: unknown): T | undefined {
  return (r as { data?: T } | undefined)?.data;
}

/**
 * 🔴 개원 관제는 경영진(EXECUTIVE)에게도 열려 있지만, 서버의 **쓰기 EP 는 전부 ADMIN 전용**이다
 *    (기록 등록·삭제, 기관 항목 CRUD, 증빙 첨부·판독). 버튼을 그대로 띄우면 누를 때마다 403 이라
 *    화면이 **가진 적 없는 권한을 가진 척**하게 된다 — 쓰기 UI 를 숨기고 읽기 전용임을 밝힌다.
 */
function useOpeningCanWrite(): boolean {
  return useAuthStore((st) => st.user?.role) === 'ADMIN';
}

export default function OpeningPage() {
  const canWrite = useOpeningCanWrite();
  const tAttr = useTAttr();
  const [editing, setEditing] = useState<Task | null>(null);
  /** 기관 항목 추가·수정 — `phase` 만 있으면 신규, `task` 가 있으면 수정 */
  const [customForm, setCustomForm] = useState<{ phase: string; task?: Task } | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  /** 🔴 `null` = 기관 설정을 따른다 · 값 = 사람이 다른 나라를 보려고 고른 것 */
  const [country, setCountry] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['opening', 'overview', country],
    queryFn: () => apiClient.get<{ data: Overview }>('/api/v1/opening', country ? { country } : undefined),
    staleTime: 60_000,
  });
  const data = unwrap<Overview>(q.data);

  // 개원 후 축 — 위원회 주기 준수
  const cycleQ = useQuery({
    queryKey: ['opening', 'committee-cycle'],
    queryFn: () => apiClient.get<{ data: CycleCompliance }>('/api/v1/opening/committee-cycle'),
    staleTime: 60_000,
  });
  const cycle = unwrap<CycleCompliance>(cycleQ.data);

  if (q.isError) return <div className="p-6"><QueryErrorFallback error={q.error} onRetry={() => q.refetch()} /></div>;
  if (q.isLoading) return <div className="p-6 text-sm text-gray-400"><T k="개원 단계 불러오는 중…" /></div>;
  if (!data) return null;

  const stages: Stage[] = ['BEFORE', 'AT', 'AFTER'];

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <header>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-900"><T k="개원·운영 단계" /></h1>
            <p className="text-sm text-gray-500 mt-1">
              <T k="병원이 문을 열기까지와 연 뒤에 해야 하는 일을 업무 이름과 순서로 본다." />
            </p>
          </div>
          {/* 🔴 나라마다 절차가 다르다 — 섞으면 다른 나라 항목이 "안 한 일"로 보인다 */}
          <div className="flex gap-1 shrink-0">
            {data.countries.map((c) => (
              <button key={c.code} onClick={() => setCountry(c.code === data.country ? null : c.code)}
                className={`px-2.5 py-1 rounded-lg text-xs border ${c.code === data.country ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
        {/* 🔴 이 나라가 설정에서 온 것인지 기본값으로 떨어진 것인지 말한다 */}
        <p className="text-[11px] text-gray-500 mt-2">
          {data.countryNote}
          {!data.countryFromConfig && (
            <span className="text-amber-700"> · 기관 국가가 설정되지 않아 기본값으로 보고 있습니다(시스템 설정 <code>hospital.country</code>).</span>
          )}
        </p>
      </header>

      {/* 🔴 전수가 아니라는 사실 — 안 말하면 "이것만 하면 된다"로 읽힌다 */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
        <p className="text-xs text-amber-900">
          {data.caveat}
          {' '}기본 목록에 없는 것은 <b>기관 항목</b>으로 등재할 수 있습니다(보라색 배지로 구분합니다).
        </p>
      </div>

      {/* 🔴 내려둔 항목을 조용히 감추지 않는다 — 목록에서 뺐을 뿐 없는 것이 아니다 */}
      {data.inactiveCustom.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-2.5">
          <button onClick={() => setShowInactive((v) => !v)} className="text-[11px] text-gray-600 hover:underline">
            <T k="내려둔 기관 항목" /> {data.inactiveCustom.length}건 {showInactive ? <T k="접기" /> : <T k="보기" />}
          </button>
          {showInactive && (
            <ul className="mt-2 space-y-1">
              {data.inactiveCustom.map((c) => (
                <li key={c.key} className="flex items-center gap-2 text-[11px] text-gray-600">
                  <span className="flex-1">{c.title}</span>
                  {/* 🔴 사유 없이 내려간 것은 없다(서버가 강제한다) — 그래도 없으면 없다고 쓴다 */}
                  <span className="text-gray-400">{c.reason ?? <T k="사유 미기재" />}</span>
                  <ReactivateButton taskKey={c.key} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {stages.map((st) => {
        const phases = data.phases.filter((p) => p.stage === st);
        if (phases.length === 0) return null;
        return (
          <section key={st} className="space-y-3">
            <div className="flex items-baseline gap-2 border-b border-gray-200 pb-1.5">
              <h2 className="text-base font-bold text-gray-800"><T k={STAGE_LABEL[st]} /></h2>
              <span className="text-xs text-gray-400"><T k={STAGE_NOTE[st]} /></span>
            </div>

            {/* 🔴 정리는 삭제가 아니라 **이관**이다 — 위원 명부가 이쪽에 있다 */}
            {st === 'BEFORE' && phases.some((p) => p.phase === 'O5_GOVERNANCE') && data.codelessCommittees.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <p className="text-xs font-bold text-amber-900">
                  정본에 없는 위원회 {data.codelessCommittees.length}건 — 위원 {data.codelessCommittees.reduce((a, c) => a + c.members, 0)}명이 여기 있다
                </p>
                <p className="text-[11px] text-amber-800 mt-1">
                  코드가 없는 위원회가 남아 있고, <b>위원 명부가 이쪽에 붙어 있다</b>. 정본 위원회는 위원 0명이다 —
                  그래서 정리는 삭제가 아니라 <b>이관</b>이다. 어느 위원회로 합칠지는 사람이 정한다.
                </p>
                <p className="text-[11px] text-amber-700 mt-1.5">
                  {data.codelessCommittees.map((c) => `${c.name}(위원 ${c.members})`).join(' · ')}
                </p>
              </div>
            )}

            {/* 🔴 개원 후 축 — 위원회 주기. "미개최"가 아니라 **기록 없음**이다 */}
            {st === 'AFTER' && (
              cycleQ.isError ? (
                <QueryErrorFallback error={cycleQ.error} onRetry={() => cycleQ.refetch()} size="compact" />
              ) : cycleQ.isLoading ? (
                <p className="text-xs text-gray-400">위원회 주기 확인 중…</p>
              ) : cycle ? (
                <div className="bg-white border border-gray-100 rounded-2xl p-4">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <h3 className="text-sm font-bold text-gray-800"><T k="위원회 정기 회의 — 이번 주기 기록" /></h3>
                    {/* 🔴 분모를 함께. 판정 못 하는 것은 분모 밖이다 */}
                    <p className="text-[11px] text-gray-500 tabular-nums">
                      <T k="기록 있음" /> {cycle.summary.withRecord} / {cycle.summary.judged}
                      {cycle.summary.notJudged > 0 && <span className="text-gray-400"> · <T k="판정 대상 아님" /> {cycle.summary.notJudged}</span>}
                    </p>
                  </div>
                  <ul className="mt-2.5 space-y-1">
                    {cycle.rows.map((r) => (
                      <li key={r.code} className="flex items-center gap-2 text-xs rounded-lg px-2.5 py-1.5 border border-gray-100">
                        <span className="font-mono text-[10px] text-gray-400 w-12 shrink-0">{r.code}</span>
                        <span className="text-gray-800 flex-1 min-w-[8rem]">{r.name}</span>
                        {r.heldThisPeriod === null ? (
                          <span className="text-[10px] text-gray-400">{r.reason}</span>
                        ) : r.heldThisPeriod ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200">
                            <ServerText msg={r.periodLabelMsg} fallback={r.periodLabel} /> <T k="기록 있음" />
                          </span>
                        ) : (
                          /* 🔴 "미개최"라 쓰지 않는다 — 시스템에 안 남았을 뿐일 수 있다 */
                          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200">
                            <ServerText msg={r.periodLabelMsg} fallback={r.periodLabel} /> <T k="기록 없음" />
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400 w-28 text-right shrink-0">
                          {r.lastHeldAt ? `최근 ${r.lastHeldAt.slice(0, 10)}` : <T k="개최 기록 없음" />}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-gray-400 mt-2">{cycle.caveat}</p>
                </div>
              ) : null
            )}

            {phases.map((p) => (
              <div key={p.phase} className="bg-white border border-gray-100 rounded-2xl p-4">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">{p.label}</h3>
                    <p className="text-[11px] text-gray-400 mt-0.5">{p.note}</p>
                  </div>
                  {/* 🔴 기본 목록이 전수가 아니라고 말하면서 정하는 통로가 없었다 — 여기가 그 통로다 */}
                  {canWrite && <button onClick={() => setCustomForm({ phase: p.phase })}
                    className="text-[10px] px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 shrink-0">
                    + <T k="기관 항목 추가" />
                  </button>}
                  {/* 🔴 분모와 함께. "완료 N건"이 아니라 "완료로 읽히는 것 N / 전체 M" 이다 */}
                  <p className="text-[11px] text-gray-500 tabular-nums shrink-0">
                    {p.total === 0 ? (
                      <span className="text-gray-400"><T k="기본 항목 없음" /></span>
                    ) : (
                      <>
                        완료로 읽힘 {p.knownDone} / {p.total}
                        {p.unknown > 0 && <span className="text-gray-400"> · <T k="기록 없음" /> {p.unknown}</span>}
                        {/* 🔴 해당 없음을 완료와 합치지 않는다 — 합치면 분모가 거짓이 된다 */}
                        {p.notApplicable > 0 && <span className="text-sky-600"> · <T k="해당 없음" /> {p.notApplicable}</span>}
                        {/* 🔴 분모의 성격을 밝힌다 — 기관이 정한 것과 기본 목록은 다른 것이다 */}
                        {p.institutional > 0 && <span className="text-violet-600"> · <T k="그중 기관 항목" /> {p.institutional}</span>}
                      </>
                    )}
                  </p>
                </div>

                {p.tasks.length === 0 && (
                  /* 🔴 "없다"가 아니라 "기본 목록이 없다"이다 — 기관이 채우는 자리다 */
                  <p className="mt-2 text-[11px] text-gray-400">
                    <T k="기본 목록이 없는 단계입니다 — 기관이 항목을 정해 등재합니다." />
                  </p>
                )}
                {p.tasks.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {p.tasks.map((t) => {
                      const st2 = t.derived ? STATUS_STYLE[t.derived.status] : null;
                      return (
                        <li key={t.key} className="rounded-xl border border-gray-100 px-3 py-2">
                          <div className="flex items-start gap-2 flex-wrap">
                            <span className="text-xs font-medium text-gray-800 flex-1 min-w-[14rem]">
                              {t.title}
                              {/* 🔴 출처를 밝힌다 — 기관이 정한 것을 법정 의무로 읽으면 안 되고, 그 역도 안 된다 */}
                              {t.origin === 'INSTITUTION' && (
                                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded border bg-violet-50 text-violet-700 border-violet-200 align-middle">
                                  <T k="기관 항목" />
                                </span>
                              )}
                            </span>
                            {st2 ? (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${st2.cls}`}><T k={st2.label} /></span>
                            ) : t.state === 'RECORDED' ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200"><T k="완료 기록됨" /></span>
                            ) : t.state === 'NOT_APPLICABLE' ? (
                              /* 🔴 해당 없음은 완료가 아니다 — 색을 달리해 섞이지 않게 한다 */
                              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-sky-50 text-sky-800 border-sky-200"><T k="해당 없음" /></span>
                            ) : (
                              /* 🔴 "미완료"가 아니다 — 시스템에 기록이 없을 뿐일 수 있다 */
                              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-50 text-gray-500 border-gray-200">
                                <T k="기록 없음" />
                              </span>
                            )}
                            {/* 🔴 파생 항목에는 기록 버튼을 주지 않는다 — 정본이 둘이 된다 */}
                            {!t.derived && (
                              <button onClick={() => canWrite && setEditing(t)} disabled={!canWrite} title={canWrite ? undefined : tAttr('기록 등록은 관리자 권한입니다')} className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                                {t.record ? <T k="수정" /> : <T k="기록@버튼" />}
                              </button>
                            )}
                            {/* 🔴 기본 목록 항목에는 주지 않는다 — 코드 정본은 화면에서 고치는 것이 아니다
                                ("해당 없음"으로 내리는 길은 위 기록 버튼에 이미 있다) */}
                            {t.origin === 'INSTITUTION' && (
                              <CustomTaskActions task={t} onEdit={() => setCustomForm({ phase: t.phase, task: t })} />
                            )}
                          </div>
                          <div className="text-[10px] text-gray-500 mt-1 flex gap-2 flex-wrap">
                            <span><T k="담당@개원" /> {t.owner}</span>
                            {t.authority && <span className="text-gray-400">· <T k="제출처" /> {t.authority}</span>}
                            <span className="text-gray-400">· {data.dueLabel[t.dueBy] ?? t.dueBy}</span>
                            {t.cycle && <span className="text-gray-400">· <T k="주기" /> {data.cycleLabel[t.cycle] ?? t.cycle}</span>}
                          </div>
                          {t.derived && (
                            <div className="text-[10px] text-gray-500 mt-0.5">
                              <T k={SOURCE_LABEL[t.derived.source] ?? t.derived.source} />
                              {(t.derived.detailMsg || t.derived.detail) && <>: <ServerText msg={t.derived.detailMsg} fallback={t.derived.detail} /></>}
                              <Link href={t.derived.href} className="ml-1.5 text-blue-600 hover:underline"><T k="확인" /></Link>
                            </div>
                          )}
                          {/* 🔴 선행은 보여주기만 — 막지 않는다 */}
                          {t.waitingOn.length > 0 && (
                            <p className="text-[10px] text-amber-700 mt-0.5">
                              <T k="선행:" /> {t.waitingOn.map((w) => w.title).join(' · ')} (<T k="막지 않는다 — 순서다" />)
                            </p>
                          )}
                          {t.record && (
                            <p className="text-[10px] text-gray-500 mt-0.5">
                              {t.record.evidenceRef
                                ? `증빙 ${t.record.evidenceRef}`
                                : /* 🔴 증빙을 강제하지 않는다. 대신 없으면 없다고 말한다 */
                                  <T k="증빙 미기재" />}
                              {t.record.evidenceDate && ` · ${t.record.evidenceDate}`}
                              {t.record.note && ` · ${t.record.note}`}
                              {/* 🔴 첨부 0건을 감추지 않는다 — "증빙 있음"으로 읽히면 안 된다 */}
                              {` · 첨부 ${t.record.attachments?.length ?? 0}건`}
                            </p>
                          )}
                          {t.note && <p className="text-[10px] text-gray-400 mt-0.5">{t.note}</p>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </section>
        );
      })}

      {editing && <RecordModal task={editing} onClose={() => setEditing(null)} />}
      {customForm && (
        <CustomTaskModal
          phase={customForm.phase} task={customForm.task} overview={data}
          onClose={() => setCustomForm(null)}
        />
      )}
    </div>
  );
}

/** 개원 항목 사람 기록 — 완료했다 / 이 기관에 해당 없다 */
function RecordModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [state, setState] = useState<'RECORDED' | 'NOT_APPLICABLE'>(
    (task.record?.state as 'RECORDED' | 'NOT_APPLICABLE') ?? 'RECORDED',
  );
  const [evidenceRef, setEvidenceRef] = useState(task.record?.evidenceRef ?? '');
  const [evidenceDate, setEvidenceDate] = useState(task.record?.evidenceDate ?? '');
  const [note, setNote] = useState(task.record?.note ?? '');

  const save = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/opening/tasks/${task.key}/record`, {
      state,
      ...(evidenceRef.trim() ? { evidenceRef: evidenceRef.trim() } : {}),
      ...(evidenceDate ? { evidenceDate } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }),
    onSuccess: () => { toast.success('기록했습니다'); qc.invalidateQueries({ queryKey: ['opening'] }); onClose(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? extractErrorMessage(e) : '기록하지 못했습니다'),
  });
  const clear = useMutation({
    mutationFn: () => apiClient.del(`/api/v1/opening/tasks/${task.key}/record`),
    onSuccess: () => { toast.success('기록을 철회했습니다'); qc.invalidateQueries({ queryKey: ['opening'] }); onClose(); },
  });

  // 🔴 해당 없음은 사유가 있어야 한다 — 사유 없이 지우면 빠뜨린 것과 구분되지 않는다
  const canSave = state === 'RECORDED' || !!note.trim();

  const qcAtt = qc;
  const [uploading, setUploading] = useState(false);
  const [draft, setDraft] = useState<EvidenceExtractResult | null>(null);
  const [extracting, setExtracting] = useState<string | null>(null);
  const atts = task.record?.attachments ?? [];

  /** 🔴 첨부는 **기록이 저장된 뒤**에만 붙는다 — 무엇에 대한 증빙인지가 먼저다 */
  const upload = async (f: File) => {
    if (!task.record) { toast.error('먼저 기록을 저장한 뒤 증빙을 첨부하세요'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      await apiClient.postForm(`/api/v1/opening/tasks/${task.key}/attachments`, fd);
      toast.success('첨부했습니다');
      await qcAtt.invalidateQueries({ queryKey: ['opening'] });
    } catch (e) {
      toast.error(e instanceof Error ? extractErrorMessage(e) : '첨부하지 못했습니다');
    } finally { setUploading(false); }
  };

  /** 🔴 판독은 **초안**이다 — 여기서 저장하지 않는다. 사람이 보고 [입력칸에 담기] 를 누른다 */
  const runExtract = async (id: string) => {
    setExtracting(id);
    setDraft(null);
    try {
      const r = await apiClient.post<{ data: EvidenceExtractResult }>(
        `/api/v1/opening/tasks/${task.key}/attachments/${id}/extract`, {},
      );
      setDraft(unwrap<EvidenceExtractResult>(r) ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? extractErrorMessage(e) : '판독하지 못했습니다');
    } finally { setExtracting(null); }
  };

  /** 🔴 담는 것도 사람이 한다 — 자동으로 칸을 덮지 않는다(고쳐둔 값을 지운다) */
  const applyDraft = () => {
    if (!draft) return;
    if (draft.fields.evidenceRef) setEvidenceRef(draft.fields.evidenceRef);
    if (draft.fields.evidenceDate) setEvidenceDate(draft.fields.evidenceDate);
    toast.success('입력칸에 담았습니다 — 확인하고 저장하세요');
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900">{task.title}</h3>
        <p className="text-[11px] text-gray-400"><T k="담당@개원" /> {task.owner}{task.authority ? ` · 제출처 ${task.authority}` : ''}</p>

        <div className="flex gap-2">
          {(['RECORDED', 'NOT_APPLICABLE'] as const).map((v) => (
            <button key={v} onClick={() => setState(v)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs border ${state === v ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600'}`}>
              {v === 'RECORDED' ? <T k="완료했다" /> : <T k="이 기관에 해당 없다" />}
            </button>
          ))}
        </div>

        {state === 'RECORDED' && (
          <>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">
                <T k="증빙 참조" /> <span className="text-gray-400"><T k="— 신고증·문서 번호 (선택)" /></span>
              </label>
              <input value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="증빙 일자 (선택)" /></label>
              <input type="date" value={evidenceDate} onChange={(e) => setEvidenceDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          </>
        )}

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">
            {state === 'NOT_APPLICABLE' ? <T k="사유 *" /> : <T k="비고 (선택)" />}
          </label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            placeholder={state === 'NOT_APPLICABLE' ? tAttr('왜 이 기관에 해당하지 않는지') : ''}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>

        {/* ── 증빙 첨부 ── */}
        {state === 'RECORDED' && (
          <div className="border-t border-gray-100 pt-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-medium text-gray-500"><T k="증빙 자료 (선택)" /></label>
              <label className={`text-[11px] px-2 py-1 rounded-lg border cursor-pointer ${task.record ? 'border-gray-200 text-gray-600 hover:bg-gray-50' : 'border-gray-100 text-gray-300 cursor-not-allowed'}`}>
                {uploading ? <T k="올리는 중…" /> : <T k="파일 첨부" />}
                <input type="file" className="hidden" disabled={!task.record || uploading}
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
              </label>
            </div>
            {/* 🔴 기록 전에는 붙일 수 없다는 사실을 그 자리에서 말한다 */}
            {!task.record && <p className="text-[10px] text-amber-700 mt-1"><T k="기록을 먼저 저장해야 증빙을 붙일 수 있습니다." /></p>}

            {atts.length === 0 ? (
              <p className="text-[10px] text-gray-400 mt-1.5"><T k="첨부 없음" /></p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {atts.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-[11px] border border-gray-100 rounded-lg px-2 py-1.5">
                    <a href={a.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-blue-600 hover:underline">{a.fileName}</a>
                    <span className="text-[10px] text-gray-400 shrink-0">{Math.round(a.sizeBytes / 1024)}KB</span>
                    <button onClick={() => void runExtract(a.id)} disabled={extracting === a.id}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-amber-200 text-amber-800 bg-amber-50 disabled:opacity-50">
                      {extracting === a.id ? <T k="판독 중…" /> : `${AI_ORIGIN_TEXT} 판독`}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* 🔴 판독 결과 — 3상태를 뭉개지 않는다. 못 읽었으면 이유를 말한다 */}
            {draft && (
              <div className="mt-2 flex gap-0 rounded-xl overflow-hidden border border-amber-200">
                <div className="w-1 bg-amber-400 shrink-0" />
                <div className="flex-1 bg-amber-50/50 p-2.5">
                  <p className="text-[11px] font-bold text-amber-900">
                    {AI_ORIGIN_TEXT} 판독 초안 {draft.fileName && <span className="font-normal text-amber-700">· {draft.fileName}</span>}
                  </p>
                  {draft.source === 'UNAVAILABLE' ? (
                    <p className="text-[11px] text-amber-800 mt-1">{draft.reason}</p>
                  ) : extractedCount(draft.fields) === 0 ? (
                    /* 🔴 "읽었는데 아무것도 없었다"와 "못 읽었다"는 다른 사실이다 */
                    <p className="text-[11px] text-amber-800 mt-1"><T k="문서에서 채울 수 있는 칸을 찾지 못했습니다 — 직접 입력하세요." /></p>
                  ) : (
                    <>
                      <ul className="mt-1 space-y-0.5">
                        {(Object.keys(draft.fields) as (keyof typeof draft.fields)[]).map((k) => (
                          <li key={k} className="text-[11px] text-amber-900">
                            <span className="text-amber-700">{EVIDENCE_FIELD_LABEL[k]}</span> {draft.fields[k]}
                          </li>
                        ))}
                      </ul>
                      <button onClick={applyDraft}
                        className="mt-1.5 text-[11px] px-2 py-1 rounded-lg bg-amber-600 text-white"><T k="입력칸에 담기" /></button>
                    </>
                  )}
                  <p className="text-[10px] text-amber-700/80 mt-1.5">{EVIDENCE_EGRESS_NOTICE}</p>
                </div>
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-gray-400">
          🔴 <T k="이 기록은 시스템이 확인한 것이 아니라" /> <b><T k="담당자가 남긴 것" /></b><T k="입니다. 증빙은 강제하지 않습니다." />
        </p>

        <div className="flex gap-2 pt-1">
          {task.record && (
            <button onClick={() => clear.mutate()} disabled={clear.isPending}
              className="min-h-[44px] px-3 py-2 text-xs text-red-600 hover:bg-red-50 rounded-lg"><T k="기록 철회" /></button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-2 text-xs text-gray-500"><T k="취소" /></button>
          <button onClick={() => save.mutate()} disabled={!canSave || save.isPending}
            className="min-h-[44px] px-4 py-2 text-xs bg-gray-900 text-white rounded-lg disabled:opacity-40"><T k="저장" /></button>
        </div>
      </div>
    </div>
  );
}

/**
 * 기관 항목 조작 — 수정 · 내리기 · 삭제.
 *
 * 🔴 **삭제와 내리기를 다른 버튼으로 둔다.** 하나로 묶으면 사람이 "정리"라 생각하고
 *    누른 것이 기록까지 지운다. 삭제는 서버가 **기록이 하나도 없을 때만** 받는다.
 */
function CustomTaskActions({ task, onEdit }: { task: Task; onEdit: () => void }) {
  const canWrite = useOpeningCanWrite();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['opening', 'overview'] });

  const down = useMutation({
    mutationFn: (reason: string) =>
      apiClient.patch(`/api/v1/opening/custom-tasks/${task.key}/active`, { isActive: false, reason }),
    onSuccess: () => { toast.success('항목을 내렸습니다'); invalidate(); },
    onError: (e: Error) => toast.error(extractErrorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => apiClient.del(`/api/v1/opening/custom-tasks/${task.key}`),
    onSuccess: () => { toast.success('항목을 지웠습니다'); invalidate(); },
    // 🔴 서버가 거절한 이유를 그대로 보여준다("기록이 있으면 지우지 않는다")
    onError: (e: Error) => toast.error(extractErrorMessage(e)),
  });

  if (!canWrite) return null;

  return (
    <>
      <button onClick={onEdit} className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">
        <T k="항목 수정" />
      </button>
      <button
        onClick={() => {
          // 🔴 사유를 받아서 보낸다 — 사유 없이 내리면 "빠뜨린 것"과 구분되지 않는다(서버도 강제한다)
          const reason = window.prompt('이 항목을 내리는 사유를 적어주세요 (기록은 남습니다)');
          if (reason?.trim()) down.mutate(reason.trim());
        }}
        disabled={down.isPending}
        className="min-h-[44px] text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
        <T k="내리기" />
      </button>
      <button
        onClick={() => { if (window.confirm(`"${task.title}" 을(를) 지웁니다. 기록이 있으면 서버가 거절합니다.`)) del.mutate(); }}
        disabled={del.isPending}
        className="min-h-[44px] text-[10px] px-1.5 py-0.5 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
        <T k="삭제" />
      </button>
    </>
  );
}

/** 내려둔 항목 다시 올리기 — 🔴 올릴 때는 사유를 묻지 않는다(사유는 내릴 때의 사실이다) */
function ReactivateButton({ taskKey }: { taskKey: string }) {
  const canWrite = useOpeningCanWrite();
  const qc = useQueryClient();
  const up = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/opening/custom-tasks/${taskKey}/active`, { isActive: true }),
    onSuccess: () => { toast.success('항목을 다시 올렸습니다'); qc.invalidateQueries({ queryKey: ['opening', 'overview'] }); },
    onError: (e: Error) => toast.error(extractErrorMessage(e)),
  });
  if (!canWrite) return null;
  return (
    <button onClick={() => up.mutate()} disabled={up.isPending}
      className="min-h-[44px] text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
      <T k="다시 올리기" />
    </button>
  );
}

/**
 * 기관 항목 추가·수정.
 *
 * 🔴 이 폼이 **주지 않는 것**: 연결 키(운영 전환 관제·결정 등록부·위원회 대장) 입력란.
 *    기관이 남의 상태를 자기 항목 상태로 끌어오면 화면이 거짓말한다 — 서버도 받지 않는다.
 * 🔴 **쓰기 폼의 초기값은 "미선택"** 이 원칙이지만, 단계는 사람이 그 단계의 버튼을 눌러
 *    들어온 것이라 이미 고른 값이다(추측이 아니다).
 */
function CustomTaskModal({
  phase, task, overview, onClose,
}: { phase: string; task?: Task; overview: Overview; onClose: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    phase: task?.phase ?? phase,
    title: task?.title ?? '',
    owner: task?.owner ?? '',
    authority: task?.authority ?? '',
    // 🔴 지금 보고 있는 나라로 시작한다 — 국가가 다르면 절차가 다르다
    countries: task?.countries ?? [overview.country],
    dueBy: task?.dueBy ?? '',
    cycle: task?.cycle ?? '',
    note: task?.note ?? '',
    dependsOn: task?.dependsOn ?? [],
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        phase: form.phase, title: form.title.trim(), owner: form.owner.trim(),
        countries: form.countries, dueBy: form.dueBy,
        // 🔴 빈 문자열을 보내지 않는다 — 서버가 "모르는 것"과 "빈 값을 적은 것"을 가른다
        authority: form.authority.trim() || undefined,
        cycle: form.cycle || undefined,
        note: form.note.trim() || undefined,
        dependsOn: form.dependsOn,
      };
      return task
        ? apiClient.patch(`/api/v1/opening/custom-tasks/${task.key}`, body)
        : apiClient.post('/api/v1/opening/custom-tasks', body);
    },
    onSuccess: () => {
      toast.success(task ? '항목을 고쳤습니다' : '항목을 등재했습니다');
      qc.invalidateQueries({ queryKey: ['opening', 'overview'] });
      onClose();
    },
    // 🔴 서버가 거절한 사유(국가 간 선행·주기 모순 등)를 그대로 보여준다
    onError: (e: Error) => toast.error(extractErrorMessage(e)),
  });

  /** 선행 후보 — 🔴 **같은 나라 항목만**. 다른 나라를 고를 수 있게 두면 서버가 거절할 것을 권한 셈이다 */
  const dependCandidates = overview.phases
    .flatMap((p) => p.tasks)
    .filter((t) => t.key !== task?.key && t.countries?.some((c) => form.countries.includes(c)));

  const ready = form.title.trim() && form.owner.trim() && form.dueBy && form.countries.length > 0;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-3" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-sm font-bold text-gray-800">{task ? <T k="기관 항목 수정" /> : <T k="기관 항목 추가" />}</h3>
          {/* 🔴 이 화면이 무엇을 할 수 없는지 그 자리에서 말한다 */}
          <p className="text-[11px] text-gray-500 mt-1">
            기본 목록에 없는 것을 기관이 등재합니다. 상태는 <b>사람 기록</b>으로만 남습니다 —
            운영 전환 관제·결정 등록부·위원회 대장에 <b>연결할 수 없습니다</b>(다른 정본의 상태를 끌어오지 않습니다).
          </p>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="단계" /></label>
          <select value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
            {overview.phaseOptions.map((o) => (
              <option key={o.phase} value={o.phase}>{tAttr(STAGE_LABEL[o.stage])} · {o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="항목 이름 *" /></label>
          {/* 🔴 실무 명칭 그대로 — 전산 용어로 바꾸지 않는다 */}
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200}
            placeholder={tAttr('업무에서 부르는 이름 그대로')}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="담당(역할·부서) *" /></label>
            <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} maxLength={100}
              placeholder={tAttr('사람 이름이 아니라 역할')}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="제출처 (선택)" /></label>
            {/* 🔴 강제하지 않는다 — 필수로 만들면 아무 값이나 채워진다 */}
            <input value={form.authority} onChange={(e) => setForm({ ...form, authority: e.target.value })} maxLength={200}
              placeholder={tAttr('모르면 비워둡니다')}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="어느 나라의 항목인가 *" /></label>
          <div className="flex gap-2 flex-wrap">
            {overview.countries.map((c) => {
              const on = form.countries.includes(c.code);
              return (
                <button key={c.code} type="button"
                  onClick={() => setForm({
                    ...form,
                    countries: on ? form.countries.filter((x) => x !== c.code) : [...form.countries, c.code],
                    // 🔴 나라를 바꾸면 다른 나라 선행이 남을 수 있다 — 그 자리에서 턴다(국가 간 선행 금지)
                    dependsOn: [],
                  })}
                  className={`px-3 py-1.5 rounded-lg text-xs border ${on ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600'}`}>
                  {c.label}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-400 mt-1"><T k={'비워둘 수 없습니다 — 비면 "모든 나라"인지 "아직 안 정했는지" 구분되지 않습니다.'} /></p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="언제까지 *" /></label>
            {/* 🔴 초기값은 미선택 — 표시보다 저장이 더 위험하다 */}
            <select value={form.dueBy}
              onChange={(e) => setForm({ ...form, dueBy: e.target.value, cycle: e.target.value === 'RECURRING' ? form.cycle : '' })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="">{tAttr('선택하세요')}</option>
              {Object.entries(overview.dueLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="주기" /></label>
            <select value={form.cycle} onChange={(e) => setForm({ ...form, cycle: e.target.value })}
              disabled={form.dueBy !== 'RECURRING'}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400">
              {/* 🔴 주기 반복인데 주기를 모를 수 있다 — 강제하지 않고 "미설정"으로 남긴다 */}
              <option value="">{form.dueBy === 'RECURRING' ? tAttr('미설정 (모르면 비워둡니다)') : tAttr('주기 반복 항목만')}</option>
              {Object.entries(overview.cycleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="선행 항목 (선택)" /></label>
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v && !form.dependsOn.includes(v)) setForm({ ...form, dependsOn: [...form.dependsOn, v] });
            }}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
            <option value="">{tAttr('추가할 선행 항목…')}</option>
            {dependCandidates.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
          </select>
          {form.dependsOn.length > 0 && (
            <div className="flex gap-1 flex-wrap mt-1.5">
              {form.dependsOn.map((k) => {
                const t = dependCandidates.find((c) => c.key === k);
                return (
                  <button key={k} type="button"
                    onClick={() => setForm({ ...form, dependsOn: form.dependsOn.filter((x) => x !== k) })}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">
                    {t?.title ?? k} ✕
                  </button>
                );
              })}
            </div>
          )}
          {/* 🔴 막지 않는다는 사실을 그 자리에서 말한다 — 막는 줄 알면 사람이 우회한다 */}
          <p className="text-[10px] text-gray-400 mt-1">
            <T k="순서를 보여줄 뿐 뒤 항목을 막지 않습니다. 같은 나라 항목만 걸 수 있습니다." />
          </p>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="비고 (선택)" /></label>
          <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg text-xs border border-gray-200 text-gray-600"><T k="닫기" /></button>
          <button onClick={() => save.mutate()} disabled={!ready || save.isPending}
            className="min-h-[44px] flex-1 px-3 py-2 rounded-lg text-xs bg-gray-900 text-white disabled:opacity-40">
            {save.isPending ? <T k="저장 중…" /> : task ? <T k="고치기" /> : <T k="등재" />}
          </button>
        </div>
      </div>
    </div>
  );
}
