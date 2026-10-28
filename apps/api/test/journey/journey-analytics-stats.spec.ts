import { describe, it, expect } from 'vitest';
import { stats } from '../../src/modules/journey-console/journey-analytics.service';

describe('journey-analytics stats', () => {
  it('빈 배열 → 0·breachRate null', () => {
    const s = stats([]);
    expect(s.count).toBe(0);
    expect(s.avg).toBe(0);
    expect(s.breachRate).toBeNull();
  });

  it('avg·max·count', () => {
    const s = stats([10, 20, 30]);
    expect(s.count).toBe(3);
    expect(s.avg).toBe(20);
    expect(s.max).toBe(30);
  });

  it('percentile nearest-rank(p90 != max 편향 보정)', () => {
    const v = Array.from({ length: 10 }, (_, i) => i + 1); // 1..10
    const s = stats(v);
    // ceil(0.9*10)-1 = 8 → v[8] = 9 (max=10이 아님)
    expect(s.p90).toBe(9);
    // ceil(0.5*10)-1 = 4 → v[4] = 5
    expect(s.p50).toBe(5);
    expect(s.max).toBe(10);
  });

  it('breachRate — 목표 초과 비율', () => {
    // 목표 30: 10,20,30 통과 / 40,50 위반 → 2/5 = 40%
    const s = stats([10, 20, 30, 40, 50], 30);
    expect(s.breachRate).toBe(40);
    expect(s.target).toBe(30);
  });

  it('breachRate — 경계(==target은 위반 아님, > 만 위반)', () => {
    expect(stats([30, 30, 30], 30).breachRate).toBe(0);
    expect(stats([31, 31], 30).breachRate).toBe(100);
  });

  it('음수/비유한 값 필터', () => {
    const s = stats([-5, 10, NaN, 20, Infinity], 15);
    expect(s.count).toBe(2); // 10, 20 만
    expect(s.avg).toBe(15);
    expect(s.breachRate).toBe(50); // 20 만 위반
  });

  it('단일 값', () => {
    const s = stats([42], 30);
    expect(s.p50).toBe(42);
    expect(s.p90).toBe(42);
    expect(s.breachRate).toBe(100);
  });
});
