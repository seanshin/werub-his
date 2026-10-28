/**
 * 환불은 그 날짜로, 한 번만, 환자에게 돌려준 돈만(2026-10-14 결함 발굴 수납 P1-5).
 *  · 🔴 종전: 누적 refundAmount 를 마지막 refundedAt 날짜로 셈 → 1일 10,000·2일 5,000 이면 1일이 사라지고 2일 15,000
 *  · 🔴 종전: 동시 부분환불 둘이 둘 다 통과(무조건 갱신) · 검진권으로 되돌린 몫까지 환불로 셈(이중)
 *  · 이제: 환불 원장 라인(음수·REFUND·그 시각) · 조건부 갱신(0건 → 409) · 라인 금액 = 환불액 − 검진권 복원액
 */
import { describe, it, expect, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';

function mk(b: Record<string, unknown> = {}, restored = 0, raceLost = false) {
  const lines: any[] = [];
  const billing: any = { id: 'b1', status: 'PAID', paidAmount: 30000, refundAmount: null, paymentMethod: 'CARD', ...b };
  const prisma: any = {
    billing: {
      findUnique: vi.fn(async () => ({ ...billing })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const ok = !raceLost && Object.entries(where).every(([k, v]) => k === 'id' || billing[k] === v);
        if (ok) Object.assign(billing, data);
        return { count: ok ? 1 : 0 };
      }),
    },
    billingPayment: { create: vi.fn(async ({ data }: any) => { lines.push(data); return data; }), aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }), },
    claim: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const voucher = { reverseRedemption: vi.fn().mockResolvedValue({ count: restored ? 1 : 0, reversed: [], totalRestored: restored }) };
  const svc = new BillingService(prisma, {} as any, { enqueue: vi.fn() } as any, {} as any, {} as any, {} as any, voucher as any);
  vi.spyOn(svc as any, 'billingCorrection').mockResolvedValue({ correctionOf: null, revision: 1 });
  vi.spyOn(svc as any, 'emitBillingLines').mockResolvedValue(undefined);
  return { svc, lines, billing, prisma };
}

describe('🔴 환불 원장 — 날짜·한 번·돌려준 돈', () => {
  it('부분환불 두 번 → 라인 두 개(각 금액·음수) · 누적 refundAmount 는 합', async () => {
    const { svc, lines, billing } = mk();
    await svc.refund('b1', { amount: 10000, reason: 'a' });
    await svc.refund('b1', { amount: 5000, reason: 'b' });
    expect(lines.map((l) => [l.method, l.amount])).toEqual([['REFUND', -10000], ['REFUND', -5000]]);
    expect(billing.refundAmount).toBe(15000);
  });
  it('갱신 조건에 읽은 누적 환불액이 들어간다(동시 요청의 두 번째는 0건) · 대조군 첫 환불', async () => {
    const { svc, prisma } = mk({ refundAmount: 3000 });
    await svc.refund('b1', { amount: 1000, reason: 'a' });
    expect(prisma.billing.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'b1', status: 'PAID', refundAmount: 3000 });
  });
  it('동시 요청에서 진 쪽(조건부 갱신 0건) → 409 · 라인·이벤트 없음', async () => {
    const { svc, lines } = mk({}, 0, true);
    const e: any = await svc.refund('b1', { amount: 10000, reason: 'a' }).catch((x) => x);
    expect(e.getStatus?.()).toBe(409);
    expect(lines).toHaveLength(0);
  });
  it('검진권으로 되돌린 몫은 환자에게 돌려준 돈이 아니다 — 라인 = 환불액 − 복원액', async () => {
    const { svc, lines } = mk({}, 4000);
    await svc.refund('b1', { amount: 10000, reason: 'a' });
    expect(lines[0].amount).toBe(-6000);
  });
  it('부분 납부 취소 환급도 그 날 라인으로 · 대조군: 미납 취소는 라인 없음', async () => {
    const a = mk({ status: 'PARTIAL', paidAmount: 7000 });
    await a.svc.cancel('b1', '환자 요청');
    expect(a.lines.map((l) => l.amount)).toEqual([-7000]);
    const b = mk({ status: 'PENDING', paidAmount: null });
    await b.svc.cancel('b1', '환자 요청');
    expect(b.lines).toHaveLength(0);
  });
});

describe('일마감 — 환불은 원장 라인 날짜로', () => {
  it('그 날 환불 = 원장 라인(부호 반전) + 원장 이전 환불(라인 없는 수납) · 수단별 수납에서 REFUND 제외', async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    const prisma: any = {
      billingPayment: { groupBy, aggregate: vi.fn().mockResolvedValue({ _count: 1, _sum: { amount: -5000 } }) },
      // 2026-10-22 입원 중간정산 수납 원장(일마감 별도 칸)
      interimBillingPayment: { groupBy: vi.fn().mockResolvedValue([]) },
      interimBillingRefund: { groupBy: vi.fn().mockResolvedValue([]) },
      interimBilling: { aggregate: vi.fn().mockResolvedValue({ _count: 0, _sum: { paidAmount: null } }) },

      billing: {
        aggregate: vi.fn(async ({ where }: any) => (where.refundedAt ? { _count: 1, _sum: { refundAmount: 2000 } } : where.status === 'DEFERRED' ? { _count: 0, _sum: { patientCopay: 0 } } : { _count: 0, _sum: { paidAmount: 0 } })),
        findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0),
      },
    };
    const svc = new BillingService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const r = (await svc.getDailySummary('2026-10-02')).data;
    expect(r.refundAmount).toBe(7000);
    expect(r.refundCount).toBe(2);
    expect(groupBy.mock.calls[0][0].where.method).toEqual({ not: 'REFUND' });
  });
});
