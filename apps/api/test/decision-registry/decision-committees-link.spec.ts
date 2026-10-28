/**
 * 결정 ↔ 위원회 연결(2026-10-11 사용자 "위원회 결정사항들이 연결되어 있지 않나? 결정권한자를 위원회별로").
 *
 * 🔴 실측: 원내 위원회 층 180건의 결정권자는 자유 문장(170가지 표기·없는 위원회 다수)이었고,
 *    ① 안건을 아무 위원회에나 올릴 수 있었다 ② 의결해도 등록부에 기록되지 않았다(사람이 다시 입력)
 *    ③ 의결로 생긴 집행 액션(위원회 결정 소속)을 결정 화면이 읽지 못해 ⑥ 집행에 닿지 않았다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { GovernanceService } from '../../src/modules/gld/governance.service';
import { DecisionService } from '../../src/modules/decision-registry/decision.service';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';
import {
  COMMITTEE_AUTHORITIES, COMMITTEE_CODES, DECISION_COMMITTEE_ASSIGNMENT, CHOSEN_MODIFIED, decisionCommitteeOf,
  committeeAuthorityConfigKey, committeeAuthoritySeedRecord,
} from '@hospital-run/shared';

const GOV_SRC = readFileSync(join(__dirname, '../../src/modules/gld/governance.service.ts'), 'utf8');

describe('배정 — 등록부 대조', () => {
  it('🔴 원내 위원회 층 전 결정이 주관 위원회를 가진다 · 다른 층은 배정이 없다 · 유령 키 없음', () => {
    const ic = DECISION_REGISTRY.filter((d) => d.layer === 'INTERNAL_COMMITTEE').map((d) => d.key).sort();
    expect(Object.keys(DECISION_COMMITTEE_ASSIGNMENT).sort()).toEqual(ic);
  });
  it('위원회 코드는 9곳만 · 주관과 합동이 겹치지 않는다', () => {
    for (const [k, codes] of Object.entries(DECISION_COMMITTEE_ASSIGNMENT)) {
      for (const c of codes) expect(COMMITTEE_CODES, k).toContain(c);
      expect(new Set(codes).size, k).toBe(codes.length);
    }
  });
  it('🔴 결정권한자 표의 이름·정족수 = 거버넌스 시드(위원회를 지어내지 않는다 · 정족수가 둘이 아니다)', () => {
    const block = GOV_SRC.slice(GOV_SRC.indexOf('const COMMITTEE_SEED'), GOV_SRC.indexOf('];', GOV_SRC.indexOf('const COMMITTEE_SEED')));
    const seed = [...block.matchAll(/code: '(\w+)', name: '([^']+)', type: '\w+', quorum: (\d+)/g)].map((m) => [m[1], m[2], Number(m[3])]);
    expect(seed.map((s) => s[0]).sort()).toEqual([...COMMITTEE_CODES].sort());
    for (const [code, name, q] of seed) {
      const a = COMMITTEE_AUTHORITIES[code as keyof typeof COMMITTEE_AUTHORITIES];
      expect(a.name, String(code)).toBe(name);
      expect(a.quorum, String(code)).toBe(q);
      expect(a.votingRule).toContain(`${q}명`);
    }
  });
  it('🔴 표면 담당 시드가 있는 설정은 그 위원회가 주관 또는 합동이다(담당이 둘로 갈리지 않는다)', () => {
    const block = GOV_SRC.slice(GOV_SRC.indexOf('const SURFACE_SEED'), GOV_SRC.indexOf('];', GOV_SRC.indexOf('const SURFACE_SEED')));
    const surf = new Map([...block.matchAll(/surfaceKey: 'config:([^']+)', committee: '(\w+)'/g)].map((m) => [m[1], m[2]]));
    let checked = 0;
    for (const d of DECISION_REGISTRY.filter((x) => x.layer === 'INTERNAL_COMMITTEE')) {
      const keys = [d.configKey, ...d.options.map((o) => ((o.enact as { target?: { key?: string }; key?: string } | null | undefined)?.target?.key ?? (o.enact as { key?: string } | null | undefined)?.key))].filter(Boolean) as string[];
      for (const k of keys) {
        const c = surf.get(k);
        if (!c) continue;
        checked++;
        expect([...DECISION_COMMITTEE_ASSIGNMENT[d.key]], `${d.key} ↔ config:${k}`).toContain(c);
      }
    }
    expect(checked).toBeGreaterThan(5); // 하한 — 대상이 0이 되면 가드가 아니다
  });
});

const QPS_KEY = Object.entries(DECISION_COMMITTEE_ASSIGNMENT).find(([k, c]) => c[0] === 'QPS' && c.length === 1 && DECISION_REGISTRY.find((d) => d.key === k)!.approvalPath === 'COMMITTEE')![0];
const QPS_DEF = DECISION_REGISTRY.find((d) => d.key === QPS_KEY)!;
const LICENSE_KEY = DECISION_REGISTRY.find((d) => d.layer === 'LICENSE_HOLDER')!.key;

function gov(opts: { committeeCode?: string; configSetFails?: boolean; agendaOptions?: unknown; sourceKey?: string; events?: unknown } = {}) {
  const created: unknown[] = [];
  const tx = {
    $executeRaw: vi.fn(),
    committeeDecision: { count: vi.fn().mockResolvedValue(0), create: vi.fn(async () => ({ id: 'dec-1', decisionNo: 'GOV-2026-001', resolution: 'r', actions: [] })), update: vi.fn() },
    committeeAgenda: { update: vi.fn() },
  };
  const prisma = {
    committee: { findUnique: vi.fn(async () => ({ code: opts.committeeCode ?? 'QPS' })) },
    committeeAgenda: {
      create: vi.fn(async ({ data }: { data: unknown }) => { created.push(data); return data; }),
      findFirst: vi.fn(async () => null), // 같은 결정의 열린 안건 없음
      findUnique: vi.fn(async () => ({
        id: 'ag-1', committeeId: 'c-1', meetingId: 'm-1', status: 'SCHEDULED',
        sourceRef: { type: 'DECISION', key: opts.sourceKey ?? QPS_KEY },
        options: opts.agendaOptions ?? QPS_DEF.options,
        committee: { id: 'c-1', quorum: 1, code: 'QPS', name: '질향상·환자안전위원회' },
      })),
    },
    committeeMember: { findMany: vi.fn().mockResolvedValue([]) },
    committeeMeeting: { findUnique: vi.fn().mockResolvedValue({ attendees: ['u1'] }) },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const config = {
    get: vi.fn(async () => 'WARN'),
    set: vi.fn(async () => { if (opts.configSetFails) throw new Error('db down'); }),
  };
  const svc = new GovernanceService(prisma as never, { validateAction: vi.fn() } as never, undefined, config as never, undefined, undefined, opts.events as never);
  (svc as never as { sealDecision: unknown }).sealDecision = vi.fn(async () => undefined);
  return { svc, config, created, prisma };
}

describe('안건 상정 — 등록부가 정한 위원회에만', () => {
  it('🔴 배정 밖 위원회면 거부 · 사유에 주관·합동을 말한다', async () => {
    const { svc, created } = gov({ committeeCode: 'NUT' });
    await expect(svc.submitAgenda('u1', { committeeId: 'c-x', title: 't', sourceRef: { type: 'DECISION', key: QPS_KEY } }))
      .rejects.toMatchObject({ response: { code: 'DECISION_COMMITTEE_NOT_ASSIGNED' } });
    expect(created).toHaveLength(0);
  });
  it('🔴 허가권자 층 결정은 위원회 안건이 아니다', async () => {
    const { svc } = gov();
    await expect(svc.submitAgenda('u1', { committeeId: 'c-1', title: 't', sourceRef: { type: 'DECISION', key: LICENSE_KEY } }))
      .rejects.toMatchObject({ response: { code: 'DECISION_NOT_COMMITTEE_LAYER' } });
  });
  it('대조군 — 주관 위원회는 받는다 · 합동 위원회도 받는다 · 등록부 밖 안건은 검사하지 않는다', async () => {
    expect((await gov({ committeeCode: 'QPS' }).svc.submitAgenda('u1', { committeeId: 'c-1', title: 't', sourceRef: { type: 'DECISION', key: QPS_KEY } }))).toBeTruthy();
    const [jk, jc] = Object.entries(DECISION_COMMITTEE_ASSIGNMENT).find(([, c]) => c.length > 1)!;
    expect(await gov({ committeeCode: jc[1] }).svc.submitAgenda('u1', { committeeId: 'c-1', title: 't', sourceRef: { type: 'DECISION', key: jk } })).toBeTruthy();
    const g = gov({ committeeCode: 'NUT' });
    await g.svc.submitAgenda('u1', { committeeId: 'c-1', title: 't', sourceRef: { type: 'SAFETY_GATE', key: 'dur.enforce' } });
    expect(g.prisma.committee.findUnique).not.toHaveBeenCalled();
  });
});

describe('의결 → 등록부 기록(다시 입력하지 않는다)', () => {
  const opt = QPS_DEF.options[0];
  it('🔴 고른 선택지 · 의결 번호 · 위원회가 등록부 기록이 된다 · 기록자 계정 = 의결 입력자', async () => {
    const { svc, config } = gov();
    const r = await svc.resolveAgenda('ag-1', { resolution: 'x', chosenOption: { value: opt.value, snapshot: QPS_DEF.options as never } }, 'admin-1') as { registryRecord?: unknown };
    expect(config.set).toHaveBeenCalledTimes(1);
    const [key, rec, by] = config.set.mock.calls[0] as unknown as [string, Record<string, unknown>, string];
    expect(key).toBe(`decision.${QPS_KEY}`);
    expect(rec).toMatchObject({ choice: opt.value, legalReviewRef: 'GOV-2026-001', applied: false, committeeDecision: { id: 'dec-1', decisionNo: 'GOV-2026-001', committeeCode: 'QPS' } });
    expect(rec.authorityClaim).toBe('질향상·환자안전위원회(QPS)');
    expect(by).toBe('admin-1');
    expect(r.registryRecord).toMatchObject({ key: QPS_KEY, written: true });
    // 🔴 결정 엔진이 연결되지 않으면 이력이 안 남았다고 말한다(조용히 넘기지 않는다) — 연결된 경우는 decision-engine.spec
    expect((r.registryRecord as { engine?: { logged: boolean } }).engine?.logged).toBe(false);
  });
  it('🔴 결정 엔진 연결 — 의결 기록을 이전 기록과 함께 엔진으로 보내고 엔진 결과를 돌려준다', async () => {
    const emitAsync = vi.fn(async () => [{ logged: true, propagatedTo: ['x'] }]);
    const { svc } = gov({ events: { emitAsync } });
    const r = await svc.resolveAgenda('ag-1', { resolution: 'x', chosenOption: { value: opt.value, snapshot: QPS_DEF.options as never } }, 'admin-1') as { registryRecord?: { engine?: unknown } };
    expect(emitAsync).toHaveBeenCalledTimes(1);
    const [ev, payload] = emitAsync.mock.calls[0] as unknown as [string, { key: string; next: { choice: string }; actorUserId: string }];
    expect(ev).toBe('decision.committeeRecorded');
    expect(payload).toMatchObject({ key: QPS_KEY, next: { choice: opt.value }, actorUserId: 'admin-1' });
    expect(r.registryRecord?.engine).toEqual({ logged: true, propagatedTo: ['x'] });
  });
  it('🔴 원안 수정 의결은 등록부로 옮기지 않는다(선택지에 없는 것을 지어내지 않는다)', async () => {
    const { svc, config } = gov();
    const r = await svc.resolveAgenda('ag-1', { resolution: 'x', chosenOption: { value: CHOSEN_MODIFIED, snapshot: QPS_DEF.options as never, note: '수정' } }, 'admin-1') as { registryRecord?: { written: boolean } };
    expect(config.set).not.toHaveBeenCalled();
    expect(r.registryRecord?.written).toBe(false);
  });
  it('🔴 기록 실패가 의결을 되돌리지 않는다 — 응답이 실패를 말한다', async () => {
    const { svc } = gov({ configSetFails: true });
    const r = await svc.resolveAgenda('ag-1', { resolution: 'x', chosenOption: { value: opt.value, snapshot: QPS_DEF.options as never } }, 'admin-1') as { decisionNo?: string; registryRecord?: { written: boolean; reason?: string } };
    expect(r.decisionNo).toBe('GOV-2026-001');
    expect(r.registryRecord).toMatchObject({ written: false });
  });
});

describe('목록 — 위원회·의결 집행 배선', () => {
  function mk(records: Record<string, unknown>, committeeActions: unknown[], rosterFail = false) {
    const store = new Map(Object.entries(records));
    const config: any = { get: vi.fn(async (k: string) => store.get(k) ?? null), getMany: vi.fn(async (keys: string[]) => new Map(keys.map((k) => [k, store.get(k) ?? null]))), set: vi.fn() };
    const daFind = vi.fn(async (q: { where: { decisionId?: unknown } }) => (q.where.decisionId ? committeeActions : []));
    const prisma: any = {
      decisionAction: { findMany: daFind },
      committeeAgenda: { findMany: vi.fn(async () => []) },
      committee: { findMany: vi.fn(async () => { if (rosterFail) throw new Error('down'); return [{ code: 'QPS', members: [{ role: 'CHAIR', source: 'SEED' }, { role: 'MEMBER', source: 'MANUAL' }] }]; }) },
    };
    return { svc: new DecisionService(prisma, config, { enactRegistryDecision: vi.fn() } as never, { onRecorded: vi.fn(async () => ({ logged: true, propagatedTo: [] })), listSignals: vi.fn(async () => ({ lastReview: new Map(), counts: new Map(), devEvents: new Map() })) } as never, { log: vi.fn().mockResolvedValue(null) } as never), daFind };
  }
  const rec = { choice: QPS_DEF.options[0].value, legalReviewRef: 'GOV-2026-001', authorityClaim: '질향상·환자안전위원회(QPS)', decidedByUserId: 'a', decidedAt: '2026-10-11', applied: false, committeeDecision: { id: 'dec-1', decisionNo: 'GOV-2026-001', committeeCode: 'QPS', committeeName: '질향상·환자안전위원회' } };

  it('🔴 의결 기록의 집행 상태는 위원회 결정 소속 액션을 읽는다 → ⑥ 집행', async () => {
    const { svc } = mk({ [`decision.${QPS_KEY}`]: rec }, [{ decisionId: 'dec-1', kind: 'CONFIG_CHANGE', status: 'ENACTED', error: null, enactedAt: new Date(), target: {} }]);
    const it0 = (await svc.list()).items.find((i) => i.key === QPS_KEY)!;
    expect(it0.decided).toBe(true);
    expect(it0.enactment.state).toBe('ENACTED');
    expect(it0.stage.stage).toBe('ENACTED');
  });
  it('대조군 — 액션이 없으면 ⑤ 기록 · 이유는 "의결의 선택은 바꾸는 설정이 없다"(상신이 남았다고 말하지 않는다)', async () => {
    const it0 = (await mk({ [`decision.${QPS_KEY}`]: rec }, []).svc.list()).items.find((i) => i.key === QPS_KEY)!;
    expect(it0.stage.stage).toBe('RECORDED');
    expect(it0.enactment.detail).toContain('의결된 선택');
    expect(it0.enactment.detail).not.toContain('상신');
  });
  it('항목에 주관·합동 위원회 · 다른 층은 null · 위원회별 요약(명부 임명/시드 분리 · 실패는 null)', async () => {
    const r = await mk({}, []).svc.list();
    expect(r.items.find((i) => i.key === QPS_KEY)!.committee).toEqual(decisionCommitteeOf(QPS_KEY));
    expect(r.items.find((i) => i.key === LICENSE_KEY)!.committee).toBeNull();
    const qps = r.summary.byCommittee.find((c) => c.code === 'QPS')!;
    expect(qps.roster).toEqual({ active: 2, manual: 1, seed: 1, chairAppointed: false }); // 🔴 시드 위원장은 임명이 아니다
    expect(r.summary.byCommittee.reduce((n, c) => n + c.lead, 0)).toBe(Object.keys(DECISION_COMMITTEE_ASSIGNMENT).length);
    const failed = await mk({}, [], true).svc.list();
    expect(failed.summary.byCommittee.every((c) => c.roster === null)).toBe(true);
  });
});

describe('결정권한자 표 — 개발 시드 확정', () => {
  const SEED_SRC = readFileSync(join(__dirname, '../../prisma/seed.ts'), 'utf8');
  it('🔴 시드가 9곳 전부를 정의 그대로 DEV-SEED 로 · 없을 때만(update: {})', () => {
    const i = SEED_SRC.indexOf('for (let i = 0; i < COMMITTEE_CODES.length; i++)');
    expect(i).toBeGreaterThan(0);
    const block = SEED_SRC.slice(i, SEED_SRC.indexOf('// HolidayCalendar', i));
    expect(block).toContain('committeeAuthorityConfigKey(code)');
    expect(block).toContain('committeeAuthoritySeedRecord(code,');
    expect(block).toMatch(/update: \{\}/);
  });
  function mkA(cfg: Record<string, unknown>, authorityFail = false) {
    const config: any = {
      get: vi.fn(async () => null),
      getMany: vi.fn(async (keys: string[]) => {
        if (authorityFail && keys.some((k) => k.startsWith('governance.committeeAuthority.'))) throw new Error('down');
        return new Map(keys.map((k) => [k, cfg[k] ?? null]));
      }),
      set: vi.fn(),
    };
    const prisma: any = { decisionAction: { findMany: vi.fn(async () => []) }, committeeAgenda: { findMany: vi.fn(async () => []) }, committee: { findMany: vi.fn(async () => []) } };
    return new DecisionService(prisma, config, { enactRegistryDecision: vi.fn() } as never, { onRecorded: vi.fn(async () => ({ logged: true, propagatedTo: [] })), listSignals: vi.fn(async () => ({ lastReview: new Map(), counts: new Map(), devEvents: new Map() })) } as never, { log: vi.fn().mockResolvedValue(null) } as never);
  }
  it('목록 — 위원회별 기록 출처(시드·원내 채택·없음) · 🔴 조회 실패는 null(목록은 산다)', async () => {
    const seedQ = committeeAuthoritySeedRecord('QPS', '2026-10-11T00:00:00.000Z');
    const r = await mkA({
      [committeeAuthorityConfigKey('QPS')]: seedQ,
      [committeeAuthorityConfigKey('MRC')]: { ...committeeAuthoritySeedRecord('MRC', 'x'), basisRef: '의무기록위원회 규정 제3호', chair: '의무기록위원장' },
    }).list();
    const by = (c: string) => r.summary.byCommittee.find((x) => x.code === c)!;
    expect(by('QPS').authority).toMatchObject({ source: 'DEV_SEED', record: { chair: COMMITTEE_AUTHORITIES.QPS.chair } });
    expect(by('MRC').authority).toMatchObject({ source: 'RECORDED', record: { chair: '의무기록위원장' } });
    expect(by('DTC').authority).toEqual({ source: 'NONE', record: null });
    const failed = await mkA({}, true).list();
    expect(failed.items.length).toBe(DECISION_REGISTRY.length);
    expect(failed.summary.byCommittee.every((c) => c.authority === null)).toBe(true);
  });
});
