import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HiraEdiService } from '../../src/modules/hira-edi/hira-edi.service';

describe('HiraEdiService', () => {
  let service: HiraEdiService;
  let p: any;
  const mockDoc = { id: 'he-1', status: 'DRAFT', claimId: 'c-1', createdBy: 'u-1', ediData: { totals: { total: 100, insurance: 70, patient: 30 } } };
  const mockClaim = {
    id: 'c-1',
    patientId: 'p-1',
    diagnoses: [],
    patient: { id: 'p-1', mrn: 'M001', familyName: '홍', givenName: '길동', insuranceType: 'NHI', insuranceNumber: '123' },
    billing: {
      id: 'b-1', totalAmount: 100, insuranceCovered: 70, patientCopay: 30,
      items: [],
      encounter: { id: 'e-1', visitType: 'OUTPATIENT', admissionId: null, createdAt: new Date(), doctor: { id: 'd-1', familyName: '김', givenName: '의사', department: '내과' } },
    },
  };

  beforeEach(() => {
    p = {
      hiraClaimDocument: { findMany: vi.fn().mockResolvedValue([mockDoc]), findUnique: vi.fn().mockResolvedValue(mockDoc), create: vi.fn().mockResolvedValue(mockDoc), update: vi.fn().mockResolvedValue(mockDoc), count: vi.fn().mockResolvedValue(10), groupBy: vi.fn().mockResolvedValue([]) },
      claim: { findUnique: vi.fn().mockResolvedValue(mockClaim) },
      encounterDiagnosis: { findMany: vi.fn().mockResolvedValue([]) },
      staff: { findUnique: vi.fn().mockResolvedValue(null) },
      procedureCode: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCode: { findMany: vi.fn().mockResolvedValue([]) },
      // 기관 식별 정본(DB 행) — 미설정이면 명세서를 만들지 않으므로(422) 설정된 병원을 준다
      systemConfig: { findMany: vi.fn().mockResolvedValue([{ key: 'hospital.code', value: '99887766' }, { key: 'hospital.name', value: '위루비병원' }]) },
    };
    service = new HiraEdiService(p);
  });

  it('generateDocument', async () => { const r = await service.generateDocument('c-1', 'u-1'); expect(r).toBeDefined(); });
  it('getDocument', async () => { await service.getDocument('he-1'); expect(p.hiraClaimDocument.findUnique).toHaveBeenCalled(); });
  it('getDocuments', async () => { await service.getDocuments({}); expect(p.hiraClaimDocument.findMany).toHaveBeenCalled(); });
  it('getStats', async () => { const r = await service.getStats(); expect(r).toBeDefined(); });
});
