import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';

/** 청구 심층검토 §4 — 과다환불(누적)·환불후 재수납 봉합 */
describe('BillingService.refund/pay — §4 불변식', () => {
  let svc: BillingService;
  let prisma: any;
  let billing: any;

  beforeEach(() => {
    billing = { id: 'b1', status: 'PAID', paidAmount: 50000, refundAmount: 0, paymentMethod: 'CARD', discountAmount: 0 };
    prisma = {
      billing: {
        findUnique: vi.fn(async () => billing),
        update: vi.fn(async ({ data }: any) => { Object.assign(billing, data); return billing; }),
        // (P1-5) 조건부 갱신 — where 의 상태·누적 환불액이 지금 값과 같을 때만(실제 DB 처럼 판정)
        updateMany: vi.fn(async ({ where, data }: any) => {
          const ok = Object.entries(where).every(([k, v]) => k === 'id' || billing[k] === v);
          if (ok) Object.assign(billing, data);
          return { count: ok ? 1 : 0 };
        }),
      },
      billingPayment: { create: vi.fn(), aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }), },
      claim: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const voucher = { reverseRedemption: vi.fn().mockResolvedValue({ count: 0, reversed: [] }) };
    const outbox = { enqueue: vi.fn() };
    svc = new BillingService(prisma, {} as any, outbox as any, {} as any, {} as any, {} as any, voucher as any);
    vi.spyOn(svc as any, 'billingCorrection').mockResolvedValue({ correctionOf: null, revision: 1 });
  });

  it('부분환불 반복 — 기환불 차감 잔여로 가드(누적 초과 차단)', async () => {
    await svc.refund('b1', { amount: 30000, reason: 'a' });
    expect(billing.refundAmount).toBe(30000); // 누적
    expect(billing.status).toBe('PAID');
    // 잔여 20,000인데 30,000 재환불 시도 → 차단
    await expect(svc.refund('b1', { amount: 30000, reason: 'b' })).rejects.toThrow();
    // 잔여 20,000 정확히 → 전액환불 도달·REFUNDED
    await svc.refund('b1', { amount: 20000, reason: 'c' });
    expect(billing.refundAmount).toBe(50000);
    expect(billing.status).toBe('REFUNDED');
  });

  it('0 이하 환불 거부', async () => {
    await expect(svc.refund('b1', { amount: 0, reason: 'x' })).rejects.toThrow();
    await expect(svc.refund('b1', { amount: -100, reason: 'x' })).rejects.toThrow();
  });

  it('환불된 건 재수납 차단', async () => {
    billing.status = 'REFUNDED';
    await expect(svc.pay('b1', { amount: 50000, method: 'CARD' } as any)).rejects.toThrow(/환불된/);
  });
});

describe('BillingService.pay — §6 lost-update 낙관적 락', () => {
  let svc: BillingService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      billing: {
        findUnique: vi.fn().mockResolvedValue({ id: 'b1', status: 'PENDING', patientCopay: 10000, paidAmount: 0, discountAmount: 0, encounter: { id: 'e1', prescriptions: [] } }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      billingPayment: { create: vi.fn().mockResolvedValue({}), aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }), },
      claim: { findMany: vi.fn().mockResolvedValue([]) },
      deposit: { findMany: vi.fn().mockResolvedValue([]) },
      waitingQueue: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findFirst: vi.fn() },
      patientJourneyEvent: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (fn: any) => fn(prisma)),
    };
    svc = new BillingService(prisma, {} as any, { enqueue: vi.fn() } as any, { get: vi.fn().mockResolvedValue(undefined) } as any, {} as any, {} as any, { redeem: vi.fn(), reverseRedemption: vi.fn() } as any);
    vi.spyOn(svc as any, 'emitAccrualLine').mockResolvedValue({});
  });

  it('낙관적 락 — updateMany where에 읽은 paidAmount/status 조건 포함', async () => {
    await svc.pay('b1', { amount: 10000, paymentMethod: 'CARD' } as any);
    const arg = prisma.billing.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: 'b1', paidAmount: 0, status: 'PENDING' });
    expect(arg.data.paidAmount).toBe(10000);
    expect(arg.data.status).toBe('PAID');
  });

  it('동시 결제(락 불일치) — updateMany 0건 → 충돌 예외', async () => {
    prisma.billing.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.pay('b1', { amount: 10000, paymentMethod: 'CARD' } as any)).rejects.toThrow(/변경되었습니다/);
  });
});
