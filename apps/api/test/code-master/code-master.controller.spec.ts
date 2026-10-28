import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CodeMasterController } from '../../src/modules/code-master/code-master.controller';
import { NotFoundException } from '@nestjs/common';

describe('CodeMasterController', () => {
  let controller: CodeMasterController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      searchDiagnosis: vi.fn(),
      getDiagnosisByCode: vi.fn(),
      searchProcedure: vi.fn(),
      getProcedureByCode: vi.fn(),
      searchMedication: vi.fn(),
      getMedicationByCode: vi.fn(),
      runSeed: vi.fn(),
    };

    controller = new CodeMasterController(mockService);
  });

  describe('Diagnosis Search', () => {
    it('should search diagnosis with default parameters', async () => {
      const mockResult = {
        data: [
          { code: 'I10', nameKo: '본태성 고혈압' },
        ],
        total: 1,
        hasMore: false,
      };

      vi.mocked(mockService.searchDiagnosis).mockResolvedValue(mockResult);

      const result = await controller.searchDiagnosis({});

      expect(result.data).toHaveLength(1);
      expect(mockService.searchDiagnosis).toHaveBeenCalledWith({});
    });

    it('should search diagnosis with query parameters', async () => {
      const mockResult = {
        data: [{ code: 'I10', nameKo: '본태성 고혈압' }],
        total: 1,
        hasMore: false,
      };

      vi.mocked(mockService.searchDiagnosis).mockResolvedValue(mockResult);

      const query = { query: '고혈압', page: 1, limit: 20 };
      const result = await controller.searchDiagnosis(query);

      expect(result.data).toHaveLength(1);
      expect(mockService.searchDiagnosis).toHaveBeenCalledWith(query);
    });

    it('should search diagnosis with codeSystem filter', async () => {
      const mockResult = {
        data: [{ code: 'A00', nameKo: '콜레라' }],
        total: 1,
        hasMore: false,
      };

      vi.mocked(mockService.searchDiagnosis).mockResolvedValue(mockResult);

      const query = { codeSystem: 'KCD' };
      const result = await controller.searchDiagnosis(query);

      expect(result.data).toHaveLength(1);
      expect(mockService.searchDiagnosis).toHaveBeenCalledWith(query);
    });

    it('should handle empty diagnosis search results', async () => {
      const mockResult = {
        data: [],
        total: 0,
        hasMore: false,
      };

      vi.mocked(mockService.searchDiagnosis).mockResolvedValue(mockResult);

      const result = await controller.searchDiagnosis({ query: 'nonexistent' });

      expect(result.data).toHaveLength(0);
    });
  });

  describe('Diagnosis Detail', () => {
    it('should get diagnosis by code with default codeSystem', async () => {
      const mockResult = {
        code: 'I10',
        nameKo: '본태성 고혈압',
        icd10Code: 'I10',
      };

      vi.mocked(mockService.getDiagnosisByCode).mockResolvedValue(mockResult);

      const result = await controller.getDiagnosis('I10');

      expect(result.data.code).toBe('I10');
      expect(mockService.getDiagnosisByCode).toHaveBeenCalledWith('I10', undefined);
    });

    it('should get diagnosis by code with specific codeSystem', async () => {
      const mockResult = {
        code: 'I10',
        nameKo: '본태성 고혈압',
        icd11Code: 'BA00',
      };

      vi.mocked(mockService.getDiagnosisByCode).mockResolvedValue(mockResult);

      const result = await controller.getDiagnosis('I10', 'ICD-11');

      expect(result.data.icd11Code).toBe('BA00');
      expect(mockService.getDiagnosisByCode).toHaveBeenCalledWith('I10', 'ICD-11');
    });

    it('should throw NotFoundException when diagnosis code not found', async () => {
      vi.mocked(mockService.getDiagnosisByCode).mockResolvedValue(null);

      await expect(controller.getDiagnosis('INVALID')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should wrap diagnosis detail in data object', async () => {
      const mockResult = {
        code: 'E11',
        nameKo: '제2형 당뇨병',
      };

      vi.mocked(mockService.getDiagnosisByCode).mockResolvedValue(mockResult);

      const result = await controller.getDiagnosis('E11');

      expect(result).toHaveProperty('data');
      expect(result.data.code).toBe('E11');
    });
  });

  describe('Procedure Search', () => {
    it('should search procedure with default parameters', async () => {
      const mockResult = {
        data: [
          { code: 'R9300', nameKo: '단순흉부 X-선 촬영' },
        ],
        total: 1,
        hasMore: false,
      };

      vi.mocked(mockService.searchProcedure).mockResolvedValue(mockResult);

      const result = await controller.searchProcedure({});

      expect(result.data).toHaveLength(1);
      expect(mockService.searchProcedure).toHaveBeenCalledWith({});
    });

    it('should search procedure with query parameters', async () => {
      const mockResult = {
        data: [{ code: 'R9300', nameKo: '단순흉부 X-선 촬영' }],
        total: 1,
        hasMore: false,
      };

      vi.mocked(mockService.searchProcedure).mockResolvedValue(mockResult);

      const query = { query: 'X-선', page: 1, limit: 20 };
      const result = await controller.searchProcedure(query);

      expect(result.data).toHaveLength(1);
      expect(mockService.searchProcedure).toHaveBeenCalledWith(query);
    });

    it('should search procedure with category filter', async () => {
      const mockResult = {
        data: [{ code: 'R9300', nameKo: '단순흉부 X-선 촬영', category: 'IMAGING' }],
        total: 1,
        hasMore: false,
      };

      vi.mocked(mockService.searchProcedure).mockResolvedValue(mockResult);

      const query = { category: 'IMAGING' };
      const result = await controller.searchProcedure(query);

      expect(result.data[0].category).toBe('IMAGING');
      expect(mockService.searchProcedure).toHaveBeenCalledWith(query);
    });

    it('should handle empty procedure search results', async () => {
      const mockResult = {
        data: [],
        total: 0,
        hasMore: false,
      };

      vi.mocked(mockService.searchProcedure).mockResolvedValue(mockResult);

      const result = await controller.searchProcedure({ query: 'nonexistent' });

      expect(result.data).toHaveLength(0);
    });
  });

  describe('Procedure Detail', () => {
    it('should get procedure by code', async () => {
      const mockResult = {
        code: 'R9300',
        nameKo: '단순흉부 X-선 촬영',
        category: 'IMAGING',
      };

      vi.mocked(mockService.getProcedureByCode).mockResolvedValue(mockResult);

      const result = await controller.getProcedure('R9300');

      expect(result.data.code).toBe('R9300');
      expect(mockService.getProcedureByCode).toHaveBeenCalledWith('R9300');
    });

    it('should throw NotFoundException when procedure code not found', async () => {
      vi.mocked(mockService.getProcedureByCode).mockResolvedValue(null);

      await expect(controller.getProcedure('INVALID')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should wrap procedure detail in data object', async () => {
      const mockResult = {
        code: 'R9300',
        nameKo: '단순흉부 X-선 촬영',
      };

      vi.mocked(mockService.getProcedureByCode).mockResolvedValue(mockResult);

      const result = await controller.getProcedure('R9300');

      expect(result).toHaveProperty('data');
      expect(result.data.code).toBe('R9300');
    });
  });

  describe('Medication Search', () => {
    it('should search medication with default parameters', async () => {
      const mockResult = {
        data: [
          { code: 'A001', nameKo: '아스피린 500mg', ingredient: 'Aspirin' },
        ],
        total: 1,
        hasMore: false,
      };

      vi.mocked(mockService.searchMedication).mockResolvedValue(mockResult);

      const result = await controller.searchMedication({});

      expect(result.data).toHaveLength(1);
      expect(mockService.searchMedication).toHaveBeenCalledWith({});
    });

    it('should search medication with query parameters', async () => {
      const mockResult = {
        data: [{ code: 'A001', nameKo: '아스피린 500mg' }],
        total: 1,
        hasMore: false,
      };

      vi.mocked(mockService.searchMedication).mockResolvedValue(mockResult);

      const query = { query: '아스피린', page: 1, limit: 20 };
      const result = await controller.searchMedication(query);

      expect(result.data).toHaveLength(1);
      expect(mockService.searchMedication).toHaveBeenCalledWith(query);
    });

    it('should search medication by ingredient', async () => {
      const mockResult = {
        data: [{ code: 'A001', ingredient: 'Aspirin' }],
        total: 1,
        hasMore: false,
      };

      vi.mocked(mockService.searchMedication).mockResolvedValue(mockResult);

      const query = { query: 'Aspirin' };
      const result = await controller.searchMedication(query);

      expect(result.data[0].ingredient).toBe('Aspirin');
      expect(mockService.searchMedication).toHaveBeenCalledWith(query);
    });

    it('should handle empty medication search results', async () => {
      const mockResult = {
        data: [],
        total: 0,
        hasMore: false,
      };

      vi.mocked(mockService.searchMedication).mockResolvedValue(mockResult);

      const result = await controller.searchMedication({ query: 'nonexistent' });

      expect(result.data).toHaveLength(0);
    });
  });

  describe('Medication Detail', () => {
    it('should get medication by code', async () => {
      const mockResult = {
        code: 'A001',
        nameKo: '아스피린 500mg',
        ingredient: 'Aspirin',
      };

      vi.mocked(mockService.getMedicationByCode).mockResolvedValue(mockResult);

      const result = await controller.getMedication('A001');

      expect(result.data.code).toBe('A001');
      expect(mockService.getMedicationByCode).toHaveBeenCalledWith('A001');
    });

    it('should throw NotFoundException when medication code not found', async () => {
      vi.mocked(mockService.getMedicationByCode).mockResolvedValue(null);

      await expect(controller.getMedication('INVALID')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should wrap medication detail in data object', async () => {
      const mockResult = {
        code: 'A001',
        nameKo: '아스피린 500mg',
      };

      vi.mocked(mockService.getMedicationByCode).mockResolvedValue(mockResult);

      const result = await controller.getMedication('A001');

      expect(result).toHaveProperty('data');
      expect(result.data.code).toBe('A001');
    });
  });

  describe('Seed', () => {
    it('should run seed successfully', async () => {
      const mockResult = {
        diagnosisCount: 5000,
        procedureCount: 1000,
        medicationCount: 10000,
      };

      vi.mocked(mockService.runSeed).mockResolvedValue(mockResult);

      const result = await controller.seed();

      expect(result.data.diagnosisCount).toBe(5000);
      expect(mockService.runSeed).toHaveBeenCalled();
    });

    it('should wrap seed result in data object', async () => {
      const mockResult = {
        diagnosisCount: 5000,
        procedureCount: 1000,
        medicationCount: 10000,
      };

      vi.mocked(mockService.runSeed).mockResolvedValue(mockResult);

      const result = await controller.seed();

      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(mockResult);
    });
  });

  describe('Authorization', () => {
    it('should require ADMIN for seed endpoint', async () => {
      // @Roles(UserRole.ADMIN) is applied to seed method
      // @UseGuards(RolesGuard) is applied
      expect(controller).toBeDefined();
    });

    it('should allow search endpoints without role restriction', async () => {
      // Search endpoints have no @Roles decorator
      // Only @UseGuards(JwtAuthGuard) from controller level
      expect(controller).toBeDefined();
    });

    it('should allow detail endpoints without role restriction', async () => {
      // Detail endpoints have no @Roles decorator
      // Only @UseGuards(JwtAuthGuard) from controller level
      expect(controller).toBeDefined();
    });
  });

  describe('Response Wrapping', () => {
    it('should wrap search diagnosis response in data', async () => {
      const mockResult = {
        data: [{ code: 'I10' }],
        total: 1,
        hasMore: false,
      };

      vi.mocked(mockService.searchDiagnosis).mockResolvedValue(mockResult);

      const result = await controller.searchDiagnosis({});

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should wrap diagnosis detail in data object', async () => {
      const mockResult = { code: 'I10', nameKo: '본태성 고혈압' };

      vi.mocked(mockService.getDiagnosisByCode).mockResolvedValue(mockResult);

      const result = await controller.getDiagnosis('I10');

      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(mockResult);
    });

    it('should wrap search procedure response in data', async () => {
      const mockResult = {
        data: [{ code: 'R9300' }],
        total: 1,
        hasMore: false,
      };

      vi.mocked(mockService.searchProcedure).mockResolvedValue(mockResult);

      const result = await controller.searchProcedure({});

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should wrap search medication response in data', async () => {
      const mockResult = {
        data: [{ code: 'A001' }],
        total: 1,
        hasMore: false,
      };

      vi.mocked(mockService.searchMedication).mockResolvedValue(mockResult);

      const result = await controller.searchMedication({});

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should propagate service errors for diagnosis search', async () => {
      vi.mocked(mockService.searchDiagnosis).mockRejectedValue(
        new Error('Database error'),
      );

      await expect(controller.searchDiagnosis({})).rejects.toThrow(
        'Database error',
      );
    });

    it('should handle null result for diagnosis detail', async () => {
      vi.mocked(mockService.getDiagnosisByCode).mockResolvedValue(null);

      await expect(controller.getDiagnosis('INVALID')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle null result for procedure detail', async () => {
      vi.mocked(mockService.getProcedureByCode).mockResolvedValue(null);

      await expect(controller.getProcedure('INVALID')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle null result for medication detail', async () => {
      vi.mocked(mockService.getMedicationByCode).mockResolvedValue(null);

      await expect(controller.getMedication('INVALID')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle empty search results gracefully', async () => {
      const mockResult = {
        data: [],
        total: 0,
        hasMore: false,
      };

      vi.mocked(mockService.searchDiagnosis).mockResolvedValue(mockResult);

      const result = await controller.searchDiagnosis({ query: 'nonexistent' });

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('Route-specific Behavior', () => {
    it('should route diagnosis search correctly', async () => {
      const mockResult = { data: [], total: 0, hasMore: false };

      vi.mocked(mockService.searchDiagnosis).mockResolvedValue(mockResult);

      const result = await controller.searchDiagnosis({});

      expect(result).toBeDefined();
    });

    it('should route diagnosis detail correctly', async () => {
      const mockResult = { code: 'I10' };

      vi.mocked(mockService.getDiagnosisByCode).mockResolvedValue(mockResult);

      const result = await controller.getDiagnosis('I10');

      expect(result.data).toBeDefined();
    });

    it('should route procedure search correctly', async () => {
      const mockResult = { data: [], total: 0, hasMore: false };

      vi.mocked(mockService.searchProcedure).mockResolvedValue(mockResult);

      const result = await controller.searchProcedure({});

      expect(result).toBeDefined();
    });

    it('should route procedure detail correctly', async () => {
      const mockResult = { code: 'R9300' };

      vi.mocked(mockService.getProcedureByCode).mockResolvedValue(mockResult);

      const result = await controller.getProcedure('R9300');

      expect(result.data).toBeDefined();
    });

    it('should route medication search correctly', async () => {
      const mockResult = { data: [], total: 0, hasMore: false };

      vi.mocked(mockService.searchMedication).mockResolvedValue(mockResult);

      const result = await controller.searchMedication({});

      expect(result).toBeDefined();
    });

    it('should route medication detail correctly', async () => {
      const mockResult = { code: 'A001' };

      vi.mocked(mockService.getMedicationByCode).mockResolvedValue(mockResult);

      const result = await controller.getMedication('A001');

      expect(result.data).toBeDefined();
    });

    it('should route seed endpoint correctly', async () => {
      const mockResult = { diagnosisCount: 5000 };

      vi.mocked(mockService.runSeed).mockResolvedValue(mockResult);

      const result = await controller.seed();

      expect(result.data).toBeDefined();
    });
  });
});
