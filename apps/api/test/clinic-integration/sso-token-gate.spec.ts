import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { SsoController } from '../../src/modules/clinic-integration/sso.controller';

/**
 * SSO 표면 계약 — `/sso`(랜딩)·`/api/v1/sso/verify` (무인증·Clinic→HIS).
 *
 * HIS JWT 는 원격 Clinic 토큰 검증 결과에만 발급된다. 토큰이 없거나 검증 실패면
 * **JWT 를 절대 발급하지 않는다**(fail-closed). 원격 verifySsoToken 이 null → 401.
 */

function makeCtrl(clinicUser: unknown) {
  const clinicApi = { verifySsoToken: vi.fn().mockResolvedValue(clinicUser) };
  const jwt = { sign: vi.fn().mockReturnValue('JWT') };
  const redis = { set: vi.fn() };
  const prisma = {};
  return {
    ctrl: new SsoController(clinicApi as never, prisma as never, jwt as never, redis as never),
    clinicApi, jwt,
  };
}

describe('SsoController.verifySso (POST — 토큰 게이트)', () => {
  it('🔴 토큰 없음 — 400(JWT 미발급)', async () => {
    const { ctrl, jwt } = makeCtrl(null);
    await expect(ctrl.verifySso({ token: '' } as never)).rejects.toBeInstanceOf(HttpException);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('🔴 원격 검증 실패(null) — 401(JWT 미발급)', async () => {
    const { ctrl, jwt } = makeCtrl(null);
    await expect(ctrl.verifySso({ token: 'bad' } as never)).rejects.toMatchObject({ status: 401 });
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});

describe('SsoController.ssoLanding (GET — 토큰 게이트)', () => {
  it('🔴 토큰 없음 — 400 응답(리다이렉트/JWT 없음)', async () => {
    const { ctrl, jwt } = makeCtrl(null);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await ctrl.ssoLanding('', res as never);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('🔴 원격 검증 실패 — 401 응답(JWT 미발급)', async () => {
    const { ctrl, jwt } = makeCtrl(null);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await ctrl.ssoLanding('bad-token', res as never);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});
