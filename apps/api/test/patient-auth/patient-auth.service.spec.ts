import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { PatientAuthService } from '../../src/modules/patient-auth/patient-auth.service';

// bcrypt mock
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2b$12$hashedvalue'),
    compare: vi.fn(),
  },
  hash: vi.fn().mockResolvedValue('$2b$12$hashedvalue'),
  compare: vi.fn(),
}));

// jsonwebtoken mock
vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn().mockReturnValue('mock-jwt-token'),
    verify: vi.fn(),
  },
  sign: vi.fn().mockReturnValue('mock-jwt-token'),
  verify: vi.fn(),
}));

import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';

describe('PatientAuthService', () => {
  let service: PatientAuthService;
  let mockPrisma: any;
  let mockConfig: any;
  let mockEncryption: any;

  const mockAccount = {
    id: 'account-1',
    patientId: 'patient-1',
    phone: '01012345678',
    passwordHash: '$2b$12$existinghash',
    pinHash: '$2b$12$pinhash',
    status: 'ACTIVE',
    failedAttempts: 0,
    lockedUntil: null,
    previousPasswords: ['$2b$12$old1'],
    ci: 'encrypted-ci',
    patient: { id: 'patient-1', familyName: '김', givenName: '환자', mrn: 'MRN-001' },
  };

  beforeEach(() => {
    mockPrisma = {
      patientAccount: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      patient: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      patientConsent: { create: vi.fn() },
      patientAddress: { create: vi.fn() },
      patientDevice: {
        upsert: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      smsVerification: { create: vi.fn() },
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'admin-1' }) },
    };
    // 🔴 (2026-09-16 J1) 가입은 환자·계정·동의 이력·주소가 한 트랜잭션이다(법정 동의 이력).
    //    목이 콜백을 돌리지 않으면 정본의 실제 호출 모양이 아니다.
    mockPrisma.$transaction = vi.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
    );

    mockConfig = {
      get: vi.fn().mockReturnValue('test-jwt-secret'),
    };

    mockEncryption = {
      encrypt: vi.fn().mockReturnValue('encrypted-value'),
      decrypt: vi.fn().mockReturnValue('decrypted-value'),
    };

    service = new PatientAuthService(mockPrisma, mockConfig, mockEncryption);
  });

  // ── signup ──

  describe('signup', () => {
    const validDto = {
      // 🔴 본인확인기관 CI 형식(88자 Base64)이어야 가입 경로가 열린다.
      //    종전 목값 `'test-ci-value'` 는 실제로는 서버가 거절해야 하는 값이다 —
      //    그 값으로 통과하던 것이 웹 포털이 CI 를 지어내던 결함과 같은 뿌리다.
      ci: `${'A'.repeat(86)}==`,
      name: '김환자',
      dateOfBirth: '1990-01-01',
      gender: 'MALE',
      phone: '01012345678',
      password: 'Test1234!',
      pin: '123456',
      consents: { privacyCollect: true, sensitiveHealth: true, thirdParty: true, uniqueId: true, treatment: true, hie: true },
    };

    it('정상 회원가입 — 신규 환자 생성', async () => {
      mockPrisma.patientAccount.findFirst.mockResolvedValue(null);
      mockPrisma.patient.findFirst.mockResolvedValue(null);
      mockPrisma.patient.create.mockResolvedValue({ id: 'new-patient', mrn: 'APP-20260529-0001' });
      mockPrisma.patientAccount.create.mockResolvedValue({ id: 'new-account', patientId: 'new-patient' });

      const result = await service.signup(validDto);

      expect(result.accountId).toBe('new-account');
      expect(result.patientId).toBe('new-patient');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(mockPrisma.patient.create).toHaveBeenCalled();
      expect(mockPrisma.patientConsent.create).toHaveBeenCalledTimes(6);
    });

    it('정상 회원가입 — 기존 환자 매칭', async () => {
      mockPrisma.patientAccount.findFirst.mockResolvedValue(null);
      mockPrisma.patient.findFirst.mockResolvedValue({ id: 'existing-patient' });
      mockPrisma.patientAccount.create.mockResolvedValue({ id: 'new-account', patientId: 'existing-patient' });

      const result = await service.signup(validDto);

      expect(result.patientId).toBe('existing-patient');
      expect(mockPrisma.patient.create).not.toHaveBeenCalled();
      expect(mockPrisma.patient.update).toHaveBeenCalled();
    });

    it('CI 중복 시 ConflictException', async () => {
      mockPrisma.patientAccount.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(service.signup(validDto)).rejects.toThrow(ConflictException);
    });

    it('약한 비밀번호 시 BadRequestException', async () => {
      mockPrisma.patientAccount.findFirst.mockResolvedValue(null);

      await expect(service.signup({ ...validDto, password: '1234' })).rejects.toThrow(BadRequestException);
    });

    it('잘못된 PIN 형식 시 BadRequestException', async () => {
      mockPrisma.patientAccount.findFirst.mockResolvedValue(null);

      await expect(service.signup({ ...validDto, pin: 'abc' })).rejects.toThrow(BadRequestException);
    });

    it('필수 동의 누락 시 BadRequestException', async () => {
      mockPrisma.patientAccount.findFirst.mockResolvedValue(null);

      await expect(service.signup({ ...validDto, consents: { privacyCollect: true } })).rejects.toThrow(BadRequestException);
    });

    it('주소 포함 회원가입', async () => {
      mockPrisma.patientAccount.findFirst.mockResolvedValue(null);
      mockPrisma.patient.findFirst.mockResolvedValue(null);
      mockPrisma.patient.create.mockResolvedValue({ id: 'p1', mrn: 'APP-20260529-0002' });
      mockPrisma.patientAccount.create.mockResolvedValue({ id: 'a1', patientId: 'p1' });

      await service.signup({
        ...validDto,
        address: { zipCode: '06164', roadAddress: '서울 강남구', jibunAddress: '역삼동', detail: '101호' },
      });

      expect(mockPrisma.patientAddress.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ zipCode: '06164', isPrimary: true }),
        }),
      );
    });
  });

  // ── login ──

  describe('login', () => {
    it('정상 로그인 — 토큰 발급 + 기기 등록', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue(mockAccount);
      (bcrypt.compare as any).mockResolvedValue(true);
      mockPrisma.patientDevice.upsert.mockResolvedValue({});

      const result = await service.login('01012345678', 'Test1234!', 'device-1', 'iOS');

      expect(result.accountId).toBe('account-1');
      expect(result.patientName).toBe('김환자');
      expect(result.accessToken).toBeDefined();
      expect(mockPrisma.patientAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ failedAttempts: 0 }) }),
      );
    });

    it('미등록 번호 시 UnauthorizedException', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue(null);

      await expect(service.login('01099999999', 'pw', 'd1', 'iOS')).rejects.toThrow(UnauthorizedException);
    });

    it('탈퇴 계정 시 UnauthorizedException', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue({ ...mockAccount, status: 'WITHDRAWN' });

      await expect(service.login('01012345678', 'pw', 'd1', 'iOS')).rejects.toThrow(UnauthorizedException);
    });

    it('정지 계정 시 UnauthorizedException', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue({ ...mockAccount, status: 'SUSPENDED' });

      await expect(service.login('01012345678', 'pw', 'd1', 'iOS')).rejects.toThrow(UnauthorizedException);
    });

    it('잠긴 계정 시 UnauthorizedException + 남은 시간', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue({
        ...mockAccount,
        lockedUntil: new Date(Date.now() + 1800000),
      });

      await expect(service.login('01012345678', 'pw', 'd1', 'iOS')).rejects.toThrow('잠겼습니다');
    });

    it('비밀번호 틀리면 실패 횟수 증가', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue({ ...mockAccount, failedAttempts: 2 });
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(service.login('01012345678', 'wrong', 'd1', 'iOS')).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.patientAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ failedAttempts: 3 }) }),
      );
    });

    it('5회 실패 시 계정 잠금', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue({ ...mockAccount, failedAttempts: 4 });
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(service.login('01012345678', 'wrong', 'd1', 'iOS')).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.patientAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ failedAttempts: 5, lockedUntil: expect.any(Date) }),
        }),
      );
    });
  });

  // ── loginWithPin ──

  describe('loginWithPin', () => {
    it('정상 PIN 로그인', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue(mockAccount);
      mockPrisma.patientDevice.findUnique.mockResolvedValue({ id: 'dev-1', isActive: true });
      (bcrypt.compare as any).mockResolvedValue(true);

      const result = await service.loginWithPin('01012345678', '123456', 'device-1');

      expect(result.accountId).toBe('account-1');
      expect(result.accessToken).toBeDefined();
    });

    it('PIN 미설정 계정 시 UnauthorizedException', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue({ ...mockAccount, pinHash: null });

      await expect(service.loginWithPin('01012345678', '123456', 'd1')).rejects.toThrow(UnauthorizedException);
    });

    it('비활성 계정 시 UnauthorizedException', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue({ ...mockAccount, status: 'LOCKED' });

      await expect(service.loginWithPin('01012345678', '123456', 'd1')).rejects.toThrow(UnauthorizedException);
    });

    it('미등록 기기 시 UnauthorizedException', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue(mockAccount);
      mockPrisma.patientDevice.findUnique.mockResolvedValue(null);

      await expect(service.loginWithPin('01012345678', '123456', 'unknown')).rejects.toThrow(UnauthorizedException);
    });

    it('틀린 PIN 시 UnauthorizedException', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue(mockAccount);
      mockPrisma.patientDevice.findUnique.mockResolvedValue({ id: 'dev-1', isActive: true });
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(service.loginWithPin('01012345678', '000000', 'device-1')).rejects.toThrow(UnauthorizedException);
    });

    // 🔴 PIN 은 잠금을 보지도 실패를 세지도 않았다 — 비밀번호와 같은 카운터를 쓴다
    it('🔴 비밀번호로 잠긴 계정은 PIN 으로도 못 들어온다 — PIN 비교 전에 거부', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue({ ...mockAccount, lockedUntil: new Date(Date.now() + 1800000) });
      mockPrisma.patientDevice.findUnique.mockResolvedValue({ id: 'dev-1', isActive: true });
      (bcrypt.compare as any).mockClear();
      (bcrypt.compare as any).mockResolvedValue(true);

      await expect(service.loginWithPin('01012345678', '123456', 'device-1')).rejects.toThrow('잠겼습니다');
      expect(bcrypt.compare).not.toHaveBeenCalledWith('123456', mockAccount.pinHash);
    });

    it('🔴 틀린 PIN 은 실패 횟수를 누적한다', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue({ ...mockAccount, failedAttempts: 2 });
      mockPrisma.patientDevice.findUnique.mockResolvedValue({ id: 'dev-1', isActive: true });
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(service.loginWithPin('01012345678', '000000', 'device-1')).rejects.toThrow('PIN이 틀렸습니다');
      expect(mockPrisma.patientAccount.update).toHaveBeenCalledWith({ where: { id: 'account-1' }, data: { failedAttempts: 3 } });
    });

    it('🔴 PIN 5회째 실패에서 계정이 잠긴다(비밀번호와 같은 한도)', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue({ ...mockAccount, failedAttempts: 4 });
      mockPrisma.patientDevice.findUnique.mockResolvedValue({ id: 'dev-1', isActive: true });
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(service.loginWithPin('01012345678', '000000', 'device-1')).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.patientAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ failedAttempts: 5, lockedUntil: expect.any(Date) }) }),
      );
    });

    it('대조군 — 잠금 시각이 지난 계정의 정상 PIN 은 통과하고 카운터를 초기화한다', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue({ ...mockAccount, failedAttempts: 5, lockedUntil: new Date(Date.now() - 1000) });
      mockPrisma.patientDevice.findUnique.mockResolvedValue({ id: 'dev-1', isActive: true });
      (bcrypt.compare as any).mockResolvedValue(true);

      const result = await service.loginWithPin('01012345678', '123456', 'device-1');
      expect(result.accountId).toBe('account-1');
      expect(mockPrisma.patientAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'account-1' }, data: expect.objectContaining({ failedAttempts: 0, lockedUntil: null }) }),
      );
    });
  });

  // ── refreshToken ──

  describe('refreshToken', () => {
    it('정상 토큰 갱신', async () => {
      (jwt.verify as any).mockReturnValue({ sub: 'account-1', pid: 'patient-1', phone: '010', type: 'patient-refresh' });
      mockPrisma.patientDevice.findMany.mockResolvedValue([{ refreshTokenHash: 'hash1' }]);
      (bcrypt.compare as any).mockResolvedValue(true);

      const result = await service.refreshToken('valid-refresh-token');

      expect(result.accessToken).toBeDefined();
      expect(result.expiresAt).toBeDefined();
    });

    it('만료 토큰 시 UnauthorizedException', async () => {
      (jwt.verify as any).mockImplementation(() => { throw new Error('expired'); });

      await expect(service.refreshToken('expired-token')).rejects.toThrow(UnauthorizedException);
    });

    it('잘못된 토큰 타입 시 UnauthorizedException', async () => {
      (jwt.verify as any).mockReturnValue({ sub: 'a1', type: 'patient' });

      await expect(service.refreshToken('wrong-type')).rejects.toThrow(UnauthorizedException);
    });

    it('기기 매칭 실패 시 UnauthorizedException', async () => {
      (jwt.verify as any).mockReturnValue({ sub: 'a1', pid: 'p1', phone: '010', type: 'patient-refresh' });
      mockPrisma.patientDevice.findMany.mockResolvedValue([{ refreshTokenHash: 'hash1' }]);
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(service.refreshToken('unmatched-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── logout ──

  describe('logout', () => {
    it('특정 기기 로그아웃', async () => {
      await service.logout('account-1', 'device-1');

      expect(mockPrisma.patientDevice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accountId: 'account-1', deviceId: 'device-1' },
          data: { isActive: false, refreshTokenHash: null },
        }),
      );
    });

    it('전체 기기 로그아웃 (deviceId 미지정)', async () => {
      await service.logout('account-1');

      expect(mockPrisma.patientDevice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accountId: 'account-1' },
        }),
      );
    });
  });

  // ── changePassword ──

  describe('changePassword', () => {
    it('정상 비밀번호 변경 + 전체 기기 로그아웃', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue(mockAccount);
      (bcrypt.compare as any).mockResolvedValueOnce(true).mockResolvedValueOnce(false); // current OK, previous check OK

      const result = await service.changePassword('account-1', 'OldPass1!', 'NewPass1!');

      expect(result.success).toBe(true);
      expect(mockPrisma.patientAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ passwordChangedAt: expect.any(Date) }),
        }),
      );
      // 전체 기기 로그아웃도 호출
      expect(mockPrisma.patientDevice.updateMany).toHaveBeenCalled();
    });

    it('현재 비밀번호 틀리면 UnauthorizedException', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue(mockAccount);
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(service.changePassword('account-1', 'wrong', 'new')).rejects.toThrow(UnauthorizedException);
    });

    it('존재하지 않는 계정 시 UnauthorizedException', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue(null);

      await expect(service.changePassword('none', 'a', 'b')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── verifyAccessToken ──

  describe('verifyAccessToken', () => {
    it('유효한 토큰 검증', async () => {
      (jwt.verify as any).mockReturnValue({ sub: 'account-1', pid: 'patient-1', type: 'patient' });

      const result = await service.verifyAccessToken('valid-token');

      expect(result.accountId).toBe('account-1');
      expect(result.patientId).toBe('patient-1');
    });

    it('잘못된 토큰 시 UnauthorizedException', async () => {
      (jwt.verify as any).mockImplementation(() => { throw new Error(); });

      await expect(service.verifyAccessToken('bad')).rejects.toThrow(UnauthorizedException);
    });

    it('타입이 patient가 아니면 UnauthorizedException', async () => {
      (jwt.verify as any).mockReturnValue({ sub: 'a1', pid: 'p1', type: 'staff' });

      await expect(service.verifyAccessToken('wrong-type')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── setPin ──

  describe('setPin', () => {
    it('정상 PIN 설정', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue(mockAccount);
      (bcrypt.compare as any).mockResolvedValue(true);

      const result = await service.setPin('account-1', 'Test1234!', '654321');

      expect(result.success).toBe(true);
      expect(mockPrisma.patientAccount.update).toHaveBeenCalled();
    });

    it('비밀번호 틀리면 UnauthorizedException', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue(mockAccount);
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(service.setPin('account-1', 'wrong', '654321')).rejects.toThrow(UnauthorizedException);
    });

    it('잘못된 PIN 형식 시 BadRequestException', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue(mockAccount);
      (bcrypt.compare as any).mockResolvedValue(true);

      await expect(service.setPin('account-1', 'Test1234!', 'abc')).rejects.toThrow(BadRequestException);
    });
  });

  // ── getDevices / removeDevice ──

  describe('getDevices', () => {
    it('기기 목록 조회', async () => {
      mockPrisma.patientDevice.findMany.mockResolvedValue([
        { id: 'd1', deviceId: 'dev-1', platform: 'iOS', isActive: true },
      ]);

      const result = await service.getDevices('account-1');

      expect(result).toHaveLength(1);
      expect(result[0].platform).toBe('iOS');
    });
  });

  describe('removeDevice', () => {
    it('기기 삭제 (원격 로그아웃)', async () => {
      mockPrisma.patientDevice.updateMany.mockResolvedValue({ count: 1 });
      const result = await service.removeDevice('account-1', 'dev-db-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.patientDevice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dev-db-1', accountId: 'account-1' },
        }),
      );
    });
  });
});
