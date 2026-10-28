'use client';

// 응급 접근(Break-glass) 사후 검토 — R2 (gap-remediation R2)
// 🔴 이 화면의 대상은 **로그인 응급접근**(authEmergencyAccess: 인증불가 직원에게 책임자가
//    시간제한 토큰을 부여)이다. 환자 차트 응급열람(BreakTheGlassAccess)과는 별개 원장 —
//    혼동하면 "검토 완료"가 다른 사건에 찍힌다.
// 서버 계약: GET /api/v1/admin/break-glass (ADMIN·최근 100건 절단) →
//   { id, staff, role, reason, approvalKind, approvers, scope, grantedAt, expiresAt, reviewed }
// POST :id/review 는 검토자·시각만 기록한다(소견 필드 없음 — 화면이 그 한계를 밝힌다).

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { EmptyState, KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface BtgRecord {
  id: string;
  staff: string;
  role: string;
  reason: string;
  approvalKind: 'SUPERVISOR' | 'TWO_PERSON' | string;
  approvers: string[];
  scope: string;
  grantedAt: string;
  expiresAt: string;
  reviewed: boolean;
}

const APPROVAL_KIND_LABEL: Record<string, string> = {
  SUPERVISOR: '책임자 1인',
  TWO_PERSON: '2인 승인',
};

export default function BreakGlassReviewPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [confirmTarget, setConfirmTarget] = useState<BtgRecord | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-break-glass'],
    queryFn: () => apiClient.get<{ data: BtgRecord[] }>('/api/v1/admin/break-glass'),
  });
  const rows: BtgRecord[] = (() => {
    const d = data?.data as unknown;
    return Array.isArray(d) ? (d as BtgRecord[]) : ((d as { data?: BtgRecord[] } | undefined)?.data ?? []);
  })();

  const review = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/admin/break-glass/${id}/review`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-break-glass'] });
      setConfirmTarget(null);
      toast.success('검토 완료로 기록했습니다(검토자·시각)');
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '검토 기록 실패'),
  });

  const pending = rows.filter((r) => !r.reviewed);
  const done = rows.filter((r) => r.reviewed);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900"><T k="응급 접근(Break-glass) 사후 검토" /></h1>
        <p className="mt-1 text-sm text-gray-500">
          <T k="인증불가 상황에서 책임자 승인으로 발급된" /> <b><T k="로그인 임시 접근" /></b><T k="(시간제한 토큰)의 의무 사후 검토. 환자 차트 응급열람과는 별개 원장입니다. 목록은" /> <b><T k="최근 100건" /></b><T k="까지만 표시됩니다." />
        </p>
      </div>

      {isError ? (
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="py-10 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
      ) : (
        <>
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-gray-900">
              <T k="미검토" />
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${pending.length > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                {pending.length}건
              </span>
            </h2>
            {pending.length === 0 ? (
              <EmptyState compact title="미검토 발급 건이 없습니다" hint="최근 100건 범위 안에서 0건입니다 — 그 이전 기록은 이 목록에 없습니다." />
            ) : (
              <div className="space-y-2">
                {pending.map((r) => (
                  <RecordCard key={r.id} r={r}>
                    <button
                      type="button"
                      onClick={() => setConfirmTarget(r)}
                      className="min-h-[44px] shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      <T k="검토 완료" />
                    </button>
                  </RecordCard>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-gray-700"><T k="검토 완료" /> ({done.length}건)</h2>
            {done.length === 0 ? (
              <EmptyState compact title="검토 완료 건이 없습니다" />
            ) : (
              <div className="space-y-2 opacity-70">
                {done.map((r) => (
                  <RecordCard key={r.id} r={r}>
                    <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700"><T k="검토됨" /></span>
                  </RecordCard>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold text-gray-900"><T k="검토 완료로 기록할까요?" /></h3>
            <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
              <div><b>{confirmTarget.staff}</b> ({confirmTarget.role})</div>
              <div className="mt-1 text-gray-600"><T k="사유:" /> {confirmTarget.reason}</div>
              <div className="mt-1 text-xs text-gray-500">
                <T k="발급@BTG" /> <KDate value={confirmTarget.grantedAt} mode="datetime" /> · <T k="만료" /> <KDate value={confirmTarget.expiresAt} mode="datetime" />
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              <T k="서버에는" /> <b><T k="검토자와 검토 시각만" /></b> <T k="남습니다(소견 저장 없음). 조치가 필요한 건은 감사 로그·보안 절차로 별도 처리하십시오." />
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <T k="취소" />
              </button>
              <button
                type="button"
                disabled={review.isPending}
                onClick={() => review.mutate(confirmTarget.id)}
                className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {review.isPending ? <T k="기록 중…" /> : <T k="검토 완료 기록" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordCard({ r, children }: { r: BtgRecord; children: React.ReactNode }) {
  const tAttr = useTAttr();
  const expired = new Date(r.expiresAt).getTime() < Date.now();
  return (
    <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-900">{r.staff}</span>
          <span className="text-xs text-gray-500">{r.role}</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            <T k={APPROVAL_KIND_LABEL[r.approvalKind] ?? r.approvalKind} /> · <T k="승인자" /> {r.approvers.length}인
          </span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"><T k="범위" /> {r.scope}</span>
          {expired ? (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500"><T k="만료됨" /></span>
          ) : (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700"><T k="유효 중" /></span>
          )}
        </div>
        <div className="mt-1 truncate text-sm text-gray-700" title={r.reason}><T k="사유:" /> {r.reason}</div>
        <div className="mt-0.5 text-xs text-gray-500">
          <T k="발급@BTG" /> <KDate value={r.grantedAt} mode="datetime" /> · <T k="만료" /> <KDate value={r.expiresAt} mode="datetime" />
        </div>
      </div>
      {children}
    </div>
  );
}
