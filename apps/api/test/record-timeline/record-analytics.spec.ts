/**
 * 임상 기록 시계열 분석(2026-10-01) — 진료 판단을 돕는 수치 사실.
 *  · 같은 항목 판정은 LOINC → 원 코드 → 이름(종전 화면은 이름 문자열만)
 *  · 처음→최근·변화·범위 안 비율(분모)·기울기 · 범위 이동은 판정 어휘가 아니라 IN/OUT 이동
 *  · `<5` 같은 보고값·다른 단위는 계산에서 빼고 수를 밝힌다 · 보고값은 재반올림하지 않는다
 *  · 처방 시작 전·후 평균은 양쪽 2점 이상일 때만
 *  · 활력 범위는 판정 정본(개정 병합본)
 */
import { describe, expect, it } from 'vitest';
import { VITALS_THRESHOLDS } from '@hospital-run/shared';
import {
  buildLabAnalytes, buildRecordAnalytics, buildVitalAnalytes, medLanes, parseNumeric, slopePer30d, type LabPointInput, type MedInput,
} from '../../src/modules/record-timeline/record-analytics';

const t = (iso: string) => new Date(iso);
const item = (at: string, value: string, over: Partial<LabPointInput> = {}): LabPointInput => ({
  at: t(at), testName: 'HbA1c (당화혈색소)', testCode: null, loincCode: '4548-4', value, unit: '%', normalMin: 4, normalMax: 6, flag: null, ...over,
});

describe('검사 항목 시계열', () => {
  it('🔴 같은 LOINC 는 이름이 달라도 한 항목 · 코드 없으면 이름으로', () => {
    const a = buildLabAnalytes([
      item('2026-07-01T00:00:00Z', '7.05', { testName: 'HbA1c', flag: 'H' }),
      item('2026-08-01T00:00:00Z', '5.44', { testName: 'HbA1c (당화혈색소)' }),
      item('2026-08-01T00:00:00Z', '90', { loincCode: null, testName: 'Glucose (혈당)', unit: 'mg/dL', normalMin: 70, normalMax: 99 }),
      item('2026-08-02T00:00:00Z', '254', { loincCode: null, testName: ' glucose  (혈당) ', unit: 'mg/dL', normalMin: 70, normalMax: 99, flag: 'H' }),
    ], []);
    expect(a).toHaveLength(2);
    const hba1c = a.find((x) => x.key === 'loinc:4548-4')!;
    expect(hba1c).toMatchObject({ n: 2, first: { value: 7.05 }, last: { value: 5.44 }, rangeMove: 'ENTERED', name: 'HbA1c (당화혈색소)' });
    expect(hba1c.delta).toBeCloseTo(-1.61, 5);
    expect(hba1c.inRange).toEqual({ numerator: 1, denominator: 2 });
    expect(a.find((x) => x.key.startsWith('name:'))!).toMatchObject({ n: 2, rangeMove: 'LEFT' });
  });

  it('🔴 보고값 원값 그대로(재반올림 없음) · 파생값만 정책 반올림', () => {
    const [a] = buildLabAnalytes([item('2026-07-01T00:00:00Z', '1.2345'), item('2026-07-02T00:00:00Z', '2.3456')], []);
    expect(a.series.map((p) => p.value)).toEqual([1.2345, 2.3456]);
    expect(a.delta).toBe(1.11); // 1.1111 → 3 유효숫자
  });

  it('🔴 `<5`·문자 결과·다른 단위는 계산에서 빼고 수를 밝힌다(값을 지어내지 않는다)', () => {
    const [a] = buildLabAnalytes([
      item('2026-07-01T00:00:00Z', '<5'),
      item('2026-07-02T00:00:00Z', 'negative'),
      item('2026-07-03T00:00:00Z', '6.1'),
      item('2026-07-04T00:00:00Z', '6.3'),
      item('2026-07-05T00:00:00Z', '43', { unit: 'mmol/mol' }),
    ], []);
    expect(a.n).toBe(2);
    expect(a.unit).toBe('%');
    expect(a.excluded).toEqual({ nonNumeric: 2, otherUnit: 1 });
    expect(parseNumeric('1,234')).toBe(1234);
    expect(parseNumeric('>1000')).toBeNull();
  });

  it('범위가 없으면 플래그로 · 둘 다 없으면 판정하지 않는다(분모에서 빠짐)', () => {
    const [a] = buildLabAnalytes([
      item('2026-07-01T00:00:00Z', '10', { normalMin: null, normalMax: null, flag: 'H' }),
      item('2026-07-02T00:00:00Z', '11', { normalMin: null, normalMax: null, flag: null }),
    ], []);
    expect(a.inRange).toEqual({ numerator: 0, denominator: 1 });
    expect(a.rangeMove).toBeNull();
    expect(a.range.source).toBeNull();
  });

  it('기울기 — 3점 이상·하루 이상일 때만 · 30일당', () => {
    expect(slopePer30d([{ t: 0, v: 1 }, { t: 86_400_000, v: 2 }])).toBeNull();
    expect(slopePer30d([{ t: 0, v: 0 }, { t: 15 * 86_400_000, v: 5 }, { t: 30 * 86_400_000, v: 10 }])).toBeCloseTo(10, 6);
  });

  it('🔴 처방 시작 전·후 평균 — 양쪽 2점 이상일 때만 · 취소 처방 제외', () => {
    const med = (over: Partial<MedInput> = {}): MedInput => ({ id: 'm1', name: '메트포르민', status: 'ACTIVE', createdAt: t('2026-07-15T00:00:00Z'), duration: 90, discontinuedAt: null, ...over });
    const pts = [
      item('2026-07-01T00:00:00Z', '8'), item('2026-07-10T00:00:00Z', '7.8'),
      item('2026-08-01T00:00:00Z', '7'), item('2026-09-01T00:00:00Z', '6.6'),
    ];
    const [a] = buildLabAnalytes(pts, [med(), med({ id: 'cx', status: 'CANCELLED' })]);
    expect(a.medEffects).toEqual([{ medId: 'm1', name: '메트포르민', start: '2026-07-15T00:00:00.000Z', meanBefore: 7.9, nBefore: 2, meanAfter: 6.8, nAfter: 2 }]);
    const [b] = buildLabAnalytes(pts.slice(1), [med()]);
    expect(b.medEffects).toEqual([]); // 전 1점 — 비교하지 않는다
  });
});

describe('활력 · 처방 레인 · 요약', () => {
  it('활력 범위는 판정 정본 · 측정 없는 항목은 만들지 않는다', () => {
    const a = buildVitalAnalytes([
      { at: t('2026-07-01T00:00:00Z'), source: 'PRE_VISIT', systolicBp: 150, diastolicBp: 90, heartRate: null, temperature: null, spo2: null, respiratoryRate: null },
      { at: t('2026-07-02T00:00:00Z'), source: 'FLOWSHEET', systolicBp: 120, diastolicBp: 80, heartRate: null, temperature: null, spo2: null, respiratoryRate: null },
    ], VITALS_THRESHOLDS, []);
    expect(a.map((x) => x.key)).toEqual(['vital:systolicBp', 'vital:diastolicBp']);
    expect(a[0]).toMatchObject({ rangeMove: 'ENTERED', range: { source: 'VITALS_CANON', low: 90, high: 140 } });
  });
  it('처방 레인 — 중단은 중단 시각 · 기간 모르면 끝 모름', () => {
    const now = t('2026-10-01T00:00:00Z');
    const lanes = medLanes([
      { id: 'a', name: 'A', status: 'DISCONTINUED', createdAt: t('2026-09-01T00:00:00Z'), duration: 30, discontinuedAt: t('2026-09-10T00:00:00Z') },
      { id: 'b', name: 'B', status: 'ACTIVE', createdAt: t('2026-09-01T00:00:00Z'), duration: null, discontinuedAt: null },
    ], now);
    expect(lanes[0]).toMatchObject({ end: '2026-09-10T00:00:00.000Z', endKnown: true, ongoing: false });
    expect(lanes[1]).toMatchObject({ end: null, endKnown: false });
  });
  it('요약 — 최근값 범위 밖 수·위급 점·변화율 큰 순(크기만) · 범위 밖 항목이 먼저', () => {
    const r = buildRecordAnalytics({
      labs: [
        item('2026-07-01T00:00:00Z', '5'), item('2026-08-01T00:00:00Z', '5.5'),
        item('2026-07-01T00:00:00Z', '100', { loincCode: 'G', testName: 'Glucose', unit: 'mg/dL', normalMin: 70, normalMax: 99 }),
        item('2026-08-01T00:00:00Z', '646', { loincCode: 'G', testName: 'Glucose', unit: 'mg/dL', normalMin: 70, normalMax: 99, flag: 'HH' }),
      ],
      vitals: [], meds: [], thresholds: VITALS_THRESHOLDS, thresholdSource: 'DEFAULT',
      period: { from: t('2026-01-01T00:00:00Z'), to: t('2026-10-01T00:00:00Z') }, truncated: { labs: false, vitals: false, meds: false },
    });
    expect(r.analytes[0].name).toBe('Glucose');
    expect(r.summary).toMatchObject({ analytes: 2, latestOutOfRange: 1, criticalPoints: 1 });
    expect(r.summary.largestChanges[0]).toMatchObject({ name: 'Glucose', deltaPct: 546 });
  });
  it('🔴 같은 약은 레인 하나(반복·갱신은 기간 조각) · 취소는 레인에 없다', () => {
    const now = t('2026-10-01T00:00:00Z');
    const lanes = medLanes([
      { id: 'a1', name: '메트포르민', status: 'DISCONTINUED', createdAt: t('2026-07-01T00:00:00Z'), duration: 30, discontinuedAt: t('2026-07-31T00:00:00Z') },
      { id: 'a2', name: '메트포르민 ', status: 'ACTIVE', createdAt: t('2026-09-01T00:00:00Z'), duration: 60, discontinuedAt: null },
      { id: 'x', name: '취소약', status: 'CANCELLED', createdAt: t('2026-09-01T00:00:00Z'), duration: 7, discontinuedAt: null },
    ], now);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toMatchObject({ prescriptions: 2, ongoing: true, start: '2026-07-01T00:00:00.000Z' });
    expect(lanes[0].segments).toHaveLength(2);
  });
});

describe('처방 전·후 — 약마다 첫 시작만 · 항목당 상한', () => {
  it('🔴 같은 약의 반복 처방은 다시 "시작"으로 세지 않는다 · 5건 넘으면 나머지는 수로', () => {
    const pts = Array.from({ length: 24 }, (_, i) => item(`2026-0${1 + Math.floor(i / 3)}-${String(1 + (i % 3) * 9).padStart(2, '0')}T00:00:00Z`, String(5 + i * 0.1)));
    const med = (id: string, name: string, at: string): MedInput => ({ id, name, status: 'ACTIVE', createdAt: t(at), duration: 30, discontinuedAt: null });
    const [a] = buildLabAnalytes(pts, [
      med('r1', 'A', '2026-03-05T00:00:00Z'), med('r2', 'A', '2026-05-05T00:00:00Z'),
      med('b', 'B', '2026-03-06T00:00:00Z'), med('c', 'C', '2026-03-07T00:00:00Z'), med('d', 'D', '2026-03-08T00:00:00Z'),
      med('e', 'E', '2026-03-09T00:00:00Z'), med('f', 'F', '2026-03-10T00:00:00Z'), med('g', 'G', '2026-03-11T00:00:00Z'),
    ]);
    expect(a.medEffects.filter((e) => e.name === 'A')).toHaveLength(1);
    expect(a.medEffects[0].medId).toBe('r1');
    expect(a.medEffects).toHaveLength(5);
    expect(a.medEffectsMore).toBe(2);
  });
});
