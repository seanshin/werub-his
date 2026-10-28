import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OperationalStatsController } from '../../src/modules/operational-stats/operational-stats.controller';
import { OperationalStatsService } from '../../src/modules/operational-stats/operational-stats.service';

describe('OperationalStatsController', () => {
  let controller: OperationalStatsController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getWardStats: vi.fn(),
      getAdmissionTrends: vi.fn(),
      getPatientFlow: vi.fn(),
      getDiseaseStats: vi.fn(),
      getFinancialStats: vi.fn(),
    };
    controller = new OperationalStatsController(mockService);
  });

  describe('getWardStats', () => {
    it('should return ward statistics', async () => {
      mockService.getWardStats.mockResolvedValue([
        { wardId: 'ward-1', wardName: '5층 내과', totalBeds: 10, discharged: 2 },
      ]);

      const result = await controller.getWardStats({});

      expect(result.data.length).toBe(1);
      expect(mockService.getWardStats).toHaveBeenCalled();
    });
  });

  describe('getAdmissionTrends', () => {
    it('should return admission trends', async () => {
      mockService.getAdmissionTrends.mockResolvedValue({
        totalAdmissions: 10,
        totalDischarges: 5,
        avgStayDays: 5,
      });

      const result = await controller.getAdmissionTrends({});

      expect(result.data.totalAdmissions).toBe(10);
    });
  });

  describe('getPatientFlow', () => {
    it('should return patient flow', async () => {
      mockService.getPatientFlow.mockResolvedValue({
        newAdmissions: 5,
        dischargedToday: 3,
        netFlow: 2,
      });

      const result = await controller.getPatientFlow({});

      expect(result.data.netFlow).toBe(2);
    });
  });

  describe('getDiseaseStats', () => {
    it('should return disease statistics', async () => {
      mockService.getDiseaseStats.mockResolvedValue([
        { name: 'J45-천식', count: 5 },
      ]);

      const result = await controller.getDiseaseStats({});

      expect(result.data.length).toBe(1);
    });
  });

  describe('getFinancialStats', () => {
    it('should return financial statistics', async () => {
      mockService.getFinancialStats.mockResolvedValue({
        totalBillings: 100,
        totalAmount: 10000000,
        avgBillingAmount: 100000,
      });

      const result = await controller.getFinancialStats({});

      expect(result.data.totalBillings).toBe(100);
    });
  });
});
