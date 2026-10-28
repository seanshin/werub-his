import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PatientAuthController } from '../../src/modules/patient-auth/patient-auth.controller';

describe('PatientAuthController', () => {
  let controller: PatientAuthController;
  let mockAuthService: any;
  let mockSmsService: any;

  const mockReq = (overrides = {}) => ({
    headers: { 'x-forwarded-for': '192.168.1.1', authorization: 'Bearer mock-token' },
    ip: '127.0.0.1',
    patientAccountId: 'account-1',
    ...overrides,
  } as any);

  beforeEach(() => {
    mockAuthService = {
      signup: vi.fn().mockResolvedValue({ accountId: 'a1', patientId: 'p1', accessToken: 'at', refreshToken: 'rt' }),
      login: vi.fn().mockResolvedValue({ accountId: 'a1', patientId: 'p1', patientName: '김환자', accessToken: 'at', refreshToken: 'rt' }),
      loginWithPin: vi.fn().mockResolvedValue({ accountId: 'a1', accessToken: 'at', refreshToken: 'rt' }),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-at', expiresAt: '2026-05-29T12:00:00Z' }),
      logout: vi.fn().mockResolvedValue(undefined),
      changePassword: vi.fn().mockResolvedValue({ success: true }),
      verifyAccessToken: vi.fn().mockResolvedValue({ accountId: 'a1', patientId: 'p1' }),
      setPin: vi.fn().mockResolvedValue({ success: true }),
      getDevices: vi.fn().mockResolvedValue([{ id: 'd1', platform: 'iOS' }]),
      removeDevice: vi.fn().mockResolvedValue({ success: true }),
    };

    mockSmsService = {
      send: vi.fn().mockResolvedValue({ sent: true }),
      verify: vi.fn().mockResolvedValue(true),
    };

    controller = new PatientAuthController(mockAuthService, mockSmsService, { effective: vi.fn().mockResolvedValue('DEV') } as any);
  });

  // ── SMS OTP ──

  describe('sendSms', () => {
    it('SMS OTP 발송', async () => {
      const result = await controller.sendSms({ phone: '01012345678', purpose: 'SIGNUP' }, mockReq());

      expect(result.data.sent).toBe(true);
      expect(mockSmsService.send).toHaveBeenCalledWith('01012345678', 'SIGNUP', '192.168.1.1');
    });

    it('x-forwarded-for 없으면 req.ip 사용', async () => {
      const req = mockReq({ headers: {} });
      await controller.sendSms({ phone: '01012345678', purpose: 'SIGNUP' }, req);

      expect(mockSmsService.send).toHaveBeenCalledWith('01012345678', 'SIGNUP', req.ip);
    });
  });

  describe('verifySms', () => {
    it('SMS OTP 인증', async () => {
      const result = await controller.verifySms({ phone: '01012345678', code: '123456', purpose: 'SIGNUP' });

      expect(result.data.verified).toBe(true);
    });
  });

  // ── 회원가입 ──

  describe('signup', () => {
    it('정상 회원가입', async () => {
      const dto = {
        ci: 'ci-value', name: '김환자', dateOfBirth: '1990-01-01', gender: 'MALE',
        phone: '01012345678', password: 'Test1234!', pin: '123456',
        consents: { privacyCollect: true, sensitiveHealth: true, thirdParty: true },
      };

      const result = await controller.signup(dto as any);

      expect(result.data.accountId).toBe('a1');
      expect(result.data.accessToken).toBe('at');
    });
  });

  // ── 로그인 ──

  describe('login', () => {
    it('정상 로그인 — IP 추출', async () => {
      const result = await controller.login(
        { phone: '01012345678', password: 'Test1234!', deviceId: 'd1', platform: 'iOS' },
        mockReq(),
      );

      expect(result.data.patientName).toBe('김환자');
      expect(mockAuthService.login).toHaveBeenCalledWith('01012345678', 'Test1234!', 'd1', 'iOS', '192.168.1.1', undefined);
    });
  });

  describe('loginPin', () => {
    it('PIN 로그인', async () => {
      const result = await controller.loginPin({ phone: '01012345678', pin: '123456', deviceId: 'd1' });

      expect(result.data.accessToken).toBe('at');
    });
  });

  // ── 토큰 갱신 ──

  describe('refresh', () => {
    it('토큰 갱신', async () => {
      const result = await controller.refresh({ refreshToken: 'old-rt' });

      expect(result.data.accessToken).toBe('new-at');
    });
  });

  // ── 로그아웃 ──

  describe('logout', () => {
    it('로그아웃', async () => {
      const result = await controller.logout(mockReq(), { deviceId: 'd1' });

      expect(result.data.success).toBe(true);
      expect(mockAuthService.logout).toHaveBeenCalledWith('account-1', 'd1');
    });
  });

  // ── 비밀번호 변경 ──

  describe('changePassword', () => {
    it('비밀번호 변경', async () => {
      const result = await controller.changePassword(mockReq(), { currentPassword: 'old', newPassword: 'New1234!' });

      expect(result.data.success).toBe(true);
    });
  });

  // ── PIN 설정 ──

  describe('setPin', () => {
    it('PIN 설정', async () => {
      const result = await controller.setPin(mockReq(), { password: 'Test1234!', pin: '654321' });

      expect(result.data.success).toBe(true);
    });
  });

  // ── 기기 관리 ──

  describe('getDevices', () => {
    it('등록 기기 목록', async () => {
      const result = await controller.getDevices(mockReq());

      expect(result.data).toHaveLength(1);
    });
  });

  describe('removeDevice', () => {
    it('기기 삭제', async () => {
      const result = await controller.removeDevice('dev-db-1', mockReq());

      expect(result.data.success).toBe(true);
    });
  });
});
