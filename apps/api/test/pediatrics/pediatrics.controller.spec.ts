import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PediatricsController } from '../../src/modules/pediatrics/pediatrics.controller';

describe('PediatricsController', () => {
  let controller: PediatricsController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getPatients: vi.fn(),
      getGrowth: vi.fn(),
      createGrowth: vi.fn(),
      getImmunizations: vi.fn(),
      createImmunization: vi.fn(),
      getDevelopmental: vi.fn(),
      createDevelopmental: vi.fn(),
      getToday: vi.fn(),
      getStats: vi.fn(),
    };
    controller = new PediatricsController(mockService);
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
  });

  describe('getGrowth', () => {
    it('should return { data: growth records }', async () => {
      const growth = [{ id: 'g-1', height: 75 }];
      mockService.getGrowth.mockResolvedValue(growth);
      const result = await controller.getGrowth('p-1');
      expect(result).toEqual({ data: growth });
      expect(mockService.getGrowth).toHaveBeenCalledWith('p-1');
    });

    it('should pass patientId to service', async () => {
      mockService.getGrowth.mockResolvedValue([]);
      await controller.getGrowth('patient-uuid-1');
      expect(mockService.getGrowth).toHaveBeenCalledWith('patient-uuid-1');
    });
  });

  describe('createGrowth', () => {
    it('should return { data: created }', async () => {
      const body = { patientId: 'p-1', ageMonths: 12 };
      mockService.createGrowth.mockResolvedValue({ id: 'g-new' });
      const result = await controller.createGrowth(body as any, 'doc-1');
      expect(result).toEqual({ data: { id: 'g-new' } });
    });

    it('should merge userId as measuredBy', async () => {
      const body = { patientId: 'p-1', ageMonths: 6 };
      mockService.createGrowth.mockResolvedValue({ id: 'g-2' });
      await controller.createGrowth(body as any, 'doctor-uuid-1');
      expect(mockService.createGrowth).toHaveBeenCalledWith({ ...body, measuredBy: 'doctor-uuid-1' });
    });
  });

  describe('getImmunizations', () => {
    it('should return { data: immunizations }', async () => {
      const immunizations = [{ id: 'i-1', vaccineName: 'DTaP' }];
      mockService.getImmunizations.mockResolvedValue(immunizations);
      const result = await controller.getImmunizations('p-1');
      expect(result).toEqual({ data: immunizations });
      expect(mockService.getImmunizations).toHaveBeenCalledWith('p-1');
    });
  });

  describe('createImmunization', () => {
    it('should return { data: created }', async () => {
      const body = { patientId: 'p-1', vaccineName: 'MMR', doseNumber: 1 };
      mockService.createImmunization.mockResolvedValue({ id: 'i-new' });
      const result = await controller.createImmunization(body as any, 'doc-1');
      expect(result).toEqual({ data: { id: 'i-new' } });
    });

    it('should merge userId as givenBy', async () => {
      const body = { patientId: 'p-1', vaccineName: 'BCG', doseNumber: 1 };
      mockService.createImmunization.mockResolvedValue({ id: 'i-2' });
      await controller.createImmunization(body as any, 'doctor-uuid-1');
      expect(mockService.createImmunization).toHaveBeenCalledWith({ ...body, givenBy: 'doctor-uuid-1' });
    });
  });

  describe('getDevelopmental', () => {
    it('should return { data: assessments }', async () => {
      const assessments = [{ id: 'd-1', tool: 'K-DST' }];
      mockService.getDevelopmental.mockResolvedValue(assessments);
      const result = await controller.getDevelopmental('p-1');
      expect(result).toEqual({ data: assessments });
      expect(mockService.getDevelopmental).toHaveBeenCalledWith('p-1');
    });
  });

  describe('createDevelopmental', () => {
    it('should return { data: created }', async () => {
      const body = { patientId: 'p-1', ageMonths: 18, tool: 'K-DST', grossMotor: 'NORMAL', fineMotor: 'NORMAL', language: 'NORMAL', socialPersonal: 'NORMAL', overallResult: 'NORMAL' };
      mockService.createDevelopmental.mockResolvedValue({ id: 'd-new' });
      const result = await controller.createDevelopmental(body as any, 'doc-1');
      expect(result).toEqual({ data: { id: 'd-new' } });
    });

    it('should merge userId as assessedBy', async () => {
      const body = { patientId: 'p-1', ageMonths: 24, tool: 'Denver', grossMotor: 'NORMAL', fineMotor: 'NORMAL', language: 'NORMAL', socialPersonal: 'NORMAL', overallResult: 'NORMAL' };
      mockService.createDevelopmental.mockResolvedValue({ id: 'd-2' });
      await controller.createDevelopmental(body as any, 'doctor-uuid-1');
      expect(mockService.createDevelopmental).toHaveBeenCalledWith({ ...body, assessedBy: 'doctor-uuid-1' });
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
      const stats = { totalExams: 35, totalGrowth: 10, totalImmunizations: 20, totalAssessments: 5 };
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
