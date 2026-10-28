/**
 * 환자 목록 P3(2026-10-20 · `patients-list-refinement-2026-10.plan.md` B1~B5).
 *  - 알레르기 칸: 서버 4상태 · 🔴 미확인은 주의 · 초록은 문진 기록이 있을 때만 · 권한 밖이면 열 자체가 없다
 *  - 나이(만) · 최근 방문(없음 `-` / 모름 `?`) · 다음 예약 · 머무는 곳(재원·응급)
 *  - 내 환자 필터는 의사에게만 · 누르면 scope=mine
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AllergyChip, VisitCell, AgeText, StayChip } from '@/app/(main)/patients/components/RowExtras';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/patients', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/useWideScreen', () => ({ useWideScreen: () => false, splitIntoColumns: <T,>(rows: T[]) => [rows] }));
let role = 'DOCTOR';
vi.mock('@/stores/auth-store', () => {
  const useAuthStore = (sel?: (s: unknown) => unknown) => { const st = { user: { id: 'u', role, department: '' } }; return sel ? sel(st) : st; };
  (useAuthStore as unknown as { getState: () => unknown }).getState = () => ({ user: { role } });
  return { useAuthStore };
});

const CAP = { scope: 'ALL', contact: 'MASKED', contactReason: 'SETTING', identity: false, phoneSearch: false, canRegister: false, canImport: false, canMerge: false, canExport: false, canReviewDuplicates: false, canViewQuality: false, narrowing: null };
let cap: Record<string, unknown> = { ...CAP, allergyStatus: true, myScope: true };
const rows = [
  { id: 'a', mrn: 'MA', familyName: '김', givenName: '가', dateOfBirth: '1980-01-01', gender: 'MALE', insuranceType: 'NHI', tags: [], allergyStatus: 'NOT_ASSESSED', allergyAssessedAt: null, lastVisitAt: null, nextAppointment: { at: '2026-11-01T01:00:00Z', department: '내과' }, stay: { kind: 'ADMITTED', ward: '5병동', room: '501', bed: 'A' } },
];
function route(url: string) {
  if (url === '/api/v1/patients/list-capabilities') return Promise.resolve({ data: cap });
  if (url === '/api/v1/patients') return Promise.resolve({ data: rows, pagination: { total: 1, hasMore: false } });
  if (url === '/api/v1/patients/onsite-summary') return Promise.resolve({ data: { total: 0, states: [] } });
  return Promise.resolve({ data: {} });
}
async function mountPage() {
  const { default: Page } = await import('@/app/(main)/patients/page');
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Page /></QueryClientProvider>);
}
const listCalls = () => get.mock.calls.filter((c) => c[0] === '/api/v1/patients').map((c) => c[1] as Record<string, unknown>);

beforeEach(() => { cleanup(); get.mockReset(); get.mockImplementation(route); role = 'DOCTOR'; cap = { ...CAP, allergyStatus: true, myScope: true }; });

describe('🔴 알레르기 칩 — 정본 4상태', () => {
  it('미확인은 주의(초록 아님) · 확인 불가도 주의 · 있음은 위험', () => {
    const { container, rerender } = render(<AllergyChip status="NOT_ASSESSED" assessedAt={null} />);
    expect(container.innerHTML).toMatch(/amber/);
    rerender(<AllergyChip status="UNABLE_TO_ASSESS" assessedAt="2026-10-01" />);
    expect(container.innerHTML).toMatch(/amber/);
    rerender(<AllergyChip status="HAS_ALLERGIES" />);
    expect(container.innerHTML).toMatch(/rose/);
  });
  it('🔴 "없음(확인함)"도 문진 기록이 없으면 초록이 아니다 · 있으면 초록', () => {
    const { container, rerender } = render(<AllergyChip status="NO_KNOWN_ALLERGIES" assessedAt={null} />);
    expect(container.innerHTML).not.toMatch(/emerald/);
    rerender(<AllergyChip status="NO_KNOWN_ALLERGIES" assessedAt="2026-10-01T00:00:00Z" />);
    expect(container.innerHTML).toMatch(/emerald/);
  });
  it('칸이 없으면(권한 밖) 아무것도 그리지 않는다', () => {
    const { container } = render(<AllergyChip status={undefined} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('나이·방문·머무는 곳', () => {
  it('만 나이 · 생년월일 모르면 그리지 않음', () => {
    const { container, rerender } = render(<AgeText dateOfBirth="1980-01-01" />);
    expect(container.textContent).toMatch(/\d+/);
    rerender(<AgeText dateOfBirth={null} />);
    expect(container.innerHTML).toBe('');
  });
  it('🔴 최근 방문 없음은 `-` · 칸 자체가 없으면 `?`(0 이나 없음으로 그리지 않는다)', () => {
    const { container, rerender } = render(<VisitCell lastVisitAt={null} nextAppointment={null} />);
    expect(container.querySelector('[data-visit-none]')).toBeTruthy();
    rerender(<VisitCell lastVisitAt={undefined} nextAppointment={null} />);
    expect(container.textContent).toMatch(/\?/);
  });
  it('재원은 병동·호실 · 응급 진행 · 없으면 없음', () => {
    const { container, rerender } = render(<StayChip stay={{ kind: 'ADMITTED', ward: '5병동', room: '501', bed: 'A' }} />);
    expect(container.textContent).toMatch(/5병동 501-A/);
    rerender(<StayChip stay={{ kind: 'ER', status: 'IN_TREATMENT' }} />);
    expect(container.querySelector('[data-stay="ER"]')).toBeTruthy();
    rerender(<StayChip stay={null} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('목록 화면', () => {
  it('의사 — 알레르기 열·방문 열·재원 칩 · 내 환자 누르면 scope=mine', async () => {
    const { container } = await mountPage();
    await vi.waitFor(() => expect(container.querySelector('[data-allergy="NOT_ASSESSED"]')).toBeTruthy());
    expect(screen.getByText('알레르기')).toBeTruthy();
    expect(container.querySelector('[data-stay="ADMITTED"]')).toBeTruthy();
    expect(container.querySelector('[data-next-appt]')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-scope-mine]')!);
    await vi.waitFor(() => expect(listCalls().some((q) => q.scope === 'mine')).toBe(true));
  });

  it('🔴 권한 밖 역할 — 알레르기 열 없음 · 내 환자 필터 없음', async () => {
    role = 'RECEPTIONIST';
    cap = { ...CAP, allergyStatus: false, myScope: false };
    const { container } = await mountPage();
    await vi.waitFor(() => expect(container.querySelector('[data-visit]')).toBeTruthy());
    expect(screen.queryByText('알레르기')).toBeNull();
    expect(container.querySelector('[data-scope-mine]')).toBeNull();
    expect(listCalls().every((q) => q.scope === undefined)).toBe(true);
  });
});
