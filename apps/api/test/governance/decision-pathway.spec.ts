import { describe, it, expect, vi } from 'vitest';
import {
  DecisionPathwayService, PATHWAY_SEED, SLA_UNSET_REASON, SUMMARY_LIMIT,
} from '../../src/modules/gld/decision-pathway.service';

/**
 * 결정 경로 엔진 (2026-08-28 · 계획서 §3.4 · P2 · 가드 G7·G8).
 *
 * 🔴 CP 엔진과 1:1로 놓으니 결정 축에 10가지가 전부 없었다. 이 가드가 지키는 것:
 *   ① **막힌 이유가 남는다** — 이유 없는 "막힘"은 아무 정보도 아니다
 *   ② **버전 스냅샷** — 경로가 개정돼도 과거 인스턴스가 소급 해석되지 않는다
 *   ③ **출처 배타** — 위원회 의결과 허가권자 결정을 섞지 않는다
 *   ④ **게이트는 근거 없이 통과하지 못한다**(§ 층 규칙)
 *   ⑤ **기한을 지어내지 않는다** — 실운영 표본이 없다
 */
describe('경로 정의 — 기본 3종', () => {
  it('결정의 세 층에 대응한다', () => {
    expect(PATHWAY_SEED.map((p) => p.code).sort()).toEqual(['CODE_CHANGE', 'COMMITTEE', 'LICENSE']);
    expect(PATHWAY_SEED.find((p) => p.code === 'LICENSE')!.layer).toBe('LICENSE_HOLDER');
  });

  it('🔴 허가권자 경로에 법적검토 게이트가 있다 — "법적 검토 없이 결재"를 막는 자리', () => {
    const lic = PATHWAY_SEED.find((p) => p.code === 'LICENSE')!;
    const gate = lic.steps.find((s) => s.gate);
    expect(gate?.key).toBe('legal_review');
    expect(gate?.gateRule).toBe('legal_review_recorded');
    // 게이트가 결재보다 앞이어야 의미가 있다
    expect(lic.steps.findIndex((s) => s.key === 'legal_review'))
      .toBeLessThan(lic.steps.findIndex((s) => s.key === 'authorize'));
  });

  it('🔴 위원회 경로의 정족수 게이트가 의결보다 앞이다', () => {
    const c = PATHWAY_SEED.find((p) => p.code === 'COMMITTEE')!;
    expect(c.steps.findIndex((s) => s.key === 'quorum'))
      .toBeLessThan(c.steps.findIndex((s) => s.key === 'resolve'));
  });

  it('🔴 코드변경 경로는 배포로 끝나지 않는다 — 운영 검증이 게이트다', () => {
    const cc = PATHWAY_SEED.find((p) => p.code === 'CODE_CHANGE')!;
    const last = cc.steps[cc.steps.length - 1];
    expect(last.key).toBe('operate_verify');
    expect(last.gate).toBe(true);
  });

  it('🔴 기한을 지어내지 않는다 — 어느 단계에도 slaDays 가 없다', () => {
    for (const p of PATHWAY_SEED) {
      for (const s of p.steps) expect(s).not.toHaveProperty('slaDays');
    }
    expect(SLA_UNSET_REASON).toContain('실운영 표본이 없다');
  });
});

/** 목은 정본의 실제 호출 모양을 쓴다 — `$transaction(배열)`·`findUnique(include)` */
function makeSvc(o: { pathway?: unknown; instance?: unknown } = {}) {
  const calls: { table: string; op: string; args: unknown }[] = [];
  const rec = (table: string, op: string) => (args: unknown) => { calls.push({ table, op, args }); return args; };
  const prisma = {
    decisionPathway: {
      findFirst: vi.fn().mockResolvedValue(o.pathway ?? null),
      create: vi.fn(async (a: unknown) => { calls.push({ table: 'pathway', op: 'create', args: a }); return { id: 'pw' }; }),
    },
    decisionPathwayInstance: {
      create: vi.fn(async (a: unknown) => { calls.push({ table: 'instance', op: 'create', args: a }); return { id: 'inst-1' }; }),
      findUnique: vi.fn().mockResolvedValue(o.instance ?? null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(rec('instance', 'update')),
    },
    decisionPathwayStepState: { update: vi.fn(rec('state', 'update')) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
  return { svc: new DecisionPathwayService(prisma as never), prisma, calls };
}

const PW = {
  id: 'pw', code: 'COMMITTEE', name: '위원회', version: 3, layer: 'INTERNAL_COMMITTEE',
  steps: [
    { key: 'submit', title: '상신', sortOrder: 0, ownerRoles: ['ADMIN'], gate: false, gateRule: null, slaDays: null },
    { key: 'quorum', title: '정족수', sortOrder: 1, ownerRoles: ['ADMIN'], gate: true, gateRule: 'quorum_met', slaDays: null },
    { key: 'resolve', title: '의결', sortOrder: 2, ownerRoles: ['ADMIN'], gate: false, gateRule: null, slaDays: null },
  ],
};

describe('🔴 P3 — 층별 요약은 층을 합치지 않는다', () => {
  const svcWith = (n: number, layer = 'INTERNAL_COMMITTEE') => {
    const inst = {
      id: 'i', pathwayVersion: 1, agendaId: 'a', registryKey: null,
      currentStepKey: 'quorum', status: 'ACTIVE', startedAt: new Date(Date.now() - 2 * 86400000),
      pathway: { ...PW, layer },
      states: [
        { stepKey: 'submit', status: 'DONE', actorId: null, actedAt: new Date(Date.now() - 2 * 86400000), blockedReason: null, note: null },
        { stepKey: 'quorum', status: 'IN_PROGRESS', actorId: null, actedAt: null, blockedReason: null, note: null },
        { stepKey: 'resolve', status: 'PENDING', actorId: null, actedAt: null, blockedReason: null, note: null },
      ],
    };
    const { svc, prisma } = makeSvc({ pathway: PW, instance: inst });
    prisma.decisionPathwayInstance.findMany.mockResolvedValue(
      Array.from({ length: n }, (_, k) => ({ id: `i${k}`, status: 'ACTIVE', pathway: { layer } })),
    );
    return svc;
  };

  it('🔴 층을 합친 단일 진행률을 내지 않는다 — 세 층은 별개다', async () => {
    const out = await svcWith(2).summaryByLayer();
    // 합쳐진 퍼센트/총계 필드가 있으면 "위원회가 다 의결했으니 90%" 같은 거짓 안심이 생긴다
    expect(out).not.toHaveProperty('overall');
    expect(out).not.toHaveProperty('percent');
    expect(out).not.toHaveProperty('total');
    expect(Array.isArray(out.layers)).toBe(true);
  });

  it('🔴 표본이 없으면 체류일이 0 이 아니라 null 이다', async () => {
    const { svc, prisma } = makeSvc({ pathway: PW, instance: {
      id: 'i', pathwayVersion: 1, agendaId: 'a', registryKey: null,
      currentStepKey: null, status: 'DONE', startedAt: new Date(), pathway: PW,
      states: PW.steps.map((st) => ({ stepKey: st.key, status: 'DONE', actorId: null, actedAt: new Date(), blockedReason: null, note: null })),
    } });
    prisma.decisionPathwayInstance.findMany.mockResolvedValue([{ id: 'i', status: 'DONE', pathway: { layer: 'INTERNAL_COMMITTEE' } }]);
    const out = await svc.summaryByLayer();
    expect(out.layers[0].stayDaysMax).toBeNull();
    expect(out.layers[0].stayDaysMedian).toBeNull();
    expect(out.layers[0].done).toBe(1);
  });

  it('🔴 상한에 걸리면 잘렸다고 말한다', async () => {
    const under = await svcWith(3).summaryByLayer();
    expect(under.truncated).toBe(false);
    const over = await svcWith(SUMMARY_LIMIT + 1).summaryByLayer();
    expect(over.truncated, '잘라놓고 전수인 척하지 않는다').toBe(true);
    expect(over.layers[0].total).toBe(SUMMARY_LIMIT);
  });

  it('🔴 인스턴스가 없는 층도 카드가 남는다 — 0건을 감추면 "그런 층이 없다"로 읽힌다', async () => {
    const out = await svcWith(1, 'INTERNAL_COMMITTEE').summaryByLayer();
    const seedLayers = [...new Set(PATHWAY_SEED.map((p) => p.layer))].sort();
    expect(out.layers.map((l) => l.layer)).toEqual(seedLayers);
    const empty = out.layers.find((l) => l.layer !== 'INTERNAL_COMMITTEE');
    if (empty) { expect(empty.total).toBe(0); expect(empty.stayDaysMedian).toBeNull(); }
  });

  it('기준이 없다는 사실을 응답이 들고 다닌다', async () => {
    const out = await svcWith(1).summaryByLayer();
    expect(out.slaNote).toBe(SLA_UNSET_REASON);
  });
});

describe('🔴 P3 — 기준 없이 "지연"을 세지 않는다', () => {
  it('체류일은 사실이고, 지연은 판정이다 — 판정에 필요한 기준이 없다', () => {
    // SLA 가 어디에도 없으므로 "초과"를 셀 수 없다. 대신 체류일이라는 사실만 낸다.
    expect(SLA_UNSET_REASON).toContain('감으로 정하지 않는다');
  });

  it('🔴 취소된 인스턴스는 체류일이 null 이다 — 머무는 중이 아니다', async () => {
    // 🔴 픽스처가 상태 분기를 실제로 겨누게 한다. `currentStepKey` 를 비우면
    //    `!cur` 가 대신 통과시켜 상태 검사가 일하는지 알 수 없다(그렇게 한 번 헛돌았다).
    //    취소 경로는 아직 없지만 상태는 선언돼 있다 — 생겼을 때 체류일을 세지 않도록 막아둔다.
    const cancelled = {
      id: 'i', pathwayVersion: 1, agendaId: 'a', registryKey: null,
      currentStepKey: 'quorum', status: 'CANCELLED', startedAt: new Date(Date.now() - 5 * 86400000),
      pathway: PW,
      states: [
        { stepKey: 'submit', status: 'DONE', actorId: null, actedAt: new Date(Date.now() - 4 * 86400000), blockedReason: null, note: null },
        { stepKey: 'quorum', status: 'IN_PROGRESS', actorId: null, actedAt: null, blockedReason: null, note: null },
        { stepKey: 'resolve', status: 'PENDING', actorId: null, actedAt: null, blockedReason: null, note: null },
      ],
    };
    const { svc } = makeSvc({ pathway: PW, instance: cancelled });
    const v = await svc.view('i');
    expect(v.currentStepDays).toBeNull();
  });

  it('막힌 인스턴스는 체류일을 센다 — 막혀 있어도 머무는 중이다', async () => {
    const blocked = {
      id: 'i', pathwayVersion: 1, agendaId: 'a', registryKey: null,
      currentStepKey: 'quorum', status: 'BLOCKED', startedAt: new Date(Date.now() - 5 * 86400000),
      pathway: PW,
      states: [
        { stepKey: 'submit', status: 'DONE', actorId: null, actedAt: new Date(Date.now() - 2 * 86400000), blockedReason: null, note: null },
        { stepKey: 'quorum', status: 'BLOCKED', actorId: null, actedAt: null, blockedReason: '정족수 미달', note: null },
        { stepKey: 'resolve', status: 'PENDING', actorId: null, actedAt: null, blockedReason: null, note: null },
      ],
    };
    const { svc } = makeSvc({ pathway: PW, instance: blocked });
    const v = await svc.view('i');
    expect(v.currentStepDays).toBe(2);
  });

  it('진행 중이면 직전 완료 시점부터 센다', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
    const inst = {
      id: 'i', pathwayVersion: 1, agendaId: 'a', registryKey: null,
      currentStepKey: 'quorum', status: 'ACTIVE', startedAt: new Date(Date.now() - 9 * 86400000),
      pathway: PW,
      states: [
        { stepKey: 'submit', status: 'DONE', actorId: null, actedAt: threeDaysAgo, blockedReason: null, note: null },
        { stepKey: 'quorum', status: 'IN_PROGRESS', actorId: null, actedAt: null, blockedReason: null, note: null },
        { stepKey: 'resolve', status: 'PENDING', actorId: null, actedAt: null, blockedReason: null, note: null },
      ],
    };
    const { svc } = makeSvc({ pathway: PW, instance: inst });
    const v = await svc.view('i');
    // 인스턴스 시작(9일 전)이 아니라 직전 단계 완료(3일 전) 기준이어야 한다
    expect(v.currentStepDays).toBe(3);
  });
});

describe('🔴 출처는 배타다 — 위원회와 허가권자를 섞지 않는다', () => {
  it('둘 다 주면 거부', async () => {
    const { svc } = makeSvc({ pathway: PW });
    await expect(svc.start({ code: 'COMMITTEE', agendaId: 'a', registryKey: 'k' }))
      .rejects.toThrowError(/정확히 하나|SOURCE_EXCLUSIVE/);
  });
  it('둘 다 없으면 거부', async () => {
    const { svc } = makeSvc({ pathway: PW });
    await expect(svc.start({ code: 'COMMITTEE' })).rejects.toThrowError(/정확히 하나|SOURCE_EXCLUSIVE/);
  });
});

describe('🔴 G8 — 인스턴스는 경로 버전을 스냅샷으로 든다', () => {
  it('시작 시 현재 버전을 박는다(경로 개정이 과거에 소급되지 않는다)', async () => {
    const { svc, calls } = makeSvc({
      pathway: PW,
      // 🔴 목은 정본의 실제 반환 모양을 쓴다 — 실제 행에는 `startedAt` 이 있다
      instance: { id: 'inst-1', pathwayVersion: 3, agendaId: 'a', registryKey: null, currentStepKey: 'submit', status: 'ACTIVE', startedAt: new Date(), pathway: PW, states: [] },
    });
    await svc.start({ code: 'COMMITTEE', agendaId: 'a' });
    const c = calls.find((x) => x.table === 'instance' && x.op === 'create')!;
    expect((c.args as { data: { pathwayVersion: number } }).data.pathwayVersion).toBe(3);
  });
});

describe('🔴 G7 + 막힌 이유 — 게이트는 근거 없이 통과하지 못한다', () => {
  const instAt = (stepKey: string) => ({
    id: 'inst-1', pathwayVersion: 3, agendaId: 'a', registryKey: null,
    currentStepKey: stepKey, status: 'ACTIVE', startedAt: new Date(), pathway: PW,
    states: PW.steps.map((s) => ({ stepKey: s.key, status: s.key === stepKey ? 'IN_PROGRESS' : 'PENDING', actorId: null, actedAt: null, blockedReason: null, note: null })),
  });

  it('🔴 근거 없이 게이트를 완료하면 막히고 **이유가 남는다**', async () => {
    const { svc, calls } = makeSvc({ pathway: PW, instance: instAt('quorum') });
    await svc.complete('inst-1', 'quorum', { actorId: 'u1' });
    const st = calls.find((x) => x.table === 'state')!.args as { data: { status: string; blockedReason: string } };
    expect(st.data.status).toBe('BLOCKED');
    expect(st.data.blockedReason).toContain('quorum_met');
    expect(st.data.blockedReason).toContain('통과 근거가 제시되지 않았습니다');
    // 인스턴스도 막힘으로
    const inst = calls.find((x) => x.table === 'instance' && x.op === 'update')!.args as { data: { status: string } };
    expect(inst.data.status).toBe('BLOCKED');
  });

  it('근거를 주면 통과하고 근거가 기록된다', async () => {
    const { svc, calls } = makeSvc({ pathway: PW, instance: instAt('quorum') });
    await svc.complete('inst-1', 'quorum', { gatePassed: true, gateEvidence: '참석 6명 ≥ 정족수 5' });
    const done = calls.filter((x) => x.table === 'state')[0].args as { data: { status: string; note: string } };
    expect(done.data.status).toBe('DONE');
    expect(done.data.note).toContain('참석 6명');
  });

  it('🔴 사유 없는 막힘은 거부한다 — 아무 정보도 아니다', async () => {
    const { svc } = makeSvc({ pathway: PW, instance: instAt('submit') });
    await expect(svc.block('inst-1', 'submit', '   ')).rejects.toThrowError(/막힌 이유|BLOCK_REASON_REQUIRED/);
  });

  it('마지막 단계를 끝내면 완료 시각이 찍힌다 — 그 전엔 안 찍는다', async () => {
    const { svc, calls } = makeSvc({ pathway: PW, instance: instAt('resolve') });
    await svc.complete('inst-1', 'resolve');
    const inst = calls.find((x) => x.table === 'instance' && x.op === 'update')!.args as { data: Record<string, unknown> };
    expect(inst.data.status).toBe('DONE');
    expect(inst.data.completedAt).toBeInstanceOf(Date);
  });
});
