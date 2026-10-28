import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CheckupService } from '../../src/modules/checkup/checkup.service';

// 검진 자동판정·등급 롤업 (F: spec 밀도 — 오판정 = 환자안전 영향)
describe('CheckupService 판정 로직', () => {
  let service: CheckupService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = { checkupResultItem: { findMany: vi.fn() } };
    service = new CheckupService(mockPrisma, {} as any, { emit: vi.fn() } as any);
  });

  describe('autoJudgeFinding (참조범위 기반 개별 판정)', () => {
    const judge = (v: string | null, ref: string | null) => (service as any).autoJudgeFinding(v, ref);

    it('값·참조범위 없으면 PENDING', () => {
      expect(judge(null, '4000-10000')).toBe('PENDING');
      expect(judge('5000', null)).toBe('PENDING');
    });

    it('범위 내 = NORMAL', () => {
      expect(judge('7000', '4000-10000')).toBe('NORMAL');
      expect(judge('4000', '4000-10000')).toBe('NORMAL'); // 경계 포함
    });

    it('범위 벗어남 — 편차 ≤30% ABNORMAL · >30% CRITICAL', () => {
      expect(judge('11000', '4000-10000')).toBe('ABNORMAL'); // +10%
      expect(judge('14000', '4000-10000')).toBe('CRITICAL'); // +40%
      expect(judge('3000', '4000-10000')).toBe('ABNORMAL'); // (4000-3000)/4000=25% ≤30%
    });

    it('하한 미달 편차 계산 — (low-v)/low', () => {
      expect(judge('3500', '4000-10000')).toBe('ABNORMAL'); // (4000-3500)/4000=12.5%
      expect(judge('2000', '4000-10000')).toBe('CRITICAL'); // 50%
    });

    it('단일 상한(~40, <40) 판정', () => {
      expect(judge('30', '~40')).toBe('NORMAL');
      expect(judge('45', '<40')).toBe('ABNORMAL'); // +12.5%
      expect(judge('60', '~40')).toBe('CRITICAL'); // +50%
    });

    it('비수치 텍스트 — 정상/이상/양성 키워드', () => {
      expect(judge('정상', 'ref')).toBe('NORMAL');
      expect(judge('negative', 'ref')).toBe('NORMAL');
      expect(judge('이상 소견', 'ref')).toBe('ABNORMAL');
      expect(judge('positive', 'ref')).toBe('ABNORMAL');
      expect(judge('판독중', 'ref')).toBe('PENDING');
    });
  });

  describe('generateGradeSummary (영역별 최악 등급 롤업)', () => {
    it('영역 내 최악 finding으로 등급 산출 — CRITICAL=C1', async () => {
      mockPrisma.checkupResultItem.findMany.mockResolvedValue([
        { category: '혈액검사', testName: 'WBC', finding: 'NORMAL', value: '7000', unit: '/µL' },
        { category: '혈액검사', testName: 'Hb', finding: 'ABNORMAL', value: '10', unit: 'g/dL' },
        { category: '간기능', testName: 'AST', finding: 'CRITICAL', value: '200', unit: 'U/L' },
      ]);
      const r = await service.generateGradeSummary('v-1');
      const blood = r.sections.find((s) => s.area === '혈액검사')!;
      const liver = r.sections.find((s) => s.area === '간기능')!;
      expect(blood.grade).toBe('B');   // ABNORMAL 최악
      expect(liver.grade).toBe('C1');  // CRITICAL
      expect(r.overallGrade).toBe('C1'); // 전체 = 가장 심한 것
    });

    it('전부 정상이면 A·findings=정상', async () => {
      mockPrisma.checkupResultItem.findMany.mockResolvedValue([
        { category: '혈액검사', testName: 'WBC', finding: 'NORMAL', value: '7000', unit: '/µL' },
      ]);
      const r = await service.generateGradeSummary('v-1');
      expect(r.overallGrade).toBe('A');
      expect(r.sections[0].findings).toBe('정상');
    });

    it('검사명 키워드로 영역 매핑(당뇨→당뇨검사)·이상항목만 findings', async () => {
      mockPrisma.checkupResultItem.findMany.mockResolvedValue([
        { category: '기타', testName: '당뇨 HbA1c', finding: 'ABNORMAL', value: '7.5', unit: '%' },
        { category: '기타', testName: '당뇨 공복혈당', finding: 'NORMAL', value: '95', unit: 'mg/dL' },
      ]);
      const r = await service.generateGradeSummary('v-1');
      const dm = r.sections.find((s) => s.area === '당뇨검사')!;
      expect(dm).toBeDefined();
      expect(dm.findings).toContain('당뇨 HbA1c 7.5%');
      expect(dm.findings).not.toContain('공복혈당'); // NORMAL은 제외
    });

    it('🔴 미측정(PENDING)만 있으면 판정 불가 — A(정상)로 단정하지 않는다', async () => {
      // 종전 계약은 "PENDING은 A 유지"였다. 그 결과 **검사를 하나도 안 한 방문이
      // "종합판정 A · 전 영역 정상"** 으로 결과서에 인쇄됐다(2026-08-13 W5 실측).
      mockPrisma.checkupResultItem.findMany.mockResolvedValue([
        { category: '흉부', testName: '흉부 X-ray', finding: 'PENDING', value: null, unit: null },
      ]);
      const r = await service.generateGradeSummary('v-1');
      expect(r.overallGrade, '미검사를 정상으로 말하면 안 된다').toBeNull();
      expect(r.sections[0].grade).toBeNull();
      expect(r.sections[0].findings).toBe('미검사');
      expect(r.sections[0].pendingCount).toBe(1);
    });

    it('일부만 측정됐으면 측정된 것으로 판정하고 미측정 건수를 함께 알린다', async () => {
      mockPrisma.checkupResultItem.findMany.mockResolvedValue([
        { category: '흉부', testName: '흉부 X-ray', finding: 'NORMAL', value: null, unit: null },
        { category: '흉부', testName: '폐기능', finding: 'PENDING', value: null, unit: null },
      ]);
      const r = await service.generateGradeSummary('v-1');
      expect(r.overallGrade).toBe('A');
      // 영역 매핑이 두 항목을 다른 영역으로 나눌 수 있으므로 합계로 본다
      expect(r.sections.reduce((n, s) => n + s.pendingCount, 0)).toBe(1);
    });

    it('스킵(NOT_APPLICABLE)은 정상도 이상도 아니다', async () => {
      mockPrisma.checkupResultItem.findMany.mockResolvedValue([
        { category: '흉부', testName: '흉부 X-ray', finding: 'NOT_APPLICABLE', value: null, unit: null },
      ]);
      const r = await service.generateGradeSummary('v-1');
      expect(r.overallGrade).toBeNull();
    });
  });
});
