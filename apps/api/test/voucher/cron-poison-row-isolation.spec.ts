import { describe, it, expect, vi } from 'vitest';
import { VoucherCronService } from '../../src/modules/voucher/voucher-cron.service';

/**
 * 🔴 한 장이 나머지를 막지 않는다 — 검진권 만료 스윕(2026-09-16 E4).
 *
 * 종전엔 건별 보호가 없어, 한 장에서 원장 append 가 실패하면(해시 체인 불일치 등) **그 배치 전체가 중단**됐다.
 * 게다가 실패한 장은 상태가 그대로라 다음 날에도 맨 앞에 와서, **스윕이 영구히 막힌다**
 * (audit 버퍼가 이미 겪은 poison message 와 같은 구조다).
 */
function makeService(opts: { failSerials: Set<string> }) {
  const updated: string[] = [];
  let findCalls = 0;

  const rows = [
    { id: 'v1', serial: 'S-1', headHash: 'h1' },
    { id: 'v2', serial: 'S-BAD', headHash: 'h2' },
    { id: 'v3', serial: 'S-3', headHash: 'h3' },
  ];

  const prisma = {
    checkupVoucher: {
      // 만료된 장만 돌려준다 — 성공한 장은 EXPIRED 가 되어 다음 조회에서 빠진다(실제 쿼리와 같은 성질)
      findMany: vi.fn(async () => {
        findCalls++;
        if (findCalls > 5) return []; // 무한 루프 방지용 안전핀(가드가 아니라 테스트 보호)
        return rows.filter((r) => !updated.includes(r.id));
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        checkupVoucher: { update: vi.fn(async ({ where }: { where: { id: string } }) => { updated.push(where.id); }) },
      };
      return fn(tx);
    }),
  };

  const ledger = {
    append: vi.fn(async (_tx: unknown, e: { serial: string }) => {
      if (opts.failSerials.has(e.serial)) throw new Error('prevHash 불일치 — 체인 어긋남');
      return `head-${e.serial}`;
    }),
  };

  const svc = new VoucherCronService(
    prisma as never,
    { getActive: vi.fn() } as never,
    ledger as never,
  );
  return { svc, updated, prisma, findCalls: () => findCalls };
}

describe('검진권 만료 스윕 — poison row 격리', () => {
  it('🔴 한 장이 실패해도 나머지는 만료된다(종전엔 배치 전체가 멈췄다)', async () => {
    const { svc, updated } = makeService({ failSerials: new Set(['S-BAD']) });
    await svc.expireVouchers();
    expect(updated).toContain('v1');
    expect(updated).toContain('v3');
    expect(updated, '실패한 장은 상태를 바꾸지 않는다').not.toContain('v2');
  });

  it('🔴 전건 실패면 배치를 끝낸다 — 같은 조회가 영원히 반복되지 않는다', async () => {
    const { svc, updated, findCalls } = makeService({ failSerials: new Set(['S-1', 'S-BAD', 'S-3']) });
    await svc.expireVouchers();
    expect(updated).toEqual([]);
    expect(findCalls(), '무한 루프에 빠졌다').toBeLessThanOrEqual(2);
  });

  it('대조군 — 전부 성공하면 전부 만료된다', async () => {
    const { svc, updated } = makeService({ failSerials: new Set() });
    await svc.expireVouchers();
    expect(updated).toEqual(['v1', 'v2', 'v3']);
  });
});
