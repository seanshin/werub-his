import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BedController } from '../../src/modules/bed/bed.controller';
import { BedStatus } from '@prisma/client';

describe('BedController', () => {
  let controller: BedController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      listBeds: vi.fn(),
      updateBedStatus: vi.fn(),
      getAvailableBeds: vi.fn(),
      getBedsByWard: vi.fn(),
      getBedDetail: vi.fn(),
      calculateWardOccupancy: vi.fn(),
    };
    controller = new BedController(mockService);
  });

  describe('listBeds', () => {
    it('should return beds', async () => {
      mockService.listBeds.mockResolvedValue([{ id: 'bed-1', status: BedStatus.AVAILABLE }]);

      const result = await controller.listBeds();

      expect(result.data.length).toBe(1);
    });
  });

  describe('updateBedStatus', () => {
    it('should update bed status', async () => {
      mockService.updateBedStatus.mockResolvedValue({ id: 'bed-1', status: BedStatus.MAINTENANCE });

      const result = await controller.updateBedStatus('bed-1', { status: BedStatus.MAINTENANCE });

      expect(result.data.status).toBe(BedStatus.MAINTENANCE);
    });
  });

  describe('getAvailableBeds', () => {
    it('should return available beds', async () => {
      mockService.getAvailableBeds.mockResolvedValue([{ id: 'bed-1', status: BedStatus.AVAILABLE }]);

      const result = await controller.getAvailableBeds();

      expect(result.data.length).toBe(1);
    });
  });

  describe('calculateWardOccupancy', () => {
    it('should return occupancy stats', async () => {
      mockService.calculateWardOccupancy.mockResolvedValue({
        total: 10,
        occupied: 7,
        occupancyRate: 70,
      });

      const result = await controller.calculateWardOccupancy('ward-1');

      expect(result.data.occupancyRate).toBe(70);
    });
  });
});
