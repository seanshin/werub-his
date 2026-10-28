import { describe, it, expect } from 'vitest';
import { computeDepreciation, usefulLifeOf } from './equipment-depreciation';

describe('감가상각(정액법)', () => {
  it('진단장비 8년·8천만원 → 연상각 1천만·중간연도 장부가', () => {
    const r = computeDepreciation(80_000_000, 2022, '진단장비', false, 2026);
    expect(r.usefulLifeYears).toBe(8);
    expect(r.annualDepreciation).toBe(10_000_000);
    expect(r.currentBookValue).toBe(30_000_000); // 5년 경과(2022~2026)
    expect(r.schedule[0]).toMatchObject({ year: 2022, bookValue: 70_000_000 });
    expect(r.schedule[7].bookValue).toBe(0); // 최종연도 0
  });
  it('내용연수 초과 → 장부가 0·완전상각', () => {
    const r = computeDepreciation(60_000_000, 2010, '응급장비', false, 2026);
    expect(r.currentBookValue).toBe(0);
    expect(r.fullyDepreciated).toBe(true);
  });
  it('처분(RETIRED) → 현재 장부가 0·누계=취득가', () => {
    const r = computeDepreciation(50_000_000, 2024, '치료장비', true, 2026);
    expect(r.currentBookValue).toBe(0);
    expect(r.accumulatedDepreciation).toBe(50_000_000);
  });
  it('카테고리 미지정 → 기본 5년', () => {
    expect(usefulLifeOf('알수없음')).toBe(5);
  });
  it('최종연도 잔액 보정(정수오차) — 누계=취득가', () => {
    const r = computeDepreciation(10_000_000, 2020, '수술장비', false, 2030); // 6년, 1666666.67
    const last = r.schedule[r.schedule.length - 1];
    expect(last.accumulated).toBe(10_000_000);
    expect(last.bookValue).toBe(0);
  });
});
