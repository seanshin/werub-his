import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EquipmentService } from '../../src/modules/equipment/equipment.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('EquipmentService', () => {
  let service: EquipmentService;
  let mockPrisma: any;
  let mockOutbox: any;
  let mockConfig: any;

  beforeEach(() => {
    mockPrisma = {
      equipment: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findUnique: vi.fn(),
        groupBy: vi.fn(),
        count: vi.fn(),
      },
      maintenanceLog: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      equipmentPart: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      gateViolationLog: { create: vi.fn().mockResolvedValue({}) }, // 관제 위반 영속(best-effort)
      equipmentUsageLog: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      equipmentInspectionLog: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      $queryRaw: vi.fn(),
    };

    // 🔴 (H4) 점검 기록과 장비 상태 전환이 한 트랜잭션이 됐다 — 목은 정본의 실제 호출 모양을 쓴다
    mockPrisma.$transaction = vi.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
    );

    mockOutbox = { enqueue: vi.fn().mockResolvedValue(undefined) };

    mockConfig = { get: vi.fn().mockResolvedValue(undefined) };
    service = new EquipmentService(mockPrisma, mockOutbox, mockConfig);
  });

  describe('findAll', () => {
    it('should return all equipment with no filters', async () => {
      const mockEquipment = [
        { id: 'eq-1', name: 'Ventilator', category: 'ICU', status: 'ACTIVE' },
        { id: 'eq-2', name: 'Monitor', category: 'General', status: 'ACTIVE' },
      ];

      vi.mocked(mockPrisma.equipment.findMany).mockResolvedValue(mockEquipment);

      const result = await service.findAll({});

      expect(result).toHaveLength(2);
      expect(mockPrisma.equipment.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { name: 'asc' },
        include: { maintenanceLogs: expect.any(Object) },
      });
    });

    it('should filter by category', async () => {
      const mockEquipment = [
        { id: 'eq-1', name: 'Ventilator', category: 'ICU', status: 'ACTIVE' },
      ];

      vi.mocked(mockPrisma.equipment.findMany).mockResolvedValue(mockEquipment);

      const result = await service.findAll({ category: 'ICU' });

      expect(result).toHaveLength(1);
      expect(mockPrisma.equipment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { category: 'ICU' },
        }),
      );
    });

    it('should filter by status', async () => {
      const mockEquipment = [
        { id: 'eq-1', name: 'Monitor', status: 'INACTIVE' },
      ];

      vi.mocked(mockPrisma.equipment.findMany).mockResolvedValue(mockEquipment);

      const result = await service.findAll({ status: 'RETIRED' });

      expect(result[0].status).toBe('INACTIVE');
    });

    it('should include latest maintenance log', async () => {
      const mockEquipment = [
        {
          id: 'eq-1',
          name: 'Ventilator',
          maintenanceLogs: [{ id: 'ml-1', performedAt: new Date() }],
        },
      ];

      vi.mocked(mockPrisma.equipment.findMany).mockResolvedValue(mockEquipment);

      const result = await service.findAll({});

      expect(result[0].maintenanceLogs).toBeDefined();
      expect(result[0].maintenanceLogs).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('should create equipment with required fields', async () => {
      const mockCreated = {
        id: 'eq-1',
        assetNumber: 'AST-001',
        name: 'Ventilator',
        category: 'ICU',
        manufacturer: 'Siemens',
        model: 'SERVO-i',
        serialNumber: 'SN-12345',
        location: 'ICU Room 1',
        purchaseDate: new Date('2025-01-01'),
        purchasePrice: 50000,
        warrantyExpiry: new Date('2027-01-01'),
        nextInspection: new Date('2026-06-01'),
      };

      vi.mocked(mockPrisma.equipment.create).mockResolvedValue(mockCreated);

      const dto = {
        assetNumber: 'AST-001',
        name: 'Ventilator',
        category: 'ICU',
        manufacturer: 'Siemens',
        model: 'SERVO-i',
        serialNumber: 'SN-12345',
        location: 'ICU Room 1',
        purchaseDate: '2025-01-01',
        purchasePrice: '50000',
        warrantyExpiry: '2027-01-01',
        nextInspection: '2026-06-01',
      };

      const result = await service.create(dto);

      expect(result.id).toBe('eq-1');
      expect(result.name).toBe('Ventilator');
    });

    it('should handle optional supplier contact fields', async () => {
      const mockCreated = {
        id: 'eq-1',
        supplierName: 'Medical Supplies Inc',
        supplierContact: 'contact@supplies.example',
        supplierPhone: '02-1234-5678',
      };

      vi.mocked(mockPrisma.equipment.create).mockResolvedValue(mockCreated);

      const dto = {
        assetNumber: 'AST-001',
        name: 'Monitor',
        category: 'General',
        supplierName: 'Medical Supplies Inc',
        supplierContact: 'contact@supplies.example',
        supplierPhone: '02-1234-5678',
      };

      const result = await service.create(dto);

      expect(result.supplierName).toBe('Medical Supplies Inc');
    });
  });

  describe('update', () => {
    it('should update equipment basic fields', async () => {
      const mockUpdated = {
        id: 'eq-1',
        name: 'Updated Ventilator',
        location: 'ICU Room 2',
      };

      vi.mocked(mockPrisma.equipment.update).mockResolvedValue(mockUpdated);

      const dto = { name: 'Updated Ventilator', location: 'ICU Room 2' };

      const result = await service.update('eq-1', dto);

      expect(result.name).toBe('Updated Ventilator');
      expect(mockPrisma.equipment.update).toHaveBeenCalled();
    });

    it('should update date fields correctly', async () => {
      const mockUpdated = {
        id: 'eq-1',
        warrantyExpiry: new Date('2027-12-31'),
        nextInspection: new Date('2026-12-31'),
      };

      vi.mocked(mockPrisma.equipment.update).mockResolvedValue(mockUpdated);

      const dto = {
        warrantyExpiry: '2027-12-31',
        nextInspection: '2026-12-31',
      };

      const result = await service.update('eq-1', dto);

      expect(result.warrantyExpiry).toEqual(new Date('2027-12-31'));
    });
  });

  describe('findById', () => {
    it('should return equipment with maintenance logs', async () => {
      const mockEquipment = {
        id: 'eq-1',
        name: 'Ventilator',
        maintenanceLogs: [{ id: 'ml-1' }, { id: 'ml-2' }],
        usageLogs: [],
      };

      vi.mocked(mockPrisma.equipment.findUnique).mockResolvedValue(mockEquipment);

      const result = await service.findById('eq-1');

      expect(result.id).toBe('eq-1');
      expect(result.maintenanceLogs).toHaveLength(2);
    });

    it('should throw NotFoundException when not found', async () => {
      vi.mocked(mockPrisma.equipment.findUnique).mockResolvedValue(null);

      await expect(service.findById('non-existent')).rejects.toThrow(
        NotFoundException,
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
        performedAt: new Date(),
      };

      vi.mocked(mockPrisma.maintenanceLog.create).mockResolvedValue(mockLog);

      const dto = {
        type: 'PREVENTIVE',
        status: 'COMPLETED',
        description: 'Scheduled maintenance',
        performedBy: 'John Doe',
        requestedBy: 'Manager',
        performedAt: new Date().toISOString(),
      };

      const result = await service.addMaintenanceLog('eq-1', dto as any);

      expect(result.type).toBe('PREVENTIVE');
      expect(mockPrisma.maintenanceLog.create).toHaveBeenCalled();
    });

    it('should update maintenance log', async () => {
      const mockUpdated = {
        id: 'ml-1',
        status: 'IN_PROGRESS',
        resultNotes: 'Filter replaced',
      };

      vi.mocked(mockPrisma.maintenanceLog.update).mockResolvedValue(mockUpdated);

      const dto = {
        status: 'IN_PROGRESS',
        resultNotes: 'Filter replaced',
      };

      const result = await service.updateMaintenanceLog('ml-1', dto);

      expect(result.status).toBe('IN_PROGRESS');
    });
  });

  describe('Equipment Status & Inspections', () => {
    it('should update equipment status', async () => {
      const mockUpdated = {
        id: 'eq-1',
        status: 'UNDER_MAINTENANCE',
        nextInspection: new Date('2026-12-01'),
      };

      vi.mocked(mockPrisma.equipment.update).mockResolvedValue(mockUpdated);

      const result = await service.updateStatus(
        'eq-1',
        'UNDER_MAINTENANCE',
        '2026-12-01',
      );

      expect(result.status).toBe('UNDER_MAINTENANCE');
    });

    it('should get equipment due for inspection', async () => {
      const mockEquipment = [
        {
          id: 'eq-1',
          name: 'Ventilator',
          nextInspection: new Date(),
        },
      ];

      vi.mocked(mockPrisma.equipment.findMany).mockResolvedValue(mockEquipment);

      const result = await service.getDueInspections();

      expect(result).toHaveLength(1);
      // 🔴 폐기만 제외한다 — 종전 `status:'ACTIVE'` 는 **정비중·고장 장비를 점검 대상에서
      //    빼버렸다**. 점검이 가장 밀린 쪽이 그쪽인데도.
      expect(mockPrisma.equipment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { not: 'RETIRED' } }),
        }),
      );
    });

    it('🔴 점검 기한 경과를 계산해 함께 실어 보낸다 — 상태 배지만으로는 알 수 없다', async () => {
      const yesterday = new Date(Date.now() - 3 * 86400000);
      vi.mocked(mockPrisma.equipment.findMany).mockResolvedValue([
        { id: 'eq-1', name: '제세동기', nextInspection: yesterday },
        { id: 'eq-2', name: '마취기', nextInspection: null },
      ] as never);

      const [overdue, unknown] = await service.getDueInspections();

      expect(overdue.inspectionOverdue).toBe(true);
      expect(overdue.inspectionDueInDays).toBeLessThan(0);
      // 점검일 미지정은 '경과'가 아니라 '모름'
      expect(unknown.inspectionOverdue).toBe(false);
      expect(unknown.inspectionDueInDays).toBeNull();
    });
  });

  describe('Statistics', () => {
    it('should get equipment statistics', async () => {
      const mockStats = {
        byStatus: [{ status: 'ACTIVE', _count: { id: 5 } }],
        byCategory: [{ category: 'ICU', _count: { id: 3 } }],
        recentLogs: [{ id: 'ml-1', equipment: { name: 'Ventilator' } }],
        pendingAS: 2,
      };

      vi.mocked(mockPrisma.equipment.groupBy)
        .mockResolvedValueOnce(mockStats.byStatus)
        .mockResolvedValueOnce(mockStats.byCategory);
      vi.mocked(mockPrisma.maintenanceLog.findMany).mockResolvedValue(
        mockStats.recentLogs,
      );
      vi.mocked(mockPrisma.maintenanceLog.count).mockResolvedValue(
        mockStats.pendingAS,
      );
      vi.mocked(mockPrisma.equipment.count)
        .mockResolvedValueOnce(10) // 점검 기한 경과
        .mockResolvedValueOnce(1); // 30일 내 점검

      const result = await service.getStats();

      expect(result.byStatus).toBeDefined();
      expect(result.byCategory).toBeDefined();
      expect(result.recentLogs).toHaveLength(1);
      expect(result.pendingAS).toBe(2);
      // 🔴 상태가 전부 ACTIVE 라도 점검은 밀려 있을 수 있다 — 화면에 없던 수치
      expect(result.inspectionOverdue).toBe(10);
      expect(result.inspectionDueSoon).toBe(1);
    });
  });

  describe('Parts Inventory', () => {
    it('should get parts for equipment', async () => {
      const mockParts = [
        { id: 'p-1', partName: 'Filter', partNumber: 'F-001', currentStock: 5 },
        { id: 'p-2', partName: 'Valve', partNumber: 'V-001', currentStock: 2 },
      ];

      vi.mocked(mockPrisma.equipmentPart.findMany).mockResolvedValue(mockParts);

      const result = await service.getPartsForEquipment('eq-1');

      expect(result).toHaveLength(2);
      expect(mockPrisma.equipmentPart.findMany).toHaveBeenCalledWith({
        where: { equipmentId: 'eq-1' },
        orderBy: { partName: 'asc' },
      });
    });

    it('should add part to equipment', async () => {
      const mockPart = {
        id: 'p-1',
        equipmentId: 'eq-1',
        partName: 'Filter',
        partNumber: 'F-001',
        currentStock: 10,
        minStock: 2,
      };

      vi.mocked(mockPrisma.equipmentPart.create).mockResolvedValue(mockPart);

      const dto = {
        partName: 'Filter',
        partNumber: 'F-001',
        currentStock: '10',
        minStock: '2',
      };

      const result = await service.addPart('eq-1', dto as any);

      expect(result.partName).toBe('Filter');
    });

    it('should update part inventory', async () => {
      const mockUpdated = {
        id: 'p-1',
        currentStock: 8,
        minStock: 2,
      };

      vi.mocked(mockPrisma.equipmentPart.update).mockResolvedValue(mockUpdated);

      const dto = { currentStock: '8' };

      const result = await service.updatePart('p-1', dto);

      expect(result.currentStock).toBe(8);
    });

    it('should get low stock parts', async () => {
      const mockLowStock = [
        { id: 'p-1', partName: 'Filter', current_stock: 1, min_stock: 5 },
      ];

      vi.mocked(mockPrisma.$queryRaw).mockResolvedValue(mockLowStock);

      const result = await service.getLowStockParts();

      expect(result).toHaveLength(1);
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });
  });

  describe('Usage Logs', () => {
    it('should get usage logs for equipment', async () => {
      const mockLogs = [
        {
          id: 'ul-1',
          equipmentId: 'eq-1',
          usedDate: new Date(),
          usedBy: 'Dr. Kim',
          department: 'ICU',
        },
      ];

      vi.mocked(mockPrisma.equipmentUsageLog.findMany).mockResolvedValue(
        mockLogs,
      );

      const result = await service.getUsageLogs('eq-1');

      expect(result).toHaveLength(1);
      expect(mockPrisma.equipmentUsageLog.findMany).toHaveBeenCalledWith({
        where: { equipmentId: 'eq-1' },
        orderBy: { usedDate: 'desc' },
        take: 100,
      });
    });

    it('should add usage log', async () => {
      const mockLog = {
        id: 'ul-1',
        equipmentId: 'eq-1',
        usedDate: new Date(),
        usedBy: 'Dr. Kim',
        condition: 'NORMAL',
      };

      vi.mocked(mockPrisma.equipmentUsageLog.create).mockResolvedValue(
        mockLog,
      );
      vi.mocked(mockPrisma.equipment.findUnique).mockResolvedValue({
        name: 'Ventilator', assetNumber: 'EQ-001', status: 'ACTIVE', nextCalibration: null,
      });

      const dto = {
        usedDate: new Date().toISOString(),
        usedBy: 'Dr. Kim',
        department: 'ICU',
        patientCount: '3',
        condition: 'NORMAL',
      };

      const result = await service.addUsageLog('eq-1', dto as any);

      expect(result.usedBy).toBe('Dr. Kim');
    });

    it('should get all usage logs with filters', async () => {
      const mockLogs = [
        { id: 'ul-1', usedDate: new Date(), equipment: { name: 'Ventilator' } },
      ];

      vi.mocked(mockPrisma.equipmentUsageLog.findMany).mockResolvedValue(
        mockLogs,
      );

      const result = await service.getAllUsageLogs({
        equipmentId: 'eq-1',
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      });

      expect(result).toHaveLength(1);
      expect(mockPrisma.equipmentUsageLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { equipment: expect.any(Object) },
        }),
      );
    });
  });

  describe('Inspection Logs', () => {
    it('should get inspection logs for equipment', async () => {
      const mockLogs = [
        {
          id: 'il-1',
          equipmentId: 'eq-1',
          inspectionDate: new Date(),
          inspectorName: 'Inspector A',
          overallResult: 'PASS',
        },
      ];

      vi.mocked(mockPrisma.equipmentInspectionLog.findMany).mockResolvedValue(
        mockLogs,
      );

      const result = await service.getInspectionLogs('eq-1');

      expect(result).toHaveLength(1);
      expect(result[0].overallResult).toBe('PASS');
    });

    it('should add inspection log and update equipment next inspection', async () => {
      const mockLog = {
        id: 'il-1',
        equipmentId: 'eq-1',
        inspectionDate: new Date(),
        inspectionType: 'ANNUAL',
        overallResult: 'PASS',
      };

      vi.mocked(mockPrisma.equipmentInspectionLog.create).mockResolvedValue(
        mockLog,
      );
      vi.mocked(mockPrisma.equipment.update).mockResolvedValue({
        nextInspection: new Date('2027-05-13'),
      });

      const dto = {
        inspectionDate: new Date().toISOString(),
        inspectorName: 'Inspector A',
        inspectionType: 'ANNUAL',
        overallResult: 'PASS',
        nextInspectionDate: '2027-05-13',
      };

      const result = await service.addInspectionLog('eq-1', dto as any);

      expect(result.id).toBe('il-1');
      expect(mockPrisma.equipment.update).toHaveBeenCalled();
    });

    it('should get all inspection logs with filters', async () => {
      const mockLogs = [
        { id: 'il-1', inspectionType: 'ANNUAL', overallResult: 'PASS' },
      ];

      vi.mocked(mockPrisma.equipmentInspectionLog.findMany).mockResolvedValue(
        mockLogs,
      );

      const result = await service.getAllInspectionLogs({
        type: 'ANNUAL',
        result: 'PASS',
      });

      expect(result).toHaveLength(1);
    });
  });

  describe('All Maintenance Logs', () => {
    it('should get all maintenance logs with type filter', async () => {
      const mockLogs = [
        {
          id: 'ml-1',
          type: 'PREVENTIVE',
          equipment: { name: 'Ventilator', assetNumber: 'AST-001' },
        },
      ];

      vi.mocked(mockPrisma.maintenanceLog.findMany).mockResolvedValue(mockLogs);

      const result = await service.getAllMaintenanceLogs({ type: 'PREVENTIVE' });

      expect(result).toHaveLength(1);
      expect(mockPrisma.maintenanceLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { equipment: expect.any(Object) },
        }),
      );
    });

    it('should get all maintenance logs with status filter', async () => {
      const mockLogs = [
        {
          id: 'ml-1',
          status: 'COMPLETED',
          equipment: { location: 'ICU' },
        },
      ];

      vi.mocked(mockPrisma.maintenanceLog.findMany).mockResolvedValue(mockLogs);

      const result = await service.getAllMaintenanceLogs({
        status: 'COMPLETED',
      });

      expect(result).toHaveLength(1);
    });
  });

  describe('사용/점검 안전게이트', () => {
    it('should BLOCK usage log for BROKEN equipment when gate=BLOCK', async () => {
      mockConfig.get.mockImplementation(async (k: string) => (k === 'equipment.useEnforce' ? 'BLOCK' : undefined));
      vi.mocked(mockPrisma.equipment.findUnique).mockResolvedValue({
        name: 'Defibrillator', assetNumber: 'EQ-009', status: 'BROKEN', nextCalibration: null,
      });

      await expect(
        service.addUsageLog('eq-9', { usedDate: new Date().toISOString(), usedBy: 'RN' } as any),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.equipmentUsageLog.create).not.toHaveBeenCalled();
    });

    it('should warn (not block) on WARN mode and attach safetyWarnings', async () => {
      mockConfig.get.mockImplementation(async (k: string) => (k === 'equipment.useEnforce' ? 'WARN' : undefined));
      vi.mocked(mockPrisma.equipment.findUnique).mockResolvedValue({
        name: 'Defibrillator', assetNumber: 'EQ-009', status: 'UNDER_MAINTENANCE',
        nextCalibration: new Date(Date.now() - 86400000), // 교정기한 경과
      });
      vi.mocked(mockPrisma.equipmentUsageLog.create).mockResolvedValue({ id: 'ul-9' });

      const result: any = await service.addUsageLog('eq-9', { usedDate: new Date().toISOString(), usedBy: 'RN' } as any);

      expect(result.safetyWarnings).toHaveLength(2); // 사용중지 + 교정경과
    });

    it('should auto set UNDER_MAINTENANCE on inspection FAIL', async () => {
      vi.mocked(mockPrisma.equipmentInspectionLog.create).mockResolvedValue({ id: 'il-1' });
      mockPrisma.equipment.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      vi.mocked(mockPrisma.equipment.findUnique).mockResolvedValue({
        name: 'Ventilator', assetNumber: 'EQ-001', erpAssetCode: null,
      });

      await service.addInspectionLog('eq-1', {
        inspectionDate: new Date().toISOString(), inspectorName: '점검자',
        inspectionType: 'SAFETY', overallResult: 'FAIL',
      } as any);

      expect(mockPrisma.equipment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'eq-1', status: { not: 'RETIRED' } },
          data: { status: 'UNDER_MAINTENANCE' },
        }),
      );
    });

    it('should NOT revive a RETIRED asset on inspection FAIL', async () => {
      vi.mocked(mockPrisma.equipmentInspectionLog.create).mockResolvedValue({ id: 'il-2' });
      mockPrisma.equipment.updateMany = vi.fn().mockResolvedValue({ count: 0 }); // RETIRED → 조건 불일치

      await service.addInspectionLog('eq-retired', {
        inspectionDate: new Date().toISOString(), inspectorName: '점검자',
        inspectionType: 'SAFETY', overallResult: 'FAIL',
      } as any);

      expect(mockPrisma.equipment.findUnique).not.toHaveBeenCalled(); // 전환 미발생 → 이벤트 없음
    });
  });
});
