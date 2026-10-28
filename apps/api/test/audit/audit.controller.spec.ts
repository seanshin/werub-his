import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditController } from '../../src/modules/audit/audit.controller';

describe('AuditController', () => {
  let controller: AuditController;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      auditLog: {
        findMany: vi.fn(),
        count: vi.fn(),
        groupBy: vi.fn(),
      },
    };

    controller = new AuditController(mockPrisma);
  });

  describe('GET /api/v1/audit (findAll)', () => {
    it('should return paginated audit logs', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          userId: 'user-1',
          action: 'CREATE',
          resourceType: 'Patient',
          resourceId: 'p-1',
          timestamp: new Date(),
          user: {
            id: 'user-1',
            familyName: '이',
            givenName: '의사',
            role: 'DOCTOR',
            email: 'doctor@hospital.example.org',
          },
        },
      ];

      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue(mockLogs);
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(100);

      const result = await controller.findAll('1', '50');

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(100);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(50);
      expect(result.pagination.hasMore).toBe(true);
    });

    it('should use default pagination values', async () => {
      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(0);

      await controller.findAll();

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { timestamp: 'desc' },
        take: 50,
        skip: 0,
        include: expect.any(Object),
      });
    });

    it('should calculate pagination offset correctly', async () => {
      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(500);

      await controller.findAll('3', '25');

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: expect.any(Object),
        orderBy: { timestamp: 'desc' },
        take: 25,
        skip: 50, // (3-1)*25
        include: expect.any(Object),
      });
    });

    it('should cap limit at 100', async () => {
      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(1000);

      await controller.findAll('1', '200');

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: expect.any(Object),
        orderBy: { timestamp: 'desc' },
        take: 100, // capped at 100
        skip: 0,
        include: expect.any(Object),
      });
    });

    it('should filter by userId', async () => {
      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(10);

      await controller.findAll('1', '50', 'user-1');

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { timestamp: 'desc' },
        take: 50,
        skip: 0,
        include: expect.any(Object),
      });
    });

    it('should filter by action', async () => {
      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(20);

      await controller.findAll('1', '50', undefined, 'CREATE');

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { action: 'CREATE' },
        orderBy: { timestamp: 'desc' },
        take: 50,
        skip: 0,
        include: expect.any(Object),
      });
    });

    it('should filter by resourceType', async () => {
      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(15);

      await controller.findAll('1', '50', undefined, undefined, 'Patient');

      // 이표기(PRESCRIPTION/Prescription) 흡수 — 대소문자 무시 매칭
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { resourceType: { equals: 'Patient', mode: 'insensitive' } },
        orderBy: { timestamp: 'desc' },
        take: 50,
        skip: 0,
        include: expect.any(Object),
      });
    });

    it('should combine multiple filters', async () => {
      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(5);

      await controller.findAll('1', '50', 'user-1', 'UPDATE', 'Encounter');

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          action: 'UPDATE',
          resourceType: { equals: 'Encounter', mode: 'insensitive' },
        },
        orderBy: { timestamp: 'desc' },
        take: 50,
        skip: 0,
        include: expect.any(Object),
      });
    });

    it('should include user information in results', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          userId: 'user-1',
          action: 'CREATE',
          resourceType: 'Patient',
          timestamp: new Date(),
          user: {
            id: 'user-1',
            familyName: '이',
            givenName: '의사',
            role: 'DOCTOR',
            email: 'doctor@hospital.example.org',
          },
        },
      ];

      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue(mockLogs);
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(1);

      const result = await controller.findAll();

      expect(result.data[0].user).toBeDefined();
      expect(result.data[0].user.email).toBe('doctor@hospital.example.org');
    });

    it('should sort by timestamp descending', async () => {
      const mockLogs = [
        {
          id: 'log-3',
          timestamp: new Date('2026-05-13T12:00:00Z'),
          user: { id: 'u-1', familyName: '이', givenName: '의사', role: 'DOCTOR', email: 'x@x' },
        },
        {
          id: 'log-2',
          timestamp: new Date('2026-05-13T11:00:00Z'),
          user: { id: 'u-1', familyName: '이', givenName: '의사', role: 'DOCTOR', email: 'x@x' },
        },
        {
          id: 'log-1',
          timestamp: new Date('2026-05-13T10:00:00Z'),
          user: { id: 'u-1', familyName: '이', givenName: '의사', role: 'DOCTOR', email: 'x@x' },
        },
      ];

      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue(mockLogs);
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(3);

      const result = await controller.findAll();

      expect(result.data[0].id).toBe('log-3');
      expect(result.data[1].id).toBe('log-2');
      expect(result.data[2].id).toBe('log-1');
    });

    it('should indicate if more data exists', async () => {
      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue(
        Array(50).fill({ id: 'log', user: { id: 'u', familyName: '이', givenName: '의사', role: 'DOCTOR', email: 'x' } })
      );
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(150);

      const result = await controller.findAll('1', '50');

      expect(result.pagination.hasMore).toBe(true);
    });

    it('should indicate when no more data exists', async () => {
      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(25);

      const result = await controller.findAll('1', '50');

      expect(result.pagination.hasMore).toBe(false);
    });

    it('should return empty array when no logs found', async () => {
      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(0);

      const result = await controller.findAll('1', '50', 'nonexistent-user');

      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });
  });

  describe('GET /api/v1/audit/stats (stats)', () => {
    it('should return audit statistics', async () => {
      vi.mocked(mockPrisma.auditLog.groupBy)
        .mockResolvedValueOnce([
          { action: 'CREATE', _count: 100 },
          { action: 'UPDATE', _count: 250 },
          { action: 'DELETE', _count: 50 },
        ])
        .mockResolvedValueOnce([
          { resourceType: 'Patient', _count: 150 },
          { resourceType: 'Encounter', _count: 120 },
          { resourceType: 'Prescription', _count: 80 },
        ]);

      vi.mocked(mockPrisma.auditLog.count)
        .mockResolvedValueOnce(75) // 24h count
        .mockResolvedValueOnce(500); // total count

      const result = await controller.stats();

      expect(result.data.byAction).toHaveLength(3);
      expect(result.data.byResource).toHaveLength(3);
      expect(result.data.last24h).toBe(75);
      expect(result.data.total).toBe(500);
    });

    // 과거 직접 호출분의 이표기(PRESCRIPTION/Prescription)는 앵커링돼 있어 데이터를 고칠 수 없다 → 집계에서 병합
    it('should merge case-variant resource types', async () => {
      vi.mocked(mockPrisma.auditLog.groupBy)
        .mockResolvedValueOnce([{ action: 'UPDATE', _count: 47 }])
        .mockResolvedValueOnce([
          { resourceType: 'PRESCRIPTION', _count: 6 },
          { resourceType: 'Prescription', _count: 41 },
          { resourceType: 'Patient', _count: 10 },
        ]);
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValueOnce(1).mockResolvedValueOnce(57);

      const result = await controller.stats();

      expect(result.data.byResource).toEqual([
        { resourceType: 'Prescription', count: 47 }, // 다수 표기를 대표로 병합
        { resourceType: 'Patient', count: 10 },
      ]);
    });

    it('should break down by action type', async () => {
      vi.mocked(mockPrisma.auditLog.groupBy)
        .mockResolvedValueOnce([
          { action: 'CREATE', _count: 100 },
          { action: 'READ', _count: 500 },
          { action: 'UPDATE', _count: 200 },
          { action: 'DELETE', _count: 50 },
        ])
        .mockResolvedValueOnce([]);

      vi.mocked(mockPrisma.auditLog.count)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const result = await controller.stats();

      expect(result.data.byAction[0].action).toBe('CREATE');
      expect(result.data.byAction[0].count).toBe(100);
      expect(result.data.byAction[1].action).toBe('READ');
      expect(result.data.byAction[1].count).toBe(500);
    });

    it('should break down by resource type (top 10)', async () => {
      const resourceBreakdown = [
        { resourceType: 'Patient', _count: 300 },
        { resourceType: 'Encounter', _count: 250 },
        { resourceType: 'Prescription', _count: 200 },
        { resourceType: 'Lab', _count: 150 },
        { resourceType: 'Imaging', _count: 100 },
      ];

      vi.mocked(mockPrisma.auditLog.groupBy)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(resourceBreakdown);

      vi.mocked(mockPrisma.auditLog.count)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const result = await controller.stats();

      expect(result.data.byResource).toHaveLength(5);
      expect(result.data.byResource[0].resourceType).toBe('Patient');
      expect(result.data.byResource[0].count).toBe(300);
    });

    it('should include 24-hour activity count', async () => {
      vi.mocked(mockPrisma.auditLog.groupBy)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      vi.mocked(mockPrisma.auditLog.count)
        .mockResolvedValueOnce(42) // last 24h
        .mockResolvedValueOnce(5000); // total

      const result = await controller.stats();

      expect(result.data.last24h).toBe(42);
    });

    it('should include total audit log count', async () => {
      vi.mocked(mockPrisma.auditLog.groupBy)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      vi.mocked(mockPrisma.auditLog.count)
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(10000); // total

      const result = await controller.stats();

      expect(result.data.total).toBe(10000);
    });

    it('should handle empty statistics', async () => {
      vi.mocked(mockPrisma.auditLog.groupBy)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      vi.mocked(mockPrisma.auditLog.count)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const result = await controller.stats();

      expect(result.data.byAction).toEqual([]);
      expect(result.data.byResource).toEqual([]);
      expect(result.data.last24h).toBe(0);
      expect(result.data.total).toBe(0);
    });

    it('should format response with data wrapper', async () => {
      vi.mocked(mockPrisma.auditLog.groupBy)
        .mockResolvedValueOnce([{ action: 'CREATE', _count: 10 }])
        .mockResolvedValueOnce([{ resourceType: 'Patient', _count: 10 }]);

      vi.mocked(mockPrisma.auditLog.count)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(10);

      const result = await controller.stats();

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('byAction');
      expect(result.data).toHaveProperty('byResource');
      expect(result.data).toHaveProperty('last24h');
      expect(result.data).toHaveProperty('total');
    });

    it('should count logs from last 24 hours only', async () => {
      vi.mocked(mockPrisma.auditLog.groupBy)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      vi.mocked(mockPrisma.auditLog.count)
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(0);

      await controller.stats();

      // Check that the 24h count was called with a timestamp filter
      const callArgs = (mockPrisma.auditLog.count as any).mock.calls[0];
      expect(callArgs[0].where.timestamp.gte).toBeDefined();
    });

    it('should handle multiple concurrent queries', async () => {
      vi.mocked(mockPrisma.auditLog.groupBy)
        .mockResolvedValueOnce([{ action: 'UPDATE', _count: 20 }])
        .mockResolvedValueOnce([{ resourceType: 'Encounter', _count: 15 }]);

      vi.mocked(mockPrisma.auditLog.count)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(100);

      const result = await controller.stats();

      expect(result.data.byAction).toBeDefined();
      expect(result.data.byResource).toBeDefined();
      expect(result.data.last24h).toBe(8);
      expect(result.data.total).toBe(100);
    });
  });
});
