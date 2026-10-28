import { describe, it, expect } from 'vitest';
import {
  clampSummaryRatio, summaryRatioFromPointer, parseSummaryRatio,
  SUMMARY_MIN_RATIO, SUMMARY_MAX_RATIO, SUMMARY_DEFAULT_RATIO,
} from './summary-split';

/**
 * 목록 ↔ 정리 영역 분할 골든 — 2026-07-30.
 * 불변: 정리 영역이 화면을 다 먹지 않는다(목록 최소 30% 보존) · 완전히 사라지지도 않는다.
 */
describe('clampSummaryRatio', () => {
  it('기본값은 30%', () => expect(SUMMARY_DEFAULT_RATIO).toBe(0.3));

  it('하한/상한으로 클램프', () => {
    expect(clampSummaryRatio(0.01)).toBe(SUMMARY_MIN_RATIO);
    expect(clampSummaryRatio(0.99)).toBe(SUMMARY_MAX_RATIO);
    expect(clampSummaryRatio(0.42)).toBe(0.42);
  });

  it('유한수가 아니면 기본값(NaN·Infinity 모두)', () => {
    expect(clampSummaryRatio(NaN)).toBe(SUMMARY_DEFAULT_RATIO);
    expect(clampSummaryRatio(Infinity)).toBe(SUMMARY_DEFAULT_RATIO);
    expect(clampSummaryRatio(-Infinity)).toBe(SUMMARY_DEFAULT_RATIO);
  });
});

describe('summaryRatioFromPointer — 분할선 드래그', () => {
  const top = 100, height = 1000; // 컨테이너 100~1100

  it('분할선을 위로 끌면 정리 영역이 커진다', () => {
    const high = summaryRatioFromPointer(600, top, height); // 중앙
    const higher = summaryRatioFromPointer(400, top, height); // 더 위
    expect(higher).toBeGreaterThan(high);
    expect(high).toBeCloseTo(0.5, 5);
  });

  it('맨 아래로 끌어도 하한 유지(정리 영역이 사라지지 않음)', () => {
    expect(summaryRatioFromPointer(1100, top, height)).toBe(SUMMARY_MIN_RATIO);
    expect(summaryRatioFromPointer(2000, top, height)).toBe(SUMMARY_MIN_RATIO);
  });

  it('맨 위로 끌어도 상한 유지(목록이 사라지지 않음)', () => {
    expect(summaryRatioFromPointer(100, top, height)).toBe(SUMMARY_MAX_RATIO);
    expect(summaryRatioFromPointer(-500, top, height)).toBe(SUMMARY_MAX_RATIO);
  });

  it('컨테이너 높이가 0이면 기본값(0 나눗셈 방어)', () => {
    expect(summaryRatioFromPointer(500, top, 0)).toBe(SUMMARY_DEFAULT_RATIO);
  });
});

describe('parseSummaryRatio — 저장값 복원', () => {
  it('정상값은 그대로', () => expect(parseSummaryRatio('0.45')).toBe(0.45));
  it('없거나 손상되면 기본값', () => {
    expect(parseSummaryRatio(null)).toBe(SUMMARY_DEFAULT_RATIO);
    expect(parseSummaryRatio('abc')).toBe(SUMMARY_DEFAULT_RATIO);
  });
  it('범위 밖은 클램프', () => {
    expect(parseSummaryRatio('0.95')).toBe(SUMMARY_MAX_RATIO);
    expect(parseSummaryRatio('0.02')).toBe(SUMMARY_MIN_RATIO);
  });
});
