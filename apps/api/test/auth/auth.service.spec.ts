import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService } from '../../src/modules/auth/auth.service';
import { UnauthorizedException } from '@nestjs/common';

// bcrypt mock
vi.mock('bcrypt', () => ({ compare: vi.fn() }));
import * as bcrypt from 'bcrypt';

/**
 * JwtService 목 — **정본이 실제로 하는 일**을 흉내낸다.
 *
 * 🔴 종전 목에는 `decode` 가 없었고 테스트는 `expiresIn` 을 **28800 이라고 손으로 적어** 단언했다.
 *    그래서 회전 응답이 `900` 을 말하면서 실제로는 8시간짜리 토큰을 발급하던 결함을
 *    **이 테스트들은 원리적으로 잡을 수 없었다**(목만 통과하는 테스트 · v4.2.0 유형).
 *    이제 서명한 토큰에 만료가 실려 있고, 응답의 만료초는 그 토큰에서 나온다.
 */
const MODULE_DEFAULT_TTL = 28800; // JwtModule signOptions.expiresIn = '8h'
const ttlOf = (opts?: { expiresIn?: number | string }) => {
  const v = opts?.expiresIn;
  if (v == null) return MODULE_DEFAULT_TTL;
  return typeof v === 'number' ? v : Number(String(v).replace(/[^0-9]/g, '')) || MODULE_DEFAULT_TTL;
};
/** 목이 발급한 토큰에 실린 만료초 — 테스트가 응답과 토큰을 대조할 때 쓴다 */
const expiresInOfMock = (token: string) => Number(String(token).split('.').pop()) || MODULE_DEFAULT_TTL;

const makeJwtMock = (verifyValue: unknown) => ({
  sign: vi.fn((_payload: unknown, opts?: { expiresIn?: number | string }) => `jwt-token.${ttlOf(opts)}`),
  verify: vi.fn().mockReturnValue(verifyValue),
  decode: vi.fn((token: string) => {
    const ttl = Number(String(token).split('.').pop()) || MODULE_DEFAULT_TTL;
    return { iat: 1_700_000_000, exp: 1_700_000_000 + ttl };
  }),
});

describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: any;
  let mockJwt: any;
  let mockRedis: any;
  let mockConfig: any;

  const mockUser = {
    id: 'u-1', email: 'doctor@hospital.example.org', passwordHash: '$2b$10$hashed',
    role: 'DOCTOR', isActive: true, familyName: '김', givenName: '의사',
    department: '내과', specialty: '소화기',
  };

  beforeEach(() => {
    mockPrisma = {
      user: { findUnique: vi.fn(), update: vi.fn() },
    };
    mockJwt = makeJwtMock({ sub: 'u-1', email: 'doctor@hospital.example.org', role: 'DOCTOR', sid: 'sess-1' });
    const multiChain = {
      incr: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(),
      sadd: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    mockRedis = {
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue('stored-refresh-token'),
      del: vi.fn().mockResolvedValue(1),
      multi: vi.fn().mockReturnValue(multiChain),
      sadd: vi.fn().mockResolvedValue(1),
      sismember: vi.fn().mockResolvedValue(0),
      smembers: vi.fn().mockResolvedValue([]),
      srem: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      incr: vi.fn().mockResolvedValue(1),
    };
    mockConfig = {
      getOrThrow: vi.fn().mockReturnValue('refresh-secret-key'),
    };
    const mockSsoIdp = { revokeAllForUser: vi.fn().mockResolvedValue(undefined) };
    service = new AuthService(mockPrisma, mockJwt, mockRedis, mockConfig, mockSsoIdp as any, { log: vi.fn() } as any);
  });

  describe('login', () => {
    it('should return tokens on valid credentials', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(true);

      const result = await service.login({ email: 'doctor@hospital.example.org', password: 'pass123' });

      expect(result.accessToken).toMatch(/^jwt-token\./);
      expect(result.refreshToken).toMatch(/^jwt-token\./);
      // 🔴 응답의 만료초는 **발급된 토큰에서** 나와야 한다. 손으로 적은 상수와 비교하면
      //    응답과 토큰이 어긋나도 통과한다(실제로 회전 응답이 32배 어긋나 있었다).
      expect(result.expiresIn).toBe(expiresInOfMock(result.accessToken));
      // Token stored via multi().set()...exec()
      expect(mockRedis.multi).toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u-1' }, data: { lastLoginAt: expect.any(Date) } }),
      );
    });

    it('should throw on wrong email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login({ email: 'wrong@email.example', password: 'pass' })).rejects.toThrow(UnauthorizedException);
    });

    it('should throw on inactive user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, isActive: false });
      await expect(service.login({ email: 'doctor@hospital.example.org', password: 'pass' })).rejects.toThrow(UnauthorizedException);
    });

    it('should throw on wrong password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(false);
      await expect(service.login({ email: 'doctor@hospital.example.org', password: 'wrong' })).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('should rotate tokens on valid refresh', async () => {
      mockRedis.get.mockResolvedValue('valid-refresh-token');
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.refresh('valid-refresh-token');

      expect(result.accessToken).toMatch(/^jwt-token\./);
      expect(result.refreshToken).toMatch(/^jwt-token\./);
      expect(result.expiresIn).toBe(expiresInOfMock(result.accessToken));
      expect(mockRedis.multi).toHaveBeenCalled(); // new token stored via multi
    });

    it('should throw on invalid JWT', async () => {
      mockJwt.verify.mockImplementation(() => { throw new Error('invalid'); });
      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw on revoked token (not in Redis)', async () => {
      mockRedis.get.mockResolvedValue(null);
      await expect(service.refresh('revoked-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw on token mismatch', async () => {
      mockRedis.get.mockResolvedValue('different-stored-token');
      await expect(service.refresh('mismatched-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw on inactive user during refresh', async () => {
      mockRedis.get.mockResolvedValue('valid-refresh-token');
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, isActive: false });
      await expect(service.refresh('valid-refresh-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should revoke all tokens and sessions from Redis', async () => {
      await service.logout('u-1');
      // revokeAllTokens uses multi().del()...exec()
      expect(mockRedis.multi).toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('should return user profile', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1', email: 'doctor@hospital.example.org', familyName: '김', givenName: '의사',
        role: 'DOCTOR', department: '내과', specialty: '소화기',
      });
      const result = await service.getProfile('u-1');
      expect(result.email).toBe('doctor@hospital.example.org');
      expect(result.familyName).toBe('김');
    });

    it('should throw on non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getProfile('u-x')).rejects.toThrow(UnauthorizedException);
    });
  });
});
