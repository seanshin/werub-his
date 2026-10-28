/**
 * 🔴 PACU — 측정된 0 을 버리지 않는다 (2026-08-20).
 *
 * 종전 `vitalFlags()` 는 `v.spo2 > 0`·`v.hr > 0`·`v.rr > 0` 조건 때문에 **0 을 통째로 버렸다.**
 * DTO 는 `@Min(0)`(pacu.dto.ts:40-42)으로 0 을 받고, 화면은 빈칸을 `undefined` 로 보낸다
 * (`pacu/page.tsx` `num()`) — 즉 서비스에 도착한 0 은 **실제 측정값**이다.
 * 회복실에서 HR 0 · RR 0 · SpO2 0 은 가장 놓치면 안 되는 값인데 **아무 경보도 뜨지 않았다.**
 *
 * 재주입: `typeof v.hr === 'number'` 에 `&& v.hr > 0` 을 다시 붙이면 이 파일이 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { PacuService } from '../../src/modules/pacu/pacu.service';

const flags = (v: Record<string, unknown>): string[] =>
  (PacuService.prototype as unknown as { vitalFlags: (x: unknown) => string[] }).vitalFlags.call(null, v);

describe('PACU 이상 활력 — 0 은 미측정이 아니라 측정값이다', () => {
  it('🔴 HR 0 은 경보한다 — 종전엔 아무 flag 도 없었다', () => {
    expect(flags({ hr: 0 }).join('|')).toContain('HR 0');
  });

  it('🔴 RR 0 은 경보한다', () => {
    expect(flags({ rr: 0 }).join('|')).toContain('RR 0');
  });

  it('🔴 SpO2 0 은 경보한다 — 다만 사인을 단정하지 않고 확인을 요구한다', () => {
    const f = flags({ spo2: 0 }).join('|');
    expect(f).toContain('SpO2 0');
    expect(f).toContain('확인');
    expect(f).not.toContain('사망'); // 프로브 이탈일 수 있다 — 진단하지 않는다
  });

  it('미측정(undefined)은 판정하지 않는다 — 0 과 구분한다', () => {
    expect(flags({})).toEqual([]);
    expect(flags({ hr: undefined, rr: undefined, spo2: undefined })).toEqual([]);
  });

  it('정상값은 경보하지 않는다(0 처리가 다른 판정을 깨지 않는다)', () => {
    expect(flags({ hr: 72, rr: 14, spo2: 98, temp: 36.6, bp: '120/80' })).toEqual([]);
  });

  it('기존 임계 판정은 그대로다 — PACU 는 정본보다 엄격하다(느슨해지지 않았는지 확인)', () => {
    expect(flags({ spo2: 91 }).join('|')).toContain('저산소'); // 정본(90)이면 정상, PACU(92)는 이상
    expect(flags({ hr: 125 }).join('|')).toContain('빈맥');    // 정본(130)이면 정상, PACU(120)는 이상
    expect(flags({ rr: 26 }).join('|')).toContain('빈호흡');   // 정본(30)이면 정상, PACU(24)는 이상
  });
});
