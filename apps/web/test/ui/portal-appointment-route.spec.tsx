/**
 * 포털 B1 남은 몫 — 예약 진료실 가는 길(접수 전 · 2026-10-26).
 *  · 펼치기 전에는 부르지 않는다
 *  · 🔴 진료실은 진료표 기준 "예정"(접수 때 바뀔 수 있음)이라고 말한다 · 진료표에 없으면 진료실을 지어내지 않는다
 *  · 🔴 먼저 접수 — 창구는 서버가 준 전부(하나를 고르지 않음) · 없으면 없다고
 *  · 경로를 못 구하면 이유 · 🔴 조회 실패 ≠ 경로 없음 · 접수 뒤면 대기표 길안내로
 *  · 출발 출입구·엘리베이터 선택이 요청에 실린다 · 예약 카드(CareTab)에 붙어 있다(구조)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, act, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

const api = vi.hoisted(() => ({ get: vi.fn(async (_url: string): Promise<unknown> => ({ data: null })), post: vi.fn(), put: vi.fn(), getToken: () => 't', setToken: vi.fn() }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));

const wrap = (el: ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{el}</QueryClientProvider>);
beforeEach(() => { cleanup(); api.get.mockReset(); });

const ENTRANCES = [{ id: 'E1', name: '정문', floor: '1F', main: true }, { id: 'E2', name: '후문', floor: '1F', main: false }];
const BASE = {
  appointmentId: 'a1', checkedIn: false, scheduledAt: '2026-10-27T05:30:00Z', departmentName: '내과',
  room: { name: '내과 1진료실', basis: 'CLINIC_SCHEDULE' },
  receptions: [{ name: '검진 접수', floor: -1 }, { name: '접수/원무', floor: 1 }],
  route: { available: true, walkM: 42, steps: [{ kind: 'START', space: '정문' }, { kind: 'ARRIVE', floor: '2F', space: '내과 1진료실' }], segments: [], floors: [], entrances: ENTRANCES },
};

async function mount(data: unknown, opts: { reject?: boolean } = {}) {
  api.get.mockImplementation(async () => { if (opts.reject) throw new Error('500'); return { data }; });
  const { AppointmentRoutePanel } = await import('@/app/portal/_care/AppointmentRoutePanel');
  let v!: ReturnType<typeof render>;
  await act(async () => { v = wrap(<AppointmentRoutePanel appointmentId="a1" />); });
  return v;
}
const open = (v: ReturnType<typeof render>) => fireEvent.click(v.container.querySelector('[data-portal-route-toggle]')!);

describe('🔴 예약 진료실 가는 길', () => {
  it('펼치기 전 미호출 · 펼치면 예약 경로 EP', async () => {
    const v = await mount(BASE);
    expect(api.get).not.toHaveBeenCalled();
    open(v);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/v1/portal/appointments/a1/route'));
  });
  it('예정 진료실 + "접수 때 바뀔 수 있음" · 접수 창구 전부 · 걷는 거리·단계', async () => {
    const v = await mount(BASE);
    open(v);
    await waitFor(() => expect(v.container.querySelector('[data-portal-route-available]')).not.toBeNull());
    expect(v.container.querySelector('[data-portal-route-room]')!.getAttribute('data-portal-route-room')).toBe('내과 1진료실');
    expect(v.container.querySelector('[data-portal-route-room-basis]')!.textContent).toContain('바뀔 수 있습니다');
    const rec = v.container.querySelector('[data-portal-route-receptions]')!.textContent!;
    expect(rec).toContain('B1 검진 접수');
    expect(rec).toContain('1F 접수/원무');
    expect(v.container.textContent).toContain('42m');
  });
  it('🔴 진료표에 없으면 진료실을 지어내지 않는다 — "아직 정해지지 않음" · 이유 · 예정 문구 없음', async () => {
    const v = await mount({ ...BASE, room: null, route: { available: false, reason: 'ROOM_NOT_ASSIGNED', entrances: ENTRANCES } });
    open(v);
    await waitFor(() => expect(v.container.querySelector('[data-portal-route-reason]')).not.toBeNull());
    expect(v.container.querySelector('[data-portal-route-room]')!.getAttribute('data-portal-route-room')).toBe('UNKNOWN');
    expect(v.container.querySelector('[data-portal-route-room-basis]')).toBeNull();
    expect(v.container.querySelector('[data-portal-route-reason]')!.getAttribute('data-portal-route-reason')).toBe('ROOM_NOT_ASSIGNED');
    expect(v.container.querySelector('[data-portal-route-available]')).toBeNull();
  });
  it('접수 창구가 없으면 없다고(지어내지 않음)', async () => {
    const v = await mount({ ...BASE, receptions: [] });
    open(v);
    await waitFor(() => expect(v.container.querySelector('[data-portal-route-receptions-none]')).not.toBeNull());
  });
  it('🔴 조회 실패는 실패라고 — 경로 없음·이유로 그리지 않는다', async () => {
    const v = await mount(null, { reject: true });
    open(v);
    await waitFor(() => expect(v.container.querySelector('[data-portal-route-error]')).not.toBeNull());
    expect(v.container.querySelector('[data-portal-route-reason]')).toBeNull();
  });
  it('접수 뒤 → 대기표 길안내 링크만', async () => {
    const v = await mount({ appointmentId: 'a1', checkedIn: true, queueId: 'q9' });
    open(v);
    await waitFor(() => expect(v.container.querySelector('[data-portal-route-queue-guide]')).not.toBeNull());
    expect(v.container.querySelector('[data-portal-route-queue-guide]')!.getAttribute('href')).toBe('/guide/q9');
    expect(v.container.querySelector('[data-portal-route-receptions]')).toBeNull();
  });
  it('출발 출입구·엘리베이터 선택이 요청에 실린다', async () => {
    const v = await mount(BASE);
    open(v);
    await waitFor(() => expect(v.container.querySelector('[data-portal-route-origin]')).not.toBeNull());
    fireEvent.change(v.container.querySelector('[data-portal-route-origin]')!, { target: { value: 'E2' } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/v1/portal/appointments/a1/route?origin=E2'));
    fireEvent.click(v.container.querySelector('[data-portal-route-accessible]')!);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/v1/portal/appointments/a1/route?origin=E2&accessible=1'));
  });
  it('예약 카드(예정·확정)에 붙어 있다 · 대기표 화면도 같은 도면 부품(구조)', () => {
    const care = readFileSync(join(__dirname, '../../src/app/portal/_care/CareTab.tsx'), 'utf8');
    expect(care).toMatch(/\(a\.status === 'SCHEDULED' \|\| a\.status === 'CONFIRMED'\) && <AppointmentRoutePanel appointmentId=\{a\.id\} \/>/);
    const guide = readFileSync(join(__dirname, '../../src/app/guide/[id]/page.tsx'), 'utf8');
    expect(guide).toMatch(/<RouteFloorPlans /);
  });
});
