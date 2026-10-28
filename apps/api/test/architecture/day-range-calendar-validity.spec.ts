/**
 * 🔴 (2026-09-14) `parseLocalDate('2026-13-40')` 이 null 이 아니라 2027-02-09 를 돌려줬다 — `new Date(y, m-1, d)` 는 넘치는 월·일을
 * 다음 달로 굴린다. requireDateParam 소비처(가용 슬롯·일 뷰 등)가 400 대신 엉뚱한 날짜로 조회했다.
 * 지키는 것: ① 달력에 없는 날짜는 null·400 ② 대조군 — 윤년 2/29·월말은 통과 ③ 비윤년 2/29 는 거부
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parseLocalDate, requireDateParam } from '../../src/common/day-range';

describe('day-range — 달력 실재 날짜만', () => {
  it.each(['2026-13-40', '2026-02-30', '2026-04-31', '2026-00-10', '2026-12-00'])('① %s 는 null·400', (v) => {
    expect(parseLocalDate(v)).toBeNull();
    expect(() => requireDateParam(v, '날짜')).toThrow(BadRequestException);
  });
  it.each(['2028-02-29', '2026-01-31', '2026-12-31', '2026-09-14'])('② 대조군 — %s 는 그 날짜', (v) => {
    const d = parseLocalDate(v)!;
    const [y, m, day] = v.split('-').map(Number);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([y, m, day]);
  });
  it('③ 비윤년 2/29 거부', () => {
    expect(parseLocalDate('2026-02-29')).toBeNull();
  });
});
