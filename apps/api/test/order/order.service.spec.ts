import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrderService } from '../../src/modules/order/order.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('OrderService', () => {
  let service: OrderService;
  let mockPrisma: any;
  let mockPacsProxy: any;

  beforeEach(() => {
    mockPrisma = {
      order: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
      },
      prescription: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      medicationAdministration: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      // changeStatus 는 오더 전이와 처방 연동 취소를 한 트랜잭션에서 쓴다
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockPrisma)),
    };

    mockPacsProxy = {
      createWorklistItem: vi.fn(),
    };

    service = new OrderService(mockPrisma, mockPacsProxy);
  });

  describe('createFromPrescription', () => {
    it('should create order from MEDICATION prescription', async () => {
      mockPrisma.order.create.mockResolvedValue({
        id: 'ord-1',
        prescriptionId: 'rx-1',
        department: 'PHARMACY',
        status: 'ORDERED',
        priority: 'ROUTINE',
      });

      const result = await service.createFromPrescription('rx-1', 'MEDICATION');

      expect(result.department).toBe('PHARMACY');
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            prescriptionId: 'rx-1',
            department: 'PHARMACY',
          }),
        }),
      );
    });

    it('should create order from LAB prescription', async () => {
      mockPrisma.order.create.mockResolvedValue({
        id: 'ord-2',
        prescriptionId: 'rx-2',
        department: 'LAB',
        status: 'ORDERED',
      });

      const result = await service.createFromPrescription('rx-2', 'LAB');

      expect(result.department).toBe('LAB');
    });

    it('should create order from IMAGING prescription', async () => {
      mockPrisma.order.create.mockResolvedValue({
        id: 'ord-3',
        prescriptionId: 'rx-3',
        department: 'IMAGING',
        status: 'ORDERED',
      });

      mockPrisma.prescription.findUnique.mockResolvedValue({
        id: 'rx-3',
        encounter: {
          patient: { mrn: 'MR001', familyName: '김', givenName: '환자', gender: 'MALE' },
          doctor: { familyName: '이', givenName: '의사' },
        },
        procedureCode: { code: 'CXR', nameKo: '흉부 X선' },
      });

      mockPacsProxy.createWorklistItem.mockResolvedValue({ status: 'success' });

      const result = await service.createFromPrescription('rx-3', 'IMAGING');

      expect(result.department).toBe('IMAGING');
      // PACS worklist 푸시는 비동기로 실행되므로 await 필요 없음
    });

    it('should handle custom priority', async () => {
      mockPrisma.order.create.mockResolvedValue({
        id: 'ord-1',
        priority: 'STAT',
      });

      await service.createFromPrescription('rx-1', 'MEDICATION', 'STAT');

      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: 'STAT',
          }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('should return orders with pagination', async () => {
      const mockOrders = [
        {
          id: 'ord-1',
          department: 'PHARMACY',
          status: 'ORDERED',
          prescription: { encounter: { patient: { mrn: 'MR001' } } },
        },
      ];

      mockPrisma.order.findMany.mockResolvedValue(mockOrders);
      mockPrisma.order.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
    });

    it('should filter by department', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      mockPrisma.order.count.mockResolvedValue(0);

      await service.findAll({ department: 'PHARMACY' });

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            department: 'PHARMACY',
          }),
        }),
      );
    });

    it('should filter by status', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      mockPrisma.order.count.mockResolvedValue(0);

      await service.findAll({ status: 'ORDERED' });

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'ORDERED',
          }),
        }),
      );
    });

    it('should paginate with custom limit', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      mockPrisma.order.count.mockResolvedValue(100);

      await service.findAll({ page: 2, limit: 25 });

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 25,
          take: 25,
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

      mockPrisma.order.findMany.mockResolvedValue(mockQueue);

      const result = await service.getQueue('PHARMACY');

      expect(result).toHaveLength(2);
      expect(result[0].priority).toBe('STAT'); // STAT comes first
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            department: 'PHARMACY',
            status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] },
          }),
        }),
      );
    });

    it('should return queue for LAB department', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      await service.getQueue('LAB');

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            department: 'LAB',
          }),
        }),
      );
    });

    it('should sort by priority then creation time', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      await service.getQueue('IMAGING');

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        }),
      );
    });
  });

  describe('changeStatus', () => {
    it('should change status from ORDERED to RECEIVED', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        status: 'ORDERED',
      });

      mockPrisma.order.update.mockResolvedValue({
        id: 'ord-1',
        status: 'RECEIVED',
        receivedAt: new Date(),
      });

      const result = await service.changeStatus('ord-1', 'RECEIVED');

      expect(result.status).toBe('RECEIVED');
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'RECEIVED',
            receivedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should change status from RECEIVED to IN_PROGRESS', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        status: 'RECEIVED',
      });

      mockPrisma.order.update.mockResolvedValue({
        id: 'ord-1',
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      });

      const result = await service.changeStatus('ord-1', 'IN_PROGRESS');

      expect(result.status).toBe('IN_PROGRESS');
    });

    it('should change status from IN_PROGRESS to COMPLETED', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        status: 'IN_PROGRESS',
      });

      mockPrisma.order.update.mockResolvedValue({
        id: 'ord-1',
        status: 'COMPLETED',
        completedAt: new Date(),
      });

      const result = await service.changeStatus('ord-1', 'COMPLETED');

      expect(result.status).toBe('COMPLETED');
    });

    it('should allow cancellation from ORDERED', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        status: 'ORDERED',
      });

      mockPrisma.order.update.mockResolvedValue({
        id: 'ord-1',
        status: 'CANCELLED',
      });

      const result = await service.changeStatus('ord-1', 'CANCELLED');

      expect(result.status).toBe('CANCELLED');
    });

    it('should allow cancellation from RECEIVED', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        status: 'RECEIVED',
      });

      mockPrisma.order.update.mockResolvedValue({
        id: 'ord-1',
        status: 'CANCELLED',
      });

      const result = await service.changeStatus('ord-1', 'CANCELLED');

      expect(result.status).toBe('CANCELLED');
    });

    it('should reject invalid status transition', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        status: 'COMPLETED',
      });

      await expect(service.changeStatus('ord-1', 'IN_PROGRESS')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if order not found', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(service.changeStatus('ord-1', 'RECEIVED')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should add notes if provided', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        status: 'ORDERED',
      });

      mockPrisma.order.update.mockResolvedValue({
        id: 'ord-1',
        status: 'RECEIVED',
        notes: '처방전 확인됨',
      });

      const result = await service.changeStatus('ord-1', 'RECEIVED', '처방전 확인됨');

      expect(result.notes).toBe('처방전 확인됨');
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notes: '처방전 확인됨',
          }),
        }),
      );
    });
  });
});
