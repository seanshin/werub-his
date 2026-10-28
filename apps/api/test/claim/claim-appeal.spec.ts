import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClaimService } from '../../src/modules/claim/claim.service';
import { NotFoundException } from '@nestjs/common';

describe('ClaimService — 이의신청/월별통계', () => {
  let service: ClaimService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      claim: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    };
    service = new ClaimService(mockPrisma);
  });

  describe('appeal', () => {
    it('should submit appeal for rejected claim', async () => {
      mockPrisma.claim.findUnique.mockResolvedValue({ id: 'cl-1', status: 'REJECTED', rejectReason: '불인정' });
      mockPrisma.claim.update.mockResolvedValue({ id: 'cl-1', status: 'SUBMITTED' });

      const result = await service.appeal('cl-1', { reason: '의학적 필요성 주장' });
      expect(result.status).toBe('SUBMITTED');
      expect(mockPrisma.claim.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cl-1' }, data: expect.objectContaining({ status: 'SUBMITTED' }) }),
      );
    });

    it('should throw if claim not found', async () => {
      mockPrisma.claim.findUnique.mockResolvedValue(null);
      await expect(service.appeal('cl-none', { reason: 'test' })).rejects.toThrow(NotFoundException);
    });

    it('should throw if claim status is not rejected/partially', async () => {
      mockPrisma.claim.findUnique.mockResolvedValue({ id: 'cl-1', status: 'APPROVED' });
      await expect(service.appeal('cl-1', { reason: 'test' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStatsByMonth', () => {
    it('should aggregate claims by month', async () => {
      const now = new Date();
      mockPrisma.claim.findMany.mockResolvedValue([
        { status: 'APPROVED', claimedAmount: 100000, approvedAmount: 100000, createdAt: now },
        { status: 'REJECTED', claimedAmount: 50000, approvedAmount: 0, createdAt: now },
        { status: 'APPROVED', claimedAmount: 80000, approvedAmount: 80000, createdAt: now },
      ]);

      const result = await service.getStatsByMonth();
      expect(result).toHaveLength(1);
      expect(result[0].total).toBe(3);
      expect(result[0].approved).toBe(2);
      expect(result[0].rejected).toBe(1);
    });
  });
});
