/**
 * 시간대 혼잡 미니맵(schedule-timegrid P2 · `GET /appointments/heatmap`) — 일 뷰 상단.
 * 지키는 것: ① 칸이 예약/슬롯(분모)을 함께 그린다 ② 휴진·시간표 없음·확인 필요 칸은 비율·분수를 그리지 않는다
 *           ③ 시간표 밖 예약을 숨기지 않는다 ④ 조회 실패는 "불러오지 못했습니다"(빈 막대 금지) ⑤ 칸 0개면 산출 불가 문장
 *           ⑥ 색 기준이 일 뷰 정원 표시와 같다(80% 주황·100% 빨강) ⑦ 일 뷰에 실제로 붙어 있다
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a) } }));

const BASE = { date: '2026-09-15', slotMinutes: 30, excludedStatuses: ['CANCELLED', 'NO_SHOW'], scheduleCount: 2 };
const READY = {
  ...BASE,
  cells: [
    { hour: 9, label: '09:00', booked: 3, capacity: 4, closedSlots: 0, reviewSlots: 0, state: 'SCHEDULED' },
    { hour: 10, label: '10:00', booked: 0, capacity: null, closedSlots: 2, reviewSlots: 0, state: 'CLOSED' },
    { hour: 13, label: '13:00', booked: 2, capacity: null, closedSlots: 0, reviewSlots: 0, state: 'NO_SCHEDULE' },
    { hour: 14, label: '14:00', booked: 0, capacity: null, closedSlots: 0, reviewSlots: 2, state: 'NEEDS_REVIEW' },
  ],
  totals: { booked: 5, capacity: 4, bookedOutsideSchedule: 2 },
};

async function mount(reply: () => Promise<unknown>) {
  get.mockImplementation(reply);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { default: HourHeatmapStrip } = await import('@/app/(main)/schedule/_components/HourHeatmapStrip');
  return render(<QueryClientProvider client={qc}><HourHeatmapStrip date="2026-09-15" departmentName="내과" /></QueryClientProvider>);
}

describe('시간대 혼잡 미니맵', () => {
  afterEach(() => { get.mockReset(); });

  it('① 칸이 예약/슬롯을 함께 그리고 ② 분모 없는 칸은 분수를 그리지 않는다 · ③ 시간표 밖 예약을 말한다', async () => {
    const { container } = await mount(() => Promise.resolve({ data: READY }));
    await waitFor(() => expect(container.querySelector('[data-heatmap="ready"]')).toBeTruthy());
    const cell = (s: string) => container.querySelector(`[data-heatmap-state="${s}"]`) as HTMLElement;
    expect(cell('SCHEDULED').textContent).toContain('3/4');
    for (const s of ['CLOSED', 'NO_SCHEDULE', 'NEEDS_REVIEW']) {
      expect(cell(s).textContent).not.toMatch(/\d+\/\d+|%/);
    }
    expect(cell('NO_SCHEDULE').textContent).toMatch(/2/);
    expect(screen.getByText(/시간표 밖 예약|outside the schedule/)).toBeTruthy();
    expect(get.mock.calls[0][0]).toContain('/api/v1/appointments/heatmap?');
    expect(get.mock.calls[0][0]).toContain('departmentName=');
  });

  it('④ 조회 실패는 "불러오지 못했습니다" — 빈 막대로 그리지 않는다', async () => {
    const { container } = await mount(() => Promise.reject(new Error('boom')));
    await waitFor(() => expect(container.querySelector('[data-heatmap="error"]')).toBeTruthy());
    expect(container.querySelector('[data-heatmap-state]')).toBeNull();
  });

  it('⑤ 칸 0개면 산출 불가 문장(0% 막대를 지어내지 않는다)', async () => {
    const { container } = await mount(() => Promise.resolve({ data: { ...BASE, cells: [], totals: { booked: 0, capacity: 0, bookedOutsideSchedule: 0 } } }));
    await waitFor(() => expect(container.querySelector('[data-heatmap="empty"]')).toBeTruthy());
    expect(container.querySelector('[data-heatmap-state]')).toBeNull();
  });

  it('⑥ 색 기준 — 80% 이상 주황·100% 이상 빨강·분모 없는 칸은 비율색이 아니다', async () => {
    const { heatmapCellTone } = await import('@/app/(main)/schedule/_components/HourHeatmapStrip');
    const c = (booked: number, capacity: number | null, state = 'SCHEDULED') => ({ hour: 9, label: '09:00', booked, capacity, closedSlots: 0, reviewSlots: 0, state } as never);
    expect(heatmapCellTone(c(10, 10))).toContain('bg-red-500');
    expect(heatmapCellTone(c(8, 10))).toContain('bg-amber-400');
    expect(heatmapCellTone(c(7, 10))).not.toMatch(/red-500|amber-400/);
    expect(heatmapCellTone(c(5, null, 'NO_SCHEDULE'))).not.toMatch(/red-500|amber-400|blue-400/);
  });

  it('⑦ 일 뷰(page.tsx)가 미니맵을 DayTimeGrid 위에 그린다', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/app/(main)/schedule/page.tsx'), 'utf8');
    const i = src.indexOf('<HourHeatmapStrip');
    const j = src.indexOf('<DayTimeGrid');
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
  });
});
