'use client';

/**
 * 오더 위원회 기준 점검(2026-10-06) — 위원회별로 오더에 걸리는 기준(권고·게이트)과 그 근거, 오늘 오더 점검.
 *
 * 🔴 값·담당·결정은 서버가 정본에서 읽은 그대로 — 이 화면은 기준을 정하지 않는다(변경은 위원회 안건으로).
 * 🔴 근거 3상태: 의결·결정 있음 / 담당 위원회는 있으나 의결 없음 / 담당 미지정 — "기본값"을 권고처럼 그리지 않는다.
 * 🔴 점검은 셀 수 있는 것만(분자·분모) · 기준 미설정이면 점검하지 않았다고 · 셀 기록이 없으면 "기준 표시만".
 */
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  CONFIG_SOURCE_TEXT, ORDER_DEPT_LABEL, ORDER_STANDARD_CHECK_LABEL, ORDER_TRACK_PHASE_LABEL, RATIO_UNAVAILABLE,
  type ConfigSource, type OrderDept, type OrderStandardCheck, type OrderTrackPhase,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Duration, KDate, PatientName } from '@/components/ui/display';
import { T, Tf } from '@/components/ui/i18n-text';
import { DEPT_TONE, PHASE_TONE } from './tracking-types';
import { AttentionAgendaSlot } from './committee-agenda-ui';

type Check =
  | { state: 'CHECKED'; numerator: number; denominator: number; offendersTruncated: boolean;
      offenders: { id: string; department: OrderDept; name: string | null; priority: string; phase: OrderTrackPhase; patient: { id: string; name: string; koreanName?: string | null; mrn: string } | null; sinceOrderedMin: number | null }[] }
  | { state: 'UNSET' } | { state: 'NO_CHECK' };
interface Standard {
  surfaceKey: string; label: string; depts: OrderDept[]; checkKind: OrderStandardCheck | null;
  value: { value: unknown; source: ConfigSource } | null;
  basis: {
    state: 'DECIDED' | 'NO_DECISION' | 'NOT_GOVERNED'; owners: { code: string | null; name: string }[]; decisions: number;
    latest: { source: 'COMMITTEE' | 'REGISTRY'; registryKey: string | null; decisionNo: string | null; status: string; resolvedAt: string | null; resolution: string | null } | null;
  };
  check: Check;
}
interface GovernanceCheck {
  date: string; now: string; truncated: boolean; total: number;
  committees: { code: string | null; name: string; standards: Standard[] }[];
  unassigned: Standard[];
  summary: { standards: number; decided: number; noDecision: number; notGoverned: number; checked: number; unset: number; withFindings: number };
}

/** 설정 값 한 줄 — 객체는 키=값으로 · 비어 있으면 "값 없음" */
function valueText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    return entries.length ? entries.map(([k, x]) => `${k}=${String(x)}`).join(' · ') : null;
  }
  return String(v);
}

function BasisBadge({ b }: { b: Standard['basis'] }) {
  if (b.state === 'DECIDED' && b.latest) {
    return (
      <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200" data-gov-basis="DECIDED">
        {b.latest.source === 'COMMITTEE' ? <>⚖ {b.latest.decisionNo}</> : <><T k="결정 등록부" /> {b.latest.registryKey}</>}
        {b.latest.resolvedAt && <> · <KDate value={b.latest.resolvedAt} /></>}
        {b.decisions > 1 && <> · <Tf k="결정 {수}건" params={{ 수: b.decisions }} /></>}
      </span>
    );
  }
  if (b.state === 'NO_DECISION') return <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200" data-gov-basis="NO_DECISION"><T k="담당 지정 · 의결 없음" /></span>;
  return <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600" data-gov-basis="NOT_GOVERNED"><T k="담당 위원회 미지정" /></span>;
}

function CheckBlock({ s }: { s: Standard }) {
  const [open, setOpen] = useState(false);
  const c = s.check;
  if (c.state === 'NO_CHECK') return <p className="text-[11px] text-gray-400" data-gov-check="NO_CHECK"><T k="이 화면의 기록으로 셀 점검 항목이 없습니다 — 기준 표시만" /></p>;
  if (c.state === 'UNSET') {
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] text-amber-700" data-gov-check="UNSET"><T k="기준이 설정되지 않아 점검하지 않았습니다(기준은 위원회 의결로 정합니다)" /></p>
        {/* 위원회가 정할 기준 — 이 자리에서 담당 위원회 안건으로 올린다(화면은 값을 바꾸지 않는다) */}
        {s.checkKind === 'ATTENTION' && <AttentionAgendaSlot />}
      </div>
    );
  }
  const label = s.checkKind ? ORDER_STANDARD_CHECK_LABEL[s.checkKind] : '';
  return (
    <div data-gov-check="CHECKED">
      <button type="button" onClick={() => c.numerator && setOpen(!open)} className="flex w-full items-center gap-2 text-left">
        <span className="text-[11px] text-gray-600"><T k={label} /></span>
        {c.denominator === 0 ? (
          <span className="ml-auto text-xs text-gray-400"><T k={RATIO_UNAVAILABLE} /> — <T k="해당 오더 없음" /></span>
        ) : (
          <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${c.numerator ? 'bg-rose-100 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
            {c.numerator} / {c.denominator}
          </span>
        )}
        {c.numerator > 0 && <span className="text-[10px] text-gray-400">{open ? '▴' : '▾'}</span>}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1" data-gov-offenders>
          {c.offenders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-gray-50 px-2 py-1 text-[11px]">
              <span className={`rounded px-1 text-[9px] font-semibold ring-1 ${DEPT_TONE[o.department]}`}><T k={ORDER_DEPT_LABEL[o.department]} /></span>
              {o.patient && <Link href={`/patients/${o.patient.id}`} className="font-medium text-gray-900 hover:text-blue-700"><PatientName name={o.patient.name} koreanName={o.patient.koreanName} showMrn={false} maskable /></Link>}
              <span className="truncate text-gray-600">{o.name ?? <T k="이름 없음" />}</span>
              {o.priority === 'STAT' && <span className="rounded bg-rose-600 px-1 text-[9px] font-bold text-white">STAT</span>}
              <span className={`ml-auto rounded px-1 ${PHASE_TONE[o.phase].soft} ${PHASE_TONE[o.phase].text}`}><T k={ORDER_TRACK_PHASE_LABEL[o.phase]} /></span>
              {o.sinceOrderedMin != null && <span className="tabular-nums text-gray-500"><Duration minutes={o.sinceOrderedMin} dense /></span>}
            </li>
          ))}
          {c.offendersTruncated && <li className="text-[10px] text-gray-400"><Tf k="처음 {수}건만 표시" params={{ 수: c.offenders.length }} /></li>}
        </ul>
      )}
    </div>
  );
}

function StandardRow({ s }: { s: Standard }) {
  const v = s.value ? valueText(s.value.value) : null;
  return (
    <li className="space-y-1.5 py-3" data-gov-standard={s.surfaceKey}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold text-gray-900"><T k={s.label} /></span>
        {s.depts.map((d) => <span key={d} className={`rounded px-1 text-[9px] font-semibold ring-1 ${DEPT_TONE[d]}`}><T k={ORDER_DEPT_LABEL[d]} /></span>)}
        <span className="ml-auto"><BasisBadge b={s.basis} /></span>
      </div>
      <p className="text-[11px] text-gray-500">
        <span className="font-mono text-gray-400">{s.surfaceKey}</span>
        {s.value ? (
          <> · <T k="현재 값" /> <b className="text-gray-700">{v ?? <T k="값 없음" />}</b>{' '}
            <span className={`rounded px-1 text-[10px] ${s.value.source === 'db' || s.value.source === 'env' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}><T k={CONFIG_SOURCE_TEXT[s.value.source]} /></span></>
        ) : <> · <T k="마스터 데이터(값은 해당 관리 화면)" /></>}
      </p>
      {s.basis.latest?.resolution && <p className="rounded-lg bg-emerald-50/50 px-2 py-1 text-[11px] italic text-emerald-900">“{s.basis.latest.resolution}”</p>}
      <CheckBlock s={s} />
    </li>
  );
}

export function OrderGovernancePanel({ date }: { date: string }) {
  // 서버 @Roles(ADMIN·DOCTOR·NURSE·PHARMACIST·LAB_TECH) 와 같은 판정 — 권한 밖이면 부르지 않는다
  const canView = useHasRole('DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH');
  const isAdmin = useHasRole();
  const q = useQuery({
    queryKey: ['orders-governance-check', date],
    queryFn: () => apiClient.get<{ data: GovernanceCheck }>(`/api/v1/orders/governance-check?date=${date}`).then((r) => r.data),
    enabled: canView,
    refetchInterval: pollMs('slow'),
  });
  if (!canView) return <p className="rounded-xl bg-white p-6 text-sm text-gray-500"><T k="오더 실시간 추적은 의사·간호사·약사·임상병리사가 봅니다." /></p>;
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />;
  const g = q.data;
  if (!g) return <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />;
  const s = g.summary;
  const chip = (label: React.ReactNode, v: number, tone: string, data: string) => (
    <div className={`rounded-xl px-3 py-2 ${tone}`} data-gov-summary={data}><p className="text-[10px] font-medium opacity-80">{label}</p><p className="text-xl font-black tabular-nums">{v}</p></div>
  );
  return (
    <div className="space-y-4" data-gov-panel>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {chip(<T k="오더 관련 기준" />, s.standards, 'bg-gray-900 text-white', 'standards')}
        {chip(<T k="의결·결정 있음" />, s.decided, 'bg-emerald-50 text-emerald-900', 'decided')}
        {chip(<T k="담당만 · 의결 없음" />, s.noDecision, 'bg-amber-50 text-amber-900', 'noDecision')}
        {chip(<T k="담당 미지정" />, s.notGoverned, 'bg-gray-100 text-gray-700', 'notGoverned')}
        {chip(<T k="점검한 기준" />, s.checked, 'bg-sky-50 text-sky-900', 'checked')}
        {chip(<T k="해당 오더가 있는 점검" />, s.withFindings, s.withFindings ? 'bg-rose-50 text-rose-800' : 'bg-gray-50 text-gray-500', 'withFindings')}
      </div>
      <p className="text-[11px] text-gray-500">
        <T k="기준 값·담당·결정은 위원회 거버넌스와 설정에서 읽은 그대로입니다 — 이 화면은 기준을 정하지 않습니다(변경은 위원회 안건으로)." />
        {' '}<Tf k="점검 대상은 오더 실시간 추적과 같습니다({날짜} 발행분 + 끝나지 않은 오더)." params={{ 날짜: g.date }} />
        {g.truncated && <span className="ml-1 font-semibold text-amber-700"><Tf k="점검 대상이 잘렸습니다 — 전체 {전체}건 중 오래된 순 일부만" params={{ 전체: g.total }} /></span>}
        {isAdmin && <> · <Link href="/admin/governance" className="text-blue-700 hover:underline"><T k="위원회 거버넌스로" /></Link></>}
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        {g.committees.map((c) => (
          <section key={c.code ?? c.name} className="rounded-2xl border border-gray-100 bg-white shadow-sm" data-gov-committee={c.code ?? c.name}>
            <header className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
              <span className="text-lg" aria-hidden>⚖</span>
              <h3 className="text-sm font-bold text-gray-900"><T k={c.name} /></h3>
              {c.code && <span className="rounded bg-gray-100 px-1.5 font-mono text-[10px] text-gray-500">{c.code}</span>}
              <span className="ml-auto text-[11px] text-gray-400"><Tf k="기준 {수}" params={{ 수: c.standards.length }} /></span>
            </header>
            <ul className="divide-y divide-gray-50 px-4">{c.standards.map((st) => <StandardRow key={st.surfaceKey} s={st} />)}</ul>
          </section>
        ))}
        {g.unassigned.length > 0 && (
          <section className="rounded-2xl border border-dashed border-gray-300 bg-white" data-gov-committee="UNASSIGNED">
            <header className="border-b border-gray-100 px-4 py-2.5">
              <h3 className="text-sm font-bold text-gray-700"><T k="담당 위원회 미지정" /></h3>
              <p className="text-[11px] text-gray-400"><T k="이 기준을 의결할 위원회가 정해지지 않았습니다 — 담당 지정은 위원회 거버넌스에서." /></p>
            </header>
            <ul className="divide-y divide-gray-50 px-4">{g.unassigned.map((st) => <StandardRow key={st.surfaceKey} s={st} />)}</ul>
          </section>
        )}
      </div>
    </div>
  );
}
