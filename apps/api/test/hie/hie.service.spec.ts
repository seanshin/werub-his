import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HieService } from '../../src/modules/hie/hie.service';

describe('HieService', () => {
  let service: HieService;
  let mockPrisma: any;
  let mockCda: any;

  beforeEach(() => {
    mockPrisma = {
      patient: { findUnique: vi.fn(), findFirst: vi.fn() },
      organization: { findFirst: vi.fn(), findUnique: vi.fn() },
      hieExchange: {
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
        groupBy: vi.fn(),
      },
    };
    mockCda = {
      fhirToCda: vi.fn().mockReturnValue('<ClinicalDocument/>'),
      cdaToFhir: vi.fn(),
      parseCdaHeader: vi.fn(),
    };
    service = new HieService(mockPrisma, mockCda);
  });

  const basePatient = () => ({
    id: 'p-1',
    mrn: '12345',
    fhirId: 'fhir-p-1',
    familyName: '김',
    givenName: '철수',
    gender: 'MALE',
    dateOfBirth: new Date('1990-01-01'),
    encounters: [],
    allergiesRel: [],
  });

  describe('sendPatientSummary', () => {
    it('should send patient summary and persist an exchange', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue(basePatient());
      mockPrisma.organization.findFirst.mockResolvedValue({ id: 'self', name: '본원', isSelf: true });
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-456', name: '협력병원' });
      mockPrisma.hieExchange.create.mockResolvedValue({ id: 'ex-1' });
      mockPrisma.hieExchange.update.mockResolvedValue({ id: 'ex-1', status: 'SENT' });

      const result = await service.sendPatientSummary('p-1', {
        documentType: 'TRSF',
        targetOrgId: 'org-456',
      });

      expect(result.exchangeId).toBe('ex-1');
      // 🔴 종전 계약: `status:'SENT'` · `sendResult.success:true`. 게이트웨이 전송 코드가
      //    존재한 적이 없는데 전건 '전송 완료'였다(2026-08-14 W8). 정본으로 갱신한다.
      expect(result.status).toBe('LOCAL_RECORDED');
      expect(result.transmitted).toBe(false);
      expect(result.sentAt).toBeNull();
      expect(result.documentType).toBe('TRSF');
      expect(result.targetOrg).toBe('협력병원');
      expect(result.sendResult.outcome).toBe('NOT_TRANSMITTED');
      expect(result.retransmittable).toBe(true);
    });

    it('should throw NotFoundException when patient not found', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue(null);

      await expect(
        service.sendPatientSummary('non-existent', { documentType: 'TRSF', targetOrgId: 'org-456' }),
      ).rejects.toThrow('환자를 찾을 수 없습니다');
    });

    it('should query patient by ID with encounters and allergies', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue(basePatient());
      mockPrisma.organization.findFirst.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockPrisma.hieExchange.create.mockResolvedValue({ id: 'ex-1' });
      mockPrisma.hieExchange.update.mockResolvedValue({ id: 'ex-1' });

      await service.sendPatientSummary('p-1', { documentType: 'TRSF', targetOrgId: 'org-456' });

      expect(mockPrisma.patient.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p-1' } }),
      );
    });

    it('should convert FHIR bundle to CDA via the converter', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue(basePatient());
      mockPrisma.organization.findFirst.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockPrisma.hieExchange.create.mockResolvedValue({ id: 'ex-1' });
      mockPrisma.hieExchange.update.mockResolvedValue({ id: 'ex-1' });

      await service.sendPatientSummary('p-1', { documentType: 'TRSF', targetOrgId: 'org-456' });

      expect(mockCda.fhirToCda).toHaveBeenCalledWith(
        expect.objectContaining({ resourceType: 'Bundle', type: 'document' }),
        'TRSF',
      );
    });

    it('should report the number of FHIR resources and CDA length', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue(basePatient());
      mockPrisma.organization.findFirst.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockPrisma.hieExchange.create.mockResolvedValue({ id: 'ex-1' });
      mockPrisma.hieExchange.update.mockResolvedValue({ id: 'ex-1' });

      const result = await service.sendPatientSummary('p-1', { documentType: 'TRSF', targetOrgId: 'org-456' });

      // Composition + Patient entries at minimum
      expect(result.fhirResourceCount).toBeGreaterThanOrEqual(2);
      expect(result.cdaLength).toBe('<ClinicalDocument/>'.length);
    });

    it('should default format to CDA_R2 when not provided', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue(basePatient());
      mockPrisma.organization.findFirst.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockPrisma.hieExchange.create.mockResolvedValue({ id: 'ex-1' });
      mockPrisma.hieExchange.update.mockResolvedValue({ id: 'ex-1' });

      await service.sendPatientSummary('p-1', { documentType: 'TRSF', targetOrgId: 'org-456' });

      expect(mockPrisma.hieExchange.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ format: 'CDA_R2', direction: 'SEND' }) }),
      );
    });

    it('should fall back to targetOrgId label when target org missing', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue(basePatient());
      mockPrisma.organization.findFirst.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockPrisma.hieExchange.create.mockResolvedValue({ id: 'ex-1' });
      mockPrisma.hieExchange.update.mockResolvedValue({ id: 'ex-1' });

      const result = await service.sendPatientSummary('p-1', { documentType: 'TRSF', targetOrgId: 'org-456' });

      expect(result.targetOrg).toBe('org-456');
    });
  });

  describe('receiveExternalRecord', () => {
    it('should receive an external FHIR bundle and persist an exchange', async () => {
      const fhirBundle = {
        resourceType: 'Bundle',
        type: 'document',
        entry: [{ resource: { resourceType: 'Patient', name: [{ family: '김', given: ['철수'] }] } }],
      };
      mockPrisma.patient.findFirst.mockResolvedValue({ id: 'p-1' });
      mockPrisma.hieExchange.create.mockResolvedValue({ id: 'ex-2', documentType: 'TRSF' });

      const result = await service.receiveExternalRecord({ fhirBundle });

      expect(result.status).toBe('RECEIVED');
      expect(result.patientMatched).toBe(true);
      expect(result.patientName).toBe('김철수');
      expect(result.fhirResourceCount).toBe(1);
    });

    it('should convert an incoming CDA document to FHIR', async () => {
      mockCda.cdaToFhir.mockReturnValue({ resourceType: 'Bundle', entry: [] });
      mockCda.parseCdaHeader.mockReturnValue({ documentType: 'PRSC', title: '처방전' });
      mockPrisma.hieExchange.create.mockResolvedValue({ id: 'ex-3', documentType: 'PRSC' });

      const result = await service.receiveExternalRecord({ cdaDocument: '<ClinicalDocument/>' });

      expect(mockCda.cdaToFhir).toHaveBeenCalledWith('<ClinicalDocument/>');
      expect(result.documentType).toBe('PRSC');
      expect(result.status).toBe('RECEIVED');
    });

    it('should use a default patient id when no match is found', async () => {
      const fhirBundle = { resourceType: 'Bundle', type: 'document', entry: [] };
      mockPrisma.patient.findFirst.mockResolvedValue({ id: 'default-p' });
      mockPrisma.hieExchange.create.mockResolvedValue({ id: 'ex-4', documentType: 'TRSF' });

      const result = await service.receiveExternalRecord({ fhirBundle });

      expect(result.patientMatched).toBe(false);
      expect(mockPrisma.hieExchange.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ patientId: 'default-p', direction: 'RECEIVE' }) }),
      );
    });

    it('should throw when neither CDA nor FHIR is supplied', async () => {
      await expect(service.receiveExternalRecord({})).rejects.toThrow(
        'CDA 또는 FHIR Bundle 데이터가 필요합니다',
      );
    });
  });

  describe('getExchangeLog', () => {
    it('should return paginated logs from the database', async () => {
      const logs = [{ id: 'ex-1' }, { id: 'ex-2' }];
      mockPrisma.hieExchange.findMany.mockResolvedValue(logs);
      mockPrisma.hieExchange.count.mockResolvedValue(2);

      const result = await service.getExchangeLog();

      // 저장값은 그대로 두고 전송 판정(transmission)만 덧붙인다 — 읽는 쪽 분류(W8)
      expect(result.logs.map((l: any) => l.id)).toEqual(['ex-1', 'ex-2']);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should filter by patientId and direction', async () => {
      mockPrisma.hieExchange.findMany.mockResolvedValue([]);
      mockPrisma.hieExchange.count.mockResolvedValue(0);

      await service.getExchangeLog('p-1', 'SEND', 2, 10);

      expect(mockPrisma.hieExchange.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { patientId: 'p-1', direction: 'SEND' },
          skip: 10,
          take: 10,
        }),
      );
    });
  });

  describe('getExchangeDetail', () => {
    it('should return an exchange detail', async () => {
      mockPrisma.hieExchange.findUnique.mockResolvedValue({ id: 'ex-1' });

      const result = await service.getExchangeDetail('ex-1');

      expect(result).toMatchObject({ id: 'ex-1' });
      // 상세도 전송 판정을 함께 싣는다(화면이 '전송 완료'를 스스로 추측하지 못하게)
      expect(result.transmission).toBeDefined();
    });

    it('should throw when exchange not found', async () => {
      mockPrisma.hieExchange.findUnique.mockResolvedValue(null);

      await expect(service.getExchangeDetail('missing')).rejects.toThrow('교류 이력을 찾을 수 없습니다');
    });
  });

  describe('getStats', () => {
    it('should aggregate exchange statistics', async () => {
      mockPrisma.hieExchange.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(3); // recentMonth
      mockPrisma.hieExchange.groupBy
        .mockResolvedValueOnce([{ direction: 'SEND', _count: 6 }, { direction: 'RECEIVE', _count: 4 }])
        .mockResolvedValueOnce([{ documentType: 'TRSF', _count: 10 }])
        .mockResolvedValueOnce([{ status: 'SENT', _count: 7 }, { status: 'RECEIVED', _count: 3 }]);

      const result = await service.getStats();

      expect(result.total).toBe(10);
      expect(result.recentMonth).toBe(3);
      expect(result.byDirection).toEqual({ SEND: 6, RECEIVE: 4 });
      expect(result.byDocType).toEqual({ TRSF: 10 });
      expect(result.byStatus).toEqual({ SENT: 7, RECEIVED: 3 });
    });
  });
});
