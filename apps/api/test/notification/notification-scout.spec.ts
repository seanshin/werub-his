import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationService } from '../../src/modules/notification/notification.service';

/** 알림 전면 검토(2026-07-24) — IDOR·보존·notify 정규 경로 */
describe('NotificationService — scout fixes', () => {
  let svc: NotificationService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      notification: {
        create: vi.fn(({ data }: any) => Promise.resolve({ id: 'n1', ...data })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
        count: vi.fn().mockResolvedValue(0),
      },
      patientNotification: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    svc = new NotificationService(prisma);
  });

  it('markRead — 소유자 스코프(타인 알림 읽음/내용 노출 IDOR 봉합)', async () => {
    await svc.markRead('nid', 'user-1');
    const args = prisma.notification.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'nid', userId: 'user-1' });

    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    const r = await svc.markRead('other-user-nid', 'user-1');
    expect(r.ok).toBe(false); // 타인 소유 — 내용 미반환·미변경
  });

  it('notify — 생성+SSE 푸시 동시(정규 발신 경로)', async () => {
    const pushSpy = vi.spyOn(svc, 'pushNotification');
    // refId 는 @db.Uuid — 임의 문자열('o1')은 저장 단계에서 걸러진다(ref-id-contract.spec 참조)
    const orderId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    await svc.notify('u1', { type: 'T', title: '제목', message: '본문', refType: 'ORDER', refId: orderId });
    expect(prisma.notification.create).toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledWith('u1', expect.objectContaining({ id: 'n1', refType: 'ORDER', refId: orderId }));
  });

  it('purgeOld — 읽음 90일·미읽음 180일 기준으로 직원/환자 알림 삭제', async () => {
    const r = await svc.purgeOld();
    expect(r.purged).toBe(2 + 2 + 1 + 1);
    const calls = prisma.notification.deleteMany.mock.calls.map((c: any[]) => c[0].where);
    expect(calls[0].isRead).toBe(true);
    expect(calls[1].isRead).toBe(false);
    // 미읽음 컷이 읽음 컷보다 과거(더 오래 보존)
    expect(calls[1].createdAt.lt.getTime()).toBeLessThan(calls[0].createdAt.lt.getTime());
  });

  it('severity 정규화 — 비표준 값이 표준 3단계로 수렴', async () => {
    const cases: [string, string][] = [
      ['ERROR', 'CRITICAL'], ['CONTRAINDICATED', 'CRITICAL'], ['CRITICAL', 'CRITICAL'],
      ['WARN', 'WARNING'], ['URGENT', 'WARNING'], ['HIGH', 'WARNING'], ['WARNING', 'WARNING'],
      ['LOW', 'INFO'], ['MILD', 'INFO'], ['INFO', 'INFO'], ['UNKNOWN_X', 'INFO'],
    ];
    for (const [input, expected] of cases) {
      prisma.notification.create.mockClear();
      await svc.create('u1', { type: 'T', title: 't', message: 'm', severity: input });
      expect(prisma.notification.create.mock.calls[0][0].data.severity).toBe(expected);
    }
  });
});
