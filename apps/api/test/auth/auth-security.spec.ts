import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService } from '../../src/modules/auth/auth.service';
import { UnauthorizedException } from '@nestjs/common';

describe('AuthService — 보안 강화', () => {
  let service: AuthService;
  let mockPrisma: any;
  let mockJwt: any;
  let mockRedis: any;
  let mockConfig: any;

  beforeEach(() => {
    mockPrisma = {
      user: { findUnique: vi.fn(), update: vi.fn() },
    };
    mockJwt = { sign: vi.fn(), verify: vi.fn() };
    mockRedis = {
      get: vi.fn(), set: vi.fn(), del: vi.fn(), setex: vi.fn(),
      multi: vi.fn().mockReturnThis(), exec: vi.fn().mockResolvedValue([]),
      sadd: vi.fn().mockReturnThis(), expire: vi.fn().mockReturnThis(),
      smembers: vi.fn().mockResolvedValue([]), srem: vi.fn(),
    };
    mockConfig = { getOrThrow: vi.fn().mockReturnValue('test-refresh-secret'), get: vi.fn() };
    service = new AuthService(mockPrisma, mockJwt, mockRedis, mockConfig, undefined as any, { log: vi.fn() } as any);
  });

  describe('changePassword — wrong current password', () => {
    it('should reject if current password is wrong', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1', passwordHash: '$2b$12$invalidhash' });
      // bcrypt.compare will fail naturally with wrong hash
      // 🔴 (2026-09-15) 입력 문제는 400(DomainException) — 401 이면 web 이 토큰 만료로 읽어 refresh 재시도했다
      await expect(service.changePassword('u-1', 'wrongpassword', 'NewValid123!@#')).rejects.toMatchObject({ domainCode: 'PASSWORD_CURRENT_MISMATCH', status: 400 });
    });

    it('should throw if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.changePassword('u-none', 'old', 'new')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('isPasswordExpired', () => {
    it('should return true if no passwordChangedAt', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ passwordChangedAt: null });
      const result = await service.isPasswordExpired('u-1');
      expect(result).toBe(true);
    });

    it('should return false if changed within 90 days', async () => {
      const recent = new Date();
      recent.setDate(recent.getDate() - 30);
      mockPrisma.user.findUnique.mockResolvedValue({ passwordChangedAt: recent });
      const result = await service.isPasswordExpired('u-1');
      expect(result).toBe(false);
    });

    it('should return true if changed over 90 days ago', async () => {
      const old = new Date();
      old.setDate(old.getDate() - 100);
      mockPrisma.user.findUnique.mockResolvedValue({ passwordChangedAt: old });
      const result = await service.isPasswordExpired('u-1');
      expect(result).toBe(true);
    });
  });
});
