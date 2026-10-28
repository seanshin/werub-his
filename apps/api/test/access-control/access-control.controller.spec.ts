import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AccessControlController } from '../../src/modules/access-control/access-control.controller';
import { AccessControlService } from '../../src/modules/access-control/access-control.service';

describe('AccessControlController', () => {
  let controller: AccessControlController;
  let service: AccessControlService;

  beforeEach(() => {
    service = {
      getMenuPaths: vi.fn(),
      getDepartments: vi.fn(),
      getAllDeptAccess: vi.fn(),
      getDeptAccess: vi.fn(),
      setDeptAccess: vi.fn(),
      deleteDeptAccess: vi.fn(),
      getDataAccessFields: vi.fn(),
      getAllRoleDataAccess: vi.fn(),
      getRoleDataAccess: vi.fn(),
      setRoleDataAccess: vi.fn(),
      resetRoleDataAccess: vi.fn(),
    } as any;

    controller = new AccessControlController(service);
  });

  describe('getMenuPaths', () => {
    it('should return all available menu paths', async () => {
      const mockMenuPaths = [
        { path: '/dashboard', label: '대시보드', section: '임상' },
        { path: '/patients', label: '환자', section: '임상' },
        { path: '/admin/staff-management', label: '직원관리', section: '관리자' },
      ];

      vi.mocked(service.getMenuPaths).mockReturnValue(mockMenuPaths);

      const result = await controller.getMenuPaths();

      expect(result.data).toHaveLength(3);
      expect(result.data[0]).toHaveProperty('path');
      expect(result.data[0]).toHaveProperty('label');
      expect(result.data[0]).toHaveProperty('section');
      expect(service.getMenuPaths).toHaveBeenCalled();
    });
  });

  describe('getDepartments', () => {
    it('should return all departments with access info', async () => {
      const mockDepartments = [
        { department: '급양과', accessCount: 5 },
        { department: '원무과', accessCount: 3 },
        { department: '행정과', accessCount: 4 },
      ];

      vi.mocked(service.getDepartments).mockResolvedValue(mockDepartments);

      const result = await controller.getDepartments();

      expect(result.data).toHaveLength(3);
      expect(result.data[0]).toHaveProperty('department');
      expect(result.data[0]).toHaveProperty('accessCount');
      expect(service.getDepartments).toHaveBeenCalled();
    });
  });

  describe('getAllDeptAccess', () => {
    it('should return all department access settings', async () => {
      const mockDeptAccess = {
        급양과: ['/dashboard', '/menu'],
        원무과: ['/dashboard', '/reception'],
        행정과: ['/dashboard', '/admin'],
      };

      vi.mocked(service.getAllDeptAccess).mockResolvedValue(mockDeptAccess);

      const result = await controller.getAllDeptAccess();

      expect(result.data).toBeDefined();
      expect(result.data['급양과']).toEqual(['/dashboard', '/menu']);
      expect(service.getAllDeptAccess).toHaveBeenCalled();
    });
  });

  describe('getDeptAccess', () => {
    it('should return access paths for specific department', async () => {
      const mockAccess = ['/dashboard', '/nutrition', '/menu'];

      vi.mocked(service.getDeptAccess).mockResolvedValue(mockAccess);

      const result = await controller.getDeptAccess('급양과');

      expect(result.data).toEqual(mockAccess);
      expect(result.data).toHaveLength(3);
      expect(service.getDeptAccess).toHaveBeenCalledWith('급양과');
    });

    it('should return empty array for unknown department', async () => {
      vi.mocked(service.getDeptAccess).mockResolvedValue([]);

      const result = await controller.getDeptAccess('unknown-dept');

      expect(result.data).toEqual([]);
      expect(service.getDeptAccess).toHaveBeenCalledWith('unknown-dept');
    });
  });

  describe('setDeptAccess', () => {
    it('should update department access paths', async () => {
      const allowedPaths = ['/dashboard', '/reception', '/patients'];
      const mockConfig = {
        key: 'access.dept.원무과',
        value: { allowedPaths },
        category: 'access',
      };

      vi.mocked(service.setDeptAccess).mockResolvedValue(mockConfig);

      const result = await controller.setDeptAccess('원무과', { allowedPaths }, 'admin-1');

      expect(result.data.value.allowedPaths).toEqual(allowedPaths);
      expect(service.setDeptAccess).toHaveBeenCalledWith('원무과', allowedPaths, 'admin-1');
    });

    it('should store admin user who made the change', async () => {
      const allowedPaths = ['/dashboard'];
      const mockConfig = {
        key: 'access.dept.test',
        value: { allowedPaths },
        updatedBy: 'admin-user-123',
      };

      vi.mocked(service.setDeptAccess).mockResolvedValue(mockConfig);

      await controller.setDeptAccess('test', { allowedPaths }, 'admin-user-123');

      expect(service.setDeptAccess).toHaveBeenCalledWith('test', allowedPaths, 'admin-user-123');
    });
  });

  describe('deleteDeptAccess', () => {
    it('should reset department access to default', async () => {
      vi.mocked(service.deleteDeptAccess).mockResolvedValue(undefined);

      const result = await controller.deleteDeptAccess('급양과');

      expect(result.data.reset).toBe(true);
      expect(result.data.department).toBe('급양과');
      expect(service.deleteDeptAccess).toHaveBeenCalledWith('급양과');
    });
  });

  describe('getDataAccessFields', () => {
    it('should return data access field definitions', async () => {
      const mockFields = [
        { key: 'canRegister', label: '환자등록', category: '기본' },
        { key: 'showPhone', label: '전화번호', category: '개인정보' },
        { key: 'showAllergy', label: '알레르기', category: '임상' },
      ];

      vi.mocked(service.getDataAccessFields).mockReturnValue(mockFields);

      const result = await controller.getDataAccessFields();

      expect(result.data).toHaveLength(3);
      expect(result.data[0]).toHaveProperty('key');
      expect(result.data[0]).toHaveProperty('label');
      expect(result.data[0]).toHaveProperty('category');
      expect(service.getDataAccessFields).toHaveBeenCalled();
    });

    it('should include personal info and clinical fields', async () => {
      const mockFields = [
        { key: 'canRegister', label: '환자등록', category: '기본' },
        { key: 'showPhone', label: '전화번호', category: '개인정보' },
        { key: 'showAllergy', label: '알레르기', category: '임상' },
      ];

      vi.mocked(service.getDataAccessFields).mockReturnValue(mockFields);

      const result = await controller.getDataAccessFields();

      const personalFields = result.data.filter((f: any) => f.category === '개인정보');
      const clinicalFields = result.data.filter((f: any) => f.category === '임상');

      expect(personalFields.length).toBeGreaterThan(0);
      expect(clinicalFields.length).toBeGreaterThan(0);
    });
  });

  describe('getAllRoleDataAccess', () => {
    it('should return data access settings for all roles', async () => {
      const mockRoleAccess = {
        DOCTOR: { canRegister: true, showPhone: true, showAllergy: true },
        NURSE: { canRegister: true, showPhone: true, showAllergy: true },
        PHARMACIST: { canRegister: false, showPhone: false, showAllergy: true },
      };

      vi.mocked(service.getAllRoleDataAccess).mockResolvedValue(mockRoleAccess);

      const result = await controller.getAllRoleDataAccess();

      expect(result.data).toBeDefined();
      expect(result.data.DOCTOR).toBeDefined();
      expect(result.data.NURSE).toBeDefined();
      expect(result.data.PHARMACIST).toBeDefined();
      expect(service.getAllRoleDataAccess).toHaveBeenCalled();
    });
  });

  describe('getRoleDataAccess', () => {
    it('should return data access permissions for specific role', async () => {
      const mockAccess = {
        canRegister: true,
        showPhone: true,
        showAllergy: true,
        showBilling: false,
      };

      vi.mocked(service.getRoleDataAccess).mockResolvedValue(mockAccess);

      const result = await controller.getRoleDataAccess('DOCTOR');

      expect(result.data).toEqual(mockAccess);
      expect(result.data.canRegister).toBe(true);
      expect(result.data.showBilling).toBe(false);
      expect(service.getRoleDataAccess).toHaveBeenCalledWith('DOCTOR');
    });

    it('should handle different roles with different permissions', async () => {
      const mockAccess = {
        canRegister: false,
        showPhone: false,
        showAllergy: true,
      };

      vi.mocked(service.getRoleDataAccess).mockResolvedValue(mockAccess);

      const result = await controller.getRoleDataAccess('PHARMACIST');

      expect(result.data.canRegister).toBe(false);
      expect(result.data.showAllergy).toBe(true);
      expect(service.getRoleDataAccess).toHaveBeenCalledWith('PHARMACIST');
    });
  });

  describe('setRoleDataAccess', () => {
    it('should update role data access permissions', async () => {
      const permissions = {
        canRegister: true,
        showPhone: true,
        showAllergy: true,
        showBilling: false,
      };

      const mockConfig = {
        key: 'access.role.DOCTOR',
        value: permissions,
        updatedBy: 'admin-1',
      };

      vi.mocked(service.setRoleDataAccess).mockResolvedValue(mockConfig);

      const result = await controller.setRoleDataAccess('DOCTOR', { permissions }, 'admin-1');

      expect(result.data.value).toEqual(permissions);
      expect(service.setRoleDataAccess).toHaveBeenCalledWith('DOCTOR', permissions, 'admin-1');
    });

    it('should record admin user who made the change', async () => {
      const permissions = { canRegister: true };

      vi.mocked(service.setRoleDataAccess).mockResolvedValue({
        key: 'access.role.NURSE',
        value: permissions,
        updatedBy: 'admin-123',
      });

      await controller.setRoleDataAccess('NURSE', { permissions }, 'admin-123');

      expect(service.setRoleDataAccess).toHaveBeenCalledWith('NURSE', permissions, 'admin-123');
    });
  });

  describe('resetRoleDataAccess', () => {
    it('should reset role data access to default', async () => {
      vi.mocked(service.resetRoleDataAccess).mockResolvedValue(undefined);

      const result = await controller.resetRoleDataAccess('PHARMACIST');

      expect(result.data.reset).toBe(true);
      expect(result.data.role).toBe('PHARMACIST');
      expect(service.resetRoleDataAccess).toHaveBeenCalledWith('PHARMACIST');
    });
  });
});
