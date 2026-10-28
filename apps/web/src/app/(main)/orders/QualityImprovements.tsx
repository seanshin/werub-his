'use client';

/**
 * 질 개선 활동(PDCA · 2026-10-07) — 지표 신호 → 계획 → 실행 → 효과 확인 → 표준화 → 종결.
 *
 * 🔴 기준선·효과 확인 수는 서버가 원장에서 다시 센다 — 이 화면은 기간만 보낸다.
 * 🔴 효과는 차이(%p)와 95% 구간 · 구간이 0 을 포함하면 "변화 확인 불가" · 작은 표본이면 그렇다고 · 좋고 나쁨은 지표 방향이 등재된 경우만.
 * 🔴 쓰기(시작·단계·메모·효과 확인)는 관리자 — 서버 @Roles(ADMIN) 와 같은 판정(useHasRole() = ADMIN).
 * 2026-10-08 QI 흐름 — CPOE 지표(indicatorKey)뿐 아니라 질 지표 원장의 일반 지표(indicatorId)도 같은 부품으로.
 *   공급원이 있는 지표는 서버가 다시 세고, 공급원 없는 수기 지표는 사람이 센 분자·분모를 받는다(출처 MANUAL 로 남는다).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  canTransitQiAction, cpoeQiDef, formatNum, joinPatientName, QI_ACTION_STATUS_LABEL, QI_ACTION_TRANSITIONS,
  type CpoeQiKey, type ProportionDiff, type QiActionStatus,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate, Ratio } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface Effect { diff: ProportionDiff | null; direction: string | null; favorable: boolean | null }
interface ActionRow {
  id: string; indicatorKey: CpoeQiKey | null; indicatorId?: string | null; indicatorName?: string | null; baselineSource?: string | null; title: string; status: QiActionStatus; ownerName: string | null; dueDate: string | null; triggerPeriod: string | null;
  baselineFrom: string; baselineTo: string; baselineNumerator: number; baselineDenominator: number;
  lastCheck: { at: string; from: string; to: string; numerator: number; denominator: number } | null; effect: Effect | null;
}
interface ActionDetail extends Omit<ActionRow, 'lastCheck' | 'ownerName'> {
  problem: string; rootCause: string | null; plan: string; ownerId: string | null; createdBy: string;
  names: Record<string, string>;
  events: { id: string; kind: string; fromStatus: string | null; toStatus: string | null; note: string | null; checkFrom: string | null; checkTo: string | null; checkNumerator: number | null; checkDenominator: number | null; actorId: string; at: string }[];
}

const STATUS_TONE: Record<QiActionStatus, string> = {
  PLAN: 'bg-sky-100 text-sky-800', DO: 'bg-indigo-100 text-indigo-800', CHECK: 'bg-amber-100 text-amber-800',
  ACT: 'bg-emerald-100 text-emerald-800', CLOSED: 'bg-gray-200 text-gray-700', CANCELLED: 'bg-gray-100 text-gray-400',
};
const pp = (v: number) => formatNum(v * 100, 'percentPoint');
/** 기간 끝(배타) → 그 날 포함 표시용 마지막 날 */
const lastDay = (iso: string) => new Date(new Date(iso).getTime() - 1).toISOString();

export function EffectText({ effect }: { effect: Effect | null }) {
  if (!effect) return <span className="text-gray-400" data-qi-effect="none"><T k="효과 확인 전" /></span>;
  if (!effect.diff) return <span className="text-gray-400" data-qi-effect="na"><T k="비교 불가(대상 0)" /></span>;
  const d = effect.diff;
  return (
    <span data-qi-effect={effect.favorable == null ? (d.includesZero ? 'unclear' : 'undirected') : effect.favorable ? 'favorable' : 'unfavorable'}>
      <b className="tabular-nums">{d.diff > 0 ? '+' : ''}{pp(d.diff)}</b>
      <span className="text-gray-400"> (95% {pp(d.low)} ~ {pp(d.high)})</span>
      {' · '}
      {d.includesZero
        ? <span className="text-gray-500"><T k="변화 확인 불가" /></span>
        : effect.favorable == null
          ? <span className="text-gray-500"><T k="방향 미정 지표" /></span>
          : effect.favorable
            ? <span className="font-semibold text-emerald-700"><T k="바람직한 쪽 변화" /></span>
            : <span className="font-semibold text-rose-700"><T k="바람직하지 않은 쪽 변화" /></span>}
      {d.small && <span className="ml-1 text-amber-700"><T k="표본 작음" /></span>}
    </span>
  );
}

export function ImprovementCreateForm({ indicatorKey, indicatorId, indicatorLabel, manualCounts = false, triggerPeriod, defaultFrom, defaultTo, onClose }: {
  /** CPOE 지표 또는 질 지표 원장 지표 — 하나만 */
  indicatorKey?: CpoeQiKey; indicatorId?: string; indicatorLabel?: string;
  /** 공급원 없는 수기 지표 — 기준선 분자·분모를 사람이 넣는다 */
  manualCounts?: boolean;
  triggerPeriod?: string; defaultFrom: string; defaultTo: string; onClose: () => void;
}) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const label = indicatorKey ? cpoeQiDef(indicatorKey)?.label ?? indicatorKey : indicatorLabel ?? '';
  // 🔴 쓰기 폼은 미선택·빈칸으로 시작한다(분자·분모를 지어 넣지 않는다)
  const [f, setF] = useState({
    title: '', problem: triggerPeriod ? tAttr('관리도 신호') + ` ${triggerPeriod}` : '', rootCause: '', plan: '', ownerId: '', dueDate: '',
    baselineFrom: defaultFrom, baselineTo: defaultTo, baselineNumerator: '', baselineDenominator: '',
  });
  // 서버 @Roles(ADMIN) 와 같은 판정(useHasRole() = ADMIN) — 시작·담당자 목록
  const canCreate = useHasRole();
  const users = useQuery({
    enabled: canCreate,
    queryKey: ['qi-owner-candidates'],
    queryFn: () => apiClient.get<{ data: { id: string; familyName?: string; givenName?: string; role?: string }[] }>('/api/v1/users?limit=200').then((r) => r.data ?? []),
  });
  const create = useMutation({
    mutationFn: () => {
      if (!canCreate) throw new Error(tAttr('개선 활동은 관리자가 시작합니다.'));
      return apiClient.post('/api/v1/orders/quality/improvements', {
      ...(indicatorKey ? { indicatorKey } : { indicatorId }), title: f.title, problem: f.problem, plan: f.plan, baselineFrom: f.baselineFrom, baselineTo: f.baselineTo,
      ...(f.rootCause.trim() ? { rootCause: f.rootCause } : {}), ...(f.ownerId ? { ownerId: f.ownerId } : {}),
      ...(f.dueDate ? { dueDate: f.dueDate } : {}), ...(triggerPeriod ? { triggerPeriod } : {}),
      ...(manualCounts ? { baselineNumerator: Number(f.baselineNumerator), baselineDenominator: Number(f.baselineDenominator) } : {}),
      });
    },
    onSuccess: () => { toast.success(tAttr('개선 활동을 시작했습니다 — 기준선은 서버가 셌습니다.')); qc.invalidateQueries({ queryKey: ['qi-improvements'] }); onClose(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('개선 활동을 시작하지 못했습니다.')),
  });
  const countsOk = !manualCounts || (/^\d+$/.test(f.baselineNumerator) && /^\d+$/.test(f.baselineDenominator) && Number(f.baselineDenominator) > 0);
  const ready = f.title.trim() && f.problem.trim() && f.plan.trim() && f.baselineFrom && f.baselineTo && countsOk;
  if (!canCreate) return null;
  const input = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm';
  return (
    <section className="space-y-2 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm" data-qi-improve-form={indicatorKey ?? indicatorId}>
      <div className="flex items-center gap-2">
        <p className="text-sm font-bold text-gray-900"><T k="개선 활동 시작" /> — {indicatorKey ? <T k={label} /> : label}</p>
        <button type="button" onClick={onClose} className="ml-auto rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100" aria-label="close">✕</button>
      </div>
      <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={tAttr('제목')} aria-label={tAttr('제목')} className={input} />
      <textarea value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} placeholder={tAttr('문제 — 무엇이 신호였나')} aria-label={tAttr('문제')} rows={2} className={input} />
      <textarea value={f.rootCause} onChange={(e) => setF({ ...f, rootCause: e.target.value })} placeholder={tAttr('원인 분석(선택)')} aria-label={tAttr('원인 분석')} rows={2} className={input} />
      <textarea value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} placeholder={tAttr('개선 계획 — 무엇을 바꿀지')} aria-label={tAttr('개선 계획')} rows={2} className={input} />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1"><T k="담당" />
          <select value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })} className="rounded-lg border border-gray-200 px-2 py-1.5" data-qi-owner>
            <option value="">{tAttr('미지정')}</option>
            {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{joinPatientName(u.familyName, u.givenName)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1"><T k="기한" /><input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} className="rounded-lg border border-gray-200 px-2 py-1" /></label>
        <label className="flex items-center gap-1"><T k="기준선" />
          <input type="date" value={f.baselineFrom} onChange={(e) => setF({ ...f, baselineFrom: e.target.value })} aria-label={tAttr('기준선 시작일')} className="rounded-lg border border-gray-200 px-2 py-1" />
          ~<input type="date" value={f.baselineTo} onChange={(e) => setF({ ...f, baselineTo: e.target.value })} aria-label={tAttr('기준선 종료일')} className="rounded-lg border border-gray-200 px-2 py-1" />
        </label>
      </div>
      {manualCounts && (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-qi-manual-baseline>
          <T k="기준선 분자" />
          <input inputMode="numeric" value={f.baselineNumerator} onChange={(e) => setF({ ...f, baselineNumerator: e.target.value })} aria-label={tAttr('기준선 분자')} className="w-24 rounded-lg border border-gray-200 px-2 py-1" />
          <T k="분모" />
          <input inputMode="numeric" value={f.baselineDenominator} onChange={(e) => setF({ ...f, baselineDenominator: e.target.value })} aria-label={tAttr('기준선 분모')} className="w-24 rounded-lg border border-gray-200 px-2 py-1" />
          <span className="text-[10px] text-amber-700"><T k="자동 산출 공급원이 없는 지표입니다 — 사람이 센 수로 기록되고 출처가 '수기'로 남습니다." /></span>
        </div>
      )}
      {users.isError && <p className="text-[11px] text-amber-700"><T k="담당자 목록을 불러오지 못했습니다 — 미지정으로 시작할 수 있습니다." /></p>}
      <div className="flex items-center gap-2">
        <button type="button" disabled={!ready || create.isPending} onClick={() => create.mutate()} data-qi-improve-submit
          className="min-h-[44px] rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-40">
          <T k="시작" />
        </button>
        <span className="text-[10px] text-gray-400"><T k={manualCounts ? '효과 확인도 같은 방식(사람이 센 수)으로 합니다.' : '기준선 수는 서버가 그 기간을 병원 전체로 셉니다 — 대상이 없는 기간은 거절됩니다.'} /></span>
      </div>
    </section>
  );
}

function ActionDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  // 서버 @Roles(ADMIN) 와 같은 판정 — 단계·메모·효과 확인
  const canWrite = useHasRole();
  const q = useQuery({
    queryKey: ['qi-improvement', id],
    queryFn: () => apiClient.get<{ data: ActionDetail }>(`/api/v1/orders/quality/improvements/${id}`).then((r) => r.data),
  });
  const [note, setNote] = useState('');
  const [check, setCheck] = useState({ from: '', to: '', numerator: '', denominator: '' });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['qi-improvement', id] }); qc.invalidateQueries({ queryKey: ['qi-improvements'] }); };
  const transit = useMutation({
    mutationFn: (to: QiActionStatus) => {
      if (!canWrite) throw new Error(tAttr('단계는 관리자가 바꿉니다.'));
      return apiClient.post(`/api/v1/orders/quality/improvements/${id}/transition`, { to, ...(note.trim() ? { note } : {}) });
    },
    onSuccess: () => { toast.success(tAttr('단계를 바꿨습니다.')); setNote(''); refresh(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('단계를 바꾸지 못했습니다.')),
  });
  const addNote = useMutation({
    mutationFn: () => {
      if (!canWrite) throw new Error(tAttr('메모는 관리자가 남깁니다.'));
      return apiClient.post(`/api/v1/orders/quality/improvements/${id}/notes`, { note });
    },
    onSuccess: () => { setNote(''); refresh(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('메모를 남기지 못했습니다.')),
  });
  const runCheck = useMutation({
    mutationFn: () => {
      if (!canWrite) throw new Error(tAttr('효과 확인은 관리자가 합니다.'));
      const manual = q.data?.baselineSource === 'MANUAL';
      return apiClient.post(`/api/v1/orders/quality/improvements/${id}/checks`, {
        from: check.from, to: check.to, ...(note.trim() ? { note } : {}),
        ...(manual ? { numerator: Number(check.numerator), denominator: Number(check.denominator) } : {}),
      });
    },
    onSuccess: () => { toast.success(tAttr('효과를 다시 쟀습니다.')); setNote(''); refresh(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('효과를 재지 못했습니다.')),
  });
  const a = q.data;
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />;
  if (!a) return <div className="h-32 animate-pulse rounded-xl bg-gray-100" />;
  const name = (uid: string | null) => (uid ? a.names[uid] ?? '—' : '—');
  const next = QI_ACTION_TRANSITIONS[a.status];
  return (
    <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3" data-qi-improve-detail={id}>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[a.status]}`}><T k={QI_ACTION_STATUS_LABEL[a.status]} /></span>
        <p className="text-sm font-bold text-gray-900">{a.title}</p>
        <button type="button" onClick={onClose} className="ml-auto text-xs text-gray-500"><T k="닫기" /></button>
      </div>
      <dl className="grid gap-1 text-xs sm:grid-cols-[6rem_1fr]">
        <dt className="text-gray-400"><T k="문제" /></dt><dd className="whitespace-pre-wrap text-gray-800">{a.problem}</dd>
        <dt className="text-gray-400"><T k="원인 분석" /></dt><dd className="whitespace-pre-wrap text-gray-800">{a.rootCause ?? <span className="text-gray-400"><T k="기록 없음" /></span>}</dd>
        <dt className="text-gray-400"><T k="개선 계획" /></dt><dd className="whitespace-pre-wrap text-gray-800">{a.plan}</dd>
        <dt className="text-gray-400"><T k="기준선" /></dt>
        <dd><KDate value={a.baselineFrom} /> ~ <KDate value={lastDay(a.baselineTo)} /> · <Ratio numerator={a.baselineNumerator} denominator={a.baselineDenominator} /></dd>
        <dt className="text-gray-400"><T k="효과" /></dt><dd><EffectText effect={a.effect} /></dd>
      </dl>
      <ol className="space-y-1 border-l-2 border-gray-200 pl-3 text-xs" data-qi-improve-events>
        {a.events.map((e) => (
          <li key={e.id} data-qi-event={e.kind}>
            <span className="tabular-nums text-gray-400"><KDate value={e.at} mode="datetimeShort" /></span>{' '}
            <span className="text-gray-500">{name(e.actorId)}</span>{' · '}
            {e.kind === 'CREATED' && <T k="시작" />}
            {e.kind === 'STATUS' && <>{e.fromStatus && <T k={QI_ACTION_STATUS_LABEL[e.fromStatus as QiActionStatus] ?? e.fromStatus} />} → <b><T k={QI_ACTION_STATUS_LABEL[e.toStatus as QiActionStatus] ?? String(e.toStatus)} /></b></>}
            {e.kind === 'NOTE' && <T k="메모" />}
            {e.kind === 'CHECK' && e.checkFrom && e.checkTo && (
              <><T k="효과 확인" /> <KDate value={e.checkFrom} /> ~ <KDate value={lastDay(e.checkTo)} /> · <Ratio numerator={e.checkNumerator} denominator={e.checkDenominator} /></>
            )}
            {e.note && <p className="whitespace-pre-wrap text-gray-700">{e.note}</p>}
          </li>
        ))}
      </ol>
      {canWrite && next.length > 0 && (
        <div className="space-y-2 border-t border-gray-100 pt-2">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} aria-label={tAttr('메모·사유')}
            placeholder={tAttr('메모·사유(종결·취소에는 필수)')} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" />
          <div className="flex flex-wrap items-center gap-1.5">
            {next.map((to) => (
              <button key={to} type="button" disabled={transit.isPending || !canTransitQiAction(a.status, to)} onClick={() => transit.mutate(to)} data-qi-transit={to}
                className={`min-h-[44px] rounded-lg px-3 text-xs font-semibold ${to === 'CANCELLED' ? 'border border-gray-300 text-gray-600' : 'bg-gray-900 text-white'} disabled:opacity-40`}>
                → <T k={QI_ACTION_STATUS_LABEL[to]} />
              </button>
            ))}
            <button type="button" disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate()} className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs text-gray-700 disabled:opacity-40" data-qi-note>
              <T k="메모만 남기기" />
            </button>
          </div>
          {(['DO', 'CHECK', 'ACT'] as QiActionStatus[]).includes(a.status) && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs" data-qi-check-form>
              <T k="효과 확인 기간" />
              <input type="date" value={check.from} onChange={(e) => setCheck({ ...check, from: e.target.value })} aria-label={tAttr('효과 확인 시작일')} className="rounded-lg border border-gray-200 px-2 py-1" />
              ~<input type="date" value={check.to} onChange={(e) => setCheck({ ...check, to: e.target.value })} aria-label={tAttr('효과 확인 종료일')} className="rounded-lg border border-gray-200 px-2 py-1" />
              {a.baselineSource === 'MANUAL' && (
                <>
                  <input inputMode="numeric" value={check.numerator} onChange={(e) => setCheck({ ...check, numerator: e.target.value })} aria-label={tAttr('분자')} placeholder={tAttr('분자')} className="w-20 rounded-lg border border-gray-200 px-2 py-1" />
                  /<input inputMode="numeric" value={check.denominator} onChange={(e) => setCheck({ ...check, denominator: e.target.value })} aria-label={tAttr('분모')} placeholder={tAttr('분모')} className="w-20 rounded-lg border border-gray-200 px-2 py-1" />
                </>
              )}
              <button type="button" disabled={!check.from || !check.to || runCheck.isPending || (a.baselineSource === 'MANUAL' && !(Number(check.denominator) > 0 && /^\d+$/.test(check.numerator)))} onClick={() => runCheck.mutate()} data-qi-check-run
                className="min-h-[44px] rounded-lg bg-amber-500 px-3 font-semibold text-white disabled:opacity-40">
                <T k="효과 다시 재기" />
              </button>
              <span className="text-[10px] text-gray-400"><T k={a.baselineSource === 'MANUAL' ? '기준선이 끝난 뒤 기간만 · 사람이 센 수(수기)' : '기준선이 끝난 뒤 기간만 · 서버가 다시 셉니다'} /></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ImprovementsSection({ indicatorId }: { indicatorId?: string } = {}) {
  const [status, setStatus] = useState<'OPEN' | ''>('OPEN');
  const [openId, setOpenId] = useState<string | null>(null);
  // 서버 @Roles(ADMIN·DOCTOR) 와 같은 판정 — 권한 밖이면 부르지 않는다
  const canView = useHasRole('DOCTOR');
  const q = useQuery({
    enabled: canView,
    queryKey: ['qi-improvements', status, indicatorId ?? null],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (indicatorId) qs.set('indicatorId', indicatorId);
      const s = qs.toString();
      return apiClient.get<{ data: ActionRow[] }>(`/api/v1/orders/quality/improvements${s ? `?${s}` : ''}`).then((r) => r.data ?? []);
    },
  });
  if (!canView) return null;
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm" data-qi-improvements>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-xs font-bold text-gray-700"><T k="개선 활동(PDCA)" /></p>
        {(['OPEN', ''] as const).map((s) => (
          <button key={s || 'ALL'} type="button" onClick={() => setStatus(s)} className={`rounded px-2 py-0.5 text-[11px] ${status === s ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <T k={s === 'OPEN' ? '진행 중' : '전체'} />
          </button>
        ))}
      </div>
      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />
        : !q.data ? <div className="h-16 animate-pulse rounded-xl bg-gray-100" />
          : q.data.length === 0
            ? <p className="text-xs text-gray-400" data-qi-improvements-empty><T k="개선 활동이 없습니다 — 지표 카드나 관리도 신호에서 시작합니다." /></p>
            : (
              <ul className="space-y-1.5">
                {q.data.map((a) => (
                  <li key={a.id} data-qi-improvement={a.id}>
                    <button type="button" onClick={() => setOpenId(openId === a.id ? null : a.id)} className="flex w-full flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-gray-50">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[a.status]}`}><T k={QI_ACTION_STATUS_LABEL[a.status]} /></span>
                      <span className="min-w-0 flex-1 truncate font-semibold text-gray-900">{a.title}</span>
                      <span className="text-gray-500">{a.indicatorKey ? <T k={cpoeQiDef(a.indicatorKey)?.label ?? a.indicatorKey} /> : (a.indicatorName ?? '—')}</span>
                      {a.baselineSource === 'MANUAL' && <span className="rounded bg-amber-50 px-1.5 text-[10px] text-amber-700"><T k="수기" /></span>}
                      {a.ownerName && <span className="text-gray-400">{a.ownerName}</span>}
                      {a.dueDate && <span className="text-gray-400"><T k="기한" /> <KDate value={a.dueDate} /></span>}
                      <span className="text-gray-500"><T k="기준선" /> <Ratio numerator={a.baselineNumerator} denominator={a.baselineDenominator} pctOnly /></span>
                      <EffectText effect={a.effect} />
                    </button>
                    {openId === a.id && <ActionDetailPanel id={a.id} onClose={() => setOpenId(null)} />}
                  </li>
                ))}
              </ul>
            )}
      <p className="mt-2 text-[10px] text-gray-400">
        <Tf k="효과는 기준선 대비 차이(%p)와 95% 구간입니다 — 구간이 0 을 포함하면 변화를 확인할 수 없습니다. 효과 확인 없이는 '{단계}'로 넘어가지 않습니다." params={{ 단계: QI_ACTION_STATUS_LABEL.ACT }} />
      </p>
    </section>
  );
}
