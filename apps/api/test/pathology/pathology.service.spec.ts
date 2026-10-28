import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PathologyService } from '../../src/modules/pathology/pathology.service';

describe('PathologyService', () => {
  let service: PathologyService;
  let p: any;
  const mockSpec = { id: 'sp-1', status: 'RECEIVED', clinicalInfo: null, specimenId: 'sp-1' };
  const mockReport = { id: 'rp-1', status: 'DRAFT', specimenId: 'sp-1' };

  beforeEach(() => {
    p = {
      pathologySpecimen: { findMany: vi.fn().mockResolvedValue([mockSpec]), findUnique: vi.fn().mockResolvedValue(mockSpec), create: vi.fn().mockResolvedValue(mockSpec), update: vi.fn().mockResolvedValue(mockSpec), updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(5), groupBy: vi.fn().mockResolvedValue([]) },
      pathologyReport: { findFirst: vi.fn().mockResolvedValue(mockReport), findUnique: vi.fn().mockResolvedValue({ ...mockReport, specimen: { patientId: 'p-1' } }), create: vi.fn().mockResolvedValue(mockReport), update: vi.fn().mockResolvedValue(mockReport), count: vi.fn().mockResolvedValue(3), findMany: vi.fn().mockResolvedValue([]) },
      // 배열형(signReport)·콜백형(createSpecimen accession 채번 advisory lock) 둘 다 지원
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn().mockImplementation((arg: any) => (typeof arg === 'function' ? arg(p) : Promise.all(arg))),
      blockchainCertificate: { findUnique: vi.fn().mockResolvedValue(null) },
      signedDocument: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'sd-1' }), update: vi.fn() },
      documentSignature: { create: vi.fn().mockResolvedValue({ id: 'ds-1' }) },
    };
    service = new PathologyService(p);
  });

  it('getSpecimens', async () => { await service.getSpecimens({}); expect(p.pathologySpecimen.findMany).toHaveBeenCalled(); });
  it('getSpecimenById', async () => { await service.getSpecimenById('sp-1'); });
  it('getSpecimenById — 없음', async () => { p.pathologySpecimen.findUnique.mockResolvedValue(null); await expect(service.getSpecimenById('x')).rejects.toThrow(NotFoundException); });
  it('createSpecimen', async () => { const r = await service.createSpecimen({ patientId: 'p-1', specimenType: 'BIOPSY' }); expect(r.id).toBe('sp-1'); });
  it('receiveSpecimen', async () => { await service.receiveSpecimen('sp-1'); expect(p.pathologySpecimen.updateMany).toHaveBeenCalled(); });
  it('createReport', async () => { const r = await service.createReport({ specimenId: 'sp-1', pathologistId: 'doc-1' }); expect(r.id).toBe('rp-1'); });
  it('updateReport — 미서명 DRAFT 수정 성공', async () => { p.pathologyReport.findUnique.mockResolvedValue({ id: 'rp-1', signedAt: null }); await service.updateReport('rp-1', { diagnosis: 'x' }); expect(p.pathologyReport.update).toHaveBeenCalled(); });
  it('[P0] 서명된 리포트 수정 차단(변조 방지)', async () => {
    p.pathologyReport.findUnique.mockResolvedValue({ id: 'rp-1', signedAt: new Date() });
    await expect(service.updateReport('rp-1', { diagnosis: '변조' })).rejects.toMatchObject({ response: { code: 'PATHOLOGY_REPORT_SIGNED' } });
    expect(p.pathologyReport.update).not.toHaveBeenCalled();
  });
  it('signReport', async () => { await service.signReport('rp-1', 'doc-1'); expect(p.$transaction).toHaveBeenCalled(); });
  it('addSlide', async () => { await service.addSlide('sp-1', { blockNo: 'B1', slideNo: 'S001', stainType: 'H&E' }); expect(p.pathologySpecimen.update).toHaveBeenCalled(); });
  it('getStats — FE 통계 탭 계약 필드(totalReceived/totalReported/averageTAT/urgentCount) 제공', async () => {
    // 🔴 종전엔 {byStatus,total}만 줘서 통계 탭 4카드가 데이터가 있어도 항상 0 이었다(P11·2026-08-13 W3)
    p.pathologySpecimen.groupBy.mockResolvedValue([
      { status: 'RECEIVED', _count: { id: 2 } },
      { status: 'SIGNED', _count: { id: 3 } },
    ]);
    p.pathologySpecimen.count.mockResolvedValue(1);
    p.pathologySpecimen.findMany.mockResolvedValue([
      { collectedAt: new Date('2026-08-01T00:00:00Z'), createdAt: new Date('2026-08-01T00:00:00Z'), priority: 'ROUTINE', report: { reportedAt: new Date('2026-08-02T00:00:00Z') } },
    ]);
    const r = await service.getStats();
    expect(r.totalReceived).toBe(5);
    expect(r.totalReported).toBe(3);
    expect(r.averageTAT).toBe(24);
    expect(r.urgentCount).toBe(1);
  });
});
