import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingAdvancedService } from '../../src/modules/billing-advanced/billing-advanced.service';

describe('BillingAdvancedService', () => {
  let service: BillingAdvancedService;
  let mockPrisma: any;

  const mockEncounter = {
    id: 'e-1',
    patient: { insuranceType: 'NHI' },
    appointment: { type: 'INITIAL' },
    prescriptions: [
      {
        type: 'MEDICATION',
        status: 'ACTIVE',
        medicationCode: { code: 'M001', nameKo: '아스피린', unitPrice: 500 },
        procedureCode: null,
        quantity: 30,
        duration: 30,
      },
      {
        type: 'LAB',
        status: 'ACTIVE',
        medicationCode: null,
        procedureCode: { code: 'L001', nameKo: 'CBC', unitPrice: 5000, copayRate: 0.3 },
        quantity: 1,
        duration: 1,
      },
    ],
  };

  beforeEach(() => {
    mockPrisma = {
      encounter: { findUnique: vi.fn() },
      // calculateFFS는 진찰료 코드를 procedureCode.findFirst(temporal 유효성)로 조회
      procedureCode: { findUnique: vi.fn(), findFirst: vi.fn() },
      // 요양기관 종별 설정 행 — 없음(미설정 = 의원 · 2026-10-20 진찰료 코드는 종별 정본)
      systemConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    // 🔴 자격 정본 주입 — 기본 NHI(감면 아님 → 코드특례 적용·기존 기대값 유지)
    const mockEligibility: any = { resolveCopayRate: vi.fn().mockResolvedValue({ rate: 0.3, copayCategory: 'NHI' }) };
    service = new BillingAdvancedService(mockPrisma, mockEligibility);
  });

  // ─── calculateFFS ─────────────────────────────────────

  describe('calculateFFS', () => {
    it('should calculate fee-for-service with consult + medication + lab', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue(mockEncounter);
      mockPrisma.procedureCode.findFirst.mockResolvedValue({
        code: 'AA157',
        nameKo: '초진 진찰료',
        unitPrice: 15000,
        copayRate: 0.3,
      });

      const result = await service.calculateFFS('e-1');

      expect(result).not.toBeNull();
      expect(result!.feeSystem).toBe('FFS');
      expect(result!.items.length).toBe(3); // consult + med + lab
      expect(result!.totalAmount).toBeGreaterThan(0);
      expect(result!.patientCopay).toBeLessThan(result!.totalAmount);
      expect(result!.insuranceCovered).toBe(result!.totalAmount - result!.patientCopay);
    });

    it('should return null for non-existent encounter', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue(null);

      const result = await service.calculateFFS('e-x');

      expect(result).toBeNull();
    });

    it('should handle encounter with no prescriptions', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        ...mockEncounter,
        appointment: { type: 'FOLLOW_UP' },
        prescriptions: [],
      });
      mockPrisma.procedureCode.findFirst.mockResolvedValue({
        code: 'AA257',
        nameKo: '재진 진찰료',
        unitPrice: 12000,
        copayRate: 0.3,
      });

      const result = await service.calculateFFS('e-2');

      expect(result!.items).toHaveLength(1); // consult only
      expect(result!.totalAmount).toBe(12000);
    });

    it('재진 — 종별 미설정(의원)이면 AA254 · 🔴 종전엔 종별과 무관하게 상급종합 AA257', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        ...mockEncounter,
        appointment: { type: 'FOLLOW_UP' },
        prescriptions: [],
      });
      mockPrisma.procedureCode.findFirst.mockResolvedValue({
        code: 'AA257',
        nameKo: '재진 진찰료',
        unitPrice: 12000,
        copayRate: 0.3,
      });

      const result = await service.calculateFFS('e-1');

      expect(mockPrisma.procedureCode.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ code: 'AA254' }) }),
      );
      expect(result!.items[0].code).toBe('AA257'); // 돌려준 마스터 행 그대로
    });

    it('대조군 — 종별 상급종합(TERTIARY)이면 AA257 · 표 밖 값이면 진찰료를 고르지 않는다', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({ ...mockEncounter, appointment: { type: 'FOLLOW_UP' }, prescriptions: [] });
      mockPrisma.procedureCode.findFirst.mockResolvedValue({ code: 'AA257', nameKo: '재진', unitPrice: 0, copayRate: 0.3 });
      mockPrisma.systemConfig.findUnique.mockResolvedValue({ value: 'TERTIARY' });
      await service.calculateFFS('e-1');
      expect(mockPrisma.procedureCode.findFirst.mock.calls.at(-1)[0].where.code).toBe('AA257');
      mockPrisma.procedureCode.findFirst.mockClear();
      mockPrisma.systemConfig.findUnique.mockResolvedValue({ value: 'DENTAL?' });
      const r = await service.calculateFFS('e-1');
      expect(mockPrisma.procedureCode.findFirst).not.toHaveBeenCalled();
      expect(r!.items.some((i: any) => i.category === '진찰료')).toBe(false);
    });

    it('should handle missing consult procedure code', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        ...mockEncounter,
        prescriptions: [],
      });
      mockPrisma.procedureCode.findFirst.mockResolvedValue(null);

      const result = await service.calculateFFS('e-1');

      expect(result!.items.length).toBe(0);
      expect(result!.totalAmount).toBe(0);
    });

    it('should correctly calculate medication amounts with quantity', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        ...mockEncounter,
        prescriptions: [
          {
            type: 'MEDICATION',
            status: 'ACTIVE',
            medicationCode: { code: 'MED01', nameKo: '약', unitPrice: 1000 },
            procedureCode: null,
            quantity: 5,
            duration: 3,
          },
        ],
      });
      mockPrisma.procedureCode.findFirst.mockResolvedValue(null);

      const result = await service.calculateFFS('e-1');

      const medItem = result!.items[0];
      expect(medItem.quantity).toBe(5);
      expect(medItem.amount).toBe(5000); // 1000 * 5
    });

    it('should categorize LAB prescriptions as 검사료', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        ...mockEncounter,
        prescriptions: [
          {
            type: 'LAB',
            status: 'ACTIVE',
            medicationCode: null,
            procedureCode: { code: 'L001', nameKo: 'CBC', unitPrice: 8000, copayRate: 0.3 },
            quantity: 1,
            duration: null,
          },
        ],
      });
      mockPrisma.procedureCode.findFirst.mockResolvedValue(null);

      const result = await service.calculateFFS('e-1');

      expect(result!.items[0].category).toBe('검사료');
    });

    it('should categorize non-LAB procedures as 영상료', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        ...mockEncounter,
        prescriptions: [
          {
            type: 'IMAGING',
            status: 'ACTIVE',
            medicationCode: null,
            procedureCode: { code: 'IMG01', nameKo: '흉부 X선', unitPrice: 20000, copayRate: 0.3 },
            quantity: 1,
            duration: null,
          },
        ],
      });
      mockPrisma.procedureCode.findFirst.mockResolvedValue(null);

      const result = await service.calculateFFS('e-1');

      expect(result!.items[0].category).toBe('영상료');
    });

    it('should categorize medication items as 약제비', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        ...mockEncounter,
        prescriptions: [
          {
            type: 'MEDICATION',
            status: 'ACTIVE',
            medicationCode: { code: 'MED01', nameKo: '약', unitPrice: 500 },
            procedureCode: null,
            quantity: 10,
            duration: 5,
          },
        ],
      });
      mockPrisma.procedureCode.findFirst.mockResolvedValue(null);

      const result = await service.calculateFFS('e-1');

      expect(result!.items[0].category).toBe('약제비');
    });

    it('should categorize consult item as 진찰료', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        ...mockEncounter,
        prescriptions: [],
      });
      mockPrisma.procedureCode.findFirst.mockResolvedValue({
        code: 'AA157',
        nameKo: '초진 진찰료',
        unitPrice: 15000,
        copayRate: 0.3,
      });

      const result = await service.calculateFFS('e-1');

      expect(result!.items[0].category).toBe('진찰료');
    });

    it('should use procedure copayRate when available', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        ...mockEncounter,
        prescriptions: [
          {
            type: 'LAB',
            status: 'ACTIVE',
            medicationCode: null,
            procedureCode: { code: 'L002', nameKo: '특수검사', unitPrice: 50000, copayRate: 0.5 },
            quantity: 1,
            duration: null,
          },
        ],
      });
      mockPrisma.procedureCode.findFirst.mockResolvedValue(null);

      const result = await service.calculateFFS('e-1');

      expect(result!.items[0].copayRate).toBe(0.5);
    });
  });

  // ─── calculateDRG ─────────────────────────────────────

  describe('calculateDRG', () => {
    it('should return DRG amount for known code G01', async () => {
      const result = await service.calculateDRG('e-1', 'G01');

      expect(result.feeSystem).toBe('DRG');
      expect(result.drgCode).toBe('G01');
      expect(result.totalAmount).toBe(500000);
      expect(result.insuranceCovered).toBe(350000);
      expect(result.patientCopay).toBe(150000);
    });

    it('should return 0 for unknown DRG code', async () => {
      const result = await service.calculateDRG('e-1', 'UNKNOWN');

      expect(result.totalAmount).toBe(0);
      expect(result.insuranceCovered).toBe(0);
      expect(result.patientCopay).toBe(0);
    });

    it('should split 70/30 for insurance/copay', async () => {
      const result = await service.calculateDRG('e-1', 'I01');

      expect(result.insuranceCovered + result.patientCopay).toBe(result.totalAmount);
      expect(result.insuranceCovered).toBe(Math.round(result.totalAmount * 0.7));
      expect(result.patientCopay).toBe(Math.round(result.totalAmount * 0.3));
    });

    it('should return all known DRG codes correctly', async () => {
      const codes = ['G01', 'G02', 'H01', 'I01'];
      const expected = [500000, 800000, 1200000, 3000000];

      for (let i = 0; i < codes.length; i++) {
        const result = await service.calculateDRG('e-1', codes[i]);
        expect(result.totalAmount).toBe(expected[i]);
      }
    });

    it('should always include feeSystem=DRG', async () => {
      const result = await service.calculateDRG('e-1', 'G02');

      expect(result.feeSystem).toBe('DRG');
    });

    it('should include drgCode in result', async () => {
      const result = await service.calculateDRG('e-1', 'H01');

      expect(result.drgCode).toBe('H01');
    });
  });
});
