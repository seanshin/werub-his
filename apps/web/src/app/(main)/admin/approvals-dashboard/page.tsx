'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T } from '@/components/ui/i18n-text';

interface CategoryStat {
  category: string;
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  other: number;
  byDocType: Record<string, number>;
}
interface DashboardData {
  categories: CategoryStat[];
  preAuth: { byType: Record<string, Record<string, number>>; postFactoPending: number };
  period: { from: string | null; to: string | null };
}

const CAT_LABEL: Record<string, string> = { HR: '인사·근태', CLINICAL_RECORD: '임상 기록지', PRE_AUTH: '사전승인' };
const CAT_COLOR: Record<string, string> = { HR: 'border-slate-300', CLINICAL_RECORD: 'border-blue-300', PRE_AUTH: 'border-amber-300' };
const DOCTYPE_LABEL: Record<string, string> = {
  HR_LEAVE: '휴가', HR_LEAVE_CANCEL: '휴가취소', HR_ATTENDANCE_CORRECTION: '근태정정', HR_OVERTIME: '초과근무',
  CLINICAL_CERTIFICATE: '증명서', CONSENT_DOCTOR_SIGN: '동의서', CLINICAL_NOTE_COSIGN: '간호기록 공동서명', MEDICAL_RECORD_COPY_APPROVAL: '의무기록 사본',
  PRE_AUTH: '사전승인',
};
const PREAUTH_TYPE_LABEL: Record<string, string> = {
  NARCOTIC_RX: '마약류 처방', HIGH_COST_IMAGING: '고가·특수 검사', TRANSFUSION: '수혈', CHEMO_REGIMEN: '항암 레지멘',
  PORTAL_REFILL: '재처방(환자신청)', PORTAL_TEST: '검사(환자신청)', PORTAL_REFERRAL: '진료의뢰(환자신청)', PORTAL_CONSULT: '시술상담(환자신청)',
};

export default function ApprovalsDashboardPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['approvals-dashboard', from, to],
    queryFn: () => apiClient.get<{ data: DashboardData }>(`/api/v1/ess/approvals/dashboard${qs.toString() ? `?${qs}` : ''}`),
  });

  if (error) return <QueryErrorFallback error={error as Error} onRetry={() => refetch()} />;
  const d = ((data as { data?: DashboardData })?.data ?? data) as DashboardData | undefined;
  const categories = d?.categories ?? [];
  const preAuth = d?.preAuth ?? { byType: {}, postFactoPending: 0 };

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold"><T k="결재 관리 대시보드" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="전자결재 카테고리(인사·기록지·사전승인)별 현황" /></p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1" />
          <span>~</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1" />
        </div>
      </div>

      {preAuth.postFactoPending > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          ⚠️ <T k="사전승인" /> <b><T k="사후승인 미결" /> {preAuth.postFactoPending}<Unit>건</Unit></b> — <T k="응급/우회 발행 후 소급 결재가 필요한 건이 있습니다." />
        </div>
      )}

      {isLoading ? (
        <div className="text-gray-400 text-sm"><T k="불러오는 중…" /></div>
      ) : (
        <>
          {/* 카테고리 카드 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {categories.map((c) => (
              <div key={c.category} className={`bg-white rounded-xl border-2 ${CAT_COLOR[c.category] ?? 'border-gray-200'} p-4`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold"><T k={CAT_LABEL[c.category] ?? c.category} /></span>
                  <span className="text-2xl font-bold">{c.total}</span>
                </div>
                <div className="mt-3 flex gap-3 text-xs">
                  <span className="text-blue-600"><T k="진행" /> {c.pending}</span>
                  <span className="text-green-600"><T k="승인" /> {c.approved}</span>
                  <span className="text-red-600"><T k="반려" /> {c.rejected}</span>
                  {c.other > 0 && <span className="text-gray-400"><T k="기타" /> {c.other}</span>}
                </div>
                <div className="mt-3 space-y-1 border-t pt-2">
                  {Object.entries(c.byDocType).map(([dt, n]) => (
                    <div key={dt} className="flex justify-between text-xs text-gray-600">
                      <span><T k={DOCTYPE_LABEL[dt] ?? dt} /></span>
                      <span>{n}</span>
                    </div>
                  ))}
                  {Object.keys(c.byDocType).length === 0 && <div className="text-xs text-gray-300"><T k="건수 없음" /></div>}
                </div>
              </div>
            ))}
          </div>

          {/* 사전승인 유형별 세부 */}
          <div className="bg-white rounded-xl border p-4">
            <h2 className="font-semibold text-sm mb-3"><T k="사전승인 유형별 현황" /></h2>
            {Object.keys(preAuth.byType).length === 0 ? (
              <div className="text-xs text-gray-300"><T k="데이터 없음" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
                      <th className="py-1.5 pr-4"><T k="유형" /></th>
                      <th className="py-1.5 px-2"><T k="진행/승인" /></th>
                      <th className="py-1.5 px-2"><T k="발행완료" /></th>
                      <th className="py-1.5 px-2"><T k="반려" /></th>
                      <th className="py-1.5 px-2"><T k="사후미결" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(preAuth.byType).map(([type, st]) => (
                      <tr key={type} className="border-b last:border-0">
                        <td className="py-1.5 pr-4"><T k={PREAUTH_TYPE_LABEL[type] ?? type} /></td>
                        <td className="py-1.5 px-2">{(st.PENDING ?? 0) + (st.PROCESSING ?? 0) + (st.APPROVED ?? 0)}</td>
                        <td className="py-1.5 px-2">{st.FULFILLED ?? 0}</td>
                        <td className="py-1.5 px-2">{st.REJECTED ?? 0}</td>
                        <td className="py-1.5 px-2 text-red-600">{st.POST_FACTO_PENDING ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
