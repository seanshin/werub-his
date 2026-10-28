/**
 * 입원 중간정산 v2(2026-10-22 · 수납·청구 결함 발굴 P3-2 남은 몫 · 사용자 "중간정산 수납 관련된 부분들 진행").
 *  · 🔴 산식 정본 하나 — 중간정산 = 퇴원 입원료 청구와 같은 stayPricing(수가 단가 → 병상 등급 설정 → 기본 일당 → 상수) · 자격별 급여율(INPATIENT)
 *       · 견적은 진료에 자격을 고정하지 않는다 · 단가 출처를 돌려준다(상수 = DEFAULT_CONSTANT)
 *  · 🔴 기간 — [시작, 끝) 박 수 · 첫 회차는 입원일(KST 날짜)부터 · 다음 회차는 직전 끝 날짜부터(경계일 두 번 세지 않음) ·
 *       같은 날 두 번 = 409 · 무효 회차는 이어받지 않음 · 재원 중만 · 동시 생성 409
 *  · 🔴 수납 — 수단 필수·카드 승인번호 · 상태 전이와 원장 줄 한 트랜잭션 · 처리자 · 무효 회차 수납 거부 · ERP 페이로드에 수단
 *  · 무효 — 사유 4자 · 수납 전·마지막 회차만 · 이벤트
 *  · 🔴 일마감 — 중간정산 수납을 별도 칸으로(총계에 섞지 않음 — 전표는 interim_paid) · 원장 이전 수납은 수단 미기록
 *  · 퇴원 정산은 무효 회차를 뺀다 · 권한 — 원무가 만들고 무효로 한다
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UserRole } from '@prisma/client';
import { BillingService } from '../../src/modules/billing/billing.service';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';
import { InpatientController } from '../../src/modules/inpatient/inpatient.controller';
import { PayInterimBillingDto } from '../../src/modules/inpatient/dto/inpatient.dto';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { todayDateOnly } from '../../src/common/day-range';

const SRC = join(__dirname, '../../src/modules');
const status = async (p: Promise<unknown>) => { const e: any = await p.catch((x) => x); expect(e, '거부돼야 한다').toBeInstanceOf(Error); return { s: e.getStatus?.(), code: e.getResponse?.()?.code }; };

// ── 정본 견적 ──
function billingWith(opts: { unitPrice?: number; config?: Record<string, unknown>; procFound?: boolean; eligRate?: number }) {
  const prisma: any = {
    admission: { findUnique: vi.fn(async () => ({ id: 'a1', patient: { id: 'p1', insuranceType: 'NHI' }, bed: { bedClass: 'GENERAL' } })) },
    procedureCode: { findFirst: vi.fn(async () => (opts.procFound === false ? null : { id: 'pc1', code: 'AB1A0100', nameKo: '입원료', unitPrice: opts.unitPrice ?? 0 })) },
    eligibilityCheck: { findFirst: vi.fn(async () => null) },
    encounter: { update: vi.fn() },
  };
  const config = { get: vi.fn(async (k: string) => opts.config?.[k] ?? null) };
  const eligibility = { resolveCopayRate: vi.fn(async () => ({ rate: opts.eligRate ?? 0.2, copayCategory: 'NHI_GENERAL' })), copayRateFor: vi.fn() };
  const svc = new BillingService(prisma, {} as any, {} as any, config as any, eligibility as any, {} as any, {} as any);
  return { svc, prisma, eligibility };
}

describe('🔴 입원료 견적 정본 — 중간정산과 퇴원 입원료 청구가 같은 함수', () => {
  it('단가 출처 사슬 — 수가 단가 · 병상 등급 설정 · 기본 일당 · 상수(근거 없음)', async () => {
    expect(await billingWith({ unitPrice: 61000 }).svc.quoteInpatientStay('a1', 3)).toMatchObject({ ok: true, dailyRate: 61000, priceBasis: 'CODE', totalAmount: 183000 });
    expect(await billingWith({ config: { 'inpatient.bedRates': { GENERAL: 55000 } } }).svc.quoteInpatientStay('a1', 2)).toMatchObject({ dailyRate: 55000, priceBasis: 'CONFIG_BED_CLASS' });
    expect(await billingWith({ config: { 'inpatient.dailyRate': 52000 } }).svc.quoteInpatientStay('a1', 2)).toMatchObject({ dailyRate: 52000, priceBasis: 'CONFIG_DAILY' });
    expect(await billingWith({}).svc.quoteInpatientStay('a1', 2)).toMatchObject({ dailyRate: 50000, priceBasis: 'DEFAULT_CONSTANT' });
  });
  it('🔴 급여율 = 자격 정본(INPATIENT) — 80% 상수가 아니다 · 진료에 자격을 고정하지 않는다', async () => {
    const m = billingWith({ unitPrice: 50000, eligRate: 0.05 });
    const q = await m.svc.quoteInpatientStay('a1', 4);
    expect(q).toMatchObject({ copayRate: 0.05, copayAmount: 10000, insuranceAmount: 190000 });
    expect(m.eligibility.resolveCopayRate).toHaveBeenCalledWith('p1', 'NHI', 'INPATIENT', undefined);
    expect(m.prisma.encounter.update).not.toHaveBeenCalled();
  });
  it('수가코드를 못 찾으면 금액을 지어내지 않는다', async () => {
    expect(await billingWith({ procFound: false }).svc.quoteInpatientStay('a1', 2)).toEqual({ ok: false, reason: 'CODE_NOT_FOUND:AB1A0100' });
  });
  it('구조 가드 — 퇴원 입원료 청구도 stayPricing 을 쓰고 · 중간정산 서비스에 설정 일당·80% 상수가 없다', () => {
    const billing = readFileSync(join(SRC, 'billing/billing.service.ts'), 'utf8');
    const stay = billing.slice(billing.indexOf('async createInpatientStayBilling'), billing.indexOf('async createInpatientStayBilling') + 4000);
    expect(stay).toMatch(/this\.stayPricing\(/);
    expect(stay).toMatch(/stayCopayOf\(/);
    const inpatient = readFileSync(join(SRC, 'inpatient/inpatient.service.ts'), 'utf8');
    expect(inpatient).not.toMatch(/inpatient\.insuranceRate/);
    expect(inpatient).not.toMatch(/resolveDailyRate/);
    expect(inpatient).toMatch(/this\.billing\.quoteInpatientStay\(/);
  });
});

// ── 생성 ──
const DAY = 86_400_000;
function inpatientWith(o: { status?: string; admitDate?: Date; existing?: { sequenceNo: number; periodEnd: Date; status: string }[]; createErr?: unknown; billing?: unknown } = {}) {
  const created: any[] = [];
  const prisma: any = {
    admission: { findUnique: vi.fn(async () => ({ id: 'a1', patientId: 'p1', status: o.status ?? 'ADMITTED', admitDate: o.admitDate ?? new Date(Date.now() - 3 * DAY) })) },
    interimBilling: {
      findMany: vi.fn(async () => [...(o.existing ?? [])].sort((a, b) => b.sequenceNo - a.sequenceNo)),
      create: vi.fn(async ({ data }: any) => { if (o.createErr) throw o.createErr; created.push(data); return { id: 'ib-new', ...data }; }),
    },
    patient: { findUnique: vi.fn(async () => ({ mrn: 'M1' })) },
  };
  const billing = o.billing === undefined
    ? { quoteInpatientStay: vi.fn(async (_a: string, days: number) => ({ ok: true, stayCode: 'AB1A0100', stayName: '입원료', days, dailyRate: 50000, priceBasis: 'DEFAULT_CONSTANT', totalAmount: days * 50000, copayRate: 0.2, copayAmount: days * 10000, insuranceAmount: days * 40000 })) }
    : o.billing;
  const outbox = { enqueue: vi.fn() };
  return { svc: new InpatientService(prisma, undefined, undefined, outbox as any, billing as any), prisma, created, billing: billing as any, outbox };
}

describe('🔴 중간정산 생성 — 기간·상태·동시성', () => {
  it('첫 회차 = 입원일(KST 날짜)부터 오늘까지 박 수 · 근거 칸 · 만든 사람', async () => {
    const m = inpatientWith({ admitDate: new Date(Date.now() - 3 * DAY) });
    await m.svc.generateInterimBilling('a1', 'u1');
    const d = m.created[0];
    expect(d.periodEnd).toEqual(todayDateOnly());
    expect(d.days).toBe(3);
    expect(m.billing.quoteInpatientStay).toHaveBeenCalledWith('a1', 3);
    expect(d).toMatchObject({ sequenceNo: 1, priceBasis: 'DEFAULT_CONSTANT', dailyRate: 50000, copayRate: 0.2, createdBy: 'u1', copayAmount: 30000 });
  });
  it('🔴 다음 회차는 직전 끝 날짜부터 — 경계일을 두 번 세지 않는다(박 수 = 끝 − 시작)', async () => {
    const lastEnd = new Date(todayDateOnly().getTime() - 2 * DAY);
    const m = inpatientWith({ existing: [{ sequenceNo: 1, periodEnd: lastEnd, status: 'PAID' }] });
    await m.svc.generateInterimBilling('a1');
    expect(m.created[0]).toMatchObject({ periodStart: lastEnd, days: 2, sequenceNo: 2 });
  });
  it('🔴 같은 날 두 번 = 409(종전엔 max(1,…) 로 하루치가 또 생겼다)', async () => {
    const m = inpatientWith({ existing: [{ sequenceNo: 1, periodEnd: todayDateOnly(), status: 'GENERATED' }] });
    expect(await status(m.svc.generateInterimBilling('a1'))).toEqual({ s: 409, code: 'INTERIM_NO_NEW_PERIOD' });
    expect(m.created).toHaveLength(0);
  });
  it('무효 회차는 이어받지 않는다 — 그 앞 살아 있는 회차 끝부터 · 회차 번호는 계속 증가', async () => {
    const liveEnd = new Date(todayDateOnly().getTime() - 4 * DAY);
    const m = inpatientWith({ existing: [{ sequenceNo: 1, periodEnd: liveEnd, status: 'PAID' }, { sequenceNo: 2, periodEnd: todayDateOnly(), status: 'VOID' }] });
    await m.svc.generateInterimBilling('a1');
    expect(m.created[0]).toMatchObject({ periodStart: liveEnd, days: 4, sequenceNo: 3 });
  });
  it('🔴 퇴원·취소된 입원은 409 · 동시 생성(유일 위반)은 409 · 산정 정본 없으면 409 · 수가코드 없음 409', async () => {
    expect(await status(inpatientWith({ status: 'DISCHARGED' }).svc.generateInterimBilling('a1'))).toEqual({ s: 409, code: 'INTERIM_NOT_ADMITTED' });
    expect(await status(inpatientWith({ createErr: { code: 'P2002' } }).svc.generateInterimBilling('a1'))).toEqual({ s: 409, code: 'INTERIM_CONCURRENT' });
    expect(await status(inpatientWith({ billing: null }).svc.generateInterimBilling('a1'))).toEqual({ s: 409, code: 'INTERIM_PRICING_UNAVAILABLE' });
    const noCode = inpatientWith({ billing: { quoteInpatientStay: vi.fn(async () => ({ ok: false, reason: 'CODE_NOT_FOUND:X' })) } });
    expect(await status(noCode.svc.generateInterimBilling('a1'))).toEqual({ s: 409, code: 'INTERIM_PRICE_UNKNOWN' });
    expect(noCode.created).toHaveLength(0);
  });
  it('대조군 — 전실(TRANSFERRED)도 재원 중', async () => {
    const m = inpatientWith({ status: 'TRANSFERRED' });
    await m.svc.generateInterimBilling('a1');
    expect(m.created).toHaveLength(1);
  });
});

// ── 수납·무효 ──
function payWith(row: any, opts: { raced?: boolean; later?: number } = {}) {
  const writes: any[] = []; const ledger: any[] = [];
  const prisma: any = {
    interimBilling: {
      findFirst: vi.fn(async () => row),
      updateMany: vi.fn(async ({ where, data }: any) => { if (opts.raced || where.status !== row.status) return { count: 0 }; writes.push(data); return { count: 1 }; }),
      findUniqueOrThrow: vi.fn(async () => ({ ...row, ...writes.at(-1), payments: ledger })),
      count: vi.fn(async () => opts.later ?? 0),
    },
    interimBillingPayment: { create: vi.fn(async ({ data }: any) => { ledger.push(data); return data; }) },
    admission: { findUnique: vi.fn(async () => ({ patientId: 'p1' })) },
    patient: { findUnique: vi.fn(async () => ({ mrn: 'M1' })) },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
  const outbox = { enqueue: vi.fn() };
  return { svc: new InpatientService(prisma, undefined, undefined, outbox as any, undefined), prisma, writes, ledger, outbox };
}
const ROW = { id: 'ib1', admissionId: 'a1', sequenceNo: 2, status: 'GENERATED', copayAmount: 20000 };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('🔴 중간정산 수납 — 수단·처리자·원장 줄', () => {
  it('현금 — 상태 전이와 원장 줄이 한 트랜잭션 · 처리자 · ERP 페이로드에 수단', async () => {
    const m = payWith(ROW);
    await m.svc.payInterimBilling('a1', 'ib1', { method: 'CASH', cashReceiptNo: ' 123 ' }, 'u7');
    expect(m.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(m.writes[0]).toMatchObject({ status: 'PAID', paidAmount: 20000, paidBy: 'u7' });
    expect(m.ledger[0]).toMatchObject({ interimBillingId: 'ib1', method: 'CASH', amount: 20000, cashReceiptNo: '123', processedBy: 'u7' });
    await flush();
    expect(m.outbox.enqueue).toHaveBeenCalledWith('billing', 'billing.interim_paid', 'interim:paid:ib1', expect.objectContaining({ paidBy: 'u7', payments: [expect.objectContaining({ method: 'CASH', amount: 20000, processedBy: 'u7' })] }));
  });
  it('🔴 카드는 승인번호가 있어야 한다 · 원장·상태 아무것도 안 쓴다', async () => {
    const m = payWith(ROW);
    expect(await status(m.svc.payInterimBilling('a1', 'ib1', { method: 'CARD' }, 'u1'))).toEqual({ s: 400, code: 'INTERIM_CARD_APPROVAL_REQUIRED' });
    expect(m.writes).toHaveLength(0); expect(m.ledger).toHaveLength(0);
  });
  it('무효 회차는 수납하지 않는다 · 동시 변경은 원장 줄을 남기지 않는다', async () => {
    expect(await status(payWith({ ...ROW, status: 'VOID' }).svc.payInterimBilling('a1', 'ib1', { method: 'CASH' }))).toEqual({ s: 409, code: 'INTERIM_VOID' });
    const raced = payWith(ROW, { raced: true });
    expect(await status(raced.svc.payInterimBilling('a1', 'ib1', { method: 'CASH' }))).toEqual({ s: 409, code: 'INTERIM_CHANGED' });
    expect(raced.ledger).toHaveLength(0);
  });
  it('DTO — 수단 필수·어휘 밖 거부(선수금·검진권 아님) · 대조군 카드', async () => {
    const errs = async (o: object) => (await validate(plainToInstance(PayInterimBillingDto, o))).map((e) => e.property);
    expect(await errs({})).toContain('method');
    expect(await errs({ method: 'DEPOSIT' })).toContain('method');
    expect(await errs({ method: 'VOUCHER' })).toContain('method');
    expect(await errs({ method: 'CARD', cardApprovalNo: '1234' })).toEqual([]);
  });
});

describe('중간정산 무효 — 수납 전·마지막 회차·사유', () => {
  it('사유 4자 미만 400 · 수납된 회차 409 · 뒤에 살아 있는 회차가 있으면 409 · 아무것도 안 쓴다', async () => {
    const m = payWith(ROW);
    expect((await status(m.svc.voidInterimBilling('a1', 'ib1', ' 잘못 ', 'u1'))).s).toBe(400);
    expect(await status(payWith({ ...ROW, status: 'PAID' }).svc.voidInterimBilling('a1', 'ib1', '잘못 생성함', 'u1'))).toEqual({ s: 409, code: 'INTERIM_PAID_NOT_VOIDABLE' });
    const mid = payWith(ROW, { later: 1 });
    expect(await status(mid.svc.voidInterimBilling('a1', 'ib1', '잘못 생성함', 'u1'))).toEqual({ s: 409, code: 'INTERIM_NOT_LATEST' });
    expect(m.writes).toHaveLength(0); expect(mid.writes).toHaveLength(0);
  });
  it('대조군 — 무효 기록(시각·사람·사유) · 이벤트', async () => {
    const m = payWith(ROW);
    await m.svc.voidInterimBilling('a1', 'ib1', '  날짜 착오로 다시 생성  ', 'u9');
    expect(m.writes[0]).toMatchObject({ status: 'VOID', voidedBy: 'u9', voidReason: '날짜 착오로 다시 생성' });
    await flush();
    expect(m.outbox.enqueue).toHaveBeenCalledWith('billing', 'billing.interim_voided', 'interim:void:ib1', expect.objectContaining({ voidReason: '날짜 착오로 다시 생성' }));
  });
});

describe('🔴 일마감 — 중간정산 수납은 별도 칸(총계에 섞지 않는다)', () => {
  it('수단별·원장 이전 미기록 · totalRevenue 불변', async () => {
    const prisma: any = {
      billingPayment: { groupBy: vi.fn(async () => [{ method: 'CARD', _sum: { amount: 30000 }, _count: 1 }]), aggregate: vi.fn(async () => ({ _count: 0, _sum: { amount: 0 } })) },
      billing: {
        aggregate: vi.fn(async ({ where }: any) => (where.refundedAt ? { _count: 0, _sum: { refundAmount: 0 } } : where.status === 'DEFERRED' ? { _count: 0, _sum: { patientCopay: 0 } } : { _count: 1, _sum: { paidAmount: 30000 } })),
        findMany: vi.fn(async () => []), count: vi.fn(async () => 0),
      },
      interimBillingPayment: { groupBy: vi.fn(async () => [{ method: 'CASH', _sum: { amount: 20000 }, _count: 1 }, { method: 'TRANSFER', _sum: { amount: 10000 }, _count: 1 }]) },
      interimBillingRefund: { groupBy: vi.fn(async () => [{ method: 'CASH', _sum: { amount: 3000 }, _count: 1 }]) },
      interimBilling: { aggregate: vi.fn(async () => ({ _count: 1, _sum: { paidAmount: 5000 } })) },
    };
    const svc = new BillingService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const r = (await svc.getDailySummary('2026-10-22')).data as any;
    expect(r.totalRevenue).toBe(30000);
    expect(r.interimPayments).toEqual({ settledExcluded: true, count: 3, amount: 35000, byMethod: { cash: 20000, transfer: 10000 }, unledgeredCount: 1, unledgeredAmount: 5000, refundCount: 1, refundAmount: 3000, refundByMethod: { cash: 3000 } });
    // 🔴 환불은 수납 합에서 빼지 않고 따로 말한다(전표가 따로 — billing.interim_refunded)
    expect(r.byPaymentMethod.cash).toBeUndefined();
  });
});

describe('퇴원 정산·권한·이벤트 어휘', () => {
  it('퇴원 정산은 무효 회차를 읽지 않는다(구조)', () => {
    const s = readFileSync(join(SRC, 'inpatient/inpatient.service.ts'), 'utf8');
    const body = s.slice(s.indexOf('async getDischargeSettlement'), s.indexOf('async getDischargeSettlement') + 2500);
    expect(body).toMatch(/interimBilling\.findMany\(\{ where: \{ admissionId, status: \{ not: 'VOID' \} \}/);
  });
  it('원무가 만들고 수납하고 무효로 한다', () => {
    for (const m of ['generateInterimBilling', 'payInterimBilling', 'voidInterimBilling'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, InpatientController.prototype[m]), m).toContain(UserRole.RECEPTIONIST);
    }
  });
  it('포털은 무효 회차를 보이지 않는다(두 조회 모두)', () => {
    const s = readFileSync(join(SRC, 'portal/portal.service.ts'), 'utf8');
    expect(s.match(/interimBilling\.findMany\(\{\s*\/\/[^\n]*\n\s*where: \{ admissionId: admission\.id, status: \{ not: 'VOID' \} \}/g)?.length).toBe(2);
  });
});
