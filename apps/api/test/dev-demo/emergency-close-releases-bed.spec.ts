import { describe, it, expect, vi } from 'vitest';
import { DevDemoService } from '../../src/modules/dev-demo/dev-demo.service';

/**
 * 데모 응급 마감은 **병상 반납까지**다 — 2026-08-10.
 *
 * 🔴 종전엔 묵은 재실을 COMPLETED 로 바꾸기만 하고 `emergency_bed_assignments` 를 그대로 둬서
 *    `released_at` 이 NULL 로 남고 병상이 **영구 OCCUPIED** 였다(운영 실측 2건·응급 GEN-1/ACUTE-1).
 *    ER 축이 이미 배운 "결정 ≠ 퇴실"이 데모 경로에서 그대로 재현된 것 — 자동 해제 경로에
 *    데모 마감이 빠져 있었다. 상태만 바꾸는 마감은 마감이 아니다.
 */

function prismaMock(opts: { stale: { id: string; arrivalAt: Date }[]; openAssignments: { id: string; bedId: string }[] }) {
  const tx = {
    emergencyVisit: { update: vi.fn().mockResolvedValue({}) },
    emergencyBedAssignment: {
      findMany: vi.fn().mockResolvedValue(opts.openAssignments),
      updateMany: vi.fn().mockResolvedValue({ count: opts.openAssignments.length }),
    },
    bed: { updateMany: vi.fn().mockResolvedValue({ count: opts.openAssignments.length }) },
  };
  return {
    tx,
    prisma: {
      emergencyVisit: {
        findMany: vi.fn().mockResolvedValue(opts.stale),
        count: vi.fn().mockResolvedValue(99), // 목표 충족 → 생성 단계는 건너뛴다
        update: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never,
  };
}

describe('데모 응급 마감 — 병상 반납', () => {
  it('🔴 마감 시 미해제 배정을 풀고 병상을 AVAILABLE 로 되돌린다', async () => {
    const { prisma, tx } = prismaMock({
      stale: [{ id: 'v1', arrivalAt: new Date('2026-08-05T04:17:26Z') }],
      openAssignments: [{ id: 'a1', bedId: 'bed-1' }],
    });
    const svc = new DevDemoService(prisma);

    const r = await svc.refreshEmergency();

    expect(r.closed).toBe(1);
    // 배정 해제 — 사유를 남겨 출처를 추적할 수 있게
    expect(tx.emergencyBedAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['a1'] } },
        data: expect.objectContaining({ releaseReason: 'DEMO_CLOSE', releasedAt: expect.any(Date) }),
      }),
    );
    // 병상 반납 — OCCUPIED 인 것만(다른 상태를 덮어쓰지 않는다)
    expect(tx.bed.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['bed-1'] }, status: 'OCCUPIED' }),
        data: { status: 'AVAILABLE' },
      }),
    );
  });

  it('배정이 없으면 병상을 건드리지 않는다', async () => {
    const { prisma, tx } = prismaMock({
      stale: [{ id: 'v1', arrivalAt: new Date('2026-08-05T04:17:26Z') }],
      openAssignments: [],
    });
    const svc = new DevDemoService(prisma);

    await svc.refreshEmergency();

    expect(tx.bed.updateMany).not.toHaveBeenCalled();
    expect(tx.emergencyBedAssignment.updateMany).not.toHaveBeenCalled();
  });

  it('마감과 반납이 한 트랜잭션이다 — 방문만 종결되고 병상이 남는 상태를 만들지 않는다', async () => {
    const { prisma, tx } = prismaMock({
      stale: [{ id: 'v1', arrivalAt: new Date('2026-08-05T04:17:26Z') }],
      openAssignments: [{ id: 'a1', bedId: 'bed-1' }],
    });
    const svc = new DevDemoService(prisma);

    await svc.refreshEmergency();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.emergencyVisit.update).toHaveBeenCalled(); // 방문 종결도 같은 tx 안에서
  });

  it('dryRun 은 아무것도 바꾸지 않는다', async () => {
    const { prisma, tx } = prismaMock({
      stale: [{ id: 'v1', arrivalAt: new Date('2026-08-05T04:17:26Z') }],
      openAssignments: [{ id: 'a1', bedId: 'bed-1' }],
    });
    const svc = new DevDemoService(prisma);

    const r = await svc.refreshEmergency(true);

    expect(r.closed).toBe(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.bed.updateMany).not.toHaveBeenCalled();
  });
});
