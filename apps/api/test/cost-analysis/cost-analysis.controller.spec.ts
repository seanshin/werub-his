import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CostAnalysisController } from '../../src/modules/cost-analysis/cost-analysis.controller';

describe('CostAnalysisController', () => {
  let controller: CostAnalysisController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getCenters: vi.fn().mockResolvedValue([
        { id: 'cc-1', code: 'CC-ER', name: '응급실', type: 'DIRECT_CARE' },
      ]),
      createCenter: vi.fn().mockResolvedValue({ id: 'cc-new', code: 'CC-NEW' }),
      getDrivers: vi.fn().mockResolvedValue([
        { id: 'cd-1', code: 'CD-LABOR-DR', name: '의사 인건비', unitCost: 150000 },
      ]),
      createDriver: vi.fn().mockResolvedValue({ id: 'cd-new' }),
      createAllocation: vi.fn().mockResolvedValue({ id: 'alloc-1', amount: 15000000 }),
      getProcedureCosts: vi.fn().mockResolvedValue([
        { procedureCode: 'HA101', procedureName: '외래 진찰', totalCost: 65000, margin: 0.23 },
      ]),
      getDepartmentAnalytics: vi.fn().mockResolvedValue({
        totalCost: 2500000000, topCenters: [], costTrend: [], profitabilityByDept: [],
      }),
    };
    controller = new CostAnalysisController(mockService);
  });

  describe('getCenters', () => {
    it('should return cost center list', async () => {
      const result = await controller.getCenters();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].code).toBe('CC-ER');
    });
  });

  describe('createAllocation', () => {
    it('should create cost allocation', async () => {
      const body = { costCenterId: 'cc-1', driverId: 'cd-1', period: '2026-Q2', quantity: 300 };
      const result = await controller.createAllocation(body);
      expect(result.data.amount).toBe(15000000);
    });
  });

  describe('getProcedureCosts', () => {
    it('should return procedure cost analysis', async () => {
      const result = await controller.getProcedureCosts('2026-Q2');
      expect(result.data[0].margin).toBe(0.23);
    });
  });

  describe('getDepartmentAnalytics', () => {
    it('should return department analytics', async () => {
      const result = await controller.getDepartmentAnalytics('2026-Q2');
      expect(result.data.totalCost).toBe(2500000000);
    });
  });
});
