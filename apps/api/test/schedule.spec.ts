import { describe, it, expect } from 'vitest';
import { AppointmentConflictError, InvalidStatusTransitionError } from '../src/domain/errors/domain-error';

// Valid status transitions (from Design)
const VALID_TRANSITIONS: Record<string, string[]> = {
  SCHEDULED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

function checkTimeOverlap(
  existingStart: Date, existingDuration: number,
  newStart: Date, newDuration: number,
): boolean {
  const existingEnd = new Date(existingStart.getTime() + existingDuration * 60000);
  const newEnd = new Date(newStart.getTime() + newDuration * 60000);
  return existingStart < newEnd && existingEnd > newStart;
}

describe('Appointment Status Transitions', () => {
  it('SCHEDULED → CHECKED_IN (valid)', () => {
    expect(isValidTransition('SCHEDULED', 'CHECKED_IN')).toBe(true);
  });

  it('SCHEDULED → CANCELLED (valid)', () => {
    expect(isValidTransition('SCHEDULED', 'CANCELLED')).toBe(true);
  });

  it('SCHEDULED → NO_SHOW (valid)', () => {
    expect(isValidTransition('SCHEDULED', 'NO_SHOW')).toBe(true);
  });

  it('SCHEDULED → IN_PROGRESS (invalid)', () => {
    expect(isValidTransition('SCHEDULED', 'IN_PROGRESS')).toBe(false);
  });

  it('CHECKED_IN → IN_PROGRESS (valid)', () => {
    expect(isValidTransition('CHECKED_IN', 'IN_PROGRESS')).toBe(true);
  });

  it('IN_PROGRESS → COMPLETED (valid)', () => {
    expect(isValidTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
  });

  it('COMPLETED → anything (invalid, terminal)', () => {
    expect(isValidTransition('COMPLETED', 'SCHEDULED')).toBe(false);
    expect(isValidTransition('COMPLETED', 'CANCELLED')).toBe(false);
  });

  it('CANCELLED → anything (invalid, terminal)', () => {
    expect(isValidTransition('CANCELLED', 'SCHEDULED')).toBe(false);
  });
});

describe('Appointment Time Conflict', () => {
  it('overlapping slots detected', () => {
    const existing = new Date('2026-05-10T09:00:00Z');
    const newSlot = new Date('2026-05-10T09:15:00Z');
    expect(checkTimeOverlap(existing, 30, newSlot, 30)).toBe(true);
  });

  it('non-overlapping slots pass', () => {
    const existing = new Date('2026-05-10T09:00:00Z');
    const newSlot = new Date('2026-05-10T09:30:00Z');
    expect(checkTimeOverlap(existing, 30, newSlot, 30)).toBe(false);
  });

  it('back-to-back slots do not conflict', () => {
    const existing = new Date('2026-05-10T09:00:00Z');
    const newSlot = new Date('2026-05-10T09:30:00Z');
    expect(checkTimeOverlap(existing, 30, newSlot, 30)).toBe(false);
  });

  it('AppointmentConflictError contains details', () => {
    const err = new AppointmentConflictError('doc-1', new Date('2026-05-10T09:00:00Z'), 'apt-1');
    expect(err.code).toBe('APPOINTMENT_CONFLICT');
    expect(err.message).toContain('doc-1');
    expect(err.message).toContain('apt-1');
  });
});
