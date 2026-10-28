import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsentService } from '../../src/modules/consent/consent.service';

/**
 * H4 (화면 실사용 점검 W8 잔여배치) — 동의서 재전송이 결과를 확인하지 않는다.
 *
 * 🔴 종전: `resendNotification()` 이 `consent.created` 를 재발행하고 **리스너 결과를 보지 않은 채**
 *    '재전송되었습니다'. 리스너(`notification.listener.handleConsentCreated`)는 실재하지만
 *    포털 계정이 없으면 아무것도 만들지 않고, 내부 예외도 전부 삼킨다(warn 후 void).
 *
 * 리스너를 다시 만들지 않는다 — 산출물(PatientNotification)로 도달을 판정한다.
 */
describe('동의서 서명 요청 재전송 — 결과를 확인한 뒤에만 "재전송됨"', () => {
  let service: ConsentService;
  let prisma: any;
  let emitter: any;

  const pending = {
    id: 'c-1', patientId: 'p-1', doctorId: 'd-1', status: 'PENDING',
    consentType: 'SURGERY', type: 'SURGERY', templateName: '수술 동의서',
  };

  beforeEach(() => {
    prisma = {
      consentForm: { findUnique: vi.fn().mockResolvedValue(pending) },
      patientAccount: { findFirst: vi.fn() },
      patientNotification: { findFirst: vi.fn() },
    };
    emitter = { emit: vi.fn(), emitAsync: vi.fn().mockResolvedValue([undefined]) };
    service = new ConsentService(prisma, emitter);
  });

  it('🔴 포털 계정이 없으면 success:false — 이벤트도 던지지 않는다', async () => {
    prisma.patientAccount.findFirst.mockResolvedValue(null);

    const r = await service.resendNotification('c-1');

    expect(r.success).toBe(false);
    expect(r.reason).toBe('NO_PORTAL_ACCOUNT');
    // 발행하면 여정에 '동의서 요청'만 거짓으로 쌓인다
    expect(emitter.emitAsync).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('🔴 리스너 완료를 기다린 뒤(emitAsync) 산출물을 확인한다', async () => {
    prisma.patientAccount.findFirst.mockResolvedValue({ id: 'acc-1' });
    prisma.patientNotification.findFirst.mockResolvedValue({ id: 'pn-9' });

    const r = await service.resendNotification('c-1');

    expect(emitter.emitAsync).toHaveBeenCalledWith('consent.created', expect.objectContaining({ consentId: 'c-1' }));
    expect(prisma.patientNotification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ accountId: 'acc-1', type: 'CONSENT' }) }),
    );
    expect(r.success).toBe(true);
    expect(r.delivered).toBe(true);
    expect(r.notificationId).toBe('pn-9');
  });

  it('🔴 리스너가 알림을 만들지 못했으면 "재전송됨"이라고 말하지 않는다', async () => {
    prisma.patientAccount.findFirst.mockResolvedValue({ id: 'acc-1' });
    prisma.patientNotification.findFirst.mockResolvedValue(null); // 리스너가 예외를 삼킨 경우

    const r = await service.resendNotification('c-1');

    expect(r.success).toBe(false);
    expect(r.delivered).toBe(false);
    expect(r.reason).toBe('NOTIFICATION_NOT_CREATED');
  });

  it('emitAsync 미지원 emitter 에서도 동작한다(동기 emit 폴백)', async () => {
    const syncEmitter: any = { emit: vi.fn() };
    service = new ConsentService(prisma, syncEmitter);
    prisma.patientAccount.findFirst.mockResolvedValue({ id: 'acc-1' });
    prisma.patientNotification.findFirst.mockResolvedValue({ id: 'pn-1' });

    const r = await service.resendNotification('c-1');

    expect(syncEmitter.emit).toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it('PENDING 이 아니면 종전대로 거부한다 (판정 변경 아님)', async () => {
    prisma.consentForm.findUnique.mockResolvedValue({ ...pending, status: 'SIGNED' });
    await expect(service.resendNotification('c-1')).rejects.toThrow('PENDING 상태에서만 재전송 가능');
  });
});
