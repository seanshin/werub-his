import { Injectable, Optional } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Permission, ROLE_PERMISSIONS, PermissionContext } from './permission.types';
import { PermissionOverrideService } from './permission-override.service';

@Injectable()
export class PermissionService {
  constructor(@Optional() private readonly overrides?: PermissionOverrideService) {}

  /**
   * 권한 판정 — **관리 화면 오버라이드가 코드 기본값을 이긴다**(명시 허용/차단).
   * 오버라이드가 없으면 역할 기본 매트릭스(ROLE_PERMISSIONS)를 따른다.
   */
  hasPermission(context: PermissionContext, requiredPermission: Permission): boolean {
    const override = this.overrides?.get(context.userRole, requiredPermission);
    if (override !== undefined) return override;
    const userPermissions = ROLE_PERMISSIONS[context.userRole];
    return userPermissions?.has(requiredPermission) ?? false;
  }

  /** 화면 표시용 — 기본값 대비 무엇이 바뀌었는지 함께 낸다 */
  effectivePermissions(role: UserRole): { key: string; allowed: boolean; overridden: boolean }[] {
    const defaults = ROLE_PERMISSIONS[role] ?? new Set<Permission>();
    return Object.values(Permission).map((p) => {
      const override = this.overrides?.get(role, p);
      return {
        key: p,
        allowed: override !== undefined ? override : defaults.has(p),
        overridden: override !== undefined,
      };
    });
  }

  /**
   * Check if a user has any of the required permissions
   */
  hasAnyPermission(context: PermissionContext, requiredPermissions: Permission[] | string[]): boolean {
    return requiredPermissions.some(permission => this.hasPermission(context, permission as Permission));
  }

  /**
   * Check if a user has all of the required permissions
   */
  hasAllPermissions(context: PermissionContext, requiredPermissions: Permission[] | string[]): boolean {
    return requiredPermissions.every(permission => this.hasPermission(context, permission as Permission));
  }

  /**
   * Get all permissions for a role
   */
  getRolePermissions(role: UserRole): Set<Permission> {
    return ROLE_PERMISSIONS[role] ?? new Set();
  }

  /**
   * Get all available permissions
   */
  getAllPermissions(): string[] {
    return Object.values(Permission);
  }

  /**
   * Get permission matrix as a readable format
   */
  getPermissionMatrix(): Record<UserRole, string[]> {
    const matrix: Record<UserRole, string[]> = {} as Record<UserRole, string[]>;
    Object.entries(ROLE_PERMISSIONS).forEach(([role, permissions]) => {
      matrix[role as UserRole] = Array.from(permissions);
    });
    return matrix;
  }
}
