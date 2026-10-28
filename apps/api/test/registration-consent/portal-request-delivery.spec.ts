import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RegistrationConsentService } from '../../src/modules/registration-consent/registration-consent.service';

/**
 * H3 (화면 실사용 점검 W8 잔여배치) — 포털 계정이 없어도 "전송되었습니다".
 *
 * 🔴 종전: `sendPortalRequest()` 가 계정이 없으면 `PatientNotification` 을 **하나도 만들지 않고도**
 *    `{ success:true, '포털 동의 요청이 전송되었습니다' }` 를 반환했다. 원무 창구는 환자가
 *    받지도 못한 요청을 기다렸다. 정본 `CrmChannelService.sendPortal` 과 같은 판정으로 수렴한다.
 */
describe('접수 동의 포털 요청 — 받을 곳이 없으면 발송이 아니다', () => {
  let service: RegistrationConsentService;
  let prisma: any;
  let events: any;

  beforeEach(() => {
    prisma = {
      patient: { findUnique: vi.fn().mockResolvedValue({ id: 'p-1', familyName: '김', givenName: '철수' }) },
      patientAccount: { findFirst: vi.fn() },
      patientNotification: { create: vi.fn() },
    };
    events = { emit: vi.fn() };
    service = new RegistrationConsentService(prisma, events, undefined);
  });

  it('🔴 포털 계정이 없으면 success:false 로 답한다', async () => {
    prisma.patientAccount.findFirst.mockResolvedValue(null);

    const r = await service.sendPortalRequest('p-1');

    expect(r.success).toBe(false);
    expect(r.delivered).toBe(false);
    expect(r.reason).toBe('NO_PORTAL_ACCOUNT');
    expect(r.message).toMatch(/전송되지 않았습니다/);
  });

  it('🔴 미발송이면 알림도 이벤트도 만들지 않는다', async () => {
    prisma.patientAccount.findFirst.mockResolvedValue(null);

    await service.sendPortalRequest('p-1');

    expect(prisma.patientNotification.create).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('계정이 있으면 알림을 만들고 전달 근거(notificationId)를 싣는다', async () => {
    prisma.patientAccount.findFirst.mockResolvedValue({ id: 'acc-1' });
    prisma.patientNotification.create.mockResolvedValue({ id: 'pn-1' });

    const r = await service.sendPortalRequest('p-1');

    expect(r.success).toBe(true);
    expect(r.delivered).toBe(true);
    expect(r.notificationId).toBe('pn-1');
    expect(events.emit).toHaveBeenCalledWith(
      'registration.consent.portal_requested',
      expect.objectContaining({ patientId: 'p-1', notificationId: 'pn-1' }),
    );
  });

  it('알림 기록에 실패하면 실패로 답한다 (fail-open 금지)', async () => {
    prisma.patientAccount.findFirst.mockResolvedValue({ id: 'acc-1' });
    prisma.patientNotification.create.mockRejectedValue(new Error('DB down'));

    const r = await service.sendPortalRequest('p-1');

    expect(r.success).toBe(false);
    expect(r.reason).toBe('NOTIFICATION_WRITE_FAILED');
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('환자가 없으면 종전대로 404 (판정 변경 아님)', async () => {
    prisma.patient.findUnique.mockResolvedValue(null);
    await expect(service.sendPortalRequest('nope')).rejects.toThrow('환자를 찾을 수 없습니다');
  });
});
