'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { pollMs } from '@/lib/ui-settings';

import { EmptyState, Duration, Unit } from '@/components/ui/display';
import { useQueueThresholds, waitTone, WAIT_TONE_TEXT } from '@/lib/queue-thresholds';
import { usePatientNotifyConfirm, patientPushMessage } from '@/components/notification/PatientNotifyConfirm';

interface QueueItem {
  id: string;
  queueNumber: number;
  patientId: string;
  status: string;
  visitType: string;
  checkedInAt: string;
  patient?: { familyName?: string; givenName?: string };
}

export default function MyWaitingQueueWidget() {
  const tt = useTAttr();
  const qThresholds = useQueueThresholds(); // 임계 정본 = config clinical.queue.*(§7 P2)
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-queue'],
    queryFn: () => apiClient.get<{ data: QueueItem[] }>('/api/v1/queue/my'),
    refetchInterval: pollMs('fast'),
  });

  const router = useRouter();

  // 🔴 환자 앱 알림은 명시 승인이 있어야 나간다
  const notify = usePatientNotifyConfirm(tt('호출'));
  const callMutation = useMutation({
    mutationFn: ({ queueItem, notifyPatient }: { queueItem: QueueItem; notifyPatient: boolean }) =>
      apiClient.patch<{ data: { patientPush?: { sent?: boolean; reason?: string; pushChannel?: string | null } } }>(
        `/api/v1/queue/${queueItem.id}/call`, { notifyPatient },
      ).then((r) => ({ queueItem, res: r })),
    onSuccess: ({ queueItem, res }: { queueItem: QueueItem; res: { data?: { patientPush?: { sent?: boolean; reason?: string; pushChannel?: string | null } } } }) => {
      toast.success(tt('환자를 호출했습니다. 진료 화면으로 이동합니다.'));
      const msg = patientPushMessage(res?.data?.patientPush);
      if (msg) toast.info(msg);
      queryClient.invalidateQueries({ queryKey: ['my-queue'] });
      queryClient.invalidateQueries({ queryKey: ['clinic-queue'] });
      startAndOpen(queueItem);
    },
    onError: () => toast.error(tt('호출 처리 중 오류가 발생했습니다.')),
  });

  // 🔴 호출 뒤 곧장 진료화면으로 가면 대기열과 끊긴 새 진료가 생긴다(서명 후 수납 대기로 안 넘어감) —
  //    진료시작(/start)이 대기열↔진료를 한 트랜잭션으로 잇고, 그 진료로 들어간다(진료실 대기 화면과 같은 흐름 · 2026-09-30)
  const startMutation = useMutation({
    mutationFn: (queueItem: QueueItem) =>
      apiClient.patch<{ data?: { encounterId?: string } }>(`/api/v1/queue/${queueItem.id}/start`).then((r) => ({ queueItem, res: r })),
    onSuccess: ({ queueItem, res }) => {
      queryClient.invalidateQueries({ queryKey: ['my-queue'] });
      const enc = (res as { data?: { encounterId?: string } })?.data?.encounterId;
      router.push(`/patients/${queueItem.patientId}/encounter/new${enc ? `?encounterId=${enc}` : ''}`);
    },
    onError: () => toast.error(tt('진료 시작 처리 중 오류가 발생했습니다.')),
  });
  const startAndOpen = (queueItem: QueueItem) => startMutation.mutate(queueItem);

  const rawQueue = data?.data;
  const queue: QueueItem[] = Array.isArray(rawQueue) ? rawQueue : (rawQueue as Record<string, unknown> | undefined)?.data as QueueItem[] ?? [];
  const waitingCount = queue.filter((q: QueueItem) => q.status === 'WAITING').length;
  const firstWaiting = queue.find((q: QueueItem) => q.status === 'WAITING');

  return (
    <div>
      {/* 🔴 승인 다이얼로그 — 렌더하지 않으면 물어보지 못하고, 물어보지 못하면 알림은 영원히 안 나간다 */}
      {notify.dialog}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {waitingCount > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white animate-pulse">
              {waitingCount}<Unit><T k="명" /></Unit>
            </span>
          )}
        </div>
        <Link href="/clinic-queue" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
          <T k="진료실 대기" /> →
        </Link>
      </div>
      {/* 🔴 조회 실패를 "대기 중인 환자가 없습니다"로 말하지 않는다 */}
      {isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} size="compact" />
      ) : isLoading ? (
        <div className="space-y-1.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : queue.length === 0 ? (
        <EmptyState compact icon="👤" title="대기 중인 환자가 없습니다." />
      ) : (
        <>
          <div className="divide-y divide-gray-50">
            {queue.map((q: QueueItem) => {
              const waitMins = Math.round((Date.now() - new Date(q.checkedInAt).getTime()) / 60000);
              return (
                <div
                  key={q.id}
                  className={`flex items-center justify-between py-1.5 px-1 ${
                    q.status === 'CALLED' ? 'bg-blue-50 rounded' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-900">#{q.queueNumber}</span>
                    <span className="text-xs font-medium text-gray-900">
                      {q.patient?.familyName}{q.patient?.givenName}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      <T k={q.visitType === 'INITIAL' ? '초진' : '재진'} />
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] ${waitTone(waitMins, qThresholds) ? `${WAIT_TONE_TEXT[waitTone(waitMins, qThresholds)!]} font-bold` : 'text-gray-400'}`}>
                      <Duration minutes={waitMins} />
                    </span>
                    {q.status === 'WAITING' && (
                      <button
                        onClick={() => void (async () => { const yes = await notify.ask(); if (yes !== null) callMutation.mutate({ queueItem: q, notifyPatient: yes }); })()}
                        disabled={callMutation.isPending}
                        className="px-2 py-0.5 text-[10px] font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        <T k="호출" />
                      </button>
                    )}
                    {q.status === 'CALLED' && (
                      <button
                        type="button"
                        onClick={() => startAndOpen(q)}
                        disabled={startMutation.isPending}
                        className="px-2 py-0.5 text-[10px] font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                      >
                        <T k="진료" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {firstWaiting && (
            <button
              onClick={() => void (async () => { const yes = await notify.ask(); if (yes !== null) callMutation.mutate({ queueItem: firstWaiting, notifyPatient: yes }); })()}
              disabled={callMutation.isPending}
              className="mt-2 w-full py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <T k="다음 환자 호출 → 진료 시작" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
