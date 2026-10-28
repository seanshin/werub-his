import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';

/** P0 이중 계상 해소(inpatient-edi-claim.plan.md) — InterimBilling=입원료 전용(처방 SoT=Billing.items) */
describe('중간정산 입원료 전용(P0)', () => {
  let service: InpatientService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      admission: { findUnique: vi.fn().mockResolvedValue({ id: 'adm-1', patientId: 'p-1', admitDate: new Date(Date.now() - 2.5 * 86400_000), dischargeDate: null, status: 'ADMITTED', bed: { bedClass: null } }) }, // 2.5일 → ceil 3일(호출 시점 오차 경계 회피)
      interimBillingRefund: { groupBy: vi.fn().mockResolvedValue([]) },
      interimBilling: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'ib-1', ...data })),
      },
      prescription: { findMany: vi.fn() },
      patient: { findUnique: vi.fn().mockResolvedValue({ mrn: 'HR-0001' }) },
      encounter: { findMany: vi.fn().mockResolvedValue([]) },
      billing: { findMany: vi.fn().mockResolvedValue([]) },
    };
    // 2026-10-22 — 산식은 정본 BillingService.quoteInpatientStay(퇴원 입원료 청구와 같은 함수)
    billing = { quoteInpatientStay: vi.fn(async (_a: string, days: number) => ({ ok: true, stayCode: 'AB1A0100', stayName: '입원료', days, dailyRate: 50000, priceBasis: 'DEFAULT_CONSTANT', totalAmount: days * 50000, copayRate: 0.2, copayAmount: days * 10000, insuranceAmount: days * 40000 })) };
    service = new InpatientService(prisma, undefined, { get: vi.fn(async () => null) } as any, { enqueue: vi.fn() } as any, billing as any);
  });
  let billing: any;

  it('생성 금액 = 정본 입원료 견적만(처방 합산 없음 — Billing.items 와 이중 계상 방지)', async () => {
    const r = await service.generateInterimBilling('adm-1');
    const days = billing.quoteInpatientStay.mock.calls[0][1];
    expect(Number(r.data.totalAmount)).toBe(days * 50000);
    // 🔴 처방 조회 자체가 없어야 함(구 rxTotal 경로 제거 확인)
    expect(prisma.prescription.findMany).not.toHaveBeenCalled();
  });

  it('보험/본인부담 = 견적의 자격별 급여율 결과 그대로(80% 상수 아님)', async () => {
    const r = await service.generateInterimBilling('adm-1');
    const days = billing.quoteInpatientStay.mock.calls[0][1];
    expect(Number(r.data.insuranceAmount)).toBe(days * 40000);
    expect(Number(r.data.copayAmount)).toBe(days * 10000);
  });

  it('퇴원정산 — 구 산식(P0 이전) 중간정산 혼재 시 안내 경고 동봉', async () => {
    prisma.interimBilling.findMany.mockResolvedValue([
      { id: 'old', sequenceNo: 1, periodStart: new Date('2026-07-20'), periodEnd: new Date('2026-07-21'), totalAmount: 100000, copayAmount: 20000, paidAmount: 20000, status: 'PAID', createdAt: new Date('2026-07-20') },
    ]);
    const r = await service.getDischargeSettlement('adm-1');
    expect(r.data.reconciliation.warnings.some((w: string) => w.includes('구 산식'))).toBe(true);
  });

  it('퇴원정산 — 신 산식(P0 이후)만이면 혼재 경고 없음', async () => {
    prisma.interimBilling.findMany.mockResolvedValue([
      { id: 'new', sequenceNo: 1, periodStart: new Date(), periodEnd: new Date(), totalAmount: 150000, copayAmount: 30000, paidAmount: 30000, status: 'PAID', createdAt: new Date('2026-07-25') },
    ]);
    const r = await service.getDischargeSettlement('adm-1');
    expect(r.data.reconciliation.warnings.some((w: string) => w.includes('구 산식'))).toBe(false);
  });
});
