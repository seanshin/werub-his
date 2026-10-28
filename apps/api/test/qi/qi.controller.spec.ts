import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QiController } from '../../src/modules/qi/qi.controller';

describe('QiController', () => {
  let controller: QiController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getMetrics: vi.fn(),
    };
    controller = new QiController(mockService);
  });

  describe('getMetrics', () => {
    it('should get QI metrics and return service result directly', async () => {
      const mockMetrics = {
        data: {
          period: { from: '2026-05-01', to: '2026-05-31' },
          outpatient: { totalVisits: 100, avgWaitMinutes: 15 },
          emergency: { totalVisits: 50, avgStayHours: 4 },
          inpatient: { totalAdmissions: 30, avgLengthOfStay: 5 },
          surgery: { totalSurgeries: 20, avgOpTimeMinutes: 90 },
          safety: { totalPrescriptions: 500 },
        },
      };
      mockService.getMetrics.mockResolvedValue(mockMetrics);

      const result = await controller.getMetrics('2026-05-01', '2026-05-31');
      expect(result.data).toBeDefined();
      expect(result.data.outpatient.totalVisits).toBe(100);
      expect(mockService.getMetrics).toHaveBeenCalledWith('2026-05-01', '2026-05-31', undefined);
    });

    it('should pass department filter', async () => {
      mockService.getMetrics.mockResolvedValue({ data: {} });
      await controller.getMetrics('2026-05-01', '2026-05-31', 'Cardiology');
      expect(mockService.getMetrics).toHaveBeenCalledWith('2026-05-01', '2026-05-31', 'Cardiology');
    });

    it('should handle missing dates', async () => {
      mockService.getMetrics.mockResolvedValue({ data: {} });
      await controller.getMetrics(undefined as any, undefined as any);
      expect(mockService.getMetrics).toHaveBeenCalled();
    });

    it('should include all five metric categories', async () => {
      const mockMetrics = {
        data: {
          period: {},
          outpatient: { totalVisits: 100 },
          emergency: { totalVisits: 50 },
          inpatient: { totalAdmissions: 30 },
          surgery: { totalSurgeries: 20 },
          safety: { totalPrescriptions: 500 },
        },
      };
      mockService.getMetrics.mockResolvedValue(mockMetrics);
      const result = await controller.getMetrics('2026-05-01', '2026-05-31');
      expect(result.data.outpatient).toBeDefined();
      expect(result.data.emergency).toBeDefined();
      expect(result.data.inpatient).toBeDefined();
      expect(result.data.surgery).toBeDefined();
      expect(result.data.safety).toBeDefined();
    });
  });

  describe('Response Format', () => {
    it('should return service result (which already contains data wrapper)', async () => {
      const mockMetrics = { data: { period: {}, outpatient: {}, emergency: {}, inpatient: {}, surgery: {}, safety: {} } };
      mockService.getMetrics.mockResolvedValue(mockMetrics);
      const result = await controller.getMetrics('2026-05-01', '2026-05-31');
      expect(result).toHaveProperty('data');
    });

    it('should include period information', async () => {
      const mockMetrics = { data: { period: { from: '2026-05-01', to: '2026-05-31' }, outpatient: {}, emergency: {}, inpatient: {}, surgery: {}, safety: {} } };
      mockService.getMetrics.mockResolvedValue(mockMetrics);
      const result = await controller.getMetrics('2026-05-01', '2026-05-31');
      expect(result.data.period.from).toBe('2026-05-01');
    });
  });

  describe('Query Parameters', () => {
    it('should pass from, to, and department', async () => {
      mockService.getMetrics.mockResolvedValue({ data: {} });
      await controller.getMetrics('2026-05-01', '2026-05-31', 'Surgery');
      expect(mockService.getMetrics).toHaveBeenCalledWith('2026-05-01', '2026-05-31', 'Surgery');
    });

    it('should handle undefined department', async () => {
      mockService.getMetrics.mockResolvedValue({ data: {} });
      await controller.getMetrics('2026-05-01', '2026-05-31');
      expect(mockService.getMetrics).toHaveBeenCalledWith('2026-05-01', '2026-05-31', undefined);
    });
  });
});
