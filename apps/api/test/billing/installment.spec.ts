import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';

describe('BillingService - Installment', () => {
  let service: BillingService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      billing: {
        findUnique: vi.fn(),
        update: vi.fn(),
        // (P1-2) 상태 조건부 갱신 — 열린 상태일 때만
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn(),
        count: vi.fn(),
        aggregate: vi.fn(),
      },
      installmentPlan: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(0), // 진행 중 계획 없음
      },
      installmentPayment: {
        findUnique: vi.fn(),
        update: vi.fn(),
        // 회차 납부는 원자 선점(updateMany status!=PAID)으로 처리
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      // 🔴 수납 원장 — 목에 이 모델이 없어서 "회차 납부가 원장에 안 남는다"는 결함을
      //    이 테스트가 원리적으로 잡을 수 없었다(목에 없는 메서드가 결함을 숨긴다).
      billingPayment: { create: vi.fn().mockResolvedValue({ id: 'bp-1' }) },
    };
    // 분납 생성/납부는 $transaction 원자 처리 — tx=mockPrisma로 콜백 실행
    mockPrisma.$transaction = vi.fn(async (fn: any) => fn(mockPrisma));

    service = new BillingService(mockPrisma as any, {} as any, {
      getOrSet: vi.fn((_k: string, _t: number, fn: () => Promise<any>) => fn()),
      invalidate: vi.fn(),
      del: vi.fn(),
    } as any);
  });

  describe('createInstallmentPlan', () => {
    it('should create plan with correct number of payments', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue({
        id: 'b1', status: 'PENDING', patientCopay: 90000, discountAmount: 0, paidAmount: 0, totalAmount: 300000,
      });
      mockPrisma.installmentPlan.create.mockResolvedValue({
        id: 'plan-1', billingId: 'b1', totalAmount: 90000, installments: 3,
        payments: [
          { seqNo: 1, amount: 30000, status: 'PENDING' },
          { seqNo: 2, amount: 30000, status: 'PENDING' },
          { seqNo: 3, amount: 30000, status: 'PENDING' },
        ],
      });
      mockPrisma.billing.update.mockResolvedValue({ status: 'PARTIAL' });

      const result = await service.createInstallmentPlan('b1', 3, 30);

      expect(mockPrisma.installmentPlan.create).toHaveBeenCalled();
      expect(mockPrisma.billing.updateMany).toHaveBeenCalledWith({
        where: { id: 'b1', status: 'PENDING' }, data: { status: 'PARTIAL' },
      });
      expect(result.installments).toBe(3);
    });

    it('should throw if billing not found', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue(null);
      await expect(service.createInstallmentPlan('x', 3, 30))
        .rejects.toThrow('수납 건을 찾을 수 없습니다.');
    });
  });

  describe('payInstallment', () => {
    it('should mark payment as paid', async () => {
      mockPrisma.installmentPayment.findUnique.mockResolvedValue({
        id: 'pay-1', planId: 'plan-1', seqNo: 1, status: 'PENDING',
        plan: { id: 'plan-1', billingId: 'b1', paidCount: 0, installments: 3, status: 'ACTIVE' },
      });
      mockPrisma.installmentPayment.update.mockResolvedValue({});
      mockPrisma.installmentPlan.update.mockResolvedValue({ paidCount: 1, installments: 3 });

      const result = await service.payInstallment('pay-1', 'CARD');
      expect(result.status).toBe('PAID');
      expect(result.allPaid).toBe(false);
    });

    it('should complete billing when all paid', async () => {
      mockPrisma.installmentPayment.findUnique.mockResolvedValue({
        id: 'pay-3', planId: 'plan-1', seqNo: 3, status: 'PENDING',
        plan: { id: 'plan-1', billingId: 'b1', paidCount: 2, installments: 3, status: 'ACTIVE' },
      });
      mockPrisma.installmentPayment.update.mockResolvedValue({});
      mockPrisma.installmentPlan.update.mockResolvedValue({ paidCount: 3, installments: 3 });
      mockPrisma.billing.update.mockResolvedValue({});

      const result = await service.payInstallment('pay-3');
      expect(result.allPaid).toBe(true);
    });

    it('should reject already paid', async () => {
      mockPrisma.installmentPayment.findUnique.mockResolvedValue({
        id: 'pay-1', status: 'PAID', plan: { paidCount: 1, installments: 3 },
      });
      await expect(service.payInstallment('pay-1'))
        .rejects.toThrow('이미 납부된 회차입니다.');
    });
  });

  describe('getOutstandingBillings', () => {
    it('should return outstanding summary', async () => {
      mockPrisma.billing.findMany.mockResolvedValue([
        { id: 'b1', status: 'DEFERRED', patientCopay: 50000, totalAmount: 100000, createdAt: new Date(), deferredReason: '후납', encounter: { patient: { id: 'p1', mrn: '001', familyName: '김', givenName: '환자', phone: null } }, installmentPlans: [] },
      ]);
      mockPrisma.billing.count.mockResolvedValue(1);
      mockPrisma.billing.aggregate.mockResolvedValue({ _sum: { patientCopay: 50000 } });

      const result = await service.getOutstandingBillings();
      expect(result.items).toHaveLength(1);
      expect(result.totalOutstandingAmount).toBe(50000);
      expect(result.items[0].hasInstallment).toBe(false);
    });
  });
});
