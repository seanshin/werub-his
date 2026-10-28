'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { anesthesiaText, SURGERY_PHASES, SURGERY_PHASE_LABEL, type IntraopVitalPoint } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Duration, KDate, PatientName } from '@/components/ui/display';
import { T, Tf, Data, useTAttr } from '@/components/ui/i18n-text';
import { BloodPressureValue, VitalValue } from '@/components/vitals/VitalSigns';
import { flagsWith, useVitalsThresholds } from '@/lib/vital-flags';
import { isLive, type LiveBoard, type LiveCase, type LiveRoom } from './live-types';

/**
 * 수술실 실시간 모니터(2026-10-05) — `GET /api/v1/surgery/live-board`.
 *  · 방 상태·단계는 **수술 원장 시각**에서(서버 판정) · 기록 없는 단계는 빈 점 + "기록 없음"(지났다고 그리지 않는다)
 *  · 수술 중 활력은 마취 기록 원장의 점만 · 없으면 "수술 중 활력 기록 없음"(정상으로 그리지 않는다)
 *  · 예상 대비는 수술방 배정의 예상 소요가 있을 때만
 */
const STATE_TONE: Record<LiveRoom['state'], string> = {
  IN_USE: 'bg-rose-600 text-white', WAITING: 'bg-sky-100 text-sky-800', IDLE: 'bg-gray-100 text-gray-500',
};
const STATE_KEY: Record<LiveRoom['state'], string> = { IN_USE: '수술 중', WAITING: '대기 중', IDLE: '비어 있음' };

/** 하루 일정 막대(간트) — 예정(테두리)과 실제(채움)를 겹쳐 그린다 · 지금 선 */
function DayGantt({ rooms, now }: { rooms: LiveRoom[]; now: string }) {
  const tAttr = useTAttr();
  const times: number[] = [];
  for (const r of rooms) for (const c of r.cases) {
    for (const v of [c.slot?.plannedStart, c.slot?.plannedEnd, isLive(c) ? c.startedAt : null, isLive(c) ? c.endedAt : null]) if (v) times.push(Date.parse(v));
  }
  const nowMs = Date.parse(now);
  if (!times.length) return null;
  const HOUR = 3_600_000;
  const lo = Math.floor(Math.min(...times, nowMs) / HOUR) * HOUR;
  const hi = Math.ceil(Math.max(...times, nowMs) / HOUR) * HOUR;
  const span = Math.max(hi - lo, HOUR);
  const pct = (t: number) => `${((t - lo) / span) * 100}%`;
  const w = (a: number, b: number) => `${Math.max(((b - a) / span) * 100, 0.8)}%`;
  const hours: number[] = [];
  for (let t = lo; t <= hi; t += HOUR) hours.push(t);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4" aria-label={tAttr('오늘 수술방 일정')}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900"><T k="오늘 수술방 일정" /></h3>
        <p className="flex items-center gap-3 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm border border-indigo-400" /><T k="예정" /></span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm bg-amber-400" /><T k="진행" /></span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm bg-emerald-400" /><T k="완료" /></span>
          <span className="inline-flex items-center gap-1"><span className="h-3 w-0.5 bg-rose-500" /><T k="지금" /></span>
        </p>
      </div>
      <div className="relative">
        <div className="ml-20 flex justify-between text-[10px] text-gray-400 tabular-nums">
          {hours.map((h) => <span key={h}><KDate value={new Date(h).toISOString()} mode="time" /></span>)}
        </div>
        <div className="mt-1 space-y-1.5">
          {rooms.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <span className="w-[4.5rem] shrink-0 truncate text-xs font-semibold text-gray-700"><Data>{r.name}</Data></span>
              <div className="relative h-7 flex-1 rounded-md bg-gray-50">
                {r.cases.map((c) => {
                  const ps = c.slot?.plannedStart ? Date.parse(c.slot.plannedStart) : null;
                  const pe = c.slot?.plannedEnd ? Date.parse(c.slot.plannedEnd) : null;
                  const live = isLive(c) ? c : null;
                  const as = live?.startedAt ? Date.parse(live.startedAt) : null;
                  const ae = live?.endedAt ? Date.parse(live.endedAt) : live?.status === 'IN_PROGRESS' ? nowMs : null;
                  return (
                    <div key={c.id}>
                      {ps != null && pe != null && pe > ps && (
                        <div className="absolute top-0.5 h-6 rounded border border-indigo-400 bg-indigo-50/40" style={{ left: pct(ps), width: w(ps, pe) }}
                          title={`${live?.procedureName ?? ''} ${c.slot?.startTime}~${c.slot?.endTime}`} />
                      )}
                      {as != null && ae != null && ae >= as && (
                        <div className={`absolute top-1.5 h-4 rounded ${live?.status === 'IN_PROGRESS' ? 'bg-amber-400' : 'bg-emerald-400'}`}
                          style={{ left: pct(as), width: w(as, ae) }} title={live?.procedureName} />
                      )}
                    </div>
                  );
                })}
                <div className="absolute inset-y-0 w-0.5 bg-rose-500" style={{ left: pct(nowMs) }} aria-hidden="true" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** 활력 추이선 — 점이 2개 미만이면 선을 긋지 않는다(한 점으로 추세를 지어내지 않는다) */
function Spark({ pts, pick, color }: { pts: IntraopVitalPoint[]; pick: (p: IntraopVitalPoint) => number | null; color: string }) {
  const vs = pts.map(pick);
  const xs = vs.map((v, i) => (v == null ? null : { i, v })).filter((x): x is { i: number; v: number } => !!x);
  if (xs.length < 2) return <svg width="96" height="24" aria-hidden="true" />;
  const min = Math.min(...xs.map((x) => x.v)); const max = Math.max(...xs.map((x) => x.v));
  const yr = max - min || 1; const n = Math.max(pts.length - 1, 1);
  const d = xs.map((x, k) => `${k ? 'L' : 'M'}${(x.i / n) * 94 + 1},${22 - ((x.v - min) / yr) * 20}`).join(' ');
  return <svg width="96" height="24" aria-hidden="true"><path d={d} fill="none" stroke={color} strokeWidth="1.5" /></svg>;
}

function Vitals({ c }: { c: LiveCase }) {
  const tAttr = useTAttr();
  const rule = useVitalsThresholds();
  const a = c.anesthesia;
  if (!a) return <p className="text-[11px] text-gray-400"><T k="마취 기록 없음" /></p>;
  if (!a.vitals || a.vitals.length === 0) return <p className="text-[11px] text-amber-700"><T k="수술 중 활력 기록 없음" /></p>;
  const last = a.vitals[a.vitals.length - 1];
  const f = flagsWith(rule, last);
  const row = (label: string, value: React.ReactNode, spark: React.ReactNode) => (
    <div className="flex items-center justify-between gap-2">
      <span className="w-10 text-[10px] text-gray-500">{label}</span>
      {spark}
      <span className="w-16 text-right text-sm font-bold tabular-nums text-gray-900">{value}</span>
    </div>
  );
  return (
    <div className="space-y-0.5" data-intraop-vitals>
      {/* 활력 값은 표시 부품 정본(표준 순서 SpO₂ → BP → HR · 정본 자릿수 · 임계 정본 색) · EtCO₂ 는 활력 정본 밖 */}
      {row('SpO₂', <VitalValue k="spo2" value={last.spo2} unit={false} flag={f?.spo2} />, <Spark pts={a.vitals} pick={(p) => p.spo2} color="#0891b2" />)}
      {row('BP', <BloodPressureValue systolic={last.systolicBp} diastolic={last.diastolicBp} systolicFlag={f?.systolicBp} diastolicFlag={f?.diastolicBp} unit={false} />, <Spark pts={a.vitals} pick={(p) => p.systolicBp} color="#2563eb" />)}
      {row('HR', <VitalValue k="heartRate" value={last.heartRate} unit={false} flag={f?.heartRate} />, <Spark pts={a.vitals} pick={(p) => p.heartRate} color="#e11d48" />)}
      {row('EtCO₂', last.etco2 ?? '—', <Spark pts={a.vitals} pick={(p) => p.etco2} color="#7c3aed" />)}
      <p className="text-[10px] text-gray-400">
        <T k="마지막 측정" /> <KDate value={a.lastVitalAt} mode="time" />
        {a.vitalsTruncated && <> · <Tf k="최근 {표시}점만 — 전체 {전체}점" params={{ 표시: a.vitals.length, 전체: a.vitalsTotal ?? 0 }} /></>}
        <span className="ml-1" title={tAttr('마취 기록 원장의 측정점 — 장비 연동 실시간 값이 아닙니다')}>ⓘ</span>
      </p>
    </div>
  );
}

/** 단계 막대 — 기록된 단계는 채운 점과 시각 · 없는 단계는 빈 점 */
function Phases({ c }: { c: LiveCase }) {
  const tAttr = useTAttr();
  const at = new Map(c.phases.map((p) => [p.key, p.at]));
  return (
    <ol className="flex flex-wrap items-start gap-x-1 gap-y-1.5" aria-label={tAttr('수술 단계')}>
      {SURGERY_PHASES.map((k, i) => {
        const t = at.get(k) ?? null;
        const current = c.lastPhase === k;
        return (
          <li key={k} className="flex items-center gap-1">
            <span className={`flex flex-col items-center rounded-md px-1.5 py-0.5 text-[10px] ${current ? 'bg-amber-500 text-white' : t ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-50 text-gray-400'}`}
              title={t ? undefined : tAttr('기록 없음')}>
              <span className="font-semibold whitespace-nowrap"><T k={SURGERY_PHASE_LABEL[k]} /></span>
              <span className="tabular-nums">{t ? <KDate value={t} mode="time" /> : '—'}</span>
            </span>
            {i < SURGERY_PHASES.length - 1 && <span className="text-gray-300" aria-hidden="true">›</span>}
          </li>
        );
      })}
    </ol>
  );
}

function SafetyChips({ c }: { c: LiveCase }) {
  const s = c.safety;
  const chip = (ok: boolean, k: string) => (
    <span key={k} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{ok ? '✓' : '○'} <T k={k} /></span>
  );
  return (
    <div className="flex flex-wrap gap-1">
      {!s.checklistPresent
        ? <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700"><T k="안전 체크리스트 없음" /></span>
        : <>{chip(s.signIn, 'Sign-In')}{chip(s.timeOut, 'Time-Out')}{chip(s.signOut, 'Sign-Out')}</>}
      {s.countUnresolved && <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">⚠ <T k="계수 불일치 미해소" /></span>}
      {c.asaClass && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">ASA <Data>{c.asaClass}</Data></span>}
      {c.preAnesthesia?.npoConfirmed && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700"><T k="금식 확인" /></span>}
    </div>
  );
}

/** 경과 / 예상 — 예상이 없으면 막대 없이 경과만 */
function Progress({ c }: { c: LiveCase }) {
  if (c.runMin == null) return null;
  const est = c.estimatedMin;
  const ratio = est ? Math.min(c.runMin / est, 1.5) : null;
  const over = c.overrunMin != null && c.overrunMin > 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-gray-500"><T k={c.status === 'IN_PROGRESS' ? '경과' : '소요'} /></span>
        <span className={`text-lg font-black tabular-nums ${over ? 'text-rose-600' : 'text-gray-900'}`}><Duration minutes={c.runMin} /></span>
      </div>
      {ratio != null ? (
        <>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
            <div className={`h-full ${over ? 'bg-rose-500' : 'bg-amber-400'}`} style={{ width: `${(ratio / 1.5) * 100}%` }} />
          </div>
          <p className="mt-0.5 text-[10px] text-gray-500">
            <T k="예상" /> <Duration minutes={est} dense />{over && <span className="ml-1 font-semibold text-rose-600"><Tf k="+{분}분 초과" params={{ 분: c.overrunMin ?? 0 }} /></span>}
          </p>
        </>
      ) : <p className="mt-0.5 text-[10px] text-gray-400"><T k="예상 소요 없음 — 초과를 판정하지 않습니다" /></p>}
    </div>
  );
}

function CaseCard({ c, emphasis }: { c: LiveCase; emphasis?: boolean }) {
  return (
    <article className={`rounded-xl border p-3 ${emphasis ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200 bg-white'}`} data-live-case={c.status}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-gray-900"><Data>{c.procedureName}</Data></p>
          <p className="text-xs text-gray-600">
            {c.patient ? <Link href={`/patients/${c.patient.id}`} className="font-medium hover:underline"><PatientName name={c.patient.name} koreanName={c.patient.koreanName} showMrn={false} maskable /></Link> : '—'}
            {c.surgeon && <> · <Data>{c.surgeon}</Data></>} · {anesthesiaText(c.anesthesiaType)}
          </p>
        </div>
        <span className="flex shrink-0 flex-col gap-1">
          <Link href={`/or-chart/${c.id}`} className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-center text-[11px] font-semibold text-white hover:bg-indigo-700"><T k="수술방 차트" /></Link>
          <Link href={`/surgery/${c.id}`} className="rounded-lg bg-gray-900 px-2.5 py-1.5 text-center text-[11px] font-semibold text-white hover:bg-gray-700"><T k="상세" /></Link>
        </span>
      </div>
      <div className="mt-2.5 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <Phases c={c} />
          <SafetyChips c={c} />
        </div>
        {c.status !== 'SCHEDULED' && (
          <div className="w-full lg:w-56 space-y-2">
            <Progress c={c} />
            <Vitals c={c} />
          </div>
        )}
      </div>
    </article>
  );
}

function RoomCard({ r }: { r: LiveRoom }) {
  const current = r.cases.find((c) => c.id === r.currentCaseId);
  const next = r.cases.find((c) => c.id === r.nextCaseId);
  const done = r.cases.filter((c) => isLive(c) && c.status === 'COMPLETED').length;
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm" data-room-state={r.state}>
      <header className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-base font-black text-gray-900"><Data>{r.name}</Data> {r.floor && <span className="text-xs font-normal text-gray-400"><Data>{r.floor}</Data></span>}</h3>
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <Tf k="오늘 {전체}건 · 완료 {완료}" params={{ 전체: r.cases.length, 완료: done }} />
          <span className={`rounded-full px-2 py-0.5 font-bold ${STATE_TONE[r.state]}`}><T k={STATE_KEY[r.state]} /></span>
        </div>
      </header>
      {current && isLive(current) ? <CaseCard c={current} emphasis /> : <p className="rounded-xl bg-gray-50 px-3 py-4 text-center text-xs text-gray-400"><T k="진행 중인 수술 없음" /></p>}
      {next && isLive(next) && (
        <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-gray-600">
          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800"><T k="다음" /></span>
          <span className="tabular-nums">{next.slot?.startTime}</span> · <Data>{next.procedureName}</Data>
          {next.patient && <> · <PatientName name={next.patient.name} koreanName={next.patient.koreanName} showMrn={false} maskable /></>}
          {!next.safety.signIn && <span className="text-[10px] text-amber-700">· <T k="Sign-In 전" /></span>}
        </p>
      )}
      {r.cases.some((c) => !isLive(c)) && <p className="mt-1 text-[10px] text-rose-600"><T k="예약은 있는데 수술 기록을 찾지 못한 칸이 있습니다." /></p>}
    </section>
  );
}

export default function SurgeryLiveBoard() {
  const tAttr = useTAttr();
  const q = useQuery({
    queryKey: ['surgery-live-board'],
    queryFn: () => apiClient.get<{ data: LiveBoard }>('/api/v1/surgery/live-board'),
    refetchInterval: pollMs('fast'),
  });
  // 🔴 조회 실패를 "수술 없음"으로 말하지 않는다
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data?.data;
  if (!b) return <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />;
  const s = b.summary;
  const chip = (k: React.ReactNode, v: number, tone: string) => (
    <div className={`rounded-xl px-3 py-2 ${tone}`}><p className="text-[11px] font-medium">{k}</p><p className="text-2xl font-black tabular-nums">{v}</p></div>
  );
  return (
    <div className="space-y-4" aria-label={tAttr('수술실 실시간 모니터')}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2" data-live-summary>
        {chip(<Tf k="사용 중 방 / 전체 {수}" params={{ 수: s.rooms }} />, s.inUse, 'bg-rose-50 text-rose-800')}
        {chip(<T k="진행 중" />, s.inProgress, 'bg-amber-50 text-amber-800')}
        {chip(<T k="예정" />, s.scheduled, 'bg-sky-50 text-sky-800')}
        {chip(<T k="완료" />, s.completed, 'bg-emerald-50 text-emerald-800')}
        {chip(<T k="예상 소요 초과" />, s.overrun, s.overrun > 0 ? 'bg-rose-100 text-rose-800' : 'bg-gray-50 text-gray-500')}
      </div>
      {s.staleInProgress > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <Tf k="어제 이전에 시작해 아직 '진행 중'인 수술 {수}건 — 종료 기록이 빠졌을 수 있습니다." params={{ 수: s.staleInProgress }} />
        </p>
      )}
      <DayGantt rooms={b.rooms} now={b.now} />
      <div className="grid gap-3 xl:grid-cols-2">
        {b.rooms.map((r) => <RoomCard key={r.id} r={r} />)}
      </div>
      {b.unassigned.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-bold text-gray-700"><Tf k="수술방 미배정 {수}건" params={{ 수: b.unassigned.length }} /></h3>
          {b.unassigned.map((c) => <CaseCard key={c.id} c={c} emphasis={c.status === 'IN_PROGRESS'} />)}
        </section>
      )}
    </div>
  );
}
