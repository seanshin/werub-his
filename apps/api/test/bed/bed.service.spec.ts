import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BedService } from '../../src/modules/bed/bed.service';
import { BedStatus } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';

describe('BedService', () => {
  let service: BedService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      bed: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      ward: {
        findUnique: vi.fn(),
      },
    };
    service = new BedService(mockPrisma);
  });

  describe('listBeds', () => {
    it('should return all beds', async () => {
      const mockBeds = [
        { id: 'bed-1', status: BedStatus.AVAILABLE },
        { id: 'bed-2', status: BedStatus.OCCUPIED },
      ];
      mockPrisma.bed.findMany.mockResolvedValue(mockBeds);

      const result = await service.listBeds();

      expect(result.length).toBe(2);
    });
  });

  describe('updateBedStatus', () => {
    it('should update bed status', async () => {
      mockPrisma.bed.findUnique.mockResolvedValue({ id: 'bed-1' });
      mockPrisma.bed.update.mockResolvedValue({ id: 'bed-1', status: BedStatus.MAINTENANCE });

      const result = await service.updateBedStatus('bed-1', BedStatus.MAINTENANCE);

      expect(result.status).toBe(BedStatus.MAINTENANCE);
    });

    it('should throw if bed not found', async () => {
      mockPrisma.bed.findUnique.mockResolvedValue(null);

      await expect(service.updateBedStatus('bed-1', BedStatus.MAINTENANCE)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAvailableBeds', () => {
    it('should return available beds', async () => {
      const mockBeds = [{ id: 'bed-1', status: BedStatus.AVAILABLE }];
      mockPrisma.bed.findMany.mockResolvedValue(mockBeds);

      const result = await service.getAvailableBeds();

      expect(result.length).toBe(1);
      // wardId 미지정=입원 배정용 — 응급병동(ward.type=EMERGENCY)은 제외(ER 베드 보드 D1 실결함 봉합)
      expect(mockPrisma.bed.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: [BedStatus.AVAILABLE, BedStatus.RESERVED] },
          ward: { type: { not: 'EMERGENCY' } },
        },
        orderBy: { roomNumber: 'asc' },
        include: expect.any(Object),
      });
    });

    it('특정 병동 지목 시에는 제외 없이 그 병동만(호출자가 스코프를 안다)', async () => {
      mockPrisma.bed.findMany.mockResolvedValue([]);
      await service.getAvailableBeds('ward-er');
      expect(mockPrisma.bed.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { status: { in: [BedStatus.AVAILABLE, BedStatus.RESERVED] }, wardId: 'ward-er' },
      }));
    });
  });

  describe('calculateWardOccupancy', () => {
    it('should calculate occupancy rate', async () => {
      const mockBeds = [
        { id: 'bed-1', status: BedStatus.OCCUPIED },
        { id: 'bed-2', status: BedStatus.AVAILABLE },
      ];
      mockPrisma.bed.findMany.mockResolvedValue(mockBeds);

      const result = await service.calculateWardOccupancy('ward-1');

      expect(result.total).toBe(2);
      expect(result.occupied).toBe(1);
      expect(result.occupancyRate).toBe(50);
    });
  });
});
