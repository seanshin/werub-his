'use client';

import { useState, useMemo } from 'react';
import { Duration, Unit, genderText } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import Link from 'next/link';
import { pollMs } from '@/lib/ui-settings';
import StatusBadge from '@/components/ui/StatusBadge';
import { usePatientNotifyConfirm, patientPushMessage } from '@/components/notification/PatientNotifyConfirm';
import { toast } from '@/stores/toast-store';
import { T } from '@/components/ui/i18n-text';
import { RxGuidePanel } from './RxGuidePanel';

interface QueueItem {
  id: string;
  queueNumber: number;
  status: string;
  type: string;
  visitType: string;
  reason: string | null;
  departmentName: string;
  roomName: string | null;
  checkedInAt: string;
  calledAt: string | null;
  startedAt: string | null;
  encounterId?: string | null;
  patient: { id: string; familyName: string; givenName: string; dateOfBirth: string; gender: string };
  doctor: { id: string; familyName: string; givenName: string; specialty: string | null };
}

function minutesAgo(ts: string) {
  return Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
}



const NURSING_STEPS = [
  { key: 'vitals', label: '바이탈' },
  { key: 'questionnaire', label: '문진' },
  { key: 'consent', label: '동의서' },
  { key: 'ready', label: '준비완료' },
] as const;

export default function OutpatientNursingPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [deptFilter, setDeptFilter] = useState('');
  const [nursingStatus, setNursingStatus] = useState<Record<string, Set<string>>>({});
  const [rxGuideEncounter, setRxGuideEncounter] = useState<string | null>(null);

  const { data: queueData, isError, error, refetch } = useQuery({
    queryKey: ['queue-all', deptFilter],
    queryFn: () => apiClient.get<{ data: QueueItem[] }>(`/api/v1/queue${deptFilter ? `?department=${deptFilter}` : ''}`),
    refetchInterval: pollMs('fast'),
  });

  const { data: statsData } = useQuery({
    queryKey: ['queue-stats'],
    queryFn: () => apiClient.get<{ data: any }>('/api/v1/queue/stats'),
    refetchInterval: pollMs('normal'),
  });

  // 🔴 환자 앱 알림은 명시 승인이 있어야 나간다(설정만으로 몰래 나가지 않는다)
  const notify = usePatientNotifyConfirm('호출');
  const callMutation = useMutation({
    mutationFn: ({ id, notifyPatient }: { id: string; notifyPatient: boolean }) =>
      apiClient.patch<{ data: { patientPush?: { sent?: boolean; reason?: string; pushChannel?: string | null } } }>(
        `/api/v1/queue/${id}/call`, { notifyPatient },
      ),
    onSuccess: (res) => {
      const msg = patientPushMessage(res?.data?.patientPush);
      if (msg) toast.info(msg);
      qc.invalidateQueries({ queryKey: ['queue-all'] });
    },
  });
  const callWithConsent = async (id: string) => {
    const yes = await notify.ask();
    if (yes === null) return;
    callMutation.mutate({ id, notifyPatient: yes });
  };

  const noShowMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/queue/${id}/no-show`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queue-all'] }),
  });

  const raw = queueData?.data;
  const queue: QueueItem[] = Array.isArray(raw) ? raw : (raw as any)?.data ?? [];
  const activeQueue = queue.filter((q) => ['WAITING', 'CALLED', 'IN_CONSULTATION'].includes(q.status));

  const departments = useMemo(() => {
    const deps = new Set(queue.map((q) => q.departmentName));
    return Array.from(deps).sort();
  }, [queue]);

  const stats = statsData?.data;
  const statsObj = (stats as any)?.data ?? stats;

  const toggleNursingStep = (queueId: string, step: string) => {
    setNursingStatus((prev) => {
      const current = new Set(prev[queueId] ?? []);
      if (current.has(step)) current.delete(step);
      else current.add(step);
      return { ...prev, [queueId]: current };
    });
  };

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-[1400px] mx-auto space-y-4">
      {/* 🔴 승인 다이얼로그 — 렌더하지 않으면 물어보지 못하고, 물어보지 못하면 알림은 영원히 안 나간다 */}
      {notify.dialog}
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900"><T k="외래 간호 워크스테이션" /></h2>
          <p className="text-sm text-gray-500">{user?.familyName}{user?.givenName} 간호사 | 외래 대기환자 관리</p>
        </div>
        <div className="flex gap-2">
          <Link href="/workstation/nursing" className="px-3 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
            <T k="입원 간호" />
          </Link>
          <Link href="/reception" className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <T k="접수 데스크" />
          </Link>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-[11px] text-gray-500"><T k="대기 중" /></p>
          <p className="text-2xl font-bold text-amber-600">{activeQueue.filter((q) => q.status === 'WAITING').length}<Unit>명</Unit></p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-[11px] text-gray-500"><T k="호출됨" /></p>
          <p className="text-2xl font-bold text-blue-600">{activeQueue.filter((q) => q.status === 'CALLED').length}<Unit>명</Unit></p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-[11px] text-gray-500"><T k="진료 중" /></p>
          <p className="text-2xl font-bold text-emerald-600">{activeQueue.filter((q) => q.status === 'IN_CONSULTATION').length}<Unit>명</Unit></p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-[11px] text-gray-500"><T k="오늘 완료" /></p>
          <p className="text-2xl font-bold text-gray-600">{queue.filter((q) => q.status === 'COMPLETED').length}<Unit>명</Unit></p>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex gap-2 items-center">
        <button
          onClick={() => setDeptFilter('')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg ${!deptFilter ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          <T k="전체" />
        </button>
        {departments.map((dept) => (
          <button
            key={dept}
            onClick={() => setDeptFilter(dept)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${deptFilter === dept ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            {dept}
          </button>
        ))}
      </div>

      {/* 대기열 테이블 */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500"><T k="순번" /></th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500"><T k="진료과 / 의사" /></th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500"><T k="대기" /></th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500"><T k="간호 진행" /></th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500"><T k="액션" /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {activeQueue.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="대기 환자가 없습니다" /></td></tr>
            ) : (
              activeQueue.map((q) => {
                const patientSteps = nursingStatus[q.id] ?? new Set<string>();
                const allDone = NURSING_STEPS.every((s) => patientSteps.has(s.key));
                return (
                  <tr key={q.id} className="hover:bg-blue-50/30">
                    <td className="px-3 py-3 font-mono font-bold text-gray-900">#{q.queueNumber}</td>
                    <td className="px-3 py-3">
                      <Link href={`/patients/${q.patient.id}?tab=vitals`} className="font-medium text-gray-900 hover:text-blue-600">
                        {q.patient.familyName}{q.patient.givenName}
                      </Link>
                      <span className="ml-1.5 text-[10px] text-gray-400">
                        {/* 🔴 종전 이진 삼항은 값이 없을 때 **전원을 여성으로 단정**했다
                             (서버 select 에 gender 가 빠져 20행이 전부 F · 2026-08-12). 정본 경유. */}
                        {genderText(q.patient.gender)} / {q.visitType === 'INITIAL' ? '초진' : '재진'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-gray-700">{q.departmentName}</span>
                      <span className="text-gray-400 mx-1">/</span>
                      <span className="text-gray-600">{q.doctor.familyName}{q.doctor.givenName}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${q.type === 'WALK_IN' ? 'bg-orange-100 text-orange-600' : 'bg-sky-100 text-sky-600'}`}>
                        {q.type === 'WALK_IN' ? '당일' : '예약'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-gray-600 tabular-nums">
                      <Duration minutes={minutesAgo(q.checkedInAt)} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        {NURSING_STEPS.map((step) => (
                          <button
                            key={step.key}
                            onClick={() => toggleNursingStep(q.id, step.key)}
                            className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                              patientSteps.has(step.key)
                                ? 'bg-emerald-100 text-emerald-700 font-medium'
                                : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                            }`}
                          >
                            {step.label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge domain="waitingQueue" status={q.status} className="text-[10px] whitespace-nowrap" />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        {q.status === 'WAITING' && allDone && (
                          <button
                            onClick={() => void callWithConsent(q.id)}
                            className="px-2 py-1 text-[10px] font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            <T k="호출@버튼" />
                          </button>
                        )}
                        {q.status === 'WAITING' && !allDone && (
                          <span className="text-[10px] text-gray-400"><T k="간호 미완료" /></span>
                        )}
                        {q.status === 'WAITING' && (
                          <button
                            onClick={() => noShowMutation.mutate(q.id)}
                            className="px-2 py-1 text-[10px] text-gray-400 hover:text-red-500"
                          >
                            <T k="미방문" />
                          </button>
                        )}
                        <Link
                          href={`/patients/${q.patient.id}?tab=vitals`}
                          className="px-2 py-1 text-[10px] text-blue-600 hover:text-blue-800"
                        >
                          <T k="차트" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 진료 후 처방 설명 가이드(#17) — 진료가 끝나 진료 기록이 연결된 환자만 */}
      {queue.some((q) => q.status === 'COMPLETED' && q.encounterId) && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
          <h3 className="text-xs font-bold text-gray-500"><T k="진료 후 처방 설명" /></h3>
          <div className="flex flex-wrap gap-2">
            {queue.filter((q) => q.status === 'COMPLETED' && q.encounterId).map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => setRxGuideEncounter(rxGuideEncounter === q.encounterId ? null : (q.encounterId ?? null))}
                className={`min-h-[44px] px-3 text-xs rounded-lg border ${rxGuideEncounter === q.encounterId ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
              >
                #{q.queueNumber} {q.patient.familyName}{q.patient.givenName}
              </button>
            ))}
          </div>
          {rxGuideEncounter && <RxGuidePanel encounterId={rxGuideEncounter} />}
        </div>
      )}

      {/* 사유 표시 */}
      {activeQueue.some((q) => q.reason) && (
        <div className="bg-gray-50 rounded-xl p-4">
          <h3 className="text-xs font-bold text-gray-500 mb-2"><T k="접수 사유" /></h3>
          <div className="space-y-1">
            {activeQueue.filter((q) => q.reason).map((q) => (
              <p key={q.id} className="text-xs text-gray-600">
                <span className="font-medium">#{q.queueNumber} {q.patient.familyName}{q.patient.givenName}</span>: {q.reason}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
