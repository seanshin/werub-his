import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiagnosticTestController } from '../../src/modules/diagnostic-test/diagnostic-test.controller';
import { DiagnosticTestService } from '../../src/modules/diagnostic-test/diagnostic-test.service';

describe('DiagnosticTestController', () => {
  let controller: DiagnosticTestController;
  let service: DiagnosticTestService;

  beforeEach(() => {
    service = {
      create: vi.fn(),
      findAll: vi.fn(),
      findOne: vi.fn(),
      perform: vi.fn(),
      report: vi.fn(),
      getTypes: vi.fn(),
    } as any;

    controller = new DiagnosticTestController(service);
  });

  describe('POST /api/v1/diagnostic-tests (create)', () => {
    it('should order diagnostic test', async () => {
      const body = {
        patientId: 'patient-1',
        testType: 'EKG',
        testName: '심전도 (EKG)',
        scheduledAt: '2026-05-15T10:00:00Z',
      };

      const mockTest = {
        id: 'test-1',
        ...body,
        status: 'SCHEDULED',
        requestedBy: 'doctor-1',
        patient: {
          id: 'patient-1',
          mrn: 'MRN-001',
          familyName: '이',
          givenName: '환자',
        },
      };

      vi.mocked(service.create).mockResolvedValue(mockTest);

      const result = await controller.create(body, 'doctor-1');

      expect(result.data.id).toBe('test-1');
      expect(result.data.testType).toBe('EKG');
      expect(result.data.status).toBe('SCHEDULED');
      expect(service.create).toHaveBeenCalledWith({
        ...body,
        requestedBy: 'doctor-1',
      });
    });

    it('should create test without scheduled date', async () => {
      const body = {
        patientId: 'patient-1',
        testType: 'PFT',
        testName: '폐기능검사 (PFT)',
      };

      const mockTest = {
        id: 'test-2',
        ...body,
        status: 'ORDERED',
        requestedBy: 'doctor-1',
      };

      vi.mocked(service.create).mockResolvedValue(mockTest);

      const result = await controller.create(body, 'doctor-1');

      expect(result.data.status).toBe('ORDERED');
      expect(result.data.scheduledAt).toBeUndefined();
    });

    it('should include patient info in response', async () => {
      const body = {
        patientId: 'patient-1',
        testType: 'ECHO',
        testName: '심초음파 (Echo)',
      };

      const mockTest = {
        id: 'test-3',
        ...body,
        status: 'ORDERED',
        requestedBy: 'doctor-1',
        patient: {
          id: 'patient-1',
          mrn: 'MRN-002',
          familyName: '김',
          givenName: '환자',
        },
      };

      vi.mocked(service.create).mockResolvedValue(mockTest);

      const result = await controller.create(body, 'doctor-1');

      expect(result.data.patient).toBeDefined();
      expect(result.data.patient.mrn).toBe('MRN-002');
    });
  });

  describe('GET /api/v1/diagnostic-tests (findAll)', () => {
    it('should return all diagnostic tests', async () => {
      const mockTests = [
        {
          id: 'test-1',
          testType: 'EKG',
          status: 'COMPLETED',
          patientId: 'patient-1',
        },
        {
          id: 'test-2',
          testType: 'PFT',
          status: 'IN_PROGRESS',
          patientId: 'patient-1',
        },
      ];

      vi.mocked(service.findAll).mockResolvedValue(mockTests);

      const result = await controller.findAll();

      expect(result.data).toHaveLength(2);
      expect(service.findAll).toHaveBeenCalledWith({
        testType: undefined,
        status: undefined,
        patientId: undefined,
      });
    });

    it('should filter by testType', async () => {
      const mockTests = [
        {
          id: 'test-1',
          testType: 'EKG',
          patientId: 'patient-1',
        },
      ];

      vi.mocked(service.findAll).mockResolvedValue(mockTests);

      const result = await controller.findAll('EKG');

      expect(result.data[0].testType).toBe('EKG');
      expect(service.findAll).toHaveBeenCalledWith({
        testType: 'EKG',
        status: undefined,
        patientId: undefined,
      });
    });

    it('should filter by status', async () => {
      const mockTests = [
        {
          id: 'test-1',
          status: 'COMPLETED',
          testType: 'EKG',
        },
      ];

      vi.mocked(service.findAll).mockResolvedValue(mockTests);

      const result = await controller.findAll(undefined, 'COMPLETED');

      expect(result.data[0].status).toBe('COMPLETED');
    });

    it('should filter by patientId', async () => {
      const mockTests = [
        {
          id: 'test-1',
          patientId: 'patient-1',
          testType: 'EKG',
        },
      ];

      vi.mocked(service.findAll).mockResolvedValue(mockTests);

      const result = await controller.findAll(undefined, undefined, 'patient-1');

      expect(result.data[0].patientId).toBe('patient-1');
    });

    it('should return empty array when no matches', async () => {
      vi.mocked(service.findAll).mockResolvedValue([]);

      const result = await controller.findAll('INVALID_TYPE');

      expect(result.data).toEqual([]);
    });
  });

  describe('GET /api/v1/diagnostic-tests/types (getTypes)', () => {
    it('should return available test types', () => {
      const mockTypes = [
        { code: 'EKG', name: '심전도 (EKG)', ediCode: 'E6011' },
        { code: 'PFT', name: '폐기능검사 (PFT)', ediCode: 'E6591' },
      ];

      vi.mocked(service.getTypes).mockReturnValue(mockTypes);

      const result = controller.getTypes();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].code).toBe('EKG');
      expect(service.getTypes).toHaveBeenCalled();
    });

    it('should include all test type properties', () => {
      const mockTypes = [
        { code: 'EKG', name: '심전도 (EKG)', ediCode: 'E6011' },
      ];

      vi.mocked(service.getTypes).mockReturnValue(mockTypes);

      const result = controller.getTypes();

      expect(result.data[0]).toHaveProperty('code');
      expect(result.data[0]).toHaveProperty('name');
      expect(result.data[0]).toHaveProperty('ediCode');
    });

    it('should return multiple test types', () => {
      const mockTypes = [
        { code: 'EKG', name: '심전도 (EKG)', ediCode: 'E6011' },
        { code: 'ECHO', name: '심초음파 (Echo)', ediCode: 'EB421' },
        { code: 'DEXA', name: '골밀도검사 (DEXA)', ediCode: 'FA011' },
      ];

      vi.mocked(service.getTypes).mockReturnValue(mockTypes);

      const result = controller.getTypes();

      expect(result.data.length).toBeGreaterThan(2);
    });
  });

  describe('GET /api/v1/diagnostic-tests/:id (findOne)', () => {
    it('should return diagnostic test details', async () => {
      const mockTest = {
        id: 'test-1',
        testType: 'EKG',
        testName: '심전도 (EKG)',
        status: 'COMPLETED',
        patientId: 'patient-1',
        patient: {
          id: 'patient-1',
          mrn: 'MRN-001',
          familyName: '이',
          givenName: '환자',
          gender: 'M',
          dateOfBirth: '1990-01-01',
        },
        findings: 'Normal sinus rhythm',
        reportedAt: new Date(),
      };

      vi.mocked(service.findOne).mockResolvedValue(mockTest);

      const result = await controller.findOne('test-1');

      expect(result.data.id).toBe('test-1');
      expect(result.data.testType).toBe('EKG');
      expect(result.data.patient.gender).toBe('M');
      expect(service.findOne).toHaveBeenCalledWith('test-1');
    });

    it('should include full patient details', async () => {
      const mockTest = {
        id: 'test-1',
        patientId: 'patient-1',
        patient: {
          id: 'patient-1',
          mrn: 'MRN-002',
          familyName: '김',
          givenName: '환자',
          gender: 'F',
          dateOfBirth: '1985-05-15',
        },
      };

      vi.mocked(service.findOne).mockResolvedValue(mockTest);

      const result = await controller.findOne('test-1');

      expect(result.data.patient.dateOfBirth).toBe('1985-05-15');
      expect(result.data.patient.mrn).toBe('MRN-002');
    });

    it('should include test findings and interpretation', async () => {
      const mockTest = {
        id: 'test-1',
        testType: 'PFT',
        status: 'COMPLETED',
        findings: 'Spirometry normal',
        impression: 'Normal lung function',
        conclusion: 'No obstructive or restrictive pattern',
        measurements: { FEV1: 85, FVC: 90 },
      };

      vi.mocked(service.findOne).mockResolvedValue(mockTest);

      const result = await controller.findOne('test-1');

      expect(result.data.findings).toBe('Spirometry normal');
      expect(result.data.impression).toBe('Normal lung function');
    });
  });

  describe('PATCH /api/v1/diagnostic-tests/:id/perform (perform)', () => {
    it('should mark test as performed', async () => {
      const mockTest = {
        id: 'test-1',
        testType: 'EKG',
        status: 'IN_PROGRESS',
        performedBy: 'lab-tech-1',
        performedAt: new Date(),
      };

      vi.mocked(service.perform).mockResolvedValue(mockTest);

      const result = await controller.perform('test-1', {} as never, 'lab-tech-1');

      expect(result.data.status).toBe('IN_PROGRESS');
      expect(result.data.performedBy).toBe('lab-tech-1');
      expect(service.perform).toHaveBeenCalledWith('test-1', 'lab-tech-1', undefined);
    });

    it('should set performedAt timestamp', async () => {
      const mockTest = {
        id: 'test-1',
        status: 'IN_PROGRESS',
        performedAt: new Date(),
      };

      vi.mocked(service.perform).mockResolvedValue(mockTest);

      const result = await controller.perform('test-1', {} as never, 'lab-tech-1');

      expect(result.data.performedAt).toBeDefined();
    });

    it('should track performer information', async () => {
      const mockTest = {
        id: 'test-1',
        performedBy: 'doctor-specialist',
        status: 'IN_PROGRESS',
      };

      vi.mocked(service.perform).mockResolvedValue(mockTest);

      const result = await controller.perform('test-1', {} as never, 'doctor-specialist');

      expect(result.data.performedBy).toBe('doctor-specialist');
    });
  });

  describe('PATCH /api/v1/diagnostic-tests/:id/report (report)', () => {
    it('should submit test report', async () => {
      const body = {
        findings: 'Normal sinus rhythm',
        impression: 'Normal EKG',
        conclusion: 'No acute abnormality',
        measurements: { rate: 72 },
      };

      const mockTest = {
        id: 'test-1',
        testType: 'EKG',
        status: 'COMPLETED',
        ...body,
        interpretedBy: 'doctor-1',
        reportedAt: new Date(),
      };

      vi.mocked(service.report).mockResolvedValue(mockTest);

      const result = await controller.report('test-1', body, 'doctor-1');

      expect(result.data.status).toBe('COMPLETED');
      expect(result.data.findings).toBe('Normal sinus rhythm');
      expect(result.data.impression).toBe('Normal EKG');
      expect(service.report).toHaveBeenCalledWith('test-1', {
        ...body,
        interpretedBy: 'doctor-1',
      });
    });

    it('should include measurements in report', async () => {
      const body = {
        findings: 'Spirometry normal',
        measurements: {
          FEV1: 85,
          FVC: 90,
          FEV1_FVC_ratio: 94,
        },
      };

      const mockTest = {
        id: 'test-2',
        testType: 'PFT',
        status: 'COMPLETED',
        findings: body.findings,
        measurements: body.measurements,
        interpretedBy: 'doctor-1',
      };

      vi.mocked(service.report).mockResolvedValue(mockTest);

      const result = await controller.report('test-2', body, 'doctor-1');

      expect(result.data.measurements).toHaveProperty('FEV1');
      expect(result.data.measurements.FEV1).toBe(85);
    });

    it('should mark test as completed', async () => {
      const body = {
        findings: 'Normal',
      };

      const mockTest = {
        id: 'test-1',
        status: 'COMPLETED',
        findings: 'Normal',
      };

      vi.mocked(service.report).mockResolvedValue(mockTest);

      const result = await controller.report('test-1', body, 'doctor-1');

      expect(result.data.status).toBe('COMPLETED');
    });

    it('should track interpreter information', async () => {
      const body = {
        findings: 'Normal findings',
      };

      const mockTest = {
        id: 'test-1',
        status: 'COMPLETED',
        interpretedBy: 'specialist-doctor',
        findings: 'Normal findings',
      };

      vi.mocked(service.report).mockResolvedValue(mockTest);

      const result = await controller.report('test-1', body, 'specialist-doctor');

      expect(result.data.interpretedBy).toBe('specialist-doctor');
    });
  });
});
