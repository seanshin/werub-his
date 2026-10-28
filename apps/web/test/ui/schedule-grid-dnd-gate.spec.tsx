/**
 * 🔴 (2026-09-14 P6) 예약 일 뷰 드래그 이동이 기획 게이트 `schedule.grid.dnd`(기본 OFF · schedule-timegrid §7 P3) 없이 켜져 있었다.
 * 지키는 것: ① 설정 false 면 끌 수 있는 블록이 없고 "꺼짐(설정)"을 말한다 ② 조회 실패도 끄고 "확인하지 못했다"를 말한다
 *           ③ 대조군 — 설정 true 면 이동 가능한 상태의 블록은 끌 수 있다 ④ 서버 기본값이 false 다
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/useAppointments', () => ({
  useConfirmAppointment: () => ({ mutateAsync: vi.fn() }),
  useChangeAppointmentStatus: () => ({ mutateAsync: vi.fn() }),
  useNoShowAppointment: () => ({ mutateAsync: vi.fn() }),
  useUpdateAppointment: () => ({ mutateAsync: vi.fn() }),
}));

const get = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a) } }));

const DAY = {
  date: '2026-09-15', dayOfWeek: 2, workStart: '08:00', workEnd: '19:00', coreStart: '09:00', coreEnd: '18:00', groupBy: 'doctor',
  lanes: [{
    laneKey: 'd1', title: '김의사', subtitle: '내과', doctorId: 'd1', departmentName: '내과', booked: 1, maxPatients: 20,
    sessions: [{ startTime: '09:00', endTime: '12:00', maxPatients: 10, closed: false }],
    appointments: [{ id: 'a1', patientId: 'p1', scheduledAt: '2026-09-15T01:00:00.000Z', duration: 30, status: 'SCHEDULED', type: 'FIRST_VISIT', patientName: '홍길동', mrn: 'M1' }],
  }],
};

function mount(dnd: 'true' | 'false' | 'error') {
  get.mockImplementation((url: string) => {
    if (url.includes('/api/v1/config/schedule.grid.dnd')) {
      if (dnd === 'error') return Promise.reject(new Error('boom'));
      return Promise.resolve({ data: dnd === 'true', meta: { source: 'db' } });
    }
    return Promise.resolve({ data: DAY });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return import('@/app/(main)/schedule/_components/DayTimeGrid').then(({ default: DayTimeGrid }) =>
    render(<QueryClientProvider client={qc}><DayTimeGrid date="2026-09-15" onEmptySlot={() => {}} /></QueryClientProvider>));
}

const draggables = (c: HTMLElement) => c.querySelectorAll('[draggable="true"]').length;

describe('예약 일 뷰 드래그 이동 — 설정 게이트', () => {
  afterEach(() => { get.mockReset(); });

  it('① 설정 false → 끌 수 있는 블록 0 · "꺼짐(설정)" 표시', async () => {
    const { container } = await mount('false');
    await waitFor(() => expect(screen.getByText(/드래그 이동 꺼짐|Drag-to-move is off/)).toBeTruthy());
    expect(container.querySelector('[title*="홍길동"]')).toBeTruthy();
    expect(draggables(container)).toBe(0);
  });

  it('② 조회 실패 → 끄고 "확인하지 못했다" 표시', async () => {
    const { container } = await mount('error');
    await waitFor(() => expect(screen.getByText(/확인하지 못해|Could not check/)).toBeTruthy());
    expect(draggables(container)).toBe(0);
  });

  it('③ 대조군 — 설정 true → 이동 가능한 블록은 끌 수 있다', async () => {
    const { container } = await mount('true');
    await waitFor(() => expect(draggables(container)).toBe(1));
    expect(screen.queryByText(/드래그 이동 꺼짐|Drag-to-move is off/)).toBeNull();
  });

  it('④ 서버 기본값이 false 다', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../api/src/modules/config/config-runtime.service.ts'), 'utf8');
    expect(src).toMatch(/'schedule\.grid\.dnd':\s*\{\s*key:\s*'schedule\.grid\.dnd',\s*value:\s*false/);
  });
});
