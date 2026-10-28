import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoLiveCronService } from '../../src/modules/go-live/go-live-cron.service';

/**
 * 운영 전환 크론 — **발송 시도 ≠ 도달** 계약 (2026-08-14 신설).
 *
 * 예전 코드는 알림을 await 없이 던지고 곧장 "ADMIN N명 통보" 를 로그에 남겼다.
 * 실패해도 로그는 성공이라, 0건 도달을 아무도 몰랐다(refId 계약 위반으로 알림이 통째
 * 유실됐는데 로그에는 "N명 통보"였던 사고와 같은 계열).
 */
const UUID_A = '11111111-2222-3333-4444-555555555555';

const make = (opts: { admins?: number; notify?: any; overdue?: any[]; snap?: any }) => {
  const prisma: any = {
    user: { findMany: vi.fn().mockResolvedValue(Array.from({ length: opts.admins ?? 2 }, (_, i) => ({ id: `u${i}` }))) },
  };
  const goLive: any = {
    snapshot: vi.fn().mockResolvedValue(opts.snap ?? { justReachedReady: false, readinessPct: 50, canGoLive: false }),
    overdueItems: vi.fn().mockResolvedValue(opts.overdue ?? []),
  };
  const svc = new GoLiveCronService(prisma, goLive, opts.notify);
  const logs = { log: [] as string[], warn: [] as string[], error: [] as string[] };
  (svc as any).logger = {
    log: (m: string) => logs.log.push(m),
    warn: (m: string) => logs.warn.push(m),
    error: (m: string) => logs.error.push(m),
  };
  return { svc, logs, prisma, goLive };
};

const overdueItem = (id = UUID_A) => ({ id, title: 'LIS 컷오버', owner: '진단검사의학과', isBlocking: true });

describe('🔴 알림 로그는 도달한 것만 도달했다고 적는다', () => {
  it('전건 실패하면 "0/2 도달" 로 적는다(성공으로 위장하지 않는다)', async () => {
    const notify = { notify: vi.fn().mockRejectedValue(new Error('P2023 refId')) };
    const { svc, logs } = make({ admins: 2, notify, overdue: [overdueItem()] });
    await svc.run();
    expect(logs.warn.some((m) => m.includes('0/2명 도달'))).toBe(true);
    expect(logs.error).toHaveLength(2); // 실패는 실패로 남는다
  });

  it('일부만 실패하면 성공 건수만 도달로 센다', async () => {
    const notify = { notify: vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('boom')) };
    const { svc, logs } = make({ admins: 2, notify, overdue: [overdueItem()] });
    await svc.run();
    expect(logs.warn.some((m) => m.includes('1/2명 도달') && m.includes('실패 1'))).toBe(true);
  });

  it('알림 서비스가 주입되지 않았으면 미발송으로 경고한다(조용히 성공 금지)', async () => {
    const { svc, logs } = make({ admins: 3, notify: undefined, overdue: [overdueItem()] });
    await svc.run();
    expect(logs.warn.some((m) => m.includes('미발송'))).toBe(true);
    expect(logs.warn.some((m) => m.includes('0/3명 도달'))).toBe(true);
  });

  it('발송을 await 한다 — run() 이 끝난 시점에 시도가 모두 끝나 있다', async () => {
    let settled = 0;
    const notify = { notify: vi.fn().mockImplementation(() => new Promise((res) => setTimeout(() => { settled++; res({}); }, 5))) };
    const { svc } = make({ admins: 2, notify, overdue: [overdueItem()] });
    await svc.run();
    expect(settled).toBe(2); // floating promise 였다면 0
  });
});

describe('🔴 refId 계약 — UUID 가 아닌 값은 넘기지 않는다', () => {
  it('준비완료 통지는 가리킬 엔티티가 없으므로 refId 를 붙이지 않는다', async () => {
    const notify = { notify: vi.fn().mockResolvedValue({}) };
    const { svc } = make({ admins: 1, notify, snap: { justReachedReady: true, readinessPct: 100, canGoLive: true } });
    await svc.run();
    const payload = notify.notify.mock.calls[0][1];
    expect(payload.type).toBe('GOLIVE_READY');
    expect(payload.refId).toBeUndefined(); // 예전엔 'ready' 라는 비-UUID 를 넘겨 알림이 통째 유실될 수 있었다
  });

  it('지연 통지는 항목 id 가 UUID 일 때만 참조를 붙인다', async () => {
    const notify = { notify: vi.fn().mockResolvedValue({}) };
    const { svc } = make({ admins: 1, notify, overdue: [overdueItem()] });
    await svc.run();
    expect(notify.notify.mock.calls[0][1]).toMatchObject({ refType: 'GoLiveItem', refId: UUID_A });
  });

  it('id 가 UUID 가 아니면 참조 없이 보낸다(알림 자체를 잃지 않는다)', async () => {
    const notify = { notify: vi.fn().mockResolvedValue({}) };
    const { svc } = make({ admins: 1, notify, overdue: [overdueItem('integ.lis')] });
    await svc.run();
    const payload = notify.notify.mock.calls[0][1];
    expect(payload.refId).toBeUndefined();
    expect(payload.message).toContain('LIS 컷오버'); // 알림은 그대로 나간다
  });
});

describe('지연이 없으면 통보하지 않는다', () => {
  let notify: any;
  beforeEach(() => { notify = { notify: vi.fn().mockResolvedValue({}) }; });

  it('overdue 0건 · 준비완료 전환 없음 → 발송 0', async () => {
    const { svc } = make({ notify, overdue: [] });
    await svc.run();
    expect(notify.notify).not.toHaveBeenCalled();
  });
});
