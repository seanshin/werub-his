import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DiagnosticTestService } from '../../src/modules/diagnostic-test/diagnostic-test.service';
import { DIAGNOSTIC_TEST_TYPES } from '@hospital-run/shared';

describe('DiagnosticTestService', () => {
  let service: DiagnosticTestService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      diagnosticTest: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    };

    service = new DiagnosticTestService(mockPrisma);
  });

  describe('create', () => {
    it('should create diagnostic test with scheduled date', async () => {
      const data = {
        patientId: 'patient-1',
        testType: 'EKG',
        testName: '심전도 (EKG)',
        requestedBy: 'doctor-1',
        scheduledAt: '2026-05-15T10:00:00Z',
      };

      mockPrisma.diagnosticTest.create.mockResolvedValue({
        id: 'test-1',
        ...data,
        status: 'SCHEDULED',
        scheduledAt: new Date(data.scheduledAt),
        patient: {
          id: 'patient-1',
          mrn: 'MRN-001',
          familyName: '이',
          givenName: '환자',
        },
      });

      const result = await service.create(data);

      expect(result.id).toBe('test-1');
      expect(result.testType).toBe('EKG');
      expect(result.status).toBe('SCHEDULED');
      expect(mockPrisma.diagnosticTest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: 'patient-1',
            status: 'SCHEDULED',
          }),
        })
      );
    });

    it('should create test without scheduled date (ORDERED status)', async () => {
      const data = {
        patientId: 'patient-1',
        testType: 'PFT',
        testName: '폐기능검사 (PFT)',
        requestedBy: 'doctor-1',
      };

      mockPrisma.diagnosticTest.create.mockResolvedValue({
        id: 'test-2',
        ...data,
        status: 'ORDERED',
        scheduledAt: null,
      });

      const result = await service.create(data);

      expect(result.status).toBe('ORDERED');
      expect(result.scheduledAt).toBeNull();
    });

    it('should include patient information', async () => {
      const data = {
        patientId: 'patient-1',
        testType: 'ECHO',
        testName: '심초음파 (Echo)',
        requestedBy: 'doctor-1',
      };

      mockPrisma.diagnosticTest.create.mockResolvedValue({
        id: 'test-3',
        ...data,
        status: 'ORDERED',
        patient: {
          id: 'patient-1',
          mrn: 'MRN-001',
          familyName: '김',
          givenName: '환자',
        },
      });

      const result = await service.create(data);

      expect(result.patient).toBeDefined();
      expect(result.patient.mrn).toBe('MRN-001');
    });

    it('should create with different test types', async () => {
      const testTypes = ['EKG', 'ECHO', 'PFT', 'AUDIOMETRY', 'DEXA'];

      for (const testType of testTypes) {
        mockPrisma.diagnosticTest.create.mockResolvedValue({
          id: `test-${testType}`,
          testType,
          patientId: 'patient-1',
          requestedBy: 'doctor-1',
          status: 'ORDERED',
        });

        const result = await service.create({
          patientId: 'patient-1',
          testType,
          testName: testType,
          requestedBy: 'doctor-1',
        });

        expect(result.testType).toBe(testType);
      }
    });
  });

  describe('findAll', () => {
    it('should return all diagnostic tests', async () => {
      const mockTests = [
        {
          id: 'test-1',
          testType: 'EKG',
          status: 'COMPLETED',
          patientId: 'patient-1',
          createdAt: new Date(),
        },
        {
          id: 'test-2',
          testType: 'PFT',
          status: 'IN_PROGRESS',
          patientId: 'patient-1',
          createdAt: new Date(),
        },
      ];

      mockPrisma.diagnosticTest.findMany.mockResolvedValue(mockTests);

      const result = await service.findAll({});

      expect(result).toHaveLength(2);
      expect(mockPrisma.diagnosticTest.findMany).toHaveBeenCalledWith({
        where: {},
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
        take: 300,
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

      mockPrisma.diagnosticTest.findMany.mockResolvedValue(mockTests);

      const result = await service.findAll({ testType: 'EKG' });

      expect(result[0].testType).toBe('EKG');
      expect(mockPrisma.diagnosticTest.findMany).toHaveBeenCalledWith({
        where: { testType: 'EKG' },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
        take: 300,
      });
    });

    it('should filter by status', async () => {
      const mockTests = [
        {
          id: 'test-1',
          testType: 'EKG',
          status: 'COMPLETED',
        },
        {
          id: 'test-3',
          testType: 'PFT',
          status: 'COMPLETED',
        },
      ];

      mockPrisma.diagnosticTest.findMany.mockResolvedValue(mockTests);

      const result = await service.findAll({ status: 'COMPLETED' });

      expect(result.every((t: any) => t.status === 'COMPLETED')).toBe(true);
      expect(mockPrisma.diagnosticTest.findMany).toHaveBeenCalledWith({
        where: { status: 'COMPLETED' },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
        take: 300,
      });
    });

    it('should filter by patientId', async () => {
      const mockTests = [
        {
          id: 'test-1',
          patientId: 'patient-1',
          testType: 'EKG',
        },
      ];

      mockPrisma.diagnosticTest.findMany.mockResolvedValue(mockTests);

      const result = await service.findAll({ patientId: 'patient-1' });

      expect(result[0].patientId).toBe('patient-1');
      expect(mockPrisma.diagnosticTest.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1' },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
        take: 300,
      });
    });

    it('should filter with multiple criteria', async () => {
      const mockTests = [
        {
          id: 'test-1',
          patientId: 'patient-1',
          testType: 'EKG',
          status: 'COMPLETED',
        },
      ];

      mockPrisma.diagnosticTest.findMany.mockResolvedValue(mockTests);

      const result = await service.findAll({
        patientId: 'patient-1',
        testType: 'EKG',
        status: 'COMPLETED',
      });

      expect(result).toHaveLength(1);
    });

    it('should return empty array when no matches', async () => {
      mockPrisma.diagnosticTest.findMany.mockResolvedValue([]);

      const result = await service.findAll({ status: 'INVALID' });

      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return diagnostic test by id', async () => {
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

      mockPrisma.diagnosticTest.findUnique.mockResolvedValue(mockTest);

      const result = await service.findOne('test-1');

      expect(result.id).toBe('test-1');
      expect(result.testType).toBe('EKG');
      expect(result.patient.gender).toBe('M');
      expect(mockPrisma.diagnosticTest.findUnique).toHaveBeenCalledWith({
        where: { id: 'test-1' },
        include: expect.any(Object),
      });
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrisma.diagnosticTest.findUnique.mockResolvedValue(null);

      await expect(service.findOne('invalid-id')).rejects.toThrow(NotFoundException);
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

      mockPrisma.diagnosticTest.findUnique.mockResolvedValue(mockTest);

      const result = await service.findOne('test-1');

      expect(result.patient.dateOfBirth).toBe('1985-05-15');
      expect(result.patient.mrn).toBe('MRN-002');
    });
  });

  describe('perform', () => {
    it('should mark test as in progress', async () => {
      mockPrisma.diagnosticTest.findUnique.mockResolvedValue({
        id: 'test-1',
        testType: 'EKG',
        status: 'SCHEDULED',
      });

      mockPrisma.diagnosticTest.update.mockResolvedValue({
        id: 'test-1',
        status: 'IN_PROGRESS',
        performedBy: 'lab-tech-1',
        performedAt: new Date(),
      });

      const result = await service.perform('test-1', 'lab-tech-1');

      expect(result.status).toBe('IN_PROGRESS');
      expect(result.performedBy).toBe('lab-tech-1');
      expect(mockPrisma.diagnosticTest.update).toHaveBeenCalledWith({
        where: { id: 'test-1' },
        data: expect.objectContaining({
          status: 'IN_PROGRESS',
          performedBy: 'lab-tech-1',
        }),
      });
    });

    it('should set performedAt timestamp', async () => {
      mockPrisma.diagnosticTest.findUnique.mockResolvedValue({
        id: 'test-1',
        status: 'SCHEDULED',
      });

      mockPrisma.diagnosticTest.update.mockResolvedValue({
        id: 'test-1',
        status: 'IN_PROGRESS',
        performedAt: new Date(),
      });

      await service.perform('test-1', 'lab-tech-1');

      expect(mockPrisma.diagnosticTest.update).toHaveBeenCalledWith({
        where: { id: 'test-1' },
        data: expect.objectContaining({
          performedAt: expect.any(Date),
        }),
      });
    });

    it('should throw NotFoundException if test not found', async () => {
      mockPrisma.diagnosticTest.findUnique.mockResolvedValue(null);

      await expect(service.perform('invalid-id', 'lab-tech-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('report', () => {
    it('should submit test report with findings', async () => {
      mockPrisma.diagnosticTest.findUnique.mockResolvedValue({
        id: 'test-1',
        testType: 'EKG',
        status: 'IN_PROGRESS',
      });

      mockPrisma.diagnosticTest.update.mockResolvedValue({
        id: 'test-1',
        status: 'COMPLETED',
        findings: 'Normal sinus rhythm',
        impression: 'Normal EKG',
        conclusion: 'No acute abnormality',
        interpretedBy: 'doctor-1',
        reportedAt: new Date(),
      });

      const result = await service.report('test-1', {
        findings: 'Normal sinus rhythm',
        impression: 'Normal EKG',
        conclusion: 'No acute abnormality',
        interpretedBy: 'doctor-1',
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.findings).toBe('Normal sinus rhythm');
      expect(result.impression).toBe('Normal EKG');
      expect(mockPrisma.diagnosticTest.update).toHaveBeenCalledWith({
        where: { id: 'test-1' },
        data: expect.objectContaining({
          status: 'COMPLETED',
        }),
      });
    });

    it('should submit report with measurements', async () => {
      mockPrisma.diagnosticTest.findUnique.mockResolvedValue({
        id: 'test-2',
        testType: 'PFT',
        status: 'IN_PROGRESS',
      });

      mockPrisma.diagnosticTest.update.mockResolvedValue({
        id: 'test-2',
        status: 'COMPLETED',
        findings: 'Spirometry normal',
        measurements: {
          FEV1: 85,
          FVC: 90,
          FEV1_FVC_ratio: 94,
        },
        interpretedBy: 'doctor-1',
        reportedAt: new Date(),
      });

      const result = await service.report('test-2', {
        findings: 'Spirometry normal',
        measurements: { FEV1: 85, FVC: 90, FEV1_FVC_ratio: 94 },
        interpretedBy: 'doctor-1',
      });

      expect(result.measurements).toHaveProperty('FEV1');
      expect(result.measurements.FEV1).toBe(85);
    });

    it('should set reportedAt timestamp', async () => {
      mockPrisma.diagnosticTest.findUnique.mockResolvedValue({
        id: 'test-1',
        status: 'IN_PROGRESS',
      });

      mockPrisma.diagnosticTest.update.mockResolvedValue({
        id: 'test-1',
        status: 'COMPLETED',
        reportedAt: new Date(),
      });

      await service.report('test-1', { findings: 'Normal' });

      expect(mockPrisma.diagnosticTest.update).toHaveBeenCalledWith({
        where: { id: 'test-1' },
        data: expect.objectContaining({
          reportedAt: expect.any(Date),
        }),
      });
    });

    it('should throw NotFoundException if test not found', async () => {
      mockPrisma.diagnosticTest.findUnique.mockResolvedValue(null);

      await expect(
        service.report('invalid-id', { findings: 'Normal' })
      ).rejects.toThrow(NotFoundException);
    });

    it('should submit partial report', async () => {
      mockPrisma.diagnosticTest.findUnique.mockResolvedValue({
        id: 'test-1',
        status: 'IN_PROGRESS',
      });

      mockPrisma.diagnosticTest.update.mockResolvedValue({
        id: 'test-1',
        status: 'COMPLETED',
        findings: 'Normal findings',
        impression: null,
        conclusion: null,
      });

      const result = await service.report('test-1', { findings: 'Normal findings' });

      expect(result.findings).toBe('Normal findings');
    });
  });

  describe('getTypes', () => {
    it('should return list of available test types', () => {
      const result = service.getTypes();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should include EKG test type', () => {
      const result = service.getTypes();
      const ekg = result.find((t: any) => t.code === 'EKG');

      expect(ekg).toBeDefined();
      // 🔴 표시명을 여기 다시 적지 않는다 — 적으면 정본이 둘이 되고, 정본이 둘이면 갈라진다(P12).
      //    이름은 shared 정본이 정하고, 이 테스트는 "그 정본을 그대로 내보내는가"만 본다.
      expect(ekg.name).toBe(DIAGNOSTIC_TEST_TYPES.find((t) => t.code === 'EKG')!.name);
      expect(ekg.ediCode).toBe('E6011');
    });

    /**
     * 🔴 표시명이 **청구하는 코드보다 덜 구체적이면** 화면과 청구가 다른 말을 한다.
     *    운영 수가 마스터 실측: `E6011 = 심전도(12유도 EKG)` (2026-08-26).
     *    옛 라벨은 그냥 '심전도 (EKG)' 라 12유도가 아닌 검사도 같은 이름으로 보였다.
     */
    it('🔴 심전도 표시명이 12유도임을 밝힌다 — E6011 은 12유도 코드다', () => {
      const ekg = service.getTypes().find((t: any) => t.code === 'EKG');
      expect(ekg.name).toMatch(/12/);
      // 대조군: 홀터(24시간)를 12유도라고 부르지 않는다
      const holter = DIAGNOSTIC_TEST_TYPES.find((t) => t.ediCode === 'E6012');
      if (holter) expect(holter.name).not.toMatch(/12/);
    });

    it('should include endoscopy types', () => {
      const result = service.getTypes();
      const upperEso = result.find((t: any) => t.code === 'ENDOSCOPY_UPPER');
      const lowerEso = result.find((t: any) => t.code === 'ENDOSCOPY_LOWER');

      expect(upperEso).toBeDefined();
      expect(lowerEso).toBeDefined();
    });

    it('should have code, name, and ediCode for each type', () => {
      const result = service.getTypes();

      result.forEach((type: any) => {
        expect(type).toHaveProperty('code');
        expect(type).toHaveProperty('name');
        expect(type).toHaveProperty('ediCode');
      });
    });

    it('should return consistent results', () => {
      const result1 = service.getTypes();
      const result2 = service.getTypes();

      expect(result1).toEqual(result2);
    });
  });
});
