/**
 * 청구 상세 — 심사 결과 입력·항목 내역(2026-10-14 결함 발굴 수납·청구 P2-3 · P4-3 일부).
 *  · 🔴 종전 `parseFloat(approvedAmount) || 0` — 인정액 칸을 비우면 0 을 보내 '인정 0 · 삭감 0'
 *  · 인정 = 청구액 · 반려 = 0 · 부분인정만 입력(비어 있거나 청구액 이상이면 저장 불가)
 *  · 🔴 항목 내역이 `type`/`category` 만 읽어 늘 비었다 — 원장 칸은 `codeType`
 */
import { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), getToken: () => 'x' }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));

const CLAIM = { data: { id: 'c1', status: 'SUBMITTED', claimedAmount: 70000, claimDate: '2026-10-13', patient: { familyName: '홍', givenName: '길동' },
  billing: { items: [{ codeType: 'LAB', codeName: 'CBC', amount: 10000 }, { codeType: 'MEDICATION', codeName: '아목시실린', amount: 5000 }] } } };

async function mount() {
  api.get.mockImplementation(async (url: string) => (url === '/api/v1/claims/c1' ? CLAIM : { data: [] }));
  api.patch.mockResolvedValue({ data: {} });
  const { default: Page } = await import('@/app/(main)/claims/[id]/page');
  const params = Promise.resolve({ id: 'c1' });
  let v!: ReturnType<typeof render>;
  await act(async () => {
    v = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Suspense fallback={null}><Page params={params} /></Suspense></QueryClientProvider>);
  });
  await waitFor(() => expect(v.container.textContent).toContain('심사결과 입력'));
  fireEvent.click([...v.container.querySelectorAll('button')].find((b) => b.textContent === '심사결과 입력')!);
  return v;
}
const saveBtn = (v: ReturnType<typeof render>) => [...v.container.querySelectorAll('button')].find((b) => b.textContent === '심사결과 저장') as HTMLButtonElement;
const pick = (v: ReturnType<typeof render>, val: string) => fireEvent.change(v.container.querySelector('select')!, { target: { value: val } });

beforeEach(() => { cleanup(); api.get.mockReset(); api.patch.mockReset(); });

describe('🔴 심사 결과 입력', () => {
  it('부분인정 — 인정액 비어 있으면 저장 불가(0 을 보내지 않는다) · 청구액 이상도 불가 · 입력하면 그 값', async () => {
    const v = await mount();
    pick(v, 'PARTIALLY_APPROVED');
    expect(saveBtn(v).disabled).toBe(true);
    const input = v.container.querySelector('[data-claim-approved-input]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '70000' } });
    expect(saveBtn(v).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '50000' } });
    expect(saveBtn(v).disabled).toBe(false);
    fireEvent.click(saveBtn(v));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch.mock.calls[0][1]).toMatchObject({ reviewResult: 'PARTIALLY_APPROVED', approvedAmount: 50000 });
  });
  it('인정 = 청구액 전액을 보낸다 · 반려 = 0', async () => {
    const v = await mount();
    pick(v, 'APPROVED');
    fireEvent.click(saveBtn(v));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch.mock.calls[0][1].approvedAmount).toBe(70000);
    await waitFor(() => expect(v.container.querySelector('select')).toBeNull()); // 저장 뒤 닫힘
    fireEvent.click([...v.container.querySelectorAll('button')].find((b) => b.textContent === '심사결과 입력')!);
    pick(v, 'REJECTED');
    fireEvent.click(saveBtn(v));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect(api.patch.mock.calls[1][1].approvedAmount).toBe(0);
  });
  it('🔴 항목 내역 — 원장 codeType 으로 나뉜다(종전엔 늘 "상세 내역이 없습니다")', async () => {
    const v = await mount();
    expect(v.container.textContent).toContain('CBC');
    expect(v.container.textContent).toContain('아목시실린');
    expect(v.container.textContent).not.toContain('행목별 상세 내역이 없습니다.');
  });
});
