import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BurnAssessmentController } from '../../src/modules/burn-assessment/burn-assessment.controller';

describe('BurnAssessmentController', () => {
  let controller: BurnAssessmentController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getPatients: vi.fn(),
      getAssessments: vi.fn(),
      createAssessment: vi.fn(),
      calculateTbsa: vi.fn(),
    };
    controller = new BurnAssessmentController(mockService);
  });

  describe('getPatients', () => {
    it('should return { data: patients }', async () => {
      const patients = [{ patientId: 'p-1', lastTbsa: 25 }];
      mockService.getPatients.mockResolvedValue({ items: patients, total: patients.length, limit: 100, truncated: false });
      const result = await controller.getPatients();
      expect(result).toEqual({ data: patients, meta: { total: patients.length, limit: 100, truncated: false } });
    });

    it('should call service.getPatients', async () => {
      mockService.getPatients.mockResolvedValue({ items: [], total: [].length, limit: 100, truncated: false });
      await controller.getPatients();
      expect(mockService.getPatients).toHaveBeenCalled();
    });

    it('should return empty data', async () => {
      mockService.getPatients.mockResolvedValue({ items: [], total: [].length, limit: 100, truncated: false });
      const result = await controller.getPatients();
      expect(result.data).toEqual([]);
    });
  });

  describe('getAssessments', () => {
    it('should return { data: assessments }', async () => {
      const assessments = [{ id: 'a-1', tbsa: 25 }];
      mockService.getAssessments.mockResolvedValue(assessments);
      const result = await controller.getAssessments('p-1');
      expect(result).toEqual({ data: assessments });
      expect(mockService.getAssessments).toHaveBeenCalledWith('p-1');
    });

    it('should pass patientId to service', async () => {
      mockService.getAssessments.mockResolvedValue([]);
      await controller.getAssessments('patient-uuid-1');
      expect(mockService.getAssessments).toHaveBeenCalledWith('patient-uuid-1');
    });

    it('should return empty data when no assessments', async () => {
      mockService.getAssessments.mockResolvedValue([]);
      const result = await controller.getAssessments('p-none');
      expect(result.data).toEqual([]);
    });
  });

  describe('createAssessment', () => {
    it('should return { data: created }', async () => {
      const body = {
        patientId: 'p-1', tbsa: 25,
        regions: [{ region: 'LEFT_ARM', percentage: 9, depth: 'SECOND_DEGREE' }],
      };
      mockService.createAssessment.mockResolvedValue({ id: 'a-new' });
      const result = await controller.createAssessment(body as any, 'doc-1');
      expect(result).toEqual({ data: { id: 'a-new' } });
    });

    it('should merge userId as assessedBy', async () => {
      const body = {
        patientId: 'p-1', tbsa: 10,
        regions: [{ region: 'HAND', percentage: 10, depth: 'FIRST_DEGREE' }],
      };
      mockService.createAssessment.mockResolvedValue({ id: 'a-2' });
      await controller.createAssessment(body as any, 'doctor-uuid-1');
      expect(mockService.createAssessment).toHaveBeenCalledWith({ ...body, assessedBy: 'doctor-uuid-1' });
    });

    it('should pass all body fields', async () => {
      const body = {
        patientId: 'p-1', tbsa: 30,
        regions: [{ region: 'CHEST', percentage: 18, depth: 'THIRD_DEGREE' }],
        mechanism: 'FLAME', isChild: false, notes: 'house fire',
      };
      mockService.createAssessment.mockResolvedValue({ id: 'a-3' });
      await controller.createAssessment(body as any, 'doc-1');
      expect(mockService.createAssessment).toHaveBeenCalledWith({ ...body, assessedBy: 'doc-1' });
    });
  });

  describe('calculateTbsa', () => {
    it('should return { data: tbsa result }', async () => {
      const body = {
        regions: [{ region: 'LEFT_ARM', percentage: 9, depth: 'SECOND_DEGREE' }],
        isChild: false,
      };
      const calcResult = { tbsa: 9, byDepth: { SECOND_DEGREE: 9 } };
      mockService.calculateTbsa.mockReturnValue(calcResult);
      const result = await controller.calculateTbsa(body as any);
      expect(result).toEqual({ data: calcResult });
      expect(mockService.calculateTbsa).toHaveBeenCalledWith(body.regions, body.isChild);
    });

    it('should pass regions and isChild to service', async () => {
      const body = {
        regions: [
          { region: 'HEAD', percentage: 18, depth: 'FIRST_DEGREE' },
          { region: 'CHEST', percentage: 18, depth: 'SECOND_DEGREE' },
        ],
        isChild: true,
      };
      mockService.calculateTbsa.mockReturnValue({ tbsa: 36, byDepth: {} });
      await controller.calculateTbsa(body as any);
      expect(mockService.calculateTbsa).toHaveBeenCalledWith(body.regions, true);
    });

    it('should handle empty regions', async () => {
      const body = { regions: [], isChild: false };
      mockService.calculateTbsa.mockReturnValue({ tbsa: 0, byDepth: {} });
      const result = await controller.calculateTbsa(body as any);
      expect(result.data.tbsa).toBe(0);
    });

    it('should pass isChild flag correctly for child patient', async () => {
      const body = {
        regions: [{ region: 'HEAD', percentage: 18, depth: 'SECOND_DEGREE' }],
        isChild: true,
      };
      mockService.calculateTbsa.mockReturnValue({ tbsa: 18, byDepth: { SECOND_DEGREE: 18 } });
      await controller.calculateTbsa(body as any);
      expect(mockService.calculateTbsa).toHaveBeenCalledWith(body.regions, true);
    });
  });
});
