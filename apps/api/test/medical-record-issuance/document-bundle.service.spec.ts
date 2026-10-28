import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DocumentBundleService } from '../../src/modules/medical-record-issuance/document-bundle.service';
import { INSURANCE_DOC_SETS, resolveInsuranceDocSet } from '../../src/modules/medical-record-issuance/insurance-doc-sets';

// F-4 실손보험 서류 번들 회귀 스펙 — 세트 resolve·수수료 합산·자동발급 분기·소유 검증·guardian 차단·config 게이트

const PATIENT = 'patient-1';

function makeBilling(overrides: Record<string, unknown> = {}) {
  return {
    id: 'billing-1',
    createdAt: new Date('2026-07-01T02:00:00Z'),
    totalAmount: 30000,
    insuranceCovered: 14000,
    patientCopay: 16000,
    discountAmount: 0,
    paidAmount: 16000,
    receiptNo: 'R-0001',
    copayCategory: 'NHI',
    eligibilityStatus: 'VERIFIED',
    encounter: {
      id: 'enc-1',
      createdAt: new Date('2026-07-01T01:00:00Z'),
      visitType: 'OUTPATIENT',
      doctor: { familyName: '김', givenName: '의사', department: '내과' },
    },
    items: [
      // 급여 일부본인부담: 10,000 × 30% = 본인 3,000 / 공단 7,000
      { codeName: '진찰료', codeType: 'CONSULT', quantity: 1, unitPrice: 10000, amount: 10000, copayRate: 0.3, insuranceCategory: 'COVERED', fullCopay: false },
      // 급여 전액본인부담(100/100): 5,000
      { codeName: '전액약', codeType: 'MEDICATION', quantity: 1, unitPrice: 5000, amount: 5000, copayRate: 1, insuranceCategory: 'COVERED', fullCopay: true },
      // 비급여: 15,000
      { codeName: '비급여주사', codeType: 'PROCEDURE', quantity: 1, unitPrice: 15000, amount: 15000, copayRate: 1, insuranceCategory: 'NON_COVERED', fullCopay: false },
    ],
    ...overrides,
  };
}

function makePrisma() {
  let seq = 0;
  return {
    systemConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    billing: { findMany: vi.fn().mockResolvedValue([makeBilling()]) },
    patient: {
      findUnique: vi.fn().mockResolvedValue({ mrn: 'MRN001', familyName: '홍', givenName: '길동', dateOfBirth: new Date('1980-01-01'), gender: 'MALE' }),
    },
    documentRequest: {
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        return Promise.resolve({ id: `req-${seq}`, status: 'REQUESTED', ...data });
      }),
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    issuedDocument: { findFirst: vi.fn().mockResolvedValue(null) },
  };
}

function makeDeps() {
  const prisma = makePrisma();
  const documents = {
    issue: vi.fn().mockImplementation(() => Promise.resolve({ issueNo: `WRB-TEST-${Math.random().toString(36).slice(2, 6)}` })),
    generatePdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
  };
  const configRuntime = { get: vi.fn().mockResolvedValue(true) }; // 기본 ON(게이트 테스트에서 개별 OFF)
  const events = { emit: vi.fn() };
  const svc = new DocumentBundleService(prisma as never, documents as never, configRuntime as never, events as never);
  return { prisma, documents, configRuntime, events, svc };
}

describe('insurance-doc-sets 상수', () => {
  it('외래 세트 = DETAILED_BILL + RECEIPT(zip 동봉) + ATTENDANCE_CERT', () => {
    const set = resolveInsuranceDocSet('INSURANCE_OUTPATIENT')!;
    expect(set.components.map((c) => c.type)).toEqual(['DETAILED_BILL', 'RECEIPT', 'ATTENDANCE_CERT']);
    expect(set.components.find((c) => c.type === 'RECEIPT')?.mode).toBe('RECEIPT_ATTACH'); // DocumentRequest 미생성
    expect(set.components.filter((c) => c.mode === 'AUTO').map((c) => c.type)).toEqual(['DETAILED_BILL', 'ATTENDANCE_CERT']);
  });

  it('입원 세트 = DETAILED_BILL + RECEIPT + ADMISSION_CERT(직원 작성)', () => {
    const set = resolveInsuranceDocSet('INSURANCE_INPATIENT')!;
    expect(set.components.map((c) => c.type)).toEqual(['DETAILED_BILL', 'RECEIPT', 'ADMISSION_CERT']);
    expect(set.components.find((c) => c.type === 'ADMISSION_CERT')?.mode).toBe('STAFF'); // 기존 B그룹 흐름 불변
  });

  it('진단서는 어느 세트에도 포함되지 않는다(별도 신청 안내)', () => {
    for (const set of Object.values(INSURANCE_DOC_SETS)) {
      expect(set.components.some((c) => c.type === 'DIAGNOSIS_CERT')).toBe(false);
      expect(set.notice).toContain('진단서');
    }
  });

  it('미지원 세트 유형은 null', () => {
    expect(resolveInsuranceDocSet('NOPE')).toBeNull();
  });
});

describe('DocumentBundleService', () => {
  let d: ReturnType<typeof makeDeps>;
  beforeEach(() => { d = makeDeps(); });

  describe('config 게이트 (portal.insuranceDocBundle 기본 OFF)', () => {
    it('OFF면 전 EP 404', async () => {
      d.configRuntime.get.mockResolvedValue(false);
      await expect(d.svc.getSets()).rejects.toThrow(NotFoundException);
      await expect(d.svc.requestBundle(PATIENT, { setType: 'INSURANCE_OUTPATIENT', periodFrom: '2026-06-01', periodTo: '2026-07-01' })).rejects.toThrow(NotFoundException);
      await expect(d.svc.getBundle(PATIENT, 'b-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSets — 신청 전 수수료 고지', () => {
    it('수수료 합산: DETAILED_BILL 1,000 + ATTENDANCE_CERT 3,000 = 4,000 (영수증 0원)', async () => {
      const { sets } = await d.svc.getSets();
      const out = sets.find((s) => s.setType === 'INSURANCE_OUTPATIENT')!;
      expect(out.components.find((c) => c.type === 'DETAILED_BILL')?.fee).toBe(1000);
      expect(out.components.find((c) => c.type === 'ATTENDANCE_CERT')?.fee).toBe(3000);
      expect(out.components.find((c) => c.type === 'RECEIPT')?.fee).toBe(0);
      expect(out.totalFee).toBe(4000);
      const inp = sets.find((s) => s.setType === 'INSURANCE_INPATIENT')!;
      expect(inp.totalFee).toBe(4000); // DETAILED_BILL 1,000 + ADMISSION_CERT 3,000
    });
  });

  describe('requestBundle — 자동발급 분기', () => {
    it('외래 세트: 요청 2건(영수증 미생성)·전량 즉시 READY·번들 완성 이벤트 발행', async () => {
      const r = await d.svc.requestBundle(PATIENT, { setType: 'INSURANCE_OUTPATIENT', periodFrom: '2026-06-01', periodTo: '2026-07-01' });
      expect(r.requests.map((x) => x.type)).toEqual(['DETAILED_BILL', 'ATTENDANCE_CERT']); // RECEIPT 는 DocumentRequest 미생성
      expect(r.requests.every((x) => x.status === 'READY')).toBe(true);
      expect(r.totalFee).toBe(4000);
      expect(r.allReady).toBe(true);
      expect(r.receiptIncluded).toBe(true);
      expect(d.documents.issue).toHaveBeenCalledTimes(2); // 자동발급 2건
      expect(d.events.emit).toHaveBeenCalledWith('portal.document_bundle_ready', expect.objectContaining({ patientId: PATIENT }));
      // 생성 요청 전부 동일 bundleId
      const bundleIds = d.prisma.documentRequest.create.mock.calls.map((c) => c[0].data.bundleId);
      expect(new Set(bundleIds).size).toBe(1);
    });

    it('입원 세트: ADMISSION_CERT 는 REQUESTED 유지(직원 흐름)·완성 이벤트 미발행', async () => {
      d.prisma.billing.findMany.mockResolvedValue([makeBilling({ encounter: { id: 'enc-2', createdAt: new Date('2026-06-10'), visitType: 'INPATIENT', doctor: { familyName: '김', givenName: '의사', department: '내과' } } })]);
      const r = await d.svc.requestBundle(PATIENT, { setType: 'INSURANCE_INPATIENT', periodFrom: '2026-06-01', periodTo: '2026-07-01' });
      expect(r.requests.find((x) => x.type === 'DETAILED_BILL')?.status).toBe('READY');
      expect(r.requests.find((x) => x.type === 'ADMISSION_CERT')?.status).toBe('REQUESTED');
      expect(r.allReady).toBe(false);
      expect(d.documents.issue).toHaveBeenCalledTimes(1); // 자동발급은 세부내역서 1건뿐
      expect(d.events.emit).not.toHaveBeenCalled();
    });

    it('DETAILED_BILL 스냅샷 — 영수증 5열 분해(공단/일부본인/전액본인/비급여)', async () => {
      await d.svc.requestBundle(PATIENT, { setType: 'INSURANCE_OUTPATIENT', periodFrom: '2026-06-01', periodTo: '2026-07-01' });
      const call = d.documents.issue.mock.calls.find((c) => c[0].documentType === 'DETAILED_BILL')!;
      const snap = call[0].snapshot as { grandTotal: Record<string, number>; billings: { items: Record<string, number>[] }[] };
      expect(snap.grandTotal).toEqual({ amount: 30000, insurerShare: 7000, copayPartial: 3000, copayFull: 5000, nonCovered: 15000 });
      const consult = snap.billings[0].items[0];
      expect(consult.copayPartial).toBe(3000);
      expect(consult.insurerShare).toBe(7000);
    });

    it('기간 내 수납 내역이 없으면 400(빈 번들 방지)', async () => {
      d.prisma.billing.findMany.mockResolvedValue([]);
      await expect(d.svc.requestBundle(PATIENT, { setType: 'INSURANCE_OUTPATIENT', periodFrom: '2026-06-01', periodTo: '2026-07-01' })).rejects.toThrow(BadRequestException);
      expect(d.prisma.documentRequest.create).not.toHaveBeenCalled();
    });

    it('기간 역전(from > to)·잘못된 세트는 400', async () => {
      await expect(d.svc.requestBundle(PATIENT, { setType: 'INSURANCE_OUTPATIENT', periodFrom: '2026-07-01', periodTo: '2026-06-01' })).rejects.toThrow(BadRequestException);
      await expect(d.svc.requestBundle(PATIENT, { setType: 'WRONG', periodFrom: '2026-06-01', periodTo: '2026-07-01' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('getBundle — 소유 검증', () => {
    it('타 환자 번들이면 404(존재 노출 금지)', async () => {
      d.prisma.documentRequest.findMany.mockResolvedValue([
        { id: 'r1', patientId: 'other-patient', type: 'DETAILED_BILL', status: 'READY', fee: 1000, purpose: 'x', periodFrom: null, periodTo: null, issuedDocumentId: 'W-1', rejectReason: null },
      ]);
      await expect(d.svc.getBundle(PATIENT, 'b-1')).rejects.toThrow(NotFoundException);
    });

    it('빈 번들(미존재)도 404', async () => {
      d.prisma.documentRequest.findMany.mockResolvedValue([]);
      await expect(d.svc.getBundle(PATIENT, 'b-404')).rejects.toThrow(NotFoundException);
    });

    it('본인 번들은 상태·수수료 합산 반환', async () => {
      d.prisma.documentRequest.findMany.mockResolvedValue([
        { id: 'r1', patientId: PATIENT, type: 'DETAILED_BILL', status: 'READY', fee: 1000, purpose: '실손보험 청구(입원)', periodFrom: new Date('2026-06-01'), periodTo: new Date('2026-07-01'), issuedDocumentId: 'W-1', rejectReason: null },
        { id: 'r2', patientId: PATIENT, type: 'ADMISSION_CERT', status: 'REQUESTED', fee: 3000, purpose: '실손보험 청구(입원)', periodFrom: new Date('2026-06-01'), periodTo: new Date('2026-07-01'), issuedDocumentId: null, rejectReason: null },
      ]);
      const r = await d.svc.getBundle(PATIENT, 'b-1');
      expect(r.totalFee).toBe(4000);
      expect(r.readyCount).toBe(1);
      expect(r.allReady).toBe(false);
      expect(r.receiptIncluded).toBe(true); // 입원 세트 역추정(ADMISSION_CERT 포함)
    });
  });

  describe('streamBundleZip — 보호자 위임 차단(설계 §6.6)', () => {
    it('guardian 세션이면 403(소유 검증 이전에 차단)', async () => {
      const res = {} as never;
      await expect(d.svc.streamBundleZip(PATIENT, 'b-1', res, { isGuardianAccess: true })).rejects.toThrow(ForbiddenException);
      expect(d.prisma.documentRequest.findMany).not.toHaveBeenCalled();
    });

    it('내려받을 서류가 하나도 없으면 400', async () => {
      d.prisma.documentRequest.findMany.mockResolvedValue([
        { id: 'r2', patientId: PATIENT, type: 'ADMISSION_CERT', status: 'REQUESTED', fee: 3000, purpose: 'x', periodFrom: null, periodTo: null, issuedDocumentId: null, rejectReason: null },
      ]);
      const res = { setHeader: vi.fn(), destroy: vi.fn() } as never;
      await expect(d.svc.streamBundleZip(PATIENT, 'b-1', res)).rejects.toThrow(BadRequestException);
    });
  });
});
