import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClaimService } from '../../src/modules/claim/claim.service';

describe('심사조정(삭감) 라인 (R3-3)', () => {
  let service: ClaimService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      claim: { findUnique: vi.fn().mockResolvedValue({ id: 'clm-1', reducedAmount: 30000 }) },
      claimAdjustment: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'adj', ...data })),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 30000 }, _count: { _all: 2 } }),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
    };
    service = new ClaimService(mockPrisma, { enqueue: vi.fn() } as any, undefined as any);
  });

  it('사유코드 필수·양수 금액 검증', async () => {
    await expect(service.addAdjustments('clm-1', [{ adjustCode: '', amount: 100 }])).rejects.toThrow(/사유코드/);
    await expect(service.addAdjustments('clm-1', [{ adjustCode: 'A01', amount: 0 }])).rejects.toThrow(/양수/);
    await expect(service.addAdjustments('clm-1', [])).rejects.toThrow(/라인이 없습니다/);
  });

  it('라인 합계 = 삭감 총액이면 경고 없음', async () => {
    const r = await service.addAdjustments('clm-1', [
      { adjustCode: 'F001', amount: 20000, itemName: 'MRI' },
      { adjustCode: 'K201', amount: 10000 },
    ], 'u-1');
    expect(r.created).toBe(2);
    expect(r.lineSum).toBe(30000);
    expect((r as any).warning).toBeUndefined();
  });

  it('라인 합계 ≠ 삭감 총액이면 정합 경고 동봉', async () => {
    mockPrisma.claimAdjustment.aggregate.mockResolvedValue({ _sum: { amount: 25000 } });
    const r = await service.addAdjustments('clm-1', [{ adjustCode: 'F001', amount: 25000 }]);
    expect((r as any).warning).toContain('다릅니다');
  });

  it('상태 전이 — 허용 값 외 거부', async () => {
    await expect(service.setAdjustmentStatus('adj-1', 'WRONG')).rejects.toThrow(/ACCEPTED\|APPEALING/);
    await service.setAdjustmentStatus('adj-1', 'REWORK', 'u-1');
    expect(mockPrisma.claimAdjustment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REWORK' }) }),
    );
  });

  it('통계 — 사유코드별 금액 내림차순', async () => {
    mockPrisma.claimAdjustment.groupBy
      .mockResolvedValueOnce([{ adjustCode: 'F001', _count: { _all: 3 }, _sum: { amount: 90000 } }])
      .mockResolvedValueOnce([{ status: 'ACCEPTED', _count: { _all: 3 }, _sum: { amount: 90000 } }]);
    mockPrisma.claimAdjustment.aggregate.mockResolvedValue({ _count: { _all: 3 }, _sum: { amount: 90000 } });
    const r = await service.getAdjustmentStats();
    expect(r.total).toEqual({ count: 3, amount: 90000 });
    expect(r.byCode[0]).toEqual({ adjustCode: 'F001', count: 3, amount: 90000 });
  });
});
