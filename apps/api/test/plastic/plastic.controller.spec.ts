import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlasticController } from '../../src/modules/plastic/plastic.controller';

describe('PlasticController', () => {
  let controller: PlasticController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getPatients: vi.fn(),
      getExams: vi.fn(),
      createExam: vi.fn(),
      getToday: vi.fn(),
      getStats: vi.fn(),
    };
    controller = new PlasticController(mockService);
  });

  describe('getPatients', () => {
    it('should return { data: patients }', async () => {
      const patients = [{ patientId: 'p-1' }];
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

  describe('getExams', () => {
    it('should return { data: exams }', async () => {
      const exams = [{ id: 'e-1', bodyPart: 'Nose' }];
      mockService.getExams.mockResolvedValue(exams);
      const result = await controller.getExams('p-1');
      expect(result).toEqual({ data: exams });
      expect(mockService.getExams).toHaveBeenCalledWith('p-1');
    });

    it('should pass patientId to service', async () => {
      mockService.getExams.mockResolvedValue([]);
      await controller.getExams('patient-uuid-1');
      expect(mockService.getExams).toHaveBeenCalledWith('patient-uuid-1');
    });
  });

  describe('createExam', () => {
    it('should return { data: created }', async () => {
      const body = { patientId: 'p-1', bodyPart: 'Eyelid', procedure: 'Blepharoplasty' };
      mockService.createExam.mockResolvedValue({ id: 'e-new' });
      const result = await controller.createExam(body as any, 'doc-1');
      expect(result).toEqual({ data: { id: 'e-new' } });
    });

    it('should merge userId as examinedBy', async () => {
      const body = { patientId: 'p-1', bodyPart: 'Nose', procedure: 'Rhinoplasty' };
      mockService.createExam.mockResolvedValue({ id: 'e-2' });
      await controller.createExam(body as any, 'doctor-uuid-1');
      expect(mockService.createExam).toHaveBeenCalledWith({ ...body, examinedBy: 'doctor-uuid-1' });
    });

    it('should pass all body fields', async () => {
      const body = { patientId: 'p-1', bodyPart: 'Face', procedure: 'Facelift', fitzpatrickType: 3, duration: 120 };
      mockService.createExam.mockResolvedValue({ id: 'e-3' });
      await controller.createExam(body as any, 'doc-1');
      expect(mockService.createExam).toHaveBeenCalledWith({ ...body, examinedBy: 'doc-1' });
    });
  });

  describe('getToday', () => {
    it('should return { data: [] }', async () => {
      mockService.getToday.mockResolvedValue([]);
      const result = await controller.getToday();
      expect(result).toEqual({ data: [] });
    });

    it('should call service.getToday', async () => {
      mockService.getToday.mockResolvedValue([]);
      await controller.getToday();
      expect(mockService.getToday).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return { data: stats }', async () => {
      const stats = { totalExams: 22 };
      mockService.getStats.mockResolvedValue(stats);
      const result = await controller.getStats();
      expect(result).toEqual({ data: stats });
    });

    it('should call service.getStats', async () => {
      mockService.getStats.mockResolvedValue({});
      await controller.getStats();
      expect(mockService.getStats).toHaveBeenCalled();
    });
  });
});
