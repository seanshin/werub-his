import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PsychiatryController } from '../../src/modules/psychiatry/psychiatry.controller';

describe('PsychiatryController', () => {
  let controller: PsychiatryController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getPatients: vi.fn(),
      getExams: vi.fn(),
      createExam: vi.fn(),
      getScoreTrend: vi.fn(),
      getToday: vi.fn(),
      getStats: vi.fn(),
    };
    controller = new PsychiatryController(mockService);
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
      const exams = [{ id: 'e-1', mood: 'depressed' }];
      mockService.getExams.mockResolvedValue(exams);
      const result = await controller.getExams('p-1');
      expect(result).toEqual({ data: exams });
      expect(mockService.getExams).toHaveBeenCalledWith('p-1');
    });

    it('should pass patientId correctly', async () => {
      mockService.getExams.mockResolvedValue([]);
      await controller.getExams('patient-uuid-1');
      expect(mockService.getExams).toHaveBeenCalledWith('patient-uuid-1');
    });
  });

  describe('createExam', () => {
    it('should return { data: created }', async () => {
      const body = { patientId: 'p-1', mood: 'anxious', phq9: 12 };
      mockService.createExam.mockResolvedValue({ id: 'e-new' });
      const result = await controller.createExam(body as any, 'doc-1');
      expect(result).toEqual({ data: { id: 'e-new' } });
    });

    it('should merge userId as examinedBy', async () => {
      const body = { patientId: 'p-1', mood: 'neutral' };
      mockService.createExam.mockResolvedValue({ id: 'e-2' });
      await controller.createExam(body as any, 'doctor-uuid-1');
      expect(mockService.createExam).toHaveBeenCalledWith({ ...body, examinedBy: 'doctor-uuid-1' });
    });

    it('should pass all body fields to service', async () => {
      const body = { patientId: 'p-1', mood: 'depressed', affect: 'flat', phq9: 20, gad7: 15, suicideRisk: 'HIGH' };
      mockService.createExam.mockResolvedValue({ id: 'e-3' });
      await controller.createExam(body as any, 'doc-1');
      expect(mockService.createExam).toHaveBeenCalledWith({ ...body, examinedBy: 'doc-1' });
    });
  });

  describe('getScoreTrend', () => {
    it('should return { data: trend }', async () => {
      const trend = [{ date: new Date(), phq9: 15, gad7: 12, mmse: 26 }];
      mockService.getScoreTrend.mockResolvedValue(trend);
      const result = await controller.getScoreTrend('p-1');
      expect(result).toEqual({ data: trend });
      expect(mockService.getScoreTrend).toHaveBeenCalledWith('p-1');
    });

    it('should pass patientId to service', async () => {
      mockService.getScoreTrend.mockResolvedValue([]);
      await controller.getScoreTrend('patient-uuid-1');
      expect(mockService.getScoreTrend).toHaveBeenCalledWith('patient-uuid-1');
    });
  });

  describe('getToday', () => {
    it('should return { data: [] }', async () => {
      mockService.getToday.mockResolvedValue([]);
      const result = await controller.getToday();
      expect(result).toEqual({ data: [] });
    });
  });

  describe('getStats', () => {
    it('should return { data: stats }', async () => {
      const stats = { totalExams: 30 };
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
