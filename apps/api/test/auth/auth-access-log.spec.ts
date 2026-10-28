import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService } from '../../src/modules/auth/auth.service';
import { UnauthorizedException } from '@nestjs/common';
import { AUDIT_EXEMPT } from '../../src/modules/audit/audit-routes';
import { authContextFromRequest } from '../../src/modules/auth/auth-audit';

vi.mock('bcrypt', () => ({ compare: vi.fn() }));
import * as bcrypt from 'bcrypt';

/**
 * 직원 접속기록(의료법 §23④) 가드.
 *
 * 🔴 이 파일이 생기기 전 실측: 직원 로그인·로그아웃이 개통 이래 **AuditLog 0건**이었다.
 *    `AUDIT_EXEMPT` 는 auth 경로를 면제하면서 "세션 감사는 auth 모듈 자체 기록"이라 적어놨는데
 *    auth 모듈에는 감사 호출이 한 줄도 없었다 — 면제 사유가 사실이 아니었다.
 *
 * 이 테스트는 **결함을 재주입하면 반드시 실패**한다:
 *   - `issueSession` 의 auditSession 호출을 지우면 → '로그인 성공' 케이스 실패
 *   - `logout` 의 auditSession 호출을 지우면 → '로그아웃' 케이스 실패
 *   - 실패 로그인 기록을 지우면 → 'BAD_PASSWORD' 케이스 실패
 *   - 성공/실패를 같은 resourceType 으로 합치면 → '성공과 실패는 구분된다' 케이스 실패
 */
describe('직원 접속기록 감사 (auth access log)', () => {
  let service: AuthService;
  let prisma: any;
  let redis: any;
  let audit: { log: ReturnType<typeof vi.fn> };

  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'doctor@hospital.example.org',
    passwordHash: '$2b$10$hashed',
    role: 'DOCTOR',
    isActive: true,
  };

  beforeEach(() => {
    prisma = { user: { findUnique: vi.fn().mockResolvedValue(user), update: vi.fn().mockResolvedValue(user) } };
    const chain: any = {
      incr: vi.fn().mockReturnThis(), expire: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(), sadd: vi.fn().mockReturnThis(), srem: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    redis = {
      get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn().mockResolvedValue(1),
      multi: vi.fn().mockReturnValue(chain), sadd: vi.fn(), sismember: vi.fn().mockResolvedValue(0),
      smembers: vi.fn().mockResolvedValue([]), srem: vi.fn(), expire: vi.fn(),
    };
    audit = { log: vi.fn().mockResolvedValue({ id: 'a-1' }) };
    const jwt = {
      sign: vi.fn().mockReturnValue('jwt'),
      // 정본은 응답 만료초를 발급 토큰에서 읽는다 — 목도 그 모양을 갖춘다
      decode: vi.fn().mockReturnValue({ iat: 1_700_000_000, exp: 1_700_000_000 + 28800 }),
      verify: vi.fn().mockReturnValue({ sub: user.id, email: user.email, role: 'DOCTOR', sid: 'sess-1' }),
    };
    const config = { getOrThrow: vi.fn().mockReturnValue('refresh-secret') };
    const ssoIdp = { revokeAllForUser: vi.fn().mockResolvedValue(undefined) };
    service = new AuthService(prisma as any, jwt as any, redis as any, config as any, ssoIdp as any, audit as any);
  });

  it('로그인 성공이 원장에 남는다 — 주체·접속지 IP·단말까지', async () => {
    (bcrypt.compare as any).mockResolvedValue(true);

    await service.login(
      { email: user.email, password: 'pw' } as any,
      { method: 'PASSWORD', ipAddress: '10.0.0.9', userAgent: 'Chrome/1.0' },
    );

    expect(audit.log).toHaveBeenCalledTimes(1);
    const e = audit.log.mock.calls[0][0];
    expect(e.userId).toBe(user.id);
    expect(e.action).toBe('CREATE');
    expect(e.resourceType).toBe('AuthSession');
    expect(e.resourceId).toBe(user.id); // 🔴 @db.Uuid — 비UUID 는 앵커링 큐 poison
    expect(e.ipAddress).toBe('10.0.0.9');
    expect(e.userAgent).toBe('Chrome/1.0');
    expect(e.changes.session.new).toMatchObject({ kind: 'LOGIN', method: 'PASSWORD' });
  });

  it('로그아웃이 원장에 남는다 — 무엇을 끊었는지까지', async () => {
    await service.logout(user.id, 'refresh-token', { ipAddress: '10.0.0.9' });

    const e = audit.log.mock.calls.at(-1)![0];
    expect(e.action).toBe('DELETE');
    expect(e.resourceType).toBe('AuthSession');
    expect(e.changes.session.new).toMatchObject({ kind: 'LOGOUT', scope: 'SESSION' });
  });

  it('쿠키 없는 로그아웃은 전 세션 종료로 기록된다(scope=ALL)', async () => {
    await service.logout(user.id, undefined);

    const e = audit.log.mock.calls.at(-1)![0];
    expect(e.changes.session.new).toMatchObject({ kind: 'LOGOUT', scope: 'ALL' });
  });

  it('비밀번호 실패가 기록된다 — 그리고 성공과 다른 resourceType 이다', async () => {
    (bcrypt.compare as any).mockResolvedValue(false);

    await expect(
      service.login({ email: user.email, password: 'wrong' } as any, { ipAddress: '10.0.0.9' }),
    ).rejects.toThrow(UnauthorizedException);

    const e = audit.log.mock.calls.at(-1)![0];
    expect(e.resourceType).toBe('AuthLoginFailure');
    // 🔴 감사 화면은 changes 를 렌더하지 않는다 — 합치면 실패가 성공처럼 보인다
    expect(e.resourceType).not.toBe('AuthSession');
    expect(e.changes.login.new.reason).toBe('BAD_PASSWORD');
  });

  it('잠금 상태의 시도도 기록된다(브루트포스 규모는 여기서만 보인다)', async () => {
    redis.get.mockResolvedValue('10');

    await expect(service.login({ email: user.email, password: 'pw' } as any)).rejects.toThrow(UnauthorizedException);

    const e = audit.log.mock.calls.at(-1)![0];
    expect(e.resourceType).toBe('AuthLoginFailure');
    expect(e.changes.login.new.reason).toBe('LOCKED');
  });

  it('🔴 미존재 계정 시도는 원장에 담기지 않는다 — AuditLog.userId 는 User FK(알려진 한계)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.login({ email: 'nobody@x.example', password: 'pw' } as any)).rejects.toThrow(UnauthorizedException);

    // FK 없는 행을 억지로 만들지 않는다(넣으면 저장 자체가 실패한다). 로거로만 남는다.
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('감사 저장이 실패해도 로그인은 막히지 않는다(가용성 우선)', async () => {
    (bcrypt.compare as any).mockResolvedValue(true);
    audit.log.mockRejectedValue(new Error('DB down'));

    await expect(service.login({ email: user.email, password: 'pw' } as any)).resolves.toMatchObject({
      accessToken: 'jwt',
    });
  });

  it('AUDIT_EXEMPT 의 auth 면제 사유는 "auth 모듈이 직접 기록"이어야 한다', () => {
    const entry = AUDIT_EXEMPT.find((x) => x.pattern.test('/api/v1/auth/login'));
    expect(entry).toBeDefined();
    // 사유가 "actor 없음"으로 되돌아가면(=기록 없이 면제) 이 가드가 잡는다
    expect(entry!.reason).toContain('auth 모듈');
    expect(entry!.reason).not.toContain('actor 없음');
  });

  it('접속지 IP 는 프록시 뒤에서도 원래 클라이언트 IP 를 잡는다', () => {
    const ctx = authContextFromRequest(
      { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'UA' }, ip: '10.0.0.1' },
      'PASSWORD',
    );
    expect(ctx.ipAddress).toBe('203.0.113.7'); // nginx 뒤라 req.ip 는 항상 내부 IP 다
    expect(ctx.userAgent).toBe('UA');
    expect(ctx.method).toBe('PASSWORD');
  });
});
