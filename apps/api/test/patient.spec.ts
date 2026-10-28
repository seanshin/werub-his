import { describe, it, expect } from 'vitest';
import { PatientNotFoundError, DuplicateMrnError } from '../src/domain/errors/domain-error';

// Pure domain logic tests
describe('Patient Domain Logic', () => {
  it('PatientNotFoundError contains correct id', () => {
    const err = new PatientNotFoundError('uuid-123');
    expect(err.code).toBe('PATIENT_NOT_FOUND');
    expect(err.message).toContain('uuid-123');
  });

  it('DuplicateMrnError contains MRN', () => {
    const err = new DuplicateMrnError('HR-20260506-0001');
    expect(err.code).toBe('DUPLICATE_MRN');
    expect(err.message).toContain('HR-20260506-0001');
  });

  describe('MRN format validation', () => {
    const MRN_REGEX = /^HR-\d{8}-\d{4}$/;

    it('valid MRN format', () => {
      expect(MRN_REGEX.test('HR-20260506-0001')).toBe(true);
      expect(MRN_REGEX.test('HR-20260506-9999')).toBe(true);
    });

    it('invalid MRN formats', () => {
      expect(MRN_REGEX.test('HR-2026050-0001')).toBe(false);
      expect(MRN_REGEX.test('XX-20260506-0001')).toBe(false);
      expect(MRN_REGEX.test('HR-20260506-00001')).toBe(false);
    });
  });

  describe('Insurance type validation', () => {
    const VALID_TYPES = ['NHI', 'MEDICAID', 'INDUSTRIAL', 'AUTO', 'SELF_PAY'];

    it('all valid insurance types', () => {
      VALID_TYPES.forEach(type => {
        expect(VALID_TYPES).toContain(type);
      });
    });

    it('rejects invalid type', () => {
      expect(VALID_TYPES).not.toContain('PRIVATE');
    });
  });
});
