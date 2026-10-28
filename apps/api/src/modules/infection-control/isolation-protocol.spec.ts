import { describe, it, expect } from 'vitest';
import { ISOLATION_PROTOCOL_DEFAULTS } from './isolation-protocol.defaults';

/** P0-a④ 격리 프로토콜 테이블화 — 기본값 6종 보존·구조 검증(이관 유실 방지) */
describe('격리 프로토콜 기본값', () => {
  it('6종 전부 존재(STANDARD~PROTECTIVE)', () => {
    const types = ISOLATION_PROTOCOL_DEFAULTS.map((d) => d.isolationType);
    expect(types.sort()).toEqual(['AIRBORNE', 'CONTACT', 'DROPLET', 'PROTECTIVE', 'STANDARD', 'STRICT']);
  });

  it('핵심 값 보존 — AIRBORNE 10일·N95·음압 / STRICT 14일·면회 금지', () => {
    const air = ISOLATION_PROTOCOL_DEFAULTS.find((d) => d.isolationType === 'AIRBORNE')!;
    expect(air.standardDurationDays).toBe(10);
    expect(air.requiredPPE.join()).toContain('N95');
    expect(air.environmentalMeasures.join()).toContain('Negative pressure');
    const strict = ISOLATION_PROTOCOL_DEFAULTS.find((d) => d.isolationType === 'STRICT')!;
    expect(strict.standardDurationDays).toBe(14);
    expect(strict.visitationPolicy).toBe('Prohibited');
  });

  it('전 항목 PPE·환경조치 비어있지 않음(테이블 이관 시 유실 검출)', () => {
    for (const d of ISOLATION_PROTOCOL_DEFAULTS) {
      expect(d.requiredPPE.length).toBeGreaterThan(0);
      expect(d.environmentalMeasures.length).toBeGreaterThan(0);
      expect(typeof d.staffEducationRequired).toBe('boolean');
    }
  });
});
