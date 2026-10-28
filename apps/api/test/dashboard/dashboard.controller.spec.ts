import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DashboardController } from '../../src/modules/dashboard/dashboard.controller';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service';

describe('DashboardController', () => {
  let controller: DashboardController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getDashboardSummary: vi.fn(),
      getPharmacyStats: vi.fn(),
      getLabStats: vi.fn(),
      getImagingStats: vi.fn(),
      getPharmacyQueue: vi.fn(),
      getLabQueue: vi.fn(),
      getImagingQueue: vi.fn(),
      getFinancialSummary: vi.fn(),
    };

    controller = new DashboardController(mockService);
  });

  describe('getDashboardSummary', () => {
    it('should return dashboard summary', async () => {
      const mockSummary = {
        pharmacy: { department: 'PHARMACY', total: 10, completed: 5, completionRate: 50 },
        lab: { department: 'LAB', total: 8, completed: 6, completionRate: 75 },
        imaging: { department: 'IMAGING', total: 5, completed: 4, completionRate: 80 },
        totalPatients: 100,
        totalEncounters: 50,
        avgWaitTime: 25,
        financialSummary: {
          totalAmount: 1000000,
          claimedAmount: 800000,
          approvedAmount: 750000,
          claimApprovalRate: 93.75,
        },
      };

      mockService.getDashboardSummary.mockResolvedValue(mockSummary);

      const result = await controller.getDashboardSummary('today');

      expect(result.data).toEqual(mockSummary);
      expect(mockService.getDashboardSummary).toHaveBeenCalledWith('today');
    });
  });

  describe('getPharmacyStats', () => {
    it('should return pharmacy stats', async () => {
      const mockStats = {
        department: 'PHARMACY',
        total: 10,
        pending: 2,
        inProgress: 3,
        completed: 5,
        completionRate: 50,
      };

      mockService.getPharmacyStats.mockResolvedValue(mockStats);

      const result = await controller.getPharmacyStats('week');

      expect(result.data).toEqual(mockStats);
      expect(mockService.getPharmacyStats).toHaveBeenCalledWith('week');
    });
  });

  describe('getLabStats', () => {
    it('should return lab stats', async () => {
      const mockStats = {
        department: 'LAB',
        total: 8,
        pending: 1,
        inProgress: 1,
        completed: 6,
        completionRate: 75,
      };

      mockService.getLabStats.mockResolvedValue(mockStats);

      const result = await controller.getLabStats('month');

      expect(result.data).toEqual(mockStats);
      expect(mockService.getLabStats).toHaveBeenCalledWith('month');
    });
  });

  describe('getImagingStats', () => {
    it('should return imaging stats', async () => {
      const mockStats = {
        department: 'IMAGING',
        total: 5,
        pending: 0,
        inProgress: 1,
        completed: 4,
        completionRate: 80,
      };

      mockService.getImagingStats.mockResolvedValue(mockStats);

      const result = await controller.getImagingStats('today');

      expect(result.data).toEqual(mockStats);
    });
  });

  describe('getPharmacyQueue', () => {
    it('should return pharmacy queue', async () => {
      const mockQueue = [
        { id: 'disp-1', orderId: 'ord-1', status: 'PENDING', createdAt: new Date() },
      ];

      mockService.getPharmacyQueue.mockResolvedValue(mockQueue);

      const result = await controller.getPharmacyQueue();

      expect(result.data).toEqual(mockQueue);
      expect(mockService.getPharmacyQueue).toHaveBeenCalled();
    });
  });

  describe('getFinancialSummary', () => {
    it('should return financial summary', async () => {
      const mockSummary = {
        totalAmount: 1000000,
        insuranceCovered: 800000,
        patientCopay: 200000,
        claimedAmount: 800000,
        approvedAmount: 750000,
        paidAmount: 700000,
        pendingAmount: 50000,
        claimApprovalRate: 93.75,
      };

      mockService.getFinancialSummary.mockResolvedValue(mockSummary);

      const result = await controller.getFinancialSummary('week');

      expect(result.data).toEqual(mockSummary);
      expect(mockService.getFinancialSummary).toHaveBeenCalledWith('week');
    });
  });
});
