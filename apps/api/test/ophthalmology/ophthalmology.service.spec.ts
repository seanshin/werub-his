import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OphthalmologyService } from '../../src/modules/ophthalmology/ophthalmology.service';

describe('OphthalmologyService', () => {
  let service: OphthalmologyService;
  let p: any;

  beforeEach(() => {
    p = {
      eyeExam: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue({ id: 'ex-1' }), create: vi.fn().mockResolvedValue({ id: 'ex-1' }), update: vi.fn().mockResolvedValue({ id: 'ex-1' }), count: vi.fn().mockResolvedValue(0) },
      eyeSurgery: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'es-1' }), count: vi.fn().mockResolvedValue(0) },
      eyePrescription: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'ep-1' }) },
    };
    service = new OphthalmologyService(p);
  });

  describe('getPatients', () => {
    // 2026-10-10 정본 specialtyRecordPatients — 환자별 최근 기록(groupBy) · 상한 · 전체 수(상세는 test/specialty/specialty-review-2026-10-10c)
    it('환자별 최근 기록 · 전체 수 · 잘림 여부', async () => {
      p.eyeExam.groupBy = vi.fn().mockResolvedValue([{ patientId: 'p-1', _max: { examinedAt: new Date('2026-05-20') } }]);
      p.patient = { findMany: vi.fn().mockResolvedValue([{ id: 'p-1', familyName: '박', givenName: '환자', mrn: 'MRN001' }]) };
      const r = await service.getPatients();
      expect(p.eyeExam.groupBy.mock.calls[0][0]).toMatchObject({ by: ['patientId'], orderBy: { _max: { examinedAt: 'desc' } } });
      expect(r).toMatchObject({ total: 1, truncated: false });
      expect(r.items[0]).toMatchObject({ patientId: 'p-1', mrn: 'MRN001', lastDate: new Date('2026-05-20') });
    });
  });
  it('createExam', async () => { const r = await service.createExam({ patientId: 'p-1', examinedBy: 'doc-1' }); expect(r.id).toBe('ex-1'); });
  it('getExams', async () => { await service.getExams('p-1'); expect(p.eyeExam.findMany).toHaveBeenCalled(); });
  it('createSurgery', async () => { const r = await service.createSurgery({ patientId: 'p-1', eye: 'LEFT', procedure: 'CATARACT', operatedBy: 'doc-1' }); expect(r.id).toBe('es-1'); });
  it('getPrescriptions', async () => { await service.getPrescriptions('p-1'); expect(p.eyePrescription.findMany).toHaveBeenCalled(); });
  it('getIopTrend', async () => { await service.getIopTrend('p-1'); expect(p.eyeExam.findMany).toHaveBeenCalled(); });
});
