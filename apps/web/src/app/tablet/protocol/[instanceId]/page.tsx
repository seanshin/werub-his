'use client';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { usePatient } from '@/hooks/usePatients';
import type { Patient } from '@/types/patient';
import TabletTopBar from '../../_components/TabletTopBar';
import TabletSummary from '../../_components/TabletSummary';

type Gate = { rule: string | null; passed: boolean; done: number; total: number; detail?: string };
type Step = { key: string; title: string; phase: string; ownerRoles: string[]; gate: boolean; gateRule: string | null; chartView: string | null; state: string; gateStatus: Gate };
type Board = { id: string; domain: string; status: string; currentStepKey: string | null; patientId: string; steps: Step[] };
type Next = { instanceId: string; dueNow: Step[]; upcoming: Step[]; blocked: Step[] };

const STATE_BADGE: Record<string, string> = { DONE: 'bg-emerald-100 text-emerald-700', IN_PROGRESS: 'bg-amber-100 text-amber-700', PENDING: 'bg-gray-100 text-gray-500' };
const DOMAIN_KO: Record<string, string> = { SURGERY: '수술 프로토콜', IPD: '입원 프로토콜', OPD: '외래 프로토콜', ER: '응급 프로토콜' };

export default function TabletProtocolBoard({ params }: { params: Promise<{ instanceId: string }> }) {
  const { instanceId } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const { data: boardRes } = useQuery({ queryKey: ['protocol-board', instanceId], queryFn: () => apiClient.get<{ data: Board }>(`/api/v1/protocols/instance/${instanceId}`), refetchInterval: 15000 });
  const board = (boardRes?.data ?? null) as Board | null;
  const { data: nextRes } = useQuery({ queryKey: ['protocol-next', instanceId], queryFn: () => apiClient.get<{ data: Next }>(`/api/v1/protocols/instance/${instanceId}/next-steps`), refetchInterval: 15000 });
  const next = (nextRes?.data ?? null) as Next | null;
  const { data: pRes } = usePatient(board?.patientId ?? '');
  const patient = (pRes?.data ?? null) as Patient | null;

  const complete = async (stepKey: string) => {
    setBusy(stepKey); setErr('');
    try {
      await apiClient.post(`/api/v1/protocols/instances/${instanceId}/steps/${stepKey}/complete`, {});
      qc.invalidateQueries({ queryKey: ['protocol-board', instanceId] });
      qc.invalidateQueries({ queryKey: ['protocol-next', instanceId] });
    } catch (e) { setErr(String((e as { message?: string })?.message ?? '게이트 미충족으로 진행할 수 없습니다')); }
    finally { setBusy(''); }
  };

  return (
    <div className="min-h-screen flex flex-col pb-6">
      <TabletTopBar patient={patient} patientId={board?.patientId} />
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">{DOMAIN_KO[board?.domain ?? ''] ?? '프로토콜'}</span>
        <button onClick={() => router.push('/tablet/protocol')} className="text-sm text-gray-500">목록</button>
      </div>
      {err && <div className="mx-3 mb-2 px-4 py-2 rounded-xl bg-red-50 text-red-700 text-sm">{err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 px-3">
        <section className="space-y-3">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <h3 className="text-base font-bold text-gray-800 mb-2">내 할 일</h3>
            {next && (next.dueNow.length || next.blocked.length) ? (
              <div className="space-y-2">
                {next.blocked.map((s) => (
                  <div key={s.key} className="rounded-xl border border-red-200 bg-red-50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-red-700">🔒 {s.title}</span>
                      <span className="text-xs text-red-600">게이트 {s.gateStatus.done}/{s.gateStatus.total}</span>
                    </div>
                    <p className="text-sm text-red-600 mt-1">{s.gateStatus.detail ?? '질관리 체크 미충족 — 통과 전 진행 불가'}</p>
                  </div>
                ))}
                {next.dueNow.map((s) => (
                  <div key={s.key} className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-blue-800">▶ {s.title}</span>
                      {s.gate && <span className="text-xs text-blue-600">게이트 {s.gateStatus.done}/{s.gateStatus.total}</span>}
                    </div>
                    <button onClick={() => complete(s.key)} disabled={busy === s.key} className="mt-2 min-h-[44px] px-4 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-40">
                      {busy === s.key ? '처리 중…' : s.gate ? '게이트 통과·완료' : '완료·다음 진행'}
                    </button>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-gray-400">지금 내 역할의 할 일이 없습니다.</p>}
            {next?.upcoming?.length ? <p className="mt-2 text-xs text-gray-400">다음: {next.upcoming.map((s) => s.title).join(' · ')}</p> : null}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <h3 className="text-base font-bold text-gray-800 mb-2">진행 단계</h3>
            <ol className="space-y-1.5">
              {(board?.steps ?? []).map((s) => (
                <li key={s.key} className={`flex items-center justify-between rounded-xl px-3 py-2 ${board?.currentStepKey === s.key ? 'bg-blue-50' : ''}`}>
                  <span className="text-base text-gray-800">{s.title}{s.gate ? ' 🔒' : ''}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATE_BADGE[s.state] ?? 'bg-gray-100'}`}>
                    {s.state === 'DONE' ? '완료' : s.state === 'IN_PROGRESS' ? '진행중' : s.gate && !s.gateStatus.passed && board?.currentStepKey === s.key ? `차단 ${s.gateStatus.done}/${s.gateStatus.total}` : '대기'}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-2 mb-2 text-sm font-semibold text-gray-600">차트 참조</div>
          {board?.patientId && <TabletSummary patientId={board.patientId} />}
        </section>
      </div>
    </div>
  );
}
