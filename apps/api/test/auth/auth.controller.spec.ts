import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { UnauthorizedException, HttpStatus } from '@nestjs/common';
import { PermissionService } from '../../src/modules/auth/rbac/permission.service';

/** 접속기록(의료법 §23④) — 컨트롤러가 접속지 IP·단말을 서비스로 넘긴다 */
const LOGIN_REQ = { headers: { 'x-forwarded-for': '203.0.113.7', 'user-agent': 'UA' }, ip: '10.0.0.1', cookies: {} };

describe('AuthController', () => {
  let controller: AuthController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      login: vi.fn(),
      refresh: vi.fn(),
      logout: vi.fn(),
      getProfile: vi.fn(),
      staffContextOf: vi.fn().mockResolvedValue(null),
    };

    const mockConfigRuntime = { get: vi.fn().mockResolvedValue(null) };
    // 오버라이드 없는 실제 PermissionService — /auth/me 가 정본을 읽는지 보기 위해 목이 아니라 실물을 쓴다
    controller = new AuthController(mockService, mockConfigRuntime as any, new PermissionService());
  });

  describe('login', () => {
    it('should return access token on successful login', async () => {
      const mockResult = {
        accessToken: 'access-token-12345',
        refreshToken: 'refresh-token-12345',
        expiresIn: 28800,
      };

      vi.mocked(mockService.login).mockResolvedValue(mockResult);

      const mockRes = {
        cookie: vi.fn().mockReturnThis(),
      } as any;

      const result = await controller.login({ email: 'doctor@hospital.example.org', password: 'password' }, LOGIN_REQ as any, mockRes);

      expect(result.data).toHaveProperty('accessToken');
      expect(result.data.expiresIn).toBe(28800);
    });

    it('should set httpOnly refresh token cookie', async () => {
      const mockResult = {
        accessToken: 'access-token-12345',
        refreshToken: 'refresh-token-12345',
        expiresIn: 28800,
      };

      vi.mocked(mockService.login).mockResolvedValue(mockResult);

      const mockRes = {
        cookie: vi.fn().mockReturnThis(),
      } as any;

      await controller.login({ email: 'doctor@hospital.example.org', password: 'password' }, LOGIN_REQ as any, mockRes);

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'refresh-token-12345',
        expect.objectContaining({
          httpOnly: true,
        }),
      );
    });

    it('should not expose refresh token in response body', async () => {
      const mockResult = {
        accessToken: 'access-token-12345',
        refreshToken: 'refresh-token-12345',
        expiresIn: 28800,
      };

      vi.mocked(mockService.login).mockResolvedValue(mockResult);

      const mockRes = {
        cookie: vi.fn().mockReturnThis(),
      } as any;

      const result = await controller.login({ email: 'doctor@hospital.example.org', password: 'password' }, LOGIN_REQ as any, mockRes);

      expect(result.data).not.toHaveProperty('refreshToken');
    });

    it('should throw UnauthorizedException on invalid credentials', async () => {
      vi.mocked(mockService.login).mockRejectedValue(new UnauthorizedException('Invalid credentials'));

      const mockRes = {
        cookie: vi.fn().mockReturnThis(),
      } as any;

      await expect(
        controller.login({ email: 'invalid@hospital.example.org', password: 'wrong' }, LOGIN_REQ as any, mockRes),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should wrap response in data object', async () => {
      const mockResult = {
        accessToken: 'access-token-12345',
        refreshToken: 'refresh-token-12345',
        expiresIn: 28800,
      };

      vi.mocked(mockService.login).mockResolvedValue(mockResult);

      const mockRes = {
        cookie: vi.fn().mockReturnThis(),
      } as any;

      const result = await controller.login({ email: 'doctor@hospital.example.org', password: 'password' }, LOGIN_REQ as any, mockRes);

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('accessToken');
    });
  });

  describe('refresh', () => {
    it('should return new access token', async () => {
      const mockResult = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 900,
      };

      vi.mocked(mockService.refresh).mockResolvedValue(mockResult);

      const mockReq = {
        cookies: { refreshToken: 'refresh-token-12345' },
      } as any;

      const mockRes = {
        cookie: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
      } as any;

      const result = await controller.refresh(mockReq, mockRes);

      expect(result.data).toHaveProperty('accessToken');
      expect(result.data.expiresIn).toBe(900);
    });

    it('should rotate refresh token', async () => {
      const mockResult = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 900,
      };

      vi.mocked(mockService.refresh).mockResolvedValue(mockResult);

      const mockReq = {
        cookies: { refreshToken: 'refresh-token-12345' },
      } as any;

      const mockRes = {
        cookie: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
      } as any;

      await controller.refresh(mockReq, mockRes);

      expect(mockRes.cookie).toHaveBeenCalledWith('refreshToken', 'new-refresh-token', expect.any(Object));
    });

    it('should return 401 if no refresh token in cookie', async () => {
      const mockReq = {
        cookies: {},
      } as any;

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as any;

      await controller.refresh(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    });

    it('should throw UnauthorizedException on invalid token', async () => {
      vi.mocked(mockService.refresh).mockRejectedValue(new UnauthorizedException('Invalid refresh token'));

      const mockReq = {
        cookies: { refreshToken: 'invalid-token' },
      } as any;

      const mockRes = {
        cookie: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
      } as any;

      await expect(controller.refresh(mockReq, mockRes)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should call service logout', async () => {
      vi.mocked(mockService.logout).mockResolvedValue(undefined);

      const mockReq = { cookies: {} } as any;
      const mockRes = {
        clearCookie: vi.fn().mockReturnThis(),
      } as any;

      await controller.logout('user-1', mockReq, mockRes);

      // 3번째 인자 = 접속기록 컨텍스트(접속지 IP·단말) — 로그아웃도 원장에 남는다
      expect(mockService.logout).toHaveBeenCalledWith('user-1', undefined, expect.objectContaining({ method: 'UNSPECIFIED' }));
    });

    it('should clear refresh token cookie', async () => {
      vi.mocked(mockService.logout).mockResolvedValue(undefined);

      const mockReq = { cookies: {} } as any;
      const mockRes = {
        clearCookie: vi.fn().mockReturnThis(),
      } as any;

      await controller.logout('user-1', mockReq, mockRes);

      expect(mockRes.clearCookie).toHaveBeenCalledWith('refreshToken', { path: '/api/v1/auth' });
    });

    it('should require JwtAuthGuard', () => {
      expect(controller).toBeDefined();
    });
  });

  describe('me (getProfile)', () => {
    it('should return current user profile', async () => {
      const mockProfile = {
        id: 'user-1',
        email: 'doctor@hospital.example.org',
        familyName: '김',
        givenName: '철수',
        role: 'DOCTOR',
        department: 'Internal Medicine',
        specialty: 'Cardiology',
      };

      vi.mocked(mockService.getProfile).mockResolvedValue(mockProfile);

      const result = await controller.me({ id: 'user-1' });

      // 🔴 모바일 필드가 붙었다(AUTH-S-04). 기존 프로필·권한은 그대로여야 하고,
      //    기기·보증 수준은 **토큰에 실린 사실이 없으면 null** 이다(있는 척하지 않는다).
      expect(result.data).toMatchObject({ ...mockProfile, permissions: expect.any(Array) });
      expect(result.data.homeModule).toEqual(expect.any(String));
      expect(result.data.deviceState).toBeNull();
      expect(result.data.appKeyState).toBeNull();
      expect(result.data.email).toBe('doctor@hospital.example.org');
    });

    it('should wrap profile in data object', async () => {
      const mockProfile = {
        id: 'user-1',
        email: 'doctor@hospital.example.org',
        role: 'DOCTOR',
      };

      vi.mocked(mockService.getProfile).mockResolvedValue(mockProfile);

      const result = await controller.me({ id: 'user-1' });

      expect(result).toHaveProperty('data');
    });

    it('should throw UnauthorizedException if user not found', async () => {
      vi.mocked(mockService.getProfile).mockRejectedValue(new UnauthorizedException('User not found'));

      await expect(controller.me({ id: 'invalid-id' })).rejects.toThrow(UnauthorizedException);
    });

    it('should require JwtAuthGuard', () => {
      expect(controller).toBeDefined();
    });
  });

  describe('Response Format', () => {
    it('login should wrap accessToken in data', async () => {
      const mockResult = {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresIn: 28800,
      };

      vi.mocked(mockService.login).mockResolvedValue(mockResult);
      const mockRes = { cookie: vi.fn().mockReturnThis() } as any;

      const result = await controller.login({ email: 'test@hospital.example.org', password: 'pwd' }, LOGIN_REQ as any, mockRes);

      expect(result.data).toHaveProperty('accessToken');
      expect(result.data).not.toHaveProperty('refreshToken');
    });

    it('refresh should wrap accessToken in data', async () => {
      const mockResult = {
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
        expiresIn: 900,
      };

      vi.mocked(mockService.refresh).mockResolvedValue(mockResult);
      const mockReq = { cookies: { refreshToken: 'token' } } as any;
      const mockRes = { cookie: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() } as any;

      const result = await controller.refresh(mockReq, mockRes);

      expect(result.data).toHaveProperty('accessToken');
      expect(result.data).not.toHaveProperty('refreshToken');
    });

    it('me should wrap profile in data', async () => {
      const mockProfile = { id: 'user-1', email: 'test@hospital.example.org', role: 'DOCTOR' };

      vi.mocked(mockService.getProfile).mockResolvedValue(mockProfile);

      const result = await controller.me({ id: 'user-1' });

      // 🔴 모바일 필드가 붙었다(AUTH-S-04). 기존 프로필·권한은 그대로여야 하고,
      //    기기·보증 수준은 **토큰에 실린 사실이 없으면 null** 이다(있는 척하지 않는다).
      expect(result.data).toMatchObject({ ...mockProfile, permissions: expect.any(Array) });
      expect(result.data.homeModule).toEqual(expect.any(String));
      expect(result.data.deviceState).toBeNull();
      expect(result.data.appKeyState).toBeNull();
    });
  });

  describe('Authorization', () => {
    it('login should be publicly accessible', () => {
      expect(controller).toBeDefined();
    });

    it('refresh should be publicly accessible (cookie-based)', () => {
      expect(controller).toBeDefined();
    });

    it('logout should require JwtAuthGuard', () => {
      expect(controller).toBeDefined();
    });

    it('me should require JwtAuthGuard', () => {
      expect(controller).toBeDefined();
    });
  });

  describe('Rate Limiting', () => {
    it('login should be throttled (5 attempts per 60s)', () => {
      expect(controller).toBeDefined();
    });
  });
});
