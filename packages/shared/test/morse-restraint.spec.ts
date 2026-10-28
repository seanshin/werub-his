/** Morse 등급 정본·보호대 점검 간격 정규화(2026-10-26) — 경계·범위 밖 null · 간격 15~480 정수만 */
import { describe, it, expect } from 'vitest';
import { morseRiskLevel, normalizeRestraintCheckInterval, RESTRAINT_CHECK_INTERVAL_DEFAULT_MIN } from '../src/morse';
import { bradenRiskLevel } from '../src/braden';

describe('Morse·Braden 등급', () => {
  it('Morse 24/25·44/45 · 범위 밖 null', () => {
    expect([0, 24, 25, 44, 45, 125].map((s) => morseRiskLevel(s))).toEqual(['LOW', 'LOW', 'MODERATE', 'MODERATE', 'HIGH', 'HIGH']);
    expect(morseRiskLevel(126)).toBeNull();
    expect(morseRiskLevel(-1)).toBeNull();
  });
  it('Braden 12/13·14/15 — 3단계(15 이상 저위험)', () => {
    expect([6, 12, 13, 14, 15, 18, 19, 23].map((s) => bradenRiskLevel(s))).toEqual(['HIGH', 'HIGH', 'MODERATE', 'MODERATE', 'LOW', 'LOW', 'LOW', 'LOW']);
  });
});
describe('보호대 점검 간격', () => {
  it('15~480 정수만 · 나머지 null · 코드 기본값 120', () => {
    expect([15, 60, '90', 480].map(normalizeRestraintCheckInterval)).toEqual([15, 60, 90, 480]);
    for (const v of [14, 481, 30.5, '', null, '2시간']) expect(normalizeRestraintCheckInterval(v)).toBeNull();
    expect(RESTRAINT_CHECK_INTERVAL_DEFAULT_MIN).toBe(120);
  });
});
