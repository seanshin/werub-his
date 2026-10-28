import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TransferService } from '../../src/modules/transfer/transfer.service';

describe('TransferService', () => {
  let service: TransferService;
  let mockPrisma: any;

  const mockSelfOrg = { id: 'self-org', name: '우리병원', code: 'WERUBYHOSP', isSelf: true, fhirEndpoint: null };
  const mockPartnerOrg = { id: 'partner-org', name: '가상대병원', code: '11100001', isSelf: false, fhirEndpoint: 'https://fhir.partner-a.example/R4', smartClientId: 'snuh-001', smartSecret: 'secret' };
  const mockPatient = { id: 'patient-1', mrn: 'MRN-001', familyName: '김', givenName: '환자', fhirId: null, gender: 'MALE', dateOfBirth: new Date('1990-01-01'), phone: '010-1234-5678', nameEn: null };
  const mockTransfer = {
    id: 'transfer-1',
    patientId: 'patient-1',
    fromOrgId: 'self-org',
    toOrgId: 'partner-org',
    transferType: 'OUTGOING_REFERRAL',
    status: 'REQUESTED',
    urgency: 'URGENT',
    reason: '전원 사유',
    clinicalSummary: null,
    fhirBundle: { resourceType: 'Bundle', type: 'document', entry: [] },
    metadata: null,
    patient: mockPatient,
    fromOrg: mockSelfOrg,
    toOrg: mockPartnerOrg,
    diagnoses: [],
    medications: [],
    allergies: [],
    requestedAt: new Date(),
  };

  beforeEach(() => {
    mockPrisma = {
      organization: { findFirst: vi.fn(), findMany: vi.fn() },
      transferRecord: {
        create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(),
        count: vi.fn(), groupBy: vi.fn(),
      },
      encounterDiagnosis: { findMany: vi.fn().mockResolvedValue([]) },
      prescription: { findMany: vi.fn().mockResolvedValue([]) },
      allergy: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
      patient: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      diagnosisCode: { findFirst: vi.fn() },
      smartClient: { findUnique: vi.fn() },
    };
    service = new TransferService(mockPrisma);
  });

  describe('create', () => {
    it('자기 기관 없을 때 NotFoundException', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(null);
      await expect(service.create({ patientId: 'p', toOrgId: 'o', urgency: 'ROUTINE', reason: '이유', transferType: 'OUTGOING_REFERRAL' }, 'user'))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('존재하지 않는 전원 NotFoundException', async () => {
      mockPrisma.transferRecord.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nonexist')).rejects.toThrow(NotFoundException);
    });

    it('전원 상세 조회 성공', async () => {
      mockPrisma.transferRecord.findUnique.mockResolvedValue(mockTransfer);
      const result = await service.findOne('transfer-1');
      expect(result.id).toBe('transfer-1');
    });
  });

  describe('sendBundle', () => {
    it('Bundle 없으면 BadRequestException', async () => {
      mockPrisma.transferRecord.findUnique.mockResolvedValue({ ...mockTransfer, fhirBundle: null });
      await expect(service.sendBundle('transfer-1')).rejects.toThrow(BadRequestException);
    });

    it('FHIR 엔드포인트 없는 기관은 내부 전환', async () => {
      mockPrisma.transferRecord.findUnique.mockResolvedValue({
        ...mockTransfer, toOrg: { ...mockSelfOrg, fhirEndpoint: null },
      });
      mockPrisma.transferRecord.update.mockResolvedValue({ ...mockTransfer, status: 'IN_TRANSIT' });
      const result = await service.sendBundle('transfer-1');
      expect(result.status).toBe('IN_TRANSIT');
    });
  });

  describe('receiveBundle', () => {
    it('잘못된 Bundle 거부', async () => {
      await expect(service.receiveBundle({ resourceType: 'Patient' })).rejects.toThrow(BadRequestException);
    });

    it('빈 Bundle 거부', async () => {
      await expect(service.receiveBundle({ resourceType: 'Bundle', entry: [] })).rejects.toThrow(BadRequestException);
    });

    it('Patient 없는 Bundle 거부', async () => {
      await expect(service.receiveBundle({
        resourceType: 'Bundle',
        entry: [{ resource: { resourceType: 'Condition', code: { text: 'test' } } }],
      })).rejects.toThrow(BadRequestException);
    });

    it('MRN으로 기존 환자 매칭', async () => {
      const existingPatient = { id: 'existing-patient', mrn: 'MRN-001' };
      mockPrisma.patient.findFirst.mockResolvedValue(existingPatient);
      mockPrisma.organization.findFirst.mockResolvedValue(mockSelfOrg);
      mockPrisma.transferRecord.create.mockResolvedValue(mockTransfer);

      const result = await service.receiveBundle({
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', identifier: [{ system: 'urn:mrn', value: 'MRN-001' }], name: [{ family: '김', given: ['환자'] }] } },
        ],
      });

      expect(result.patient.id).toBe('existing-patient');
    });

    it('매칭 실패 시 신규 환자 등록', async () => {
      mockPrisma.patient.findFirst.mockResolvedValue(null);
      mockPrisma.patient.create.mockResolvedValue({ id: 'new-patient', mrn: 'TRF-XXX' });
      mockPrisma.organization.findFirst.mockResolvedValue(mockSelfOrg);
      mockPrisma.transferRecord.create.mockResolvedValue(mockTransfer);

      const result = await service.receiveBundle({
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', name: [{ family: '이', given: ['전원'] }], birthDate: '1985-05-15', gender: 'female' } },
        ],
      });

      expect(mockPrisma.patient.create).toHaveBeenCalled();
    });

    it('알레르기 데이터 — 수신 자료로 보존(원내 목록 FK 위반 쓰기 없음)', async () => {
      const matchedPatient = { id: 'p1', mrn: 'MRN-001' };
      mockPrisma.patient.findFirst
        .mockResolvedValueOnce(matchedPatient)  // MRN 매칭
        .mockResolvedValue(null);               // allergy 중복 체크: 없음
      mockPrisma.allergy.findFirst = vi.fn().mockResolvedValue(null); // 기존 알레르기 없음
      mockPrisma.allergy.create.mockResolvedValue({});
      mockPrisma.organization.findFirst.mockResolvedValue(mockSelfOrg);
      mockPrisma.transferRecord.create.mockResolvedValue(mockTransfer);
      mockPrisma.patient.findUnique.mockResolvedValue({ metadata: {} });

      await service.receiveBundle({
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', identifier: [{ system: 'urn:mrn', value: 'MRN-001' }], name: [{ family: '김' }] } },
          { resource: { resourceType: 'AllergyIntolerance', code: { text: '페니실린' }, category: ['medication'], criticality: 'high', patient: { reference: 'Patient/p1' } } },
        ],
      });

      // 🔴 (2026-09-15) 종전 기대값은 allergy.create(recordedBy=환자 id)였다 — 운영 DB 에선 users FK 위반으로 늘 실패하던 쓰기를
      //    목(mock)이 성공으로 돌려 테스트만 통과했다. 이제 수신 자료로 TransferRecord.allergies 에 보존한다.
      expect(mockPrisma.allergy.create).not.toHaveBeenCalled();
      expect(mockPrisma.transferRecord.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ allergies: [expect.objectContaining({ name: '페니실린', severity: 'high' })] }),
      }));
    });
  });

  describe('getStats', () => {
    it('통계 조회 성공', async () => {
      mockPrisma.transferRecord.count.mockResolvedValue(10);
      mockPrisma.transferRecord.groupBy.mockResolvedValue([]);
      mockPrisma.transferRecord.findMany.mockResolvedValue([]);

      const result = await service.getStats();
      expect(result.total).toBe(10);
    });
  });
});
