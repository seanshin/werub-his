import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service';
import { DispensingStatus, LabResultStatus, ImagingResultStatus, ClaimStatus } from '@prisma/client';

describe('DashboardService', () => {
  let service: DashboardService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      dispensing: {
        groupBy: vi.fn(),
        findMany: vi.fn(),
      },
      labResult: {
        groupBy: vi.fn(),
        findMany: vi.fn(),
      },
      imagingResult: {
        groupBy: vi.fn(),
        findMany: vi.fn(),
      },
      waitingQueue: { count: vi.fn().mockResolvedValue(0) }, // '대기 환자' 정본(2026-08-13 W3)
      billing: {
        aggregate: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      claim: {
        aggregate: vi.fn(),
        findMany: vi.fn(),
      },
      patient: {
        count: vi.fn(),
      },
      encounter: {
        count: vi.fn(),
      },
      order: {
        findMany: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      appointment: {
        count: vi.fn().mockResolvedValue(0),
      },
    };

    service = new DashboardService(mockPrisma);
  });

  describe('getPharmacyStats', () => {
    it('should return pharmacy statistics', async () => {
      const mockGroups = [
        { status: DispensingStatus.PENDING, _count: 1 },
        { status: DispensingStatus.DISPENSED, _count: 1 },
        { status: DispensingStatus.VERIFIED, _count: 1 },
      ];

      mockPrisma.dispensing.groupBy.mockResolvedValue(mockGroups);

      const result = await service.getPharmacyStats('today');

      expect(result.department).toBe('PHARMACY');
      expect(result.total).toBe(3);
      expect(result.pending).toBe(1);
      expect(result.inProgress).toBe(1);
      expect(result.completed).toBe(1);
    });

    it('should calculate completion rate', async () => {
      const mockGroups = [
        { status: DispensingStatus.PENDING, _count: 2 },
        { status: DispensingStatus.VERIFIED, _count: 1 },
      ];

      mockPrisma.dispensing.groupBy.mockResolvedValue(mockGroups);

      const result = await service.getPharmacyStats('today');

      expect(result.completionRate).toBeCloseTo(33.33, 1);
    });
  });

  describe('getLabStats', () => {
    it('should return lab statistics', async () => {
      const mockGroups = [
        { status: LabResultStatus.COLLECTED, _count: 1 },
        { status: LabResultStatus.IN_PROGRESS, _count: 1 },
        { status: LabResultStatus.COMPLETED, _count: 1 },
      ];

      mockPrisma.labResult.groupBy.mockResolvedValue(mockGroups);

      const result = await service.getLabStats('today');

      expect(result.department).toBe('LAB');
      expect(result.total).toBe(3);
      expect(result.completed).toBe(1);
    });
  });

  describe('getImagingStats', () => {
    it('should return imaging statistics', async () => {
      const mockGroups = [
        { status: ImagingResultStatus.ORDERED, _count: 1 },
        { status: ImagingResultStatus.ACQUIRED, _count: 1 },
        { status: ImagingResultStatus.REPORTED, _count: 1 },
      ];

      mockPrisma.imagingResult.groupBy.mockResolvedValue(mockGroups);

      const result = await service.getImagingStats('today');

      expect(result.department).toBe('IMAGING');
      expect(result.total).toBe(3);
      expect(result.pending).toBe(1);
    });
  });

  describe('getFinancialSummary', () => {
    it('should return financial summary', async () => {
      mockPrisma.billing.aggregate.mockResolvedValue({
        _sum: { totalAmount: 100000, insuranceCovered: 80000, patientCopay: 20000 },
      });
      mockPrisma.claim.aggregate.mockResolvedValue({
        _sum: { claimedAmount: 80000, approvedAmount: 75000, paidAmount: 75000 },
      });

      const result = await service.getFinancialSummary('today');

      expect(result.totalAmount).toBe(100000);
      expect(result.claimedAmount).toBe(80000);
      expect(result.approvedAmount).toBe(75000);
    });

    it('should calculate claim approval rate', async () => {
      mockPrisma.billing.aggregate.mockResolvedValue({
        _sum: { totalAmount: null, insuranceCovered: null, patientCopay: null },
      });
      mockPrisma.claim.aggregate.mockResolvedValue({
        _sum: { claimedAmount: 100000, approvedAmount: 80000, paidAmount: 80000 },
      });

      const result = await service.getFinancialSummary('today');

      expect(result.claimApprovalRate).toBe(80);
    });
  });

  describe('getDashboardSummary', () => {
    it('should return complete dashboard summary', async () => {
      mockPrisma.dispensing.groupBy.mockResolvedValue([]);
      mockPrisma.labResult.groupBy.mockResolvedValue([]);
      mockPrisma.imagingResult.groupBy.mockResolvedValue([]);
      mockPrisma.billing.aggregate.mockResolvedValue({ _sum: {} });
      mockPrisma.claim.aggregate.mockResolvedValue({ _sum: {} });
      mockPrisma.patient.count.mockResolvedValue(100);
      mockPrisma.encounter.count.mockResolvedValue(50);
      mockPrisma.order.findMany.mockResolvedValue([]);

      const result = await service.getDashboardSummary('today');

      expect(result.pharmacy).toBeDefined();
      expect(result.lab).toBeDefined();
      expect(result.imaging).toBeDefined();
      expect(result.totalPatients).toBe(100);
      expect(result.totalEncounters).toBe(50);
      expect(result.financialSummary).toBeDefined();
    });
  });
});
