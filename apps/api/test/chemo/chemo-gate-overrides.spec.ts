import { describe, it, expect, vi } from 'vitest';
import { ChemoService, GATE_OVERRIDE_LIMIT } from '../../src/modules/chemo/chemo.service';

/**
 * 항암 점검 우회 이력(2026-10-10) — nadir 게이트를 통과하지 못한 채 시작된 사이클.
 * 원장 = 사이클 시작 순간의 gateResult 스냅샷(startedDespiteFail: 누가·언제·오버라이드·사유).
 * 🔴 OFF 모드 시작은 우회가 아니다 · 누가·왜가 없는 옛 시작은 recorded:false(지어내지 않는다) · 상한+전체 수.
 */
const cyc = (o: any = {}) => ({
  id: 'c1', cycleNumber: 2, startedAt: new Date('2026-10-10T01:00:00Z'), status: 'IN_PROGRESS',
  gateResult: { pass: false, mode: 'BLOCK', checks: [{ name: '혈소판', value: '80', unit: 'k', min: 100000, pass: false, reason: '기준 미만' }, { name: 'ANC', value: '2000', unit: null, min: 1500, pass: true }], startedDespiteFail: { by: 'u1', at: '2026-10-10T01:00:00Z', override: true, reason: '감량 투여' } },
  course: { id: 'k1', patientId: 'p1', patient: { mrn: 'M1', familyName: '김', givenName: '환자' }, regimen: { code: 'FOLFOX', name: 'FOLFOX' } },
  ...o,
});
function svc(rows: any[], total = rows.length) {
  const prisma: any = {
    chemoCycle: { count: vi.fn(async () => total), findMany: vi.fn(async () => rows) },
    user: { findMany: vi.fn(async () => [{ id: 'u1', familyName: '이', givenName: '의사' }]) },
  };
  return { s: new ChemoService(prisma, {} as never, {} as never, {} as never), prisma };
}

describe('ChemoService.gateOverrides', () => {
  it('🔴 조회 조건 — 시작된 사이클 · 게이트 미통과 · OFF 모드 제외 · 기간·환자', async () => {
    const { s, prisma } = svc([]);
    await s.gateOverrides({ from: '2026-10-01', to: '2026-10-10', patientId: 'p1' });
    const w = prisma.chemoCycle.findMany.mock.calls[0][0].where;
    expect(w.AND).toEqual([{ gateResult: { path: ['pass'], equals: false } }, { NOT: { gateResult: { path: ['mode'], equals: 'OFF' } } }]);
    expect(w.startedAt.not).toBeNull();
    expect(w.startedAt.gte).toBeInstanceOf(Date);
    expect(w.startedAt.lt).toBeInstanceOf(Date);
    expect(w.course).toEqual({ patientId: 'p1' });
    expect(prisma.chemoCycle.findMany.mock.calls[0][0].take).toBe(GATE_OVERRIDE_LIMIT);
    expect(prisma.chemoCycle.count.mock.calls[0][0].where).toEqual(w);
  });

  it('누가(이름)·사유·미통과 항목만', async () => {
    const r = await svc([cyc()]).s.gateOverrides({});
    expect(r.items[0]).toMatchObject({ recorded: true, override: true, reason: '감량 투여', byName: '이의사', patientName: '김환자', mode: 'BLOCK' });
    expect(r.items[0].failedChecks.map((c) => c.name)).toEqual(['혈소판']);
  });

  it('🔴 누가·왜가 남지 않은 시작은 recorded:false — 사람을 지어내지 않는다', async () => {
    const { s, prisma } = svc([cyc({ gateResult: { pass: false, mode: 'WARN', checks: [] } })]);
    const r = await s.gateOverrides({});
    expect(r.items[0]).toMatchObject({ recorded: false, override: null, reason: null, byId: null, byName: null });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('잘림 — 전체 수와 함께', async () => {
    const r = await svc([cyc()], 350).s.gateOverrides({});
    expect(r).toMatchObject({ total: 350, truncated: true, limit: GATE_OVERRIDE_LIMIT });
  });

  it('잘못된 날짜는 400', async () => {
    await expect(svc([]).s.gateOverrides({ from: '2026-13-40' })).rejects.toMatchObject({ status: 400 });
  });
});
