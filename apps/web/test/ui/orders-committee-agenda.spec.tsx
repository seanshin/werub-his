/**
 * 위원회가 정할 것 — 그 기능 화면에서 안건으로 올리기(2026-10-07).
 *  · 주의 기준: 열린 안건이 없으면 올리기 · 후보는 1~1440 정수만(비면 못 누름) · 보낸 것은 후보·사유뿐(설정 값을 직접 보내지 않는다)
 *  · 열린 안건이 있으면 상태만(다시 올리지 않는다) · 의결된 안건이면 상태 + 다시 올리기 가능
 *  · 안건 상태 조회 실패는 실패라고(없음으로 덮지 않는다)
 *  · 지표 목표: 방향이 정해지지 않은 지표는 방향을 골라야 · 등록된 지표는 "목표 변경"
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/orders', useSearchParams: () => new URLSearchParams() }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const agenda = (o: Record<string, unknown>) => ({
  id: 'ag1', title: 't', status: 'SUBMITTED', createdAt: '2026-10-07T00:00:00Z', source: 'ORDER_ATTENTION', key: 'orders.tracking.attentionMin',
  committee: { code: 'QPS', name: '질향상·환자안전위원회' }, decision: null, ...o,
});
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); useAuthStore.setState({ user: { id: 'u1', role: 'DOCTOR' } as never, isAuthenticated: true }); });

describe('주의 기준 안건', () => {
  async function slot(list: unknown) {
    get.mockImplementation(() => (list instanceof Error ? Promise.reject(list) : Promise.resolve({ data: list })));
    const { AttentionAgendaSlot } = await import('@/app/(main)/orders/committee-agenda-ui');
    return render(<AttentionAgendaSlot />, { wrapper: wrap });
  }

  it('🔴 열린 안건이 없으면 올리기 · 빈 후보·범위 밖은 못 누름 · 후보·사유만 보낸다', async () => {
    post.mockResolvedValue({ data: {} });
    const { container, getByLabelText } = await slot([]);
    await waitFor(() => expect(container.querySelector('[data-agenda-open="attention"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-agenda-open="attention"]')!);
    const submit = container.querySelector('[data-agenda-submit]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(getByLabelText('STAT 1'), { target: { value: '2000' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(getByLabelText('STAT 1'), { target: { value: '30' } });
    fireEvent.change(getByLabelText('ROUTINE 1'), { target: { value: '240' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/orders/governance/attention-agenda', { candidates: [{ STAT: 30, ROUTINE: 240 }] }));
  });

  it('🔴 열린 안건이 있으면 상태만 — 다시 올리지 않는다', async () => {
    const { container } = await slot([agenda({ status: 'SCHEDULED' })]);
    await waitFor(() => expect(container.querySelector('[data-agenda-badge="SCHEDULED"]')).toBeTruthy());
    expect(container.querySelector('[data-agenda-badge="SCHEDULED"]')!.textContent).toContain('질향상·환자안전위원회');
    expect(container.querySelector('[data-agenda-open="attention"]')).toBeNull();
  });

  it('의결된 안건 — 상태와 의결 번호 · 다시 올릴 수 있다', async () => {
    const { container } = await slot([agenda({ status: 'RESOLVED', decision: { decisionNo: 'GOV-2026-021', status: 'ENACTED' } })]);
    await waitFor(() => expect(container.querySelector('[data-agenda-badge="RESOLVED"]')).toBeTruthy());
    expect(container.textContent).toContain('GOV-2026-021');
    expect(container.querySelector('[data-agenda-open="attention"]')).toBeTruthy();
  });

  it('🔴 안건 상태 조회 실패는 실패라고(올리기 버튼으로 덮지 않는다)', async () => {
    const { container } = await slot(new Error('boom'));
    await waitFor(() => expect(container.textContent).toContain('위원회 안건 상태를 확인하지 못했습니다'));
    expect(container.querySelector('[data-agenda-open="attention"]')).toBeNull();
  });
});

describe('지표 목표 안건', () => {
  async function slot(props: { registered: boolean; needsDirection: boolean }, list: unknown[] = []) {
    get.mockResolvedValue({ data: list });
    const { QiAgendaSlot } = await import('@/app/(main)/orders/committee-agenda-ui');
    return render(<QiAgendaSlot indicatorKey="VERBAL_RATE" {...props} />, { wrapper: wrap });
  }

  it('🔴 방향이 정해지지 않은 지표는 방향을 골라야 보낼 수 있다', async () => {
    post.mockResolvedValue({ data: {} });
    const { container, getByLabelText } = await slot({ registered: false, needsDirection: true });
    await waitFor(() => expect(container.querySelector('[data-agenda-open="qi-VERBAL_RATE"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-agenda-open="qi-VERBAL_RATE"]')!);
    fireEvent.change(getByLabelText('목표 후보 1'), { target: { value: '5' } });
    const submit = container.querySelector('[data-agenda-submit]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-agenda-direction]')!, { target: { value: 'LOWER_IS_BETTER' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/orders/quality/agenda', { key: 'VERBAL_RATE', targets: [5], direction: 'LOWER_IS_BETTER' }));
  });

  it('등록된 지표 — "목표 변경" · 방향이 정해진 지표는 방향을 보내지 않는다', async () => {
    post.mockResolvedValue({ data: {} });
    const { container, getByLabelText } = await slot({ registered: true, needsDirection: false });
    await waitFor(() => expect(container.querySelector('[data-agenda-open="qi-VERBAL_RATE"]')).toBeTruthy());
    expect(container.textContent).toContain('목표 변경');
    fireEvent.click(container.querySelector('[data-agenda-open="qi-VERBAL_RATE"]')!);
    expect(container.querySelector('[data-agenda-direction]')).toBeNull();
    fireEvent.change(getByLabelText('목표 후보 1'), { target: { value: '3' } });
    fireEvent.click(container.querySelector('[data-agenda-submit]')!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/orders/quality/agenda', { key: 'VERBAL_RATE', targets: [3] }));
  });

  it('🔴 열린 안건이 있으면 상태만', async () => {
    const { container } = await slot({ registered: false, needsDirection: false }, [agenda({ source: 'CPOE_QI', key: 'VERBAL_RATE' })]);
    await waitFor(() => expect(container.querySelector('[data-agenda-badge="SUBMITTED"]')).toBeTruthy());
    expect(container.querySelector('[data-agenda-open="qi-VERBAL_RATE"]')).toBeNull();
  });
});
