import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProblemListService } from '../../src/modules/problem-list/problem-list.service';
import { ProblemNotFoundError, ProblemAlreadyResolvedError } from '../../src/domain/errors/domain-error';

describe('ProblemListService', () => {
  let service: ProblemListService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      problemList: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    };

    service = new ProblemListService(mockPrisma);
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
        onsetDate: new Date('2026-01-15'),
        resolvedDate: null,
        addedBy: 'doc-1',
        diagnosisCode: { code: 'I10', nameKo: '고혈압', nameEn: 'Hypertension', codeSystem: 'ICD10' },
        addedByUser: { id: 'doc-1', familyName: '이', givenName: '의사' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.problemList.create.mockResolvedValue(mockProblem);

      const result = await service.create('pat-1', dto, 'doc-1');

      expect(result.id).toBe('prob-1');
      expect(result.description).toBe('고혈압');
      expect(result.status).toBe('ACTIVE');
      expect(mockPrisma.problemList.create).toHaveBeenCalledWith({
        data: {
          patientId: 'pat-1',
          diagnosisCodeId: 'diag-001',
          description: '고혈압',
          status: 'ACTIVE',
          severity: 'MODERATE',
          onsetDate: new Date('2026-01-15'),
          addedEncounterId: 'enc-1',
          notes: '환자 보고',
          addedBy: 'doc-1',
        },
        include: expect.anything(),
      });
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
        onsetDate: null,
        addedEncounterId: null,
        notes: null,
        addedBy: 'doc-1',
        diagnosisCode: { code: 'E11', nameKo: '당뇨병', nameEn: 'Type 2 Diabetes', codeSystem: 'ICD10' },
        addedByUser: { id: 'doc-1', familyName: '이', givenName: '의사' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.problemList.create.mockResolvedValue(mockProblem);

      const result = await service.create('pat-1', dto, 'doc-1');

      expect(result.description).toBe('당뇨병');
      expect(mockPrisma.problemList.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: 'pat-1',
            diagnosisCodeId: 'diag-001',
          }),
        }),
      );
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
          severity: 'MODERATE',
          diagnosisCode: { code: 'I10', nameKo: '고혈압', nameEn: 'Hypertension', codeSystem: 'ICD10' },
        },
        {
          id: 'prob-2',
          patientId: 'pat-1',
          description: '당뇨병',
          status: 'RESOLVED',
          severity: 'MILD',
          diagnosisCode: { code: 'E11', nameKo: '당뇨병', nameEn: 'Type 2 Diabetes', codeSystem: 'ICD10' },
        },
      ];

      mockPrisma.problemList.findMany.mockResolvedValue(mockProblems);

      const result = await service.findByPatient('pat-1');

      expect(result).toHaveLength(2);
      expect(result[0].description).toBe('고혈압');
      expect(mockPrisma.problemList.findMany).toHaveBeenCalledWith({
        where: { patientId: 'pat-1' },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: expect.anything(),
      });
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

      mockPrisma.problemList.findMany.mockResolvedValue(mockProblems);

      const result = await service.findByPatient('pat-1', 'ACTIVE');

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('ACTIVE');
      expect(mockPrisma.problemList.findMany).toHaveBeenCalledWith({
        where: {
          patientId: 'pat-1',
          status: { in: ['ACTIVE'] },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: expect.anything(),
      });
    });

    it('should filter by multiple statuses (comma-separated)', async () => {
      const mockProblems = [
        { id: 'prob-1', status: 'ACTIVE' },
        { id: 'prob-2', status: 'INACTIVE' },
      ];

      mockPrisma.problemList.findMany.mockResolvedValue(mockProblems);

      const result = await service.findByPatient('pat-1', 'ACTIVE,INACTIVE');

      expect(result).toHaveLength(2);
      expect(mockPrisma.problemList.findMany).toHaveBeenCalledWith({
        where: {
          patientId: 'pat-1',
          status: { in: ['ACTIVE', 'INACTIVE'] },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: expect.anything(),
      });
    });

    it('should return empty list when no problems found', async () => {
      mockPrisma.problemList.findMany.mockResolvedValue([]);

      const result = await service.findByPatient('pat-1');

      expect(result).toEqual([]);
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
        addedByUser: { id: 'doc-1', familyName: '이', givenName: '의사' },
      };

      mockPrisma.problemList.findFirst.mockResolvedValue(mockProblem);

      const result = await service.findById('patient-1', 'prob-1');

      expect(result.id).toBe('prob-1');
      expect(result.description).toBe('고혈압');
      expect(mockPrisma.problemList.findFirst).toHaveBeenCalledWith({
        where: { id: 'prob-1', patientId: 'patient-1' },
        include: expect.anything(),
      });
    });

    it('should throw ProblemNotFoundError if problem not found', async () => {
      mockPrisma.problemList.findFirst.mockResolvedValue(null);

      await expect(service.findById('patient-1', 'prob-1')).rejects.toThrow(ProblemNotFoundError);
    });
  });

  describe('update', () => {
    it('should update problem description', async () => {
      const dto = { description: '수정된 고혈압' };

      mockPrisma.problemList.findFirst.mockResolvedValue({
        id: 'prob-1',
        status: 'ACTIVE',
      });

      const mockUpdated = {
        id: 'prob-1',
        description: '수정된 고혈압',
        status: 'ACTIVE',
      };

      mockPrisma.problemList.update.mockResolvedValue(mockUpdated);

      const result = await service.update('patient-1', 'prob-1', dto);

      expect(result.description).toBe('수정된 고혈압');
      expect(mockPrisma.problemList.update).toHaveBeenCalledWith({
        where: { id: 'prob-1' },
        data: {
          description: '수정된 고혈압',
        },
        include: expect.anything(),
      });
    });

    it('should update problem status', async () => {
      const dto = { status: 'INACTIVE' };

      mockPrisma.problemList.findFirst.mockResolvedValue({
        id: 'prob-1',
        status: 'ACTIVE',
      });

      const mockUpdated = {
        id: 'prob-1',
        status: 'INACTIVE',
      };

      mockPrisma.problemList.update.mockResolvedValue(mockUpdated);

      const result = await service.update('patient-1', 'prob-1', dto);

      expect(result.status).toBe('INACTIVE');
    });

    it('should update problem severity', async () => {
      const dto = { severity: 'HIGH' };

      mockPrisma.problemList.findFirst.mockResolvedValue({
        id: 'prob-1',
        status: 'ACTIVE',
      });

      const mockUpdated = {
        id: 'prob-1',
        severity: 'HIGH',
      };

      mockPrisma.problemList.update.mockResolvedValue(mockUpdated);

      const result = await service.update('patient-1', 'prob-1', dto);

      expect(result.severity).toBe('HIGH');
    });

    it('should update problem notes', async () => {
      const dto = { notes: '치료 중 개선 확인' };

      mockPrisma.problemList.findFirst.mockResolvedValue({
        id: 'prob-1',
        status: 'ACTIVE',
      });

      const mockUpdated = {
        id: 'prob-1',
        notes: '치료 중 개선 확인',
      };

      mockPrisma.problemList.update.mockResolvedValue(mockUpdated);

      const result = await service.update('patient-1', 'prob-1', dto);

      expect(result.notes).toBe('치료 중 개선 확인');
    });

    it('should update multiple fields', async () => {
      const dto = {
        description: '수정된 고혈압',
        severity: 'HIGH',
        notes: '치료 중',
      };

      mockPrisma.problemList.findFirst.mockResolvedValue({
        id: 'prob-1',
        status: 'ACTIVE',
      });

      const mockUpdated = {
        id: 'prob-1',
        description: '수정된 고혈압',
        severity: 'HIGH',
        notes: '치료 중',
      };

      mockPrisma.problemList.update.mockResolvedValue(mockUpdated);

      const result = await service.update('patient-1', 'prob-1', dto);

      expect(result.description).toBe('수정된 고혈압');
      expect(result.severity).toBe('HIGH');
      expect(result.notes).toBe('치료 중');
    });

    it('should throw ProblemNotFoundError if problem not found', async () => {
      mockPrisma.problemList.findFirst.mockResolvedValue(null);

      await expect(service.update('patient-1', 'prob-1', { description: 'new' })).rejects.toThrow(
        ProblemNotFoundError,
      );
    });
  });

  describe('resolve', () => {
    it('should resolve problem with default resolvedDate', async () => {
      const dto = { notes: '문제 해결됨' };

      mockPrisma.problemList.findFirst.mockResolvedValue({
        id: 'prob-1',
        status: 'ACTIVE',
      });

      const mockResolved = {
        id: 'prob-1',
        status: 'RESOLVED',
        resolvedDate: new Date(),
        notes: '문제 해결됨',
      };

      mockPrisma.problemList.update.mockResolvedValue(mockResolved);

      const result = await service.resolve('patient-1', 'prob-1', dto);

      expect(result.status).toBe('RESOLVED');
      expect(result.notes).toBe('문제 해결됨');
      expect(mockPrisma.problemList.update).toHaveBeenCalledWith({
        where: { id: 'prob-1' },
        data: {
          status: 'RESOLVED',
          resolvedDate: expect.any(Date),
          notes: '문제 해결됨',
        },
        include: expect.anything(),
      });
    });

    it('should resolve problem with custom resolvedDate', async () => {
      const dto = {
        resolvedDate: '2026-05-10',
        notes: '문제 해결',
      };

      mockPrisma.problemList.findFirst.mockResolvedValue({
        id: 'prob-1',
        status: 'ACTIVE',
      });

      const mockResolved = {
        id: 'prob-1',
        status: 'RESOLVED',
        resolvedDate: new Date('2026-05-10'),
      };

      mockPrisma.problemList.update.mockResolvedValue(mockResolved);

      const result = await service.resolve('patient-1', 'prob-1', dto);

      expect(result.status).toBe('RESOLVED');
      expect(mockPrisma.problemList.update).toHaveBeenCalledWith({
        where: { id: 'prob-1' },
        data: {
          status: 'RESOLVED',
          resolvedDate: new Date('2026-05-10'),
          notes: '문제 해결',
        },
        include: expect.anything(),
      });
    });

    it('should throw ProblemNotFoundError if problem not found', async () => {
      mockPrisma.problemList.findFirst.mockResolvedValue(null);

      await expect(service.resolve('patient-1', 'prob-1', {})).rejects.toThrow(ProblemNotFoundError);
    });

    it('should throw ProblemAlreadyResolvedError if already resolved', async () => {
      mockPrisma.problemList.findFirst.mockResolvedValue({
        id: 'prob-1',
        status: 'RESOLVED',
      });

      await expect(service.resolve('patient-1', 'prob-1', {})).rejects.toThrow(ProblemAlreadyResolvedError);
    });
  });
});
