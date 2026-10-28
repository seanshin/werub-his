'use client';

import { useAuthStore } from '@/stores/auth-store';

/** 현재 사용자가 특정 권한을 가지고 있는지 확인 */
export function useHasPermission(permission: string): boolean {
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  return permissions.includes(permission);
}

/** 현재 사용자가 모든 권한을 가지고 있는지 확인 */
export function useHasAllPermissions(required: string[]): boolean {
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  return required.every((p) => permissions.includes(p));
}

/** 역할 + 권한 동시 체크 (위젯 팔레트용) */
export function canAccessWidget(
  widgetRoles: string[],
  widgetPermissions: string[],
  userRole: string,
  userPermissions: string[],
): boolean {
  if (widgetRoles.length > 0 && !widgetRoles.includes(userRole)) return false;
  if (widgetPermissions.length > 0) {
    if (!widgetPermissions.every((p) => userPermissions.includes(p))) return false;
  }
  return true;
}
