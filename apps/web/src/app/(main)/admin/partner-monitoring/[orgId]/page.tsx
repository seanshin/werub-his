'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

interface OrgMonitoring {
  organization: { id: string; name: string; code: string };
  /** 🔴 계측이 없으면 null(산출 불가) — 0 과 구분한다(W8) */
  measurement?: { measured: boolean; source: string; since: string | null; note: string | null; hint: string | null };
  totalCalls: number | null;
  errorCalls: number | null;
  errorRate: number | null;
  avgResponseTime: number | null;
  dailyCalls: number | null;
}

/** 측정하지 않은 값은 0 이 아니다 — '—' 로 둔다(W8) */
function Metric({ value, suffix }: { value: number | null | undefined; suffix?: string }) {
  const tAttr = useTAttr();
  if (value === null || value === undefined) return <span className="text-gray-400" title={tAttr('측정되지 않았습니다')}>—</span>;
  return <>{value.toLocaleString()}{suffix === '%' ? <Unit>%</Unit> : suffix}</>;
}

interface LogEntry {
  id: string;
  method: string;
  path: string;
  statusCode: number;
  responseTime: number;
  createdAt: string;
  errorMessage?: string;
}

export default function PartnerMonitoringDetailPage() {
  const tAttr = useTAttr();
  const { orgId } = useParams<{ orgId: string }>();

  const { data: monData, isLoading, isError: monIsError, error: monError, refetch: refetchMon } = useQuery({
    queryKey: ['partner-monitoring', orgId],
    queryFn: () => apiClient.get<{ data: OrgMonitoring }>(`/api/v1/admin/partner-monitoring/${orgId}`),
    enabled: !!orgId,
  });
  const mon: OrgMonitoring | null = (monData as any)?.data?.data ?? (monData as any)?.data ?? null;

  const { data: logsData, isError: logsIsError, error: logsError, refetch: refetchLogs } = useQuery({
    queryKey: ['partner-logs', orgId],
    queryFn: () => apiClient.get<{ data: { logs: LogEntry[] } }>(`/api/v1/admin/partner-monitoring/${orgId}/logs`),
    enabled: !!orgId,
  });
  const logs: LogEntry[] = (logsData as any)?.data?.data?.logs ?? (logsData as any)?.data?.logs ?? [];
  const measured = mon?.measurement ? mon.measurement.measured : undefined;

  // 🔴 조회 실패에 "호출 0 · 에러율 0%"를 그리지 않는다
  if (monIsError) return <QueryErrorFallback error={monError} onRetry={() => refetchMon()} />;
  if (isLoading) return <div className="py-12 text-center text-gray-400 animate-pulse"><T k="로딩 중..." /></div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{mon?.organization?.name ?? tAttr('기관')} <T k="모니터링" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="코드" />: {mon?.organization?.code}</p>
        </div>
        <Link href="/admin/partner-monitoring" className="text-sm text-blue-600 hover:underline">&larr; <T k="전체 모니터링" /></Link>
      </div>

      {/* 🔴 계측 미배선 — "에러율 0%"가 아니라 "측정되지 않음" (W8) */}
      {measured === false && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5">
          <p className="text-xs font-bold text-amber-900"><T k="⚠️ 이 기관의 API 호출은 측정되지 않고 있습니다 — 호출 수·에러율은 산출할 수 없습니다." /></p>
          <p className="text-[11px] text-amber-800 mt-1">{mon?.measurement?.note}</p>
          {mon?.measurement?.hint && <p className="text-[11px] text-amber-700 mt-1"><T k="조치" />: {mon.measurement.hint}</p>}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border p-4 text-center">
          <div className="text-2xl font-bold text-gray-900"><Metric value={mon?.totalCalls} /></div>
          <div className="text-xs text-gray-500"><T k="전체 호출" /></div>
        </div>
        <div className="bg-white rounded-2xl border p-4 text-center">
          <div className="text-2xl font-bold text-red-600"><Metric value={mon?.errorCalls} /></div>
          <div className="text-xs text-gray-500"><T k="에러" /></div>
        </div>
        <div className="bg-white rounded-2xl border p-4 text-center">
          <div className="text-2xl font-bold text-amber-600"><Metric value={mon?.errorRate} suffix="%" /></div>
          <div className="text-xs text-gray-500"><T k="에러율" /></div>
        </div>
        <div className="bg-white rounded-2xl border p-4 text-center">
          <div className="text-2xl font-bold text-blue-600"><Metric value={mon?.avgResponseTime} suffix="ms" /></div>
          <div className="text-xs text-gray-500"><T k="평균 응답" /></div>
        </div>
      </div>

      {/* Logs */}
      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b bg-gray-50">
          <h3 className="text-sm font-bold text-gray-900"><T k="최근 API 호출 이력" /></h3>
        </div>
        {logsIsError ? (
          <div className="p-4"><QueryErrorFallback error={logsError} onRetry={() => refetchLogs()} size="compact" /></div>
        ) : logs.length === 0 ? (
          <EmptyState icon="📝" title={measured === false ? '측정되지 않음' : '호출 이력이 없습니다'} hint={measured === false ? '호출 기록을 남기는 계측이 배선되지 않았습니다 — 호출이 없었다는 뜻이 아닙니다.' : undefined} />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium"><T k="메서드" /></th>
                <th className="text-left px-4 py-2 font-medium"><T k="경로" /></th>
                <th className="text-left px-4 py-2 font-medium"><T k="상태" /></th>
                <th className="text-left px-4 py-2 font-medium"><T k="응답시간" /></th>
                <th className="text-left px-4 py-2 font-medium"><T k="일시" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {logs.slice(0, 30).map(log => (
                <tr key={log.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2 font-mono text-xs">{log.method}</td>
                  <td className="px-4 py-2 text-xs text-gray-600 truncate max-w-[200px]">{log.path}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                      log.statusCode < 300 ? 'bg-emerald-100 text-emerald-700' :
                      log.statusCode < 500 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                    }`}>{log.statusCode}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">{log.responseTime}ms</td>
                  <td className="px-4 py-2 text-[10px] text-gray-400">{log.createdAt?.slice(11, 19)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
