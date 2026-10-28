import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';

/** WeRU.B 후속(A-9) — 최근검사 컨텍스트 주입·피드백 대시보드 집계 */
describe('WeRU.B 후속(A-9)', () => {
  let service: MedicalAiService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      labResult: { findMany: vi.fn().mockResolvedValue([]) },
      allergy: { findMany: vi.fn().mockResolvedValue([]) },
      problemList: { findMany: vi.fn().mockResolvedValue([]) },
      prescription: { findMany: vi.fn().mockResolvedValue([]) },
      aiFeedback: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const cfg = { get: vi.fn() };
    const rt = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
    service = new MedicalAiService(cfg as any, rt as any, mockPrisma);
  });

  describe('최근검사 요약(getRecentLabsSummary)', () => {
    it('이상치(flag) 우선 정렬 + 항목별 최신값만(중복 제거)', async () => {
      mockPrisma.labResult.findMany.mockResolvedValue([
        { items: [ // 최신 결과
          { testName: 'CRP', value: '12.3', unit: 'mg/L', flag: 'H' },
          { testName: 'Na', value: '140', unit: 'mmol/L', flag: 'N' },
        ] },
        { items: [ // 과거 결과 — CRP는 최신값이 이미 있어 제외
          { testName: 'CRP', value: '3.1', unit: 'mg/L', flag: null },
          { testName: 'K', value: '3.1', unit: 'mmol/L', flag: 'L' },
        ] },
      ]);
      const r = await (service as any).getRecentLabsSummary('p-1');
      expect(r).toEqual(['CRP 12.3mg/L(H)', 'K 3.1mmol/L(L)', 'Na 140mmol/L']); // 이상치 2건 우선·N은 플래그 미표기
      const where = mockPrisma.labResult.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ in: ['COMPLETED', 'VERIFIED'] }); // 확정 결과만
    });

    it('조회 실패 시 빈 배열(AI 호출 비차단)', async () => {
      mockPrisma.labResult.findMany.mockRejectedValue(new Error('db down'));
      await expect((service as any).getRecentLabsSummary('p-1')).resolves.toEqual([]);
    });
  });

  describe('getPatientContext — recentLabs 포함(AI 인지 배지용)', () => {
    it('recentLabs 필드 + summaryText에 최근 검사 편입', async () => {
      mockPrisma.labResult.findMany.mockResolvedValue([{ items: [{ testName: 'Cr', value: '2.1', unit: 'mg/dL', flag: 'H' }] }]);
      const r = await service.getPatientContext('p-1');
      expect(r.recentLabs).toEqual(['Cr 2.1mg/dL(H)']);
      expect(r.summaryText).toContain('최근 검사(30일): Cr 2.1mg/dL(H)');
    });
  });

  describe('피드백 대시보드(feedbackStats)', () => {
    it('기능별(toolsUsed[0]) 👍/👎 집계·badRate·부정 코멘트', async () => {
      mockPrisma.aiFeedback.findMany.mockResolvedValue([
        { rating: 'GOOD', toolsUsed: ['ddx'], comment: null, createdAt: new Date(), model: 'llm' },
        { rating: 'BAD', toolsUsed: ['ddx'], comment: '진단 부정확', createdAt: new Date(), model: 'llm' },
        { rating: 'GOOD', toolsUsed: ['lab'], comment: null, createdAt: new Date(), model: 'llm' },
        { rating: 'BAD', toolsUsed: [], comment: null, createdAt: new Date(), model: null },
      ]);
      const r = await service.feedbackStats(30);
      expect(r.total).toBe(4);
      const ddx = r.features.find((f: any) => f.feature === 'ddx');
      expect(ddx).toEqual(expect.objectContaining({ good: 1, bad: 1, total: 2, badRate: 50 }));
      expect(r.features.find((f: any) => f.feature === 'GENERAL')?.bad).toBe(1); // toolsUsed 빈 배열 → GENERAL
      expect(r.recentBad).toHaveLength(1); // 코멘트 있는 BAD만
      expect(r.recentBad[0].comment).toBe('진단 부정확');
    });

    it('days 상한 365·비정상 입력은 기본 30', async () => {
      const r1 = await service.feedbackStats(9999);
      expect(r1.days).toBe(365);
      const r2 = await service.feedbackStats(NaN as any);
      expect(r2.days).toBe(30);
    });
  });
});
