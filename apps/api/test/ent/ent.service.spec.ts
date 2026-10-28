import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EntService } from '../../src/modules/ent/ent.service';

describe('EntService', () => {
  let service: EntService;
  let p: any;

  beforeEach(() => {
    p = {
      entExam: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'ee-1' }), count: vi.fn().mockResolvedValue(0) },
      sleepStudy: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'ss-1' }) },
    };
    service = new EntService(p);
  });

  describe('getPatients', () => {
    // 2026-10-10 정본 specialtyRecordPatients — 환자별 최근 기록(groupBy) · 상한 · 전체 수(상세는 test/specialty/specialty-review-2026-10-10c)
    it('환자별 최근 기록 · 전체 수 · 잘림 여부', async () => {
      p.entExam.groupBy = vi.fn().mockResolvedValue([{ patientId: 'p-1', _max: { examinedAt: new Date('2026-05-20') } }]);
      p.patient = { findMany: vi.fn().mockResolvedValue([{ id: 'p-1', familyName: '박', givenName: '환자', mrn: 'MRN001' }]) };
      const r = await service.getPatients();
      expect(p.entExam.groupBy.mock.calls[0][0]).toMatchObject({ by: ['patientId'], orderBy: { _max: { examinedAt: 'desc' } } });
      expect(r).toMatchObject({ total: 1, truncated: false });
      expect(r.items[0]).toMatchObject({ patientId: 'p-1', mrn: 'MRN001', lastDate: new Date('2026-05-20') });
    });
  });
  it('createExam', async () => { const r = await service.createExam({ patientId: 'p-1', examinedBy: 'doc-1' }); expect(r.id).toBe('ee-1'); });
  it('getExams', async () => { await service.getExams('p-1'); expect(p.entExam.findMany).toHaveBeenCalled(); });
  it('getAudiogram', async () => { await service.getAudiogram('p-1'); expect(p.entExam.findMany).toHaveBeenCalled(); });
  it('createHearingAid persists to HearingAid model (무저장 스텁 근절)', async () => {
    p.hearingAid = {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'ha-1', ...data })),
      findMany: vi.fn().mockResolvedValue([]),
    };
    const r: any = await service.createHearingAid({ patientId: 'p-1', ear: 'LEFT', model: 'X-100', prescribedBy: 'doc-1' });
    expect(p.hearingAid.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ patientId: 'p-1', ear: 'LEFT', prescribedBy: 'doc-1' }) }),
    );
    expect(r.id).toBe('ha-1');
  });
  it('createSleepStudy', async () => { const r = await service.createSleepStudy({ patientId: 'p-1', studyType: 'PSG', studyDate: '2026-06-01', ahi: 10, interpretedBy: 'doc-1' }); expect(r.id).toBe('ss-1'); });
});
