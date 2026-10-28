'use client';
import { ReasonInput, reasonFilled } from '@/components/ui/ReasonInput';
import { kdate } from '@/lib/ui-settings';

import { useEffect, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { apiClient } from '@/lib/api-client';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

// 팀 캘린더(부서장 전용, P2-3) — 부서 휴가+당직 월뷰·인력공백 하이라이트·대결(위임) 관리
interface TeamDay { date: string; leaves: { name: string; type: string; status: string }[]; duties: { name: string; shift: string }[]; understaffed: boolean }
interface TeamData { members: { staffId: string; name: string; position?: string | null }[]; days: TeamDay[]; warnRatio: number | null }
interface Delegation { id: string; delegatorStaffId: string; delegateStaffId: string; fromDate: string; toDate: string; reason: string }

const LEAVE_KO: Record<string, string> = { ANNUAL: '연차', HALF: '반차', SICK: '병가', BEREAVEMENT: '경조', OUTING: '외출' };
const unwrap = <T,>(r: unknown): T => {
  const raw = (r as { data?: unknown })?.data as { data?: T } | T | undefined;
  return ((raw as { data?: T })?.data ?? raw) as T;
};

export default function StaffTeamPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, isAuthenticated, loadProfile } = useAuthStore();
  const [ready, setReady] = useState(false);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [dgForm, setDgForm] = useState({ delegateStaffId: '', fromDate: '', toDate: '', reason: '' });
  const tAttr = useTAttr();

  useEffect(() => {
    (async () => {
      if (!isAuthenticated) { router.replace('/staff/login?next=/staff/team'); return; }
      if (!user) { try { await loadProfile(); } catch { router.replace('/staff/login'); return; } }
      setReady(true);
    })();
  }, [isAuthenticated, user, loadProfile, router]);

  const team = useQuery({
    queryKey: ['team-calendar', month],
    queryFn: () => apiClient.get(`/api/v1/ess/team/calendar?month=${month}`).then((r) => unwrap<TeamData>(r)),
    enabled: ready,
  });
  const delegations = useQuery({
    queryKey: ['delegations'],
    queryFn: () => apiClient.get('/api/v1/ess/approvals/delegation').then((r) => unwrap<Delegation[]>(r) ?? []),
    enabled: ready,
  });
  const createDg = useMutation({
    mutationFn: () => apiClient.post('/api/v1/ess/approvals/delegation', dgForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delegations'] }); setDgForm({ delegateStaffId: '', fromDate: '', toDate: '', reason: '' }); },
  });
  const revokeDg = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/ess/approvals/delegation/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delegations'] }),
  });

  if (!ready) return <div className="min-h-screen flex items-center justify-center text-gray-400"><T k="로딩 중…" /></div>;
  const d = team.data;

  return (
    <div className="min-h-[100dvh] bg-[#f0f4f8]">
      <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/60 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <button onClick={() => router.push('/staff')} className="p-1 -ml-1 rounded-lg hover:bg-gray-100" aria-label={tAttr('내부포털로')}>
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="font-bold text-gray-800"><T k="팀 캘린더 (휴가·당직)" /></span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="ml-auto px-2 py-1 text-xs border border-gray-200 rounded-lg" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        {/* 🔴 종전엔 조회 실패·로딩도 전부 "관리 중인 팀이 없습니다(부서장 전용 화면)" 로 떨어져
            **장애가 '당신은 부서장이 아니다'로 읽혔다**. 세 상태를 갈라 말한다. */}
        {team.isLoading ? (
          <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 text-center text-sm text-gray-400">
            <T k="팀 캘린더를 불러오는 중…" />
          </section>
        ) : team.isError ? (
          <section className="rounded-2xl bg-white border border-amber-200 bg-amber-50 shadow-sm p-6 text-center">
            <p className="text-sm font-medium text-amber-800"><T k="팀 캘린더를 불러오지 못했습니다." /></p>
            <p className="text-xs text-amber-700 mt-1"><Tf k="권한 문제가 아니라 {실패}입니다 — 관리 중인 팀이 없다는 뜻이 아닙니다." params={{ 실패: <b><T k="조회 실패" /></b> }} /></p>
            <button onClick={() => team.refetch()} className="mt-3 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs text-amber-800"><T k="다시 시도" /></button>
          </section>
        ) : !d || d.members.length === 0 ? (
          <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 text-center text-sm text-gray-400">
            <T k="관리 중인 팀이 없습니다(부서장 전용 화면)" />
          </section>
        ) : (
          <>
            <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-400 mb-1.5"><Tf k="팀원 {인원}" params={{ 인원: <>{d.members.length}<Unit>명</Unit></> }} /></p>
              <div className="flex flex-wrap gap-1.5">
                {d.members.map((m) => (
                  <span key={m.staffId} className="px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-600">{m.name}{m.position ? ` · ${m.position}` : ''}</span>
                ))}
              </div>
            </section>

            <section className="rounded-2xl bg-white border border-gray-100 shadow-sm divide-y divide-gray-50">
              {d.days.filter((day) => day.leaves.length || day.duties.length || day.understaffed).map((day) => (
                <div key={day.date} className={`px-4 py-2.5 ${day.understaffed ? 'bg-rose-50/50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-800">
                      {kdate(day.date, 'monthDayWeekday')}
                    </span>
                    {day.understaffed && <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-100 text-rose-700 font-medium"><T k="인력공백 주의" /></span>}
                  </div>
                  {day.leaves.length > 0 && (
                    <div className="mt-1 text-[11px] text-gray-600">
                      🏖 {day.leaves.map((l) => `${l.name}(${tAttr(LEAVE_KO[l.type] ?? l.type)}${l.status === 'REQUESTED' ? `·${tAttr('결재중')}` : ''})`).join(', ')}
                    </div>
                  )}
                  {day.duties.length > 0 && (
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      🌙 <Tf k="당직: {목록}" params={{ 목록: day.duties.map((x) => `${x.name}(${x.shift})`).join(', ') }} />
                    </div>
                  )}
                </div>
              ))}
              {d.days.every((day) => !day.leaves.length && !day.duties.length && !day.understaffed) && (
                <div className="px-4 py-8 text-center text-xs text-gray-400"><T k="이 달의 휴가·당직 일정이 없습니다" /></div>
              )}
            </section>

            <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
              <p className="text-sm font-semibold text-gray-800 mb-2"><T k="결재 대결(위임)" /></p>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <select value={dgForm.delegateStaffId} onChange={(e) => setDgForm({ ...dgForm, delegateStaffId: e.target.value })} className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg col-span-2">
                  <option value="">{tAttr('수임자 선택(팀원)')}</option>
                  {d.members.map((m) => <option key={m.staffId} value={m.staffId}>{m.name}{m.position ? ` · ${m.position}` : ''}</option>)}
                </select>
                <input type="date" value={dgForm.fromDate} onChange={(e) => setDgForm({ ...dgForm, fromDate: e.target.value })} className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
                <input type="date" value={dgForm.toDate} onChange={(e) => setDgForm({ ...dgForm, toDate: e.target.value })} className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
                <div className="col-span-2"><ReasonInput domain="approvalDelegate" required value={dgForm.reason} onChange={(v) => setDgForm({ ...dgForm, reason: v })} placeholder="위임 사유(필수)" className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg" /></div>
              </div>
              <button disabled={!dgForm.delegateStaffId || !dgForm.fromDate || !dgForm.toDate || !reasonFilled(dgForm.reason) || createDg.isPending}
                onClick={() => createDg.mutate()}
                className="w-full py-1.5 rounded-lg bg-purple-600 text-white text-xs font-medium disabled:opacity-40"><T k="위임 지정" /></button>
              <div className="mt-2 space-y-1">
                {(delegations.data ?? []).map((dg) => (
                  <div key={dg.id} className="flex items-center justify-between text-[11px] text-gray-600">
                    <span>{String(dg.fromDate).slice(0, 10)}~{String(dg.toDate).slice(0, 10)} — {dg.reason}</span>
                    <button onClick={() => revokeDg.mutate(dg.id)} className="text-red-500 hover:underline"><T k="해제@지정" /></button>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
