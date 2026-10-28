import { describe, it, expect } from 'vitest';
import { computeFeeWith, DEFAULT_FEE_RULES, FeeRule } from '../../src/modules/medical-record-issuance/fee-rules';

const fee = (type: string, pages: number, copies: number) => computeFeeWith(DEFAULT_FEE_RULES, 'DEFAULT', type, pages, copies);
const reconciles = (b: { base: number; pageCharge: number; copyCharge: number; total: number }) => b.base + b.pageCharge + b.copyCharge === b.total;

describe('computeFeeWith', () => {
  describe('의무기록 사본(MEDICAL_RECORD, 매수 누진 1~5매 1000/매·초과 100/매)', () => {
    it('3매 1부 = 3000', () => {
      const f = fee('MEDICAL_RECORD', 3, 1);
      expect(f.total).toBe(3000);
      expect(f.base).toBe(0);
      expect(f.pageCharge).toBe(3000);
    });
    it('7매 1부 = 5*1000 + 2*100 = 5200', () => {
      expect(fee('MEDICAL_RECORD', 7, 1).total).toBe(5200);
    });
    it('3매 2부 = 6000(부수 배수)', () => {
      const f = fee('MEDICAL_RECORD', 3, 2);
      expect(f.total).toBe(6000);
      expect(f.copyCharge).toBe(3000);
    });
    it('0매(스냅샷 전 견적) = base 1000·합산 정합', () => {
      const f = fee('MEDICAL_RECORD', 0, 1);
      expect(f.total).toBe(1000);
      expect(reconciles(f)).toBe(true);
    });
    it('합산 정합 — 여러 케이스', () => {
      for (const [p, c] of [[0, 1], [3, 1], [7, 3], [12, 2]] as [number, number][]) {
        expect(reconciles(fee('MEDICAL_RECORD', p, c))).toBe(true);
      }
    });
  });

  describe('증명서(base + 부수 가산)', () => {
    it('진단서 1부 = 20000', () => {
      const f = fee('DIAGNOSIS_CERT', 1, 1);
      expect(f.total).toBe(20000);
      expect(f.base).toBe(20000);
      expect(f.pageCharge).toBe(0);
    });
    it('진단서 3부 = 20000 + 1000*2 = 22000', () => {
      const f = fee('DIAGNOSIS_CERT', 1, 3);
      expect(f.total).toBe(22000);
      expect(f.copyCharge).toBe(2000);
      expect(reconciles(f)).toBe(true);
    });
    it('소견서 2부 = 11000 · 입퇴원확인서 1부 = 3000', () => {
      expect(fee('OPINION', 1, 2).total).toBe(11000);
      expect(fee('ADMISSION_CERT', 1, 1).total).toBe(3000);
    });
  });

  describe('엣지', () => {
    it('미지원 타입 → base 0 폴백', () => {
      expect(fee('UNKNOWN_TYPE', 5, 2).total).toBe(0);
    });
    it('copies 0/음수 → 최소 1부', () => {
      expect(fee('DIAGNOSIS_CERT', 1, 0).total).toBe(20000);
      expect(fee('DIAGNOSIS_CERT', 1, -3).copies).toBe(1);
    });
    it('CONFIG 오버라이드 적용', () => {
      const custom: Record<string, FeeRule> = { DIAGNOSIS_CERT: { label: '진단서', base: 5000, perExtraCopy: 500 } };
      const f = computeFeeWith({ ...DEFAULT_FEE_RULES, ...custom }, 'CONFIG', 'DIAGNOSIS_CERT', 1, 2);
      expect(f.total).toBe(5500);
      expect(f.ruleSource).toBe('CONFIG');
    });
  });
});
