import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrthopedicsController } from '../../src/modules/orthopedics/orthopedics.controller';

describe('OrthopedicsController', () => {
  let controller: OrthopedicsController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getPatients: vi.fn(),
      getExams: vi.fn(),
      createExam: vi.fn(),
      getToday: vi.fn(),
      getStats: vi.fn(),
    };
    controller = new OrthopedicsController(mockService);
  });

  describe('getPatients', () => {
    it('should return { data: patients }', async () => {
      const patients = [{ patientId: 'p-1', familyName: '김', givenName: '철수' }];
      mockService.getPatients.mockResolvedValue({ items: patients, total: patients.length, limit: 100, truncated: false });
      const result = await controller.getPatients();
      expect(result).toEqual({ data: patients, meta: { total: patients.length, limit: 100, truncated: false } });
    });

    it('should call service.getPatients', async () => {
      mockService.getPatients.mockResolvedValue({ items: [], total: [].length, limit: 100, truncated: false });
      await controller.getPatients();
      expect(mockService.getPatients).toHaveBeenCalled();
    });

    it('should return empty data when no patients', async () => {
      mockService.getPatients.mockResolvedValue({ items: [], total: [].length, limit: 100, truncated: false });
      const result = await controller.getPatients();
      expect(result.data).toEqual([]);
    });
  });

  describe('getExams', () => {
    it('should return { data: exams } for given patientId', async () => {
      const exams = [{ id: 'e-1', bodyPart: 'Knee' }];
      mockService.getExams.mockResolvedValue(exams);
      const result = await controller.getExams('patient-uuid-1');
      expect(result).toEqual({ data: exams });
      expect(mockService.getExams).toHaveBeenCalledWith('patient-uuid-1');
    });

    it('should pass patientId to service', async () => {
      mockService.getExams.mockResolvedValue([]);
      await controller.getExams('p-123');
      expect(mockService.getExams).toHaveBeenCalledWith('p-123');
    });

    it('should return empty data when no exams found', async () => {
      mockService.getExams.mockResolvedValue([]);
      const result = await controller.getExams('p-none');
      expect(result.data).toEqual([]);
    });
  });

  describe('createExam', () => {
    it('should return { data: created exam }', async () => {
      const body = { patientId: 'p-1', bodyPart: 'Shoulder' };
      const created = { id: 'e-new', ...body, examinedBy: 'doc-1' };
      mockService.createExam.mockResolvedValue(created);
      const result = await controller.createExam(body as any, 'doc-1');
      expect(result).toEqual({ data: created });
    });

    it('should merge userId as examinedBy', async () => {
      const body = { patientId: 'p-1', bodyPart: 'Hip' };
      mockService.createExam.mockResolvedValue({ id: 'e-2' });
      await controller.createExam(body as any, 'doctor-uuid-1');
      expect(mockService.createExam).toHaveBeenCalledWith({ ...body, examinedBy: 'doctor-uuid-1' });
    });

    it('should pass all body fields to service', async () => {
      const body = { patientId: 'p-1', bodyPart: 'Knee', side: 'RIGHT', painVas: 5 };
      mockService.createExam.mockResolvedValue({ id: 'e-3' });
      await controller.createExam(body as any, 'doc-1');
      expect(mockService.createExam).toHaveBeenCalledWith({ ...body, examinedBy: 'doc-1' });
    });
  });

  describe('getToday', () => {
    it('should return { data: today schedule }', async () => {
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
      const stats = { totalExams: 10, todayAppointments: 0, completed: 0, inProgress: 0, waiting: 0 };
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
