import { describe, it, expect, vi } from 'vitest';
import { HandoffReminderCron } from '../../src/modules/inpatient/handoff-reminder.cron';

/**
 * 미확인 인수인계 재알림 — 기획 v2 P1-2.
 * acknowledge 를 안 하면 아무 일도 일어나지 않았다 — 최초 알림을 놓친 인계가 영영 묻혔다.
 */
const STALE = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  toDoctorId: 'nurse-b',
  createdAt: new Date(Date.now() - 5 * 3600_000),
  patient: { familyName: '김', givenName: '영수', mrn: 'P-1' },
};

function build(cfg: Record<string, unknown>, rows: unknown[] = [STALE], recent: unknown = null) {
  const prisma: any = {
    clinicalHandoff: { findMany: vi.fn().mockResolvedValue(rows) },
    notification: { findFirst: vi.fn().mockResolvedValue(recent) },
  };
  const notifications = { notify: vi.fn().mockResolvedValue({ id: 'n1' }) };
  const config = { get: vi.fn(async (k: string) => cfg[k]) };
  const cron = new HandoffReminderCron(prisma, notifications as never, config as never);
  return { cron, prisma, notifications };
}

describe('미확인 인계 재알림', () => {
  it('기본은 OFF — 설정 없으면 조회조차 하지 않는다', async () => {
    const { cron, prisma } = build({});
    expect(await cron.remindUnacknowledged()).toEqual({ notified: 0, targets: 0 });
    expect(prisma.clinicalHandoff.findMany).not.toHaveBeenCalled();
  });

  it('N시간 경과·미확인만 — 유형 무관(의사 인계도 묻히면 안 된다)', async () => {
    const { cron, prisma } = build({ 'nursing.handoff.remindAfterHours': 2 });
    await cron.remindUnacknowledged();
    const where = prisma.clinicalHandoff.findMany.mock.calls[0][0].where;
    expect(where.acknowledgedAt).toBeNull();
    expect(where.createdAt.lt).toBeInstanceOf(Date);
    expect(where.type).toBeUndefined();
  });

  it('인수자에게 재알림 — refId 는 handoff id(알림 refId 계약)·경과시간 명시', async () => {
    const { cron, notifications } = build({ 'nursing.handoff.remindAfterHours': 2 });
    const r = await cron.remindUnacknowledged();
    expect(r.notified).toBe(1);
    const [userId, input] = notifications.notify.mock.calls[0];
    expect(userId).toBe('nurse-b');
    expect(input.type).toBe('CLINICAL_HANDOFF_REMINDER');
    expect(input.refId).toBe(STALE.id);
    expect(input.message).toContain('5시간째');
  });

  it('같은 건 재알림은 N시간 간격 억제 — 매시간 쏘면 알림 무시가 학습된다', async () => {
    const { cron, notifications } = build({ 'nursing.handoff.remindAfterHours': 2 }, [STALE], { id: 'n-recent' });
    const r = await cron.remindUnacknowledged();
    expect(r.notified).toBe(0);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('개별 실패는 나머지를 막지 않는다', async () => {
    const second = { ...STALE, id: '4a2504e0-4f89-41d3-9a0c-0305e82c3302' };
    const { cron, notifications } = build({ 'nursing.handoff.remindAfterHours': 2 }, [STALE, second]);
    notifications.notify.mockRejectedValueOnce(new Error('boom'));
    const r = await cron.remindUnacknowledged();
    expect(r.notified).toBe(1);
  });
});
