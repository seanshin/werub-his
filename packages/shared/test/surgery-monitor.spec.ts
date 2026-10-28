import { describe, it, expect } from 'vitest';
import { intraopVitalsOf, quantileOf, surgeryFlowOf, intraopSummaryOf, SURGERY_PHASES, SURGERY_PHASE_LABEL } from '../src/surgery-monitor';

/**
 * 수술실 모니터 정본(2026-10-05) — 🔴 배열이 아니면 null(모름 — 빈 목록과 다르다) · 시각 없는 점은 버린다 · 표본 0 분위수는 null.
 * 재주입: 모름을 빈 목록으로 접거나 시각 없는 점을 지어내거나 빈 표본에 0 을 내면 실패한다.
 */
describe('수술 중 활력', () => {
  it('🔴 배열이 아니면 null · 시각 없는 점은 버리고 시각순 · 키 별칭', () => {
    for (const v of [null, undefined, 'x', {}]) expect(intraopVitalsOf(v)).toBeNull();
    const r = intraopVitalsOf([
      { time: '2026-10-05T02:00:00Z', hr: 90, sbp: 120, dbp: 70, spo2: '98', etco2: null },
      { heartRate: 80 },
      { time: '2026-10-05T01:00:00Z', heartRate: 80, systolicBp: 'x' },
    ])!;
    expect(r.map((p) => p.heartRate)).toEqual([80, 90]);
    expect(r[0].systolicBp).toBeNull();
    expect(r[1]).toMatchObject({ systolicBp: 120, diastolicBp: 70, spo2: 98, etco2: null });
  });
});

describe('분위수', () => {
  it('표본 0 은 null(0 아님) · 가장 가까운 순위', () => {
    expect(quantileOf([], 0.5)).toBeNull();
    expect(quantileOf([5, 1, 3], 0.5)).toBe(3);
    expect(quantileOf([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.9)).toBe(90);
  });
  it('단계 라벨이 모두 있다', () => {
    expect(Object.keys(SURGERY_PHASE_LABEL).sort()).toEqual([...SURGERY_PHASES].sort());
  });
});

describe('수술 흐름 정본(surgeryFlowOf)', () => {
  const none = Object.fromEntries(SURGERY_PHASES.map((k) => [k, null])) as Record<(typeof SURGERY_PHASES)[number], null>;
  it('🔴 마지막 기록 단계 앞의 빈 단계는 "기록 없음"(지났다고 하지 않는다) · 다음 단계', () => {
    const f = surgeryFlowOf({ ...none, SIGN_IN: '2026-10-05T01:00:00Z', START: '2026-10-05T01:20:00Z', INCISION: '2026-10-05T01:30:00Z' });
    expect(f.lastPhase).toBe('INCISION');
    expect(f.nextPhase).toBe('CLOSURE');
    expect(f.unrecordedBefore).toEqual(['INDUCTION', 'TIME_OUT']);
    expect(f.phases.find((p) => p.key === 'INDUCTION')!.at).toBeNull();
  });
  it('하나도 없으면 다음=Sign-In · 회복실 퇴실까지면 다음 없음', () => {
    expect(surgeryFlowOf(none)).toMatchObject({ lastPhase: null, nextPhase: 'SIGN_IN', unrecordedBefore: [] });
    expect(surgeryFlowOf({ ...none, PACU_OUT: '2026-10-05T05:00:00Z' }).nextPhase).toBeNull();
  });
  it('🔴 정해진 짝만 뒤집힘을 말한다(절개>봉합) — 유동적인 순서(유도·Time-Out)는 보지 않는다', () => {
    const f = surgeryFlowOf({ ...none, INDUCTION: '2026-10-05T02:00:00Z', TIME_OUT: '2026-10-05T01:00:00Z', INCISION: '2026-10-05T03:00:00Z', CLOSURE: '2026-10-05T02:30:00Z' });
    expect(f.timeConflicts).toEqual([['INCISION', 'CLOSURE']]);
  });
});

describe('수술 중 기록 요약(intraopSummaryOf)', () => {
  const T = '2026-10-05T01:00:00Z';
  const row = (kind: string, payload: Record<string, unknown>, voided = false) => ({ kind, occurredAt: T, payload, voidedAt: voided ? T : null });
  const times = { induction: '2026-10-05T01:00:00Z', extubation: '2026-10-05T03:10:00Z', incision: '2026-10-05T01:30:00Z', closure: '2026-10-05T03:00:00Z', start: null, end: null };
  it('🔴 기록 없는 종류는 null(0 아님) · 무효 줄은 빼고 센다 · 기간은 양 끝이 있을 때만', () => {
    const s = intraopSummaryOf([
      row('FLUID', { name: 'NS', volumeMl: 500 }), row('FLUID', { name: 'NS', volumeMl: 300 }, true),
      row('OUTPUT', { type: 'URINE', volumeMl: 200 }),
      row('VITALS', { heartRate: 80, spo2: 99 }), row('VITALS', { heartRate: 120 }), row('VITALS', { heartRate: 300 }, true),
    ], times);
    expect(s.io.fluidMl).toBe(500);
    expect(s.io.bloodMl).toBeNull();
    expect(s.io.bloodLossMl).toBeNull();
    expect(s.io.urineMl).toBe(200);
    expect(s.io.balanceMl).toBe(300);
    expect(s.vitals.heartRate).toEqual({ min: 80, max: 120, n: 2 });
    expect(s.vitals.etco2).toBeNull();
    expect(s.counts.voided).toBe(2);
    expect(s.durations).toEqual({ anesthesiaMin: 130, incisionToClosureMin: 90, startToEndMin: null });
  });
  it('🔴 단위가 다른 같은 약은 합치지 않는다 · mL 없는 혈액은 합 밖(수만) · 한쪽만 있으면 수지 null', () => {
    const s = intraopSummaryOf([
      row('DRUG', { name: 'Fentanyl', dose: 50, unit: 'mcg' }), row('DRUG', { name: 'fentanyl', dose: 50, unit: 'mcg' }), row('DRUG', { name: 'Fentanyl', dose: 0.1, unit: 'mg' }),
      row('BLOOD', { product: 'RBC', units: 1 }),
    ], { ...times, closure: '2026-10-05T01:00:00Z' });
    expect(s.drugs).toEqual([{ name: 'Fentanyl', unit: 'mcg', total: 100, count: 2 }, { name: 'Fentanyl', unit: 'mg', total: 0.1, count: 1 }]);
    expect(s.io.bloodMl).toBeNull();
    expect(s.io.bloodUnitsOnly).toBe(1);
    expect(s.io.balanceMl).toBeNull();
    expect(s.durations.incisionToClosureMin).toBeNull(); // 뒤집힘 → 값을 만들지 않는다
  });
});
