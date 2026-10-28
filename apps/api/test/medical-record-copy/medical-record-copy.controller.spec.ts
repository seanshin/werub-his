import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MedicalRecordCopyController } from '../../src/modules/medical-record-copy/medical-record-copy.controller';

describe('MedicalRecordCopyController', () => {
  let controller: MedicalRecordCopyController;
  let mockService: any;
  let mockResponse: any;

  beforeEach(() => {
    mockService = {
      generatePdf: vi.fn(),
      createCopy: vi.fn(),
      findByPatient: vi.fn(),
    };

    mockResponse = {
      setHeader: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    controller = new MedicalRecordCopyController(mockService);
  });

  describe('POST /medical-records/generate-pdf', () => {
    it('should generate PDF and return HTML response', async () => {
      const mockHtml = '<html><body>의료기록</body></html>';
      vi.mocked(mockService.generatePdf).mockResolvedValue(mockHtml);

      await controller.generatePdf({ recordType: 'encounter', recordId: 'enc-1' }, mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
      expect(mockResponse.send).toHaveBeenCalledWith(mockHtml);
    });

    it('should call service with correct recordType and recordId', async () => {
      vi.mocked(mockService.generatePdf).mockResolvedValue('<html></html>');

      await controller.generatePdf(
        { recordType: 'discharge_summary', recordId: 'adm-1' },
        mockResponse
      );

      expect(mockService.generatePdf).toHaveBeenCalledWith('discharge_summary', 'adm-1');
    });

    it('should set UTF-8 charset in response header', async () => {
      vi.mocked(mockService.generatePdf).mockResolvedValue('<html></html>');

      await controller.generatePdf({ recordType: 'lab_result', recordId: 'lab-1' }, mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/html; charset=utf-8'
      );
    });

    it('should handle encounter PDF generation', async () => {
      const encounterHtml = '<html>진료기록</html>';
      vi.mocked(mockService.generatePdf).mockResolvedValue(encounterHtml);

      await controller.generatePdf({ recordType: 'encounter', recordId: 'enc-123' }, mockResponse);

      expect(mockResponse.send).toHaveBeenCalledWith(encounterHtml);
    });

    it('should handle discharge summary PDF generation', async () => {
      const dischargeHtml = '<html>퇴원요약</html>';
      vi.mocked(mockService.generatePdf).mockResolvedValue(dischargeHtml);

      await controller.generatePdf(
        { recordType: 'discharge_summary', recordId: 'adm-456' },
        mockResponse
      );

      expect(mockResponse.send).toHaveBeenCalledWith(dischargeHtml);
    });

    it('should handle lab result PDF generation', async () => {
      const labHtml = '<html>검사결과</html>';
      vi.mocked(mockService.generatePdf).mockResolvedValue(labHtml);

      await controller.generatePdf({ recordType: 'lab_result', recordId: 'lab-789' }, mockResponse);

      expect(mockResponse.send).toHaveBeenCalledWith(labHtml);
    });

    it('should propagate service errors', async () => {
      vi.mocked(mockService.generatePdf).mockRejectedValue(new Error('PDF generation failed'));

      await expect(
        controller.generatePdf({ recordType: 'encounter', recordId: 'invalid' }, mockResponse)
      ).rejects.toThrow('PDF generation failed');
    });
  });

  describe('POST /medical-record-copies', () => {
    it('should create medical record copy', async () => {
      const dto = {
        patientId: 'p-1',
        requestedBy: 'family',
        requestorRelation: '자녀',
        purpose: 'insurance',
        recordTypes: { encounter: ['e-1'] },
        copyCount: 2,
      };

      const mockCopy = { id: 'copy-1', ...dto, fee: 2000, issuedBy: 'user-1', issuedAt: new Date() };

      vi.mocked(mockService.createCopy).mockResolvedValue(mockCopy);

      const result = await controller.createCopy(dto, 'user-1');

      expect(result.data).toEqual(mockCopy);
    });

    it('should pass userId from CurrentUser decorator', async () => {
      const dto = {
        patientId: 'p-1',
        requestedBy: 'patient',
        requestorRelation: '본인',
        purpose: 'personal',
        recordTypes: {},
        copyCount: 1,
      };

      vi.mocked(mockService.createCopy).mockResolvedValue({ id: 'copy-1' });

      await controller.createCopy(dto, 'doctor-456');

      expect(mockService.createCopy).toHaveBeenCalledWith(dto, 'doctor-456');
    });

    it('should include fee in response', async () => {
      const dto = {
        patientId: 'p-1',
        requestedBy: 'patient',
        requestorRelation: '본인',
        purpose: 'personal',
        recordTypes: {},
        copyCount: 3,
      };

      const mockCopy = { id: 'copy-1', fee: 3000 };
      vi.mocked(mockService.createCopy).mockResolvedValue(mockCopy);

      const result = await controller.createCopy(dto, 'user-1');

      expect(result.data.fee).toBe(3000);
    });

    it('should wrap response in data object', async () => {
      const dto = {
        patientId: 'p-1',
        requestedBy: 'patient',
        requestorRelation: '본인',
        purpose: 'personal',
        recordTypes: {},
        copyCount: 1,
      };

      const mockCopy = { id: 'copy-1' };
      vi.mocked(mockService.createCopy).mockResolvedValue(mockCopy);

      const result = await controller.createCopy(dto, 'user-1');

      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(mockCopy);
    });

    it('should handle different requestor relations', async () => {
      const relations = ['본인', '배우자', '자녀', '부모', '직장'];

      for (const relation of relations) {
        const dto = {
          patientId: 'p-1',
          requestedBy: 'family',
          requestorRelation: relation,
          purpose: 'personal',
          recordTypes: {},
          copyCount: 1,
        };

        vi.mocked(mockService.createCopy).mockResolvedValue({ id: 'copy-1' });

        await controller.createCopy(dto, 'user-1');

        expect(mockService.createCopy).toHaveBeenCalled();
      }
    });

    it('should handle different purposes', async () => {
      const purposes = ['insurance', 'medical', 'legal', 'personal', 'immigration'];

      for (const purpose of purposes) {
        const dto = {
          patientId: 'p-1',
          requestedBy: 'patient',
          requestorRelation: '본인',
          purpose,
          recordTypes: {},
          copyCount: 1,
        };

        vi.mocked(mockService.createCopy).mockResolvedValue({ id: 'copy-1' });

        await controller.createCopy(dto, 'user-1');

        expect(mockService.createCopy).toHaveBeenCalled();
      }
    });

    it('should handle optional notes', async () => {
      const dto = {
        patientId: 'p-1',
        requestedBy: 'patient',
        requestorRelation: '본인',
        purpose: 'personal',
        recordTypes: {},
        copyCount: 1,
        notes: '긴급 발급',
      };

      vi.mocked(mockService.createCopy).mockResolvedValue({ id: 'copy-1', notes: '긴급 발급' });

      const result = await controller.createCopy(dto, 'user-1');

      expect(result.data.notes).toBe('긴급 발급');
    });

    it('should handle optional dateRange', async () => {
      const dto = {
        patientId: 'p-1',
        requestedBy: 'patient',
        requestorRelation: '본인',
        purpose: 'personal',
        recordTypes: {},
        dateRange: { from: '2025-01-01', to: '2026-05-13' },
        copyCount: 1,
      };

      vi.mocked(mockService.createCopy).mockResolvedValue({ id: 'copy-1' });

      await controller.createCopy(dto, 'user-1');

      expect(mockService.createCopy).toHaveBeenCalledWith(expect.objectContaining({ dateRange: dto.dateRange }), 'user-1');
    });
  });

  describe('GET /patients/:patientId/record-copies', () => {
    it('should return record copies for patient', async () => {
      const mockCopies = [
        {
          id: 'copy-1',
          patientId: 'p-1',
          issuedAt: new Date('2026-05-13'),
          issuer: { id: 'u-1', familyName: '이', givenName: '의사' },
        },
        {
          id: 'copy-2',
          patientId: 'p-1',
          issuedAt: new Date('2026-05-10'),
          issuer: { id: 'u-2', familyName: '김', givenName: '간호사' },
        },
      ];

      vi.mocked(mockService.findByPatient).mockResolvedValue(mockCopies);

      const result = await controller.findByPatient('p-1');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe('copy-1');
    });

    it('should call service with correct patientId', async () => {
      vi.mocked(mockService.findByPatient).mockResolvedValue([]);

      await controller.findByPatient('specific-patient-123');

      expect(mockService.findByPatient).toHaveBeenCalledWith('specific-patient-123');
    });

    it('should wrap response in data object', async () => {
      const mockCopies = [
        {
          id: 'copy-1',
          patientId: 'p-1',
          issuedAt: new Date(),
          issuer: { id: 'u-1', familyName: '이', givenName: '의사' },
        },
      ];

      vi.mocked(mockService.findByPatient).mockResolvedValue(mockCopies);

      const result = await controller.findByPatient('p-1');

      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(mockCopies);
    });

    it('should return empty array when no copies found', async () => {
      vi.mocked(mockService.findByPatient).mockResolvedValue([]);

      const result = await controller.findByPatient('non-existent-patient');

      expect(result.data).toEqual([]);
    });

    it('should include issuer information in each copy', async () => {
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

      vi.mocked(mockService.findByPatient).mockResolvedValue(mockCopies);

      const result = await controller.findByPatient('p-1');

      expect(result.data[0].issuer).toBeDefined();
      expect(result.data[0].issuer.familyName).toBe('이');
    });

    it('should include fee information', async () => {
      const mockCopies = [
        {
          id: 'copy-1',
          patientId: 'p-1',
          issuedAt: new Date(),
          fee: 5000,
          issuer: { id: 'u-1', familyName: '이', givenName: '의사' },
        },
      ];

      vi.mocked(mockService.findByPatient).mockResolvedValue(mockCopies);

      const result = await controller.findByPatient('p-1');

      expect(result.data[0].fee).toBe(5000);
    });

    it('should sort by issuedAt descending (most recent first)', async () => {
      const mockCopies = [
        {
          id: 'copy-3',
          patientId: 'p-1',
          issuedAt: new Date('2026-05-13'),
          issuer: { id: 'u-1', familyName: '이', givenName: '의사' },
        },
        {
          id: 'copy-2',
          patientId: 'p-1',
          issuedAt: new Date('2026-05-10'),
          issuer: { id: 'u-1', familyName: '이', givenName: '의사' },
        },
        {
          id: 'copy-1',
          patientId: 'p-1',
          issuedAt: new Date('2026-05-05'),
          issuer: { id: 'u-1', familyName: '이', givenName: '의사' },
        },
      ];

      vi.mocked(mockService.findByPatient).mockResolvedValue(mockCopies);

      const result = await controller.findByPatient('p-1');

      expect(result.data[0].id).toBe('copy-3');
      expect(result.data[1].id).toBe('copy-2');
      expect(result.data[2].id).toBe('copy-1');
    });

    it('should include multiple copies with different record types', async () => {
      const mockCopies = [
        {
          id: 'copy-1',
          patientId: 'p-1',
          recordTypes: { encounter: ['e-1', 'e-2'] },
          issuedAt: new Date('2026-05-13'),
          issuer: { id: 'u-1', familyName: '이', givenName: '의사' },
        },
        {
          id: 'copy-2',
          patientId: 'p-1',
          recordTypes: { discharge: ['d-1'], lab: ['l-1'] },
          issuedAt: new Date('2026-05-10'),
          issuer: { id: 'u-1', familyName: '이', givenName: '의사' },
        },
      ];

      vi.mocked(mockService.findByPatient).mockResolvedValue(mockCopies);

      const result = await controller.findByPatient('p-1');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].recordTypes).toEqual({ encounter: ['e-1', 'e-2'] });
      expect(result.data[1].recordTypes).toEqual({ discharge: ['d-1'], lab: ['l-1'] });
    });
  });
});
