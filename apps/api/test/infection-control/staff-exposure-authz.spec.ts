import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { InfectionControlController } from '../../src/modules/infection-control/infection-control.controller';
import { InfectionControlService } from '../../src/modules/infection-control/infection-control.service';
import { Permission, ROLE_PERMISSIONS } from '../../src/modules/auth/rbac/permission.types';
import { uncatalogedPermissions } from '../../src/modules/auth/rbac/permission-catalog';

/**
 * 🔴 직원 노출 사고 EP 의 **권한 재검토** 가드 — 2026-08-18.
 *
 * 무엇이 잘못이었나
 *  ① 접수(`POST /staff-exposure`)가 `PATIENT_EDIT` 였다. 보유자는 ADMIN·NURSE·RECEPTIONIST 뿐이라
 *     **예리물을 가장 많이 다루는 의사·약사·검사기사가 자기 니들스틱을 신고할 수 없었다.**
 *     신고를 막는다고 사고가 없어지지는 않는다 — 법정기록이 남지 않을 뿐이다.
 *  ② 열람(`GET /staff-exposure`)이 `AUDIT_VIEW` 였다. 거기엔 CRM_MANAGER 가 들어 있어
 *     **마케팅 담당이 동료의 HIV 노출 이력을 전건 열람**할 수 있었다.
 *  ③ 신고는 되는데 **본인 기록을 볼 경로가 없는** 직군이 생겼다(원무·검진·급양·행정·의무기록).
 *
 * 이 스펙은 셋 다 되살아나면 실패한다.
 */
const CONTROLLER = join(process.cwd(), 'src/modules/infection-control/infection-control.controller.ts');
const controllerSrc = readFileSync(CONTROLLER, 'utf-8');

/** 해당 라우트 데코레이터 바로 위/아래에 붙은 `@RequirePermission(...)` 를 소스에서 읽는다 */
function permissionOf(routeDecorator: string): string {
  const at = controllerSrc.indexOf(routeDecorator);
  expect(at, `라우트를 찾지 못했다: ${routeDecorator}`).toBeGreaterThan(-1);
  const block = controllerSrc.slice(at, at + 400);
  const m = block.match(/@RequirePermission\(Permission\.([A-Z_]+)\)/);
  expect(m, `@RequirePermission 이 없다: ${routeDecorator} — 무가드면 RolesGuard 가 통과시킨다`).toBeTruthy();
  return m![1];
}

describe('노출 사고 EP 권한 — 신고는 넓게, 타인 이력은 좁게', () => {
  it('🔴 접수는 STAFF_EXPOSURE_REPORT — PATIENT_EDIT 로 되돌아가면 실패', () => {
    expect(permissionOf("@Post('staff-exposure')")).toBe('STAFF_EXPOSURE_REPORT');
  });

  it('🔴 전건 열람·추적관찰 갱신은 STAFF_EXPOSURE_MANAGE — AUDIT_VIEW/PATIENT_EDIT 로 되돌아가면 실패', () => {
    expect(permissionOf("@Get('staff-exposure')")).toBe('STAFF_EXPOSURE_MANAGE');
    expect(permissionOf("@Put('staff-exposure/:id/follow-up')")).toBe('STAFF_EXPOSURE_MANAGE');
  });

  it('본인 이력·상세는 REPORT 로 열린다(신고만 되고 확인은 못 하는 상태를 막는다)', () => {
    expect(permissionOf("@Get('staff-exposure/mine')")).toBe('STAFF_EXPOSURE_REPORT');
    expect(permissionOf("@Get('staff-exposure/:id')")).toBe('STAFF_EXPOSURE_REPORT');
  });

  it("🔴 라우트 선언 순서 — 'staff-exposure/mine' 이 'staff-exposure/:id' 보다 먼저다", () => {
    const mine = controllerSrc.indexOf("@Get('staff-exposure/mine')");
    const byId = controllerSrc.indexOf("@Get('staff-exposure/:id')");
    expect(mine).toBeGreaterThan(-1);
    expect(byId).toBeGreaterThan(-1);
    // 뒤집히면 Nest 가 'mine' 을 :id 로 먹어 본인 이력이 통째로 404/400 이 된다
    expect(mine).toBeLessThan(byId);
  });
});

describe('역할 매트릭스 실측 — 누가 신고하고 누가 열람하는가', () => {
  const can = (role: UserRole, p: Permission) => ROLE_PERMISSIONS[role].has(p);

  it('🔴 예리물을 다루는 임상 직군이 전부 신고할 수 있다(종전엔 의사·약사·검사기사가 막혀 있었다)', () => {
    for (const role of [UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.LAB_TECH, UserRole.NURSE]) {
      expect(can(role, Permission.STAFF_EXPOSURE_REPORT), `${role} 이 신고할 수 없다`).toBe(true);
      // 종전 게이트였던 PATIENT_EDIT 가 없어도 신고가 열려야 한다는 사실을 못 박는다
      if (role === UserRole.DOCTOR || role === UserRole.PHARMACIST || role === UserRole.LAB_TECH) {
        expect(can(role, Permission.PATIENT_EDIT)).toBe(false);
      }
    }
  });

  it('사람 계정은 전 직군이 신고할 수 있다 — 서비스계정(READ)만 제외', () => {
    const humanRoles = Object.values(UserRole).filter((r) => r !== UserRole.READ);
    for (const role of humanRoles) {
      expect(can(role as UserRole, Permission.STAFF_EXPOSURE_REPORT), `${role} 이 신고할 수 없다`).toBe(true);
    }
    // 🔴 노출 사고는 피노출 당사자 명의로 남는 기록이라 서비스계정 명의로 접수되면 안 된다
    expect(can(UserRole.READ, Permission.STAFF_EXPOSURE_REPORT)).toBe(false);
  });

  it('🔴 타인 이력 전건 열람은 감염관리 실무 직군만 — CRM/약제/검사/원무는 막힌다', () => {
    for (const role of [UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE]) {
      expect(can(role, Permission.STAFF_EXPOSURE_MANAGE), `${role} 이 감염관리 열람을 못 한다`).toBe(true);
    }
    for (const role of [
      UserRole.CRM_MANAGER,
      UserRole.CRM_STAFF,
      UserRole.PHARMACIST,
      UserRole.LAB_TECH,
      UserRole.RECEPTIONIST,
      UserRole.EXECUTIVE,
      UserRole.READ,
    ]) {
      expect(can(role, Permission.STAFF_EXPOSURE_MANAGE), `${role} 이 동료의 HIV 노출 이력을 볼 수 있다`).toBe(false);
    }
    // 종전 게이트(AUDIT_VIEW)를 가진 역할이라도 이제는 열리지 않는다
    expect(can(UserRole.CRM_MANAGER, Permission.AUDIT_VIEW)).toBe(true);
  });

  it('새 권한은 관리 화면 카탈로그에 설명이 있다(라벨 없이 토글만 뜨는 것 방지)', () => {
    expect(
      uncatalogedPermissions([Permission.STAFF_EXPOSURE_REPORT, Permission.STAFF_EXPOSURE_MANAGE]),
    ).toEqual([]);
  });
});

describe('본인 이력(self-scope) — 조회 불가를 빈 목록으로 삼키지 않는다', () => {
  let prisma: any;
  let service: InfectionControlService;

  beforeEach(() => {
    prisma = {
      staff: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      patient: { findMany: vi.fn().mockResolvedValue([]) },
      staffExposureIncident: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    };
    service = new InfectionControlService(prisma);
  });

  it('🔴 계정↔직원 연결이 없으면 0 건이 아니라 "산출 불가"로 말한다', async () => {
    prisma.staff.findFirst.mockResolvedValue(null);
    const r: any = await service.getMyStaffExposures('user-1');

    expect(r.staffLinked).toBe(false);
    // 🔴 0 은 "본인 사고가 없다"는 다른 사실이다 — null 이어야 한다
    expect(r.totalCount).toBeNull();
    expect(r.totalCount).not.toBe(0);
    expect(r.unavailableReason).toContain('직원 원장');
    expect(r.zeroMeaning).toBeNull();
    // 조회 자체를 시도하지 않는다(엉뚱한 사람의 이력을 보여줄 위험)
    expect(prisma.staffExposureIncident.findMany).not.toHaveBeenCalled();
  });

  it('연결이 있으면 본인 staffId 로만 좁혀 조회하고, 0 건은 "본인 접수 기록 없음"이라 말한다', async () => {
    prisma.staff.findFirst.mockResolvedValue({ id: 'staff-9' });
    const r: any = await service.getMyStaffExposures('user-1');

    expect(prisma.staffExposureIncident.findMany.mock.calls[0][0].where.staffId).toBe('staff-9');
    expect(r.staffLinked).toBe(true);
    expect(r.totalCount).toBe(0);
    expect(r.zeroMeaning).toContain('본인 명의로 접수된 노출 사고 기록이 없습니다');
    // 🔴 "사고가 없다"고 말하면 회귀
    expect(r.zeroMeaning).not.toContain('사고가 없');
  });

  it('요약은 잘린 페이지가 아니라 전체를 센다 — 같은 응답 안의 모순 방지', async () => {
    prisma.staffExposureIncident.findMany.mockResolvedValue([]);
    prisma.staffExposureIncident.count
      .mockResolvedValueOnce(700) // totalCount
      .mockResolvedValueOnce(612) // open
      .mockResolvedValueOnce(410); // sourceStatusUnknown
    const r = await service.getStaffExposures();

    expect(r.totalCount).toBe(700);
    expect(r.summary.open).toBe(612); // 페이지(0건)에서 셌다면 0 이 나온다
    expect(r.summary.sourceStatusUnknown).toBe(410);
    expect(r.truncated).toBe(true);
  });
});

describe('상세 — 타인 기록은 감염관리 권한이 있어야 열린다', () => {
  let prisma: any;
  let service: InfectionControlService;
  const row = {
    id: 'exp-1',
    staffId: 'staff-A',
    sourcePatientId: null,
    exposureType: 'NEEDLESTICK',
    followUpStatus: 'OPEN',
    sourceHbv: null,
    sourceHcv: null,
    sourceHiv: null,
  };

  beforeEach(() => {
    prisma = {
      staff: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      patient: { findMany: vi.fn().mockResolvedValue([]) },
      staffExposureIncident: { findUnique: vi.fn().mockResolvedValue(row) },
    };
    service = new InfectionControlService(prisma);
  });

  it('🔴 본인 기록이 아니고 MANAGE 도 없으면 거부한다', async () => {
    prisma.staff.findFirst.mockResolvedValue({ id: 'staff-B' });
    await expect(
      service.getStaffExposureDetail('exp-1', { userId: 'user-B', canManage: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('본인 기록이면 MANAGE 없이도 열린다', async () => {
    prisma.staff.findFirst.mockResolvedValue({ id: 'staff-A' });
    const r = await service.getStaffExposureDetail('exp-1', { userId: 'user-A', canManage: false });
    expect(r.id).toBe('exp-1');
    // 🔴 원환자 미지정 = 검사 자체가 불가 — '음성'으로 접지 않는다
    expect(r.sourceStatus.sourceIdentified).toBe(false);
    expect(r.sourceStatus.hbv).toBe('UNKNOWN');
    expect(r.sourceStatusNote).toContain('음성으로 간주하지 마십시오');
  });

  it('MANAGE 면 타인 기록도 열린다(감염관리 실무)', async () => {
    prisma.staff.findFirst.mockResolvedValue({ id: 'staff-B' });
    await expect(
      service.getStaffExposureDetail('exp-1', { userId: 'user-B', canManage: true }),
    ).resolves.toMatchObject({ id: 'exp-1' });
  });
});

describe('컨트롤러 상세 — MANAGE 판정은 PermissionService 로만 한다', () => {
  it('역할 문자열을 직접 비교하지 않고 권한 서비스에 묻는다', async () => {
    const service = { getStaffExposureDetail: vi.fn().mockResolvedValue({ id: 'exp-1' }) } as any;
    const permissions = { hasPermission: vi.fn().mockReturnValue(false) } as any;
    const controller = new InfectionControlController(service, permissions);

    await controller.getStaffExposureDetail('exp-1', { id: 'user-1', role: UserRole.PHARMACIST });

    expect(permissions.hasPermission).toHaveBeenCalledWith(
      { userId: 'user-1', userRole: UserRole.PHARMACIST },
      Permission.STAFF_EXPOSURE_MANAGE,
    );
    expect(service.getStaffExposureDetail).toHaveBeenCalledWith('exp-1', {
      userId: 'user-1',
      canManage: false,
    });
  });
});
