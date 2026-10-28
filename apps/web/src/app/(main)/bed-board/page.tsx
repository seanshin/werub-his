'use client';

import type React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FreshnessBadge } from '@/components/dashboard/FreshnessBadge';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';

import { RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { EmptyState, Ratio, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

type Ward = { name: string; total: number; occupied: number; available: number; reserved: number; maintenance: number; cleaning: number; isolation: number; occupancyRate: number | null };
type Resp = {
  summary: { totalBeds: number; occupied: number; available: number; occupancyRate: number | null; admitToday: number; dischargeToday: number; admittedTotal: number; longStay: number; avgLos: number | null };
  wards: Ward[];
};

function Stat({ label, value, tone }: { label: React.ReactNode; value: React.ReactNode; tone?: string }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone ?? 'border-gray-100 bg-white'}`}>
      <div className="text-xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}
// 🔴 산출 불가(null)는 색으로 판정하지 않는다 — 회색(모른다). 색만으로 말하지 않게 텍스트는 <Ratio> 가 '산출 불가'를 낸다
const rateTone = (r: number | null | undefined) => (r == null ? 'text-gray-500' : r >= 90 ? 'text-rose-600' : r >= 75 ? 'text-amber-600' : 'text-emerald-600');

export default function BedBoard() {
  const tAttr = useTAttr();
  const { data, isLoading, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['bed-board'],
    queryFn: () => apiClient.get<{ data: Resp }>('/api/v1/bed-board'),
    refetchInterval: pollMs('normal'),
  });
  const r = data?.data;
  const s = r?.summary;
  const wards = r?.wards ?? [];

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="병상·입원 보드" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="병동별 병상 가동률·금일 입퇴원·재원일수·장기재원 현황" /></p>
        </div>
        <FreshnessBadge updatedAt={dataUpdatedAt} isFetching={isFetching} staleMs={35000} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        {/* 🔴 등록 병상이 0이면 가동률은 0%(=여유 있음)가 아니라 산출 불가다 — 분모와 함께 낸다(§3.3) */}
        <Stat label={<T k="병상 가동률" />} value={<Ratio numerator={s?.occupied} denominator={s?.totalBeds} unavailableHint="등록 병상 0" />} tone="border-blue-200 bg-blue-50" />
        <Stat label={<T k="재원/가용" />} value={`${s?.occupied ?? 0} / ${s?.available ?? 0}`} />
        <Stat label={<T k="금일 입원 / 퇴원" />} value={`${s?.admitToday ?? 0} / ${s?.dischargeToday ?? 0}`} />
        <Stat label={<T k="장기재원(14일+)" />} value={`${s?.longStay ?? 0}명`} tone="border-amber-200 bg-amber-50" />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-bold text-gray-700"><T k="병동별 가동률" /> <span className="text-xs font-normal text-gray-400">(<T k="평균 재원" /> {s?.avgLos != null ? <>{s.avgLos}<Unit>일</Unit></> : <T k={RATIO_UNAVAILABLE} />})</span></div>
        {isLoading ? <div className="p-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
        : !wards.length ? <EmptyState icon="📊" title="병동 데이터가 없습니다." />
        : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] text-gray-400 text-left">
                <th className="px-4 py-2 font-medium"><T k="병동" /></th>
                <th className="px-3 py-2 font-medium"><T k="가동률" /></th>
                <th className="px-3 py-2 font-medium"><T k="재원@병상" /></th>
                <th className="px-3 py-2 font-medium"><T k="가용" /></th>
                <th className="px-3 py-2 font-medium"><T k="예약@병상" /></th>
                <th className="px-3 py-2 font-medium" title={tAttr('퇴원 후 청소·소독 대기 — 즉시 배정 불가')}><T k="청소@병상" /></th>
                <th className="px-3 py-2 font-medium"><T k="격리" /></th>
                <th className="px-3 py-2 font-medium"><T k="점검" /></th>
                <th className="px-3 py-2 font-medium"><T k="총" /></th>
              </tr>
            </thead>
            <tbody>
              {wards.map((w) => (
                <tr key={w.name} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{w.name}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 rounded-full bg-gray-100 overflow-hidden">{w.occupancyRate != null && <div className={`h-full ${w.occupancyRate >= 90 ? 'bg-rose-500' : w.occupancyRate >= 75 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${w.occupancyRate}%` }} />}</div>
                      {/* 🔴 병상이 0인 병동은 '0%' 가 아니라 산출 불가 — 정본 `<Ratio>` 가 판정한다 */}
                      <Ratio numerator={w.occupied} denominator={w.total} className={`font-semibold ${rateTone(w.occupancyRate)}`} unavailableHint="등록 병상 0" />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-gray-700">{w.occupied}</td>
                  <td className="px-3 py-2.5 text-emerald-600">{w.available}</td>
                  <td className="px-3 py-2.5 text-gray-500">{w.reserved}</td>
                  <td className="px-3 py-2.5 text-amber-600">{w.cleaning}</td>
                  <td className="px-3 py-2.5 text-gray-500">{w.isolation}</td>
                  <td className="px-3 py-2.5 text-gray-400">{w.maintenance}</td>
                  <td className="px-3 py-2.5 text-gray-500">{w.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
