import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CssdPackageService } from '../../src/modules/cssd/cssd-package.service';

describe('CssdPackageService — BI-gated release & expiry', () => {
  let service: CssdPackageService;
  let mockPrisma: any;
  let journeyEmit: any;

  beforeEach(() => {
    mockPrisma = {
      sterilizationLoad: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      sterilePackage: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      encounter: { findUnique: vi.fn().mockResolvedValue({ patientId: 'pat-1' }) },
      packageEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction = vi.fn().mockImplementation((cb: any) => cb(mockPrisma));
    journeyEmit = vi.fn();
    service = new CssdPackageService(mockPrisma, {} as any, { emit: journeyEmit } as any);
  });

  const loadWith = (pkgs: any[]) => ({ id: 'L1', loadNo: 'L-1', packages: pkgs });

  describe('releaseLoad', () => {
    it('[P0] BI PENDING → 불출 거부', async () => {
      mockPrisma.sterilizationLoad.findUnique.mockResolvedValue(loadWith([{ id: 'p1', status: 'IN_LOAD', template: {} }]));
      await expect(service.releaseLoad('L1', { biResult: 'PENDING', ciResult: 'PASS', userId: 'u1' }))
        .rejects.toThrow(BadRequestException);
    });

    it('[P0] BI 미입력(undefined) → 불출 거부', async () => {
      mockPrisma.sterilizationLoad.findUnique.mockResolvedValue(loadWith([{ id: 'p1', status: 'IN_LOAD', template: {} }]));
      await expect(service.releaseLoad('L1', { biResult: undefined as any, ciResult: 'PASS', userId: 'u1' }))
        .rejects.toThrow(BadRequestException);
    });

    it('[P0] BI·CI 모두 PASS만 STERILE 방출', async () => {
      mockPrisma.sterilizationLoad.findUnique.mockResolvedValue(loadWith([{ id: 'p1', status: 'IN_LOAD', template: { shelfLifeDays: 30 } }]));
      const res = await service.releaseLoad('L1', { biResult: 'PASS', ciResult: 'PASS', userId: 'u1' });
      expect(res.released).toBe(true);
      const call = mockPrisma.sterilePackage.update.mock.calls.find((c: any) => c[0].where.id === 'p1');
      expect(call[0].data.status).toBe('STERILE');
    });

    it('[P0] BI FAIL → 회수(PACKAGED), STERILE 아님', async () => {
      mockPrisma.sterilizationLoad.findUnique.mockResolvedValue(loadWith([{ id: 'p1', status: 'IN_LOAD', template: {} }]));
      const res = await service.releaseLoad('L1', { biResult: 'FAIL', ciResult: 'PASS', userId: 'u1' });
      expect(res.released).toBe(false);
      const call = mockPrisma.sterilePackage.update.mock.calls.find((c: any) => c[0].where.id === 'p1');
      expect(call[0].data.status).toBe('PACKAGED');
    });

    it('[P0] CI FAIL이면 BI PASS라도 회수', async () => {
      mockPrisma.sterilizationLoad.findUnique.mockResolvedValue(loadWith([{ id: 'p1', status: 'IN_LOAD', template: {} }]));
      const res = await service.releaseLoad('L1', { biResult: 'PASS', ciResult: 'FAIL', userId: 'u1' });
      expect(res.released).toBe(false);
    });
  });

  describe('recallLoad (지연양성 BI 로드 회수)', () => {
    it('전 패키지 RECALLED + 사용 환자 감염추적 여정 이벤트', async () => {
      mockPrisma.sterilizationLoad.findUnique.mockResolvedValue({
        id: 'L1', loadNo: 'L-1', packages: [
          { id: 'p1', lotNo: 'PKG-1', status: 'STERILE', usedEncounterId: null },
          { id: 'p2', lotNo: 'PKG-2', status: 'IN_USE', usedEncounterId: 'enc-9' },
          { id: 'p3', lotNo: 'PKG-3', status: 'RECALLED', usedEncounterId: null },
        ],
      });
      const res = await service.recallLoad('L1', 'u1', '배양 48h 양성');
      expect(res.recalled).toBe(2); // RECALLED 제외
      expect(res.usedOnPatients).toBe(1);
      expect(res.affectedEncounters).toEqual(['enc-9']);
      // 로드 BI FAIL 기록
      expect(mockPrisma.sterilizationLoad.update).toHaveBeenCalledWith(expect.objectContaining({ data: { biResult: 'FAIL' } }));
      // 사용된 패키지 환자 여정 이벤트
      expect(journeyEmit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'CSSD_RECALL', patientId: 'pat-1' }));
    });

    it('존재하지 않는 로드 → NotFound', async () => {
      mockPrisma.sterilizationLoad.findUnique.mockResolvedValue(null);
      await expect(service.recallLoad('x', 'u1')).rejects.toThrow();
    });
  });

  describe('usePackage', () => {
    it('[P1] 유효기간 만료 패키지 사용 거부', async () => {
      mockPrisma.sterilePackage.findUnique.mockResolvedValue({ id: 'p1', status: 'STERILE', expiresAt: new Date('2020-01-01') });
      await expect(service.usePackage('p1', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('유효기간 내 STERILE 패키지 사용 허용(원자 선점)', async () => {
      mockPrisma.sterilePackage.findUnique
        .mockResolvedValueOnce({ id: 'p1', status: 'STERILE', expiresAt: new Date('2999-01-01') })
        .mockResolvedValueOnce({ id: 'p1', status: 'IN_USE' });
      mockPrisma.sterilePackage.updateMany.mockResolvedValue({ count: 1 });
      const res = await service.usePackage('p1', 'u1', 'enc-1');
      expect(res.status).toBe('IN_USE');
      expect(mockPrisma.sterilePackage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'p1', status: 'STERILE' },
      }));
    });

    it('[P2] 이미 사용된(선점 실패) 패키지는 거부', async () => {
      mockPrisma.sterilePackage.findUnique.mockResolvedValue({ id: 'p1', status: 'STERILE', expiresAt: new Date('2999-01-01') });
      mockPrisma.sterilePackage.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.usePackage('p1', 'u1', 'enc-1')).rejects.toThrow(BadRequestException);
    });
  });
});
