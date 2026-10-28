import { describe, it, expect, vi } from 'vitest';
import { WaitingQueueService } from '../../src/modules/waiting-queue/waiting-queue.service';

/**
 * '지금 대기' vs '예약 대기' 계약 — 2026-08-13 (화면 점검 W3 · 패턴 P1-ⓓ·P12).
 *
 * 🔴 대기열에 **아직 접수 시각이 오지 않은 예약**이 섞여 있었다.
 *    운영 실측(08:30): 대기 180명 중 **129명이 미래 접수**(최대 9시간 뒤).
 *    화면들이 각자 세다 보니 진료실 대기는 54명, 접수 데스크는 180명을 말했다.
 *
 * 규약: **서버가 가른다.** 각 행에 `isScheduled` 를 달고, stats 는 `waitingNow`/`waitingScheduled`
 * 를 낸다 — 화면이 재판정하면 또 갈라진다.
 */

function svc(rows: Array<{ checkedInAt: Date; status?: string }>) {
  const prisma = {
    waitingQueue: {
      findMany: vi.fn().mockResolvedValue(rows.map((r, i) => ({ id: `q${i}`, status: r.status ?? 'WAITING', ...r }))),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  };
  return { s: new WaitingQueueService(prisma as never), prisma };
}

describe('대기열 — 지금 대기와 예약 대기', () => {
  it('🔴 접수 시각이 미래면 isScheduled=true 로 밝힌다', async () => {
    const future = new Date(Date.now() + 3 * 3600_000);
    const past = new Date(Date.now() - 30 * 60_000);
    const { s } = svc([{ checkedInAt: past }, { checkedInAt: future }]);

    const res = await s.findAll({});
    expect(res.data[0].isScheduled).toBe(false);
    expect(res.data[1].isScheduled, '아직 오지 않은 예약을 지금 대기로 센다').toBe(true);
  });

  it('경계: 정확히 현재면 지금 대기로 본다(미래가 아니다)', async () => {
    const { s } = svc([{ checkedInAt: new Date(Date.now() - 1000) }]);
    const res = await s.findAll({});
    expect(res.data[0].isScheduled).toBe(false);
  });

  it('🔴 stats 가 지금/예약을 나눠 낸다 — 화면이 재판정하지 않게', async () => {
    const { s, prisma } = svc([]);
    prisma.waitingQueue.count
      .mockResolvedValueOnce(51)   // waitingNow
      .mockResolvedValueOnce(129); // waitingScheduled

    const res = await s.getStats();
    expect(res.data.waitingNow).toBe(51);
    expect(res.data.waitingScheduled).toBe(129);
  });
});
