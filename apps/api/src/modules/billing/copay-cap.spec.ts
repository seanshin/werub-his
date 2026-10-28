import { describe, it, expect } from 'vitest';
import { annualCapFor, copayCapState, applyCopayCap } from './copay-cap';

describe('본인부담상한제', () => {
  it('소득분위별 상한(1분위 80만·10분위 780만)', () => {
    expect(annualCapFor(1)).toBe(800_000);
    expect(annualCapFor(10)).toBe(7_800_000);
    expect(annualCapFor(99)).toBe(2_500_000); // 미정의→기본
  });
  it('YTD 상태(초과·잔여)', () => {
    const s = copayCapState(1, 900_000); // 상한 80만 초과
    expect(s.exceeds).toBe(true);
    expect(s.remaining).toBe(0);
    const s2 = copayCapState(5, 1_000_000); // 상한 250만
    expect(s2.exceeds).toBe(false);
    expect(s2.remaining).toBe(1_500_000);
  });
  it('사전급여 캡 — 잔여 초과분을 본인부담에서 제외', () => {
    expect(applyCopayCap(100_000, 500_000)).toEqual({ patientCopay: 100_000, capExcess: 0 }); // 잔여 내
    expect(applyCopayCap(300_000, 100_000)).toEqual({ patientCopay: 100_000, capExcess: 200_000 }); // 초과분 사전급여
    expect(applyCopayCap(50_000, 0)).toEqual({ patientCopay: 0, capExcess: 50_000 }); // 상한 도달
    expect(applyCopayCap(0, 100_000)).toEqual({ patientCopay: 0, capExcess: 0 }); // 무본인부담
  });
});
