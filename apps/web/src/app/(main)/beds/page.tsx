'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import StatCard from '@/components/ui/StatCard';
import PageHeader from '@/components/ui/PageHeader';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Bed {
  id: string;
  roomNumber: string;
  bedNumber: string;
  status: string;
  admissions?: Array<{ id: string; patient?: { familyName: string; givenName: string; mrn: string }; admitDate: string }>;
}

interface Ward {
  id: string;
  name: string;
  floor: string;
  beds?: Bed[];
}

interface BedStatusCount {
  status: string;
  _count: number;
}

interface BedStatusSummary {
  total: number;
  byStatus: BedStatusCount[];
}

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: 'bg-green-400',
  OCCUPIED: 'bg-blue-400',
  RESERVED: 'bg-amber-400',
  MAINTENANCE: 'bg-gray-300',
  CLEANING: 'bg-cyan-400',
  ISOLATION: 'bg-red-400',
};

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: '사용가능',
  OCCUPIED: '사용중',
  RESERVED: '예약',
  MAINTENANCE: '점검',
  CLEANING: '청소중',
  ISOLATION: '격리',
};

const STATUS_BADGE: Record<string, string> = {
  AVAILABLE: 'bg-green-50 text-green-700',
  OCCUPIED: 'bg-blue-50 text-blue-700',
  RESERVED: 'bg-amber-50 text-amber-700',
  MAINTENANCE: 'bg-gray-100 text-gray-500',
  CLEANING: 'bg-cyan-50 text-cyan-700',
  ISOLATION: 'bg-red-50 text-red-700',
};

const ALL_STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE', 'CLEANING', 'ISOLATION'] as const;

export default function BedsPage() {
  /**
   * 🔴 병상 상태 변경은 서버가 `@RequirePermission(PATIENT_EDIT)` — 보유자는
   *    ADMIN·NURSE·RECEPTIONIST 다(병상 운용은 병동·원무 업무). 의사에게는 조회 화면이라
   *    상태 메뉴를 띄우면 고를 때마다 403 이었다.
   */
  const canChangeBed = useHasRole('NURSE', 'RECEPTIONIST');
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [selectedBed, setSelectedBed] = useState<string | null>(null);

  const { data: wardsData, isLoading: wardsLoading, isError, error, refetch } = useQuery({
    queryKey: ['wards'],
    queryFn: () => apiClient.get<{ data: Ward[] | { data: Ward[] } }>('/api/v1/beds/wards'),
  });

  const { data: statusData } = useQuery({
    queryKey: ['beds-status'],
    queryFn: () => apiClient.get<{ data: BedStatusSummary | { data: BedStatusSummary } }>('/api/v1/beds/status'),
  });

  const changeStatus = useMutation({
    mutationFn: ({ bedId, status }: { bedId: string; status: string }) =>
      apiClient.patch(`/api/v1/beds/${bedId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wards'] });
      qc.invalidateQueries({ queryKey: ['beds-status'] });
      setSelectedBed(null);
    },
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const _wardsRaw = wardsData?.data;
  const wards: Ward[] = Array.isArray(_wardsRaw) ? _wardsRaw : (_wardsRaw as { data: Ward[] })?.data ?? [];
  const _statsRaw = statusData?.data;
  const stats: BedStatusSummary | null = _statsRaw
    ? ((_statsRaw as { data: BedStatusSummary })?.data ?? _statsRaw) as BedStatusSummary
    : null;
  const total = stats?.total ?? 0;
  const byStatus = (status: string) =>
    stats?.byStatus?.find((s: BedStatusCount) => s.status === status)?._count ?? 0;

  return (
    <div>
      <PageHeader title={tAttr('병상 현황')} />

      {/* Summary Cards
          🔴 상태 6종 중 4종만 세어 **합이 총계와 맞지 않았다**(49+5+0+1=55 vs 전체 57 —
             청소중 2가 어디에도 없었다·2026-08-12 실측). 병상은 "어디에 있는지"가 곧 가용성이라
             한 칸이 사라지면 배정 판단이 어긋난다.
             `BED_STATUS_LABEL` 의 **모든 상태**를 센다 — 라벨이 늘면 여기도 늘어야 한다. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-8">
        <StatCard title={tAttr('전체 병상')} value={total} color="gray" />
        <StatCard title={tAttr('사용가능')} value={byStatus('AVAILABLE')} color="emerald" />
        <StatCard title={tAttr('사용중')} value={byStatus('OCCUPIED')} color="blue" />
        <StatCard title={tAttr('예약@병상')} value={byStatus('RESERVED')} color="amber" />
        <StatCard title={tAttr('청소중')} value={byStatus('CLEANING')} color="cyan" />
        <StatCard title={tAttr('격리')} value={byStatus('ISOLATION')} color="red" />
        <StatCard title={tAttr('점검')} value={byStatus('MAINTENANCE')} color="gray" />
      </div>

      {/* Legend */}
      <div className="flex gap-4 mb-6">
        {ALL_STATUSES.map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded ${STATUS_COLORS[s]}`} />
            <span className="text-xs text-gray-600">{STATUS_LABELS[s]}</span>
          </div>
        ))}
      </div>

      {/* Ward Cards */}
      {wardsLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="h-5 w-32 bg-gray-100 rounded-lg animate-pulse mb-4" />
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 8 }).map((_, j) => (
                  <div key={j} className="w-14 h-14 bg-gray-50 rounded-xl animate-pulse" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : !wards.length ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21" />
          </svg>
          <p className="text-sm text-gray-400"><T k="등록된 병동이 없습니다." /></p>
        </div>
      ) : (
        <div className="space-y-4">
          {wards.map((ward: Ward) => (
            <div key={ward.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900">{ward.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{ward.floor}<Unit>층</Unit></p>
                </div>
                <div className="flex gap-2">
                  {ALL_STATUSES.map((s) => {
                    const count = ward.beds?.filter((b: Bed) => b.status === s).length ?? 0;
                    if (!count) return null;
                    return (
                      <span key={s} className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${STATUS_BADGE[s]}`}>
                        {STATUS_LABELS[s]} {count}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {ward.beds?.map((bed: Bed) => {
                  const occupant = bed.status === 'OCCUPIED' && bed.admissions?.[0]?.patient;
                  const admissionId = bed.admissions?.[0]?.id;
                  return (
                  <div key={bed.id} className="relative group">
                    <button
                      onClick={() => setSelectedBed(selectedBed === bed.id ? null : bed.id)}
                      className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center text-white text-[10px] font-medium transition-all hover:scale-105 hover:shadow-md ${STATUS_COLORS[bed.status]}`}
                      title={occupant ? `${occupant.familyName}${occupant.givenName} (${occupant.mrn})` : STATUS_LABELS[bed.status]}
                    >
                      <span className="font-bold text-xs">{bed.roomNumber}</span>
                      <span>{bed.bedNumber}</span>
                    </button>
                    {/* 환자 이름 툴팁 */}
                    {occupant && (
                      <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-gray-500 whitespace-nowrap">
                        {occupant.familyName}{occupant.givenName}
                      </div>
                    )}
                    {canChangeBed && selectedBed === bed.id && (
                      <div className="absolute top-full left-0 mt-1 z-20 bg-white rounded-xl border border-gray-200 shadow-lg py-1 min-w-[120px]">
                        {ALL_STATUSES.map((s) => (
                          <button
                            key={s}
                            disabled={bed.status === s || changeStatus.isPending}
                            onClick={() => changeStatus.mutate({ bedId: bed.id, status: s })}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2 disabled:opacity-40 ${bed.status === s ? 'font-bold' : ''}`}
                          >
                            <div className={`w-2.5 h-2.5 rounded ${STATUS_COLORS[s]}`} />
                            {STATUS_LABELS[s]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
