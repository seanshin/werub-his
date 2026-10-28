/**
 * CPOE 질 관리 심화(2026-10-07) — 경고 부담 · 전후 비교 · 개선 활동(PDCA).
 *  · 경고 부담: 유형별로 처방은 한 번만 센다(같은 유형 경고 2개여도 처방 1) · 옛 문자열 경고는 UNTYPED · 사유 없는 무시 · CDSS 수준
 *  · 전후 비교: 분모 0 = null · 0 을 포함하는 구간 · 작은 표본 표시 · 판정어 없음
 *  · 개선 활동: 기준선은 서버가 병원 전체로 센다(표본 0 거절) · 정해진 전이만 · 종결·취소 사유 · CHECK→ACT 는 효과 확인 필요
 *    · 동시 전이 409 · 효과 확인은 실행 이후·기준선 뒤 기간만 · "바람직한 쪽"은 등재 방향일 때만
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { canTransitQiAction, proportionDiff, QI_ACTION_STATUSES } from '@hospital-run/shared';
import { computeAlertBurden, type QiRx, type QiCdss } from '../../src/modules/cpoe-quality/cpoe-quality.compute';
import { CpoeImprovementService } from '../../src/modules/cpoe-quality/cpoe-improvement.service';

let seq = 0;
const rx = (over: Partial<QiRx>): QiRx => ({
  id: `rx${++seq}`, type: 'MEDICATION', status: 'ACTIVE', priority: 'ROUTINE', orderSource: 'WRITTEN', durChecked: true, durWarnings: [],
  durOverridden: false, durOverrideReason: null, readBackConfirmedAt: null, prescriberCosignedAt: null, diagnosisCodeId: 'dx',
  discontinueReason: null, createdAt: new Date('2026-09-10T00:00:00Z'), prescriber: 'd1', patientId: 'p1', name: '와파린', setting: 'OUTPATIENT', ...over,
});
const cd = (over: Partial<QiCdss>): QiCdss => ({ id: `c${++seq}`, overridden: false, overrideReason: null, createdAt: new Date(), prescriber: 'd1', patientId: 'p1', name: null, setting: 'UNKNOWN', ...over });

describe('경고 부담', () => {
  it('🔴 유형별 처방은 한 번만 · 경고 수는 전부 · 옛 문자열 경고는 UNTYPED · 사유 없는 무시', () => {
    const b = computeAlertBurden({
      rx: [
        rx({ durWarnings: [{ type: 'INTERACTION' }, { type: 'INTERACTION' }, { type: 'MAX_DOSE' }], durOverridden: true, durOverrideReason: ' ' }),
        rx({ durWarnings: ['옛 형식 경고'], name: '아스피린' }),
        rx({ durWarnings: [] }),
      ],
      orders: [], interventions: [], criticals: [],
      cdss: [cd({ level: 'CRITICAL', overridden: true }), cd({ level: 'CRITICAL' }), cd({ level: null })],
    });
    expect(b.dur).toMatchObject({ warnedPrescriptions: 2, overridden: 1, overriddenNoReason: 1 });
    expect(b.dur.byType.find((t) => t.type === 'INTERACTION')).toEqual({ type: 'INTERACTION', prescriptions: 1, alerts: 2, overridden: 1, overriddenNoReason: 1 });
    expect(b.dur.byType.find((t) => t.type === 'UNTYPED')).toMatchObject({ prescriptions: 1, alerts: 1, overridden: 0 });
    expect(b.dur.topDrugs[0]).toMatchObject({ name: '와파린', prescriptions: 1, overridden: 1 });
    expect(b.dur.topDrugs[0].types.sort()).toEqual(['INTERACTION', 'MAX_DOSE']);
    expect(b.cdss.byLevel).toEqual(expect.arrayContaining([{ level: 'CRITICAL', logs: 2, overridden: 1, overriddenNoReason: 1 }, { level: 'UNKNOWN', logs: 1, overridden: 0, overriddenNoReason: 0 }]));
  });
});

describe('전후 비교', () => {
  it('🔴 분모 0 이면 비교 불가(null) · 구간이 0 을 포함하면 includesZero · 작은 표본 표시', () => {
    expect(proportionDiff({ numerator: 0, denominator: 0 }, { numerator: 1, denominator: 10 })).toBeNull();
    const big = proportionDiff({ numerator: 300, denominator: 1000 }, { numerator: 150, denominator: 1000 })!;
    expect(big.diff).toBeCloseTo(-0.15);
    expect(big.includesZero).toBe(false);
    expect(big.small).toBe(false);
    const tiny = proportionDiff({ numerator: 3, denominator: 10 }, { numerator: 2, denominator: 10 })!;
    expect(tiny.includesZero).toBe(true);
    expect(tiny.small).toBe(true);
    // 분모만 작은 경우(분자·여집합은 5 이상) — 분모 < 30 규칙 하나로만 걸린다
    expect(proportionDiff({ numerator: 10, denominator: 20 }, { numerator: 8, denominator: 20 })!.small).toBe(true);
    expect(proportionDiff({ numerator: 10, denominator: 40 }, { numerator: 8, denominator: 40 })!.small).toBe(false);
  });

  it('PDCA 전이 — 정해진 것만 · 종결·취소는 끝', () => {
    expect(canTransitQiAction('PLAN', 'DO')).toBe(true);
    expect(canTransitQiAction('PLAN', 'CHECK')).toBe(false);
    expect(canTransitQiAction('ACT', 'PLAN')).toBe(true);
    expect(canTransitQiAction('CHECK', 'DO')).toBe(true);
    for (const s of QI_ACTION_STATUSES) { expect(canTransitQiAction('CLOSED', s)).toBe(false); expect(canTransitQiAction('CANCELLED', s)).toBe(false); }
  });
});

function mk(opts: { action?: Record<string, unknown> | null; counts?: { numerator: number; denominator: number }; checks?: number; updated?: number; owner?: boolean } = {}) {
  const action = opts.action === undefined ? {
    id: 'a1', indicatorKey: 'NO_DIAGNOSIS', status: 'DO', baselineFrom: new Date('2026-08-01T00:00:00+09:00'), baselineTo: new Date('2026-09-01T00:00:00+09:00'),
    baselineNumerator: 300, baselineDenominator: 1000,
  } : opts.action;
  const tx: any = {
    qiImprovementAction: { create: vi.fn(async (a: any) => ({ id: 'new', ...a.data })), updateMany: vi.fn(async () => ({ count: opts.updated ?? 1 })), findUnique: vi.fn(async () => action) },
    qiImprovementEvent: { create: vi.fn(async (a: any) => ({ id: 'e1', ...a.data })) },
  };
  const prisma: any = {
    ...tx,
    qiImprovementAction: { ...tx.qiImprovementAction, findUnique: vi.fn(async () => action) },
    qiImprovementEvent: { ...tx.qiImprovementEvent, count: vi.fn(async () => opts.checks ?? 0) },
    user: { findUnique: vi.fn(async () => (opts.owner === false ? null : { id: 'u2' })), findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const quality: any = { countPeriod: vi.fn(async () => opts.counts ?? { numerator: 150, denominator: 1000 }) };
  return { svc: new CpoeImprovementService(prisma, quality), prisma, tx, quality };
}
const base = { indicatorKey: 'NO_DIAGNOSIS' as const, title: '상병 연결', problem: '관리도 신호', plan: '처방 창에서 상병 필수 안내', baselineFrom: '2026-08-01', baselineTo: '2026-08-31' };

describe('개선 활동', () => {
  it('🔴 기준선은 서버가 병원 전체로 센다 · CREATED 경과', async () => {
    const { svc, quality, tx } = mk({ counts: { numerator: 40, denominator: 100 } });
    const a = await svc.create(base, 'admin');
    expect(quality.countPeriod).toHaveBeenCalledWith('NO_DIAGNOSIS', expect.objectContaining({ from: expect.any(Date), to: expect.any(Date) }));
    expect(a).toMatchObject({ baselineNumerator: 40, baselineDenominator: 100, createdBy: 'admin' });
    expect(tx.qiImprovementEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'CREATED', toStatus: 'PLAN' }) });
  });

  it('🔴 표본 없는 기준선 거절 · 없는 담당자 거절', async () => {
    await expect(mk({ counts: { numerator: 0, denominator: 0 } }).svc.create(base, 'admin')).rejects.toMatchObject({ response: { code: 'CPOE_QI_BASELINE_EMPTY' } });
    await expect(mk({ owner: false }).svc.create({ ...base, ownerId: '00000000-0000-4000-8000-000000000009' }, 'admin')).rejects.toMatchObject({ response: { code: 'CPOE_QI_OWNER_NOT_FOUND' } });
  });

  it('🔴 정해진 전이만 · 종결·취소는 사유 필요', async () => {
    await expect(mk({ action: { id: 'a1', status: 'PLAN' } }).svc.transition('a1', { to: 'ACT' }, 'admin')).rejects.toMatchObject({ response: { code: 'CPOE_QI_TRANSITION' } });
    await expect(mk({ action: { id: 'a1', status: 'ACT' } }).svc.transition('a1', { to: 'CLOSED', note: '  ' }, 'admin')).rejects.toMatchObject({ response: { code: 'CPOE_QI_NOTE_REQUIRED' } });
    const ok = mk({ action: { id: 'a1', status: 'ACT' } });
    await ok.svc.transition('a1', { to: 'CLOSED', note: '처방 창 안내 표준화' }, 'admin');
    expect(ok.tx.qiImprovementAction.updateMany).toHaveBeenCalledWith({ where: { id: 'a1', status: 'ACT' }, data: { status: 'CLOSED', closedAt: expect.any(Date) } });
  });

  it('🔴 CHECK→ACT 는 효과 확인 기록이 있어야 · 대조군: 있으면 간다', async () => {
    await expect(mk({ action: { id: 'a1', status: 'CHECK' }, checks: 0 }).svc.transition('a1', { to: 'ACT' }, 'admin')).rejects.toMatchObject({ response: { code: 'CPOE_QI_CHECK_REQUIRED' } });
    await expect(mk({ action: { id: 'a1', status: 'CHECK' }, checks: 1 }).svc.transition('a1', { to: 'ACT' }, 'admin')).resolves.toBeTruthy();
  });

  it('🔴 동시 전이 — 다른 사람이 먼저 바꿨으면 409(덮지 않는다)', async () => {
    await expect(mk({ action: { id: 'a1', status: 'PLAN' }, updated: 0 }).svc.transition('a1', { to: 'DO' }, 'admin')).rejects.toMatchObject({ response: { code: 'CPOE_QI_STALE' } });
  });

  it('🔴 효과 확인 — 계획 단계 거절 · 기준선과 겹치는 기간 거절 · 서버가 다시 센 수로 기록', async () => {
    await expect(mk({ action: { id: 'a1', status: 'PLAN', baselineTo: new Date('2026-09-01T00:00:00+09:00') } }).svc.check('a1', { from: '2026-09-01', to: '2026-09-30' }, 'admin')).rejects.toMatchObject({ response: { code: 'CPOE_QI_CHECK_STATUS' } });
    await expect(mk().svc.check('a1', { from: '2026-08-15', to: '2026-09-30' }, 'admin')).rejects.toMatchObject({ response: { code: 'CPOE_QI_CHECK_OVERLAP' } });
    const { svc, prisma, quality } = mk({ counts: { numerator: 150, denominator: 1000 } });
    const r = await svc.check('a1', { from: '2026-09-01', to: '2026-09-30' }, 'admin');
    expect(quality.countPeriod).toHaveBeenCalledWith('NO_DIAGNOSIS', expect.anything());
    expect(prisma.qiImprovementEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'CHECK', checkNumerator: 150, checkDenominator: 1000 }) });
    // 상병 미연결은 낮을수록(등재 방향) — 30% → 15% 는 바람직한 쪽
    expect(r.effect).toMatchObject({ direction: 'LOWER_IS_BETTER', favorable: true });
    expect(r.effect!.diff!.diff).toBeCloseTo(-0.15);
  });

  it('🔴 방향이 등재되지 않은 관찰 지표는 좋고 나쁨을 말하지 않는다', async () => {
    const { svc } = mk({ action: { id: 'a1', indicatorKey: 'VERBAL_RATE', status: 'DO', baselineTo: new Date('2026-09-01T00:00:00+09:00'), baselineNumerator: 300, baselineDenominator: 1000 }, counts: { numerator: 100, denominator: 1000 } });
    const r = await svc.check('a1', { from: '2026-09-01', to: '2026-09-30' }, 'admin');
    expect(r.effect).toMatchObject({ direction: null, favorable: null });
    // 이름 보조신호(HINT)로만 방향이 잡히는 지표('처방 취소율' → '취소율')도 좋고 나쁨을 말하지 않는다
    const hint = mk({ action: { id: 'a1', indicatorKey: 'RX_CANCEL_RATE', status: 'DO', baselineTo: new Date('2026-09-01T00:00:00+09:00'), baselineNumerator: 300, baselineDenominator: 1000 }, counts: { numerator: 100, denominator: 1000 } });
    expect((await hint.svc.check('a1', { from: '2026-09-01', to: '2026-09-30' }, 'admin')).effect).toMatchObject({ direction: null, favorable: null });
  });
});
