'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useDepartments, DeptLoadError } from '@/lib/use-departments';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { subscribeSseSignal } from '@/lib/sse-signal';
import { toast } from '@/stores/toast-store';
import { LoadingSkeleton } from './LoadingSkeleton';
import { ReceptionTicket, type TicketData } from './ReceptionTicket';
import { pollMs, kdate } from '@/lib/ui-settings';

import { EmptyState, Unit, Duration } from '@/components/ui/display';
import { useQueueThresholds, waitTone, WAIT_TONE_TEXT } from '@/lib/queue-thresholds';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface QueueItem {
  id: string;
  queueNumber: number;
  status: string;
  departmentName: string;
  roomName?: string;
  visitType: string;
  type: string;
  checkedInAt: string;
  eligibilityStatus?: string | null;
  /** 접수 시각이 아직 오지 않은 예약 — 서버 판정 */
  isScheduled?: boolean;
  identityVerifiedAt?: string | null;
  patient?: { familyName: string; givenName: string; mrn: string };
  doctor?: { familyName: string; givenName: string };
}

interface QueueStats {
  /** 🔴 표본이 있는 과만 키가 있다 — 키가 없는 과는 '0분'이 아니라 **산출 불가**다 */
  avgWaitMinutes?: Record<string, number>;
  /** 대기시간을 산출할 수 있었던 건(진료 시작 시각 보유) */
  waitSampleN?: number;
  /** 오늘 접수됐지만 대기시간을 산출할 수 없는 건 */
  waitUnmeasuredN?: number;
  /** 위 두 수의 근거 문구(서버 생성) */
  waitBasis?: string;
  hourly?: { hour: number; total: number; walkIn: number; appointment: number }[];
  typeCounts?: { WALK_IN: number; APPOINTMENT: number };
}

// 진료과 목록 정본 = 마스터(useDepartments) — 로컬 배열 재정의 금지(input-assist-ux P1)

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  WAITING: { label: '대기', color: 'bg-yellow-100 text-yellow-800' },
  CALLED: { label: '호출', color: 'bg-blue-100 text-blue-800' },
  IN_CONSULTATION: { label: '진료중', color: 'bg-green-100 text-green-800' },
  CASHIER_WAITING: { label: '수납대기', color: 'bg-purple-100 text-purple-700' },
  PHARMACY_WAITING: { label: '약국대기', color: 'bg-teal-100 text-teal-700' }, // 정본(WAITING_QUEUE) 누락 봉합
  COMPLETED: { label: '완료', color: 'bg-gray-100 text-gray-600' },
  CANCELLED: { label: '취소', color: 'bg-red-100 text-red-700' },
  NO_SHOW: { label: '미방문', color: 'bg-orange-100 text-orange-700' },
};

export function QueueTab() {
  const tt = useTAttr();
  const qThresholds = useQueueThresholds(); // 임계 정본 = config clinical.queue.*(§7 P2)
  const queryClient = useQueryClient();
  const [filterDept, setFilterDept] = useState('');
  const { names: departments } = useDepartments({ category: 'CLINICAL' });
  const [filterStatus, setFilterStatus] = useState('');

  const [search, setSearch] = useState('');
  const [sortLongWait, setSortLongWait] = useState(false);
  // 🔴 상태는 서버에서 거르지 않는다 — 상태별 칩이 **전체 중 몇 명**인지 세려면 전 상태가 필요하다(2026-09-29)
  const { data, isLoading, isError: queueIsError, error: queueError, refetch: refetchQueue } = useQuery({
    queryKey: ['queue', filterDept],
    queryFn: () =>
      apiClient.get<{ data: QueueItem[] }>('/api/v1/queue', {
        department: filterDept || undefined,
      }),
    refetchInterval: pollMs('normal'), // SSE 신호가 주 갱신원 — 폴링은 안전망
  });

  const { data: statsData } = useQuery({
    queryKey: ['queue-stats'],
    queryFn: () => apiClient.get<{ data: QueueStats }>('/api/v1/queue/stats'),
    refetchInterval: pollMs('slow'),
  });

  // 실시간: 대기열 변경 SSE 신호 수신 시 즉시 재조회(체크인/호출/진료시작/완료/취소/정정)
  useEffect(() => {
    const unsub = subscribeSseSignal('/api/v1/queue/events', () => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      queryClient.invalidateQueries({ queryKey: ['queue-stats'] });
    });
    return unsub;
  }, [queryClient]);

  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [editFor, setEditFor] = useState<QueueItem | null>(null);

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/queue/${id}/cancel`),
    onSuccess: () => {
      toast.success(tt('접수가 취소되었습니다.'));
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: () => toast.error(tt('취소 처리 중 오류가 발생했습니다.')),
  });

  // 잘못 누른 취소·미방문 되돌리기(오늘·진료 미시작·같은 과 재접수 없음 — 서버가 가린다)
  const restoreMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/queue/${id}/restore`),
    onSuccess: () => {
      toast.success(tt('대기로 되돌렸습니다 — 순번과 접수 시각은 그대로입니다.'));
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message || tt('되돌리지 못했습니다.')),
  });

  const noShowMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/queue/${id}/no-show`),
    onSuccess: () => {
      toast.success(tt('미방문(노쇼) 처리되었습니다.'));
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: () => toast.error(tt('노쇼 처리 중 오류가 발생했습니다.')),
  });

  const _queuesRaw = data?.data;
  const allQueues: QueueItem[] = Array.isArray(_queuesRaw) ? _queuesRaw : (_queuesRaw as unknown as Record<string, unknown>)?.data as QueueItem[] ?? [];
  const statusCounts = allQueues.reduce<Record<string, number>>((m, q) => { m[q.status] = (m[q.status] ?? 0) + 1; return m; }, {});
  const needle = search.trim().replace(/^#/, '').toLowerCase();
  const queues = allQueues
    .filter((q) => !filterStatus || q.status === filterStatus)
    .filter((q) => !needle
      || `${q.patient?.familyName ?? ''}${q.patient?.givenName ?? ''}`.toLowerCase().includes(needle)
      || (q.patient?.mrn ?? '').toLowerCase().includes(needle)
      || String(q.queueNumber) === needle)
    // 오래 기다린 순 — 대기·호출만 앞으로(종료된 행은 기다리는 사람이 아니다)
    .sort((a, b) => {
      if (!sortLongWait) return 0;
      const act = (q: QueueItem) => ['WAITING', 'CALLED'].includes(q.status) && !q.isScheduled;
      if (act(a) !== act(b)) return act(a) ? -1 : 1;
      return act(a) ? a.checkedInAt.localeCompare(b.checkedInAt) : 0;
    });
  // stats 응답은 {data:{data:{...}}} 이중 래핑 — 내부 data까지 언랩
  const _sRaw = statsData?.data as QueueStats | { data?: QueueStats } | undefined;
  const stats: QueueStats | undefined = _sRaw && 'avgWaitMinutes' in _sRaw ? _sRaw : (_sRaw as { data?: QueueStats } | undefined)?.data;
  const hourly = stats?.hourly ?? [];
  const hourlyMax = Math.max(1, ...hourly.map((h) => h.total));
  const tc = stats?.typeCounts;
  const tcTotal = (tc?.WALK_IN ?? 0) + (tc?.APPOINTMENT ?? 0);

  return (
    <div className="space-y-6">
      {stats && (() => {
        const deptAvgs = Object.entries(stats.avgWaitMinutes ?? {});
        return (
          <div className="space-y-1.5">
            {/* 🔴 표본이 없으면 카드가 통째로 사라져 화면이 아무 말도 안 했다 —
                 서버가 낸 근거(waitBasis)를 그대로 옮겨 '왜 없는지'를 말한다. */}
            {deptAvgs.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="text-sm font-semibold text-gray-700"><T k="평균 대기시간 산출 불가" /></p>
                <p className="text-[11px] text-gray-400 mt-0.5">{stats.waitBasis ?? <T k="진료 시작 시각이 기록된 건이 없습니다" />}</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {deptAvgs.slice(0, 4).map(([dept, mins]) => (
                    <div key={dept} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                      <p className="text-xs text-gray-500">{dept}</p>
                      <p className="text-lg font-bold text-gray-900 mt-1">{mins as number}<Unit>분</Unit></p>
                      <p className="text-[11px] text-gray-400"><T k="평균 대기시간" /></p>
                    </div>
                  ))}
                </div>
                {stats.waitBasis && <p className="text-[11px] text-gray-400 px-1">{stats.waitBasis}</p>}
              </>
            )}
          </div>
        );
      })()}

      {/* 시간대별 접수 현황 + 워크인/예약 비율 */}
      {hourly.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900"><T k="시간대별 접수 현황" /></h3>
            {tcTotal > 0 && (
              <span className="text-xs text-gray-500">
                <T k="현장" /> <b className="text-blue-600">{tc!.WALK_IN}</b> · <T k="예약" /> <b className="text-emerald-600">{tc!.APPOINTMENT}</b>
                <span className="text-gray-400 ml-1">({Math.round((tc!.WALK_IN / tcTotal) * 100)}<Unit>%</Unit> / {Math.round((tc!.APPOINTMENT / tcTotal) * 100)}<Unit>%</Unit>)</span>
              </span>
            )}
          </div>
          <div className="flex items-end gap-1.5 h-20">
            {hourly.map((h) => (
              <div key={h.hour} className="flex-1 flex flex-col items-center justify-end gap-0.5 h-full" title={`${h.hour}시 · ${h.total}건 (현장 ${h.walkIn}·예약 ${h.appointment})`}>
                <span className="text-[10px] text-gray-500 font-medium">{h.total}</span>
                <div className="w-full flex flex-col justify-end rounded-t overflow-hidden" style={{ height: `${(h.total / hourlyMax) * 100}%`, minHeight: '4px' }}>
                  <div className="w-full bg-emerald-400" style={{ height: `${h.total ? (h.appointment / h.total) * 100 : 0}%` }} />
                  <div className="w-full bg-blue-500 flex-1" />
                </div>
                <span className="text-[10px] text-gray-400">{h.hour}시</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <input value={search} onChange={(e) => setSearch(e.target.value)} data-queue-search
            placeholder={tt('이름·등록번호·순번(#)')} aria-label={tt('대기열 검색 — 이름·등록번호·순번')}
            className="w-56 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
            <option value="">{tt('전체 진료과')}</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600 select-none">
            <input type="checkbox" checked={sortLongWait} onChange={(e) => setSortLongWait(e.target.checked)} data-queue-sort-longwait />
            <T k="오래 기다린 순" />
          </label>
        </div>
        {/* 상태 칩 — 수는 오늘 전체(진료과 필터 적용) 기준. 누르면 그 상태만 */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={tt('상태로 거르기')}>
          {[['', '전체'] as const, ...Object.entries(STATUS_BADGE).map(([k, v]) => [k, v.label] as const)].map(([key, label]) => {
            const n = key ? (statusCounts[key] ?? 0) : allQueues.length;
            if (key && n === 0 && filterStatus !== key) return null;
            const on = filterStatus === key;
            return (
              <button key={key || 'ALL'} type="button" onClick={() => setFilterStatus(key)} aria-pressed={on} data-queue-status-chip={key || 'ALL'}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
                <T k={label} /> <span className={`tabular-nums ${on ? 'text-white/80' : 'text-gray-400'}`}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">
          <T k="대기열" /> ({queues.length}<Unit>명</Unit>)
          {queues.length !== allQueues.length && <span className="ml-1 text-xs font-normal text-gray-400">/ <T k="오늘 전체" /> {allQueues.length}</span>}
        </h3>
        {/* 🔴 종전엔 isError 를 보지 않아 조회 실패가 "대기 중인 환자가 없습니다"로 그려졌다(P1 — 한산함으로 읽힌다) */}
        {queueIsError ? (
          <QueryErrorFallback error={queueError} onRetry={() => refetchQueue()} />
        ) : isLoading ? (
          <LoadingSkeleton rows={8} />
        ) : allQueues.length === 0 ? (
          <EmptyState icon="👤" title="대기 중인 환자가 없습니다." />
        ) : queues.length === 0 ? (
          <EmptyState icon="🔍" title="조건에 맞는 접수가 없습니다." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th className="pb-3 font-medium text-gray-500"><T k="순번" /></th>
                  <th className="pb-3 font-medium text-gray-500"><T k="환자" /></th>
                  <th className="pb-3 font-medium text-gray-500"><T k="진료과" /></th>
                  <th className="pb-3 font-medium text-gray-500"><T k="의사" /></th>
                  <th className="pb-3 font-medium text-gray-500"><T k="진료실" /></th>
                  <th className="pb-3 font-medium text-gray-500"><T k="유형" /></th>
                  <th className="pb-3 font-medium text-gray-500"><T k="접수시간" /></th>
                  <th className="pb-3 font-medium text-gray-500"><T k="대기시간" /></th>
                  <th className="pb-3 font-medium text-gray-500"><T k="상태" /></th>
                  <th className="pb-3 font-medium text-gray-500"><T k="작업" /></th>
                </tr>
              </thead>
              <tbody>
                {queues.map((q) => {
                  const waitMins = Math.round((Date.now() - new Date(q.checkedInAt).getTime()) / 60000);
                  const badge = STATUS_BADGE[q.status] ?? { label: q.status, color: 'bg-gray-100 text-gray-600' };
                  return (
                    <tr key={q.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-3 font-bold text-gray-900">#{q.queueNumber}</td>
                      <td className="py-3">
                        <span className="font-medium text-gray-900">{q.patient?.familyName}{q.patient?.givenName}</span>
                        <span className="text-xs text-gray-400 ml-1">{q.patient?.mrn}</span>
                        {q.eligibilityStatus === 'VERIFIED' && <span className="ml-1 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full whitespace-nowrap"><T k="자격" />✓</span>}
                        {(q.eligibilityStatus === 'EXPIRED' || q.eligibilityStatus === 'NOT_FOUND') && <span className="ml-1 text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full whitespace-nowrap"><T k="자격" />⚠</span>}
                        {q.identityVerifiedAt && <span className="ml-1 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full whitespace-nowrap"><T k="본인확인" /></span>}
                        {/* 접수 시각이 아직 오지 않은 예약 — 서버 판정(isScheduled). 지금 기다리는 사람과 섞어 읽지 않게 */}
                        {q.isScheduled && <span className="ml-1 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full whitespace-nowrap"><T k="예약(미도래)" /></span>}
                      </td>
                      <td className="py-3 text-gray-600">{q.departmentName}</td>
                      <td className="py-3 text-gray-600">{q.doctor?.familyName}{q.doctor?.givenName}</td>
                      <td className="py-3 text-gray-500 text-xs">{q.roomName ?? '-'}</td>
                      <td className="py-3">
                        <span className="text-xs">
                          <T k={q.visitType === 'INITIAL' ? '초진' : '재진'} />
                          {q.type === 'APPOINTMENT' && <span className="ml-1 text-blue-500">(<T k="예약" />)</span>}
                        </span>
                      </td>
                      <td className="py-3 text-gray-500 text-xs">
                        {kdate(q.checkedInAt, 'time')}
                      </td>
                      <td className="py-3">
                        {['WAITING', 'CALLED'].includes(q.status) && !q.isScheduled && (
                          <span className={`text-xs font-medium ${WAIT_TONE_TEXT[waitTone(waitMins, qThresholds)!] ?? 'text-gray-600'}`}><Duration minutes={waitMins} /></span>
                        )}
                      </td>
                      <td className="py-3">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${badge.color}`}>{badge.label}</span>
                      </td>
                      <td className="py-3">
                        <div className="flex gap-1">
                          {['WAITING', 'CALLED', 'IN_CONSULTATION'].includes(q.status) && (
                            <button onClick={() => setTicket(q)}
                              className="px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"><T k="대기표" /></button>
                          )}
                          {['WAITING', 'CALLED'].includes(q.status) && (
                            <>
                              <button onClick={() => setEditFor(q)}
                                className="px-2.5 py-1 text-xs font-medium bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"><T k="정정" /></button>
                              <button onClick={() => { if (window.confirm(tt('미방문(노쇼)으로 처리하시겠습니까?'))) noShowMutation.mutate(q.id); }}
                                className="px-2.5 py-1 text-xs font-medium bg-orange-50 text-orange-600 rounded-lg hover:bg-orange-100 transition-colors"><T k="노쇼" /></button>
                              <button onClick={() => { if (window.confirm(tt('이 접수를 취소하시겠습니까?'))) cancelMutation.mutate(q.id); }}
                                className="px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"><T k="접수 취소" /></button>
                            </>
                          )}
                          {['CANCELLED', 'NO_SHOW'].includes(q.status) && (
                            <button onClick={() => { if (window.confirm(tt('대기로 되돌리시겠습니까? 순번과 접수 시각은 그대로입니다.'))) restoreMutation.mutate(q.id); }}
                              disabled={restoreMutation.isPending} data-queue-restore
                              className="px-2.5 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"><T k="되돌리기" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {ticket && <ReceptionTicket ticket={ticket} onClose={() => setTicket(null)} />}
      {editFor && <EditQueueModal item={editFor} onClose={() => setEditFor(null)} onDone={() => { setEditFor(null); queryClient.invalidateQueries({ queryKey: ['queue'] }); }} />}
    </div>
  );
}

/** 접수 정정 — 진료과/의사/유형 수정(대기·호출 상태만, 과 변경 시 순번 재발급) */
function EditQueueModal({ item, onClose, onDone }: { item: QueueItem; onClose: () => void; onDone: () => void }) {
  const tt = useTAttr();
  const [dept, setDept] = useState(item.departmentName);
  const { names: departments, isError: deptListError, refetch: refetchDepts } = useDepartments({ category: 'CLINICAL', include: [item.departmentName] });
  const [doctorId, setDoctorId] = useState('');
  const [visitType, setVisitType] = useState(item.visitType);
  const [busy, setBusy] = useState(false);

  interface ScheduleItem { doctorId: string; doctor?: { familyName?: string; givenName?: string } }
  const { data: docData, isError: docIsError, error: docError, refetch: refetchDoc } = useQuery({
    queryKey: ['clinic-schedule-today', dept],
    queryFn: () => apiClient.get<{ data: ScheduleItem[] }>('/api/v1/clinic-schedule/today', { department: dept }),
    enabled: !!dept,
  });
  const _dRaw = docData?.data;
  const doctors: ScheduleItem[] = Array.isArray(_dRaw) ? _dRaw : (_dRaw as unknown as { data?: ScheduleItem[] })?.data ?? [];

  const submit = async () => {
    setBusy(true);
    try {
      await apiClient.patch(`/api/v1/queue/${item.id}`, {
        departmentName: dept !== item.departmentName ? dept : undefined,
        doctorId: doctorId || undefined,
        visitType: visitType !== item.visitType ? visitType : undefined,
      });
      toast.success(tt('접수가 정정되었습니다.'));
      onDone();
    } catch (e) {
      toast.error((e as { message?: string })?.message || tt('정정 처리 중 오류가 발생했습니다.'));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 mb-1"><T k="접수 정정" /></h3>
        <p className="text-xs text-gray-400 mb-4">#{item.queueNumber} {item.patient?.familyName}{item.patient?.givenName} · <T k="과 변경 시 순번이 재발급됩니다" /></p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block"><T k="진료과" /></label>
            <select value={dept} onChange={(e) => { setDept(e.target.value); setDoctorId(''); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {deptListError && <DeptLoadError onRetry={refetchDepts} />}
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block"><T k="담당의" /> <span className="text-gray-400">(<T k="미선택 시" /> <T k={dept !== item.departmentName ? '자동 배정' : '유지'} />)</span></label>
            <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">{dept !== item.departmentName ? tt('자동 배정') : tt('현재 담당의 유지')}</option>
              {doctors.map((d) => <option key={d.doctorId} value={d.doctorId}>{d.doctor?.familyName ?? ''}{d.doctor?.givenName ?? ''}</option>)}
              {docIsError && <option value="" disabled>{tt('진료의 목록을 불러오지 못했습니다')}</option>}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block"><T k="접수 유형" /></label>
            <div className="flex gap-2">
              {[{ v: 'INITIAL', l: '초진' }, { v: 'FOLLOW_UP', l: '재진' }].map((t) => (
                <button key={t.v} onClick={() => setVisitType(t.v)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium ${visitType === t.v ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}><T k={t.l} /></button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={submit} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50">{busy ? <T k="정정 중…" /> : <T k="정정 적용" />}</button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600"><T k="닫기" /></button>
        </div>
      </div>
    </div>
  );
}
