import { describe, it, expect, vi } from 'vitest';
import { DraftChartReminderCron, draftChartRecipient } from '../../src/modules/encounter/draft-chart-reminder.cron';

/**
 * 처방 달린 미서명(DRAFT) 진료 회수 알림 — 2026-08-03.
 *
 * 🔴 처방은 나갔는데 차트가 안 닫힌 진료가 쌓였다(운영 실측 30건·처방 111건).
 *    서명 전엔 기록 미완결·수납/청구 정지. 대기열 게이트는 대기열 밖 경로를 못 막는다.
 */
const DRAFT = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  doctorId: 'doc-1',
  doctor: { role: 'DOCTOR', isActive: true },
  admission: null,
  appointment: null,
  createdAt: new Date(Date.now() - 3 * 86_400_000),
  patient: { familyName: '김', givenName: '영수', mrn: 'P2026-0001' },
  _count: { prescriptions: 4 },
};

function build(cfg: Record<string, unknown>, drafts: unknown[] = [DRAFT], recentNotification: unknown = null) {
  const prisma: any = {
    encounter: { findMany: vi.fn().mockResolvedValue(drafts) },
    notification: { findFirst: vi.fn().mockResolvedValue(recentNotification) },
  };
  const notifications = { notify: vi.fn().mockResolvedValue({ id: 'n1' }) };
  const config = { get: vi.fn(async (k: string) => cfg[k]) };
  const cron = new DraftChartReminderCron(prisma, notifications as never, config as never);
  return { cron, prisma, notifications };
}

describe('미서명 차트 회수 알림', () => {
  it('기본은 OFF — 설정 없으면 조회조차 하지 않는다', async () => {
    const { cron, prisma } = build({});
    const r = await cron.remindDraftCharts();
    expect(r).toEqual({ notified: 0, targets: 0, noRecipient: 0 });
    expect(prisma.encounter.findMany).not.toHaveBeenCalled();
  });

  it('처방 달린 DRAFT 만 — 처방 없는 DRAFT 는 진행 중 작성일 수 있다', async () => {
    const { cron, prisma } = build({ 'encounter.draftReminder.afterHours': 24 });
    await cron.remindDraftCharts();
    const where = prisma.encounter.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('DRAFT');
    expect(where.prescriptions).toEqual({ some: {} });
    expect(where.createdAt.lt).toBeInstanceOf(Date);
  });

  it('담당의에게 알림 — refId 는 encounter id(UUID·알림 refId 계약)', async () => {
    const { cron, notifications } = build({ 'encounter.draftReminder.afterHours': 24 });
    const r = await cron.remindDraftCharts();
    expect(r.notified).toBe(1);
    const [userId, input] = notifications.notify.mock.calls[0];
    expect(userId).toBe('doc-1');
    expect(input.type).toBe('DRAFT_CHART_REMINDER');
    expect(input.refId).toBe(DRAFT.id);
    expect(input.message).toContain('처방 4건');
  });

  it('repeatDays 내 재알림 억제 — 매일 쏘면 알림 무시가 학습된다', async () => {
    const { cron, notifications } = build(
      { 'encounter.draftReminder.afterHours': 24 }, [DRAFT], { id: 'n-recent' },
    );
    const r = await cron.remindDraftCharts();
    expect(r.notified).toBe(0);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('개별 실패는 나머지를 막지 않는다', async () => {
    const second = { ...DRAFT, id: '4a2504e0-4f89-41d3-9a0c-0305e82c3302', doctorId: 'doc-2' };
    const { cron, notifications } = build({ 'encounter.draftReminder.afterHours': 24 }, [DRAFT, second]);
    notifications.notify.mockRejectedValueOnce(new Error('boom'));
    const r = await cron.remindDraftCharts();
    expect(r.notified).toBe(1);
  });

  /**
   * 🔴 2026-10-10 — 관리자 계정이 연 진료의 회수 알림이 관리자 한 계정에 몰렸다
   *    (운영 실측: DRAFT_CHART_REMINDER 1,341건 전부 admin · 진료 93건 · 경보 등록부 targetRoles = DOCTOR).
   */
  describe('수신자 — 작성 의사 → 담당의 → 없음(관리자 대체 없음)', () => {
    const ADMIN = { role: 'ADMIN', isActive: true };
    const DOC = { role: 'DOCTOR', isActive: true };
    it('🔴 작성자가 관리자면 관리자에게 보내지 않는다 — 입원 주치의에게', async () => {
      const e = { ...DRAFT, doctorId: 'admin-1', doctor: ADMIN, admission: { attendingDoctorId: 'att-1', attendingDoctor: DOC } };
      const { cron, notifications } = build({ 'encounter.draftReminder.afterHours': 24 }, [e]);
      const r = await cron.remindDraftCharts();
      expect(notifications.notify.mock.calls[0][0]).toBe('att-1');
      expect(r).toMatchObject({ notified: 1, noRecipient: 0 });
    });
    it('입원 주치의가 없으면 예약 의사', async () => {
      const e = { ...DRAFT, doctorId: 'admin-1', doctor: ADMIN, appointment: { doctorId: 'appt-doc', doctor: DOC } };
      const { cron, notifications } = build({ 'encounter.draftReminder.afterHours': 24 }, [e]);
      await cron.remindDraftCharts();
      expect(notifications.notify.mock.calls[0][0]).toBe('appt-doc');
    });
    it('🔴 담당의도 없으면 보내지 않고 수신자 없음으로 센다(조용히 0 이 아니다)', async () => {
      const e = { ...DRAFT, doctorId: 'admin-1', doctor: ADMIN };
      const { cron, notifications, prisma } = build({ 'encounter.draftReminder.afterHours': 24 }, [e]);
      const r = await cron.remindDraftCharts();
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(r).toEqual({ notified: 0, targets: 1, noRecipient: 1 });
      expect(prisma.notification.findFirst).not.toHaveBeenCalled();
    });
    it('비활성 의사 계정(퇴직)에게도 보내지 않는다 · 비활성 주치의도 건너뛴다', async () => {
      const e = { ...DRAFT, doctor: { role: 'DOCTOR', isActive: false }, admission: { attendingDoctorId: 'att-x', attendingDoctor: { role: 'DOCTOR', isActive: false } }, appointment: { doctorId: 'appt-doc', doctor: DOC } };
      expect(draftChartRecipient(e)).toBe('appt-doc');
    });
    it('대조군 — 작성자가 활성 의사면 본인(주치의가 따로 있어도)', () => {
      expect(draftChartRecipient({ ...DRAFT, admission: { attendingDoctorId: 'att-1', attendingDoctor: DOC } })).toBe('doc-1');
    });
    it('조회가 수신자 판정에 필요한 역할·활성·주치의·예약 의사를 가져온다', async () => {
      const { cron, prisma } = build({ 'encounter.draftReminder.afterHours': 24 });
      await cron.remindDraftCharts();
      const sel = prisma.encounter.findMany.mock.calls[0][0].select;
      expect(sel.doctor.select).toEqual({ role: true, isActive: true });
      expect(sel.admission.select.attendingDoctor.select).toEqual({ role: true, isActive: true });
      expect(sel.appointment.select.doctor.select).toEqual({ role: true, isActive: true });
    });
  });
});
