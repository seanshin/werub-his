'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { EmptyState, KDate } from '@/components/ui/display';
import { FreshnessBadge } from '@/components/dashboard/FreshnessBadge';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { kstToday, kstDateOf } from '@/lib/kst-today';
import { useAuthStore } from '@/stores/auth-store';
import { T, Tf, Data, useTAttr } from '@/components/ui/i18n-text';
import { HandoffBoard } from './HandoffBoard';
import { StaffingPanel } from './StaffingPanel';
import { PatientCard, PatientTable } from './PatientViews';
import { AssignBar, canAssignRole, useTakeOver } from './AssignControls';
import { SHIFT_KEY, type BoardResp, type Row } from './board-types';

type Filter = 'all' | 'highRisk' | 'isolated' | 'medsOverdue' | 'unsigned' | 'handoffPending' | 'noNote' | 'noVitals' | 'noHandoff' | 'medsPending' | 'critical' | 'surgery' | 'npo' | 'discharge' | 'transfer' | 'vitalsNever';
type View = 'cards' | 'table';

const FILTERS: Record<Exclude<Filter, 'all'>, (r: Row) => boolean> = {
  highRisk: (r) => r.highRisk,
  isolated: (r) => (r.isolation?.length ?? 0) > 0,
  medsOverdue: (r) => r.meds.overdue > 0,
  unsigned: (r) => r.unsignedNotes > 0,
  // 마지막 인계가 아직 인수 확인 전인 환자
  handoffPending: (r) => !!r.handoff && !r.handoff.acknowledgedAt,
  // 이번 근무조 기록 없음(유무만) — 구버전 응답(shiftRecord 없음)은 걸리지 않는다(모르는 것을 '없음'으로 세지 않는다)
  noNote: (r) => r.shiftRecord?.notes === 0,
  noVitals: (r) => r.shiftRecord?.vitals === 0,
  noHandoff: (r) => r.shiftRecord?.handoffs === 0,
  medsPending: (r) => (r.shiftRecord?.medsPending ?? 0) > 0,
  critical: (r) => (r.criticalOpen?.length ?? 0) > 0,
  surgery: (r) => !!r.surgery,
  npo: (r) => !!r.npo,
  discharge: (r) => !!r.expectedDischargeAt && kstDateOf(r.expectedDischargeAt) === kstToday(),
  transfer: (r) => !!r.transferPending,
  vitalsNever: (r) => r.lastVitalsAt === null,
};

/** 안전·일정 신호 막대(④~⑦) — 해당 환자 수 · 누르면 거른다 · 0 인 것은 흐리게(초록으로 안심시키지 않는다) */
function SignalBar({ s, filter, toggle }: { s: BoardResp['summary']; filter: Filter; toggle: (f: Filter) => void }) {
  if (s.criticalOpenPatients == null) return null; // 구버전 응답
  const item = (f: Filter, label: React.ReactNode, n: number, hot: string) => (
    <button key={f} type="button" onClick={() => toggle(f)} aria-pressed={filter === f}
      className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${filter === f ? 'bg-gray-900 text-white' : n > 0 ? hot : 'bg-white text-gray-400 ring-1 ring-inset ring-gray-200'}`}>
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-gray-200 bg-white px-3 py-2" data-signal-bar>
      <span className="mr-1 text-xs font-semibold text-gray-700"><T k="안전·일정" /></span>
      {item('critical', <Tf k="위급값 미확인 {수}명" params={{ 수: s.criticalOpenPatients ?? 0 }} />, s.criticalOpenPatients ?? 0, 'bg-rose-600 text-white hover:bg-rose-700')}
      {item('vitalsNever', <Tf k="활력 기록 없음 {수}명" params={{ 수: s.vitalsNever ?? 0 }} />, s.vitalsNever ?? 0, 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200')}
      {item('surgery', <Tf k="오늘·내일 수술 {수}명" params={{ 수: s.surgeryUpcoming ?? 0 }} />, s.surgeryUpcoming ?? 0, 'bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-200')}
      {item('npo', <Tf k="금식 {수}명" params={{ 수: s.npo ?? 0 }} />, s.npo ?? 0, 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200')}
      {item('discharge', <Tf k="오늘 퇴원 예정 {수}명" params={{ 수: s.dischargeToday ?? 0 }} />, s.dischargeToday ?? 0, 'bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200')}
      {item('transfer', <Tf k="전동 요청 {수}명" params={{ 수: s.transferPending ?? 0 }} />, s.transferPending ?? 0, 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200')}
      <span className="ml-auto text-[10px] text-gray-400">
        {s.vitalsStaleHours == null
          ? <T k="활력 경과 강조 기준 미설정 — 경과만 보입니다" />
          : <Tf k="활력 {시간}시간 넘으면 강조 · 해당 {수}명" params={{ 시간: s.vitalsStaleHours, 수: s.vitalsStale ?? 0 }} />}
      </span>
    </div>
  );
}

/** 병동 근무조 마감 막대 — 기록이 없는 환자 수 · 누르면 거른다 */
function CloseoutBar({ s, shiftKey, filter, toggle }: { s: BoardResp['summary']; shiftKey: string; filter: Filter; toggle: (f: Filter) => void }) {
  if (s.shiftWithoutNote == null) return null; // 구버전 응답
  // 라벨은 호출부에서 `<Tf k="…">` 리터럴로 — 키를 변수로 넘기면 i18n 가드가 등재 여부를 못 본다
  const item = (f: Filter, label: React.ReactNode, n: number) => (
    <button key={f} type="button" onClick={() => toggle(f)} aria-pressed={filter === f}
      className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${filter === f ? 'bg-gray-900 text-white' : n > 0 ? 'bg-white text-gray-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-50' : 'bg-white text-gray-400 ring-1 ring-inset ring-gray-200'}`}>
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2" data-closeout>
      <span className="mr-1 text-xs font-semibold text-gray-700"><T k={shiftKey} /> <T k="근무조 마감" /></span>
      {item('noNote', <Tf k="간호기록 없음 {수}명" params={{ 수: s.shiftWithoutNote ?? 0 }} />, s.shiftWithoutNote ?? 0)}
      {item('noVitals', <Tf k="활력 없음 {수}명" params={{ 수: s.shiftWithoutVitals ?? 0 }} />, s.shiftWithoutVitals ?? 0)}
      {item('noHandoff', <Tf k="인계 없음 {수}명" params={{ 수: s.shiftWithoutHandoff ?? 0 }} />, s.shiftWithoutHandoff ?? 0)}
      {item('medsPending', <Tf k="미처리 투약 {수}건" params={{ 수: s.shiftMedsPending ?? 0 }} />, s.shiftMedsPending ?? 0)}
      <span className="ml-auto text-[10px] text-gray-400"><T k="기록 유무만 — 충분한지는 판정하지 않습니다" /></span>
    </div>
  );
}

const VIEW_KEY = 'nursing-station.view';

/** 근무조 남은 시간 — 서버가 준 끝 시각 기준(브라우저 시간대로 근무조를 판정하지 않는다) */
function useRemaining(end?: string): { h: number; m: number } | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  if (!end) return null;
  const ms = new Date(end).getTime() - now;
  if (!(ms > 0)) return { h: 0, m: 0 };
  return { h: Math.floor(ms / 3_600_000), m: Math.floor((ms % 3_600_000) / 60_000) };
}

function Kpi({ label, value, hint, tone, active, onClick }: {
  label: string; value: number | null; hint?: React.ReactNode; tone: string; active: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`rounded-2xl border p-3.5 text-left transition-all hover:shadow-sm ${tone} ${active ? 'ring-2 ring-offset-1 ring-indigo-500' : ''}`}>
      {/* 🔴 값이 없으면(구버전 응답) 0 이 아니라 '-' */}
      <div className="text-2xl font-bold text-gray-900 tabular-nums">{value ?? '-'}</div>
      <div className="text-xs font-medium text-gray-600 mt-0.5"><T k={label} /></div>
      {hint && <div className="mt-0.5 text-[10px] text-gray-400">{hint}</div>}
    </button>
  );
}

export default function NursingStationBoard() {
  const tAttr = useTAttr();
  const myId = useAuthStore((s) => s.user?.id ?? null);
  const myRole = useAuthStore((s) => s.user?.role ?? null);
  const [wardId, setWardId] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<View>('cards');
  // 담당 배정 — 선택 모드(카드 보기에서만) · 내가 담당
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    try { const v = localStorage.getItem(VIEW_KEY); if (v === 'cards' || v === 'table') setView(v); } catch { /* 저장소 불가여도 기본 보기 */ }
  }, []);
  const pickView = (v: View) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* 무시 */ } };

  const queryKey = ['nursing-station', wardId];
  const { data, isLoading, isFetching, isError, error, refetch, dataUpdatedAt } = useQuery({
    queryKey,
    queryFn: () => apiClient.get<{ data: BoardResp }>(`/api/v1/nursing/station-board${wardId ? `?wardId=${wardId}` : ''}`),
    refetchInterval: pollMs('normal'),
  });
  const resp = data?.data;
  const rows = resp?.patients ?? [];
  const s = resp?.summary;
  const shift = resp?.shift;
  const remaining = useRemaining(shift?.end);
  const shown = filter === 'all' ? rows : rows.filter(FILTERS[filter]);
  const toggle = (f: Filter) => setFilter((cur) => (cur === f ? 'all' : f));
  const canAssign = canAssignRole(myRole);
  const takeOver = useTakeOver(queryKey);
  const endSelecting = () => { setSelecting(false); setPicked([]); };

  // F-5 WeRU.B 스테이션 브리핑(게이트 OFF면 에러 → 미표시)
  const briefingQ = useQuery({
    queryKey: ['nursing-briefing', wardId],
    queryFn: () => apiClient.get<{ data: { enabled: boolean; briefing: string } }>(`/api/v1/nursing/station-briefing${wardId ? `?wardId=${wardId}` : ''}`),
    refetchInterval: pollMs('slow'), retry: false,
  });
  const brief = ((briefingQ.data as { data?: { data?: { briefing?: string } } } | undefined)?.data?.data) ?? (briefingQ.data as { data?: { briefing?: string } } | undefined)?.data;

  return (
    <div className="space-y-4 p-4">
      {/* 머리 — 제목 · 지금 근무조 · 도구 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="간호 스테이션 보드" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="재원 환자 실시간 현황 — 조기경보(EWS)·투약 지연·낙상위험·미서명 기록·상하번 인계" /></p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {shift && (
            <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5" data-shift-now>
              <span className="rounded-md bg-indigo-600 px-1.5 py-0.5 text-[11px] font-bold text-white"><T k={SHIFT_KEY[shift.current]} /></span>
              <span className="text-xs text-indigo-900 tabular-nums"><KDate value={shift.start} mode="time" />–<KDate value={shift.end} mode="time" /></span>
              {remaining && <span className="text-[11px] text-indigo-700"><Tf k="교대까지 {시간}시간 {분}분" params={{ 시간: remaining.h, 분: remaining.m }} /></span>}
            </div>
          )}
          <Link href="/nurse-station" className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-50"><T k="인계 작성·근무조 마감" /></Link>
          <Link href="/tablet/nursing" className="px-3 py-1.5 bg-indigo-50 text-indigo-700 text-sm rounded-lg hover:bg-indigo-100">📱 <T k="타블렛 모드" /></Link>
          {/* 벽걸이(TV) — 새 창 · 고른 병동 고정 · 이름 마스킹은 서버가 한다 */}
          <a href={`/station-wall${wardId ? `?ward=${encodeURIComponent(wardId)}` : ''}`} target="_blank" rel="noopener noreferrer"
            className="px-3 py-1.5 bg-slate-800 text-white text-sm rounded-lg hover:bg-slate-700">📺 <T k="벽걸이 화면" /></a>
          <FreshnessBadge updatedAt={dataUpdatedAt} isFetching={isFetching} staleMs={35000} />
        </div>
      </div>

      {/* 🔴 조회 실패를 `?? 0` 으로 접으면 병동 보드가 "재원 0명 · 고위험 0명 · 미확인 인계 0"이라 말한다 —
          그것은 "괜찮다"가 아니라 **모른다**이다. KPI 를 0 으로 채우던 자리에 실패를 그대로 낸다. */}
      {isError ? (
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
          <Kpi label="재원 환자" value={s?.total ?? null} tone="border-gray-200 bg-white" active={filter === 'all'} onClick={() => setFilter('all')} hint={<T k="전체 보기" />} />
          <Kpi label="고위험(EWS)" value={s?.highRisk ?? null} tone="border-rose-200 bg-rose-50" active={filter === 'highRisk'} onClick={() => toggle('highRisk')} />
          <Kpi label="격리 환자" value={s?.isolated ?? null} tone="border-orange-200 bg-orange-50" active={filter === 'isolated'} onClick={() => toggle('isolated')} />
          <Kpi label="투약 지연 환자" value={s?.medsOverdue ?? null} tone="border-amber-200 bg-amber-50" active={filter === 'medsOverdue'} onClick={() => toggle('medsOverdue')} />
          <Kpi label="미서명 기록" value={s?.unsignedNotes ?? null} tone="border-gray-200 bg-white" active={filter === 'unsigned'} onClick={() => toggle('unsigned')} />
          <Kpi label="인계 미확인" value={s?.handoffsInWindowPending ?? null}
            tone={(s?.handoffsInWindowPending ?? 0) > 0 ? 'border-indigo-200 bg-indigo-50' : 'border-gray-200 bg-white'}
            active={filter === 'handoffPending'} onClick={() => toggle('handoffPending')}
            hint={s?.handoffPending != null ? <Tf k="직전·이번 근무조 · 누적 {수}" params={{ 수: s.handoffPending }} /> : undefined} />
        </div>
      )}

      {!isError && s && <SignalBar s={s} filter={filter} toggle={toggle} />}
      {!isError && s && shift && <CloseoutBar s={s} shiftKey={SHIFT_KEY[shift.current]} filter={filter} toggle={toggle} />}

      {!briefingQ.isError && brief?.briefing && (
        <div className="relative rounded-2xl border border-amber-200 bg-amber-50/40 p-4 pl-5">
          <span className="absolute left-0 top-0 h-full w-1 rounded-l bg-gradient-to-b from-amber-400 to-transparent" />
          {/* 🔴 AI 표기(AI기본법 §31)는 번역하지 않고 자리표시자로 끼운다 */}
          <p className="text-xs font-semibold text-amber-800 mb-1">✦ <Tf k="{출처} 브리핑" params={{ 출처: AI_ORIGIN_TEXT }} /></p>
          <p className="text-sm text-gray-800 leading-relaxed"><Data>{brief.briefing}</Data></p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(resp?.wards.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setWardId('')} className={`px-3 py-1.5 text-xs rounded-lg border ${!wardId ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600'}`}><T k="전체 병동" /></button>
            {resp!.wards.map((w) => <button key={w.id} onClick={() => setWardId(w.id)} className={`px-3 py-1.5 text-xs rounded-lg border ${wardId === w.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600'}`}><Data>{w.name}</Data></button>)}
          </div>
        )}
        {canAssign && shift && view === 'cards' && !selecting && rows.length > 0 && (
          <button type="button" onClick={() => setSelecting(true)}
            className="ml-auto rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
            <T k="담당 배정" />
          </button>
        )}
        <div className={`${canAssign && shift && view === 'cards' && !selecting && rows.length > 0 ? '' : 'ml-auto '}inline-flex rounded-lg border border-gray-200 bg-white p-0.5`} role="group" aria-label={tAttr('보기 방식')}>
          {(['cards', 'table'] as View[]).map((v) => (
            <button key={v} type="button" onClick={() => pickView(v)} aria-pressed={view === v}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${view === v ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              <T k={v === 'cards' ? '카드' : '표'} />
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* 환자 */}
        <div className="min-w-0">
          {filter !== 'all' && !isError && (
            <p className="mb-2 text-xs text-gray-500">
              <Tf k="걸러 보는 중 — {보임}명 / 전체 {전체}명" params={{ 보임: shown.length, 전체: rows.length }} />
              <button type="button" onClick={() => setFilter('all')} className="ml-2 text-indigo-700 hover:underline"><T k="해제" /></button>
            </p>
          )}
          {isLoading ? <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
          /* 🔴 실패는 "재원 환자가 없습니다"가 아니다 — 빈 목록으로 접으면 병동이 비었다고 읽힌다 */
          : isError ? <div className="rounded-2xl border border-gray-100 bg-white p-6"><QueryErrorFallback error={error} onRetry={() => refetch()} /></div>
          : !rows.length ? <div className="rounded-2xl border border-gray-100 bg-white"><EmptyState icon="👤" title="재원 환자가 없습니다." /></div>
          : !shown.length ? <div className="rounded-2xl border border-gray-100 bg-white"><EmptyState icon="✓" title="이 조건에 맞는 환자가 없습니다." /></div>
          : view === 'cards' ? (
            <>
              {selecting && shift && (
                <div className="mb-3">
                  <AssignBar selected={picked} shift={shift.current} staffing={resp?.staffing} queryKey={queryKey} onDone={endSelecting} onCancel={endSelecting} />
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {shown.map((r) => (
                  <PatientCard key={r.admissionId} r={r} vitalsStaleHours={s?.vitalsStaleHours} assign={canAssign ? {
                    selecting, selected: picked.includes(r.admissionId),
                    onToggle: () => setPicked((cur) => (cur.includes(r.admissionId) ? cur.filter((x) => x !== r.admissionId) : [...cur, r.admissionId])),
                    // 내가 지금 담당이 아니고, 근무조를 서버가 알려준 경우만 · 관리자는 넘겨받지 않는다(간호 담당이 아님)
                    canTakeOver: myRole === 'NURSE' && !!shift && r.nurse !== undefined && r.nurse?.id !== myId,
                    onTakeOver: () => shift && takeOver.mutate({ admissionId: r.admissionId, shift: shift.current }),
                    pending: takeOver.isPending,
                  } : undefined} />
                ))}
              </div>
            </>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto"><PatientTable rows={shown} vitalsStaleHours={s?.vitalsStaleHours} /></div>
          )}
        </div>

        {/* 상·하번 인계 메모 */}
        <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
          {isError ? null : resp ? <div className="space-y-4"><StaffingPanel staffing={resp.staffing} ward={resp.wards.find((w) => w.id === wardId) ?? null} isAdmin={myRole === 'ADMIN'} queryKey={queryKey} census={{ total: rows.length, unassigned: rows.some((r) => r.nurse === undefined) ? null : rows.filter((r) => r.nurse === null).length }} /><HandoffBoard board={resp} myId={myId} myRole={myRole} queryKey={queryKey} /></div> : (
            <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />
          )}
        </div>
      </div>
    </div>
  );
}
