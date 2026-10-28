/**
 * 회복실 활력 경보 임계 설정화(2026-10-01) — `pacu.vitalAlertThresholds`.
 *  · 미설정 = 코드 기본값(DEFAULT) · 부분 덮어쓰기 · 미상 키·범위 밖·짝 역전은 버리고 밝힌다 · 조회 실패 = UNAVAILABLE(기본값으로 감시는 계속)
 *  · 소견 문구에 숫자를 박지 않는다(기준이 바뀌면 문구가 거짓이 된다)
 */
import { describe, it, expect, vi } from 'vitest';
import { PacuService, PACU_ALERT_DEFAULTS, normalizePacuAlertThresholds } from '../../src/modules/pacu/pacu.service';

const svc = (cfg: Record<string, unknown> | 'fail') =>
  new PacuService({} as never, undefined, undefined, {
    get: vi.fn(async (k: string) => { if (cfg === 'fail' && k === 'pacu.vitalAlertThresholds') throw new Error('db'); return cfg === 'fail' ? null : (k in cfg ? cfg[k] : null); }),
  } as never);
const flagsOf = (v: Record<string, unknown>, t = PACU_ALERT_DEFAULTS) =>
  (PacuService.prototype as unknown as { vitalFlags: (x: unknown, w: number, t: unknown) => string[] }).vitalFlags.call(null, v, 36, t);

describe('정규화', () => {
  it('부분 덮어쓰기 · 미상 키·범위 밖은 버린다', () => {
    const r = normalizePacuAlertThresholds({ spo2Low: 94, hrHigh: 110, sat: 90, rrHigh: 999 });
    expect(r.thresholds).toMatchObject({ spo2Low: 94, hrHigh: 110, rrHigh: PACU_ALERT_DEFAULTS.rrHigh });
    expect(r.applied.sort()).toEqual(['hrHigh', 'spo2Low']);
    expect(r.dropped.sort()).toEqual(['rrHigh', 'sat']);
  });
  it('🔴 짝 역전(hrLow ≥ hrHigh)이면 둘 다 기본값으로 되돌리고 버린 키로 밝힌다', () => {
    const r = normalizePacuAlertThresholds({ hrLow: 100, hrHigh: 90 });
    expect(r.thresholds).toMatchObject({ hrLow: PACU_ALERT_DEFAULTS.hrLow, hrHigh: PACU_ALERT_DEFAULTS.hrHigh });
    expect(r.dropped.sort()).toEqual(['hrHigh', 'hrLow']);
    expect(r.applied).toEqual([]);
  });
  it('문자열 숫자는 받지 않는다(JSON 숫자만)', () => {
    expect(normalizePacuAlertThresholds({ spo2Low: '94' }).dropped).toEqual(['spo2Low']);
  });
});

describe('설정 응답', () => {
  it('미설정 = DEFAULT · 코드 기본값', async () => {
    const s = await svc({}).getMonitoringSettings();
    expect(s).toMatchObject({ alertSource: 'DEFAULT', alertThresholds: PACU_ALERT_DEFAULTS, alertDroppedKeys: [] });
  });
  it('원내 값이 하나라도 적용되면 CONFIG', async () => {
    const s = await svc({ 'pacu.vitalAlertThresholds': { spo2Low: 94 } }).getMonitoringSettings();
    expect(s).toMatchObject({ alertSource: 'CONFIG', alertThresholds: { spo2Low: 94 } });
  });
  it('🔴 전부 버려졌으면 CONFIG 가 아니다 — DEFAULT + 버린 키', async () => {
    const s = await svc({ 'pacu.vitalAlertThresholds': { spO2Low: 94 } }).getMonitoringSettings();
    expect(s).toMatchObject({ alertSource: 'DEFAULT', alertDroppedKeys: ['spO2Low'] });
  });
  it('🔴 조회 실패는 UNAVAILABLE(미설정으로 번역하지 않는다) · 감시는 기본값으로 계속', async () => {
    const s = await svc('fail').getMonitoringSettings();
    expect(s).toMatchObject({ alertSource: 'UNAVAILABLE', alertThresholds: PACU_ALERT_DEFAULTS });
  });
});

describe('소견 판정', () => {
  it('🔴 설정한 임계로 판정한다(SpO2 93: 기본 정상 → 기준 94 면 저산소)', () => {
    expect(flagsOf({ spo2: 93 })).toEqual([]);
    expect(flagsOf({ spo2: 93 }, { ...PACU_ALERT_DEFAULTS, spo2Low: 94 })).toEqual(['저산소(SpO2 기준 미만)']);
  });
  it('소견 문구에 숫자를 박지 않는다 · 0 은 여전히 즉시 확인', () => {
    const f = flagsOf({ hr: 130, rr: 30, bp: '200/90', temp: 39, spo2: 0 });
    expect(f).toContain('빈맥(HR 기준 초과)');
    expect(f).toContain('SpO2 0 — 신호 없음(프로브·환자 즉시 확인)');
    expect(f.filter((x) => !x.includes(' 0 ')).join('|')).not.toMatch(/\d/);
  });
});
