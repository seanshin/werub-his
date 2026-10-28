/**
 * 환자 목록 P1(2026-10-20 · `patients-list-refinement-2026-10.plan.md` A5·A6·A7).
 *  - R10 조건이 걸린 빈 목록을 "등록된 환자가 없습니다"라 말했다
 *  - R13 검색이 글자마다 서버 요청
 *  - R11 진료 횟수가 작성 중까지 "진료 N회"
 *  - 🔴 R8 품질 카드: 중복 의심 그룹 수를 환자 분모 % 로 · 분모 0 을 0% 로 · 정책 없는 사진을 경고색으로
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ListEmptyState } from '@/app/(main)/patients/components/ListEmptyState';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/patients', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/useWideScreen', () => ({ useWideScreen: () => false, splitIntoColumns: <T,>(rows: T[]) => [rows] }));
vi.mock('@/stores/auth-store', () => {
  const user = { id: 'u', role: 'ADMIN', department: '' };
  const useAuthStore = (sel?: (s: unknown) => unknown) => { const st = { user }; return sel ? sel(st) : st; };
  (useAuthStore as unknown as { getState: () => unknown }).getState = () => ({ user });
  return { useAuthStore };
});

const CAP = { scope: 'ALL', contact: 'FULL', contactReason: null, identity: true, phoneSearch: true, canRegister: true, canImport: true, canMerge: true, canExport: true, canReviewDuplicates: true, canViewQuality: true, narrowing: null };
let patients: unknown[] = [];
let quality: unknown = null;
function route(url: string) {
  if (url === '/api/v1/patients/list-capabilities') return Promise.resolve({ data: CAP });
  if (url === '/api/v1/patients') return Promise.resolve({ data: patients, pagination: { total: patients.length, hasMore: false } });
  if (url === '/api/v1/patients/quality-dashboard') return Promise.resolve({ data: quality });
  if (url === '/api/v1/patients/onsite-summary') return Promise.resolve({ data: { total: 0, states: [] } });
  return Promise.resolve({ data: {} });
}
async function mount() {
  const { default: Page } = await import('@/app/(main)/patients/page');
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Page /></QueryClientProvider>);
}
const listCalls = () => get.mock.calls.filter((c) => c[0] === '/api/v1/patients').map((c) => c[1] as Record<string, unknown>);
const row = (over: Record<string, unknown>) => ({ id: 'p', mrn: 'M', familyName: '김', givenName: '가', dateOfBirth: '1980-01-01', gender: 'MALE', insuranceType: 'NHI', tags: [], ...over });

beforeEach(() => { cleanup(); get.mockReset(); get.mockImplementation(route); patients = []; quality = null; vi.useRealTimers(); });

describe('빈 상태 3갈래', () => {
  it('🔴 원내 보기(기본)에서 빈 목록은 "조건에 맞는 환자 없음" + 전체 보기 — "등록된 환자가 없습니다" 아님', async () => {
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-patients-empty="no-match"]')).toBeTruthy());
    expect(container.querySelector('[data-patients-empty="none-registered"]')).toBeNull();
    expect(container.querySelector('[data-empty-cond="onsite"]')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-empty-show-all]')!);
    await vi.waitFor(() => expect(listCalls().some((q) => q.presence === undefined)).toBe(true));
  });

  it('조건 없음이면 등록 0', () => {
    const { container } = render(<ListEmptyState conditions={{ search: '', onsiteOnly: false, filterCount: 0 }} onShowAll={() => {}} onResetFilters={() => {}} />);
    expect(container.querySelector('[data-patients-empty="none-registered"]')).toBeTruthy();
  });

  it('검색·필터 조건을 나열하고 초기화를 준다', () => {
    const reset = vi.fn();
    const { container } = render(<ListEmptyState conditions={{ search: '홍', onsiteOnly: false, filterCount: 2 }} onShowAll={() => {}} onResetFilters={reset} />);
    expect(container.querySelector('[data-empty-cond="search"]')?.textContent).toMatch(/홍/);
    expect(container.querySelector('[data-empty-cond="filters"]')?.textContent).toMatch(/2/);
    fireEvent.click(container.querySelector('[data-empty-reset]')!);
    expect(reset).toHaveBeenCalled();
  });
});

describe('🔴 검색 디바운스', () => {
  it('입력 즉시 부르지 않고 멈춘 뒤 한 번', async () => {
    await mount();
    await vi.waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    vi.useFakeTimers();
    const input = document.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '김' } });
    fireEvent.change(input, { target: { value: '김가' } });
    expect(listCalls().some((q) => q.q === '김' || q.q === '김가')).toBe(false);
    // 100ms 에는 아직 부르지 않는다(디바운스 창 안)
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(listCalls().some((q) => q.q === '김가')).toBe(false);
    await act(async () => { vi.advanceTimersByTime(210); });
    vi.useRealTimers();
    await vi.waitFor(() => expect(listCalls().some((q) => q.q === '김가')).toBe(true));
    expect(listCalls().some((q) => q.q === '김')).toBe(false);
  });
});

describe('🔴 진료 횟수 — 서명과 작성 중', () => {
  it('서명 3회 + 작성 중 2 · 칸이 없으면 ? (0 으로 그리지 않음)', async () => {
    patients = [row({ id: 'a', mrn: 'MA', encounterCounts: { signed: 3, drafts: 2 } }), row({ id: 'b', mrn: 'MB' })];
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-enc-signed]')).toBeTruthy());
    expect(container.querySelector('[data-enc-signed]')!.textContent).toMatch(/3/);
    expect(container.querySelector('[data-enc-drafts]')!.textContent).toMatch(/2/);
    expect(container.textContent).toMatch(/\?/);
  });
});

describe('🔴 품질 카드 — 분자·분모·단위', () => {
  it('중복 의심은 "N그룹 · M명" · 비율은 환자 수/전체 · 분모 0 은 산출 불가 · 사진은 경고색 아님', async () => {
    quality = {
      total: 873,
      noPhone: { count: 825, denominator: 873 },
      noInsurance: { count: 10, denominator: 848 },
      noAddress: { count: 1, denominator: 873 },
      dormant: { count: 0, denominator: 0 },
      duplicateSuspect: { groups: 86, patients: 175, denominator: 873 },
      noPhoto: { count: 873, denominator: 873, policy: 'UNDECIDED' },
    };
    const { container } = await mount();
    fireEvent.click(await screen.findByText('데이터 품질 대시보드'));
    await vi.waitFor(() => expect(container.querySelector('[data-quality-cards]')).toBeTruthy());
    const dup = container.querySelector('[data-quality-card="dupSuspect"]')!;
    expect(dup.textContent).toMatch(/86\s*그룹/);
    expect(dup.textContent).toMatch(/175\s*명/);
    expect(dup.textContent).toMatch(/20\.0/); // 175/873 = 20.0% (86/873=9.9% 가 아니다)
    expect(container.querySelector('[data-quality-card="dormant"] [data-quality-share="na"]')).toBeTruthy();
    const photo = container.querySelector('[data-quality-card="noPhoto"]')!;
    expect(photo.innerHTML).not.toMatch(/text-gray-600|text-amber|text-red/);
    expect(container.querySelector('[data-quality-card="noInsurance"]')!.textContent).toMatch(/848/);
  });
});
