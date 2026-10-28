import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { InventoryService } from '../../src/modules/inventory/inventory.service';

describe('InventoryService', () => {
  let service: InventoryService;
  let mockPrisma: any;
  let mockOutbox: any;
  let mockConfig: any;

  beforeEach(() => {
    mockPrisma = {
      inventoryItem: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      inventoryStorage: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      inventoryTransaction: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      gateViolationLog: { create: vi.fn().mockResolvedValue({}) }, // 관제 위반 영속(best-effort)
      inventoryLot: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      inventorySupplier: {
        findMany: vi.fn(),
      },
      $queryRaw: vi.fn(),
      $transaction: vi.fn((cb: Function) => cb(mockPrisma)),
    };

    mockOutbox = { enqueue: vi.fn().mockResolvedValue(undefined) };
    mockConfig = { get: vi.fn().mockResolvedValue(undefined) };

    service = new InventoryService(mockPrisma, mockOutbox, mockConfig);
  });

  describe('findAll', () => {
    it('should return all active items', async () => {
      const mockItems = [
        { id: 'item-1', code: 'ITEM001', name: '반창고', category: '의료소모품', currentStock: 100, safetyStock: 20 },
        { id: 'item-2', code: 'ITEM002', name: '주사기', category: '의료소모품', currentStock: 500, safetyStock: 100 },
      ];

      mockPrisma.inventoryItem.findMany.mockResolvedValue(mockItems);

      const result = await service.findAll({});

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('반창고');
    });

    it('should filter by category', async () => {
      const mockItems = [
        { id: 'item-1', code: 'ITEM001', name: '반창고', category: '의료소모품', currentStock: 100, safetyStock: 20 },
      ];

      mockPrisma.inventoryItem.findMany.mockResolvedValue(mockItems);

      const result = await service.findAll({ category: '의료소모품' });

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('의료소모품');
    });

    it('should filter by low stock', async () => {
      const mockItems = [
        { id: 'item-1', code: 'ITEM001', name: '반창고', category: '의료소모품', currentStock: 10, safetyStock: 20 },
        { id: 'item-2', code: 'ITEM002', name: '주사기', category: '의료소모품', currentStock: 500, safetyStock: 100 },
      ];

      mockPrisma.inventoryItem.findMany.mockResolvedValue(mockItems);

      const result = await service.findAll({ lowStock: true });

      expect(result).toHaveLength(1);
      expect(result[0].currentStock <= result[0].safetyStock).toBe(true);
    });
  });

  describe('findById', () => {
    it('should return item with suppliers and lots', async () => {
      const mockItem = {
        id: 'item-1',
        code: 'ITEM001',
        name: '반창고',
        category: '의료소모품',
        currentStock: 100,
        safetyStock: 20,
        defaultStorage: { id: 'stor-1', name: '약품고' },
        itemSuppliers: [],
        lots: [],
        transactions: [],
      };

      mockPrisma.inventoryItem.findUnique.mockResolvedValue(mockItem);

      const result = await service.findById('item-1');

      expect(result.id).toBe('item-1');
      expect(result.name).toBe('반창고');
    });

    it('should throw NotFoundException if item not found', async () => {
      mockPrisma.inventoryItem.findUnique.mockResolvedValue(null);

      await expect(service.findById('item-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createItem', () => {
    it('should create item with all fields', async () => {
      const dto = {
        code: 'ITEM001',
        name: '반창고',
        category: '의료소모품',
        unit: '개',
        safetyStock: '20',
        maxStock: '500',
        unitPrice: '500',
      };

      const mockItem = {
        id: 'item-1',
        ...dto,
        safetyStock: 20,
        maxStock: 500,
        unitPrice: 500,
      };

      mockPrisma.inventoryItem.create.mockResolvedValue(mockItem);

      const result = await service.createItem(dto as any);

      expect(result.id).toBe('item-1');
      expect(result.code).toBe('ITEM001');
    });

    it('should use defaults for optional numeric fields', async () => {
      const dto = {
        code: 'ITEM002',
        name: '주사기',
        category: '의료소모품',
        unit: '개',
      };

      mockPrisma.inventoryItem.create.mockResolvedValue({
        id: 'item-2',
        ...dto,
        safetyStock: 10,
      });

      const result = await service.createItem(dto as any);

      expect(result.id).toBe('item-2');
    });
  });

  describe('updateItem', () => {
    it('should update item name', async () => {
      const dto = { name: '수정된 반창고' };

      const mockUpdated = { id: 'item-1', name: '수정된 반창고' };
      mockPrisma.inventoryItem.update.mockResolvedValue(mockUpdated);

      const result = await service.updateItem('item-1', dto);

      expect(result.name).toBe('수정된 반창고');
    });

    it('should update numeric fields', async () => {
      const dto = { safetyStock: '50', maxStock: '1000' };

      const mockUpdated = { id: 'item-1', safetyStock: 50, maxStock: 1000 };
      mockPrisma.inventoryItem.update.mockResolvedValue(mockUpdated);

      const result = await service.updateItem('item-1', dto as any);

      expect(result.safetyStock).toBe(50);
    });
  });

  describe('transact', () => {
    it('should record IN transaction and update stock', async () => {
      mockPrisma.inventoryItem.findUnique.mockResolvedValue({
        id: 'item-1',
        currentStock: 100,
      });

      const mockTx = {
        inventoryItem: {
          update: vi.fn().mockResolvedValue({}),
        },
        inventoryTransaction: {
          create: vi.fn().mockResolvedValue({
            id: 'tx-1',
            itemId: 'item-1',
            type: 'IN',
            quantity: 50,
          }),
        },
      };

      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        const result = await cb(mockTx);
        return result;
      });

      const result = await service.transact('item-1', 'IN', 50, 'user-1', '입고');

      expect(result.type).toBe('IN');
      expect(result.quantity).toBe(50);
    });

    it('should record OUT transaction and decrease stock', async () => {
      mockPrisma.inventoryItem.findUnique.mockResolvedValue({
        id: 'item-1',
        currentStock: 100,
      });

      const mockTx = {
        inventoryItem: {
          update: vi.fn().mockResolvedValue({}),
        },
        inventoryLot: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn(),
          update: vi.fn(),
          count: vi.fn().mockResolvedValue(0),
        },
        inventoryTransaction: {
          create: vi.fn().mockResolvedValue({
            id: 'tx-1',
            itemId: 'item-1',
            type: 'OUT',
            quantity: 30,
          }),
        },
      };

      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        const result = await cb(mockTx);
        return result;
      });

      const result = await service.transact('item-1', 'OUT', 30, 'user-1', '출고');

      expect(result.type).toBe('OUT');
      expect(result.quantity).toBe(30);
    });

    it('should throw BadRequestException if stock insufficient', async () => {
      mockPrisma.inventoryItem.findUnique.mockResolvedValue({
        id: 'item-1',
        currentStock: 10,
      });

      await expect(service.transact('item-1', 'OUT', 50, 'user-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw NotFoundException if item not found', async () => {
      mockPrisma.inventoryItem.findUnique.mockResolvedValue(null);

      await expect(service.transact('item-1', 'IN', 50, 'user-1')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('getTransactions', () => {
    it('should return transactions for all items', async () => {
      const mockTransactions = [
        { id: 'tx-1', itemId: 'item-1', type: 'IN', quantity: 50, createdAt: new Date() },
        { id: 'tx-2', itemId: 'item-2', type: 'OUT', quantity: 10, createdAt: new Date() },
      ];

      mockPrisma.inventoryTransaction.findMany.mockResolvedValue(mockTransactions);

      const result = await service.getTransactions();

      expect(result).toHaveLength(2);
      expect(mockPrisma.inventoryTransaction.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: expect.anything(),
      });
    });

    it('should filter by itemId', async () => {
      const mockTransactions = [
        { id: 'tx-1', itemId: 'item-1', type: 'IN', quantity: 50 },
      ];

      mockPrisma.inventoryTransaction.findMany.mockResolvedValue(mockTransactions);

      const result = await service.getTransactions('item-1');

      expect(result).toHaveLength(1);
    });
  });

  describe('getStorages', () => {
    it('should return all active storages', async () => {
      const mockStorages = [
        { id: 'stor-1', code: 'STOR-01', name: '약품고', type: 'PHARMACY', children: [], _count: { lots: 5 } },
        { id: 'stor-2', code: 'STOR-02', name: '의료소모품', type: 'GENERAL', children: [], _count: { lots: 10 } },
      ];

      mockPrisma.inventoryStorage.findMany.mockResolvedValue(mockStorages);

      const result = await service.getStorages();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('약품고');
    });
  });

  describe('createStorage', () => {
    it('should create storage location', async () => {
      const dto = {
        code: 'STOR-01',
        name: '약품고',
        type: 'PHARMACY',
        location: '3층',
        temperature: '25°C',
      };

      const mockStorage = { id: 'stor-1', ...dto };
      mockPrisma.inventoryStorage.create.mockResolvedValue(mockStorage);

      const result = await service.createStorage(dto);

      expect(result.id).toBe('stor-1');
      expect(result.name).toBe('약품고');
    });
  });

  describe('updateStorage', () => {
    it('should update storage location name', async () => {
      const dto = { name: '수정된 약품고' };

      const mockUpdated = { id: 'stor-1', name: '수정된 약품고' };
      mockPrisma.inventoryStorage.update.mockResolvedValue(mockUpdated);

      const result = await service.updateStorage('stor-1', dto);

      expect(result.name).toBe('수정된 약품고');
    });
  });

  describe('deleteStorage', () => {
    it('should soft-delete storage location', async () => {
      const mockUpdated = { id: 'stor-1', isActive: false };
      mockPrisma.inventoryStorage.update.mockResolvedValue(mockUpdated);

      const result = await service.deleteStorage('stor-1');

      expect(mockPrisma.inventoryStorage.update).toHaveBeenCalledWith({
        where: { id: 'stor-1' },
        data: { isActive: false },
      });
    });
  });

  describe('issueRequest — LOT 안전게이트(FEFO·만료/리콜)', () => {
    const approvedReq = {
      id: 'req-1', status: 'APPROVED', department: 'ICU', requestNumber: 'REQ-001',
      items: [{ id: 'ri-1', itemId: 'item-1', requestedQty: 10, approvedQty: 10 }],
    };

    beforeEach(() => {
      mockPrisma.inventoryRequest = {
        findUnique: vi.fn().mockResolvedValue(approvedReq),
        update: vi.fn().mockResolvedValue({ ...approvedReq, status: 'ISSUED' }),
      };
      mockPrisma.inventoryRequestItem = { update: vi.fn() };
      mockPrisma.inventoryItem.findUnique.mockResolvedValue({ currentStock: 100, name: '수액세트' });
      mockPrisma.inventoryItem.update.mockResolvedValue({});
      mockPrisma.inventoryLot.update.mockResolvedValue({});
    });

    it('should consume lots FEFO and record lotId in transactions', async () => {
      mockPrisma.inventoryLot.findMany.mockResolvedValue([
        { id: 'lot-1', lotNumber: 'L1', quantity: 4, expiryDate: new Date(Date.now() + 86400000) },
        { id: 'lot-2', lotNumber: 'L2', quantity: 20, expiryDate: new Date(Date.now() + 30 * 86400000) },
      ]);

      await service.issueRequest('req-1', 'u-1');

      // lot-1 전량(4) + lot-2 잔여(6)
      expect(mockPrisma.inventoryLot.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lot-1' }, data: expect.objectContaining({ quantity: { decrement: 4 }, status: 'CONSUMED' }) }),
      );
      expect(mockPrisma.inventoryLot.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lot-2' }, data: expect.objectContaining({ quantity: { decrement: 6 } }) }),
      );
      expect(mockPrisma.inventoryTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lotId: 'lot-1', quantity: 4 }) }),
      );
    });

    it('should never consume expired lots and mark them EXPIRED', async () => {
      mockPrisma.inventoryLot.findMany.mockResolvedValue([
        { id: 'lot-exp', lotNumber: 'LX', quantity: 50, expiryDate: new Date(Date.now() - 86400000) },
        { id: 'lot-ok', lotNumber: 'LO', quantity: 20, expiryDate: new Date(Date.now() + 86400000) },
      ]);

      await service.issueRequest('req-1', 'u-1');

      expect(mockPrisma.inventoryLot.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lot-exp' }, data: { status: 'EXPIRED' } }),
      );
      // 만료 LOT은 차감 호출에 등장하지 않음
      const decrements = mockPrisma.inventoryLot.update.mock.calls.filter((c: any[]) => c[0]?.data?.quantity?.decrement);
      expect(decrements.every((c: any[]) => c[0].where.id !== 'lot-exp')).toBe(true);
    });

    it('should BLOCK issuance when only expired lots remain and gate=BLOCK', async () => {
      mockConfig.get.mockImplementation(async (k: string) => (k === 'inventory.expiryIssueEnforce' ? 'BLOCK' : undefined));
      mockPrisma.inventoryLot.findMany.mockResolvedValue([
        { id: 'lot-exp', lotNumber: 'LX', quantity: 50, expiryDate: new Date(Date.now() - 86400000) },
      ]);
      mockPrisma.inventoryLot.count.mockResolvedValue(1);

      await expect(service.issueRequest('req-1', 'u-1')).rejects.toThrow(BadRequestException);
    });

    it('should BLOCK also when remaining lots are already marked EXPIRED/RECALLED (fail-open 방지)', async () => {
      mockConfig.get.mockImplementation(async (k: string) => (k === 'inventory.expiryIssueEnforce' ? 'BLOCK' : undefined));
      mockPrisma.inventoryLot.findMany.mockResolvedValue([]); // ACTIVE LOT 없음
      mockPrisma.inventoryLot.count.mockResolvedValue(2); // 마킹된 EXPIRED/RECALLED 잔량 존재

      await expect(service.issueRequest('req-1', 'u-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('transact — 폐기(DISPOSAL) 예외', () => {
    it('should allow DISPOSAL of an expired lot (정리 경로) and decrement it', async () => {
      mockPrisma.inventoryItem.findUnique.mockResolvedValue({ id: 'item-1', code: 'C1', name: '수액세트', currentStock: 50, erpItemCode: null });
      mockPrisma.inventoryLot.findUnique.mockResolvedValue({
        id: 'lot-exp', status: 'EXPIRED', expiryDate: new Date(Date.now() - 86400000), quantity: 10, lotNumber: 'LX',
      });
      mockPrisma.inventoryItem.update.mockResolvedValue({});
      mockPrisma.inventoryLot.update.mockResolvedValue({});
      mockPrisma.inventoryTransaction.create.mockResolvedValue({ id: 'tx-1', type: 'DISPOSAL' });

      const result = await service.transact('item-1', 'DISPOSAL' as any, 10, 'u-1', '만료 폐기', { lotId: 'lot-exp' });

      expect(result.type).toBe('DISPOSAL');
      expect(mockPrisma.inventoryLot.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lot-exp' }, data: expect.objectContaining({ quantity: { decrement: 10 } }) }),
      );
    });

    it('should still block normal OUT of an expired lot', async () => {
      mockPrisma.inventoryItem.findUnique.mockResolvedValue({ id: 'item-1', code: 'C1', name: '수액세트', currentStock: 50, erpItemCode: null });
      mockPrisma.inventoryLot.findUnique.mockResolvedValue({
        id: 'lot-exp', status: 'EXPIRED', expiryDate: new Date(Date.now() - 86400000), quantity: 10, lotNumber: 'LX',
      });

      await expect(
        service.transact('item-1', 'OUT' as any, 5, 'u-1', '출고', { lotId: 'lot-exp' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
