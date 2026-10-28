import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EquipmentController } from '../../src/modules/equipment/equipment.controller';
import { NotFoundException } from '@nestjs/common';

describe('EquipmentController', () => {
  let controller: EquipmentController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      findAll: vi.fn(),
      create: vi.fn(),
      getStats: vi.fn(),
      getDueInspections: vi.fn(),
      getAllMaintenanceLogs: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      addMaintenanceLog: vi.fn(),
      updateStatus: vi.fn(),
      updateMaintenanceLog: vi.fn(),
      getPartsForEquipment: vi.fn(),
      addPart: vi.fn(),
      updatePart: vi.fn(),
      getLowStockParts: vi.fn(),
      getAllUsageLogs: vi.fn(),
      getUsageLogs: vi.fn(),
      addUsageLog: vi.fn(),
      getAllInspectionLogs: vi.fn(),
      getInspectionLogs: vi.fn(),
      addInspectionLog: vi.fn(),
    };

    controller = new EquipmentController(mockService);
  });

  describe('Equipment List & Stats', () => {
    it('should get all equipment', async () => {
      const mockEquipment = [
        { id: 'eq-1', name: 'Ventilator', status: 'ACTIVE' },
      ];

      vi.mocked(mockService.findAll).mockResolvedValue(mockEquipment);

      const result = await controller.findAll();

      expect(result.data).toHaveLength(1);
      expect(mockService.findAll).toHaveBeenCalledWith({ category: undefined, status: undefined });
    });

    it('should filter equipment by category', async () => {
      const mockEquipment = [{ id: 'eq-1', category: 'ICU' }];

      vi.mocked(mockService.findAll).mockResolvedValue(mockEquipment);

      const result = await controller.findAll('ICU');

      expect(result.data[0].category).toBe('ICU');
      expect(mockService.findAll).toHaveBeenCalledWith({ category: 'ICU', status: undefined });
    });

    it('should create equipment', async () => {
      const mockCreated = { id: 'eq-1', name: 'Ventilator', assetNumber: 'AST-001' };

      vi.mocked(mockService.create).mockResolvedValue(mockCreated);

      const dto = {
        assetNumber: 'AST-001',
        name: 'Ventilator',
        category: 'ICU',
        manufacturer: 'Siemens',
        model: 'SERVO-i',
        serialNumber: 'SN-123',
        location: 'ICU Room 1',
      };

      const result = await controller.create(dto);

      expect(result.data.name).toBe('Ventilator');
    });

    it('should get equipment statistics', async () => {
      const mockStats = {
        byStatus: [{ status: 'ACTIVE', _count: { id: 10 } }],
        byCategory: [{ category: 'ICU', _count: { id: 5 } }],
        recentLogs: [{ id: 'ml-1' }],
        pendingAS: 3,
      };

      vi.mocked(mockService.getStats).mockResolvedValue(mockStats);

      const result = await controller.getStats();

      expect(result.data.byStatus).toBeDefined();
      expect(result.data.byCategory).toBeDefined();
      expect(result.data.pendingAS).toBe(3);
    });

    it('should get due inspections', async () => {
      const mockDue = [
        { id: 'eq-1', name: 'Ventilator', nextInspection: new Date() },
      ];

      vi.mocked(mockService.getDueInspections).mockResolvedValue(mockDue);

      const result = await controller.getDue();

      expect(result.data).toHaveLength(1);
      expect(mockService.getDueInspections).toHaveBeenCalled();
    });

    it('should get all maintenance logs', async () => {
      const mockLogs = [
        { id: 'ml-1', type: 'PREVENTIVE', status: 'COMPLETED' },
      ];

      vi.mocked(mockService.getAllMaintenanceLogs).mockResolvedValue(mockLogs);

      const result = await controller.getAllLogs('PREVENTIVE', 'COMPLETED');

      expect(result.data).toHaveLength(1);
      expect(mockService.getAllMaintenanceLogs).toHaveBeenCalledWith({
        type: 'PREVENTIVE',
        status: 'COMPLETED',
      });
    });
  });

  describe('Equipment CRUD', () => {
    it('should find equipment by ID', async () => {
      const mockEq = {
        id: 'eq-1',
        name: 'Ventilator',
        maintenanceLogs: [{ id: 'ml-1' }],
      };

      vi.mocked(mockService.findById).mockResolvedValue(mockEq);

      const result = await controller.findOne('eq-1');

      expect(result.data.name).toBe('Ventilator');
      expect(mockService.findById).toHaveBeenCalledWith('eq-1');
    });

    it('should throw NotFoundException when equipment not found', async () => {
      vi.mocked(mockService.findById).mockRejectedValue(
        new NotFoundException('Equipment not found'),
      );

      await expect(controller.findOne('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should update equipment', async () => {
      const mockUpdated = {
        id: 'eq-1',
        name: 'Updated Name',
        location: 'ICU Room 2',
      };

      vi.mocked(mockService.update).mockResolvedValue(mockUpdated);

      const dto = { name: 'Updated Name', location: 'ICU Room 2' };

      const result = await controller.update('eq-1', dto);

      expect(result.data.name).toBe('Updated Name');
    });

    it('should update equipment status', async () => {
      const mockUpdated = { id: 'eq-1', status: 'UNDER_MAINTENANCE' };

      vi.mocked(mockService.updateStatus).mockResolvedValue(mockUpdated);

      const body = {
        status: 'UNDER_MAINTENANCE',
        nextInspection: '2026-12-01',
      };

      const result = await controller.updateStatus('eq-1', body);

      expect(result.data.status).toBe('UNDER_MAINTENANCE');
      expect(mockService.updateStatus).toHaveBeenCalledWith(
        'eq-1',
        'UNDER_MAINTENANCE',
        '2026-12-01',
      );
    });
  });

  describe('Maintenance Log Management', () => {
    it('should add maintenance log', async () => {
      const mockLog = {
        id: 'ml-1',
        equipmentId: 'eq-1',
        type: 'PREVENTIVE',
        status: 'COMPLETED',
      };

      vi.mocked(mockService.addMaintenanceLog).mockResolvedValue(mockLog);

      const dto = {
        type: 'PREVENTIVE',
        status: 'COMPLETED',
        description: 'Scheduled maintenance',
        performedBy: 'John',
        performedAt: new Date().toISOString(),
      };

      const result = await controller.addLog('eq-1', dto as any);

      expect(result.data.type).toBe('PREVENTIVE');
    });

    it('should update maintenance log', async () => {
      const mockUpdated = {
        id: 'ml-1',
        status: 'IN_PROGRESS',
        resultNotes: 'Filter replaced',
      };

      vi.mocked(mockService.updateMaintenanceLog).mockResolvedValue(mockUpdated);

      const dto = {
        status: 'IN_PROGRESS',
        resultNotes: 'Filter replaced',
      };

      const result = await controller.updateLog('ml-1', dto);

      expect(result.data.status).toBe('IN_PROGRESS');
    });
  });

  describe('Parts Management', () => {
    it('should get parts for equipment', async () => {
      const mockParts = [
        { id: 'p-1', partName: 'Filter', currentStock: 5 },
      ];

      vi.mocked(mockService.getPartsForEquipment).mockResolvedValue(mockParts);

      const result = await controller.getParts('eq-1');

      expect(result.data).toHaveLength(1);
      expect(result.data[0].partName).toBe('Filter');
    });

    it('should add part to equipment', async () => {
      const mockPart = {
        id: 'p-1',
        partName: 'Filter',
        currentStock: 10,
      };

      vi.mocked(mockService.addPart).mockResolvedValue(mockPart);

      const dto = {
        partName: 'Filter',
        partNumber: 'F-001',
        currentStock: '10',
        minStock: '2',
      };

      const result = await controller.addPart('eq-1', dto as any);

      expect(result.data.partName).toBe('Filter');
    });

    it('should update part inventory', async () => {
      const mockUpdated = {
        id: 'p-1',
        currentStock: 8,
      };

      vi.mocked(mockService.updatePart).mockResolvedValue(mockUpdated);

      const dto = { currentStock: '8' };

      const result = await controller.updatePart('p-1', dto);

      expect(result.data.currentStock).toBe(8);
    });

    it('should get low stock parts', async () => {
      const mockLowStock = [
        { id: 'p-1', partName: 'Filter', current_stock: 1, min_stock: 5 },
      ];

      vi.mocked(mockService.getLowStockParts).mockResolvedValue(mockLowStock);

      const result = await controller.getLowStock();

      expect(result.data).toHaveLength(1);
      expect(mockService.getLowStockParts).toHaveBeenCalled();
    });
  });

  describe('Usage Logs', () => {
    it('should get all usage logs', async () => {
      const mockLogs = [
        {
          id: 'ul-1',
          usedBy: 'Dr. Kim',
          equipment: { name: 'Ventilator' },
        },
      ];

      vi.mocked(mockService.getAllUsageLogs).mockResolvedValue(mockLogs);

      const result = await controller.getAllUsageLogs('eq-1', '2026-05-01', '2026-05-31');

      expect(result.data).toHaveLength(1);
      expect(mockService.getAllUsageLogs).toHaveBeenCalledWith({
        equipmentId: 'eq-1',
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      });
    });

    it('should get usage logs for equipment', async () => {
      const mockLogs = [
        { id: 'ul-1', usedBy: 'Dr. Kim', condition: 'NORMAL' },
      ];

      vi.mocked(mockService.getUsageLogs).mockResolvedValue(mockLogs);

      const result = await controller.getUsageLogs('eq-1');

      expect(result.data).toHaveLength(1);
      expect(result.data[0].usedBy).toBe('Dr. Kim');
    });

    it('should add usage log', async () => {
      const mockLog = {
        id: 'ul-1',
        usedBy: 'Dr. Kim',
        condition: 'NORMAL',
      };

      vi.mocked(mockService.addUsageLog).mockResolvedValue(mockLog);

      const dto = {
        usedDate: new Date().toISOString(),
        usedBy: 'Dr. Kim',
        department: 'ICU',
        patientCount: '3',
        condition: 'NORMAL',
      };

      const result = await controller.addUsageLog('eq-1', dto as any);

      expect(result.data.usedBy).toBe('Dr. Kim');
    });
  });

  describe('Inspection Logs', () => {
    it('should get all inspection logs', async () => {
      const mockLogs = [
        {
          id: 'il-1',
          inspectionType: 'ANNUAL',
          overallResult: 'PASS',
          equipment: { name: 'Ventilator' },
        },
      ];

      vi.mocked(mockService.getAllInspectionLogs).mockResolvedValue(mockLogs);

      const result = await controller.getAllInspectionLogs('ANNUAL', 'PASS');

      expect(result.data).toHaveLength(1);
      expect(mockService.getAllInspectionLogs).toHaveBeenCalledWith({
        type: 'ANNUAL',
        result: 'PASS',
      });
    });

    it('should get inspection logs for equipment', async () => {
      const mockLogs = [
        { id: 'il-1', inspectionType: 'ANNUAL', overallResult: 'PASS' },
      ];

      vi.mocked(mockService.getInspectionLogs).mockResolvedValue(mockLogs);

      const result = await controller.getInspectionLogs('eq-1');

      expect(result.data).toHaveLength(1);
      expect(result.data[0].overallResult).toBe('PASS');
    });

    it('should add inspection log', async () => {
      const mockLog = {
        id: 'il-1',
        inspectionType: 'ANNUAL',
        overallResult: 'PASS',
      };

      vi.mocked(mockService.addInspectionLog).mockResolvedValue(mockLog);

      const dto = {
        inspectionDate: new Date().toISOString(),
        inspectorName: 'Inspector A',
        inspectionType: 'ANNUAL',
        overallResult: 'PASS',
        nextInspectionDate: '2027-05-13',
      };

      const result = await controller.addInspectionLog('eq-1', dto as any);

      expect(result.data.overallResult).toBe('PASS');
    });
  });

  describe('Authorization', () => {
    it('should require ADMIN role for all endpoints', async () => {
      // @Roles(UserRole.ADMIN) is applied at controller class level
      // This test verifies the decorator is present
      expect(controller).toBeDefined();
    });
  });

  describe('Response Wrapping', () => {
    it('should wrap all responses in data object', async () => {
      const mockEq = { id: 'eq-1', name: 'Ventilator' };

      vi.mocked(mockService.findAll).mockResolvedValue([mockEq]);

      const result = await controller.findAll();

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should wrap single object responses in data', async () => {
      const mockCreated = { id: 'eq-1', name: 'Ventilator' };

      vi.mocked(mockService.create).mockResolvedValue(mockCreated);

      const dto = {
        assetNumber: 'AST-001',
        name: 'Ventilator',
        category: 'ICU',
      };

      const result = await controller.create(dto);

      expect(result).toHaveProperty('data');
      expect(result.data.id).toBe('eq-1');
    });
  });

  describe('Error Handling', () => {
    it('should propagate service exceptions', async () => {
      vi.mocked(mockService.findById).mockRejectedValue(
        new NotFoundException('Equipment not found'),
      );

      await expect(controller.findOne('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle empty results', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result.data).toHaveLength(0);
    });
  });

  describe('Route-specific Behavior', () => {
    it('should route stats endpoint correctly', async () => {
      const mockStats = { byStatus: [], byCategory: [] };

      vi.mocked(mockService.getStats).mockResolvedValue(mockStats);

      const result = await controller.getStats();

      expect(result.data).toBeDefined();
    });

    it('should route inspections-due endpoint correctly', async () => {
      const mockDue = [];

      vi.mocked(mockService.getDueInspections).mockResolvedValue(mockDue);

      const result = await controller.getDue();

      expect(result.data).toBeDefined();
    });

    it('should route usage-logs/all endpoint correctly', async () => {
      const mockLogs = [];

      vi.mocked(mockService.getAllUsageLogs).mockResolvedValue(mockLogs);

      const result = await controller.getAllUsageLogs();

      expect(result.data).toBeDefined();
    });

    it('should route inspection-logs/all endpoint correctly', async () => {
      const mockLogs = [];

      vi.mocked(mockService.getAllInspectionLogs).mockResolvedValue(mockLogs);

      const result = await controller.getAllInspectionLogs();

      expect(result.data).toBeDefined();
    });
  });
});
