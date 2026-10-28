/**
 * 개발 반영 추적(2026-10-12 기획 `decision-print-remaining` P2).
 *  · 이력 원장 사건 3종 — 반영 확인(릴리즈 버전)·반영 불필요(근거)·🔴 되돌림 필요(실결정 ≠ 이미 구현된 시드 동작 — 시스템이 남김)
 *  · 이행 상태 5종은 원장에서 파생 — 🔴 시드는 이행 상태를 만들지 않는다 · 옛 선택의 반영 확인은 지금 결정의 이행이 아니다
 *  · 🔴 되돌림이 남은 결정에 "할 일 없음"을 남기지 못한다
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { devApplyStatusOf } from '@hospital-run/shared';
import { DecisionEngineService } from '../../src/modules/decision-registry/decision-engine.service';
import { DecisionController } from '../../src/modules/decision-registry/decision.controller';
import { DEV_APPLY_IMPLEMENTED } from '../../src/modules/decision-registry/dev-apply-baseline';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

const IMPL = 'journey.outpatientEnd'; // 판정표: 코드가 이미 BILLING_PAID
const PLAIN = 'policy.consent.translation'; // 개발 반영 · 판정표 미구현(코드 선택 없음)
const NON_DEV = 'governance.decisionConfigGuard'; // 자동 반영(설정) — 개발 반영 아님
const real = (choice: string, at = '2026-10-12T01:00:00.000Z') => ({ choice, legalReviewRef: '운영위 제5호', authorityClaim: '원장', decidedAt: at, applied: false });
const seed = (choice: string) => ({ choice, legalReviewRef: '개발 시드(DEV-SEED) — t', authorityClaim: '개발 시드(DEV-SEED)', decidedAt: '2026-10-10T00:00:00.000Z', applied: false });

function engine(store: Record<string, unknown> = {}) {
  const created: Array<Record<string, unknown>> = [];
  const prisma: any = {
    decisionLogEntry: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return data; }),
      findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []), count: vi.fn(async () => 0),
    },
  };
  const m = new Map(Object.entries(store));
  const config: any = {
    get: vi.fn(async (k: string) => m.get(k) ?? null),
    getMany: vi.fn(async (keys: string[]) => new Map(keys.map((k) => [k, m.get(k) ?? null]))),
  };
  return { eng: new DecisionEngineService(prisma, config), created };
}

describe('이행 상태 파생(shared devApplyStatusOf)', () => {
  const D = { choice: 'A', decidedAt: '2026-10-12T00:00:00.000Z' };
  const ev = (kind: string, choice: string, at: string, version?: string) => ({ kind, choice, occurredAt: at, version: version ?? null });
  it('🔴 실결정이 없으면 미결 — 시드는 이행 상태를 만들지 않는다', () => {
    expect(devApplyStatusOf({ decision: null, events: [ev('DEV_ENACTED', 'A', '2026-10-13T00:00:00Z', 'v1.0.0')] }).status).toBe('UNDECIDED');
  });
  it('실결정만 있으면 반영 대기 · 반영 확인이면 반영됨(버전) · 불필요면 반영 불필요', () => {
    expect(devApplyStatusOf({ decision: D, events: [] })).toEqual({ status: 'PENDING_DEV', version: null, since: D.decidedAt });
    expect(devApplyStatusOf({ decision: D, events: [ev('DEV_ENACTED', 'A', '2026-10-13T00:00:00Z', 'v4.75.0')] })).toMatchObject({ status: 'ENACTED', version: 'v4.75.0' });
    expect(devApplyStatusOf({ decision: D, events: [ev('DEV_NOT_REQUIRED', 'A', '2026-10-13T00:00:00Z')] }).status).toBe('NOT_REQUIRED');
  });
  it('🔴 옛 선택·결정 이전의 반영 확인은 지금 결정의 이행이 아니다', () => {
    expect(devApplyStatusOf({ decision: D, events: [ev('DEV_ENACTED', 'B', '2026-10-13T00:00:00Z', 'v1.0.0')] }).status).toBe('PENDING_DEV');
    expect(devApplyStatusOf({ decision: D, events: [ev('DEV_ENACTED', 'A', '2026-10-11T00:00:00Z', 'v1.0.0')] }).status).toBe('PENDING_DEV');
  });
  it('🔴 되돌림 필요 → 그 뒤 반영 확인이 있어야 반영됨 · 불필요 기록으로는 덮이지 않는다', () => {
    const rv = ev('DEV_REVERT_NEEDED', 'A', '2026-10-12T00:00:01Z');
    expect(devApplyStatusOf({ decision: D, events: [rv] }).status).toBe('REVERT_NEEDED');
    expect(devApplyStatusOf({ decision: D, events: [rv, ev('DEV_NOT_REQUIRED', 'A', '2026-10-13T00:00:00Z')] }).status).toBe('REVERT_NEEDED');
    expect(devApplyStatusOf({ decision: D, events: [rv, ev('DEV_ENACTED', 'A', '2026-10-14T00:00:00Z', 'v4.76.0')] })).toMatchObject({ status: 'ENACTED', version: 'v4.76.0' });
  });
});

describe('🔴 되돌림 필요 — 실결정 기록 순간 시스템이 남긴다', () => {
  it('판정표상 구현된 선택과 다른 실결정 → DEV_REVERT_NEEDED(구현된 선택을 상세에)', async () => {
    expect(DEV_APPLY_IMPLEMENTED[IMPL]).toBe('BILLING_PAID');
    const { eng, created } = engine();
    await eng.onRecorded({ key: IMPL, prev: seed('BILLING_PAID') as never, next: real('VISIT_CLOSED') as never, kind: 'RECORDED', actorUserId: 'u1' });
    const rv = created.filter((c) => c.kind === 'DEV_REVERT_NEEDED');
    expect(rv).toHaveLength(1);
    expect(rv[0]).toMatchObject({ decisionKey: IMPL, choice: 'VISIT_CLOSED', actorUserId: null });
    expect((rv[0].detail as { implementedChoice: string }).implementedChoice).toBe('BILLING_PAID');
  });
  it('대조군 — 같은 선택 · 시드 기록 · 구현 선택이 없는 결정은 남기지 않는다', async () => {
    for (const [key, next] of [[IMPL, real('BILLING_PAID')], [IMPL, seed('VISIT_CLOSED')], [PLAIN, real('ENFORCE_ALL')]] as const) {
      const { eng, created } = engine();
      await eng.onRecorded({ key, prev: null, next: next as never, kind: 'RECORDED', actorUserId: 'u1' });
      expect(created.filter((c) => c.kind === 'DEV_REVERT_NEEDED'), `${key} ${next.choice}`).toEqual([]);
    }
  });
});

describe('개발 반영 기록(관리자)', () => {
  it('🔴 개발 반영 결정에만 · 실결정 있어야 · 근거 · 반영 확인은 릴리즈 버전', async () => {
    const bad = async (key: string, store: Record<string, unknown>, input: any) => {
      const e = await engine(store).eng.recordDevEnactment(key, 'u1', input).catch((x) => x);
      expect(e, key).toBeInstanceOf(BadRequestException);
      return (e as BadRequestException).getResponse() as { code: string };
    };
    expect((await bad(NON_DEV, { [`decision.${NON_DEV}`]: real('WARN') }, { kind: 'DEV_NOT_REQUIRED', note: '근거 있음' })).code).toBe('DEV_APPLY_NOT_APPLICABLE');
    expect((await bad(PLAIN, { [`decision.${PLAIN}`]: seed('ENFORCE_ALL') }, { kind: 'DEV_NOT_REQUIRED', note: '근거 있음' })).code).toBe('DEV_APPLY_NOT_DECIDED');
    expect((await bad(PLAIN, {}, { kind: 'DEV_NOT_REQUIRED', note: '근거 있음' })).code).toBe('DEV_APPLY_NOT_DECIDED');
    expect((await bad(PLAIN, { [`decision.${PLAIN}`]: real('ENFORCE_ALL') }, { kind: 'DEV_ENACTED', note: '근거 있음', version: '4.75' })).code).toBe('DEV_APPLY_VERSION_REQUIRED');
    expect((await bad(PLAIN, { [`decision.${PLAIN}`]: real('ENFORCE_ALL') }, { kind: 'DEV_ENACTED', note: ' ', version: 'v4.75.0' })).code).toBe('DEV_APPLY_NOTE_REQUIRED');
  });
  it('🔴 코드가 다른 선택대로 도는 결정에 "할 일 없음"을 남기지 못한다 · 대조군: 같은 선택이면 남긴다', async () => {
    const e = await engine({ [`decision.${IMPL}`]: real('VISIT_CLOSED') }).eng.recordDevEnactment(IMPL, 'u1', { kind: 'DEV_NOT_REQUIRED', note: '현행' }).catch((x) => x);
    expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'DEV_APPLY_REVERT_PENDING' });
    const { eng, created } = engine({ [`decision.${IMPL}`]: real('BILLING_PAID') });
    await eng.recordDevEnactment(IMPL, 'u1', { kind: 'DEV_NOT_REQUIRED', note: '판정표 — 이미 그 선택대로' });
    expect(created[0]).toMatchObject({ decisionKey: IMPL, kind: 'DEV_NOT_REQUIRED', choice: 'BILLING_PAID', actorUserId: null });
  });
  it('반영 확인 — 지금 실결정의 선택·버전·근거를 남긴다 · EP 는 관리자만', async () => {
    const { eng, created } = engine({ [`decision.${PLAIN}`]: real('ENFORCE_ALL') });
    await eng.recordDevEnactment(PLAIN, '00000000-0000-4000-a000-0000000000a1', { kind: 'DEV_ENACTED', version: 'v4.75.0', note: '커밋 abc · RELEASE-v4.75.0' });
    expect(created[0]).toMatchObject({ kind: 'DEV_ENACTED', choice: 'ENFORCE_ALL', actorUserId: '00000000-0000-4000-a000-0000000000a1', detail: { version: 'v4.75.0' } });
    expect(Reflect.getMetadata(ROLES_KEY, DecisionController.prototype.devEnactment)).toEqual(['ADMIN']);
  });
});
