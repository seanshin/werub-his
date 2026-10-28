'use client';

// 법적 보존명령(legal hold) 관제 — 상용 릴리즈 T10-7 (2026-09-13 · API `/api/v1/legal-holds` 첫 소비처)
// 🔴 정직 표기 원칙:
//   - 보존명령은 **막는 표시**다 — 설정은 1인, 해제는 4-eyes(요청자·설정자와 다른 사람이 승인).
//   - 활성 여부는 서버가 **해제 기록 유무로 파생**한 `active` 를 그대로 쓴다(화면이 따로 판정하지 않는다).
//   - 🔴 조회 실패는 "보존명령 0건"이 아니다 — 실패로 그린다. 보존명령이 없는 것과 모르는 것은 다른 사실이다.
//   - 🔴 이 화면이 파기를 막는 것은 아니다 — 파기·아카이브 경로가 `isHeld()` 를 부르게 연결돼야 막힌다(연결 전이면 그 사실을 말한다).

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { EmptyState, KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface HoldRelease {
  id: string;
  reason: string;
  requestedBy: string;
  approvedBy: string;
  releasedBy: string;
  releasedAt: string;
}

interface HoldRow {
  id: string;
  patientId: string;
  scope: string;
  reason: string;
  basis: string | null;
  setBy: string;
  setAt: string;
  active: boolean;
  release: HoldRelease | null;
}

interface ApprovalRow {
  id: string;
  targetId: string;
  requestedBy: string;
  reason?: string | null;
  requestedAt: string;
  expiresAt: string;
  status: string;
  payload?: { patientId?: string } | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function LegalHoldPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState('');
  const [reason, setReason] = useState('');
  const [basis, setBasis] = useState('');
  const [releaseTarget, setReleaseTarget] = useState<HoldRow | null>(null);
  const [releaseReason, setReleaseReason] = useState('');

  const holdsQ = useQuery({
    queryKey: ['legal-holds'],
    queryFn: () => apiClient.get<{ data: HoldRow[] }>('/api/v1/legal-holds'),
  });
  const holds = (holdsQ.data?.data ?? []) as HoldRow[];
  const active = holds.filter((h) => h.active);
  const released = holds.filter((h) => !h.active);

  const approvalsQ = useQuery({
    queryKey: ['legal-hold-approvals'],
    queryFn: () => apiClient.get<{ data: ApprovalRow[] }>('/api/v1/legal-holds/approvals'),
  });
  const approvals = (approvalsQ.data?.data ?? []) as ApprovalRow[];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['legal-holds'] });
    qc.invalidateQueries({ queryKey: ['legal-hold-approvals'] });
  };

  const setMut = useMutation({
    mutationFn: () =>
      apiClient.post(`/api/v1/legal-holds/patients/${patientId.trim()}`, { reason: reason.trim(), basis: basis.trim() || undefined }),
    onSuccess: () => {
      toast.success(tAttr('보존명령을 설정했습니다'));
      setPatientId('');
      setReason('');
      setBasis('');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message || tAttr('보존명령 설정에 실패했습니다')),
  });

  const requestMut = useMutation({
    mutationFn: (h: HoldRow) =>
      apiClient.post(`/api/v1/legal-holds/${h.id}/patients/${h.patientId}/release-request`, { reason: releaseReason.trim() }),
    onSuccess: () => {
      toast.success(tAttr('해제 요청을 올렸습니다 — 다른 사람의 승인이 필요합니다'));
      setReleaseTarget(null);
      setReleaseReason('');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message || tAttr('해제 요청에 실패했습니다')),
  });

  const approveMut = useMutation({
    mutationFn: (a: ApprovalRow) => {
      const hold = holds.find((h) => h.id === a.targetId);
      const pid = hold?.patientId ?? a.payload?.patientId;
      if (!pid) throw new Error(tAttr('승인 대상 보존명령의 환자를 확인할 수 없습니다'));
      return apiClient.post(`/api/v1/legal-holds/approvals/${a.id}/patients/${pid}/approve`, {});
    },
    onSuccess: () => {
      toast.success(tAttr('해제를 승인했습니다'));
      refresh();
    },
    onError: (e: Error) => toast.error(e.message || tAttr('해제 승인에 실패했습니다')),
  });

  const releaseMut = useMutation({
    mutationFn: (h: HoldRow) => apiClient.post(`/api/v1/legal-holds/${h.id}/patients/${h.patientId}/release`, {}),
    onSuccess: () => {
      toast.success(tAttr('보존명령을 해제했습니다'));
      refresh();
    },
    onError: (e: Error) => toast.error(e.message || tAttr('해제 실행에 실패했습니다')),
  });

  const canSet = UUID.test(patientId.trim()) && reason.trim().length > 0 && !setMut.isPending;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900"><T k="법적 보존명령" /></h1>
        <p className="mt-1 text-sm text-gray-500">
          <T k="소송·분쟁·수사로 보존해야 하는 환자 기록의 파기·익명화·아카이브 이동을 막습니다. 설정은 1인, 해제는 다른 사람의 승인이 필요합니다." />
        </p>
      </div>

      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
        <T k="이 표시가 실제로 파기를 막으려면 파기·아카이브 경로가 보존명령을 확인해야 합니다. 그 연결 상태는 보유·파기 관제에서 확인하세요." />
      </p>

      {/* 설정 */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-bold text-gray-700"><T k="보존명령 설정" /></h2>
        <div className="grid gap-2 md:grid-cols-3">
          <input
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            placeholder={tAttr('환자 ID(UUID)')}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={tAttr('사유(필수)')}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder={tAttr('근거(사건번호·요청 기관 등 · 선택)')}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="button"
          disabled={!canSet}
          onClick={() => setMut.mutate()}
          className="mt-3 min-h-[44px] rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          <T k="보존명령 설정" />
        </button>
      </section>

      {/* 활성 */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-bold text-gray-700"><T k="활성 보존명령" /></h2>
        {holdsQ.isError ? (
          <QueryErrorFallback error={holdsQ.error} onRetry={() => holdsQ.refetch()} />
        ) : holdsQ.isLoading ? (
          <p className="py-6 text-center text-sm text-gray-400"><T k="불러오는 중…" /></p>
        ) : active.length === 0 ? (
          <EmptyState icon="🔓" title="활성 보존명령이 없습니다" compact />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[11px] text-gray-400">
                <th className="px-2 py-2 font-medium"><T k="환자 ID" /></th>
                <th className="px-2 py-2 font-medium"><T k="사유" /></th>
                <th className="px-2 py-2 font-medium"><T k="근거" /></th>
                <th className="px-2 py-2 font-medium"><T k="설정 시각" /></th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {active.map((h) => {
                const pending = approvals.find((a) => a.targetId === h.id);
                return (
                  <tr key={h.id} className="border-b border-gray-50">
                    <td className="px-2 py-2 font-mono text-[11px] text-gray-600">{h.patientId}</td>
                    <td className="px-2 py-2 text-gray-800">{h.reason}</td>
                    <td className="px-2 py-2 text-gray-500">{h.basis ?? '-'}</td>
                    <td className="px-2 py-2 text-gray-500"><KDate value={h.setAt} mode="datetime" /></td>
                    <td className="px-2 py-2 text-right">
                      {pending ? (
                        <span className="text-xs text-amber-700"><T k="해제 승인 대기" /></span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setReleaseTarget(h); setReleaseReason(''); }}
                          className="min-h-[44px] rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700"
                        >
                          <T k="해제 요청" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* 해제 요청 입력 */}
      {releaseTarget && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
          <h2 className="mb-2 text-sm font-bold text-amber-800"><T k="보존명령 해제 요청" /></h2>
          <p className="mb-2 font-mono text-[11px] text-gray-600">{releaseTarget.patientId}</p>
          <textarea
            value={releaseReason}
            onChange={(e) => setReleaseReason(e.target.value)}
            placeholder={tAttr('해제 사유(필수 · 5자 이상)')}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            rows={2}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={releaseReason.trim().length < 5 || requestMut.isPending}
              onClick={() => requestMut.mutate(releaseTarget)}
              className="min-h-[44px] rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              <T k="해제 요청 올리기" />
            </button>
            <button type="button" onClick={() => setReleaseTarget(null)} className="min-h-[44px] rounded-lg border border-gray-200 px-4 py-2 text-sm">
              <T k="취소" />
            </button>
          </div>
        </section>
      )}

      {/* 승인 대기 */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-bold text-gray-700"><T k="해제 승인 대기" /></h2>
        {approvalsQ.isError ? (
          <QueryErrorFallback error={approvalsQ.error} onRetry={() => approvalsQ.refetch()} />
        ) : approvalsQ.isLoading ? (
          <p className="py-6 text-center text-sm text-gray-400"><T k="불러오는 중…" /></p>
        ) : approvals.length === 0 ? (
          <EmptyState icon="✅" title="승인 대기 중인 해제 요청이 없습니다" compact />
        ) : (
          <ul className="space-y-2">
            {approvals.map((a) => {
              const hold = holds.find((h) => h.id === a.targetId);
              const approved = hold && !hold.active;
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm">
                  <div>
                    <p className="text-gray-800">{a.reason ?? '-'}</p>
                    <p className="text-[11px] text-gray-400"><KDate value={a.requestedAt} mode="datetime" /></p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={approveMut.isPending || approved}
                      onClick={() => approveMut.mutate(a)}
                      className="min-h-[44px] rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      <T k="해제 승인" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-gray-400">
          <T k="요청한 사람과 보존명령을 건 사람은 승인할 수 없습니다. 승인 후 해제 실행은 활성 목록에서 합니다." />
        </p>
      </section>

      {/* 승인됐고 실행 대기인 건 — 활성 목록 아래에 실행 버튼 */}
      {active.length > 0 && (
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-gray-700"><T k="해제 실행" /></h2>
          <p className="mb-2 text-[11px] text-gray-400"><T k="승인이 끝난 해제만 실행됩니다. 승인이 없으면 서버가 거부합니다." /></p>
          <div className="flex flex-wrap gap-2">
            {active.map((h) => (
              <button
                key={h.id}
                type="button"
                disabled={releaseMut.isPending}
                onClick={() => releaseMut.mutate(h)}
                className="min-h-[44px] rounded-lg border border-gray-200 px-3 py-1.5 font-mono text-[11px] text-gray-700"
              >
                {h.patientId.slice(0, 8)}… <T k="해제 실행" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 이력 */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-bold text-gray-700"><T k="해제 이력" /></h2>
        {holdsQ.isError ? null : released.length === 0 ? (
          <EmptyState icon="📜" title="해제된 보존명령이 없습니다" compact />
        ) : (
          <ul className="space-y-1 text-sm">
            {released.map((h) => (
              <li key={h.id} className="rounded-lg border border-gray-100 px-3 py-2">
                <span className="font-mono text-[11px] text-gray-500">{h.patientId}</span>
                <span className="ml-2 text-gray-700">{h.release?.reason}</span>
                <span className="ml-2 text-[11px] text-gray-400">{h.release ? <KDate value={h.release.releasedAt} mode="datetime" /> : '-'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
