import { describe, it, expect } from 'vitest';
import { gateMode } from '../../src/common/gate-mode';

describe('gateMode — fail-closed 안전게이트 정규화', () => {
  it('명시적 OFF/WARN/BLOCK 정규화', () => {
    expect(gateMode('OFF')).toBe('OFF');
    expect(gateMode('WARN')).toBe('WARN');
    expect(gateMode('BLOCK')).toBe('BLOCK');
    expect(gateMode('off')).toBe('OFF');
    expect(gateMode(' warn ')).toBe('WARN');
  });

  it('[핵심] 공백 포함·오타 값은 fail-closed로 BLOCK', () => {
    expect(gateMode('BLOCK ')).toBe('BLOCK'); // 과거 fail-open 되던 값
    expect(gateMode('BLOCKED')).toBe('BLOCK');
    expect(gateMode('ON')).toBe('BLOCK');
    expect(gateMode('엉뚱값')).toBe('BLOCK');
    expect(gateMode('true')).toBe('BLOCK');
  });

  it('부재(null/undefined/빈문자열)는 fallback(기본 BLOCK)', () => {
    expect(gateMode(null)).toBe('BLOCK');
    expect(gateMode(undefined)).toBe('BLOCK');
    expect(gateMode('')).toBe('BLOCK');
    expect(gateMode('   ')).toBe('BLOCK');
  });

  it('부재 시 fallback 지정(간호=WARN·per-rule=OFF)', () => {
    expect(gateMode(null, 'WARN')).toBe('WARN');
    expect(gateMode(undefined, 'OFF')).toBe('OFF');
    // 부재 fallback이 OFF/WARN이어도, 존재하는 오타 값은 여전히 BLOCK(fail-closed)
    expect(gateMode('엉뚱', 'OFF')).toBe('BLOCK');
    expect(gateMode('BLOCK ', 'WARN')).toBe('BLOCK');
  });
});
