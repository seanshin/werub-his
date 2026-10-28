/**
 * 🔴 환자 목록 능력표(2026-10-20 환자 목록 P0 · `patients-list-refinement-2026-10.plan.md` A1·A2·R7·R9).
 *  - 종전 화면은 역할 권한을 화면 로컬 표·설정(실패 삼킴)·서버 RBAC 셋에서 따로 정했다 → 서버 능력표 하나.
 *  - 의사 배너 "본인 진료 환자 … 연락처 마스킹" 은 거짓이었다(서버는 전체 환자·전화 원문) → 서버가 하는 일만 말한다.
 *  - 사용자 정보 전 `?? 'ADMIN'` 으로 관리자 화면을 잠깐 그렸다 → 오는 중이면 쓰기·관리 도구 없음.
 *  - 내 환자 이름 붙여 쓰기 → 이름 정본.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
let user: { id: string; role: string; department: string } | null = { id: 'u', role: 'ADMIN', department: '' };
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/patients', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/useWideScreen', () => ({ useWideScreen: () => false, splitIntoColumns: <T,>(rows: T[]) => [rows] }));
vi.mock('@/stores/auth-store', () => {
  const useAuthStore = (sel?: (s: unknown) => unknown) => { const st = { user }; return sel ? sel(st) : st; };
  (useAuthStore as unknown as { getState: () => unknown }).getState = () => ({ user });
  return { useAuthStore };
});

const CAP_FULL = { scope: 'ALL', contact: 'FULL', contactReason: null, identity: true, phoneSearch: true, canRegister: true, canImport: true, canMerge: true, canExport: true, canReviewDuplicates: true, canViewQuality: true, narrowing: null };
const CAP_DOCTOR = { ...CAP_FULL, contact: 'MASKED', contactReason: 'SETTING', identity: false, phoneSearch: false, canRegister: true, canImport: false, canMerge: false, canExport: false, canReviewDuplicates: false, canViewQuality: false, narrowing: { source: 'default:DOCTOR', fields: ['showPhone'], scope: 'LIST' } };
const patients = [{ id: 'p0', mrn: 'M0', familyName: '김', givenName: '가', dateOfBirth: '1980-01-01', gender: 'MALE', insuranceType: 'NHI', phone: '010-1234-5678', tags: [], _count: { encounters: 0 } }];

let cap: unknown = CAP_FULL;
let capMode: 'ok' | 'pending' | 'error' = 'ok';
let listExtra: Record<string, unknown> = {};
function route(url: string) {
  if (url === '/api/v1/patients/list-capabilities') {
    if (capMode === 'pending') return new Promise(() => {});
    if (capMode === 'error') return Promise.reject(new Error('500'));
    return Promise.resolve({ data: cap });
  }
  if (url === '/api/v1/patients') return Promise.resolve({ data: patients, pagination: { total: 1, hasMore: false }, ...listExtra });
  if (url === '/api/v1/patients/smart-list') return Promise.resolve({ data: { myPatients: [{ id: 'f1', familyName: 'Smith', givenName: 'John', koreanName: null, context: '09:00 예약', contextType: 'appointment' }] } });
  if (url === '/api/v1/patients/onsite-summary') return Promise.resolve({ data: { total: 1, states: [] } });
  return Promise.resolve({ data: {} });
}
async function mount() {
  const { default: Page } = await import('@/app/(main)/patients/page');
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Page /></QueryClientProvider>);
}
const urls = () => get.mock.calls.map((c) => c[0]);

beforeEach(() => {
  cleanup(); get.mockReset(); get.mockImplementation(route);
  user = { id: 'u', role: 'ADMIN', department: '' }; cap = CAP_FULL; capMode = 'ok'; listExtra = {};
});

describe('환자 목록 — 서버 능력표', () => {
  it('🔴 능력표가 오는 중이면 관리자여도 등록·관리 도구·연락처 열을 그리지 않는다', async () => {
    capMode = 'pending';
    const { container } = await mount();
    await vi.waitFor(() => expect(urls()).toContain('/api/v1/patients'));
    expect(container.querySelector('a[href="/patients/new"]')).toBeNull();
    expect(screen.queryByText('병합')).toBeNull();
    expect(screen.queryByText('연락처')).toBeNull();
    expect(container.querySelector('[data-patients-access-banner]')).toBeNull();
    expect(container.querySelector('[data-patients-access-error]')).toBeNull();
  });

  it('🔴 능력표 실패 — 도구를 숨겼다고 말한다(조용히 기본값으로 열지 않는다)', async () => {
    capMode = 'error';
    const { container } = await mount();
    // 능력표 조회는 한 번 재시도한다 — 실패 표시는 그 뒤
    await vi.waitFor(() => expect(container.querySelector('[data-patients-access-error]')).toBeTruthy(), { timeout: 4000 });
    expect(container.querySelector('a[href="/patients/new"]')).toBeNull();
  });

  it('🔴 의사: 범위 거짓말 없음 · 연락처 가림 이유=설정 · 전화 검색 안 함 · 서버가 허용한 등록은 보인다', async () => {
    user = { id: 'd', role: 'DOCTOR', department: '' }; cap = CAP_DOCTOR;
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-patients-access-banner]')).toBeTruthy());
    const banner = container.querySelector('[data-patients-access-banner]')!.textContent ?? '';
    expect(banner).toMatch(/전체 환자/);
    expect(container.querySelector('[data-patients-contact-masked="SETTING"]')).toBeTruthy();
    expect(container.querySelector('[data-patients-no-phone-search]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/본인 진료 환자|마스킹됩니다|처방이 있는 환자/);
    expect(screen.queryByText('연락처')).toBeNull();
    expect(container.querySelector('a[href="/patients/new"]')).toBeTruthy();
    expect(screen.queryByText('병합')).toBeNull();
    expect((container.querySelector('input[type="text"]') as HTMLInputElement).placeholder).not.toMatch(/전화번호/);
  });

  it('대조군: 원무(연락처 원문) — 연락처 열·전화 검색 안내', async () => {
    user = { id: 'r', role: 'RECEPTIONIST', department: '' }; cap = { ...CAP_FULL, canImport: false, canMerge: false, canExport: false, canReviewDuplicates: false, canViewQuality: false };
    const { container } = await mount();
    await vi.waitFor(() => expect(screen.queryByText('연락처')).toBeTruthy());
    expect((container.querySelector('input[type="text"]') as HTMLInputElement).placeholder).toMatch(/전화번호/);
    expect(container.querySelector('[data-patients-contact-masked]')).toBeNull();
  });

  it('관리 도구는 능력별로 — 병합 권한 없으면 병합 버튼 없음', async () => {
    cap = { ...CAP_FULL, canMerge: false };
    await mount();
    await vi.waitFor(() => expect(screen.queryByText('가져오기')).toBeTruthy());
    expect(screen.queryByText('병합')).toBeNull();
    expect(screen.queryByText('중복 검토')).toBeTruthy();
  });

  it('숫자 검색이 전화 검색 권한 없음으로 걸렀으면 그 사실을 말한다', async () => {
    cap = CAP_DOCTOR; listExtra = { searchNote: 'PHONE_SEARCH_NOT_ALLOWED' };
    const { container } = await mount();
    await vi.waitFor(() => expect(container.querySelector('[data-patients-search-note]')).toBeTruthy());
  });

  it('🔴 사용자 정보 전 — 역할 칩·내 환자 조회 없음(관리자로 그리지 않음)', async () => {
    user = null;
    const { container } = await mount();
    await vi.waitFor(() => expect(urls()).toContain('/api/v1/patients'));
    expect(container.querySelector('[data-patients-role-chip]')).toBeNull();
    expect(urls()).not.toContain('/api/v1/patients/smart-list');
  });

  it('내 환자 이름은 정본 — 외국 이름을 붙여 쓰지 않는다', async () => {
    user = { id: 'd', role: 'DOCTOR', department: '' }; cap = CAP_DOCTOR;
    const { container } = await mount();
    await vi.waitFor(() => expect(container.textContent).toMatch(/John/));
    expect(container.textContent).not.toMatch(/SmithJohn/);
  });

  it('🔴 구조 가드 — 화면이 역할 권한을 따로 정하지 않는다', () => {
    const src = readFileSync(resolve(__dirname, '../../src/app/(main)/patients/page.tsx'), 'utf8');
    expect(src).not.toMatch(/DEFAULT_ROLE_ACCESS|role-data-access|RESTRICTIVE_ACCESS/);
    expect(src).not.toMatch(/user\?\.role \?\? 'ADMIN'/);
    expect(src).not.toMatch(/role === 'DOCTOR' &&/);
    expect(src).not.toMatch(/\{p\.familyName\}\{p\.givenName\}/);
  });
});
