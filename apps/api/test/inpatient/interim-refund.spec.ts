/**
 * 입원 중간정산 환불(2026-10-22 · ERP 회신 R5 계약 — ERP `docs/05-reference/erp-reply-his-interim-settlement-2026-10-22.md` §2).
 *  · 수납된(PAID) 회차만 · 부분 환불 · 🔴 누적 환불 ≤ 그 회차 수납액(넘으면 409 · 아무것도 안 쓴다)
 *  · 🔴 동시 환불 — 회차 행을 잠근 **뒤에** 합산한다(잠그기 전 합산은 경합 상대의 환불을 못 본다)
 *  · 사유 4자 · 금액 정수 ≥1 · 수단 = 중간정산 수단 어휘 · 회차 상태는 PAID 그대로(무효 아님)
 *  · 이벤트 `billing.interim_refunded` — ref `interim:refund:{refundId}` · 본문에 refundId(ERP 멱등 키)
 *  · 퇴원 정산 기납부 = 수납 − 환불 · 권한 = 관리자·원무
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UserRole } from '@prisma/client';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';
import { InpatientController } from '../../src/modules/inpatient/inpatient.controller';
import { RefundInterimBillingDto } from '../../src/modules/inpatient/dto/inpatient.dto';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { HIS_EVENT_CATALOG, PHI_GRADE_EVENTS } from '../../src/modules/integration/integration-outbox.service';

const status = async (p: Promise<unknown>) => { const e: any = await p.catch((x) => x); expect(e, '거부돼야 한다').toBeInstanceOf(Error); return { s: e.getStatus?.(), code: e.getResponse?.()?.code }; };
const flush = () => new Promise((r) => setTimeout(r, 0));
const PAID = { id: 'ib1', admissionId: 'a1', sequenceNo: 1, status: 'PAID', copayAmount: 20000, paidAmount: 20000, periodStart: new Date('2026-10-01'), periodEnd: new Date('2026-10-08'), totalAmount: 100000, insuranceAmount: 80000 };

function refundWith(row: any, already = 0, opts: { prior?: any } = {}) {
  const order: string[] = []; const created: any[] = [];
  const tx: any = {
    $queryRaw: vi.fn(async () => { order.push('lock'); return [{ id: row?.id }]; }),
    interimBillingRefund: {
      findUnique: vi.fn(async ({ where }: any) => opts.prior && opts.prior.requestKey === where.requestKey ? opts.prior : null),
      aggregate: vi.fn(async () => { order.push('sum'); return { _sum: { amount: already || null } }; }),
      create: vi.fn(async ({ data }: any) => { const r = { id: 'rf1', refundedAt: new Date('2026-10-22T03:00:00Z'), ...data }; created.push(r); return r; }),
    },
  };
  const prisma: any = {
    interimBilling: { findFirst: vi.fn(async () => row) },
    interimBillingRefund: { findUnique: vi.fn(async ({ where }: any) => opts.prior && opts.prior.requestKey === where.requestKey ? opts.prior : null) },
    admission: { findUnique: vi.fn(async () => ({ patientId: 'p1' })) },
    patient: { findUnique: vi.fn(async () => ({ mrn: 'M1' })) },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  const outbox = { enqueue: vi.fn() };
  return { svc: new InpatientService(prisma, undefined, undefined, outbox as any, undefined), order, created, outbox, prisma };
}

describe('🔴 중간정산 환불 — 수납된 회차·누적 ≤ 수납액', () => {
  it('부분 환불 기록 · 처리자 · 회차 상태는 건드리지 않는다', async () => {
    const m = refundWith(PAID, 5000);
    const r = await m.svc.refundInterimBilling('a1', 'ib1', { amount: 15000, method: 'CASH', reason: '  조기 퇴원 차액  ' }, 'u3', 'k-req-0001');
    expect(r.data).toMatchObject({ interimBillingId: 'ib1', amount: 15000, method: 'CASH', reason: '조기 퇴원 차액', refundedBy: 'u3' });
    expect(m.prisma.interimBilling).not.toHaveProperty('updateMany');
  });
  it('🔴 누적이 수납액을 넘으면 409 · 아무것도 안 쓴다', async () => {
    const m = refundWith(PAID, 5000);
    expect(await status(m.svc.refundInterimBilling('a1', 'ib1', { amount: 15001, method: 'CASH', reason: '조기 퇴원 차액' }, 'u3', 'k-req-0001'))).toEqual({ s: 409, code: 'INTERIM_REFUND_EXCEEDS_PAID' });
    expect(m.created).toHaveLength(0);
    await flush();
    expect(m.outbox.enqueue).not.toHaveBeenCalled();
  });
  it('🔴 잠근 뒤에 합산한다(동시 환불이 합계를 넘지 않게)', async () => {
    const m = refundWith(PAID);
    await m.svc.refundInterimBilling('a1', 'ib1', { amount: 1000, method: 'CARD', reason: '카드 취소 요청' }, 'u3', 'k-req-0001');
    expect(m.order).toEqual(['lock', 'sum']);
  });
  it('수납 전·무효 회차 409 · 없는 회차 404 · 사유 4자 미만·금액 0/소수 400 — 아무것도 안 쓴다', async () => {
    for (const st of ['GENERATED', 'VOID']) {
      const m = refundWith({ ...PAID, status: st });
      expect(await status(m.svc.refundInterimBilling('a1', 'ib1', { amount: 1000, method: 'CASH', reason: '조기 퇴원 차액' }, undefined, 'k-req-0001'))).toEqual({ s: 409, code: 'INTERIM_NOT_PAID' });
      expect(m.created).toHaveLength(0);
    }
    expect((await status(refundWith(null).svc.refundInterimBilling('a1', 'ib1', { amount: 1000, method: 'CASH', reason: '조기 퇴원 차액' }, undefined, 'k-req-0001'))).s).toBe(404);
    const m = refundWith(PAID);
    expect(await status(m.svc.refundInterimBilling('a1', 'ib1', { amount: 1000, method: 'CASH', reason: ' 착오 ' }, undefined, 'k-req-0001'))).toEqual({ s: 400, code: 'INTERIM_REFUND_REASON_REQUIRED' });
    expect(await status(m.svc.refundInterimBilling('a1', 'ib1', { amount: 0, method: 'CASH', reason: '조기 퇴원 차액' }, undefined, 'k-req-0001'))).toEqual({ s: 400, code: 'INTERIM_REFUND_AMOUNT_INVALID' });
    expect(await status(m.svc.refundInterimBilling('a1', 'ib1', { amount: 10.5, method: 'CASH', reason: '조기 퇴원 차액' }, undefined, 'k-req-0001'))).toEqual({ s: 400, code: 'INTERIM_REFUND_AMOUNT_INVALID' });
    expect(m.created).toHaveLength(0);
  });
  it('대조군 — 수납액 전액 환불은 허용', async () => {
    const m = refundWith(PAID, 0);
    await m.svc.refundInterimBilling('a1', 'ib1', { amount: 20000, method: 'TRANSFER', reason: '전액 환불 요청' }, undefined, 'k-req-0001');
    expect(m.created).toHaveLength(1);
  });
});

describe('🔴 요청 중복 방지 키(v4.118.0 · ERP 2차 회신 §3-2)', () => {
  const PRIOR = { id: 'rf0', interimBillingId: 'ib1', amount: 7000, method: 'CASH', reason: '조기 퇴원 차액', refundedBy: 'u3', refundedAt: new Date('2026-10-22T03:00:00Z'), requestKey: 'k-req-0001' };
  it('키 없음·형식 밖 = 400 · 아무것도 안 쓴다(잠그지도 않는다)', async () => {
    for (const k of [undefined, '', 'short', 'has space 12345', 'x'.repeat(101)]) {
      const m = refundWith(PAID);
      expect(await status(m.svc.refundInterimBilling('a1', 'ib1', { amount: 1000, method: 'CASH', reason: '조기 퇴원 차액' }, 'u3', k))).toEqual({ s: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
      expect(m.created).toHaveLength(0); expect(m.order).toHaveLength(0);
    }
  });
  it('🔴 같은 키·같은 내용 재전송 = 첫 결과 그대로 · 새 환불·이벤트 없음 · 합산도 안 한다', async () => {
    const m = refundWith(PAID, 7000, { prior: PRIOR });
    const r: any = await m.svc.refundInterimBilling('a1', 'ib1', { amount: 7000, method: 'CASH', reason: ' 조기 퇴원 차액 ' }, 'u3', 'k-req-0001');
    expect(r).toEqual({ data: PRIOR, meta: { replayed: true } });
    expect(m.created).toHaveLength(0); expect(m.order).toEqual(['lock']);
    await flush(); await flush();
    expect(m.outbox.enqueue).not.toHaveBeenCalled();
  });
  it('🔴 같은 키·다른 내용 = 409 IDEMPOTENCY_KEY_CONFLICT · 아무것도 안 쓴다', async () => {
    for (const d of [{ amount: 7001, method: 'CASH', reason: '조기 퇴원 차액' }, { amount: 7000, method: 'CARD', reason: '조기 퇴원 차액' }, { amount: 7000, method: 'CASH', reason: '다른 사유 적음' }] as const) {
      const m = refundWith(PAID, 7000, { prior: PRIOR });
      expect(await status(m.svc.refundInterimBilling('a1', 'ib1', d, 'u3', 'k-req-0001'))).toEqual({ s: 409, code: 'IDEMPOTENCY_KEY_CONFLICT' });
      expect(m.created).toHaveLength(0);
    }
    const other = refundWith({ ...PAID, id: 'ib2' }, 0, { prior: PRIOR });
    expect(await status(other.svc.refundInterimBilling('a1', 'ib2', { amount: 7000, method: 'CASH', reason: '조기 퇴원 차액' }, 'u3', 'k-req-0001'))).toEqual({ s: 409, code: 'IDEMPOTENCY_KEY_CONFLICT' });
  });
  it('회차 잠금 밖 동시 경합(유일 인덱스 P2002) = 먼저 들어간 행으로 판정', async () => {
    const m = refundWith(PAID);
    m.prisma.$transaction = vi.fn(async () => { throw Object.assign(new Error('unique'), { code: 'P2002' }); });
    m.prisma.interimBillingRefund.findUnique = vi.fn(async () => PRIOR);
    expect(await m.svc.refundInterimBilling('a1', 'ib1', { amount: 7000, method: 'CASH', reason: '조기 퇴원 차액' }, 'u3', 'k-req-0001')).toEqual({ data: PRIOR, meta: { replayed: true } });
  });
  it('대조군 — 새 키는 새 환불 · 키를 원장에 남긴다 · replayed false', async () => {
    const m = refundWith(PAID, 7000, { prior: PRIOR });
    const r: any = await m.svc.refundInterimBilling('a1', 'ib1', { amount: 7000, method: 'CASH', reason: '조기 퇴원 차액' }, 'u3', 'k-req-0002');
    expect(r.meta).toEqual({ replayed: false });
    expect(m.created[0]).toMatchObject({ requestKey: 'k-req-0002', amount: 7000 });
  });
  it('컨트롤러가 Idempotency-Key 헤더를 서비스로 넘긴다(구조)', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/inpatient/inpatient.controller.ts'), 'utf8');
    const body = src.slice(src.indexOf('async refundInterimBilling'), src.indexOf('async refundInterimBilling') + 500);
    expect(body).toMatch(/@Headers\('idempotency-key'\) idempotencyKey/);
    expect(body).toMatch(/refundInterimBilling\(id, billingId, dto, userId, idempotencyKey\)/);
  });
});

describe('ERP 이벤트 — billing.interim_refunded (R5 계약)', () => {
  it('ref = interim:refund:{refundId} · 본문에 refundId·금액·수단·사유·처리자·시각 · 회차 칸 그대로', async () => {
    const m = refundWith(PAID);
    await m.svc.refundInterimBilling('a1', 'ib1', { amount: 7000, method: 'CASH', reason: '조기 퇴원 차액' }, 'u3', 'k-req-0001');
    await flush(); await flush();
    expect(m.outbox.enqueue).toHaveBeenCalledWith('billing', 'billing.interim_refunded', 'interim:refund:rf1', expect.objectContaining({
      interimBillingId: 'ib1', sequenceNo: 1, paidAmount: 20000, status: 'PAID', chartNo: 'M1',
      refund: { refundId: 'rf1', amount: 7000, method: 'CASH', reason: '조기 퇴원 차액', refundedBy: 'u3', refundedAt: new Date('2026-10-22T03:00:00Z') },
    }));
    // 🔴 환불을 payments 음수 줄로 보내지 않는다(ERP 계약)
    expect(m.outbox.enqueue.mock.calls[0][3]).not.toHaveProperty('payments');
  });
  it('이벤트 카탈로그에 있다', () => {
    expect(HIS_EVENT_CATALOG).toContain('billing.interim_refunded');
    expect(PHI_GRADE_EVENTS.has('billing.interim_refunded')).toBe(true);
  });
});

describe('DTO·권한', () => {
  it('금액 정수 ≥1 · 수단 어휘(선수금 아님) · 사유 4자 · 대조군', async () => {
    const errs = async (o: object) => (await validate(plainToInstance(RefundInterimBillingDto, o))).map((e) => e.property).sort();
    expect(await errs({})).toEqual(['amount', 'method', 'reason']);
    expect(await errs({ amount: 1000, method: 'DEPOSIT', reason: '조기 퇴원 차액' })).toEqual(['method']);
    expect(await errs({ amount: 0, method: 'CASH', reason: '조기 퇴원 차액' })).toEqual(['amount']);
    expect(await errs({ amount: 1000, method: 'CASH', reason: '착오' })).toEqual(['reason']);
    expect(await errs({ amount: 1000, method: 'CASH', reason: '조기 퇴원 차액' })).toEqual([]);
  });
  it('관리자·원무만', () => {
    expect(Reflect.getMetadata(ROLES_KEY, InpatientController.prototype.refundInterimBilling)).toEqual([UserRole.ADMIN, UserRole.RECEPTIONIST]);
  });
});
