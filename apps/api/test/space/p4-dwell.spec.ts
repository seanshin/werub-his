import { describe, it, expect, vi } from 'vitest';
import { DWELL_MIN_SAMPLE } from '@hospital-run/shared';
import { MetaverseService } from '../../src/modules/metaverse/metaverse.service';

/**
 * P4b — 구역별 체류 분석(`GET /api/v1/metaverse/dwell`).
 *   ① 표본 < DWELL_MIN_SAMPLE → p50/p90 null(0 도 폴백도 아님) · 관측·추정은 다른 열
 *   ② 병목 순위 = 관측 p90 산출 구역만 앞 · 추정 p90 이 커도 순위를 매기지 않는다
 *   ③ 기간 검증(1~90 정수) → 400 코드 · SQL 이 시뮬레이션을 표본에서 빼고 층 단위를 뺀다(뺀 수는 따로)
 * 백분위 계산 자체는 로컬 PG 트랜잭션에서 실측(10·20·30·40·50분 → p50 30·p90 46 · 롤백).
 */
const Z = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function svc(rows: any[], excluded = { simulated: 3, unknown: 2, floorOnly: 1 }) {
  const sqls: string[] = [];
  const prisma: any = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      sqls.push(sql);
      return /AS simulated/.test(sql) ? [excluded] : rows;
    }),
    spaceNode: { findMany: vi.fn(async () => [{ id: Z(1), name: '채혈실', floor: -1 }, { id: Z(2), name: '초음파실', floor: -1 }, { id: Z(3), name: '약국', floor: 1 }]) },
  };
  return { s: new MetaverseService(prisma), sqls };
}
const row = (zoneId: string, cls: string, n: number, p50: number, p90: number) => ({ zoneId, cls, n, open: 0, invalid: 0, p50, p90 });

describe('① 표본 부족 · 관측/추정 분리', () => {
  it('관측 n<최소 → null · 추정은 별도 열 · 합치지 않는다', async () => {
    const { s } = svc([row(Z(1), 'OBSERVED', DWELL_MIN_SAMPLE - 1, 9, 40), row(Z(1), 'INFERRED', 50, 3, 12)]);
    const r = await s.getDwell('7');
    expect(r.zones[0].observed).toMatchObject({ n: DWELL_MIN_SAMPLE - 1, p50: null, p90: null });
    expect(r.zones[0].inferred).toMatchObject({ n: 50, p50: 3, p90: 12 });
    expect(r.rankedZones).toBe(0);
    expect(r.totals).toEqual({ observed: DWELL_MIN_SAMPLE - 1, inferred: 50 });
  });
});

describe('② 병목 순위', () => {
  it('관측 p90 큰 순 · 추정만 큰 구역은 뒤', async () => {
    const { s } = svc([
      row(Z(1), 'OBSERVED', 6, 10, 20),
      row(Z(2), 'OBSERVED', 8, 15, 45),
      row(Z(3), 'INFERRED', 90, 60, 300),
    ]);
    const r = await s.getDwell();
    expect(r.zones.map((z) => z.name)).toEqual(['초음파실', '채혈실', '약국']);
    expect(r.rankedZones).toBe(2);
    expect(r.windowDays).toBe(7);
    expect(r.excluded).toEqual({ simulated: 3, unknown: 2, floorOnly: 1 });
  });
});

describe('③ 기간 검증 · SQL 조건', () => {
  it('정수 1~90 외는 400(DWELL_DAYS_INVALID)', async () => {
    for (const d of ['0', '91', '1.5', 'abc']) {
      await expect(svc([]).s.getDwell(d)).rejects.toMatchObject({ response: { code: 'DWELL_DAYS_INVALID' } });
    }
  });
  it('표본 SQL: 구역 단위만 · 관측 출처 또는 INFERRED_EVENT 만(시뮬레이션·미상 제외) · 떠난 시각 > 들어온 시각만', async () => {
    const { s, sqls } = svc([]);
    await s.getDwell('30');
    const main = sqls.find((q) => /percentile_cont/.test(q))!;
    expect(main).toMatch(/granularity = 'ZONE'/);
    expect(main).toMatch(/pl\.source = 'INFERRED_EVENT'/);
    expect(main).not.toMatch(/SIMULATED/);
    expect(main).toMatch(/FILTER \(WHERE pl\.left_at > pl\.entered_at\)\s*\/ 60/);
  });
});
