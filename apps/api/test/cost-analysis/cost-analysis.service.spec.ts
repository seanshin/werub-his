import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CostAnalysisService } from '../../src/modules/cost-analysis/cost-analysis.service';

describe('CostAnalysisService', () => {
  let service: CostAnalysisService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      costCenter: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      costDriver: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      costAllocation: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      procedureCost: {
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
      prescription: {
        findMany: vi.fn(),
      },
    };
    service = new CostAnalysisService(mockPrisma);
  });

  /* ───────── Cost Centers ───────── */

  describe('getCenters', () => {
    it('should return a tree structure of cost centers', async () => {
      const rows = [
        { id: 'c1', code: 'CC-001', name: '진료부', type: 'DIRECT', parentId: null, department: 'MEDICAL', isActive: true },
        { id: 'c2', code: 'CC-002', name: '내과', type: 'DIRECT', parentId: 'c1', department: 'MEDICAL', isActive: true },
        { id: 'c3', code: 'CC-003', name: '외과', type: 'DIRECT', parentId: 'c1', department: 'MEDICAL', isActive: true },
        { id: 'c4', code: 'CC-010', name: '관리부', type: 'INDIRECT', parentId: null, department: 'ADMIN', isActive: true },
      ];
      mockPrisma.costCenter.findMany.mockResolvedValue(rows);

      const result = await service.getCenters();

      // root nodes
      expect(result).toHaveLength(2);
      // 진료부 has 2 children
      const medical = result.find((n: any) => n.id === 'c1');
      expect(medical!.children).toHaveLength(2);
      // 관리부 has no children
      const admin = result.find((n: any) => n.id === 'c4');
      expect(admin!.children).toHaveLength(0);
    });

    it('should return empty array when no centers', async () => {
      mockPrisma.costCenter.findMany.mockResolvedValue([]);

      const result = await service.getCenters();

      expect(result).toEqual([]);
    });
  });

  describe('createCenter', () => {
    it('should create a cost center', async () => {
      const data = { code: 'CC-100', name: '신규센터', type: 'DIRECT', department: 'MEDICAL' };
      mockPrisma.costCenter.create.mockResolvedValue({ id: 'new-id', ...data });

      const result = await service.createCenter(data);

      expect(result.code).toBe('CC-100');
      // 🔴 (B6) 본문 통째가 아니라 명시 필드만 — 미선택 상위는 null
      expect(mockPrisma.costCenter.create).toHaveBeenCalledWith({ data: { ...data, parentId: null } });
    });
  });

  describe('updateCenter', () => {
    it('should update a cost center', async () => {
      mockPrisma.costCenter.update.mockResolvedValue({ id: 'c1', name: '변경됨' });

      const result = await service.updateCenter('c1', { name: '변경됨' });

      expect(result.name).toBe('변경됨');
      expect(mockPrisma.costCenter.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { name: '변경됨' },
      });
    });
  });

  /* ───────── Cost Drivers ───────── */

  describe('getDrivers', () => {
    it('should return all drivers without filters', async () => {
      const drivers = [
        { id: 'd1', code: 'DR-001', category: 'LABOR', period: '2026-05', unitCost: 50000 },
        { id: 'd2', code: 'DR-002', category: 'MATERIAL', period: '2026-05', unitCost: 12000 },
      ];
      mockPrisma.costDriver.findMany.mockResolvedValue(drivers);

      const result = await service.getDrivers();

      expect(result).toHaveLength(2);
    });

    it('should apply category and period filters', async () => {
      mockPrisma.costDriver.findMany.mockResolvedValue([]);

      await service.getDrivers('LABOR', '2026-05');

      expect(mockPrisma.costDriver.findMany).toHaveBeenCalledWith({
        where: { category: 'LABOR', period: '2026-05' },
        orderBy: { code: 'asc' },
      });
    });
  });

  describe('createDriver', () => {
    it('should create a cost driver', async () => {
      const data = { code: 'DR-100', name: '간접비', category: 'OVERHEAD', unit: 'HOUR', unitCost: 30000, period: '2026-05' };
      mockPrisma.costDriver.create.mockResolvedValue({ id: 'drv-new', ...data });

      const result = await service.createDriver(data);

      expect(result.code).toBe('DR-100');
    });
  });

  describe('updateDriver', () => {
    it('should update a cost driver', async () => {
      mockPrisma.costDriver.update.mockResolvedValue({ id: 'd1', unitCost: 60000 });

      const result = await service.updateDriver('d1', { unitCost: 60000 });

      expect(result.unitCost).toBe(60000);
    });
  });

  /* ───────── Allocations ───────── */

  describe('createAllocation', () => {
    // 🔴 (2026-09-15 B6) 종전 테스트는 `{costDriverId, amount, source}` 를 본문으로 넣었다 — 화면은 `{costCenterId, driverId, quantity, period}` 를
    //    보내므로 실제로는 한 번도 저장되지 않았고(P11), 반대로 API 직접 호출은 금액·출처를 마음대로 정했다. 목이 내 가정이었다.
    beforeEach(() => {
      mockPrisma.costCenter.findUnique = vi.fn().mockResolvedValue({ id: 'c1' });
      mockPrisma.costDriver.findUnique = vi.fn().mockResolvedValue({ id: 'd1', unitCost: 50000.5, period: '2026-05' });
      mockPrisma.costAllocation.create.mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'alloc-1', ...(data as object) }));
    });

    it('화면 계약(driverId·quantity) 그대로 저장 — 금액은 동인 단가×수량(money 정책)·출처 MANUAL', async () => {
      const result = await service.createAllocation({ costCenterId: 'c1', driverId: 'd1', quantity: 2, period: '2026-05' });

      expect(mockPrisma.costAllocation.create).toHaveBeenCalledWith({
        data: { costCenterId: 'c1', costDriverId: 'd1', period: '2026-05', quantity: 2, amount: 100001, source: 'MANUAL' },
      });
      expect(result.source).toBe('MANUAL');
    });

    it('🔴 본문에 금액·출처를 넣어도 서버 계산이 이긴다', async () => {
      await service.createAllocation({ costCenterId: 'c1', driverId: 'd1', quantity: 1, period: '2026-05', amount: 999, source: 'AUTO' } as never);
      const data = mockPrisma.costAllocation.create.mock.calls[0][0].data;
      expect(data.amount).toBe(50001);
      expect(data.source).toBe('MANUAL');
    });

    it('동인 기간이 배부 기간과 다르면 400 · 없는 동인은 404 · 저장 안 함', async () => {
      await expect(service.createAllocation({ costCenterId: 'c1', driverId: 'd1', quantity: 1, period: '2026-06' })).rejects.toThrow(/기간/);
      mockPrisma.costDriver.findUnique.mockResolvedValue(null);
      await expect(service.createAllocation({ costCenterId: 'c1', driverId: 'd9', quantity: 1, period: '2026-05' })).rejects.toThrow(/동인/);
      expect(mockPrisma.costAllocation.create).not.toHaveBeenCalled();
    });
  });

  describe('autoAllocate', () => {
    it('should create allocations for each driver-center pair', async () => {
      mockPrisma.costDriver.findMany.mockResolvedValue([
        { id: 'd1', unitCost: 50000 },
        { id: 'd2', unitCost: 12000 },
      ]);
      mockPrisma.costCenter.findMany.mockResolvedValue([
        { id: 'c1', isActive: true },
        { id: 'c2', isActive: true },
      ]);
      mockPrisma.costAllocation.create.mockResolvedValue({});

      const result = await service.autoAllocate('2026-05');

      // 2 drivers x 2 centers = 4 allocations
      expect(result.allocationsCreated).toBe(4);
      expect(result.period).toBe('2026-05');
      expect(result.details).toHaveLength(4);
      expect(mockPrisma.costAllocation.create).toHaveBeenCalledTimes(4);
    });

    it('should skip drivers with zero unitCost', async () => {
      mockPrisma.costDriver.findMany.mockResolvedValue([
        { id: 'd1', unitCost: 0 },
      ]);
      mockPrisma.costCenter.findMany.mockResolvedValue([
        { id: 'c1', isActive: true },
      ]);

      const result = await service.autoAllocate('2026-05');

      expect(result.allocationsCreated).toBe(0);
      expect(mockPrisma.costAllocation.create).not.toHaveBeenCalled();
    });
  });

  describe('getAllocations', () => {
    it('should return allocations with costCenter included', async () => {
      const allocs = [
        { id: 'a1', costCenterId: 'c1', period: '2026-05', amount: 50000, costCenter: { id: 'c1', name: '내과' } },
      ];
      mockPrisma.costAllocation.findMany.mockResolvedValue(allocs);

      const result = await service.getAllocations('c1', '2026-05');

      expect(result).toHaveLength(1);
      expect(mockPrisma.costAllocation.findMany).toHaveBeenCalledWith({
        where: { costCenterId: 'c1', period: '2026-05' },
        include: { costCenter: true },
        orderBy: { allocatedAt: 'desc' },
      });
    });

    it('should return all allocations when no filters', async () => {
      mockPrisma.costAllocation.findMany.mockResolvedValue([]);

      await service.getAllocations();

      expect(mockPrisma.costAllocation.findMany).toHaveBeenCalledWith({
        where: {},
        include: { costCenter: true },
        orderBy: { allocatedAt: 'desc' },
      });
    });
  });

  /* ───────── Procedure Costs ───────── */

  describe('getProcedureCosts', () => {
    it('should return procedure costs ordered by totalCost desc', async () => {
      const costs = [
        { procedureCode: 'P001', totalCost: 500000 },
        { procedureCode: 'P002', totalCost: 300000 },
      ];
      mockPrisma.procedureCost.findMany.mockResolvedValue(costs);

      const result = await service.getProcedureCosts('2026-05');

      expect(result).toHaveLength(2);
      expect(mockPrisma.procedureCost.findMany).toHaveBeenCalledWith({
        where: { period: '2026-05' },
        orderBy: { totalCost: 'desc' },
      });
    });

    it('should return all when no period specified', async () => {
      mockPrisma.procedureCost.findMany.mockResolvedValue([]);

      await service.getProcedureCosts();

      expect(mockPrisma.procedureCost.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { totalCost: 'desc' },
      });
    });
  });

  describe('calculateProcedureCosts', () => {
    it('should compute direct + indirect costs and upsert', async () => {
      mockPrisma.costAllocation.findMany.mockResolvedValue([
        { amount: 100000, costCenter: { department: 'MEDICAL' } },
        { amount: 200000, costCenter: { department: 'MEDICAL' } },
      ]);
      mockPrisma.prescription.findMany.mockResolvedValue([
        { procedureCode: { code: 'P001', nameKo: '초음파', unitPrice: 80000 } },
        { procedureCode: { code: 'P001', nameKo: '초음파', unitPrice: 80000 } },
        { procedureCode: { code: 'P002', nameKo: 'CT촬영', unitPrice: 200000 } },
      ]);
      mockPrisma.procedureCost.upsert.mockResolvedValue({});

      const result = await service.calculateProcedureCosts('2026-05');

      expect(result.period).toBe('2026-05');
      expect(result.procedureCount).toBe(2);
      expect(result.totalIndirectCost).toBe(300000);
      expect(result.results).toHaveLength(2);
      expect(mockPrisma.procedureCost.upsert).toHaveBeenCalledTimes(2);
    });

    it('should handle zero prescriptions', async () => {
      mockPrisma.costAllocation.findMany.mockResolvedValue([]);
      mockPrisma.prescription.findMany.mockResolvedValue([]);

      const result = await service.calculateProcedureCosts('2026-05');

      expect(result.procedureCount).toBe(0);
      expect(result.results).toEqual([]);
    });
  });

  /* ───────── Analytics ───────── */

  describe('getDepartmentAnalytics', () => {
    it('should group allocations by department and sort by totalCost desc', async () => {
      mockPrisma.costAllocation.findMany.mockResolvedValue([
        { amount: 100000, costCenter: { department: 'MEDICAL' } },
        { amount: 200000, costCenter: { department: 'MEDICAL' } },
        { amount: 150000, costCenter: { department: 'ADMIN' } },
      ]);

      const result = await service.getDepartmentAnalytics('2026-05');

      expect(result).toHaveLength(2);
      expect(result[0].department).toBe('MEDICAL');
      expect(result[0].totalCost).toBe(300000);
      expect(result[0].allocationCount).toBe(2);
      expect(result[1].department).toBe('ADMIN');
      expect(result[1].totalCost).toBe(150000);
    });
  });

  describe('getProfitability', () => {
    it('should return profitability metrics with profitPerCase', async () => {
      mockPrisma.procedureCost.findMany.mockResolvedValue([
        { procedureCode: 'P001', procedureName: '초음파', period: '2026-05', totalCost: 200000, revenueAvg: 250000, margin: 0.2, volumeCount: 10 },
      ]);

      const result = await service.getProfitability('2026-05');

      expect(result).toHaveLength(1);
      expect(result[0].procedureCode).toBe('P001');
      expect(result[0].profitPerCase).toBe(250000 - 200000 / 10);
      expect(result[0].margin).toBe(0.2);
    });
  });

  describe('getTrend', () => {
    it('should aggregate costs by period sorted chronologically', async () => {
      mockPrisma.costAllocation.findMany.mockResolvedValue([
        { period: '2026-03', amount: 100000 },
        { period: '2026-03', amount: 50000 },
        { period: '2026-04', amount: 200000 },
        { period: '2026-05', amount: 180000 },
      ]);

      const result = await service.getTrend('2026-03', '2026-05');

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ period: '2026-03', totalCost: 150000, count: 2 });
      expect(result[1]).toEqual({ period: '2026-04', totalCost: 200000, count: 1 });
      expect(result[2]).toEqual({ period: '2026-05', totalCost: 180000, count: 1 });
    });

    it('should return empty array when no allocations in range', async () => {
      mockPrisma.costAllocation.findMany.mockResolvedValue([]);

      const result = await service.getTrend('2026-01', '2026-03');

      expect(result).toEqual([]);
    });
  });

  /* ───────── 경영 대시보드 (W6 신설) ───────── */

  describe('getDashboard', () => {
    /**
     * 🔴 '경영 대시보드' 탭이 부르던 `GET /cost/dashboard` 는 **존재하지 않았다**(404).
     * 화면은 실패를 `?? 0` 으로 받아 "총 원가 ₩0 · 마진율 0%"를 그렸고, 0% 는 `>= 0` 이라
     * **초록색**으로 떴다 — 호출이 실패한 화면이 건전한 손익으로 보였다.
     */
    it('🔴 배분 실적이 없으면 allocationCount 0 으로 알린다 — 원가 0원과 구분', async () => {
      mockPrisma.costAllocation.findMany.mockResolvedValue([]);
      mockPrisma.procedureCost.findMany.mockResolvedValue([]);

      const r = await service.getDashboard('2026-08');

      expect(r.allocationCount).toBe(0);
      expect(r.overallCost).toBe(0);
      expect(r.departments).toEqual([]);
    });

    it('🔴 행위별 원가가 없으면 수익·순이익은 0 이 아니라 null', async () => {
      mockPrisma.costAllocation.findMany.mockResolvedValue([]);
      mockPrisma.procedureCost.findMany.mockResolvedValue([]);

      const r = await service.getDashboard('2026-08');

      expect(r.revenueAvailable).toBe(false);
      expect(r.overallRevenue).toBeNull();
      expect(r.overallMargin).toBeNull();
    });

    it('🔴 진료과별 수익은 산출 불가로 밝힌다 — 0 으로 채우면 전 부서가 마진율 -100%', async () => {
      mockPrisma.costAllocation.findMany.mockResolvedValue([
        { period: '2026-08', amount: 1000, costCenter: { department: '내과' } },
        { period: '2026-08', amount: 500, costCenter: { department: '내과' } },
        { period: '2026-08', amount: 300, costCenter: { department: '외과' } },
      ]);
      mockPrisma.procedureCost.findMany.mockResolvedValue([]);

      const r = await service.getDashboard('2026-08');

      expect(r.departmentRevenueAvailable).toBe(false);
      expect(r.departmentRevenueReason).toBeTruthy();
      expect(r.overallCost).toBe(1800);
      const 내과 = r.departments.find((d: { department: string }) => d.department === '내과');
      expect(내과?.totalCost).toBe(1500);
      expect(내과?.allocationCount).toBe(2);
      expect(내과?.totalRevenue).toBeNull();
      expect(내과?.marginRate).toBeNull();
    });
  });

});
