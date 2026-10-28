/**
 * 환자 관리 정돈(2026-09-29 "세련되게 정리") — 모양을 고치다 드러난 사실 결함을 못박는다.
 *  1. 🔴 페이지 수가 `total / 20` 고정 — 넓은 화면(페이지 크기 40)에서 전체 페이지 수가 두 배로 보였다
 *  2. 필터 배지 수가 외국인·국적·언어·품질을 세지 않았다(파란 버튼인데 수가 빔)
 *  3. '필터 초기화'가 원내 상태를 남겼다(활성 필터로는 세면서)
 *  4. 🔴 '내 환자' 조회 실패가 섹션 통째 사라짐 = '내 환자 없음'
 *  5. 원내 상태(어디에 몇 명)가 필터 패널 안에 숨어 있었다 — 원내 보기일 때 상시 띠
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
let wide = false;
let role = 'ADMIN';
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/patients', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/useWideScreen', () => ({ useWideScreen: () => wide, splitIntoColumns: <T,>(rows: T[], n: number) => (n > 1 ? [rows.slice(0, Math.ceil(rows.length / 2)), rows.slice(Math.ceil(rows.length / 2))] : [rows]) }));
vi.mock('@/stores/auth-store', () => {
  const useAuthStore = (sel?: (s: unknown) => unknown) => { const st = { user: { id: 'u', role, department: '', familyName: '김', givenName: '관리' } }; return sel ? sel(st) : st; };
  (useAuthStore as unknown as { getState: () => unknown }).getState = () => ({ user: { role } });
  return { useAuthStore };
});

const patients = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, mrn: `M${i}`, familyName: '김', givenName: `환${i}`, dateOfBirth: '1980-01-01', gender: 'MALE', insuranceType: 'NHI', tags: [], _count: { encounters: 0 } }));
function route(url: string) {
  if (url === '/api/v1/patients') return Promise.resolve({ data: patients, pagination: { total: 57, hasMore: true } });
  if (url === '/api/v1/patients/onsite-summary') return Promise.resolve({ data: { total: 57, states: [{ key: 'admitted', label: '재원', hint: '', count: 22 }, { key: 'waiting', label: '대기', hint: '', count: 18 }] } });
  if (url === '/api/v1/patients/filter-options') return Promise.resolve({ data: { foreignerTotal: 4, nationalities: [], languages: [] } });
  return Promise.resolve({ data: {} });
}
async function mount() {
  const { default: Page } = await import('@/app/(main)/patients/page');
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Page /></QueryClientProvider>);
}

beforeEach(() => { cleanup(); get.mockReset(); get.mockImplementation(route); wide = false; role = 'ADMIN'; });

describe('환자 관리', () => {
  it.each([[false, '1 / 3'], [true, '1 / 2']])('🔴 페이지 수는 실제 페이지 크기로 센다(넓은 화면=%s → %s)', async (w, expected) => {
    wide = w as boolean;
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-page-indicator]')?.textContent).toBe(expected));
  });

  it('원내 상태 띠는 필터를 열지 않아도 보인다', async () => {
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-onsite-strip]')?.textContent).toMatch(/재원\s*22/));
  });

  it('필터 배지는 외국인 구분도 센다 · 초기화는 원내 상태까지 지운다', async () => {
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-onsite-strip]')).toBeTruthy());
    // 원내 상태 하나 고르기(띠)
    fireEvent.click(await screen.findByRole('button', { pressed: false, name: /^재원/ }));
    fireEvent.click(container.querySelector('[data-filter-toggle]')!);
    fireEvent.click(await screen.findByRole('button', { name: /외국인/ }));
    const filterBtn = container.querySelector('[data-filter-toggle]') as HTMLElement;
    expect(filterBtn.textContent).toMatch(/2/); // 원내 상태 1 + 외국인 1
    fireEvent.click(container.querySelector('[data-filter-reset]')!);
    expect(screen.getByRole('button', { name: /^재원/ }).getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-filter-reset]')).toBeNull();
  });

  it('🔴 내 환자 조회 실패는 "없음"(섹션 증발)이 아니다', async () => {
    role = 'DOCTOR';
    get.mockImplementation((url: string) => (url === '/api/v1/patients/smart-list' ? Promise.reject(new Error('500')) : route(url)));
    await mount();
    expect((await screen.findAllByText(/재시도|다시 시도/, {}, { timeout: 3000 })).length).toBeGreaterThan(0);
  });
});
