/**
 * 옆문 `/api/v1/insurance-claims` — 정본 `/claims` 와 같은 사람·같은 규칙(2026-10-14 결함 발굴 수납·청구 P2-4).
 *  · 🔴 종전: `BILLING_EDIT` 만 보아 간호사·원무가 심사·지급·청구 데이터 교체 · 부르는 화면 0
 *  · 🔴 종전: 모르는 action → 반려 · 반려는 인정 0 을 못 적음(@IsPositive) · 0·음수 지급 PAID ·
 *    claimData 통째 교체(전송 기록 소실) · 미수납·자비·산재 수납도 청구 생성
 *  · 대조군: 관리자 · 정상 심사·지급·데이터 병합 · 수납 완료 건강보험 청구 생성
 */
import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UserRole } from '@prisma/client';
import { InsuranceClaimController } from '../../src/modules/insurance-claim/insurance-claim.controller';
import { InsuranceClaimService } from '../../src/modules/insurance-claim/insurance-claim.service';
import { ReviewClaimDto, RecordPaymentDto } from '../../src/modules/insurance-claim/dto/claim.dto';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

const errs = (cls: any, body: any) => validateSync(plainToInstance(cls, body)).map((e) => e.property);

describe('🔴 역할 — 정본과 같은 관리자 전용', () => {
  it('컨트롤러 전체가 ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, InsuranceClaimController)).toEqual([UserRole.ADMIN]);
  });
});

describe('🔴 DTO', () => {
  it('모르는 action 거부 · 반려 인정 0 허용 · 지급 0·음수·소수 거부', () => {
    expect(errs(ReviewClaimDto, { action: 'APPROVE', approvedAmount: 1 })).toContain('action');
    expect(errs(ReviewClaimDto, { action: 'reject', approvedAmount: 0 })).toEqual([]);
    for (const v of [0, -1, 1.5]) expect(errs(RecordPaymentDto, { paidAmount: v })).toContain('paidAmount');
    expect(errs(RecordPaymentDto, { paidAmount: 1000 })).toEqual([]);
  });
});

function mk(claim: any, billing?: any) {
  const prisma: any = {
    claim: {
      findUnique: vi.fn().mockResolvedValue(claim),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(async ({ data }: any) => ({ id: 'c1', ...data })),
      create: vi.fn(async ({ data }: any) => ({ id: 'c-new', ...data })),
    },
    billing: { findUnique: vi.fn().mockResolvedValue(billing), update: vi.fn(async () => ({})) },
    procedureCode: { findMany: vi.fn().mockResolvedValue([{ id: 'p1', code: 'AA157' }]) },
    medicationCode: { findMany: vi.fn().mockResolvedValue([]) },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  prisma.$transaction = vi.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
  return { svc: new InsuranceClaimService(prisma, { enqueue: vi.fn() } as any), prisma };
}
const status = async (p: Promise<unknown>) => { const e: any = await p.catch((x) => x); expect(e, '거부돼야 한다').toBeInstanceOf(Error); return e.getStatus(); };

describe('🔴 서비스 규칙', () => {
  const SUB = { id: 'c1', status: 'SUBMITTED', claimedAmount: 70000, billingId: 'b1', claimData: null };
  it('반려에 인정액 · 전액 인정인데 금액 다름 · 부분인정 = 전액 → 400 · 대조군 반려 0 은 기록', async () => {
    expect(await status(mk(SUB).svc.review('c1', 'reject', 1000))).toBe(400);
    expect(await status(mk(SUB).svc.review('c1', 'approve', 60000))).toBe(400);
    expect(await status(mk(SUB).svc.review('c1', 'partial_approve', 70000))).toBe(400);
    const ok = mk(SUB);
    await ok.svc.review('c1', 'reject', 0, '코드 오류');
    expect(ok.prisma.claim.update.mock.calls[0][0].data).toMatchObject({ status: 'REJECTED', approvedAmount: 0 });
  });
  it('지급 0 거부 · 대조군 인정액 이하 지급', async () => {
    const APPR = { ...SUB, status: 'APPROVED', approvedAmount: 70000 };
    expect(await status(mk(APPR).svc.recordPayment('c1', 0))).toBe(400);
    const ok = mk(APPR);
    await ok.svc.recordPayment('c1', 70000);
    expect(ok.prisma.claim.update.mock.calls[0][0].data).toMatchObject({ status: 'PAID', paidAmount: 70000 });
  });
  it('🔴 claimData 는 병합 — 전송 기록·생성 근거를 지우지 않고, 보낸 transmission 은 무시', async () => {
    const { svc, prisma } = mk({ ...SUB, claimData: { reason: '외래', transmission: { outcome: 'NOT_TRANSMITTED' } } });
    await svc.updateClaimData('c1', { note: 'x', transmission: { outcome: 'SENT' } });
    expect(prisma.claim.update.mock.calls[0][0].data.claimData).toEqual({ reason: '외래', note: 'x', transmission: { outcome: 'NOT_TRANSMITTED' } });
  });
  it('🔴 청구 생성 — 미수납·자비·산재는 409 · 대조군 수납 완료 건강보험은 정본 청구 데이터로', async () => {
    const B = (over: any) => ({ id: 'b1', patientId: 'pt', status: 'PAID', totalAmount: 30000, insuranceCovered: 21000, patientCopay: 9000, patient: { insuranceType: 'NHI' }, encounter: { createdAt: new Date(2026, 9, 13, 11) }, items: [{ codeId: 'p1', codeName: '진찰', amount: 30000, quantity: 1 }], ...over });
    expect(await status(mk(null, B({ status: 'PENDING' })).svc.create('b1'))).toBe(409);
    expect(await status(mk(null, B({ patient: { insuranceType: 'SELF_PAY' } })).svc.create('b1'))).toBe(409);
    expect(await status(mk(null, B({ patient: { insuranceType: 'INDUSTRIAL' } })).svc.create('b1'))).toBe(409);
    const ok = mk(null, B({}));
    await ok.svc.create('b1', '재청구');
    expect(ok.prisma.claim.create.mock.calls[0][0].data.claimData).toMatchObject({ payerType: 'NHI', serviceDate: '2026-10-13', totalAmount: 30000, items: [{ code: 'AA157' }], reason: '재청구' });
  });
});
