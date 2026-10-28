'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';

interface Transfer {
  id: string;
  patientId: string;
  patient?: { familyName: string; givenName: string; mrn: string };
  fromOrg?: { name: string; code: string };
  toOrg?: { name: string; code: string };
  transferType: string;
  status: string;
  urgency: string;
  reason: string;
  requestedAt: string;
  completedAt?: string;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  REQUESTED: { label: '요청', color: 'bg-yellow-100 text-yellow-700' },
  ACCEPTED: { label: '수락', color: 'bg-blue-100 text-blue-700' },
  IN_TRANSIT: { label: '이송중', color: 'bg-purple-100 text-purple-700' },
  COMPLETED: { label: '완료', color: 'bg-emerald-100 text-emerald-700' },
  REJECTED: { label: '거절', color: 'bg-red-100 text-red-700' },
  CANCELLED: { label: '취소', color: 'bg-gray-100 text-gray-500' },
};

const URGENCY_MAP: Record<string, { label: string; color: string }> = {
  EMERGENT: { label: '응급', color: 'bg-red-600 text-white' },
  URGENT: { label: '긴급', color: 'bg-orange-100 text-orange-700' },
  ROUTINE: { label: '일반', color: 'bg-gray-100 text-gray-600' },
};

const TYPE_MAP: Record<string, string> = {
  OUTGOING_REFERRAL: '발신',
  INCOMING_REFERRAL: '수신',
  RETURN: '회송',
  CROSS_CONSULT: '교차진료',
};

export default function TransferDashboardPage() {
  // 🔴 종전엔 '발신·수신·진행'을 `?status=OUTGOING|INCOMING|IN_PROGRESS` 로 서버에 보냈다.
  //    실제 status enum 은 REQUESTED/ACCEPTED/IN_TRANSIT/COMPLETED/REJECTED 이고 **발신·수신은
  //    status 가 아니라 transferType 축**이라, 네 탭이 전부 0건이 되고 "전원 기록이 없습니다"라고
  //    말했다(실측: 발신 2·진행 2 실재). 목록은 한 번만 받고 **화면에서 축별로 가른다.**
  const [filter, setFilter] = useState<string>('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['transfers'],
    queryFn: () => apiClient.get<{ data: Transfer[] }>('/api/v1/transfer'),
  });
  const all: Transfer[] = (() => { const d = data?.data; return Array.isArray(d) ? d : (d as any)?.data ?? []; })();
  const IN_PROGRESS_STATUSES = ['REQUESTED', 'ACCEPTED', 'IN_TRANSIT'];
  const transfers: Transfer[] = filter === 'OUTGOING' ? all.filter(t => t.transferType === 'OUTGOING_REFERRAL')
    : filter === 'INCOMING' ? all.filter(t => t.transferType === 'INCOMING_REFERRAL')
    : filter === 'IN_PROGRESS' ? all.filter(t => IN_PROGRESS_STATUSES.includes(t.status))
    : filter === 'COMPLETED' ? all.filter(t => t.status === 'COMPLETED')
    : all;

  // KPI 는 필터와 무관하게 전체 모수에서 센다(종전엔 필터된 목록에서 재계산돼 함께 0이 됐다)
  const outgoing = all.filter(t => t.transferType === 'OUTGOING_REFERRAL').length;
  const incoming = all.filter(t => t.transferType === 'INCOMING_REFERRAL').length;
  const inProgress = all.filter(t => IN_PROGRESS_STATUSES.includes(t.status)).length;
  const completed = all.filter(t => t.status === 'COMPLETED').length;

  const stats = [
    { label: '발신', value: outgoing, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: '수신', value: incoming, color: 'text-violet-600', bg: 'bg-violet-50' },
    { label: '진행중', value: inProgress, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: '완료', value: completed, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  ];

  const filters = [
    { label: '전체', value: '' },
    { label: '발신', value: 'OUTGOING' },
    { label: '수신', value: 'INCOMING' },
    { label: '진행', value: 'IN_PROGRESS' },
    { label: '완료', value: 'COMPLETED' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="전원 관리" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="환자 전원 의뢰/수신 대시보드" /></p>
        </div>
        <Link href="/transfer/request" className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">+ <T k="전원 의뢰" /></Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {stats.map(s => (
          <div key={s.label} className={`${s.bg} rounded-2xl p-4 text-center`}>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5"><T k={s.label} /></div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-1.5">
        {filters.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <T k={f.label} />
          </button>
        ))}
      </div>

      {/* Table — 🔴 조회 실패를 "전원 기록이 없습니다"로 말하지 않는다 */}
      {isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : isLoading ? (
        <div className="py-12 text-center text-gray-400 animate-pulse"><T k="로딩 중..." /></div>
      ) : transfers.length === 0 ? (
        <EmptyState icon="🔄" title="전원 기록이 없습니다" />
      ) : (
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium"><T k="환자" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="유형" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="경로" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="긴급도" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="상태" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="요청일" /></th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {transfers.map(t => {
                const st = STATUS_MAP[t.status] ?? { label: t.status, color: 'bg-gray-100 text-gray-600' };
                const urg = URGENCY_MAP[t.urgency] ?? { label: t.urgency, color: 'bg-gray-100 text-gray-600' };
                return (
                  <tr key={t.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{t.patient ? `${t.patient.familyName}${t.patient.givenName}` : '-'}</div>
                      <div className="text-[10px] text-gray-400">{t.patient?.mrn}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-600"><T k={TYPE_MAP[t.transferType] ?? t.transferType} /></span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-gray-600">
                        {t.fromOrg?.name ?? <T k="우리병원" />} <span className="text-gray-400 mx-0.5">&rarr;</span> {t.toOrg?.name ?? <T k="우리병원" />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${urg.color}`}><T k={urg.label} /></span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${st.color}`}><T k={st.label} /></span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{t.requestedAt?.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/transfer/${t.id}`} className="text-xs text-blue-600 hover:underline"><T k="상세" /></Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/transfer/incoming" className="bg-white rounded-2xl border p-4 hover:shadow-md transition-shadow">
          <div className="font-semibold text-gray-900 text-sm"><T k="수신 전원" /></div>
          <p className="text-xs text-gray-400 mt-1"><T k="타 병원에서 전원된 환자 확인 및 수락" /></p>
        </Link>
        <Link href="/transfer/history" className="bg-white rounded-2xl border p-4 hover:shadow-md transition-shadow">
          <div className="font-semibold text-gray-900 text-sm"><T k="전원 이력" /></div>
          <p className="text-xs text-gray-400 mt-1"><T k="기간별/기관별 전원 통계 및 이력" /></p>
        </Link>
      </div>
    </div>
  );
}
