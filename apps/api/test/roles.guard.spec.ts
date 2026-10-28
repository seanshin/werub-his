import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { PermissionService } from '../src/modules/auth/rbac/permission.service';
import { Permission } from '../src/modules/auth/rbac/permission.types';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: any;
  let permissionService: any;

  const mockExecutionContext = (user: any, roles?: UserRole[], permissions?: string[]) => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };

    return mockContext as any;
  };

  beforeEach(() => {
    reflector = {
      get: vi.fn(),
    };
    permissionService = {
      hasAnyPermission: vi.fn(),
    };
    guard = new RolesGuard(reflector, permissionService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Role-based access control', () => {
    it('should allow request when user role matches required roles', () => {
      const user = { id: 'user-1', role: UserRole.DOCTOR };
      const context = mockExecutionContext(user);

      // get calls: handlerRoles, classRoles, handlerPerms, classPerms
      vi.mocked(reflector.get)
        .mockReturnValueOnce([UserRole.DOCTOR, UserRole.ADMIN]) // handlerRoles
        .mockReturnValueOnce(undefined) // classRoles (not reached due to ??)
        .mockReturnValueOnce(undefined) // handlerPerms
        .mockReturnValueOnce(undefined); // classPerms

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should deny request when user role does not match required roles', () => {
      const user = { id: 'user-1', role: UserRole.NURSE };
      const context = mockExecutionContext(user);

      vi.mocked(reflector.get)
        .mockReturnValueOnce([UserRole.DOCTOR, UserRole.ADMIN])
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined);

      const result = guard.canActivate(context);
      expect(result).toBe(false);
    });

    it('should allow request when no roles are required', () => {
      const user = { id: 'user-1', role: UserRole.LAB_TECH };
      const context = mockExecutionContext(user);

      vi.mocked(reflector.get)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined);

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow request when roles array is empty', () => {
      const user = { id: 'user-1', role: UserRole.PHARMACIST };
      const context = mockExecutionContext(user);

      vi.mocked(reflector.get)
        .mockReturnValueOnce([])
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined);

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  describe('Permission-based access control', () => {
    it('should allow request when user has required permission', () => {
      const user = { id: 'user-1', role: UserRole.DOCTOR };
      const context = mockExecutionContext(user);

      vi.mocked(reflector.get)
        .mockReturnValueOnce(undefined) // handlerRoles
        .mockReturnValueOnce(undefined) // classRoles
        .mockReturnValueOnce([Permission.PATIENT_VIEW]) // handlerPerms
        .mockReturnValueOnce(undefined); // classPerms
      vi.mocked(permissionService.hasAnyPermission).mockReturnValue(true);

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should throw ForbiddenException when user lacks required permission', () => {
      const user = { id: 'user-1', role: UserRole.LAB_TECH };
      const context = mockExecutionContext(user);

      vi.mocked(reflector.get)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce([Permission.PATIENT_DELETE])
        .mockReturnValueOnce(undefined);
      vi.mocked(permissionService.hasAnyPermission).mockReturnValue(false);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should handle multiple permissions', () => {
      const user = { id: 'user-1', role: UserRole.DOCTOR };
      const context = mockExecutionContext(user);

      vi.mocked(reflector.get)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce([Permission.PATIENT_CREATE, Permission.PATIENT_EDIT])
        .mockReturnValueOnce(undefined);
      vi.mocked(permissionService.hasAnyPermission).mockReturnValue(true);

      const result = guard.canActivate(context);
      expect(result).toBe(true);
      expect(permissionService.hasAnyPermission).toHaveBeenCalledWith(
        { userId: 'user-1', userRole: UserRole.DOCTOR },
        [Permission.PATIENT_CREATE, Permission.PATIENT_EDIT],
      );
    });
  });

  describe('Combined role + permission checks', () => {
    it('should check both role and permission', () => {
      const user = { id: 'user-1', role: UserRole.DOCTOR };
      const context = mockExecutionContext(user);

      vi.mocked(reflector.get)
        .mockReturnValueOnce([UserRole.DOCTOR, UserRole.ADMIN]) // handlerRoles
        .mockReturnValueOnce(undefined) // classRoles
        .mockReturnValueOnce([Permission.PATIENT_CREATE]) // handlerPerms
        .mockReturnValueOnce(undefined); // classPerms
      vi.mocked(permissionService.hasAnyPermission).mockReturnValue(true);

      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should deny if role matches but permission fails', () => {
      const user = { id: 'user-1', role: UserRole.NURSE };
      const context = mockExecutionContext(user);

      vi.mocked(reflector.get)
        .mockReturnValueOnce([UserRole.DOCTOR, UserRole.NURSE])
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce([Permission.SYSTEM_MANAGE])
        .mockReturnValueOnce(undefined);
      vi.mocked(permissionService.hasAnyPermission).mockReturnValue(false);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should deny if role fails regardless of permission', () => {
      const user = { id: 'user-1', role: UserRole.PHARMACIST };
      const context = mockExecutionContext(user);

      vi.mocked(reflector.get)
        .mockReturnValueOnce([UserRole.DOCTOR]) // handlerRoles
        .mockReturnValueOnce(undefined) // classRoles
        .mockReturnValueOnce(undefined) // handlerPerms
        .mockReturnValueOnce(undefined); // classPerms

      const result = guard.canActivate(context);
      expect(result).toBe(false);
    });
  });
});
