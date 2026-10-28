'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

interface HieStats {
  total: number;
  recentMonth: number;
  byDirection: Record<string, number>;
  byDocType: Record<string, number>;
  byStatus: Record<string, number>;
}

interface HieLog {
  id: string;
  direction: string;
  documentType: string;
  documentTitle?: string;
  format: string;
  status: string;
  /** 서버가 저장값을 바꾸지 않고 덧붙이는 전송 판정 — 미전송을 초록으로 칠하지 않기 위한 정본(W8) */
  transmission?: { state: string; label: string; note?: string | null; transmitted: boolean; retransmittable?: boolean };
  patient?: { familyName: string; givenName: string; mrn: string };
  targetOrg?: { name: string; code: string };
  sourceOrg?: { name: string; code: string };
  createdAt: string;
  sentAt?: string;
  receivedAt?: string;
}

const DOC_LABEL: Record<string, string> = {
  TRSF: '진료의뢰서', PRSC: '처방전', DIAG: '진단서',
  EXAM: '검사결과지', IMAG: '영상판독문', DSCH: '퇴원요약서',
};

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  SENT: 'bg-blue-100 text-blue-700',
  RECEIVED: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
  // 🔴 화면 실사용 점검 W8(2026-08-14) — 서버가 전송을 흉내내던 것을 정직화하며 늘어난 상태.
  //    `transmitToHie()` 는 `logger.log('Would transmit CDA…')` 만 하고 `status:'SENT'`·`sentAt=now` 를
  //    찍고 있었다. 법정 문서(CDA) 반출 기록이 통째로 거짓이었다.
  //    이제 미전송은 `LOCAL_RECORDED` 이며 **초록·파랑으로 칠하지 않는다**(P17).
  LOCAL_RECORDED: 'bg-orange-100 text-orange-700',
  SEND_FAILED: 'bg-red-100 text-red-700',
};

export default function HieDashboardPage() {
  const tAttr = useTAttr();
  const [direction, setDirection] = useState<string>('');

  const { data: statsData, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['hie-stats'],
    queryFn: () => apiClient.get<{ data: HieStats }>('/api/v1/hie/stats'),
  });
  const stats: HieStats = (statsData as any)?.data?.data ?? (statsData as any)?.data ?? { total: 0, recentMonth: 0, byDirection: {}, byDocType: {}, byStatus: {} };

  const { data: logsData, isLoading, isError: logsIsError, error: logsError, refetch: refetchLogs } = useQuery({
    queryKey: ['hie-logs', direction],
    queryFn: () => apiClient.get<{ data: { logs: HieLog[] } }>(`/api/v1/hie/log${direction ? `?direction=${direction}` : ''}`),
  });
  const logs: HieLog[] = (logsData as any)?.data?.data?.logs ?? (logsData as any)?.data?.logs ?? [];

  const maxDocCount = Math.max(1, ...Object.values(stats.byDocType ?? {}));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="진료정보교류 (HIE)" /></h1>
        <p className="text-sm text-gray-500 mt-0.5"><T k="건강정보고속도로 교류 이력 및 통계" /></p>
      </div>

      {/* 🔴 통계 조회 실패를 "전체 0 · 실패 0" 으로 말하지 않는다(P17 안심시키는 0) */}
      {statsIsError && <QueryErrorFallback error={statsError} onRetry={refetchStats} size="compact" />}

      {/* Summary */}
      {!statsIsError && (
      <div className="grid grid-cols-5 gap-3">
        <div className="bg-white rounded-2xl border p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          <div className="text-xs text-gray-500"><T k="전체 교류" /></div>
        </div>
        <div className="bg-white rounded-2xl border p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{stats.recentMonth}</div>
          <div className="text-xs text-gray-500"><T k="최근 30일" /></div>
        </div>
        <div className="bg-white rounded-2xl border p-4 text-center">
          <div className="text-2xl font-bold text-violet-600">{stats.byDirection?.SEND ?? 0}</div>
          <div className="text-xs text-gray-500"><T k="전송" /></div>
        </div>
        <div className="bg-white rounded-2xl border p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600">{stats.byDirection?.RECEIVE ?? 0}</div>
          <div className="text-xs text-gray-500"><T k="수신" /></div>
        </div>
        <div className="bg-white rounded-2xl border p-4 text-center">
          <div className="text-2xl font-bold text-red-600">{stats.byStatus?.FAILED ?? 0}</div>
          <div className="text-xs text-gray-500"><T k="실패" /></div>
        </div>
      </div>
      )}

      {/* Doc type chart */}
      {!statsIsError && (
      <div className="bg-white rounded-2xl border p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="문서 유형별 분포" /></h3>
        <div className="grid grid-cols-6 gap-2">
          {Object.entries(stats.byDocType ?? {}).map(([type, count]) => (
            <div key={type} className="text-center">
              <div className="bg-gray-100 rounded-xl h-20 flex items-end justify-center overflow-hidden">
                <div className="w-full bg-blue-500 rounded-t-lg" style={{ height: `${(count / maxDocCount) * 100}%` }} />
              </div>
              <div className="text-[10px] font-medium text-gray-600 mt-1"><T k={DOC_LABEL[type] ?? type} /></div>
              <div className="text-xs font-bold text-gray-900">{count}</div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Filters */}
      <div className="flex gap-1.5">
        {[
          { label: '전체', value: '' },
          { label: '전송', value: 'SEND' },
          { label: '수신', value: 'RECEIVE' },
        ].map(f => (
          <button
            key={f.value}
            onClick={() => setDirection(f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
              direction === f.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          ><T k={f.label} /></button>
        ))}
      </div>

      {/* Logs Table */}
      {logsIsError ? (
        <QueryErrorFallback error={logsError} onRetry={refetchLogs} />
      ) : isLoading ? (
        <div className="py-8 text-center text-gray-400 animate-pulse"><T k="로딩 중..." /></div>
      ) : logs.length === 0 ? (
        <EmptyState icon="📝" title="교류 이력이 없습니다" />
      ) : (
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium"><T k="방향" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="문서" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="환자" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="기관" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="포맷" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="상태" /></th>
                <th className="text-left px-4 py-3 font-medium"><T k="일시" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                      log.direction === 'SEND' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                    }`}><T k={log.direction === 'SEND' ? '전송' : '수신'} /></span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700"><T k={DOC_LABEL[log.documentType] ?? log.documentType} /></td>
                  <td className="px-4 py-3">
                    <div className="text-xs font-medium">{log.patient ? `${log.patient.familyName}${log.patient.givenName}` : '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {log.direction === 'SEND' ? log.targetOrg?.name : log.sourceOrg?.name ?? '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-mono">{log.format}</span>
                  </td>
                  <td className="px-4 py-3">
                    {/* 🔴 서버가 실어 보내는 판정(transmission)을 쓴다 — 원시 enum 문자열을 그대로
                        노출하면 `LOCAL_RECORDED` 가 회색 영문으로 흘러 미전송인지 알 수 없다.
                        과거 `SENT` 행도 게이트웨이 미구축 기간 것이면 '전송 근거 없음'으로 읽힌다. */}
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${STATUS_STYLE[log.transmission?.state ?? log.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {log.transmission?.label ?? log.status}
                    </span>
                    {log.transmission?.transmitted === false && (
                      <p className="text-[10px] text-orange-700 mt-0.5">{log.transmission.note ?? '외부로 나가지 않았습니다'}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[10px] text-gray-400">{log.createdAt?.slice(0, 16).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
