'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { safeFormat as format } from '@/lib/safe-date';
import StatCard from '@/components/ui/StatCard';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface AuditActionStat {
  action: string;
  count: number;
}

interface AuditResourceStat {
  resource: string;
  count: number;
}

interface AuditDashboard {
  totalAccess: number;
  btgCount: number;
  byAction?: AuditActionStat[];
  byResource?: AuditResourceStat[];
  /**
   * 🔴 W7 부터 서버가 내주던 필드인데 이 화면이 읽지 않았다 — 화면 실사용 점검 W8(2026-08-14).
   *    SMART 토큰 접근은 주체가 클라이언트라 `AuditLog`(User FK)에 담기지 않고 `SmartAccessLog` 에 쌓인다.
   *    그래서 "총 접근"이 **내부 감사만** 세고 있었고(실측 SMART 27,156 vs 내부 6,131),
   *    `/admin/audit` 과 이 화면이 **같은 '전체 접근'을 서로 다르게** 말했다.
   *    두 화면이 이제 같은 `/audit/dashboard` 한 함수를 쓴다.
   */
  smartAccess?: number;
  smartPatientScoped?: number;
  totalAccessAllChannels?: number;
  /** 🔴 BTG 는 아직 계측되지 않는다 — 0 을 "비상열람 없음"으로 읽으면 안 된다 */
  btgInstrumented?: boolean;
}

interface BtgRecord {
  id: string;
  reason: string;
  accessedAt: string;
  isApproved: boolean | null;
  user?: { familyName: string; givenName: string };
  patient?: { familyName: string; givenName: string };
}

export default function AuditDashboardPage() {
  const tAttr = useTAttr();
  const [dateFrom, setDateFrom] = useState(format(new Date(Date.now() - 7 * 86400000), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: stats, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['audit-dashboard', dateFrom, dateTo],
    queryFn: () => apiClient.get<{ data: AuditDashboard }>('/api/v1/audit/dashboard', { dateFrom, dateTo }),
  });

  const { data: btgData } = useQuery({
    queryKey: ['btg-list', dateFrom, dateTo],
    queryFn: () => apiClient.get<{ data: BtgRecord[] }>('/api/v1/break-the-glass', { dateFrom, dateTo }),
  });

  const dashboard = stats?.data;
  const _btgRaw = btgData?.data;
  const btgList: BtgRecord[] = Array.isArray(_btgRaw) ? _btgRaw : ((_btgRaw as unknown as Record<string, unknown>)?.data as BtgRecord[] ?? []);

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900"><T k="감사 대시보드" /></h1>

      <div className="flex gap-3">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
        <span className="text-gray-400 self-center">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : dashboard && (
        <>
          <div className="grid grid-cols-4 gap-4">
            {/* 🔴 '총 접근'이 내부 감사만 세던 것 봉합(W8) — 외부 앱(SMART) 접근을 함께 센다 */}
            <StatCard
              title={tAttr('총 접근 (내부+외부앱)')}
              value={dashboard.totalAccessAllChannels ?? dashboard.totalAccess}
            />
            <StatCard title={tAttr('내부 감사(AuditLog)')} value={dashboard.totalAccess} />
            <StatCard
              title={tAttr('외부 앱(SMART)')}
              value={dashboard.smartAccess ?? 0}
              color={dashboard.smartAccess ? 'amber' : undefined}
            />
            <StatCard title={tAttr('BTG 접근')} value={dashboard.btgCount} color="amber" />
            {dashboard.byAction?.map((a) => (
              <StatCard key={a.action} title={a.action} value={a.count} />
            ))}
          </div>

          {/* 🔴 계측되지 않은 0 을 "없음"으로 읽지 않게 한다(P17) */}
          {dashboard.btgInstrumented === false && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              비상열람(BTG)은 아직 계측되지 않습니다 — 위 <b>0건</b>은 “비상열람이 없었다”는 뜻이 아닙니다.
            </div>
          )}
          {typeof dashboard.smartPatientScoped === 'number' && dashboard.smartPatientScoped > 0 && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              외부 앱 접근 중 <b>{dashboard.smartPatientScoped.toLocaleString()}건</b>이 환자 지목 조회입니다.
              아래 목록·리소스별 집계는 <b>내부 감사(AuditLog)만</b> 대상으로 합니다 —
              외부 앱 접근 상세는 <span className="font-medium">/admin/smart-clients</span> 에서 봅니다.
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4"><T k="리소스별 접근" /></h3>
              {dashboard.byResource?.map((r) => (
                <div key={r.resource} className="flex justify-between py-2 border-b border-gray-50">
                  <span className="text-sm text-gray-600">{r.resource}</span>
                  <span className="text-sm font-medium">{r.count}</span>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4"><T k="최근 Break-the-Glass" /></h3>
              {btgList.length === 0 ? (
                <p className="text-center text-gray-400 py-4 text-sm"><T k="BTG 접근 기록 없음" /></p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {btgList.slice(0, 10).map((b) => (
                    <div key={b.id} className="flex items-start justify-between py-2 border-b border-gray-50">
                      <div>
                        <p className="text-xs font-medium text-gray-900">{b.user?.familyName}{b.user?.givenName} → {b.patient?.familyName}{b.patient?.givenName}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">{b.reason}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-gray-400">{format(new Date(b.accessedAt), 'MM-dd HH:mm')}</p>
                        {b.isApproved === null ? (
                          <span className="text-[11px] text-amber-600"><T k="미검토" /></span>
                        ) : b.isApproved ? (
                          <span className="text-[11px] text-emerald-600"><T k="승인" /></span>
                        ) : (
                          <span className="text-[11px] text-red-600"><T k="거부" /></span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* StatCard: moved to @/components/ui/StatCard */
