'use client';

import { useState, useMemo } from 'react';
import { Ratio, Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf } from '@/components/ui/i18n-text';

interface Transfer {
  id: string;
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

const TYPE_LABEL: Record<string, string> = {
  OUTGOING_REFERRAL: '발신',
  INCOMING_REFERRAL: '수신',
  RETURN: '회송',
  CROSS_CONSULT: '교차진료',
};

const STATUS_STYLE: Record<string, string> = {
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
  REQUESTED: 'bg-yellow-100 text-yellow-700',
  ACCEPTED: 'bg-blue-100 text-blue-700',
  IN_TRANSIT: 'bg-purple-100 text-purple-700',
};

export default function TransferHistoryPage() {
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [period, setPeriod] = useState<string>('all');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['transfers-all'],
    queryFn: () => apiClient.get<{ data: Transfer[] }>('/api/v1/transfer'),
  });
  const allTransfers: Transfer[] = (() => { const d = data?.data; return Array.isArray(d) ? d : (d as any)?.data ?? []; })();

  const filtered = useMemo(() => {
    let list = allTransfers;
    if (typeFilter) list = list.filter(t => t.transferType === typeFilter);
    if (period !== 'all') {
      const now = new Date();
      const cutoff = new Date();
      if (period === '7d') cutoff.setDate(now.getDate() - 7);
      if (period === '30d') cutoff.setDate(now.getDate() - 30);
      if (period === '90d') cutoff.setDate(now.getDate() - 90);
      list = list.filter(t => new Date(t.requestedAt) >= cutoff);
    }
    return list;
  }, [allTransfers, typeFilter, period]);

  // 통계
  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(t => { map[t.transferType] = (map[t.transferType] ?? 0) + 1; });
    return map;
  }, [filtered]);

  const byOrg = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(t => {
      const org = t.transferType === 'OUTGOING_REFERRAL' ? t.toOrg?.name : t.fromOrg?.name;
      if (org) map[org] = (map[org] ?? 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [filtered]);

  const completedCount = filtered.filter(t => t.status === 'COMPLETED').length;
  const rejectedCount = filtered.filter(t => t.status === 'REJECTED').length;
  /* 🔴 분모 0 은 0% 가 아니라 '산출 불가'다 — 미완료(0%)와 대상 없음을 뒤바꿔 말하지 않는다(2026-09-02) */

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="전원 이력" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="기간별/기관별 전원 통계" /></p>
        </div>
        <Link href="/transfer" className="text-sm text-blue-600 hover:underline">&larr; <T k="대시보드" /></Link>
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex gap-1.5">
          {[
            { label: '전체', value: '' },
            { label: '발신', value: 'OUTGOING_REFERRAL' },
            { label: '수신', value: 'INCOMING_REFERRAL' },
            { label: '회송', value: 'RETURN' },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                typeFilter === f.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            ><T k={f.label} /></button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {[
            { label: '전체 기간', days: undefined as number | undefined, value: 'all' },
            { label: '{일수}일', days: 7, value: '7d' },
            { label: '{일수}일', days: 30, value: '30d' },
            { label: '{일수}일', days: 90, value: '90d' },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => setPeriod(f.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                period === f.value ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >{f.days != null ? <Tf k={f.label} params={{ 일수: f.days }} /> : <T k={f.label} />}</button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{filtered.length}</div>
          <div className="text-xs text-gray-500"><T k="전체" /></div>
        </div>
        <div className="bg-white rounded-2xl border p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600">{completedCount}</div>
          <div className="text-xs text-gray-500"><T k="완료" /></div>
        </div>
        <div className="bg-white rounded-2xl border p-4 text-center">
          <div className="text-2xl font-bold text-red-600">{rejectedCount}</div>
          <div className="text-xs text-gray-500"><T k="거절" /></div>
        </div>
        <div className="bg-white rounded-2xl border p-4 text-center">
          <div className="text-2xl font-bold text-amber-600"><Ratio numerator={rejectedCount} denominator={filtered.length} pctOnly unavailableHint="해당 조건의 전원 이력 없음" /></div>
          <div className="text-xs text-gray-500"><T k="거절률" /></div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        {/* 유형별 분포 */}
        <div className="bg-white rounded-2xl border p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="유형별 분포" /></h3>
          <div className="space-y-2">
            {Object.entries(byType).map(([type, count]) => (
              <div key={type} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 w-16"><T k={TYPE_LABEL[type] ?? type} /></span>
                <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${(count / filtered.length) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-gray-700 w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 기관별 Top 5 */}
        <div className="bg-white rounded-2xl border p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="기관별 Top 5" /></h3>
          {byOrg.length === 0 ? (
            <div className="text-xs text-gray-400 py-4 text-center"><T k="데이터 없음" /></div>
          ) : (
            <div className="space-y-2">
              {byOrg.map(([org, count]) => (
                <div key={org} className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 flex-1 truncate">{org}</span>
                  <div className="w-24 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div
                      className="h-full bg-violet-500 rounded-full"
                      style={{ width: `${(count / (byOrg[0]?.[1] ?? 1)) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold text-gray-700 w-8 text-right">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* List — 🔴 조회 실패를 "0건"·빈 표로 말하지 않는다 */}
      {isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : isLoading ? (
        <div className="py-8 text-center text-gray-400 animate-pulse"><T k="로딩 중..." /></div>
      ) : (
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium"><T k="환자" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="유형" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="기관" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="상태" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="요청일" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="완료일" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(t => (
                <tr key={t.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <Link href={`/transfer/${t.id}`} className="text-blue-600 hover:underline font-medium">
                      {t.patient ? `${t.patient.familyName}${t.patient.givenName}` : '-'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600"><T k={TYPE_LABEL[t.transferType] ?? t.transferType} /></td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {t.transferType === 'OUTGOING_REFERRAL' ? t.toOrg?.name : t.fromOrg?.name}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${STATUS_STYLE[t.status] ?? 'bg-gray-100'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{t.requestedAt?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{t.completedAt?.slice(0, 10) ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
