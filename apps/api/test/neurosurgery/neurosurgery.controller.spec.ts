import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NeurosurgeryController } from '../../src/modules/neurosurgery/neurosurgery.controller';

describe('NeurosurgeryController', () => {
  let controller: NeurosurgeryController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getPatients: vi.fn(),
      getExams: vi.fn(),
      createExam: vi.fn(),
      getGcsTrend: vi.fn(),
      getToday: vi.fn(),
      getStats: vi.fn(),
    };
    controller = new NeurosurgeryController(mockService);
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
      const exams = [{ id: 'e-1', gcsTotal: 15 }];
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
      const body = { patientId: 'p-1', gcsTotal: 15 };
      mockService.createExam.mockResolvedValue({ id: 'e-new' });
      const result = await controller.createExam(body as any, 'doc-1');
      expect(result).toEqual({ data: { id: 'e-new' } });
    });

    it('should merge userId as examinedBy', async () => {
      const body = { patientId: 'p-1', gcsEye: 4 };
      mockService.createExam.mockResolvedValue({ id: 'e-2' });
      await controller.createExam(body as any, 'doctor-uuid-1');
      expect(mockService.createExam).toHaveBeenCalledWith({ ...body, examinedBy: 'doctor-uuid-1' });
    });

    it('should pass all fields', async () => {
      const body = { patientId: 'p-1', gcsEye: 3, gcsVerbal: 4, gcsMotor: 5, gcsTotal: 12, nihss: 10 };
      mockService.createExam.mockResolvedValue({ id: 'e-3' });
      await controller.createExam(body as any, 'doc-1');
      expect(mockService.createExam).toHaveBeenCalledWith({ ...body, examinedBy: 'doc-1' });
    });
  });

  describe('getGcsTrend', () => {
    it('should return { data: trend }', async () => {
      const trend = [{ date: new Date(), eye: 4, verbal: 5, motor: 6, total: 15 }];
      mockService.getGcsTrend.mockResolvedValue(trend);
      const result = await controller.getGcsTrend('p-1');
      expect(result).toEqual({ data: trend });
      expect(mockService.getGcsTrend).toHaveBeenCalledWith('p-1');
    });

    it('should pass patientId to service', async () => {
      mockService.getGcsTrend.mockResolvedValue([]);
      await controller.getGcsTrend('patient-uuid-1');
      expect(mockService.getGcsTrend).toHaveBeenCalledWith('patient-uuid-1');
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
      const stats = { totalExams: 18 };
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
