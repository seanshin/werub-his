import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationListener } from '../../src/modules/notification/notification.listener';

/**
 * EWS 에스컬레이션 통보 표기 가드.
 *
 * 🔴 실측 결함(2026-08-18): `early_warning_scores.escalation_notified` 는 컬럼과 FE 소비처
 *    (환자 안전바의 '보고 미통보' 빨강 배지)가 다 있는데 **쓰는 곳이 전역 0**이었다.
 *    주치의에게 알림이 실제로 갔어도 배지는 영원히 빨강 — 거짓 경보는 진짜 경보를 죽인다.
 *
 * 🔴 반대 방향도 사실이 아니다: 통보가 실패했는데 참으로 적으면 화면이 실제보다 안전하게 말한다.
 *    그래서 **실제 생성·푸시된 경우에만** 참으로 적는다(전송을 흉내내지 않는다).
 */
describe('EWS 에스컬레이션 — escalation_notified 쓰기 경로', () => {
  let prisma: any;
  let notificationService: any;
  let listener: NotificationListener;

  const ewsId = '22222222-2222-4222-8222-222222222222';
  const patientId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    prisma = {
      patient: { findUnique: vi.fn().mockResolvedValue({ familyName: '김', givenName: '환자' }) },
      admission: { findFirst: vi.fn().mockResolvedValue({ id: 'adm-1', attendingDoctorId: 'doc-1' }) },
      chargeOfCare: { findFirst: vi.fn().mockResolvedValue({ doctorId: 'doc-1' }) },
      encounter: { findFirst: vi.fn().mockResolvedValue(null) },
      notification: { findFirst: vi.fn().mockResolvedValue(null) },
      earlyWarningScore: { update: vi.fn().mockResolvedValue({}) },
    };
    notificationService = {
      create: vi.fn().mockResolvedValue({ id: 'n-1', type: 'EWS_ALERT', title: 't', message: 'm', severity: 'CRITICAL', refType: 'EWS', refId: ewsId }),
      pushNotification: vi.fn(),
    };
    listener = new NotificationListener(notificationService, { } as any, prisma, { } as any, undefined);
  });

  it('주치의에게 실제로 통보되면 escalation_notified 가 기록된다(시각까지)', async () => {
    await listener.handleEwsRecorded({ patientId, ewsId, riskLevel: 'HIGH', totalScore: 8, escalationRequired: true });

    expect(prisma.earlyWarningScore.update).toHaveBeenCalledTimes(1);
    const arg = prisma.earlyWarningScore.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: ewsId });
    expect(arg.data.escalationNotified).toBe(true);
    expect(arg.data.escalationNotifiedAt).toBeInstanceOf(Date);
  });

  it('🔴 통보 대상이 없으면 참으로 적지 않는다 — 화면이 실제보다 안전하게 말하면 안 된다', async () => {
    prisma.admission.findFirst.mockResolvedValue(null);
    prisma.chargeOfCare.findFirst.mockResolvedValue(null);
    prisma.encounter.findFirst.mockResolvedValue(null); // 주치의도 최근 진료의도 없음

    await listener.handleEwsRecorded({ patientId, ewsId, riskLevel: 'HIGH', totalScore: 8, escalationRequired: true });

    expect(notificationService.create).not.toHaveBeenCalled();
    expect(prisma.earlyWarningScore.update).not.toHaveBeenCalled();
  });

  it('알림 생성이 실패하면 통보로 적지 않는다(전송을 흉내내지 않는다)', async () => {
    notificationService.create.mockRejectedValue(new Error('DB down'));

    await listener.handleEwsRecorded({ patientId, ewsId, riskLevel: 'HIGH', totalScore: 8, escalationRequired: true });

    expect(prisma.earlyWarningScore.update).not.toHaveBeenCalled();
  });

  it('통보 기준 미달(저위험·escalation 불필요)이면 알림도 표기도 없다 — 과알림 방지', async () => {
    await listener.handleEwsRecorded({ patientId, ewsId, riskLevel: 'LOW', totalScore: 1, escalationRequired: false });

    expect(notificationService.create).not.toHaveBeenCalled();
    expect(prisma.earlyWarningScore.update).not.toHaveBeenCalled();
  });

  it('표기 쓰기가 실패해도 알림 처리는 예외로 터지지 않는다(비차단)', async () => {
    prisma.earlyWarningScore.update.mockRejectedValue(new Error('write fail'));

    await expect(
      listener.handleEwsRecorded({ patientId, ewsId, riskLevel: 'HIGH', totalScore: 8, escalationRequired: true }),
    ).resolves.toBeUndefined();
  });
});
