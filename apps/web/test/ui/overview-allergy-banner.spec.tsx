/**
 * 차트 개요 — 알레르기 안전 축(2026-10-03).
 *  🔴 종전 배너는 환자 요약에 `allergies` 키가 없을 때만 경고했다 — 임상 역할엔 요약이 늘 배열을 실어 **미평가 환자에게 경고가 뜬 적이 없었고**,
 *     원무 등엔 권한상 빼고 보내는 것을 "알레르기 정보 미확인 — 처방 전 확인"으로 말했다 · 개요 탭은 정본 상태를 역할 무관 호출(원무 403)
 *  · 정본 4상태 · 조회 역할만 부른다 · 미평가·확인 불가·근거 없는 "없음"만 경고 · 조회 실패는 미확인과 구분 · 권한 밖은 "비어 있지 않다"
 * 재주입: 정본 상태 대신 요약 키·역할 게이트·실패 구분·권한 밖 문구를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), getToken: () => null } }));
let role = 'DOCTOR';
vi.mock('@/hooks/use-admin-write', () => ({ useHasRole: (...roles: string[]) => role === 'ADMIN' || roles.includes(role) }));
import { useAuthStore } from '@/stores/auth-store';

const P = '00000000-0000-4000-a000-000000d00001';
const setRole = (r: string) => { role = r; useAuthStore.setState({ user: { id: 'u', email: 'u@x', familyName: '', givenName: '', role: r, permissions: [] } }); };
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

function routes(status: unknown, summary: Record<string, unknown> = { patient: { mrn: 'M1' }, allergies: [] }) {
  return async (u: string) => {
    if (u.includes('/allergies/status')) { if (status instanceof Error) throw status; return { data: status }; }
    if (u.endsWith('/summary')) return { data: summary };
    if (u.includes('/ai/brief/')) return { data: { computedAt: new Date().toISOString(), basis: [], activeMedications: [], medicationDetails: [], activeProblems: [], recordDiagnoses: [], recentLabs: [], abnormalLabCount: 0, unavailable: [] } };
    if (u.includes('/record-timeline/analytics')) return { data: { analytes: [] } };
    return { data: [] };
  };
}
async function mount() {
  const { OverviewTab } = await import('@/app/(main)/patients/[id]/components/OverviewTab');
  return wrap(<OverviewTab patientId={P} recentEncounters={[]} encountersLoading={false} billings={[]} billingsLoading={false} totalBillingAmount={0} paidBillings={0} onTabChange={() => {}} userRole={role} />);
}
const statusCalls = () => get.mock.calls.filter((c) => String(c[0]).includes('/allergies/status')).length;

beforeEach(() => { get.mockReset(); setRole('DOCTOR'); });
afterEach(() => cleanup());

describe('알레르기 안전 축', () => {
  it('🔴 미평가 환자에게 경고한다(요약이 빈 배열을 실어도)', async () => {
    get.mockImplementation(routes({ status: 'NOT_ASSESSED', assessedAt: null }));
    const r = await mount();
    await waitFor(() => expect(r.container.textContent).toContain('알레르기를 확인한 기록이 없습니다'));
    expect(r.container.textContent).toContain('처방 전 반드시 확인하세요');
  });

  it.each([
    ['확인한 없음', { status: 'NO_KNOWN_ALLERGIES', assessedAt: '2026-10-01T00:00:00Z' }],
    ['알레르기 있음(목록은 카드가)', { status: 'HAS_ALLERGIES', assessedAt: '2026-10-01T00:00:00Z' }],
  ])('대조군 — %s 이면 배너 경고가 없다', async (_n, st) => {
    get.mockImplementation(routes(st));
    const r = await mount();
    await waitFor(() => expect(statusCalls()).toBe(1));
    await new Promise((res) => setTimeout(res, 20));
    expect(r.container.textContent).not.toContain('처방 전 반드시 확인하세요.');
  });

  it('🔴 평가 기록 없는 "없음"은 안심시키지 않는다', async () => {
    get.mockImplementation(routes({ status: 'NO_KNOWN_ALLERGIES', assessedAt: null }));
    const r = await mount();
    await waitFor(() => expect(r.container.textContent).toContain('처방 전 반드시 확인하세요.'));
  });

  it('🔴 조회 실패는 "확인하지 못했다"(미확인과 다르다)', async () => {
    get.mockImplementation(routes(new Error('500')));
    const r = await mount();
    await waitFor(() => expect(r.container.textContent).toContain('알레르기 확인 을(를) 확인하지 못했습니다'));
    expect(r.container.querySelector('[data-allergy-status-error]')).not.toBeNull();
  });

  it('🔴 원무: 정본 상태를 부르지 않고(403 방지) 경고하지 않는다 · 권한상 빠진 것은 "비어 있지 않다"', async () => {
    setRole('RECEPTIONIST');
    get.mockImplementation(routes({ status: 'NOT_ASSESSED', assessedAt: null }, { patient: { mrn: 'M1' }, restricted: ['latestVitals', 'activeMedications', 'problems', 'allergies'] }));
    const r = await mount();
    await waitFor(() => expect(r.container.querySelector('[data-allergy-restricted]')).not.toBeNull());
    expect(statusCalls()).toBe(0);
    expect(r.container.textContent).not.toContain('처방 전 반드시');
  });
});
