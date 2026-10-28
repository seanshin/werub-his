/**
 * 낸 돈 증빙 — 연말정산 의료비·실손 영수증(2026-10-14 결함 발굴 수납·청구 P2-5).
 *  · 🔴 종전 연말정산: 완납(PAID) 청구만·완납일에·납부액 그대로 → 부분 납부·분납 회차 누락, 부분 환불 미차감,
 *    연간 요약은 `paidAmount ?? patientCopay`(안 낸 본인부담을 낸 돈처럼)·연 경계 로컬 자정
 *  · 🔴 종전 실손 서류: 취소만 빼고 미납·전액 환불 청구도 영수증 동봉 · 첫 발급 금액을 환불 뒤에도 재사용
 *  · 대조군: 원장 줄 없는 옛 수납은 완납일 납부액 · 그대로인 영수증은 재사용
 */
import { describe, it, expect, vi } from 'vitest';
import { PortalService } from '../../src/modules/portal/portal.service';
import { DocumentBundleService } from '../../src/modules/medical-record-issuance/document-bundle.service';

function portal(lines: any[], legacy: any[], linesBillingIds: string[] = lines.map((l) => l.billingId)) {
  const prisma: any = {
    billingPayment: {
      findMany: vi.fn(async (args: any) => (args.distinct ? [...new Set(linesBillingIds)].map((billingId) => ({ billingId })) : lines.filter((l) => l.method !== args.where?.method?.not))),
    },
    billing: {
      findMany: vi.fn(async ({ where }: any) => (where?.id?.in
        ? where.id.in.map((id: string) => ({ id, totalAmount: 30000, insuranceCovered: 20000, patientCopay: 10000 }))
        : legacy.filter((b) => !where.id.notIn.includes(b.id)))),
    },
  };
  const svc = Object.create(PortalService.prototype) as any;
  svc.prisma = prisma;
  return { svc, prisma };
}

describe('🔴 연말정산 의료비 — 돈이 오간 날에, 오간 만큼', () => {
  it('부분 납부 줄·회차 줄을 세고 환불 줄은 뺀다(완납 여부와 무관)', async () => {
    const { svc } = portal([
      { billingId: 'b1', amount: 5000, createdAt: new Date('2026-03-10T03:00:00Z'), method: 'CARD' },
      { billingId: 'b1', amount: 3000, createdAt: new Date('2026-04-10T03:00:00Z'), method: 'CASH' },
      { billingId: 'b1', amount: -2000, createdAt: new Date('2026-05-10T03:00:00Z'), method: 'REFUND' },
    ], []);
    const r = await svc.getMedicalExpenses('p1', 2026);
    expect(r.summary.paid).toBe(6000);
    expect(r.monthly.map((m: any) => [m.month, m.paid])).toEqual([[3, 5000], [4, 3000], [5, -2000]]);
    const a = await svc.getAnnualBillingSummary('p1', 2026);
    expect(a.totalCopay).toBe(6000);
  });
  it('🔴 연간 요약은 안 낸 본인부담을 낸 돈으로 세지 않는다 · 검진권 충당은 환자 돈이 아니다', async () => {
    const { svc } = portal([{ billingId: 'b1', amount: 30000, createdAt: new Date('2026-03-10T03:00:00Z'), method: 'VOUCHER' }], [], ['b1']);
    const a = await svc.getAnnualBillingSummary('p1', 2026);
    expect(a.totalCopay).toBe(0);
  });
  it('대조군 — 원장 줄 없는 옛 수납은 완납일 납부액 · 옛 환불은 환불일에 −', async () => {
    const { svc } = portal([], [
      { id: 'L1', paidAmount: 10000, paidAt: new Date('2026-02-01T03:00:00Z'), refundAmount: 4000, refundedAt: new Date('2026-06-01T03:00:00Z') },
    ]);
    const r = await svc.getMedicalExpenses('p1', 2026);
    expect(r.summary.paid).toBe(6000);
    expect(r.monthly.map((m: any) => m.month)).toEqual([2, 6]);
  });
});

describe('🔴 실손 서류 영수증 — 받은 돈이 있을 때만 · 바뀐 금액은 새로 발급', () => {
  const bundle = (existing: any) => {
    const prisma: any = {
      issuedDocument: { findFirst: vi.fn().mockResolvedValue(existing) },
      patient: { findUnique: vi.fn().mockResolvedValue({ mrn: 'M1', familyName: '홍', givenName: '길동' }) },
    };
    const documents = { issue: vi.fn().mockResolvedValue({ issueNo: 'NEW' }) };
    const svc = Object.create(DocumentBundleService.prototype) as any;
    svc.prisma = prisma; svc.documents = documents;
    return { svc, documents };
  };
  const B = { id: 'b1', createdAt: new Date(), status: 'PAID', totalAmount: 30000, insuranceCovered: 20000, patientCopay: 10000, discountAmount: 0, paidAmount: 10000, refundAmount: null, receiptNo: null, copayCategory: null, eligibilityStatus: null, encounter: null };
  it('🔴 첫 발급 뒤 환불되면 옛 사본을 재사용하지 않고 환불이 담긴 판을 새로 발급', async () => {
    const { svc, documents } = bundle({ issueNo: 'OLD', snapshotJson: { paidAmount: 10000, refundAmount: null, discountAmount: 0, status: 'PAID' } });
    const no = await svc.issueReceiptIdempotent('p1', { ...B, refundAmount: 4000 });
    expect(no).toBe('NEW');
    expect(documents.issue.mock.calls[0][0].snapshot).toMatchObject({ refundAmount: 4000, paidAmount: 10000 });
  });
  it('대조군 — 금액이 그대로면 재사용', async () => {
    const { svc, documents } = bundle({ issueNo: 'OLD', snapshotJson: { paidAmount: 10000, refundAmount: null, discountAmount: 0, status: 'PAID' } });
    expect(await svc.issueReceiptIdempotent('p1', B)).toBe('OLD');
    expect(documents.issue).not.toHaveBeenCalled();
  });
  it('구조 — 동봉 전 받은 돈(납부 − 환불)을 본다', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/modules/medical-record-issuance/document-bundle.service.ts', 'utf8');
    expect(src).toMatch(/const received = \(b\.paidAmount \?\? 0\) - \(b\.refundAmount \?\? 0\);\s*if \(received <= 0\)/);
  });
});
