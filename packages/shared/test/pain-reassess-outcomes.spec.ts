/**
 * 통증 재평가 기한 내 수행률 판정(2026-10-27) — 사건마다 · 사건 뒤 첫 통증 기록이 기한 안인가.
 *  · 기한 안/뒤/없음 · 🔴 기한이 아직 안 온 것·기한 전에 재원이 끝난 것은 분모 제외 · 같은 시각 기록은 재평가 아님
 *  · 기간 밖 사건은 세지 않는다 · 진통제 사건은 규정이 켤 때만
 */
import { describe, it, expect } from 'vitest';
import { painReassessOutcomes, riskReassessOutcomes, normalizeRiskReassessIntervals, RISK_REASSESS_INTERVAL_DEFAULT } from '../src/nursing-rules';

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 10, h, m));
const RANGE = { from: new Date(Date.UTC(2026, 9, 1)), to: new Date(Date.UTC(2026, 10, 1)) };
const NOW = new Date(Date.UTC(2026, 10, 5));
const RULE = { thresholdScore: 4, withinMinutes: 60, afterAnalgesicMinutes: 30 };

describe('통증 재평가 결과', () => {
  it('기한 안 · 기한 뒤 · 재평가 없음 · 기준 미만은 사건 아님', () => {
    const pain = [{ at: T(1), score: 7 }, { at: T(1, 50), score: 5 }, { at: T(4), score: 6 }, { at: T(6), score: 2 }, { at: T(9), score: 8 }];
    // 1:00(7) → 1:50 재평가 onTime · 1:50(5) → 4:00 late · 4:00(6) → 6:00 late · 9:00(8) → 없음 never
    expect(painReassessOutcomes(RULE, pain, [], RANGE, NOW, null)).toEqual({ onTime: 1, late: 2, never: 1, pending: 0, endedBeforeDue: 0 });
  });
  it('🔴 기한이 아직 안 옴 → pending · 기한 전에 재원 끝 → endedBeforeDue(둘 다 분모 제외)', () => {
    const pain = [{ at: T(9), score: 8 }];
    expect(painReassessOutcomes(RULE, pain, [], RANGE, T(9, 30), null).pending).toBe(1);
    expect(painReassessOutcomes(RULE, pain, [], RANGE, NOW, T(9, 20)).endedBeforeDue).toBe(1);
  });
  it('같은 시각 기록은 재평가 아님 · 기간 밖 사건 제외 · 진통제 사건은 규정이 켤 때만', () => {
    expect(painReassessOutcomes(RULE, [{ at: T(1), score: 7 }, { at: T(1), score: 3 }], [], RANGE, NOW, null).never).toBe(1);
    expect(painReassessOutcomes(RULE, [{ at: new Date(Date.UTC(2026, 8, 30, 23)), score: 9 }], [], RANGE, NOW, null)).toEqual({ onTime: 0, late: 0, never: 0, pending: 0, endedBeforeDue: 0 });
    const an = [{ at: T(2), name: null }];
    expect(painReassessOutcomes(RULE, [{ at: T(2, 20), score: 1 }], an, RANGE, NOW, null).onTime).toBe(1);
    expect(painReassessOutcomes({ ...RULE, afterAnalgesicMinutes: null }, [{ at: T(2, 20), score: 1 }], an, RANGE, NOW, null).onTime).toBe(0);
  });
});

describe('위험 재평가 주기·결과(2026-10-27)', () => {
  it('주기 표 — 코드 기본값 통과 · 🔴 고위험이 더 길면 거부 · 범위 밖·빈 유형 거부', () => {
    expect(normalizeRiskReassessIntervals(RISK_REASSESS_INTERVAL_DEFAULT)).toEqual(RISK_REASSESS_INTERVAL_DEFAULT);
    expect(normalizeRiskReassessIntervals({ ...RISK_REASSESS_INTERVAL_DEFAULT, PRESSURE_ULCER: { HIGH: 24, MODERATE: 8, LOW: 4 } })).toBeNull();
    expect(normalizeRiskReassessIntervals({ ...RISK_REASSESS_INTERVAL_DEFAULT, FALL_RISK: { HIGH: 2, MODERATE: 4, LOW: 169 } })).toBeNull();
    expect(normalizeRiskReassessIntervals({ FALL_RISK: RISK_REASSESS_INTERVAL_DEFAULT.FALL_RISK })).toBeNull();
  });
  it('등급별 주기로 기한 · 다음 평가 기한 안/뒤/없음', () => {
    const iv = { HIGH: 2, MODERATE: 4, LOW: 8 };
    const ev = [{ at: T(1), level: 'HIGH' as const }, { at: T(2, 30), level: 'LOW' as const }, { at: T(20), level: 'MODERATE' as const }];
    expect(riskReassessOutcomes(iv, ev, RANGE, NOW, null)).toEqual({ onTime: 1, late: 1, never: 1, pending: 0, endedBeforeDue: 0 });
  });
});
