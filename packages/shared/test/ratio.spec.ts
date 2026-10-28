import { describe, it, expect } from 'vitest';
import { ratioOf, ratioText, RATIO_UNAVAILABLE } from '../src/ratio';

/**
 * 비율 정본 — 분모와 함께, 분모 0·미상은 산출 불가(`clinical-ux-agent-era.plan.md` §2.1·§3.3).
 * 🔴 분모 0이면 완결률이 100% 가 되던 것(v4.4.0)·표본 부재를 `0%`/`-` 로 그리던 것이 이 정본의 이유다.
 */
describe('ratioOf / ratioText', () => {
  it('정상: n / N (p%) — 백분율은 percent 정책(소수 1자리)', () => {
    expect(ratioText(3, 4)).toBe('3 / 4 (75.0%)');
    expect(ratioText(7, 9, { pctOnly: true, decimals: 0 })).toBe('78%');
    expect(ratioOf(0, 24)).toMatchObject({ pct: 0, unavailableReason: null }); // 진짜 0 은 0
  });
  it('🔴 분모 0 은 0% 도 100% 도 아니다 — 산출 불가', () => {
    expect(ratioText(0, 0)).toBe(RATIO_UNAVAILABLE);
    expect(ratioOf(0, 0).unavailableReason).toBe('ZERO_DENOMINATOR');
    expect(ratioOf(5, 0).pct).toBeNull(); // 5/0 을 100% 로 만들지 않는다
  });
  it('분모 미상·분자 미상도 산출 불가(사유가 다르다)', () => {
    expect(ratioOf(3, null).unavailableReason).toBe('NO_DENOMINATOR');
    expect(ratioOf(null, 10).unavailableReason).toBe('NO_NUMERATOR');
    expect(ratioText(null, 10)).toBe(RATIO_UNAVAILABLE);
    expect(ratioOf(NaN, 10).unavailableReason).toBe('NO_NUMERATOR');
  });
});
