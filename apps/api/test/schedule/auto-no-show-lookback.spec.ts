import { describe, it, expect, vi } from 'vitest';
import { ScheduleService } from '../../src/modules/schedule/schedule.service';

/**
 * 자동 노쇼 스윕의 되돌아보기 창 — 2026-08-03.
 *
 * 🔴 종전엔 `gte: now - 24h` 가 하드코딩이라 그보다 오래된 예약은 **켜도 영영 정리되지 않았다**
 *    (실측: 지난 예약 118건이 SCHEDULED 로 잔존). config 로 빼고 0=제한 없음을 허용한다.
 *    (같은 시기 발견: autoNoShow 3키가 DEFAULTS 에 없어 관리 화면에 뜨지도 않았다)
 */
function build(cfg: Record<string, unknown>) {
  const prisma: any = {
    appointment: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
  };
  const config = { get: vi.fn(async (k: string) => cfg[k]) };
  // 생성자 순서: (prisma, config, waitingQueue, events, journey)
  const svc = new ScheduleService(prisma, config as never);
  return { svc, prisma };
}

const whereOf = (prisma: any) => prisma.appointment.findMany.mock.calls[0][0].where;

describe('자동 노쇼 되돌아보기 창', () => {
  it('기본은 24시간 — 그 이전 예약은 대상이 아니다', async () => {
    const { svc, prisma } = build({ 'appointment.autoNoShow': true });
    await svc.autoNoShowSweep();
    const w = whereOf(prisma);
    expect(w.scheduledAt.gte).toBeInstanceOf(Date);
    const spanHours = (Date.now() - w.scheduledAt.gte.getTime()) / 3600_000;
    expect(spanHours).toBeGreaterThan(23.9);
    expect(spanHours).toBeLessThan(24.1);
  });

  it('설정한 시간만큼 되돌아본다', async () => {
    const { svc, prisma } = build({ 'appointment.autoNoShow': true, 'appointment.autoNoShow.lookbackHours': 720 });
    await svc.autoNoShowSweep();
    const spanHours = (Date.now() - whereOf(prisma).scheduledAt.gte.getTime()) / 3600_000;
    expect(spanHours).toBeGreaterThan(719);
  });

  it('0 이면 제한 없음 — 과거 누적분을 일괄 정리한다', async () => {
    const { svc, prisma } = build({ 'appointment.autoNoShow': true, 'appointment.autoNoShow.lookbackHours': 0 });
    await svc.autoNoShowSweep();
    expect(whereOf(prisma).scheduledAt.gte).toBeUndefined();
    expect(whereOf(prisma).scheduledAt.lt).toBeInstanceOf(Date);
  });

  it('기본은 여전히 OFF — 스위치가 꺼져 있으면 조회조차 하지 않는다', async () => {
    const { svc, prisma } = build({});
    await svc.autoNoShowSweep();
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
  });

  it('유예 0 을 30 으로 뒤집지 않는다', async () => {
    const { svc, prisma } = build({ 'appointment.autoNoShow': true, 'appointment.autoNoShow.graceMinutes': 0 });
    await svc.autoNoShowSweep();
    const graceMin = (Date.now() - whereOf(prisma).scheduledAt.lt.getTime()) / 60_000;
    expect(graceMin).toBeLessThan(0.5);
  });
});
