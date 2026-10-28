import { describe, it, expect } from 'vitest';
import { durGateDecision } from './dur-gate';

describe('DUR 강제 게이트 판정', () => {
  it('경고 없음 → PASS', () => {
    expect(durGateDecision({ hasWarnings: false, overridden: false, gateEnforced: true })).toBe('PASS');
  });
  it('이미 오버라이드 → PASS', () => {
    expect(durGateDecision({ hasWarnings: true, overridden: true, gateEnforced: true })).toBe('PASS');
  });
  it('경고+사유 → 오버라이드 기록', () => {
    expect(durGateDecision({ hasWarnings: true, overridden: false, overrideReason: '임상적 필요', gateEnforced: true })).toBe('RECORD_OVERRIDE');
  });
  it('경고+사유없음+게이트ON → 차단', () => {
    expect(durGateDecision({ hasWarnings: true, overridden: false, gateEnforced: true })).toBe('BLOCK');
  });
  it('경고+사유없음+게이트OFF → PASS(무중단)', () => {
    expect(durGateDecision({ hasWarnings: true, overridden: false, gateEnforced: false })).toBe('PASS');
  });
});
