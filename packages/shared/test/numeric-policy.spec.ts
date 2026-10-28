import { describe, it, expect } from 'vitest';
import { roundBy, formatNum, policyOf, NUMERIC_POLICIES } from '../src/numeric-policy';

/**
 * 수치 정책 정본 계약 (P0). 도메인별 반올림·정밀도·단위가 표준대로 나오는지 고정한다.
 * 값이 바뀌면 화면·저장·청구·FHIR 가 함께 어긋나므로 정확값으로 단언한다.
 */

describe('roundBy — 도메인 정책대로 반올림', () => {
  it('체온: 소수 1자리 반올림 (부동소수점 잔차 없음)', () => {
    expect(roundBy(38.199999999999996, 'temperature')).toBe(38.2);
    expect(roundBy(36.55, 'temperature')).toBe(36.6);
  });

  it('활력: 정수 반올림', () => {
    expect(roundBy(96.4, 'heartRate')).toBe(96);
    expect(roundBy(95.6, 'spo2')).toBe(96);
  });

  it('BMI: 소수 1자리', () => {
    expect(roundBy(24.567, 'bmi')).toBe(24.6);
  });

  it('🔴 재원일수: 올림 + 최소 1 (청구 산식) — floor 아님', () => {
    // mode: ceil. 2일 15시간 상당 = 2.6 → 3
    expect(roundBy(2.6, 'stayDays')).toBe(3);
    expect(roundBy(1, 'stayDays')).toBe(1);
  });

  it('🔴 본인부담: 원단위(10) 절사 — 12,347 → 12,340', () => {
    expect(roundBy(12347, 'copay')).toBe(12340);
    expect(roundBy(12340, 'copay')).toBe(12340);
  });

  it('🔴 검사수치: 3 유효숫자 (자릿수 아님)', () => {
    expect(roundBy(1250.7, 'labValue')).toBe(1250); // 4자리→3유효는 1250(0은 유효 아님)
    expect(roundBy(0.05123, 'labValue')).toBe(0.0512);
    expect(roundBy(12.345, 'labValue')).toBe(12.3);
  });

  it('은행가 반올림(round-half-to-even)', () => {
    // percent 를 bankers override 로 검증
    expect(roundBy(2.5, 'age', { mode: 'bankers', decimals: 0 })).toBe(2);
    expect(roundBy(3.5, 'age', { mode: 'bankers', decimals: 0 })).toBe(4);
  });

  it('null/무효 입력 → null (0 으로 뭉개지 않음)', () => {
    expect(roundBy(null, 'temperature')).toBeNull();
    expect(roundBy(undefined, 'temperature')).toBeNull();
    expect(roundBy(NaN, 'temperature')).toBeNull();
  });

  it('미등록 도메인 → 입력 그대로', () => {
    expect(roundBy(3.14159, 'unknownKey')).toBe(3.14159);
  });

  it('override 로 자릿수 변경 (관리 화면/config 반영 시뮬)', () => {
    // "체온 소수 2자리" 수용 기준
    expect(roundBy(38.199999999999996, 'temperature', { decimals: 2 })).toBe(38.2);
    expect(roundBy(36.555, 'temperature', { decimals: 2 })).toBe(36.56);
  });
});

describe('formatNum — 표시 문자열(단위·null 안전)', () => {
  it('체온 표시 — 단위 포함·소수1 고정', () => {
    expect(formatNum(38.199999999999996, 'temperature')).toBe('38.2℃');
    expect(formatNum(37, 'temperature')).toBe('37.0℃'); // trailing zero 유지
  });

  it('단위 제외 옵션', () => {
    expect(formatNum(96.4, 'heartRate', { unit: false })).toBe('96');
  });

  it('본인부담 — 절사 후 원 단위', () => {
    expect(formatNum(12347, 'copay')).toBe('12340원');
  });

  it('null → fallback', () => {
    expect(formatNum(null, 'temperature')).toBe('-');
    expect(formatNum(undefined, 'bmi', { fallback: '미측정' })).toBe('미측정');
  });

  it('override 로 소수 2자리 표시 (수용 기준)', () => {
    expect(formatNum(38.199999999999996, 'temperature', { override: { decimals: 2 } })).toBe('38.20℃');
  });
});

describe('정책 레지스트리 — 표준 정합', () => {
  it('체온은 FHIR/UCUM 정렬 (LOINC 8310-5·UCUM Cel)', () => {
    const p = policyOf('temperature')!;
    expect(p.loincCode).toBe('8310-5');
    expect(p.ucumUnit).toBe('Cel');
    expect(p.standard).toBe('FHIR/UCUM');
  });

  it('법정·안전 도메인은 잠금', () => {
    for (const k of ['money', 'copay', 'labValue', 'bsa', 'stayDays', 'age']) {
      expect(NUMERIC_POLICIES[k].locked).toBe(true);
    }
  });

  it('모든 정책은 label·mode 를 가진다(관리 화면 표시)', () => {
    for (const p of Object.values(NUMERIC_POLICIES)) {
      expect(p.label).toBeTruthy();
      expect(p.mode).toBeTruthy();
    }
  });
});
