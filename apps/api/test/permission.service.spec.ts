import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { PermissionService } from '../src/modules/auth/rbac/permission.service';
import { Permission } from '../src/modules/auth/rbac/permission.types';

describe('PermissionService', () => {
  let service: PermissionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PermissionService],
    }).compile();

    service = module.get<PermissionService>(PermissionService);
  });

  describe('hasPermission', () => {
    it('should return true for admin with all permissions', () => {
      const context = { userId: 'user-1', userRole: UserRole.ADMIN };
      const result = service.hasPermission(context, Permission.PATIENT_CREATE);
      expect(result).toBe(true);
    });

    it('should return true for doctor with PATIENT_VIEW', () => {
      const context = { userId: 'user-1', userRole: UserRole.DOCTOR };
      const result = service.hasPermission(context, Permission.PATIENT_VIEW);
      expect(result).toBe(true);
    });

    it('should return false for nurse with USER_DELETE', () => {
      const context = { userId: 'user-1', userRole: UserRole.NURSE };
      const result = service.hasPermission(context, Permission.USER_DELETE);
      expect(result).toBe(false);
    });

    it('should return false for lab_tech with BILLING_EDIT', () => {
      const context = { userId: 'user-1', userRole: UserRole.LAB_TECH };
      const result = service.hasPermission(context, Permission.BILLING_EDIT);
      expect(result).toBe(false);
    });

    it('급양(NUTRITION)은 환자 기본 조회만 — 임상/처방/오더/청구 권한 없음', () => {
      const ctx = { userId: 'u-nut', userRole: UserRole.NUTRITION };
      // 급식 대상 식별용 기본 조회는 허용
      expect(service.hasPermission(ctx, Permission.PATIENT_VIEW)).toBe(true);
      expect(service.hasPermission(ctx, Permission.DASHBOARD_VIEW)).toBe(true);
      // 임상·처방·오더·청구·PHI 신원은 불가(급식 담당이 가지면 안 되는 권한)
      for (const p of [Permission.PRESCRIPTION_CREATE, Permission.ORDER_CREATE, Permission.ENCOUNTER_CREATE, Permission.BILLING_EDIT, Permission.PATIENT_VIEW_IDENTITY, Permission.USER_EDIT]) {
        expect(service.hasPermission(ctx, p)).toBe(false);
      }
    });

    it('행정직(ADMIN_STAFF)은 대시보드만 — 환자/임상/처방 권한 없음', () => {
      const ctx = { userId: 'u-adm', userRole: UserRole.ADMIN_STAFF };
      expect(service.hasPermission(ctx, Permission.DASHBOARD_VIEW)).toBe(true);
      for (const p of [Permission.PATIENT_VIEW, Permission.PRESCRIPTION_CREATE, Permission.ORDER_CREATE, Permission.ENCOUNTER_VIEW, Permission.BILLING_EDIT]) {
        expect(service.hasPermission(ctx, p)).toBe(false);
      }
    });

    it('의무기록사(MEDICAL_RECORDS)는 환자·진료 열람만 — 임상 작성/처방/오더 없음', () => {
      const ctx = { userId: 'u-mr', userRole: UserRole.MEDICAL_RECORDS };
      expect(service.hasPermission(ctx, Permission.PATIENT_VIEW)).toBe(true);
      expect(service.hasPermission(ctx, Permission.ENCOUNTER_VIEW)).toBe(true);
      for (const p of [Permission.PRESCRIPTION_CREATE, Permission.ORDER_CREATE, Permission.ENCOUNTER_CREATE, Permission.ENCOUNTER_EDIT, Permission.PATIENT_DELETE]) {
        expect(service.hasPermission(ctx, p)).toBe(false);
      }
    });

    it('검진센터(CHECKUP)는 환자·수납·진료열람만 — 본원 처방/오더/기록작성 없음', () => {
      const ctx = { userId: 'u-ck', userRole: UserRole.CHECKUP };
      expect(service.hasPermission(ctx, Permission.PATIENT_VIEW)).toBe(true);
      expect(service.hasPermission(ctx, Permission.BILLING_CREATE)).toBe(true); // 검진 수납
      for (const p of [Permission.PRESCRIPTION_CREATE, Permission.ORDER_CREATE, Permission.ENCOUNTER_CREATE, Permission.PATIENT_DELETE, Permission.SYSTEM_MANAGE]) {
        expect(service.hasPermission(ctx, p)).toBe(false);
      }
    });

    it('should return true for pharmacist with PRESCRIPTION_EDIT', () => {
      const context = { userId: 'user-1', userRole: UserRole.PHARMACIST };
      const result = service.hasPermission(context, Permission.PRESCRIPTION_EDIT);
      expect(result).toBe(true);
    });
  });

  describe('hasAnyPermission', () => {
    it('should return true if user has at least one permission', () => {
      const context = { userId: 'user-1', userRole: UserRole.DOCTOR };
      const permissions = [Permission.PATIENT_DELETE, Permission.PATIENT_VIEW];
      const result = service.hasAnyPermission(context, permissions);
      expect(result).toBe(true);
    });

    it('should return false if user has none of the permissions', () => {
      const context = { userId: 'user-1', userRole: UserRole.LAB_TECH };
      const permissions = [Permission.PATIENT_DELETE, Permission.PRESCRIPTION_DELETE];
      const result = service.hasAnyPermission(context, permissions);
      expect(result).toBe(false);
    });

    it('should handle string array (from decorator)', () => {
      const context = { userId: 'user-1', userRole: UserRole.DOCTOR };
      const permissions = [Permission.PATIENT_VIEW, Permission.PATIENT_DELETE];
      const result = service.hasAnyPermission(context, permissions as any);
      expect(result).toBe(true);
    });
  });

  describe('hasAllPermissions', () => {
    it('should return true if user has all permissions', () => {
      const context = { userId: 'user-1', userRole: UserRole.ADMIN };
      const permissions = [Permission.PATIENT_CREATE, Permission.PATIENT_EDIT, Permission.PATIENT_DELETE];
      const result = service.hasAllPermissions(context, permissions);
      expect(result).toBe(true);
    });

    it('should return false if user lacks one permission', () => {
      const context = { userId: 'user-1', userRole: UserRole.DOCTOR };
      const permissions = [Permission.PATIENT_CREATE, Permission.PATIENT_DELETE];
      const result = service.hasAllPermissions(context, permissions);
      expect(result).toBe(false);
    });
  });

  describe('getRolePermissions', () => {
    it('should return all permissions for admin role', () => {
      const permissions = service.getRolePermissions(UserRole.ADMIN);
      expect(permissions.size).toBeGreaterThan(0);
      expect(permissions.has(Permission.PATIENT_VIEW)).toBe(true);
      expect(permissions.has(Permission.SYSTEM_MANAGE)).toBe(true);
    });

    it('should return limited permissions for nurse role', () => {
      const permissions = service.getRolePermissions(UserRole.NURSE);
      expect(permissions.has(Permission.PATIENT_VIEW)).toBe(true);
      expect(permissions.has(Permission.USER_DELETE)).toBe(false);
    });

    it('should return empty set for unknown role', () => {
      const permissions = service.getRolePermissions('UNKNOWN' as UserRole);
      expect(permissions.size).toBe(0);
    });
  });

  describe('getPermissionMatrix', () => {
    it('should return matrix for all roles', () => {
      const matrix = service.getPermissionMatrix();
      expect(matrix[UserRole.ADMIN]).toBeDefined();
      expect(matrix[UserRole.DOCTOR]).toBeDefined();
      expect(matrix[UserRole.NURSE]).toBeDefined();
      expect(matrix[UserRole.PHARMACIST]).toBeDefined();
      expect(matrix[UserRole.LAB_TECH]).toBeDefined();
    });

    it('should have admin permissions >= other roles', () => {
      const matrix = service.getPermissionMatrix();
      const adminCount = matrix[UserRole.ADMIN].length;
      const doctorCount = matrix[UserRole.DOCTOR].length;
      const nurseCount = matrix[UserRole.NURSE].length;

      expect(adminCount).toBeGreaterThanOrEqual(doctorCount);
      expect(doctorCount).toBeGreaterThanOrEqual(nurseCount);
    });
  });

  describe('Role hierarchy', () => {
    it('should verify DOCTOR has more permissions than NURSE', () => {
      const doctorPerms = service.getRolePermissions(UserRole.DOCTOR);
      const nursePerms = service.getRolePermissions(UserRole.NURSE);

      // Doctor can create encounters, nurse cannot
      expect(doctorPerms.has(Permission.ENCOUNTER_CREATE)).toBe(true);
      expect(nursePerms.has(Permission.ENCOUNTER_CREATE)).toBe(false);
    });

    it('should verify PHARMACIST can edit prescriptions', () => {
      const pharmacistPerms = service.getRolePermissions(UserRole.PHARMACIST);
      expect(pharmacistPerms.has(Permission.PRESCRIPTION_EDIT)).toBe(true);
      expect(pharmacistPerms.has(Permission.PRESCRIPTION_VIEW)).toBe(true);
    });

    it('should verify LAB_TECH can edit orders', () => {
      const labPerms = service.getRolePermissions(UserRole.LAB_TECH);
      expect(labPerms.has(Permission.ORDER_EDIT)).toBe(true);
      expect(labPerms.has(Permission.ORDER_VIEW)).toBe(true);
    });
  });
});
