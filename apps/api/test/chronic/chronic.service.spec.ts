import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChronicService } from '../../src/modules/chronic/chronic.service';

describe('ChronicService.getTrend', () => {
  let svc: ChronicService;
  let prisma: any;

  beforeEach(() => {
    prisma = { chronicObservation: { findMany: vi.fn() } };
    svc = new ChronicService(prisma);
  });

  it('코드별 시계열 그룹핑 + 최신/Δ 요약', async () => {
    prisma.chronicObservation.findMany.mockResolvedValue([
      { code: 'HBA1C', value: 8.0, unit: '%', measuredAt: new Date('2026-01-01'), flag: 'H', normalMin: 4, normalMax: 6.5 },
      { code: 'HBA1C', value: 7.2, unit: '%', measuredAt: new Date('2026-04-01'), flag: 'H', normalMin: 4, normalMax: 6.5 },
      { code: 'FBS', value: 130, unit: 'mg/dL', measuredAt: new Date('2026-04-01'), flag: 'H', normalMin: 70, normalMax: 100 },
    ]);
    const r = await svc.getTrend('p1', {});
    expect(r.series.HBA1C).toHaveLength(2);
    expect(r.series.FBS).toHaveLength(1);
    expect(r.summary.HBA1C.latest).toBe(7.2);
    expect(r.summary.HBA1C.delta).toBe(-0.8); // 8.0→7.2 개선
    expect(r.summary.HBA1C.count).toBe(2);
    expect(r.summary.FBS.delta).toBeNull(); // 1건이면 Δ 없음
  });

  it('codes·기간 필터를 where 에 반영', async () => {
    prisma.chronicObservation.findMany.mockResolvedValue([]);
    await svc.getTrend('p1', { codes: ['HBA1C', 'FBS'], from: new Date('2026-01-01'), to: new Date('2026-06-01'), limit: 100 });
    const arg = prisma.chronicObservation.findMany.mock.calls[0][0];
    expect(arg.where.code).toEqual({ in: ['HBA1C', 'FBS'] });
    expect(arg.where.measuredAt.gte).toEqual(new Date('2026-01-01'));
    expect(arg.where.measuredAt.lte).toEqual(new Date('2026-06-01'));
    expect(arg.take).toBe(100);
  });
});
