/**
 * 결정 엔진(2026-10-11 사용자 "엔진 형태로 세팅 후에 변경되고, 전후 관계에도 영향을 주고, 보호하거나 설정에 영향을 줄 수 있어야 함 ·
 * 이미 의사결정된 과정도 로그 형태로 · 문서 형태로").
 *
 * 🔴 실측: 결정 기록은 `decision.<key>` 한 행을 덮어썼다(이전 선택은 감사 문자열에만) · 선행 결정이 나중에 바뀌어도 후행 실결정은 아무 표시가 없었다 ·
 *    결정에 묶인 설정을 설정 화면에서 바꿔도 결정 쪽엔 흔적이 없었다.
 * 쌍: 선행 `legal.patientPush.consentScope`(허가권자 · NOT_REVIEWED/CLEARED) → 후행 `policy.patientPush.enable`(설정 notification.patientPush.enabled).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { DecisionEngineService, CONFIG_GUARD_EVENT, COMMITTEE_RECORDED_EVENT } from '../../src/modules/decision-registry/decision-engine.service';
import { enactConfigOf, governedConfigMap, downstreamOf, decidedConfigOf } from '../../src/modules/decision-registry/decision-engine';
import { DecisionService } from '../../src/modules/decision-registry/decision.service';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';
import { ConfigRuntimeController } from '../../src/modules/config/config-runtime.controller';
import { DECISION_LOG_KINDS, upstreamChangedAfter } from '@hospital-run/shared';

const UP = 'legal.patientPush.consentScope';
const DOWN = 'policy.patientPush.enable';
const CFG = 'notification.patientPush.enabled';
const real = (choice: string, at = '2026-10-11T01:00:00.000Z') => ({ choice, legalReviewRef: '법무 회신 제3호', authorityClaim: '원장', decidedAt: at, applied: true });
const seed = (choice: string) => ({ choice, legalReviewRef: '개발 시드(DEV-SEED) — t', authorityClaim: '개발 시드(DEV-SEED)', decidedAt: '2026-10-10T00:00:00.000Z', applied: false });

function engine(store: Record<string, unknown> = {}, opts: { createFails?: boolean; logRows?: unknown[] } = {}) {
  const created: Array<Record<string, unknown>> = [];
  const prisma: any = {
    decisionLogEntry: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { if (opts.createFails) throw new Error('down'); created.push(data); return data; }),
      findMany: vi.fn(async () => opts.logRows ?? []),
      count: vi.fn(async () => (opts.logRows ?? []).length),
      groupBy: vi.fn(async () => []),
    },
  };
  const m = new Map(Object.entries(store));
  const config: any = {
    get: vi.fn(async (k: string) => m.get(k) ?? null),
    getMany: vi.fn(async (keys: string[]) => new Map(keys.map((k) => [k, m.get(k) ?? null]))),
  };
  return { eng: new DecisionEngineService(prisma, config), created, prisma };
}

describe('규칙(파생) — 손으로 목록을 두지 않는다', () => {
  it('집행 대상 두 모양 · 설정 변경 아닌 집행은 null', () => {
    expect(enactConfigOf({ key: 'a', newValue: 1 })).toEqual({ key: 'a', value: 1 });
    expect(enactConfigOf({ kind: 'CONFIG_CHANGE', target: { key: 'b', newValue: 'X' } })).toEqual({ key: 'b', value: 'X' });
    expect(enactConfigOf({ kind: 'GATE_MODE', target: { key: 'c' } })).toBeNull();
    expect(enactConfigOf(null)).toBeNull();
  });
  it('설정 → 결정 역방향 · 후행 · 선택이 정하는 값', () => {
    expect(governedConfigMap().get(CFG)).toContain(DOWN);
    expect(governedConfigMap().get('governance.decisionConfigGuard')).toEqual(['governance.decisionConfigGuard']);
    expect(downstreamOf(UP).map((d) => d.key)).toContain(DOWN);
    const d = DECISION_REGISTRY.find((x) => x.key === DOWN)!;
    expect(decidedConfigOf(d, 'ON')).toEqual([{ key: CFG, value: true }]);
  });
  it('재검토 필요 판정 — 내 결정 뒤 선행 변경 · 확인 뒤면 해소 · 시각 모르면 판정 안 함', () => {
    const up = [{ key: UP, decidedAt: '2026-10-11T02:00:00.000Z' }];
    expect(upstreamChangedAfter({ myDecidedAt: '2026-10-11T01:00:00.000Z', lastReviewConfirmedAt: null, upstream: up })).toEqual([UP]);
    expect(upstreamChangedAfter({ myDecidedAt: '2026-10-11T01:00:00.000Z', lastReviewConfirmedAt: '2026-10-11T03:00:00.000Z', upstream: up })).toEqual([]);
    expect(upstreamChangedAfter({ myDecidedAt: '2026-10-11T03:00:00.000Z', lastReviewConfirmedAt: null, upstream: up })).toEqual([]);
    expect(upstreamChangedAfter({ myDecidedAt: null, lastReviewConfirmedAt: null, upstream: up })).toEqual([]);
  });
});

describe('기록 → 원장 · 전후 관계 전파', () => {
  it('🔴 결정 기록이 원장에 "무엇에서 무엇으로" 남는다', async () => {
    const { eng, created } = engine();
    const r = await eng.onRecorded({ key: UP, prev: seed('NOT_REVIEWED'), next: real('CLEARED'), kind: 'RECORDED', actorUserId: '00000000-0000-4000-a000-000000a00001' });
    expect(r.logged).toBe(true);
    expect(created[0]).toMatchObject({ decisionKey: UP, kind: 'RECORDED', choice: 'CLEARED', prevChoice: 'NOT_REVIEWED', basisRef: '법무 회신 제3호' });
    expect((created[0].detail as { replaced: { seeded: boolean } }).replaced.seeded).toBe(true);
  });
  it('🔴 선행이 바뀌면 후행 실결정에 "선행 결정 변경" · 부정 결정이면 근거 상실 표시 · 후행은 자동으로 되돌리지 않는다', async () => {
    const { eng, created } = engine({ [`decision.${DOWN}`]: real('ON', '2026-10-01T00:00:00.000Z') });
    const r = await eng.onRecorded({ key: UP, prev: real('CLEARED'), next: real('NOT_REVIEWED'), kind: 'RECORDED' });
    expect(r.propagatedTo).toEqual([DOWN]);
    const up = created.find((c) => c.kind === 'UPSTREAM_CHANGED')!;
    expect(up).toMatchObject({ decisionKey: DOWN, sourceKey: UP, choice: 'ON' });
    expect(up.detail).toMatchObject({ upstreamPrev: 'CLEARED', upstreamNext: 'NOT_REVIEWED', upstreamNegative: true });
  });
  it('대조군 — 후행이 미결·시드면 흔들 결정이 없다 · 선택이 같으면 전파하지 않는다', async () => {
    const a = engine({ [`decision.${DOWN}`]: seed('ON') });
    expect((await a.eng.onRecorded({ key: UP, prev: null, next: real('CLEARED'), kind: 'RECORDED' })).propagatedTo).toEqual([]);
    const b = engine({ [`decision.${DOWN}`]: real('ON') });
    expect((await b.eng.onRecorded({ key: UP, prev: real('CLEARED'), next: real('CLEARED'), kind: 'RECORDED' })).propagatedTo).toEqual([]);
    expect(b.created.map((c) => c.kind)).toEqual(['RECORDED']);
  });
  it('🔴 원장 쓰기 실패는 결정을 되돌리지 않고(던지지 않음) 실패를 말한다', async () => {
    const { eng } = engine({}, { createFails: true });
    await expect(eng.onRecorded({ key: UP, prev: null, next: real('CLEARED'), kind: 'RECORDED' })).resolves.toMatchObject({ logged: false });
  });
});

describe('보호 — 결정에 묶인 설정', () => {
  const check = (eng: DecisionEngineService, value: unknown, phase: 'check' | 'changed' = 'check') => eng.onConfigGuard({ phase, key: CFG, value, prev: false, actorUserId: 'u' });
  it('묶이지 않은 설정은 판정하지 않는다(null)', async () => {
    expect(await engine().eng.onConfigGuard({ phase: 'check', key: 'ui.anything', value: 1 })).toBeNull();
  });
  it('🔴 BLOCK — 실결정이 정한 값과 다르면 막는다 · 대조군: 같은 값(되돌리기)·시드·WARN 은 막지 않는다', async () => {
    expect((await check(engine({ [`decision.${DOWN}`]: real('ON'), 'governance.decisionConfigGuard': 'BLOCK' }).eng, false))!.block).toBe(true);
    expect((await check(engine({ [`decision.${DOWN}`]: real('ON'), 'governance.decisionConfigGuard': 'BLOCK' }).eng, true))!.block).toBe(false);
    expect((await check(engine({ [`decision.${DOWN}`]: seed('ON'), 'governance.decisionConfigGuard': 'BLOCK' }).eng, false))!.block).toBe(false);
    expect((await check(engine({ [`decision.${DOWN}`]: real('ON') }).eng, false))!).toMatchObject({ mode: 'WARN', block: false });
  });
  it('🔴 WARN — 바뀐 뒤 결정 이력에 "설정 직접 변경"(이전·새 값·결정 값) · OFF 는 남기지 않는다', async () => {
    const w = engine({ [`decision.${DOWN}`]: real('ON') });
    await check(w.eng, false, 'changed');
    expect(w.created[0]).toMatchObject({ decisionKey: DOWN, kind: 'CONFIG_OVERRIDE', sourceKey: CFG });
    expect(w.created[0].detail).toMatchObject({ prev: false, value: false, decidedValue: true, matchesDecision: false });
    const o = engine({ [`decision.${DOWN}`]: real('ON'), 'governance.decisionConfigGuard': 'OFF' });
    await check(o.eng, false, 'changed');
    expect(o.created).toHaveLength(0);
  });
  it('🔴 설정 화면(PUT) — 막히면 409·저장 안 함·막힘 이력 · 허용이면 저장 후 이력과 meta', async () => {
    const set = vi.fn(async () => ({ ok: true }));
    const emitAsync = vi.fn(async (_e: string, ev: { phase: string }) => (ev.phase === 'check' ? [{ block: true, mode: 'BLOCK', governing: [{ key: DOWN, title: 't', decidedValue: true, seeded: false }] }] : []));
    const c = new ConfigRuntimeController({ set, get: async () => true } as never, { emitAsync } as never);
    await expect(c.set(CFG, { value: false } as never, 'u')).rejects.toMatchObject({ response: { code: 'CONFIG_DECISION_GOVERNED' } });
    expect(set).not.toHaveBeenCalled();
    expect(emitAsync.mock.calls.map((x) => (x[1] as { phase: string }).phase)).toEqual(['check', 'blocked']);
    const emit2 = vi.fn(async (_e: string, ev: { phase: string }) => (ev.phase === 'check' ? [{ block: false, mode: 'WARN', governing: [{ key: DOWN, title: 't', decidedValue: true, seeded: false }] }] : [null]));
    const c2 = new ConfigRuntimeController({ set, get: async () => true } as never, { emitAsync: emit2 } as never);
    const r = await c2.set(CFG, { value: false } as never, 'u') as { meta?: { decisionGoverned: { logged: boolean } } };
    expect(set).toHaveBeenCalledTimes(1);
    expect(emit2.mock.calls.map((x) => (x[1] as { phase: string }).phase)).toEqual(['check', 'changed']);
    expect(r.meta?.decisionGoverned.logged).toBe(true);
    expect(emit2.mock.calls[0][0]).toBe(CONFIG_GUARD_EVENT);
  });
});

describe('영향 미리보기 · 재검토 확인 · 이력 조회', () => {
  it('🔴 고르기 전에 — 바뀌는 설정(현재→바뀔 값)·후행(재검토/열림/막힘)·선행 충족', async () => {
    const { eng } = engine({ [CFG]: false, [`decision.${DOWN}`]: real('ON') });
    const up = await eng.impact(UP, 'NOT_REVIEWED');
    expect(up.downstream.find((x) => x.key === DOWN)).toMatchObject({ effect: 'REVIEW', loseBasis: true });
    const dn = await eng.impact(DOWN, 'ON');
    expect(dn.configChanges).toEqual([{ key: CFG, current: false, next: true, changes: true }]);
    expect(dn.upstream[0]).toMatchObject({ key: UP, decided: false, satisfied: false });
    expect(dn.protectedKeys).toContain(CFG);
    await expect(eng.impact(DOWN, 'NOPE')).rejects.toMatchObject({ response: { code: 'DECISION_INVALID_CHOICE' } });
  });
  it('🔴 재검토 확인 — 대상일 때만(근거 필수) · 아니면 거부(빈 확인을 쌓지 않는다)', async () => {
    const needs = engine({ [`decision.${DOWN}`]: real('ON', '2026-10-01T00:00:00.000Z'), [`decision.${UP}`]: real('CLEARED', '2026-10-05T00:00:00.000Z') });
    await needs.eng.reviewConfirm(DOWN, 'u', '법무 회신 재확인 — 동의 범위 동일');
    expect(needs.created[0]).toMatchObject({ decisionKey: DOWN, kind: 'REVIEW_CONFIRMED', choice: 'ON' });
    const not = engine({ [`decision.${DOWN}`]: real('ON', '2026-10-09T00:00:00.000Z'), [`decision.${UP}`]: real('CLEARED', '2026-10-05T00:00:00.000Z') });
    await expect(not.eng.reviewConfirm(DOWN, 'u', '확인')).rejects.toMatchObject({ response: { code: 'DECISION_REVIEW_NOT_NEEDED' } });
    await expect(engine({ [`decision.${DOWN}`]: seed('ON') }).eng.reviewConfirm(DOWN, 'u', '확인')).rejects.toMatchObject({ response: { code: 'DECISION_REVIEW_NOT_DECIDED' } });
    await expect(needs.eng.reviewConfirm(DOWN, 'u', ' ')).rejects.toMatchObject({ response: { code: 'DECISION_REVIEW_NOTE_REQUIRED' } });
  });
  it('이력 — 자르면 nextCursor · 커서 형식·종류 검사', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `id-${i}`, decisionKey: UP, kind: 'RECORDED', occurredAt: new Date(`2026-10-0${i + 1}T00:00:00Z`) }));
    const { eng } = engine({}, { logRows: rows });
    const r = await eng.log({ limit: 2 });
    expect(r.items).toHaveLength(2);
    expect(r.nextCursor).toBe('2026-10-02T00:00:00.000Z|id-1');
    expect(r.items[0].title).toBeTruthy();
    await expect(eng.log({ cursor: 'bad' })).rejects.toMatchObject({ response: { code: 'DECISION_LOG_CURSOR' } });
    await expect(eng.log({ kind: 'NOPE' })).rejects.toMatchObject({ response: { code: 'DECISION_LOG_KIND' } });
  });
});

describe('목록 — 엔진 신호(파생)', () => {
  function mk(store: Record<string, unknown>, signals: unknown | 'FAIL') {
    const m = new Map(Object.entries(store));
    const config: any = { get: vi.fn(async (k: string) => m.get(k) ?? null), getMany: vi.fn(async (ks: string[]) => new Map(ks.map((k) => [k, m.get(k) ?? null]))), set: vi.fn() };
    const prisma: any = { decisionAction: { findMany: vi.fn(async () => []) }, committeeAgenda: { findMany: vi.fn(async () => []) }, committee: { findMany: vi.fn(async () => []) } };
    const listSignals = vi.fn(async () => { if (signals === 'FAIL') throw new Error('down'); return signals; });
    return new DecisionService(prisma, config, { enactRegistryDecision: vi.fn() } as never, { listSignals } as never, { log: vi.fn() } as never);
  }
  const SIG = (lastReview: Record<string, string> = {}) => ({ lastReview: new Map(Object.entries(lastReview)), counts: new Map([[DOWN, 3]]), protectionMode: 'WARN', devEvents: new Map() });
  const store = { [`decision.${DOWN}`]: real('ON', '2026-10-01T00:00:00.000Z'), [`decision.${UP}`]: real('CLEARED', '2026-10-05T00:00:00.000Z'), [CFG]: false };
  it('🔴 내 실결정 뒤 선행 실결정 → 재검토 필요 · 확인 뒤면 해소 · 설정이 결정과 다름 · 이력 수 · 요약', async () => {
    const r = await mk(store, SIG()).list();
    const down = r.items.find((i) => i.key === DOWN)!;
    expect(down.needsReview).toEqual([UP]);
    expect(down.governedConfig).toEqual([{ key: CFG, decided: true, current: false, matches: false }]);
    expect(down.logCount).toBe(3);
    expect(r.summary.engine).toMatchObject({ protectionMode: 'WARN', reviewNeeded: 1, configDrift: 1, logTotal: 3 });
    const confirmed = await mk(store, SIG({ [DOWN]: '2026-10-06T00:00:00.000Z' })).list();
    expect(confirmed.items.find((i) => i.key === DOWN)!.needsReview).toEqual([]);
  });
  it('🔴 이력 신호 실패 — 재검토 필요는 null(확인 불가) · 필요 없음(빈 배열)으로 접지 않는다 · 목록은 산다', async () => {
    const r = await mk(store, 'FAIL').list();
    expect(r.items.find((i) => i.key === DOWN)!.needsReview).toBeNull();
    expect(r.items.find((i) => i.key === DOWN)!.logCount).toBeNull();
    expect(r.summary.engine).toMatchObject({ protectionMode: null, reviewNeeded: null, logTotal: null });
  });
  it('대조군 — 선행이 시드면 재검토 대상 아님(시드는 실결정이 아니다)', async () => {
    const r = await mk({ ...store, [`decision.${UP}`]: { ...seed('CLEARED'), decidedAt: '2026-10-09T00:00:00.000Z' } }, SIG()).list();
    expect(r.items.find((i) => i.key === DOWN)!.needsReview).toEqual([]);
  });
});

describe('배선', () => {
  it('🔴 결정 기록(decide)이 엔진을 부르고 응답이 엔진 결과를 싣는다 — 이전 기록을 함께 넘긴다', async () => {
    const store = new Map<string, unknown>([[`decision.${DOWN}`, seed('OFF')], [`decision.${UP}`, real('CLEARED')]]);
    const config: any = { get: vi.fn(async (k: string) => store.get(k) ?? null), getMany: vi.fn(async (ks: string[]) => new Map(ks.map((k) => [k, store.get(k) ?? null]))), set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }) };
    const onRecorded = vi.fn(async () => ({ logged: true, propagatedTo: [] }));
    const prisma: any = { decisionAction: { create: vi.fn(async () => ({ id: 'a' })) } };
    const svc = new DecisionService(prisma, config, { enactRegistryDecision: vi.fn(async () => ({ enacted: 1, failed: 0, remaining: 0 })) } as never, { onRecorded } as never, { log: vi.fn().mockResolvedValue(null) } as never);
    const r = await svc.decide(DOWN, 'u', { choice: 'ON', legalReviewRef: '운영위 결정 1', authorityClaim: '진료부장' });
    expect(onRecorded).toHaveBeenCalledTimes(1);
    const arg = (onRecorded.mock.calls[0] as unknown as [{ prev: { choice: string }; next: { choice: string }; kind: string }])[0];
    expect(arg).toMatchObject({ kind: 'RECORDED', prev: { choice: 'OFF' }, next: { choice: 'ON' } });
    expect(r.engine).toEqual({ logged: true, propagatedTo: [] });
  });
  it('🔴 이벤트 수신자 — 위원회 의결·설정 화면 이벤트를 엔진이 받는다 · 모듈 등록 · 거버넌스가 의결 이벤트를 보낸다', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/decision-registry/decision-engine.service.ts'), 'utf8');
    expect(src).toMatch(/@OnEvent\(COMMITTEE_RECORDED_EVENT/);
    expect(src).toMatch(/@OnEvent\(CONFIG_GUARD_EVENT/);
    expect(COMMITTEE_RECORDED_EVENT).toBe('decision.committeeRecorded');
    expect(CONFIG_GUARD_EVENT).toBe('decision.configGuard');
    const mod = readFileSync(join(__dirname, '../../src/modules/decision-registry/decision.module.ts'), 'utf8');
    expect(mod).toMatch(/providers: \[DecisionService, DecisionEngineService[,\]]/);
    const gov = readFileSync(join(__dirname, '../../src/modules/gld/governance.service.ts'), 'utf8');
    expect(gov).toMatch(/emitAsync\(COMMITTEE_RECORDED_EVENT/);
    const ctl = readFileSync(join(__dirname, '../../src/modules/config/config-runtime.controller.ts'), 'utf8');
    expect(ctl).toContain("emitAsync('decision.configGuard'"); // 문자열 = 상수 값(위에서 대조)
  });
  it('🔴 원장에 고치기·지우기 경로가 없다(덧붙이기만) · 마이그레이션이 지금 기록을 원장 시작 전 기록으로 옮긴다', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.ts') ? [join(d, e.name)] : []));
    const bad = walk(join(__dirname, '../../src')).filter((f) => /decisionLogEntry\.(update|updateMany|delete|deleteMany|upsert)\(/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261011000701_decision_log_entries/migration.sql'), 'utf8');
    expect(sql).toMatch(/'BACKFILL'/);
    expect(sql).toMatch(/NOT LIKE 'decision\.attachments\.%'/);
    expect(DECISION_LOG_KINDS).toContain('BACKFILL');
  });
});
