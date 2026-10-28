/**
 * 사람 몫 할 일(2026-10-26) — 상태를 정본에서 파생한다.
 *  · 🔴 결정은 실결정만 충족 — 개발 시드(DEV-SEED)·기록 없음은 미충족 · 시드 선택지는 그대로 보여 준다
 *  · 🔴 조회 실패는 그 확인 항목만 UNKNOWN — 다른 항목·다른 할 일은 그대로 · "끝남"이라 말하지 않는다
 *  · 판정 수단 없는 일은 MANUAL · INFO 는 판정에 넣지 않는다
 *  · H4 키 = 결정 등록부에 실재 · 화면 정의 = 명세 H1~H10 · 관리자 전용
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { HUMAN_ACTIONS, HUMAN_ACTION_IDS, HUMAN_H4_DECISION_KEYS, humanActionState } from '@hospital-run/shared';
import { HumanActionsService } from '../../src/modules/human-actions/human-actions.service';
import { HumanActionsController } from '../../src/modules/human-actions/human-actions.controller';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';
import { FcmPushService } from '../../src/modules/notification/fcm-push.service';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

const REAL = { choice: 'DISCARD_WITH_RECORD', legalReviewRef: '2026-11 OPS 회의록', authorityClaim: '운영위원회 의결' };
const SEED = { choice: 'DISCARD_WITH_RECORD', legalReviewRef: '개발 시드(DEV-SEED)', authorityClaim: '개발 시드(DEV-SEED) — 위원회 의결 미검증' };

function svcWith(opts: { cfg?: Record<string, unknown>; failKeys?: string[]; counts?: Partial<Record<'outbox' | 'orderSet' | 'tmpl', number>>; approval?: unknown; fcm?: boolean | 'missing'; sched?: string[]; linked?: string[] } = {}) {
  const config: any = {
    get: vi.fn(async (k: string) => { if (opts.failKeys?.includes(k)) throw new Error('db down'); return opts.cfg?.[k] ?? null; }),
    getWithSource: vi.fn(async (k: string) => { if (opts.failKeys?.includes(k)) throw new Error('db down'); const v = opts.cfg?.[k]; return v === undefined ? { value: 120, source: 'default', registered: true } : { value: v, source: 'db', registered: true }; }),
  };
  const prisma: any = {
    integrationOutbox: { count: vi.fn(async () => opts.counts?.outbox ?? 0) },
    orderSet: { count: vi.fn(async () => opts.counts?.orderSet ?? 0) },
    treatmentScheduleTemplate: { count: vi.fn(async () => opts.counts?.tmpl ?? 0) },
    alertApproval: { findFirst: vi.fn(async () => opts.approval ?? null) },
    clinicSchedule: { findMany: vi.fn(async () => (opts.sched ?? []).map((roomName) => ({ roomName }))) },
    clinicRoom: { findMany: vi.fn(async () => (opts.linked ?? []).map((name) => ({ name }))) },
  };
  const moduleRef: any = { get: vi.fn((cls: unknown) => { if (opts.fcm === 'missing') throw new Error('nope'); return cls === FcmPushService ? { isEnabled: opts.fcm === true } : null; }) };
  return new HumanActionsService(prisma, config, moduleRef);
}
const item = async (svc: HumanActionsService, id: string) => (await svc.list()).items.find((i) => i.id === id)!;

describe('🔴 결정은 실결정만 충족', () => {
  it('H1 — 시드는 미충족(선택지는 보인다) · 기록 없음 미충족 · 실결정 충족 · 보류 건수는 참고(INFO)', async () => {
    const seeded = await item(svcWith({ cfg: { 'decision.ops.rehearsalOutboxAtCutover': SEED }, counts: { outbox: 3 } }), 'H1');
    expect(seeded.state).toBe('PENDING');
    expect(seeded.checks[0]).toMatchObject({ code: 'DECISION_REAL', state: 'UNMET', decision: 'SEED', choice: 'DISCARD_WITH_RECORD', target: 'ops.rehearsalOutboxAtCutover' });
    expect(seeded.checks[1]).toMatchObject({ code: 'OUTBOX_PENDING', state: 'INFO', count: 3 });
    expect((await item(svcWith(), 'H1')).checks[0]).toMatchObject({ state: 'UNMET', decision: 'NONE', choice: null });
    expect((await item(svcWith({ cfg: { 'decision.ops.rehearsalOutboxAtCutover': REAL } }), 'H1')).state).toBe('DONE');
  });
  it('H4 — 13건 중 실결정만 셈 · 일부면 PARTIAL', async () => {
    const cfg: Record<string, unknown> = Object.fromEntries(HUMAN_H4_DECISION_KEYS.map((k) => [`decision.${k}`, SEED]));
    cfg['decision.catalog.ownership'] = REAL;
    const h4 = await item(svcWith({ cfg }), 'H4');
    expect(h4.checks).toHaveLength(13);
    expect(h4.checks.filter((c) => c.state === 'MET').map((c) => c.target)).toEqual(['catalog.ownership']);
    expect(h4.state).toBe('PARTIAL');
  });
});

describe('🔴 조회 실패는 그 항목만 확인 불가', () => {
  it('H2 결정 조회 실패 → UNKNOWN(미충족·끝남 아님) · 다른 할 일은 그대로', async () => {
    const s = svcWith({ failKeys: ['decision.billing.institutionType'], cfg: { 'decision.ops.rehearsalOutboxAtCutover': REAL } });
    const { items } = await s.list();
    expect(items.find((i) => i.id === 'H2')).toMatchObject({ state: 'UNKNOWN', checks: [{ state: 'UNKNOWN', target: 'billing.institutionType' }] });
    expect(items.find((i) => i.id === 'H1')!.state).toBe('DONE');
  });
  it('H6 — 하나만 확인 불가여도 끝남이라 말하지 않는다 · FCM 판정은 발송부와 같은 isEnabled · 못 찾으면 확인 불가', async () => {
    const cfg = { 'notification.patientPush.queueNearAhead': 2, 'notification.patientPush.enabled': true, 'notification.patientPush.types.QUEUE_NEAR': true };
    const { ALERT_REGISTRY } = await import('../../src/modules/notification/alert-registry');
    const { alertSnapshot } = await import('../../src/modules/notification/alert-approval');
    const def = ALERT_REGISTRY.find((d) => d.code === 'PATIENT_PUSH_QUEUE_NEAR')!;
    const approval = { snapshot: alertSnapshot(def), revokedAt: null };
    expect((await item(svcWith({ cfg, approval, fcm: true }), 'H6')).state).toBe('DONE');
    const noFcm = await item(svcWith({ cfg, approval, fcm: 'missing' }), 'H6');
    expect(noFcm.state).toBe('UNKNOWN');
    expect(noFcm.checks.find((c) => c.code === 'FCM_CREDENTIALS')!.state).toBe('UNKNOWN');
    const none = await item(svcWith({ fcm: false }), 'H6');
    expect(none.state).toBe('PENDING');
    expect(none.checks.map((c) => [c.code, c.state])).toEqual([
      ['QUEUE_NEAR_THRESHOLD', 'UNMET'], ['PUSH_MASTER_ON', 'UNMET'], ['PUSH_TYPE_ON', 'UNMET'], ['ALERT_APPROVED', 'UNMET'], ['FCM_CREDENTIALS', 'UNMET'],
    ]);
  });
});

describe('원장 수·연결', () => {
  it('H3 — 코드 매핑·일당 둘 다 비면 미충족 · 하나라도 있으면 충족(빈 객체는 없는 것)', async () => {
    expect((await item(svcWith({ cfg: { 'inpatient.bedRateCodes': {} } }), 'H3')).state).toBe('PENDING');
    expect((await item(svcWith({ cfg: { 'inpatient.bedRates': { GENERAL: 60000 } } }), 'H3')).state).toBe('DONE');
  });
  it('H5 — 승인 없는 사용 중 수 · 0 이면 충족', async () => {
    const h5 = await item(svcWith({ counts: { orderSet: 26, tmpl: 0 } }), 'H5');
    expect(h5).toMatchObject({ state: 'PARTIAL', checks: [{ code: 'ORDER_SETS_UNAPPROVED', state: 'UNMET', count: 26 }, { code: 'TEMPLATES_UNAPPROVED', state: 'MET', count: 0 }] });
  });
  it('H7 — 진료표 진료실 중 도면 연결 없는 것 · 이름 · 잘림', async () => {
    const sched = Array.from({ length: 35 }, (_, i) => `진료실${String(i).padStart(2, '0')}`);
    const h7 = await item(svcWith({ sched, linked: ['진료실00', '진료실01'] }), 'H7');
    expect(h7.checks[0]).toMatchObject({ state: 'UNMET', count: 33, truncated: true });
    expect(h7.checks[0].names).toHaveLength(30);
    expect((await item(svcWith({ sched: ['A'], linked: ['A'] }), 'H7')).state).toBe('DONE');
  });
});

describe('🔴 H11 보호대 점검 간격 — 코드 기본값은 원내 규정이 아니다', () => {
  it('설정 없음(코드 기본값 120) → 남음 · 원내 설정 60 → 끝남 · 형식 밖 → 남음 · 조회 실패 → 확인 불가', async () => {
    expect((await item(svcWith(), 'H11')).checks[0]).toMatchObject({ state: 'UNMET', target: 'nursing.restraint.checkIntervalMinutes', count: null });
    expect(await item(svcWith({ cfg: { 'nursing.restraint.checkIntervalMinutes': 60 } }), 'H11')).toMatchObject({ state: 'DONE', checks: [{ count: 60 }] });
    expect((await item(svcWith({ cfg: { 'nursing.restraint.checkIntervalMinutes': 5 } }), 'H11')).state).toBe('PENDING');
    expect((await item(svcWith({ failKeys: ['nursing.restraint.checkIntervalMinutes'] }), 'H11')).state).toBe('UNKNOWN');
  });
});

describe('🔴 H12 통증 재평가 규정·인계 인수 방식 — 코드 기본값·미설정은 원내 결정이 아니다', () => {
  it('둘 다 비면 남음 · 하나만 원내 설정이면 일부 · 둘 다면 끝남 · 조회 실패는 그 항목만 확인 불가', async () => {
    const RULE = { thresholdScore: 4, withinMinutes: 60, afterAnalgesicMinutes: null };
    const none = await item(svcWith(), 'H12');
    expect(none.checks.map((c) => [c.code, c.state])).toEqual([['PAIN_RULE_CONFIGURED', 'UNMET'], ['HANDOFF_ACK_MODE_CONFIGURED', 'UNMET'], ['RISK_INTERVALS_CONFIGURED', 'UNMET']]);
    expect(none.state).toBe('PENDING');
    expect((await item(svcWith({ cfg: { 'nursing.pain.reassessRule': RULE } }), 'H12')).state).toBe('PARTIAL');
    expect((await item(svcWith({ cfg: { 'nursing.pain.reassessRule': RULE, 'nursing.handoff.ackTakeOverMode': 'SEPARATE' } }), 'H12')).state).toBe('PARTIAL');
    const RISK = { FALL_RISK: { HIGH: 2, MODERATE: 4, LOW: 8 }, PRESSURE_ULCER: { HIGH: 4, MODERATE: 8, LOW: 24 } };
    expect((await item(svcWith({ cfg: { 'nursing.pain.reassessRule': RULE, 'nursing.handoff.ackTakeOverMode': 'SEPARATE', 'nursing.riskReassess.intervalHours': RISK } }), 'H12')).state).toBe('DONE');
    const fail = await item(svcWith({ failKeys: ['nursing.handoff.ackTakeOverMode'], cfg: { 'nursing.pain.reassessRule': RULE } }), 'H12');
    expect(fail.checks.map((c) => c.state)).toEqual(['MET', 'UNKNOWN', 'UNMET']);
    expect(fail.state).toBe('PARTIAL'); // 충족·확인 불가·미충족이 섞이면 일부(끝남 아님)
  });
});

describe('판정 수단·정의', () => {
  it('H8·H9·H10 은 MANUAL — H10 결정 상태는 참고(INFO)', async () => {
    const { items } = await svcWith({ cfg: { 'decision.billing.paymentRefReconciliation': REAL } }).list();
    for (const id of ['H8', 'H9', 'H10']) expect(items.find((i) => i.id === id)!.state).toBe('MANUAL');
    expect(items.find((i) => i.id === 'H10')!.checks[0]).toMatchObject({ state: 'INFO', decision: 'REAL' });
  });
  it('상태 파생 규칙 — INFO 무시 · 확인 불가 섞이면 끝남 아님 · 판정 항목 없으면 확인 불가', () => {
    expect(humanActionState(true, [{ state: 'MET' }, { state: 'INFO' }])).toBe('DONE');
    expect(humanActionState(true, [{ state: 'MET' }, { state: 'UNKNOWN' }])).toBe('UNKNOWN');
    expect(humanActionState(true, [{ state: 'MET' }, { state: 'UNMET' }, { state: 'UNKNOWN' }])).toBe('PARTIAL');
    expect(humanActionState(true, [{ state: 'INFO' }])).toBe('UNKNOWN');
    expect(humanActionState(false, [{ state: 'MET' }])).toBe('MANUAL');
  });
  it('H4 키·다른 결정 키가 등록부에 실재 · 정의 H1~H10 · 관리자 전용', () => {
    const keys = new Set(DECISION_REGISTRY.map((d) => d.key));
    for (const k of [...HUMAN_H4_DECISION_KEYS, 'ops.rehearsalOutboxAtCutover', 'billing.institutionType', 'billing.paymentRefReconciliation']) expect(keys.has(k), k).toBe(true);
    expect(HUMAN_ACTIONS.map((d) => d.id)).toEqual([...HUMAN_ACTION_IDS]);
    expect(Reflect.getMetadata(ROLES_KEY, HumanActionsController.prototype.list)).toEqual([UserRole.ADMIN]);
  });
});
