import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DurService } from '../../src/modules/prescription/dur/dur.service';
import { DurRulesRepo } from '../../src/modules/prescription/dur/dur-rules.repo';

// DUR P2 — 효능군(분류) 중복·Beers(노인주의)·maxDailyDose(DB) 검사
describe('DurService P2', () => {
  let service: DurService;
  let mockPrisma: any;

  const baseMed = {
    id: 'mc-new', nameKo: '신규약', ingredient: 'drug-a', ingredientCode: 'ING-A',
    category: '항히스타민제', pregnancyCategory: null, highAlertFlag: false, lasaGroup: null,
    maxDailyDose: null,
  };

  const setup = (newMed: Record<string, unknown>, opts?: {
    existingRx?: unknown[]; birthYear?: number;
  }) => {
    mockPrisma.medicationCode.findUnique.mockResolvedValue({ ...baseMed, ...newMed });
    mockPrisma.patient.findUnique.mockResolvedValue({
      dateOfBirth: new Date(`${opts?.birthYear ?? 1990}-01-01`), allergies: null,
    });
    mockPrisma.encounter.findUnique.mockResolvedValue({ pregnancyStatus: null });
    mockPrisma.prescription.findMany
      .mockResolvedValueOnce(opts?.existingRx ?? [])
      .mockResolvedValueOnce([]);
  };

  beforeEach(() => {
    mockPrisma = {
      medicationCode: { findUnique: vi.fn() },
      patient: { findUnique: vi.fn() },
      encounter: { findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
      prescription: { findMany: vi.fn() },
      preVisitVitals: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    // P0-a①(2026-08-04)에서 룰이 DurRulesRepo 정본으로 이관 — DB 조회가 실패하면 하드코딩 폴백(fail-safe).
    // 이 spec 은 폴백 룰셋(이관 전과 동일 판정) 경로를 검증한다.
    const rulesRepo = new DurRulesRepo({
      durRule: { findMany: vi.fn().mockRejectedValue(new Error('no db in spec')) },
    } as never);
    service = new DurService(mockPrisma, rulesRepo);
  });

  describe('효능군(분류) 중복', () => {
    it('동일 category·다른 성분 병용 → THERAPEUTIC_DUPLICATION WARNING', async () => {
      setup({}, {
        existingRx: [{
          medicationCodeId: 'mc-old',
          medicationCode: { nameKo: '기존항히스타민', category: '항히스타민제', ingredientCode: 'ING-B', ingredient: 'drug-b' },
        }],
      });
      const warnings = await service.checkInteractions('enc-1', 'mc-new', 'pat-1');
      const dup = warnings.filter(w => w.type === 'THERAPEUTIC_DUPLICATION');
      expect(dup).toHaveLength(1);
      expect(dup[0].severity).toBe('WARNING');
      expect(dup[0].message).toContain('항히스타민제');
    });

    it('동일 성분이면 효능군 중복은 미발행 (성분 중복 경고와 이중 방지)', async () => {
      setup({}, {
        existingRx: [{
          medicationCodeId: 'mc-old',
          medicationCode: { nameKo: '동일성분약', category: '항히스타민제', ingredientCode: 'ING-A', ingredient: 'drug-a' },
        }],
      });
      const warnings = await service.checkInteractions('enc-1', 'mc-new', 'pat-1');
      expect(warnings.some(w => w.type === 'THERAPEUTIC_DUPLICATION')).toBe(false);
      expect(warnings.some(w => w.type === 'DUPLICATE')).toBe(true);
    });

    it('광범위 분류(기타)는 판정 제외', async () => {
      setup({ category: '기타' }, {
        existingRx: [{
          medicationCodeId: 'mc-old',
          medicationCode: { nameKo: 'X', category: '기타', ingredientCode: 'ING-B', ingredient: 'drug-b' },
        }],
      });
      const warnings = await service.checkInteractions('enc-1', 'mc-new', 'pat-1');
      expect(warnings.some(w => w.type === 'THERAPEUTIC_DUPLICATION')).toBe(false);
    });
  });

  describe('Beers Criteria (노인주의)', () => {
    it('≥65세 + 1세대 항히스타민(영문 성분) → BEERS WARNING', async () => {
      setup({ ingredient: 'chlorpheniramine maleate 4mg', ingredientCode: 'ING-CPM' }, { birthYear: 1950 });
      const warnings = await service.checkInteractions('enc-1', 'mc-new', 'pat-1');
      const beers = warnings.filter(w => w.type === 'BEERS');
      expect(beers).toHaveLength(1);
      expect(beers[0].message).toContain('노인주의');
    });

    it('65세 미만은 미발행', async () => {
      setup({ ingredient: 'chlorpheniramine maleate 4mg' }, { birthYear: 1990 });
      const warnings = await service.checkInteractions('enc-1', 'mc-new', 'pat-1');
      expect(warnings.some(w => w.type === 'BEERS')).toBe(false);
    });

    it('한글명 매칭도 동작 (디아제팜)', async () => {
      setup({ ingredient: '', nameKo: '디아제팜정 5mg' }, { birthYear: 1950 });
      const warnings = await service.checkInteractions('enc-1', 'mc-new', 'pat-1');
      expect(warnings.some(w => w.type === 'BEERS')).toBe(true);
    });
  });

  describe('maxDailyDose (DB 기반)', () => {
    it('일일 총량 초과 → MAX_DOSE ERROR', async () => {
      setup({ maxDailyDose: 4000 });
      const warnings = await service.checkInteractions('enc-1', 'mc-new', 'pat-1',
        { dosage: '1000mg', frequency: '1일 6회' });
      const max = warnings.filter(w => w.type === 'MAX_DOSE');
      expect(max).toHaveLength(1);
      expect(max[0].severity).toBe('ERROR');
      expect(max[0].message).toContain('6000mg/일');
    });

    it('허가 범위 내면 미발행', async () => {
      setup({ maxDailyDose: 4000 });
      const warnings = await service.checkInteractions('enc-1', 'mc-new', 'pat-1',
        { dosage: '500mg', frequency: '1일 3회' });
      expect(warnings.some(w => w.type === 'MAX_DOSE')).toBe(false);
    });

    it('용법 컨텍스트 미전달 시 검사 생략 (하위호환)', async () => {
      setup({ maxDailyDose: 100 });
      const warnings = await service.checkInteractions('enc-1', 'mc-new', 'pat-1');
      expect(warnings.some(w => w.type === 'MAX_DOSE')).toBe(false);
    });

    it('maxDailyDose 미등재(0건 데이터) 시 생략', async () => {
      setup({ maxDailyDose: null });
      const warnings = await service.checkInteractions('enc-1', 'mc-new', 'pat-1',
        { dosage: '9999mg', frequency: '1일 9회' });
      expect(warnings.some(w => w.type === 'MAX_DOSE')).toBe(false);
    });
  });
});
