import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ClinicalChartVerificationService } from '../../src/modules/clinical-chart-verification/clinical-chart-verification.service';

/**
 * 가드 스펙 — 2026-08 W8. 임상 가이드라인 검수의 자가 승인 차단·안전 기본값.
 * 완화(기본값 off 로 되돌리기, 자가 승인 허용)는 환자안전위원회 의결 없이는 금지.
 */
describe('ClinicalChartVerificationService', () => {
  let service: ClinicalChartVerificationService;
  let p: any;
  const user = { id: 'u-1', familyName: '김', givenName: '의사' };

  beforeEach(() => {
    p = {
      clinicalChartVerification: {
        create: vi.fn().mockResolvedValue({ id: 'v-1' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      systemConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    service = new ClinicalChartVerificationService(p);
  });

  describe('가드 ⑤ 자가 승인 차단', () => {
    it('같은 사람이 같은 정의를 두 번 승인하면 거부한다', async () => {
      p.clinicalChartVerification.findMany.mockResolvedValue([
        { status: 'VERIFIED', verifiedBy: 'u-1', defHash: 'h1' },
      ]);
      await expect(
        service.create({ chartId: 'NEWS2', status: 'VERIFIED', defHash: 'h1' } as any, user),
      ).rejects.toThrow(ConflictException);
      expect(p.clinicalChartVerification.create).not.toHaveBeenCalled();
    });

    it('다른 사람의 2차 승인은 허용한다', async () => {
      p.clinicalChartVerification.findMany.mockResolvedValue([
        { status: 'VERIFIED', verifiedBy: 'u-2', defHash: 'h1' },
      ]);
      await service.create({ chartId: 'NEWS2', status: 'VERIFIED', defHash: 'h1' } as any, user);
      expect(p.clinicalChartVerification.create).toHaveBeenCalled();
    });

    it('마지막 반려 이후 구간만 본다 — 반려로 리셋되면 본인이 다시 승인 가능', async () => {
      p.clinicalChartVerification.findMany.mockResolvedValue([
        { status: 'REJECTED', verifiedBy: 'u-9', defHash: 'h1' },
        { status: 'VERIFIED', verifiedBy: 'u-1', defHash: 'h1' },
      ]);
      await service.create({ chartId: 'NEWS2', status: 'VERIFIED', defHash: 'h1' } as any, user);
      expect(p.clinicalChartVerification.create).toHaveBeenCalled();
    });

    it('정의가 바뀌면(defHash 다름) 본인 재승인 가능', async () => {
      p.clinicalChartVerification.findMany.mockResolvedValue([
        { status: 'VERIFIED', verifiedBy: 'u-1', defHash: 'old' },
      ]);
      await service.create({ chartId: 'NEWS2', status: 'VERIFIED', defHash: 'new' } as any, user);
      expect(p.clinicalChartVerification.create).toHaveBeenCalled();
    });

    it('반려(REJECTED)는 중복 제출을 막지 않는다 — 안전 방향', async () => {
      p.clinicalChartVerification.findMany.mockResolvedValue([
        { status: 'VERIFIED', verifiedBy: 'u-1', defHash: 'h1' },
      ]);
      await service.create({ chartId: 'NEWS2', status: 'REJECTED', defHash: 'h1' } as any, user);
      expect(p.clinicalChartVerification.create).toHaveBeenCalled();
    });
  });

  describe('4-eyes 안전 기본값', () => {
    it('설정 행이 없으면 4-eyes 는 ON (설정 안 함 ≠ 끔)', async () => {
      p.systemConfig.findUnique.mockResolvedValue(null);
      const r = await service.getSummary();
      expect(r.fourEyes).toBe(true);
      expect(r.fourEyesSource).toBe('default');
    });

    it('관리자가 명시적으로 false 로 설정한 경우에만 꺼진다', async () => {
      p.systemConfig.findUnique.mockResolvedValue({ value: false });
      const r = await service.getSummary();
      expect(r.fourEyes).toBe(false);
      expect(r.fourEyesSource).toBe('config');
    });

    it('{ enabled: true } 형태도 인식한다', async () => {
      p.systemConfig.findUnique.mockResolvedValue({ value: { enabled: true } });
      expect((await service.getSummary()).fourEyes).toBe(true);
    });
  });

  describe('요약 집계', () => {
    it('동일인의 중복 승인은 승인자 1인으로만 센다 (4-eyes 우회 차단)', async () => {
      p.clinicalChartVerification.findMany.mockResolvedValue([
        { chartId: 'NEWS2', status: 'VERIFIED', verifiedBy: 'u-1', verifiedByName: '김의사', defHash: 'h1', createdAt: new Date(), sourceGuideline: null, sourceVersion: null, note: null },
        { chartId: 'NEWS2', status: 'VERIFIED', verifiedBy: 'u-1', verifiedByName: '김의사', defHash: 'h1', createdAt: new Date(), sourceGuideline: null, sourceVersion: null, note: null },
      ]);
      const r = await service.getSummary();
      expect(r.items[0].approverCount).toBe(1);
    });

    it('검수 기록이 0행이면 items 는 빈 목록 (임의의 "검증됨" 폴백 없음)', async () => {
      p.clinicalChartVerification.findMany.mockResolvedValue([]);
      const r = await service.getSummary();
      expect(r.items).toEqual([]);
    });
  });
});
