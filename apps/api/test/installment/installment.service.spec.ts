import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { InstallmentService } from '../../src/modules/installment/installment.service';

describe('InstallmentService', () => {
  let service: InstallmentService;
  let mockPrisma: any;
  let mockBillingService: any;

  const mockBilling = { id: 'b-1', patientCopay: 300000, status: 'PENDING' };
  const mockPlan = {
    id: 'ip-1', billingId: 'b-1', totalAmount: 300000, installments: 3,
    paidCount: 0, status: 'ACTIVE',
    payments: [
      { id: 'pay-1', seqNo: 1, amount: 100000, status: 'PENDING', dueDate: new Date() },
      { id: 'pay-2', seqNo: 2, amount: 100000, status: 'PENDING', dueDate: new Date() },
      { id: 'pay-3', seqNo: 3, amount: 100000, status: 'PENDING', dueDate: new Date() },
    ],
  };

  beforeEach(() => {
    mockPrisma = {
      billing: {
        findUnique: vi.fn().mockResolvedValue(mockBilling),
        update: vi.fn().mockResolvedValue(mockBilling),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      installmentPlan: {
        create: vi.fn().mockResolvedValue(mockPlan),
        findUnique: vi.fn().mockResolvedValue(mockPlan),
        findMany: vi.fn().mockResolvedValue([mockPlan]),
        update: vi.fn().mockResolvedValue(mockPlan),
      },
      installmentPayment: {
        update: vi.fn().mockResolvedValue({ id: 'pay-1', status: 'PAID' }),
      },
    };
    // 🔴 분납 회차 납부의 정본은 BillingService.payInstallment 다 — 이 서비스는 위임만 한다.
    //    종전에는 같은 행위가 여기에도 구현돼 있었고(무트랜잭션·paidAmount 미반영) 아래 테스트가
    //    **그 중복 구현을 못박고 있었다**. 목은 정본의 실제 시그니처를 그대로 쓴다.
    // (2026-10-14 P1-2) 생성 규칙(상태·남은 금액·진행 중 계획)도 정본 BillingService.prepareInstallment 가 판정한다
    mockBillingService = {
      payInstallment: vi.fn().mockResolvedValue({ allPaid: false }),
      prepareInstallment: vi.fn().mockResolvedValue({ billing: { id: 'b-1', status: 'PENDING' }, amount: 300000 }),
    };
    // 🔴 (G3) 한 트랜잭션으로 묶인 쓰기 — 목은 정본의 실제 호출 모양을 쓴다(tx 는 같은 목 재사용)
    mockPrisma.$transaction = vi.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
    );
    service = new InstallmentService(mockPrisma, mockBillingService);
  });

  describe('createPlan', () => {
    it('분할 납부 계획 생성 (3회)', async () => {
      await service.createPlan('b-1', 3);
      expect(mockPrisma.installmentPlan.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ billingId: 'b-1', totalAmount: 300000, installments: 3 }),
      }));
      // 🔴 (P1-2) INSTALLMENT 가 아니라 PARTIAL — INSTALLMENT 는 미수 집합 정본 밖이라 미수 집계에서 빠졌다
      expect(mockPrisma.billing.updateMany).toHaveBeenCalledWith({ where: { id: 'b-1', status: 'PENDING' }, data: { status: 'PARTIAL' } });
      expect(mockPrisma.billing.update).not.toHaveBeenCalled();
    });

    it('생성 규칙은 정본이 판정 — 거부되면 계획을 만들지 않는다', async () => {
      mockBillingService.prepareInstallment.mockRejectedValue(new BadRequestException('x'));
      await expect(service.createPlan('b-1', 3)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.installmentPlan.create).not.toHaveBeenCalled();
    });
  });

  describe('payInstallment', () => {
    it('분할 납부 결제 — 정본(BillingService)에 위임한다', async () => {
      await service.payInstallment('ip-1', 1);
      expect(mockBillingService.payInstallment).toHaveBeenCalledWith('pay-1', undefined);
      // 🔴 회차·계획·수납 갱신을 여기서 직접 하지 않는다(그렇게 하면 정본이 둘이 되어 금액이 갈라진다)
      expect(mockPrisma.installmentPayment.update).not.toHaveBeenCalled();
    });

    it('결제수단을 받으면 정본에 그대로 넘긴다(원장에 남아야 대사가 된다)', async () => {
      await service.payInstallment('ip-1', 1, 'CARD');
      expect(mockBillingService.payInstallment).toHaveBeenCalledWith('pay-1', 'CARD');
    });

    it('계획 없으면 NotFoundException', async () => {
      mockPrisma.installmentPlan.findUnique.mockResolvedValue(null);
      await expect(service.payInstallment('x', 1)).rejects.toThrow(NotFoundException);
    });

    it('이미 완료된 계획', async () => {
      mockPrisma.installmentPlan.findUnique.mockResolvedValue({ ...mockPlan, status: 'COMPLETED' });
      await expect(service.payInstallment('ip-1', 1)).rejects.toThrow(BadRequestException);
    });

    it('이미 결제된 회차', async () => {
      const plan = { ...mockPlan, payments: [{ ...mockPlan.payments[0], status: 'PAID' }, ...mockPlan.payments.slice(1)] };
      mockPrisma.installmentPlan.findUnique.mockResolvedValue(plan);
      await expect(service.payInstallment('ip-1', 1)).rejects.toThrow(BadRequestException);
    });

    it('마지막 회차 — 완납 처리는 정본이 하고, 여기서는 다음 납부일만 비운다', async () => {
      const plan = { ...mockPlan, paidCount: 2 };
      mockPrisma.installmentPlan.findUnique.mockResolvedValue(plan);
      await service.payInstallment('ip-1', 3);
      expect(mockBillingService.payInstallment).toHaveBeenCalledWith('pay-3', undefined);
      expect(mockPrisma.installmentPlan.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { nextDueDate: null },
      }));
      // 수납 상태를 여기서 건드리면 정본과 이중으로 쓰게 된다
      expect(mockPrisma.billing.update).not.toHaveBeenCalled();
    });

    it('중간 회차는 다음 납부일을 남긴다(대조군 — 항상 null 로 비우지 않는다)', async () => {
      await service.payInstallment('ip-1', 1);
      const call = mockPrisma.installmentPlan.update.mock.calls.at(-1)[0];
      expect(call.data.nextDueDate).toBeInstanceOf(Date);
    });
  });

  describe('getPlanDetail', () => {
    it('계획 상세', async () => {
      const result = await service.getPlanDetail('ip-1');
      expect(result.totalAmount).toBe(300000);
    });

    it('없는 계획', async () => {
      mockPrisma.installmentPlan.findUnique.mockResolvedValue(null);
      await expect(service.getPlanDetail('x')).rejects.toThrow(NotFoundException);
    });
  });
});
