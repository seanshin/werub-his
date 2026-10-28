import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingAdvancedController } from '../../src/modules/billing-advanced/billing-advanced.controller';

describe('BillingAdvancedController', () => {
  let controller: BillingAdvancedController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      calculateFFS: vi.fn(),
      calculateDRG: vi.fn(),
    };
    controller = new BillingAdvancedController(mockService);
  });

  // ─── calculateFFS ─────────────────────────────────────

  describe('calculateFFS', () => {
    it('should wrap FFS result in { data }', async () => {
      const ffsResult = {
        feeSystem: 'FFS',
        items: [{ code: 'AA157', name: '초진', category: '진찰료', amount: 15000, copayRate: 0.3 }],
        totalAmount: 15000,
        insuranceCovered: 10500,
        patientCopay: 4500,
      };
      mockService.calculateFFS.mockResolvedValue(ffsResult);

      const result = await controller.calculateFFS('enc-1');

      expect(mockService.calculateFFS).toHaveBeenCalledWith('enc-1');
      expect(result).toEqual({ data: ffsResult });
    });

    it('should wrap null result in { data: null }', async () => {
      mockService.calculateFFS.mockResolvedValue(null);

      const result = await controller.calculateFFS('nonexistent-id');

      expect(result).toEqual({ data: null });
    });

    it('should include all items in response', async () => {
      const ffsResult = {
        feeSystem: 'FFS',
        items: [
          { code: 'AA157', name: '초진료', category: '진찰료', amount: 50000 },
          { code: 'MED001', name: '아스피린', category: '약제비', amount: 150000 },
        ],
        totalAmount: 200000,
        insuranceCovered: 140000,
        patientCopay: 60000,
      };
      mockService.calculateFFS.mockResolvedValue(ffsResult);

      const result = await controller.calculateFFS('enc-1');

      expect(result.data.items).toHaveLength(2);
      expect(result.data.items[0].code).toBe('AA157');
      expect(result.data.items[1].code).toBe('MED001');
    });

    it('should pass encounterId from route parameter', async () => {
      mockService.calculateFFS.mockResolvedValue({ feeSystem: 'FFS', items: [], totalAmount: 0 });

      await controller.calculateFFS('enc-123');

      expect(mockService.calculateFFS).toHaveBeenCalledWith('enc-123');
    });

    it('should propagate service errors', async () => {
      mockService.calculateFFS.mockRejectedValue(new Error('Service error'));

      await expect(controller.calculateFFS('enc-1')).rejects.toThrow('Service error');
    });
  });

  // ─── calculateDRG ─────────────────────────────────────

  describe('calculateDRG', () => {
    it('should wrap DRG result in { data }', async () => {
      const drgResult = {
        feeSystem: 'DRG',
        drgCode: 'G01',
        totalAmount: 500000,
        insuranceCovered: 350000,
        patientCopay: 150000,
      };
      mockService.calculateDRG.mockResolvedValue(drgResult);

      const result = await controller.calculateDRG('enc-1', 'G01');

      expect(mockService.calculateDRG).toHaveBeenCalledWith('enc-1', 'G01');
      expect(result).toEqual({ data: drgResult });
    });

    it('should pass drgCode from query parameter', async () => {
      mockService.calculateDRG.mockResolvedValue({
        feeSystem: 'DRG',
        drgCode: 'H01',
        totalAmount: 1200000,
      });

      await controller.calculateDRG('enc-1', 'H01');

      expect(mockService.calculateDRG).toHaveBeenCalledWith('enc-1', 'H01');
    });

    it('should pass encounterId from route parameter', async () => {
      mockService.calculateDRG.mockResolvedValue({ totalAmount: 0 });

      await controller.calculateDRG('enc-456', 'G01');

      expect(mockService.calculateDRG).toHaveBeenCalledWith('enc-456', 'G01');
    });

    it('should propagate service errors', async () => {
      mockService.calculateDRG.mockRejectedValue(new Error('Calculation error'));

      await expect(controller.calculateDRG('enc-1', 'G01')).rejects.toThrow('Calculation error');
    });

    it('should verify insurance + copay equals total', async () => {
      const drgResult = {
        feeSystem: 'DRG',
        drgCode: 'G01',
        totalAmount: 500000,
        insuranceCovered: 350000,
        patientCopay: 150000,
      };
      mockService.calculateDRG.mockResolvedValue(drgResult);

      const result = await controller.calculateDRG('enc-1', 'G01');

      expect(result.data.insuranceCovered + result.data.patientCopay).toBe(result.data.totalAmount);
    });
  });

  // ─── Response Wrapping ────────────────────────────────

  describe('Response Wrapping', () => {
    it('should wrap calculateFFS response in { data }', async () => {
      const mockResult = { feeSystem: 'FFS', items: [], totalAmount: 0, insuranceCovered: 0, patientCopay: 0 };
      mockService.calculateFFS.mockResolvedValue(mockResult);

      const result = await controller.calculateFFS('enc-1');

      expect(result).toEqual({ data: mockResult });
    });

    it('should wrap calculateDRG response in { data }', async () => {
      const mockResult = { feeSystem: 'DRG', drgCode: 'G01', totalAmount: 500000, insuranceCovered: 350000, patientCopay: 150000 };
      mockService.calculateDRG.mockResolvedValue(mockResult);

      const result = await controller.calculateDRG('enc-1', 'G01');

      expect(result).toEqual({ data: mockResult });
    });
  });

  // ─── Fee System Comparison ────────────────────────────

  describe('Fee System Comparison', () => {
    it('should support both FFS and DRG calculation endpoints', async () => {
      const ffsMock = { feeSystem: 'FFS', items: [], totalAmount: 100000, insuranceCovered: 70000, patientCopay: 30000 };
      const drgMock = { feeSystem: 'DRG', drgCode: 'G01', totalAmount: 500000, insuranceCovered: 350000, patientCopay: 150000 };

      mockService.calculateFFS.mockResolvedValue(ffsMock);
      mockService.calculateDRG.mockResolvedValue(drgMock);

      const ffsResult = await controller.calculateFFS('enc-1');
      const drgResult = await controller.calculateDRG('enc-1', 'G01');

      expect(ffsResult.data.feeSystem).toBe('FFS');
      expect(drgResult.data.feeSystem).toBe('DRG');
    });
  });
});
