import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InsuranceClaimService } from '../../src/modules/insurance-claim/insurance-claim.service';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { ClaimStatus } from '@prisma/client';

describe('InsuranceClaimService', () => {
  let service: InsuranceClaimService;
  let mockPrisma: any;
  let mockOutbox: any;

  beforeEach(() => {
    mockPrisma = {
      // 청구 항목 마스터 코드 해석(P2-2 · 정본 resolveEdiCodes)
      procedureCode: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCode: { findMany: vi.fn().mockResolvedValue([]) },
      claim: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      billing: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      // 배열 형태 + 콜백 형태(`create` 는 정본 `withAdvisoryLock` 을 지나간다 — `$executeRaw` 로 잠근다)
      $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    mockOutbox = { enqueue: vi.fn() };

    service = new InsuranceClaimService(mockPrisma, mockOutbox as any);
  });

  describe('getQueue', () => {
    it('should return pending claims', async () => {
      const mockClaims = [
        {
          id: 'claim-1',
          status: ClaimStatus.DRAFT,
          claimDate: new Date(),
          billing: { totalAmount: 100000 },
          patient: { id: 'pat-1', mrn: 'MRN001', familyName: '김', givenName: '환자' },
        },
      ];

      mockPrisma.claim.findMany.mockResolvedValue(mockClaims);

      const result = await service.getQueue();

      expect(result).toEqual(mockClaims);
      expect(mockPrisma.claim.findMany).toHaveBeenCalledWith({
        where: { status: { in: [ClaimStatus.DRAFT, ClaimStatus.SUBMITTED, ClaimStatus.UNDER_REVIEW] } },
        orderBy: { claimDate: 'asc' },
        include: expect.any(Object),
      });
    });
  });

  describe('create', () => {
    const billingId = 'bill-1';

    it('should create claim from billing', async () => {
      const mockBilling = {
        id: billingId,
        patientId: 'pat-1',
        totalAmount: 100000,
        status: 'PAID', // P2-4: 수납 끝난 건만
        patient: { insuranceType: 'NHI' },
        items: [{ id: 'item-1', codeId: 'c1' }, { id: 'item-2', codeId: 'c2' }],
      };

      const mockClaim = {
        id: 'claim-1',
        billingId,
        patientId: 'pat-1',
        claimedAmount: 100000,
        status: ClaimStatus.DRAFT,
      };

      mockPrisma.billing.findUnique.mockResolvedValue(mockBilling);
      mockPrisma.claim.findFirst.mockResolvedValue(null);
      mockPrisma.claim.create.mockResolvedValue(mockClaim);

      const result = await service.create(billingId);

      expect(result.status).toBe(ClaimStatus.DRAFT);
      expect(mockPrisma.claim.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          billingId,
          patientId: 'pat-1',
          claimedAmount: 100000,
          status: ClaimStatus.DRAFT,
        }),
        include: expect.any(Object),
      });
    });

    it('should throw NotFoundException when billing not found', async () => {
      mockPrisma.billing.findUnique.mockResolvedValue(null);

      await expect(service.create(billingId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when claim already exists', async () => {
      const mockBilling = {
        id: billingId,
        patientId: 'pat-1',
        totalAmount: 100000,
        items: [],
      };

      mockPrisma.billing.findUnique.mockResolvedValue(mockBilling);
      mockPrisma.claim.findFirst.mockResolvedValue({ id: 'claim-1' });

      await expect(service.create(billingId)).rejects.toThrow(ConflictException);
    });
  });

  describe('submit', () => {
    const claimId = 'claim-1';

    it('should submit claim with EDI data', async () => {
      mockPrisma.claim.findUnique.mockResolvedValue({
        id: claimId,
        status: ClaimStatus.DRAFT,
        claimedAmount: 100000,
        billing: {},
      });

      mockPrisma.claim.update.mockResolvedValue({
        id: claimId,
        status: ClaimStatus.SUBMITTED,
        claimNumber: expect.any(String),
      });

      const result = await service.submit(claimId, 'EDI_DATA_HERE');

      expect(result.status).toBe(ClaimStatus.SUBMITTED);
      // 🔴 2026-08-20 — 종전 이 단언은 `submittedAt: expect.any(Date)` 였다. 즉 **결함을 계약으로
      //    못박고 있었다**: 심평원 전송 코드가 없는데도 제출 시각이 찍히는 것을 통과시켰다.
      //    미전송이면 시각을 남기지 않는다(근거는 claimData.transmission).
      //    전송 성공 분기까지 포함한 판정은 test/claim/claim-submit-transmit-honesty.spec.ts.
      expect(mockPrisma.claim.update).toHaveBeenCalledWith({
        where: { id: claimId },
        data: expect.objectContaining({
          status: ClaimStatus.SUBMITTED,
          submittedAt: null,
        }),
        include: expect.any(Object),
      });
    });

    it('should throw ConflictException when not in DRAFT status', async () => {
      mockPrisma.claim.findUnique.mockResolvedValue({
        id: claimId,
        status: ClaimStatus.SUBMITTED,
      });

      await expect(service.submit(claimId)).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when claim not found', async () => {
      mockPrisma.claim.findUnique.mockResolvedValue(null);

      await expect(service.submit(claimId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDetail', () => {
    it('should return claim detail with billing items', async () => {
      const mockClaim = {
        id: 'claim-1',
        claimId: 'claim-1',
        claimedAmount: 100000,
        status: ClaimStatus.APPROVED,
        billing: { items: [{ codeType: 'MED', amount: 50000 }] },
        patient: { id: 'pat-1', mrn: 'MRN001' },
      };

      mockPrisma.claim.findUnique.mockResolvedValue(mockClaim);

      const result = await service.getDetail('claim-1');

      expect(result).toEqual(mockClaim);
      expect(result.billing.items).toBeDefined();
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.claim.findUnique.mockResolvedValue(null);

      await expect(service.getDetail('claim-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPatientHistory', () => {
    it('should return patient claims ordered by date', async () => {
      const mockClaims = [
        { id: 'claim-1', claimDate: new Date('2026-05-13') },
        { id: 'claim-2', claimDate: new Date('2026-05-12') },
      ];

      mockPrisma.claim.findMany.mockResolvedValue(mockClaims);

      const result = await service.getPatientHistory('pat-1');

      expect(result).toEqual(mockClaims);
      expect(mockPrisma.claim.findMany).toHaveBeenCalledWith({
        where: { patientId: 'pat-1' },
        orderBy: { claimDate: 'desc' },
        include: expect.any(Object),
      });
    });
  });

  describe('review', () => {
    const claimId = 'claim-1';

    it('should approve claim', async () => {
      mockPrisma.claim.findUnique.mockResolvedValue({
        id: claimId,
        status: ClaimStatus.SUBMITTED,
        claimedAmount: 100000,
      });

      mockPrisma.claim.update.mockResolvedValue({
        id: claimId,
        status: ClaimStatus.APPROVED,
        approvedAmount: 100000,
      });

      const result = await service.review(claimId, 'approve', 100000);

      expect(result.status).toBe(ClaimStatus.APPROVED);
      expect(mockPrisma.claim.update).toHaveBeenCalledWith({
        where: { id: claimId },
        data: expect.objectContaining({
          status: ClaimStatus.APPROVED,
          approvedAmount: 100000,
        }),
        include: expect.any(Object),
      });
    });

    it('§5 — 부분삭감 시 Billing 원장 갱신 + claim.reviewed 발행(경로A 정합)', async () => {
      mockPrisma.claim.findUnique.mockResolvedValue({ id: claimId, billingId: 'b1', status: ClaimStatus.SUBMITTED, claimedAmount: 100000 });
      mockPrisma.claim.update.mockResolvedValue({ id: claimId, claimNumber: 'CLM-1', status: ClaimStatus.PARTIALLY_APPROVED });
      await service.review(claimId, 'partial_approve', 70000, '일부 삭감');
      // Billing 원장에 승인액/삭감액 반영(종전엔 미갱신)
      expect(mockPrisma.billing.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'b1' },
        data: expect.objectContaining({ reviewedInsuranceAmount: 70000, insuranceReducedAmount: 30000 }),
      }));
      // ERP claim.reviewed 발행(§3 ref 바인딩)
      expect(mockOutbox.enqueue).toHaveBeenCalledWith('claim', 'claim.reviewed', expect.stringContaining('claim:review:claim-1:PARTIALLY_APPROVED:70000:30000'), expect.anything());
    });

    it('should reject claim', async () => {
      mockPrisma.claim.findUnique.mockResolvedValue({
        id: claimId,
        status: ClaimStatus.SUBMITTED,
        claimedAmount: 100000,
      });

      mockPrisma.claim.update.mockResolvedValue({
        id: claimId,
        status: ClaimStatus.REJECTED,
        approvedAmount: 0,
      });

      const result = await service.review(claimId, 'reject', 0, '부정청구 의심');

      expect(result.status).toBe(ClaimStatus.REJECTED);
    });

    it('should throw ConflictException when not in reviewable status', async () => {
      mockPrisma.claim.findUnique.mockResolvedValue({
        id: claimId,
        status: ClaimStatus.DRAFT,
      });

      await expect(service.review(claimId, 'approve', 100000)).rejects.toThrow(ConflictException);
    });
  });

  describe('recordPayment', () => {
    const claimId = 'claim-1';

    it('should record payment for approved claim', async () => {
      mockPrisma.claim.findUnique.mockResolvedValue({
        id: claimId,
        status: ClaimStatus.APPROVED,
        approvedAmount: 100000,
      });

      mockPrisma.claim.update.mockResolvedValue({
        id: claimId,
        status: ClaimStatus.PAID,
        paidAmount: 100000,
      });

      const result = await service.recordPayment(claimId, 100000);

      expect(result.status).toBe(ClaimStatus.PAID);
      expect(mockPrisma.claim.update).toHaveBeenCalledWith({
        where: { id: claimId },
        data: expect.objectContaining({
          status: ClaimStatus.PAID,
          paidAmount: 100000,
          paidAt: expect.any(Date),
        }),
        include: expect.any(Object),
      });
    });

    it('should throw ConflictException when claim not approved', async () => {
      mockPrisma.claim.findUnique.mockResolvedValue({
        id: claimId,
        status: ClaimStatus.SUBMITTED,
      });

      await expect(service.recordPayment(claimId, 100000)).rejects.toThrow(ConflictException);
    });
  });
});
