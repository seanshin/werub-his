/**
 * 사람 결정 → 집행 → 기능 — 끝까지 먹는가(2026-10-09).
 *
 * 🔴 집행 엔진은 DEFAULTS 에 있는 키면 값을 그대로 저장한다. 선택지 값이 기능 코드가 알아듣는 값과 어긋나면
 *    **의결·집행은 "반영됨"인데 기능은 기본값으로 떨어진다**(이 저장소의 "안 먹는 다이얼"). 그래서 배치 10-D 의
 *    모든 집행 선택지를 ① 엔진 검증(validateAction) ② 그 설정을 읽는 실제 소비 코드에 통과시켜, 값마다 동작이 갈리는지 본다.
 */
import { describe, it, expect, vi } from 'vitest';
import { DECISION_BATCH_2026_10_D } from '../../src/modules/decision-registry/decision.registry.batch-2026-10-d';
import { GovernanceEnactmentService } from '../../src/modules/gld/governance-enactment.service';
import { DEFAULTS } from '../../src/modules/config/config-runtime.service';
import { IndicatorSupplierService } from '../../src/modules/quality/indicator-supplier.service';
import { QualityService } from '../../src/modules/quality/quality.service';
import { readQiPrecedence } from '../../src/modules/quality/measurement-read';
import { MonthCloseService } from '../../src/modules/quality-flow/month-close.service';
import { DeviceDaysService } from '../../src/modules/quality-flow/device-days.service';
import { AccreditationService } from '../../src/modules/quality-flow/accreditation.service';
import { QiFlowSettingsService } from '../../src/modules/quality-flow/qi-flow-settings.service';
import { PatientSafetyService } from '../../src/modules/patient-safety/patient-safety.service';
import { DiagnosisPoaService } from '../../src/modules/discharge-summary/diagnosis-poa.service';

type Opt = { value: string; enact: { kind: string; target: { key: string; newValue: unknown } } | null };
const OPTIONS: Array<{ decision: string; opt: Opt }> = DECISION_BATCH_2026_10_D.flatMap((d) => ((d.options ?? []) as unknown as Opt[]).map((opt) => ({ decision: d.key, opt })));
const ENACTED = OPTIONS.filter((x) => x.opt.enact);
const cfgOf = (key: string, v: unknown) => ({ get: vi.fn(async (k: string) => (k === key ? v : null)), getWithSource: vi.fn(async (k: string) => ({ value: k === key ? v : null, source: k === key ? 'db' : 'default', registered: true })) });
const SEP = { from: new Date(2026, 8, 1), to: new Date(2026, 9, 1) };

/** 그 설정 값으로 기능이 보이는 동작 — 값마다 다른 문자열이 나와야 한다 */
async function behaviour(key: string, v: unknown): Promise<string> {
  const cfg = cfgOf(key, v);
  switch (key) {
    case 'qi.autoMeasure.incidentDenominator':
      return String(await new IndicatorSupplierService({} as never, cfg as never).incidentDenominatorBasis());
    case 'qi.autoMeasure.enabled': {
      const svc = new MonthCloseService({} as never, {} as never, {} as never, {} as never, cfg as never);
      const spy = vi.spyOn(svc, 'closeMonth').mockResolvedValue({} as never);
      await svc.monthly();
      return spy.mock.calls.length ? 'RUNS' : 'SKIPS';
    }
    case 'qi.deviceDays.source': {
      const prisma = { haiCase: { count: vi.fn(async () => 0) }, deviceDayEntry: { findMany: vi.fn(async () => []) }, deviceLine: { findMany: vi.fn(async () => []) } };
      const r = await new IndicatorSupplierService(prisma as never, cfg as never).supply('CLABSI_RATE', SEP);
      const accepting = (await new DeviceDaysService({} as never, cfg as never).source()) === 'MANUAL';
      return `${r.available ? 'OK' : (r as { reason: string }).reason}|input:${accepting}`;
    }
    case 'qi.autoManual.precedence':
      return readQiPrecedence(cfg as never);
    case 'qi.indicator.directEdit': {
      const svc = new QualityService({} as never, cfg as never);
      try { await svc.guardDirectEdit({ fields: ['targetValue'], changeReason: '위원회 권고 반영' }); return 'ALLOWED'; } catch (e) { return (e as { response?: { code?: string } }).response?.code ?? 'ERR'; }
    }
    case 'safety.incident.anonymous': {
      const create = vi.fn(async (a: { data: unknown }) => ({ id: 'n', ...(a.data as object) }));
      const svc = new PatientSafetyService({ safetyIncident: { create } } as never, { emit: vi.fn() } as never, cfg as never);
      try { await svc.reportIncident({ reporterId: 'u1', type: 'FALL', severity: 'MINOR', description: 'x', occurredAt: '2026-09-10T00:00:00Z', anonymous: true }); return 'ANON_OK'; } catch { return 'ANON_REJECTED'; }
    }
    case 'safety.harmLevelScale': {
      const r = await new QiFlowSettingsService(cfg as never).read();
      return r.harmLevels ? r.harmLevels.join(',') : 'NONE';
    }
    case 'accreditation.framework':
      return (await new AccreditationService({} as never, cfg as never).frameworks()).allowed.join(',') || 'NONE';
    case 'safety.poa.required':
      return (await new DiagnosisPoaService({} as never, cfg as never).required()) ? 'REQUIRED' : 'OPTIONAL';
    default:
      return `UNTESTED:${key}`;
  }
}

describe('결정 배치 10-D — 의결 값이 기능까지 먹는다', () => {
  it('대조군 — 집행 선택지가 실제로 있다(0 이면 아래는 아무것도 보증하지 않는다)', () => {
    expect(ENACTED.length).toBeGreaterThanOrEqual(22);
  });

  it('🔴 모든 집행 선택지가 집행 엔진 검증을 통과한다(카탈로그 키 · 보호 키 아님)', () => {
    const engine = new GovernanceEnactmentService({} as never, { hasDefault: (k: string) => k in DEFAULTS } as never);
    for (const { decision, opt } of ENACTED) {
      expect(() => engine.validateAction(opt.enact!.kind, opt.enact!.target as never), `${decision}=${opt.value}`).not.toThrow();
    }
  });

  it('🔴 같은 설정을 바꾸는 선택지끼리는 기능 동작이 서로 다르고, 미설정(기본)과도 다르다 — 기본값으로 떨어지는 선택지가 없다', async () => {
    const byKey = new Map<string, Array<{ decision: string; value: string; newValue: unknown }>>();
    for (const { decision, opt } of ENACTED) {
      const k = opt.enact!.target.key;
      byKey.set(k, [...(byKey.get(k) ?? []), { decision, value: opt.value, newValue: opt.enact!.target.newValue }]);
    }
    const problems: string[] = [];
    for (const [key, opts] of byKey) {
      const seen = new Map<string, string>();
      for (const o of opts) {
        const b = await behaviour(key, o.newValue);
        if (b.startsWith('UNTESTED')) problems.push(`소비 코드 대조 없음: ${key}`);
        if (seen.has(b)) problems.push(`${key}: ${o.value} 와 ${seen.get(b)} 가 같은 동작(${b})`);
        seen.set(b, o.value);
      }
      // 미설정과 같은 동작인 선택지는 "현행 유지"여야만 한다(값을 바꾼다고 말하면서 기본값으로 떨어지면 거짓)
      const unset = await behaviour(key, null);
      const same = opts.filter((o) => seen.get(unset) === o.value);
      for (const o of same) if (!/ALLOW_WITH_REASON|BOTH|false/.test(String(o.newValue))) problems.push(`${key}: ${o.value} 가 미설정과 같은 동작(${unset})`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
