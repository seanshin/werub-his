import { describe, it, expect, vi } from 'vitest';
import { GovernanceService } from '../../src/modules/gld/governance.service';

/**
 * 표면 → 근거 역조회의 **3상태** (2026-08-27 · 계획서 §3.3).
 *
 * 🔴 이 EP 는 **이미 있었다** — 계획서 초안이 "신설"이라 쓴 것을 재검토에서 정정했다.
 *    없던 것은 **3번째 상태**다. 종전 응답은 체인이 비면 `chain: []` 뿐이라
 *    소비처가 "거버넌스 대상인데 아무도 정하지 않았다"와
 *    "애초에 결정 대상이 아니다"를 **구분할 수 없었다** — 화면은 둘 다 조용히 그린다.
 *
 * 🔴 `NO_DECISION` 은 결함이 아니다(개시 전 정상일 수 있다).
 *    다만 **"정해진 값"과 같은 얼굴을 하면 안 된다**.
 *
 * 재주입: `basisState` 를 지우거나 `map` 유무를 보지 않고 한 값으로 접으면 실패한다.
 */
function makeSvc(opts: { actions?: unknown[]; map?: unknown }) {
  const prisma = {
    decisionAction: {
      findMany: vi.fn().mockResolvedValue(opts.actions ?? []),
      findUnique: vi.fn().mockResolvedValue({ basis: { legal: ['의료법 §22'] } }),
    },
    // 🔴 목은 **정본의 실제 호출 모양**을 쓴다 — 담당이 복수(합동 의결)가 될 수 있어
    //    `findUnique` 가 아니라 `findMany` 다. 내가 가정한 모양으로 두면 가드가 헛돈다.
    committeeSurfaceMap: { findMany: vi.fn().mockResolvedValue(opts.map ? [opts.map] : []) },
    committee: { findMany: vi.fn().mockResolvedValue([{ id: 'c-1', code: 'QPS', name: '질향상·환자안전위원회' }]) },
    committeeDecision: { findUnique: vi.fn().mockResolvedValue({ chosenOption: { value: 'BLOCK', snapshot: [] } }) },
  };
  return new GovernanceService(prisma as never, undefined, undefined, undefined, undefined);
}

/** 🔴 목은 정본의 실제 반환 모양을 쓴다 — `surfaceKeyOf` 가 target 에서 키를 만든다 */
const ACTION = {
  id: 'act-1', kind: 'GATE_MODE', status: 'ENACTED', enactedAt: new Date(), registryKey: null,
  target: { gateKey: 'dur.enforce', mode: 'BLOCK' },
  decision: { id: 'dec-1', decisionNo: 'GOV-2026-012', status: 'ENACTED', resolvedAt: new Date(), resolution: 'x', supersedesId: null, committee: { code: 'QPS', name: 'QPS' } },
};

describe('provenance — 3상태를 구분해 말한다', () => {
  it('🔴 결정도 담당도 없다 → NOT_GOVERNED (결정 대상으로 등재된 적이 없다)', async () => {
    const r = await makeSvc({}).provenance('config:nope.key');
    expect(r.basisState).toBe('NOT_GOVERNED');
    expect(r.owner).toBeNull();
    expect(r.chain).toEqual([]);
  });

  it('🔴 담당은 있는데 결정이 없다 → NO_DECISION (지금 값은 코드 기본값이다)', async () => {
    const r = await makeSvc({ map: { surfaceKey: 'config:dur.enforce', committeeId: 'c-1' } })
      .provenance('config:dur.enforce');
    expect(r.basisState).toBe('NO_DECISION');
    // 🔴 담당이 있다는 것과 근거가 있다는 것은 다른 축이다
    expect(r.owner).toMatchObject({ code: 'QPS' });
    expect(r.chosenOption).toBeNull();
    expect(r.basis).toBeNull();
  });

  it('결정이 있으면 DECIDED — 고른 선택과 근거를 함께 낸다', async () => {
    const r = await makeSvc({ actions: [ACTION], map: { surfaceKey: 'config:dur.enforce', committeeId: 'c-1' } })
      .provenance('config:dur.enforce');
    expect(r.basisState).toBe('DECIDED');
    expect(r.chain).toHaveLength(1);
    expect(r.chosenOption).toMatchObject({ value: 'BLOCK' });
    expect(r.basis).toEqual({ legal: ['의료법 §22'] });
  });

  it('🔴 담당 위원회를 코드·이름으로 낸다 — 화면이 다시 조회하지 않게', async () => {
    const r = await makeSvc({ map: { surfaceKey: 'config:dur.enforce', committeeId: 'c-1' } })
      .provenance('config:dur.enforce');
    expect(r.owner).toEqual({ id: 'c-1', code: 'QPS', name: '질향상·환자안전위원회' });
    expect(r.owners).toHaveLength(1);
  });

  it('🔴 대조군 — 세 상태가 실제로 갈린다(한 값으로 접히지 않는다)', async () => {
    const a = await makeSvc({}).provenance('config:x');
    const b = await makeSvc({ map: { surfaceKey: 'config:x', committeeId: 'c-1' } }).provenance('config:x');
    const c = await makeSvc({ actions: [ACTION], map: { surfaceKey: 'config:dur.enforce', committeeId: 'c-1' } }).provenance('config:dur.enforce');
    expect(new Set([a.basisState, b.basisState, c.basisState]).size).toBe(3);
  });
});
