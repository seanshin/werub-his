/**
 * 청구 파일(EDI·XML)에 싣는 사실(2026-10-14 결함 발굴 수납·청구 P2-2).
 *  · 🔴 종전: 보험유형 = `billing.insuranceType || 'NHI'` — Billing 에 그 칸이 없어 **늘 NHI**(의료급여 분기 도달 0)
 *    → 테스트는 스키마에 없는 `billing.insuranceType` 을 목에 넣어 통과했다
 *  · 🔴 종전: 산재·자동차보험도 건강보험 청구로 생성 · 항목 `<코드>` = 내부 UUID · `<진료일>` = 청구 생성일
 *  · 이제: 청구 만들 때 보험유형·진료일·마스터 코드를 남긴다 · 옛 청구는 원장에서 다시 읽는다 ·
 *    모르는 것은 지어내지 않고 422 · 명세서 경로(hira-edi)도 UUID 폴백 대신 거부
 */
import { describe, it, expect, vi } from 'vitest';
import { ClaimService } from '../../src/modules/claim/claim.service';
import { HiraEdiService } from '../../src/modules/hira-edi/hira-edi.service';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function mkPrisma(over: Record<string, any> = {}) {
  const prisma: any = {
    claim: { findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0), create: vi.fn(async ({ data }: any) => ({ id: 'c-new', ...data })) },
    billing: { findMany: vi.fn().mockResolvedValue([]) },
    procedureCode: { findMany: vi.fn(async ({ where }: any) => [{ id: UUID_A, code: 'AA157' }].filter((p) => where.id.in.includes(p.id))) },
    medicationCode: { findMany: vi.fn(async ({ where }: any) => [{ id: UUID_B, code: 'MED1', insuranceCode: '641100010' }].filter((p) => where.id.in.includes(p.id))) },
    systemConfig: { findMany: vi.fn(async () => [{ key: 'hospital.code', value: '99887766' }, { key: 'hospital.name', value: '위루비병원' }]) },
    patientJourneyEvent: { create: vi.fn().mockResolvedValue({}) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    ...over,
  };
  prisma.$transaction = vi.fn((fn: any) => fn(prisma));
  return prisma;
}
const svcOf = (prisma: any) => new ClaimService(prisma, { enqueue: vi.fn() } as any, { create: vi.fn() } as any);
const bill = (insuranceType: string, id = 'b1') => ({
  id, patientId: 'p1', totalAmount: 30000, insuranceCovered: 21000, patientCopay: 9000,
  patient: { id: 'p1', insuranceType },
  encounter: { createdAt: new Date(2026, 9, 13, 11, 0) }, // 로컬 10월 13일 11시
  items: [{ codeId: UUID_A, codeName: '초진 진찰료', amount: 20000, quantity: 1, unitPrice: 20000, insuranceCategory: 'COVERED' }, { codeId: UUID_B, codeName: '아목시실린', amount: 10000, quantity: 1, unitPrice: 10000, insuranceCategory: 'COVERED' }],
});
const claimRow = (claimData: Record<string, unknown>, patientType: string | null = 'NHI') => ({
  id: 'c1', claimNumber: 'CLM-1', claimDate: new Date(2026, 10, 2), claimedAmount: 21000, claimData,
  patient: { mrn: 'M1', familyName: '홍', givenName: '길동', insuranceNumber: null, insuranceType: patientType },
  billing: { items: [], encounter: { createdAt: new Date(2026, 9, 13, 11, 0) } },
});
const err = async (p: Promise<unknown>) => { const e: any = await p.catch((x) => x); expect(e, '거부돼야 한다').toBeInstanceOf(Error); return e.getResponse?.(); };

describe('🔴 청구 생성 — 보험유형·진료일·마스터 코드를 남긴다', () => {
  it('의료급여는 MEDICAID 로 · 진료일 = 진료 날짜 · 코드 = 수가·약가 마스터(UUID 아님)', async () => {
    const prisma = mkPrisma({ billing: { findMany: vi.fn().mockResolvedValue([bill('MEDICAID')]) } });
    await svcOf(prisma).generateClaims();
    const data = prisma.claim.create.mock.calls[0][0].data.claimData;
    expect(data.payerType).toBe('MEDICAID');
    expect(data.serviceDate).toBe('2026-10-13');
    expect(data.items.map((i: any) => i.code)).toEqual(['AA157', '641100010']);
  });
  it('산재·자동차보험은 이 청구로 만들지 않고 센다 · 대조군 건강보험은 만든다', async () => {
    const prisma = mkPrisma({ billing: { findMany: vi.fn().mockResolvedValue([bill('INDUSTRIAL', 'b1'), bill('AUTO', 'b2'), bill('NHI', 'b3')]) } });
    const r: any = await svcOf(prisma).generateClaims();
    expect(r.excludedOtherPayer).toBe(2);
    expect(r.generated).toBe(1);
    expect(prisma.claim.create.mock.calls[0][0].data.billingId).toBe('b3');
  });
});

describe('🔴 청구 파일 — 지어내지 않는다', () => {
  it('의료급여 청구 EDI 헤더 = 청구구분 2 · MEDICAID (종전엔 늘 1 · NHI)', async () => {
    const prisma = mkPrisma();
    prisma.claim.findUnique.mockResolvedValue(claimRow({ payerType: 'MEDICAID', serviceDate: '2026-10-13', items: [{ code: 'AA157', codeId: UUID_A, name: '진찰', amount: 1, quantity: 1 }] }));
    const edi = await svcOf(prisma).generateEdi('c1');
    const h = edi.split('\n')[0].split('|');
    expect(h[3]).toBe('2'); expect(h[6]).toBe('MEDICAID');
  });
  it('옛 청구(code 칸에 UUID) → codeId 로 마스터 코드 재해석 · XML 진료일 = 진료일(청구 생성일 아님)', async () => {
    const prisma = mkPrisma();
    prisma.claim.findUnique.mockResolvedValue(claimRow({ items: [{ code: UUID_A, name: '진찰', amount: 1, quantity: 1 }] }));
    const xml = await svcOf(prisma).generateHiraXml('c1');
    expect(xml).toContain('<코드>AA157</코드>');
    expect(xml).not.toContain(UUID_A);
    expect(xml).toContain('<진료일>2026-10-13</진료일>');
    expect(xml).toContain('<보험유형>NHI</보험유형>');
  });
  it('마스터에 없는 코드 → 422(어느 항목인지) · 보험유형 모름 → 422 · 산재 청구 파일 → 422', async () => {
    const p1 = mkPrisma();
    p1.claim.findUnique.mockResolvedValue(claimRow({ items: [{ code: '99999999-9999-4999-8999-999999999999', name: '모르는 처치', amount: 1, quantity: 1 }] }));
    expect(await err(svcOf(p1).generateEdi('c1'))).toMatchObject({ code: 'CLAIM_FILE_FACT_MISSING', details: { unresolved: ['모르는 처치'] } });
    const p2 = mkPrisma();
    p2.claim.findUnique.mockResolvedValue(claimRow({ items: [{ code: 'AA157', name: '진찰', amount: 1, quantity: 1 }] }, null));
    expect(await err(svcOf(p2).generateHiraXml('c1'))).toMatchObject({ details: { missing: ['보험유형'] } });
    const p3 = mkPrisma();
    p3.claim.findUnique.mockResolvedValue(claimRow({ payerType: 'INDUSTRIAL', serviceDate: '2026-10-13', items: [] }));
    expect(await err(svcOf(p3).generateEdi('c1'))).toMatchObject({ code: 'CLAIM_OTHER_PAYER' });
  });
});

describe('🔴 명세서 경로(hira-edi) — 못 찾은 코드를 UUID 로 싣지 않는다', () => {
  it('마스터에 없는 항목이 있으면 422 · 명세서를 만들지 않는다', async () => {
    const prisma: any = {
      claim: { findUnique: vi.fn().mockResolvedValue({ id: 'c1', patient: { id: 'p1', insuranceType: 'NHI' }, billing: { id: 'b1', totalAmount: 1, insuranceCovered: 1, patientCopay: 0, items: [{ codeType: 'PROCEDURE', codeId: 'unknown-id', codeName: '모르는 처치', quantity: 1, unitPrice: 1, amount: 1 }], encounter: { id: 'e1', visitType: 'OUTPATIENT', admissionId: null, createdAt: new Date(), doctor: null } } }) },
      procedureCode: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCode: { findMany: vi.fn().mockResolvedValue([]) },
      hiraClaimDocument: { create: vi.fn() },
    };
    const e: any = await new HiraEdiService(prisma).generateDocument('c1', 'u1').catch((x) => x);
    expect(e.getResponse()).toMatchObject({ code: 'EDI_CODE_UNRESOLVED', details: { unresolved: ['모르는 처치'] } });
    expect(prisma.hiraClaimDocument.create).not.toHaveBeenCalled();
  });
});

describe('🔴 입원 명세서(hira-edi P2-6) — 수납 완료만 · 같은 입원은 한 번', () => {
  const mkInpt = (dup: unknown) => {
    const prisma: any = {
      claim: { findUnique: vi.fn().mockResolvedValue({ id: 'c2', patient: { id: 'p1', mrn: 'M', familyName: '홍', givenName: '길동', insuranceType: 'NHI', insuranceNumber: null }, billing: { id: 'b2', totalAmount: 1, insuranceCovered: 1, patientCopay: 0, items: [], encounter: { id: 'e2', visitType: 'INPATIENT', admissionId: 'a1', createdAt: new Date(), doctor: null } } }) },
      admission: { findUnique: vi.fn().mockResolvedValue({ admitDate: new Date('2026-10-01'), dischargeDate: new Date('2026-10-05') }) },
      encounter: { findMany: vi.fn().mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]) },
      billing: { findMany: vi.fn().mockResolvedValue([]) },
      hiraClaimDocument: { findFirst: vi.fn().mockResolvedValue(dup), create: vi.fn() },
      procedureCode: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCode: { findMany: vi.fn().mockResolvedValue([]) },
    };
    return prisma;
  };
  it('같은 입원의 다른 청구로 만든 명세서가 있으면 409 · 수납 조회는 PAID 만', async () => {
    const prisma = mkInpt({ id: 'd1', claimId: 'c1' });
    const e: any = await new HiraEdiService(prisma).generateDocument('c2', 'u1').catch((x) => x);
    expect(e.getResponse()).toMatchObject({ code: 'EDI_ADMISSION_ALREADY_DOCUMENTED' });
    expect(prisma.billing.findMany.mock.calls[0][0].where.status).toBe('PAID');
    expect(prisma.hiraClaimDocument.findFirst.mock.calls[0][0].where).toMatchObject({ documentType: 'INPATIENT', status: { not: 'REJECTED' } });
    expect(prisma.hiraClaimDocument.create).not.toHaveBeenCalled();
  });
});
