/**
 * 🔴 (2026-09-15) 본인 비밀번호 변경 EP 가 현재 비밀번호 불일치·정책 위반에도 401 이었다 — web apiClient 는 401 을
 * 토큰 만료로 읽어 refresh 후 재시도한다(입력 실수가 재인증 흐름을 탔다). 본문은 인라인 타입이라 ValidationPipe 스킵.
 * `password-status` 의 maxAgeDays 90 과 판정의 90 이 각자 적혀 있었다.
 * 지키는 것: ① 불일치 400·PASSWORD_CURRENT_MISMATCH ② 정책 위반 400·PASSWORD_POLICY_VIOLATION·위반 목록
 *           ③ 성공 시 세션 만료(revokeAllTokens) 기존 동작 ④ 사용자 없음은 401 대조군 ⑤ 본문 class DTO·빈 본문 400
 *           ⑥ maxAgeDays 와 판정이 정본 PASSWORD_MAX_AGE_DAYS 하나 ⑦ 두 EP 는 JwtAuthGuard 뒤(인증 없으면 401) 대조군
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import 'reflect-metadata';
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../../src/modules/auth/auth.service';
import { ChangePasswordDto } from '../../src/modules/auth/dto/change-password.dto';
import { PASSWORD_MAX_AGE_DAYS } from '../../src/modules/auth/password-policy';

function make(user: unknown) {
  const prisma = { user: { findUnique: vi.fn().mockResolvedValue(user), update: vi.fn().mockResolvedValue({}) } };
  const redis = {
    get: vi.fn(), set: vi.fn(), del: vi.fn(), setex: vi.fn(),
    multi: vi.fn().mockReturnThis(), exec: vi.fn().mockResolvedValue([]),
    sadd: vi.fn().mockReturnThis(), expire: vi.fn().mockReturnThis(),
    smembers: vi.fn().mockResolvedValue([]), srem: vi.fn(),
  };
  const config = { getOrThrow: vi.fn().mockReturnValue('test-refresh-secret'), get: vi.fn() };
  const svc = new AuthService(prisma as any, { sign: vi.fn(), verify: vi.fn() } as any, redis as any, config as any, undefined as any, { log: vi.fn() } as any);
  return { svc, prisma };
}

describe('본인 비밀번호 변경 — 상태 코드 정직성', () => {
  it('① 현재 비밀번호 불일치 → 400 PASSWORD_CURRENT_MISMATCH(401 아님)', async () => {
    const hash = await bcrypt.hash('Correct-Pass#1', 4);
    const { svc, prisma } = make({ id: 'u1', passwordHash: hash });
    const err = await svc.changePassword('u1', 'Wrong-Pass#1', 'NewValid123!@#x').catch((e) => e);
    expect(err).not.toBeInstanceOf(UnauthorizedException);
    expect(err.getStatus()).toBe(400);
    expect(err.domainCode).toBe('PASSWORD_CURRENT_MISMATCH');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('② 정책 위반 → 400 PASSWORD_POLICY_VIOLATION + 위반 목록', async () => {
    const hash = await bcrypt.hash('Correct-Pass#1', 4);
    const { svc, prisma } = make({ id: 'u1', passwordHash: hash });
    const err = await svc.changePassword('u1', 'Correct-Pass#1', 'short').catch((e) => e);
    expect(err.getStatus()).toBe(400);
    expect(err.domainCode).toBe('PASSWORD_POLICY_VIOLATION');
    const violations = (err.getResponse() as { details: { violations: string[] } }).details.violations;
    expect(violations.length).toBeGreaterThan(0);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('③ 성공 → 저장 + 모든 세션 만료(기존 동작)', async () => {
    const hash = await bcrypt.hash('Correct-Pass#1', 4);
    const { svc, prisma } = make({ id: 'u1', passwordHash: hash });
    const revoke = vi.spyOn(svc as any, 'revokeAllTokens').mockResolvedValue(undefined);
    await svc.changePassword('u1', 'Correct-Pass#1', 'Brand-New-Pass#9');
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('u1');
  });

  it('④ 대조군 — 사용자 없음(인증 주체 소멸)은 401 유지', async () => {
    const { svc } = make(null);
    await expect(svc.changePassword('ghost', 'x', 'y')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('⑤ 본문은 class DTO — 빈 본문은 ValidationPipe 가 400', async () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/modules/auth/auth.controller.ts'), 'utf8');
    expect(src).toMatch(/@Body\(\) body: ChangePasswordDto/);
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    await expect(pipe.transform({}, { type: 'body', metatype: ChangePasswordDto })).rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({ currentPassword: 'a', newPassword: 'b' }, { type: 'body', metatype: ChangePasswordDto })).resolves.toBeTruthy();
  });

  it('⑥ maxAgeDays 응답과 만료 판정이 정본 하나를 쓴다', async () => {
    const ctl = fs.readFileSync(path.resolve(__dirname, '../../src/modules/auth/auth.controller.ts'), 'utf8');
    expect(ctl).toMatch(/maxAgeDays: PASSWORD_MAX_AGE_DAYS/);
    expect(ctl).not.toMatch(/maxAgeDays:\s*\d+/);
    const day = 86_400_000;
    const { svc: under } = make({ passwordChangedAt: new Date(Date.now() - (PASSWORD_MAX_AGE_DAYS - 1) * day) });
    expect(await under.isPasswordExpired('u1')).toBe(false);
    const { svc: over } = make({ passwordChangedAt: new Date(Date.now() - (PASSWORD_MAX_AGE_DAYS + 1) * day) });
    expect(await over.isPasswordExpired('u1')).toBe(true);
  });

  it('⑦ 대조군 — 두 EP 는 JwtAuthGuard 뒤(인증 없으면 401)', () => {
    const ctl = fs.readFileSync(path.resolve(__dirname, '../../src/modules/auth/auth.controller.ts'), 'utf8');
    for (const route of ["@Post('change-password')", "@Get('password-status')"]) {
      const i = ctl.indexOf(route);
      expect(i).toBeGreaterThan(-1);
      expect(ctl.slice(i, i + 200)).toMatch(/@UseGuards\(JwtAuthGuard\)/);
    }
  });
});
