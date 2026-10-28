import { describe, it, expect } from 'vitest';
import { evalCondition, validateCondition } from '../../src/modules/protocol/condition-dsl';

describe('condition-dsl', () => {
  const ctx = { age: 70, gender: 'MALE', ktas: 2, disposition: 'ADMISSION' };

  describe('evalCondition', () => {
    it('빈 조건 → true(무조건)', () => {
      expect(evalCondition('', ctx)).toBe(true);
      expect(evalCondition(undefined, ctx)).toBe(true);
    });
    it('비교 연산자', () => {
      expect(evalCondition('ktas <= 2', ctx)).toBe(true);
      expect(evalCondition('ktas < 2', ctx)).toBe(false);
      expect(evalCondition('age >= 65', ctx)).toBe(true);
      expect(evalCondition('age > 70', ctx)).toBe(false);
      expect(evalCondition('age == 70', ctx)).toBe(true);
      expect(evalCondition('ktas != 1', ctx)).toBe(true);
    });
    it('문자열(enum) 비교 — 따옴표 유무 무관', () => {
      expect(evalCondition('disposition == ADMISSION', ctx)).toBe(true);
      expect(evalCondition("gender == 'MALE'", ctx)).toBe(true);
      expect(evalCondition('disposition == DISCHARGE', ctx)).toBe(false);
    });
    it('in 리스트', () => {
      expect(evalCondition('ktas in (1,2)', ctx)).toBe(true);
      expect(evalCondition('ktas in (3,4,5)', ctx)).toBe(false);
      expect(evalCondition('disposition in (ADMISSION, TRANSFER)', ctx)).toBe(true);
    });
    it('AND/OR 결합(AND 우선)', () => {
      expect(evalCondition('age >= 65 && ktas <= 3', ctx)).toBe(true);
      expect(evalCondition('age >= 80 && ktas <= 3', ctx)).toBe(false);
      expect(evalCondition('age >= 80 || ktas <= 2', ctx)).toBe(true);
      expect(evalCondition('ktas == 5 && age == 1 || disposition == ADMISSION', ctx)).toBe(true);
    });
    it('컨텍스트에 없는 필드 → false(미충족)', () => {
      expect(evalCondition('ktas <= 2', { age: 70 })).toBe(false);
    });
    it('형식 오류 → false', () => {
      expect(evalCondition('ktas =< 2', ctx)).toBe(false);
      expect(evalCondition('garbage', ctx)).toBe(false);
    });
  });

  describe('validateCondition', () => {
    it('정상 → null', () => {
      expect(validateCondition('ktas <= 2')).toBeNull();
      expect(validateCondition('age >= 65 && ktas in (1,2)')).toBeNull();
      expect(validateCondition('')).toBeNull();
      expect(validateCondition(undefined)).toBeNull();
    });
    it('형식 오류 → 메시지', () => {
      expect(validateCondition('ktas')).toMatch(/형식 오류/);
      expect(validateCondition('=< 2')).toMatch(/형식 오류/);
    });
    it('미지원 필드 → 메시지', () => {
      expect(validateCondition('hba1c >= 7')).toMatch(/미지원 조건 필드/);
    });
  });
});
