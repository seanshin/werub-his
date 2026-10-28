/**
 * 🔴 `/auth/me` 는 **역할 권한 오버라이드가 반영된 유효 권한**을 내려야 한다.
 *
 * 원 결함(2026-08-18 실측): `me()` 가 코드 상수 `ROLE_PERMISSIONS[role]` 을 그대로 배열로 내려줬다.
 * 판정 정본은 `RolesGuard` → `PermissionService.hasPermission`(오버라이드 우선)이라, `/admin/rbac` 에서
 * 권한을 조정해도 화면만 옛 권한으로 그려졌다. 두 방향 모두 거짓말이다.
 *   - 회수(false) 했는데 화면에 버튼이 남는다 → 누르면 403. "할 수 있다"고 말한 화면이 틀렸다.
 *   - 허용(true) 했는데 화면이 기능을 숨긴다 → 실제로는 되는 일을 안 된다고 말한다.
 *
 * 이 스펙은 컨트롤러를 직접 조립해(가드 없이) `me()` 의 권한 산출만 검증한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { PermissionOverrideService } from '../../src/modules/auth/rbac/permission-override.service';
import { PermissionService } from '../../src/modules/auth/rbac/permission.service';
import { Permission, ROLE_PERMISSIONS } from '../../src/modules/auth/rbac/permission.types';

async function buildController(stored: Record<string, unknown>, role: UserRole) {
  const prisma: any = {
    systemConfig: {
      findUnique: vi.fn().mockResolvedValue({ value: stored }),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  const overrides = new PermissionOverrideService(prisma);
  await overrides.reload();
  const permissions = new PermissionService(overrides);
  const authService: any = {
    getProfile: vi.fn().mockResolvedValue({ id: 'u1', email: 'x@y.example', role }),
  };
  const configRuntime: any = { get: vi.fn().mockResolvedValue(null) };
  const controller = new AuthController(authService, configRuntime, permissions);
  return { controller, permissions };
}

async function mePermissions(stored: Record<string, unknown>, role: UserRole): Promise<string[]> {
  const { controller } = await buildController(stored, role);
  const res: any = await controller.me('u1');
  return res.data.permissions as string[];
}

describe('/auth/me 는 역할 권한 오버라이드를 반영한다', () => {
  it('🔴 회수(false) 한 권한은 목록에서 빠진다 — 화면이 없는 권한을 있다고 말하지 않게', async () => {
    expect(ROLE_PERMISSIONS[UserRole.NURSE]?.has(Permission.PATIENT_EDIT)).toBe(true); // 전제 확인
    const perms = await mePermissions({ NURSE: { [Permission.PATIENT_EDIT]: false } }, UserRole.NURSE);
    expect(perms).not.toContain(Permission.PATIENT_EDIT);
  });

  it('🔴 허용(true) 한 권한은 목록에 들어온다 — 실제로 되는 일을 안 된다고 말하지 않게', async () => {
    expect(ROLE_PERMISSIONS[UserRole.PHARMACIST]?.has(Permission.PATIENT_VIEW_CONTACT)).toBe(false); // 전제 확인
    const perms = await mePermissions({ PHARMACIST: { [Permission.PATIENT_VIEW_CONTACT]: true } }, UserRole.PHARMACIST);
    expect(perms).toContain(Permission.PATIENT_VIEW_CONTACT);
  });

  it('넓히는 방향이 안전한 근거 — /auth/me 와 RolesGuard 가 같은 판정자를 쓴다', async () => {
    const { controller, permissions } = await buildController(
      { PHARMACIST: { [Permission.PATIENT_VIEW_CONTACT]: true } },
      UserRole.PHARMACIST,
    );
    const res: any = await controller.me('u1');
    // RolesGuard 는 @RequirePermission 을 이 함수로 판정한다 → 화면이 여는 것과 API 가 허용하는 것이 같다
    expect(permissions.hasPermission(
      { userId: 'u1', userRole: UserRole.PHARMACIST }, Permission.PATIENT_VIEW_CONTACT,
    )).toBe(true);
    expect(res.data.permissions).toContain(Permission.PATIENT_VIEW_CONTACT);
  });

  it('오버라이드가 없으면 코드 기본 매트릭스와 정확히 같다(회귀 방지)', async () => {
    for (const role of Object.values(UserRole)) {
      const perms = await mePermissions({}, role);
      expect([...perms].sort()).toEqual([...(ROLE_PERMISSIONS[role] ?? new Set())].sort());
    }
  });

  it('🔴 ADMIN 은 오버라이드로 잠기지 않는다', async () => {
    const perms = await mePermissions({ ADMIN: { [Permission.SYSTEM_MANAGE]: false } }, UserRole.ADMIN);
    expect(perms).toContain(Permission.SYSTEM_MANAGE);
  });
});
