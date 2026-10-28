import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BillingService } from '../../src/modules/billing/billing.service';
import { IssuanceService, deriveFeeBillingLink, DOC_FEE_CODE_TYPE } from '../../src/modules/medical-record-issuance/issuance.service';

/**
 * 서류 수수료 ↔ 수납 연결(2026-10-10 · 결정 `documents.fee.billingLink`).
 *  · null(미정) = 현행 — 수납 원장에 아무것도 만들지 않는다
 *  · 'BILLING_ITEM' = 발급 완료 때(금액 확정) 그 서류 진료의 **미납** 수납에 비급여 한 줄 · 멱등
 *  · 🔴 수납을 새로 만들지 않는다(진료 단위 유니크 — 정규 청구 생성을 막는다) · 납부 진행된 수납은 바꾸지 않는다(소급 금지)
 *  · 상태는 원장에서 파생 — 라인이 있으면 설정과 무관하게 그 수납 상태
 */

function billingSvc(opts: { existing?: unknown; billing?: unknown }) {
  const created: any[] = [];
  const updated: any[] = [];
  const tx = {
    billingItem: {
      create: vi.fn(async (a: any) => { created.push(a.data); return { id: 'bi-new', ...a.data }; }),
      findMany: vi.fn(async () => [{ amount: 30000, copayRate: 0.3 }, ...created.map((c) => ({ amount: c.amount, copayRate: c.copayRate }))]),
    },
    billing: { update: vi.fn(async (a: any) => { updated.push(a.data); return a.data; }) },
  };
  const prisma: any = {
    billingItem: { findFirst: vi.fn(async () => opts.existing ?? null) },
    billing: { findUnique: vi.fn(async () => opts.billing ?? null) },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  const config = { get: vi.fn(async () => null) };
  const s = new BillingService(prisma, {} as never, {} as never, config as never, {} as never, {} as never, {} as never);
  return { s, prisma, created, updated };
}
const LINE = { codeType: DOC_FEE_CODE_TYPE, codeId: 'req-1', codeName: '제증명 수수료 · 진단서(일반) · ABCD1234', unitPrice: 20000, quantity: 1 };

describe('BillingService.addNonCoveredLine — 진료 미납 수납에만 덧붙인다', () => {
  it('미납 수납 → 비급여 한 줄(본인부담 100%) · 합계·본인부담을 전체 라인으로 다시 센다', async () => {
    const { s, created, updated } = billingSvc({ billing: { id: 'b1', status: 'PENDING', copayCategory: 'NHI', encounter: { visitType: 'OUTPATIENT' } } });
    expect(await s.addNonCoveredLine('enc-1', LINE)).toEqual({ status: 'ADDED', billingId: 'b1', billingStatus: 'PENDING' });
    expect(created[0]).toMatchObject({ billingId: 'b1', codeType: 'DOCUMENT_FEE', codeId: 'req-1', amount: 20000, copayRate: 1, insuranceCategory: 'NON_COVERED' });
    // 기존 30,000(30%) + 수수료 20,000(100%) → 합 50,000 · 본인부담 9,000 + 20,000
    expect(updated[0]).toEqual({ totalAmount: 50000, patientCopay: 29000, insuranceCovered: 21000 });
  });
  it('🔴 납부가 진행된 수납은 바꾸지 않는다(소급 금지)', async () => {
    const { s, created } = billingSvc({ billing: { id: 'b1', status: 'PAID', copayCategory: 'NHI', encounter: { visitType: 'OUTPATIENT' } } });
    expect(await s.addNonCoveredLine('enc-1', LINE)).toMatchObject({ status: 'BILLING_NOT_OPEN', billingStatus: 'PAID' });
    expect(created).toEqual([]);
  });
  it('🔴 수납이 없으면 새로 만들지 않는다', async () => {
    const { s, prisma, created } = billingSvc({});
    expect(await s.addNonCoveredLine('enc-1', LINE)).toMatchObject({ status: 'NO_BILLING', billingId: null });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });
  it('멱등 — 같은 서류 라인이 이미 있으면 그대로', async () => {
    const { s, prisma } = billingSvc({ existing: { billingId: 'b9', billing: { status: 'PAID' } }, billing: { id: 'b1', status: 'PENDING' } });
    expect(await s.addNonCoveredLine('enc-1', LINE)).toEqual({ status: 'ALREADY', billingId: 'b9', billingStatus: 'PAID' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

function issuance(opts: { mode?: string | null; req?: Record<string, unknown>; billing?: { addNonCoveredLine: ReturnType<typeof vi.fn> } }) {
  const prisma: any = {
    documentRequest: { findUnique: vi.fn(async () => ({ id: 'req-1', type: 'DIAGNOSIS_CERT', status: 'READY', fee: 20000, encounterId: 'enc-1', ...(opts.req ?? {}) })) },
    systemConfig: { findUnique: vi.fn(async () => null) },
    billingItem: { findMany: vi.fn(async () => []) },
  };
  const config = { get: vi.fn(async () => opts.mode ?? null) };
  const billing = opts.billing ?? { addNonCoveredLine: vi.fn(async () => ({ status: 'ADDED', billingId: 'b1', billingStatus: 'PENDING' })) };
  const s = new IssuanceService(prisma, {} as never, {} as never, { emit: vi.fn() } as never, {} as never, config as never, billing as never);
  return { s, prisma, billing };
}

describe('linkFeeToBilling — 설정·진료 연결이 있을 때만', () => {
  it('🔴 미설정(null)이면 수납을 건드리지 않는다(현행)', async () => {
    const { s, billing } = issuance({ mode: null });
    expect(await s.linkFeeToBilling('req-1')).toMatchObject({ attempted: false, result: 'OFF' });
    expect(billing.addNonCoveredLine).not.toHaveBeenCalled();
  });
  it('BILLING_ITEM → 그 서류 진료의 수납에 수수료 한 줄(서류 id 로 멱등)', async () => {
    const { s, billing } = issuance({ mode: 'BILLING_ITEM' });
    expect(await s.linkFeeToBilling('req-1')).toEqual({ attempted: true, result: 'ADDED', billingId: 'b1' });
    expect(billing.addNonCoveredLine).toHaveBeenCalledWith('enc-1', expect.objectContaining({ codeType: 'DOCUMENT_FEE', codeId: 'req-1', unitPrice: 20000, quantity: 1 }));
  });
  it('🔴 진료 연결 없는 서류 · 발급 전 · 수수료 0 은 시도하지 않고 이유', async () => {
    expect(await issuance({ mode: 'BILLING_ITEM', req: { encounterId: null } }).s.linkFeeToBilling('req-1')).toMatchObject({ attempted: false, result: 'NO_ENCOUNTER' });
    expect(await issuance({ mode: 'BILLING_ITEM', req: { status: 'IN_REVIEW' } }).s.linkFeeToBilling('req-1')).toMatchObject({ attempted: false, result: 'AWAITING_ISSUE' });
    expect(await issuance({ mode: 'BILLING_ITEM', req: { fee: 0 } }).s.linkFeeToBilling('req-1')).toMatchObject({ attempted: false, result: 'NO_FEE' });
  });
  it('모르는 설정 값은 연결하지 않는 쪽', async () => {
    const { s, billing } = issuance({ mode: 'YES' });
    expect((await s.linkFeeToBilling('req-1')).result).toBe('OFF');
    expect(billing.addNonCoveredLine).not.toHaveBeenCalled();
  });
});

describe('상태 파생 — 수납 원장이 정본', () => {
  const issued = { status: 'READY', fee: 20000, encounterId: 'enc-1' };
  it('🔴 라인이 있으면 설정을 꺼도 그 수납 상태(이미 올린 수납은 사실)', () => {
    expect(deriveFeeBillingLink('OFF', issued, { billingId: 'b1', billing: { status: 'PAID' } })).toMatchObject({ state: 'PAID', billingId: 'b1' });
    expect(deriveFeeBillingLink('BILLING_ITEM', issued, { billingId: 'b1', billing: { status: 'PENDING' } }).state).toBe('UNPAID');
    expect(deriveFeeBillingLink('BILLING_ITEM', issued, { billingId: 'b1', billing: { status: 'CANCELLED' } }).state).toBe('CANCELLED');
  });
  it('라인 없음 — 꺼짐 / 진료 연결 없음(접수 때부터) / 발급 전 / 발급됐는데 못 올림', () => {
    expect(deriveFeeBillingLink('OFF', issued, null).state).toBe('OFF');
    expect(deriveFeeBillingLink('BILLING_ITEM', { status: 'REQUESTED', fee: null, encounterId: null }, null).state).toBe('NO_ENCOUNTER');
    expect(deriveFeeBillingLink('BILLING_ITEM', { status: 'REQUESTED', fee: null, encounterId: 'enc-1' }, null).state).toBe('AWAITING_ISSUE');
    expect(deriveFeeBillingLink('BILLING_ITEM', issued, null).state).toBe('NOT_LINKED');
  });
  it('대기 목록은 한 번에 원장을 읽는다(서류 id · DOCUMENT_FEE)', async () => {
    const { s, prisma } = issuance({ mode: 'BILLING_ITEM' });
    prisma.billingItem.findMany.mockResolvedValueOnce([{ codeId: 'r1', billingId: 'b1', billing: { status: 'PAID' } }]);
    const m = await s.feeBillingLinks([{ id: 'r1', ...issued }, { id: 'r2', ...issued }]);
    expect(prisma.billingItem.findMany.mock.calls[0][0].where).toEqual({ codeType: 'DOCUMENT_FEE', codeId: { in: ['r1', 'r2'] } });
    expect([m.get('r1')?.state, m.get('r2')?.state]).toEqual(['PAID', 'NOT_LINKED']);
  });
});

describe('발급 — 연결 실패가 발급을 되돌리지 않고, 삼키지도 않는다', () => {
  it('🔴 수납 연결이 던져도 발급 응답에 FAILED 로 싣는다', async () => {
    const src = readFileSync(join(__dirname, '../../src/modules/medical-record-issuance/issuance.service.ts'), 'utf8');
    // 두 발급 경로(사본·증명서) 모두 자동 연결 결과를 응답에 싣는다
    expect(src.match(/const feeBilling = await this\.autoLinkFee\(/g)?.length).toBe(2);
    const billing = { addNonCoveredLine: vi.fn(async () => { throw new Error('db down'); }) };
    const { s } = issuance({ mode: 'BILLING_ITEM', billing });
    expect(await (s as any).autoLinkFee('req-1')).toEqual({ attempted: true, result: 'FAILED', billingId: null });
  });
  it('재시도 EP 는 처리 역할(클래스 @Roles)만 — 원무 창구 역할을 따로 열지 않는다', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/medical-record-issuance/staff-document.controller.ts'), 'utf8');
    const block = src.slice(src.indexOf("@Post(':id/fee-billing')"), src.indexOf("@Post(':id/reject')"));
    expect(block).toContain('linkFeeToBilling');
    expect(block).not.toContain('@Roles(');
  });
});
