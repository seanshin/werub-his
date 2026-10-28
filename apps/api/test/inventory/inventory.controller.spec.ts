import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InventoryController } from '../../src/modules/inventory/inventory.controller';
import { InventoryService } from '../../src/modules/inventory/inventory.service';

describe('InventoryController', () => {
  let controller: InventoryController;
  let service: InventoryService;

  beforeEach(() => {
    service = {
      findAll: vi.fn(),
      findById: vi.fn(),
      createItem: vi.fn(),
      updateItem: vi.fn(),
      transact: vi.fn(),
      getTransactions: vi.fn(),
      getLowStockAlerts: vi.fn(),
      getStorages: vi.fn(),
      createStorage: vi.fn(),
      updateStorage: vi.fn(),
      deleteStorage: vi.fn(),
      getSuppliers: vi.fn(),
    } as any;

    controller = new InventoryController(service);
  });

  describe('findAll', () => {
    it('should return paginated items', async () => {
      const mockItems = Array(100).fill(null).map((_, i) => ({
        id: `item-${i}`,
        code: `ITEM${i.toString().padStart(3, '0')}`,
        name: `Item ${i}`,
        currentStock: 100,
        safetyStock: 20,
      }));

      vi.mocked(service.findAll).mockResolvedValue(mockItems);

      const result = await controller.findAll();

      expect(result.data).toHaveLength(50); // Default limit
      expect(result.meta.total).toBe(100);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(50);
    });

    it('should apply pagination', async () => {
      const mockItems = Array(100).fill(null).map((_, i) => ({
        id: `item-${i}`,
        code: `ITEM${i}`,
        name: `Item ${i}`,
      }));

      vi.mocked(service.findAll).mockResolvedValue(mockItems);

      const result = await controller.findAll(undefined, undefined, '2', '25');

      expect(result.data).toHaveLength(25);
      expect(result.meta.page).toBe(2);
      expect(result.meta.limit).toBe(25);
    });

    it('should filter by category', async () => {
      const mockItems = [
        { id: 'item-1', category: '의료소모품', currentStock: 100, safetyStock: 20 },
      ];

      vi.mocked(service.findAll).mockResolvedValue(mockItems);

      const result = await controller.findAll('의료소모품');

      expect(result.data).toHaveLength(1);
      expect(service.findAll).toHaveBeenCalledWith({ category: '의료소모품', lowStock: false });
    });

    it('should filter by low stock', async () => {
      const mockItems = [
        { id: 'item-1', currentStock: 10, safetyStock: 20 },
      ];

      vi.mocked(service.findAll).mockResolvedValue(mockItems);

      const result = await controller.findAll(undefined, 'true');

      expect(result.data).toHaveLength(1);
      expect(service.findAll).toHaveBeenCalledWith({ lowStock: true });
    });
  });

  describe('create', () => {
    it('should create item', async () => {
      const dto = {
        code: 'ITEM001',
        name: '반창고',
        category: '의료소모품',
        unit: '개',
        safetyStock: '20',
      };

      const mockItem = { id: 'item-1', ...dto };
      vi.mocked(service.createItem).mockResolvedValue(mockItem);

      const result = await controller.create(dto as any);

      expect(result.data.id).toBe('item-1');
      expect(service.createItem).toHaveBeenCalledWith(dto);
    });
  });

  describe('getItem', () => {
    it('should return item detail', async () => {
      const mockItem = {
        id: 'item-1',
        code: 'ITEM001',
        name: '반창고',
        currentStock: 100,
        safetyStock: 20,
        itemSuppliers: [],
        lots: [],
        transactions: [],
      };

      vi.mocked(service.findById).mockResolvedValue(mockItem);

      const result = await controller.getItem('item-1');

      expect(result.data.id).toBe('item-1');
      expect(service.findById).toHaveBeenCalledWith('item-1');
    });
  });

  describe('updateItem', () => {
    it('should update item', async () => {
      const dto = { name: '수정된 반창고' };

      const mockUpdated = { id: 'item-1', name: '수정된 반창고' };
      vi.mocked(service.updateItem).mockResolvedValue(mockUpdated);

      const result = await controller.updateItem('item-1', dto);

      expect(result.data.name).toBe('수정된 반창고');
      expect(service.updateItem).toHaveBeenCalledWith('item-1', dto);
    });
  });

  describe('getTransactions', () => {
    it('should return transactions', async () => {
      const mockTransactions = [
        { id: 'tx-1', itemId: 'item-1', type: 'IN', quantity: 50 },
        { id: 'tx-2', itemId: 'item-1', type: 'OUT', quantity: 10 },
      ];

      vi.mocked(service.getTransactions).mockResolvedValue(mockTransactions);

      const result = await controller.getTransactions();

      expect(result.data).toHaveLength(2);
      expect(result.meta.page).toBe(1);
    });

    it('should filter by itemId', async () => {
      const mockTransactions = [
        { id: 'tx-1', itemId: 'item-1', type: 'IN', quantity: 50 },
      ];

      vi.mocked(service.getTransactions).mockResolvedValue(mockTransactions);

      const result = await controller.getTransactions('item-1');

      expect(result.data).toHaveLength(1);
      expect(service.getTransactions).toHaveBeenCalledWith('item-1', 100);
    });
  });

  describe('transact', () => {
    it('should record IN transaction', async () => {
      const body = { type: 'IN', quantity: '50', reason: '입고' };

      const mockTx = {
        id: 'tx-1',
        itemId: 'item-1',
        type: 'IN',
        quantity: 50,
      };

      vi.mocked(service.transact).mockResolvedValue(mockTx);

      const result = await controller.transact('item-1', body as any, 'user-1');

      expect(result.data.type).toBe('IN');
      expect(service.transact).toHaveBeenCalledWith('item-1', 'IN', 50, 'user-1', '입고', expect.anything());
    });

    it('should record OUT transaction', async () => {
      const body = { type: 'OUT', quantity: '30', reason: '출고', department: '수술실' };

      const mockTx = {
        id: 'tx-2',
        itemId: 'item-1',
        type: 'OUT',
        quantity: 30,
      };

      vi.mocked(service.transact).mockResolvedValue(mockTx);

      const result = await controller.transact('item-1', body as any, 'user-1');

      expect(result.data.type).toBe('OUT');
      expect(result.data.quantity).toBe(30);
    });
  });

  describe('getItemTransactions', () => {
    it('should return item transactions', async () => {
      const mockTransactions = [
        { id: 'tx-1', itemId: 'item-1', type: 'IN', quantity: 50 },
        { id: 'tx-2', itemId: 'item-1', type: 'OUT', quantity: 10 },
      ];

      vi.mocked(service.getTransactions).mockResolvedValue(mockTransactions);

      const result = await controller.getItemTransactions('item-1');

      expect(result.data).toHaveLength(2);
      expect(service.getTransactions).toHaveBeenCalledWith('item-1');
    });
  });

  describe('getAlerts', () => {
    it('should return low stock alerts', async () => {
      const mockAlerts = [
        { id: 'item-1', code: 'ITEM001', name: '반창고', currentStock: 5, safetyStock: 20 },
        { id: 'item-2', code: 'ITEM002', name: '주사기', currentStock: 50, safetyStock: 100 },
      ];

      vi.mocked(service.getLowStockAlerts).mockResolvedValue(mockAlerts as any);

      const result = await controller.getAlerts();

      expect(result.data).toHaveLength(2);
      expect(service.getLowStockAlerts).toHaveBeenCalled();
    });
  });
});
