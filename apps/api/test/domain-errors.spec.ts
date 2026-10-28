import { describe, it, expect } from 'vitest';
import {
  DomainError,
  PatientNotFoundError,
  DuplicateMrnError,
  AppointmentConflictError,
  InvalidStatusTransitionError,
} from '../src/domain/errors/domain-error';

describe('Domain Errors', () => {
  it('PatientNotFoundError', () => {
    const err = new PatientNotFoundError('abc-123');
    expect(err.code).toBe('PATIENT_NOT_FOUND');
    expect(err.message).toContain('abc-123');
    expect(err).toBeInstanceOf(DomainError);
  });

  it('DuplicateMrnError', () => {
    const err = new DuplicateMrnError('HR-20260506-0001');
    expect(err.code).toBe('DUPLICATE_MRN');
    expect(err.message).toContain('HR-20260506-0001');
  });

  it('AppointmentConflictError', () => {
    const err = new AppointmentConflictError('doc-1', new Date('2026-05-10T09:00:00Z'), 'apt-1');
    expect(err.code).toBe('APPOINTMENT_CONFLICT');
  });

  it('InvalidStatusTransitionError', () => {
    const err = new InvalidStatusTransitionError('COMPLETED', 'SCHEDULED');
    expect(err.code).toBe('INVALID_STATUS_TRANSITION');
    expect(err.message).toContain('COMPLETED');
    expect(err.message).toContain('SCHEDULED');
  });
});
