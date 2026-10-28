import { describe, it, expect } from 'vitest';
import {
  DIAGNOSTIC_TEST_TYPES,
  DIAGNOSTIC_TEST_TYPE_CODES,
  DIAGNOSTIC_MEASUREMENT_FIELDS,
  DIAGNOSTIC_CONCLUSION_CODES,
  diagnosticMeasurementFields,
  diagnosticTestLabel,
  diagnosticTestTypeOf,
  isDiagnosticTestType,
  resolveDiagnosticStationTypes,
} from './diagnostic-test';

/**
 * 기초검사 정본 가드.
 *
 * 🔴 이 가드가 잡아야 하는 실제 결함(2026-08-26 실측):
 *    ① 운영 `workstation_configs.order_codes` 가 `ECG`·`EGD`·`PTA` 라 검사 종류
 *       (`EKG`·`ENDOSCOPY_UPPER`·`AUDIOMETRY`)와 **교집합이 0** → 자리 큐가 영원히 빈다.
 *       그때 조용히 전체로 폴백하면 심전도실이 채혈 오더를 보게 된다.
 *    ② 측정 항목에 예시값(placeholder)을 달면 그 임상값이 그대로 저장된다.
 */

describe('기초검사 검사 종류 정본', () => {
  it('코드가 중복되지 않는다', () => {
    expect(new Set(DIAGNOSTIC_TEST_TYPE_CODES).size).toBe(DIAGNOSTIC_TEST_TYPE_CODES.length);
  });

  it('모르는 코드는 지어내지 않는다(null) — 라벨은 코드를 그대로 보여준다', () => {
    expect(diagnosticTestTypeOf('NOPE')).toBeNull();
    expect(diagnosticTestTypeOf(undefined)).toBeNull();
    expect(diagnosticTestLabel('NOPE')).toBe('NOPE'); // 빈칸으로 감추지 않는다
    expect(diagnosticTestLabel(null)).toBe('-');
    expect(diagnosticTestLabel('EKG')).toBe('심전도');
  });

  it('결론 어휘는 3종 고정', () => {
    expect([...DIAGNOSTIC_CONCLUSION_CODES].sort()).toEqual(['ABNORMAL', 'BORDERLINE', 'NORMAL']);
  });
});

describe('측정 항목 정본', () => {
  const allFields = Object.entries(DIAGNOSTIC_MEASUREMENT_FIELDS);

  it('측정 항목이 정의된 종류는 모두 정본 어휘에 있다(고아 항목표 금지)', () => {
    for (const [type] of allFields) {
      expect(isDiagnosticTestType(type), `${type} 은 검사 종류 정본에 없다`).toBe(true);
    }
  });

  it('한 종류 안에서 항목 키가 중복되지 않는다(뒤 값이 앞 값을 덮어 기록이 사라진다)', () => {
    for (const [type, fields] of allFields) {
      const keys = fields.map((f) => f.key);
      expect(new Set(keys).size, `${type} 항목 키 중복`).toBe(keys.length);
    }
  });

  it('🔴 임상값을 예시로 제안하지 않는다 — 필드에 placeholder 가 없고 라벨에 예시 숫자가 없다', () => {
    for (const [type, fields] of allFields) {
      for (const f of fields) {
        expect(Object.keys(f), `${type}.${f.key} 에 placeholder 가 생겼다`).not.toContain('placeholder');
        expect(f.label, `${type}.${f.key} 라벨이 예시값을 제안한다`).not.toMatch(/예\s*[:：]/);
        // 라벨 안의 순수 숫자 예시(단위 표기 `25-75%`·`12-lead` 같은 항목명은 허용)
        expect(f.label, `${type}.${f.key} 라벨에 예시값이 있다`).not.toMatch(/\(\s*예/);
      }
    }
  });

  it('select 항목은 선택지를 갖고, number 항목은 상·하한이 뒤집히지 않는다', () => {
    for (const [type, fields] of allFields) {
      for (const f of fields) {
        if (f.kind === 'select') {
          expect(f.options && f.options.length > 0, `${type}.${f.key} select 인데 선택지가 없다`).toBe(true);
          expect(new Set(f.options).size, `${type}.${f.key} 선택지 중복`).toBe(f.options!.length);
        }
        if (f.kind === 'number' && f.min !== undefined && f.max !== undefined) {
          expect(f.min, `${type}.${f.key} min>max`).toBeLessThan(f.max);
        }
        if (f.kind !== 'select') {
          expect(f.options, `${type}.${f.key} 는 select 가 아닌데 선택지가 있다`).toBeUndefined();
        }
      }
    }
  });

  it('항목표가 없는 종류는 빈 배열 — "잴 것이 없다"가 아니라 "아직 안 정했다"는 뜻이다', () => {
    expect(diagnosticMeasurementFields('NOPE')).toEqual([]);
    expect(diagnosticMeasurementFields(null)).toEqual([]);
  });

  it('대조군 — 심전도는 실제로 항목을 갖는다(전부 빈 배열이면 위 검사들이 헛돈다)', () => {
    expect(diagnosticMeasurementFields('EKG').length).toBeGreaterThan(3);
    expect(diagnosticMeasurementFields('EKG').map((f) => f.key)).toContain('heartRate');
  });
});

describe('자리 설정 코드 해석', () => {
  it('🔴 운영 실측값(ECG·HOLTER·ABPM·TMT)은 절반만 살아남는다 — 미지 코드를 통과시키지 않는다', () => {
    const r = resolveDiagnosticStationTypes(['ECG', 'HOLTER', 'ABPM', 'TMT']);
    expect(r.usable).toEqual(['HOLTER', 'TMT']);
    expect(r.unknown).toEqual(['ECG', 'ABPM']); // ECG 는 정본 어휘가 아니다(EKG 다)
  });

  it('🔴 내시경실 실측값(EGD·COLONOSCOPY·ERCP·EUS·CAPSULE)은 하나도 잡지 못한다 — 전체 폴백이 아니라 빈 목록이어야 한다', () => {
    const r = resolveDiagnosticStationTypes(['EGD', 'COLONOSCOPY', 'ERCP', 'EUS', 'CAPSULE']);
    expect(r.usable).toEqual([]);
    expect(r.unknown.length).toBe(5);
  });

  it('배열이 아니거나 문자열이 아닌 값은 조용히 통과시키지 않는다', () => {
    expect(resolveDiagnosticStationTypes(null)).toEqual({ usable: [], unknown: [] });
    expect(resolveDiagnosticStationTypes('EKG')).toEqual({ usable: [], unknown: [] });
    expect(resolveDiagnosticStationTypes([1, 'EKG', null])).toEqual({ usable: ['EKG'], unknown: [] });
  });

  it('중복 설정은 한 번만 센다', () => {
    expect(resolveDiagnosticStationTypes(['EKG', 'EKG', 'PFT']).usable).toEqual(['EKG', 'PFT']);
  });

  it('대조군 — 올바로 설정된 자리는 그대로 살아난다(전부 버리는 구현이면 위 검사들이 헛돈다)', () => {
    const r = resolveDiagnosticStationTypes(['EKG', 'HOLTER', 'TMT', 'ECHO']);
    expect(r.usable).toEqual(['EKG', 'HOLTER', 'TMT', 'ECHO']);
    expect(r.unknown).toEqual([]);
  });

  it('정본 11종이 모두 usable 로 해석된다', () => {
    const r = resolveDiagnosticStationTypes([...DIAGNOSTIC_TEST_TYPE_CODES]);
    expect(r.usable.length).toBe(DIAGNOSTIC_TEST_TYPES.length);
    expect(r.unknown).toEqual([]);
  });
});
