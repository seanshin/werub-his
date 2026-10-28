import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClinicalPathwayController } from '../../src/modules/clinical-pathway/clinical-pathway.controller';

describe('ClinicalPathwayController', () => {
  let controller: ClinicalPathwayController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      findAll: vi.fn().mockResolvedValue([{ id: 'pw-1', code: 'CP-DM2', name: '제2형 당뇨 표준경로' }]),
      create: vi.fn().mockResolvedValue({ id: 'pw-new', code: 'CP-NEW' }),
      findOne: vi.fn().mockResolvedValue({ id: 'pw-1', code: 'CP-DM2', milestones: [] }),
      update: vi.fn().mockResolvedValue({ id: 'pw-1', updated: true }),
      remove: vi.fn().mockResolvedValue({ id: 'pw-1', isActive: false }),
      getAnalytics: vi.fn().mockResolvedValue({ totalPathways: 5, avgCompletionRate: 78.5 }),
      getAssignments: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      assignPatient: vi.fn().mockResolvedValue({ id: 'assign-1', status: 'ACTIVE' }),
      recordOutcome: vi.fn().mockResolvedValue({ id: 'outcome-1', status: 'COMPLETED' }),
      deviate: vi.fn().mockResolvedValue({ id: 'assign-1', status: 'DEVIATED' }),
    };
    controller = new ClinicalPathwayController(mockService);
  });

  describe('findAll', () => {
    it('should return pathway list', async () => {
      const result = await controller.findAll('내과', undefined);
      expect(result).toEqual({ data: [{ id: 'pw-1', code: 'CP-DM2', name: '제2형 당뇨 표준경로' }] });
      expect(mockService.findAll).toHaveBeenCalledWith('내과', undefined);
    });
  });

  describe('create', () => {
    it('should create a pathway', async () => {
      const body = { code: 'CP-NEW', name: '신규 경로', department: '외과' };
      const result = await controller.create(body, 'user-1');
      expect(result).toEqual({ data: { id: 'pw-new', code: 'CP-NEW' } });
      expect(mockService.create).toHaveBeenCalledWith(body, 'user-1');
    });
  });

  describe('getAnalytics', () => {
    it('should return analytics data', async () => {
      const result = await controller.getAnalytics('내과');
      expect(result.data.totalPathways).toBe(5);
      expect(result.data.avgCompletionRate).toBe(78.5);
    });
  });
});
