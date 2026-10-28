import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';

/** A-6 중간정산/퇴원정산 ERP export — outbox 이벤트 3종(발생·수납·퇴원 스냅샷·값-멱등 ref) */
describe('중간정산/퇴원정산 ERP export', () => {
  let service: InpatientService;
  let prisma: any;
  let outbox: any;

  beforeEach(() => {
    let lastPaid: any = {};
    prisma = {
      admission: { findUnique: vi.fn().mockResolvedValue({ id: 'adm-1', patientId: 'p-1', admitDate: new Date('2026-07-01'), dischargeDate: null, status: 'ADMITTED', bed: { bedClass: null } }) },
      interimBilling: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'ib-1', ...data })),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'ib-1', admissionId: 'adm-1', sequenceNo: 1, periodStart: new Date(), periodEnd: new Date(), totalAmount: 100000, insuranceAmount: 80000, copayAmount: 20000, ...data })),
        // P3-2: 수납은 상태 조건부 갱신 → 다시 읽기
        updateMany: vi.fn().mockImplementation(({ data }: any) => { lastPaid = data; return Promise.resolve({ count: 1 }); }),
        findUniqueOrThrow: vi.fn().mockImplementation(() => Promise.resolve({ id: 'ib-1', admissionId: 'adm-1', sequenceNo: 1, periodStart: new Date(), periodEnd: new Date(), totalAmount: 100000, insuranceAmount: 80000, copayAmount: 20000, payments: [{ method: 'CASH', amount: 20000, cardApprovalNo: null, cardCompany: null, installment: null, cashReceiptNo: null, processedBy: 'u1', createdAt: new Date() }], ...lastPaid })),
      },
      prescription: { findMany: vi.fn().mockResolvedValue([]) },
      patient: { findUnique: vi.fn().mockResolvedValue({ mrn: 'HR-0001' }) },
      encounter: { findMany: vi.fn().mockResolvedValue([]) },
      billing: { findMany: vi.fn().mockResolvedValue([]) },
    };
    outbox = { enqueue: vi.fn().mockResolvedValue({}) };
    prisma.interimBillingPayment = { create: vi.fn(async ({ data }: any) => data) };
    prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
    service = new InpatientService(prisma, undefined, { get: vi.fn(async () => null) } as any, outbox, { quoteInpatientStay: vi.fn(async (_a: string, days: number) => ({ ok: true, stayCode: 'AB1A0100', stayName: '입원료', days, dailyRate: 50000, priceBasis: 'DEFAULT_CONSTANT', totalAmount: days * 50000, copayRate: 0.2, copayAmount: days * 10000, insuranceAmount: days * 40000 })) } as any);
  });

  it('중간정산 생성 → billing.interim_recorded 발행(chartNo 동봉·ref 멱등)', async () => {
    await service.generateInterimBilling('adm-1');
    await new Promise((r) => setTimeout(r, 0)); // void 비동기 발행 대기
    expect(outbox.enqueue).toHaveBeenCalledWith(
      'billing', 'billing.interim_recorded', 'interim:rec:ib-1',
      expect.objectContaining({ interimBillingId: 'ib-1', admissionId: 'adm-1', chartNo: 'HR-0001' }),
    );
  });

  it('중간정산 수납 → billing.interim_paid 발행', async () => {
    prisma.interimBilling.findFirst.mockResolvedValue({ id: 'ib-1', admissionId: 'adm-1', status: 'GENERATED', copayAmount: 20000 });
    await service.payInterimBilling('adm-1', 'ib-1', { method: 'CASH', amount: 20000 }, 'u1');
    await new Promise((r) => setTimeout(r, 0));
    expect(outbox.enqueue).toHaveBeenCalledWith(
      'billing', 'billing.interim_paid', 'interim:paid:ib-1',
      expect.objectContaining({ paidAmount: 20000, status: 'PAID', payments: [expect.objectContaining({ method: 'CASH', amount: 20000 })] }),
    );
  });

  it('퇴원정산 export → billing.discharge_settlement 스냅샷·값-멱등 ref(총본인부담:기납부 바인딩)', async () => {
    const r = await service.exportDischargeSettlement('adm-1', 'u-admin');
    expect(r.exported).toBe(true);
    expect(r.ref).toBe('dsettle:adm-1:0:0'); // 청구/중간정산 0건 → 0:0
    expect(outbox.enqueue).toHaveBeenCalledWith(
      'billing', 'billing.discharge_settlement', 'dsettle:adm-1:0:0',
      expect.objectContaining({ admissionId: 'adm-1', chartNo: 'HR-0001', exportedBy: 'u-admin' }),
    );
  });

  it('outbox 미구성 시 export는 400(명확한 미구성 에러)', async () => {
    const svc = new InpatientService(prisma, undefined, { get: vi.fn(async () => null) } as any, undefined);
    await expect(svc.exportDischargeSettlement('adm-1')).rejects.toThrow(BadRequestException);
  });

  it('outbox 발행 실패는 비차단 — 정산 생성은 성공', async () => {
    prisma.patient.findUnique.mockRejectedValue(new Error('db down'));
    const r = await service.generateInterimBilling('adm-1');
    expect(r.data.id).toBe('ib-1'); // 발행 실패해도 정산 무영향
  });
});
