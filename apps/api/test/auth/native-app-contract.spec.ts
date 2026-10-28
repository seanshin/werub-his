import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';

/**
 * 네이티브 앱 요청서(SERVER_REQUEST_SPEC · 2026-08-24) P0 봉합 가드.
 *
 * 세 가지가 각각 **다른 층에서 같은 유형**이었다 — "확인했다고 적혀 있는데 확인한 적이 없다".
 *  1) 패스키가 ACTIVE 라는 사실을 **병원이 그 기기를 승인했다**는 뜻으로 읽었다
 *  2) 응답의 만료초를 서명된 토큰과 **따로 손으로 적어** 32배 어긋났다
 *  3) 클라이언트가 보낸 CI 를 **본인확인 결과로** 받았다
 */

// ── 1. 패스키 로그인 ↔ 승인 기기 결합 ──
describe('패스키 로그인은 승인된 기기에서만 된다', () => {
  /**
   * 등록 흐름은 미인증 공개 EP 에서 credential(기본값 ACTIVE)을 만들고 StaffDevice 는
   * `PENDING_CONFIRM` 으로 둔다. 로그인이 기기를 보지 않으면 **관리자 확정 전에 로그인이 된다**.
   * 실측 2026-08-24 운영: PENDING_CONFIRM 기기 0건 · deviceId 없는 credential 0건
   * (구조적 결함이고 통과 이력은 없다 — 검사를 켜도 잠기는 기존 사용자가 없다).
   */
  const load = async () => (await import('../../src/modules/auth/passkey/passkey.service')).PasskeyService;

  const makeService = async (cred: Record<string, unknown> | null) => {
    const PasskeyService = await load();
    const prisma = {
      webAuthnCredential: { findUnique: vi.fn().mockResolvedValue(cred), update: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const redis = {
      get: vi.fn().mockResolvedValue('challenge'),
      del: vi.fn(),
      set: vi.fn(),
    };
    return new (PasskeyService as unknown as new (...a: unknown[]) => {
      verifyLogin: (f: string, r: unknown) => Promise<unknown>;
    })(prisma, redis, { get: vi.fn() }, { issueSession: vi.fn() });
  };

  it.each([
    ['PENDING_CONFIRM', 'ENROLLMENT_PENDING_CONFIRM'],
    ['REVOKED', 'DEVICE_NOT_ACTIVE'],
    ['EXPIRED', 'DEVICE_NOT_ACTIVE'],
  ])('기기가 %s 이면 로그인 거부(%s)', async (deviceStatus, code) => {
    const svc = await makeService({
      id: 'c1', userId: 'u1', credentialId: 'x', status: 'ACTIVE',
      deviceId: 'd1', device: { id: 'd1', status: deviceStatus },
    });
    await expect(svc.verifyLogin('flow', { id: 'x' } as never)).rejects.toMatchObject({
      response: { code },
    });
  });

  /** 대조군 — 기기가 ACTIVE 면 여기서 막지 않는다(막으면 아무도 로그인 못 한다) */
  it('기기가 ACTIVE 면 이 검사에서 막지 않는다', async () => {
    const svc = await makeService({
      id: 'c1', userId: 'u1', credentialId: 'x', status: 'ACTIVE',
      deviceId: 'd1', device: { id: 'd1', status: 'ACTIVE' },
    });
    // 기기 검사를 통과하면 WebAuthn 검증 단계로 넘어가 다른 이유로 실패한다.
    await expect(svc.verifyLogin('flow', { id: 'x', response: {} } as never)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof UnauthorizedException &&
        !['ENROLLMENT_PENDING_CONFIRM', 'DEVICE_NOT_ACTIVE'].includes(
          ((e as UnauthorizedException).getResponse() as { code?: string })?.code ?? '',
        ),
    );
  });
});

// ── 3. 본인확인 없는 CI 로 가입되지 않는다 ──
describe('가입은 지어낸 CI 를 받지 않는다', () => {
  const realCi = 'A'.repeat(86) + '==';

  const makeService = async () => {
    const { PatientAuthService } = await import('../../src/modules/patient-auth/patient-auth.service');
    return new (PatientAuthService as unknown as new (...a: unknown[]) => {
      signup: (d: Record<string, unknown>) => Promise<unknown>;
      signupAvailability: () => { available: boolean };
    })(
      { patientAccount: { findFirst: vi.fn().mockResolvedValue(null) } },
      { get: vi.fn() },
      { encrypt: (v: string) => v },
    );
  };

  beforeEach(() => { delete process.env.PATIENT_SIGNUP_IDENTITY; });

  it.each([
    'web-01012345678-1756000000000',   // 웹 포털이 실제로 보내던 값
    '',
    'not-a-ci',
    'A'.repeat(40),
  ])('지어낸 CI(%s) 는 거부한다', async (ci) => {
    const svc = await makeService();
    await expect(svc.signup({ ci, password: 'Abcd1234!', pin: '123456', consents: {} })).rejects.toMatchObject({
      response: { code: 'IDENTITY_VERIFICATION_REQUIRED' },
    });
  });

  /** 대조군 — 형식이 맞는 CI 는 이 검사에서 막지 않는다(다음 단계에서 다른 이유로 진행/실패) */
  it('본인확인기관 형식 CI 는 이 검사에서 막지 않는다', async () => {
    const svc = await makeService();
    await expect(
      svc.signup({ ci: realCi, password: 'short', pin: '123456', consents: {} }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof BadRequestException &&
        ((e as BadRequestException).getResponse() as { code?: string })?.code !== 'IDENTITY_VERIFICATION_REQUIRED',
    );
  });

  it('연동 전에는 가입 경로가 닫혀 있다고 화면에 말한다', async () => {
    const svc = await makeService();
    expect(svc.signupAvailability().available).toBe(false);
  });
});
