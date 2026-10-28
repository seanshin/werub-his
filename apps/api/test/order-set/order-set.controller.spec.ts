import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrderSetController } from '../../src/modules/order-set/order-set.controller';
import { NotFoundException } from '@nestjs/common';

describe('OrderSetController', () => {
  let controller: OrderSetController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      create: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      recommend: vi.fn(),
      cloneOrderSet: vi.fn(),
      changeStatus: vi.fn(),
      deprecateOrderSet: vi.fn(),
      searchOrderSets: vi.fn(),
      recordUsage: vi.fn(),
      getUsageStats: vi.fn(),
      getHistory: vi.fn(),
      createFavorite: vi.fn(),
      getFavorites: vi.fn(),
      useFavorite: vi.fn(),
      removeFavorite: vi.fn(),
    };
    controller = new OrderSetController(mockService);
  });

  // ── create ──

  describe('create', () => {
    it('should create order set with userId and wrap in data', async () => {
      const dto = { name: 'Pneumonia Set', category: 'ANTIBIOTICS', items: [{ medication: 'Amoxicillin' }] };
      mockService.create.mockResolvedValue({ id: 'os-1', ...dto, createdBy: 'user-1' });
      const result = await controller.create(dto, 'user-1');
      expect(result.data.id).toBe('os-1');
      expect(mockService.create).toHaveBeenCalledWith(dto, 'user-1');
    });
  });

  // ── findAll ──

  describe('findAll', () => {
    it('should return all with no filters', async () => {
      mockService.findAll.mockResolvedValue([{ id: 'os-1' }]);
      const result = await controller.findAll();
      expect(result).toHaveProperty('data');
      expect(mockService.findAll).toHaveBeenCalledWith({});
    });

    it('should pass all filters', async () => {
      mockService.findAll.mockResolvedValue([]);
      await controller.findAll('ANTIBIOTICS', 'Internal Medicine', 'J15', 'ACTIVE');
      expect(mockService.findAll).toHaveBeenCalledWith({
        category: 'ANTIBIOTICS',
        department: 'Internal Medicine',
        diagnosisCode: 'J15',
        status: 'ACTIVE',
      });
    });
  });

  // ── search ──

  describe('search', () => {
    it('should search order sets by query', async () => {
      mockService.searchOrderSets.mockResolvedValue([{ id: 'os-1', name: 'AMX 처방' }]);
      const result = await controller.search('AMX');
      expect(result.data).toHaveLength(1);
      expect(mockService.searchOrderSets).toHaveBeenCalledWith('AMX');
    });

    it('should handle empty query', async () => {
      mockService.searchOrderSets.mockResolvedValue([]);
      const result = await controller.search(undefined as any);
      expect(result).toHaveProperty('data');
      expect(mockService.searchOrderSets).toHaveBeenCalledWith('');
    });
  });

  // ── getStats ──

  describe('getStats', () => {
    it('should return usage statistics', async () => {
      const stats = { topUsed: [], byDepartment: [], totalUsages: 0, modificationRate: 0 };
      mockService.getUsageStats.mockResolvedValue(stats);
      const result = await controller.getStats();
      expect(result.data).toEqual(stats);
    });
  });

  // ── recommend ──

  describe('recommend', () => {
    it('should recommend sets by comma-separated diagnosis codes', async () => {
      mockService.recommend.mockResolvedValue([{ id: 'os-1' }]);
      const result = await controller.recommend('I10,E11');
      expect(result.data).toHaveLength(1);
      expect(mockService.recommend).toHaveBeenCalledWith(['I10', 'E11'], undefined, undefined, undefined);
    });

    it('should pass primaryCode and age to recommend v2', async () => {
      mockService.recommend.mockResolvedValue([]);
      await controller.recommend('I10,E11', 'I10', '45');
      expect(mockService.recommend).toHaveBeenCalledWith(['I10', 'E11'], 'I10', 45, undefined);
    });

    it('should handle empty codes string', async () => {
      mockService.recommend.mockResolvedValue([]);
      await controller.recommend('');
      expect(mockService.recommend).toHaveBeenCalledWith([], undefined, undefined, undefined);
    });
  });

  // ── findById ──

  describe('findById', () => {
    it('should return order set detail', async () => {
      mockService.findById.mockResolvedValue({ id: 'os-1', name: 'CP' });
      const result = await controller.findById('os-1');
      expect(result.data.id).toBe('os-1');
    });

    it('should throw NotFoundException if not found', async () => {
      mockService.findById.mockRejectedValue(new NotFoundException());
      await expect(controller.findById('os-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ── getHistory ──

  describe('getHistory', () => {
    it('should return version history wrapped in data', async () => {
      mockService.getHistory.mockResolvedValue([{ id: 'os-1', version: 1 }, { id: 'os-2', version: 2 }]);
      const result = await controller.getHistory('os-1');
      expect(result.data).toHaveLength(2);
    });
  });

  // ── update ──

  describe('update', () => {
    it('should update order set', async () => {
      const dto = { name: 'Updated Set' };
      mockService.update.mockResolvedValue({ id: 'os-1', name: 'Updated Set' });
      const result = await controller.update('os-1', dto, 'u-1');
      expect(result.data.name).toBe('Updated Set');
      // 수정자 — 사용 중 세트면 새 판 초안의 작성자가 된다(2026-10-21 P2)
      expect(mockService.update).toHaveBeenCalledWith('os-1', dto, 'u-1');
    });
  });

  // ── clone ──

  describe('clone', () => {
    it('should clone order set and wrap in data', async () => {
      mockService.cloneOrderSet.mockResolvedValue({ id: 'os-2', version: 2 });
      const result = await controller.clone('os-1', 'user-1');
      expect(result.data.version).toBe(2);
      expect(mockService.cloneOrderSet).toHaveBeenCalledWith('os-1', 'user-1');
    });
  });

  // ── changeStatus ──

  describe('changeStatus', () => {
    it('should change status and wrap in data', async () => {
      mockService.changeStatus.mockResolvedValue({ id: 'os-1', status: 'APPROVED' });
      const result = await controller.changeStatus('os-1', { status: 'APPROVED' } as any, 'admin-1');
      expect(result.data.status).toBe('APPROVED');
      expect(mockService.changeStatus).toHaveBeenCalledWith('os-1', 'APPROVED', 'admin-1');
    });
  });

  // ── deprecate ──

  describe('deprecate', () => {
    it('should deprecate order set', async () => {
      mockService.deprecateOrderSet.mockResolvedValue({ id: 'os-1', status: 'DEPRECATED' });
      const result = await controller.deprecate('os-1');
      expect(result.data.status).toBe('DEPRECATED');
    });
  });

  // ── recordUsage ──

  describe('recordUsage', () => {
    it('should record usage and wrap in data', async () => {
      const dto = { encounterId: 'enc-1', patientId: 'p-1', itemsApplied: 5, itemsModified: 1 };
      mockService.recordUsage.mockResolvedValue({ id: 'u-1', ...dto });
      const result = await controller.recordUsage('os-1', dto as any, 'doc-1');
      expect(result.data.id).toBe('u-1');
      expect(mockService.recordUsage).toHaveBeenCalledWith('os-1', dto, 'doc-1');
    });
  });

  // ── remove ──

  describe('remove', () => {
    it('should soft delete and return { deleted: true }', async () => {
      mockService.remove.mockResolvedValue({ isActive: false });
      const result = await controller.remove('os-1');
      expect(result.data.deleted).toBe(true);
    });
  });

  // ── Favorites ──

  describe('createFavorite', () => {
    it('should create favorite with userId', async () => {
      const dto = { name: 'My Fav', items: [{ drug: 'Aspirin' }] };
      mockService.createFavorite.mockResolvedValue({ id: 'fav-1', userId: 'u-1' });
      const result = await controller.createFavorite(dto, 'u-1');
      expect(result.data.id).toBe('fav-1');
      expect(mockService.createFavorite).toHaveBeenCalledWith(dto, 'u-1');
    });
  });

  describe('getFavorites', () => {
    it('should return user favorites', async () => {
      mockService.getFavorites.mockResolvedValue([{ id: 'fav-1' }]);
      const result = await controller.getFavorites('u-1');
      expect(result.data).toHaveLength(1);
    });
  });

  describe('useFavorite', () => {
    it('should use favorite and wrap in data', async () => {
      mockService.useFavorite.mockResolvedValue({ id: 'fav-1', useCount: 5 });
      const result = await controller.useFavorite('fav-1');
      expect(result.data.useCount).toBe(5);
    });
  });

  describe('removeFavorite', () => {
    it('should delete favorite and return { deleted: true }', async () => {
      mockService.removeFavorite.mockResolvedValue({});
      const result = await controller.removeFavorite('fav-1');
      expect(result.data.deleted).toBe(true);
    });
  });

  // ── Response Format ──

  describe('Response Format', () => {
    it('should wrap all responses in data object', async () => {
      mockService.create.mockResolvedValue({ id: 'os-1' });
      mockService.findAll.mockResolvedValue([]);
      mockService.searchOrderSets.mockResolvedValue([]);
      mockService.getUsageStats.mockResolvedValue({});
      mockService.recommend.mockResolvedValue([]);
      mockService.findById.mockResolvedValue({ id: 'os-1' });
      mockService.getHistory.mockResolvedValue([]);
      mockService.update.mockResolvedValue({ id: 'os-1' });
      mockService.cloneOrderSet.mockResolvedValue({ id: 'os-2' });
      mockService.changeStatus.mockResolvedValue({ id: 'os-1' });
      mockService.deprecateOrderSet.mockResolvedValue({ id: 'os-1' });
      mockService.recordUsage.mockResolvedValue({ id: 'u-1' });
      mockService.remove.mockResolvedValue({});
      mockService.createFavorite.mockResolvedValue({ id: 'f-1' });
      mockService.getFavorites.mockResolvedValue([]);
      mockService.useFavorite.mockResolvedValue({ id: 'f-1' });
      mockService.removeFavorite.mockResolvedValue({});

      const results = await Promise.all([
        controller.create({ name: 'S', category: 'G', items: [] }, 'u'),
        controller.findAll(),
        controller.search('q'),
        controller.getStats(),
        controller.recommend('I10'),
        controller.findById('os-1'),
        controller.getHistory('os-1'),
        controller.update('os-1', {}),
        controller.clone('os-1', 'u'),
        controller.changeStatus('os-1', { status: 'ACTIVE' } as any, 'u'),
        controller.deprecate('os-1'),
        controller.recordUsage('os-1', {} as any, 'u'),
        controller.remove('os-1'),
        controller.createFavorite({ name: 'F', items: [] }, 'u'),
        controller.getFavorites('u'),
        controller.useFavorite('f-1'),
        controller.removeFavorite('f-1'),
      ]);

      results.forEach(r => expect(r).toHaveProperty('data'));
    });
  });
});
