import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { addMonths, subMonths } from '../../src/common/day-range';

/**
 * 🔴 개월 계산 정본 (2026-08-29 · 발굴 7회차).
 *
 * `d.setMonth(d.getMonth() + n)` 은 그 달에 없는 날짜를 **다음 달로 굴린다** —
 * `2026-01-31` + 1개월 → `2026-02-31` → **`2026-03-03`**.
 *
 * 🔴 실제로 만들어진 결함:
 *  · **분납 청구가 2월을 건너뛰고 3월에 두 번**(1회차 3/03 · 2회차 3/31)
 *  · QI 시드가 2월을 잃고 3월을 두 번 만들어 **매달 말일에 `db seed` 사망**
 *
 * 🔴 **정본은 원래 있었다** — `psychiatry.service.ts` 안 private 함수에.
 *    한 모듈에 갇혀 있어 나머지 넷이 각자 틀렸다.
 */
const f = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('🔴 addMonths 는 말일에서 굴러가지 않는다', () => {
  it('짧은 달로 갈 때 말일로 클램프한다', () => {
    expect(f(addMonths(new Date(2026, 0, 31), 1))).toBe('2026-02-28'); // 1/31 → 2/28
    expect(f(addMonths(new Date(2026, 0, 30), 1))).toBe('2026-02-28');
    expect(f(addMonths(new Date(2026, 0, 29), 1))).toBe('2026-02-28');
    expect(f(addMonths(new Date(2026, 2, 31), 1))).toBe('2026-04-30'); // 3/31 → 4/30
  });

  it('윤년 2월을 정확히 안다(대조군 — 28로 고정하면 틀린다)', () => {
    expect(f(addMonths(new Date(2028, 0, 31), 1))).toBe('2028-02-29');
  });

  it('굴러갈 일이 없는 날짜는 그대로다(대조군 — 무조건 클램프하면 틀린다)', () => {
    expect(f(addMonths(new Date(2026, 0, 15), 1))).toBe('2026-02-15');
    expect(f(addMonths(new Date(2026, 0, 1), 13))).toBe('2027-02-01');
  });

  it('뺄셈도 같다', () => {
    expect(f(subMonths(new Date(2026, 2, 31), 1))).toBe('2026-02-28');
    expect(f(subMonths(new Date(2026, 0, 15), 1))).toBe('2025-12-15');
  });

  it('🔴 연속 호출이 같은 달을 두 번 내지 않는다 — 분납이 3월에 두 번 잡히던 결함', () => {
    for (const base of [new Date(2026, 0, 29), new Date(2026, 0, 30), new Date(2026, 0, 31)]) {
      const months = [1, 2, 3, 4].map((i) => f(addMonths(base, i)).slice(0, 7));
      expect(new Set(months).size, `${f(base)} 기준 분납이 같은 달에 두 번: ${months.join(' ')}`)
        .toBe(months.length);
    }
  });
});

describe('🔴 기한·만료 계산이 정본을 쓴다 — setMonth 로 직접 하지 않는다', () => {
  const ROOT = join(process.cwd(), 'src');
  const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /**
   * 🔴 기한·만료를 계산하는 자리 — 하루가 밀리면 **사실이 바뀐다**.
   *    조회 범위(대시보드의 "6개월 전")는 여기 넣지 않는다 — 하루 차이가 통계에 무의미하고,
   *    억지로 넓히면 정당 판정에 가드를 만드는 셈이다.
   */
  const DEADLINE_FILES = [
    'modules/voucher/voucher.service.ts',
    'modules/education/education.service.ts',
    'modules/installment/installment.service.ts',
    'modules/pediatrics/pediatrics.service.ts',
    'modules/psychiatry/psychiatry.service.ts',
  ];

  for (const rel of DEADLINE_FILES) {
    it(`${rel.split('/').pop()} 가 setMonth 산술을 쓰지 않는다`, () => {
      const src = strip(readFileSync(join(ROOT, rel), 'utf8'));
      expect(src, 'setMonth(getMonth() ± n) 은 말일에서 굴러간다 — addMonths 를 쓴다')
        .not.toMatch(/setMonth\(\s*\w+\.getMonth\(\)\s*[+-]/);
      expect(src, 'addMonths 정본을 쓴다').toMatch(/addMonths\(/);
    });
  }

  it('🔴 정신과가 자기 addMonths 를 다시 만들지 않는다 — 정본이 둘이면 갈라진다', () => {
    const src = readFileSync(join(ROOT, 'modules/psychiatry/psychiatry.service.ts'), 'utf8');
    expect(src).not.toMatch(/private addMonths\(/);
    expect(src).toMatch(/from '\.\.\/\.\.\/common\/day-range'/);
  });

  it('🔴 시드도 같은 결함을 갖지 않는다(QI 측정 기간)', () => {
    const seed = strip(readFileSync(join(process.cwd(), 'prisma/seeds/qi-measurement.ts'), 'utf8'));
    expect(seed).not.toMatch(/setMonth\(\s*\w+\.getMonth\(\)\s*[+-]/);
  });

  it('스캔이 실제로 동작한다(대조군 — 파일을 못 읽으면 전부 자동 통과한다)', () => {
    expect(readdirSync(ROOT).length).toBeGreaterThan(3);
    for (const rel of DEADLINE_FILES) {
      expect(statSync(join(ROOT, rel)).size, rel).toBeGreaterThan(100);
    }
  });
});
