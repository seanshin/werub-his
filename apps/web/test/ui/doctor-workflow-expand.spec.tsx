/**
 * 의사 업무 확장(2026-10-10).
 *  · 차트 검사결과 탭에서 바로 확인(정본 EP · 받은 목록 안에서만 · 잘림 고지)
 *  · 차트 의뢰/회신 탭 — 🔴 가장 최근 진료의 협진만 보던 것 → 환자 전체 · 수신자만 회신 쓰기(서버와 같은 규칙)
 *  · 할 일함 '처리한 것' — 원장에 남는 일만 · 협진 종결은 세지 않는다고 말함
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { canReplyConsult } from '@/lib/consultation-close';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/x', useSearchParams: () => new URLSearchParams() }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
const as = (role: string, extra: Record<string, unknown> = {}) => useAuthStore.setState({ user: { id: 'u1', role, familyName: '박', givenName: '의', department: '신경과', ...extra } as never, isAuthenticated: true });

beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); patch.mockReset(); patch.mockResolvedValue({ data: {} }); post.mockResolvedValue({ data: { acknowledged: 2, skipped: 0 } }); });

describe('canReplyConsult — 서버 assertRecipient 와 같은 규칙', () => {
  const me = { id: 'u1', role: 'DOCTOR', department: '신경과' };
  it('지정의 본인·미지정이면 수신 과 · 관리자 · 열린 협진만', () => {
    expect(canReplyConsult({ status: 'REQUESTED', toDoctorId: 'u1' }, me)).toBe(true);
    expect(canReplyConsult({ status: 'ACCEPTED', toDoctorId: null, toDepartment: '신경과' }, me)).toBe(true);
    expect(canReplyConsult({ status: 'REQUESTED', toDoctorId: 'other' }, me)).toBe(false);
    expect(canReplyConsult({ status: 'REPLIED', toDoctorId: 'u1' }, me)).toBe(false);
    expect(canReplyConsult({ status: 'REQUESTED', toDoctorId: 'x' }, { id: 'a', role: 'ADMIN' })).toBe(true);
    expect(canReplyConsult({ status: 'REQUESTED', toDoctorId: null, toDepartment: '신경과' }, { id: 'n', role: 'NURSE', department: '신경과' })).toBe(false);
  });
});

describe('차트 검사결과 탭 — 바로 확인', () => {
  const items = [
    { orderId: 'o1', testName: 'K', completedAt: '2026-10-10T01:00:00Z', severity: 'CRITICAL', lab: { flaggedItems: [{ testName: 'K', value: '6.1', unit: 'mmol/L', flag: 'HH' }] }, imaging: null },
    { orderId: 'o2', testName: 'CBC', completedAt: '2026-10-10T02:00:00Z', severity: 'ABNORMAL', lab: { flaggedItems: [] }, imaging: null },
  ];
  const mount = async () => {
    as('DOCTOR');
    const { LabResultsTab } = await import('@/app/(main)/patients/[id]/components/LabResultsTab');
    return render(<LabResultsTab patientId="p1" />, { wrapper: wrap });
  };
  it('항목마다 확인(PATCH 정본) · 보이는 것 모두 확인(POST 정본 — 받은 id 만) · 잘림 고지', async () => {
    get.mockImplementation(async (u: string) => (u.includes('/doctors/results-inbox') ? { data: { total: 5, counts: { critical: 1, abnormal: 1, other: 3 }, items } } : { data: [] }));
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-chart-ack="o1"]')).not.toBeNull());
    expect(get.mock.calls.find((c) => String(c[0]).includes('/doctors/results-inbox'))![0]).toContain('patientId=p1&limit=20');
    expect(container.querySelector('[data-chart-unacked-truncated]')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-chart-ack="o1"]')!);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/doctors/orders/o1/acknowledge', {}));
    fireEvent.click(container.querySelector('[data-chart-ack-shown]')!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/doctors/orders/acknowledge', { orderIds: ['o1', 'o2'] }));
  });
});

describe('차트 의뢰/회신 탭', () => {
  const consults = [
    { id: 'c-old', toDepartment: '신경과', reason: '두통', urgency: 'ROUTINE', status: 'REQUESTED', createdAt: '2026-09-01T00:00:00Z', toDoctorId: null, requestingDoctorId: 'x', encounter: { id: 'e-old' } },
    { id: 'c-other', toDepartment: '정형외과', reason: '골절', urgency: 'ROUTINE', status: 'REQUESTED', createdAt: '2026-10-01T00:00:00Z', toDoctorId: null, requestingDoctorId: 'x', encounter: { id: 'e-new' } },
  ];
  const mount = async () => {
    as('DOCTOR');
    get.mockImplementation(async (u: string) => {
      if (u.startsWith('/api/v1/encounters')) return { data: [{ id: 'e-new' }] };
      if (u.includes('/consultations/patient/p1')) return { data: consults, meta: { total: 2, truncated: false } };
      return { data: [] };
    });
    const { ReferralTab } = await import('@/app/(main)/patients/[id]/components/ReferralTab');
    return render(<ReferralTab patientId="p1" />, { wrapper: wrap });
  };
  it('🔴 환자 전체 협진(이전 진료 것 포함)을 읽는다 — 최근 진료 한 건 EP 를 부르지 않는다', async () => {
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-consult-awaiting-me="c-old"]')).not.toBeNull());
    expect(get.mock.calls.some((c) => String(c[0]).includes('/consultations/encounter/'))).toBe(false);
    // 수신 과가 아닌 협진에는 '내 회신 대기'가 없다
    expect(container.querySelector('[data-consult-awaiting-me="c-other"]')).toBeNull();
  });
  it('수신자는 회신을 쓴다 — 내용 없이는 못 보낸다 · 회신 EP 정본', async () => {
    const { container, getAllByText } = await mount();
    await waitFor(() => expect(container.querySelector('[data-consult-awaiting-me="c-old"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-consult-awaiting-me="c-old"]')!.closest('button')!);
    await waitFor(() => expect(container.querySelector('[data-consult-reply-open="c-old"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-consult-reply-open="c-old"]')!);
    const submit = container.querySelector('[data-consult-reply-submit="c-old"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-consult-reply-form="c-old"] textarea')!, { target: { value: 'MRI 권함' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/consultations/c-old/reply', { replyContent: 'MRI 권함' }));
    void getAllByText;
  });
});

describe('할 일함 — 처리한 것', () => {
  const H = {
    date: '2026-10-10', total: 3, truncated: false, limit: 50, notCounted: ['CONSULT_CLOSE'],
    counts: { RESULT_ACK: 2, VERBAL_COSIGN: 0, RENEWAL: 0, PREORDER_APPROVE: 0, PHARMACIST_REPLY: 0, CONSULT_REPLY: 1, ENCOUNTER_SIGN: 0, DISCHARGE_SIGN: 0 },
    items: [
      { kind: 'CONSULT_REPLY', id: 'c1', at: '2026-10-10T03:00:00Z', label: '신경과', patient: { id: 'p1', mrn: 'M1', familyName: '김', givenName: '가' }, href: '/patients/p1?tab=referrals' },
      { kind: 'RESULT_ACK', id: 'o1', at: '2026-10-10T02:00:00Z', label: 'K', patient: { id: 'p1', mrn: 'M1', familyName: '김', givenName: '가' }, href: '/patients/p1?tab=labresults' },
      { kind: 'RESULT_ACK', id: 'o2', at: '2026-10-10T01:00:00Z', label: 'CBC', patient: null, href: null },
    ],
  };
  it('원장 수 그대로 · 종류로 거르기 · 처리 종류 없는 칸은 비활성', async () => {
    as('DOCTOR');
    get.mockImplementation(async (u: string) => (u.includes('/doctors/my-handled') ? { data: H } : { data: [] }));
    const { HandledTodayPanel } = await import('@/app/(main)/doctor-inbox/FollowupPanels');
    const { container } = render(<HandledTodayPanel today="2026-10-10" />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-handled-total="3"]')).not.toBeNull());
    expect(get.mock.calls[0][0]).toBe('/api/v1/doctors/my-handled?date=2026-10-10');
    expect(container.querySelectorAll('[data-handled-item]').length).toBe(3);
    fireEvent.click(container.querySelector('[data-handled-kind="RESULT_ACK"]')!);
    expect(container.querySelectorAll('[data-handled-item]').length).toBe(2);
    expect((container.querySelector('[data-handled-kind="RENEWAL"]') as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain('협진 종결은 종결자가 기록되지 않아 세지 않습니다');
  });
  it('🔴 조회 실패는 0건이 아니다(오류 표시)', async () => {
    as('DOCTOR');
    get.mockImplementation(async () => { throw new Error('boom'); });
    const { HandledTodayPanel } = await import('@/app/(main)/doctor-inbox/FollowupPanels');
    const { container } = render(<HandledTodayPanel today="2026-10-10" />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-handled-panel]')!.textContent).not.toContain('처리한 일이 없습니다'));
    expect(container.querySelector('[data-handled-total]')).toBeNull();
  });
});
