'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Ratio } from '@/components/ui/display';
import { T, Tf, useTfAttr } from '@/components/ui/i18n-text';

/**
 * 시간대 혼잡 미니맵(기획 `schedule-timegrid-and-scale.plan.md` §4.2·§4.4 · P2) — 일 뷰 상단.
 *
 * 🔴 칸마다 분모(시간표 슬롯)를 함께 그린다. 시간표 없음·휴진·휴진 확인 필요 칸은 **비율을 내지 않는다**(0% 가 아니다).
 *    색 기준은 일 뷰 레인 정원 표시(`DayTimeGrid` nearFull)와 같다 — 80% 이상 주황·100% 이상 빨강.
 *    조회 실패는 "불러오지 못했습니다"로 말한다(빈 막대로 그리지 않는다).
 */
export type HeatmapCellState = 'SCHEDULED' | 'NEEDS_REVIEW' | 'CLOSED' | 'NO_SCHEDULE';
export interface HeatmapCell { hour: number; label: string; booked: number; capacity: number | null; closedSlots: number; reviewSlots: number; state: HeatmapCellState }
export interface HeatmapData {
  date: string;
  slotMinutes: number;
  excludedStatuses: string[];
  scheduleCount: number;
  cells: HeatmapCell[];
  totals: { booked: number; capacity: number; bookedOutsideSchedule: number };
}

/** 칸 색 — 순수 함수(테스트 대상). 비율을 낼 수 없는 칸은 상태색만 */
export function heatmapCellTone(c: HeatmapCell): string {
  if (c.state === 'CLOSED') return 'bg-gray-300 text-gray-700';
  if (c.state === 'NEEDS_REVIEW') return 'bg-amber-50 text-amber-700 border border-dashed border-amber-400';
  if (c.state === 'NO_SCHEDULE') return c.booked > 0 ? 'bg-white text-red-600 border border-dashed border-red-300' : 'bg-white text-gray-400 border border-dashed border-gray-200';
  const cap = c.capacity ?? 0;
  if (cap <= 0) return 'bg-white text-gray-400';
  const r = c.booked / cap;
  if (r >= 1) return 'bg-red-500 text-white';
  if (r >= 0.8) return 'bg-amber-400 text-white';
  if (r >= 0.5) return 'bg-blue-400 text-white';
  if (r > 0) return 'bg-blue-100 text-blue-800';
  return 'bg-gray-50 text-gray-500';
}

export default function HourHeatmapStrip({ date, departmentName }: { date: string; departmentName?: string }) {
  const tfAttr = useTfAttr();
  const q = useQuery({
    queryKey: ['appointments', 'heatmap', date, departmentName ?? ''],
    queryFn: async () => {
      const params = new URLSearchParams({ date, by: 'hour' });
      if (departmentName) params.set('departmentName', departmentName);
      const res = await apiClient.get<{ data: HeatmapData }>(`/api/v1/appointments/heatmap?${params.toString()}`);
      return res.data;
    },
  });

  if (q.isLoading) {
    return <div className="mb-3 text-xs text-gray-400" data-heatmap="loading"><T k="불러오는 중..." /></div>;
  }
  if (q.isError || !q.data) {
    return (
      <div className="mb-3 flex items-center gap-2 text-xs text-red-600" data-heatmap="error">
        <T k="시간대 혼잡도를 불러오지 못했습니다." />
        <button type="button" onClick={() => q.refetch()} className="underline"><T k="다시 시도" /></button>
      </div>
    );
  }

  const d = q.data;
  // 합계 비율의 분자는 분모가 있는 칸(SCHEDULED)의 예약만 — 휴진·확인 필요·시간표 없음 칸의 예약을 섞으면 비율이 부푼다
  const scheduledBooked = d.cells.filter((c) => c.state === 'SCHEDULED').reduce((n, c) => n + c.booked, 0);
  if (d.cells.length === 0) {
    return (
      <p className="mb-3 text-xs text-gray-500" data-heatmap="empty">
        <T k="이 날짜에는 진료 시간표도 예약도 없어 시간대 혼잡도를 산출할 수 없습니다." />
      </p>
    );
  }

  return (
    <section className="mb-3 rounded-xl border border-gray-100 bg-white p-3" data-heatmap="ready">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-semibold text-gray-700"><T k="시간대 혼잡" /></span>
        <span className="text-gray-500">
          <T k="하루 합계" /> <Ratio numerator={scheduledBooked} denominator={d.totals.capacity} unavailableHint="시간표 슬롯 없음" />
        </span>
        {d.totals.bookedOutsideSchedule > 0 && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-600">
            <Tf k="시간표 밖 예약 {건수}건" params={{ 건수: d.totals.bookedOutsideSchedule }} />
          </span>
        )}
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {d.cells.map((c) => (
          <div
            key={c.hour}
            className={`min-w-[3.25rem] shrink-0 rounded-md px-1.5 py-1 text-center text-[11px] leading-tight ${heatmapCellTone(c)}`}
            data-heatmap-state={c.state}
            title={c.state === 'SCHEDULED'
              ? tfAttr('{시각} · 예약 {예약} / 슬롯 {슬롯}', { 시각: c.label, 예약: c.booked, 슬롯: c.capacity ?? 0 })
              : tfAttr('{시각} · 예약 {예약}', { 시각: c.label, 예약: c.booked })}
          >
            <div className="font-medium tabular-nums">{c.label}</div>
            {c.state === 'SCHEDULED' ? (
              <div className="tabular-nums">{c.booked}/{c.capacity}</div>
            ) : c.state === 'CLOSED' ? (
              <div><T k="휴진" /></div>
            ) : c.state === 'NEEDS_REVIEW' ? (
              <div><T k="휴진 확인 필요" /></div>
            ) : (
              <div>{c.booked > 0 ? <Tf k="시간표 없음 · {건수}" params={{ 건수: c.booked }} /> : <T k="시간표 없음" />}</div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-gray-400">
        <Tf k="칸 = 그 시에 시작하는 예약 수 / 시간표 슬롯({분}분 단위·휴진 제외) · 취소·노쇼 제외" params={{ 분: d.slotMinutes }} />
      </p>
    </section>
  );
}
