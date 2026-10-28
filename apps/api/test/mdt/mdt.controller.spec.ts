import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MdtController } from '../../src/modules/mdt/mdt.controller';

describe('MdtController', () => {
  let controller: MdtController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      findAll: vi.fn().mockResolvedValue([
        { id: 'conf-1', title: '간암 MDT', conferenceType: 'TUMOR_BOARD', department: '외과' },
      ]),
      create: vi.fn().mockResolvedValue({ id: 'conf-new' }),
      findOne: vi.fn().mockResolvedValue({ id: 'conf-1', cases: [], attendees: [] }),
      addCase: vi.fn().mockResolvedValue({ id: 'case-1', primaryDiag: 'C22.0' }),
      addAttendee: vi.fn().mockResolvedValue({ id: 'att-1', attended: false }),
      updateAttendee: vi.fn().mockResolvedValue({ id: 'att-1', attended: true }),
      updateCase: vi.fn().mockResolvedValue({ id: 'case-1', decision: '수술 결정' }),
      getStats: vi.fn().mockResolvedValue({ totalConferences: 12, totalCases: 48, avgAttendeesPerConf: 6.5 }),
    };
    controller = new MdtController(mockService);
  });

  describe('findAll', () => {
    it('should return conference list', async () => {
      const result = await controller.findAll('외과', undefined);
      expect(result).toEqual({ data: [{ id: 'conf-1', title: '간암 MDT', conferenceType: 'TUMOR_BOARD', department: '외과' }] });
    });
  });

  describe('create', () => {
    it('should create a conference', async () => {
      const body = { title: '신규 MDT', conferenceType: 'TUMOR_BOARD', department: '내과', scheduledAt: '2026-06-01T09:00:00Z' };
      const result = await controller.create(body, 'user-1');
      expect(result.data.id).toBe('conf-new');
    });
  });

  describe('getStats', () => {
    it('should return MDT statistics', async () => {
      const result = await controller.getStats();
      expect(result.data.totalConferences).toBe(12);
      expect(result.data.totalCases).toBe(48);
    });
  });
});
