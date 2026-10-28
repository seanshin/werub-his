import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DermatologyService } from '../../src/modules/dermatology/dermatology.service';

describe('DermatologyService', () => {
  let service: DermatologyService;
  let p: any;

  beforeEach(() => {
    p = {
      skinLesion: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue({ id: 'sl-1' }), create: vi.fn().mockResolvedValue({ id: 'sl-1' }), update: vi.fn().mockResolvedValue({ id: 'sl-1' }), count: vi.fn().mockResolvedValue(0) },
      skinTreatment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'st-1' }), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
    };
    service = new DermatologyService(p);
  });

  describe('getPatients', () => {
    // 2026-10-10 정본 specialtyRecordPatients — 환자별 최근 기록(groupBy) · 상한 · 전체 수(상세는 test/specialty/specialty-review-2026-10-10c)
    it('환자별 최근 기록 · 전체 수 · 잘림 여부', async () => {
      p.skinLesion.groupBy = vi.fn().mockResolvedValue([{ patientId: 'p-1', _max: { recordedAt: new Date('2026-05-20') } }]);
      p.patient = { findMany: vi.fn().mockResolvedValue([{ id: 'p-1', familyName: '박', givenName: '환자', mrn: 'MRN001' }]) };
      const r = await service.getPatients();
      expect(p.skinLesion.groupBy.mock.calls[0][0]).toMatchObject({ by: ['patientId'], orderBy: { _max: { recordedAt: 'desc' } } });
      expect(r).toMatchObject({ total: 1, truncated: false });
      expect(r.items[0]).toMatchObject({ patientId: 'p-1', mrn: 'MRN001', lastDate: new Date('2026-05-20') });
    });
  });
  it('createLesion', async () => { const r = await service.createLesion({ patientId: 'p-1', location: '얼굴', bodyRegion: 'FACE', morphology: 'PAPULE', recordedBy: 'doc-1' }); expect(r.id).toBe('sl-1'); });
  it('getLesions', async () => { await service.getLesions('p-1'); expect(p.skinLesion.findMany).toHaveBeenCalled(); });
  it('createTreatment', async () => { const r = await service.createTreatment({ patientId: 'p-1', lesionId: 'sl-1', treatmentType: 'EXCISION', procedure: '절제', treatedBy: 'doc-1' }); expect(r.id).toBe('st-1'); });
  it('getTreatments', async () => { await service.getTreatments('p-1'); expect(p.skinTreatment.findMany).toHaveBeenCalled(); });
  it('createBodyMap persists regions as SkinLesion rows (무저장 스텁 근절)', async () => {
    p.skinLesion.create = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'sl-x', ...data }));
    p.$transaction = vi.fn((ops: any[]) => Promise.all(ops));
    const r: any = await service.createBodyMap('p-1', {
      regions: [
        { bodyRegion: 'FACE', morphology: 'PAPULE', size: '3mm' },
        { bodyRegion: 'BACK' }, // morphology 미기재 → UNSPECIFIED 폴백
      ],
      notes: '전신 스크리닝', recordedBy: 'doc-1',
    });
    expect(r.createdCount).toBe(2);
    expect(p.skinLesion.create).toHaveBeenCalledTimes(2);
    expect(p.skinLesion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bodyRegion: 'BACK', morphology: 'UNSPECIFIED', recordedBy: 'doc-1' }) }),
    );
  });

  it('createBodyMap rejects empty regions', async () => {
    await expect(service.createBodyMap('p-1', { regions: [], recordedBy: 'doc-1' })).rejects.toThrow();
  });
});
