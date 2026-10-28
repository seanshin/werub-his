import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';

/** 청구 심층검토 §1 — 입원료 이중계상 봉합(게이트 ON 시 interim charge 제외·paid 유지) */
describe('InpatientService.getDischargeSettlement — 입원료 이중계상 봉합', () => {
  let prisma: any;
  const admitDate = new Date('2026-07-01');

  const build = (stayGateOn: boolean) => {
    const config = { get: vi.fn(async (k: string) => (k === 'inpatient.stayBilling.enabled' ? (stayGateOn ? 'true' : 'false') : null)) };
    return new InpatientService(prisma, undefined, config as any);
  };

  beforeEach(() => {
    prisma = {
      admission: { findUnique: vi.fn().mockResolvedValue({ id: 'a1', admitDate, dischargeDate: new Date('2026-07-06'), bed: { bedClass: 'GENERAL' } }) },
      encounter: { findMany: vi.fn().mockResolvedValue([{ id: 'e1' }]) },
      // stayBilling이 만든 입원료가 encounter Billing에 반영됨: charge 250,000·copay 50,000
      billing: { findMany: vi.fn().mockResolvedValue([{ id: 'b1', encounterId: 'e1', totalAmount: 250000, patientCopay: 50000, discountAmount: 0, paidAmount: 0, status: 'PENDING' }]) },
      // interim에도 동일 입원료: charge 250,000·copay 50,000·수납 50,000
      interimBillingRefund: { groupBy: vi.fn().mockResolvedValue([]) },
      interimBilling: { findMany: vi.fn().mockResolvedValue([{ id: 'i1', sequenceNo: 1, totalAmount: 250000, copayAmount: 50000, paidAmount: 50000, status: 'PAID', periodStart: admitDate, periodEnd: new Date('2026-07-06') }]) },
    };
  });

  it('게이트 ON — 입원료 charge/copay 이중계상 제외(정본=stayBilling)·interim 수납은 차감 유지', async () => {
    const svc = build(true);
    const r: any = await svc.getDischargeSettlement('a1');
    // 입원료 정본=encBilling만: totalCharges 250,000(2배 500,000 아님)·totalCopay 50,000(2배 100,000 아님)
    expect(r.data.totalCharges).toBe(250000);
    expect(r.data.totalCopay).toBe(50000);
    // interim 수납 50,000은 alreadyPaid에 반영 → balanceDue 0(50,000 copay - 50,000 paid)
    expect(r.data.alreadyPaid).toBe(50000);
    expect(r.data.balanceDue).toBe(0);
    // 상세 표시(대사용)엔 interim 원본 유지
    expect(r.data.breakdown.interim.charges).toBe(250000);
  });

  it('🔴 중간정산 환불은 기납부에서 뺀다(2026-10-22 ERP R5) · 회차별 환불액', async () => {
    prisma.interimBillingRefund.groupBy.mockResolvedValue([{ interimBillingId: 'i1', _sum: { amount: 20000 } }]);
    const r: any = await build(true).getDischargeSettlement('a1');
    expect(r.data.alreadyPaid).toBe(30000);
    expect(r.data.balanceDue).toBe(20000);
    expect(r.data.breakdown.interim.refunded).toBe(20000);
    expect(r.data.breakdown.interim.items[0].refundedAmount).toBe(20000);
  });

  it('게이트 OFF — 종전대로 interim이 입원료 정본(제외 안 함)', async () => {
    // 게이트 OFF면 stayBilling이 encBilling에 없어야 정상이나, 이 테스트는 합산 로직만 검증:
    // encBilling 없이 interim만 → totalCharges=interim
    prisma.billing.findMany.mockResolvedValue([]);
    const svc = build(false);
    const r: any = await svc.getDischargeSettlement('a1');
    expect(r.data.totalCharges).toBe(250000); // interim 입원료
    expect(r.data.totalCopay).toBe(50000);
  });
});
