/**
 * 오더 위원회 기준 점검(2026-10-06).
 *  · 담당·결정은 거버넌스 정본(provenance) 그대로 — 3상태(DECIDED·NO_DECISION·NOT_GOVERNED) · 합동 담당은 두 위원회 모두에
 *  · 값은 설정 출처와 함께(default 를 의결처럼 말하지 않는다) · master 표면은 값 없음
 *  · 점검은 셀 수 있는 것만(분자·분모·해당 오더) — 주의 기준 미설정이면 UNSET · 셀 기록 없는 기준은 NO_CHECK
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { OrderGovernanceService } from '../../src/modules/order-governance/order-governance.service';

const o = (over: Record<string, unknown>) => ({
  id: Math.random().toString(36).slice(2), department: 'LAB', name: 'CBC', priority: 'ROUTINE', status: 'ORDERED', phase: 'WAITING',
  patient: { id: 'p1', name: '김하나', mrn: 'M1' }, sinceOrderedMin: 30, attention: null, critical: false, dur: null, ...over,
});
const tracking = (orders: unknown[], configured = false) => ({
  date: '2026-10-06', now: '2026-10-06T03:00:00.000Z', population: 'DAY_ISSUED_PLUS_ACTIVE', truncated: false, total: orders.length,
  attention: { configured, thresholds: configured ? { STAT: 30 } : null }, orders,
});
const prov = (state: string, owners: { code: string; name: string }[], chain: unknown[] = []) => ({ basisState: state, owners, chain });

function mk(t: unknown, provBy: Record<string, unknown> = {}, values: Record<string, unknown> = {}) {
  const trackingSvc: any = { getTracking: vi.fn(async () => t) };
  const governance: any = { provenance: vi.fn(async (k: string) => provBy[k] ?? prov('NOT_GOVERNED', [])) };
  const config: any = { getWithSource: vi.fn(async (k: string) => (k in values ? { value: values[k], source: 'db', registered: true } : { value: 'OFF', source: 'default', registered: true })) };
  return { svc: new OrderGovernanceService(trackingSvc, governance, config), governance, config };
}

describe('오더 위원회 기준 점검', () => {
  it('🔴 담당·결정은 provenance 그대로 — 위원회별 묶음 · 합동 담당은 둘 다 · 담당 미지정은 따로', async () => {
    const r = await mk(tracking([]), {
      'config:dur.enforce': prov('DECIDED', [{ code: 'DTC', name: '약사위원회' }], [{ source: 'COMMITTEE', registryKey: null, action: { status: 'ENACTED' }, decision: { decisionNo: 'GOV-2026-003', status: 'ENACTED', resolvedAt: '2026-08-01', resolution: 'LAB 만 WARN', committee: { code: 'DTC', name: '약사위원회' } } }]),
      'config:formulary.enforce': prov('NO_DECISION', [{ code: 'DTC', name: '약사위원회' }, { code: 'QPS', name: '질향상·환자안전위원회' }]),
    }).svc.getCheck('2026-10-06');
    const dtc = r.committees.find((c) => c.code === 'DTC')!;
    expect(dtc.standards.map((s) => s.surfaceKey).sort()).toEqual(['config:dur.enforce', 'config:formulary.enforce']);
    expect(r.committees.find((c) => c.code === 'QPS')!.standards.map((s) => s.surfaceKey)).toEqual(['config:formulary.enforce']);
    const dur = dtc.standards.find((s) => s.surfaceKey === 'config:dur.enforce')!;
    expect(dur.basis).toMatchObject({ state: 'DECIDED', latest: { decisionNo: 'GOV-2026-003', source: 'COMMITTEE' }, decisions: 1 });
    expect(r.unassigned.length).toBe(6);
    expect(r.summary).toMatchObject({ standards: 8, decided: 1, noDecision: 1, notGoverned: 6 });
  });

  it('🔴 값은 설정 출처와 함께(default 는 default) · master 표면은 값 없음(설정을 읽지 않는다)', async () => {
    const { svc, config } = mk(tracking([]), {}, { 'dur.enforce': 'BLOCK' });
    const r = await svc.getCheck();
    const all = [...r.unassigned];
    expect(all.find((s) => s.surfaceKey === 'config:dur.enforce')!.value).toEqual({ value: 'BLOCK', source: 'db' });
    expect(all.find((s) => s.surfaceKey === 'config:cdss.enforce')!.value).toEqual({ value: 'OFF', source: 'default' });
    expect(all.find((s) => s.surfaceKey === 'master:reference-range')!.value).toBeNull();
    expect(config.getWithSource).not.toHaveBeenCalledWith('reference-range');
  });

  it('🔴 점검 — 주의 기준 미설정이면 UNSET · 설정되면 처리 중 오더 중 초과(분자·분모·해당 오더)', async () => {
    const orders = [o({ attention: true, priority: 'STAT' }), o({ attention: false }), o({ phase: 'DONE', attention: null })];
    const unset = await mk(tracking(orders, false)).svc.getCheck();
    expect(unset.unassigned.find((s) => s.checkKind === 'ATTENTION')!.check).toEqual({ state: 'UNSET' });
    const set = await mk(tracking(orders, true)).svc.getCheck();
    const c = set.unassigned.find((s) => s.checkKind === 'ATTENTION')!.check as any;
    expect(c).toMatchObject({ state: 'CHECKED', numerator: 1, denominator: 2 });
    expect(c.offenders[0].priority).toBe('STAT');
  });

  it('🔴 DUR 무시 = 경고가 있었던 약제 오더 중 무시 · 위급 미확인 = 위급 검사 중 결과 미확인 · 셀 기록 없는 기준은 NO_CHECK', async () => {
    const orders = [
      o({ department: 'PHARMACY', dur: { warned: true, overridden: true } }), o({ department: 'PHARMACY', dur: { warned: true, overridden: false } }),
      o({ department: 'PHARMACY', dur: { warned: false, overridden: false } }),
      o({ critical: true, phase: 'RESULT_UNACK' }), o({ critical: true, phase: 'DONE' }), o({ critical: false, phase: 'RESULT_UNACK' }),
    ];
    const r = await mk(tracking(orders)).svc.getCheck();
    const by = (k: string) => r.unassigned.find((s) => s.checkKind === k)!.check as any;
    expect(by('DUR_OVERRIDE')).toMatchObject({ numerator: 1, denominator: 2 });
    expect(by('CRITICAL_UNACK')).toMatchObject({ numerator: 1, denominator: 2 });
    expect(r.unassigned.find((s) => s.surfaceKey === 'config:cdss.enforce')!.check).toEqual({ state: 'NO_CHECK' });
    expect(r.summary.withFindings).toBe(2);
  });

  it('조회 실패는 실패로 — provenance 가 던지면 빈 결과로 접지 않는다', async () => {
    const { svc, governance } = mk(tracking([]));
    governance.provenance.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.getCheck()).rejects.toThrow('db down');
  });
});
