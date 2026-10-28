import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../src/modules/auth/auth.service';

vi.mock('bcrypt');
vi.mock('ioredis');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwtService: any;
  let config: any;

  const mockUser = {
    id: 'user-1',
    email: 'doctor@test.example',
    passwordHash: 'hashed-password',
    familyName: '김',
    givenName: '의사',
    role: UserRole.DOCTOR,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    department: '내과',
  };

  const mockToken = {
    accessToken: 'jwt-access-token',
    refreshToken: 'jwt-refresh-token',
    expiresIn: 28800,
  };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      session: {
        update: vi.fn(),
      },
    };

    jwtService = {
      sign: vi.fn(),
      decode: vi.fn().mockReturnValue({ iat: 1_700_000_000, exp: 1_700_000_000 + 28800 }),
      verify: vi.fn(),
    };

    const multiChain = {
      incr: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(),
      sadd: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    const redisService = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      multi: vi.fn().mockReturnValue(multiChain),
      sadd: vi.fn().mockResolvedValue(1),
      sismember: vi.fn().mockResolvedValue(0),
      smembers: vi.fn().mockResolvedValue([]),
      srem: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      incr: vi.fn().mockResolvedValue(1),
    };

    config = {
      getOrThrow: (key: string) => {
        const values: Record<string, string> = {
          'AUTH_REFRESH_SECRET': 'refresh-secret',
          'AUTH_ACCESS_SECRET': 'access-secret',
          'REDIS_URL': 'redis://localhost:6379',
        };
        return values[key];
      },
      get: vi.fn(),
    } as unknown as ConfigService;

    const ssoIdp = {
      revokeAllForUser: vi.fn().mockResolvedValue(undefined),
    };

    service = new AuthService(prisma, jwtService, redisService as any, config, ssoIdp as any, { log: vi.fn() } as any);
  });

  describe('login', () => {
    it('should return tokens on valid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as any);
      jwtService.sign.mockReturnValueOnce(mockToken.accessToken).mockReturnValueOnce(mockToken.refreshToken);

      const result = await service.login({ email: 'doctor@test.example', password: 'password123' } as any);

      // 🔴 세션 발급은 이제 `sessionId` 도 돌려준다 — access token 이 `sid` 를 담아야
      //    로그아웃·기기 폐기·권한 회수가 즉시 반영된다(요청서 AUTH-S-02/S-07).
      expect(result).toMatchObject(mockToken);
      expect(result.sessionId).toEqual(expect.any(String));
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'doctor@test.example' },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith('password123', mockUser.passwordHash);
      expect(jwtService.sign).toHaveBeenCalledTimes(2);
    });

    it('should throw UnauthorizedException on invalid email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login({ email: 'nonexistent@test.example', password: 'password123' } as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException on invalid password', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as any);

      await expect(service.login({ email: 'doctor@test.example', password: 'wrongpassword' } as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if user is inactive', async () => {
      const inactiveUser = { ...mockUser, isActive: false };
      prisma.user.findUnique.mockResolvedValue(inactiveUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as any);

      await expect(service.login({ email: 'doctor@test.example', password: 'password123' } as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refresh', () => {
    it('should return new access token on valid refresh token', async () => {
      const refreshToken = 'valid-refresh-token';
      jwtService.verify.mockReturnValue({ sub: mockUser.id, email: mockUser.email, role: UserRole.DOCTOR });
      jwtService.sign.mockReturnValue('new-access-token');
      prisma.user.findUnique.mockResolvedValue(mockUser);
      // Redis mock: stored token matches
      const innerMultiChain = {
        incr: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        del: vi.fn().mockReturnThis(),
        sadd: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      };
      (service as any).redis = {
        get: vi.fn().mockResolvedValue(refreshToken),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        multi: vi.fn().mockReturnValue(innerMultiChain),
        sadd: vi.fn().mockResolvedValue(1),
        sismember: vi.fn().mockResolvedValue(0),
        smembers: vi.fn().mockResolvedValue([]),
        srem: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
      };

      const result = await service.refresh(refreshToken);

      expect(result.accessToken).toBe('new-access-token');
      expect(jwtService.verify).toHaveBeenCalledWith(refreshToken, { secret: 'refresh-secret' });
    });

    it('should throw UnauthorizedException on invalid refresh token', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(service.refresh('invalid-token')).rejects.toThrow();
    });
  });

  describe('logout', () => {
    it('should complete logout', async () => {
      await expect(service.logout(mockUser.id)).resolves.not.toThrow();
    });
  });

  describe('getProfile', () => {
    it('should return user profile', async () => {
      const profileFields = {
        id: mockUser.id,
        email: mockUser.email,
        familyName: mockUser.familyName,
        givenName: mockUser.givenName,
        role: mockUser.role,
        department: mockUser.department,
        specialty: undefined,
      };
      prisma.user.findUnique.mockResolvedValue(profileFields);

      const result = await service.getProfile(mockUser.id);

      expect(result).toEqual(profileFields);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        select: {
          id: true,
          email: true,
          familyName: true,
          givenName: true,
          role: true,
          department: true,
          specialty: true,
        },
      });
    });

    it('should throw error if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('nonexistent-id')).rejects.toThrow();
    });
  });
});
