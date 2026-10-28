import { classifyClosureImpact } from '../clinic-schedule/closure-impact';

/**
 * 시간대 혼잡 히트맵(기획 `schedule-timegrid-and-scale.plan.md` §4.4·§5 `GET /appointments/heatmap` · P2) — 순수 함수.
 *
 * 🔴 칸마다 **분모를 함께** 준다 — 비율만 그리면 "시간표가 없는 시간"과 "한가한 시간"이 같은 0% 로 보인다.
 *  - 분자 `booked`   = 그 시(KST)에 **시작하는** 예약 수. CANCELLED·NO_SHOW 는 제외(가용 슬롯·정원 판정 `getAvailability`·
 *                      `validateBookable` 과 같은 규칙 — 범례가 이 사실을 말한다).
 *  - 분모 `capacity` = 그 시에 **시작하는 시간표 슬롯 수**(진료 시간표 × `SLOT_MINUTES` 단위, 가용 슬롯 EP 와 같은 슬롯 생성).
 *                      휴진에 닿는 슬롯은 빼고(판정 정본 `clinic-schedule/closure-impact.ts`), 휴진 반나절 여부를 시간표가
 *                      말하지 못하는 슬롯(NEEDS_REVIEW)도 분모에 넣지 않고 `reviewSlots` 로 따로 센다(추측해 넣지도 빼지도 않는다).
 *  - 상태: 쓸 수 있는 슬롯이 있으면 `SCHEDULED`(비율 산출) · 없고 확인 필요 슬롯만 있으면 `NEEDS_REVIEW` ·
 *          휴진 슬롯만 있으면 `CLOSED` · 슬롯이 하나도 없으면 `NO_SCHEDULE` — 뒤의 셋은 **비율을 내지 않는다**(0% 가 아니다).
 * 예약이 시간표 밖(예: 시간표 없는 시)에 있으면 그 칸은 `NO_SCHEDULE` 이지만 `booked` 는 그대로 보인다(숨기지 않는다 — 안전).
 */
export const HEATMAP_SLOT_MINUTES = 30;
export const HEATMAP_EXCLUDED_STATUSES = ['CANCELLED', 'NO_SHOW'] as const;

export type HeatmapCellState = 'SCHEDULED' | 'NEEDS_REVIEW' | 'CLOSED' | 'NO_SCHEDULE';

export interface HeatmapCell {
  hour: number;
  /** 'HH:00' — KST */
  label: string;
  booked: number;
  /** 분모 — 휴진·확인 필요를 뺀 시간표 슬롯 수. 상태가 SCHEDULED 가 아니면 null */
  capacity: number | null;
  closedSlots: number;
  reviewSlots: number;
  state: HeatmapCellState;
}

export interface HeatmapInput {
  date: string; // YYYY-MM-DD (KST 달력)
  schedules: Array<{ doctorId: string; period: string; startTime: string; endTime: string }>;
  closures: Array<{ id: string; doctorId: string; period: string | null }>;
  appointments: Array<{ doctorId: string; scheduledAt: Date }>;
}

const kstHour = (d: Date) => new Date(d.getTime() + 9 * 3600000).getUTCHours();

export function buildHourHeatmap(input: HeatmapInput): {
  slotMinutes: number;
  excludedStatuses: readonly string[];
  cells: HeatmapCell[];
  totals: { booked: number; capacity: number; bookedOutsideSchedule: number };
} {
  const acc = new Map<number, { booked: number; open: number; closed: number; review: number }>();
  const cell = (h: number) => {
    let c = acc.get(h);
    if (!c) { c = { booked: 0, open: 0, closed: 0, review: 0 }; acc.set(h, c); }
    return c;
  };

  const step = HEATMAP_SLOT_MINUTES * 60000;
  for (const s of input.schedules) {
    const doctorClosures = input.closures.filter((c) => c.doctorId === s.doctorId).map((c) => ({ id: c.id, period: c.period }));
    const doctorSchedules = input.schedules
      .filter((x) => x.doctorId === s.doctorId)
      .map((x) => ({ period: x.period, startTime: x.startTime, endTime: x.endTime }));
    const sStart = new Date(`${input.date}T${s.startTime}:00+09:00`).getTime();
    const sEnd = new Date(`${input.date}T${s.endTime}:00+09:00`).getTime();
    for (let t = sStart; t + step <= sEnd; t += step) {
      const slotAt = new Date(t);
      const verdict = classifyClosureImpact(
        { dateKey: input.date, scheduledAt: slotAt, durationMinutes: HEATMAP_SLOT_MINUTES },
        doctorClosures,
        doctorSchedules,
      );
      const c = cell(kstHour(slotAt));
      if (verdict.kind === 'AFFECTED') c.closed += 1;
      else if (verdict.kind === 'NEEDS_REVIEW') c.review += 1;
      else c.open += 1;
    }
  }

  for (const a of input.appointments) cell(kstHour(a.scheduledAt)).booked += 1;

  let booked = 0;
  let capacity = 0;
  let bookedOutsideSchedule = 0;
  const cells: HeatmapCell[] = [...acc.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([hour, c]) => {
      const state: HeatmapCellState = c.open > 0 ? 'SCHEDULED' : c.review > 0 ? 'NEEDS_REVIEW' : c.closed > 0 ? 'CLOSED' : 'NO_SCHEDULE';
      booked += c.booked;
      if (state === 'SCHEDULED') capacity += c.open;
      if (state === 'NO_SCHEDULE') bookedOutsideSchedule += c.booked;
      return {
        hour,
        label: `${String(hour).padStart(2, '0')}:00`,
        booked: c.booked,
        capacity: state === 'SCHEDULED' ? c.open : null,
        closedSlots: c.closed,
        reviewSlots: c.review,
        state,
      };
    });

  return { slotMinutes: HEATMAP_SLOT_MINUTES, excludedStatuses: HEATMAP_EXCLUDED_STATUSES, cells, totals: { booked, capacity, bookedOutsideSchedule } };
}
