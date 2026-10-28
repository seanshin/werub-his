/**
 * 입원 중간정산 화면(2026-10-22).
 *  · 🔴 수납은 수단을 고른 뒤에만(미선택 시작 · 종전엔 버튼 한 번에 수단 없이 "수납 완료") · 카드면 승인번호 전 잠김 · 보낸 값
 *  · 🔴 실패는 서버가 말한 이유 그대로 · 창은 닫지 않는다(종전엔 "수납에 실패했습니다" 한 마디)
 *  · 산정 근거 — 박 수 × 일당 · 단가 출처 · 상수 단가 경고 · 근거 칸 전 회차는 모른다고
 *  · 무효 — 수납 전 마지막 회차에만 단추 · 사유 4자 전 잠김 · 무효 회차는 합계에서 뺀다
 *  · 수납된 회차는 수단을 말한다(원장 줄 없으면 "수단 미기록")
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); patch.mockReset(); });

const ROWS = [
  { id: 'i1', sequenceNo: 1, status: 'PAID', totalAmount: 100000, insuranceAmount: 80000, copayAmount: 20000, paidAmount: 20000, paidAt: '2026-10-10T01:00:00Z', periodStart: '2026-10-01', periodEnd: '2026-10-03', days: null, dailyRate: null, payments: [] },
  { id: 'i2', sequenceNo: 2, status: 'VOID', totalAmount: 50000, insuranceAmount: 40000, copayAmount: 10000, periodStart: '2026-10-03', periodEnd: '2026-10-04', days: 1, dailyRate: 50000, priceBasis: 'DEFAULT_CONSTANT', copayRate: 0.2, voidReason: '날짜 착오' },
  { id: 'i3', sequenceNo: 3, status: 'GENERATED', totalAmount: 150000, insuranceAmount: 120000, copayAmount: 30000, periodStart: '2026-10-03', periodEnd: '2026-10-06', days: 3, dailyRate: 50000, priceBasis: 'DEFAULT_CONSTANT', copayRate: 0.2 },
];
async function mount(rows: unknown[] = ROWS) {
  get.mockResolvedValue({ data: rows });
  const { InterimBillingSection } = await import('@/app/(main)/inpatient/[admissionId]/InterimBillingSection');
  const v = render(<InterimBillingSection admissionId="a1" />, { wrapper: wrap });
  await waitFor(() => expect(v.container.querySelector('[data-interim-row="i3"]')).toBeTruthy());
  return v;
}

describe('🔴 수납 — 수단 고른 뒤에만', () => {
  it('미선택 시작 잠김 · 카드면 승인번호 전 잠김 · 보낸 값(금액=본인부담·수단·승인번호)', async () => {
    patch.mockResolvedValue({ data: {} });
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-interim-pay-open="i3"]')!);
    const submit = container.querySelector('[data-interim-pay-submit]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect([...container.querySelectorAll('[data-interim-method]')].every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    fireEvent.click(container.querySelector('[data-interim-method="CARD"]')!);
    expect(submit.disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-interim-card-approval]')!, { target: { value: '77001234' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/inpatient/a1/interim-billings/i3/pay', { amount: 30000, method: 'CARD', cardApprovalNo: '77001234' }));
  });
  it('🔴 실패는 서버 사유 그대로 · 창 유지', async () => {
    patch.mockRejectedValue(Object.assign(new Error('중간정산은 본인부담금 전액을 받습니다'), { code: 'INTERIM_AMOUNT_MISMATCH' }));
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-interim-pay-open="i3"]')!);
    fireEvent.click(container.querySelector('[data-interim-method="CASH"]')!);
    fireEvent.click(container.querySelector('[data-interim-pay-submit]')!);
    await waitFor(() => expect(container.querySelector('[data-interim-pay-error]')!.textContent).toContain('본인부담금 전액'));
    expect(container.querySelector('[data-interim-pay-form="i3"]')).toBeTruthy();
  });
});

describe('근거·무효·합계', () => {
  it('근거 — 박 수 × 일당 · 상수 단가 경고 · 근거 칸 전 회차는 모른다고', async () => {
    const { container } = await mount();
    expect(container.querySelector('[data-interim-row="i3"] [data-interim-basis="DEFAULT_CONSTANT"]')!.textContent).toMatch(/3/);
    expect(container.querySelector('[data-interim-row="i3"] [data-interim-default-price]')).toBeTruthy();
    expect(container.querySelector('[data-interim-row="i1"] [data-interim-basis="LEGACY"]')).toBeTruthy();
  });
  it('무효 단추 = 수납 전 마지막 살아 있는 회차에만 · 사유 4자 전 잠김 · 보낸 사유', async () => {
    patch.mockResolvedValue({ data: {} });
    const { container } = await mount();
    expect(container.querySelector('[data-interim-void-open="i1"]')).toBeNull();
    expect(container.querySelector('[data-interim-void-open="i2"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-interim-void-open="i3"]')!);
    const submit = container.querySelector('[data-interim-void-submit]') as HTMLButtonElement;
    fireEvent.change(container.querySelector('[data-interim-void-reason-input]')!, { target: { value: '착오' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-interim-void-reason-input]')!, { target: { value: '기간 착오로 재생성' } });
    fireEvent.click(submit);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/inpatient/a1/interim-billings/i3/void', { reason: '기간 착오로 재생성' }));
  });
  it('🔴 미수납 회차가 둘이면 마지막 회차에만 무효 단추(가운데를 무효로 하면 기간에 구멍)', async () => {
    const { container } = await mount([...ROWS, { ...ROWS[2], id: 'i4', sequenceNo: 4, periodStart: '2026-10-06', periodEnd: '2026-10-08' }]);
    expect(container.querySelector('[data-interim-void-open="i3"]')).toBeNull();
    expect(container.querySelector('[data-interim-void-open="i4"]')).toBeTruthy();
  });
  it('🔴 무효 회차는 합계에서 뺀다 · 수납 회차의 원장 줄 없으면 "수단 미기록"', async () => {
    const { container } = await mount();
    // 누적 본인부담 = 20,000 + 30,000(무효 10,000 제외) · 미수납 = 30,000
    expect(container.querySelector('[data-interim-total-copay]')!.getAttribute('data-interim-total-copay')).toBe('50000');
    expect(container.querySelector('[data-interim-unpaid]')!.getAttribute('data-interim-unpaid')).toBe('30000');
    expect(container.querySelector('[data-interim-row="i1"] [data-interim-payment-method="UNKNOWN"]')).toBeTruthy();
    expect(container.querySelector('[data-interim-row="i2"] [data-interim-void-reason]')!.textContent).toContain('날짜 착오');
  });
  it('대조군 — 원장 줄이 있으면 수단을 말한다', async () => {
    const rows = [{ ...ROWS[0], payments: [{ id: 'p', method: 'TRANSFER', amount: 20000, createdAt: '2026-10-10T01:00:00Z' }] }, ROWS[2]];
    const { container } = await mount(rows);
    expect(container.querySelector('[data-interim-row="i1"] [data-interim-payment-method="TRANSFER"]')!.textContent).toContain('계좌이체');
  });
});

describe('🔴 환불(2026-10-22 · ERP R5) — 수납된 회차 · 누적 ≤ 받은 금액', () => {
  const PAID_WITH_REFUND = { ...ROWS[0], refunds: [{ id: 'r1', amount: 5000, method: 'CASH', reason: '조기 퇴원 차액', refundedAt: '2026-10-12T01:00:00Z' }] };
  it('수납된 회차에만 단추 · 돌려줄 수 있는 금액 = 받은 돈 − 이미 환불 · 합계는 순액 · 미수납에 환불을 더하지 않는다', async () => {
    const { container } = await mount([PAID_WITH_REFUND, ROWS[2]]);
    expect(container.querySelector('[data-interim-refund-open="i3"]')).toBeNull();
    expect(container.querySelector('[data-interim-refund="r1"]')).toBeTruthy();
    expect(container.querySelector('[data-interim-total-paid]')!.getAttribute('data-interim-total-paid')).toBe('15000');
    expect(container.querySelector('[data-interim-total-refunded]')!.getAttribute('data-interim-total-refunded')).toBe('5000');
    expect(container.querySelector('[data-interim-unpaid]')!.getAttribute('data-interim-unpaid')).toBe('30000');
    fireEvent.click(container.querySelector('[data-interim-refund-open="i1"]')!);
    expect(container.querySelector('[data-interim-refundable]')!.getAttribute('data-interim-refundable')).toBe('15000');
  });
  it('🔴 금액·수단 미선택 시작 · 넘는 금액·소수·사유 4자 미만 잠김 · 보낸 값', async () => {
    post.mockResolvedValue({ data: {} });
    const { container } = await mount([PAID_WITH_REFUND, ROWS[2]]);
    fireEvent.click(container.querySelector('[data-interim-refund-open="i1"]')!);
    const submit = container.querySelector('[data-interim-refund-submit]') as HTMLButtonElement;
    expect((container.querySelector('[data-interim-refund-amount]') as HTMLInputElement).value).toBe('');
    expect([...container.querySelectorAll('[data-interim-refund-method]')].every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    fireEvent.change(container.querySelector('[data-interim-refund-amount]')!, { target: { value: '15001' } });
    fireEvent.click(container.querySelector('[data-interim-refund-method="CASH"]')!);
    fireEvent.change(container.querySelector('[data-interim-refund-reason]')!, { target: { value: '조기 퇴원 차액' } });
    expect(container.querySelector('[data-interim-refund-amount-error]')).toBeTruthy();
    expect(submit.disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-interim-refund-amount]')!, { target: { value: '100.5' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-interim-refund-amount]')!, { target: { value: '15000' } });
    fireEvent.change(container.querySelector('[data-interim-refund-reason]')!, { target: { value: '차액' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-interim-refund-reason]')!, { target: { value: '  조기 퇴원 차액  ' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/inpatient/a1/interim-billings/i1/refund', { amount: 15000, method: 'CASH', reason: '조기 퇴원 차액' }, { 'Idempotency-Key': expect.stringMatching(/^[A-Za-z0-9_-]{8,100}$/) }));
  });
  it('🔴 실패는 서버 사유 그대로 · 창 유지 · 다 돌려준 회차엔 단추 없음', async () => {
    post.mockRejectedValue(new Error('환불 합계가 이 회차에서 받은 금액을 넘습니다'));
    const { container } = await mount([PAID_WITH_REFUND, ROWS[2]]);
    fireEvent.click(container.querySelector('[data-interim-refund-open="i1"]')!);
    fireEvent.change(container.querySelector('[data-interim-refund-amount]')!, { target: { value: '1000' } });
    fireEvent.click(container.querySelector('[data-interim-refund-method="TRANSFER"]')!);
    fireEvent.change(container.querySelector('[data-interim-refund-reason]')!, { target: { value: '조기 퇴원 차액' } });
    fireEvent.click(container.querySelector('[data-interim-refund-submit]')!);
    await waitFor(() => expect(container.querySelector('[data-interim-refund-error]')!.textContent).toContain('받은 금액을 넘습니다'));
    expect(container.querySelector('[data-interim-refund-form="i1"]')).toBeTruthy();
    cleanup();
    const full = await mount([{ ...ROWS[0], refunds: [{ id: 'r2', amount: 20000, method: 'CASH', reason: '전액 환불', refundedAt: '2026-10-12T01:00:00Z' }] }, ROWS[2]]);
    expect(full.container.querySelector('[data-interim-refund-open="i1"]')).toBeNull();
  });
});

describe('🔴 환불 요청 중복 방지 키(v4.118.0 · ERP 2차 회신)', () => {
  const ROW_PAID = { ...ROWS[0], refunds: [] };
  const fill = (c: HTMLElement, amount: string, reason: string) => {
    fireEvent.change(c.querySelector('[data-interim-refund-amount]')!, { target: { value: amount } });
    fireEvent.click(c.querySelector('[data-interim-refund-method="CASH"]')!);
    fireEvent.change(c.querySelector('[data-interim-refund-reason]')!, { target: { value: reason } });
  };
  it('🔴 응답을 못 받은 재시도(같은 내용) = 같은 키 · 내용을 바꾸면 새 키', async () => {
    post.mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new Error('network')).mockResolvedValue({ data: {}, meta: { replayed: false } });
    const { container } = await mount([ROW_PAID, ROWS[2]]);
    fireEvent.click(container.querySelector('[data-interim-refund-open="i1"]')!);
    fill(container, '1000', '조기 퇴원 차액');
    fireEvent.click(container.querySelector('[data-interim-refund-submit]')!);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((container.querySelector('[data-interim-refund-submit]') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(container.querySelector('[data-interim-refund-submit]')!);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const k1 = post.mock.calls[0][2]['Idempotency-Key']; const k2 = post.mock.calls[1][2]['Idempotency-Key'];
    expect(k1).toBe(k2);
    await waitFor(() => expect((container.querySelector('[data-interim-refund-submit]') as HTMLButtonElement).disabled).toBe(false));
    fill(container, '2000', '조기 퇴원 차액');
    fireEvent.click(container.querySelector('[data-interim-refund-submit]')!);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post.mock.calls[2][2]['Idempotency-Key']).not.toBe(k1);
  });
  it('재전송으로 판정되면 "이미 기록" 이라고 말한다(새로 기록했다고 하지 않는다)', async () => {
    const { toast } = await import('@/stores/toast-store');
    post.mockResolvedValue({ data: {}, meta: { replayed: true } });
    const { container } = await mount([ROW_PAID, ROWS[2]]);
    fireEvent.click(container.querySelector('[data-interim-refund-open="i1"]')!);
    fill(container, '1000', '조기 퇴원 차액');
    fireEvent.click(container.querySelector('[data-interim-refund-submit]')!);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('이미 기록된 환불')));
  });
});
