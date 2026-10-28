import { describe, it, expect } from 'vitest';
import { isAbnormalFlag, isCriticalFlag, isHighFlag, isLowFlag, toFhirInterpretation, fromFhirInterpretation } from '../src/lab-flags';

/**
 * 검사 flag 판정 정본 계약 — 🔴 위급값이 정상처럼 새는 것을 막는다.
 * 화면·경보·FHIR 전달이 이 판정을 공유하므로, 여기가 깨지면 위급값 사고로 이어진다.
 */

describe('isAbnormalFlag — 정상 아님', () => {
  it('N/NORMAL/빈값만 정상', () => {
    for (const f of ['N', 'NORMAL', '', null, undefined]) expect(isAbnormalFlag(f)).toBe(false);
  });
  it('H/L/HH/LL/A/C 는 이상', () => {
    for (const f of ['H', 'L', 'HH', 'LL', 'A', 'C', 'CRITICAL']) expect(isAbnormalFlag(f)).toBe(true);
  });
});

describe('isCriticalFlag — 위급(패닉값)', () => {
  it('🔴 HH/LL/AA/C/CRITICAL/PANIC 은 위급', () => {
    for (const f of ['HH', 'LL', 'AA', 'C', 'CC', 'CRITICAL', 'PANIC']) expect(isCriticalFlag(f)).toBe(true);
  });
  it('H/L/A/N 은 위급 아님(일반 이상 또는 정상)', () => {
    for (const f of ['H', 'L', 'A', 'N', null]) expect(isCriticalFlag(f)).toBe(false);
  });
});

describe('방향 판정', () => {
  it('isHighFlag: H·HH', () => { expect(isHighFlag('H')).toBe(true); expect(isHighFlag('HH')).toBe(true); expect(isHighFlag('L')).toBe(false); });
  it('isLowFlag: L·LL', () => { expect(isLowFlag('L')).toBe(true); expect(isLowFlag('LL')).toBe(true); expect(isLowFlag('H')).toBe(false); });
});

describe('toFhirInterpretation — HIS flag → FHIR 표준 코드', () => {
  it('🔴 위급은 표준 위급 코드로 전달(H/L 로 격하 금지)', () => {
    expect(toFhirInterpretation('HH')).toBe('HH');
    expect(toFhirInterpretation('LL')).toBe('LL');
  });
  it('일반 이상·정상', () => {
    expect(toFhirInterpretation('H')).toBe('H');
    expect(toFhirInterpretation('L')).toBe('L');
    expect(toFhirInterpretation('A')).toBe('A');
    expect(toFhirInterpretation('N')).toBe('N');
    expect(toFhirInterpretation(null)).toBe('N');
  });
  it('비표준 위급(C/CRITICAL) → AA(Critical abnormal)', () => {
    expect(toFhirInterpretation('C')).toBe('AA');
    expect(toFhirInterpretation('CRITICAL')).toBe('AA');
  });
});

describe('fromFhirInterpretation — LIS 수신 fallback(정성 위급)', () => {
  it('🔴 정성 위급 HH/LL/AA → HIS 위급 flag (놓치지 않음)', () => {
    expect(fromFhirInterpretation('HH')).toBe('HH');
    expect(fromFhirInterpretation('LL')).toBe('LL');
    expect(fromFhirInterpretation('AA')).toBe('AA');
    for (const f of ['HH', 'LL', 'AA']) expect(isCriticalFlag(fromFhirInterpretation(f))).toBe(true);
  });
  it('일반 이상·정상·소문자', () => {
    expect(fromFhirInterpretation('h')).toBe('H');
    expect(fromFhirInterpretation('L')).toBe('L');
    expect(fromFhirInterpretation('A')).toBe('A');
    expect(fromFhirInterpretation('N')).toBe('N');
  });
  it('알 수 없는/빈 코드 → null(미판정·오정상 금지)', () => {
    expect(fromFhirInterpretation(null)).toBeNull();
    expect(fromFhirInterpretation('XYZ')).toBeNull();
  });
});
