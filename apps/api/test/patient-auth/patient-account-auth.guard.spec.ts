import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { PatientAccountAuthGuard } from '../../src/modules/patient-auth/guards/patient-account-auth.guard';

describe('PatientAccountAuthGuard', () => {
  let guard: PatientAccountAuthGuard;
  let mockAuthService: any;

  const createContext = (authHeader?: string) => {
    const req: any = { headers: authHeader ? { authorization: authHeader } : {} };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      _req: req,
    } as any;
  };

  beforeEach(() => {
    mockAuthService = {
      verifyAccessToken: vi.fn().mockResolvedValue({ accountId: 'account-1', patientId: 'patient-1' }),
    };

    guard = new PatientAccountAuthGuard(mockAuthService, { get: () => undefined } as any); // 포털 서비스 없음 = 401 그대로(포털 세션 구분은 patient-account-required.spec)
  });

  it('유효한 Bearer 토큰 — req에 accountId/patientId 설정', async () => {
    const ctx = createContext('Bearer valid-token');
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(ctx._req.patientAccountId).toBe('account-1');
    expect(ctx._req.portalPatientId).toBe('patient-1');
  });

  it('Authorization 헤더 없으면 UnauthorizedException', async () => {
    const ctx = createContext();

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('Bearer 접두사 없으면 UnauthorizedException', async () => {
    const ctx = createContext('Basic some-token');

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('토큰 검증 실패 시 UnauthorizedException 전파', async () => {
    mockAuthService.verifyAccessToken.mockRejectedValue(new UnauthorizedException('만료'));
    const ctx = createContext('Bearer expired-token');

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
