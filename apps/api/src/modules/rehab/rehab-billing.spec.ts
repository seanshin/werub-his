import { describe, it, expect } from 'vitest';
import { therapyBillingCode } from './rehab-billing';

describe('재활 세션→청구코드 매핑', () => {
  it('치료유형별 EDI 수가', () => {
    expect(therapyBillingCode('ST')).toBe('MM241'); // 언어치료
    expect(therapyBillingCode('OT')).toBe('MM111'); // 작업치료
    expect(therapyBillingCode('PT')).toBe('MM301'); // 물리치료
    expect(therapyBillingCode('GAIT')).toBe('MM301');
    expect(therapyBillingCode('HEAT')).toBe('MM301');
  });
  it('미정의 유형 → 기본 MM301', () => {
    expect(therapyBillingCode('XYZ')).toBe('MM301');
  });
});
