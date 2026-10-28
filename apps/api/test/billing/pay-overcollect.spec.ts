/**
 * 수납은 남은 금액보다 더 받지 않는다(2026-10-14 결함 발굴 수납 P1-1).
 *  · 🔴 종전: 카드·현금·이체만 남은 금액과 비교하지 않아 부분 납부·감면·검진권 뒤 전액을 또 받고 PAID(넘친 돈 기록 없음)
 *  · 조용히 깎지 않고 거부(단말기 승인 금액과 원장이 갈라지지 않게) · 남은 금액 0 이면 거부 · 감면 뒤 이미 더 받았으면 거부(환불로)
 *  · 대조군: 남은 금액만큼은 받고 PAID · 남은 금액보다 적으면 PARTIAL · 처리자는 로그인 직원(컨트롤러)
 */
import { describe, it, expect, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';
import { BillingController } from '../../src/modules/billing/billing.controller';

function mk(b: Record<string, unknown>) {
  const lines: any[] = []; const updates: any[] = [];
  const prisma: any = {
    billing: {
      findUnique: vi.fn().mockResolvedValue({ id: 'b1', patientId: 'p1', status: 'PARTIAL', patientCopay: 15000, discountAmount: 0, paidAmount: 5000, paymentMethod: 'CARD', encounter: { id: 'e1', prescriptions: [] }, ...b }),
      updateMany: vi.fn(async ({ data }: any) => { updates.push(data); return { count: 1 }; }),
    },
    billingPayment: { create: vi.fn(async ({ data }: any) => { lines.push(data); return data; }) },
    waitingQueue: { updateMany: vi.fn(async () => ({ count: 0 })) }, // 완납 시 대기열 다음 단계
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
  const svc = new BillingService(prisma, { emit: vi.fn() } as any, {} as any, { get: vi.fn() } as any, {} as any, {} as any, {} as any,
    { getOrSet: vi.fn(), invalidate: vi.fn(), del: vi.fn() } as any);
  (svc as any).outbox = { enqueue: vi.fn() };
  return { svc, lines, updates };
}
const err = async (p: Promise<unknown>) => { const e: any = await p.catch((x) => x); expect(e, '거부돼야 한다').toBeInstanceOf(Error); return e.getResponse?.(); };

describe('🔴 수납 — 남은 금액보다 더 받지 않는다', () => {
  it('부분 납부 5,000 뒤 전액 15,000 카드 → 거부 · 원장·청구 그대로', async () => {
    const { svc, lines, updates } = mk({});
    const r = await err(svc.pay('b1', { amount: 15000, paymentMethod: 'CARD' }));
    expect(r).toMatchObject({ details: { amount: 15000, remaining: 10000 } });
    expect(lines).toHaveLength(0); expect(updates).toHaveLength(0);
  });
  it('남은 금액 0 이면 거부 · 감면 뒤 이미 더 받았으면 거부(환불로 정리)', async () => {
    await err(mk({ paidAmount: 15000, status: 'PARTIAL' }).svc.pay('b1', { amount: 1, paymentMethod: 'CASH' }));
    const r = await err(mk({ paidAmount: 12000, discountAmount: 0 }).svc.pay('b1', { amount: 1000, paymentMethod: 'CASH', discountAmount: 5000 }));
    expect(r).toMatchObject({ details: { alreadyPaid: 12000, payable: 10000 } });
  });
  it('대조군 — 남은 10,000 은 받고 PAID · 4,000 은 PARTIAL', async () => {
    const a = mk({});
    await a.svc.pay('b1', { amount: 10000, paymentMethod: 'CARD' });
    expect(a.updates[0]).toMatchObject({ status: 'PAID', paidAmount: 15000 });
    const b = mk({});
    await b.svc.pay('b1', { amount: 4000, paymentMethod: 'CASH' });
    expect(b.updates[0]).toMatchObject({ status: 'PARTIAL', paidAmount: 9000 });
  });
  it('(P5-6) 처리자는 로그인 직원 — 컨트롤러가 넘긴다', async () => {
    const pay = vi.fn().mockResolvedValue({});
    await new (BillingController as any)({ pay }).pay('b1', { amount: 1, paymentMethod: 'CASH' }, 'staff-9');
    expect(pay).toHaveBeenCalledWith('b1', expect.objectContaining({ processedBy: 'staff-9' }));
  });
});
