import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ImagingSafetyService } from '../../src/modules/imaging/imaging-safety.service';

describe('ImagingSafetyService', () => {
  let service: ImagingSafetyService;
  let mockPrisma: any;
  let mockConfig: any;
  let configValues: Record<string, unknown>;

  const basePatient = { id: 'pat-1', gender: 'FEMALE', dateOfBirth: new Date('1990-01-01') };

  const makeOrder = (over?: {
    procedureCode?: Record<string, unknown> | null;
    pregnancyStatus?: string | null;
    patient?: Record<string, unknown>;
  }) => ({
    id: 'order-1',
    prescription: {
      procedureCode: over?.procedureCode === undefined
        ? { code: 'HA401', nameKo: '복부 CT (조영)', modality: null, usesContrast: false }
        : over.procedureCode,
      encounter: {
        patientId: 'pat-1',
        pregnancyStatus: over?.pregnancyStatus ?? null,
        patient: over?.patient ?? basePatient,
      },
    },
  });

  beforeEach(() => {
    configValues = {};
    mockPrisma = {
      order: { findUnique: vi.fn() },
      allergy: { findMany: vi.fn().mockResolvedValue([]) },
      labResultItem: { findFirst: vi.fn().mockResolvedValue(null) },
      imagingResult: { findUnique: vi.fn().mockResolvedValue(null) },
      radiationExposure: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { effectiveDoseMsv: null }, _count: 0 }),
        upsert: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    mockConfig = { get: vi.fn(async (k: string) => configValues[k] ?? null) };
    service = new ImagingSafetyService(mockPrisma, mockConfig);
  });

  describe('detectModality', () => {
    it('should prefer explicit modality', () => {
      expect(service.detectModality('mr', 'HA401', '복부 CT')).toBe('MR');
    });
    it('should detect CT from code prefix HA', () => {
      expect(service.detectModality(null, 'HA401', '')).toBe('CT');
    });
    it('should detect US from name', () => {
      expect(service.detectModality(null, 'HC123', '복부 초음파')).toBe('US');
    });
  });

  describe('assertAcquireGate — contrast', () => {
    it('should BLOCK on contrast allergy when imaging.contrastEnforce=BLOCK', async () => {
      configValues['imaging.contrastEnforce'] = 'BLOCK';
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({ pregnancyStatus: 'NONE' }));
      mockPrisma.allergy.findMany.mockResolvedValue([
        { allergen: 'CT 조영제 (iodine)', severity: 'SEVERE' },
      ]);

      await expect(service.assertAcquireGate('order-1')).rejects.toThrow(BadRequestException);
    });

    it('should allow override with audit payload', async () => {
      configValues['imaging.contrastEnforce'] = 'BLOCK';
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({ pregnancyStatus: 'NONE' }));
      mockPrisma.allergy.findMany.mockResolvedValue([
        { allergen: '요오드 조영제', severity: 'SEVERE' },
      ]);

      const result = await service.assertAcquireGate('order-1', {
        override: true, overrideReason: '응급 — 대체검사 불가', userId: 'u-1',
      });

      expect(result.overridden).toBe(true);
      expect(result.overrideReason).toContain('응급');
      expect(result.overriddenBy).toBe('u-1');
    });

    it('should BLOCK on eGFR < 30', async () => {
      configValues['imaging.contrastEnforce'] = 'BLOCK';
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({ pregnancyStatus: 'NONE' }));
      mockPrisma.labResultItem.findFirst.mockResolvedValue({ value: '4.5' }); // 중증 신부전

      await expect(service.assertAcquireGate('order-1')).rejects.toThrow(BadRequestException);
    });

    it('should WARN (not throw) when contrastEnforce=WARN', async () => {
      configValues['imaging.contrastEnforce'] = 'WARN';
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({ pregnancyStatus: 'NONE' }));
      mockPrisma.allergy.findMany.mockResolvedValue([
        { allergen: '조영제', severity: 'SEVERE' },
      ]);

      const result = await service.assertAcquireGate('order-1');
      expect(result.checks.some((c) => c.rule === 'CONTRAST_ALLERGY' && c.level === 'ERROR')).toBe(true);
    });

    it('should pass silently when gate OFF (default)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder());
      mockPrisma.allergy.findMany.mockResolvedValue([
        { allergen: '조영제', severity: 'SEVERE' },
      ]);

      const result = await service.assertAcquireGate('order-1');
      expect(result.checks.length).toBeGreaterThan(0); // 평가·기록은 하되 차단 안 함
    });
  });

  describe('assertAcquireGate — pregnancy', () => {
    it('should BLOCK PREGNANT patient for ionizing modality when pregnancyEnforce=BLOCK', async () => {
      configValues['imaging.pregnancyEnforce'] = 'BLOCK';
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({
        procedureCode: { code: 'G1001', nameKo: '흉부 단순촬영', modality: null, usesContrast: false },
        pregnancyStatus: 'PREGNANT',
      }));

      await expect(service.assertAcquireGate('order-1')).rejects.toThrow(BadRequestException);
    });

    it('should WARN on unassessed pregnancy for childbearing-age female', async () => {
      configValues['imaging.pregnancyEnforce'] = 'BLOCK';
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({
        procedureCode: { code: 'G1001', nameKo: '흉부 단순촬영', modality: null, usesContrast: false },
        pregnancyStatus: null,
      }));

      const result = await service.assertAcquireGate('order-1');
      expect(result.checks.some((c) => c.rule === 'PREGNANCY' && c.level === 'WARNING')).toBe(true);
    });

    it('should skip pregnancy check for male patient', async () => {
      configValues['imaging.pregnancyEnforce'] = 'BLOCK';
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({
        procedureCode: { code: 'G1001', nameKo: '흉부 단순촬영', modality: null, usesContrast: false },
        pregnancyStatus: 'PREGNANT',
        patient: { id: 'pat-2', gender: 'MALE', dateOfBirth: new Date('1990-01-01') },
      }));

      const result = await service.assertAcquireGate('order-1');
      expect(result.checks.some((c) => c.rule === 'PREGNANCY')).toBe(false);
    });

    it('should skip pregnancy check for non-ionizing modality (US)', async () => {
      configValues['imaging.pregnancyEnforce'] = 'BLOCK';
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({
        procedureCode: { code: 'HC123', nameKo: '복부 초음파', modality: null, usesContrast: false },
        pregnancyStatus: 'PREGNANT',
      }));

      const result = await service.assertAcquireGate('order-1');
      expect(result.checks.some((c) => c.rule === 'PREGNANCY')).toBe(false);
    });
  });

  describe('cumulative dose', () => {
    /**
     * 🔴 결함 재주입으로 검증한 가드 — `checkCumulativeDose` 가 기록 0건에서 `null` 을 돌려주면
     *    이 테스트는 실패한다. 종전에는 항목이 통째로 사라져, 이송 전 확인 화면이
     *    "확인 항목 없음(조영·방사선 검사 아님)" 이라 단정했다(전리방사선 검사인데).
     *    운영 실측 2026-08-24: `radiation_exposures` 0행 · 전리방사선 촬영 117건 → 전건 침묵.
     */
    it('should say 산출 불가 (not silence, not 0 mSv) when no exposure record exists', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({ pregnancyStatus: 'NONE' }));
      mockPrisma.radiationExposure.aggregate.mockResolvedValue({ _sum: { effectiveDoseMsv: null }, _count: 0 });

      const result = await service.assertAcquireGate('order-1');
      const dose = result.checks.find((c) => c.rule === 'CUMULATIVE_DOSE');
      expect(dose).toBeDefined();
      expect(dose?.message).toContain('산출 불가');
      expect(dose?.message).not.toContain('0.0 mSv'); // 모르는 것을 0 으로 말하지 않는다
      expect(dose?.data?.cumulativeMsv).toBeNull();
      expect(dose?.data?.unavailableReason).toBe('NO_RECORD');
    });

    /** 대조군 — 기록이 있으면 '산출 불가'라 말하지 않는다(무조건 통과하는 가드 방지) */
    it('should NOT claim 산출 불가 when records exist', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({ pregnancyStatus: 'NONE' }));
      mockPrisma.radiationExposure.aggregate.mockResolvedValue({ _sum: { effectiveDoseMsv: 12.5 }, _count: 3 });

      const result = await service.assertAcquireGate('order-1');
      const dose = result.checks.find((c) => c.rule === 'CUMULATIVE_DOSE');
      expect(dose?.message).not.toContain('산출 불가');
      expect(dose?.data?.cumulativeMsv).toBe(12.5);
    });

    /** 비전리 검사까지 번지지 않는다 — 초음파에 피폭 항목이 뜨면 그것도 거짓말이다 */
    it('should not emit CUMULATIVE_DOSE for non-ionizing modality', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({
        procedureCode: { code: 'HC123', nameKo: '복부 초음파', modality: null, usesContrast: false },
        pregnancyStatus: 'NONE',
      }));
      const result = await service.assertAcquireGate('order-1');
      expect(result.checks.some((c) => c.rule === 'CUMULATIVE_DOSE')).toBe(false);
    });

    it('should WARN when 12mo cumulative dose exceeds threshold', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({ pregnancyStatus: 'NONE' }));
      mockPrisma.radiationExposure.aggregate.mockResolvedValue({ _sum: { effectiveDoseMsv: 120 }, _count: 8 });

      const result = await service.assertAcquireGate('order-1');
      const dose = result.checks.find((c) => c.rule === 'CUMULATIVE_DOSE');
      expect(dose?.level).toBe('WARNING');
    });
  });

  /**
   * 전리방사선 판정 어휘 — 운영에 `XR`·`X-ray` 로 저장된 촬영이 실재한다(2026-08-24 실측 2건).
   * 집합 밖으로 떨어지면 임신 게이트와 피폭 추적이 **조용히 꺼진다**.
   */
  describe('isIonizing — 저장된 어휘를 빠뜨리지 않는다', () => {
    it.each(['CT', 'CR', 'MG', 'NM', 'RF', 'XR', 'X-ray', 'x-ray'])('%s is ionizing', (m) => {
      expect(service.isIonizing(m)).toBe(true);
    });
    it.each(['US', 'MR'])('%s is not ionizing', (m) => {
      expect(service.isIonizing(m)).toBe(false);
    });
  });

  /**
   * 🔴 modality 판정 근거 — 시술코드는 처방 DTO 전 경로에서 **선택**이다.
   *    운영 실측 2026-08-24: 영상 결과 209건 중 시술코드가 달린 건 46건(22%) · CT 36건은 **전건 0**.
   *    시술코드만 보면 판정이 'OT' 가 되어 임신·피폭 항목이 **한 개도 돌지 않고**,
   *    화면은 그 빈 결과를 "조영·방사선 검사 아님" 으로 읽었다. CT 를 앞둔 환자에게.
   */
  describe('modality 판정 — 시술코드가 없어도 아는 것을 쓴다', () => {
    const noCodeOrder = () => makeOrder({ procedureCode: null, pregnancyStatus: 'NONE' });

    it('시술코드가 없으면 이미 기록된 촬영의 modality 를 근거로 삼는다', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(noCodeOrder());
      mockPrisma.imagingResult.findUnique.mockResolvedValue({ modality: 'CT' });

      const r = await service.precheck('order-1');
      expect(r.modality).toBe('CT');
      expect(r.ionizing).toBe(true);
      expect(r.modalityKnown).toBe(true);
      expect(r.modalitySource).toBe('RECORDED');
      // 판정이 되살아나면 피폭 항목이 따라 돈다 — 이것이 이 결함의 실제 피해였다
      expect(r.checks.some((c) => c.rule === 'CUMULATIVE_DOSE')).toBe(true);
    });

    it('아무 근거도 없으면 판정 불가를 밝힌다 — "해당 없음"이 아니다', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(noCodeOrder());
      mockPrisma.imagingResult.findUnique.mockResolvedValue(null);

      const r = await service.precheck('order-1');
      expect(r.modality).toBe('OT');
      expect(r.modalityKnown).toBe(false);
      expect(r.modalitySource).toBe('UNKNOWN');
    });

    it('대조군 — 시술코드가 있으면 그것이 우선이다(기록값이 덮지 않는다)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({
        procedureCode: { code: 'HE201', nameKo: '뇌 MRI', modality: null, usesContrast: false },
        pregnancyStatus: 'NONE',
      }));
      mockPrisma.imagingResult.findUnique.mockResolvedValue({ modality: 'CT' });

      const r = await service.precheck('order-1');
      expect(r.modality).toBe('MR');
      expect(r.modalitySource).toBe('PROCEDURE_CODE');
    });

    it('시행 게이트도 같은 근거를 쓴다 — 두 화면이 다른 말을 하지 않는다', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(noCodeOrder());
      mockPrisma.imagingResult.findUnique.mockResolvedValue({ modality: 'MG' });

      const g = await service.assertAcquireGate('order-1');
      expect(g.modality).toBe('MG');
      expect(g.ionizing).toBe(true);
      expect(g.modalityKnown).toBe(true);
    });
  });

  describe('recordExposure', () => {
    it('should estimate effective dose from DLP when not provided', async () => {
      mockPrisma.radiationExposure.upsert.mockImplementation(({ create }: any) => Promise.resolve(create));

      const rec: any = await service.recordExposure({
        imagingResultId: 'img-1', patientId: 'pat-1', modality: 'CT',
        bodyPart: 'Chest', dlp: 500, enteredBy: 'u-1',
      });

      expect(rec.effectiveDoseMsv).toBe(7); // 500 × 0.014
      expect(rec.estimated).toBe(true);
    });

    it('should keep provided effective dose without estimation', async () => {
      mockPrisma.radiationExposure.upsert.mockImplementation(({ create }: any) => Promise.resolve(create));

      const rec: any = await service.recordExposure({
        imagingResultId: 'img-1', patientId: 'pat-1', modality: 'CT',
        bodyPart: 'Chest', dlp: 500, effectiveDoseMsv: 6.2, enteredBy: 'u-1',
      });

      expect(rec.effectiveDoseMsv).toBe(6.2);
      expect(rec.estimated).toBe(false);
    });
  });
});
