import { describe, it, expect } from 'vitest';
import { BRADEN_ITEMS, bradenRiskLevel, bradenTotalOf, evaluateBradenRecord, readBradenSubscores } from '../src/braden';

/** Braden 정본(2026-10-10) — 하위 6항목·범위·등급·기록 점검. 부분 합을 총점으로 만들지 않는다. */
const FULL = { sensory: 3, moisture: 2, activity: 2, mobility: 3, nutrition: 2, friction: 2 }; // 14

describe('Braden 정본', () => {
  it('6항목 · 마찰은 최대 3', () => {
    expect(BRADEN_ITEMS.map((i) => i.key)).toEqual(['sensory', 'moisture', 'activity', 'mobility', 'nutrition', 'friction']);
    expect(BRADEN_ITEMS.find((i) => i.key === 'friction')!.max).toBe(3);
  });
  it('등급 경계 ≤12 고 · 13–14 중 · ≥15 저 · 범위 밖·정수 아님은 null', () => {
    expect([6, 12, 13, 14, 15, 23].map(bradenRiskLevel)).toEqual(['HIGH', 'HIGH', 'MODERATE', 'MODERATE', 'LOW', 'LOW']);
    for (const bad of [5, 24, 12.5, null, undefined, NaN]) expect(bradenRiskLevel(bad as never)).toBeNull();
  });
  it('세 입력 모양(점수·scores·임상 도구 idx) · 재평가 화면 키 별칭', () => {
    expect(bradenTotalOf(readBradenSubscores(FULL).scores)).toBe(14);
    expect(bradenTotalOf(readBradenSubscores({ scores: FULL }).scores)).toBe(14);
    expect(readBradenSubscores({ idx: { sensory: 2, moisture: 1, activity: 1, mobility: 2, nutrition: 1, friction: 1 } }).scores).toEqual(FULL);
    const alias = { sensoryPerception: 3, moisture: 2, activity: 2, mobility: 3, nutrition: 2, frictionShear: 2 };
    expect(bradenTotalOf(readBradenSubscores(alias).scores)).toBe(14);
  });
  it('🔴 항목이 하나라도 없으면 총점 없음(부분 합 금지) · 범위 밖 항목은 invalid', () => {
    const { friction: _f, ...five } = FULL;
    expect(bradenTotalOf(readBradenSubscores(five).scores)).toBeNull();
    expect(readBradenSubscores({ ...FULL, friction: 4 }).invalid).toEqual(['friction']);
  });
  it('기록 점검 — 총점만 받는 경로는 점검 아님 · 범위 밖 · 누락 · 합 불일치', () => {
    expect(evaluateBradenRecord(14, null)).toEqual({ total: 14, subscores: null, riskLevel: 'MODERATE', checks: [] });
    expect(evaluateBradenRecord(30, null)).toMatchObject({ riskLevel: null, checks: ['OUT_OF_RANGE'] });
    expect(evaluateBradenRecord(14, { sensory: 3 })).toMatchObject({ total: 14, checks: ['INCOMPLETE'] });
    expect(evaluateBradenRecord(18, FULL)).toMatchObject({ total: 18, checks: ['SUM_MISMATCH'] });
    expect(evaluateBradenRecord(null, FULL)).toMatchObject({ total: 14, riskLevel: 'MODERATE', checks: [] });
  });
});
