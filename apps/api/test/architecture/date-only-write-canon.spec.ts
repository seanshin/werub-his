import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { todayDateOnly } from '../../src/common/day-range';

/**
 * 🔴 **`new Date()`(now) 를 `@db.Date` 컬럼에 쓰면 KST 00~09시엔 전날로 저장된다** (2026-08-31 · 발굴).
 *
 * Prisma 는 `@db.Date` 에 인스턴트의 **UTC 날짜**를 쓴다. KST 07:00 = UTC 전날 22:00 →
 * 저장 날짜가 **하루 앞**. 정본 `todayDateOnly()` 는 KST 달력 날짜의 UTC 자정을 만들어 이를 막는다.
 * 실측 8곳(전부 @db.Date): research(irbApprovalDate·endDate·withdrawDate)·inpatient(noteDate)·
 * code-master(diagnosis·procedure·medication validFrom)·chemo(cancerTreatment endDate).
 * (admitDate·isolationPrecaution.endDate 는 @db.Timestamptz 라 `new Date()` 가 정당 — 안 고쳤다)
 * 근거: [[db_date_offset_trap]] · CLAUDE.md §날짜밀림
 */
describe('🔴 todayDateOnly 가 KST 오전 오프셋을 고친다(오라클)', () => {
  it('KST 07:00 인스턴트 → 저장 날짜가 KST 오늘이다(전날 아님)', () => {
    const kstMorning = new Date('2026-08-31T07:00:00+09:00'); // = 2026-08-30T22:00Z
    // new Date() 를 그대로 @db.Date 로 쓰면 UTC 날짜(전날)
    expect(kstMorning.toISOString().slice(0, 10)).toBe('2026-08-30'); // ← 버그 재현
    // 정본은 KST 날짜를 보존
    expect(todayDateOnly(kstMorning).toISOString().slice(0, 10)).toBe('2026-08-31');
  });
});

describe('🔴 @db.Date "오늘" 쓰기가 정본을 쓴다(회귀 잠금)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), 'src/modules', p), 'utf8');
  const sites: [string, RegExp][] = [
    ['research/research.service.ts', /irbApprovalDate: new Date\(\)/],
    ['research/research.service.ts', /endDate: new Date\(\) }/],
    ['research/research.service.ts', /withdrawDate: new Date\(\)/],
    ['inpatient/inpatient.service.ts', /noteDate: new Date\(\)/],
    ['code-master/code-master.service.ts', /validFrom: new Date\(\)/],
    ['chemo/chemo.service.ts', /endDate: new Date\(\),/],
  ];
  for (const [file, bad] of sites) {
    it(`${file} — @db.Date 에 new Date() 를 쓰지 않는다: ${bad.source}`, () => {
      expect(bad.test(src(file)), `${bad.source} 재발 — todayDateOnly() 를 쓴다`).toBe(false);
    });
  }
  it('정본이 실제로 소비된다(대조군)', () => {
    expect(src('code-master/code-master.service.ts')).toMatch(/validFrom: todayDateOnly\(\)/);
    expect(src('inpatient/inpatient.service.ts')).toMatch(/noteDate: todayDateOnly\(\)/);
  });
});
