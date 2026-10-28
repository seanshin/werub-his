import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DentalService } from '../../src/modules/dental/dental.service';

describe('DentalService', () => {
  let service: DentalService;
  let p: any;

  beforeEach(() => {
    p = {
      dentalChart: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'dc-1' }) },
      dentalTreatmentPlan: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue({ id: 'dp-1' }), create: vi.fn().mockResolvedValue({ id: 'dp-1' }), update: vi.fn(), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
      dentalTreatmentRecord: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'dr-1' }), count: vi.fn().mockResolvedValue(0) },
      dentalLabOrder: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue({ id: 'dl-1' }), create: vi.fn().mockResolvedValue({ id: 'dl-1' }), update: vi.fn() },
      dentalRecall: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue({ id: 'rc-1' }), create: vi.fn().mockResolvedValue({ id: 'rc-1' }), update: vi.fn() },
    };
    service = new DentalService(p);
  });

  describe('getPatients', () => {
    // 2026-10-10 정본 specialtyRecordPatients — 환자별 최근 기록(groupBy) · 상한 · 전체 수(상세는 test/specialty/specialty-review-2026-10-10c)
    it('환자별 최근 기록 · 전체 수 · 잘림 여부', async () => {
      p.dentalChart.groupBy = vi.fn().mockResolvedValue([{ patientId: 'p-1', _max: { chartedAt: new Date('2026-05-20') } }]);
      p.patient = { findMany: vi.fn().mockResolvedValue([{ id: 'p-1', familyName: '박', givenName: '환자', mrn: 'MRN001' }]) };
      const r = await service.getPatients();
      expect(p.dentalChart.groupBy.mock.calls[0][0]).toMatchObject({ by: ['patientId'], orderBy: { _max: { chartedAt: 'desc' } } });
      expect(r).toMatchObject({ total: 1, truncated: false });
      expect(r.items[0]).toMatchObject({ patientId: 'p-1', mrn: 'MRN001', lastDate: new Date('2026-05-20') });
    });
  });
  it('getChart', async () => { await service.getChart('p-1'); expect(p.dentalChart.findMany).toHaveBeenCalled(); });
  it('createChart', async () => { const r = await service.createChart({ patientId: 'p-1', teethStatus: {}, chartedBy: 'u-1' }); expect(r.id).toBe('dc-1'); });
  it('createPlan', async () => { const r = await service.createPlan({ patientId: 'p-1', tooth: '11', procedure: 'FILLING', category: '보존', plannedBy: 'doc-1' }); expect(r.id).toBe('dp-1'); });
  it('getPlans', async () => { await service.getPlans('p-1'); expect(p.dentalTreatmentPlan.findMany).toHaveBeenCalled(); });
  it('createRecord', async () => { const r = await service.createRecord({ patientId: 'p-1', tooth: '11', procedure: 'FILLING', treatedBy: 'doc-1' }); expect(r.id).toBe('dr-1'); });
  it('createLabOrder', async () => { const r = await service.createLabOrder({ patientId: 'p-1', tooth: '11', orderType: 'CROWN', material: 'ZIRCONIA', orderedBy: 'doc-1' }); expect(r.id).toBe('dl-1'); });
  it('createPerio', async () => { const r = await service.createPerio({ patientId: 'p-1', perioStatus: {}, chartedBy: 'doc-1' }); expect(r.id).toBe('dc-1'); });
  it('createRecall', async () => { const r = await service.createRecall({ patientId: 'p-1', recallType: '6MONTH', scheduledDate: '2026-06-01', createdBy: 'doc-1' }); expect(r.id).toBe('rc-1'); });

  describe('국소마취 최대용량 게이트', () => {
    beforeEach(() => {
      p.preVisitVitals = { findFirst: vi.fn().mockResolvedValue(null) };
    });

    it('절대상한 초과 차단 (리도카인 500mg 초과)', async () => {
      await expect(
        service.createRecord({ patientId: 'p-1', tooth: '11', procedure: 'EXTRACTION', anesthesiaAgent: 'LIDOCAINE', anesthesiaDoseMg: 520, treatedBy: 'doc-1' }),
      ).rejects.toThrow();
      expect(p.dentalTreatmentRecord.create).not.toHaveBeenCalled();
    });

    it('체중기준 초과 차단 (50kg × 7mg/kg = 350mg < 400mg)', async () => {
      p.preVisitVitals.findFirst.mockResolvedValue({ weight: 50 });
      await expect(
        service.createRecord({ patientId: 'p-1', tooth: '11', procedure: 'EXTRACTION', anesthesiaAgent: 'LIDOCAINE', anesthesiaDoseMg: 400, treatedBy: 'doc-1' }),
      ).rejects.toThrow();
    });

    it('정상 용량 허용 + 구조화 필드 저장 (카트리지 2개 = 72mg)', async () => {
      const r = await service.createRecord({ patientId: 'p-1', tooth: '38', procedure: '매복 사랑니 발치', anesthesiaAgent: 'LIDOCAINE', anesthesiaDoseMg: 72, treatedBy: 'doc-1' });
      expect(r.id).toBe('dr-1');
      expect(p.dentalTreatmentRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ anesthesiaAgent: 'LIDOCAINE', anesthesiaDoseMg: 72 }) }),
      );
    });

    it('레거시 자유문자열(구조화 미입력)은 통과', async () => {
      const r = await service.createRecord({ patientId: 'p-1', tooth: '11', procedure: 'FILLING', anesthesia: '리도카인 2% 1.8mL', treatedBy: 'doc-1' });
      expect(r.id).toBe('dr-1');
    });
  });
});
