import { describe, it, expect } from 'vitest';
import { isValidBirthDate } from '../../src/common/validators/is-birth-date.validator';

/**
 * 생년월일 범위 계약 — 2026-08-03.
 * 🔴 `@IsDateString()` 은 형식만 본다: 미래 생년월일 13명이 그대로 운영에 들어와 있었다.
 *    나이가 음수가 되면 소아 용량·검사 기준치·DUR 연령금기가 조용히 어긋난다.
 */
// 🔴 toISOString slice 는 UTC 날짜 — KST 00~09시에 로컬 하루와 어긋나 '내일'이 '오늘'로 밀렸다(2026-08-05 실측 플레이크).
//    검증기가 로컬 endOfToday 기준이므로 헬퍼도 로컬 날짜로 포맷한다.
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysFromNow = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

describe('생년월일 검증', () => {
  it('미래 날짜를 거부한다', () => {
    expect(isValidBirthDate(iso(daysFromNow(1)))).toBe(false);
    expect(isValidBirthDate('2026-11-15')).toBe(new Date('2026-11-15') <= new Date());
  });

  it('오늘 출생(신생아)은 허용한다', () => {
    expect(isValidBirthDate(iso(new Date()))).toBe(true);
  });

  it('통상적인 과거 날짜를 허용한다', () => {
    expect(isValidBirthDate('1990-01-15')).toBe(true);
    expect(isValidBirthDate('1948-01-30')).toBe(true);
  });

  it('150년을 넘는 과거를 거부한다', () => {
    expect(isValidBirthDate('1800-01-01')).toBe(false);
  });

  it('날짜가 아닌 값을 거부한다', () => {
    expect(isValidBirthDate('not-a-date')).toBe(false);
    expect(isValidBirthDate(undefined)).toBe(false);
    expect(isValidBirthDate(null)).toBe(false);
  });
});
