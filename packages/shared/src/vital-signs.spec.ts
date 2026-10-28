/**
 * 활력 표시 표준 정본 — 다른 정본들과 한 몸인지(2026-10-07).
 *  · 표시 단위·LOINC·UCUM 이 수치 정책(NUMERIC_POLICIES)과 같다 · 임계(VITALS_THRESHOLDS) 단위도 같다
 *    (종전 호흡수 단위가 임계 '회/분' · 수치 정책 '/min' 으로 갈라져 있었다)
 *  · 순서 = NEWS2 차트 순서 · readVitals 는 값을 고치지 않는다 · 정본 이름이 별칭을 이긴다
 *  · vitalConformance: 범위 밖·역전·짝 없음·문자열·미래 시각을 말한다 / 정상 기록에는 아무 말 없다(대조군)
 */
import { describe, it, expect } from 'vitest';
import { NUMERIC_POLICIES } from './numeric-policy';
import { VITALS_THRESHOLDS } from './vitals-thresholds';
import { VITAL_SIGN_DEFS, VITAL_SIGN_DEF, VITAL_DISPLAY_ORDER, readVitals, vitalConformance } from './vital-signs';

describe('정본 간 일치', () => {
  it('🔴 표시 단위·LOINC·UCUM = 수치 정책', () => {
    for (const d of VITAL_SIGN_DEFS) {
      if (!d.numericDomain) continue;
      const p = NUMERIC_POLICIES[d.numericDomain];
      expect(p, d.key).toBeTruthy();
      expect(p.displayUnit, `${d.key} 표시 단위`).toBe(d.displayUnit);
      expect(p.ucumUnit, `${d.key} UCUM`).toBe(d.ucum);
      expect(p.loincCode, `${d.key} LOINC`).toBe(d.loinc);
    }
  });
  it('🔴 임계 단위 = 표시 단위', () => {
    for (const [k, t] of Object.entries(VITALS_THRESHOLDS)) {
      expect(t.unit, k).toBe(VITAL_SIGN_DEF[k as keyof typeof VITAL_SIGN_DEF].displayUnit);
    }
  });
  it('순서 = NEWS2 관찰 차트(혈압 한 칸)', () => {
    expect(VITAL_DISPLAY_ORDER.slice(0, 6)).toEqual(['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'consciousness', 'temperature']);
  });
});

describe('readVitals', () => {
  it('🔴 값을 고치지 않는다 · 정본 이름이 별칭을 이긴다', () => {
    const r = readVitals({ heartRate: 80, pulse: 999, temp: 36.849 });
    expect(r.values.heartRate).toBe(80);
    expect(r.values.temperature).toBe(36.849);
    expect(r.aliasesUsed).toEqual([{ field: 'temp', key: 'temperature' }]);
  });
  it('문자열 혈압·숫자 문자열·Decimal 모양', () => {
    const r = readVitals({ bp: '120/80', spo2: '97', weight: { toNumber: () => 70.5 } });
    expect(r.values).toMatchObject({ systolicBp: 120, diastolicBp: 80, spo2: 97, weight: 70.5 });
    expect(r.bpStringParsed).toBe(true);
    expect(r.stringNumbers).toEqual(['spo2']);
  });
});

describe('vitalConformance', () => {
  it('🔴 범위 밖·역전·짝 없음·읽을 수 없음·미래 시각', () => {
    const now = new Date('2026-10-07T10:00:00Z');
    const codes = (raw: Record<string, unknown>, at?: string | null) => vitalConformance(raw, at === undefined ? { now } : { measuredAt: at, now }).issues.map((i) => i.code);
    expect(codes({ temperature: 365 })).toContain('IMPLAUSIBLE');
    expect(codes({ systolicBp: 80, diastolicBp: 90 })).toContain('BP_INVERTED');
    expect(codes({ systolicBp: 120 })).toContain('BP_INCOMPLETE');
    expect(codes({ heartRate: 'abc' })).toContain('UNREADABLE');
    expect(codes({ heartRate: 70 }, '2026-10-07T12:00:00Z')).toContain('FUTURE_MEASURED_AT');
    expect(codes({ heartRate: 70 }, null)).toContain('NO_MEASURED_AT');
  });
  it('대조군 — 정상 기록에는 아무 말 없다', () => {
    const r = vitalConformance({ respiratoryRate: 16, spo2: 98, systolicBp: 120, diastolicBp: 80, heartRate: 72, temperature: 36.6 }, { measuredAt: '2026-10-07T09:00:00Z', now: new Date('2026-10-07T10:00:00Z') });
    expect(r.issues).toEqual([]);
  });
});
