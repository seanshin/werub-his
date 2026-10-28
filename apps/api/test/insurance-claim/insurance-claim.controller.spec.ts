import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InsuranceClaimController } from '../../src/modules/insurance-claim/insurance-claim.controller';
import { InsuranceClaimService } from '../../src/modules/insurance-claim/insurance-claim.service';
import { ClaimStatus } from '@prisma/client';

describe('InsuranceClaimController', () => {
  let controller: InsuranceClaimController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getQueue: vi.fn(),
      create: vi.fn(),
      submit: vi.fn(),
      getDetail: vi.fn(),
      getPatientHistory: vi.fn(),
      review: vi.fn(),
      recordPayment: vi.fn(),
      updateClaimData: vi.fn(),
    };

    controller = new InsuranceClaimController(mockService);
  });

  describe('getQueue', () => {
    it('should return pending claims', async () => {
      const mockQueue = [
        {
          id: 'claim-1',
          status: ClaimStatus.DRAFT,
          claimedAmount: 100000,
        },
      ];

      mockService.getQueue.mockResolvedValue(mockQueue);

      const result = await controller.getQueue();

      expect(result.data).toEqual(mockQueue);
      expect(mockService.getQueue).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create claim', async () => {
      const billingId = 'bill-1';
      const dto = { billingId, reason: '정기 청구' };

      const mockClaim = {
        id: 'claim-1',
        status: ClaimStatus.DRAFT,
        claimedAmount: 100000,
      };

      mockService.create.mockResolvedValue(mockClaim);

      const result = await controller.create(dto);

      expect(result.data).toEqual(mockClaim);
      expect(mockService.create).toHaveBeenCalledWith(billingId, '정기 청구');
    });
  });

  describe('submit', () => {
    it('should submit claim with EDI data', async () => {
      const claimId = 'claim-1';
      const dto = { ediData: 'EDI_DATA', notes: '제출 완료' };

      const mockSubmitted = {
        id: claimId,
        status: ClaimStatus.SUBMITTED,
        claimNumber: 'CLM-20260513001',
      };

      mockService.submit.mockResolvedValue(mockSubmitted);

      const result = await controller.submit(claimId, dto);

      expect(result.data.status).toBe(ClaimStatus.SUBMITTED);
      expect(mockService.submit).toHaveBeenCalledWith(claimId, 'EDI_DATA', '제출 완료');
    });

    it('should submit without optional data', async () => {
      const claimId = 'claim-1';
      const dto = {};

      mockService.submit.mockResolvedValue({
        id: claimId,
        status: ClaimStatus.SUBMITTED,
      });

      await controller.submit(claimId, dto);

      expect(mockService.submit).toHaveBeenCalledWith(claimId, undefined, undefined);
    });
  });

  describe('getDetail', () => {
    it('should return claim detail', async () => {
      const claimId = 'claim-1';
      const mockDetail = {
        id: claimId,
        claimedAmount: 100000,
        status: ClaimStatus.APPROVED,
        billing: { items: [] },
      };

      mockService.getDetail.mockResolvedValue(mockDetail);

      const result = await controller.getDetail(claimId);

      expect(result.data).toEqual(mockDetail);
      expect(mockService.getDetail).toHaveBeenCalledWith(claimId);
    });
  });

  describe('getPatientHistory', () => {
    it('should return patient claims history', async () => {
      const patientId = 'pat-1';
      const mockHistory = [
        { id: 'claim-1', claimDate: new Date('2026-05-13') },
        { id: 'claim-2', claimDate: new Date('2026-05-12') },
      ];

      mockService.getPatientHistory.mockResolvedValue(mockHistory);

      const result = await controller.getPatientHistory(patientId);

      expect(result.data).toEqual(mockHistory);
      expect(mockService.getPatientHistory).toHaveBeenCalledWith(patientId);
    });
  });

  describe('review', () => {
    it('should approve claim', async () => {
      const claimId = 'claim-1';
      const dto = {
        action: 'approve' as const,
        approvedAmount: 100000,
        reason: '승인',
      };

      const mockApproved = {
        id: claimId,
        status: ClaimStatus.APPROVED,
        approvedAmount: 100000,
      };

      mockService.review.mockResolvedValue(mockApproved);

      const result = await controller.review(claimId, dto);

      expect(result.data.status).toBe(ClaimStatus.APPROVED);
      expect(mockService.review).toHaveBeenCalledWith(claimId, 'approve', 100000, '승인');
    });

    it('should reject claim', async () => {
      const claimId = 'claim-1';
      const dto = {
        action: 'reject' as const,
        approvedAmount: 0,
        reason: '부정청구 의심',
      };

      const mockRejected = {
        id: claimId,
        status: ClaimStatus.REJECTED,
        approvedAmount: 0,
      };

      mockService.review.mockResolvedValue(mockRejected);

      const result = await controller.review(claimId, dto);

      expect(result.data.status).toBe(ClaimStatus.REJECTED);
      expect(mockService.review).toHaveBeenCalledWith(claimId, 'reject', 0, '부정청구 의심');
    });
  });

  describe('recordPayment', () => {
    it('should record payment', async () => {
      const claimId = 'claim-1';
      const body = { paidAmount: 100000 };

      const mockPaid = {
        id: claimId,
        status: ClaimStatus.PAID,
        paidAmount: 100000,
      };

      mockService.recordPayment.mockResolvedValue(mockPaid);

      const result = await controller.recordPayment(claimId, body);

      expect(result.data.status).toBe(ClaimStatus.PAID);
      expect(mockService.recordPayment).toHaveBeenCalledWith(claimId, 100000);
    });
  });

  describe('updateClaimData', () => {
    it('should update claim data', async () => {
      const claimId = 'claim-1';
      const dto = {
        claimData: { notes: '수정됨' },
        reducedAmount: 10000,
      };

      const mockUpdated = {
        id: claimId,
        claimData: { notes: '수정됨' },
        reducedAmount: 10000,
      };

      mockService.updateClaimData.mockResolvedValue(mockUpdated);

      const result = await controller.updateClaimData(claimId, dto);

      expect(result.data.claimData.notes).toBe('수정됨');
      expect(mockService.updateClaimData).toHaveBeenCalledWith(claimId, { notes: '수정됨' }, 10000);
    });
  });
});
