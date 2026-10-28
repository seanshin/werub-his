import { describe, it, expect, vi } from 'vitest';
import { BedStatus } from '@prisma/client';
import { BedBoardService } from '../../src/modules/bed/bed-board.service';

/**
 * 병상 보드 상태 커버리지 계약 — 2026-08-11.
 *
 * 🔴 `BedStatus` 는 6종인데 집계가 4종만 세어 **CLEANING·ISOLATION 병상이 total 에는 들어가고
 *    어느 컬럼에도 나타나지 않았다.** 화면에서 합이 맞지 않았다(운영 실측: 응급병동 25 =
 *    가용 22 + 점검 1 + ??? 2 — 실제는 청소 대기 2). 청소 대기는 "즉시 배정 불가"라
 *    운영상 반드시 보여야 하는 상태다. enum 이 늘면 이 테스트가 잡는다.
 */

function prismaMock(statuses: BedStatus[]) {
  const beds = statuses.map((status, i) => ({ id: `b${i}`, wardId: 'w1', status, ward: { name: '테스트병동' } }));
  return {
    bed: { findMany: vi.fn().mockResolvedValue(beds) },
    admission: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as never;
}

describe('병상 보드 — 상태 집계 커버리지', () => {
  it('🔴 모든 BedStatus 가 어느 한 버킷에 들어간다(합 = total)', async () => {
    const all = Object.values(BedStatus);
    const svc = new BedBoardService(prismaMock(all));
    const r = await svc.getBoard();
    const w = r.wards[0];

    const bucketSum = w.occupied + w.available + w.reserved + w.maintenance + w.cleaning + w.isolation;
    expect(w.total).toBe(all.length);
    expect(bucketSum, `버킷 합(${bucketSum}) ≠ total(${w.total}) — 새 BedStatus 가 어디에도 안 세어진다`).toBe(w.total);
  });

  it('청소 대기가 별도로 집계된다 — 가용으로 착각하면 안 된다', async () => {
    const svc = new BedBoardService(prismaMock([BedStatus.CLEANING, BedStatus.CLEANING, BedStatus.AVAILABLE]));
    const r = await svc.getBoard();
    expect(r.wards[0].cleaning).toBe(2);
    expect(r.wards[0].available).toBe(1); // 청소 대기가 가용에 섞이지 않는다
    expect(r.summary.cleaning).toBe(2);
  });

  it('격리 병상도 집계된다', async () => {
    const svc = new BedBoardService(prismaMock([BedStatus.ISOLATION, BedStatus.AVAILABLE]));
    expect((await svc.getBoard()).wards[0].isolation).toBe(1);
  });

  it('가동률은 재원(OCCUPIED) 기준 — 청소·점검은 분자에 넣지 않는다', async () => {
    const svc = new BedBoardService(prismaMock([BedStatus.OCCUPIED, BedStatus.CLEANING, BedStatus.MAINTENANCE, BedStatus.AVAILABLE]));
    expect((await svc.getBoard()).wards[0].occupancyRate).toBe(25); // 1/4
  });
});
