import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InternalMedicineController } from '../../src/modules/internal-medicine/internal-medicine.controller';

describe('InternalMedicineController', () => {
  let controller: InternalMedicineController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getPatients: vi.fn(),
      getExams: vi.fn(),
      createExam: vi.fn(),
      getToday: vi.fn(),
      getStats: vi.fn(),
      getScoreTrend: vi.fn(),
      calculate: vi.fn(),
    };
    controller = new InternalMedicineController(mockService);
  });

  describe('getPatients', () => {
    it('should return { data: patients }', async () => {
      const patients = [{ patientId: 'p-1', subspecialties: ['CARDIOLOGY'] }];
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
    it('should return exams without subspecialty filter', async () => {
      const exams = [{ id: 'e-1', subspecialty: 'CARDIOLOGY' }];
      mockService.getExams.mockResolvedValue(exams);
      const result = await controller.getExams('p-1', undefined);
      expect(result).toEqual({ data: exams });
      expect(mockService.getExams).toHaveBeenCalledWith('p-1', undefined);
    });

    it('should pass subspecialty filter to service', async () => {
      mockService.getExams.mockResolvedValue([]);
      await controller.getExams('p-1', 'NEPHROLOGY');
      expect(mockService.getExams).toHaveBeenCalledWith('p-1', 'NEPHROLOGY');
    });

    it('should pass patientId correctly', async () => {
      mockService.getExams.mockResolvedValue([]);
      await controller.getExams('patient-uuid-1');
      expect(mockService.getExams).toHaveBeenCalledWith('patient-uuid-1', undefined);
    });
  });

  describe('createExam', () => {
    it('should return { data: created }', async () => {
      const body = { patientId: 'p-1', subspecialty: 'CARDIOLOGY', nyhaClass: 2 };
      mockService.createExam.mockResolvedValue({ id: 'e-new' });
      const result = await controller.createExam(body as any, 'doc-1');
      expect(result).toEqual({ data: { id: 'e-new' } });
    });

    it('should merge userId as examinedBy', async () => {
      const body = { patientId: 'p-1', subspecialty: 'GASTRO' };
      mockService.createExam.mockResolvedValue({ id: 'e-2' });
      await controller.createExam(body as any, 'doctor-uuid-1');
      expect(mockService.createExam).toHaveBeenCalledWith({ ...body, examinedBy: 'doctor-uuid-1' });
    });

    it('should pass all body fields', async () => {
      const body = { patientId: 'p-1', subspecialty: 'PULMONOLOGY', fev1: 2.5, fvc: 3.5, goldStage: 2 };
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
      const stats = { totalExams: 100, bySubspecialty: [] };
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

  describe('getScoreTrend', () => {
    it('should return { data: trend }', async () => {
      const trend = [{ id: 't-1', cha2ds2vasc: 3 }];
      mockService.getScoreTrend.mockResolvedValue(trend);
      const result = await controller.getScoreTrend('p-1', undefined);
      expect(result).toEqual({ data: trend });
      expect(mockService.getScoreTrend).toHaveBeenCalledWith('p-1', undefined);
    });

    it('should pass subspecialty filter', async () => {
      mockService.getScoreTrend.mockResolvedValue([]);
      await controller.getScoreTrend('p-1', 'CARDIOLOGY');
      expect(mockService.getScoreTrend).toHaveBeenCalledWith('p-1', 'CARDIOLOGY');
    });

    it('should pass patientId correctly', async () => {
      mockService.getScoreTrend.mockResolvedValue([]);
      await controller.getScoreTrend('patient-uuid-1');
      expect(mockService.getScoreTrend).toHaveBeenCalledWith('patient-uuid-1', undefined);
    });
  });

  describe('calculate', () => {
    it('should return { data: result } for cha2ds2vasc', async () => {
      const calcResult = { score: 6, interpretation: '고위험' };
      mockService.calculate.mockResolvedValue(calcResult);
      const result = await controller.calculate('cha2ds2vasc', { age: 75, female: true });
      expect(result).toEqual({ data: calcResult });
      expect(mockService.calculate).toHaveBeenCalledWith('cha2ds2vasc', { age: 75, female: true });
    });

    it('should pass scoreName and body to service', async () => {
      mockService.calculate.mockResolvedValue({ score: 0 });
      await controller.calculate('curb65', { confusion: false, urea: 5 });
      expect(mockService.calculate).toHaveBeenCalledWith('curb65', { confusion: false, urea: 5 });
    });

    it('should pass child-pugh scoreName', async () => {
      mockService.calculate.mockResolvedValue({ score: 5, class: 'A' });
      await controller.calculate('child-pugh', { bilirubin: 1.5 });
      expect(mockService.calculate).toHaveBeenCalledWith('child-pugh', { bilirubin: 1.5 });
    });

    it('should pass egfr scoreName', async () => {
      mockService.calculate.mockResolvedValue({ score: 70 });
      await controller.calculate('egfr', { creatinine: 1.2, age: 60, female: false });
      expect(mockService.calculate).toHaveBeenCalledWith('egfr', { creatinine: 1.2, age: 60, female: false });
    });

    it('should propagate service errors', async () => {
      mockService.calculate.mockRejectedValue(new Error('Unknown calculator'));
      await expect(controller.calculate('unknown', {})).rejects.toThrow('Unknown calculator');
    });
  });
});
