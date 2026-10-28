import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localDateKey } from '../../src/common/day-range';

/**
 * 🔴 일마감 기본 날짜가 KST 오늘이어야 한다 — `.toISOString().slice(0,10)` 은 KST 자정을 UTC 전날로 준다 (2026-09-01 · 발굴).
 * getDailySummary 는 날짜를 KST 로 해석하는데 dailyClose 기본값만 UTC slice 라, "오늘 일마감"이 **어제 전표**를
 * ERP 로 보냈다(화면 '오늘 매출'과도 창이 달랐다·P12). 정본 localDateKey 로 정합.
 */
describe('일마감 기본 날짜', () => {
  it('🔴 KST 자정의 UTC slice 는 전날, localDateKey 는 오늘(오라클)', () => {
    // KST 오늘 자정 = new Date(y,m,d) (로컬). KST 아침 시점 재현.
    const kstToday = new Date('2026-09-01T00:00:00+09:00'); // = 2026-08-31T15:00Z
    expect(kstToday.toISOString().slice(0, 10)).toBe('2026-08-31'); // 종전 기본값 = 전날
    expect(localDateKey(kstToday)).toBe('2026-09-01');            // 정본 = KST 오늘
  });
  it('dailyClose 가 정본 localDateKey 를 쓴다(회귀 잠금)', () => {
    const s = readFileSync(join(process.cwd(), 'src/modules/billing/billing.service.ts'), 'utf8');
    expect(s).toMatch(/date \?\? localDateKey\(this\.getTodayStart\(\)\)/);
    expect(s, "toISOString().slice 기본값 재발").not.toMatch(/date \?\? this\.getTodayStart\(\)\.toISOString\(\)\.slice/);
  });
});
