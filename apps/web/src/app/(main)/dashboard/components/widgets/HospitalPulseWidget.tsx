'use client';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import Link from 'next/link';
import { pollMs } from '@/lib/ui-settings';
import { kstToday } from '@/lib/kst-today';
import { T } from '@/components/ui/i18n-text';

export default function HospitalPulseWidget() {
  const today = kstToday();
  // 서버 응답은 {total, byStatus, noShow, completed, ...} — 종전 평면 키(confirmed/checkedIn)는
  // 서버에 없어 확정·접수 칸이 항상 0 이었다(P11·2026-08-13)
  // 🔴 종전 `.catch(() => null)` + 칸마다 `?? 0` — 조회 실패가 "오늘 예약 0건·노쇼 0건"으로 둔갑했다(P17)
  const stats = useQuery({ queryKey: ['wt-appt-stats', today], queryFn: () => apiClient.get<{ data: { total?: number; byStatus?: Record<string, number>; completed?: number; noShow?: number } }>(`/api/v1/appointments/stats?dateFrom=${today}&dateTo=${today}`).then((r) => r.data), refetchInterval: pollMs('slow') });
  const s = stats.data ?? {};
  const by = (s as { byStatus?: Record<string, number> }).byStatus ?? {};
  const cell = (label: string, v?: number, cls = 'text-gray-800') => (
    <div className="flex-1 text-center"><div className={`text-lg font-bold ${cls}`}>{v ?? 0}</div><div className="text-[10px] text-gray-400"><T k={label} /></div></div>
  );
  return (
    <div className="flex flex-col h-full">
      {stats.isError && <p className="text-[11px] text-red-600 text-center pb-1"><T k="예약 통계 조회 실패 — 0건이 아니라 확인 불가" /></p>}
      <div className="flex items-stretch gap-1">
        {cell('전체 예약', s.total)}
        {cell('확정', by.CONFIRMED, 'text-blue-600')}
        {cell('접수', by.CHECKED_IN, 'text-amber-600')}
        {cell('완료', s.completed, 'text-emerald-600')}
        {cell('노쇼', s.noShow, 'text-red-500')}
      </div>
      <div className="mt-auto pt-2 flex gap-3 text-[11px]">
        <Link href="/schedule" className="text-blue-600 hover:underline"><T k="예약관리" /></Link>
        <Link href="/nursing-station" className="text-blue-600 hover:underline"><T k="병동 현황" /></Link>
      </div>
    </div>
  );
}
