/**
 * 🔴 (2026-09-14) 전역 셸의 비밀번호 변경 배너·변경 화면이 부르는 두 EP 는 **14역할 전부**가 통과해야 한다
 *    (전역 컴포넌트 최소권한 규칙 — 역할 게이트가 붙으면 그 역할은 상시 403 을 보고 배너가 조용히 사라진다).
 * 지키는 것: ① password-status·change-password 핸들러에 @Roles 없음 ② 클래스·핸들러에 RolesGuard 없음(JwtAuthGuard 만)
 *           ③ 대조군 — 같은 탐지로 역할 게이트가 붙은 컨트롤러는 잡힌다 ④ UserRole 이 14개(정본 수)
 */
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/modules/auth/guards/roles.guard';
import { TelehealthController } from '../../src/modules/telehealth/telehealth.controller';

const reflector = new Reflector();
const handler = (C: any, name: string) => C.prototype[name];
const guardsOf = (target: any): unknown[] => Reflect.getMetadata(GUARDS_METADATA, target) ?? [];

describe('비밀번호 상태·변경 EP — 14역할 전부 통과', () => {
  it.each(['passwordStatus', 'changePassword'])('① %s 에 @Roles 가 없다', (name) => {
    expect(reflector.get(ROLES_KEY, handler(AuthController, name))).toBeUndefined();
    expect(reflector.get(ROLES_KEY, AuthController)).toBeUndefined();
  });

  it.each(['passwordStatus', 'changePassword'])('② %s 는 JwtAuthGuard 만 — RolesGuard 없음', (name) => {
    const guards = [...guardsOf(AuthController), ...guardsOf(handler(AuthController, name))];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).not.toContain(RolesGuard);
  });

  it('③ 대조군 — 역할 게이트가 있는 컨트롤러는 같은 탐지로 잡힌다', () => {
    expect(guardsOf(TelehealthController)).toContain(RolesGuard);
    expect(reflector.get(ROLES_KEY, handler(TelehealthController, 'submitDoctorReply'))).toBeDefined();
  });

  it('④ UserRole 은 14역할(판정 대상 모집단)', () => {
    expect(Object.keys(UserRole)).toHaveLength(14);
  });
});
