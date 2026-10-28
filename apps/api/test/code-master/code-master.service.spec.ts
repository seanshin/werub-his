import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CodeMasterService } from '../../src/modules/code-master/code-master.service';
import { CodeSynonymService } from '../../src/modules/code-master/code-synonym.service';
import { CodeUsageService } from '../../src/modules/code-master/code-usage.service';

describe('CodeMasterService', () => {
  let service: CodeMasterService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      diagnosisCode: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
      },
      procedureCode: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        count: vi.fn(),
      },
      medicationCode: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
      },
      // 🔴 목에 없는 메서드가 결함을 숨긴다 — 검색이 실제로 부르는 것을 전부 둔다.
      //    (동의어 배선 전에는 `codeUsage`·`synonyms` 를 아예 넘기지 않고도 통과했다)
      codeSynonym: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    };

    service = new CodeMasterService(
      mockPrisma,
      new CodeUsageService(mockPrisma),
      new CodeSynonymService(mockPrisma),
    );
  });

  describe('Diagnosis Code Search', () => {
    it('should search diagnosis codes with pagination', async () => {
      const mockDiags = [
        { code: 'J00', codeSystem: 'KCD-8', nameKo: '급성 인두염' },
        { code: 'J01', codeSystem: 'KCD-8', nameKo: '급성 부비강염' },
      ];

      vi.mocked(mockPrisma.diagnosisCode.findMany).mockResolvedValue(mockDiags);
      vi.mocked(mockPrisma.diagnosisCode.count).mockResolvedValue(2);

      const result = await service.searchDiagnosis({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.hasMore).toBe(false);
    });

    it('should filter diagnosis codes by codeSystem', async () => {
      vi.mocked(mockPrisma.diagnosisCode.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.diagnosisCode.count).mockResolvedValue(0);

      await service.searchDiagnosis({ codeSystem: 'KCD-8' });

      expect(mockPrisma.diagnosisCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({ codeSystem: 'KCD-8' }),
            ]),
          }),
        }),
      );
    });

    it('should search by category', async () => {
      vi.mocked(mockPrisma.diagnosisCode.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.diagnosisCode.count).mockResolvedValue(0);

      await service.searchDiagnosis({ category: '감염' });

      expect(mockPrisma.diagnosisCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                category: expect.objectContaining({ contains: '감염' }),
              }),
            ]),
          }),
        }),
      );
    });

    it('should search by query text', async () => {
      vi.mocked(mockPrisma.diagnosisCode.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.diagnosisCode.count).mockResolvedValue(0);

      await service.searchDiagnosis({ q: 'J0' });

      expect(mockPrisma.diagnosisCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  expect.objectContaining({ code: { startsWith: 'J0' } }),
                ]),
              }),
            ]),
          }),
        }),
      );
    });

    it('should filter active status', async () => {
      vi.mocked(mockPrisma.diagnosisCode.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.diagnosisCode.count).mockResolvedValue(0);

      await service.searchDiagnosis({ active: true });

      expect(mockPrisma.diagnosisCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({ isActive: true }),
            ]),
          }),
        }),
      );
    });

    it('should get diagnosis by code', async () => {
      const mockDiag = {
        code: 'J00',
        codeSystem: 'KCD-8',
        nameKo: '급성 인두염',
      };

      vi.mocked(mockPrisma.diagnosisCode.findUnique).mockResolvedValue(mockDiag);

      const result = await service.getDiagnosisByCode('J00', 'KCD-8');

      expect(result.code).toBe('J00');
      expect(mockPrisma.diagnosisCode.findUnique).toHaveBeenCalledWith({
        where: { codeSystem_code: { codeSystem: 'KCD-8', code: 'J00' } },
      });
    });

    it('should use default codeSystem in getDiagnosisByCode', async () => {
      vi.mocked(mockPrisma.diagnosisCode.findUnique).mockResolvedValue({});

      await service.getDiagnosisByCode('J00');

      expect(mockPrisma.diagnosisCode.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { codeSystem_code: { codeSystem: 'KCD-8', code: 'J00' } },
        }),
      );
    });
  });

  describe('Procedure Code Search', () => {
    it('should search procedure codes with pagination', async () => {
      const mockProcs = [
        { code: '66700', nameKo: '혈압측정' },
      ];

      vi.mocked(mockPrisma.procedureCode.findMany).mockResolvedValue(mockProcs);
      vi.mocked(mockPrisma.procedureCode.count).mockResolvedValue(1);

      const result = await service.searchProcedure({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should filter procedure by category', async () => {
      vi.mocked(mockPrisma.procedureCode.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.procedureCode.count).mockResolvedValue(0);

      await service.searchProcedure({ category: '진료' });

      expect(mockPrisma.procedureCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                category: expect.objectContaining({ contains: '진료' }),
              }),
            ]),
          }),
        }),
      );
    });

    it('should get procedure by code', async () => {
      const mockProc = { code: '66700', nameKo: '혈압측정' };

      // 수가는 시행일(temporal) 기준으로 유효 버전을 findFirst로 조회
      vi.mocked(mockPrisma.procedureCode.findFirst).mockResolvedValue(mockProc);

      const result = await service.getProcedureByCode('66700');

      expect(result.code).toBe('66700');
      expect(mockPrisma.procedureCode.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ code: '66700' }),
          orderBy: { validFrom: 'desc' },
        }),
      );
    });
  });

  describe('Medication Code Search', () => {
    it('should search medication codes with pagination', async () => {
      const mockMeds = [
        { code: '640100291', nameKo: '타이레놀' },
      ];

      vi.mocked(mockPrisma.medicationCode.findMany).mockResolvedValue(mockMeds);
      vi.mocked(mockPrisma.medicationCode.count).mockResolvedValue(1);

      const result = await service.searchMedication({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should search medication by query', async () => {
      vi.mocked(mockPrisma.medicationCode.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.medicationCode.count).mockResolvedValue(0);

      await service.searchMedication({ q: '타이' });

      expect(mockPrisma.medicationCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  expect.objectContaining({ nameKo: expect.any(Object) }),
                ]),
              }),
            ]),
          }),
        }),
      );
    });

    it('should get medication by code', async () => {
      const mockMed = { code: '640100291', nameKo: '타이레놀' };

      vi.mocked(mockPrisma.medicationCode.findUnique).mockResolvedValue(mockMed);

      const result = await service.getMedicationByCode('640100291');

      expect(result.code).toBe('640100291');
      expect(mockPrisma.medicationCode.findUnique).toHaveBeenCalledWith({
        where: { code: '640100291' },
      });
    });

    it('should support ingredient search', async () => {
      vi.mocked(mockPrisma.medicationCode.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.medicationCode.count).mockResolvedValue(0);

      await service.searchMedication({ q: 'acetaminophen' });

      expect(mockPrisma.medicationCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  expect.objectContaining({
                    ingredient: expect.objectContaining({ contains: 'acetaminophen' }),
                  }),
                ]),
              }),
            ]),
          }),
        }),
      );
    });
  });

  describe('runSeed', () => {
    it('should return code counts', async () => {
      vi.mocked(mockPrisma.diagnosisCode.count).mockResolvedValue(100);
      vi.mocked(mockPrisma.procedureCode.count).mockResolvedValue(50);
      vi.mocked(mockPrisma.medicationCode.count).mockResolvedValue(200);

      const result = await service.runSeed();

      expect(result.diagnosisCodes).toBe(100);
      expect(result.procedureCodes).toBe(50);
      expect(result.medicationCodes).toBe(200);
      expect(result.message).toContain('Use `npm run db:seed`');
    });
  });

  describe('Pagination', () => {
    it('should calculate hasMore correctly', async () => {
      vi.mocked(mockPrisma.diagnosisCode.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.diagnosisCode.count).mockResolvedValue(50);

      const result = await service.searchDiagnosis({ page: 2, limit: 20 });

      expect(result.pagination.hasMore).toBe(true); // 40 < 50
    });

    it('should indicate no more pages', async () => {
      vi.mocked(mockPrisma.diagnosisCode.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.diagnosisCode.count).mockResolvedValue(40);

      const result = await service.searchDiagnosis({ page: 2, limit: 20 });

      expect(result.pagination.hasMore).toBe(false); // 40 < 40 is false
    });

    it('should calculate skip correctly', async () => {
      vi.mocked(mockPrisma.diagnosisCode.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.diagnosisCode.count).mockResolvedValue(100);

      await service.searchDiagnosis({ page: 3, limit: 25 });

      expect(mockPrisma.diagnosisCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 50, // (3-1) * 25
          take: 25,
        }),
      );
    });
  });
});
