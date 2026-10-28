'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';

import { useQuery } from '@tanstack/react-query';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import { pollMs, money } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Title, Tooltip, Legend, Filler);

interface ChartData {
  hourlyPatients: Array<{ hour: string; count: number }>;
  departmentPatients: Array<{ name: string; count: number }>;
  orderStatus: Record<string, number>;
  dailyEncounters: Array<{ date: string; count: number }>;
  ktasDistribution: Record<string, number>;
}

interface MonthlyRevenue { month: string; revenue: number; count: number }
interface BedOccupancy { totalBeds: number; trend: Array<{ date: string; rate: number; occupied: number }> }

export default function DashboardCharts() {
  const tt = useTAttr();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard-charts'],
    queryFn: () => apiClient.get<{ data: ChartData }>('/api/v1/dashboard/charts'),
    refetchInterval: pollMs('slow'),
  });

  const { data: revenueData, isError: revenueIsError, error: revenueError, refetch: refetchRevenue } = useQuery({
    queryKey: ['monthly-revenue'],
    queryFn: () => apiClient.get<{ data: MonthlyRevenue[] }>('/api/v1/dashboard/monthly-revenue'),
    refetchInterval: 300000, // 특수 주기(5분) 보존
  });

  const { data: bedData, isError: bedIsError, error: bedError, refetch: refetchBed } = useQuery({
    queryKey: ['bed-occupancy'],
    queryFn: () => apiClient.get<{ data: BedOccupancy }>('/api/v1/dashboard/bed-occupancy'),
    refetchInterval: 300000, // 특수 주기(5분) 보존
  });

  const charts = (data?.data as unknown as Record<string, unknown>)?.data as ChartData ?? data?.data;
  const _revRaw = revenueData?.data as MonthlyRevenue[] | { data?: MonthlyRevenue[] } | undefined;
  const revenue: MonthlyRevenue[] = Array.isArray(_revRaw) ? _revRaw : ((_revRaw as { data?: MonthlyRevenue[] })?.data ?? []);
  const _bedRaw = bedData?.data as BedOccupancy | { data?: BedOccupancy } | null | undefined;
  const bed: BedOccupancy | null = (_bedRaw as { data?: BedOccupancy })?.data ?? (_bedRaw as BedOccupancy | null);

  // 🔴 에러 분기가 로딩보다 먼저 — 없으면 조회 실패가 영구 스켈레톤이 된다
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (isLoading || !charts) return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {[1, 2, 3, 4].map(i => <div key={i} className="h-48 bg-gray-100 rounded-xl animate-pulse" />)}
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* 시간대별 접수 환자 */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2"><T k="시간대별 접수 환자" /></h3>
        <Bar
          data={{
            labels: charts.hourlyPatients?.map((h: { hour: string; count: number }) => h.hour) ?? [],
            datasets: [{
              label: tt('환자 수'),
              data: charts.hourlyPatients?.map((h: { hour: string; count: number }) => h.count) ?? [],
              backgroundColor: 'rgba(59, 130, 246, 0.5)',
              borderColor: 'rgb(59, 130, 246)',
              borderWidth: 1,
              borderRadius: 4,
            }],
          }}
          options={{ responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }}
          height={160}
        />
      </div>

      {/* 7일간 진료 추이 */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2"><T k="7일간 진료 건수" /></h3>
        <Line
          data={{
            labels: charts.dailyEncounters?.map((d: { date: string; count: number }) => d.date) ?? [],
            datasets: [{
              label: tt('진료 건수'),
              data: charts.dailyEncounters?.map((d: { date: string; count: number }) => d.count) ?? [],
              borderColor: 'rgb(16, 185, 129)',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              fill: true,
              tension: 0.3,
              pointRadius: 4,
              pointBackgroundColor: 'rgb(16, 185, 129)',
            }],
          }}
          options={{ responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }}
          height={160}
        />
      </div>

      {/* 부서별 환자 분포 */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2"><T k="부서별 환자 분포" /></h3>
        {charts.departmentPatients?.length > 0 ? (
          <Doughnut
            data={{
              labels: charts.departmentPatients?.map((d: { name: string; count: number }) => d.name) ?? [],
              datasets: [{
                data: charts.departmentPatients?.map((d: { name: string; count: number }) => d.count) ?? [],
                backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6'],
                borderWidth: 0,
              }],
            }}
            options={{ responsive: true, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } } }}
            height={200}
          />
        ) : (
          <p className="text-xs text-gray-400 text-center py-6"><T k="오늘 접수 데이터 없음" /></p>
        )}
      </div>

      {/* 오더 상태 + 응급실 KTAS */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2"><T k="오더 상태 / 응급실 KTAS" /></h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-2"><T k="오더 상태" /></p>
            <div className="space-y-1.5">
              {[
                { key: 'ORDERED', label: '대기', color: 'bg-amber-400' },
                { key: 'RECEIVED', label: '접수됨', color: 'bg-blue-400' },
                { key: 'IN_PROGRESS', label: '진행중', color: 'bg-violet-400' },
                { key: 'COMPLETED', label: '완료', color: 'bg-emerald-400' },
              ].map(s => {
                const val = charts.orderStatus?.[s.key] ?? 0;
                const total = Object.values(charts.orderStatus ?? {}).reduce((a: number, b: unknown) => a + (b as number), 0) as number;
                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                return (
                  <div key={s.key} className="flex items-center gap-2 text-xs">
                    <span className={`w-2 h-2 rounded-full ${s.color}`} />
                    <span className="text-gray-600 min-w-[40px]"><T k={s.label} /></span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div className={`h-2 rounded-full ${s.color}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-gray-500 font-mono w-8 text-right">{val}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-2"><T k="응급실 KTAS" /></p>
            <div className="space-y-1.5">
              {[
                { key: 'LEVEL_1', label: '1급 소생', color: 'bg-red-600' },
                { key: 'LEVEL_2', label: '2급 긴급', color: 'bg-orange-500' },
                { key: 'LEVEL_3', label: '3급 응급', color: 'bg-yellow-400' },
                { key: 'LEVEL_4', label: '4급 준응급', color: 'bg-green-500' },
                { key: 'LEVEL_5', label: '5급 비응급', color: 'bg-blue-500' },
              ].map(s => {
                const val = charts.ktasDistribution?.[s.key] ?? 0;
                return (
                  <div key={s.key} className="flex items-center gap-2 text-xs">
                    <span className={`w-2 h-2 rounded-full ${s.color}`} />
                    <span className="text-gray-600 min-w-[55px]"><T k={s.label} /></span>
                    <span className="text-gray-900 font-bold">{val}<Unit><T k="명" /></Unit></span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 월별 매출 추이 */}
      {revenueIsError && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2"><T k="월별 매출" /></h3>
          <QueryErrorFallback error={revenueError} onRetry={refetchRevenue} size="compact" />
        </div>
      )}
      {!revenueIsError && revenue.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2"><T k="월별 매출 추이" /></h3>
          <Bar
            data={{
              labels: revenue.map(r => r.month),
              datasets: [{
                label: tt('매출 (원)'),
                data: revenue.map(r => r.revenue),
                backgroundColor: 'rgba(16, 185, 129, 0.5)',
                borderColor: 'rgb(16, 185, 129)',
                borderWidth: 1,
                borderRadius: 4,
              }],
            }}
            options={{
              responsive: true,
              plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${money((ctx.raw as number))} (${revenue[ctx.dataIndex]?.count ?? 0}${tt('건')})` } } },
              scales: { y: { beginAtZero: true, ticks: { callback: (v) => `${(Number(v) / 10000).toFixed(0)}${tt('만')}` } } },
            }}
            height={200}
          />
        </div>
      )}

      {/* 병상 가동률 추이 */}
      {bedIsError && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2"><T k="병상 가동률" /></h3>
          <QueryErrorFallback error={bedError} onRetry={refetchBed} size="compact" />
        </div>
      )}
      {!bedIsError && bed?.trend && bed.trend.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-900"><T k="병상 가동률 (7일)" /></h3>
            <span className="text-xs text-gray-400"><T k="전체" /> {bed.totalBeds}<T k="병상" /></span>
          </div>
          <Line
            data={{
              labels: bed.trend.map(t => t.date),
              datasets: [{
                label: tt('가동률 (%)'),
                data: bed.trend.map(t => t.rate),
                borderColor: 'rgb(99, 102, 241)',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 4,
                pointBackgroundColor: 'rgb(99, 102, 241)',
              }],
            }}
            options={{
              responsive: true,
              plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.raw}% (${bed.trend[ctx.dataIndex]?.occupied ?? 0}/${bed.totalBeds}${tt('병상')})` } } },
              scales: { y: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } } },
            }}
            height={200}
          />
        </div>
      )}
    </div>
  );
}
