'use client';

import { useQuery } from '@tanstack/react-query';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Measurement {
  measured: boolean;
  source: string;
  since: string | null;
  note: string | null;
  hint: string | null;
}

interface MonitoringStats {
  measurement?: Measurement;
  activePartners?: number | null;
  todayCalls?: number | null;
  errorRate?: number | null;
  avgResponseTime?: number | null;
  transfersThisMonth?: number | null;
  partnerTraffic?: Array<{ orgName: string; calls: number; errorRate: number | null }>;
  recentAlerts?: Array<{ message: string; level: string; time: string }>;
}

const LEVEL_COLOR: Record<string, string> = {
  CRITICAL: 'text-red-600', WARNING: 'text-amber-600', INFO: 'text-blue-600',
};

/**
 * 🔴 측정하지 않은 값은 0 이 아니다 — 화면 실사용 점검 W8(2026-08-14).
 * 종전에는 `stats.errorRate ?? 0` 로 **에러율 0.0%(초록)** 을, 조회 실패 시에도 0 뭉치 폴백을 그렸다.
 * 서버가 `null` 을 주면(계측 미배선·표본 0) '—' 로 두고, 색으로 안심시키지 않는다.
 */
function Metric({ value, suffix, tone }: { value: number | null | undefined; suffix?: string; tone?: (v: number) => string }) {
  const tAttr = useTAttr();
  if (value === null || value === undefined) {
    return <span className="text-gray-400" title={tAttr('측정되지 않았습니다')}>—</span>;
  }
  return <span className={tone?.(value)}>{value.toLocaleString()}{suffix ? <Unit>{suffix}</Unit> : null}</span>;
}

export default function PartnerMonitoringPage() {
  const tAttr = useTAttr();
  // 🔴 조회 실패를 0 폴백으로 삼키지 않는다 — 실패는 실패로 보여준다.
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['partner-monitoring-stats'],
    queryFn: () => apiClient.get<{ data: MonitoringStats }>('/api/v1/admin/partner-monitoring/stats'),
    refetchInterval: pollMs('normal'),
    retry: 1,
  });

  const stats: MonitoringStats = (() => {
    const d = data?.data;
    if (!d) return {};
    return ((d as unknown as { data?: MonitoringStats })?.data ?? d) as MonitoringStats;
  })();

  const measurement = stats.measurement;
  const measured = measurement ? measurement.measured : undefined;
  const traffic = stats.partnerTraffic ?? [];
  const alerts = stats.recentAlerts ?? [];
  const maxCalls = Math.max(...traffic.map(t => t.calls), 1);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="연동 모니터링" /></h1>
        <p className="text-sm text-gray-500 mt-0.5"><T k="파트너 API 호출 통계, 에러율, 알림 · 30초 갱신" /></p>
      </div>

      {/* 조회 실패 — 0 으로 그리지 않는다 */}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <span className="font-bold"><T k="통계를 불러오지 못했습니다." /></span>{' '}
          <T k="아래 값은 신뢰할 수 없습니다" /> — {(error as Error)?.message ?? tAttr('서버 조회 실패')}
        </div>
      )}

      {/* 🔴 계측 미배선 — "에러율 0%·알림 없음"이 아니라 "측정되지 않음"이라고 말한다 */}
      {measured === false && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5">
          <p className="text-xs font-bold text-amber-900">
            ⚠️ 파트너 API 호출이 <span className="underline">측정되지 않고 있습니다</span> — 아래 호출 수·에러율·응답시간은 산출할 수 없습니다.
          </p>
          <p className="text-[11px] text-amber-800 mt-1">{measurement?.note}</p>
          {measurement?.hint && <p className="text-[11px] text-amber-700 mt-1"><T k="조치:" /> {measurement.hint}</p>}
          <p className="text-[11px] text-amber-700 mt-1">
            <T k={'이 화면의 "알림 없음"은 연동이 건강하다는 뜻이 아닙니다. 아무것도 보고 있지 않다는 뜻입니다.'} />
          </p>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-blue-600"><Metric value={stats.activePartners} /></div>
          <div className="text-[10px] text-gray-500"><T k="활성 파트너" /></div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-gray-900"><Metric value={stats.todayCalls} /></div>
          <div className="text-[10px] text-gray-500"><T k="오늘 호출" />{measured === false && <>{' '}<T k="(미계측)" /></>}</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold">
            <Metric value={stats.errorRate} suffix="%" tone={(v) => (v > 1 ? 'text-red-600' : 'text-emerald-600')} />
          </div>
          <div className="text-[10px] text-gray-500"><T k="에러율" />{measured === false && <>{' '}<T k="(미계측)" /></>}</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-violet-600"><Metric value={stats.avgResponseTime} suffix="ms" /></div>
          <div className="text-[10px] text-gray-500"><T k="평균 응답" />{measured === false && <>{' '}<T k="(미계측)" /></>}</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-amber-600"><Metric value={stats.transfersThisMonth} /></div>
          <div className="text-[10px] text-gray-500"><T k="이번달 전원" /></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* Traffic */}
        <div className="bg-white rounded-2xl border shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="기관별 API 트래픽 (24h)" /></h3>
          {traffic.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">
              <T k={isLoading ? '불러오는 중…' : measured === false ? '측정되지 않음 — 호출이 없다는 뜻이 아닙니다' : '데이터 없음'} />
            </p>
          ) : (
            <div className="space-y-2.5">
              {traffic.map(t => (
                <div key={t.orgName}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-700 font-medium">{t.orgName}</span>
                    <span className="text-gray-400">{t.calls.toLocaleString()} calls</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(t.calls / maxCalls) * 100}%` }} />
                    </div>
                    <span className="text-[10px] font-semibold">
                      <Metric value={t.errorRate} suffix="%" tone={(v) => (v > 1 ? 'text-red-600' : 'text-emerald-600')} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Alerts */}
        <div className="bg-white rounded-2xl border shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="최근 알림" /></h3>
          {alerts.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">
              <T k={isLoading ? '불러오는 중…' : measured === false ? '감시 중이 아닙니다 (미계측)' : '알림 없음'} />
            </p>
          ) : (
            <div className="space-y-2">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-2 py-2 border-b border-gray-50">
                  <span className={`text-xs font-bold ${LEVEL_COLOR[a.level] ?? 'text-gray-500'}`}>
                    {a.level === 'CRITICAL' ? '🚨' : a.level === 'WARNING' ? '⚠️' : 'ℹ️'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-800">{a.message}</p>
                    <p className="text-[10px] text-gray-400">{a.time}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
