import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SmsOtpService } from '../../src/modules/patient-auth/services/sms-otp.service';

describe('SmsOtpService', () => {
  let service: SmsOtpService;
  let mockPrisma: any;
  let mockChannel: any;

  beforeEach(() => {
    mockPrisma = {
      smsVerification: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'otp-1' }),
        update: vi.fn(),
        deleteMany: vi.fn(),
      },
      // 🔴 SMS 머리말 `[기관명] ` 은 정본 `system_configs hospital.name` **DB 행**에서 온다(종전엔 '[Hospital RUN]' 상수).
      //    목은 정본의 실제 반환 모양: findMany({where:{key:{in}},select:{key,value}}) → [{key, value}]
      systemConfig: { findMany: vi.fn().mockResolvedValue([{ key: 'hospital.name', value: '위루비병원' }]) },
    };

    // 정본(CrmChannelService)의 현재 사실: SMS 제공자가 등록돼 있지 않아 '제공자 없음' 분기를 탄다
    // → `{ success: true, simulated: true }`(= 성공이지만 나가지 않았다).
    mockChannel = { send: vi.fn().mockResolvedValue({ success: true, simulated: true, messageId: 'sim-1' }) };

    service = new SmsOtpService(mockPrisma, mockChannel);
  });

  // ── send ──

  describe('send', () => {
    /**
     * 🔴 원 결함(2026-08-14 W8·P16): 종전 스펙은 `result.sent === true` 를 계약으로 굳혀뒀는데,
     *    구현이 SMS 제공자 유무와 무관하게 `{ sent: true }` 를 돌려줬기 때문에 그 단언은
     *    **아무것도 보증하지 않았다**. 인증번호는 서버 로그에만 찍혔고 환자는 오지 않는 문자를
     *    기다렸다. 이제 `sent` 는 **실제로 나간 경우에만** true 다.
     */
    it('제공자가 실제로 보냈으면 SENT', async () => {
      mockPrisma.smsVerification.findFirst.mockResolvedValue(null);
      mockChannel.send.mockResolvedValue({ success: true, messageId: 'real-1' });

      const result = await service.send('01012345678', 'SIGNUP', '127.0.0.1');

      expect(result.delivery).toBe('SENT');
      expect(result.sent).toBe(true);
    });

    it('🔴 제공자가 없으면(시뮬) SENT 가 아니라 SIMULATED — sent=false', async () => {
      mockPrisma.smsVerification.findFirst.mockResolvedValue(null);

      const result = await service.send('01012345678', 'SIGNUP', '127.0.0.1');

      expect(result.delivery).toBe('SIMULATED');
      expect(result.sent).toBe(false);
      expect(result.message).toContain('실제로 발송되지 않았습니다');
      // OTP 자체는 정상 발급된다(로그인 흐름을 막지 않는다)
      expect(mockPrisma.smsVerification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phone: '01012345678',
            purpose: 'SIGNUP',
            code: expect.stringMatching(/^\d{6}$/),
          }),
        }),
      );
    });

    it('채널이 실패를 반환하거나 예외를 던지면 FAILED — 그래도 예외로 흐름을 끊지 않는다', async () => {
      mockPrisma.smsVerification.findFirst.mockResolvedValue(null);
      mockChannel.send.mockResolvedValue({ success: false, error: 'provider down' });
      await expect(service.send('01012345678', 'SIGNUP')).resolves.toMatchObject({ delivery: 'FAILED', sent: false });

      mockPrisma.smsVerification.findFirst.mockResolvedValue(null);
      mockChannel.send.mockRejectedValue(new Error('boom'));
      await expect(service.send('01012345678', 'SIGNUP')).resolves.toMatchObject({ delivery: 'FAILED', sent: false });
    });

    it('🔴 인증번호를 응답에 담지 않는다(개발 편의로도 안 된다 — 인증 우회)', async () => {
      mockPrisma.smsVerification.findFirst.mockResolvedValue(null);

      const result = await service.send('01012345678', 'SIGNUP');
      const issued = mockPrisma.smsVerification.create.mock.calls[0][0].data.code as string;

      expect(JSON.stringify(result)).not.toContain(issued);
      expect(Object.keys(result)).not.toContain('code');
    });

    it('미발송이어도 발급한 OTP 로 검증이 통과한다(환자 로그인 흐름이 죽지 않는다)', async () => {
      mockPrisma.smsVerification.findFirst.mockResolvedValue(null);
      const r = await service.send('01012345678', 'LOGIN');
      expect(r.delivery).toBe('SIMULATED');

      const issued = mockPrisma.smsVerification.create.mock.calls[0][0].data.code as string;
      mockPrisma.smsVerification.findFirst.mockResolvedValue({
        id: 'otp-1', phone: '01012345678', code: issued, purpose: 'LOGIN',
        verified: false, attempts: 0, expiresAt: new Date(Date.now() + 180000),
      });

      await expect(service.verify('01012345678', issued, 'LOGIN')).resolves.toBe(true);
    });

    it('발송 판정 정본을 재사용한다 — SMS 채널로 위임', async () => {
      mockPrisma.smsVerification.findFirst.mockResolvedValue(null);
      await service.send('01012345678', 'SIGNUP');
      expect(mockChannel.send).toHaveBeenCalledWith('SMS', '01012345678', expect.any(String), expect.any(String));
    });

    /**
     * 🔴 SMS 머리말 — 종전엔 `[Hospital RUN] 인증번호 …` 였다. 환자 휴대폰에 찍히는 발신 기관명을
     *    제품 이름으로 지어낸 것이다. 정본 DB 행이 있으면 그 이름을, 없으면 **머리말 없이** 보낸다.
     */
    it('🔴 머리말 기관명은 정본(DB 행)에서 온다 — 코드에 박힌 이름이 아니다', async () => {
      mockPrisma.smsVerification.findFirst.mockResolvedValue(null);
      await service.send('01012345678', 'SIGNUP');
      const body = mockChannel.send.mock.calls[0][3] as string;
      expect(body).toMatch(/^\[위루비병원\] 인증번호 \d{6} /);
      expect(body).not.toContain('Hospital RUN');
    });

    it('🔴 기관명이 미설정이면 머리말을 지어내지 않는다 — 머리말 없이 본문만 나간다', async () => {
      mockPrisma.smsVerification.findFirst.mockResolvedValue(null);
      mockPrisma.systemConfig.findMany.mockResolvedValue([]);
      await service.send('01012345678', 'SIGNUP');
      const body = mockChannel.send.mock.calls[0][3] as string;
      expect(body).toMatch(/^인증번호 \d{6} /);
      expect(body).not.toContain('[');
    });

    it('🔴 설정 조회 실패는 머리말 없음으로 접지 않는다 — 전파한다(실패≠미설정)', async () => {
      mockPrisma.smsVerification.findFirst.mockResolvedValue(null);
      mockPrisma.systemConfig.findMany.mockRejectedValue(new Error('DB down'));
      await expect(service.send('01012345678', 'SIGNUP')).rejects.toThrow('DB down');
      // 쓰이지 않을 인증번호 행을 남기지 않는다(머리말을 OTP 생성 **전에** 읽는다)
      expect(mockPrisma.smsVerification.create).not.toHaveBeenCalled();
    });

    it('일일 발송 10회 초과 시 BadRequestException', async () => {
      mockPrisma.smsVerification.count.mockResolvedValue(10);

      await expect(service.send('01012345678', 'SIGNUP')).rejects.toThrow(BadRequestException);
      await expect(service.send('01012345678', 'SIGNUP')).rejects.toThrow('일일');
    });

    it('1분 이내 재발송 시 BadRequestException', async () => {
      mockPrisma.smsVerification.findFirst.mockResolvedValue({ id: 'recent' });

      await expect(service.send('01012345678', 'SIGNUP')).rejects.toThrow(BadRequestException);
      await expect(service.send('01012345678', 'SIGNUP')).rejects.toThrow('1분');
    });
  });

  // ── verify ──

  describe('verify', () => {
    const validOtp = {
      id: 'otp-1',
      phone: '01012345678',
      code: '123456',
      purpose: 'SIGNUP',
      verified: false,
      attempts: 0,
      expiresAt: new Date(Date.now() + 180000), // 3분 후
    };

    it('정상 OTP 검증', async () => {
      mockPrisma.smsVerification.findFirst.mockResolvedValue(validOtp);

      const result = await service.verify('01012345678', '123456', 'SIGNUP');

      expect(result).toBe(true);
      expect(mockPrisma.smsVerification.update).toHaveBeenCalledTimes(2); // attempts +1, verified=true
    });

    it('OTP 요청 없이 검증 시 BadRequestException', async () => {
      mockPrisma.smsVerification.findFirst.mockResolvedValue(null);

      await expect(service.verify('01012345678', '123456', 'SIGNUP')).rejects.toThrow('먼저 요청');
    });

    it('만료된 OTP 시 BadRequestException', async () => {
      mockPrisma.smsVerification.findFirst.mockResolvedValue({
        ...validOtp,
        expiresAt: new Date(Date.now() - 1000), // 이미 만료
      });

      await expect(service.verify('01012345678', '123456', 'SIGNUP')).rejects.toThrow('만료');
    });

    it('시도 횟수 5회 초과 시 BadRequestException', async () => {
      mockPrisma.smsVerification.findFirst.mockResolvedValue({
        ...validOtp,
        attempts: 5,
      });

      await expect(service.verify('01012345678', '123456', 'SIGNUP')).rejects.toThrow('초과');
    });

    it('틀린 코드 시 BadRequestException + 시도 횟수 증가', async () => {
      mockPrisma.smsVerification.findFirst.mockResolvedValue(validOtp);

      await expect(service.verify('01012345678', '999999', 'SIGNUP')).rejects.toThrow('일치하지 않습니다');
      expect(mockPrisma.smsVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { attempts: { increment: 1 } },
        }),
      );
    });
  });

  // ── purgeExpired ──

  describe('purgeExpired', () => {
    it('만료된 OTP 정리', async () => {
      mockPrisma.smsVerification.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.purgeExpired();

      expect(result).toBe(5);
      expect(mockPrisma.smsVerification.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { expiresAt: { lt: expect.any(Date) } },
        }),
      );
    });
  });
});
