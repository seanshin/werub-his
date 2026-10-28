import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLOW_STAGES } from '../../src/sentinel/flow-registry';
import { SentinelService } from '../../src/sentinel/sentinel.service';
import { SentinelReadService } from '../../src/sentinel/sentinel-read.service';

const REPO_ROOT = join(process.cwd(), '..', '..');

/**
 * 축 B — 흐름 완결성.
 *
 * 🔴 이 축의 유일한 계약: **표본이 없으면 임계를 만들지 않는다.**
 *    2026-09-02 운영 실측 표본은 단계당 12~16건(외래 완료 총 4건)이었고,
 *    그 표본으로 뽑은 p95 는 564분 — 이상치 하나가 만든 값이다.
 *    그 위에 판정을 얹으면 이 축이 거짓 경보 공장이 된다.
 */
function mockPrisma(dist: { n: number; p50: number | null; p95: number | null }, pending = 0) {
  const runs: Record<string, unknown>[] = [];
  const findings = new Map<string, Record<string, unknown>>();
  const queries: { sql: string; params: unknown[] }[] = [];
  return {
    runs, findings, queries,
    sentinelRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `r${runs.length}`, ...data, ok: false }; runs.push(row); return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(runs.find((r) => r.id === where.id)!, data); return {};
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const list = runs.filter((r) => r.axis === where.axis && (where.ok === undefined || r.ok === where.ok));
        return list.length ? list[list.length - 1] : null;
      }),
    },
    sentinelFinding: {
      findUnique: vi.fn(async ({ where }: { where: { axis_checkKey: { axis: string; checkKey: string } } }) =>
        findings.get(`${where.axis_checkKey.axis}|${where.axis_checkKey.checkKey}`) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { axis_checkKey: { axis: string; checkKey: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const k = `${where.axis_checkKey.axis}|${where.axis_checkKey.checkKey}`;
        const cur = findings.get(k);
        findings.set(k, cur ? { ...cur, ...update } : { ...create });
        return {};
      }),
      findMany: vi.fn(async () => [...findings.values()]),
    },
    sentinelRuntimeSignal: { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) },
    $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      queries.push({ sql, params });
      return sql.includes('percentile_cont') ? [dist] : [{ n: pending }];
    }),
  };
}

describe('축 B — 표본이 없으면 임계를 만들지 않는다', () => {
  it('🔴 운영 실측 표본(12건)으로는 임계를 세우지 않고 관측 불가로 남긴다', async () => {
    const prisma = mockPrisma({ n: 12, p50: 47.5, p95: 894.5 });
    const r = await new SentinelService(prisma as never).sweepFlow();
    expect(r.attempted).toBe(FLOW_STAGES.length);
    expect(r.ok).toBe(true);

    for (const st of FLOW_STAGES) {
      const f = prisma.findings.get(`FLOW|${st.key}`)!;
      expect(f.unobservable, `${st.key} 가 표본 12건으로 판정했다`).toBe(true);
      expect(f.detail).toMatch(/표본 12건 — 임계 산출에 최소 \d+건/);
      expect(f.resolvedAt, '표본 부족은 해결이 아니다').toBeNull();
    }
  });

  it('🔴 표본이 부족하면 진행 건 조회를 아예 하지 않는다(없는 임계로 세지 않는다)', async () => {
    const prisma = mockPrisma({ n: 12, p50: 1, p95: 100 });
    await new SentinelService(prisma as never).sweepFlow();
    const pendingQueries = prisma.queries.filter((q) => !q.sql.includes('percentile_cont'));
    expect(pendingQueries.length, '임계가 없는데 초과 건을 셌다').toBe(0);
  });

  it('표본이 차면 임계(p95×2)를 세우고 초과 진행 건을 센다', async () => {
    const prisma = mockPrisma({ n: 500, p50: 8, p95: 30 }, 4);
    await new SentinelService(prisma as never).sweepFlow();
    const f = prisma.findings.get(`FLOW|${FLOW_STAGES[0].key}`)!;
    expect(f.unobservable).toBe(false);
    expect(f.value).toBe(4);
    expect(f.detail).toMatch(/임계 60분\(표본 500건 · p95 30분 × 2 · 중앙값 8분\)/);
    const pend = prisma.queries.find((q) => !q.sql.includes('percentile_cont'))!;
    expect(pend.params[0], '임계가 파라미터로 넘어가야 한다').toBe(60);
  });

  it('임계가 서고 초과가 0이면 해결로 접는다(대조군 — 정상을 실패로 말하지 않는다)', async () => {
    const prisma = mockPrisma({ n: 500, p50: 8, p95: 30 }, 0);
    await new SentinelService(prisma as never).sweepFlow();
    const f = prisma.findings.get(`FLOW|${FLOW_STAGES[0].key}`)!;
    expect(f.unobservable).toBe(false);
    expect(f.value).toBe(0);
    expect(f.resolvedAt).not.toBeNull();
  });

  it('🔴 p95 가 null 이면(전이 표본이 하나도 없음) 임계를 만들지 않는다', async () => {
    const prisma = mockPrisma({ n: 500, p50: null, p95: null });
    await new SentinelService(prisma as never).sweepFlow();
    const f = prisma.findings.get(`FLOW|${FLOW_STAGES[0].key}`)!;
    expect(f.unobservable).toBe(true);
  });

  it('분포 조회가 실패하면 관측 불가이지 "지연 0건"이 아니다', async () => {
    const prisma = mockPrisma({ n: 500, p50: 8, p95: 30 });
    prisma.$queryRawUnsafe = vi.fn(async () => { throw new Error('DB 불달'); }) as never;
    const r = await new SentinelService(prisma as never).sweepFlow();
    expect(r.ok).toBe(true); // 스윕 자체는 완주한다
    const f = prisma.findings.get(`FLOW|${FLOW_STAGES[0].key}`)!;
    expect(f.unobservable).toBe(true);
    expect(f.detail).toMatch(/분포 조회 실패/);
  });
});

describe('축 B 등록부 — 근거와 최소 표본이 있다', () => {
  it('🔴 최소 표본을 근거 없이 낮추지 않는다', () => {
    for (const st of FLOW_STAGES) {
      expect(st.minSample, `${st.key} 의 최소 표본이 너무 낮다 — 이상치 하나가 임계를 지배한다`)
        .toBeGreaterThanOrEqual(100);
    }
  });

  it('단계마다 왜 이 항목인지 근거가 있다', () => {
    for (const st of FLOW_STAGES) expect(st.why.length, st.key).toBeGreaterThan(20);
  });

  it('🔴 딥링크는 실재하는 화면만', () => {
    for (const st of FLOW_STAGES.filter((x) => x.drillDown)) {
      const page = join(REPO_ROOT, 'apps/web/src/app/(main)', st.drillDown!.replace(/^\//, ''), 'page.tsx');
      expect(() => readFileSync(page, 'utf-8'), `${st.key} → ${st.drillDown} 화면이 없습니다`).not.toThrow();
    }
  });

  it('🔴 시각 역전을 축 A 와 중복해 세지 않는다 — 분포에서 제외만 한다', () => {
    for (const st of FLOW_STAGES) {
      expect(st.distSql, `${st.key} 가 역전 행을 표본에 넣고 있다`).toMatch(/>=/);
    }
  });

  it('진행 건 조회는 임계를 파라미터로 받는다(하드코딩 금지)', () => {
    for (const st of FLOW_STAGES) expect(st.pendingSql, st.key).toContain('$1');
  });
});

describe('축 B 읽기 — 표본 부족을 "지연 0건"으로 그리지 않는다', () => {
  it('전 단계가 표본 부족이면 위반 0 · 관측 불가 N 으로 나온다', async () => {
    const prisma = mockPrisma({ n: 12, p50: 1, p95: 100 });
    await new SentinelService(prisma as never).sweepFlow();
    const { axes } = await new SentinelReadService(prisma as never).overview();
    const flow = axes.find((a) => a.key === 'FLOW')!;
    expect(flow.open).toBe(0);
    expect(flow.unobservable, '표본 부족이 관측 불가로 세어져야 한다').toBe(FLOW_STAGES.length);
  });
});
