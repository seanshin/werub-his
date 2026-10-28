import { BadRequestException } from '@nestjs/common';
import { describe, it, expect } from 'vitest';
import { dayRange, parseLocalDate, localDateKey, todayRange, monthRangeLocal } from '../../src/common/day-range';

/**
 * 🔴 date-only 하루 구간 정본 — 화면 실사용 점검 W7(2026-08-14).
 *
 * `new Date('2026-08-13')` 은 **TZ 와 무관하게 항상 UTC 자정**이다. pm2 가 KST 를 줘도
 * 이 파싱만은 UTC 로 고정된다. 그래서 감사 대시보드에서 같은 날짜를 `gte`/`lte` 로 넣으면
 * **폭이 0 인 구간**이 됐고, 화면은 "그날 아무도 환자 기록을 열지 않았다"고 말했다
 * (실측: 08-13 화면 0건 / 실제 21건 · 08-12 화면 0건 / 실제 63건).
 */
describe('dayRange 정본', () => {
  it('🔴 같은 날짜를 주면 그 하루 전체 — 폭 0 이 아니다', () => {
    const r = dayRange('2026-08-13', '2026-08-13')!;
    expect(r.gte).toEqual(new Date(2026, 7, 13, 0, 0, 0, 0));
    expect(r.lt).toEqual(new Date(2026, 7, 14, 0, 0, 0, 0));
    expect(r.lt!.getTime() - r.gte!.getTime()).toBe(86_400_000);
  });

  it('🔴 date-only 는 UTC 자정이 아니라 서버 로컬(KST) 자정으로 판다', () => {
    const d = parseLocalDate('2026-08-13')!;
    expect(d.getHours()).toBe(0);
    expect(d.getDate()).toBe(13);
    // UTC 자정으로 파싱됐다면 KST 에서는 09:00 이 된다
    expect(d.getTime()).not.toBe(new Date('2026-08-13').getTime());
  });

  it('🔴 끝나는 날이 포함된다 — `lte: 자정` 은 그 하루를 통째로 버린다', () => {
    const r = dayRange('2026-08-01', '2026-08-31')!;
    expect(r.lt).toEqual(new Date(2026, 8, 1, 0, 0, 0, 0)); // 9월 1일 자정 미만
  });

  it('시각이 포함된 값은 그대로 판다(호출자가 정확한 순간을 준 것)', () => {
    const r = dayRange(undefined, '2026-08-13T15:30:00')!;
    expect(r.lt).toEqual(new Date('2026-08-13T15:30:00'));
  });

  it('🔴 잘못된 날짜는 Invalid Date 가 아니라 null — Prisma 로 넘기면 500 이 난다', () => {
    expect(parseLocalDate('abc')).toBeNull();
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate(null)).toBeNull();
  });

  /**
   * 🔴 **계약 변경(2026-08-31)** — 종전엔 `dayRange('abc','abc')` 가 `undefined` 였다.
   *    그 결과 오타 날짜가 조용히 **"필터 없음"(전건 조회)** 이 되거나,
   *    호출부의 `range.gte!` 단언에서 `undefined` 가 새어 Prisma·`toISOString` 에서 터졌다.
   *    실측: 잘못된 날짜를 넣으면 **직원용 GET 56곳이 500**.
   *    → "안 준 것"과 "못 읽은 것"을 가른다. 준 값이 틀렸으면 **그 자리에서 400**.
   */
  it('🔴 준 값이 못 읽는 값이면 400 — "필터 없음"으로 조용히 넘어가지 않는다', () => {
    expect(() => dayRange('abc', 'abc')).toThrow(BadRequestException);
    expect(() => dayRange('abc', null)).toThrow(BadRequestException);
    expect(() => dayRange(null, 'abc')).toThrow(BadRequestException);
  });

  it('아예 안 준 것은 종전대로 undefined(필터 없음)다 — 대조군', () => {
    expect(dayRange(null, null)).toBeUndefined();
    expect(dayRange(undefined, undefined)).toBeUndefined();
    expect(dayRange('', '')).toBeUndefined();
  });

  it('🔴 monthRangeLocal — 못 읽는 연월은 400, 정상은 로컬 자정 구간', () => {
    for (const bad of ['abc', '2026-13', '2026', '', '2026-00']) {
      expect(() => monthRangeLocal(bad), `${bad} 가 통과했다`).toThrow(BadRequestException);
    }
    const r = monthRangeLocal('2026-08');
    expect(r.start).toEqual(new Date(2026, 7, 1));
    expect(r.end).toEqual(new Date(2026, 8, 1));
    expect(r.start.getHours(), 'UTC 로 만들면 KST 에서 하루가 밀린다').toBe(0);
  });

  it('한쪽만 줘도 동작한다', () => {
    expect(dayRange('2026-08-13', null)).toEqual({ gte: new Date(2026, 7, 13) });
    expect(dayRange(null, null)).toBeUndefined();
  });

  it('🔴 localDateKey 는 로컬 달력 날짜 — toISOString().slice(0,10) 은 하루가 밀린다', () => {
    // KST 자정 직후: UTC 로는 전날 15:00
    const d = new Date(2026, 7, 14, 0, 30, 0);
    expect(localDateKey(d)).toBe('2026-08-14');
  });

  it('todayRange 는 로컬 자정~다음 자정', () => {
    const now = new Date(2026, 7, 14, 18, 45, 0);
    const r = todayRange(now);
    expect(r.gte).toEqual(new Date(2026, 7, 14, 0, 0, 0, 0));
    expect(r.lt).toEqual(new Date(2026, 7, 15, 0, 0, 0, 0));
  });
});
