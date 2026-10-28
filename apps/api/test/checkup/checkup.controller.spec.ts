import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CheckupController } from '../../src/modules/checkup/checkup.controller';
import { CheckupService } from '../../src/modules/checkup/checkup.service';
import { CheckupProgramService } from '../../src/modules/checkup/checkup-program.service';
import { CheckupContractService } from '../../src/modules/checkup/checkup-contract.service';

describe('CheckupController', () => {
  let controller: CheckupController;
  let programService: CheckupProgramService;
  let checkupService: CheckupService;
  let contractService: CheckupContractService;

  const mockReq = { user: { sub: 'user-1' } };

  beforeEach(() => {
    programService = {
      findAll: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({ id: 'prog-1' }),
      create: vi.fn().mockResolvedValue({ id: 'prog-1' }),
      update: vi.fn().mockResolvedValue({ id: 'prog-1' }),
      remove: vi.fn().mockResolvedValue({ id: 'prog-1' }),
    } as any;

    checkupService = {
      createVisit: vi.fn().mockResolvedValue({ id: 'visit-1' }),
      findVisits: vi.fn().mockResolvedValue({ data: [], pagination: { total: 0, page: 1, limit: 20, hasMore: false } }),
      findVisit: vi.fn().mockResolvedValue({ id: 'visit-1', items: [], summary: null }),
      checkIn: vi.fn().mockResolvedValue({ id: 'visit-1', status: 'CHECKED_IN' }),
      updateStatus: vi.fn().mockResolvedValue({ id: 'visit-1', status: 'IN_PROGRESS' }),
      getRouteSheet: vi.fn().mockResolvedValue([]),
      addResult: vi.fn().mockResolvedValue({ id: 'ri-1' }),
      createSummary: vi.fn().mockResolvedValue({ visitId: 'visit-1' }),
      signSummary: vi.fn().mockResolvedValue({ signed: true }),
      autoCollectResults: vi.fn().mockResolvedValue({ collected: 0, total: 0, allDone: false }),
      generateGradeSummary: vi.fn().mockResolvedValue({ overallGrade: 'A', sections: [] }),
      findInterpretations: vi.fn().mockResolvedValue([]),
      completeInterpretation: vi.fn().mockResolvedValue({ id: 'interp-1' }),
      createFollowUp: vi.fn().mockResolvedValue({ id: 'fu-1' }),
      createReferral: vi.fn().mockResolvedValue({ id: 'ref-1' }),
      getPatientCheckupHistory: vi.fn().mockResolvedValue([]),
      getTodayStats: vi.fn().mockResolvedValue({ total: 10 }),
      getStats: vi.fn().mockResolvedValue([]),
      getAbnormalStats: vi.fn().mockResolvedValue([]),
      findFollowUps: vi.fn().mockResolvedValue([]),
      completeFollowUp: vi.fn().mockResolvedValue({ id: 'fu-1' }),
      getStationQueue: vi.fn().mockResolvedValue([]),
      stationCompleteItem: vi.fn().mockResolvedValue({ id: 'ri-1' }),
      cancelVisit: vi.fn().mockResolvedValue({ id: 'visit-1', status: 'CANCELLED' }),
      rescheduleVisit: vi.fn().mockResolvedValue({ id: 'visit-1' }),
      skipResultItem: vi.fn().mockResolvedValue({ id: 'ri-1', finding: 'NOT_APPLICABLE' }),
      processNoShows: vi.fn().mockResolvedValue({ processed: 2 }),
      interpretCheckupAI: vi.fn().mockResolvedValue({ visitId: 'visit-1', interpretation: null, source: 'FALLBACK' }),
      suggestFollowupCheckup: vi.fn().mockResolvedValue({ visitId: 'visit-1', recommendation: null, source: 'FALLBACK' }),
    } as any;

    contractService = {
      findAll: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({ id: 'ct-1' }),
      create: vi.fn().mockResolvedValue({ id: 'ct-1' }),
      getContractStats: vi.fn().mockResolvedValue({}),
      bulkReserve: vi.fn().mockResolvedValue([]),
      bulkUpload: vi.fn().mockResolvedValue({ total: 2, success: 2, failed: 0, details: [] }),
    } as any;

    const questionnaireService = {
      findAllTemplates: vi.fn().mockResolvedValue([]),
      findTemplate: vi.fn().mockResolvedValue({ id: 'q-1' }),
      createTemplate: vi.fn().mockResolvedValue({ id: 'q-1' }),
      updateTemplate: vi.fn().mockResolvedValue({ id: 'q-1' }),
      removeTemplate: vi.fn().mockResolvedValue({ id: 'q-1' }),
      getResponseByVisit: vi.fn().mockResolvedValue(null),
      getTemplateForVisit: vi.fn().mockResolvedValue(null),
      saveResponse: vi.fn().mockResolvedValue({ id: 'r-1' }),
    } as any;
    const stationService = {
      getStations: vi.fn().mockResolvedValue([]),
      getStation: vi.fn().mockResolvedValue({ stationId: 'ck-blood' }),
      updateStation: vi.fn().mockResolvedValue({}),
      arrive: vi.fn().mockResolvedValue({}),
      start: vi.fn().mockResolvedValue({}),
      complete: vi.fn().mockResolvedValue({}),
      getFlowBoard: vi.fn().mockResolvedValue({ stations: [], matrix: [] }),
      getNextStation: vi.fn().mockResolvedValue(null),
      getStationQueue: vi.fn().mockResolvedValue({ queue: [] }),
      getStationStats: vi.fn().mockResolvedValue({}),
    } as any;
    const pdfService = { generateCheckupResultPdf: vi.fn().mockResolvedValue('<html>PDF</html>'), htmlToPdfBuffer: vi.fn().mockResolvedValue(Buffer.from('PDF')) } as any;
    controller = new CheckupController(programService, checkupService, contractService, questionnaireService, stationService, pdfService);
  });

  // ── Programs ──

  describe('listPrograms', () => {
    it('should return program list', async () => {
      const result = await controller.listPrograms();
      expect(result).toEqual({ data: [] });
      expect(programService.findAll).toHaveBeenCalled();
    });

    it('should pass filter params', async () => {
      await controller.listPrograms('GENERAL', 'MALE', 'true', '종합');
      expect(programService.findAll).toHaveBeenCalledWith({
        category: 'GENERAL', gender: 'MALE', isActive: true, search: '종합',
      });
    });
  });

  describe('getProgram', () => {
    it('should return program detail', async () => {
      const result = await controller.getProgram('prog-1');
      expect(result).toEqual({ data: { id: 'prog-1' } });
    });
  });

  describe('createProgram', () => {
    it('should create program', async () => {
      const result = await controller.createProgram({ code: 'CK-01', name: 'Test' } as any);
      expect(result.data.id).toBe('prog-1');
    });
  });

  // ── Visits ──

  describe('createVisit', () => {
    it('should create visit', async () => {
      const result = await controller.createVisit({
        patientId: 'p-1', programId: 'prog-1', scheduledDate: '2026-06-01',
      });
      expect(result.data.id).toBe('visit-1');
    });
  });

  describe('listVisits', () => {
    it('should return visits with pagination', async () => {
      const result = await controller.listVisits('2026-06-01', 'RESERVED');
      expect(result.data).toEqual([]);
      expect(checkupService.findVisits).toHaveBeenCalledWith(
        expect.objectContaining({ date: '2026-06-01', status: 'RESERVED' }),
      );
    });

    it('should parse page/limit as numbers', async () => {
      await controller.listVisits(undefined, undefined, undefined, undefined, '2', '10');
      expect(checkupService.findVisits).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, limit: 10 }),
      );
    });
  });

  describe('checkIn', () => {
    it('should check in visit', async () => {
      const result = await controller.checkIn('visit-1');
      expect(result.data.status).toBe('CHECKED_IN');
    });
  });

  describe('updateStatus', () => {
    it('should update status', async () => {
      const result = await controller.updateStatus('visit-1', { status: 'IN_PROGRESS' });
      expect(result.data.status).toBe('IN_PROGRESS');
    });
  });

  // ── Results / Summary ──

  describe('getResults', () => {
    it('should return items from visit', async () => {
      const result = await controller.getResults('visit-1');
      expect(result.data).toEqual([]);
    });
  });

  describe('addResult', () => {
    it('should add result', async () => {
      const result = await controller.addResult('visit-1', {
        category: 'LAB', testName: '혈당',
      });
      expect(result.data.id).toBe('ri-1');
    });
  });

  describe('createSummary', () => {
    it('should create summary with user id', async () => {
      const result = await controller.createSummary(
        'visit-1', { overallGrade: 'A', sections: [], doctorOpinion: '정상', recommendations: [] }, mockReq as any,
      );
      expect(checkupService.createSummary).toHaveBeenCalledWith('visit-1', expect.anything(), 'user-1');
      expect(result.data.visitId).toBe('visit-1');
    });
  });

  describe('signSummary', () => {
    it('should sign summary', async () => {
      const result = await controller.signSummary('visit-1', {}, mockReq as any);
      expect(result.data.signed).toBe(true);
    });
  });

  // ── Auto-collect / Grade ──

  describe('autoCollect', () => {
    it('should trigger auto-collection', async () => {
      const result = await controller.autoCollect('visit-1');
      expect(result.data.collected).toBe(0);
    });
  });

  describe('getGradeSummary', () => {
    it('should return grade summary', async () => {
      const result = await controller.getGradeSummary('visit-1');
      expect(result.data.overallGrade).toBe('A');
    });
  });

  // ── Interpretations ──

  describe('getInterpretations', () => {
    it('should default to REQUESTED status', async () => {
      await controller.getInterpretations();
      expect(checkupService.findInterpretations).toHaveBeenCalledWith({ status: 'REQUESTED' });
    });

    it('should use provided status filter', async () => {
      await controller.getInterpretations('영상의학과', 'COMPLETED');
      expect(checkupService.findInterpretations).toHaveBeenCalledWith({
        department: '영상의학과', status: 'COMPLETED',
      });
    });
  });

  describe('completeInterpretation', () => {
    it('should complete interpretation', async () => {
      const result = await controller.completeInterpretation(
        'interp-1', { finding: '정상', grade: 'A' }, mockReq as any,
      );
      expect(result.data.id).toBe('interp-1');
    });
  });

  // ── Follow-ups / Referrals ──

  describe('createFollowUp', () => {
    it('should create follow-up', async () => {
      const result = await controller.createFollowUp('visit-1', {
        followUpType: 'RECHECK', description: '재검', dueDate: '2026-09-01',
      });
      expect(result.data.id).toBe('fu-1');
    });
  });

  describe('createReferral', () => {
    it('should create referral', async () => {
      const result = await controller.createReferral('visit-1', {
        toDepartment: '내과', reason: '이상소견',
      });
      expect(result.data.id).toBe('ref-1');
    });
  });

  // ── Contracts ──

  describe('listContracts', () => {
    it('should list contracts', async () => {
      const result = await controller.listContracts();
      expect(result.data).toEqual([]);
    });
  });

  describe('createContract', () => {
    it('should create contract', async () => {
      const result = await controller.createContract({
        companyName: '삼성전자', programId: 'p-1', headcount: 100,
        discountRate: 15, contractDate: '2026-01-01', expiryDate: '2026-12-31',
      });
      expect(result.data.id).toBe('ct-1');
    });
  });

  describe('bulkReserve', () => {
    it('should bulk reserve', async () => {
      const result = await controller.bulkReserve('ct-1', {
        reservations: [{ patientId: 'p-1', scheduledDate: '2026-06-01' }],
      });
      expect(result.data).toEqual([]);
    });
  });

  // ── Follow-up management ──

  describe('listFollowUps', () => {
    it('should list follow-ups', async () => {
      const result = await controller.listFollowUps();
      expect(result.data).toEqual([]);
    });
  });

  describe('completeFollowUp', () => {
    it('should complete follow-up', async () => {
      const result = await controller.completeFollowUp('fu-1');
      expect(result.data.id).toBe('fu-1');
    });
  });

  // ── Statistics ──

  describe('getTodayStats', () => {
    it('should return today stats', async () => {
      const result = await controller.getTodayStats();
      expect(result.data.total).toBe(10);
    });
  });

  describe('getStats', () => {
    it('should pass date range', async () => {
      await controller.getStats('2026-01-01', '2026-12-31');
      expect(checkupService.getStats).toHaveBeenCalledWith({
        from: '2026-01-01', to: '2026-12-31',
      });
    });
  });

  // ── Program CRUD ──

  describe('updateProgram', () => {
    it('should update program', async () => {
      const result = await controller.updateProgram('prog-1', { name: '종합검진A(수정)' });
      expect(programService.update).toHaveBeenCalledWith('prog-1', { name: '종합검진A(수정)' });
      expect(result.data.id).toBe('prog-1');
    });
  });

  describe('removeProgram', () => {
    it('should remove program', async () => {
      const result = await controller.removeProgram('prog-1');
      expect(programService.remove).toHaveBeenCalledWith('prog-1');
      expect(result.data.id).toBe('prog-1');
    });
  });

  // ── Visit detail ──

  describe('getVisit', () => {
    it('should return visit detail', async () => {
      const result = await controller.getVisit('visit-1');
      expect(checkupService.findVisit).toHaveBeenCalledWith('visit-1');
      expect(result.data.id).toBe('visit-1');
    });
  });

  describe('getRouteSheet', () => {
    it('should return route sheet', async () => {
      const result = await controller.getRouteSheet('visit-1');
      expect(checkupService.getRouteSheet).toHaveBeenCalledWith('visit-1');
      expect(result.data).toEqual([]);
    });
  });

  describe('getSummary', () => {
    it('should return visit summary', async () => {
      const result = await controller.getVisit('visit-1');
      expect(result.data).toHaveProperty('summary');
    });
  });

  // ── Patient history / Stats ──

  describe('getPatientHistory', () => {
    it('should return patient checkup history', async () => {
      const result = await controller.getPatientHistory('pat-1');
      expect(checkupService.getPatientCheckupHistory).toHaveBeenCalledWith('pat-1');
      expect(result.data).toEqual([]);
    });
  });

  describe('getAbnormalStats', () => {
    it('should return abnormal stats', async () => {
      const result = await controller.getAbnormalStats('2026-01-01', '2026-12-31');
      expect(checkupService.getAbnormalStats).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-12-31' });
      expect(result.data).toEqual([]);
    });
  });

  // ── Contract detail ──

  describe('getContract', () => {
    it('should return contract detail', async () => {
      const result = await controller.getContract('ct-1');
      expect(contractService.findOne).toHaveBeenCalledWith('ct-1');
      expect(result.data.id).toBe('ct-1');
    });
  });

  describe('getContractStats', () => {
    it('should return contract stats', async () => {
      const result = await controller.getContractStats('ct-1');
      expect(contractService.getContractStats).toHaveBeenCalledWith('ct-1');
      expect(result.data).toEqual({});
    });
  });

  // ── Stations ──

  describe('getStations', () => {
    it('should return station list', async () => {
      const result = await controller.getStations();
      expect(result.data).toBeDefined();
    });
  });

  // ── Station ──

  describe('getStationQueue', () => {
    it('should get station queue', async () => {
      const result = await controller.getStationQueue('blood');
      expect(result.data).toEqual([]);
    });
  });

  describe('stationComplete', () => {
    it('should complete station item', async () => {
      const result = await controller.stationComplete('blood', {
        visitId: 'v-1', testName: '혈당', finding: 'NORMAL',
      });
      expect(result.data.id).toBe('ri-1');
    });
  });

  // ── 예약 취소/변경/스킵/미방문 ──

  describe('cancelVisit', () => {
    it('should cancel a reserved visit', async () => {
      const result = await controller.cancelVisit('visit-1', { reason: '개인 사정' });
      expect(checkupService.cancelVisit).toHaveBeenCalledWith('visit-1', '개인 사정');
      expect(result.data.status).toBe('CANCELLED');
    });
  });

  describe('rescheduleVisit', () => {
    it('should reschedule a visit', async () => {
      const result = await controller.rescheduleVisit('visit-1', { scheduledDate: '2026-07-01' });
      expect(checkupService.rescheduleVisit).toHaveBeenCalledWith('visit-1', { scheduledDate: '2026-07-01' });
      expect(result.data.id).toBe('visit-1');
    });
  });

  describe('skipResultItem', () => {
    it('should skip a result item', async () => {
      const result = await controller.skipResultItem('visit-1', { testName: '위내시경', reason: '수검자 거부' });
      expect(checkupService.skipResultItem).toHaveBeenCalledWith('visit-1', '위내시경', '수검자 거부');
      expect(result.data.finding).toBe('NOT_APPLICABLE');
    });
  });

  describe('processNoShows', () => {
    it('should process no-show visits', async () => {
      const result = await controller.processNoShows();
      expect(checkupService.processNoShows).toHaveBeenCalled();
      expect(result.data.processed).toBe(2);
    });
  });
});
