'use client';

import Link from 'next/link';
import { PatientName, Unit } from '@/components/ui/display';
import { T, Tf, Data, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { IllnessBadge, illnessStrip } from './handoff-ui';
import type { NursingShift } from '@hospital-run/shared';
import { KDate } from '@/components/ui/display';
import { LabTerm } from '@/components/ui/lab-term';
import { kstToday, kstDateOf } from '@/lib/kst-today';
import { SHIFT_KEY, type Row } from './board-types';

const EWS_TONE: Record<string, string> = { HIGH: 'bg-rose-100 text-rose-700', MEDIUM: 'bg-amber-100 text-amber-700', LOW_MEDIUM: 'bg-yellow-50 text-yellow-700', LOW: 'bg-emerald-50 text-emerald-700' };
const ISO_LABEL: Record<string, string> = { STANDARD: '표준', CONTACT: '접촉', DROPLET: '비말', AIRBORNE: '공기', PROTECTIVE: '역격리', STRICT: '엄격' };
const FALL_TONE: Record<string, string> = { HIGH: 'text-rose-600', MODERATE: 'text-amber-600', MEDIUM: 'text-amber-600', LOW: 'text-gray-500' };

/**
 * 경과 표기 — 🔴 모듈 헬퍼로 두면 UI 언어를 따를 수 없다(문자열을 조립해 돌려주기 때문).
 *    `{수}시간 전`·`{수}일 전` 은 어순이 언어마다 달라 조각으로 붙이지 않고 한 문장 한 키로 넘긴다.
 */
export function useAgo(): (iso: string | null) => string {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  return (iso: string | null) => {
    if (!iso) return tAttr('기록없음');
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
    if (h < 1) return tAttr('방금');
    if (h < 24) return tfAttr('{수}시간 전', { 수: h });
    return tfAttr('{수}일 전', { 수: Math.floor(h / 24) });
  };
}
/** 측정 후 24시간 넘은 평가 — 안전 보드에서 오래된 값이 최신처럼 보이면 안 된다 */
const isStale = (iso?: string | null) => !!iso && Date.now() - new Date(iso).getTime() > 24 * 3600000;
/** 오래된 평가 옆에 붙는 경과 표시 — hover 없이도 보이게(툴팁만으로는 벽걸이 보드에서 안 보인다) */
function StaleTag({ at }: { at?: string | null }) {
  const ago = useAgo();
  const tAttr = useTAttr();
  if (!isStale(at)) return null;
  return <span className="ml-1 text-[10px] text-gray-400" title={tAttr('측정 후 24시간 경과 — 재평가 필요')}>{ago(at ?? null)}</span>;
}

function EwsPill({ r }: { r: Row }) {
  const ago = useAgo();
  const tfAttr = useTfAttr();
  if (!r.ews) return <span className="text-gray-300">-</span>;
  // 오래된 측정은 색을 죽이고 경과를 노출 — 며칠 전 점수가 현재 상태처럼 읽히면 위험
  return <><span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${isStale(r.ews.at) ? 'bg-gray-100 text-gray-400' : EWS_TONE[r.ews.risk] ?? 'bg-gray-100 text-gray-500'}`} title={tfAttr('측정 {경과}', { 경과: ago(r.ews.at) })}>EWS {r.ews.score}{r.ews.escalation ? ' ⚠' : ''}</span><StaleTag at={r.ews.at} /></>;
}

function IsolationTag({ r }: { r: Row }) {
  const tAttr = useTAttr();
  if (!(r.isolation?.length)) return null;
  return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-300 whitespace-nowrap" title={tAttr('감염 격리 — 접촉 전 PPE 착용')}>
      {/* 🔴 미등록 격리 코드는 서버 원문 그대로(지어내지 않는다) */}
      ⚠<T k="격리" /> {r.isolation!.map((t) => (ISO_LABEL[t] ? tAttr(ISO_LABEL[t]) : t)).join('·')}
    </span>
  );
}

/** 마지막 인계 — 창 밖이면 경과를 붙여 "지금 인계"처럼 읽히지 않게 */
function LastHandoff({ r, compact }: { r: Row; compact?: boolean }) {
  const ago = useAgo();
  const h = r.handoff;
  if (h === undefined) return null; // 구버전 응답
  if (!h) return <p className="text-[11px] text-gray-400"><T k="인계 기록 없음" /></p>;
  return (
    <div className={compact ? '' : 'rounded-lg bg-gray-50 px-2.5 py-2'}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <IllnessBadge value={h.illness} size="xs" />
        {h.acknowledgedAt
          ? <span className="text-emerald-700">✓ <T k="인수 확인" /></span>
          : <span className="font-semibold text-rose-600"><T k="미확인" /></span>}
        {h.openActions != null && h.openActions > 0 && <span className="text-amber-700"><Tf k="남은 조치 {수}" params={{ 수: h.openActions }} /></span>}
        <span className={h.inWindow ? 'text-gray-500' : 'text-gray-400'}>{ago(h.at)}{!h.inWindow && <> · <T k="이전 근무조" /></>}</span>
      </div>
      {!compact && h.memo && (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-700" title={h.memo}><Data>{h.memo}</Data></p>
      )}
    </div>
  );
}

/** 지금 담당 간호사 — 배정이 없으면 그렇다고 말한다(구버전 응답이면 그리지 않는다) */
function AssignedNurse({ r, compact }: { r: Row; compact?: boolean }) {
  if (r.nurse === undefined) return null;
  if (!r.nurse) return <p className={`${compact ? '' : 'mt-2.5 '}text-[11px] text-gray-400`}><T k="담당 배정 없음" /></p>;
  return (
    <p className={`${compact ? '' : 'mt-2.5 '}flex items-center gap-1.5 text-[11px] text-gray-600`}>
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-[10px] font-bold text-white" aria-hidden="true">{r.nurse.name.charAt(0) || '?'}</span>
      <span><T k="담당" /> <span className="font-semibold text-gray-800"><Data>{r.nurse.name}</Data></span></span>
      {SHIFT_KEY[r.nurse.shiftType as NursingShift] && <span className="text-gray-400">· <T k={SHIFT_KEY[r.nurse.shiftType as NursingShift]} /></span>}
      {!r.nurse.isPrimary && <span className="text-gray-400">· <T k="보조" /></span>}
    </p>
  );
}

/**
 * 안전·일정 신호(④~⑦) — 미확인 위급값 · 오늘~내일 수술 · 금식 · 퇴원 예정 · 전동 요청.
 * 🔴 값이 없으면 그리지 않는다(구버전 응답·해당 없음) — 신호가 없다는 것을 "안전"으로 말하지 않는다(초록 배지 없음)
 */
export function SignalBadges({ r }: { r: Row }) {
  const ago = useAgo();
  const tAttr = useTAttr();
  const today = kstToday();
  const crit = r.criticalOpen ?? [];
  const out: React.ReactNode[] = [];
  if (crit.length > 0) {
    const c = crit[0];
    out.push(
      <Link key="crit" href={`/patients/${r.patientId}`} title={tAttr('위급값 미확인 — 확인·조치 전')}
        className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-rose-700">
        ⚠ <T k="위급값" /> <LabTerm name={c.testName} /> <Data>{c.value}{c.unit ? ` ${c.unit}` : ''}</Data>
        <span className="font-normal opacity-80">· {ago(c.notifiedAt)}</span>
        {crit.length > 1 && <span className="font-normal">+{crit.length - 1}</span>}
      </Link>,
    );
  }
  if (r.surgery) {
    out.push(
      <span key="surg" className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800" title={r.surgery.procedureName}>
        <T k={r.surgery.status === 'IN_PROGRESS' ? '수술 중' : '수술'} />
        {r.surgery.status !== 'IN_PROGRESS' && <>{kstDateOf(r.surgery.scheduledAt) !== today && <T k="내일" />} <KDate value={r.surgery.scheduledAt} mode="time" /></>}
        <span className="max-w-[9rem] truncate font-normal"><Data>{r.surgery.procedureName}</Data></span>
      </span>,
    );
  }
  if (r.npo) out.push(<span key="npo" className="rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800" title={tAttr('활성 식이 오더 — 금식')}>NPO</span>);
  if (r.expectedDischargeAt) {
    const isToday = kstDateOf(r.expectedDischargeAt) === today;
    out.push(
      <span key="dc" className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${isToday ? 'bg-teal-100 text-teal-800' : 'bg-gray-100 text-gray-600'}`}>
        {isToday ? <T k="오늘 퇴원 예정" /> : <><T k="퇴원 예정" /> <KDate value={r.expectedDischargeAt} mode="monthDay" /></>}
      </span>,
    );
  }
  if (r.transferPending) {
    out.push(
      <span key="tr" className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
        <T k="전동 요청" /> → <Data>{r.transferPending.targetWard ?? tAttr('(병동 미상)')}</Data>
      </span>,
    );
  }
  if (!out.length) return null;
  return <div className="flex flex-wrap items-center gap-1" data-signals>{out}</div>;
}

/**
 * 마지막 활력 — 경과를 보이고, 원내 기준(설정)이 있을 때만 넘은 것을 강조한다.
 * 🔴 기준 미설정이면 강조하지 않는다(개발자가 고른 시간을 정책인 척하지 않는다) · 측정 없음은 그 사실을
 */
export function LastVitals({ r, staleHours }: { r: Row; staleHours: number | null | undefined }) {
  const ago = useAgo();
  if (r.lastVitalsAt === undefined) return null;
  if (!r.lastVitalsAt) return <span className="font-semibold text-amber-700"><T k="활력 기록 없음" /></span>;
  const over = staleHours != null && Date.now() - new Date(r.lastVitalsAt).getTime() > staleHours * 3_600_000;
  return <span className={over ? 'font-semibold text-rose-600' : 'text-gray-700'} data-vitals-stale={over || undefined}>{ago(r.lastVitalsAt)}</span>;
}

/** 카드의 배정 손잡이 — 간호사·관리자에게만 넘긴다(의사는 없음) */
/**
 * 이번 근무조 기록 칩 — 있으면 ✓ 수, 없으면 비움 · 투약은 지금까지 예정분 중 남은 것
 * 🔴 유무만 말한다(충분한지 판정하지 않는다) · 구버전 응답이면 그리지 않는다
 */
export function ShiftRecordChips({ r, compact }: { r: Row; compact?: boolean }) {
  const tAttr = useTAttr();
  const sr = r.shiftRecord;
  if (!sr) return null;
  const chip = (id: string, label: React.ReactNode, n: number, title: string) => (
    <span key={id} title={title}
      className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${n > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
      {n > 0 ? '✓' : '○'} {label}{n > 1 && <span className="tabular-nums">{n}</span>}
    </span>
  );
  return (
    <div className={`flex flex-wrap items-center gap-1 ${compact ? '' : 'mt-2.5'}`} data-shift-record>
      {!compact && <span className="mr-0.5 text-[10px] text-gray-400"><T k="이번 근무조" /></span>}
      {chip('note', <T k="간호기록" />, sr.notes, tAttr('이번 근무조에 남긴 간호기록'))}
      {chip('vitals', <T k="활력" />, sr.vitals, tAttr('이번 근무조 활력 측정 기록'))}
      {chip('io', 'I/O', sr.io, tAttr('이번 근무조 섭취·배설 기록'))}
      {chip('handoff', <T k="인계" />, sr.handoffs, tAttr('이번 근무조에 남긴 인계'))}
      {sr.medsDue > 0 && (
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${sr.medsPending > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}
          title={tAttr('이번 근무조 시작부터 지금까지 예정된 투약 중 처리 안 된 것')}>
          {sr.medsPending > 0 ? <Tf k="투약 미처리 {수}/{전체}" params={{ 수: sr.medsPending, 전체: sr.medsDue }} /> : <>✓ <T k="투약" /></>}
        </span>
      )}
    </div>
  );
}

export type CardAssign = {
  selecting: boolean; selected: boolean; onToggle: () => void;
  /** 내가 지금 담당이 아니고 근무조를 아는 경우만 */
  canTakeOver: boolean; onTakeOver: () => void; pending: boolean;
};

export function PatientCard({ r, assign, vitalsStaleHours }: { r: Row; assign?: CardAssign; vitalsStaleHours?: number | null }) {
  const ago = useAgo();
  const tone = r.highRisk ? 'border-rose-300 ring-1 ring-rose-200' : (r.meds.overdue > 0 ? 'border-amber-200' : 'border-gray-200');
  return (
    <article className={`relative flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm ${tone} ${assign?.selected ? 'ring-2 ring-indigo-500' : ''}`}>
      {assign?.selecting && (
        <label className="absolute right-2 top-2 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-white/90 shadow-sm ring-1 ring-gray-200">
          <input type="checkbox" checked={assign.selected} onChange={assign.onToggle} className="h-4 w-4 rounded border-gray-300" aria-label={`${r.room}-${r.bed} ${r.name}`} />
        </label>
      )}
      <span className={`h-1 w-full ${r.highRisk ? 'bg-rose-500' : r.handoff ? illnessStrip(r.handoff.illness) : 'bg-gray-200'}`} aria-hidden="true" />
      <div className="flex-1 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="rounded-md bg-gray-900 px-1.5 py-0.5 text-xs font-bold text-white tabular-nums">{r.room}-{r.bed}</span>
              <span className="truncate text-[11px] text-gray-400"><Data>{r.ward}</Data></span>
            </div>
            <Link href={`/patients/${r.patientId}`} className="mt-1 block truncate text-[15px] font-semibold text-gray-900 hover:text-blue-700">
              <PatientName name={r.name} koreanName={r.koreanName} showMrn={false} maskable />
            </Link>
            <p className="text-[11px] text-gray-400"><span className="font-mono">{r.mrn}</span> · <T k="재원" /> {r.losDays}<Unit>일</Unit></p>
          </div>
          {r.highRisk && <span className="shrink-0 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white"><T k="고위험" /></span>}
        </div>

        <div className="mt-2"><SignalBadges r={r} /></div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <EwsPill r={r} />
          {r.fall && (
            <span className={`text-[11px] font-medium ${isStale(r.fall.at) ? 'text-gray-400' : FALL_TONE[r.fall.risk] ?? 'text-gray-500'}`}>
              <T k="낙상" /> {r.fall.risk}<StaleTag at={r.fall.at} />
            </span>
          )}
          <IsolationTag r={r} />
        </div>

        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg bg-gray-50 px-2.5 py-1.5">
            <dt className="text-[10px] text-gray-400"><T k="마지막 활력" /></dt>
            <dd><LastVitals r={r} staleHours={vitalsStaleHours} /></dd>
          </div>
          <div className="rounded-lg bg-gray-50 px-2.5 py-1.5">
            <dt className="text-[10px] text-gray-400"><T k="오늘 남은 투약" /></dt>
            <dd>
              {r.meds.due > 0
                /* 발견 → 행동: 지연이 보이면 바로 MAR 로 */
                ? <Link href={`/inpatient/${r.admissionId}/nursing/mar`} className="font-semibold text-gray-800 hover:underline">{r.meds.due}<Unit>건</Unit>{r.meds.overdue > 0 && <span className="ml-1 text-rose-600"><Tf k="지연 {수}" params={{ 수: r.meds.overdue }} /></span>}</Link>
                : <span className="text-gray-300">-</span>}
            </dd>
          </div>
          <div className="rounded-lg bg-gray-50 px-2.5 py-1.5">
            <dt className="text-[10px] text-gray-400"><T k="최근 간호기록" /></dt>
            <dd>
              <Link href={`/inpatient/${r.admissionId}/nursing/notes`} className="text-gray-700 hover:underline">
                {ago(r.lastNoteAt)}{r.unsignedNotes > 0 && <span className="ml-1 font-semibold text-amber-600"><Tf k="미서명 {수}" params={{ 수: r.unsignedNotes }} /></span>}
              </Link>
            </dd>
          </div>
        </dl>

        <ShiftRecordChips r={r} />

        <div className="flex items-center justify-between gap-2">
          <AssignedNurse r={r} />
          {assign?.canTakeOver && !assign.selecting && (
            <button type="button" onClick={assign.onTakeOver} disabled={assign.pending}
              className="mt-2.5 shrink-0 min-h-[32px] rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              <T k="내가 담당" />
            </button>
          )}
        </div>

        <div className="mt-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400"><T k="마지막 인계" /></p>
          <LastHandoff r={r} />
        </div>
      </div>
    </article>
  );
}

export function PatientTable({ rows, vitalsStaleHours }: { rows: Row[]; vitalsStaleHours?: number | null }) {
  const ago = useAgo();
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-100 text-[11px] text-gray-400 text-left">
          <th className="px-4 py-2 font-medium"><T k="병실/베드" /></th>
          <th className="px-3 py-2 font-medium"><T k="환자" /></th>
          <th className="px-3 py-2 font-medium"><T k="재원" /></th>
          <th className="px-3 py-2 font-medium"><T k="신호" /></th>
          <th className="px-3 py-2 font-medium">EWS</th>
          <th className="px-3 py-2 font-medium"><T k="마지막 활력" /></th>
          <th className="px-3 py-2 font-medium"><T k="낙상" /></th>
          <th className="px-3 py-2 font-medium"><T k="투약(예정/지연)" /></th>
          <th className="px-3 py-2 font-medium"><T k="최근기록" /></th>
          <th className="px-3 py-2 font-medium"><T k="이번 근무조" /></th>
          <th className="px-3 py-2 font-medium"><T k="담당" /></th>
          <th className="px-3 py-2 font-medium"><T k="마지막 인계" /></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.admissionId} className={`border-b border-gray-50 hover:bg-gray-50/60 ${r.highRisk ? 'bg-rose-50/40' : ''}`}>
            <td className="px-4 py-2.5">
              <span className="font-medium text-gray-800">{r.room}-{r.bed}</span>
              <span className="block text-[10px] text-gray-400"><Data>{r.ward}</Data></span>
            </td>
            <td className="px-3 py-2.5">
              <Link href={`/patients/${r.patientId}`} className="font-medium text-blue-700 hover:underline"><PatientName name={r.name} koreanName={r.koreanName} showMrn={false} maskable /></Link>
              <span className="text-[11px] text-gray-400 ml-1.5 font-mono">{r.mrn}</span>
              <span className="ml-1.5"><IsolationTag r={r} /></span>
            </td>
            <td className="px-3 py-2.5 text-gray-600">{r.losDays}<Unit>일</Unit></td>
            <td className="px-3 py-2.5"><SignalBadges r={r} /></td>
            <td className="px-3 py-2.5"><EwsPill r={r} /></td>
            <td className="px-3 py-2.5 text-[11px]"><LastVitals r={r} staleHours={vitalsStaleHours} /></td>
            <td className="px-3 py-2.5">
              {r.fall
                ? <><span className={`text-xs font-medium ${isStale(r.fall.at) ? 'text-gray-400' : FALL_TONE[r.fall.risk] ?? 'text-gray-400'}`}>{r.fall.risk}</span><StaleTag at={r.fall.at} /></>
                : <span className="text-gray-300">-</span>}
            </td>
            <td className="px-3 py-2.5">
              {r.meds.due > 0
                ? <Link href={`/inpatient/${r.admissionId}/nursing/mar`} className="text-gray-700 hover:underline">{r.meds.due}<Unit>건</Unit>{r.meds.overdue > 0 && <span className="text-rose-600 font-semibold ml-1"><Tf k="지연 {수}" params={{ 수: r.meds.overdue }} /></span>}</Link>
                : <span className="text-gray-300">-</span>}
            </td>
            <td className="px-3 py-2.5 text-[11px] text-gray-500">
              <Link href={`/inpatient/${r.admissionId}/nursing/notes`} className="hover:underline">
                {ago(r.lastNoteAt)}{r.unsignedNotes > 0 && <span className="ml-1.5 text-amber-600 font-semibold"><Tf k="미서명 {수}" params={{ 수: r.unsignedNotes }} /></span>}
              </Link>
            </td>
            <td className="px-3 py-2.5"><ShiftRecordChips r={r} compact /></td>
            <td className="px-3 py-2.5"><AssignedNurse r={r} compact /></td>
            <td className="px-3 py-2.5"><LastHandoff r={r} compact /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
