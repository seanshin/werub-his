import { describe, it, expect } from 'vitest';
import { ageOf } from '@hospital-run/shared';

/**
 * 나이 계산 정본 회귀 — BE 는 `Math.floor(diff / 365.25일)` 근사를 쓰면 안 된다.
 *
 * 🔴 365.25 근사는 **생일 당일에 한 살 적게** 나온다(윤년 누적 오차). 만 나이는 소아 용량·
 *    수가 연령가산·방사선 안전(가임기)·DUR 연령금기가 읽는 값이라 하루/한 살 오차가
 *    임상·청구에 실영향. shared `ageOf`(연·월·일 비교)만이 정본이다.
 *
 * 이 스펙은 근사 산식이 실제로 틀렸음을 고정해, 누군가 "간단히" 365.25 로 되돌리면 실패하게 한다.
 */

const approx = (dob: Date, now: Date) =>
  Math.floor((now.getTime() - dob.getTime()) / (365.25 * 86_400_000));

describe('ageOf — 만 나이 정본(365.25 근사와 다르다)', () => {
  const now = new Date('2026-08-06T09:00:00+09:00');

  it('🔴 생일 당일 — 근사는 한 살 적지만 ageOf 는 정확', () => {
    const cases: [string, number][] = [
      ['2000-08-06', 26], // 근사=25
      ['2024-08-06', 2],  // 근사=1 (소아 경계)
      ['2008-08-06', 18], // 근사=17 (성인/소아 경계)
      ['1936-08-06', 90], // 근사=89
    ];
    for (const [dob, expected] of cases) {
      const d = new Date(dob + 'T00:00:00Z');
      expect(ageOf(d, now)).toBe(expected);
      expect(approx(d, now)).toBe(expected - 1); // 근사는 한 살 적다(회귀 방지 근거)
    }
  });

  it('생일 지난 뒤/전 경계 — 월·일 보정', () => {
    // 생일 하루 전이면 아직 한 살 어리다
    expect(ageOf(new Date('2000-08-07T00:00:00Z'), now)).toBe(25);
    // 생일 하루 지났으면 만 나이
    expect(ageOf(new Date('2000-08-05T00:00:00Z'), now)).toBe(26);
  });

  it('무효/미상 생년월일 — null(0 이나 -1 로 뭉개지 않는다)', () => {
    expect(ageOf(null, now)).toBeNull();
    expect(ageOf(undefined, now)).toBeNull();
    expect(ageOf(new Date('3000-01-01T00:00:00Z'), now)).toBeNull(); // 미래
  });
});
