import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrderController } from '../../src/modules/order/order.controller';
import { OrderService } from '../../src/modules/order/order.service';

describe('OrderController', () => {
  let controller: OrderController;
  let service: OrderService;

  beforeEach(() => {
    service = {
      findAll: vi.fn(),
      getQueue: vi.fn(),
      changeStatus: vi.fn(),
    } as any;

    controller = new OrderController(service);
  });

  describe('findAll', () => {
    it('should return orders with pagination', async () => {
      const mockResult = {
        data: [
          {
            id: 'ord-1',
            department: 'PHARMACY',
            status: 'ORDERED',
            prescription: { encounter: { patient: { mrn: 'MR001' } } },
          },
        ],
        pagination: { total: 1, page: 1, limit: 10 },
      };

      vi.mocked(service.findAll).mockResolvedValue(mockResult);

      const result = await controller.findAll();

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          department: undefined,
          status: undefined,
          doctorId: undefined,
        }),
      );
    });

    it('should filter by department', async () => {
      vi.mocked(service.findAll).mockResolvedValue({
        data: [],
        pagination: { total: 0, page: 1, limit: 10 },
      });

      await controller.findAll('PHARMACY');

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          department: 'PHARMACY',
        }),
      );
    });

    it('should filter by status', async () => {
      vi.mocked(service.findAll).mockResolvedValue({
        data: [],
        pagination: { total: 0, page: 1, limit: 10 },
      });

      await controller.findAll(undefined, 'ORDERED');

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ORDERED',
        }),
      );
    });

    it('should filter by doctorId', async () => {
      vi.mocked(service.findAll).mockResolvedValue({
        data: [],
        pagination: { total: 0, page: 1, limit: 10 },
      });

      await controller.findAll(undefined, undefined, 'doc-1');

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          doctorId: 'doc-1',
        }),
      );
    });

    it('should handle pagination with custom limit', async () => {
      vi.mocked(service.findAll).mockResolvedValue({
        data: [],
        pagination: { total: 100, page: 2, limit: 25 },
      });

      await controller.findAll(undefined, undefined, undefined, undefined, undefined, undefined, undefined, '2', '25');

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          limit: 25,
        }),
      );
    });

    it('should combine multiple filters', async () => {
      vi.mocked(service.findAll).mockResolvedValue({
        data: [],
        pagination: { total: 0, page: 1, limit: 10 },
      });

      await controller.findAll('LAB', 'IN_PROGRESS', 'doc-1', undefined, undefined, undefined, undefined, '1', '10');

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          department: 'LAB',
          status: 'IN_PROGRESS',
          doctorId: 'doc-1',
          page: 1,
          limit: 10,
        }),
      );
    });
  });

  describe('getQueue', () => {
    it('should return queue for PHARMACY department', async () => {
      const mockQueue = [
        { id: 'ord-1', priority: 'STAT', status: 'ORDERED', department: 'PHARMACY' },
        { id: 'ord-2', priority: 'ROUTINE', status: 'ORDERED', department: 'PHARMACY' },
      ];

      vi.mocked(service.getQueue).mockResolvedValue(mockQueue);

      const result = await controller.getQueue('PHARMACY');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].priority).toBe('STAT');
      expect(service.getQueue).toHaveBeenCalledWith('PHARMACY');
    });

    it('should return queue for LAB department', async () => {
      const mockQueue = [
        { id: 'ord-3', priority: 'ROUTINE', status: 'ORDERED', department: 'LAB' },
      ];

      vi.mocked(service.getQueue).mockResolvedValue(mockQueue);

      const result = await controller.getQueue('LAB');

      expect(result.data).toEqual(mockQueue);
      expect(service.getQueue).toHaveBeenCalledWith('LAB');
    });

    it('should return queue for IMAGING department', async () => {
      const mockQueue = [];

      vi.mocked(service.getQueue).mockResolvedValue(mockQueue);

      const result = await controller.getQueue('IMAGING');

      expect(result.data).toEqual([]);
      expect(service.getQueue).toHaveBeenCalledWith('IMAGING');
    });
  });

  describe('changeStatus', () => {
    it('should change order status from ORDERED to RECEIVED', async () => {
      const dto = { status: 'RECEIVED', notes: '처방전 확인됨' };

      const mockResult = {
        id: 'ord-1',
        status: 'RECEIVED',
        receivedAt: new Date(),
        notes: '처방전 확인됨',
      };

      vi.mocked(service.changeStatus).mockResolvedValue(mockResult);

      const result = await controller.changeStatus('ord-1', dto, { user: { id: 'u-1' } } as any);

      expect(result.data.status).toBe('RECEIVED');
      expect(result.data.notes).toBe('처방전 확인됨');
      expect(service.changeStatus).toHaveBeenCalledWith('ord-1', 'RECEIVED', '처방전 확인됨', 'u-1');
    });

    it('should change status without notes', async () => {
      const dto = { status: 'IN_PROGRESS' };

      const mockResult = {
        id: 'ord-1',
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      };

      vi.mocked(service.changeStatus).mockResolvedValue(mockResult);

      const result = await controller.changeStatus('ord-1', dto, { user: { id: 'u-1' } } as any);

      expect(result.data.status).toBe('IN_PROGRESS');
      expect(service.changeStatus).toHaveBeenCalledWith('ord-1', 'IN_PROGRESS', undefined, 'u-1');
    });

    it('should complete order', async () => {
      const dto = { status: 'COMPLETED' };

      const mockResult = {
        id: 'ord-1',
        status: 'COMPLETED',
        completedAt: new Date(),
      };

      vi.mocked(service.changeStatus).mockResolvedValue(mockResult);

      const result = await controller.changeStatus('ord-1', dto, { user: { id: 'u-1' } } as any);

      expect(result.data.status).toBe('COMPLETED');
      expect(service.changeStatus).toHaveBeenCalledWith('ord-1', 'COMPLETED', undefined, 'u-1');
    });

    it('should cancel order with reason', async () => {
      const dto = { status: 'CANCELLED', notes: '중복 오더' };

      const mockResult = {
        id: 'ord-1',
        status: 'CANCELLED',
        notes: '중복 오더',
      };

      vi.mocked(service.changeStatus).mockResolvedValue(mockResult);

      const result = await controller.changeStatus('ord-1', dto, { user: { id: 'u-1' } } as any);

      expect(result.data.status).toBe('CANCELLED');
      expect(service.changeStatus).toHaveBeenCalledWith('ord-1', 'CANCELLED', '중복 오더', 'u-1');
    });
  });
});
