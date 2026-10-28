/**
 * 🔴 등록 병상 0에서 가동률은 0% 가 아니라 **산출 불가**(null).
 *
 * 2026-08-20 실측 잔여: `bed.service`·`bed-board.service` 가 `total > 0 ? … : 0` 이라
 * **등록 병상이 없는 병동을 "가동률 0%"(=다 비었다)** 로 말하고 있었다. 표본 부재를 성적으로 읽는 자리다.
 * 더 나쁜 것은 관제(`command-center`)의 `n()` 이 숫자 아닌 값을 0 으로 접어, 서버가 null 을 줘도
 * KPI 에 0% 로 찍힌다는 점이었다 — 그래서 관제에도 null 을 살리는 경로를 따로 두었다.
 *
 * 재주입하면 실패한다: `: null` 을 `: 0` 으로 되돌리거나, 관제가 다시 `n()` 으로 접으면 잡힌다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

describe('병상 가동률 — 0분모는 null', () => {
  it('bed.service 가 등록 병상 0에서 0 을 내지 않는다', () => {
    const s = read('modules/bed/bed.service.ts');
    expect(s).toMatch(/occupancyRate:\s*total\s*>\s*0\s*\?[^:]+:\s*null/);
    expect(s, '0분모를 0 으로 접는 코드가 남아 있다').not.toMatch(/occupancyRate:\s*total\s*>\s*0\s*\?[^:]+:\s*0\b/);
  });

  it('bed-board 가 병동별·전체 모두 0분모에서 null 을 낸다 · 정렬이 null 로 깨지지 않는다', () => {
    const s = read('modules/bed/bed-board.service.ts');
    const nulls = s.match(/occupancyRate:\s*[\w.]+\s*\?[^:]+:\s*null/g) ?? [];
    expect(nulls.length, '병동별·요약 두 곳 모두 null 이어야 한다').toBeGreaterThanOrEqual(2);
    // 🔴 null 을 그대로 빼면 NaN 비교라 정렬이 불안정해진다
    expect(s).toMatch(/occupancyRate\s*\?\?\s*-1/);
  });

  it('🔴 관제가 산출 불가를 0% 로 접지 않고, null 에서는 경보하지 않는다', () => {
    const s = read('modules/command-center/command-center.service.ts');
    expect(s, '비율은 null 을 살리는 접근자를 써야 한다').toMatch(/nOrNull/);
    expect(s).toMatch(/const occupancyRate = nOrNull\('bed', 'occupancyRate'\)/);
    // 표본 없음에서 경보하면 거짓 경보다
    expect(s).toMatch(/occupancyRate != null && occupancyRate >= 90/);
    expect(s, '분자·분모를 함께 내야 화면이 <Ratio> 를 그린다').toMatch(/occupancyNumerator/);
    expect(s).toMatch(/occupancyDenominator/);
  });
});
