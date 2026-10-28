import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WaitingQueueService } from './waiting-queue.service';

/**
 * 잘못 누른 취소·미방문 되돌리기(2026-09-29) — 되돌릴 수 있는 것과 없는 것.
 * 종전엔 되돌릴 길이 없어 재접수 → 순번이 뒤로 밀리고 같은 날 같은 환자 대기 행이 둘 남았다.
 */
describe('대기 되돌리기(restore)', () => {
  const today = new Date();
  const base = { id: 'q1', patientId: 'p1', departmentName: '내과', status: 'CANCELLED', checkedInAt: today, startedAt: null, encounterId: null, queueNumber: 7 };
  let prisma: any;
  let emit: ReturnType<typeof vi.fn>;
  const svc = () => new WaitingQueueService(prisma, { emit } as any);

  beforeEach(() => {
    emit = vi.fn();
    prisma = {
      waitingQueue: {
        findUnique: vi.fn().mockResolvedValue({ ...base }),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...base, status: 'WAITING', completedAt: null }),
      },
    };
  });

  it('오늘 취소분 → WAITING · 종료 시각 비움 · 순번/접수 시각은 건드리지 않음 · SSE 신호', async () => {
    const res = await svc().restore('q1');
    expect(res.data.status).toBe('WAITING');
    const call = prisma.waitingQueue.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'q1', status: { in: ['CANCELLED', 'NO_SHOW'] } });
    expect(call.data).toEqual({ status: 'WAITING', completedAt: null });
    expect(emit).toHaveBeenCalledWith('queue.changed', expect.objectContaining({ queueId: 'q1' }));
  });

  it('미방문도 되돌린다', async () => {
    prisma.waitingQueue.findUnique.mockResolvedValue({ ...base, status: 'NO_SHOW' });
    await expect(svc().restore('q1')).resolves.toBeTruthy();
  });

  it.each(['WAITING', 'CALLED', 'IN_CONSULTATION', 'COMPLETED'])('%s 는 되돌릴 대상이 아니다(400)', async (status) => {
    prisma.waitingQueue.findUnique.mockResolvedValue({ ...base, status });
    await expect(svc().restore('q1')).rejects.toMatchObject({ status: 400 });
    expect(prisma.waitingQueue.updateMany).not.toHaveBeenCalled();
  });

  it('지난 날짜 접수는 소급하지 않는다(400)', async () => {
    const y = new Date(); y.setDate(y.getDate() - 1);
    prisma.waitingQueue.findUnique.mockResolvedValue({ ...base, checkedInAt: y });
    await expect(svc().restore('q1')).rejects.toMatchObject({ status: 400 });
    expect(prisma.waitingQueue.updateMany).not.toHaveBeenCalled();
  });

  it('진료가 시작된 적 있으면 되돌리지 않는다(400)', async () => {
    prisma.waitingQueue.findUnique.mockResolvedValue({ ...base, startedAt: new Date() });
    await expect(svc().restore('q1')).rejects.toMatchObject({ status: 400 });
    prisma.waitingQueue.findUnique.mockResolvedValue({ ...base, encounterId: 'e1' });
    await expect(svc().restore('q1')).rejects.toMatchObject({ status: 400 });
  });

  it('같은 과에 이미 다시 접수됐으면 409 — 대기가 둘이 되지 않게', async () => {
    prisma.waitingQueue.findFirst.mockResolvedValue({ id: 'q2' });
    await expect(svc().restore('q1')).rejects.toMatchObject({ status: 409 });
    const where = prisma.waitingQueue.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ patientId: 'p1', departmentName: '내과', id: { not: 'q1' } });
    expect(prisma.waitingQueue.updateMany).not.toHaveBeenCalled();
  });

  it('확인과 쓰기 사이에 상태가 바뀌면 덮어쓰지 않는다(409)', async () => {
    prisma.waitingQueue.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc().restore('q1')).rejects.toMatchObject({ status: 409 });
    expect(emit).not.toHaveBeenCalled();
  });
});
