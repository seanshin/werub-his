import { describe, it, expect, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../src/modules/auth/guards/roles.guard';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { PERMISSION_KEY } from '../../src/common/decorators/require-permission.decorator';

/**
 * RolesGuard 정본 계약 — 2026-07 RBAC 매트릭스 전수.
 *
 * 🔴 핵심 위험: **@Roles·@RequirePermission 이 없으면 role 검증을 건너뛰고 통과**한다
 *    (인증된 모든 역할 접근). 민감 변이 EP 에서 이 둘을 누락하면 과대 권한이 된다.
 *    이 동작을 계약으로 고정해, 스캐너(scripts/rbac-scan.js)와 함께 재발을 막는다.
 */
function ctx(user: any, meta: { roles?: UserRole[]; perms?: string[] } = {}) {
  const reflector = {
    get: (key: string) => {
      if (key === ROLES_KEY) return meta.roles;
      if (key === PERMISSION_KEY) return meta.perms;
      return undefined;
    },
  };
  const host: any = {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  };
  return { reflector, host };
}

describe('RolesGuard 계약', () => {
  const perm = { hasAnyPermission: vi.fn().mockReturnValue(true) };

  it('🔴 @Roles·@RequirePermission 둘 다 없으면 통과(모든 인증 역할) — 민감 EP 는 반드시 하나를 붙일 것', () => {
    const g = new RolesGuard(ctx({ role: UserRole.LAB_TECH }).reflector as any, perm as any);
    const { host } = ctx({ role: UserRole.LAB_TECH });
    expect(g.canActivate(host)).toBe(true); // 통제 없음 = 통과 — 이것이 과대 권한의 근원
  });

  it('@Roles 지정 시 해당 역할만 통과', () => {
    const built = ctx({ role: UserRole.NURSE }, { roles: [UserRole.DOCTOR] });
    const g = new RolesGuard(built.reflector as any, perm as any);
    expect(g.canActivate(built.host)).toBe(false); // NURSE 는 DOCTOR 전용 EP 거부
  });

  it('@Roles 에 포함된 역할은 통과', () => {
    const built = ctx({ role: UserRole.DOCTOR }, { roles: [UserRole.DOCTOR, UserRole.NURSE] });
    const g = new RolesGuard(built.reflector as any, perm as any);
    expect(g.canActivate(built.host)).toBe(true);
  });

  it('ADMIN 은 모든 @Roles 를 bypass', () => {
    const built = ctx({ role: UserRole.ADMIN }, { roles: [UserRole.DOCTOR] });
    const g = new RolesGuard(built.reflector as any, perm as any);
    expect(g.canActivate(built.host)).toBe(true);
  });

  it('@RequirePermission 은 permission 서비스로 판정(권한 없으면 Forbidden)', () => {
    const deny = { hasAnyPermission: vi.fn().mockReturnValue(false) };
    const built = ctx({ role: UserRole.NURSE, id: 'u1' }, { perms: ['RETENTION_MANAGE'] });
    const g = new RolesGuard(built.reflector as any, deny as any);
    expect(() => g.canActivate(built.host)).toThrow(/Insufficient permissions/);
  });

  it('permission 만으로도 통제 가능(@Roles 없이) — retention 패턴', () => {
    const built = ctx({ role: UserRole.ADMIN, id: 'u1' }, { perms: ['RETENTION_MANAGE'] });
    const g = new RolesGuard(built.reflector as any, perm as any);
    expect(g.canActivate(built.host)).toBe(true); // permission 통과
  });
});
