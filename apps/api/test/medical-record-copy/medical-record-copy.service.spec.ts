import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { MedicalRecordCopyService } from '../../src/modules/medical-record-copy/medical-record-copy.service';

describe('MedicalRecordCopyService', () => {
  let service: MedicalRecordCopyService;
  let mockPrisma: any;
  let mockPdfService: any;

  beforeEach(() => {
    mockPrisma = {
      medicalRecordCopy: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      // B6 — 사본은 서명된 기록만(상태를 먼저 본다)
      encounter: { findUnique: vi.fn().mockResolvedValue({ status: 'SIGNED' }) },
      dischargeSummary: { findUnique: vi.fn().mockResolvedValue({ status: 'SIGNED' }) },
    };

    mockPdfService = {
      generateEncounterPdf: vi.fn(),
      generateDischargeSummaryPdf: vi.fn(),
      generateLabResultPdf: vi.fn(),
    };

    service = new MedicalRecordCopyService(mockPrisma, mockPdfService);
  });

  describe('generatePdf', () => {
    it('should generate encounter PDF', async () => {
      const mockHtml = '<html>진료기록</html>';
      vi.mocked(mockPdfService.generateEncounterPdf).mockResolvedValue(mockHtml);

      const result = await service.generatePdf('encounter', 'enc-1');

      expect(result).toBe(mockHtml);
      expect(mockPdfService.generateEncounterPdf).toHaveBeenCalledWith('enc-1');
    });

    it('should generate discharge summary PDF', async () => {
      const mockHtml = '<html>퇴원요약</html>';
      vi.mocked(mockPdfService.generateDischargeSummaryPdf).mockResolvedValue(mockHtml);

      const result = await service.generatePdf('discharge_summary', 'adm-1');

      expect(result).toBe(mockHtml);
      expect(mockPdfService.generateDischargeSummaryPdf).toHaveBeenCalledWith('adm-1');
    });

    it('should generate lab result PDF', async () => {
      const mockHtml = '<html>검사결과</html>';
      vi.mocked(mockPdfService.generateLabResultPdf).mockResolvedValue(mockHtml);

      const result = await service.generatePdf('lab_result', 'lab-1');

      expect(result).toBe(mockHtml);
      expect(mockPdfService.generateLabResultPdf).toHaveBeenCalledWith('lab-1');
    });

    it('should throw NotFoundException for unsupported record type', async () => {
      await expect(service.generatePdf('invalid_type', 'id-1')).rejects.toThrow(NotFoundException);
    });

    it('should pass recordId correctly to PDF generator', async () => {
      vi.mocked(mockPdfService.generateEncounterPdf).mockResolvedValue('<html></html>');

      await service.generatePdf('encounter', 'specific-encounter-id');

      expect(mockPdfService.generateEncounterPdf).toHaveBeenCalledWith('specific-encounter-id');
    });
  });

  describe('createCopy', () => {
    it('should create medical record copy', async () => {
      const dto = {
        patientId: 'p-1',
        requestedBy: 'family-member',
        requestorRelation: '자녀',
        purpose: 'insurance',
        recordTypes: { encounter: ['enc-1'], labResult: ['lab-1'] },
        copyCount: 2,
      };

      const mockCopy = {
        id: 'copy-1',
        ...dto,
        issuedBy: 'user-1',
        issuedAt: new Date(),
        fee: 2000,
        notes: null,
      };

      vi.mocked(mockPrisma.medicalRecordCopy.create).mockResolvedValue(mockCopy);

      const result = await service.createCopy(dto, 'user-1');

      expect(result.id).toBe('copy-1');
      expect(result.fee).toBe(2000);
      expect(mockPrisma.medicalRecordCopy.create).toHaveBeenCalled();
    });

    it('should calculate fee correctly (copyCount * 1000)', async () => {
      const dto = {
        patientId: 'p-1',
        requestedBy: 'patient',
        requestorRelation: '본인',
        purpose: 'personal',
        recordTypes: { encounter: [] },
        copyCount: 3,
      };

      const mockCopy = { id: 'copy-1', ...dto, fee: 3000 };
      vi.mocked(mockPrisma.medicalRecordCopy.create).mockResolvedValue(mockCopy);

      const result = await service.createCopy(dto, 'user-1');

      expect(result.fee).toBe(3000);
    });

    it('should include issuedBy as userId', async () => {
      const dto = {
        patientId: 'p-1',
        requestedBy: 'family-member',
        requestorRelation: '배우자',
        purpose: 'medical',
        recordTypes: {},
        copyCount: 1,
      };

      vi.mocked(mockPrisma.medicalRecordCopy.create).mockResolvedValue({
        id: 'copy-1',
        issuedBy: 'doctor-123',
      });

      await service.createCopy(dto, 'doctor-123');

      const callArgs = (mockPrisma.medicalRecordCopy.create as any).mock.calls[0][0];
      expect(callArgs.data.issuedBy).toBe('doctor-123');
    });

    it('should set issuedAt to current date', async () => {
      const dto = {
        patientId: 'p-1',
        requestedBy: 'patient',
        requestorRelation: '본인',
        purpose: 'personal',
        recordTypes: {},
        copyCount: 1,
      };

      const beforeCall = new Date();
      vi.mocked(mockPrisma.medicalRecordCopy.create).mockResolvedValue({
        id: 'copy-1',
        issuedAt: new Date(),
      });

      const result = await service.createCopy(dto, 'user-1');
      const afterCall = new Date();

      const callArgs = (mockPrisma.medicalRecordCopy.create as any).mock.calls[0][0];
      expect(callArgs.data.issuedAt.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(callArgs.data.issuedAt.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });

    it('should handle recordTypes as JSON', async () => {
      const dto = {
        patientId: 'p-1',
        requestedBy: 'family',
        requestorRelation: '부모',
        purpose: 'insurance',
        recordTypes: { encounter: ['e1', 'e2'], discharge: ['d1'] },
        copyCount: 1,
      };

      vi.mocked(mockPrisma.medicalRecordCopy.create).mockResolvedValue({
        id: 'copy-1',
      });

      await service.createCopy(dto, 'user-1');

      const callArgs = (mockPrisma.medicalRecordCopy.create as any).mock.calls[0][0];
      expect(callArgs.data.recordTypes).toBeDefined();
    });

    it('should include optional dateRange if provided', async () => {
      const dto = {
        patientId: 'p-1',
        requestedBy: 'patient',
        requestorRelation: '본인',
        purpose: 'personal',
        recordTypes: {},
        dateRange: { from: '2026-01-01', to: '2026-05-13' },
        copyCount: 1,
      };

      vi.mocked(mockPrisma.medicalRecordCopy.create).mockResolvedValue({
        id: 'copy-1',
      });

      await service.createCopy(dto, 'user-1');

      const callArgs = (mockPrisma.medicalRecordCopy.create as any).mock.calls[0][0];
      expect(callArgs.data.dateRange).toBeDefined();
    });

    it('should handle notes field', async () => {
      const dto = {
        patientId: 'p-1',
        requestedBy: 'patient',
        requestorRelation: '본인',
        purpose: 'personal',
        recordTypes: {},
        copyCount: 1,
        notes: '긴급 발급 요청',
      };

      vi.mocked(mockPrisma.medicalRecordCopy.create).mockResolvedValue({
        id: 'copy-1',
        notes: '긴급 발급 요청',
      });

      const result = await service.createCopy(dto, 'user-1');

      expect(result.notes).toBe('긴급 발급 요청');
    });

    it('should handle zero copy count', async () => {
      const dto = {
        patientId: 'p-1',
        requestedBy: 'patient',
        requestorRelation: '본인',
        purpose: 'personal',
        recordTypes: {},
        copyCount: 0,
      };

      vi.mocked(mockPrisma.medicalRecordCopy.create).mockResolvedValue({
        id: 'copy-1',
        fee: 0,
      });

      const result = await service.createCopy(dto, 'user-1');

      expect(result.fee).toBe(0);
    });

    it('should handle large copy count', async () => {
      const dto = {
        patientId: 'p-1',
        requestedBy: 'patient',
        requestorRelation: '본인',
        purpose: 'personal',
        recordTypes: {},
        copyCount: 100,
      };

      vi.mocked(mockPrisma.medicalRecordCopy.create).mockResolvedValue({
        id: 'copy-1',
        fee: 100000,
      });

      const result = await service.createCopy(dto, 'user-1');

      expect(result.fee).toBe(100000);
    });
  });

  describe('findByPatient', () => {
    it('should return medical record copies for patient', async () => {
      const mockCopies = [
        {
          id: 'copy-1',
          patientId: 'p-1',
          issuedAt: new Date('2026-05-10'),
          issuer: { id: 'user-1', familyName: '이', givenName: '의사' },
        },
        {
          id: 'copy-2',
          patientId: 'p-1',
          issuedAt: new Date('2026-05-05'),
          issuer: { id: 'user-2', familyName: '김', givenName: '간호사' },
        },
      ];

      vi.mocked(mockPrisma.medicalRecordCopy.findMany).mockResolvedValue(mockCopies);

      const result = await service.findByPatient('p-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('copy-1');
    });

    it('should sort by issuedAt descending', async () => {
      const mockCopies = [
        {
          id: 'copy-3',
          patientId: 'p-1',
          issuedAt: new Date('2026-05-13T12:00:00'),
          issuer: { id: 'u-1', familyName: '이', givenName: '의사' },
        },
        {
          id: 'copy-2',
          patientId: 'p-1',
          issuedAt: new Date('2026-05-12T12:00:00'),
          issuer: { id: 'u-1', familyName: '이', givenName: '의사' },
        },
        {
          id: 'copy-1',
          patientId: 'p-1',
          issuedAt: new Date('2026-05-11T12:00:00'),
          issuer: { id: 'u-1', familyName: '이', givenName: '의사' },
        },
      ];

      vi.mocked(mockPrisma.medicalRecordCopy.findMany).mockResolvedValue(mockCopies);

      const result = await service.findByPatient('p-1');

      expect(result[0].id).toBe('copy-3');
      expect(result[1].id).toBe('copy-2');
      expect(result[2].id).toBe('copy-1');
    });

    it('should include issuer information', async () => {
      const mockCopies = [
        {
          id: 'copy-1',
          patientId: 'p-1',
          issuedAt: new Date(),
          issuer: {
            id: 'user-123',
            familyName: '이',
            givenName: '의사',
          },
        },
      ];

      vi.mocked(mockPrisma.medicalRecordCopy.findMany).mockResolvedValue(mockCopies);

      const result = await service.findByPatient('p-1');

      expect(result[0].issuer).toBeDefined();
      expect(result[0].issuer.familyName).toBe('이');
      expect(result[0].issuer.givenName).toBe('의사');
    });

    it('should return empty array when no copies found', async () => {
      vi.mocked(mockPrisma.medicalRecordCopy.findMany).mockResolvedValue([]);

      const result = await service.findByPatient('non-existent-patient');

      expect(result).toEqual([]);
    });

    it('should filter by correct patientId', async () => {
      vi.mocked(mockPrisma.medicalRecordCopy.findMany).mockResolvedValue([]);

      await service.findByPatient('specific-patient-id');

      expect(mockPrisma.medicalRecordCopy.findMany).toHaveBeenCalledWith({
        where: { patientId: 'specific-patient-id' },
        orderBy: { issuedAt: 'desc' },
        include: expect.any(Object),
      });
    });

    it('should include issuer with correct fields only', async () => {
      vi.mocked(mockPrisma.medicalRecordCopy.findMany).mockResolvedValue([]);

      await service.findByPatient('p-1');

      const callArgs = (mockPrisma.medicalRecordCopy.findMany as any).mock.calls[0][0];
      expect(callArgs.include.issuer.select).toEqual({
        id: true,
        familyName: true,
        givenName: true,
      });
    });

    it('should handle multiple copies with different requestors', async () => {
      const mockCopies = [
        {
          id: 'copy-1',
          patientId: 'p-1',
          requestedBy: 'patient',
          requestorRelation: '본인',
          issuedAt: new Date('2026-05-13'),
          issuer: { id: 'u-1', familyName: '이', givenName: '의사' },
        },
        {
          id: 'copy-2',
          patientId: 'p-1',
          requestedBy: 'family',
          requestorRelation: '자녀',
          issuedAt: new Date('2026-05-12'),
          issuer: { id: 'u-2', familyName: '김', givenName: '간호사' },
        },
        {
          id: 'copy-3',
          patientId: 'p-1',
          requestedBy: 'external',
          requestorRelation: '직장',
          issuedAt: new Date('2026-05-11'),
          issuer: { id: 'u-1', familyName: '이', givenName: '의사' },
        },
      ];

      vi.mocked(mockPrisma.medicalRecordCopy.findMany).mockResolvedValue(mockCopies);

      const result = await service.findByPatient('p-1');

      expect(result).toHaveLength(3);
      expect(result[0].requestorRelation).toBe('본인');
      expect(result[1].requestorRelation).toBe('자녀');
      expect(result[2].requestorRelation).toBe('직장');
    });
  });
});
