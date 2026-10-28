import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WaitingQueueService } from '../../src/modules/waiting-queue/waiting-queue.service';

/**
 * 묵은 외래 대기 자동 마감 — 2026-08-03 신설.
 *
 * 접수만 하고 진료를 받지 않은 대기가 계속 쌓여 대기 인원·평균 대기시간·상황판을 왜곡한다
 * (실측: 1일 넘게 WAITING 인 접수 188건). 응급 방문 자동 종결과 같은 규약(0=OFF 기본).
 */
function build(hours: unknown) {
  const prisma: any = {
    waitingQueue: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'q1', departmentName: '내과' },
        { id: 'q2', departmentName: '외과' },
      ]),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const events = { emit: vi.fn() };
  const config = { get: vi.fn().mockResolvedValue(hours) };
  const svc = new WaitingQueueService(prisma, events as never, undefined, config as never);
  return { svc, prisma, events, config };
}

describe('묵은 대기 자동 마감', () => {
  it('기본은 OFF — 설정이 0이면 아무것도 건드리지 않는다', async () => {
    const { svc, prisma } = build(0);
    const r = await svc.autoCloseStaleQueues();
    expect(r).toEqual({ closed: 0, hours: 0 });
    expect(prisma.waitingQueue.findMany).not.toHaveBeenCalled();
  });

  it('설정이 없어도(미설정) 꺼진 것으로 본다', async () => {
    const { svc, prisma } = build(undefined);
    await svc.autoCloseStaleQueues();
    expect(prisma.waitingQueue.findMany).not.toHaveBeenCalled();
  });

  it('대상은 WAITING·CALLED 만 — 진료중/수납대기는 건드리지 않는다', async () => {
    const { svc, prisma } = build(24);
    await svc.autoCloseStaleQueues();
    const where = prisma.waitingQueue.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['WAITING', 'CALLED'] });
    expect(where.checkedInAt.lt).toBeInstanceOf(Date);
  });

  it('미방문(NO_SHOW)으로 전이하고 완료 시각은 채우지 않는다', async () => {
    const { svc, prisma } = build(24);
    const r = await svc.autoCloseStaleQueues();
    expect(r.closed).toBe(2);
    for (const call of prisma.waitingQueue.update.mock.calls) {
      expect(call[0].data).toEqual({ status: 'NO_SHOW' });
      // 진료를 마친 게 아니므로 completedAt 을 채우면 '완료 시각' 불변식과 충돌한다
      expect(call[0].data.completedAt).toBeUndefined();
    }
  });

  it('상황판이 갱신되도록 이벤트를 낸다', async () => {
    const { svc, events } = build(24);
    await svc.autoCloseStaleQueues();
    expect(events.emit).toHaveBeenCalledWith('queue.changed', { queueId: 'q1', status: 'NO_SHOW' });
  });

  it('개별 실패는 나머지를 막지 않는다', async () => {
    const { svc, prisma } = build(24);
    prisma.waitingQueue.update.mockRejectedValueOnce(new Error('db'));
    const r = await svc.autoCloseStaleQueues();
    expect(r.closed).toBe(1);
  });
});
