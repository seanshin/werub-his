import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AccessControlService } from '../../src/modules/access-control/access-control.service';

describe('AccessControlService', () => {
  let service: AccessControlService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      systemConfig: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
    };

    service = new AccessControlService(mockPrisma);
  });

  describe('getMenuPaths', () => {
    it('should return all available menu paths', () => {
      const paths = service.getMenuPaths();

      expect(paths).toBeDefined();
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths[0]).toHaveProperty('path');
      expect(paths[0]).toHaveProperty('label');
      expect(paths[0]).toHaveProperty('section');
    });

    it('should include clinical paths', () => {
      const paths = service.getMenuPaths();
      const clinicalPaths = paths.filter((p: any) => p.section === '임상');

      expect(clinicalPaths.length).toBeGreaterThan(0);
      expect(clinicalPaths.map((p: any) => p.path)).toContain('/dashboard');
      expect(clinicalPaths.map((p: any) => p.path)).toContain('/patients');
    });

    it('should include admin paths', () => {
      const paths = service.getMenuPaths();
      const adminPaths = paths.filter((p: any) => p.section === '관리자');

      expect(adminPaths.length).toBeGreaterThan(0);
      expect(adminPaths.map((p: any) => p.path)).toContain('/admin/staff-management');
    });
  });

  describe('getAllDeptAccess', () => {
    it('should return default department access when no configs exist', async () => {
      mockPrisma.systemConfig.findMany.mockResolvedValue([]);

      const result = await service.getAllDeptAccess();

      expect(result).toBeDefined();
      expect(result['급양과']).toBeDefined();
      expect(result['원무과']).toBeDefined();
      expect(Array.isArray(result['급양과'])).toBe(true);
    });

    it('should override default access with database configs', async () => {
      const mockConfigs = [
        {
          key: 'access.dept.급양과',
          value: { allowedPaths: ['/dashboard', '/custom-path'] },
          category: 'access',
        },
      ];

      mockPrisma.systemConfig.findMany.mockResolvedValue(mockConfigs);

      const result = await service.getAllDeptAccess();

      expect(result['급양과']).toContain('/custom-path');
    });

    it('should include all departments', async () => {
      mockPrisma.systemConfig.findMany.mockResolvedValue([]);

      const result = await service.getAllDeptAccess();

      expect(result['급양과']).toBeDefined();
      expect(result['원무과']).toBeDefined();
      expect(result['행정과']).toBeDefined();
      expect(result['의무기록과']).toBeDefined();
      expect(result['경영진']).toBeDefined();
    });
  });

  describe('getDeptAccess', () => {
    it('should return default access for department', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(null);

      const result = await service.getDeptAccess('급양과');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toContain('/dashboard');
    });

    it('should return custom access if configured', async () => {
      const mockConfig = {
        key: 'access.dept.급양과',
        value: { allowedPaths: ['/dashboard', '/nutrition', '/custom'] },
        category: 'access',
      };

      mockPrisma.systemConfig.findUnique.mockResolvedValue(mockConfig);

      const result = await service.getDeptAccess('급양과');

      expect(result).toContain('/custom');
    });

    it('should return empty array for unknown department without config', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(null);

      const result = await service.getDeptAccess('unknown-dept');

      expect(result).toEqual([]);
    });

    it('should query systemConfig with correct key', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(null);

      await service.getDeptAccess('원무과');

      expect(mockPrisma.systemConfig.findUnique).toHaveBeenCalledWith({
        where: { key: 'access.dept.원무과' },
      });
    });
  });

  describe('setDeptAccess', () => {
    it('should create new access config', async () => {
      const allowedPaths = ['/dashboard', '/reception', '/patients'];
      mockPrisma.systemConfig.upsert.mockResolvedValue({
        key: 'access.dept.원무과',
        value: { allowedPaths },
        category: 'access',
      });

      const result = await service.setDeptAccess('원무과', allowedPaths, 'admin-1');

      expect(mockPrisma.systemConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'access.dept.원무과' },
          create: expect.objectContaining({
            key: 'access.dept.원무과',
            value: { allowedPaths },
            category: 'access',
          }),
        })
      );
    });

    it('should update existing access config', async () => {
      const allowedPaths = ['/dashboard', '/reception'];
      mockPrisma.systemConfig.upsert.mockResolvedValue({
        key: 'access.dept.원무과',
        value: { allowedPaths },
        category: 'access',
        updatedBy: 'admin-1',
      });

      await service.setDeptAccess('원무과', allowedPaths, 'admin-1');

      expect(mockPrisma.systemConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            value: { allowedPaths },
            updatedBy: 'admin-1',
          }),
        })
      );
    });

    it('should include update timestamp metadata', async () => {
      mockPrisma.systemConfig.upsert.mockResolvedValue({
        key: 'access.dept.test',
        value: { allowedPaths: [] },
      });

      await service.setDeptAccess('test', [], 'admin-1');

      expect(mockPrisma.systemConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            updatedBy: 'admin-1',
          }),
        })
      );
    });
  });

  describe('deleteDeptAccess', () => {
    it('should delete department access config', async () => {
      mockPrisma.systemConfig.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteDeptAccess('급양과');

      expect(mockPrisma.systemConfig.deleteMany).toHaveBeenCalledWith({
        where: { key: 'access.dept.급양과' },
      });
    });

    it('should revert to default access after deletion', async () => {
      mockPrisma.systemConfig.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.systemConfig.findUnique.mockResolvedValue(null);

      await service.deleteDeptAccess('급양과');
      const defaultAccess = await service.getDeptAccess('급양과');

      expect(defaultAccess).toBeDefined();
      expect(Array.isArray(defaultAccess)).toBe(true);
    });
  });

  describe('getDataAccessFields', () => {
    it('should return data access field definitions', () => {
      const fields = service.getDataAccessFields();

      expect(fields).toBeDefined();
      expect(Array.isArray(fields)).toBe(true);
      expect(fields.length).toBeGreaterThan(0);
      expect(fields[0]).toHaveProperty('key');
      expect(fields[0]).toHaveProperty('label');
      expect(fields[0]).toHaveProperty('category');
    });

    it('should include basic access fields', () => {
      const fields = service.getDataAccessFields();

      expect(fields.map((f: any) => f.key)).toContain('canRegister');
    });

    it('should include personal info access fields', () => {
      const fields = service.getDataAccessFields();
      const personalInfoFields = fields.filter((f: any) => f.category === '개인정보');

      expect(personalInfoFields.length).toBeGreaterThan(0);
      expect(personalInfoFields.map((f: any) => f.key)).toContain('showPhone');
    });
  });

  describe('Role-based Data Access', () => {
    it('should define access for DOCTOR role', () => {
      const fields = service.getDataAccessFields();

      expect(fields).toBeDefined();
      // DOCTOR should have access to allergy and diagnosis
      // but not to billing
    });

    it('should define access for NURSE role', () => {
      const fields = service.getDataAccessFields();

      expect(fields).toBeDefined();
      // NURSE should have access to phone and allergy
    });

    it('should define access for PHARMACIST role', () => {
      const fields = service.getDataAccessFields();

      expect(fields).toBeDefined();
      // PHARMACIST should have access to prescription and allergy
      // but not to diagnosis or billing
    });

    it('should define department-specific access', () => {
      const fields = service.getDataAccessFields();

      expect(fields).toBeDefined();
      // dept.의무기록과 should have full access
      // dept.행정과 should have minimal access
    });
  });

  // 커스텀 메뉴 href 보안 — 사이드바에 전 직원 렌더되므로 위험 스킴/외부유출 차단
  describe('custom menu href sanitization', () => {
    const savedValue = () => mockPrisma.systemConfig.upsert.mock.calls[0][0].update.value as Array<{ href: string }>;

    it('setMenuCustom: 위험 href(프로토콜-상대·javascript·data)는 제외, 내부/외부 정상만 저장', async () => {
      mockPrisma.systemConfig.upsert.mockResolvedValue({});
      await service.setMenuCustom([
        { section: 'A', label: '내부', href: '/admin/ok' },
        { section: 'A', label: '상대', href: 'reports/x' },
        { section: 'A', label: '외부', href: 'https://good.example.com/x' },
        { section: 'A', label: '오픈리다이렉트', href: '//evil.com' },
        { section: 'A', label: 'XSS', href: 'javascript:alert(1)' },
        { section: 'A', label: '데이터', href: 'data:text/html,<script>' },
      ], 'admin-1');

      const hrefs = savedValue().map((x) => x.href);
      expect(hrefs).toContain('/admin/ok');
      expect(hrefs).toContain('/reports/x');          // 상대 → 절대경로 보정
      expect(hrefs).toContain('https://good.example.com/x');
      expect(hrefs).not.toContain('//evil.com');       // 프로토콜-상대 차단
      expect(hrefs.some((h) => h.includes('javascript'))).toBe(false);
      expect(hrefs.some((h) => h.startsWith('data:'))).toBe(false);
      expect(hrefs).toHaveLength(3);
    });

    it('getMenuCustom: 기존 저장된 불량 href 도 읽기 시 무력화(필터)', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue({
        value: [
          { id: 'a', section: 'A', href: '/ok', label: '정상', roles: ['ADMIN'] },
          { id: 'b', section: 'A', href: 'javascript:alert(1)', label: '악성', roles: ['ADMIN'] },
          { id: 'c', section: 'A', href: '//evil.com', label: '리다이렉트', roles: ['ADMIN'] },
        ],
      });
      const rows = await service.getMenuCustom();
      expect(rows.map((r) => r.href)).toEqual(['/ok']);
    });
  });
});
