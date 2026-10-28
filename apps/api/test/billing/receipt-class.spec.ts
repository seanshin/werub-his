/**
 * 영수증 법정 항목은 서버가 라인마다 정한다(2026-10-14 결함 발굴 수납·청구 P2-1).
 *  · 🔴 종전: 진찰료(AA157·AA257)·입원료 라인이 `PROCEDURE` 로 저장돼 ⑨ 처치·수술료 칸으로 갔고,
 *    빈 ① 진찰료 칸에 영수증이 15,000원을 지어 넣었다
 *  · 진찰료 = 서버가 고른 코드 · 입원료 = 입원료 청구가 쓰는 같은 설정(병상 등급 매핑 + 기본 코드)
 *  · 수가 분류 칸은 서식 항목과 **이름이 정확히 같을 때만** · 맞는 칸이 없으면 null(분류 미등재)
 *  · 대조군: 종전 codeType 분류(LAB·IMAGING·MEDICATION·분류 없는 PROCEDURE)는 그대로
 */
import { describe, it, expect, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';
import { receiptClassOf, CONSULTATION_FEE_CODES_BY_GRADE } from '@hospital-run/shared';

const PROCS = [
  { id: 'pc-consult', code: CONSULTATION_FEE_CODES_BY_GRADE.CLINIC.initial, category: null },
  // 옛 청구(종별과 무관하게 상급종합 코드로 만든 것)도 ① 진찰료로 안다 — 분류는 종별 코드 전부를 본다
  { id: 'pc-consult-legacy', code: 'AA257', category: null },
  { id: 'pc-stay', code: 'AB220', category: null },
  { id: 'pc-stay-default', code: 'AB1A0100', category: null },
  { id: 'pc-anes', code: 'L0101', category: '마취료' },
  { id: 'pc-similar', code: 'M0001', category: '처치료' }, // 비슷하지만 서식 이름이 아니다
  { id: 'pc-plain', code: 'M0002', category: null },
];

function mk(items: { codeType: string; codeId: string }[]) {
  const prisma: any = {
    billing: { findUnique: vi.fn().mockResolvedValue({ id: 'b1', items: items.map((i, n) => ({ id: `i${n}`, codeName: 'x', amount: 1000, insuranceCategory: 'COVERED', fullCopay: false, ...i })) }) },
    procedureCode: { findMany: vi.fn(async ({ where }: any) => PROCS.filter((p) => where.id.in.includes(p.id))) },
  };
  const config = { get: vi.fn(async (k: string) => (k === 'inpatient.bedRateCodes' ? { GENERAL: 'AB220' } : k === 'inpatient.stayBilling.defaultCode' ? null : null)) };
  const svc = new BillingService(prisma, {} as any, {} as any, config as any, {} as any, {} as any, {} as any);
  return { svc, prisma };
}

describe('🔴 영수증 법정 항목 — 서버가 라인마다 정한다', () => {
  it('진찰료·입원료(PROCEDURE 로 저장)는 ①·② 로 · 분류 칸이 서식 이름이면 그 칸', async () => {
    const { svc } = mk([
      { codeType: 'PROCEDURE', codeId: 'pc-consult' },
      { codeType: 'PROCEDURE', codeId: 'pc-consult-legacy' },
      { codeType: 'PROCEDURE', codeId: 'pc-stay' },
      { codeType: 'PROCEDURE', codeId: 'pc-stay-default' },
      { codeType: 'PROCEDURE', codeId: 'pc-anes' },
    ]);
    const b: any = await svc.findById('b1');
    expect(b.items.map((i: any) => i.receiptClass)).toEqual(['CONSULTATION', 'CONSULTATION', 'ADMISSION', 'ADMISSION', 'ANESTHESIA']);
  });

  it('비슷한 이름은 짐작하지 않는다 · 모르는 codeType 은 null(분류 미등재)', async () => {
    const { svc } = mk([
      { codeType: 'PROCEDURE', codeId: 'pc-similar' },
      { codeType: 'SOMETHING_ELSE', codeId: 'x' },
    ]);
    const b: any = await svc.findById('b1');
    expect(b.items.map((i: any) => i.receiptClass)).toEqual(['PROCEDURE', null]);
  });

  it('대조군 — codeType 분류는 그대로(LAB·IMAGING·MEDICATION·분류 없는 PROCEDURE) · 수가 코드 조회는 PROCEDURE 만', async () => {
    const { svc, prisma } = mk([
      { codeType: 'LAB', codeId: 'l1' },
      { codeType: 'IMAGING', codeId: 'm1' },
      { codeType: 'MEDICATION', codeId: 'd1' },
      { codeType: 'CONSULTATION', codeId: 'c1' },
      { codeType: 'PROCEDURE', codeId: 'pc-plain' },
    ]);
    const b: any = await svc.findById('b1');
    expect(b.items.map((i: any) => i.receiptClass)).toEqual(['LAB', 'IMAGING', 'MEDICATION', 'CONSULTATION', 'PROCEDURE']);
    expect(prisma.procedureCode.findMany.mock.calls[0][0].where.id.in).toEqual(['pc-plain']);
  });

  it('정본 함수 — 역할 > 분류 칸 > codeType', () => {
    expect(receiptClassOf({ codeType: 'LAB', role: 'CONSULTATION_FEE' })).toBe('CONSULTATION');
    expect(receiptClassOf({ codeType: 'PROCEDURE', procedureCategory: ' 검사료 ' })).toBe('LAB');
    expect(receiptClassOf({ codeType: 'PROCEDURE', procedureCategory: '알 수 없음' })).toBe('PROCEDURE');
    expect(receiptClassOf({ codeType: null })).toBeNull();
  });
});
