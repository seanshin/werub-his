import { describe, it, expect } from 'vitest';
import { checkAboRhCompatible, normalizeRh, productCategory } from '../../src/modules/blood-bank/blood-compat';

const rbc = (patientAbo: string, patientRh: string, productAbo: string, productRh: string) =>
  checkAboRhCompatible({ productType: 'RBC', patientAbo, patientRh, productAbo, productRh });

describe('blood-compat — ABO/Rh 적합성', () => {
  describe('적혈구(RBC) ABO', () => {
    it('O 수혈자는 O만 가능', () => {
      expect(rbc('O', 'POS', 'O', 'POS').compatible).toBe(true);
      expect(rbc('O', 'POS', 'A', 'POS').compatible).toBe(false);
      expect(rbc('O', 'POS', 'B', 'POS').compatible).toBe(false);
      expect(rbc('O', 'POS', 'AB', 'POS').compatible).toBe(false);
    });
    it('A 수혈자는 A·O 가능', () => {
      expect(rbc('A', 'POS', 'A', 'POS').compatible).toBe(true);
      expect(rbc('A', 'POS', 'O', 'POS').compatible).toBe(true);
      expect(rbc('A', 'POS', 'B', 'POS').compatible).toBe(false);
      expect(rbc('A', 'POS', 'AB', 'POS').compatible).toBe(false);
    });
    it('AB 수혈자는 만능 수혈자(A/B/O/AB)', () => {
      for (const d of ['A', 'B', 'O', 'AB']) expect(rbc('AB', 'POS', d, 'POS').compatible).toBe(true);
    });
    it('B 수혈자는 B·O 가능, A·AB 불가', () => {
      expect(rbc('B', 'POS', 'B', 'POS').compatible).toBe(true);
      expect(rbc('B', 'POS', 'O', 'POS').compatible).toBe(true);
      expect(rbc('B', 'POS', 'A', 'POS').compatible).toBe(false);
    });
  });

  describe('적혈구 Rh', () => {
    it('Rh음성 수혈자는 Rh음성 공혈만', () => {
      expect(rbc('O', 'NEG', 'O', 'NEG').compatible).toBe(true);
      expect(rbc('O', 'NEG', 'O', 'POS').compatible).toBe(false); // 음성←양성 부적합
    });
    it('Rh양성 수혈자는 양성·음성 모두 가능', () => {
      expect(rbc('O', 'POS', 'O', 'NEG').compatible).toBe(true);
      expect(rbc('O', 'POS', 'O', 'POS').compatible).toBe(true);
    });
    it('Rh음성 수혈자에 제제 Rh 불명이면 부적합', () => {
      expect(rbc('O', 'NEG', 'O', '???').compatible).toBe(false);
    });
  });

  describe('혈장(FFP/PLASMA) — ABO 반대·Rh 무관', () => {
    const plasma = (pAbo: string, dAbo: string) =>
      checkAboRhCompatible({ productType: 'FFP', patientAbo: pAbo, patientRh: 'NEG', productAbo: dAbo, productRh: 'POS' });
    it('AB 혈장은 만능 공혈(모든 수혈자)', () => {
      for (const p of ['A', 'B', 'O', 'AB']) expect(plasma(p, 'AB').compatible).toBe(true);
    });
    it('O 수혈자는 모든 ABO 혈장 가능(만능 혈장 수혈자)', () => {
      for (const d of ['O', 'A', 'B', 'AB']) expect(plasma('O', d).compatible).toBe(true);
    });
    it('AB 수혈자는 AB 혈장만', () => {
      expect(plasma('AB', 'AB').compatible).toBe(true);
      expect(plasma('AB', 'A').compatible).toBe(false);
      expect(plasma('AB', 'O').compatible).toBe(false);
    });
    it('혈장은 Rh 무관(음성 수혈자에 양성 혈장 허용)', () => {
      expect(plasma('O', 'O').compatible).toBe(true); // productRh POS·patientRh NEG이어도 OK
    });
  });

  describe('형 미확정·범주', () => {
    it('환자 ABO 미확정이면 부적합(수혈전검사 필요)', () => {
      expect(rbc('', 'POS', 'O', 'POS').compatible).toBe(false);
    });
    it('동결침전물(CRYO) 등 OTHER는 ABO 강제 안 함', () => {
      expect(checkAboRhCompatible({ productType: 'CRYO', patientAbo: 'O', patientRh: 'NEG', productAbo: 'AB', productRh: 'POS' }).compatible).toBe(true);
    });
    it('normalizeRh/productCategory 정규화', () => {
      expect(normalizeRh('+')).toBe('POS');
      expect(normalizeRh('음성')).toBe('NEG');
      expect(productCategory('PACKED_RBC')).toBe('RBC');
      expect(productCategory('FFP')).toBe('PLASMA');
      expect(productCategory('PLT')).toBe('PLATELET');
    });
    it('[P1] PC(혈소판농축)·성분채집혈소판은 PLATELET(과거 OTHER→ABO무검사)', () => {
      expect(productCategory('PC')).toBe('PLATELET');
      expect(productCategory('농축혈소판(PC)')).toBe('PLATELET');
      expect(productCategory('SDP')).toBe('PLATELET');
      // PLATELET는 ABO 적혈구 규칙 준용 — O 수혈자에 A PC 부적합
      expect(checkAboRhCompatible({ productType: 'PC', patientAbo: 'O', patientRh: 'POS', productAbo: 'A', productRh: 'POS' }).compatible).toBe(false);
    });
    it('[P1] 인식불가 제제는 fail-safe로 RBC(ABO 강제)', () => {
      expect(productCategory('무슨제제XYZ')).toBe('RBC');
      // 인식불가 제제에도 ABO 부적합이면 차단
      expect(checkAboRhCompatible({ productType: '무슨제제XYZ', patientAbo: 'O', patientRh: 'POS', productAbo: 'A', productRh: 'POS' }).compatible).toBe(false);
    });
  });
});
