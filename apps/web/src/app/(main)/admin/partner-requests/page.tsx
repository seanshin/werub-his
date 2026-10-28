'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

interface PartnerRequest {
  id: string;
  orgName: string;
  orgType: string;
  country: string;
  contactName: string;
  contactEmail: string;
  purpose: string[];
  requestedScopes: string[];
  status: string;
  createdAt: string;
  reviewedAt?: string;
  reviewNote?: string;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  PENDING: { label: '대기', color: 'bg-amber-100 text-amber-700' },
  REVIEWING: { label: '심사중', color: 'bg-blue-100 text-blue-700' },
  APPROVED: { label: '승인', color: 'bg-emerald-100 text-emerald-700' },
  REJECTED: { label: '거절', color: 'bg-red-100 text-red-700' },
  SUSPENDED: { label: '일시정지', color: 'bg-gray-100 text-gray-600' },
};

const ORG_TYPE_LABEL: Record<string, string> = {
  HOSPITAL: '병원', CLINIC: '의원', INSURANCE: '보험사', APP_VENDOR: '앱개발사', RESEARCH: '연구기관',
};

type FilterStatus = '' | 'PENDING' | 'REVIEWING' | 'APPROVED' | 'REJECTED';

export default function PartnerRequestsPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterStatus>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['partner-requests', filter],
    queryFn: () => apiClient.get<{ data: PartnerRequest[] }>('/api/v1/admin/partner-requests', filter ? { status: filter } : {}),
  });

  const requests: PartnerRequest[] = (() => {
    const d = data?.data;
    return Array.isArray(d) ? d : (d as any)?.data ?? [];
  })();

  const approve = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/admin/partner-requests/${id}/approve`, { reviewNote }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['partner-requests'] }); toast.success('승인 완료 — SMART Client 발급됨'); setSelectedId(null); },
    onError: () => toast.error('승인 처리 실패'),
  });

  const reject = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/admin/partner-requests/${id}/review`, { status: 'REJECTED', reviewNote }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['partner-requests'] }); toast.success('거절 처리됨'); setSelectedId(null); },
    onError: () => toast.error('거절 처리 실패'),
  });

  const counts = {
    total: requests.length,
    pending: requests.filter(r => r.status === 'PENDING').length,
    reviewing: requests.filter(r => r.status === 'REVIEWING').length,
    approved: requests.filter(r => r.status === 'APPROVED').length,
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="연동 신청 관리" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="파트너 병원/보험사/앱 연동 신청을 관리합니다" /></p>
        </div>
      </div>

      {/* Summary Cards — 🔴 조회 실패에 0 을 그리면 "신청 없음"으로 읽힌다 */}
      {!isError && <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-gray-900">{counts.total}</div>
          <div className="text-[10px] text-gray-500"><T k="전체" /></div>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-3 text-center">
          <div className="text-lg font-bold text-amber-600">{counts.pending}</div>
          <div className="text-[10px] text-amber-600"><T k="대기" /></div>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-3 text-center">
          <div className="text-lg font-bold text-blue-600">{counts.reviewing}</div>
          <div className="text-[10px] text-blue-600"><T k="심사중" /></div>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-3 text-center">
          <div className="text-lg font-bold text-emerald-600">{counts.approved}</div>
          <div className="text-[10px] text-emerald-600"><T k="승인" /></div>
        </div>
      </div>}

      {/* Filter */}
      <div className="flex gap-1.5">
        {([
          { k: '' as FilterStatus, l: '전체' },
          { k: 'PENDING' as FilterStatus, l: '대기' },
          { k: 'REVIEWING' as FilterStatus, l: '심사중' },
          { k: 'APPROVED' as FilterStatus, l: '승인' },
          { k: 'REJECTED' as FilterStatus, l: '거절' },
        ]).map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              filter === f.k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}><T k={f.l} /></button>
        ))}
      </div>

      {/* Table */}
      {isError ? (
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="py-12 text-center text-gray-400 animate-pulse"><T k="로딩 중..." /></div>
      ) : requests.length === 0 ? (
        <EmptyState icon="📝" title="신청 내역이 없습니다" />
      ) : (
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="기관명" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="국가" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="목적" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="신청일" /></th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="조치" /></th>
              </tr>
            </thead>
            <tbody>
              {requests.map(r => {
                const st = STATUS_MAP[r.status] ?? STATUS_MAP.PENDING;
                return (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{r.orgName}</div>
                      <div className="text-[10px] text-gray-400">{r.contactEmail}</div>
                    </td>
                    <td className="px-4 py-3 text-xs"><T k={ORG_TYPE_LABEL[r.orgType] ?? r.orgType} /></td>
                    <td className="px-4 py-3 text-xs">{r.country}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(r.purpose ?? []).map(p => (
                          <span key={p} className="text-[9px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{p}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${st.color}`}><T k={st.label} /></span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{r.createdAt?.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-center">
                      {r.status === 'PENDING' || r.status === 'REVIEWING' ? (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => { setSelectedId(r.id); setReviewNote(''); }}
                            className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-[10px] font-medium hover:bg-emerald-200"><T k="심사" /></button>
                        </div>
                      ) : r.status === 'APPROVED' ? (
                        <Link href={`/admin/partner-monitoring/${r.id}`} className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-[10px] font-medium hover:bg-blue-100"><T k="모니터링" /></Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Review Modal */}
      {selectedId && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setSelectedId(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4"><T k="연동 신청 심사" /></h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="심사 의견" /></label>
                <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)}
                  rows={3} placeholder={tAttr('심사 의견을 입력하세요...')}
                  className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setSelectedId(null)} className="flex-1 py-2 bg-gray-100 rounded-xl text-sm"><T k="취소" /></button>
                <button onClick={() => reject.mutate(selectedId)} className="flex-1 py-2 bg-red-100 text-red-700 rounded-xl text-sm font-medium"><T k="거절" /></button>
                <button onClick={() => approve.mutate(selectedId)} className="flex-1 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium"><T k="승인 + 발급" /></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
