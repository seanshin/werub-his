'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NursingShift } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { kstToday, kstDateOf } from '@/lib/kst-today';
import { KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, Data, useTAttr } from '@/components/ui/i18n-text';

/**
 * ⑩ 간호 스테이션 벽걸이(TV) 화면 — `GET /api/v1/nursing/station-board/wall`.
 *  🔴 방문객·환자도 보는 자리다 — 마스킹은 **서버가** 한다(이 화면은 받은 것만 그린다 · 이름 홍○동 · 메모·검사값·술식명 없음).
 *  · 글자 크게 · 자동 갱신 · 병동은 주소 `?ward=` 로 고정(벽에 걸어 두는 화면이라 고르는 손이 없다)
 *  · 24시간 넘은 평가는 서버가 등급을 지운다(오래된 값이 지금처럼 읽히지 않게)
 */
type WallPatient = {
  room: string; bed: string; ward: string; name: string | null; highRisk: boolean;
  ewsRisk: string | null; ewsStale: boolean; fallRisk: string | null; isolation: string[];
  medsOverdue: number; criticalOpen: number; surgeryAt: string | null; surgeryInProgress: boolean;
  npo: boolean; expectedDischargeAt: string | null; transferPending: boolean; nurse: string | null; handoffUnacked: boolean;
};
type Wall = {
  shift: { current: NursingShift; start: string; end: string } | null;
  wardName: string | null; generatedAt: string;
  patients: WallPatient[];
  summary: { total: number; highRisk: number; isolated?: number; medsOverdue: number; criticalOpenPatients: number; npo: number; surgeryUpcoming: number; dischargeToday: number };
};

const SHIFT_KEY: Record<NursingShift, string> = { DAY: '주간@근무조', EVENING: '초번', NIGHT: '야간' };
const EWS_TONE: Record<string, string> = { HIGH: 'bg-rose-600 text-white', MEDIUM: 'bg-amber-500 text-slate-950', LOW_MEDIUM: 'bg-yellow-300 text-slate-950', LOW: 'bg-slate-700 text-slate-200' };

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  return <span className="tabular-nums"><KDate value={now.toISOString()} mode="time" /></span>;
}

function Tile({ p }: { p: WallPatient }) {
  const today = kstToday();
  const ring = p.criticalOpen > 0 ? 'ring-4 ring-rose-500' : p.highRisk ? 'ring-2 ring-rose-400' : 'ring-1 ring-slate-700';
  return (
    <article className={`flex flex-col gap-2 rounded-2xl bg-slate-900 p-4 ${ring}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-3xl font-black tabular-nums tracking-tight">{p.room}-{p.bed}</span>
        {p.ewsRisk
          ? <span className={`rounded-lg px-2 py-0.5 text-sm font-bold ${EWS_TONE[p.ewsRisk] ?? 'bg-slate-700'}`}>EWS {p.ewsRisk}</span>
          : p.ewsStale ? <span className="text-xs text-slate-500"><T k="EWS 24시간 경과" /></span> : null}
      </div>
      <p className="text-xl font-semibold text-slate-200"><Data>{p.name ?? '-'}</Data></p>
      <div className="flex flex-wrap gap-1.5 text-sm font-semibold">
        {p.criticalOpen > 0 && <span className="rounded-md bg-rose-600 px-2 py-0.5 text-white">⚠ <Tf k="위급값 미확인 {수}" params={{ 수: p.criticalOpen }} /></span>}
        {p.medsOverdue > 0 && <span className="rounded-md bg-amber-500 px-2 py-0.5 text-slate-950"><Tf k="투약 지연 {수}" params={{ 수: p.medsOverdue }} /></span>}
        {p.isolation.length > 0 && <span className="rounded-md bg-orange-500 px-2 py-0.5 text-slate-950"><T k="격리" /></span>}
        {p.npo && <span className="rounded-md bg-sky-500 px-2 py-0.5 text-slate-950">NPO</span>}
        {(p.surgeryInProgress || p.surgeryAt) && (
          <span className="rounded-md bg-violet-500 px-2 py-0.5 text-white">
            {p.surgeryInProgress ? <T k="수술 중" /> : <><T k="수술" /> {kstDateOf(p.surgeryAt) !== today && <T k="내일" />} <KDate value={p.surgeryAt} mode="time" /></>}
          </span>
        )}
        {p.fallRisk && p.fallRisk !== 'LOW' && <span className="rounded-md bg-slate-700 px-2 py-0.5 text-amber-300"><T k="낙상" /> {p.fallRisk}</span>}
        {p.expectedDischargeAt && kstDateOf(p.expectedDischargeAt) === today && <span className="rounded-md bg-teal-500 px-2 py-0.5 text-slate-950"><T k="오늘 퇴원 예정" /></span>}
        {p.transferPending && <span className="rounded-md bg-slate-700 px-2 py-0.5 text-slate-200"><T k="전동 요청" /></span>}
        {p.handoffUnacked && <span className="rounded-md bg-slate-700 px-2 py-0.5 text-rose-300"><T k="인계 미확인" /></span>}
      </div>
      <p className="mt-auto text-sm text-slate-400">
        {p.nurse ? <><T k="담당" /> <Data>{p.nurse}</Data></> : <T k="담당 배정 없음" />}
      </p>
    </article>
  );
}

export default function StationWallPage() {
  const tAttr = useTAttr();
  const [ward, setWard] = useState<string | null>(null);
  useEffect(() => { setWard(new URLSearchParams(window.location.search).get('ward')); }, []);
  const q = useQuery({
    queryKey: ['station-wall', ward],
    queryFn: () => apiClient.get<{ data: Wall }>(`/api/v1/nursing/station-board/wall${ward ? `?wardId=${encodeURIComponent(ward)}` : ''}`),
    refetchInterval: pollMs('normal'),
  });
  const w = q.data?.data;
  const full = () => { try { void document.documentElement.requestFullscreen?.(); } catch { /* 전체화면을 못 해도 화면은 그대로 */ } };

  return (
    <div className="p-6">
      <header className="mb-5 flex flex-wrap items-center gap-4">
        <h1 className="text-3xl font-black"><T k="간호 스테이션" /> · {w?.wardName ? <Data>{w.wardName}</Data> : <T k="전체 병동" />}</h1>
        {w?.shift && (
          <span className="rounded-xl bg-indigo-600 px-3 py-1 text-lg font-bold">
            <T k={SHIFT_KEY[w.shift.current]} /> <span className="font-normal tabular-nums"><KDate value={w.shift.start} mode="time" />–<KDate value={w.shift.end} mode="time" /></span>
          </span>
        )}
        <span className="ml-auto text-4xl font-black"><Clock /></span>
        <button type="button" onClick={full} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700" aria-label={tAttr('전체 화면')}>⛶</button>
      </header>

      {q.isError ? (
        <div className="rounded-2xl bg-white p-6 text-slate-900"><QueryErrorFallback error={q.error} onRetry={() => q.refetch()} /></div>
      ) : !w ? (
        <p className="text-xl text-slate-400"><T k="불러오는 중…" /></p>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-3 text-lg" data-wall-summary>
            <span className="rounded-xl bg-slate-800 px-4 py-2"><T k="재원" /> <b className="tabular-nums">{w.summary.total}</b></span>
            <span className={`rounded-xl px-4 py-2 ${w.summary.criticalOpenPatients > 0 ? 'bg-rose-600' : 'bg-slate-800 text-slate-400'}`}><T k="위급값 미확인" /> <b className="tabular-nums">{w.summary.criticalOpenPatients}</b></span>
            <span className={`rounded-xl px-4 py-2 ${w.summary.highRisk > 0 ? 'bg-rose-900' : 'bg-slate-800 text-slate-400'}`}><T k="고위험(EWS)" /> <b className="tabular-nums">{w.summary.highRisk}</b></span>
            <span className={`rounded-xl px-4 py-2 ${w.summary.medsOverdue > 0 ? 'bg-amber-600' : 'bg-slate-800 text-slate-400'}`}><T k="투약 지연 환자" /> <b className="tabular-nums">{w.summary.medsOverdue}</b></span>
            <span className="rounded-xl bg-slate-800 px-4 py-2 text-slate-300"><T k="오늘·내일 수술" /> <b className="tabular-nums">{w.summary.surgeryUpcoming}</b></span>
            <span className="rounded-xl bg-slate-800 px-4 py-2 text-slate-300"><T k="오늘 퇴원 예정" /> <b className="tabular-nums">{w.summary.dischargeToday}</b></span>
          </div>
          {w.patients.length === 0 ? (
            <p className="text-2xl text-slate-400"><T k="재원 환자가 없습니다." /></p>
          ) : (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
              {w.patients.map((p) => <Tile key={`${p.ward}-${p.room}-${p.bed}`} p={p} />)}
            </div>
          )}
          <p className="mt-6 text-sm text-slate-500">
            <T k="이름은 가려서 보입니다 — 인계 메모·검사값은 이 화면에 나오지 않습니다." /> · <T k="갱신" /> <KDate value={w.generatedAt} mode="time" />
          </p>
        </>
      )}
    </div>
  );
}
