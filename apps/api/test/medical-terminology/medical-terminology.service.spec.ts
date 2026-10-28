import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MedicalTerminologyService } from '../../src/modules/medical-terminology/medical-terminology.service';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';

describe('MedicalTerminologyService', () => {
  let service: MedicalTerminologyService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      diagnosisCode: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      medicationCode: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      encounterDiagnosis: {
        findFirst: vi.fn(),
      },
      prescription: {
        findFirst: vi.fn(),
      },
    };

    service = new MedicalTerminologyService(mockPrisma);
  });

  // ============================================================
  // Diagnosis Code Tests
  // ============================================================

  describe('createDiagnosisCode', () => {
    it('should create diagnosis code', async () => {
      const dto = {
        codeSystem: 'KCD-8',
        code: 'K123',
        nameKo: '당뇨병',
        validFrom: '2026-01-01',
      };

      mockPrisma.diagnosisCode.findUnique.mockResolvedValue(null);
      mockPrisma.diagnosisCode.create.mockResolvedValue({
        id: 'diag-1',
        ...dto,
        validFrom: new Date(dto.validFrom),
        validTo: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createDiagnosisCode(dto);

      expect(result.code).toBe('K123');
      expect(mockPrisma.diagnosisCode.create).toHaveBeenCalled();
    });

    it('should throw ConflictException if code exists', async () => {
      const dto = {
        codeSystem: 'KCD-8',
        code: 'K123',
        nameKo: '당뇨병',
        validFrom: '2026-01-01',
      };

      mockPrisma.diagnosisCode.findUnique.mockResolvedValue({ id: 'diag-1' });

      await expect(service.createDiagnosisCode(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('updateDiagnosisCode', () => {
    it('should update diagnosis code', async () => {
      const existing = {
        id: 'diag-1',
        codeSystem: 'KCD-8',
        code: 'K123',
        nameKo: '당뇨병',
        nameEn: 'Diabetes',
        isActive: true,
      };

      mockPrisma.diagnosisCode.findUnique.mockResolvedValue(existing);
      mockPrisma.diagnosisCode.update.mockResolvedValue({
        ...existing,
        nameKo: '제2형 당뇨병',
      });

      const result = await service.updateDiagnosisCode('diag-1', { nameKo: '제2형 당뇨병' });

      expect(result.nameKo).toBe('제2형 당뇨병');
    });

    it('should throw NotFoundException if code not found', async () => {
      mockPrisma.diagnosisCode.findUnique.mockResolvedValue(null);

      await expect(service.updateDiagnosisCode('diag-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('searchDiagnosisCodes', () => {
    it('should search diagnosis codes with pagination', async () => {
      const mockResults = [
        { id: 'diag-1', code: 'K123', nameKo: '당뇨병' },
        { id: 'diag-2', code: 'K124', nameKo: '고혈압' },
      ];

      mockPrisma.diagnosisCode.findMany.mockResolvedValue(mockResults);
      mockPrisma.diagnosisCode.count.mockResolvedValue(2);

      const result = await service.searchDiagnosisCodes({
        codeSystem: 'KCD-8',
        page: 1,
        limit: 50,
      });

      expect(result.results).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  // ============================================================
  // Medication Code Tests
  // ============================================================

  describe('createMedicationCode', () => {
    it('should create medication code', async () => {
      const dto = {
        code: 'MED001',
        nameKo: '아스피린',
        ingredient: 'Aspirin 100mg',
        validFrom: '2026-01-01',
      };

      mockPrisma.medicationCode.findUnique.mockResolvedValue(null);
      mockPrisma.medicationCode.create.mockResolvedValue({
        id: 'med-1',
        ...dto,
        validFrom: new Date(dto.validFrom),
        validTo: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createMedicationCode(dto);

      expect(result.code).toBe('MED001');
      expect(result.nameKo).toBe('아스피린');
    });
  });

  describe('updateMedicationCode', () => {
    it('should update medication code', async () => {
      const existing = {
        id: 'med-1',
        code: 'MED001',
        nameKo: '아스피린',
        isActive: true,
      };

      mockPrisma.medicationCode.findUnique.mockResolvedValue(existing);
      mockPrisma.medicationCode.update.mockResolvedValue({
        ...existing,
        nameKo: '아스피린 500mg',
      });

      const result = await service.updateMedicationCode('med-1', { nameKo: '아스피린 500mg' });

      expect(result.nameKo).toBe('아스피린 500mg');
    });
  });

  describe('searchMedicationCodes', () => {
    it('should search medication codes with keyword', async () => {
      const mockResults = [
        { id: 'med-1', code: 'MED001', nameKo: '아스피린' },
        { id: 'med-2', code: 'MED002', nameKo: '아세트아미노펜' },
      ];

      mockPrisma.medicationCode.findMany.mockResolvedValue(mockResults);
      mockPrisma.medicationCode.count.mockResolvedValue(2);

      const result = await service.searchMedicationCodes({
        keyword: '아스피',
        page: 1,
        limit: 50,
      });

      expect(result.results).toHaveLength(2);
    });
  });

  // ============================================================
  // Drug Interaction Tests
  // ============================================================

  describe('checkDrugInteractions', () => {
    it('should detect interaction between WARFARIN and ASPIRIN', async () => {
      mockPrisma.medicationCode.findMany.mockResolvedValue([
        { id: 'med-1', code: 'WARFARIN' },
        { id: 'med-2', code: 'ASPIRIN' },
      ]);

      const result = await service.checkDrugInteractions({
        medicationCodes: ['WARFARIN', 'ASPIRIN'],
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].severity).toBe('HIGH');
      expect(result.warnings[0].description).toContain('bleeding');
    });

    it('should return isValid=true when no interactions', async () => {
      mockPrisma.medicationCode.findMany.mockResolvedValue([
        { id: 'med-1', code: 'IBUPROFEN' },
        { id: 'med-2', code: 'ACETAMINOPHEN' },
      ]);

      const result = await service.checkDrugInteractions({
        medicationCodes: ['IBUPROFEN', 'ACETAMINOPHEN'],
      });

      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should throw error for non-existent medication code', async () => {
      mockPrisma.medicationCode.findMany.mockResolvedValue([{ id: 'med-1', code: 'WARFARIN' }]);

      await expect(
        service.checkDrugInteractions({
          medicationCodes: ['WARFARIN', 'NONEXISTENT'],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================================
  // DUR Tests
  // ============================================================

  describe('checkDUR', () => {
    it('should detect long prescription warning', async () => {
      mockPrisma.medicationCode.findUnique.mockResolvedValue({
        id: 'med-1',
        code: 'MED001',
      });

      const result = await service.checkDUR({
        medicationCode: 'MED001',
        prescriptionDays: 120,
      });

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].ruleCode).toBe('DUR001');
    });

    it('should detect elderly patient warning', async () => {
      mockPrisma.medicationCode.findUnique.mockResolvedValue({
        id: 'med-1',
        code: 'MED001',
      });

      const result = await service.checkDUR({
        medicationCode: 'MED001',
        patientAge: 75,
      });

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].ruleCode).toBe('DUR002');
    });

    it('should detect severe renal impairment error', async () => {
      mockPrisma.medicationCode.findUnique.mockResolvedValue({
        id: 'med-1',
        code: 'MED001',
      });

      const result = await service.checkDUR({
        medicationCode: 'MED001',
        egfr: 20,
      });

      expect(result.isValid).toBe(false);
      expect(result.warnings[0].severity).toBe('ERROR');
    });
  });

  // ============================================================
  // Contraindication Tests
  // ============================================================

  describe('checkContraindications', () => {
    it('should detect contraindication in pregnancy', async () => {
      mockPrisma.medicationCode.findUnique.mockResolvedValue({
        id: 'med-1',
        code: 'ACE_INHIBITOR',
      });
      mockPrisma.diagnosisCode.findUnique.mockResolvedValue({
        id: 'diag-1',
        code: 'O99',
      });

      const result = await service.checkContraindications({
        medicationCode: 'ACE_INHIBITOR',
        diagnosisCode: 'diag-1',
        isPregnant: true,
      });

      expect(result.isValid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should be valid when no contraindication', async () => {
      mockPrisma.medicationCode.findUnique.mockResolvedValue({
        id: 'med-1',
        code: 'IBUPROFEN',
      });
      mockPrisma.diagnosisCode.findUnique.mockResolvedValue({
        id: 'diag-1',
        code: 'K123',
      });

      const result = await service.checkContraindications({
        medicationCode: 'IBUPROFEN',
        diagnosisCode: 'diag-1',
        isPregnant: false,
      });

      expect(result.isValid).toBe(true);
    });
  });

  // ============================================================
  // Bulk Import Tests
  // ============================================================

  describe('importDiagnosisCodes', () => {
    it('should import multiple diagnosis codes', async () => {
      const codes = [
        { codeSystem: 'KCD-8', code: 'K123', nameKo: '당뇨병', validFrom: '2026-01-01' },
        { codeSystem: 'KCD-8', code: 'K124', nameKo: '고혈압', validFrom: '2026-01-01' },
      ];

      mockPrisma.diagnosisCode.findUnique.mockResolvedValue(null);
      mockPrisma.diagnosisCode.create.mockImplementation((args: any) => ({
        id: 'diag-' + Date.now(),
        ...args.data,
      }));

      const result = await service.importDiagnosisCodes(codes as any);

      expect(result.created).toBe(2);
      expect(result.errors).toHaveLength(0);
    });
  });
});
