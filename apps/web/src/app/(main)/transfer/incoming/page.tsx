'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

import { EmptyState } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

interface Transfer {
  id: string;
  patient?: { familyName: string; givenName: string; mrn: string };
  fromOrg?: { name: string; code: string };
  transferType: string;
  status: string;
  urgency: string;
  reason: string;
  clinicalSummary?: string;
  requestedAt: string;
}

const URGENCY_STYLE: Record<string, string> = {
  EMERGENT: 'bg-red-600 text-white',
  URGENT: 'bg-orange-100 text-orange-700',
  ROUTINE: 'bg-gray-100 text-gray-600',
};

export default function TransferIncomingPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['transfers-incoming'],
    queryFn: () => apiClient.get<{ data: Transfer[] }>('/api/v1/transfer/incoming'),
  });
  const transfers: Transfer[] = (() => { const d = data?.data; return Array.isArray(d) ? d : (d as any)?.data ?? []; })();

  const accept = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/transfer/${id}/accept`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transfers-incoming'] }); toast.success(tAttr('전원 수락 완료')); },
    onError: () => toast.error(tAttr('수락 실패')),
  });

  // 🔴 사유를 하드코딩해 **모든 거절이 영원히 같은 한 문장**이었다 — 송신 병원은 병상 부족인지
  //    진료과 부재인지 알 수 없었다(2026-08-13 W6). 거절은 사유를 받는다.
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.patch(`/api/v1/transfer/${id}/reject`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transfers-incoming'] }); toast.success(tAttr('전원 거절 완료')); },
    onError: () => toast.error(tAttr('거절 실패')),
  });

  const pending = transfers.filter(t => t.status === 'REQUESTED');
  const accepted = transfers.filter(t => t.status !== 'REQUESTED');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="수신 전원" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="타 병원에서 전원된 환자를 수락하거나 거절합니다" /></p>
        </div>
        <Link href="/transfer" className="text-sm text-blue-600 hover:underline">&larr; <T k="대시보드" /></Link>
      </div>

      {isError ? (
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="py-12 text-center text-gray-400 animate-pulse"><T k="로딩 중..." /></div>
      ) : transfers.length === 0 ? (
        <EmptyState icon="📋" title="수신된 전원 요청이 없습니다" />
      ) : (
        <div className="space-y-6">
          {/* 수락 대기 */}
          {pending.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-amber-700 mb-3"><Tf k="수락 대기 ({건수})" params={{ 건수: pending.length }} /></h2>
              <div className="space-y-3">
                {pending.map(t => (
                  <div key={t.id} className="bg-white rounded-2xl border-2 border-amber-200 shadow-sm p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-900">{t.patient ? `${t.patient.familyName}${t.patient.givenName}` : <T k="미확인" />}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${URGENCY_STYLE[t.urgency] ?? 'bg-gray-100'}`}>
                            <T k={t.urgency === 'EMERGENT' ? '응급' : t.urgency === 'URGENT' ? '긴급' : '일반'} />
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          <Tf k="송신: {기관}" params={{ 기관: t.fromOrg?.name ?? tAttr('알 수 없음') }} /> | {t.requestedAt?.slice(0, 16).replace('T', ' ')}
                        </div>
                      </div>
                      <Link href={`/transfer/${t.id}`} className="text-xs text-blue-600 hover:underline"><T k="상세" /></Link>
                    </div>

                    <div className="bg-gray-50 rounded-xl p-3 mb-3">
                      <div className="text-xs font-medium text-gray-700 mb-1"><T k="전원 사유" /></div>
                      <p className="text-sm text-gray-600">{t.reason}</p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => (() => { const r = window.prompt(tAttr('전원 거절 사유를 입력하세요 (송신 병원에 전달됩니다)')); if (r?.trim()) reject.mutate({ id: t.id, reason: r.trim() }); })()}
                        disabled={reject.isPending}
                        className="flex-1 py-2.5 bg-red-50 text-red-600 rounded-xl text-sm font-medium hover:bg-red-100"
                      >
                        <T k="거절" />
                      </button>
                      <button
                        onClick={() => accept.mutate(t.id)}
                        disabled={accept.isPending}
                        className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700"
                      >
                        <T k="수락" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 처리된 전원 */}
          {accepted.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 mb-3"><Tf k="처리 완료 ({건수})" params={{ 건수: accepted.length }} /></h2>
              <div className="space-y-2">
                {accepted.map(t => (
                  <Link key={t.id} href={`/transfer/${t.id}`} className="block bg-white rounded-2xl border p-4 hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-gray-900 text-sm">{t.patient ? `${t.patient.familyName}${t.patient.givenName}` : <T k="미확인" />}</span>
                        <span className="ml-2 text-xs text-gray-400">{t.fromOrg?.name}</span>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                        t.status === 'ACCEPTED' ? 'bg-blue-100 text-blue-700' :
                        t.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                        t.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        <T k={t.status === 'ACCEPTED' ? '수락' : t.status === 'COMPLETED' ? '완료' : t.status === 'REJECTED' ? '거절' : t.status} />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
