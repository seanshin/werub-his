import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { BreakGlassService } from '../../src/modules/auth/break-glass/break-glass.service';

/**
 * 🔴 가드 — **설정 조회 실패 시 비상열람 발급을 거부한다**(fail-closed · W8 2026-08-14).
 *
 * 종전: `configRuntime.get('security.btg.enabled').catch(() => true)` — 설정 조회가 실패하면
 *       비활성 게이트를 통과시켜 **토큰을 발급**했다. TTL(defaultMinutes/maxMinutes) 조회 실패도
 *       `.catch(() => null)` 로 삼켜, 운영이 좁혀 둔 상한을 무시하고 폴백 120분까지 열어줬다.
 */
describe('Break-glass 게이트 — fail-closed', () => {
  let prisma: any;
  let jwt: any;
  let config: any;
  let notify: any;

  const dto = { staffUserId: 'u-staff', reason: '심정지 대응 중 타과 기록 확인' };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'u-staff', email: 's@h.example', role: 'NURSE', familyName: '김', givenName: '간호' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      authEmergencyAccess: { create: vi.fn().mockResolvedValue({ id: 'rec1' }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    jwt = { sign: vi.fn().mockReturnValue('tok') };
    config = { getOrThrow: vi.fn().mockReturnValue('secret') };
    notify = { create: vi.fn().mockResolvedValue({ id: 'n1' }), pushNotification: vi.fn() };
  });

  const svc = (configRuntime?: any) =>
    new BreakGlassService(prisma, jwt, config, notify, configRuntime);

  it('🔴 게이트 조회가 실패하면 발급을 거부한다(종전에는 통과시켰다)', async () => {
    const configRuntime = { get: vi.fn().mockRejectedValue(new Error('DB down')) };
    await expect(svc(configRuntime).grant('u-approver', dto)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.authEmergencyAccess.create).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled(); // 토큰이 만들어지지 않았다
  });

  it('security.btg.enabled=false 면 거부한다', async () => {
    const configRuntime = { get: vi.fn().mockImplementation((k: string) => Promise.resolve(k === 'security.btg.enabled' ? false : null)) };
    await expect(svc(configRuntime).grant('u-approver', dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('🔴 TTL 상한 조회 실패도 폴백(120분)으로 넓히지 않고 거부한다', async () => {
    const configRuntime = {
      get: vi.fn().mockImplementation((k: string) =>
        k === 'security.btg.maxMinutes' ? Promise.reject(new Error('timeout')) : Promise.resolve(true)),
    };
    await expect(svc(configRuntime).grant('u-approver', { ...dto, minutes: 120 })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('정상 조회 시에는 운영이 정한 상한을 넘지 않는다', async () => {
    const configRuntime = {
      get: vi.fn().mockImplementation((k: string) =>
        Promise.resolve(k === 'security.btg.enabled' ? true : k === 'security.btg.maxMinutes' ? 20 : 10)),
    };
    const res = await svc(configRuntime).grant('u-approver', { ...dto, minutes: 999 });
    expect(res.expiresIn).toBe(20 * 60);
  });
});
