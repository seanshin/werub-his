/**
 * 분납은 남은 금액만, 열린 청구에만(2026-10-14 결함 발굴 수납 P1-2).
 *  · 🔴 종전: 40,000 낸 100,000 건에 100,000 짜리 계획 → 다 내면 140,000 · PAID·취소 청구에도 계획 · 계획 중복
 *  · 🔴 종전: 취소된 청구에 회차를 내면 PAID 로 되살아남 · 동시 회차는 paidCount 가 한 번만 늘어 영영 완납 못 함
 */
import { describe, it, expect, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';

function mk(b: Record<string, unknown>, opts: { activePlans?: number; plan?: Record<string, unknown>; open?: boolean; actualPaidCount?: number } = {}) {
  const plans: any[] = [];
  let paidCount = opts.actualPaidCount ?? (opts.plan?.paidCount as number) ?? 0;
  const prisma: any = {
    billing: {
      findUnique: vi.fn().mockResolvedValue({ id: 'b1', status: 'PARTIAL', patientCopay: 100000, discountAmount: 0, paidAmount: 40000, ...b }),
      updateMany: vi.fn().mockResolvedValue({ count: opts.open === false ? 0 : 1 }),
    },
    installmentPlan: {
      count: vi.fn().mockResolvedValue(opts.activePlans ?? 0),
      create: vi.fn(async ({ data }: any) => { plans.push(data); return { ...data, payments: data.payments.create }; }),
      update: vi.fn(async ({ data }: any) => { if (data.paidCount?.increment) paidCount += 1; return { paidCount, installments: 3 }; }),
    },
    installmentPayment: {
      findUnique: vi.fn().mockResolvedValue({ id: 'ip1', planId: 'pl1', seqNo: 1, amount: 20000, status: 'PENDING', plan: { id: 'pl1', billingId: 'b1', paidCount: 0, installments: 3, status: 'ACTIVE', ...opts.plan } }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    billingPayment: { create: vi.fn() },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
  return { svc: new BillingService(prisma, {} as any, { getOrSet: vi.fn(), invalidate: vi.fn(), del: vi.fn() } as any), prisma, plans };
}
const rejects = async (p: Promise<unknown>) => expect(await p.catch((e) => e)).toBeInstanceOf(Error);

describe('🔴 분납 계획 — 남은 금액만·열린 청구만·하나만', () => {
  it('계획 총액 = 본인부담 − 감면 − 이미 낸 돈 · 회차 합 = 총액', async () => {
    const { svc, plans } = mk({ discountAmount: 10000 });
    await svc.createInstallmentPlan('b1', 3, 30);
    expect(plans[0].totalAmount).toBe(50000);
    expect(plans[0].payments.create.reduce((s: number, p: any) => s + p.amount, 0)).toBe(50000);
  });
  it('닫힌 청구(PAID·CANCELLED·REFUNDED)·남은 금액 0·진행 중 계획 → 만들지 않는다', async () => {
    for (const status of ['PAID', 'CANCELLED', 'REFUNDED']) await rejects(mk({ status }).svc.createInstallmentPlan('b1', 3, 30));
    await rejects(mk({ paidAmount: 100000 }).svc.createInstallmentPlan('b1', 3, 30));
    const a = mk({}, { activePlans: 1 });
    await rejects(a.svc.createInstallmentPlan('b1', 3, 30));
    expect(a.prisma.installmentPlan.create).not.toHaveBeenCalled();
  });
});

describe('🔴 분납 회차 — 닫힌 청구·끝난 계획은 받지 않는다 · 횟수는 증가된 값', () => {
  it('청구가 닫혔으면(조건부 갱신 0건) 거부 → 트랜잭션 전체 롤백', async () => {
    await rejects(mk({}, { open: false }).svc.payInstallment('ip1', 'CARD'));
  });
  it('계획이 끝났으면 거부', async () => {
    await rejects(mk({}, { plan: { status: 'COMPLETED' } }).svc.payInstallment('ip1', 'CARD'));
  });
  it('읽은 paidCount 가 낡아도(0) 증가된 실제 값(3/3)으로 완납 판정', async () => {
    const { svc, prisma } = mk({}, { plan: { paidCount: 0 }, actualPaidCount: 2 });
    // 다른 회차가 먼저 커밋되어 실제 값은 2 — 이번 증가로 3
    const r = await svc.payInstallment('ip1', 'CARD');
    expect(r.allPaid).toBe(true);
    expect(prisma.billing.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'PAID' });
  });
});
