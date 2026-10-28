/**
 * '미수금' 정본 하나(2026-10-14 결함 발굴 수납·청구 P4-1).
 *  · 🔴 종전 네 벌: 미수 목록 Σ본인부담(낸 돈·감면 무시) · 원무 보드 Σ(총액 − 납부)(공단 부담 포함·INSTALLMENT 포함) ·
 *    경영·관제 Σ본인부담 − Σ납부(감면 무시) · 키오스크만 맞음 · 포털 미수 목록은 보류 제외·감면 없음
 *  · 정본: 상태 = UNPAID_STATUS(= shared BILLING_OUTSTANDING_STATUSES) · 금액 = shared billingOutstanding(본인부담 − 감면 − 낸 돈, 음수 0)
 *  · 🔴 보드 '금일 수납'은 오늘 들어온 돈(원장 줄 + 원장 없는 옛 수납) — 종전엔 오늘 완납 청구의 누적 납부액
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { BILLING_OUTSTANDING_STATUSES, billingOutstanding } from '@hospital-run/shared';
import { UNPAID_STATUS } from '../../src/modules/journey-console/flow-canon';
import { ReceptionBillingBoardService } from '../../src/modules/billing/reception-billing-board.service';
import { BillingService } from '../../src/modules/billing/billing.service';

const ROWS = [
  { patientCopay: 30000, discountAmount: 5000, paidAmount: 10000, totalAmount: 100000 }, // 남은 15,000 (공단 70,000 은 미수 아님)
  { patientCopay: 10000, discountAmount: 0, paidAmount: 12000, totalAmount: 30000 },    // 더 받음 → 0
];

describe('🔴 미수 정본', () => {
  it('상태 집합 — shared = 서버 UNPAID_STATUS · 금액 = 본인부담 − 감면 − 낸 돈(음수 0)', () => {
    expect([...BILLING_OUTSTANDING_STATUSES].sort()).toEqual([...UNPAID_STATUS].sort());
    expect(ROWS.map((r) => billingOutstanding(r))).toEqual([15000, 0]);
    expect(billingOutstanding({ patientCopay: null })).toBeNull();
  });

  it('🔴 원무 보드 — 미수는 공단 부담·감면을 빼고 · 금일 수납은 오늘 원장 줄 + 원장 없는 옛 수납', async () => {
    const prisma: any = {
      waitingQueue: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      documentRequest: { count: vi.fn().mockResolvedValue(0) },
      billingPayment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 8000 } }),
        findMany: vi.fn().mockResolvedValue([{ billingId: 'a' }, { billingId: 'b' }]),
      },
      billing: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { paidAmount: 3000 }, _count: 1 }),
        findMany: vi.fn().mockResolvedValue(ROWS),
      },
    };
    const r: any = await new ReceptionBillingBoardService(prisma).getBoard();
    expect(r.summary.outstandingAmount).toBe(15000);
    expect(r.summary.todayPaidAmount).toBe(11000);
    expect(r.summary.todayPaidCount).toBe(3);
    expect(prisma.billing.findMany.mock.calls[0][0].where.status.in).toEqual(UNPAID_STATUS);
    expect(prisma.billingPayment.aggregate.mock.calls[0][0].where.method).toEqual({ not: 'REFUND' });
  });

  it('🔴 미수 목록 합계·행 = 남은 본인부담(종전 Σ본인부담)', async () => {
    const prisma: any = {
      billing: {
        findMany: vi.fn(async (args: any) => (args.select
          ? ROWS
          : ROWS.map((r, i) => ({ ...r, id: `b${i}`, status: 'PARTIAL', createdAt: new Date(), deferredReason: null, encounter: null, installmentPlans: [] })))),
        count: vi.fn().mockResolvedValue(2),
      },
    };
    const svc = new BillingService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const r: any = await svc.getOutstandingBillings();
    expect(r.totalOutstandingAmount).toBe(15000);
    expect(r.items.map((i: any) => i.outstanding)).toEqual([15000, 0]);
  });

  it('구조 — 미수 금액을 Σ(총액 − 납부)·Σ본인부담 − Σ납부로 세는 자리가 남지 않았다', () => {
    const files = ['src/modules/billing/reception-billing-board.service.ts', 'src/modules/executive/executive.service.ts', 'src/modules/journey-console/journey-console.service.ts', 'src/modules/billing/billing.service.ts'];
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/b\.totalAmount - \(b\.paidAmount \?\? 0\)/);
      expect(s, f).not.toMatch(/_sum\.patientCopay \?\? 0\) - \(unpaidAgg/);
      expect(s, f).not.toMatch(/_sum\?\.patientCopay \?\? 0\) - \(unpaidAgg/);
      expect(s, f).not.toMatch(/totalOutstanding\._sum\.patientCopay/);
    }
  });
});
