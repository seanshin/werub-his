import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReferenceRangeService } from '../../src/modules/reference-range/reference-range.service';

describe('ReferenceRangeService', () => {
  let service: ReferenceRangeService;
  let prisma: any;

  beforeEach(() => {
    prisma = { referenceRange: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() } };
    service = new ReferenceRangeService(prisma);
  });

  describe('computeFlag', () => {
    const R = { low: 3.5, high: 5.0, criticalLow: 2.8, criticalHigh: 6.5 };
    it('LL when at/below criticalLow', () => { expect(service.computeFlag(2.8, R)).toBe('LL'); expect(service.computeFlag(2.0, R)).toBe('LL'); });
    it('HH when at/above criticalHigh', () => { expect(service.computeFlag(6.5, R)).toBe('HH'); expect(service.computeFlag(9, R)).toBe('HH'); });
    it('L below low (not critical)', () => { expect(service.computeFlag(3.0, R)).toBe('L'); });
    it('H above high (not critical)', () => { expect(service.computeFlag(5.5, R)).toBe('H'); });
    it('N within range', () => { expect(service.computeFlag(4.2, R)).toBe('N'); });
    it('null when no range at all', () => { expect(service.computeFlag(4, { low: null, high: null, criticalLow: null, criticalHigh: null })).toBeNull(); });
    it('null for NaN value', () => { expect(service.computeFlag(NaN, R)).toBeNull(); });
    it('open-high range: only low bound', () => { expect(service.computeFlag(2, { low: 5, high: null, criticalLow: null, criticalHigh: null })).toBe('L'); expect(service.computeFlag(9, { low: 5, high: null, criticalLow: null, criticalHigh: null })).toBe('N'); });
  });

  describe('flagValue', () => {
    const R = { low: 3.5, high: 5.0, criticalLow: 2.8, criticalHigh: 6.5, textNormal: null };
    it('numeric → computeFlag', () => { expect(service.flagValue('7.0', R)).toBe('HH'); expect(service.flagValue('4.0', R)).toBe('N'); });
    it('qualitative match textNormal → N', () => { expect(service.flagValue('Negative', { low: null, high: null, criticalLow: null, criticalHigh: null, textNormal: 'Negative' })).toBe('N'); });
    it('qualitative mismatch textNormal → A (abnormal, not N)', () => { expect(service.flagValue('DETECTED', { low: null, high: null, criticalLow: null, criticalHigh: null, textNormal: 'Negative' })).toBe('A'); });
    it('[safety] qualitative with no textNormal → null (NOT forced N)', () => { expect(service.flagValue('DETECTED', { low: null, high: null, criticalLow: null, criticalHigh: null, textNormal: null })).toBeNull(); });
  });

  describe('resolve', () => {
    it('[safety] unknown age → only age-agnostic ranges (no pediatric mismatch)', async () => {
      prisma.referenceRange.findMany.mockResolvedValue([
        { id: 'peds', sex: 'ANY', testCode: 'BILI', ageMinYears: 0, ageMaxYears: 1, low: null, high: 12, criticalLow: null, criticalHigh: 20, unit: 'mg/dL', textNormal: null },
        { id: 'adult', sex: 'ANY', testCode: 'BILI', ageMinYears: null, ageMaxYears: null, low: null, high: 1.2, criticalLow: null, criticalHigh: 3, unit: 'mg/dL', textNormal: null },
      ]);
      const r = await service.resolve({ testCode: 'BILI', sex: 'MALE', ageYears: null });
      expect(r?.id).toBe('adult'); // 나이 미상이 신생아 범위(high 12)로 오매칭되지 않음
    });
    it('returns null when no testCode/loincCode', async () => {
      expect(await service.resolve({})).toBeNull();
      expect(prisma.referenceRange.findMany).not.toHaveBeenCalled();
    });

    it('picks sex-specific over ANY (score)', async () => {
      prisma.referenceRange.findMany.mockResolvedValue([
        { id: 'any', sex: 'ANY', testCode: 'L0003', ageMinYears: null, ageMaxYears: null, low: 12, high: 17, criticalLow: null, criticalHigh: null, unit: 'g/dL', textNormal: null },
        { id: 'male', sex: 'MALE', testCode: 'L0003', ageMinYears: null, ageMaxYears: null, low: 13, high: 17.5, criticalLow: null, criticalHigh: null, unit: 'g/dL', textNormal: null },
      ]);
      const r = await service.resolve({ testCode: 'L0003', sex: 'MALE', ageYears: 30 });
      expect(r?.id).toBe('male');
      expect(r?.low).toBe(13);
    });

    it('filters out non-matching sex', async () => {
      prisma.referenceRange.findMany.mockResolvedValue([
        { id: 'female', sex: 'FEMALE', testCode: 'L0003', ageMinYears: null, ageMaxYears: null, low: 12, high: 16, criticalLow: null, criticalHigh: null, unit: null, textNormal: null },
      ]);
      const r = await service.resolve({ testCode: 'L0003', sex: 'MALE', ageYears: 30 });
      expect(r).toBeNull(); // FEMALE-only, male patient → no match
    });

    it('[peds] matches infant month-band and age-band outranks adult sex-range', async () => {
      prisma.referenceRange.findMany.mockResolvedValue([
        // 성인 남성(전연령·성별특이) Hb
        { id: 'adultM', sex: 'MALE', testCode: 'L0003', ageMinYears: null, ageMaxYears: null, ageMinMonths: null, ageMaxMonths: null, low: 13, high: 17.5, criticalLow: null, criticalHigh: null, unit: 'g/dL', textNormal: null },
        // 영아 3-6개월(개월 연령대) Hb
        { id: 'infant', sex: 'ANY', testCode: 'L0003', ageMinYears: null, ageMaxYears: null, ageMinMonths: 3, ageMaxMonths: 6, low: 9.5, high: 14.5, criticalLow: null, criticalHigh: null, unit: 'g/dL', textNormal: null },
      ]);
      // 4개월 남아 → 성인 남성 범위(성별특이)가 아니라 영아 개월범위가 이겨야(연령 우선).
      const r = await service.resolve({ testCode: 'L0003', sex: 'MALE', ageYears: 0, ageMonths: 4 });
      expect(r?.id).toBe('infant');
      expect(r?.high).toBe(14.5);
    });

    it('[peds] infant excluded when out of month band', async () => {
      prisma.referenceRange.findMany.mockResolvedValue([
        { id: 'newborn', sex: 'ANY', testCode: 'L0003', ageMinYears: null, ageMaxYears: null, ageMinMonths: 0, ageMaxMonths: 1, low: 14, high: 24, criticalLow: null, criticalHigh: null, unit: 'g/dL', textNormal: null },
      ]);
      // 4개월 → 0-1개월 범위 미매칭 → null
      expect(await service.resolve({ testCode: 'L0003', sex: 'MALE', ageYears: 0, ageMonths: 4 })).toBeNull();
    });

    it('respects age band [min,max)', async () => {
      prisma.referenceRange.findMany.mockResolvedValue([
        { id: 'peds', sex: 'ANY', testCode: 'X', ageMinYears: 0, ageMaxYears: 12, low: 1, high: 2, criticalLow: null, criticalHigh: null, unit: null, textNormal: null },
        { id: 'adult', sex: 'ANY', testCode: 'X', ageMinYears: 18, ageMaxYears: null, low: 3, high: 4, criticalLow: null, criticalHigh: null, unit: null, textNormal: null },
      ]);
      expect((await service.resolve({ testCode: 'X', sex: 'MALE', ageYears: 5 }))?.id).toBe('peds');
      expect((await service.resolve({ testCode: 'X', sex: 'MALE', ageYears: 40 }))?.id).toBe('adult');
      // age 15 → between bands → neither matches
      expect(await service.resolve({ testCode: 'X', sex: 'MALE', ageYears: 15 })).toBeNull();
    });
  });
});
