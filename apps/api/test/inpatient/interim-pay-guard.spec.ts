/**
 * 입원 중간정산 수납(2026-10-14 결함 발굴 수납·청구 P3-2).
 *  · 🔴 종전: 금액을 화면 값 그대로 — 0·음수·소수·본인부담과 다른 금액도 PAID · 상태 조건 없이 덮어씀 · 원무(RECEPTIONIST) 권한 없음
 *  · 이제: 본인부담 전액만(부분 납부를 담을 상태가 없다) · 받을 돈 0 이면 수납 아님 · 상태 조건부 · 원무 포함
 *  · 2026-10-22 수단·처리자·수납 원장 줄·일마감 별도 칸 — test/inpatient/interim-ledger-v2.spec.ts
 */
import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';
import { InpatientController } from '../../src/modules/inpatient/inpatient.controller';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

function mk(row: any, raced = false) {
  const writes: any[] = [];
  const prisma: any = {
    interimBilling: {
      findFirst: vi.fn().mockResolvedValue(row),
      updateMany: vi.fn(async ({ where, data }: any) => { if (raced || where.status !== row.status) return { count: 0 }; writes.push(data); return { count: 1 }; }),
      findUniqueOrThrow: vi.fn(async () => ({ ...row, ...writes.at(-1), payments: [] })),
    },
    interimBillingPayment: { create: vi.fn(async ({ data }: any) => { writes.push({ ledger: data }); return data; }) },
    admission: { findUnique: vi.fn().mockResolvedValue({ patientId: 'p1' }) },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
  return { svc: new InpatientService(prisma, undefined, { get: vi.fn(async () => null) } as any, undefined), writes };
}
const ROW = { id: 'ib1', admissionId: 'a1', status: 'GENERATED', copayAmount: 20000 };
const st = async (p: Promise<unknown>) => { const e: any = await p.catch((x) => x); expect(e, '거부돼야 한다').toBeInstanceOf(Error); return e.getStatus(); };

describe('🔴 중간정산 수납', () => {
  it('본인부담과 다른 금액·소수 → 400 · 받을 돈 0 → 409 · 아무것도 쓰지 않는다', async () => {
    for (const a of [1, 19999, 20001, 20000.5]) { const m = mk(ROW); expect(await st(m.svc.payInterimBilling('a1', 'ib1', { method: 'CASH', amount: a }))).toBe(400); expect(m.writes).toHaveLength(0); }
    const z = mk({ ...ROW, copayAmount: 0 });
    expect(await st(z.svc.payInterimBilling('a1', 'ib1', { method: 'CASH' }))).toBe(409);
  });
  it('동시 처리로 상태가 바뀌었으면 409', async () => {
    expect(await st(mk(ROW, true).svc.payInterimBilling('a1', 'ib1', { method: 'CASH', amount: 20000 }))).toBe(409);
  });
  it('대조군 — 본인부담 전액(또는 금액 생략)은 PAID', async () => {
    const m = mk(ROW);
    await m.svc.payInterimBilling('a1', 'ib1', { method: 'CASH' });
    expect(m.writes[0]).toMatchObject({ status: 'PAID', paidAmount: 20000 });
  });
  it('원무(RECEPTIONIST)도 수납한다', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, InpatientController.prototype.payInterimBilling);
    expect(roles).toContain(UserRole.RECEPTIONIST);
  });
});
