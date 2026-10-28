import { describe, it, expect, vi } from 'vitest';
import { SsoController, jitRoleForNewSsoUser } from '../../src/modules/clinic-integration/sso.controller';

/**
 * Clinic SSO 계정 찾기·만들기 — 외부 점검.
 *
 * B1 🔴 HIS 가 Clinic 에 올린 역할 어휘('Admin')가 대문자로 돌아오면 `mapClinicRoleToHisRole` 이 'ADMIN' 을
 *    유효 역할로 채택해, **외부 로그인 한 번으로 시스템 관리자 계정**이 새로 만들어졌다.
 *    → 신규 생성은 ADMIN 을 받지 않는다(READ 로 만들고 관리자가 승격). **기존 계정 역할은 불변**(소급 금지).
 * B4 🔴 이메일 경로가 isActive 를 보지 않아 비활성 계정에 lastLoginAt·로그인 성공 로그가 남았다 → 쓰기 전에 401.
 */

type U = { id: string; email: string; role: string; isActive: boolean; familyName: string; givenName: string };

function make(opts: { byEmail?: U | null; linkedStaff?: { userId: string } | null; linkedUser?: U | null; clinicUser: Record<string, unknown> }) {
  const prisma = {
    staff: {
      findUnique: vi.fn(async (args: { where: { clinicUserId?: string; userId?: string } }) =>
        args.where.clinicUserId !== undefined ? opts.linkedStaff ?? null : null),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(async (args: { where: { id?: string; email?: string } }) =>
        args.where.id !== undefined ? opts.linkedUser ?? null : opts.byEmail ?? null),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({ ...(opts.byEmail ?? opts.linkedUser)!, ...args.data })),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'new-user', ...args.data })),
    },
  };
  const clinicApi = { verifySsoToken: vi.fn().mockResolvedValue(opts.clinicUser) };
  const jwt = { sign: vi.fn().mockReturnValue('JWT') };
  const redis = { set: vi.fn() };
  const ctrl = new SsoController(clinicApi as never, prisma as never, jwt as never, redis as never);
  return { ctrl, prisma, jwt };
}

const CLINIC_ADMIN = { id: 'c-1', email: 'clerk@his.example', username: '김행정', role: 'REGULAR', hisRole: 'Admin' };

describe('B1 — 외부 SSO 신규 계정은 ADMIN 을 받지 않는다', () => {
  it('순수 판정: ADMIN 만 READ 로 접고 무엇을 보류했는지 남긴다', () => {
    expect(jitRoleForNewSsoUser('ADMIN')).toEqual({ role: 'READ', withheld: 'ADMIN' });
    expect(jitRoleForNewSsoUser('NURSE')).toEqual({ role: 'NURSE' });
    expect(jitRoleForNewSsoUser('READ')).toEqual({ role: 'READ' });
  });

  it("🔴 Clinic 이 'Admin' 을 돌려줘도 새 HIS 계정은 READ 로 만들어진다", async () => {
    const { ctrl, prisma } = make({ byEmail: null, clinicUser: CLINIC_ADMIN });
    const out = await ctrl.verifySso({ token: 't' } as never);
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'READ' }) }));
    expect(out.data.user.role).toBe('READ');
  });

  it('🔴 Clinic 자체 OWNER 역할로도 새 ADMIN 계정은 생기지 않는다', async () => {
    const { ctrl, prisma } = make({ byEmail: null, clinicUser: { id: 'c-2', email: 'o@his.example', username: '박원장', role: 'OWNER' } });
    await ctrl.verifySso({ token: 't' } as never);
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'READ' }) }));
  });

  it('대조군 — 임상 역할(NURSE)은 그대로 만든다', async () => {
    const { ctrl, prisma } = make({ byEmail: null, clinicUser: { ...CLINIC_ADMIN, hisRole: 'NURSE' } });
    await ctrl.verifySso({ token: 't' } as never);
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'NURSE' }) }));
  });

  it('대조군 — 이미 있는 ADMIN 계정은 역할을 바꾸지 않는다(소급 금지)', async () => {
    const existing: U = { id: 'u-admin', email: 'clerk@his.example', role: 'ADMIN', isActive: true, familyName: '김', givenName: '관리' };
    const { ctrl, prisma } = make({ byEmail: existing, clinicUser: CLINIC_ADMIN });
    const out = await ctrl.verifySso({ token: 't' } as never);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('role');
    expect(out.data.user.role).toBe('ADMIN');
  });
});

describe('B4 — 비활성 계정은 SSO 로 로그인하지 못한다', () => {
  const inactive: U = { id: 'u-off', email: 'clerk@his.example', role: 'NURSE', isActive: false, familyName: '김', givenName: '퇴직' };

  it('🔴 이메일로 찾은 비활성 계정 — 401 이고 아무것도 쓰지 않으며 JWT 도 없다', async () => {
    const { ctrl, prisma, jwt } = make({ byEmail: inactive, clinicUser: CLINIC_ADMIN });
    await expect(ctrl.verifySso({ token: 't' } as never)).rejects.toMatchObject({ status: 401, response: { code: 'SSO_INACTIVE' } });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.staff.update).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('🔴 clinicUserId 로 연결된 비활성 계정도 401', async () => {
    const { ctrl, prisma, jwt } = make({ linkedStaff: { userId: 'u-off' }, linkedUser: inactive, byEmail: null, clinicUser: CLINIC_ADMIN });
    await expect(ctrl.verifySso({ token: 't' } as never)).rejects.toMatchObject({ status: 401 });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('🔴 랜딩(GET /sso)도 500 이 아니라 401 로 돌려준다', async () => {
    const { ctrl, jwt } = make({ byEmail: inactive, clinicUser: CLINIC_ADMIN });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), redirect: vi.fn(), cookie: vi.fn() };
    await ctrl.ssoLanding('t', res as never);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('대조군 — 활성 계정은 이메일 경로로 통과한다', async () => {
    const { ctrl, jwt } = make({ byEmail: { ...inactive, isActive: true }, clinicUser: CLINIC_ADMIN });
    const out = await ctrl.verifySso({ token: 't' } as never);
    expect(out.data.accessToken).toBe('JWT');
    expect(jwt.sign).toHaveBeenCalled();
  });
});
