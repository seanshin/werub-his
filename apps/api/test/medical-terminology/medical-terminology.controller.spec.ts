import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MedicalTerminologyController } from '../../src/modules/medical-terminology/medical-terminology.controller';
import { MedicalTerminologyService } from '../../src/modules/medical-terminology/medical-terminology.service';

describe('MedicalTerminologyController', () => {
  let controller: MedicalTerminologyController;
  let service: MedicalTerminologyService;

  beforeEach(() => {
    service = {
      createDiagnosisCode: vi.fn(),
      updateDiagnosisCode: vi.fn(),
      deleteDiagnosisCode: vi.fn(),
      searchDiagnosisCodes: vi.fn(),
      getDiagnosisCodeDetail: vi.fn(),
      createMedicationCode: vi.fn(),
      updateMedicationCode: vi.fn(),
      deleteMedicationCode: vi.fn(),
      searchMedicationCodes: vi.fn(),
      getMedicationCodeDetail: vi.fn(),
      checkDrugInteractions: vi.fn(),
      checkDUR: vi.fn(),
      checkContraindications: vi.fn(),
      importDiagnosisCodes: vi.fn(),
      importMedicationCodes: vi.fn(),
    } as any;

    controller = new MedicalTerminologyController(service);
  });

  describe('createDiagnosisCode', () => {
    it('should create diagnosis code and return 201', async () => {
      const dto = {
        codeSystem: 'KCD-8',
        code: 'K123',
        nameKo: '당뇨병',
        validFrom: '2026-01-01',
      };

      const mockCode = { id: 'diag-1', ...dto, validTo: null, isActive: true };
      vi.mocked(service.createDiagnosisCode).mockResolvedValue(mockCode);

      const result = await controller.createDiagnosisCode(dto);

      expect(result.data).toEqual(mockCode);
      expect(result.meta.status).toBe('created');
    });
  });

  describe('searchDiagnosisCodes', () => {
    it('should return paginated diagnosis codes', async () => {
      const mockResults = [{ id: 'diag-1', code: 'K123', nameKo: '당뇨병' }];
      const mockTotal = 1;

      vi.mocked(service.searchDiagnosisCodes).mockResolvedValue({
        results: mockResults,
        total: mockTotal,
        page: 1,
        limit: 50,
      } as any);

      const result = await controller.searchDiagnosisCodes({
        codeSystem: 'KCD-8',
        page: 1,
        limit: 50,
      });

      expect(result.data).toEqual(mockResults);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('getDiagnosisCodeDetail', () => {
    it('should return diagnosis code detail', async () => {
      const mockCode = {
        id: 'diag-1',
        code: 'K123',
        nameKo: '당뇨병',
        encounterDiagnoses: [],
        problemLists: [],
      };

      vi.mocked(service.getDiagnosisCodeDetail).mockResolvedValue(mockCode as any);

      const result = await controller.getDiagnosisCodeDetail('diag-1');

      expect(result.data).toEqual(mockCode);
    });
  });

  describe('updateDiagnosisCode', () => {
    it('should update diagnosis code', async () => {
      const dto = { nameKo: '제2형 당뇨병' };
      const mockCode = { id: 'diag-1', code: 'K123', nameKo: '제2형 당뇨병' };

      vi.mocked(service.updateDiagnosisCode).mockResolvedValue(mockCode as any);

      const result = await controller.updateDiagnosisCode('diag-1', dto);

      expect(result.data).toEqual(mockCode);
    });
  });

  describe('createMedicationCode', () => {
    it('should create medication code', async () => {
      const dto = {
        code: 'MED001',
        nameKo: '아스피린',
        ingredient: 'Aspirin 100mg',
        validFrom: '2026-01-01',
      };

      const mockMed = { id: 'med-1', ...dto, validTo: null, isActive: true };
      vi.mocked(service.createMedicationCode).mockResolvedValue(mockMed);

      const result = await controller.createMedicationCode(dto);

      expect(result.data).toEqual(mockMed);
      expect(result.meta.status).toBe('created');
    });
  });

  describe('searchMedicationCodes', () => {
    it('should search medication codes', async () => {
      const mockResults = [{ id: 'med-1', code: 'MED001', nameKo: '아스피린' }];

      vi.mocked(service.searchMedicationCodes).mockResolvedValue({
        results: mockResults,
        total: 1,
        page: 1,
        limit: 50,
      } as any);

      const result = await controller.searchMedicationCodes({
        keyword: '아스',
        page: 1,
        limit: 50,
      });

      expect(result.data).toEqual(mockResults);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('checkDrugInteractions', () => {
    it('should return interaction warnings', async () => {
      const dto = { medicationCodes: ['WARFARIN', 'ASPIRIN'] };

      const mockResult = {
        isValid: false,
        warnings: [
          {
            severity: 'HIGH',
            interactingDrug1: 'WARFARIN',
            interactingDrug2: 'ASPIRIN',
            description: 'Increased bleeding risk',
            recommendation: 'Monitor bleeding parameters',
          },
        ],
      };

      vi.mocked(service.checkDrugInteractions).mockResolvedValue(mockResult as any);

      const result = await controller.checkDrugInteractions(dto);

      expect(result.data.isValid).toBe(false);
      expect(result.data.warnings).toHaveLength(1);
      expect(result.data.warnings[0].severity).toBe('HIGH');
    });

    it('should return isValid=true when no interactions', async () => {
      const dto = { medicationCodes: ['IBUPROFEN', 'ACETAMINOPHEN'] };

      const mockResult = {
        isValid: true,
        warnings: [],
      };

      vi.mocked(service.checkDrugInteractions).mockResolvedValue(mockResult as any);

      const result = await controller.checkDrugInteractions(dto);

      expect(result.data.isValid).toBe(true);
      expect(result.data.warnings).toHaveLength(0);
    });
  });

  describe('checkDUR', () => {
    it('should return DUR warnings', async () => {
      const dto = {
        medicationCode: 'MED001',
        prescriptionDays: 120,
        patientAge: 75,
      };

      const mockResult = {
        isValid: true,
        warnings: [
          {
            ruleCode: 'DUR001',
            ruleName: '장기처방 제한',
            severity: 'WARNING',
            description: 'Prescription exceeds 90 days',
            recommendation: 'Review necessity',
          },
          {
            ruleCode: 'DUR002',
            ruleName: '고령자 용량 확인',
            severity: 'WARNING',
            description: 'Consider dose reduction for elderly',
            recommendation: 'Verify dose appropriateness',
          },
        ],
      };

      vi.mocked(service.checkDUR).mockResolvedValue(mockResult as any);

      const result = await controller.checkDUR(dto);

      expect(result.data.warnings).toHaveLength(2);
      expect(result.data.warnings[0].ruleCode).toBe('DUR001');
    });

    it('should detect severe renal impairment error', async () => {
      const dto = {
        medicationCode: 'MED001',
        egfr: 20,
      };

      const mockResult = {
        isValid: false,
        warnings: [
          {
            ruleCode: 'DUR003',
            ruleName: '신기능 저하 약물 조정',
            severity: 'ERROR',
            description: 'Dose adjustment needed',
            recommendation: 'Reduce dose by 50%',
          },
        ],
      };

      vi.mocked(service.checkDUR).mockResolvedValue(mockResult as any);

      const result = await controller.checkDUR(dto);

      expect(result.data.isValid).toBe(false);
      expect(result.data.warnings[0].severity).toBe('ERROR');
    });
  });

  describe('checkContraindications', () => {
    it('should detect contraindication in pregnancy', async () => {
      const dto = {
        medicationCode: 'ACE_INHIBITOR',
        diagnosisCode: 'diag-1',
        isPregnant: true,
      };

      const mockResult = {
        isValid: false,
        warnings: [
          {
            severity: 'CONTRAINDICATED',
            interactingDrug1: 'ACE_INHIBITOR',
            interactingDrug2: 'PREGNANCY',
            description: 'Contraindicated in pregnancy',
            recommendation: 'Use alternative medication',
          },
        ],
      };

      vi.mocked(service.checkContraindications).mockResolvedValue(mockResult as any);

      const result = await controller.checkContraindications(dto);

      expect(result.data.isValid).toBe(false);
      expect(result.data.warnings[0].severity).toBe('CONTRAINDICATED');
    });
  });

  describe('importDiagnosisCodes', () => {
    it('should import diagnosis codes in bulk', async () => {
      const codes = [
        { codeSystem: 'KCD-8', code: 'K123', nameKo: '당뇨병', validFrom: '2026-01-01' },
        { codeSystem: 'KCD-8', code: 'K124', nameKo: '고혈압', validFrom: '2026-01-01' },
      ];

      const mockResult = { created: 2, errors: [] };
      vi.mocked(service.importDiagnosisCodes).mockResolvedValue(mockResult);

      const result = await controller.importDiagnosisCodes(codes as any);

      expect(result.data.created).toBe(2);
      expect(result.meta.status).toBe('imported');
    });
  });

  describe('importMedicationCodes', () => {
    it('should import medication codes in bulk', async () => {
      const codes = [
        { code: 'MED001', nameKo: '아스피린', validFrom: '2026-01-01' },
        { code: 'MED002', nameKo: '아세트아미노펜', validFrom: '2026-01-01' },
      ];

      const mockResult = { created: 2, errors: [] };
      vi.mocked(service.importMedicationCodes).mockResolvedValue(mockResult);

      const result = await controller.importMedicationCodes(codes as any);

      expect(result.data.created).toBe(2);
      expect(result.meta.status).toBe('imported');
    });
  });
});
