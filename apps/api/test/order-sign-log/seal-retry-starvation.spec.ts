import { describe, it, expect, vi } from 'vitest';
import { OrderSignLogService } from '../../src/modules/order-sign-log/order-sign-log.service';
import {
  MAX_SEAL_ATTEMPTS,
  SEAL_RETRY_WHERE,
  shouldRetrySeal,
} from '../../src/modules/order-sign-log/order-sign-entry';

/**
 * 🔴 봉인 재시도 굶주림 — 외부 점검.
 *
 * 크론이 `sealStatus in [PENDING, FAILED, SKIPPED]` 로 가장 오래된 200건을 가져온 뒤 `shouldRetrySeal` 로
 * 걸렀다. SIMULATION 시기 SKIPPED 가 200건 넘게 쌓이면 창이 늘 SKIPPED 로 차서, 그 뒤에 생긴 FAILED 는
 * **한 번도 재시도되지 않았다.** 쿼리와 판정이 같은 정본(`SEAL_RETRY_WHERE`)에서 파생되는지 본다.
 */

type Row = { id: string; sealStatus: string; sealAttempts: number; createdAt: Date };

/** Prisma findMany 의 where(in·lt)·orderBy(createdAt asc)·take 를 그대로 흉내내는 인메모리 테이블 */
function fakePrisma(rows: Row[]) {
  const findMany = vi.fn(async (args: {
    where?: { sealStatus?: { in?: string[] }; sealAttempts?: { lt?: number } };
    take?: number;
  }) => {
    const w = args.where ?? {};
    return rows
      .filter((r) => !w.sealStatus?.in || w.sealStatus.in.includes(r.sealStatus))
      .filter((r) => w.sealAttempts?.lt === undefined || r.sealAttempts < w.sealAttempts.lt)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, args.take ?? rows.length);
  });
  return { orderSignLog: { findMany } };
}

const now = new Date('2026-09-28T10:00:00Z');
const old = (i: number) => new Date(Date.UTC(2026, 5, 1, 0, 0, i)); // 6월 — SIMULATION 시기

function run(rows: Row[]) {
  const prisma = fakePrisma(rows);
  const svc = new OrderSignLogService(prisma as never, undefined);
  const seal = vi.spyOn(svc, 'seal').mockResolvedValue(undefined);
  vi.useFakeTimers();
  vi.setSystemTime(now);
  return svc.retryFailedSeals().then((r) => {
    vi.useRealTimers();
    return { r, seal, prisma };
  });
}

describe('오더 서명 로그 봉인 재시도 — 쿼리와 판정이 한 정본', () => {
  it('🔴 SKIPPED 250건이 앞에 있어도 그 뒤 FAILED 1건이 재시도된다', async () => {
    const rows: Row[] = Array.from({ length: 250 }, (_, i) => ({ id: `skip-${i}`, sealStatus: 'SKIPPED', sealAttempts: 1, createdAt: old(i) }));
    rows.push({ id: 'failed-new', sealStatus: 'FAILED', sealAttempts: 1, createdAt: new Date('2026-09-28T09:00:00Z') });

    const { r, seal } = await run(rows);

    expect(seal).toHaveBeenCalledWith('failed-new');
    expect(r.retried).toBe(1);
  });

  it('🔴 상한에 이른 FAILED 250건이 앞에 있어도 새 PENDING 이 재시도된다', async () => {
    const rows: Row[] = Array.from({ length: 250 }, (_, i) => ({ id: `cap-${i}`, sealStatus: 'FAILED', sealAttempts: MAX_SEAL_ATTEMPTS, createdAt: old(i) }));
    rows.push({ id: 'pending-new', sealStatus: 'PENDING', sealAttempts: 0, createdAt: new Date('2026-09-28T09:59:00Z') });

    const { seal } = await run(rows);

    expect(seal).toHaveBeenCalledWith('pending-new');
    expect(seal).toHaveBeenCalledTimes(1);
  });

  it('대조군 — SKIPPED·SEALED·상한 도달은 재시도하지 않는다(봉합이 범위를 넓히지 않았다)', async () => {
    const rows: Row[] = [
      { id: 's', sealStatus: 'SKIPPED', sealAttempts: 0, createdAt: old(1) },
      { id: 'd', sealStatus: 'SEALED', sealAttempts: 1, createdAt: old(2) },
      { id: 'c', sealStatus: 'FAILED', sealAttempts: MAX_SEAL_ATTEMPTS, createdAt: old(3) },
    ];
    const { r, seal } = await run(rows);
    expect(seal).not.toHaveBeenCalled();
    expect(r.retried).toBe(0);
  });

  it('쿼리가 정본 상수를 그대로 쓴다', async () => {
    const { prisma } = await run([]);
    expect(prisma.orderSignLog.findMany.mock.calls[0][0].where).toEqual(SEAL_RETRY_WHERE);
  });

  it('판정 ⊆ 쿼리 — shouldRetrySeal 이 참인 행은 모두 SEAL_RETRY_WHERE 에 걸린다(역도 상태·상한은 같다)', () => {
    const statuses = ['PENDING', 'FAILED', 'SKIPPED', 'SEALED', 'UNKNOWN'];
    const longAgo = new Date('2026-01-01T00:00:00Z');
    for (const sealStatus of statuses) {
      for (let a = 0; a <= MAX_SEAL_ATTEMPTS + 1; a++) {
        const row = { sealStatus, sealAttempts: a, createdAt: longAgo };
        const inQuery = SEAL_RETRY_WHERE.sealStatus.in.includes(sealStatus) && a < SEAL_RETRY_WHERE.sealAttempts.lt;
        // 충분히 오래된 행은 백오프가 걸리지 않으므로 판정과 쿼리가 정확히 같아야 한다
        expect(shouldRetrySeal(row, now)).toBe(inQuery);
      }
    }
  });
});
