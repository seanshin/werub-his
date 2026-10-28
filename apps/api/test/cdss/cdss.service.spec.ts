import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CdssService } from '../../src/modules/cdss/cdss.service';

describe('CdssService', () => {
  let service: CdssService;
  let mockPrisma: any;
  let mockDurService: any;
  let mockRulesRepo: any;

  beforeEach(() => {
    mockPrisma = {
      patient: { findUnique: vi.fn().mockResolvedValue({ id: 'p-1', dateOfBirth: new Date('1980-01-01'), gender: 'MALE' }) },
      medicationCode: { findUnique: vi.fn().mockResolvedValue({ id: 'med-1', nameKo: '아목시실린', ingredient: '아목시실린' }) },
      allergy: { findMany: vi.fn().mockResolvedValue([]) },
      labResultItem: { findFirst: vi.fn().mockResolvedValue(null) },
      encounter: { findUnique: vi.fn().mockResolvedValue({ id: 'enc-1', doctorId: 'doc-1', diagnoses: [] }), findMany: vi.fn().mockResolvedValue([]) },
      orderSet: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      cdssRule: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'r-1' }), update: vi.fn().mockResolvedValue({ id: 'r-1' }) },
      cdssLog: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      durRule: { count: vi.fn().mockResolvedValue(0) }, // 규칙 통계가 판정에 쓰이는 DUR 룰 수를 함께 낸다(2026-10-21)
    };
    mockDurService = { checkInteractions: vi.fn().mockResolvedValue([]) };
    // 룰 저장소는 필수 주입(2번째) — 처방세트 검증이 이 룰셋을 본다
    mockRulesRepo = { getRuleSet: vi.fn().mockResolvedValue({ interaction: [], age: [], maxDose: [], beers: [], pediatric: [] }) };
    service = new CdssService(mockPrisma, mockRulesRepo, mockDurService);
  });

  describe('check', () => {
    it('정상 — 경고/에러 없음', async () => {
      const result = await service.check({ patientId: 'p-1', medicationCodeId: 'med-1', encounterId: 'enc-1' });
      expect(['PASS', 'INFO']).toContain(result.level);
      expect(result.checks.filter((c: any) => c.level === 'ERROR')).toHaveLength(0);
    });

    it('알레르기 매칭 시 ERROR', async () => {
      mockPrisma.allergy.findMany.mockResolvedValue([{ allergen: '아목시실린', type: 'DRUG', severity: 'HIGH' }]);
      const result = await service.check({ patientId: 'p-1', medicationCodeId: 'med-1' });
      expect(result.level).toBe('ERROR');
      expect(result.checks.find((c: any) => c.category === 'ALLERGY')?.level).toBe('ERROR');
    });

    it('DUR 경고 반영', async () => {
      mockDurService.checkInteractions.mockResolvedValue([
        { type: 'INTERACTION', severity: 'WARNING', message: '약물 상호작용', drugB: '와파린' },
      ]);
      const result = await service.check({ patientId: 'p-1', medicationCodeId: 'med-1', encounterId: 'enc-1' });
      expect(result.level).toBe('WARNING');
    });

    it('신기능 기반 용량 조절 (Creatinine 높음)', async () => {
      mockPrisma.labResultItem.findFirst.mockResolvedValue({ value: '3.5' });
      const result = await service.check({ patientId: 'p-1', medicationCodeId: 'med-1' });
      const renalCheck = result.checks.find((c: any) => c.category === 'RENAL');
      expect(renalCheck?.level).toBe('WARNING');
    });

    it('연령 금기 (소아 아스피린)', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'p-1', dateOfBirth: new Date('2015-01-01'), gender: 'MALE' });
      mockPrisma.medicationCode.findUnique.mockResolvedValue({ id: 'med-2', nameKo: '아스피린', ingredient: '아스피린' });
      const result = await service.check({ patientId: 'p-1', medicationCodeId: 'med-2' });
      expect(result.checks.find((c: any) => c.category === 'AGE')?.level).toBe('ERROR');
    });

    it('약물 없으면 최소 검증만', async () => {
      mockPrisma.medicationCode.findUnique.mockResolvedValue(null);
      const result = await service.check({ patientId: 'p-1', medicationCodeId: 'med-99' });
      expect(result.totalChecks).toBeGreaterThanOrEqual(0);
    });
  });

  describe('suggestOrderSet', () => {
    it('진단 기반 처방세트 추천', async () => {
      mockPrisma.orderSet.findMany.mockResolvedValue([{ name: '[OS-HTN] 고혈압 기본', diagnosisCode: 'I10', isActive: true, items: [1, 2] }]);
      const result = await service.suggestOrderSet('I10', 'p-1');
      expect(result.diagnosisCode).toBe('I10');
      expect(result.suggestedOrderSets).toHaveLength(1);
      expect(result.suggestedOrderSets[0].matchScore).toBe(95);
    });
  });

  describe('규칙 CRUD', () => {
    it('규칙 목록 조회', async () => {
      await service.getRules('INTERACTION');
      expect(mockPrisma.cdssRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { isActive: true, category: 'INTERACTION' },
      }));
    });

    it('규칙 생성', async () => {
      await service.createRule({ name: 'test', category: 'ALLERGY', level: 'ERROR' } as any);
      expect(mockPrisma.cdssRule.create).toHaveBeenCalled();
    });

    it('규칙 삭제 (비활성화)', async () => {
      await service.deleteRule('r-1');
      expect(mockPrisma.cdssRule.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }));
    });
  });

  describe('getRuleStats', () => {
    it('통계 반환', async () => {
      mockPrisma.cdssRule.findMany.mockResolvedValue([
        { id: '1', category: 'ALLERGY', hitCount: 10, name: 'r1', level: 'ERROR' },
        { id: '2', category: 'ALLERGY', hitCount: 5, name: 'r2', level: 'WARNING' },
      ]);
      const result = await service.getRuleStats();
      expect(result.totalRules).toBe(2);
      expect(result.byCategory.ALLERGY).toBe(2);
    });
  });

  describe('검증 이력', () => {
    it('로그 조회', async () => {
      await service.getLogs('p-1', 'ERROR');
      expect(mockPrisma.cdssLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { patientId: 'p-1', overallLevel: 'ERROR' },
      }));
    });

    it('진료별 로그', async () => {
      await service.getLogsByEncounter('enc-1');
      expect(mockPrisma.cdssLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { encounterId: 'enc-1' },
      }));
    });
  });
});
