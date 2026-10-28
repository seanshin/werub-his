import { describe, it, expect, vi } from 'vitest';
import { RadiationService } from '../../src/modules/radiation/radiation.service';

/**
 * '조사 중'(DELIVERING) 고착 분할 정리(2026-10-10).
 * 🔴 조사 중은 조사 기록 트랜잭션 안에서만 거치는 상태인데 운영에 남은 분할이 2건 있었다 —
 *    조사 기록·취소가 예정(SCHEDULED)만 받아 **어떤 화면에서도 닫을 수 없었고** 계획 완료도 막혔다.
 *  · 조사됨: 치료기 기록의 선량·시각을 사람이 넣는다(추정·지금 시각 금지) · 조사 안 됨: 취소 · 사유 필수
 */
const NOW = new Date('2026-10-10T06:00:00Z');
const PLAN = { id: 'plan1', totalDose: 60, fractionDose: 2 };

function build(fraction: any, others: any[] = []) {
  const updates: any[] = [];
  const tx: any = {
    $queryRaw: vi.fn(async () => []),
    radiationFraction: {
      findMany: vi.fn(async () => others),
      updateMany: vi.fn(async (a: any) => { updates.push(a); return { count: fraction.status === a.where.status ? 1 : 0 }; }),
      findUnique: vi.fn(async () => ({ ...fraction, ...(updates[0]?.data ?? {}) })),
    },
  };
  const prisma: any = {
    radiationFraction: {
      findUnique: vi.fn(async () => (fraction ? { ...fraction, plan: PLAN } : null)),
      updateMany: tx.radiationFraction.updateMany,
    },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  prisma.radiationFraction.findUnique.mockImplementationOnce(async () => (fraction ? { ...fraction, plan: PLAN } : null));
  const svc = new RadiationService(prisma as never);
  return { svc, updates };
}
const STUCK = { id: 'f9', planId: 'plan1', status: 'DELIVERING', deliveredDose: null };

describe('조사 중 고착 정리', () => {
  it('🔴 조사됨 — 치료기 선량·시각 그대로 · 누적은 기록된 선량 합 · 조사자는 채우지 않는다', async () => {
    const { svc, updates } = build(STUCK, [{ deliveredDose: '2' }, { deliveredDose: '2' }]);
    const r = await svc.resolveStuckFraction('f9', { outcome: 'DELIVERED', reason: '치료기 로그 확인', deliveredDose: 2, deliveredAt: '2026-05-27T01:00:00Z' }, NOW);
    expect(updates[0].where).toEqual({ id: 'f9', status: 'DELIVERING' });
    expect(updates[0].data.status).toBe('DELIVERED');
    expect(updates[0].data.deliveredAt).toEqual(new Date('2026-05-27T01:00:00Z'));
    expect(Number(updates[0].data.deliveredDose)).toBe(2);
    expect(Number(updates[0].data.cumulativeDose)).toBe(6);
    expect(updates[0].data.notes).toBe('치료기 로그 확인');
    expect(updates[0].data).not.toHaveProperty('therapistId');
    expect(r.warnings).toEqual([]);
  });

  it('조사 안 됨 — 취소 + 사유 · 선량 없음', async () => {
    const { svc, updates } = build(STUCK);
    await svc.resolveStuckFraction('f9', { outcome: 'NOT_DELIVERED', reason: '치료기 기록 없음' }, NOW);
    expect(updates[0].data).toEqual({ status: 'CANCELLED', notes: '치료기 기록 없음' });
  });

  it('🔴 선량·시각을 지어내지 않는다 — 없으면 400 · 미래 시각 400 · 사유 없으면 400', async () => {
    const { svc } = build(STUCK);
    await expect(svc.resolveStuckFraction('f9', { outcome: 'DELIVERED', reason: 'x', deliveredAt: '2026-05-27T01:00:00Z' }, NOW)).rejects.toMatchObject({ response: { code: 'RT_FRACTION_RESOLVE_DOSE_REQUIRED' } });
    await expect(build(STUCK).svc.resolveStuckFraction('f9', { outcome: 'DELIVERED', reason: 'x', deliveredDose: 2 }, NOW)).rejects.toMatchObject({ response: { code: 'RT_FRACTION_RESOLVE_TIME_REQUIRED' } });
    await expect(build(STUCK).svc.resolveStuckFraction('f9', { outcome: 'DELIVERED', reason: 'x', deliveredDose: 2, deliveredAt: '2026-10-11T00:00:00Z' }, NOW)).rejects.toMatchObject({ response: { code: 'RT_FRACTION_RESOLVE_TIME_FUTURE' } });
    await expect(build(STUCK).svc.resolveStuckFraction('f9', { outcome: 'NOT_DELIVERED', reason: '  ' }, NOW)).rejects.toMatchObject({ response: { code: 'RT_FRACTION_RESOLVE_REASON_REQUIRED' } });
  });

  it('대조군 — 예정·조사 완료 분할은 이 경로로 바꾸지 않는다', async () => {
    for (const status of ['SCHEDULED', 'DELIVERED', 'CANCELLED']) {
      const { svc, updates } = build({ ...STUCK, status });
      await expect(svc.resolveStuckFraction('f9', { outcome: 'NOT_DELIVERED', reason: 'x' }, NOW)).rejects.toMatchObject({ response: { code: 'RT_FRACTION_NOT_STUCK' } });
      expect(updates).toEqual([]);
    }
  });

  it('처방과 다른 선량·처방 총선량 초과는 막지 않고 경고(이미 일어난 조사의 기록)', async () => {
    const { svc } = build(STUCK, [{ deliveredDose: '59' }]);
    const r = await svc.resolveStuckFraction('f9', { outcome: 'DELIVERED', reason: '로그', deliveredDose: 3, deliveredAt: '2026-05-27T01:00:00Z' }, NOW);
    expect(r.warnings).toEqual(['FRACTION_DOSE_DIFFERS', 'CUMULATIVE_OVER_PRESCRIBED']);
  });
});
