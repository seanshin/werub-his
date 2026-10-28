import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrderSignLogService } from '../../src/modules/order-sign-log/order-sign-log.service';

/**
 * 🔴 봉인 현황이 커버리지를 과대표시하던 것 — 화면 실사용 점검 W7(2026-08-14).
 *
 * 화면은 **"봉인률 100% · 미봉인 0건(없음)"** 을 파란 카드로 띄웠다. 그런데:
 *  ① 그 비율의 분모는 **이미 원장에 기록된 항목**(645)이지 봉인해야 할 CPOE 행위 전체(≈718)가
 *     아니다 — 애초에 기록되지 않은 행위는 분모에도 없어 **100% 가 나와도 커버리지는 89.8%**.
 *  ② `max(sealed_at)` 이 **12일 전**(2026-08-02)인데 화면에 마지막 봉인 시각 표시가 없어
 *     정체가 "100%" 뒤에 가려졌다.
 *  ③ 취소 스탬프는 있는데 원장에 취소 항목이 없는 오더 **10건**이 어느 카드에도 없었다.
 *
 * 🔴 그 10건은 `cancelled_at` 이 **마이크로초까지 동일**하고 `cancelled_by_id` 가 전부 NULL 이며
 *    `updated_at` 은 5~7월이다 — 실제 취소 시각이 아니라 **일괄 백필**이다.
 *    그 시각으로 봉인하면 **틀린 시각을 위변조 방지 원장에 영구히** 박게 된다.
 *    이 저장소 원칙 — **모르는 시각은 추정하지 않는다.** 봉인하지 말고 드러내기만 한다.
 */
describe('봉인 현황 정직성', () => {
  let service: OrderSignLogService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      orderSignLog: {
        groupBy: vi.fn(),
        findFirst: vi.fn(),
      },
      order: { count: vi.fn() },
    };
    service = new OrderSignLogService(prisma, undefined as never, undefined as never);
  });

  function arrange(opts: {
    sealed: number;
    unsealed?: number;
    lastSealedAt?: Date | null;
    cancelledWithoutLog?: number;
  }) {
    const byStatus = [{ sealStatus: 'SEALED', _count: opts.sealed }];
    if (opts.unsealed) byStatus.push({ sealStatus: 'PENDING', _count: opts.unsealed });
    prisma.orderSignLog.groupBy
      .mockResolvedValueOnce(byStatus)
      .mockResolvedValueOnce([{ action: 'ORDER_CREATED', _count: opts.sealed }]);
    prisma.orderSignLog.findFirst
      .mockResolvedValueOnce(null) // oldest unsealed
      .mockResolvedValueOnce(opts.lastSealedAt ? { sealedAt: opts.lastSealedAt } : null);
    prisma.order.count
      .mockResolvedValueOnce(0) // unrecoverableCancel
      .mockResolvedValueOnce(opts.cancelledWithoutLog ?? 0);
  }

  it('🔴 비율 이름이 분모를 밝힌다 — 종전 `sealRate` 는 커버리지로 오독됐다', async () => {
    arrange({ sealed: 645, lastSealedAt: new Date('2026-08-02T12:13:00Z') });

    const s = await service.stats();

    expect(s).toHaveProperty('sealRateOfRecorded');
    expect(s).not.toHaveProperty('sealRate'); // 오독을 부르던 이름은 사라져야 한다
    expect(s.sealRateOfRecorded).toBe(100);
  });

  it('🔴 마지막 봉인 시각을 낸다 — 100% 가 12일째 정체를 가리면 안 된다', async () => {
    const last = new Date('2026-08-02T12:13:00Z');
    arrange({ sealed: 645, lastSealedAt: last });

    const s = await service.stats();

    expect(s.lastSealedAt).toEqual(last);
  });

  it('🔴 봉인 이력이 아예 없으면 null — 0 이나 "지금"으로 채우지 않는다', async () => {
    arrange({ sealed: 0, lastSealedAt: null });

    const s = await service.stats();

    expect(s.lastSealedAt).toBeNull();
  });

  it('🔴 취소 스탬프는 있는데 원장에 없는 오더를 별도로 드러낸다(봉인하지 않고)', async () => {
    arrange({ sealed: 645, lastSealedAt: new Date(), cancelledWithoutLog: 10 });

    const s = await service.stats();

    expect(s.recordingGaps.cancelledWithoutLog).toBe(10);
    // 봉인률은 여전히 100% 로 보일 수 있다 — 그래서 이 구멍을 따로 보고해야 한다
    expect(s.sealRateOfRecorded).toBe(100);
  });

  /**
   * 🔴 이 스펙은 종전에 결함을 계약으로 굳혀뒀다 — 분모 0 일 때 `0` 을 기대했다.
   *    0% 는 "봉인 대상이 있었는데 하나도 못 했다"는 **다른 사실**이고, 그건 위급 신호다.
   *    표본이 없는 것과 구분되지 않으면 진짜 0% 가 왔을 때 아무도 놀라지 않는다.
   *    W7/W8 다른 EP 는 전부 null(산출 불가) 규약이다.
   */
  it('🔴 기록이 하나도 없으면 비율은 null(산출 불가) — 0% 도 100% 도 아니다', async () => {
    arrange({ sealed: 0 });

    const s = await service.stats();

    expect(s.sealRateOfRecorded).toBeNull();
    expect(s.sealRateOfRecorded).not.toBe(0);
    expect(s.sealRateOfRecorded).not.toBe(100);
    expect(s.sealRateUnavailableReason).toContain('표본 0');
  });

  it('🔴 표본이 있는 진짜 0% 는 null 이 아니다 — 둘을 구분한다(역검증)', async () => {
    arrange({ sealed: 0, unsealed: 12 });

    const s = await service.stats();

    expect(s.sealRateOfRecorded).toBe(0);
    expect(s.sealRateUnavailableReason).toBeNull();
  });
});
