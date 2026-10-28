'use client';

import { useEffect, useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { APPOINTMENT_STATUS_LABEL, type ErpReadFailure } from '@hospital-run/shared';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { ErpFailureNote } from '@/app/(main)/ess/_components/ErpFailureNote';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface Appt { id: string; scheduledAt: string; patientName?: string; status: string; departmentName?: string }

const hhmm = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(11, 16);

// 내부포털(모바일) 전용 진료 대시보드 — 오늘 상태·내 일정·빠른 진입.
export default function StaffDashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated, loadProfile } = useAuthStore();
  const [ready, setReady] = useState(false);
  const tAttr = useTAttr();

  useEffect(() => {
    (async () => {
      if (!isAuthenticated) { router.replace('/staff/login'); return; }
      if (!user) { try { await loadProfile(); } catch { router.replace('/staff/login'); return; } }
      setReady(true);
    })();
  }, [isAuthenticated, user, loadProfile, router]);

  const me = useQuery({ queryKey: ['ess-me'], queryFn: () => apiClient.get<{ data: any }>('/api/v1/hr/me'), enabled: ready });
  const att = useQuery({ queryKey: ['ess-attendance'], queryFn: () => apiClient.get<{ data: any[] }>('/api/v1/ess/attendance'), enabled: ready });
  const appts = useQuery({
    queryKey: ['staff-today-appts', user?.id],
    // 🔴 date=today 는 서버 특례가 있었지만 전역 DateQueryPipe(YYYY-MM-DD 강제)가 앞에서 400 으로 거른다 — 실날짜(KST)로 보낸다
    queryFn: () => apiClient.get<{ data: Appt[] | { data: Appt[] } }>(`/api/v1/appointments?date=${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })}&doctorId=${user?.id}&limit=30`),
    enabled: ready && !!user?.id,
  });
  const leaveBal = useQuery({
    queryKey: ['ess-leave-balance'],
    queryFn: () => apiClient.get<{ data: { type: string; remaining: number }[] }>('/api/v1/ess/leave/balance').then((r) => (r.data as any)?.data ?? r.data ?? []),
    enabled: ready,
  });
  const hrInbox = useQuery({
    queryKey: ['ess-approvals-inbox'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/ess/approvals/inbox').then((r) => ((r.data as any)?.data ?? r.data ?? []) as unknown[]),
    enabled: ready,
    refetchInterval: 60000,
  });
  const duties = useQuery({
    queryKey: ['staff-duties'],
    queryFn: () => {
      const now = new Date();
      const to = new Date(now.getTime() + 13 * 86400000);
      // 🔴 같은 파일의 외래 예약은 이미 KST 로 고쳤는데 근무표 범위만 UTC 였다 — 새벽에 하루 밀린다
      const fmt = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
      // 🔴 R59 — `items: null` 은 "근무 없음"이 아니라 못 받은 것(failure 에 사유). `?? []` 로 뭉개면 실패한 날 근무표 섹션이 그냥 사라진다.
      return apiClient.get<{ data: { items?: Array<{ date?: string; shift?: string; ward?: string; role?: string; note?: string }> | null; available?: boolean; failure?: ErpReadFailure; upstreamStatus?: number | null } }>(`/api/v1/ess/duties?from=${fmt(now)}&to=${fmt(to)}`).then((r) => r.data);
    },
    enabled: ready,
  });
  const dutyItems = duties.data?.items ?? [];
  const dutiesDown = !duties.isLoading && !duties.isError && duties.data?.available === false;

  if (!ready) return <div className="min-h-screen flex items-center justify-center text-gray-400"><T k="로딩 중…" /></div>;

  const staff = me.data?.data;
  const today = (att.data?.data ?? []).find((a) => a.type === 'CLOCK_IN' && new Date(a.at).toDateString() === new Date().toDateString());
  const raw = appts.data?.data;
  const list: Appt[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
  const isNurse = user?.role === 'NURSE';

  return (
    <div className="min-h-[100dvh] bg-[#f0f4f8]">
      <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/60 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <button onClick={() => router.push('/staff')} aria-label={tAttr('내부포털로')} className="p-1 -ml-1 rounded-lg hover:bg-gray-100">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="font-bold text-gray-800"><T k="진료 대시보드" /></span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        {/* 인사·근무상태 */}
        <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
          <p className="text-lg font-bold text-gray-900"><Tf k="{이름} 님" params={{ 이름: staff ? `${staff.familyName}${staff.givenName}` : (user?.familyName ?? '') }} /></p>
          <p className="text-xs text-gray-400">{staff?.department ?? ''} {staff?.position ?? ''} · {kdate(new Date(), 'monthDayWeekday')}</p>
          <div className="mt-2 text-sm">
            {today
              ? <span className="text-emerald-600"><Tf k="근무 중 · 출근 {시각}" params={{ 시각:kdate(today.at, 'time') }} /></span>
              : <span className="text-gray-400"><T k="오늘 출근 기록 없음" /> — <button onClick={() => router.push('/staff/login')} className="text-blue-600 underline"><T k="출근하기" /></button></span>}
          </div>
          {me.isError && <div className="mt-2"><QueryErrorFallback error={me.error} onRetry={me.refetch} size="compact" /></div>}
        </section>

        {/* 오늘 내 일정 */}
        <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-sm text-gray-800"><T k="오늘 내 진료" /></h2>
            <span className="text-xs text-gray-400">{appts.isError ? <T k="조회 실패" /> : <>{list.length}<Unit>건</Unit></>}</span>
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {/* 🔴 조회 실패를 "오늘 예약이 없습니다"로 말하지 않는다 */}
            {appts.isError && <QueryErrorFallback error={appts.error} onRetry={appts.refetch} size="compact" />}
            {!appts.isError && list.map((a) => (
              <button key={a.id} onClick={() => router.push('/tablet')} className="w-full flex items-center justify-between text-sm border-b border-gray-50 pb-1.5 text-left">
                <span className="font-medium text-gray-700">{hhmm(a.scheduledAt)} · {a.patientName ?? <T k="환자" />}</span>
                <span className="text-xs text-gray-400"><T k={APPOINTMENT_STATUS_LABEL[a.status] ?? a.status} /></span>
              </button>
            ))}
            {!appts.isError && list.length === 0 && <p className="text-xs text-gray-400 py-2"><T k="오늘 예약이 없습니다." /></p>}
          </div>
        </section>

        {/* 연차·결재 (P0) */}
        <section className="grid grid-cols-2 gap-2.5">
          <button onClick={() => router.push('/staff/ess')} className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 text-left">
            <p className="text-[11px] text-gray-400"><T k="연차 잔여" /></p>
            <p className="text-xl font-bold text-gray-900">
              {leaveBal.isError ? <T k="조회 실패" /> : (() => { const a = (leaveBal.data as { type: string; remaining: number }[] | undefined)?.find((b) => b.type === 'ANNUAL'); return a ? <Tf k="{일수}일" params={{ 일수: a.remaining }} /> : '—'; })()}
            </p>
            <p className="text-[10px] text-blue-600 mt-0.5"><T k="휴가 신청" /> →</p>
          </button>
          <button onClick={() => router.push('/staff/approvals')} className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 text-left relative">
            <p className="text-[11px] text-gray-400"><T k="결재 대기" /></p>
            <p className="text-xl font-bold text-gray-900">{hrInbox.isError ? <T k="조회 실패" /> : <>{(hrInbox.data as unknown[] | undefined)?.length ?? 0}<Unit>건</Unit></>}</p>
            <p className="text-[10px] text-blue-600 mt-0.5"><T k="결재함" /> →</p>
            {!hrInbox.isError && ((hrInbox.data as unknown[] | undefined)?.length ?? 0) > 0 && (
              <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-red-500" />
            )}
          </button>
        </section>
        {leaveBal.isError && <QueryErrorFallback error={leaveBal.error} onRetry={leaveBal.refetch} size="compact" />}
        {hrInbox.isError && <QueryErrorFallback error={hrInbox.error} onRetry={hrInbox.refetch} size="compact" />}

        {/* 당직/근무표(ERP) */}
        {duties.isError && (
          <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
            <h2 className="font-semibold text-sm text-gray-800 mb-2"><T k="당직 · 근무 (2주)" /></h2>
            <QueryErrorFallback error={duties.error} onRetry={duties.refetch} size="compact" />
          </section>
        )}
        {dutiesDown && (
          <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
            <h2 className="font-semibold text-sm text-gray-800 mb-2"><T k="당직 · 근무 (2주)" /></h2>
            <ErpFailureNote failure={duties.data?.failure} upstreamStatus={duties.data?.upstreamStatus} onRetry={() => void duties.refetch()}><T k="근무표를 확인할 수 없습니다" /></ErpFailureNote>
          </section>
        )}
        {!duties.isError && !dutiesDown && dutyItems.length > 0 && (
          <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
            <h2 className="font-semibold text-sm text-gray-800 mb-2"><T k="당직 · 근무 (2주)" /></h2>
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {dutyItems.map((d, i) => (
                <div key={i} className="flex items-center justify-between text-sm border-b border-gray-50 pb-1">
                  <span className="text-gray-700">{d.date?.slice(5) ?? ''} {d.shift ?? ''}</span>
                  <span className="text-xs text-gray-400">{d.ward ?? ''}{d.role ? ` · ${d.role}` : ''}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 빠른 진입 */}
        <section className="grid grid-cols-2 gap-2.5">
          <a href="/tablet" className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 flex items-center gap-2"><span className="text-xl">👥</span><span className="text-sm font-semibold text-gray-800"><T k="환자 차트" /></span></a>
          {isNurse && <a href="/tablet/nursing" className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 flex items-center gap-2"><span className="text-xl">💉</span><span className="text-sm font-semibold text-gray-800"><T k="간호 라운딩" /></span></a>}
          <a href="/staff/ess" className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 flex items-center gap-2"><span className="text-xl">🗂️</span><span className="text-sm font-semibold text-gray-800"><T k="내 행정" /></span></a>
          <a href="/staff/payroll" className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 flex items-center gap-2"><span className="text-xl">💳</span><span className="text-sm font-semibold text-gray-800"><T k="급여@인사" /></span></a>
          <a href="/notifications" className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 flex items-center gap-2"><span className="text-xl">🔔</span><span className="text-sm font-semibold text-gray-800"><T k="알림" /></span></a>
        </section>
      </main>
    </div>
  );
}
