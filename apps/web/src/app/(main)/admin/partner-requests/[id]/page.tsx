'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T } from '@/components/ui/i18n-text';

interface PartnerRequest {
  id: string;
  orgName: string;
  orgType: string;
  orgCode?: string;
  country: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  techContactName?: string;
  techContactEmail?: string;
  fhirBaseUrl?: string;
  purpose: string[];
  requestedScopes: string[];
  status: string;
  reviewNote?: string;
  createdAt: string;
  reviewedAt?: string;
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700', REVIEWING: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-emerald-100 text-emerald-700', REJECTED: 'bg-red-100 text-red-700', SUSPENDED: 'bg-gray-100 text-gray-500',
};

export default function PartnerRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['partner-request', id],
    queryFn: () => apiClient.get<{ data: PartnerRequest }>(`/api/v1/admin/partner-requests/${id}`),
    enabled: !!id,
  });
  const req: PartnerRequest | null = (data as any)?.data?.data ?? (data as any)?.data ?? null;

  const approve = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/admin/partner-requests/${id}/approve`),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['partner-request', id] });
      const secret = res?.data?.data?.smartClient?.clientSecret;
      toast.success(`승인 완료!${secret ? ` Secret: ${secret.slice(0, 8)}...` : ''}`);
    },
    onError: () => toast.error('승인 실패'),
  });

  const review = useMutation({
    mutationFn: (status: string) => apiClient.patch(`/api/v1/admin/partner-requests/${id}/review`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['partner-request', id] }); toast.success('상태 변경 완료'); },
  });

  const testConn = useMutation({
    mutationFn: () => apiClient.get(`/api/v1/admin/partner-requests/${id}/test`),
    onSuccess: (res: any) => {
      const r = res?.data?.data ?? res?.data;
      toast.success(r?.success ? `연결 성공 (FHIR ${r.fhirVersion ?? ''})` : `연결 실패: ${r?.error ?? ''}`);
    },
    onError: () => toast.error('테스트 실패'),
  });

  if (isLoading) return <div className="py-12 text-center text-gray-400 animate-pulse"><T k="로딩 중..." /></div>;
  if (!req) return <div className="py-12 text-center text-gray-400"><T k="신청을 찾을 수 없습니다" /></div>;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="파트너 신청 상세" /></h1>
          <p className="text-sm text-gray-500 mt-0.5">{req.orgName}</p>
        </div>
        <Link href="/admin/partner-requests" className="text-sm text-blue-600 hover:underline">&larr; <T k="목록" /></Link>
      </div>

      {/* Status */}
      <div className="flex items-center gap-3">
        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${STATUS_STYLE[req.status] ?? 'bg-gray-100'}`}>{req.status}</span>
        <span className="text-xs text-gray-400"><T k="신청" />: {req.createdAt?.slice(0, 10)}</span>
        {req.reviewedAt && <span className="text-xs text-gray-400"><T k="검토" />: {req.reviewedAt?.slice(0, 10)}</span>}
      </div>

      {/* 기관 정보 */}
      <div className="bg-white rounded-2xl border shadow-sm p-5 space-y-3">
        <h3 className="text-sm font-bold text-gray-900"><T k="기관 정보" /></h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-gray-500"><T k="기관명" /></span><div className="font-medium mt-0.5">{req.orgName}</div></div>
          <div><span className="text-gray-500"><T k="유형" /></span><div className="font-medium mt-0.5">{req.orgType}</div></div>
          <div><span className="text-gray-500"><T k="국가" /></span><div className="font-medium mt-0.5">{req.country}</div></div>
          <div><span className="text-gray-500"><T k="기관코드" /></span><div className="font-medium mt-0.5 font-mono">{req.orgCode ?? '-'}</div></div>
        </div>
        {req.fhirBaseUrl && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-mono truncate">{req.fhirBaseUrl}</span>
            <button onClick={() => testConn.mutate()} disabled={testConn.isPending} className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded font-medium">
              <T k={testConn.isPending ? '테스트 중...' : '연결 테스트'} />
            </button>
          </div>
        )}
      </div>

      {/* 담당자 */}
      <div className="bg-white rounded-2xl border shadow-sm p-5 space-y-3">
        <h3 className="text-sm font-bold text-gray-900"><T k="담당자" /></h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-gray-500"><T k="이름@성명" /></span><div className="font-medium mt-0.5">{req.contactName}</div></div>
          <div><span className="text-gray-500"><T k="이메일" /></span><div className="font-medium mt-0.5">{req.contactEmail}</div></div>
          {req.techContactName && <div><span className="text-gray-500"><T k="기술 담당" /></span><div className="font-medium mt-0.5">{req.techContactName}</div></div>}
          {req.techContactEmail && <div><span className="text-gray-500"><T k="기술 이메일" /></span><div className="font-medium mt-0.5">{req.techContactEmail}</div></div>}
        </div>
      </div>

      {/* 연동 정보 */}
      <div className="bg-white rounded-2xl border shadow-sm p-5 space-y-3">
        <h3 className="text-sm font-bold text-gray-900"><T k="연동 정보" /></h3>
        <div>
          <span className="text-xs text-gray-500"><T k="연동 목적" /></span>
          <div className="flex gap-1.5 mt-1">{(req.purpose ?? []).map(p => <span key={p} className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">{p}</span>)}</div>
        </div>
        <div>
          <span className="text-xs text-gray-500"><T k="요청 Scope" /></span>
          <div className="flex flex-wrap gap-1.5 mt-1">{(req.requestedScopes ?? []).map(s => <span key={s} className="text-[9px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-mono">{s}</span>)}</div>
        </div>
        {req.reviewNote && (
          <div className="bg-gray-50 rounded-xl p-3"><span className="text-xs text-gray-500"><T k="검토 메모" />: </span><span className="text-sm">{req.reviewNote}</span></div>
        )}
      </div>

      {/* Actions */}
      {req.status !== 'APPROVED' && req.status !== 'REJECTED' && (
        <div className="flex gap-3">
          <button onClick={() => review.mutate('REJECTED')} className="flex-1 py-2.5 bg-red-50 text-red-600 rounded-xl text-sm font-medium"><T k="거절" /></button>
          <button onClick={() => review.mutate('REVIEWING')} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium"><T k="검토중" /></button>
          <button onClick={() => approve.mutate()} disabled={approve.isPending} className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium">
            <T k={approve.isPending ? '처리 중...' : '승인 + 클라이언트 발급'} />
          </button>
        </div>
      )}
    </div>
  );
}
