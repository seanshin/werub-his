/**
 * 결정 방식·설정 상세(2026-10-11 사용자 "설정, 위원회 기록, 자동 선택 가능 등의 구분이 더 디테일하고, 설정 내용도 더 디테일").
 * 🔴 실측 결함 2:
 *  · `nursing.lateEntry.graceMinutes` — 선택지가 설정 값을 들고 있는데 바인딩이 없어 **골라도 설정이 바뀌지 않았다**
 *  · 코드 변경 경로 결정(`pacu.dischargeCriteria`)을 안건으로 올리면 선택지 집행 대상이 `{key,newValue}` 모양이라 의결이 "모양 오류"로 거부됐다
 */
import { describe, it, expect, vi } from 'vitest';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';
import { mechanismOf, allowedRuleOf } from '../../src/modules/decision-registry/decision-engine';
import { DecisionService } from '../../src/modules/decision-registry/decision.service';
import { GovernanceService, normalizeRegistryEnact } from '../../src/modules/gld/governance.service';
import { DECISION_MECHANISMS } from '@hospital-run/shared';

const def = (k: string) => DECISION_REGISTRY.find((d) => d.key === k)!;

describe('결정 방식 — 등록부에서 파생', () => {
  it('🔴 반영 바인딩 없는 결정(UNBOUND) 0건 — 선택지가 설정 값을 들면 반영 경로가 있어야 한다', () => {
    expect(DECISION_REGISTRY.filter((d) => mechanismOf(d) === 'UNBOUND').map((d) => d.key)).toEqual([]);
  });
  it('🔴 종전 무동작 결정이 이제 기록하면 자동 반영', () => {
    expect(mechanismOf(def('nursing.lateEntry.graceMinutes'))).toBe('AUTO_APPLY');
  });
  it('경로별 대표 — 위원회+설정=의결 자동 반영 · 위원회만=의결 기록 · 확인=확인 기록 · 코드+설정=혼합 · 건별', () => {
    expect(mechanismOf(def('qi.docIssuance.slaHours'))).toBe('COMMITTEE_APPLY');
    expect(mechanismOf(def('policy.alertRouting'))).toBe('COMMITTEE_RECORD');
    expect(mechanismOf(def('legal.patientPush.consentScope'))).toBe('CONFIRM_ONLY');
    expect(mechanismOf(def('pacu.dischargeCriteria'))).toBe('MIXED');
    expect(DECISION_REGISTRY.filter((d) => mechanismOf(d) === 'PER_EVENT')).toHaveLength(1);
    // 어휘 밖 값이 없다
    for (const d of DECISION_REGISTRY) expect(DECISION_MECHANISMS).toContain(mechanismOf(d));
  });
  it('허용 값 규칙 — 결정 설정·QI 흐름 규칙 · 규칙 없는 키는 null', () => {
    expect(allowedRuleOf('governance.decisionConfigGuard')).toEqual(['OFF', 'WARN', 'BLOCK']);
    expect(allowedRuleOf('qi.docIssuance.slaHours')).toEqual({ int: [1, 720] });
    expect(allowedRuleOf('no.such.key')).toBeNull();
  });
});

describe('설정 상세', () => {
  const described = (m: Record<string, Partial<{ value: unknown; source: string; defaultValue: unknown; description: string; updatedBy: string; updatedAt: string }>>) =>
    new Map(Object.entries(m).map(([k, v]) => [k, { value: null, source: 'unset', registered: true, defaultValue: null, description: null, category: 'clinical', updatedAt: null, updatedBy: null, ...v }])) as never;
  it('🔴 선택지별 값 · 현재 값과 정확히 같은 선택지 · 결정 값 일치 · 출처 · 마지막 변경 계정 이름', () => {
    const d = def('nursing.lateEntry.graceMinutes');
    const [s] = DecisionService.settingDetailsOf(d, { choice: 'MIN_60' } as never, described({ 'nursing.lateEntry.graceMinutes': { value: 30, source: 'db', description: '늦은 기록 유예', updatedBy: 'u1', updatedAt: '2026-10-11T00:00:00.000Z' } }), new Map([['u1', '김간호']]));
    expect(s).toMatchObject({ key: 'nursing.lateEntry.graceMinutes', role: 'SETS', current: 30, source: 'db', description: '늦은 기록 유예', currentOption: 'MIN_30', decidedValue: 60, decidedSets: true, matchesDecision: false, updatedByName: '김간호' });
    expect(s.options.find((o) => o.value === 'UNSET')).toMatchObject({ sets: false, setValue: null });
    expect(s.options.find((o) => o.value === 'MIN_60')).toMatchObject({ sets: true, setValue: 60 });
  });
  it('대조군 — 미설정이면 같은 선택지 없음(근사하지 않는다) · 바꾸지 않는 선택이면 비교할 결정 값 없음(null)', () => {
    const d = def('nursing.lateEntry.graceMinutes');
    const [s] = DecisionService.settingDetailsOf(d, { choice: 'UNSET' } as never, described({ 'nursing.lateEntry.graceMinutes': { value: null } }), new Map());
    expect(s.currentOption).toBeNull();
    expect(s.matchesDecision).toBeNull();
    expect(s.decidedSets).toBe(false);
  });
  it('바꾸지 않지만 기대는 설정은 RELATED(선행 확인 결정)', () => {
    const [s] = DecisionService.settingDetailsOf(def('legal.voiceRecording.basis'), null, described({ 'voiceEmr.ambient.enabled': { value: false, source: 'default' } }), new Map());
    expect(s).toMatchObject({ key: 'voiceEmr.ambient.enabled', role: 'RELATED', source: 'default' });
  });
  it('🔴 목록 — 결정 방식·설정 상세 · 설정 조회 실패는 null(확인 불가) · 방식별 합 = 전체', async () => {
    const mk = (fail: boolean) => {
      const config: any = { get: vi.fn(async () => null), getMany: vi.fn(async (ks: string[]) => new Map(ks.map((k) => [k, null]))), set: vi.fn(),
        describeMany: vi.fn(async (ks: string[]) => { if (fail) throw new Error('down'); return new Map(ks.map((k) => [k, { value: null, source: 'unset', registered: false, defaultValue: null, description: null, category: null, updatedAt: null, updatedBy: null }])); }) };
      const prisma: any = { decisionAction: { findMany: vi.fn(async () => []) }, committeeAgenda: { findMany: vi.fn(async () => []) }, committee: { findMany: vi.fn(async () => []) } };
      return new DecisionService(prisma, config, {} as never, { listSignals: vi.fn(async () => ({ lastReview: new Map(), counts: new Map(), protectionMode: 'WARN', devEvents: new Map() })) } as never, { log: vi.fn() } as never);
    };
    const r = await mk(false).list();
    const g = r.items.find((i) => i.key === 'nursing.lateEntry.graceMinutes')!;
    expect(g.mechanism).toBe('AUTO_APPLY');
    expect(g.settings![0].key).toBe('nursing.lateEntry.graceMinutes');
    expect(r.items.find((i) => i.key === 'policy.alertRouting')!.settings).toEqual([]);
    expect(r.summary.byMechanism.reduce((n, x) => n + x.total, 0)).toBe(DECISION_REGISTRY.length);
    const f = await mk(true).list();
    expect(f.items.find((i) => i.key === 'nursing.lateEntry.graceMinutes')!.settings).toBeNull();
  });
});

describe('안건 선택지 모양 — 의결 경로 모양으로 맞춘다', () => {
  it('`{key,newValue}` → `{kind:CONFIG_CHANGE,target}` · `{kind,…}` 그대로 · null 그대로', () => {
    expect(normalizeRegistryEnact({ key: 'a', newValue: 10 })).toEqual({ kind: 'CONFIG_CHANGE', target: { key: 'a', newValue: 10 } });
    expect(normalizeRegistryEnact({ kind: 'GATE_MODE', target: { key: 'g' } })).toEqual({ kind: 'GATE_MODE', target: { key: 'g' } });
    expect(normalizeRegistryEnact(null)).toBeNull();
  });
  it('🔴 코드 변경 경로 결정을 상정하면 설정 선택지가 의결 가능한 모양으로 실린다 → 의결하면 집행 액션이 된다', async () => {
    const created: any[] = [];
    const decisionCreate = vi.fn(async ({ data }: any) => ({ id: 'dec-1', decisionNo: 'GOV-2026-001', resolution: 'r', actions: data.actions?.create ?? [] }));
    let agendaRow: any = null;
    const tx = { $executeRaw: vi.fn(), committeeDecision: { count: vi.fn(async () => 0), create: decisionCreate, update: vi.fn() }, committeeAgenda: { update: vi.fn() } };
    const prisma: any = {
      committee: { findUnique: vi.fn(async () => ({ code: 'QPS' })) },
      committeeAgenda: {
        create: vi.fn(async ({ data }: any) => { agendaRow = { id: 'ag-1', committeeId: 'c-1', meetingId: 'm-1', status: 'SCHEDULED', ...data, committee: { id: 'c-1', quorum: 1, code: 'QPS', name: 'Q' } }; created.push(data); return agendaRow; }),
        findUnique: vi.fn(async () => agendaRow),
        findFirst: vi.fn(async () => null), // 같은 결정의 열린 안건 없음
      },
      committeeMember: { findMany: vi.fn(async () => []) },
      committeeMeeting: { findUnique: vi.fn(async () => ({ attendees: ['u1'] })) },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };
    const svc = new GovernanceService(prisma, { validateAction: vi.fn() } as never, undefined, { get: vi.fn(async () => 'WARN'), set: vi.fn() } as never, undefined);
    (svc as any).sealDecision = vi.fn(async () => undefined);
    const key = 'pacu.dischargeCriteria';
    const committees = (await import('@hospital-run/shared')).DECISION_COMMITTEE_ASSIGNMENT[key];
    prisma.committee.findUnique = vi.fn(async () => ({ code: committees[0] }));
    await svc.submitAgenda('u1', { committeeId: 'c-1', title: 't', sourceRef: { type: 'DECISION', key } });
    const opt = created[0].options.find((o: any) => o.value === 'MIN_10');
    expect(opt.enact).toEqual({ kind: 'CONFIG_CHANGE', target: { key: 'pacu.aldrete.dischargeMin', newValue: 10 } });
    await svc.resolveAgenda('ag-1', { resolution: 'x', chosenOption: { value: 'MIN_10', snapshot: created[0].options } }, 'admin-1');
    const actions = decisionCreate.mock.calls[0][0].data.actions.create;
    expect(actions[0]).toMatchObject({ kind: 'CONFIG_CHANGE', target: { key: 'pacu.aldrete.dischargeMin', newValue: 10 } });
  });
});
