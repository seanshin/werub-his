/**
 * 의사 후속 업무 흐름 추적(2026-10-10).
 *  · 🔴 협진 종결 버튼 — 회신된 협진이면 누구에게나(간호사·남의 협진) 그렸고 서버가 막으면 아무 말이 없었다 → 서버와 같은 규칙으로만
 *  · 🔴 협진 접수·회신 알림(의뢰의가 받는다)이 '받은 협진'으로 열렸다 → 보낸 협진 · 미서명 차트 알림은 환자 목록 → 할 일함 미서명 기록
 *  · 차트 검사결과 탭이 이 환자의 의사 미확인 결과 수를 말하고 확인 목록으로 보낸다(실패≠0 · 권한 밖 미호출)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { canCloseConsult } from '@/lib/consultation-close';
import { hrefForNotification } from '@/stores/notification-store';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/x', useSearchParams: () => new URLSearchParams() }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

beforeEach(() => { cleanup(); get.mockReset(); });

describe('협진 종결 — 서버와 같은 규칙', () => {
  const c = { requestingDoctorId: 'req', toDoctorId: 'to', toDepartment: '신경과' };
  it('의뢰의·지정 수신의·관리자만', () => {
    expect(canCloseConsult(c, { id: 'req', role: 'DOCTOR' })).toBe(true);
    expect(canCloseConsult(c, { id: 'to', role: 'DOCTOR' })).toBe(true);
    expect(canCloseConsult(c, { id: 'x', role: 'ADMIN' })).toBe(true);
    expect(canCloseConsult(c, { id: 'other', role: 'DOCTOR', department: '신경과' })).toBe(false);
    expect(canCloseConsult(c, { id: 'req', role: 'NURSE' })).toBe(false);
    expect(canCloseConsult(c, null)).toBe(false);
  });
  it('미지정 협진은 수신 과 소속 의사', () => {
    const d = { ...c, toDoctorId: null };
    expect(canCloseConsult(d, { id: 'n', role: 'DOCTOR', department: '신경과' })).toBe(true);
    expect(canCloseConsult(d, { id: 'n', role: 'DOCTOR', department: '내과' })).toBe(false);
  });
});

describe('알림 → 그 일을 처리하는 화면', () => {
  it('🔴 협진 접수·회신(의뢰의 수신)은 보낸 협진 · 요청은 종전대로', () => {
    expect(hrefForNotification('consultation', 'c1', 'CONSULT_REPLY')).toBe('/consultations?scope=sent');
    expect(hrefForNotification('consultation', 'c1', 'CONSULT_REQUEST')).toBe('/consultations');
  });
  it('🔴 미서명 차트 회수 → 할 일함 미서명 기록', () => {
    expect(hrefForNotification('DRAFT_CHART', 'e1', 'DRAFT_CHART_REMINDER')).toBe('/doctor-inbox?tab=unsigned');
  });
});

describe('차트 검사결과 탭 — 이 환자의 의사 미확인 결과', () => {
  const mount = async (role: string) => {
    useAuthStore.setState({ user: { id: 'u1', role, familyName: '박', givenName: '의' } as never, isAuthenticated: true });
    const { LabResultsTab } = await import('@/app/(main)/patients/[id]/components/LabResultsTab');
    return render(<LabResultsTab patientId="p1" />, { wrapper: wrap });
  };
  it('수와 위급 · 확인 목록(그 환자)으로', async () => {
    get.mockImplementation(async (u: string) => (u.includes('/doctors/results-inbox') ? { data: { total: 3, counts: { critical: 1, abnormal: 1, other: 1 }, items: [] } } : { data: [] }));
    const { container } = await mount('DOCTOR');
    await waitFor(() => expect(container.querySelector('[data-chart-unacked="3"]')).not.toBeNull());
    expect(container.querySelector('[data-chart-unacked-link]')!.getAttribute('href')).toBe('/doctor-inbox?tab=results&patientId=p1');
  });
  it('🔴 조회 실패는 0건이 아니라고 말한다', async () => {
    get.mockImplementation(async (u: string) => { if (u.includes('/doctors/results-inbox')) throw new Error('boom'); return { data: [] }; });
    const { container } = await mount('DOCTOR');
    await waitFor(() => expect(container.querySelector('[data-chart-unacked="failed"]')).not.toBeNull());
  });
  it('🔴 권한 밖(간호사)은 부르지 않는다', async () => {
    get.mockImplementation(async () => ({ data: [] }));
    await mount('NURSE');
    await new Promise((r) => setTimeout(r, 10));
    expect(get.mock.calls.some((c) => String(c[0]).includes('/doctors/results-inbox'))).toBe(false);
  });
});
