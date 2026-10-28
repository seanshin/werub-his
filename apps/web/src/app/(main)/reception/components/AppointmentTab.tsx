'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useUiSettings, usePollInterval, formatKDate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { LoadingSkeleton } from './LoadingSkeleton';
import { EligibilityVerifyModal, type VerifyTarget } from './EligibilityVerifyModal';

import { EmptyState, Unit } from '@/components/ui/display';

interface AppointmentItem {
  id: string;
  patientId: string;
  doctorId: string;
  departmentName?: string;
  type: string;
  status: string;
  scheduledAt: string;
  patient?: { familyName: string; givenName: string; mrn: string };
  doctor?: { familyName: string; givenName: string };
}

/** 예약 시각 기준 상태 — 타임라인 색·뱃지 결정 */
type TimeState = 'late' | 'imminent' | 'upcoming';
function timeState(sched: Date, now: Date): TimeState {
  const diffMin = Math.round((sched.getTime() - now.getTime()) / 60_000);
  if (diffMin < -5) return 'late';        // 예약시각 5분 경과 — 지연(미접수)
  if (diffMin <= 30) return 'imminent';   // 30분 이내 — 곧 도착
  return 'upcoming';
}
function relativeLabel(sched: Date, now: Date): string {
  const diffMin = Math.round((sched.getTime() - now.getTime()) / 60_000);
  if (diffMin <= -60) return `${Math.floor(-diffMin / 60)}시간 ${-diffMin % 60 ? `${-diffMin % 60}<Unit>분</Unit> ` : ''}지남`;
  if (diffMin < -5) return `${-diffMin}분 지남`;
  if (diffMin < 0) return '지금';
  if (diffMin === 0) return '지금';
  if (diffMin <= 60) return `${diffMin}분 후`;
  return `${Math.floor(diffMin / 60)}시간 ${diffMin % 60 ? `${diffMin % 60}분 ` : ''}후`;
}

const STATE_STYLE: Record<TimeState, { dot: string; time: string; row: string; badge?: string; badgeCls?: string }> = {
  late:     { dot: 'bg-amber-400 ring-4 ring-amber-100', time: 'text-amber-600', row: 'bg-amber-50/40', badgeCls: 'bg-amber-100 text-amber-700' },
  imminent: { dot: 'bg-blue-500 ring-4 ring-blue-100 animate-pulse', time: 'text-blue-700', row: 'bg-blue-50/40', badgeCls: 'bg-blue-100 text-blue-700' },
  upcoming: { dot: 'bg-gray-300', time: 'text-gray-500', row: '', badgeCls: 'bg-gray-100 text-gray-500' },
};

export function AppointmentTab() {
  const tt = useTAttr();
  const queryClient = useQueryClient();
  const ui = useUiSettings();
  const pollFast = usePollInterval('fast');
  // 서버 TZ=KST 기준 '오늘' (UTC 변환 시 새벽 시간대에 날짜가 어긋남)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

  // 상대시간·현재선이 실시간처럼 움직이도록 1분 시계
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['appointments-today'],
    // SCHEDULED(확정 대기) + CONFIRMED(확정) 모두 접수 대상 — staffAutoConfirm ON 시 CONFIRMED 누락 방지
    queryFn: () =>
      apiClient.get<{ data: AppointmentItem[] }>('/api/v1/appointments', { dateFrom: today, dateTo: today, statuses: 'SCHEDULED,CONFIRMED' }),
    refetchInterval: pollFast,
  });

  const [verifyTarget, setVerifyTarget] = useState<VerifyTarget | null>(null);

  // 정식 경로: 예약 상태 CHECKED_IN 전환 → 예약 status 갱신 + 대기열 멱등 생성(중복 접수 방지)
  const checkInMutation = useMutation({
    mutationFn: (appt: AppointmentItem) =>
      apiClient.patch(`/api/v1/appointments/${appt.id}/status`, { status: 'CHECKED_IN' }),
    onSuccess: (res: unknown, appt: AppointmentItem) => {
      toast.success(tt('접수가 완료되었습니다.'));
      queryClient.invalidateQueries({ queryKey: ['appointments-today'] });
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      const queueId = (res as { data?: { queueId?: string } })?.data?.queueId;
      setVerifyTarget({ patientId: appt.patientId, queueId: queueId ?? '', name: `${appt.patient?.familyName ?? ''}${appt.patient?.givenName ?? ''}` });
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message ?? '';
      toast.error(/transition|상태|CHECKED/i.test(msg) ? tt('이미 접수되었거나 접수할 수 없는 예약입니다.') : (msg || tt('접수 처리 중 오류가 발생했습니다.')));
      queryClient.invalidateQueries({ queryKey: ['appointments-today'] });
    },
  });

  // 환자앱 도착 확인 호출 — 지각·곧 도착 행에서 접수원이 앱 푸시로 문의(서버 10분 쿨다운)
  const [calledAt, setCalledAt] = useState<Record<string, number>>({});
  const callMutation = useMutation({
    mutationFn: (appt: AppointmentItem) => apiClient.post(`/api/v1/appointments/${appt.id}/call-patient`, {}),
    onSuccess: (res, appt) => {
      setCalledAt((m) => ({ ...m, [appt.id]: Date.now() }));
      // 🔴 인앱 알림 기록과 **단말 푸시**는 다른 층이다 — FCM 자격이 없으면 폰은 울리지 않는다.
      //    "보냈습니다"로 단정하면 접수 데스크가 환자 폰이 울린 줄 알고 기다린다.
      const ch = (res as { data?: { pushChannel?: string } })?.data?.pushChannel;
      if (ch === 'UNAVAILABLE') toast.success(tt('환자앱 알림함에 기록했습니다 — 단말 푸시는 설정되어 있지 않습니다.'));
      else toast.success(tt('환자앱으로 도착 확인 문의를 보냈습니다(도달 여부는 단말 설정에 따릅니다).'));
    },
    onError: (err: unknown) => toast.error((err as { message?: string })?.message || tt('호출에 실패했습니다.')),
  });

  const noShowMutation = useMutation({
    mutationFn: (appt: AppointmentItem) => apiClient.patch(`/api/v1/appointments/${appt.id}/status`, { status: 'NO_SHOW' }),
    onSuccess: () => {
      toast.success(tt('미방문(노쇼) 처리되었습니다.'));
      queryClient.invalidateQueries({ queryKey: ['appointments-today'] });
    },
    onError: () => toast.error(tt('노쇼 처리 중 오류가 발생했습니다.')),
  });

  const _apptsRaw = data?.data;
  const appointments: AppointmentItem[] = Array.isArray(_apptsRaw) ? _apptsRaw : (_apptsRaw as unknown as Record<string, unknown>)?.data as AppointmentItem[] ?? [];

  // 시간 오름차순 + 오전/오후 그룹 + '현재 시각' 기준선 위치
  const { sorted, stats, nowIndex } = useMemo(() => {
    const s = [...appointments].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    const st = { total: s.length, am: 0, pm: 0, late: 0, imminent: 0 };
    for (const a of s) {
      const d = new Date(a.scheduledAt);
      if (d.getHours() < 12) st.am++; else st.pm++;
      const state = timeState(d, now);
      if (state === 'late') st.late++;
      if (state === 'imminent') st.imminent++;
    }
    // 기준선: 첫 미래(now 이후) 예약 앞
    let idx = s.findIndex((a) => new Date(a.scheduledAt).getTime() > now.getTime());
    if (idx === -1) idx = s.length;
    return { sorted: s, stats: st, nowIndex: idx };
  }, [appointments, now]);

  const nowTimeText = formatKDate(now, ui, 'time');

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-gray-900"><T k="오늘 예약 환자 (접수 대기)" /></h3>
        {stats.total > 0 && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium"><T k="전체" /> {stats.total}</span>
            <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-500"><T k="오전" /> {stats.am} · <T k="오후" /> {stats.pm}</span>
            {stats.imminent > 0 && <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium"><T k="곧 도착" /> {stats.imminent}</span>}
            {stats.late > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium"><T k="지연" /> {stats.late}</span>}
          </div>
        )}
      </div>

      {isLoading ? (
        <LoadingSkeleton rows={5} />
      ) : sorted.length === 0 ? (
        <EmptyState icon="📅" title="오늘 접수 대기 중인 예약이 없습니다." />
      ) : (
        <div className="relative">
          {/* 타임라인 레일 */}
          <div className="absolute left-[74px] top-2 bottom-2 w-px bg-gray-100" aria-hidden />

          {sorted.map((appt, i) => {
            const sched = new Date(appt.scheduledAt);
            const state = timeState(sched, now);
            const st = STATE_STYLE[state];
            const prev = i > 0 ? new Date(sorted[i - 1].scheduledAt) : null;
            const showAmPm = !prev || (prev.getHours() < 12) !== (sched.getHours() < 12);

            return (
              <div key={appt.id}>
                {/* 오전/오후 그룹 헤더 */}
                {showAmPm && (
                  <div className="flex items-center gap-2 pl-1 pt-2 pb-1.5">
                    <span className="text-[11px] font-bold text-gray-400 tracking-wide"><T k={sched.getHours() < 12 ? '오전' : '오후'} /></span>
                    <div className="flex-1 h-px bg-gray-100" />
                  </div>
                )}

                {/* 현재 시각 기준선 */}
                {i === nowIndex && (
                  <div className="flex items-center gap-2 my-1 pl-1" aria-label={tt('현재 시각')}>
                    <span className="text-[10px] font-bold text-rose-500 whitespace-nowrap"><T k="지금" /> {nowTimeText}</span>
                    <div className="flex-1 h-px bg-rose-300" />
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                  </div>
                )}

                {/* 예약 행 */}
                <div className={`relative flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-gray-50/70 ${st.row}`}>
                  {/* 시간 + 타임라인 도트 */}
                  <div className="flex items-center gap-2.5 w-[92px] shrink-0">
                    <span className={`text-sm font-bold tabular-nums ${st.time}`}>{formatKDate(sched, ui, 'time')}</span>
                    <span className={`relative z-10 w-2.5 h-2.5 rounded-full shrink-0 ${st.dot}`} />
                  </div>

                  {/* 환자·의사 */}
                  <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[1.4fr_1fr_auto] items-center gap-x-3 gap-y-0.5">
                    <div className="min-w-0">
                      <span className="font-medium text-gray-900">{appt.patient?.familyName}{appt.patient?.givenName}</span>
                      <span className="text-xs text-gray-400 ml-1.5">{appt.patient?.mrn}</span>
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {appt.doctor?.familyName}{appt.doctor?.givenName}
                      {appt.departmentName && <span className="text-gray-400"> · {appt.departmentName}</span>}
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${appt.type === 'INITIAL' ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'}`}>
                        <T k={appt.type === 'INITIAL' ? '초진' : '재진'} />
                      </span>
                      {appt.status === 'CONFIRMED' && <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-emerald-50 text-emerald-700"><T k="확정" /></span>}
                      <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-medium ${st.badgeCls}`}>{relativeLabel(sched, now)}</span>
                    </div>
                  </div>

                  {/* 액션 — 호출(환자앱 도착 문의)은 지각·곧 도착에만 노출 */}
                  <div className="flex gap-1.5 shrink-0">
                    {(state === 'late' || state === 'imminent') && (
                      <button
                        onClick={() => callMutation.mutate(appt)}
                        disabled={!!calledAt[appt.id] || callMutation.isPending}
                        title={calledAt[appt.id] ? tt('호출됨 — 환자앱으로 문의를 보냈습니다(10분 쿨다운)') : tt('환자앱으로 도착 확인 문의 보내기')}
                        className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          calledAt[appt.id]
                            ? 'bg-emerald-50 text-emerald-600 cursor-default'
                            : 'bg-gray-50 text-gray-600 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50'
                        }`}
                      >
                        {calledAt[appt.id] ? <>✓ <T k="호출됨" /></> : <>📲 <T k="호출@동작" /></>}
                      </button>
                    )}
                    <button
                      onClick={() => checkInMutation.mutate(appt)}
                      disabled={checkInMutation.isPending}
                      className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      <T k="접수@동작" />
                    </button>
                    <button
                      onClick={() => { if (window.confirm(tt('미방문(노쇼)으로 처리하시겠습니까?'))) noShowMutation.mutate(appt); }}
                      disabled={noShowMutation.isPending}
                      className="px-2.5 py-1.5 text-xs font-medium bg-orange-50 text-orange-600 rounded-lg hover:bg-orange-100 disabled:opacity-50 transition-colors"
                    >
                      <T k="노쇼" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* 목록 끝이 전부 지난 예약이면 기준선을 맨 아래 표시 */}
          {nowIndex === sorted.length && (
            <div className="flex items-center gap-2 my-1 pl-1" aria-label={tt('현재 시각')}>
              <span className="text-[10px] font-bold text-rose-500 whitespace-nowrap"><T k="지금" /> {nowTimeText}</span>
              <div className="flex-1 h-px bg-rose-300" />
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            </div>
          )}
        </div>
      )}
      {verifyTarget && <EligibilityVerifyModal target={verifyTarget} onClose={() => setVerifyTarget(null)} />}
    </div>
  );
}
