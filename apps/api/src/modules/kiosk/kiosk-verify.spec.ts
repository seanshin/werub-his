import { describe, it, expect } from 'vitest';
import { dobMatches } from './kiosk-verify';

describe('키오스크 생년월일 본인확인', () => {
  it('YYYYMMDD 일치', () => {
    expect(dobMatches('19850512', '19850512')).toBe(true);
    expect(dobMatches('19850512', '1985-05-12')).toBe(true); // 구분자 허용
  });
  it('YYMMDD(6자리) 일치', () => {
    expect(dobMatches('19850512', '850512')).toBe(true);
  });
  it('불일치·빈값', () => {
    expect(dobMatches('19850512', '19850513')).toBe(false);
    expect(dobMatches('19850512', '')).toBe(false);
  });
});
