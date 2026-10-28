/**
 * 서류 수수료 ↔ 수납 연결 표시(2026-10-10 · 결정 `documents.fee.billingLink`).
 *  · 서버가 수납 원장에서 파생한 상태를 그대로 말한다 — 값이 없으면 "모름"(미수·0 으로 접지 않는다)
 *  · 꺼짐(설정 미정)과 미수·수납 완료를 구분 · 못 올린 건만 처리 역할에게 "다시 올리기"(44px)
 *  · 원무 대기 목록에 수납 칸 · 재시도는 원무에게 그리지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), getToken: () => 'x' } }));
vi.mock('@/components/ui/PatientSelector', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/workstation/documents', useSearchParams: () => new URLSearchParams() }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

const fb = (state: string) => ({ mode: state === 'OFF' ? 'OFF' : 'BILLING_ITEM', state, billingId: null, billingStatus: null });

describe('수납 연결 배지', () => {
  it('상태마다 다른 말 — 꺼짐 ≠ 미수 ≠ 수납 완료 · 값이 없으면 모름', async () => {
    const { FeeBillingBadge } = await import('@/app/(main)/workstation/documents/FeeBillingBadge');
    const { container, rerender } = render(<FeeBillingBadge value={fb('OFF') as never} />, { wrapper: wrap });
    const text = () => container.textContent ?? '';
    expect(text()).toContain('설정 미정');
    rerender(<FeeBillingBadge value={fb('UNPAID') as never} />);
    expect(text()).toContain('미수');
    rerender(<FeeBillingBadge value={fb('PAID') as never} />);
    expect(text()).toContain('수납 완료');
    rerender(<FeeBillingBadge value={fb('NO_ENCOUNTER') as never} />);
    expect(text()).toContain('창구에서 따로 수납');
    rerender(<FeeBillingBadge value={null} />);
    expect(container.querySelector('[data-fee-billing="UNKNOWN"]')).not.toBeNull();
    expect(text()).not.toContain('미수');
  });

  it('🔴 다시 올리기는 못 올린 건 + 처리 역할에게만 · 결과를 말한다', async () => {
    const { FeeBillingBadge } = await import('@/app/(main)/workstation/documents/FeeBillingBadge');
    const onChanged = vi.fn();
    const { container, rerender } = render(<FeeBillingBadge value={fb('NOT_LINKED') as never} requestId="r1" canRetry={false} />, { wrapper: wrap });
    expect(container.querySelector('[data-fee-billing-retry]')).toBeNull();
    rerender(<FeeBillingBadge value={fb('UNPAID') as never} requestId="r1" canRetry />);
    expect(container.querySelector('[data-fee-billing-retry]')).toBeNull();
    rerender(<FeeBillingBadge value={fb('NOT_LINKED') as never} requestId="r1" canRetry onChanged={onChanged} />);
    const btn = container.querySelector('[data-fee-billing-retry]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.className).toContain('min-h-[44px]');
    post.mockResolvedValueOnce({ data: { attempted: true, result: 'BILLING_NOT_OPEN', billingId: 'b1' } });
    fireEvent.click(btn);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe('/api/v1/staff/document-requests/r1/fee-billing');
  });
});

describe('원무 대기 목록 — 수납 칸', () => {
  it('행마다 서버 상태 · 재시도 버튼은 원무에게 없다', async () => {
    get.mockImplementation(async () => ({ data: { items: [
      { id: 'r1', type: 'DIAGNOSIS_CERT', status: 'READY', copies: 1, createdAt: '2026-10-10T00:00:00Z', slaDueAt: null, patient: { mrn: 'M1', name: '김가' }, feeBilling: fb('NOT_LINKED') },
      { id: 'r2', type: 'MEDICAL_RECORD', status: 'REQUESTED', copies: 1, createdAt: '2026-10-10T00:00:00Z', slaDueAt: null, patient: { mrn: 'M2', name: '이나' } },
    ], stats: {}, total: 2, truncated: false } }));
    useAuthStore.setState({ user: { id: 'u1', role: 'RECEPTIONIST', familyName: '박', givenName: '원무' } as never, isAuthenticated: true });
    const { default: Page } = await import('@/app/(main)/workstation/documents/page');
    const { container } = render(<Page />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-reception-doc-row="r1"] [data-fee-billing="NOT_LINKED"]')).not.toBeNull());
    expect(container.querySelector('[data-reception-doc-row="r2"] [data-fee-billing="UNKNOWN"]')).not.toBeNull();
    expect(container.querySelector('[data-fee-billing-retry]')).toBeNull();
  });
});
