/**
 * 진료실 대기 정돈(2026-09-29 "세련되게 디자인") — 모양을 고치다 드러난 사실 결함을 못박는다.
 *  1. 🔴 '다음 호출'이 `waiting[0]` 이라 **접수 시각이 아직 오지 않은 예약(도착 전)** 이 순번상 앞이면 오지 않은 사람을 불렀다
 *  2. 🔴 예약 시각 표시가 `kdate(숫자)` → Invalid → "예약 -" — 한 번도 시각이 안 보였다
 *  3. 현재 환자 '노쇼'가 확인 없이 한 번에 눌렸다
 *  4. '다음 호출' 줄이 `fixed left-1/2`(창 가운데)라 다른 패널을 덮었다 — 이제 열 안의 바닥 줄
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a), post: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/clinic-queue', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@/lib/use-departments', () => ({ useDepartments: () => ({ names: ['내과'], isError: false, refetch: vi.fn() }), DeptLoadError: () => null }));
vi.mock('@/lib/sse-signal', () => ({ subscribeSseSignal: () => () => {} }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const authState = { user: { id: 'u1', role: 'ADMIN', familyName: '김', givenName: '관리', department: '' } };
vi.mock('@/stores/auth-store', () => {
  const useAuthStore = (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState);
  (useAuthStore as unknown as { getState: () => unknown }).getState = () => authState;
  return { useAuthStore };
});

const now = Date.now();
const iso = (minFromNow: number) => new Date(now + minFromNow * 60000).toISOString();
let ROWS: Record<string, unknown>[] = [];

function route(url: string) {
  if (url === '/api/v1/queue' || url === '/api/v1/queue/my') return Promise.resolve({ data: { data: ROWS } });
  if (url === '/api/v1/care-teams/my') return Promise.resolve({ data: null });
  return Promise.resolve({ data: [] });
}
async function mount() {
  const { default: Page } = await import('@/app/(main)/clinic-queue/page');
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Page /></QueryClientProvider>);
}

beforeEach(() => {
  cleanup(); get.mockReset(); patch.mockReset(); get.mockImplementation(route); patch.mockResolvedValue({ data: {} });
  ROWS = [
    // 순번 2 는 **도착 전 예약**(접수 시각 미래) — 순번이 가장 앞이지만 다음 호출 대상이 아니다
    { id: 'sch', queueNumber: 2, patientId: 'p2', status: 'WAITING', visitType: 'FOLLOW_UP', checkedInAt: iso(90), isScheduled: true, patient: { familyName: '최', givenName: '예약' } },
    { id: 'now1', queueNumber: 5, patientId: 'p5', status: 'WAITING', visitType: 'INITIAL', checkedInAt: iso(-20), isScheduled: false, patient: { familyName: '김', givenName: '지금' } },
  ];
});

describe('진료실 대기', () => {
  it('🔴 다음 호출은 지금 기다리는 첫 사람이다(도착 전 예약을 부르지 않는다)', async () => {
    const { container } = await mount();
    await screen.findAllByText('지금', { exact: false });
    const bar = container.querySelector('[data-next-call-bar]')!;
    expect(bar.textContent).toContain('#5');
    expect(bar.textContent).not.toContain('#2');
    expect(container.querySelector('[data-next-badge]')?.closest('tr')?.getAttribute('data-queue-row')).toBe('now1');
    // 도착 전 예약은 따로 모인다
    expect(container.querySelector('[data-scheduled-section] [data-queue-row="sch"]')).toBeTruthy();
  });

  it('🔴 예약 시각이 "예약 -" 가 아니라 시각으로 보인다', async () => {
    const { container } = await mount();
    await screen.findAllByText('예약', { exact: false });
    const row = container.querySelector('[data-queue-row="sch"]')!;
    expect(row.textContent).toMatch(/예약\s*\d{1,2}:\d{2}/);
    expect(row.textContent).not.toMatch(/예약\s*-/);
  });

  it('현재 환자 노쇼는 확인을 거친다 · 확인하면 나간다(대조군)', async () => {
    ROWS = [{ id: 'cur', queueNumber: 1, patientId: 'p1', status: 'IN_CONSULTATION', visitType: 'INITIAL', checkedInAt: iso(-30), startedAt: iso(-5), patient: { familyName: '오', givenName: '현재' } }];
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await mount();
    fireEvent.click(await screen.findByText('노쇼'));
    expect(confirm).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(patch).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByText('노쇼'));
    await vi.waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/queue/cur/no-show'));
    confirm.mockRestore();
  });

  it('구조 — 다음 호출 줄은 창 가운데 fixed 가 아니다(다른 패널을 덮지 않는다)', () => {
    const src = readFileSync(join(__dirname, '../../src/app/(main)/clinic-queue/page.tsx'), 'utf8');
    expect(src).not.toMatch(/fixed bottom-6 left-1\/2/);
    expect(src).toMatch(/const firstWaiting = waitingNow\[0\]/);
  });
});
