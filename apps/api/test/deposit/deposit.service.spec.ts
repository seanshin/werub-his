import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DepositService } from '../../src/modules/deposit/deposit.service';

describe('DepositService', () => {
  let service: DepositService;
  let mockPrisma: any;

  const mockDeposit = { id: 'd-1', patientId: 'p-1', amount: 500000, balance: 500000, refundedAt: null };

  beforeEach(() => {
    mockPrisma = {
      deposit: {
        create: vi.fn().mockResolvedValue(mockDeposit),
        findUnique: vi.fn().mockResolvedValue(mockDeposit),
        findMany: vi.fn().mockResolvedValue([mockDeposit]),
        update: vi.fn().mockResolvedValue({ ...mockDeposit, balance: 0 }),
      },
    };
    service = new DepositService(mockPrisma);
  });

  describe('create', () => {
    it('예치금 등록', async () => {
      const result = await service.create({ patientId: 'p-1', amount: 500000, depositType: 'ADMISSION', paymentMethod: 'CARD' } as any, 'admin-1');
      expect(result.amount).toBe(500000);
      expect(mockPrisma.deposit.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ balance: 500000, processedBy: 'admin-1' }),
      }));
    });
  });

  describe('findByPatient', () => {
    it('환자별 예치금 목록', async () => {
      const result = await service.findByPatient('p-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('refund', () => {
    it('정상 환불', async () => {
      await service.refund('d-1', 'admin-1');
      expect(mockPrisma.deposit.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ balance: 0, refundedAt: expect.any(Date) }),
      }));
    });

    it('존재하지 않는 예치금', async () => {
      mockPrisma.deposit.findUnique.mockResolvedValue(null);
      await expect(service.refund('x', 'admin')).rejects.toThrow(NotFoundException);
    });

    it('이미 환불된 예치금', async () => {
      mockPrisma.deposit.findUnique.mockResolvedValue({ ...mockDeposit, refundedAt: new Date() });
      await expect(service.refund('d-1', 'admin')).rejects.toThrow(BadRequestException);
    });

    it('잔액 0인 예치금', async () => {
      mockPrisma.deposit.findUnique.mockResolvedValue({ ...mockDeposit, balance: 0 });
      await expect(service.refund('d-1', 'admin')).rejects.toThrow(BadRequestException);
    });
  });

  describe('useDeposit', () => {
    it('정상 차감', async () => {
      await service.useDeposit('d-1', 100000);
      expect(mockPrisma.deposit.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { balance: 400000 },
      }));
    });

    it('잔액 부족', async () => {
      await expect(service.useDeposit('d-1', 600000)).rejects.toThrow(BadRequestException);
    });

    it('0 이하 금액', async () => {
      await expect(service.useDeposit('d-1', 0)).rejects.toThrow(BadRequestException);
    });

    it('환불된 예치금 사용 불가', async () => {
      mockPrisma.deposit.findUnique.mockResolvedValue({ ...mockDeposit, refundedAt: new Date() });
      await expect(service.useDeposit('d-1', 100)).rejects.toThrow(BadRequestException);
    });
  });
});
