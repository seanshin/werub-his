import { describe, it, expect } from 'vitest';
import {
  isPathologyEdiCode,
  DEFAULT_PATHOLOGY_EDI_PREFIXES,
  PATHOLOGY_CATEGORY_CODING,
} from '../../src/modules/fhir/pathology-category.util';

describe('병리 EDI 코드 판정 (PAT category 라우팅)', () => {
  it('should match default pathology prefixes (침생검 C8511 등)', () => {
    expect(isPathologyEdiCode('C8511')).toBe(true);
    expect(isPathologyEdiCode('C8511A00')).toBe(true);
    expect(isPathologyEdiCode('C5501')).toBe(true);
    expect(isPathologyEdiCode('c8513b00')).toBe(true); // 대소문자 무관
  });

  it('should not match general lab codes', () => {
    expect(isPathologyEdiCode('E6502')).toBe(false); // CRP
    expect(isPathologyEdiCode('D2800060')).toBe(false); // 칼륨
    expect(isPathologyEdiCode(null)).toBe(false);
    expect(isPathologyEdiCode(undefined)).toBe(false);
    expect(isPathologyEdiCode('')).toBe(false);
  });

  it('should honor config override prefixes (병리과 확정 세트로 교체)', () => {
    expect(isPathologyEdiCode('C8511', ['C55'])).toBe(false); // 세트에서 제외되면 미판정
    expect(isPathologyEdiCode('X9001', ['X90'])).toBe(true);
    expect(isPathologyEdiCode('C8511', [])).toBe(true); // 빈 배열은 기본 세트 폴백
    expect(isPathologyEdiCode('C8511', null)).toBe(true);
  });

  it('계약 정본 값 — v2-0074 PAT (LIS 회신 문서와 정합)', () => {
    expect(PATHOLOGY_CATEGORY_CODING).toEqual({
      system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
      code: 'PAT',
      display: 'Pathology',
    });
    expect(DEFAULT_PATHOLOGY_EDI_PREFIXES).toContain('C85');
  });
});
