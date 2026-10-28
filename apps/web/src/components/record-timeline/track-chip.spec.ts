import { describe, it, expect } from 'vitest';
import { chipState, showChipCount } from './track-chip';

/**
 * 유형 칩 골든 — 2026-07-30 툴바 정리에서 나온 계약.
 * 🔴 회귀 방지 대상: 필터가 걸리면 counts 가 선택 트랙만 담으므로 "0건=비활성"을 그대로 적용하면
 *    나머지 칩이 전부 죽어 두 번째 유형을 고를 수 없다.
 */
describe('chipState', () => {
  it('선택된 유형은 항상 selected(건수·필터 무관)', () => {
    expect(chipState(0, true, true)).toBe('selected');
    expect(chipState(12, true, false)).toBe('selected');
  });

  it('필터 없음 + 0건 → muted(빈 결과로 가는 클릭을 막는다)', () => {
    expect(chipState(0, false, false)).toBe('muted');
  });

  it('필터 없음 + 1건 이상 → available', () => {
    expect(chipState(1, false, false)).toBe('available');
  });

  it('🔴 필터 중이면 0건이어도 available — 미조회 트랙을 죽이지 않는다', () => {
    expect(chipState(0, false, true)).toBe('available');
  });

  it('음수·비정상 건수도 0으로 취급(필터 없을 때만 muted)', () => {
    expect(chipState(-1, false, false)).toBe('muted');
    expect(chipState(-1, false, true)).toBe('available');
  });
});

describe('showChipCount', () => {
  it('1건 이상만 숫자를 노출한다', () => {
    expect(showChipCount(3)).toBe(true);
    expect(showChipCount(0)).toBe(false);
    expect(showChipCount(-2)).toBe(false);
  });
});
