'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useDepartments, DeptLoadError } from '@/lib/use-departments';
import { useHasRole } from '@/hooks/use-admin-write';
import { useQueueThresholds, waitTone } from '@/lib/queue-thresholds';
import { ORDER_DEPT_STATUS_LABEL } from '@hospital-run/shared';
import { subscribeSseSignal } from '@/lib/sse-signal';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import StatCard from '@/components/ui/StatCard';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';
import { WAITING_QUEUE_STATUS_LABEL } from '@hospital-run/shared';
import { EmptyState, Duration, DrugName, useDurationText } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { ClinicQueueSideRail } from './ClinicQueueSideRail';
import { DEPT_QUEUES, blockedDeptQueues, canFetchDeptQueue, canFetchMyQueue, type DeptQueueKey } from './queue-access';
import { usePatientNotifyConfirm, patientPushMessage } from '@/components/notification/PatientNotifyConfirm';

interface QueueItem {
  id: string;
  queueNumber: number;
  patientId: string;
  status: string; // WAITING, CALLED, IN_CONSULTATION, COMPLETED, CANCELLED, NO_SHOW
  visitType: string; // INITIAL, FOLLOW_UP
  encounterId?: string | null;
  checkedInAt: string;
  /** 접수 시각이 아직 오지 않은 예약인가 — 서버 판정 */
  isScheduled?: boolean;
  calledAt?: string;
  startedAt?: string;
  completedAt?: string;
  departmentName?: string;
  patient?: { familyName?: string; givenName?: string; mrn?: string };
}

interface CareTeam {
  id: string;
  name: string;
  departmentName?: string;
  roomName?: string;
  members?: { role: string; staffName: string }[];
}

const STATUS_LABELS = WAITING_QUEUE_STATUS_LABEL; // 정본(waitingQueue)

const STATUS_BADGE: Record<string, string> = {
  WAITING: 'bg-gray-100 text-gray-700',
  CALLED: 'bg-blue-100 text-blue-700',
  IN_CONSULTATION: 'bg-indigo-100 text-indigo-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-red-100 text-red-700',
  NO_SHOW: 'bg-amber-100 text-amber-700',
};

/**
 * 🔴 **아직 오지 않은 사람을 '방금 접수'로 말하지 않는다.**
 *    접수 시각이 미래면 경과가 음수인데, 종전 `mins < 1 → '방금'` 이 그것을 감췄다.
 *    운영 실측(2026-08-13 08:30): 대기 180명 중 **129명이 미래 접수**(최대 9시간 뒤)였고
 *    전부 "방금"으로 보였다. 지금 실제로 기다리는 사람은 51명이다.
 *    대기열에서 순서·호출 판단이 어긋난다.
 */
function useFormatWaitTime(): (checkedInAt: string) => string {
  const fmtDur = useDurationText();
  const tt = useTAttr();
  return (checkedInAt: string) => {
    const t = new Date(checkedInAt).getTime();
    if (!Number.isFinite(t)) return '-';
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 0) {
      // 🔴 종전 `kdate(t)` 는 **숫자**를 받아 `new Date(String(t))` → Invalid → '-' 였다 — 예약 시각이 한 번도 안 보였다("예약 -")
      return `${tt('예약')} ${kdate(new Date(t), 'time')}`;
    }
    if (mins < 1) return tt('방금');
    return fmtDur(mins);
  };
}

/** 접수 시각이 아직 오지 않았는가 — '지금 대기'와 '예약 대기'를 가르는 기준 */
function isFutureCheckIn(checkedInAt: string): boolean {
  const t = new Date(checkedInAt).getTime();
  return Number.isFinite(t) && t > Date.now();
}

function formatDuration(start: string, end: string): string {
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  return `${mins}분`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getWaitMins(checkedInAt: string): number {
  return Math.round((Date.now() - new Date(checkedInAt).getTime()) / 60000);
}

function WaitTimeLabel({ checkedInAt, onDark = false }: { checkedInAt: string; onDark?: boolean }) {
  const formatWaitTime = useFormatWaitTime();
  const t = useQueueThresholds(); // 임계 정본 = config clinical.queue.*(§7 P2 수렴 — 로컬 재정의 금지)
  const mins = getWaitMins(checkedInAt);
  const text = formatWaitTime(checkedInAt);
  const tone = waitTone(mins, t);
  const cls = onDark
    ? (tone === 'danger' ? 'font-bold text-rose-100 bg-rose-500/40 px-2 py-0.5 rounded-lg' : tone === 'warn' ? 'font-bold text-amber-100' : 'text-white/80')
    : tone === 'danger' ? 'text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded-lg'
    : tone === 'warn' ? 'text-amber-600 font-bold' : 'text-gray-600';
  return <span className={`text-xs whitespace-nowrap ${cls}`}>{text}</span>;
}

/** 대기 목록 한 벌 — 지금 대기·예약(도착 전) 두 곳이 같은 모양을 쓴다(모양이 갈라지지 않게) */
function WaitingTable({ rows, nextId, muted = false, isPending, encHref, onCall }: {
  rows: QueueItem[]; nextId?: string; muted?: boolean; isPending: boolean;
  encHref: (it: { patientId: string; encounterId?: string | null }) => string; onCall: (id: string) => void;
}) {
  const t = useQueueThresholds();
  return (
    <div className={`overflow-hidden rounded-2xl border bg-white ${muted ? 'border-dashed border-slate-200' : 'border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'}`}>
      {/* table-fixed + 열 폭 — '지금 대기'와 '예약·도착 전' 두 표의 열이 위아래로 맞는다 */}
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="bg-slate-50/80 text-[11px] text-slate-500">
            <th className="w-[12%] px-4 py-2.5 text-left font-medium"><T k="대기번호" /></th>
            <th className="w-[28%] px-4 py-2.5 text-left font-medium"><T k="환자명 (MRN)" /></th>
            <th className="w-[10%] px-4 py-2.5 text-left font-medium"><T k="유형" /></th>
            <th className="w-[12%] px-4 py-2.5 text-left font-medium"><T k="접수시간" /></th>
            <th className="w-[14%] px-4 py-2.5 text-left font-medium"><T k="대기시간" /></th>
            <th className="w-[12%] px-4 py-2.5 text-left font-medium"><T k="상태" /></th>
            <th className="w-[12%] px-4 py-2.5 text-right font-medium"><T k="작업" /></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((q) => {
            const isNext = q.id === nextId;
            // 오래 기다린 행은 왼쪽 띠로 — 색은 임계(config) 정본이 정한다
            const tone = muted ? null : waitTone(getWaitMins(q.checkedInAt), t);
            const bar = tone === 'danger' ? 'shadow-[inset_3px_0_0_#f43f5e]' : tone === 'warn' ? 'shadow-[inset_3px_0_0_#f59e0b]' : '';
            return (
              <tr key={q.id} data-queue-row={q.id} className={`transition-colors ${bar} ${isNext ? 'bg-blue-50/60 hover:bg-blue-50' : 'hover:bg-slate-50'} ${muted ? 'text-slate-500' : ''}`}>
                <td className="px-4 py-3">
                  <span className={`inline-flex min-w-[2.75rem] justify-center rounded-lg px-2 py-1 text-sm font-bold tabular-nums ${isNext ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>#{q.queueNumber}</span>
                </td>
                <td className="px-4 py-3">
                  <Link href={encHref(q)} className={`font-medium hover:text-blue-600 ${muted ? 'text-slate-600' : 'text-slate-900'}`}>
                    {q.patient?.familyName}{q.patient?.givenName}
                  </Link>
                  {q.patient?.mrn && <span className="ml-1 text-xs text-slate-400">({q.patient.mrn})</span>}
                  {isNext && <span className="ml-2 rounded-full bg-blue-600/10 px-2 py-0.5 text-[10px] font-bold text-blue-700" data-next-badge><T k="다음" /></span>}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${q.visitType === 'INITIAL' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                    <T k={q.visitType === 'INITIAL' ? '초진' : '재진'} />
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums text-slate-500">{formatTime(q.checkedInAt)}</td>
                <td className="px-4 py-3"><WaitTimeLabel checkedInAt={q.checkedInAt} /></td>
                <td className="px-4 py-3">
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[q.status]}`}>{STATUS_LABELS[q.status]}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onCall(q.id)}
                    disabled={isPending}
                    className={`min-h-[36px] rounded-lg px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${muted ? 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                  >
                    <T k="호출@동작" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type DeptTab = 'clinic' | DeptQueueKey;

interface DeptQueueItem {
  id: string;
  patientId?: string;
  status: string;
  type?: string;
  createdAt?: string;
  orderedAt?: string;
  patient?: { familyName?: string; givenName?: string; mrn?: string };
  medicationCode?: { nameKo?: string; nameEn?: string | null; ingredient?: string | null };
  procedureCode?: { nameKo?: string; category?: string };
  encounter?: { patient?: { familyName?: string; givenName?: string; mrn?: string } };
  /** lab/imaging/pharmacy 큐는 Order 행 — 환자·항목이 prescription 아래 중첩(서버 실측) */
  prescription?: {
    encounter?: { patient?: { familyName?: string; givenName?: string; mrn?: string } };
    procedureCode?: { nameKo?: string };
    medicationCode?: { nameKo?: string; nameEn?: string | null; ingredient?: string | null };
    instructions?: string | null;
  };
}

/**
 * 부서 탭 — 정의·역할 정본은 `./queue-access`(서버 `@Roles` 사본을 가드가 기계 대조).
 * 🔴 자기 역할이 부를 수 없는 큐 탭은 **띄우지 않는다**(누르면 403 이 뜨던 자리).
 */
const DEPT_TABS: { key: DeptTab; label: string; api: string }[] = [
  { key: 'clinic', label: '진료실', api: '' },
  ...DEPT_QUEUES.map((d) => ({ key: d.key as DeptTab, label: d.label, api: d.api })),
];

// 진료과 칩 정본 = 마스터(useDepartments) — 로컬 배열 재정의 금지(input-assist-ux P1)

export default function ClinicQueuePage() {
  const tt = useTAttr();
  const { names: clinicDepartments } = useDepartments({ category: 'CLINICAL' });
  const queryClient = useQueryClient();
  const router = useRouter();
  const { user } = useAuthStore();
  const [showCompleted, setShowCompleted] = useState(false);
  const [deptTab, setDeptTab] = useState<DeptTab>('clinic');
  const [selectedDept, setSelectedDept] = useState<string>(user?.department || '전체');

  // 🔴 역할 게이트 — 서버가 허용하는 큐만 부른다(부를 수 없는 것은 탭도 칩도 만들지 않는다)
  const role = user?.role;
  const myQueueAllowed = canFetchMyQueue(role);
  /**
   * 🔴 (2026-09-16 K3) 아래 세 버튼은 상태(CALLED 등)로만 그려지고 **역할 게이트가 없었다** —
   *    서버는 의도적으로 갈라 두었는데(진료 시작 = 의사·관리자 / 접수 취소 = "원무·간호·관리자" 주석 명시)
   *    화면이 전원에게 그려서 간호·원무가 '진료 시작'을, 의사가 '취소'를 누르면 403 이었다(dead button).
   *    서버 역할은 그대로 두고 **화면이 부르지 않게** 한다(§규약 5 — 임상 행위 귀속은 넓히지 않는다).
   */
  const canStartConsult = useHasRole('DOCTOR');
  const canCancelQueue = useHasRole('NURSE', 'RECEPTIONIST');
  const visibleDeptTabs = DEPT_TABS.filter((t) => t.key === 'clinic' || canFetchDeptQueue(role, t.key as DeptQueueKey));
  const blockedDepts = blockedDeptQueues(role);

  // Fetch clinic queue — 진료과별 전체 or 내 대기열
  // '내 환자' 칩은 `queue/my` 를 부를 수 있는 역할에만 렌더되지만, 선택 상태가 남아 있는 경우를
  // 대비해 여기서도 접는다(부를 수 없는 EP 를 부르지 않는다).
  const effectiveDept = selectedDept === '내 환자' && !myQueueAllowed ? '전체' : selectedDept;
  const isMyQueue = effectiveDept === '내 환자';
  const { data: queueData, isLoading: queueLoading, isError, error, refetch: refetchQueue } = useQuery({
    queryKey: ['clinic-queue', effectiveDept],
    queryFn: () => isMyQueue
      ? apiClient.get<{ data: QueueItem[] }>('/api/v1/queue/my')
      : apiClient.get<{ data: QueueItem[] }>('/api/v1/queue', {
          department: effectiveDept === '전체' ? undefined : effectiveDept,
        }),
    refetchInterval: pollMs('normal'), // SSE 신호가 주 갱신원 — 폴링은 안전망
  });

  // 과별 대기 카운트 — 필터 칩에 상시 표기(선택과 무관하게 전체 큐를 집계·2026-08-04)
  const { data: allQueueData, isError: allQueueIsError, error: allQueueError, refetch: refetchAllQueue } = useQuery({
    queryKey: ['clinic-queue-counts'],
    queryFn: () => apiClient.get<{ data: QueueItem[] }>('/api/v1/queue'),
    refetchInterval: pollMs('normal'),
  });
  // 🔴 `queue/my` 는 @Roles(DOCTOR, NURSE, ADMIN) — 원무 계정은 이 카운트 하나 때문에 상시 403 이었다.
  //    호출하지 않는다(`enabled:false`). 대신 '내 환자' 칩 자체를 만들지 않는다.
  const { data: myQueueCntData, isError: myQueueIsError, error: myQueueError, refetch: refetchMyQueue } = useQuery({
    queryKey: ['my-queue-count'],
    queryFn: () => apiClient.get<{ data: QueueItem[] }>('/api/v1/queue/my'),
    refetchInterval: pollMs('normal'),
    enabled: myQueueAllowed,
  });
  // 🔴 카운트 조회가 실패하면 칩의 숫자는 "0명 대기"가 아니라 **모른다**
  const countsIsError = allQueueIsError || myQueueIsError;
  const countsError = allQueueIsError ? allQueueError : myQueueError;
  // 🔴 v5 의 `refetch()` 는 `enabled:false` 도 무시하고 요청을 보낸다 — 재시도 버튼이
  //    권한 없는 EP 를 다시 두드리지 않게 여기서도 막는다.
  const refetchCounts = () => { void refetchAllQueue(); if (myQueueAllowed) void refetchMyQueue(); };
  const unwrapQueue = (res: unknown): QueueItem[] => {
    const inner = (res as { data?: unknown })?.data;
    if (Array.isArray(inner)) return inner as QueueItem[];
    const deeper = (inner as { data?: unknown })?.data;
    return Array.isArray(deeper) ? (deeper as QueueItem[]) : [];
  };
  const allWaiting = unwrapQueue(allQueueData).filter(q => q.status === 'WAITING');
  const deptWaitingCount: Record<string, number> = {};
  for (const q of allWaiting) {
    const d = q.departmentName || '기타';
    deptWaitingCount[d] = (deptWaitingCount[d] ?? 0) + 1;
  }
  const myWaitingCount = unwrapQueue(myQueueCntData).filter(q => q.status === 'WAITING').length;
  const chipCount = (d: string) => d === '전체' ? allWaiting.length : d === '내 환자' ? myWaitingCount : deptWaitingCount[d] ?? 0;

  // 실시간: 대기열 변경 SSE 신호 → 즉시 재조회(접수/호출/진료시작/완료/취소/정정)
  useEffect(() => {
    const unsub = subscribeSseSignal('/api/v1/queue/events', () => {
      queryClient.invalidateQueries({ queryKey: ['clinic-queue'] });
      queryClient.invalidateQueries({ queryKey: ['my-queue'] });
      queryClient.invalidateQueries({ queryKey: ['clinic-queue-counts'] });
      queryClient.invalidateQueries({ queryKey: ['my-queue-count'] });
    });
    return unsub;
  }, [queryClient]);

  // Fetch department queues (lab/imaging/pharmacy)
  const activeDeptApi = DEPT_TABS.find(t => t.key === deptTab)?.api;
  const { data: deptQueueData, isLoading: deptLoading, isError: deptIsError, error: deptError, refetch: refetchDeptQueue } = useQuery({
    queryKey: ['dept-queue', deptTab],
    queryFn: () => apiClient.get<{ data: DeptQueueItem[] }>(activeDeptApi!),
    // 🔴 역할이 받을 수 없는 큐는 부르지 않는다(탭도 없지만, 상태가 남아 있어도 호출하지 않는다)
    enabled: deptTab !== 'clinic' && !!activeDeptApi && canFetchDeptQueue(role, deptTab as DeptQueueKey),
    refetchInterval: pollMs('fast'),
  });
  const deptQueue: DeptQueueItem[] = (() => {
    if (deptTab === 'clinic') return [];
    const raw = deptQueueData?.data;
    return Array.isArray(raw) ? raw : (raw as Record<string, unknown> | undefined)?.data as DeptQueueItem[] ?? [];
  })();

  // Fetch care team info
  const { data: careTeamData } = useQuery({
    queryKey: ['my-care-team'],
    queryFn: () => apiClient.get<{ data: CareTeam }>('/api/v1/care-teams/my'),
  });

  const rawQueue = queueData?.data;
  const queue: QueueItem[] = Array.isArray(rawQueue)
    ? rawQueue
    : (rawQueue as Record<string, unknown> | undefined)?.data as QueueItem[] ?? [];

  const careTeam = careTeamData?.data;
  const careTeamInfo = (careTeam && typeof careTeam === 'object' && 'members' in careTeam)
    ? careTeam as CareTeam
    : (careTeam as Record<string, unknown> | undefined)?.data as CareTeam | undefined;

  // Categorize queue items
  const waiting = queue.filter(q => q.status === 'WAITING');
  // 🔴 '대기 180' 안에 **아직 오지 않은 예약 129명**이 섞여 있었다 — 지금 기다리는 사람은 51명이다.
  // 서버가 `isScheduled` 를 달아 준다 — 화면 판정은 폴백일 뿐(정본은 서버)
  const waitingNow = waiting.filter(q => !(q.isScheduled ?? isFutureCheckIn(q.checkedInAt)));
  const waitingScheduled = waiting.length - waitingNow.length;
  const called = queue.filter(q => q.status === 'CALLED');
  const inConsultation = queue.filter(q => q.status === 'IN_CONSULTATION');
  const completed = queue.filter(q => q.status === 'COMPLETED');
  const cancelled = queue.filter(q => q.status === 'CANCELLED' || q.status === 'NO_SHOW');

  const currentPatient = called[0] || inConsultation[0];
  // 🔴 종전 `waiting[0]` — 접수 시각이 아직 오지 않은 예약(도착 전)이 순번상 앞이면 **오지 않은 사람을 호출**했다
  const firstWaiting = waitingNow[0];
  const waitingScheduledRows = waiting.filter(q => !waitingNow.includes(q));

  // Nurse name from care team
  const nurseName = careTeamInfo?.members?.find(m => m.role === 'NURSE')?.staffName;
  const roomName = careTeamInfo?.roomName || careTeamInfo?.departmentName || user?.department || '';
  const doctorName = user ? `${user.familyName || ''}${user.givenName || ''}` : '';

  // Mutations
  // 🔴 대외 발신(환자 앱 알림)은 **명시 승인**이 있어야 나간다 — 설정만으로 몰래 나가지 않는다.
  const notify = usePatientNotifyConfirm('호출');

  const callMutation = useMutation({
    mutationFn: ({ id, notifyPatient }: { id: string; notifyPatient: boolean }) =>
      apiClient.patch<{ data: { patientPush?: { sent?: boolean; reason?: string; pushChannel?: string | null } } }>(
        `/api/v1/queue/${id}/call`, { notifyPatient },
      ),
    onSuccess: (res) => {
      toast.success(tt('환자를 호출했습니다.'));
      // 🔴 발송 결과를 서버가 준 사유 그대로 말한다 — "보냈습니다"를 지어내지 않는다.
      const msg = patientPushMessage(res?.data?.patientPush);
      if (msg) toast.info(msg);
      queryClient.invalidateQueries({ queryKey: ['clinic-queue'] });
      queryClient.invalidateQueries({ queryKey: ['my-queue'] });
    },
    onError: () => toast.error(tt('호출 처리 중 오류가 발생했습니다.')),
  });

  /** 승인을 물은 뒤 호출한다. 취소하면 **호출 자체를 하지 않는다** */
  const callWithConsent = async (id: string, onDone?: () => void) => {
    const yes = await notify.ask();
    if (yes === null) return;
    callMutation.mutate({ id, notifyPatient: yes }, onDone ? { onSuccess: onDone } : undefined);
  };

  const startMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/queue/${id}/start`),
    onSuccess: () => {
      toast.success(tt('진료를 시작합니다.'));
      queryClient.invalidateQueries({ queryKey: ['clinic-queue'] });
      queryClient.invalidateQueries({ queryKey: ['my-queue'] });
    },
    onError: () => toast.error(tt('진료 시작 처리 중 오류가 발생했습니다.')),
  });

  // 진료 완료 = 진료기록 서명(§통일). 서명 시 billing 리스너가 큐를 CASHIER_WAITING(수납)으로 전이하므로
  // 별도 완료 버튼(우회) 대신 진료화면에서 서명하도록 유도한다.

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/queue/${id}/cancel`),
    onSuccess: () => {
      toast.success(tt('접수가 취소되었습니다.'));
      queryClient.invalidateQueries({ queryKey: ['clinic-queue'] });
      queryClient.invalidateQueries({ queryKey: ['my-queue'] });
    },
    onError: () => toast.error(tt('취소 처리 중 오류가 발생했습니다.')),
  });

  const noShowMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/queue/${id}/no-show`),
    onSuccess: () => {
      toast.success(tt('노쇼 처리되었습니다.'));
      queryClient.invalidateQueries({ queryKey: ['clinic-queue'] });
      queryClient.invalidateQueries({ queryKey: ['my-queue'] });
    },
    onError: () => toast.error(tt('노쇼 처리 중 오류가 발생했습니다.')),
  });

  // 모든 hook 이후 조건부 return (React #300 방지)
  if (isError) return <QueryErrorFallback error={error} onRetry={refetchQueue} />;

  // 진료시작(/start)이 대기열↔진료를 한 트랜잭션으로 잇는다 — 그 진료로 들어가야 서명 후 수납 대기로 넘어간다
  const startAndOpen = (item: QueueItem) => {
    startMutation.mutate(item.id, {
      onSuccess: (res) => {
        // 진료시작이 생성한 Encounter를 그대로 진료화면에 전달(중복 생성 방지)
        const enc = (res as { data?: { encounterId?: string } })?.data?.encounterId;
        router.push(`/patients/${item.patientId}/encounter/new${enc ? `?encounterId=${enc}` : ''}`);
      },
    });
  };
  const handleCallAndStart = (item: QueueItem) => {
    if (item.status === 'WAITING') {
      // 🔴 종전엔 호출 뒤 곧장 진료화면으로 가서 대기열과 끊긴 새 진료가 생겼다 — 대기열은 CALLED 에 남아
      //    서명 후 수납 대기로 넘어가지 않았고, 새벽 정리 작업이 진료받은 환자를 미내원으로 닫을 수 있었다(2026-09-30)
      void callWithConsent(item.id, () => startAndOpen(item));
    } else if (item.status === 'CALLED') {
      startAndOpen(item);
    }
  };
  const encHref = (it: { patientId: string; encounterId?: string | null }) =>
    `/patients/${it.patientId}/encounter/new${it.encounterId ? `?encounterId=${it.encounterId}` : ''}`;

  const isPending = callMutation.isPending || startMutation.isPending || cancelMutation.isPending || noShowMutation.isPending;

  return (
    // 본문은 폭 상한 없이 flex-1 로 우측 여백을 흡수, 초광폭(1600px+)엔 참조 레일(접수 데스크와 동일 패턴)
    <div className="flex gap-4" style={{ height: 'calc(100vh - 120px)' }}>
    {/* 🔴 승인 다이얼로그 — 렌더하지 않으면 물어보지 못하고, 물어보지 못하면 알림은 영원히 안 나간다 */}
    {notify.dialog}
    <div className="flex-1 min-w-0 flex flex-col">
      {/* 세션 선택을 항상 보이게 — "항상 보냄"으로 둔 것을 잊지 않게 */}
      {notify.badge && <div className="mb-2">{notify.badge}</div>}
      {/* Header — 진료실·담당의·담당 간호사를 칩으로(한 줄 문장에 섞여 있던 것) */}
      <div className="mb-4 shrink-0">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900"><T k="진료실 대기 관리" /></h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          {roomName && (
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">
              <span className="text-slate-400"><T k="진료실" /></span> <b className="font-semibold text-slate-800">{roomName}</b>
            </span>
          )}
          {doctorName && (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-800">{doctorName}</span>
          )}
          {nurseName && (
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">
              <span className="text-slate-400"><T k="담당 간호사" /></span> <b className="font-semibold text-slate-800">{nurseName}</b>
            </span>
          )}
        </div>
      </div>

      {/* Clinic Department Filter (진료실 탭에서만) */}
      {deptTab === 'clinic' && countsIsError && (
        <QueryErrorFallback error={countsError} onRetry={refetchCounts} size="compact" className="mb-4" />
      )}
      {deptTab === 'clinic' && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {[...(myQueueAllowed ? ['내 환자'] : []), '전체', ...clinicDepartments].map(d => {
            const n = countsIsError ? -1 : chipCount(d);
            const active = selectedDept === d;
            return (
              <button key={d} onClick={() => setSelectedDept(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all inline-flex items-center gap-1.5 whitespace-nowrap ${active ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
              >
                {/* '내 환자' 칩은 queue/my 를 부를 수 있는 역할에만 렌더된다(위 필터) */}
                {d === '내 환자' || d === '전체' ? <T k={d} /> : d}
                {countsIsError ? (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${active ? 'bg-white/25 text-white' : 'bg-gray-100 text-gray-400'}`} title={tt('대기 수를 불러오지 못했습니다')}>?</span>
                ) : n > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums leading-none ${active ? 'bg-white/25 text-white' : 'bg-blue-50 text-blue-600'}`}>
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Department Tabs — 🔴 자기 역할이 부를 수 있는 큐만. 접은 것은 아래 한 줄로 밝힌다 */}
      <div className={`flex gap-1 bg-gray-100 rounded-xl p-1 w-fit ${blockedDepts.length > 0 ? 'mb-1.5' : 'mb-5'}`}>
        {visibleDeptTabs.map(t => (
          <button key={t.key} onClick={() => setDeptTab(t.key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              deptTab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <T k={t.label} />
            {t.key !== 'clinic' && deptTab === t.key && deptQueue.length > 0 && (
              <span className="ml-1.5 text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded-full">{deptQueue.length}</span>
            )}
          </button>
        ))}
      </div>
      {/* 🔴 숨긴 것과 없는 것은 다르다 — 어떤 탭이 왜 없는지 말한다(빈 화면으로 뭉개지 않는다) */}
      {blockedDepts.length > 0 && (
        <p className="mb-5 text-[11px] text-gray-400">
          {blockedDepts.map(d => d.label).join('·')} 대기열 탭은 {blockedDepts.map(d => d.whose).join('·')} 권한이 있는
          계정에만 표시됩니다 — 이 계정은 해당 대기열을 조회하지 않습니다(비어 있다는 뜻이 아닙니다).
        </p>
      )}

      {/* Department Queue (Lab/Imaging/Pharmacy) */}
      {deptTab !== 'clinic' && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-white rounded-2xl border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-6 mb-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">
            <T k={DEPT_TABS.find(t => t.key === deptTab)?.label ?? ''} /> <T k="대기열" />{deptIsError || !canFetchDeptQueue(role, deptTab as DeptQueueKey) ? '' : ` (${deptQueue.length}건)`}
          </h3>
          {!canFetchDeptQueue(role, deptTab as DeptQueueKey) ? (
            /* 도달 불가여야 하는 상태(탭이 안 보인다) — 그래도 "비어 있음"이라 말하지 않는다 */
            <p className="text-sm text-gray-500"><T k="이 계정에는 해당 대기열 조회 권한이 없어 불러오지 않았습니다 — 비어 있다는 뜻이 아닙니다." /></p>
          ) : deptIsError ? (
            <QueryErrorFallback error={deptError} onRetry={() => refetchDeptQueue()} />
          ) : deptLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}</div>
          ) : deptQueue.length === 0 ? (
            <EmptyState icon="⏳" title="대기 중인 항목이 없습니다" />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100">
                <tr>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500"><T k="환자" /></th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500"><T k="항목" /></th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500"><T k="상태" /></th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500"><T k="시간" /></th>
                </tr>
              </thead>
              <tbody>
                {deptQueue.map((item: DeptQueueItem) => {
                  const pt = item.patient || item.encounter?.patient || item.prescription?.encounter?.patient;
                  const name = pt ? `${pt.familyName || ''}${pt.givenName || ''}` : '-';
                  const mrn = pt?.mrn || '';
                  const itemName = item.medicationCode?.nameKo || item.procedureCode?.nameKo
                    || item.prescription?.medicationCode?.nameKo || item.prescription?.procedureCode?.nameKo
                    || item.prescription?.instructions || item.type || '-';
                  const statusLabel: Record<string, string> = { ...ORDER_DEPT_STATUS_LABEL, PENDING: '대기', DISPENSING: '조제중' }; // 정본+부서 확장(UX P1)
                  const statusColor: Record<string, string> = { ORDERED: 'bg-gray-100 text-gray-700', RECEIVED: 'bg-blue-100 text-blue-700', IN_PROGRESS: 'bg-indigo-100 text-indigo-700', PENDING: 'bg-gray-100 text-gray-700', DISPENSING: 'bg-amber-100 text-amber-700' };
                  const time = item.createdAt || item.orderedAt;
                  return (
                    <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-2.5 px-3">
                        <span className="font-medium text-gray-900">{name}</span>
                        {mrn && <span className="text-xs text-gray-400 ml-1">({mrn})</span>}
                      </td>
                      <td className="py-2.5 px-3 text-gray-600">{(item.medicationCode ?? item.prescription?.medicationCode) ? <DrugName nameKo={(item.medicationCode ?? item.prescription?.medicationCode)?.nameKo} nameEn={(item.medicationCode ?? item.prescription?.medicationCode)?.nameEn} ingredient={(item.medicationCode ?? item.prescription?.medicationCode)?.ingredient} /> : itemName}</td>
                      <td className="py-2.5 px-3">
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${statusColor[item.status] || 'bg-gray-100 text-gray-600'}`}>
                          {statusLabel[item.status] || item.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-gray-500">{time ? formatTime(time) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Clinic Queue (only on clinic tab) — 머리(요약) · 목록(스크롤) · 바닥 행동 줄 세 칸(2026-09-29 정돈)
          🔴 종전 '다음 호출'은 `fixed left-1/2` 라 **창 가운데**에 떠서 사이드바·참조 레일 위에 얹혔고,
             목록 높이는 `calc(100vh - 360px)` 수기 값이었다 — 이제 이 열 안의 바닥 줄이다. */}
      {deptTab === 'clinic' && <>
      <div className="mb-4 grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard title={tt('지금 대기')} value={waitingNow.length} subtitle={waitingScheduled > 0 ? `예약 대기 ${waitingScheduled}명 별도` : undefined} color="gray" />
        <StatCard title={tt('진료중')} value={called.length + inConsultation.length} color="blue" />
        <StatCard title={tt('완료')} value={completed.length} color="emerald" />
        {/* 🔴 예상 대기는 **지금 기다리는 사람** 기준이어야 한다 — 예약 129명을 넣으면 `~1일` 이 된다 */}
        {/* 🔴 `× 8`(1인당 8분)은 측정한 적 없는 상수였다 — 화면 실사용 점검 W8(2026-08-14).
            새로고침해도 그럴듯한 값이 나와 관측된 사실처럼 읽혔다(P15). 같은 날 전광판 15분 상수,
            포털 8분 상수도 함께 걷어냈다. 실측: 외래 완료 462건 중 진료 시작 시각 보유 13건 —
            회전율을 뒷받침할 표본이 사실상 없다. **모르면 지어내지 않는다.** */}
        <StatCard title={tt('예상 대기')} value={tt('산출 불가')} subtitle={tt('진료 시작 시각 표본 부족')} color="gray" />
      </div>

      {queueLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-4 pr-1" data-clinic-queue-list>
          {/* Current Patient */}
          {currentPatient && (() => {
            const elapsedMins = currentPatient.startedAt
              ? Math.round((Date.now() - new Date(currentPatient.startedAt).getTime()) / 60000)
              : getWaitMins(currentPatient.checkedInAt);
            return (
            <section>
              <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-slate-700">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-pulse" aria-hidden />
                <T k="현재 진료" />
              </h3>
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-blue-600 to-indigo-700 p-5 text-white shadow-[0_12px_28px_-14px_rgba(37,99,235,0.7)]" data-current-patient>
                <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl" aria-hidden />
                <div className="relative flex flex-wrap items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25">
                      <span className="text-lg font-bold tabular-nums">#{currentPatient.queueNumber}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={encHref(currentPatient)} className="truncate text-xl font-bold hover:text-blue-100">
                          {currentPatient.patient?.familyName}{currentPatient.patient?.givenName}
                        </Link>
                        <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap">{STATUS_LABELS[currentPatient.status]}</span>
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-blue-50 ring-1 ring-white/20 whitespace-nowrap">
                          <T k={currentPatient.visitType === 'INITIAL' ? '초진' : '재진'} />
                        </span>
                      </div>
                      {currentPatient.patient?.mrn && <p className="mt-0.5 text-xs text-blue-100/80">{currentPatient.patient.mrn}</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-blue-100/80">
                      <T k={currentPatient.startedAt ? '진료 시작' : '접수@상태'} /> {formatTime(currentPatient.startedAt || currentPatient.checkedInAt)}
                    </p>
                    <p className="mt-0.5 text-2xl font-bold tabular-nums leading-none">
                      <Duration minutes={elapsedMins} />
                    </p>
                    <p className="mt-0.5 text-[11px] text-blue-100/80"><T k="경과" /></p>
                  </div>
                </div>
                <div className="relative mt-4 flex flex-wrap items-center gap-2 border-t border-white/15 pt-4">
                  {currentPatient.status === 'CALLED' && canStartConsult && (
                    <button
                      onClick={() => startMutation.mutate(currentPatient.id)}
                      disabled={isPending}
                      className="min-h-[44px] rounded-xl bg-white px-4 text-sm font-semibold text-indigo-700 hover:bg-blue-50 disabled:opacity-50"
                    >
                      <T k="진료 시작" />
                    </button>
                  )}
                  {currentPatient.status === 'IN_CONSULTATION' && (
                    <Link
                      href={encHref(currentPatient)}
                      className="inline-flex min-h-[44px] items-center rounded-xl bg-emerald-400 px-4 text-sm font-semibold text-white hover:bg-emerald-500"
                      title={tt('진료기록 서명 시 자동으로 수납 단계로 넘어갑니다')}
                    >
                      <T k="진료기록 작성·서명" />
                    </Link>
                  )}
                  {canCancelQueue && (
                    <button
                      onClick={() => { if (window.confirm(tt('이 접수를 취소하시겠습니까?'))) cancelMutation.mutate(currentPatient.id); }}
                      disabled={isPending}
                      className="min-h-[44px] rounded-xl border border-white/30 bg-white/10 px-4 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
                    >
                      <T k="취소" />
                    </button>
                  )}
                  {/* 🔴 종전엔 확인 없이 바로 미방문 — 진료 중인 환자에게도 한 번에 눌렸다 */}
                  <button
                    onClick={() => { if (window.confirm(tt('미방문(노쇼)으로 처리하시겠습니까?'))) noShowMutation.mutate(currentPatient.id); }}
                    disabled={isPending}
                    className="min-h-[44px] rounded-xl border border-white/30 bg-white/10 px-4 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
                  >
                    <T k="노쇼" />
                  </button>
                  <Link
                    href={encHref(currentPatient)}
                    className="ml-auto inline-flex min-h-[44px] items-center rounded-xl bg-white px-4 text-sm font-medium text-blue-600 hover:bg-blue-50"
                  >
                    <T k="환자 차트" /> &rarr;
                  </Link>
                </div>
              </div>
            </section>
            );
          })()}

          {/* Waiting Queue — 지금 대기 / 예약·도착 전 을 가른다(한 표에 섞으면 오지 않은 사람을 부른다) */}
          <section>
            <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-slate-700">
              <T k="지금 대기" />
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">{waitingNow.length}</span>
            </h3>
            {waitingNow.length === 0 ? (
              <EmptyState icon="⏳" title="대기 중인 환자가 없습니다" className="bg-gray-50 rounded-2xl" />
            ) : (
              <WaitingTable rows={waitingNow} nextId={firstWaiting?.id} isPending={isPending} encHref={encHref} onCall={(id) => void callWithConsent(id)} />
            )}
          </section>

          {waitingScheduledRows.length > 0 && (
            <section data-scheduled-section>
              <h3 className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-slate-500">
                <T k="예약 · 도착 전" />
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">{waitingScheduledRows.length}</span>
              </h3>
              <p className="mb-2 text-[11px] text-slate-400"><T k="접수 시각이 아직 오지 않은 예약입니다 — 다음 호출 대상에 넣지 않습니다." /></p>
              <WaitingTable rows={waitingScheduledRows} muted isPending={isPending} encHref={encHref} onCall={(id) => void callWithConsent(id)} />
            </section>
          )}

          {/* Completed Section */}
          {(completed.length > 0 || cancelled.length > 0) && (
            <section>
              <button
                onClick={() => setShowCompleted(!showCompleted)}
                aria-expanded={showCompleted}
                className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-slate-700 hover:text-slate-500"
              >
                <svg className={`h-4 w-4 transition-transform ${showCompleted ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <T k="오늘 완료" />
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">{completed.length + cancelled.length}</span>
              </button>
              {showCompleted && (
                <div className="space-y-1.5 rounded-2xl bg-slate-50 p-3">
                  {[...completed, ...cancelled].map(q => (
                    <div key={q.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="text-sm font-bold tabular-nums text-slate-400">#{q.queueNumber}</span>
                        <span className="truncate text-sm font-medium text-slate-700">{q.patient?.familyName}{q.patient?.givenName}</span>
                        <span className="text-xs text-slate-400"><T k={q.visitType === 'INITIAL' ? '초진' : '재진'} /></span>
                        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[q.status]}`}>{STATUS_LABELS[q.status]}</span>
                      </div>
                      <div className="shrink-0 text-xs tabular-nums text-slate-400">
                        {formatTime(q.checkedInAt)}
                        {q.completedAt && <> &rarr; {formatTime(q.completedAt)} ({formatDuration(q.checkedInAt, q.completedAt)})</>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* 바닥 행동 줄 — 이 열 안에 붙는다(창 가운데에 떠서 다른 패널을 덮지 않는다) */}
      {!currentPatient && !queueLoading && (
        <div className="shrink-0 border-t border-slate-200/70 bg-gray-50/90 pt-3 backdrop-blur" data-next-call-bar>
          {firstWaiting ? (
            <button
              onClick={() => handleCallAndStart(firstWaiting)}
              disabled={isPending}
              className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 text-left text-white shadow-[0_10px_24px_-12px_rgba(37,99,235,0.8)] transition hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="rounded-lg bg-white/15 px-2 py-0.5 text-xs font-semibold"><T k="다음 호출" /></span>
                <span className="text-lg font-bold tabular-nums">#{firstWaiting.queueNumber}</span>
                <span className="truncate text-base font-semibold">{firstWaiting.patient?.familyName}{firstWaiting.patient?.givenName}</span>
              </span>
              <span className="shrink-0 text-sm text-white/80"><WaitTimeLabel checkedInAt={firstWaiting.checkedInAt} onDark /> &rarr;</span>
            </button>
          ) : (
            <div className="flex min-h-[52px] items-center justify-center rounded-2xl border border-dashed border-slate-300 text-sm font-medium text-slate-400">
              <T k="대기 환자 없음" />
              {waitingScheduled > 0 && <span className="ml-2 text-xs text-slate-400">· <T k="예약 · 도착 전" /> {waitingScheduled}</span>}
            </div>
          )}
        </div>
      )}
      </>}
    </div>
    <ClinicQueueSideRail waiting={waiting} completed={completed} cancelled={cancelled} onGoDeptTab={setDeptTab} />
    </div>
  );
}