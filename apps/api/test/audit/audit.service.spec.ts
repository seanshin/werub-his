import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditService } from '../../src/modules/audit/audit.service';
import { ZERO_UUID } from '../../src/modules/audit/audit-routes';

// 🔴 audit_logs.user_id / resource_id 는 @db.Uuid — 픽스처도 실제 컬럼 모양(UUID)을 쓴다.
//    종전 'patient-1' 같은 목은 운영에서 절대 저장될 수 없는 모양을 테스트하고 있었다.
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const R1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const D1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('AuditService', () => {
  let service: AuditService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      auditLog: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
    };

    service = new AuditService(mockPrisma);
  });

  describe('log', () => {
    it('should create audit log entry', async () => {
      const entry = {
        userId: U1,
        action: 'CREATE' as any,
        resourceType: 'Patient',
        resourceId: P1,
      };

      const mockLog = {
        id: 'log-1',
        timestamp: new Date(),
        ...entry,
        changes: null,
        ipAddress: null,
        userAgent: null,
      };

      vi.mocked(mockPrisma.auditLog.create).mockResolvedValue(mockLog);

      const result = await service.log(entry);

      expect(result.id).toBe('log-1');
      expect(result.userId).toBe(U1);
      expect(result.action).toBe('CREATE');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: U1,
          action: 'CREATE',
          resourceType: 'Patient',
          resourceId: P1,
        }),
      });
    });

    it('should include changes in log', async () => {
      const changes = {
        name: { old: '이환자', new: '김환자' },
        status: { old: 'ACTIVE', new: 'INACTIVE' },
      };

      const entry = {
        userId: U1,
        action: 'UPDATE' as any,
        resourceType: 'Patient',
        resourceId: P1,
        changes,
      };

      vi.mocked(mockPrisma.auditLog.create).mockResolvedValue({
        id: 'log-1',
        ...entry,
        timestamp: new Date(),
        ipAddress: null,
        userAgent: null,
      });

      const result = await service.log(entry);

      expect(result.changes).toEqual(changes);
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
    });

    it('should include ipAddress if provided', async () => {
      const entry = {
        userId: U1,
        action: 'DELETE' as any,
        resourceType: 'Patient',
        resourceId: P1,
        ipAddress: '192.168.1.1',
      };

      vi.mocked(mockPrisma.auditLog.create).mockResolvedValue({
        id: 'log-1',
        ...entry,
        timestamp: new Date(),
        changes: null,
        userAgent: null,
      });

      const result = await service.log(entry);

      expect(result.ipAddress).toBe('192.168.1.1');
    });

    it('should include userAgent if provided', async () => {
      const entry = {
        userId: U1,
        action: 'VIEW' as any,
        resourceType: 'Report',
        resourceId: R1,
        userAgent: 'Mozilla/5.0',
      };

      vi.mocked(mockPrisma.auditLog.create).mockResolvedValue({
        id: 'log-1',
        ...entry,
        timestamp: new Date(),
        changes: null,
        ipAddress: null,
      });

      const result = await service.log(entry);

      expect(result.userAgent).toBe('Mozilla/5.0');
    });

    it('should include both ipAddress and userAgent', async () => {
      const entry = {
        userId: U1,
        action: 'EXPORT' as any,
        resourceType: 'Data',
        resourceId: D1,
        ipAddress: '10.0.0.1',
        userAgent: 'Chrome/100',
      };

      vi.mocked(mockPrisma.auditLog.create).mockResolvedValue({
        id: 'log-1',
        ...entry,
        timestamp: new Date(),
        changes: null,
      });

      const result = await service.log(entry);

      expect(result.ipAddress).toBe('10.0.0.1');
      expect(result.userAgent).toBe('Chrome/100');
    });

    it('should handle different resource types', async () => {
      const resourceTypes = ['Patient', 'Encounter', 'Prescription', 'User', 'Configuration'];

      for (const rt of resourceTypes) {
        const entry = {
          userId: U1,
          action: 'UPDATE' as any,
          resourceType: rt,
          resourceId: D1,
        };

        vi.mocked(mockPrisma.auditLog.create).mockResolvedValue({
          id: 'log-1',
          ...entry,
          timestamp: new Date(),
          changes: null,
          ipAddress: null,
          userAgent: null,
        });

        const result = await service.log(entry);

        expect(result.resourceType).toBe(rt);
      }
    });

    it('should handle different audit actions', async () => {
      const actions = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'EXPORT', 'IMPORT'];

      for (const action of actions) {
        const entry = {
          userId: U1,
          action: action as any,
          resourceType: 'Data',
          resourceId: D1,
        };

        vi.mocked(mockPrisma.auditLog.create).mockResolvedValue({
          id: 'log-1',
          ...entry,
          timestamp: new Date(),
          changes: null,
          ipAddress: null,
          userAgent: null,
        });

        await service.log(entry);

        expect(mockPrisma.auditLog.create).toHaveBeenCalled();
      }
    });

    it('should set timestamp automatically', async () => {
      const entry = {
        userId: U1,
        action: 'CREATE' as any,
        resourceType: 'Patient',
        resourceId: P1,
      };

      const now = new Date();
      const mockLog = {
        id: 'log-1',
        timestamp: now,
        ...entry,
        changes: null,
        ipAddress: null,
        userAgent: null,
      };

      vi.mocked(mockPrisma.auditLog.create).mockResolvedValue(mockLog);

      const result = await service.log(entry);

      expect(result.timestamp).toEqual(now);
    });
  });

  describe('findByResource', () => {
    it('should return logs for resource', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          userId: U1,
          action: 'CREATE',
          resourceType: 'Patient',
          resourceId: P1,
          timestamp: new Date('2026-05-13T10:00:00Z'),
          user: {
            id: U1,
            familyName: '이',
            givenName: '의사',
            role: 'DOCTOR',
          },
          changes: null,
        },
        {
          id: 'log-2',
          userId: U2,
          action: 'UPDATE',
          resourceType: 'Patient',
          resourceId: P1,
          timestamp: new Date('2026-05-13T11:00:00Z'),
          user: {
            id: U2,
            familyName: '김',
            givenName: '관리자',
            role: 'ADMIN',
          },
          changes: { status: { old: 'ACTIVE', new: 'INACTIVE' } },
        },
      ];

      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue(mockLogs);

      const result = await service.findByResource('Patient', P1);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('log-1');
      expect(result[1].id).toBe('log-2');
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { resourceType: 'Patient', resourceId: P1 },
        orderBy: { timestamp: 'desc' },
        include: expect.any(Object),
        take: 300, // 감사로그 조회 상한(2026-07 D-2)
      });
    });

    it('should sort by timestamp descending', async () => {
      const mockLogs = [
        {
          id: 'log-3',
          timestamp: new Date('2026-05-13T12:00:00Z'),
          user: { id: U1, familyName: '이', givenName: '의사', role: 'DOCTOR' },
        },
        {
          id: 'log-2',
          timestamp: new Date('2026-05-13T11:00:00Z'),
          user: { id: U1, familyName: '이', givenName: '의사', role: 'DOCTOR' },
        },
        {
          id: 'log-1',
          timestamp: new Date('2026-05-13T10:00:00Z'),
          user: { id: U1, familyName: '이', givenName: '의사', role: 'DOCTOR' },
        },
      ];

      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue(mockLogs);

      const result = await service.findByResource('Patient', P1);

      expect(result[0].id).toBe('log-3');
      expect(result[1].id).toBe('log-2');
      expect(result[2].id).toBe('log-1');
    });

    it('should include user information', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          resourceType: 'Patient',
          resourceId: P1,
          timestamp: new Date(),
          user: {
            id: U3,
            familyName: '이',
            givenName: '환자',
            role: 'PATIENT',
          },
        },
      ];

      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue(mockLogs);

      const result = await service.findByResource('Patient', P1);

      expect(result[0].user).toBeDefined();
      expect(result[0].user.familyName).toBe('이');
      expect(result[0].user.role).toBe('PATIENT');
    });

    it('should return empty array when no logs found', async () => {
      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue([]);

      const result = await service.findByResource('NonExistent', 'invalid-id');

      expect(result).toEqual([]);
    });

    it('should handle logs with changes data', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          resourceType: 'Patient',
          resourceId: P1,
          timestamp: new Date(),
          user: { id: 'u-1', familyName: '이', givenName: '의사', role: 'DOCTOR' },
          changes: {
            name: { old: '이환자', new: '김환자' },
            dob: { old: '1990-01-01', new: '1990-02-01' },
          },
        },
      ];

      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue(mockLogs);

      const result = await service.findByResource('Patient', P1);

      expect(result[0].changes).toBeDefined();
      expect(result[0].changes.name.old).toBe('이환자');
      expect(result[0].changes.name.new).toBe('김환자');
    });

    it('should include all audit actions', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          action: 'CREATE',
          resourceType: 'Data',
          resourceId: D1,
          timestamp: new Date(),
          user: { id: 'u-1', familyName: '이', givenName: '관리자', role: 'ADMIN' },
        },
        {
          id: 'log-2',
          action: 'UPDATE',
          resourceType: 'Data',
          resourceId: D1,
          timestamp: new Date(),
          user: { id: 'u-1', familyName: '이', givenName: '관리자', role: 'ADMIN' },
        },
        {
          id: 'log-3',
          action: 'DELETE',
          resourceType: 'Data',
          resourceId: D1,
          timestamp: new Date(),
          user: { id: 'u-1', familyName: '이', givenName: '관리자', role: 'ADMIN' },
        },
      ];

      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue(mockLogs);

      const result = await service.findByResource('Data', D1);

      expect(result).toHaveLength(3);
      expect(result[0].action).toBe('CREATE');
      expect(result[1].action).toBe('UPDATE');
      expect(result[2].action).toBe('DELETE');
    });
  });

  describe('비UUID 식별자 정규화 — 유실 대신 ZERO_UUID 귀속(2026-09-09 DocumentPdf/WRB-… 폐기 실측)', () => {
    it('resourceId 가 UUID 가 아니면 ZERO_UUID 로 저장하고 원래 키를 changes.resourceKey 에 남긴다', async () => {
      vi.mocked(mockPrisma.auditLog.create).mockResolvedValue({ id: 'log-x' });
      await service.log({ userId: U1, action: 'READ' as any, resourceType: 'DocumentPdf', resourceId: 'WRB-MEDICAL_RECORD_COPY-20260723-0001' });
      const data = vi.mocked(mockPrisma.auditLog.create).mock.calls[0][0].data;
      expect(data.resourceId).toBe(ZERO_UUID);
      expect(data.changes).toMatchObject({ resourceKey: { old: null, new: 'WRB-MEDICAL_RECORD_COPY-20260723-0001' } });
    });

    it('대조군: UUID resourceId 는 그대로 저장하고 resourceKey 를 끼워 넣지 않는다', async () => {
      vi.mocked(mockPrisma.auditLog.create).mockResolvedValue({ id: 'log-y' });
      await service.log({ userId: U1, action: 'READ' as any, resourceType: 'Patient', resourceId: P1, changes: { a: { old: 1, new: 2 } } });
      const data = vi.mocked(mockPrisma.auditLog.create).mock.calls[0][0].data;
      expect(data.resourceId).toBe(P1);
      expect(data.changes).toEqual({ a: { old: 1, new: 2 } });
    });

    it('userId 가 UUID 가 아니면(예: system) 행위자를 지어내지 않고 기록 불가로 스킵한다 — 버퍼에도 넣지 않는다', async () => {
      const result = await service.log({ userId: 'system', action: 'CREATE' as any, resourceType: 'IssuedDocument', resourceId: P1 });
      expect(result).toBeNull();
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });
  });
});
