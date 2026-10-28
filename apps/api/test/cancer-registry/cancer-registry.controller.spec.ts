import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CancerRegistryController } from '../../src/modules/cancer-registry/cancer-registry.controller';

describe('CancerRegistryController', () => {
  let controller: CancerRegistryController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      findAll: vi.fn().mockResolvedValue([{ id: 'reg-1', registrationNo: 'CR-2026-00001' }]),
      findOne: vi.fn().mockResolvedValue({ id: 'reg-1', treatments: [], followUps: [] }),
      create: vi.fn().mockResolvedValue({ id: 'reg-new', registrationNo: 'CR-2026-00002' }),
      update: vi.fn().mockResolvedValue({ id: 'reg-1', updated: true }),
      addTreatment: vi.fn().mockResolvedValue({ id: 'tx-1', treatmentType: 'SURGERY' }),
      addFollowUp: vi.fn().mockResolvedValue({ id: 'fu-1', status: 'NED' }),
      getStats: vi.fn().mockResolvedValue({ totalCases: 156, byPrimarySite: { C34: 45, C50: 38 } }),
      getSurvivalData: vi.fn().mockResolvedValue({ overallSurvival: { '1yr': 0.92, '3yr': 0.78, '5yr': 0.65 } }),
    };
    controller = new CancerRegistryController(mockService);
  });

  describe('findAll', () => {
    it('should return registry list with pagination', async () => {
      const result = await controller.findAll(
        undefined, undefined, undefined, undefined, undefined, '1', '20',
      );
      expect(result.data).toHaveLength(1);
      expect(mockService.findAll).toHaveBeenCalled();
    });

    // 🔴 원결함: 화면이 보내던 vitalStatus / reportedToKccr 를 서버가 받지 않아 필터가 무효였다
    it('should forward vitalStatus and reportedToKccr filters', async () => {
      await controller.findAll(undefined, undefined, undefined, 'ALIVE', 'false');

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ vitalStatus: 'ALIVE', reportedToKccr: false }),
      );
    });

    it('should leave reportedToKccr undefined when not given (필터 미지정 ≠ false)', async () => {
      await controller.findAll();

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ reportedToKccr: undefined }),
      );
    });
  });

  describe('create', () => {
    it('should register new cancer case', async () => {
      const body = { patientId: 'pat-1', primarySite: 'C34.1', morphology: '8140/3', diagnosisBasis: 'HISTOLOGY' };
      const result = await controller.create(body, 'user-1');
      expect(result.data.registrationNo).toBe('CR-2026-00002');
    });
  });

  describe('addTreatment', () => {
    it('should add treatment record', async () => {
      const body = { treatmentType: 'SURGERY', startDate: '2026-05-01' };
      const result = await controller.addTreatment('reg-1', body);
      expect(result.data.treatmentType).toBe('SURGERY');
    });
  });

  describe('getStats', () => {
    it('should return cancer statistics', async () => {
      const result = await controller.getStats(undefined);
      expect(result.data.totalCases).toBe(156);
    });
  });

  describe('getSurvivalData', () => {
    it('should return survival data', async () => {
      const result = await controller.getSurvivalData('C34');
      expect(result.data.overallSurvival['5yr']).toBe(0.65);
    });
  });
});
