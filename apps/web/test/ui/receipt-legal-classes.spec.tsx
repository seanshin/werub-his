/**
 * 진료비 영수증 법정 항목(2026-10-14 결함 발굴 수납·청구 P2-1).
 *  · 🔴 종전: 진찰료 라인(PROCEDURE)이 ⑨ 로 가고 빈 ① 진찰료 칸에 15,000원을 지어 넣었다(공단·본인부담도 비율로)
 *  · 🔴 종전: 비급여가 '일부본인부담'(본인부담 − 전액본인부담)과 '비급여' 두 칸에 이중으로 찍혔다
 *  · 칸은 서버의 `receiptClass` · 맞는 칸이 없으면 '분류 미등재' 한 줄 · 대조군: 칸 합 = 합계
 */
import { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), getToken: () => 'x' }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));

const ITEMS = [
  { id: 'a', type: 'PROCEDURE', receiptClass: 'CONSULTATION', name: '초진 진찰료', totalPrice: 16820, copayRate: 0.3, insuranceType: 'COVERED', fullCopay: false },
  { id: 'b', type: 'LAB', receiptClass: 'LAB', name: 'CBC', totalPrice: 10000, copayRate: 0.3, insuranceType: 'COVERED', fullCopay: false },
  { id: 'c', type: 'PROCEDURE', receiptClass: 'PROCEDURE', name: '비급여 처치', totalPrice: 20000, copayRate: 1, insuranceType: 'NON_COVERED', fullCopay: true },
];
const BILL = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  data: { id: 'b1', status: 'PAID', totalAmount: 46820, insuranceCovered: 18774, patientCopay: 28046, paidAmount: 28046, createdAt: '2026-10-13T01:00:00Z', patient: { familyName: '홍', givenName: '길동', mrn: 'M1', insuranceType: 'NHI' }, items, ...extra },
});
const route = (bill: unknown) => {
  api.get.mockImplementation(async (url: string) => (url.includes('/receipt') ? bill : url.includes('/config') ? { data: [] } : { data: [] }));
  api.post.mockResolvedValue({ data: { issueNo: 'R-1' } });
};
async function mount() {
  const { default: Page } = await import('@/app/(main)/print/receipt/[billingId]/page');
  const params = Promise.resolve({ billingId: 'b1' });
  let v!: ReturnType<typeof render>;
  await act(async () => {
    v = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Suspense fallback={null}><Page params={params} /></Suspense></QueryClientProvider>);
  });
  await waitFor(() => expect(v.container.textContent).toContain('급여 소계'));
  return v;
}
const row = (v: ReturnType<typeof render>, name: string) =>
  [...v.container.querySelectorAll('tr')].find((tr) => tr.querySelectorAll('td')[1]?.textContent === name || tr.querySelectorAll('td')[0]?.textContent === name);
const cells = (tr: Element | undefined) => [...(tr?.querySelectorAll('td') ?? [])].map((td) => td.textContent?.trim());

beforeEach(() => { cleanup(); api.get.mockReset(); api.post.mockReset(); });

describe('🔴 영수증 법정 항목', () => {
  it('진찰료는 서버 분류대로 ① 칸 · 15,000원을 지어내지 않는다 · ⑨ 엔 비급여만', async () => {
    route(BILL(ITEMS));
    const v = await mount();
    expect(cells(row(v, '진찰료'))[2]).toBe('16,820');
    expect(v.container.textContent).not.toContain('15,000');
    expect(cells(row(v, '처치·수술료'))[2]).toBe('20,000');
  });

  it('🔴 비급여를 일부본인부담에 다시 넣지 않는다 — 일부본인부담 = 본인부담 − 전액본인부담 − 비급여', async () => {
    route(BILL(ITEMS));
    const v = await mount();
    const sub = cells(row(v, '급여 소계'));
    expect(sub[3]).toBe('8,046'); // 28,046 − 0 − 20,000
  });

  it('진찰료 라인이 없으면 ① 칸은 비어 있다(지어내지 않음) · 맞는 칸 없는 라인은 분류 미등재 한 줄', async () => {
    route(BILL([ITEMS[1], { id: 'z', type: 'WEIRD', receiptClass: null, name: '?', totalPrice: 5000, copayRate: 0.3, insuranceType: 'COVERED' }], { totalAmount: 15000, patientCopay: 4500, insuranceCovered: 10500 }));
    const v = await mount();
    expect(cells(row(v, '진찰료'))[2]).toBe('-');
    expect(cells(row(v, '분류 미등재'))[2]).toBe('5,000');
  });

  it('대조군 — 분류 미등재 라인이 없으면 그 줄도 없다', async () => {
    route(BILL(ITEMS));
    const v = await mount();
    expect(row(v, '분류 미등재')).toBeUndefined();
  });
});

describe('구조 — 법정 항목 표는 shared 정본 하나', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it('영수증 인쇄·수납 상세가 RECEIPT_CLASSES 를 쓰고 자기 표를 두지 않는다', () => {
    for (const p of ['src/app/(main)/print/receipt/[billingId]/page.tsx', 'src/app/(main)/billing/[id]/page.tsx']) {
      const s = src(p);
      expect(s, p).toMatch(/RECEIPT_CLASSES/);
      expect(s, p).not.toMatch(/types: \['CONSULTATION'\]/);
      expect(s, p).not.toMatch(/defaultConsult/);
    }
  });
});
