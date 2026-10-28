/**
 * 수납·청구 결함 발굴 P5(2026-10-14).
 *  · P5-2 🔴 발생(accrual) ERP 라인이 옛 우선순위(코드 특례 > 감면 자격)·처방 수량으로 따로 계산 — 정산 라인과 같은 ref 라 먼저 적재된 쪽만 남았다
 *  · P5-5 🔴 환불·취소해도 보험 청구는 그대로 — 자동으로 바꾸지 않고 검토할 청구를 응답이 말한다
 *  · P1-5/P5 선수금으로 낸 몫을 환불 응답이 밝힌다(복원 여부는 사람 결정)
 *  · P5-6 🔴 취소·환불 처리자 늘 null · 결제 전 취소 회계 통지 금액이 청구 총액 — 돌려준 돈을 따로 싣는다
 *  · P5-1 미등재 단가 라인은 0원으로 들어가되 응답이 밝힌다
 */
import { describe, it, expect, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';

function svcWith(prisma: any, outbox = { enqueue: vi.fn() }) {
  prisma.$transaction = prisma.$transaction ?? vi.fn(async (fn: any) => fn(prisma));
  const s = new BillingService(prisma, {} as any, outbox as any, { get: vi.fn(async () => 'CLINIC') } as any, {} as any, {} as any, { reverseRedemption: vi.fn().mockResolvedValue({ count: 0, totalRestored: 0 }) } as any);
  return s;
}

describe('🔴 P5-2 발생 라인 = 정산 라인', () => {
  it('감면 자격(산정특례 10%)이면 코드 특례(80%)가 아니라 자격 율 · 행위 수량은 정산과 같이 1', async () => {
    const outbox = { enqueue: vi.fn() };
    const prisma: any = {
      prescription: { findUnique: vi.fn().mockResolvedValue({
        id: 'rx1', type: 'IMAGING', quantity: 3, medicationCodeId: null, procedureCodeId: 'pmri', medicationCode: null,
        procedureCode: { code: 'HE101', nameKo: 'MRI', unitPrice: 300000, copayRate: 0.8, insuranceCovered: true },
        encounter: { id: 'e1', visitType: 'OUTPATIENT', doctorId: 'd1', admissionId: null, patient: { id: 'p1', mrn: 'M', dateOfBirth: null, gender: 'MALE', insuranceType: 'NHI' } },
      }) },
      staff: { findUnique: vi.fn().mockResolvedValue(null) },
      encounterDiagnosis: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const svc = svcWith(prisma, outbox);
    (svc as any).resolveCopay = vi.fn().mockResolvedValue({ rate: 0.1, copayCategory: 'SPECIAL_EXEMPTION', medicalAidClass: null, specialCaseType: 'V027', eligibilityStatus: 'VERIFIED' });
    const r: any = await svc.emitAccrualLine('rx1');
    const line = outbox.enqueue.mock.calls[0][3];
    expect(line.copayRate).toBe(0.1);
    expect(line.count).toBe(1);
    expect(line.amount).toBe(300000);
    expect(r.count).toBe(1);
  });
});

describe('🔴 P5-5·P5-6·선수금 — 환불·취소', () => {
  const base = { id: 'b1', patientId: 'p1', status: 'PAID', paidAmount: 30000, refundAmount: null, totalAmount: 100000, patientCopay: 30000, paymentMethod: 'MIXED', processedBy: null };
  const mk = (billing: any, claims: any[] = [], depositPaid: number | null = null) => {
    const prisma: any = {
      billing: { findUnique: vi.fn().mockResolvedValue(billing), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      billingPayment: { create: vi.fn(), aggregate: vi.fn().mockResolvedValue({ _sum: { amount: depositPaid } }) },
      claim: { findMany: vi.fn().mockResolvedValue(claims) },
    };
    const outbox = { enqueue: vi.fn() };
    const svc = svcWith(prisma, outbox);
    (svc as any).billingCorrection = vi.fn().mockResolvedValue({ correctionOf: null, revision: 1 });
    (svc as any).emitBillingLines = vi.fn();
    return { svc, prisma, outbox };
  };
  it('청구가 있으면 검토 필요를 응답에 싣는다 · 반려된 청구만 있으면 없음 · 처리자 기록', async () => {
    const a = mk(base, [{ id: 'c1', status: 'SUBMITTED', claimNumber: 'CLM-1' }]);
    const r: any = await a.svc.refund('b1', { amount: 30000, reason: '오류', processedBy: 'staff-1' });
    expect(r.claimReview).toMatchObject({ needed: true, claims: [{ id: 'c1' }] });
    expect(a.prisma.claim.findMany.mock.calls[0][0].where).toMatchObject({ billingId: 'b1', status: { not: 'REJECTED' } });
    expect(a.prisma.billingPayment.create.mock.calls[0][0].data.processedBy).toBe('staff-1');
    const b = mk(base, []);
    expect(((await b.svc.refund('b1', { amount: 1000, reason: 'x' })) as any).claimReview).toBeNull();
  });
  it('선수금으로 낸 몫 — 전액 환불이면 전부 · 부분이면 비율 · 없으면 0', async () => {
    expect(((await mk(base, [], 10000).svc.refund('b1', { amount: 30000, reason: 'x' })) as any).depositPortion).toBe(10000);
    expect(((await mk(base, [], 10000).svc.refund('b1', { amount: 15000, reason: 'x' })) as any).depositPortion).toBe(5000);
    expect(((await mk(base, [], null).svc.refund('b1', { amount: 15000, reason: 'x' })) as any).depositPortion).toBe(0);
  });
  it('결제 전 취소 — 회계 통지에 돌려준 돈(0)·청구 총액을 따로 · 처리자 기록', async () => {
    const c = mk({ ...base, status: 'PENDING', paidAmount: null });
    const r: any = await c.svc.cancel('b1', '환자 요청', 'staff-2');
    const ev = c.outbox.enqueue.mock.calls.find((x: any[]) => x[1] === 'billing.adjusted')[3];
    expect(ev).toMatchObject({ cashReversal: 0, billedTotal: 100000 });
    expect(c.prisma.billing.updateMany.mock.calls[0][0].data.processedBy).toBe('staff-2');
    expect(r.claimReview).toBeNull();
  });
});
