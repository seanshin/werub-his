/**
 * 당직/근무 컨트롤러 인가 가드 스펙 (🔴 W7 2026-08)
 *
 * 배경: RolesGuard 는 role·permission 이 **둘 다 없으면 통과**시킨다.
 *       그래서 `@Roles` 를 빠뜨린 핸들러는 "가드가 걸린 것처럼 보이면서" 실제로는 전 역할에 열려 있다.
 *       실제로 이 컨트롤러의 읽기 EP 8종이 그 상태였고, 인증된 RECEPTIONIST·NUTRITION·READ 가
 *       전 직원 근무표와 개인별 근무시간(인사정보)을 열람할 수 있었다.
 *
 * 이 스펙은 데코레이터를 **기계로** 읽어(리플렉트 메타데이터) 새 핸들러가 무방비로 추가되는 것을 막는다.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { PATH_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { DutyScheduleController } from '../../src/modules/duty-schedule/duty-schedule.controller';

type AnyProto = Record<string, (...args: unknown[]) => unknown>;

function routeHandlers(ctor: new (...args: never[]) => unknown): string[] {
  const proto = ctor.prototype as AnyProto;
  return Object.getOwnPropertyNames(proto).filter(
    (k) => k !== 'constructor' && typeof proto[k] === 'function' && Reflect.hasMetadata(PATH_METADATA, proto[k]),
  );
}

function rolesOf(ctor: new (...args: never[]) => unknown, handler: string): UserRole[] | undefined {
  const proto = ctor.prototype as AnyProto;
  return Reflect.getMetadata(ROLES_KEY, proto[handler]) as UserRole[] | undefined;
}

function guardNames(target: object): string[] {
  return ((Reflect.getMetadata(GUARDS_METADATA, target) as Array<{ name?: string }> | undefined) ?? []).map(
    (g) => g?.name ?? String(g),
  );
}

describe('DutyScheduleController 인가 가드', () => {
  it('클래스에 JwtAuthGuard + RolesGuard 가 걸려 있다', () => {
    expect(guardNames(DutyScheduleController)).toEqual(expect.arrayContaining(['JwtAuthGuard', 'RolesGuard']));
  });

  it('모든 라우트 핸들러가 @Roles 를 갖는다 (빠지면 전 역할 통과)', () => {
    const unguarded = routeHandlers(DutyScheduleController).filter((h) => {
      const roles = rolesOf(DutyScheduleController, h);
      return !roles || roles.length === 0;
    });
    expect(unguarded).toEqual([]);
  });

  it('당직 정보에 비당직·지원부서 역할이 섞이지 않는다', () => {
    const allowed = new Set<UserRole>([UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR]);
    for (const h of routeHandlers(DutyScheduleController)) {
      for (const role of rolesOf(DutyScheduleController, h) ?? []) {
        expect(allowed.has(role), `${h} 에 예상 밖 역할 ${role}`).toBe(true);
      }
    }
  });

  it('읽기 EP 8종이 실제로 @Roles 를 갖는다 (W7 봉합 대상 고정)', () => {
    const w7Reads = [
      'getSchedule', 'getHours', 'getViolations', 'getOnCall',
      'getStats', 'getFairnessReport', 'listStaffing', 'listOnCall',
    ];
    for (const h of w7Reads) {
      expect(rolesOf(DutyScheduleController, h), `${h} 에 @Roles 없음`).toBeTruthy();
    }
  });
});

describe('DutyScheduleController.getHours 자기 범위(self-scope)', () => {
  let controller: DutyScheduleController;
  let service: { getHours: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    service = { getHours: vi.fn().mockResolvedValue({ staffId: 'user-1', totalHours: 40 }) };
    controller = new DutyScheduleController(service as never);
  });

  it('본인 근무시간은 조회할 수 있다', async () => {
    const res = await controller.getHours('user-1', 'user-1', UserRole.DOCTOR, '2026-08-09');
    expect(res.ok).toBe(true);
    expect(service.getHours).toHaveBeenCalledWith('user-1', '2026-08-09');
  });

  // 🔴 W7: 타인 지정 조회(:userId)가 무제한이던 것
  it('비마스터 역할은 타인 근무시간을 조회할 수 없다', async () => {
    await expect(controller.getHours('other-1', 'user-1', UserRole.DOCTOR, '2026-08-09')).rejects.toThrow(
      ForbiddenException,
    );
    expect(service.getHours).not.toHaveBeenCalled();
  });

  it('근무표 마스터(ADMIN·NURSE)는 타인 근무시간을 조회할 수 있다', async () => {
    await controller.getHours('other-1', 'admin-1', UserRole.ADMIN, '2026-08-09');
    await controller.getHours('other-1', 'nurse-1', UserRole.NURSE, '2026-08-09');
    expect(service.getHours).toHaveBeenCalledTimes(2);
  });
});
