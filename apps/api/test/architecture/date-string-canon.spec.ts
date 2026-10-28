import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localDateKey, todayDateOnly } from '../../src/common/day-range';

/**
 * 🔴 **업무 날짜를 `new Date().toISOString().slice(0,10)` 로 만들면 KST 오전에 전날이 된다** (2026-09-01 · 발굴).
 *
 * `toISOString()` 은 UTC 다. KST 00:00~09:00(그리고 06시 크론=전날 21시 UTC)엔 UTC 날짜가 **전날**이라,
 * 조회 기본 날짜·overdue 판정·발급일·일일 스냅샷 capturedOn 이 하루 밀렸다. 정본 `localDateKey()`(KST 날짜
 * 문자열)/`todayDateOnly()`(KST 날짜의 UTC 자정). (ID 접두 문자열은 cosmetic — 대상 아님.)
 */
const src = (p: string) => readFileSync(join(process.cwd(), 'src/modules', p), 'utf8');

describe('🔴 localDateKey 오라클(KST 날짜 문자열)', () => {
  it('KST 오전엔 UTC slice 가 전날, localDateKey 는 KST 오늘', () => {
    const kstMorning = new Date('2026-09-01T06:00:00+09:00'); // = 2026-08-31T21:00Z
    expect(kstMorning.toISOString().slice(0, 10)).toBe('2026-08-31'); // 06시 크론이 전날로 굳던 원인
    expect(localDateKey(kstMorning)).toBe('2026-09-01');
    expect(todayDateOnly(kstMorning).toISOString().slice(0, 10)).toBe('2026-09-01');
  });
});

describe('🔴 업무 날짜가 정본을 쓴다(회귀 잠금)', () => {
  const cases: [string, RegExp][] = [
    ['data-quality/data-quality.service.ts', /const today = new Date\(new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\)/],
    ['go-live/go-live.service.ts', /capturedOn = new Date\(new Date\(\)\.toISOString\(\)\.slice/],
    ['notification/notification.service.ts', /d\.reviewDue < new Date\(\)\.toISOString\(\)\.slice/],
    ['therapy-order/therapy-order.controller.ts', /findByDate\(date \|\| new Date\(\)\.toISOString/],
    ['order/order.service.ts', /const today = new Date\(\)\.toISOString\(\)\.slice\(0, 10\);/],
    ['lab/qc.service.ts', /date: today\.toISOString\(\)\.slice/],
  ];
  for (const [file, bad] of cases) {
    it(`${file} — 업무 날짜에 UTC toISOString().slice 재발 없음`, () => {
      expect(bad.test(src(file)), `${file}: UTC 날짜 문자열 재발 — localDateKey()/todayDateOnly() 를 쓴다`).toBe(false);
    });
  }
  it('정본 소비 대조군', () => {
    expect(src('data-quality/data-quality.service.ts')).toContain('const today = todayDateOnly()');
    expect(src('notification/notification.service.ts')).toContain('localDateKey(new Date())');
  });
});
