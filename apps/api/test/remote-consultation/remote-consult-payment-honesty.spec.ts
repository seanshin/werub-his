/**
 * 비대면 진료 결제·취소 — 하지 않은 결제·환불을 했다고 적지 않는다(2026-10-14 결함 발굴 수납·청구 P3-1).
 *  · 🔴 종전: 카드를 고르면 승인 없이 청구 PAID·납부액 = 상담료
 *  · 🔴 종전: 결제 전 취소·48시간 자동 취소를 '환불'로 — 상담 REFUNDED·청구 REFUNDED(환불액 없음)·`refunded: true`·의사 CRITICAL
 *  · 이제: 카드·카카오페이는 승인 연동이 없어 거부(아무것도 안 바뀜) · 후불은 청구 보류 · 받은 돈이 있을 때만 환불(원장 환불 줄)
 *  · 🔎 조사의 "카카오페이·후불 늘 400"은 오탐 — 포털 DTO 는 지역 상수(CARD·KAKAOPAY·DEFERRED)로 검사한다
 */
import { describe, it, expect, vi } from 'vitest';
import { RemoteConsultationService } from '../../src/modules/remote-consultation/remote-consultation.service';

function mk(consult: any, billing: any = null) {
  const writes = { billing: [] as any[], consult: [] as any[], lines: [] as any[], notes: [] as any[] };
  const prisma: any = {
    remoteConsultation: {
      findFirst: vi.fn().mockResolvedValue(consult),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(async ({ data }: any) => { writes.consult.push(data); return { ...consult, ...data }; }),
      updateMany: vi.fn(async ({ data }: any) => { writes.consult.push(data); return { count: 1 }; }),
    },
    billing: {
      findUnique: vi.fn().mockResolvedValue(billing),
      update: vi.fn(async ({ data }: any) => { writes.billing.push(data); return {}; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const st = billing?.status;
        const ok = typeof where.status === 'string' ? where.status === st : where.status?.in ? where.status.in.includes(st) : true;
        if (!ok) return { count: 0 };
        writes.billing.push(data); return { count: 1 };
      }),
    },
    billingPayment: { create: vi.fn(async ({ data }: any) => { writes.lines.push(data); return data; }) },
    consultationMessage: { create: vi.fn().mockResolvedValue({}) },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
  const notifications = { create: vi.fn(async (_id: string, n: any) => { writes.notes.push(n); }) };
  const svc = new RemoteConsultationService(prisma, {} as any, notifications as any);
  return { svc, writes };
}
const CONFIRMED = { id: 'rc1', patientId: 'p1', doctorId: 'd1', subject: '두통', isFreeConsult: false, billingStatus: 'CONFIRMED', billingId: 'b1', feeAmount: 15000, status: 'COMPLETED' };

describe('🔴 결제 — 승인 없이 PAID 로 적지 않는다', () => {
  it('카드·카카오페이 → 409(연동 없음) · 청구·상담 아무것도 바뀌지 않는다', async () => {
    for (const m of ['CARD', 'KAKAOPAY']) {
      const { svc, writes } = mk(CONFIRMED, { status: 'PENDING' });
      const e: any = await svc.payConsultation('rc1', 'p1', { paymentMethod: m }).catch((x) => x);
      expect(e.getResponse()).toMatchObject({ code: 'ONLINE_PAYMENT_NOT_AVAILABLE', details: { charged: false } });
      expect(writes.billing).toHaveLength(0); expect(writes.consult).toHaveLength(0);
    }
  });
  it('대조군 — 후불은 청구 보류 · 상담은 결제 대기 그대로 · 결제됐다고 말하지 않는다', async () => {
    const { svc, writes } = mk(CONFIRMED, { status: 'PENDING' });
    const r: any = await svc.payConsultation('rc1', 'p1', { paymentMethod: 'DEFERRED' });
    expect(r).toMatchObject({ paid: false, deferred: true, billingStatus: 'CONFIRMED' });
    expect(writes.billing[0]).toMatchObject({ status: 'DEFERRED' });
    expect(writes.billing[0].paidAmount).toBeUndefined();
    expect(writes.consult[0]).toEqual({ paymentMethod: 'DEFERRED' });
  });
});

describe('🔴 취소 — 받은 돈이 있을 때만 환불', () => {
  const OPEN = { ...CONFIRMED, status: 'ACCEPTED', billingStatus: 'PENDING', doctorRepliedAt: null };
  it('결제 전 취소(청구 없음) → 상담 CANCELLED · refunded false', async () => {
    const { svc, writes } = mk({ ...OPEN, billingId: null });
    const r: any = await svc.cancelConsultation('rc1', 'p1');
    expect(r).toMatchObject({ cancelled: true, refunded: false, refundedAmount: 0 });
    expect(writes.consult[0]).toMatchObject({ status: 'CANCELLED', billingStatus: 'CANCELLED' });
    expect(writes.lines).toHaveLength(0);
  });
  it('미납 청구 → 청구 CANCELLED(REFUNDED 아님) · 환불 줄 없음', async () => {
    const { svc, writes } = mk(OPEN, { status: 'PENDING', paidAmount: null, refundAmount: null });
    await svc.cancelConsultation('rc1', 'p1');
    expect(writes.billing[0]).toEqual({ status: 'CANCELLED' });
    expect(writes.lines).toHaveLength(0);
  });
  it('대조군 — 받은 돈이 있으면 그만큼 환불 · 원장 환불 줄(일마감) · 상담 REFUNDED', async () => {
    const { svc, writes } = mk(OPEN, { status: 'PAID', paidAmount: 15000, refundAmount: null });
    const r: any = await svc.cancelConsultation('rc1', 'p1');
    expect(r).toMatchObject({ refunded: true, refundedAmount: 15000 });
    expect(writes.billing[0]).toMatchObject({ status: 'REFUNDED', refundAmount: 15000 });
    expect(writes.lines[0]).toMatchObject({ method: 'REFUND', amount: -15000 });
    expect(writes.consult[0]).toMatchObject({ billingStatus: 'REFUNDED' });
  });
});

describe('🔴 48시간 자동 취소 — 결제 전이면 환불·CRITICAL 이라 말하지 않는다', () => {
  it('결제 전 → WARNING "자동 취소" · 대조군 결제 후 → CRITICAL "자동 환불"', async () => {
    const old = { id: 'rc1', doctorId: 'd1', subject: '두통', createdAt: new Date(Date.now() - 50 * 3600_000), billingId: null };
    const a = mk({ ...old });
    a.svc['prisma'].remoteConsultation.findMany = vi.fn().mockResolvedValue([old]);
    await a.svc.runSlaCheck();
    expect(a.writes.notes[0]).toMatchObject({ title: '비대면 진료 자동 취소', severity: 'WARNING' });
    const b = mk({ ...old }, { status: 'PAID', paidAmount: 15000, refundAmount: null });
    b.svc['prisma'].remoteConsultation.findMany = vi.fn().mockResolvedValue([{ ...old, billingId: 'b1' }]);
    await b.svc.runSlaCheck();
    expect(b.writes.notes[0]).toMatchObject({ title: '비대면 진료 자동 환불', severity: 'CRITICAL' });
  });
});
