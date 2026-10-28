'use client';

import { useQuery } from '@tanstack/react-query';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T } from '@/components/ui/i18n-text';

interface StaffMember {
  id: string;
  familyName: string;
  givenName: string;
  department: string;
  role?: string;
}

interface EquipmentItem {
  id: string;
  name: string;
  category: string;
  location?: string;
  status: string;
}

interface InventoryItem {
  id: string;
  code: string;
  name: string;
  category: string;
  currentStock: number;
  safetyStock: number;
}

interface DashboardOverview {
  patients?: number | string;
  todayAppointments?: number | string;
  todayEncounters?: number | string;
  pendingBillings?: number | string;
  pendingOrders?: number | string;
}

export default function HospitalStatusPage() {
  const { data: staff, isError, error, refetch } = useQuery({
    queryKey: ['hr-staff'],
    queryFn: () => apiClient.get<{ data: StaffMember[] }>('/api/v1/hr/staff'),
  });
  const { data: equipment, isError: equipIsError } = useQuery({
    queryKey: ['equipment'],
    queryFn: () => apiClient.get<{ data: EquipmentItem[] }>('/api/v1/equipment'),
  });
  const { data: inventory, isError: invIsError } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => apiClient.get<{ data: InventoryItem[] }>('/api/v1/inventory'),
  });
  const { data: dashboard, isError: dashIsError, error: dashError, refetch: refetchDash } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => apiClient.get<{ data: DashboardOverview }>('/api/v1/dashboard/overview'),
  });
  interface PatientsResponse { pagination?: { total?: number }; data?: unknown[]; length?: number }
  const { data: patientsData, isError: ptIsError, error: ptError, refetch: refetchPatients } = useQuery({
    queryKey: ['patients-total'],
    queryFn: () => apiClient.get<{ data: PatientsResponse | { data: PatientsResponse } }>('/api/v1/patients?page=1&limit=1'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const _staffRaw = staff?.data;
  const staffList: StaffMember[] = Array.isArray(_staffRaw) ? _staffRaw : (_staffRaw as unknown as Record<string, unknown>)?.data as StaffMember[] ?? [];
  const _equipRaw = equipment?.data;
  const equipList: EquipmentItem[] = Array.isArray(_equipRaw) ? _equipRaw : (_equipRaw as unknown as Record<string, unknown>)?.data as EquipmentItem[] ?? [];
  const _invRaw = inventory?.data;
  const invList: InventoryItem[] = Array.isArray(_invRaw) ? _invRaw : (_invRaw as unknown as Record<string, unknown>)?.data as InventoryItem[] ?? [];
  const _dashRaw = dashboard?.data as DashboardOverview | { data: DashboardOverview } | undefined;
  const overview: DashboardOverview = (_dashRaw as { data?: DashboardOverview })?.data ?? (_dashRaw as DashboardOverview) ?? {};
  const _ptRaw = patientsData?.data as PatientsResponse | { data: PatientsResponse } | undefined;
  const _ptNested = (_ptRaw as { data?: PatientsResponse })?.data ?? _ptRaw as PatientsResponse | undefined;
  const totalPatients = overview?.patients ?? _ptNested?.pagination?.total ?? (_ptNested?.data as unknown[] | undefined)?.length ?? '-';

  // Staff by department
  const deptMap: Record<string, StaffMember[]> = {};
  staffList.forEach((s: StaffMember) => {
    if (!deptMap[s.department]) deptMap[s.department] = [];
    deptMap[s.department].push(s);
  });

  // Equipment by status
  const equipActive = equipList.filter((e: EquipmentItem) => e.status === 'ACTIVE').length;
  const equipMaint = equipList.filter((e: EquipmentItem) => e.status === 'UNDER_MAINTENANCE').length;

  // Inventory alerts (below safety stock)
  const lowStock = invList.filter((i: InventoryItem) => i.currentStock <= i.safetyStock);

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="병원 현황" /></h2>
        <p className="text-sm text-gray-500 mt-1">위루비병원 <T k="운영 현황 종합" /></p>
      </div>

      {/* Summary Cards — 🔴 조회 실패를 0/'-'(=측정값)으로 그리지 않는다 */}
      {(dashIsError || ptIsError) && (
        <div className="mb-4">
          <QueryErrorFallback
            error={dashIsError ? dashError : ptError}
            onRetry={() => { if (dashIsError) refetchDash(); if (ptIsError) refetchPatients(); }}
            size="compact"
          />
          <p className="text-[11px] text-amber-700 mt-1"><T k="아래 요약 수치 중 일부를 불러오지 못했습니다 — 표시된 값이 실제 현황과 다를 수 있습니다." /></p>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
        <SummaryCard label="총 환자" value={dashIsError && ptIsError ? '조회 실패' : totalPatients} color="blue" />
        <SummaryCard label="오늘 예약" value={dashIsError ? '조회 실패' : overview?.todayAppointments ?? '-'} color="emerald" />
        <SummaryCard label="오늘 진료" value={dashIsError ? '조회 실패' : overview?.todayEncounters ?? '-'} color="violet" />
        <SummaryCard label="미수납" value={dashIsError ? '조회 실패' : overview?.pendingBillings ?? '-'} color="amber" />
        <SummaryCard label="대기 오더" value={dashIsError ? '조회 실패' : overview?.pendingOrders ?? '-'} color="rose" />
        <SummaryCard label="직원 수" value={staffList.length} color="slate" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Staff by Department */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
            <T k="부서별 직원 현황" />
          </h3>
          <div className="space-y-3">
            {Object.entries(deptMap).map(([dept, members]) => (
              <div key={dept} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div>
                  <span className="text-sm font-medium text-gray-900">{dept}</span>
                  <span className="text-xs text-gray-400 ml-2">{members.length}<Unit>명</Unit></span>
                </div>
                <div className="flex -space-x-1">
                  {members.slice(0, 5).map((m: StaffMember, i: number) => (
                    <div key={i} className="w-7 h-7 rounded-full bg-blue-100 border-2 border-white flex items-center justify-center overflow-hidden" title={`${m.familyName}${m.givenName}`}>
                      <span className="text-[10px] font-bold text-blue-700 whitespace-nowrap">{(m.familyName || '').slice(0, 1)}</span>
                    </div>
                  ))}
                  {members.length > 5 && <div className="w-7 h-7 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center"><span className="text-[10px] text-gray-500">+{members.length - 5}</span></div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Equipment Status */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.42 15.17l-5.25 3.03a.75.75 0 01-1.08-.67V6.61a.75.75 0 01.37-.65l5.25-3.03a.75.75 0 01.74 0l5.25 3.03a.75.75 0 01.37.65v10.92a.75.75 0 01-1.08.67l-5.25-3.03a.75.75 0 00-.74 0z" /></svg>
            <T k="의료장비" /> ({equipList.length}<Unit>대</Unit>)
            {equipIsError && <span className="ml-2 text-xs font-normal text-red-600"><T k="조회 실패 — 0대가 아닙니다" /></span>}
          </h3>
          <div className="flex gap-3 mb-4">
            <StatusBadge label="정상" count={equipActive} color="emerald" />
            <StatusBadge label="점검중" count={equipMaint} color="amber" />
            <StatusBadge label="고장" count={equipList.filter((e: EquipmentItem) => e.status === 'BROKEN').length} color="red" />
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {equipList.map((eq: EquipmentItem) => (
              <div key={eq.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-900">{eq.name}</p>
                  <p className="text-xs text-gray-400">{eq.category} · {eq.location ?? '-'}</p>
                </div>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                  eq.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' :
                  eq.status === 'UNDER_MAINTENANCE' ? 'bg-amber-50 text-amber-700' :
                  'bg-red-50 text-red-700'
                }`}>
                  {eq.status === 'ACTIVE' ? <T k="정상" /> : eq.status === 'UNDER_MAINTENANCE' ? <T k="점검" /> : <T k="고장" />}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Inventory */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
            <T k="자재/재고 현황" /> ({invList.length}<Unit>품목</Unit>)
            {invIsError && <span className="ml-2 text-xs font-normal text-red-600"><T k="조회 실패 — 0품목이 아닙니다" /></span>}
          </h3>
          {lowStock.length > 0 && (
            <span className="text-xs font-medium text-red-600 bg-red-50 px-2.5 py-1 rounded-full">
              <T k="부족" /> {lowStock.length}<Unit>건</Unit>
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500"><T k="코드" /></th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500"><T k="품목명" /></th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500"><T k="분류" /></th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500"><T k="현재고" /></th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500"><T k="안전재고" /></th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500"><T k="상태" /></th>
              </tr>
            </thead>
            <tbody>
              {invList.map((item: InventoryItem) => {
                const isLow = item.currentStock <= item.safetyStock;
                return (
                  <tr key={item.id} className={`border-b border-gray-50 ${isLow ? 'bg-red-50/50' : ''}`}>
                    <td className="py-2 px-3 font-mono text-xs text-gray-500">{item.code}</td>
                    <td className="py-2 px-3 font-medium text-gray-900">{item.name}</td>
                    <td className="py-2 px-3 text-gray-500">{item.category}</td>
                    <td className={`py-2 px-3 text-right font-medium ${isLow ? 'text-red-600' : 'text-gray-900'}`}>{item.currentStock}</td>
                    <td className="py-2 px-3 text-right text-gray-400">{item.safetyStock}</td>
                    <td className="py-2 px-3">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${isLow ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {isLow ? <T k="부족" /> : <T k="정상" />}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700', emerald: 'bg-emerald-50 text-emerald-700',
    violet: 'bg-violet-50 text-violet-700', amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700', slate: 'bg-slate-50 text-slate-700',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
      <p className="text-2xl font-bold text-gray-900">{typeof value === 'string' && /[가-힣]/.test(value) ? <T k={value} /> : value}</p>
      <p className={`text-[11px] font-medium mt-1 inline-block px-2 py-0.5 rounded-full ${colors[color]}`}><T k={label} /></p>
    </div>
  );
}

function StatusBadge({ label, count, color }: { label: string; count: number; color: string }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-700',
  };
  return (
    <span className={`text-xs font-medium px-3 py-1.5 rounded-lg ${colors[color]}`}>
      <T k={label} /> {count}
    </span>
  );
}
