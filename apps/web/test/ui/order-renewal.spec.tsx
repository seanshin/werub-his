/**
 * 지속 처방 갱신·만료 화면 — 2026-09-30.
 *  1. 갱신 창 — 일수·총량을 비워 두면 보내지 않는다(원처방 값을 복사해 채우지 않는다) · 입력값으로 갱신 EP
 *  2. 갱신 대기 — 조회 실패는 "필요한 처방 없음"이 아니다 · 칸별로 나눠 보이고 재검토 기한 미설정을 말한다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

describe('갱신 창', () => {
  it('원처방 값은 참고로만 · 비어 있으면 못 보냄 · 입력한 일수·총량으로 갱신', async () => {
    post.mockResolvedValue({ data: { prescription: { id: 'n' }, renewedFromId: 'rx1' } });
    const { RenewDialog } = await import('@/components/prescription/RenewDialog');
    const onDone = vi.fn();
    const { container } = render(<RenewDialog prescriptionId="rx1" name="세파졸린" current={{ dosage: '1g', frequency: 'q8h', duration: 5, quantity: 15 }} onClose={() => {}} onDone={onDone} />, { wrapper: wrap });
    const days = container.querySelector('[data-renew-days]') as HTMLInputElement;
    expect(days.value).toBe(''); // 5 로 채우지 않는다
    const btn = container.querySelector('[data-renew-submit]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(days, { target: { value: '3' } });
    fireEvent.change(container.querySelector('[data-renew-quantity]')!, { target: { value: '9' } });
    fireEvent.click(btn);
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/prescriptions/rx1/renew', { days: 3, quantity: 9 }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});

describe('갱신 대기 목록', () => {
  const mount = async () => {
    const { default: Page } = await import('@/app/(main)/renewals/page');
    return render(<Page />, { wrapper: wrap });
  };
  it('🔴 조회 실패는 "필요한 처방 없음"이 아니다', async () => {
    get.mockRejectedValue(new Error('500'));
    const { container } = await mount();
    await vi.waitFor(() => expect(container.textContent).toMatch(/다시|재시도|불러오지/), { timeout: 10_000 });
    expect(container.textContent).not.toContain('갱신이나 중단이 필요한 처방이 없습니다');
  });
  it('만료됨·기간 없음을 칸별로 · 재검토 기한 미설정을 말한다 · 갱신 창을 연다', async () => {
    const it0 = (id: string, bucket: string, endsAt: string | null) => ({ id, bucket, createdAt: '2026-09-20T00:00:00Z', duration: endsAt ? 3 : null, quantity: 6, dosage: '1g', frequency: 'q8h', route: 'IV', medicationCode: { nameKo: id }, dosing: { state: endsAt ? 'ENDED' : 'UNKNOWN', endsAt, daysSinceEnd: 1 }, encounter: { id: 'e', patient: { id: 'p', familyName: '김', givenName: '환자' } } });
    get.mockResolvedValue({ data: { items: [it0('만료약', 'EXPIRED', '2026-09-29T00:00:00Z'), it0('기간없는약', 'NO_END', null)], counts: { EXPIRED: 1, ENDING_SOON: 0, NO_END: 1 }, soonHours: 24, noEndReviewDays: null, scanned: 2, totalActive: 2, truncated: false } });
    const { container, findByText } = await mount();
    await findByText('만료약', {}, { timeout: 10_000 });
    expect(container.querySelector('[data-renew-bucket="EXPIRED"]')).toBeTruthy();
    expect(container.querySelector('[data-renew-bucket="NO_END"]')).toBeTruthy();
    expect(container.querySelector('[data-renew-bucket="ENDING_SOON"]')).toBeNull();
    expect(container.querySelector('[data-renew-policy]')?.textContent).toContain('미설정');
    fireEvent.click(container.querySelector('[data-renew-open="만료약"]')!);
    expect(container.querySelector('[data-renew-dialog]')).toBeTruthy();
  }, 20_000);
});
