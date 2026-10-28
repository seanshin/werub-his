import { describe, it, expect } from 'vitest';
import { fhirQuantity, toUcumCode, ucumOf, UCUM_SYSTEM } from '../src/fhir-quantity';

/**
 * FHIR Quantity 정본 계약 (P4).
 * 🔴 핵심 = "UCUM 을 아는 경우에만 system/code 를 붙인다". 표시 단위를 UCUM 코드로 실어보내면
 *    외부(LIS·SMART·CDA)가 파싱 실패하거나 다른 단위로 읽는다 — 정확값으로 고정한다.
 */

describe('toUcumCode — 표시 단위 → UCUM', () => {
  it('🔴 표시형과 UCUM 이 다른 단위를 올바로 변환', () => {
    expect(toUcumCode('mmHg')).toBe('mm[Hg]');
    expect(toUcumCode('10^3/uL')).toBe('10*3/uL');
    expect(toUcumCode('IU/L')).toBe('[IU]/L');
    expect(toUcumCode('mEq/L')).toBe('meq/L');
    expect(toUcumCode('/HPF')).toBe('/[HPF]');
    expect(toUcumCode('sec')).toBe('s');
    expect(toUcumCode('bpm')).toBe('/min');
  });

  it('마이크로 기호 2종(μ·µ)과 제곱 기호를 정규화', () => {
    expect(toUcumCode('/μL')).toBe('/uL'); // Greek small mu (U+03BC)
    expect(toUcumCode('/µL')).toBe('/uL'); // micro sign (U+00B5)
    expect(toUcumCode('μIU/mL')).toBe('u[IU]/mL');
    expect(toUcumCode('kg/m²')).toBe('kg/m2');
  });

  it('섭씨 표기 3종을 Cel 로', () => {
    expect(toUcumCode('℃')).toBe('Cel');
    expect(toUcumCode('°C')).toBe('Cel');
    expect(toUcumCode('C')).toBe('Cel');
  });

  it('이미 UCUM 인 단위는 그대로', () => {
    expect(toUcumCode('mg/dL')).toBe('mg/dL');
    expect(toUcumCode('%')).toBe('%');
  });

  it('🔴 모르는 단위는 undefined — 추정 금지', () => {
    expect(toUcumCode('SICU')).toBeUndefined();
    expect(toUcumCode('박스(100매)')).toBeUndefined();
    expect(toUcumCode('개')).toBeUndefined();
    expect(toUcumCode('')).toBeUndefined();
    expect(toUcumCode(null)).toBeUndefined();
  });
});

describe('ucumOf — 도메인 정책의 UCUM', () => {
  it('레지스트리 정본에서 가져온다', () => {
    expect(ucumOf('temperature')).toBe('Cel');
    expect(ucumOf('systolicBp')).toBe('mm[Hg]');
    expect(ucumOf('bmi')).toBe('kg/m2');
  });

  it('UCUM 없는 도메인(금액 등)은 undefined', () => {
    expect(ucumOf('money')).toBeUndefined();
    expect(ucumOf('없는도메인')).toBeUndefined();
  });
});

describe('fhirQuantity — 정책 경유 조립', () => {
  it('도메인 지정 시 정책 반올림 + 표시단위 + UCUM', () => {
    expect(fhirQuantity(38.199999999999996, { policyKey: 'temperature' })).toEqual({
      value: 38.2, unit: '℃', system: UCUM_SYSTEM, code: 'Cel',
    });
    expect(fhirQuantity(96.4, { policyKey: 'heartRate' })).toEqual({
      value: 96, unit: 'bpm', system: UCUM_SYSTEM, code: '/min',
    });
  });

  it('🔴 외부 보고값(policyKey 없음)은 재반올림하지 않는다 — 보고값 변조 금지', () => {
    expect(fhirQuantity(12.3456, { unit: 'mg/dL' })).toEqual({
      value: 12.3456, unit: 'mg/dL', system: UCUM_SYSTEM, code: 'mg/dL',
    });
  });

  it('🔴 UCUM 을 모르면 표시 단위만 — system/code 미부착(허위 표기 금지)', () => {
    const q = fhirQuantity(3, { unit: 'SICU' });
    expect(q).toEqual({ value: 3, unit: 'SICU' });
    expect(q?.system).toBeUndefined();
    expect(q?.code).toBeUndefined();
  });

  it('문자열 수치는 파싱, 비수치는 undefined(호출부가 valueString 분기)', () => {
    expect(fhirQuantity('5.4', { unit: 'g/dL' })?.value).toBe(5.4);
    expect(fhirQuantity('음성', { unit: '' })).toBeUndefined();
    expect(fhirQuantity(null)).toBeUndefined();
    expect(fhirQuantity(undefined)).toBeUndefined();
    expect(fhirQuantity(NaN)).toBeUndefined();
  });

  it('🔴 Prisma Decimal 류(객체)를 흘리지 않는다 — 참조범위 조용한 유실 방지', () => {
    // Decimal 은 toString 으로 정확한 10진 표현을 준다(Number 직접 변환 불가 객체)
    const decimalLike = { toString: () => '13.5' };
    expect(fhirQuantity(decimalLike, { unit: 'g/dL' })).toEqual({
      value: 13.5, unit: 'g/dL', system: UCUM_SYSTEM, code: 'g/dL',
    });
  });

  it('🔴 빈 문자열이 0 으로 둔갑하지 않는다 (Number("")===0 함정)', () => {
    expect(fhirQuantity('', { unit: 'mg/dL' })).toBeUndefined();
    expect(fhirQuantity('   ', { unit: 'mg/dL' })).toBeUndefined();
  });

  it('불리언·일반 객체는 수치가 아니다', () => {
    expect(fhirQuantity(true, { unit: '%' })).toBeUndefined();
    expect(fhirQuantity({ a: 1 }, { unit: '%' })).toBeUndefined();
  });

  it('round:false 로 정책 반올림 해제 가능', () => {
    expect(fhirQuantity(38.16, { policyKey: 'temperature', round: false })?.value).toBe(38.16);
  });

  it('단위 없는 값은 value 만', () => {
    expect(fhirQuantity(7)).toEqual({ value: 7 });
  });
});
