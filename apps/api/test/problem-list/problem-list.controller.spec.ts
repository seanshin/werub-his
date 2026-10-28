import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProblemListController } from '../../src/modules/problem-list/problem-list.controller';
import { ProblemListService } from '../../src/modules/problem-list/problem-list.service';

describe('ProblemListController', () => {
  let controller: ProblemListController;
  let service: ProblemListService;

  beforeEach(() => {
    service = {
      create: vi.fn(),
      findByPatient: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      resolve: vi.fn(),
    } as any;

    controller = new ProblemListController(service);
  });

  describe('create', () => {
    it('should create problem with all fields', async () => {
      const dto = {
        diagnosisCodeId: 'diag-001',
        description: '고혈압',
        status: 'ACTIVE',
        severity: 'MODERATE',
        onsetDate: '2026-01-15',
        addedEncounterId: 'enc-1',
        notes: '환자 보고',
      };

      const mockProblem = {
        id: 'prob-1',
        patientId: 'pat-1',
        ...dto,
        addedBy: 'doc-1',
        diagnosisCode: { code: 'I10', nameKo: '고혈압', nameEn: 'Hypertension', codeSystem: 'ICD10' },
      };

      vi.mocked(service.create).mockResolvedValue(mockProblem);

      const result = await controller.create('pat-1', dto, 'doc-1');

      expect(result.data.id).toBe('prob-1');
      expect(result.data.description).toBe('고혈압');
      expect(service.create).toHaveBeenCalledWith('pat-1', dto, 'doc-1');
    });

    it('should create problem without optional fields', async () => {
      const dto = {
        diagnosisCodeId: 'diag-001',
        description: '당뇨병',
        status: 'ACTIVE',
        severity: 'MILD',
      };

      const mockProblem = {
        id: 'prob-2',
        patientId: 'pat-1',
        ...dto,
        addedBy: 'doc-1',
      };

      vi.mocked(service.create).mockResolvedValue(mockProblem);

      const result = await controller.create('pat-1', dto, 'doc-1');

      expect(result.data.description).toBe('당뇨병');
      expect(service.create).toHaveBeenCalledWith('pat-1', dto, 'doc-1');
    });
  });

  describe('findByPatient', () => {
    it('should return all problems for patient', async () => {
      const mockProblems = [
        {
          id: 'prob-1',
          patientId: 'pat-1',
          description: '고혈압',
          status: 'ACTIVE',
          diagnosisCode: { code: 'I10', nameKo: '고혈압', nameEn: 'Hypertension', codeSystem: 'ICD10' },
        },
        {
          id: 'prob-2',
          patientId: 'pat-1',
          description: '당뇨병',
          status: 'RESOLVED',
          diagnosisCode: { code: 'E11', nameKo: '당뇨병', nameEn: 'Type 2 Diabetes', codeSystem: 'ICD10' },
        },
      ];

      vi.mocked(service.findByPatient).mockResolvedValue(mockProblems);

      const result = await controller.findByPatient('pat-1');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].description).toBe('고혈압');
      expect(service.findByPatient).toHaveBeenCalledWith('pat-1', undefined);
    });

    it('should filter by single status', async () => {
      const mockProblems = [
        {
          id: 'prob-1',
          patientId: 'pat-1',
          description: '고혈압',
          status: 'ACTIVE',
        },
      ];

      vi.mocked(service.findByPatient).mockResolvedValue(mockProblems);

      const result = await controller.findByPatient('pat-1', 'ACTIVE');

      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe('ACTIVE');
      expect(service.findByPatient).toHaveBeenCalledWith('pat-1', 'ACTIVE');
    });

    it('should filter by multiple statuses (comma-separated)', async () => {
      const mockProblems = [
        { id: 'prob-1', status: 'ACTIVE' },
        { id: 'prob-2', status: 'INACTIVE' },
      ];

      vi.mocked(service.findByPatient).mockResolvedValue(mockProblems);

      const result = await controller.findByPatient('pat-1', 'ACTIVE,INACTIVE');

      expect(result.data).toHaveLength(2);
      expect(service.findByPatient).toHaveBeenCalledWith('pat-1', 'ACTIVE,INACTIVE');
    });

    it('should return empty list when no problems found', async () => {
      vi.mocked(service.findByPatient).mockResolvedValue([]);

      const result = await controller.findByPatient('pat-1');

      expect(result.data).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should return problem by id', async () => {
      const mockProblem = {
        id: 'prob-1',
        patientId: 'pat-1',
        description: '고혈압',
        status: 'ACTIVE',
        severity: 'MODERATE',
        diagnosisCode: { code: 'I10', nameKo: '고혈압', nameEn: 'Hypertension', codeSystem: 'ICD10' },
      };

      vi.mocked(service.findById).mockResolvedValue(mockProblem);

      const result = await controller.findById('patient-1', 'prob-1');

      expect(result.data.id).toBe('prob-1');
      expect(result.data.description).toBe('고혈압');
      expect(service.findById).toHaveBeenCalledWith('patient-1', 'prob-1');
    });
  });

  describe('update', () => {
    it('should update problem description', async () => {
      const dto = { description: '수정된 고혈압' };

      const mockUpdated = {
        id: 'prob-1',
        description: '수정된 고혈압',
        status: 'ACTIVE',
      };

      vi.mocked(service.update).mockResolvedValue(mockUpdated);

      const result = await controller.update('patient-1', 'prob-1', dto);

      expect(result.data.description).toBe('수정된 고혈압');
      expect(service.update).toHaveBeenCalledWith('patient-1', 'prob-1', dto);
    });

    it('should update problem status', async () => {
      const dto = { status: 'INACTIVE' };

      const mockUpdated = {
        id: 'prob-1',
        status: 'INACTIVE',
      };

      vi.mocked(service.update).mockResolvedValue(mockUpdated);

      const result = await controller.update('patient-1', 'prob-1', dto);

      expect(result.data.status).toBe('INACTIVE');
      expect(service.update).toHaveBeenCalledWith('patient-1', 'prob-1', dto);
    });

    it('should update problem severity', async () => {
      const dto = { severity: 'HIGH' };

      const mockUpdated = {
        id: 'prob-1',
        severity: 'HIGH',
      };

      vi.mocked(service.update).mockResolvedValue(mockUpdated);

      const result = await controller.update('patient-1', 'prob-1', dto);

      expect(result.data.severity).toBe('HIGH');
    });

    it('should update multiple fields', async () => {
      const dto = {
        description: '수정된 고혈압',
        severity: 'HIGH',
        notes: '치료 중',
      };

      const mockUpdated = {
        id: 'prob-1',
        description: '수정된 고혈압',
        severity: 'HIGH',
        notes: '치료 중',
      };

      vi.mocked(service.update).mockResolvedValue(mockUpdated);

      const result = await controller.update('patient-1', 'prob-1', dto);

      expect(result.data.description).toBe('수정된 고혈압');
      expect(result.data.severity).toBe('HIGH');
      expect(result.data.notes).toBe('치료 중');
      expect(service.update).toHaveBeenCalledWith('patient-1', 'prob-1', dto);
    });
  });

  describe('resolve', () => {
    it('should resolve problem with notes', async () => {
      const dto = { notes: '문제 해결됨' };

      const mockResolved = {
        id: 'prob-1',
        status: 'RESOLVED',
        resolvedDate: new Date(),
        notes: '문제 해결됨',
      };

      vi.mocked(service.resolve).mockResolvedValue(mockResolved);

      const result = await controller.resolve('patient-1', 'prob-1', dto);

      expect(result.data.status).toBe('RESOLVED');
      expect(result.data.notes).toBe('문제 해결됨');
      expect(service.resolve).toHaveBeenCalledWith('patient-1', 'prob-1', dto);
    });

    it('should resolve problem with custom resolvedDate', async () => {
      const dto = {
        resolvedDate: '2026-05-10',
        notes: '문제 해결',
      };

      const mockResolved = {
        id: 'prob-1',
        status: 'RESOLVED',
        resolvedDate: new Date('2026-05-10'),
      };

      vi.mocked(service.resolve).mockResolvedValue(mockResolved);

      const result = await controller.resolve('patient-1', 'prob-1', dto);

      expect(result.data.status).toBe('RESOLVED');
      expect(service.resolve).toHaveBeenCalledWith('patient-1', 'prob-1', dto);
    });

    it('should resolve problem without notes', async () => {
      const dto = {};

      const mockResolved = {
        id: 'prob-1',
        status: 'RESOLVED',
        resolvedDate: new Date(),
      };

      vi.mocked(service.resolve).mockResolvedValue(mockResolved);

      const result = await controller.resolve('patient-1', 'prob-1', dto);

      expect(result.data.status).toBe('RESOLVED');
      expect(service.resolve).toHaveBeenCalledWith('patient-1', 'prob-1', dto);
    });
  });
});
