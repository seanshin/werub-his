import { describe, it, expect } from 'vitest';
import { summarizeBasis, readBasis, BASIS_KINDS } from './decision-basis';

/**
 * 근거 정본 (2026-08-27 · 계획서 §3.2 · 가드 G5).
 *
 * 🔴 `undefined`(키 없음) = **미기재** · `[]` = **검토했고 해당 없음**.
 *    뭉개면 "법적 검토를 안 한 것"과 "법적 근거가 없다고 판단한 것"이 같아진다.
 * 🔴 실측: 등록부 35항목 중 `legalReview` 가 13(37%)에서 비어 있다 —
 *    그러므로 **비어 있음이 기본 상태**여야 한다.
 */
describe('근거 — 미기재와 해당 없음을 구분한다', () => {
  it('🔴 G5 — 아무것도 안 적으면 untouched(근거 없음이라 말할 수 있는 유일한 상태)', () => {
    const s = summarizeBasis(null);
    expect(s.untouched).toBe(true);
    expect(s.hasAny).toBe(false);
    for (const k of BASIS_KINDS) expect(s.counts[k]).toBeNull();
  });

  it('🔴 G5-b — 빈 배열은 "검토했고 해당 없음"이다 — 미기재가 아니다', () => {
    const s = summarizeBasis({ legal: [] });
    expect(s.untouched).toBe(false);   // 손을 댔다
    expect(s.counts.legal).toBe(0);    // 해당 없음
    expect(s.counts.accreditation).toBeNull(); // 이쪽은 미기재
    expect(s.hasAny).toBe(false);
  });

  it('갈래별로 센다 — 섞지 않는다', () => {
    const s = summarizeBasis({ legal: ['의료법 §22'], evidence: ['위반 30일 12건', '재발 3건'] });
    expect(s.counts.legal).toBe(1);
    expect(s.counts.evidence).toBe(2);
    expect(s.counts.accreditation).toBeNull();
    expect(s.hasAny).toBe(true);
  });

  it('readBasis — 정본에 없는 키는 버리고, 아무것도 없으면 null', () => {
    expect(readBasis({ nope: ['x'] })).toBeNull();
    expect(readBasis({ legal: ['a', '  ', 'b'], nope: ['x'] })).toEqual({ legal: ['a', 'b'] });
    expect(readBasis(null)).toBeNull();
    expect(readBasis(['a'])).toBeNull();
  });

  it('🔴 대조군 — 판정이 무조건 참/거짓이 아니다', () => {
    expect(summarizeBasis({ legal: ['x'] }).untouched).toBe(false);
    expect(summarizeBasis(undefined).untouched).toBe(true);
  });
});
