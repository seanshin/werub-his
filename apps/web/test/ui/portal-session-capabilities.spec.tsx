/**
 * 포털 세션 능력표(A1) — 화면이 계정 전용 기능을 **불러 보기 전에** 쓸 수 있는지 안다(2026-10-19 포털 세련화 P0).
 *  · 🔴 v4.93.0~2: 등록번호 세션이 계정 전용 EP 를 불러 401/403 → "세션 만료"·로그아웃(신고 3건)
 *  · 이제: 능력표 false → 부르지 않고 안내 · 대조군 계정 세션은 부른다 · 능력표를 모르면(조회 실패) 종전대로 불러 서버 응답으로 가른다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { portalAccountFeatures } from '@hospital-run/shared';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), getToken: vi.fn(() => 't' as string | null), setToken: vi.fn() }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));

const PATIENT = { id: 'p1', mrn: 'P2026-0001', familyName: '김', givenName: '영수', dateOfBirth: '1958-03-15', gender: 'MALE' } as never;

function route(kind: 'ACCOUNT' | 'MRN' | 'FAIL') {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/v1/portal/session') {
      if (kind === 'FAIL') throw Object.assign(new Error('x'), { code: 'NETWORK' });
      return { data: { kind, features: portalAccountFeatures(kind), expiresAt: null } };
    }
    if (url.startsWith('/api/v1/patient-auth/')) {
      if (kind === 'ACCOUNT') return { data: url.endsWith('masked') ? { maskedNationalId: null } : [] };
      throw Object.assign(new Error('계정 필요'), { code: 'PATIENT_ACCOUNT_REQUIRED' });
    }
    return { data: url.includes('profile') ? {} : [] };
  });
}
async function mount() {
  const { default: ProfileTab } = await import('@/app/portal/_profile/ProfileTab');
  let v!: ReturnType<typeof render>;
  await act(async () => {
    v = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ProfileTab patient={PATIENT} onLogout={() => {}} /></QueryClientProvider>);
  });
  return v;
}
const accountCalls = () => api.get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/v1/patient-auth/'));

beforeEach(() => { cleanup(); api.get.mockReset(); api.getToken.mockImplementation(() => 't'); });

describe('🔴 내 정보 탭 — 세션 능력표', () => {
  it('등록번호 세션 → 계정 전용 EP 를 부르지 않는다 · 안내 3곳 · "세션 만료" 문구 없음', async () => {
    route('MRN');
    const v = await mount();
    await waitFor(() => expect(v.container.querySelectorAll('[data-portal-account-required]').length).toBe(3));
    expect(accountCalls()).toEqual([]);
    expect(v.container.textContent).not.toContain('세션이 만료');
    // B7 — 막다른 안내가 아니라 가입 화면으로 잇는다
    expect([...v.container.querySelectorAll('a[data-portal-account-signup]')].every((a) => a.getAttribute('href') === '/portal?signup=1')).toBe(true);
    expect(v.container.querySelectorAll('a[data-portal-account-signup]').length).toBe(3);
  });
  it('대조군 — 계정 세션은 부르고 안내를 그리지 않는다', async () => {
    route('ACCOUNT');
    const v = await mount();
    await waitFor(() => expect(accountCalls().length).toBeGreaterThanOrEqual(3));
    expect(v.container.querySelectorAll('[data-portal-account-required]').length).toBe(0);
  });
  it('능력표를 모르면(조회 실패) 계정 없음으로 단정하지 않고 불러서 서버 응답(403 계정 필요)으로 가른다', async () => {
    route('FAIL');
    const v = await mount();
    await waitFor(() => expect(accountCalls().length).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(v.container.querySelectorAll('[data-portal-account-required]').length).toBe(3));
  });
});

describe('🔴 R1 — 수납 화면 한 페이지에 본인부담이 둘이던 것(부분 환불 1,000원 환자 87,203 ↔ 88,203)', () => {
  const BILL = { id: 'b1', billedAt: '2026-05-28', total: 85000, insuranceCovered: 68000, copay: 17000, paidAmount: 17000, status: 'PAID', discount: 0, outstanding: 0, refundAmount: 1000 };
  async function mountServices() {
    api.get.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/portal/billing/annual-summary')) return { data: { totalVisits: 3, totalAmount: 787478, totalInsurance: 699275, totalCopay: 87203, monthly: [] } };
      if (url.startsWith('/api/v1/portal/medical-expenses')) return { data: { year: 2026, summary: { totalAmount: 787478, insuranceCovered: 699275, copay: 88203, paid: 87203 }, visitCount: 3, monthly: [] } };
      return { data: [] };
    });
    const { default: ServicesTab } = await import('@/app/portal/_services/ServicesTab');
    let v!: ReturnType<typeof render>;
    await act(async () => {
      v = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ServicesTab patient={PATIENT} data={{ billings: [BILL] } as never} /></QueryClientProvider>);
    });
    return v;
  }
  it('연말정산 카드 머리 숫자 = 낸 돈(환불 차감) · 청구액은 다를 때 따로 · 진료비 카드에 환불 줄', async () => {
    const v = await mountServices();
    await waitFor(() => expect(v.container.querySelector('[data-portal-tax-paid]')?.textContent).toContain('87,203'));
    expect(v.container.querySelector('[data-portal-tax-billed]')?.textContent).toContain('88,203');
    expect(v.container.textContent).toContain('낸 금액(환불 차감)');
    expect(v.container.textContent).toContain('-1,000');
  });
});

describe('🔴 (v4.95.1) 토큰이 없으면(로그인 전) 능력표를 부르지 않는다', () => {
  it('401 → 세션 만료 통지 → 로그인 화면에 "로그인 시간이 지나…" 가 뜨던 길 · 대조군 토큰 있으면 부른다', async () => {
    const { usePortalSession } = await import('@/app/portal/_auth/session-check');
    function Probe() { usePortalSession(); return null; }
    route('MRN');
    api.getToken.mockImplementation(() => null);
    await act(async () => { render(<QueryClientProvider client={new QueryClient()}><Probe /></QueryClientProvider>); });
    expect(api.get.mock.calls.some((c) => c[0] === '/api/v1/portal/session')).toBe(false);
    cleanup();
    api.getToken.mockImplementation(() => 'tok');
    await act(async () => { render(<QueryClientProvider client={new QueryClient()}><Probe /></QueryClientProvider>); });
    await waitFor(() => expect(api.get.mock.calls.some((c) => c[0] === '/api/v1/portal/session')).toBe(true));
  });
});

describe('🔴 홈 — 설정으로 꺼진 입원 생활은 부르지 않는다(종전 매 로딩 404 2건)', () => {
  it('services.inpatientLife=false → 식이·중간 정산 미호출 · 대조군 켜짐 → 호출', async () => {
    const { usePortalService, mayCallAccountFeature } = await import('@/app/portal/_auth/session-check');
    const seen: Array<boolean | null | undefined> = [];
    function Probe() { const v = usePortalService('inpatientLife'); seen.push(v); return <span data-may={String(mayCallAccountFeature(v))} />; }
    for (const on of [false, true]) {
      cleanup(); seen.length = 0;
      api.get.mockImplementation(async () => ({ data: { kind: 'MRN', features: portalAccountFeatures('MRN'), expiresAt: null, services: { inpatientLife: on } } }));
      let v!: ReturnType<typeof render>;
      await act(async () => { v = render(<QueryClientProvider client={new QueryClient()}><Probe /></QueryClientProvider>); });
      await waitFor(() => expect(v.container.querySelector('[data-may]')!.getAttribute('data-may')).toBe(String(on)));
      expect(seen[0]).toBeUndefined(); // 오는 중에는 부르지 않는다
    }
  });
  it('구조 — 홈의 두 조회가 이 판정을 거친다', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const home = readFileSync('src/app/portal/_home/HomeTab.tsx', 'utf8');
    expect(home.match(/enabled: isInpatient && mayCallAccountFeature\(inpatientLife\)/g)?.length).toBe(2);
  });
});

describe('B7 — 가입 화면으로 시작', () => {
  it('initialSignup 이면 로그인 폼 대신 가입 폼 · 대조군 기본은 로그인', async () => {
    const { default: LoginForm } = await import('@/app/portal/_auth/LoginForm');
    let v!: ReturnType<typeof render>;
    await act(async () => { v = render(<QueryClientProvider client={new QueryClient()}><LoginForm onLogin={() => {}} initialSignup /></QueryClientProvider>); });
    expect(v.container.querySelector('input[type="tel"]')).not.toBeNull();
    expect(v.container.textContent).toContain('생년월일');
    cleanup();
    await act(async () => { v = render(<QueryClientProvider client={new QueryClient()}><LoginForm onLogin={() => {}} /></QueryClientProvider>); });
    expect(v.container.textContent).not.toContain('생년월일');
  });
});
