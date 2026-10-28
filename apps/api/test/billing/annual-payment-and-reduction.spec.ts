/**
 * 원무 의료비 납입확인서·경영 삭감률(2026-10-14 결함 발굴 수납·청구 P4-5 · P4-4).
 *  · 🔴 납입확인서: 직원 화면이 환자 포털 EP 를 불러 늘 401 · 응답 모양이 서식과 달라 칸 0 →
 *    원무 EP(환자 지정) · 월별 외래/입원 낸 돈(포털 연말정산과 같은 정본) · 입원 일수는 원장으로 몰라 null
 *  · 🔴 삭감률: 분모에 작성 중·미심사 청구액까지 넣어 실제보다 낮게 → 심사가 끝난 청구만
 */
import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { BillingService } from '../../src/modules/billing/billing.service';
import { BillingController } from '../../src/modules/billing/billing.controller';
import { ExecutiveService } from '../../src/modules/executive/executive.service';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

describe('🔴 의료비 납입확인서(원무)', () => {
  const prisma: any = {
    billingPayment: {
      findMany: vi.fn(async (args: any) => (args.distinct
        ? [{ billingId: 'opd' }, { billingId: 'ipd' }]
        : [
          { billingId: 'opd', amount: 5000, createdAt: new Date('2026-03-10T03:00:00Z') },
          { billingId: 'opd', amount: -1000, createdAt: new Date('2026-03-20T03:00:00Z') },
          { billingId: 'ipd', amount: 200000, createdAt: new Date('2026-05-02T03:00:00Z') },
        ])),
    },
    billing: {
      findMany: vi.fn(async ({ where }: any) => (where?.id?.in
        ? [{ id: 'opd', encounter: { visitType: 'OUTPATIENT' } }, { id: 'ipd', encounter: { visitType: 'INPATIENT' } }]
        : [])),
    },
  };
  const svc = new BillingService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  it('월별 외래·입원 낸 돈(환불 차감) · 입원 일수는 null(지어내지 않음)', async () => {
    const r: any = await svc.getAnnualPaymentStatement('p1', 2026);
    expect(r.monthly[2]).toMatchObject({ month: 3, outpatientCount: 1, outpatientAmount: 4000, inpatientAmount: 0, inpatientDays: null });
    expect(r.monthly[4]).toMatchObject({ month: 5, inpatientAmount: 200000, inpatientCount: 1, inpatientDays: null });
    expect(r.total).toBe(204000);
    expect(r.inpatientDaysKnown).toBe(false);
  });
  it('연도 형식 오류는 400 · 원무·간호·관리자 역할', async () => {
    await expect(svc.getAnnualPaymentStatement('p1', 99)).rejects.toThrow();
    const roles = Reflect.getMetadata(ROLES_KEY, BillingController.prototype.getAnnualPaymentStatement);
    expect(roles).toEqual(expect.arrayContaining([UserRole.RECEPTIONIST, UserRole.NURSE, UserRole.ADMIN]));
  });
});

describe('🔴 경영 삭감률 — 분모는 심사가 끝난 청구', () => {
  it('작성 중·제출(미심사) 청구액은 분모에 넣지 않는다 · 심사 0건이면 산출 불가', async () => {
    const mk = (claims: any[]) => new ExecutiveService({ claim: { findMany: vi.fn().mockResolvedValue(claims) } } as any);
    const r: any = await mk([
      { status: 'DRAFT', claimedAmount: 1_000_000, reducedAmount: null },
      { status: 'SUBMITTED', claimedAmount: 1_000_000, reducedAmount: null },
      { status: 'PARTIALLY_APPROVED', claimedAmount: 100_000, reducedAmount: 10_000 },
      { status: 'APPROVED', claimedAmount: 100_000, reducedAmount: 0 },
    ]).getClaimsSummary();
    expect(r.reductionRatePct).toEqual({ value: 5, n: 2 });
    const z: any = await mk([{ status: 'SUBMITTED', claimedAmount: 1000, reducedAmount: null }]).getClaimsSummary();
    expect(z.reductionRatePct.value).toBeNull();
    expect(z.note).toContain('심사가 끝난 청구 0건');
  });
});
