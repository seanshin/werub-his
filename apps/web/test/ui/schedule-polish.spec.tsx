/**
 * 예약 관리 정돈(2026-09-29 "세련되게 정리") — 모양을 고치다 드러난 사실 결함을 못박는다.
 *  1. 🔴 달력 조회 실패가 모든 날 '예약 없음'으로 그려졌다(isError 미확인)
 *  2. 🔴 이번 달 통계 조회 실패면 카드가 조용히 사라졌다
 *  3. 취소·노쇼가 한 번에 눌렸다(카드가 필터 밖으로 즉시 사라져 무엇을 눌렀는지 모른다)
 *  4. 목록 보기에서 이동 버튼이 사라져 다른 달을 볼 수 없었다
 *  5. 상태 필터가 배지와 다른 이름('신청(확정대기)'·'노쇼' vs '예약'·'미내원') — 정본 하나로
 *  6. 노쇼·취소는 고르기 전엔 불러오지 않는다 — 그 칩에 0 을 그리지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const patch = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a), post: (...a: unknown[]) => post(...a), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/schedule', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const at = (h: number) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const APPTS = [
  { id: 's1', scheduledAt: at(9), status: 'SCHEDULED', type: 'INITIAL', duration: 15, patientId: 'p1', patient: { familyName: '김', givenName: '예약' } },
  { id: 'c1', scheduledAt: at(10), status: 'CONFIRMED', type: 'FOLLOW_UP', duration: 15, patientId: 'p2', patient: { familyName: '박', givenName: '확정' } },
];
function route(url: string) {
  if (url.startsWith('/api/v1/appointments/stats')) return Promise.resolve({ data: { total: 10, completed: 5, noShow: 1, noShowRate: 16.7, noShowDenominator: 6, byStatus: {} } });
  if (url === '/api/v1/appointments/calendar') return Promise.resolve({ data: APPTS });
  return Promise.resolve({ data: [] });
}
async function mount() {
  const { default: Page } = await import('@/app/(main)/schedule/page');
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Page /></QueryClientProvider>);
}

beforeEach(() => { cleanup(); get.mockReset(); patch.mockReset(); post.mockReset(); get.mockImplementation(route); patch.mockResolvedValue({ data: {} }); post.mockResolvedValue({ data: {} }); });

describe('예약 관리', () => {
  it('🔴 달력 조회 실패는 실패로 — 모든 날 "예약 없음"이 아니다', async () => {
    get.mockImplementation((url: string) => (url === '/api/v1/appointments/calendar' ? Promise.reject(new Error('500')) : route(url)));
    const { container } = await mount();
    expect(await screen.findByText('다시 시도', {}, { timeout: 10000 })).toBeTruthy();
    expect(container.textContent).not.toContain('예약 없음');
  }, 15000); // 2026-10-10 전체 실행 부하에서 재시도 지연이 4초 대기를 넘겨 두 번 연속 시간 초과(단독 실행은 통과)

  it('🔴 통계 조회 실패는 사라지지 않고 실패로 말한다', async () => {
    get.mockImplementation((url: string) => (url.startsWith('/api/v1/appointments/stats') ? Promise.reject(new Error('500')) : route(url)));
    const { container } = await mount();
    await screen.findAllByText(/다시 시도|재시도/);
    expect(container.querySelector('[data-schedule-kpis]')).toBeNull();
  });

  it('노쇼율에는 분모를 함께 쓴다', async () => {
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-schedule-kpis]')?.textContent).toContain('16.7%'));
    expect(container.querySelector('[data-schedule-kpis]')!.textContent).toMatch(/분모\s*6/);
  });

  it('취소·노쇼는 확인을 거친다 · 확인하면 나간다(대조군)', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await mount();
    const card = await vi.waitFor(() => { const el = document.querySelector('[data-apt-card="c1"]'); if (!el) throw new Error('no card'); return el as HTMLElement; });
    fireEvent.click([...card.querySelectorAll('button')].find((b) => b.textContent === '취소')!);
    fireEvent.click([...card.querySelectorAll('button')].find((b) => b.textContent === '노쇼')!);
    expect(confirm).toHaveBeenCalledTimes(2);
    await new Promise((r) => setTimeout(r, 30));
    expect(patch).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click([...card.querySelectorAll('button')].find((b) => b.textContent === '노쇼')!);
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/appointments/c1/no-show'));
    confirm.mockRestore();
  });

  it('목록 보기에도 이동 버튼이 있다(다른 달을 볼 수 있다)', async () => {
    const { container } = await mount();
    fireEvent.click(await screen.findByRole('tab', { name: '목록' }));
    expect(container.querySelector('[data-schedule-nav]')).toBeTruthy();
  });

  it('상태 칩은 배지와 같은 이름 · 불러오지 않은 노쇼·취소엔 수를 그리지 않는다', async () => {
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-status-chip="SCHEDULED"]')?.textContent).toMatch(/예약\s*1/));
    expect(container.textContent).not.toContain('신청(확정대기)');
    expect(container.querySelector('[data-status-chip="NO_SHOW"]')!.textContent).toBe('미내원');
    expect(container.querySelector('[data-status-chip="CANCELLED"]')!.textContent).toBe('취소');
  });
});
