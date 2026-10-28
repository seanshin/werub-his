/**
 * 🔴 (2026-09-14) 분납 회차 화면에 잔액·예정일 경과가 없었다 — 화면이 금액을 다시 더하거나 브라우저 시계로 비교하지 않도록
 * 서버가 summary 를 싣는다. 지키는 것: ① 잔액=총액−납부 완료 회차 합 ② 회차 합≠총액이면 mismatch(고치지 않음)
 * ③ 예정일 경과는 미납·KST 오늘 이전만(오늘은 경과 아님·납부된 회차 제외) ④ 계획 없음은 null
 */
import { describe, expect, it, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`); // @db.Date 모양
function make(plan: unknown) {
  const svc = Object.create(BillingService.prototype) as BillingService;
  (svc as any).prisma = { installmentPlan: { findFirst: vi.fn().mockResolvedValue(plan) } };
  return svc;
}

describe('분납 계획 조회 summary — 서버 계산', () => {
  // 2026-09-14 08:30 KST = 2026-09-13T23:30Z — UTC 날짜로 비교하면 '오늘'이 하루 밀린다
  const NOW = new Date('2026-09-13T23:30:00Z');
  const plan = {
    id: 'p1', totalAmount: 100000, installments: 3, paidCount: 1, status: 'ACTIVE',
    payments: [
      { id: 'a', seqNo: 1, amount: 40000, dueDate: d('2026-08-14'), status: 'PAID', paidAt: new Date('2026-08-14T01:00:00Z') },
      { id: 'b', seqNo: 2, amount: 30000, dueDate: d('2026-09-13'), status: 'PENDING', paidAt: null },
      { id: 'c', seqNo: 3, amount: 30000, dueDate: d('2026-09-14'), status: 'PENDING', paidAt: null },
    ],
  };

  it('① 잔액·납부액 ③ 예정일 경과(KST 오늘 이전 미납만)', async () => {
    const r = (await make(plan).getInstallmentPlan('b1', NOW))!;
    expect(r.summary).toMatchObject({ paidAmount: 40000, remainingAmount: 60000, scheduledTotal: 100000, scheduleMismatch: false, dueDatePassedCount: 1, asOf: '2026-09-14' });
    expect(r.payments.map((p) => p.dueDatePassed)).toEqual([false, true, false]);
  });

  it('② 회차 합과 총액이 다르면 mismatch — 값은 고치지 않는다', async () => {
    const odd = { ...plan, totalAmount: 100001 };
    const r = (await make(odd).getInstallmentPlan('b1', NOW))!;
    expect(r.summary.scheduleMismatch).toBe(true);
    expect(r.summary.remainingAmount).toBe(60001);
    expect(r.payments.map((p) => p.amount)).toEqual([40000, 30000, 30000]);
  });

  it('④ 계획이 없으면 null', async () => {
    expect(await make(null).getInstallmentPlan('b1', NOW)).toBeNull();
  });
});
