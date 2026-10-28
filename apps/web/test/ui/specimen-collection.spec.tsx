/**
 * 검체 채취 기록 화면(2026-10-01) — 채취는 검사실 접수와 다른 사건.
 *  · 기록 없음: [지금 채취](시각 없이) · [시각 입력](ISO 로) · 서버 거절 문장을 그대로 보인다
 *  · 기록됨: 채취 시각·채취자·입력된 시각 표식
 *  · 병동 채혈 대기: 재원 환자의 접수 전 검사 · 실패≠없음 · 빈 목록 문구
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a), getToken: () => 'x' } }));
const toastError = vi.fn();
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: (m: string) => toastError(m), info: vi.fn(), warning: vi.fn() } }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); patch.mockReset(); toastError.mockReset(); });

describe('채취 기록 컨트롤', () => {
  it('[지금 채취] 는 시각 없이 · [시각 입력] 은 ISO 로 보낸다', async () => {
    patch.mockResolvedValue({ data: {} });
    const { SpecimenCollectionControl } = await import('@/components/workstation/SpecimenCollectionControl');
    const { container } = render(<SpecimenCollectionControl orderId="o1" invalidateKeys={[['k']]} />, { wrapper: wrap });
    expect(container.textContent).toContain('채취 기록 없음');
    fireEvent.click(screen.getByText('지금 채취'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/workstation/order/o1/specimen-collection', {}));
    fireEvent.click(screen.getByText('시각 입력'));
    fireEvent.change(container.querySelector('input[type="datetime-local"]')!, { target: { value: '2026-10-01T08:30' } });
    fireEvent.click(screen.getByText('저장'));
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith('/api/v1/workstation/order/o1/specimen-collection', { collectedAt: new Date('2026-10-01T08:30').toISOString() }));
  });
  it('🔴 서버 거절(접수 뒤 시각 등)은 그 문장을 보인다', async () => {
    patch.mockRejectedValue(Object.assign(new Error('채취 시각이 검사실 접수보다 늦을 수 없습니다'), { status: 400 }));
    const { SpecimenCollectionControl } = await import('@/components/workstation/SpecimenCollectionControl');
    render(<SpecimenCollectionControl orderId="o1" invalidateKeys={[]} />, { wrapper: wrap });
    fireEvent.click(screen.getByText('지금 채취'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toContain('채취 시각이 검사실 접수보다 늦을 수 없습니다');
  });
  it('기록됨 — 시각·채취자·입력된 시각 표식 · 버튼 없음', async () => {
    const { SpecimenCollectionControl } = await import('@/components/workstation/SpecimenCollectionControl');
    const { container } = render(<SpecimenCollectionControl orderId="o1" collectedAt="2026-10-01T08:30:00Z" collectorName="김간호" source="ENTERED_LATER" invalidateKeys={[]} />, { wrapper: wrap });
    expect(container.querySelector('[data-specimen-collected]')).not.toBeNull();
    expect(container.textContent).toContain('김간호');
    expect(container.textContent).toContain('입력된 시각');
    expect(screen.queryByText('지금 채취')).toBeNull();
  });
});

describe('병동 채혈 대기', () => {
  it('재원 환자의 접수 전 검사 · 병실 · 잘림 안내', async () => {
    get.mockResolvedValue({ data: [{ orderId: 'o1', priority: 'STAT', orderedAt: '2026-10-01T08:00:00Z', waitingMin: 90, testName: 'CBC', testCode: 'CBC', patient: { id: 'p', mrn: 'M1', familyName: '김', givenName: '환자' }, ward: { id: 'w', name: '5병동' }, room: '501-A' }], meta: { truncated: true, limit: 200 } });
    const { WardSpecimenPendingPanel } = await import('@/components/workstation/WardSpecimenPendingPanel');
    const { container } = render(<WardSpecimenPendingPanel />, { wrapper: wrap });
    await waitFor(() => expect(container.textContent).toContain('CBC'));
    expect(container.textContent).toContain('5병동 · 501-A');
    expect(container.textContent).toContain('STAT');
    expect(container.textContent).toContain('오래된 순 200건만 표시합니다');
    expect(get).toHaveBeenCalledWith('/api/v1/workstation/specimen-collection/pending');
  });
  it('🔴 실패는 실패로 · 빈 목록은 빈 목록으로', async () => {
    const { WardSpecimenPendingPanel } = await import('@/components/workstation/WardSpecimenPendingPanel');
    get.mockResolvedValue({ data: [], meta: {} });
    const a = render(<WardSpecimenPendingPanel />, { wrapper: wrap });
    await waitFor(() => expect(a.container.textContent).toContain('채취를 기다리는 검사 오더가 없습니다'));
    cleanup();
    get.mockRejectedValue(new Error('500'));
    const b = render(<WardSpecimenPendingPanel />, { wrapper: wrap });
    await waitFor(() => expect(b.container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(b.container.textContent).not.toContain('채취를 기다리는 검사 오더가 없습니다');
  });
});
