'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { KDate, EmptyState, Unit } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { usePollInterval } from '@/lib/ui-settings';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 접수 참조 레일 — 초광폭에서 우측 여백 활용(2026-08-04, 환자 상세 레일과 같은 취지).
 *
 * 접수 담당자가 **어느 탭에 있어도 곁눈으로 확인하는 것**을 상주시킨다:
 *  - 지금 대기: 상태별 인원(대기·호출·진료중·수납대기) — 데스크의 체감 혼잡도
 *  - 곧 도착 예약: 지각(예약시각 경과·미접수)을 먼저, 다가오는 순 — 행이 예약 접수 탭으로 연결
 *  - 진료실 현황: 대기가 몰린 진료실 순 — "어디로 배정하면 오래 기다리는지"를 접수 시점에 안다
 *
 * 환자 상세 레일(fixed)과 달리 이 화면은 자체 높이(calc(100vh-120px)) 컬럼이라
 * **flex 형제 컬럼**으로 둔다 — 겹침·스태킹 이슈가 원천적으로 없다.
 * 본문이 max-w-7xl(1280px)로 넓어 1760px 미만에선 본문을 침범하지 않도록 숨긴다.
 */

interface QueueItem {
  /** 접수 시각이 아직 오지 않은 예약인가 — 서버 판정(화면 재판정 금지) */
  isScheduled?: boolean;
  id: string;
  status: string;
  type: string;
}
interface AppointmentItem {
  id: string;
  scheduledAt: string;
  departmentName?: string;
  patient?: { familyName: string; givenName: string; mrn: string };
  doctor?: { familyName: string; givenName: string };
}
interface ClinicScheduleItem {
  id: string;
  doctor?: { familyName: string; givenName: string };
  doctorFamilyName?: string;
  doctorGivenName?: string;
  waitingCount: number;
  period: string;
  roomName: string;
}

const CARD = 'rounded-2xl border border-gray-100 bg-white shadow-sm p-3';
const CARD_TITLE = 'text-[11px] font-bold text-gray-500 mb-2';

/** 🔴 /queue 등은 서비스+컨트롤러 이중 {data} 래핑 — {data:{data:[…]}} 도 배열도 다 받는다(QueueTab 과 동일 방어) */
function unwrapList<T>(res: unknown): T[] {
  const inner = (res as { data?: unknown })?.data;
  if (Array.isArray(inner)) return inner as T[];
  const deeper = (inner as { data?: unknown })?.data;
  return Array.isArray(deeper) ? (deeper as T[]) : [];
}

const QUEUE_TILES: [string, string, string][] = [
  ['WAITING', '대기', 'text-yellow-700 bg-yellow-50'],
  ['CALLED', '호출', 'text-blue-700 bg-blue-50'],
  ['IN_CONSULTATION', '진료중', 'text-emerald-700 bg-emerald-50'],
  ['CASHIER_WAITING', '수납대기', 'text-purple-700 bg-purple-50'],
];

export function ReceptionSideRail({ onGoTab }: { onGoTab: (tab: 'appointment' | 'queue') => void }) {
  const tt = useTAttr();
  const pollFast = usePollInterval('fast');
  const pollNormal = usePollInterval('normal');
  // 환자앱 도착 확인 호출 — 세션 내 호출 시각 기억(서버 10분 쿨다운과 별개로 버튼 즉시 피드백)
  const [calledAt, setCalledAt] = useState<Record<string, number>>({});
  const callMutation = useMutation({
    mutationFn: (apptId: string) => apiClient.post<{ data: { sent: boolean; pushChannel?: 'ATTEMPTED' | 'UNAVAILABLE' | 'FAILED' } }>(`/api/v1/appointments/${apptId}/call-patient`, {}),
    onSuccess: (res, apptId) => {
      setCalledAt((m) => ({ ...m, [apptId]: Date.now() }));
      // 🔴 인앱 알림 기록과 **단말 푸시**는 다른 층이다 — FCM 자격이 없으면 폰은 울리지 않는다.
      //    "보냈습니다"로 단정하면 접수 데스크가 환자 폰이 울린 줄 알고 기다린다.
      const ch = (res as { data?: { pushChannel?: string } })?.data?.pushChannel;
      if (ch === 'UNAVAILABLE') toast.success(tt('환자앱 알림함에 기록했습니다 — 단말 푸시는 설정되어 있지 않습니다.'));
      else toast.success(tt('환자앱으로 도착 확인 문의를 보냈습니다(도달 여부는 단말 설정에 따릅니다).'));
    },
    onError: (e) => toast.error((e as { message?: string })?.message || tt('호출에 실패했습니다.')),
  });

  const queueQ = useQuery({
    queryKey: ['rail-queue'],
    queryFn: () => apiClient.get<{ data: QueueItem[] }>('/api/v1/queue'),
    refetchInterval: pollFast,
  });
  const today = kstToday();
  const apptQ = useQuery({
    queryKey: ['rail-appointments-today'],
    queryFn: () =>
      apiClient.get<{ data: AppointmentItem[] }>('/api/v1/appointments', {
        dateFrom: today, dateTo: today, statuses: 'SCHEDULED,CONFIRMED',
      }),
    refetchInterval: pollNormal,
  });
  const roomsQ = useQuery({
    queryKey: ['rail-clinic-rooms'],
    queryFn: () => apiClient.get<{ data: ClinicScheduleItem[] }>('/api/v1/clinic-schedule/today'),
    refetchInterval: pollNormal,
  });

  const queue = unwrapList<QueueItem>(queueQ.data);
  // 🔴 '대기'에 **아직 오지 않은 예약**이 섞여 있었다 — 진료실 대기 화면은 54명, 여기는 180명을
  //    말하고 있었다(2026-08-13 실측). 서버가 각 행에 `isScheduled` 를 달아 주므로
  //    **화면마다 따로 판정하지 않고** 그 플래그만 쓴다.
  const counts = queue.reduce<Record<string, number>>((m, q) => {
    if (q.status === 'WAITING' && q.isScheduled) return m; // 예약 대기는 따로 센다
    m[q.status] = (m[q.status] ?? 0) + 1;
    return m;
  }, {});
  const scheduledWaiting = queue.filter((q) => q.status === 'WAITING' && q.isScheduled).length;

  const now = Date.now();
  // 지각(예약시각 경과·아직 접수 안 됨)을 먼저 — 데스크가 능동적으로 챙겨야 할 대상이라서
  const appts = unwrapList<AppointmentItem>(apptQ.data).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const late = appts.filter((a) => new Date(a.scheduledAt).getTime() < now);
  const upcoming = appts.filter((a) => new Date(a.scheduledAt).getTime() >= now);
  const apptRows = [...late.slice(-3), ...upcoming].slice(0, 6);

  const rooms = unwrapList<ClinicScheduleItem>(roomsQ.data)
    .sort((a, b) => (b.waitingCount ?? 0) - (a.waitingCount ?? 0))
    .slice(0, 6);
  const doctorName = (r: ClinicScheduleItem) =>
    `${r.doctor?.familyName ?? r.doctorFamilyName ?? ''}${r.doctor?.givenName ?? r.doctorGivenName ?? ''}`.trim() || '-';

  return (
    <aside aria-label={tt('접수 참조 패널')} className="no-print hidden min-[1600px]:flex w-80 flex-shrink-0 flex-col gap-3 overflow-y-auto">
      <div className={CARD}>
        <button onClick={() => onGoTab('queue')} className={`${CARD_TITLE} block w-full text-left hover:text-blue-600`}>
          <T k="지금 대기" /> →
        </button>
        {scheduledWaiting > 0 && (
          <p className="mb-1.5 text-[10px] text-gray-400">
            <T k="예약 대기" /> {scheduledWaiting}<Unit>명</Unit> <T k="별도(접수 시각 미도래)" />
          </p>
        )}
        {/* 🔴 조회 실패에 "0명"을 그리지 않는다 — 한산함으로 읽힌다 */}
        {queueQ.isError ? (
          <QueryErrorFallback error={queueQ.error} onRetry={() => queueQ.refetch()} size="compact" />
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {QUEUE_TILES.map(([status, label, tone]) => (
              <div key={status} className={`rounded-xl px-2.5 py-1.5 ${tone}`}>
                <p className="text-lg font-bold tabular-nums leading-tight">{counts[status] ?? 0}<Unit>명</Unit></p>
                <p className="text-[10px] font-medium opacity-80"><T k={label} /></p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={CARD}>
        <button onClick={() => onGoTab('appointment')} className={`${CARD_TITLE} block w-full text-left hover:text-blue-600`}>
          <T k="곧 도착 예약" /> →
        </button>
        {apptQ.isError ? (
          <QueryErrorFallback error={apptQ.error} onRetry={() => apptQ.refetch()} size="compact" />
        ) : apptRows.length === 0 ? (
          <EmptyState compact icon="📅" title="남은 예약 없음" />
        ) : apptRows.map((a) => {
          const isLate = new Date(a.scheduledAt).getTime() < now;
          const wasCalled = !!calledAt[a.id];
          return (
            <div key={a.id}
              className="flex items-center gap-1 mb-1.5 last:mb-0 rounded-lg px-2 py-1.5 hover:bg-gray-50 border-b border-gray-50 last:border-0">
              <button onClick={() => onGoTab('appointment')} className="flex-1 min-w-0 text-left">
                <p className="text-xs text-gray-800 flex items-center gap-1.5">
                  <span className={`font-semibold tabular-nums ${isLate ? 'text-rose-600' : 'text-gray-900'}`}>
                    <KDate value={a.scheduledAt} mode="time" />
                  </span>
                  <span className="font-medium truncate">{`${a.patient?.familyName ?? ''}${a.patient?.givenName ?? ''}`.trim() || '-'}</span>
                  {isLate && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-rose-50 text-rose-600"><T k="지각" /></span>}
                </p>
                <p className="text-[10px] text-gray-400 pl-0.5">
                  {[a.departmentName, a.doctor ? `${a.doctor.familyName}${a.doctor.givenName}` : null].filter(Boolean).join(' · ')}
                </p>
              </button>
              <button
                onClick={() => callMutation.mutate(a.id)}
                disabled={wasCalled || callMutation.isPending}
                title={wasCalled ? tt('호출됨 — 환자앱으로 문의를 보냈습니다(10분 쿨다운)') : tt('환자앱으로 도착 확인 문의 보내기')}
                className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-1 rounded-lg border ${
                  wasCalled
                    ? 'bg-emerald-50 border-emerald-100 text-emerald-600 cursor-default'
                    : 'bg-white border-gray-200 text-gray-500 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600'
                }`}>
                {wasCalled ? <>✓ <T k="호출됨" /></> : <>📲 <T k="호출@동작" /></>}
              </button>
            </div>
          );
        })}
      </div>

      <div className={CARD}>
        <p className={CARD_TITLE}><T k="진료실 현황 (대기 많은 순)" /></p>
        {roomsQ.isError ? (
          <QueryErrorFallback error={roomsQ.error} onRetry={() => roomsQ.refetch()} size="compact" />
        ) : rooms.length === 0 ? (
          <EmptyState compact icon="🚪" title="오늘 진료 세션 없음" />
        ) : rooms.map((r) => (
          <div key={r.id} className="mb-1.5 last:mb-0 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0 pb-1.5 last:pb-0">
            <p className="text-xs text-gray-800 min-w-0">
              <span className="font-medium">{r.roomName || '-'}</span>
              <span className="ml-1.5 text-gray-500">{doctorName(r)}</span>
              <span className="ml-1 text-[10px] text-gray-400">{r.period === 'AM' || r.period === 'PM' || r.period === 'ALL' ? <T k={r.period === 'AM' ? '오전' : r.period === 'PM' ? '오후' : '종일'} /> : r.period}</span>
            </p>
            <p className={`text-xs font-bold tabular-nums flex-shrink-0 ${(r.waitingCount ?? 0) >= 5 ? 'text-rose-600' : 'text-gray-700'}`}>
              {r.waitingCount ?? 0}<Unit>명</Unit>
            </p>
          </div>
        ))}
      </div>
    </aside>
  );
}
