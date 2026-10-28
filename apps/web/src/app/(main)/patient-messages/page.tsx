'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, KDate, PatientName } from '@/components/ui/display';
import { Data, T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { patientPushMessage } from '@/components/notification/PatientNotifyConfirm';

/**
 * 환자 메시지함(2106) — 환자가 포털·앱에서 담당의에게 보낸 메시지의 **직원 측 수신처**.
 *
 * 🔴 (2026-09-14 기획서 전수 검토) 환자 메시지를 읽는 곳이 환자 본인 목록뿐이었다 —
 *    환자는 보냈다고 믿지만 **아무에게도 도달하지 않았다.**
 *
 * 화면이 말하는 사실:
 *  · 담당 미지정 메시지는 "누가 받는지 모른다" — 임의로 배정하지 않는다. 의사가 답하면 그 의사가 담당으로 기록된다
 *  · 의사는 자기 지정분 + 미지정분만 본다 · 다른 열람 역할은 전건(환자 지목 열람은 감사 원장에 남는다)
 *  · 답변은 의사만 · 환자 앱 알림은 이 답변마다 체크해야(옵트인) + 설정이 켜져 있어야 나간다 — 결과를 그대로 말한다
 */

interface InboxThread {
  patientId: string;
  patientName: string;
  mrn: string | null;
  assignment: 'MINE' | 'UNASSIGNED' | 'OTHER' | null;
  assignedDoctors: Array<{ id: string; name: string }>;
  hasUnassigned: boolean;
  unreadFromPatient: number;
  lastMessageAt: string;
  lastSender: string;
}
interface InboxResponse { scope: 'MINE_AND_UNASSIGNED' | 'ALL'; truncated: boolean; scanLimit: number; threads: InboxThread[] }
interface ThreadMessage {
  id: string;
  sender: string;
  content: string;
  createdAt: string;
  assignment: 'MINE' | 'UNASSIGNED' | 'OTHER';
  doctor: { id: string; name: string; department?: string | null } | null;
  readByStaff: boolean | null;
}
interface ThreadResponse {
  scope: InboxResponse['scope'];
  patient: { id: string; name: string; mrn: string | null };
  canReply: boolean;
  /** 서버 판정 — 화면은 로그인 역할을 스스로 보지 않는다 */
  replyBlocked: 'NOT_DOCTOR' | 'NO_PATIENT_MESSAGE' | null;
  messages: ThreadMessage[];
}

const unwrap = <X,>(r: unknown): X => ((r as { data?: X })?.data ?? r) as X;

export default function PatientMessagesPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [notifyPatient, setNotifyPatient] = useState(false);

  const inboxQ = useQuery({
    queryKey: ['patient-messages', 'inbox'],
    queryFn: async () => unwrap<InboxResponse>(await apiClient.get('/api/v1/patient-messages/inbox')),
  });
  const threadQ = useQuery({
    queryKey: ['patient-messages', 'thread', selected],
    enabled: !!selected,
    queryFn: async () => unwrap<ThreadResponse>(await apiClient.get(`/api/v1/patient-messages/patients/${selected}`)),
  });

  const replyMut = useMutation({
    mutationFn: async () =>
      unwrap<{ claimedUnassigned: number; patientPush: { sent: boolean; reason: string; pushChannel: string | null } }>(
        await apiClient.post(`/api/v1/patient-messages/patients/${selected}/reply`, { content: draft.trim(), notifyPatient }),
      ),
    onSuccess: (r) => {
      toast.success(tAttr('답변을 저장했습니다. 환자 메시지함에 보입니다.'));
      if (r.claimedUnassigned > 0) toast.info(tAttr('담당 미지정 메시지에 답해 담당으로 기록됐습니다.'));
      const pushMsg = patientPushMessage(r.patientPush);
      // 발송 결과 문장은 정본(PatientNotifyConfirm.patientPushMessage)이 만든다 — 다른 소비처와 같은 문장 그대로
      if (pushMsg) (r.patientPush.sent ? toast.success : toast.info)(pushMsg);
      setDraft('');
      setNotifyPatient(false);
      qc.invalidateQueries({ queryKey: ['patient-messages'] });
    },
    onError: () => toast.error(tAttr('답변 저장에 실패했습니다.')),
  });

  if (inboxQ.isError) return <QueryErrorFallback error={inboxQ.error} onRetry={() => inboxQ.refetch()} />;
  const inbox = inboxQ.data;
  const threads = inbox?.threads ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-gray-900"><T k="환자 메시지함" /></h2>
        <p className="text-sm text-gray-500 mt-1">
          <T k="환자가 포털·앱에서 담당의에게 보낸 메시지입니다." />{' '}
          {inbox?.scope === 'MINE_AND_UNASSIGNED'
            ? <T k="내게 지정된 메시지와 담당 미지정 메시지만 보입니다." />
            : inbox ? <T k="전체 메시지가 보입니다. 환자별 열람은 감사 기록에 남습니다." /> : null}
        </p>
      </div>

      {inbox?.truncated && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          <Tf k="최근 {건수}건까지만 묶었습니다 — 더 오래된 메시지는 이 목록에 없습니다." params={{ 건수: inbox.scanLimit }} />
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,22rem)_1fr] gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
          {inboxQ.isLoading ? (
            <div className="h-40 animate-pulse bg-gray-50 rounded-2xl" />
          ) : threads.length === 0 ? (
            <EmptyState icon="✉️" title="받은 환자 메시지가 없습니다." compact />
          ) : threads.map((th) => (
            <button key={th.patientId} onClick={() => setSelected(th.patientId)}
              className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${selected === th.patientId ? 'bg-blue-50' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <PatientName name={th.patientName} mrn={th.mrn} maskable className="text-sm font-medium text-gray-900" />
                {th.unreadFromPatient > 0 && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 whitespace-nowrap">
                    <Tf k="안 읽음 {건수}" params={{ 건수: th.unreadFromPatient }} />
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                {th.hasUnassigned && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 whitespace-nowrap"><T k="담당 미지정 포함" /></span>
                )}
                {inbox?.scope === 'ALL' && th.assignedDoctors.map((d) => (
                  <span key={d.id} className="px-1.5 py-0.5 rounded bg-gray-100 whitespace-nowrap"><Data>{d.name}</Data></span>
                ))}
                <KDate value={th.lastMessageAt} mode="datetimeShort" />
                <span>· <T k={th.lastSender === 'DOCTOR' ? '마지막: 의사 답변' : '마지막: 환자'} /></span>
              </div>
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 min-h-[16rem]">
          {!selected ? (
            <EmptyState icon="👈" title="왼쪽에서 환자를 고르세요." />
          ) : threadQ.isError ? (
            <QueryErrorFallback error={threadQ.error} onRetry={() => threadQ.refetch()} />
          ) : threadQ.isLoading || !threadQ.data ? (
            <div className="h-40 animate-pulse bg-gray-50 rounded-xl" />
          ) : (
            <div className="space-y-3">
              <PatientName name={threadQ.data.patient.name} mrn={threadQ.data.patient.mrn} maskable className="text-base font-semibold text-gray-900" />
              <ul className="space-y-2">
                {threadQ.data.messages.map((m) => (
                  <li key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.sender === 'DOCTOR' ? 'bg-blue-50 ml-8' : 'bg-gray-50 mr-8'}`}>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500 mb-1">
                      <T k={m.sender === 'DOCTOR' ? '의사 답변' : '환자'} />
                      {m.sender === 'PATIENT' && m.assignment === 'UNASSIGNED' && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700"><T k="담당 미지정 — 누가 받는지 정해지지 않았습니다" /></span>
                      )}
                      {m.doctor && <Data>{m.doctor.name}</Data>}
                      <KDate value={m.createdAt} mode="datetime" />
                    </div>
                    <p className="whitespace-pre-wrap text-gray-800"><Data>{m.content}</Data></p>
                  </li>
                ))}
              </ul>

              {threadQ.data.canReply ? (
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={4000}
                    placeholder={tAttr('환자에게 보낼 답변')}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input type="checkbox" checked={notifyPatient} onChange={(e) => setNotifyPatient(e.target.checked)} className="rounded" />
                    <T k="환자 앱 알림도 요청(설정이 켜져 있어야 나갑니다 · 답변 내용은 알림에 싣지 않습니다)" />
                  </label>
                  <button onClick={() => replyMut.mutate()} disabled={!draft.trim() || replyMut.isPending}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium disabled:opacity-40">
                    <T k="답변 보내기" />
                  </button>
                </div>
              ) : (
                <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
                  {threadQ.data.replyBlocked === 'NOT_DOCTOR'
                    ? <T k="답변은 의사만 할 수 있습니다 — 이 계정에서는 조회만 가능합니다." />
                    : <T k="이 환자에게서 받은 메시지가 없어 답할 수 없습니다." />}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
