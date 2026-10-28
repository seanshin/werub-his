import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../../src/common/phone';

/**
 * 🔴 전화 정규화 — 표기차가 같은 정본으로 수렴해야 중복 탐지가 작동한다(환자관리 A1).
 */
describe('normalizePhone', () => {
  it('하이픈 유무·공백을 흡수한다(같은 사람 → 같은 값)', () => {
    const canon = '+821012345678';
    expect(normalizePhone('010-1234-5678')).toBe(canon);
    expect(normalizePhone('01012345678')).toBe(canon);
    expect(normalizePhone('010 1234 5678')).toBe(canon);
    expect(normalizePhone('+82 10-1234-5678')).toBe(canon);
  });
  it('해석 불가는 null — 지어내지 않는다', () => {
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
  it('일반전화(02 등)도 0 접두 규칙으로 정규화', () => {
    expect(normalizePhone('02-123-4567')).toBe('+8221234567');
  });
});
