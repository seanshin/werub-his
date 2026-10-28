import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { todayDateOnly, dateOnlyValue } from '../../src/common/day-range';

/**
 * 🔴 **@db.Date 컬럼을 로컬 자정(`setHours(0,0,0,0)`)으로 조회/기록하면 하루 밀린다** (2026-08-31 · 발굴).
 *
 * Prisma 는 @db.Date 에 인스턴트의 UTC 날짜를 쓴다. `new Date(); setHours(0,0,0,0)` = KST 자정 = 전날 15:00Z
 * → @db.Date 비교/저장이 **어제**가 된다. 검진 예약·투석 세션·복약 슬롯·급식 등 **오늘 목록이 어제**로 나왔고,
 * 생성 경로는 **어제 날짜로 기록**했다. 정본 `todayDateOnly()`/`dateOnlyValue()`(UTC 자정)로 수렴.
 * (Timestamptz 컬럼은 로컬 자정이 옳다 — 안 건드렸다: portal createdAt/scheduledAt·qi 월경계 등)
 */
const src = (p: string) => readFileSync(join(process.cwd(), 'src/modules', p), 'utf8');

describe('🔴 todayDateOnly 오라클(UTC 자정 = @db.Date 정확)', () => {
  it('KST 오전에도 @db.Date 저장 날짜가 KST 오늘이다', () => {
    const kstMorning = new Date('2026-08-31T07:00:00+09:00');
    expect(kstMorning.toISOString().slice(0, 10)).toBe('2026-08-30'); // new Date() 저장 시 전날
    expect(todayDateOnly(kstMorning).toISOString().slice(0, 10)).toBe('2026-08-31');
  });
});

describe('🔴 고친 @db.Date 조회/기록이 정본을 쓴다(회귀 잠금)', () => {
  const cases: [string, RegExp][] = [
    ['workstation/workstation.service.ts', /const today = new Date\(\);\s*\n\s*today\.setHours\(0, 0, 0, 0\);/],
    ['radiation/radiation.service.ts', /today\.setHours\(0, 0, 0, 0\)/],
    ['dialysis/dialysis.service.ts', /today\.setHours\(0, 0, 0, 0\)/],
    ['portal/medication-reminder.cron.ts', /today\.setHours\(0, 0, 0, 0\)/],
    ['pre-order/pre-order.service.ts', /from\.setHours\(0, 0, 0, 0\)/],
  ];
  for (const [file, bad] of cases) {
    it(`${file} — @db.Date 경계에 로컬 자정 setHours 가 없다`, () => {
      expect(bad.test(src(file)), `${file}: setHours 로컬자정 재발 — todayDateOnly() 를 쓴다`).toBe(false);
    });
  }
  it('slotDate/scheduledDate 의 today 가 정본으로 정의된다(portal·patient-auth)', () => {
    // 🔴 fix 는 today 의 **정의**를 todayDateOnly() 로 바꿨다(사용부 `slotDate: today` 는 그대로·today 가 이제 정확).
    //    getMedicationSchedule/checkMedication 이 정본 코멘트를 담고, 로컬자정 재발이 없음을 본다.
    expect(src('portal/portal.service.ts')).toContain('slotDate 는 @db.Date');
    expect(src('patient-auth/patient-auth.service.ts')).toContain("scheduledDate: todayDateOnly()");
    expect(src('patient-auth/patient-auth.service.ts')).not.toMatch(/scheduledDate: today,/);
  });
  it('정본이 실제로 소비된다(대조군)', () => {
    expect(src('nutrition/nutrition.service.ts')).toContain('this.dayValue(`${year}-${mm}-01`)');
    expect(src('dialysis/dialysis.service.ts')).toContain('getUTCDay()');
  });
});
