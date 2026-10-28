import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { PermissionService } from '../../src/modules/auth/rbac/permission.service';

/**
 * 🔴 외부 점검 — ERP 핸드오프.
 *
 * R31: token 방식이 **메인 access 토큰(8시간)을 URL 쿼리로** 넘겼고, 서버 게이트를 지나지 않아
 *      허용 역할 밖(NURSE)도 ERP 계정이 만들어졌다(상대 팀 실호출). 이제 두 방식이 **같은 게이트**를
 *      지나 **전용 60초 토큰(aud=erp-sso · jti)** 을 받는다.
 * R32: 로그아웃이 ERP 핸드오프 쿠키를 남겨 뒀다 — 같은 브라우저에서 사용자가 바뀐 뒤에도 앞 사람의
 *      핸드오프가 소비될 수 있다. (🔴 ERP **세션 자체**를 끝내는 것은 ERP 몫이다 — 여기서 하는 말이 아니다.)
 */
function makeController(cfg: Record<string, unknown>) {
  const service = {
    logout: vi.fn(),
    issueErpSsoToken: vi.fn(() => 'erp-sso-token'),
  } as any;
  const configRuntime = { get: vi.fn(async (k: string) => cfg[k] ?? null) } as any;
  return { controller: new AuthController(service, configRuntime, new PermissionService()), service };
}

const NURSE = { id: 'u-nurse', email: 'n@h.example', role: 'NURSE' };
const ADMIN = { id: 'u-admin', email: 'a@h.example', role: 'ADMIN' };

describe('🔴 ERP SSO 핸드오프 — 토큰 방식도 게이트를 지난다', () => {
  it('허용 역할 밖이면 토큰을 주지 않는다(403)', async () => {
    const { controller, service } = makeController({ 'erp.allowedRoles': ['ADMIN'] });
    await expect(controller.erpSsoToken(NURSE)).rejects.toThrow(ForbiddenException);
    expect(service.issueErpSsoToken, '거부했는데 토큰을 만들었다').not.toHaveBeenCalled();
  });

  it('개별 허용 사용자면 역할 밖이어도 준다(쿠키 방식과 같은 규칙)', async () => {
    const { controller } = makeController({ 'erp.allowedRoles': ['ADMIN'], 'erp.allowedUserIds': [NURSE.id] });
    const res = await controller.erpSsoToken(NURSE);
    expect(res.data.token).toBe('erp-sso-token');
  });

  it('연동이 꺼져 있으면 준다는 말을 하지 않는다', async () => {
    const { controller } = makeController({ 'erp.enabled': false, 'erp.allowedRoles': ['ADMIN'] });
    await expect(controller.erpSsoToken(ADMIN)).rejects.toThrow(ForbiddenException);
  });

  it('허용 역할이면 전용 단기 토큰을 준다 — 🔴 메인 access 토큰이 아니다', async () => {
    const { controller, service } = makeController({ 'erp.allowedRoles': ['ADMIN'] });
    const res = await controller.erpSsoToken(ADMIN);
    expect(res.data).toMatchObject({ token: 'erp-sso-token', expiresInSec: 60 });
    expect(service.issueErpSsoToken).toHaveBeenCalledWith({ id: ADMIN.id, email: ADMIN.email, role: ADMIN.role });
  });
});

describe('🔴 로그아웃 — ERP 핸드오프 쿠키를 남기지 않는다', () => {
  let cleared: Array<[string, unknown]>;
  beforeEach(() => {
    cleared = [];
  });

  it('refreshToken 과 his_sso 를 모두 지운다', async () => {
    const { controller } = makeController({});
    const res = { clearCookie: vi.fn((name: string, opts: unknown) => cleared.push([name, opts])) } as any;
    await controller.logout('u-1', { cookies: {}, headers: {}, ip: '10.0.0.1' } as any, res);

    expect(cleared.map(([n]) => n)).toEqual(expect.arrayContaining(['refreshToken', 'his_sso']));
    expect(cleared.find(([n]) => n === 'his_sso')?.[1]).toMatchObject({ path: '/erp' });
  });
});
