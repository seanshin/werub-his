import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';
import { paymentMethodLabel, PAYMENT_METHOD_LABEL } from '@hospital-run/shared';

/**
 * 시드 흐름 전수 검토 7단계(청구·수납) 가드 — **수납 원장이 집계의 정본인가**
 *
 * 🔴 봉합 전 실측(운영):
 *   · `billing_payments` 를 **읽는 코드가 저장소에 하나도 없었다**(쓰기 1곳·읽기 0곳).
 *   · 일마감 수단별 집계는 `Billing.paymentMethod` 로 group by 했는데 그것은 수단이 아니라
 *     **요약 라벨**이다. 복합결제 1건(카드 18,535 + 현금 18,535)이 `mixed 37,070` 한 줄이 되어
 *     **카드사 대사에서도 현금 시재에서도 그 금액이 사라졌다.**
 *   · 분납 회차 납부는 원장 라인을 만들지 않아 **일마감에 아예 잡히지 않았고**,
 *     받은 `method` 는 반환값에만 쓰이고 저장되지 않았다.
 *
 * 이 가드는 결함을 되돌리면(원장 대신 요약 라벨을 읽게 하면·원장 라인 생성을 지우면) 실패한다.
 */
describe('수납 원장(billing_payments)이 집계의 정본이다', () => {
  let service: BillingService;
  let mockPrisma: any;

  const svc = () => new BillingService(
    mockPrisma, {} as any, {} as any, { get: vi.fn() } as any,
    {} as any, {} as any, {} as any,
    { getOrSet: vi.fn((_k: string, _t: number, fn: () => Promise<any>) => fn()), invalidate: vi.fn(), del: vi.fn() } as any,
  );

  beforeEach(() => {
    mockPrisma = {
      // 2026-10-22 입원 중간정산 수납 원장(일마감 별도 칸)
      interimBillingPayment: { groupBy: vi.fn().mockResolvedValue([]) },
      interimBillingRefund: { groupBy: vi.fn().mockResolvedValue([]) },
      interimBilling: { aggregate: vi.fn().mockResolvedValue({ _count: 0, _sum: { paidAmount: null } }) },
      billingPayment: {
        groupBy: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'bp-1' }),
        findMany: vi.fn().mockResolvedValue([]),
        // (P1-5) 그 날 환불 원장 라인 합
        aggregate: vi.fn().mockResolvedValue({ _count: 0, _sum: { amount: 0 } }),
      },
      billing: {
        aggregate: vi.fn().mockResolvedValue({ _count: 0, _sum: { paidAmount: 0, refundAmount: 0, patientCopay: 0 } }),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), // (P1-2) 열린 청구에만 회차 반영
      },
      installmentPayment: {
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      installmentPlan: { update: vi.fn().mockResolvedValue({ paidCount: 2, installments: 3 }) }, // (P1-2) 증가된 실제 값
    };
    mockPrisma.$transaction = vi.fn(async (fn: any) => fn(mockPrisma));
    service = svc();
  });

  /** 그 날의 집계 목 — 원장 라인 · 원장 없는 수납 · 수납 기준 합계 */
  function arrangeDay(opts: {
    lines?: { method: string; amount: number; count?: number }[];
    unledgered?: { count: number; amount: number };
    billingSum?: { count: number; amount: number };
  }) {
    mockPrisma.billingPayment.groupBy.mockResolvedValue(
      (opts.lines ?? []).map((l) => ({ method: l.method, _sum: { amount: l.amount }, _count: l.count ?? 1 })),
    );
    const un = opts.unledgered ?? { count: 0, amount: 0 };
    const bs = opts.billingSum ?? { count: 0, amount: 0 };
    mockPrisma.billing.aggregate
      .mockResolvedValueOnce({ _count: un.count, _sum: { paidAmount: un.amount } })   // 원장 없는 수납
      .mockResolvedValueOnce({ _count: bs.count, _sum: { paidAmount: bs.amount } })   // 수납 기준 합계
      .mockResolvedValue({ _count: 0, _sum: { refundAmount: 0, patientCopay: 0 } });  // 환불·보류
  }

  it('🔴 복합결제가 수단별로 갈라진다 — MIXED 한 줄로 뭉치지 않는다', async () => {
    // 운영에 실재하는 그 건: 카드 18,535 + 현금 18,535 = 37,070 (Billing.paymentMethod='MIXED')
    arrangeDay({
      lines: [{ method: 'CARD', amount: 18535 }, { method: 'CASH', amount: 18535 }],
      billingSum: { count: 1, amount: 37070 },
    });

    const { data } = await service.getDailySummary('2026-07-10');

    expect(data.byPaymentMethod).toEqual({ card: 18535, cash: 18535 });
    // 🔴 결함 재주입 대조 — 요약 라벨을 읽던 종전 코드는 여기서 `{ mixed: 37070 }` 을 냈다
    expect(data.byPaymentMethod).not.toHaveProperty('mixed');
    expect(data.ledger.ledgerSum).toBe(37070);
    expect(data.ledger.difference).toBe(0);
  });

  it('집계는 Billing.paymentMethod 를 group by 하지 않는다 (원장을 읽는다)', async () => {
    arrangeDay({ lines: [{ method: 'CARD', amount: 1000 }], billingSum: { count: 1, amount: 1000 } });
    await service.getDailySummary('2026-07-10');

    expect(mockPrisma.billingPayment.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['method'] }),
    );
    // billing 쪽에 group by 가 남아 있으면 정본이 둘이 된다
    expect(mockPrisma.billing.groupBy).toBeUndefined();
  });

  it('🔴 원장 라인이 없는 수납은 "수단 미기록"으로 건수·금액을 함께 드러낸다', async () => {
    arrangeDay({
      lines: [{ method: 'CARD', amount: 10000 }],
      unledgered: { count: 17, amount: 829465 },
      billingSum: { count: 18, amount: 839465 },
    });

    const { data } = await service.getDailySummary('2026-06-10');

    expect(data.byPaymentMethod.unknown).toBe(829465);
    expect(data.ledger.unledgeredCount).toBe(17);
    expect(data.ledger.unledgeredAmount).toBe(829465);
    // 0원으로도 '현금'으로도 접지 않는다
    expect(data.byPaymentMethod.cash).toBeUndefined();
  });

  it('대조군 — 전건이 원장에 있으면 "미기록"이라고 말하지 않는다', async () => {
    arrangeDay({
      lines: [{ method: 'CARD', amount: 50000, count: 3 }],
      unledgered: { count: 0, amount: 0 },
      billingSum: { count: 3, amount: 50000 },
    });

    const { data } = await service.getDailySummary('2026-08-24');

    expect(data.ledger.unledgeredCount).toBe(0);
    expect(data.byPaymentMethod).not.toHaveProperty('unknown');
    expect(data.ledger.difference).toBe(0);
  });

  it('분할수납이 날짜를 걸치면 차이를 숨기지 않고 그 값을 낸다', async () => {
    // 어제 3만(어제 원장) + 오늘 2만(오늘 원장) → 오늘 Billing.paidAmount 는 5만(마지막 결제일 기준)
    arrangeDay({
      lines: [{ method: 'CASH', amount: 20000 }],
      unledgered: { count: 0, amount: 0 },
      billingSum: { count: 1, amount: 50000 },
    });

    const { data } = await service.getDailySummary('2026-08-24');

    expect(data.ledger.difference).toBe(30000);
    expect(data.totalRevenue).toBe(50000); // 총계 정의는 바꾸지 않는다(정본을 조용히 갈아끼우지 않는다)
  });


  it('🔴 취소된 수납의 원장 라인은 수단별에 세지 않는다 (총계와 모집단을 맞춘다)', async () => {
    arrangeDay({ lines: [{ method: 'CASH', amount: 1000 }], billingSum: { count: 1, amount: 1000 } });
    await service.getDailySummary('2026-07-10');

    const where = mockPrisma.billingPayment.groupBy.mock.calls[0][0].where;
    // 배포 후 운영 실측에서 나왔다 — 취소건 1,000원이 수단별에만 잡혀 difference 가 -1,000 이 됐고
    // 화면이 그것을 "분할수납" 이라고 잘못 설명했다
    expect(where.billing).toEqual({ status: { in: ['PAID', 'PARTIAL'] } });
  });

  describe('분납 회차 납부가 원장에 남는다', () => {
    beforeEach(() => {
      mockPrisma.installmentPayment.findUnique.mockResolvedValue({
        id: 'pay-2', seqNo: 2, amount: 30000, status: 'PENDING',
        plan: { id: 'plan-1', billingId: 'b-1', paidCount: 1, installments: 3, totalAmount: 90000, status: 'ACTIVE' },
      });
    });

    it('🔴 회차 금액이 수단과 함께 원장 라인으로 기록된다', async () => {
      await service.payInstallment('pay-2', 'CARD');
      expect(mockPrisma.billingPayment.create).toHaveBeenCalledWith({
        data: { billingId: 'b-1', method: 'CARD', amount: 30000 },
      });
    });

    it('수단을 모르면 지어내지 않고 UNKNOWN 으로 남긴다 (현금으로 접지 않는다)', async () => {
      await service.payInstallment('pay-2');
      expect(mockPrisma.billingPayment.create).toHaveBeenCalledWith({
        data: { billingId: 'b-1', method: 'UNKNOWN', amount: 30000 },
      });
    });
  });

  describe('표기 정본', () => {
    it('MIXED 는 영문 원문으로 인쇄되지 않는다 (법정 영수증)', () => {
      expect(paymentMethodLabel('MIXED')).toBe('복합결제');
      expect(paymentMethodLabel('TRANSFER')).toBe('계좌이체');
      expect(paymentMethodLabel('VOUCHER')).toBe('검진권');
    });

    it('수단이 없으면 "수단 미기록" — 현금이라고 말하지 않는다', () => {
      expect(paymentMethodLabel(null)).toBe(PAYMENT_METHOD_LABEL.UNKNOWN);
      expect(paymentMethodLabel('')).toBe(PAYMENT_METHOD_LABEL.UNKNOWN);
    });

    it('정본에 없는 값은 삼키지 않고 원문 그대로 드러낸다', () => {
      expect(paymentMethodLabel('POINT')).toBe('POINT');
    });
  });

  describe('🔴 발행한 사건을 화면이 본다 (발행만 하고 끝내지 않는다)', () => {
    it('청구 생성 실패가 검토 대기 큐의 조회 집합에 들어 있다', async () => {
      mockPrisma.patientJourneyEvent = {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      };
      await service.getReviewQueue(7);
      const where = mockPrisma.patientJourneyEvent.findMany.mock.calls[0][0].where;
      // 이 배열에 없으면 사건은 기록돼도 어느 화면에도 뜨지 않는다
      expect(where.eventType.in).toContain('BILLING_CREATE_FAILED');
      expect(where.eventType.in).toContain('ER_BILLING_FAILED');
      expect(where.eventType.in).toContain('BILLING_AMEND_REVIEW');
    });

    it('라벨을 이진 삼항으로 정하지 않는다 — 세 번째 종류가 "정정 검토"로 둔갑하지 않는다', async () => {
      mockPrisma.patientJourneyEvent = {
        findMany: vi.fn().mockResolvedValue([{
          id: 'je-1', eventType: 'BILLING_CREATE_FAILED', eventAt: new Date(), title: 't', description: 'd',
          refType: 'ENCOUNTER', refId: 'e-1', patient: { familyName: '김', givenName: '환자', mrn: 'P1' },
        }]),
        count: vi.fn().mockResolvedValue(1),
        groupBy: vi.fn().mockResolvedValue([{ eventType: 'BILLING_CREATE_FAILED', _count: { _all: 1 } }]),
      };
      const { data } = await service.getReviewQueue(7);
      expect(data.items[0].kindLabel).toBe('청구 생성 실패');
      expect(data.createFailed).toBe(1);
      expect(data.amendReview).toBe(0);
    });
  });
});
