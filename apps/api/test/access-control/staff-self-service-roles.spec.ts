/**
 * 직원 자기 서비스(ESS·인사·교육) 역할 커버리지 — shared 정본 `EVERY_STAFF_ROLE` 과 집합 대조.
 *
 * 🔴 2026-09-02 운영 실측: CRM_MANAGER·CRM_STAFF 로 실제 로그인해 `/api/v1/ess/*`·`/api/v1/hr/me` 를
 *    부르면 **전부 403** 이었다. 세 컨트롤러가 역할 12개를 손으로 나열하면서 나중에 생긴 CRM 두 직군만
 *    빠뜨렸기 때문이다. ESS 는 전 핸들러가 `@CurrentUser` 자기 스코프라, 이는 "남의 정보를 못 본다"가
 *    아니라 **자기 근태·급여명세·휴가·결재함을 못 본다**는 뜻이다. 화면(TopBar 사용자 메뉴 '내 급여',
 *    대시보드 위젯 `my-today`·`my-pay-snapshot` = `roles: []`)은 전 직군에게 그 링크를 계속 보여줬다.
 *
 * 🔴 `EVERY_STAFF_ROLE` 의 주석이 예고한 재발이 그대로 일어났다 —
 *    "컨트롤러마다 역할을 손으로 나열하면 신설 직군이 생길 때 그 목록만 안 따라간다."
 *    그래서 이 가드는 **목록을 다시 적지 않고** 정본과 집합을 대조한다.
 */
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { UserRole } from '@prisma/client';
import { EVERY_STAFF_ROLE } from '@hospital-run/shared';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { EssController } from '../../src/modules/ess/ess.controller';
import { HrController } from '../../src/modules/hr/hr.controller';
import { EducationController } from '../../src/modules/education/education.controller';

type AnyProto = Record<string, (...args: unknown[]) => unknown>;

const classRoles = (c: object): string[] => Reflect.getMetadata(ROLES_KEY, c) ?? [];
const handlerRoles = (c: { prototype: AnyProto }, m: string): string[] => {
  const fn = c.prototype[m];
  expect(fn, `핸들러 ${m} 이 없다 — 이름이 바뀌면 가드가 헛돈다`).toBeTypeOf('function');
  return Reflect.getMetadata(ROLES_KEY, fn) ?? [];
};

/** 사람 직원 = 정본 전체 − READ(외부 연동 읽기전용 서비스 계정) */
const HUMAN = EVERY_STAFF_ROLE.filter((r) => r !== 'READ');

describe('직원 자기 서비스 역할 커버리지 (정본 집합 대조)', () => {
  it('정본이 CRM 두 직군을 담고 있다 — 대조 기준 자체가 비면 이 가드는 아무것도 안 한다', () => {
    expect(EVERY_STAFF_ROLE).toContain('CRM_MANAGER');
    expect(EVERY_STAFF_ROLE).toContain('CRM_STAFF');
    expect(new Set(EVERY_STAFF_ROLE)).toEqual(new Set(Object.keys(UserRole)));
  });

  it('ESS(자기 근태·급여·휴가·결재함)는 정본 전 역할에 열려 있다', () => {
    expect(new Set(classRoles(EssController))).toEqual(new Set(EVERY_STAFF_ROLE));
  });

  it.each(['findMe', 'findOne', 'getDepartments', 'getSchedule'])(
    '인사 조회 %s 는 사람 직원 전 직군에 열려 있다(READ 서비스계정 제외)',
    (m) => {
      expect(new Set(handlerRoles(HrController, m))).toEqual(new Set(HUMAN));
    },
  );

  it.each(['getPrograms', 'getByStaff', 'getExpiring', 'getCoverage', 'getLogbook', 'getEpaStatus', 'getRotations', 'getCasePresentations'])(
    '교육 조회 %s 는 사람 직원 전 직군에 열려 있다',
    (m) => {
      expect(new Set(handlerRoles(EducationController, m))).toEqual(new Set(HUMAN));
    },
  );

  it('대조군: 쓰기·관리 EP 까지 열리지는 않았다(여는 방향으로만 움직였는지 확인)', () => {
    // 교육 프로그램 등록·이수 기록은 ADMIN 전용으로 남아야 한다
    expect(handlerRoles(EducationController, 'create')).toEqual([UserRole.ADMIN]);
    expect(handlerRoles(EducationController, 'record')).toEqual([UserRole.ADMIN]);
    // 인사 마스터 쓰기·전 직원 목록도 ADMIN 전용
    expect(handlerRoles(HrController, 'create')).toEqual([UserRole.ADMIN]);
    expect(handlerRoles(HrController, 'findAll')).toEqual([UserRole.ADMIN]);
  });
});
