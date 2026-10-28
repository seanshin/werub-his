import { describe, it, expect } from 'vitest';
import {
  ageOf, ageInMonths, formatAge, birthDateProblem, daysInMonth,
  splitBirthDate, joinBirthDate, birthYearOptions, MAX_AGE_YEARS, stayDays,
} from '../src/age';
import { shiftOf, normalizeShiftBoundaries, DEFAULT_SHIFT_BOUNDARIES } from '../src/shift';

/**
 * 나이 계산 정본 — 2026-08-03.
 * 🔴 화면 6곳이 제각기 계산했고 4곳은 월·일 보정이 없어 **생일 전이면 한 살 많게** 나왔다.
 *    만 나이는 소아 용량·검사 기준치·DUR 연령금기가 읽는 값이다.
 */
const NOW = new Date(2026, 7, 3); // 2026-08-03 (월은 0-base)

describe('만 나이', () => {
  it('생일이 지났으면 그대로', () => {
    expect(ageOf('1990-01-15', NOW)).toBe(36);
  });

  it('🔴 생일 전이면 한 살 적다 (종전 버그의 핵심)', () => {
    expect(ageOf('1990-12-25', NOW)).toBe(35);
    // 보정 없는 구현은 36 을 냈다
    expect(NOW.getFullYear() - 1990).toBe(36);
  });

  it('생일 당일은 올라간다', () => {
    expect(ageOf('1990-08-03', NOW)).toBe(36);
  });

  it('하루 차이로 갈린다', () => {
    expect(ageOf('1990-08-04', NOW)).toBe(35);
  });

  it('모르는 값은 null — 0 으로 뭉개지 않는다', () => {
    expect(ageOf(null, NOW)).toBeNull();
    expect(ageOf('', NOW)).toBeNull();
    expect(ageOf('not-a-date', NOW)).toBeNull();
  });

  it('미래 생년월일은 null (음수 나이 방지)', () => {
    expect(ageOf('2026-11-15', NOW)).toBeNull();
  });
});

describe('개월 수', () => {
  it('만 1년 6개월', () => {
    expect(ageInMonths('2025-02-03', NOW)).toBe(18);
  });
  it('일자 미달이면 한 달 적다', () => {
    expect(ageInMonths('2025-02-04', NOW)).toBe(17);
  });
});

describe('표기', () => {
  it('신생아는 일 단위', () => {
    expect(formatAge('2026-07-25', { now: NOW })).toBe('9일');
  });
  it('24개월 미만은 개월(또는 세+개월)', () => {
    expect(formatAge('2026-01-03', { now: NOW })).toBe('7개월');
    expect(formatAge('2025-05-03', { now: NOW })).toBe('1세 3개월');
  });
  it('그 외는 세', () => {
    expect(formatAge('1990-01-15', { now: NOW })).toBe('36세');
  });
  it('모르면 미상 문구', () => {
    expect(formatAge(null, { now: NOW })).toBe('나이 미상');
    expect(formatAge('2026-11-15', { now: NOW })).toBe('나이 미상');
  });
});

describe('생년월일 유효성', () => {
  it('미래·초과 과거를 잡는다', () => {
    expect(birthDateProblem('2026-08-04', NOW)).toBe('FUTURE');
    expect(birthDateProblem('1800-01-01', NOW)).toBe('TOO_OLD');
    expect(birthDateProblem('nope', NOW)).toBe('INVALID');
  });
  it('오늘 출생은 허용(신생아 등록)', () => {
    expect(birthDateProblem('2026-08-03', NOW)).toBeNull();
  });
});

describe('콤보박스 보조', () => {
  it('월별 일수 — 윤년 포함', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
  });
  it('ISO ↔ 년월일 왕복', () => {
    expect(splitBirthDate('1990-01-15')).toEqual({ year: '1990', month: '01', day: '15' });
    expect(joinBirthDate('1990', '1', '5')).toBe('1990-01-05');
    expect(joinBirthDate('1990', '', '5')).toBe('');
  });
  it('연도 선택지는 150년', () => {
    const ys = birthYearOptions(NOW);
    expect(ys[0]).toBe(2026);
    expect(ys).toHaveLength(MAX_AGE_YEARS + 1);
  });
});

describe('재원일수 — 입원료 청구와 같은 산식', () => {

  it('당일 입퇴원도 1일', () => {
    expect(stayDays('2026-08-03T09:00:00+09:00', '2026-08-03T15:00:00+09:00')).toBe(1);
  });

  it('경과는 올림 — floor 면 청구서보다 하루 적게 보인다', () => {
    expect(stayDays('2026-08-01T09:00:00+09:00', '2026-08-03T15:00:00+09:00')).toBe(3);
  });

  it('퇴원 전이면 지금까지', () => {
    const d = stayDays(new Date(Date.now() - 5.2 * 86_400_000));
    expect(d).toBe(6);
  });

  it('입원일이 없거나 무효면 null — 1일로 뭉개지 않는다', () => {
    expect(stayDays(null)).toBeNull();
    expect(stayDays('nope')).toBeNull();
  });
});

describe('교대 판정 정본 — 경계는 config', () => {
  const at = (h: number) => new Date(2026, 7, 3, h, 30);

  it('기본 경계(7/15/23)', () => {
    expect(shiftOf(at(7))).toBe('DAY');
    expect(shiftOf(at(14))).toBe('DAY');
    expect(shiftOf(at(15))).toBe('EVENING');
    expect(shiftOf(at(22))).toBe('EVENING');
    expect(shiftOf(at(23))).toBe('NIGHT');
    expect(shiftOf(at(3))).toBe('NIGHT'); // 자정 넘김
    expect(shiftOf(at(6))).toBe('NIGHT');
  });

  it('config 경계 반영', () => {
    const b = { day: 6, evening: 14, night: 22 };
    expect(shiftOf(at(6), b)).toBe('DAY');
    expect(shiftOf(at(13), b)).toBe('DAY');
    expect(shiftOf(at(14), b)).toBe('EVENING');
    expect(shiftOf(at(22), b)).toBe('NIGHT');
  });

  it('잘못된 config 는 기본으로 — 판정이 죽으면 기록 저장이 막힌다', () => {
    expect(normalizeShiftBoundaries(null)).toEqual(DEFAULT_SHIFT_BOUNDARIES);
    expect(normalizeShiftBoundaries({ day: 15, evening: 7, night: 23 })).toEqual(DEFAULT_SHIFT_BOUNDARIES); // 순서 역전
    expect(normalizeShiftBoundaries({ day: 'x', evening: 15, night: 23 })).toEqual(DEFAULT_SHIFT_BOUNDARIES);
    expect(normalizeShiftBoundaries({ day: 6, evening: 14, night: 22 })).toEqual({ day: 6, evening: 14, night: 22 });
  });
});
