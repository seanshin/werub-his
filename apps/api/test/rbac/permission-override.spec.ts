import { describe, it, expect, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { PermissionOverrideService } from '../../src/modules/auth/rbac/permission-override.service';
import { PermissionService } from '../../src/modules/auth/rbac/permission.service';
import { Permission } from '../../src/modules/auth/rbac/permission.types';
import { PERMISSION_CATALOG, uncatalogedPermissions } from '../../src/modules/auth/rbac/permission-catalog';

function build(stored: Record<string, unknown> = {}) {
  const prisma: any = {
    systemConfig: {
      findUnique: vi.fn().mockResolvedValue({ value: stored }),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  const ov = new PermissionOverrideService(prisma);
  return { ov, prisma, svc: new PermissionService(ov) };
}

describe('오버라이드가 코드 기본값을 이긴다', () => {
  it('명시 차단 — 기본 허용이어도 거부', async () => {
    const { ov, svc } = build({ NURSE: { [Permission.PATIENT_EDIT]: false } });
    await ov.reload();
    expect(svc.hasPermission({ userId: 'u', userRole: UserRole.NURSE }, Permission.PATIENT_EDIT)).toBe(false);
  });

  it('명시 허용 — 기본 거부여도 허용', async () => {
    const { ov, svc } = build({ PHARMACIST: { [Permission.PATIENT_VIEW_CONTACT]: true } });
    await ov.reload();
    expect(svc.hasPermission({ userId: 'u', userRole: UserRole.PHARMACIST }, Permission.PATIENT_VIEW_CONTACT)).toBe(true);
  });

  it('오버라이드가 없으면 기본값을 따른다', async () => {
    const { ov, svc } = build({});
    await ov.reload();
    expect(svc.hasPermission({ userId: 'u', userRole: UserRole.DOCTOR }, Permission.PATIENT_VIEW_CONTACT)).toBe(true);
    expect(svc.hasPermission({ userId: 'u', userRole: UserRole.DOCTOR }, Permission.PATIENT_EXPORT)).toBe(false);
  });
});

describe('🔴 관리자 잠금 방지', () => {
  it('ADMIN 은 오버라이드가 저장돼 있어도 무시된다', async () => {
    const { ov, svc } = build({ ADMIN: { [Permission.SYSTEM_MANAGE]: false } });
    await ov.reload();
    expect(ov.get(UserRole.ADMIN, Permission.SYSTEM_MANAGE)).toBeUndefined();
    expect(svc.hasPermission({ userId: 'u', userRole: UserRole.ADMIN }, Permission.SYSTEM_MANAGE)).toBe(true);
  });

  it('ADMIN 오버라이드 설정 시도는 거부한다', async () => {
    const { ov } = build({});
    await ov.reload();
    await expect(ov.set(UserRole.ADMIN, Permission.SYSTEM_MANAGE, false)).rejects.toThrow(/관리자/);
  });
});

describe('설정·해제·초기화', () => {
  it('allow=null 이면 오버라이드를 지우고 기본값으로 되돌린다', async () => {
    const { ov, svc } = build({ NURSE: { [Permission.PATIENT_EDIT]: false } });
    await ov.reload();
    await ov.set(UserRole.NURSE, Permission.PATIENT_EDIT, null);
    expect(svc.hasPermission({ userId: 'u', userRole: UserRole.NURSE }, Permission.PATIENT_EDIT)).toBe(true);
  });

  it('역할의 마지막 오버라이드를 지우면 역할 항목 자체가 사라진다(찌꺼기 금지)', async () => {
    const { ov } = build({ NURSE: { [Permission.PATIENT_EDIT]: false } });
    await ov.reload();
    await ov.set(UserRole.NURSE, Permission.PATIENT_EDIT, null);
    expect(ov.all().NURSE).toBeUndefined();
  });

  it('역할 초기화는 그 역할만 지운다', async () => {
    const { ov } = build({ NURSE: { a: false }, DOCTOR: { b: true } });
    await ov.reload();
    await ov.reset(UserRole.NURSE);
    expect(ov.all().NURSE).toBeUndefined();
    expect(ov.all().DOCTOR).toEqual({ b: true });
  });
});

describe('화면 표시용 유효값', () => {
  it('기본값 대비 바뀐 항목을 overridden 으로 알린다', async () => {
    const { ov, svc } = build({ NURSE: { [Permission.PATIENT_EDIT]: false } });
    await ov.reload();
    const eff = svc.effectivePermissions(UserRole.NURSE);
    const edit = eff.find((e) => e.key === Permission.PATIENT_EDIT)!;
    expect(edit).toMatchObject({ allowed: false, overridden: true });
    expect(eff.find((e) => e.key === Permission.PATIENT_VIEW)).toMatchObject({ allowed: true, overridden: false });
  });
});

describe('카탈로그(화면 라벨)', () => {
  it('🔴 모든 권한에 라벨·설명이 있다 — 없으면 관리자가 뭘 켜는지 모른다', () => {
    expect(uncatalogedPermissions(Object.values(Permission))).toEqual([]);
  });

  it('민감 권한은 표시가 붙어 있다(삭제·병합·반출·사망처리)', () => {
    const patient = PERMISSION_CATALOG.find((d) => d.key === 'patient')!;
    for (const key of [Permission.PATIENT_DELETE, Permission.PATIENT_MERGE, Permission.PATIENT_EXPORT, Permission.PATIENT_DECEASED]) {
      expect(patient.permissions.find((p) => p.key === key)?.sensitive).toBe(true);
    }
  });
});
