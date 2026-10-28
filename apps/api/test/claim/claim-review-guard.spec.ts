/**
 * 청구 심사·제출 — 상태와 금액을 본다(2026-10-14 결함 발굴 수납·청구 P2-3).
 *  · 🔴 종전: 정본 review/submit 에 상태 가드·금액 검증이 없었다(쌍둥이 경로 insurance-claim 에는 있었다 — P12)
 *    → 제출 전(DRAFT)·지급 끝(PAID) 청구 심사 · 인정액 > 청구액·소수 · '인정'인데 삭감액 · APPROVED·PAID 를 SUBMITTED 로 덮는 제출
 *  · 🔴 화면은 인정액 칸을 비우면 0 을 보내 '인정 0 · 삭감 0'
 *  · 대조군: 제출된 청구의 인정·부분인정·반려 · 이미 심사된 청구의 재심사(정정) · 미전송 제출 재시도
 */
import { describe, it, expect, vi } from 'vitest';
import { ClaimService } from '../../src/modules/claim/claim.service';

function mk(status: string, claimData: unknown = null) {
  const writes: any[] = []; const billings: any[] = [];
  const prisma: any = {
    claim: {
      findUnique: vi.fn().mockResolvedValue({ billingId: 'b1', claimedAmount: 70000, patientId: 'p1', status, claimData, claimNumber: null }),
      updateMany: vi.fn(async ({ where, data }: any) => { if (where.status !== status) return { count: 0 }; writes.push(data); return { count: 1 }; }),
      findUniqueOrThrow: vi.fn(async () => ({ id: 'c1', ...writes.at(-1) })),
    },
    billing: { update: vi.fn(async ({ data }: any) => { billings.push(data); return {}; }) },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
  const svc = new ClaimService(prisma, { enqueue: vi.fn() } as any, { create: vi.fn() } as any);
  return { svc, writes, billings };
}
const err = async (p: Promise<unknown>) => { const e: any = await p.catch((x) => x); expect(e, '거부돼야 한다').toBeInstanceOf(Error); return e; };

describe('🔴 심사 — 상태', () => {
  it('제출 전(DRAFT)·지급 끝(PAID) 청구는 심사 결과를 기록하지 않는다 · 원장·수납 그대로', async () => {
    for (const st of ['DRAFT', 'PAID']) {
      const { svc, writes, billings } = mk(st);
      const e = await err(svc.review('c1', { reviewResult: 'APPROVED', approvedAmount: 70000 }));
      expect(e.getStatus()).toBe(409);
      expect(writes).toHaveLength(0); expect(billings).toHaveLength(0);
    }
  });
  it('대조군 — 제출된 청구 인정 · 이미 심사된 청구 재심사(정정)는 열려 있다', async () => {
    const a = mk('SUBMITTED');
    await a.svc.review('c1', { reviewResult: 'APPROVED', approvedAmount: 70000 });
    expect(a.writes[0]).toMatchObject({ status: 'APPROVED', approvedAmount: 70000, reducedAmount: 0 });
    const b = mk('PARTIALLY_APPROVED');
    await b.svc.review('c1', { reviewResult: 'PARTIALLY_APPROVED', approvedAmount: 50000 });
    expect(b.writes[0]).toMatchObject({ approvedAmount: 50000, reducedAmount: 20000 });
    expect(b.billings[0]).toMatchObject({ reviewedInsuranceAmount: 50000, insuranceReducedAmount: 20000 });
  });
});

describe('🔴 심사 — 금액', () => {
  const bad = async (body: any) => { const { svc, writes } = mk('SUBMITTED'); const e = await err(svc.review('c1', body)); expect(e.getStatus()).toBe(400); expect(writes).toHaveLength(0); };
  it('인정액 > 청구액 · 음수 · 소수 · 부분인정인데 인정액 없음 · 부분인정 = 전액', async () => {
    await bad({ reviewResult: 'PARTIALLY_APPROVED', approvedAmount: 80000 });
    await bad({ reviewResult: 'PARTIALLY_APPROVED', approvedAmount: -1 });
    await bad({ reviewResult: 'PARTIALLY_APPROVED', approvedAmount: 100.5 });
    await bad({ reviewResult: 'PARTIALLY_APPROVED' });
    await bad({ reviewResult: 'PARTIALLY_APPROVED', approvedAmount: 70000 });
  });
  it("'인정'인데 금액이 다르거나 삭감액이 남음 · 반려인데 인정액 · 삭감액 ≠ 청구 − 인정", async () => {
    await bad({ reviewResult: 'APPROVED', approvedAmount: 0 });
    await bad({ reviewResult: 'APPROVED', approvedAmount: 70000, reducedAmount: 5000 });
    await bad({ reviewResult: 'REJECTED', approvedAmount: 1000 });
    await bad({ reviewResult: 'PARTIALLY_APPROVED', approvedAmount: 50000, reducedAmount: 10000 });
  });
  it('대조군 — 반려는 인정 0 · 삭감 = 청구액', async () => {
    const { svc, writes } = mk('UNDER_REVIEW');
    await svc.review('c1', { reviewResult: 'REJECTED', approvedAmount: 0, rejectReason: '코드 오류' });
    expect(writes[0]).toMatchObject({ status: 'REJECTED', approvedAmount: 0, reducedAmount: 70000 });
  });
});

describe('🔴 제출 — 상태', () => {
  it('심사·지급 끝난 청구(APPROVED·PAID)·전송된 제출 건은 다시 제출하지 않는다', async () => {
    for (const [st, data] of [['APPROVED', null], ['PAID', null], ['SUBMITTED', { transmission: { outcome: 'SENT' } }]] as const) {
      const { svc, writes } = mk(st, data);
      const e = await err(svc.submit('c1'));
      expect(e.getStatus()).toBe(409);
      expect(writes).toHaveLength(0);
    }
  });
  it('대조군 — 작성 중 제출 · 나가지 않은 제출의 재시도', async () => {
    const a = mk('DRAFT');
    await a.svc.submit('c1');
    expect(a.writes[0]).toMatchObject({ status: 'SUBMITTED' });
    const b = mk('SUBMITTED', { transmission: { outcome: 'NOT_TRANSMITTED' } });
    await b.svc.submit('c1');
    expect(b.writes).toHaveLength(1);
  });
});
