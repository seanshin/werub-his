import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { judgePulse, judgeSample, median, mad, percentile } from '../../src/sentinel/pulse-anomaly';
import { PULSE_METRICS, PULSE_MIN_BASELINE, type PulseMetricDef } from '../../src/sentinel/pulse-registry';
import { SentinelService } from '../../src/sentinel/sentinel.service';

const REPO_ROOT = join(process.cwd(), '..', '..');
const def = (over: Partial<PulseMetricDef> = {}): PulseMetricDef => ({
  key: 't', label: 't', sql: '', minDelta: 10, severity: 'AMBER', why: 'x'.repeat(25), ...over,
});
/** 평상시 값들 — 약간의 자연 변동을 준다 */
const flatish = (n: number, base: number) => Array.from({ length: n }, (_, i) => base + (i % 5) - 2);

describe('급변 판정 — 판정할 수 없을 때 판정하지 않는다', () => {
  it('🔴 baseline 이 모자라면 판정하지 않고 축적 상황을 말한다', () => {
    const v = judgePulse(def(), flatish(50, 100), 500);
    expect(v.kind).toBe('WARMING');
    if (v.kind === 'WARMING') {
      expect(v.have).toBe(50);
      expect(v.need).toBe(PULSE_MIN_BASELINE);
      expect(v.detail).toMatch(/표본 없이 임계를 만들지 않습니다/);
    }
  });

  it('🔴 변동이 없던 지표는 z 가 무한대가 된다 — 그것만으로 경보하지 않는다', () => {
    // 항상 정확히 2였던 지표가 3이 됨(minDelta 3 미만)
    const v = judgePulse(def({ minDelta: 3 }), Array(200).fill(2), 3);
    expect(v.kind, '1건 변동으로 사람을 깨우면 안 된다').toBe('FLAT');
    if (v.kind === 'FLAT') expect(v.detail).toMatch(/변동이 없어 이탈을 잴 수 없습니다/);
  });

  it('변동이 없던 지표라도 절대 변화가 크면 급변이다', () => {
    const v = judgePulse(def({ minDelta: 3 }), Array(200).fill(2), 40);
    expect(v.kind).toBe('ANOMALY');
    if (v.kind === 'ANOMALY') expect(v.detail).toMatch(/절대 변화로 판정/);
  });

  it('🔴 z 가 커도 절대 변화가 작으면 급변이 아니다 — minDelta 하한', () => {
    const v = judgePulse(def({ minDelta: 50 }), flatish(200, 10), 30); // z 는 크지만 +20
    expect(v.kind).toBe('NORMAL');
  });

  it('🔴 절대 변화가 커도 평상시 변동 범위 안이면 급변이 아니다', () => {
    // 평상시 0~1000 을 오가는 지표에서 +30 은 일상이다
    const noisy = Array.from({ length: 200 }, (_, i) => (i * 137) % 1000);
    const v = judgePulse(def({ minDelta: 10 }), noisy, median(noisy) + 30);
    expect(v.kind).toBe('NORMAL');
  });

  it('평상시 범위를 크게 벗어나고 변화폭도 크면 급변이다(대조군 — 진짜는 잡는다)', () => {
    const v = judgePulse(def({ minDelta: 10 }), flatish(200, 100), 400);
    expect(v.kind).toBe('ANOMALY');
    if (v.kind === 'ANOMALY') expect(v.detail).toMatch(/증가 폭/);
  });

  it('🔴 감소를 봐야 하는 지표는 줄어들 때 잡는다(쓰기 정지)', () => {
    const d = def({ watchDrop: true, minDelta: 10 });
    expect(judgePulse(d, flatish(200, 100), 5).kind, '쓰기가 멈췄는데 정상이라 하면 안 된다').toBe('ANOMALY');
    // 반대 방향(증가)은 이 지표에서 이상이 아니다
    expect(judgePulse(d, flatish(200, 100), 400).kind).toBe('NORMAL');
  });

  it('중앙값·MAD 가 이상치에 끌려가지 않는다', () => {
    const xs = [10, 10, 10, 10, 10, 10, 10, 10, 10, 100000];
    expect(median(xs)).toBe(10);
    expect(mad(xs, 10)).toBe(0);
  });
});

/**
 * AI 판단 거버넌스 감독 지표 2종(기획 §2.3 · 2026-09-09).
 *
 * 🔴 이 두 지표가 지키는 사실:
 *    ① 비율은 분모가 모자라면 **내지 않는다**(0 도 폴백도 아니다)
 *    ② 희소 축의 임계는 **자기 이력 p95×2** 에서만 나온다 — 절대값을 박지 않는다
 *    ③ 표본이 모자라면 판정하지 않는다(미판정 ≠ 정상 ≠ 0)
 */
describe('AI 제안 감독 지표 — 산출 불가와 0 을 섞지 않는다', () => {
  const rejectRate = PULSE_METRICS.find((m) => m.key === 'ai.proposal.rejectRate.1h')!;
  const quickAccept = PULSE_METRICS.find((m) => m.key === 'ai.proposal.quickAccept.1h')!;

  it('두 지표가 실시간 축 정본에 등재돼 있다(화면은 정본에서 파생한다)', () => {
    expect(rejectRate, 'ai.proposal.rejectRate.1h 가 없다').toBeDefined();
    expect(quickAccept, 'ai.proposal.quickAccept.1h 가 없다').toBeDefined();
  });

  /* ── ① 거부율 — 표본 게이트 ── */

  it('🔴 분모 10건 미만이면 산출 불가다 — 0 이 아니다', () => {
    expect(rejectRate.minSample).toBe(10);
    const v = judgeSample(rejectRate, 3)!;
    expect(v.kind).toBe('NOT_COMPUTABLE');
    expect(v).toMatchObject({ have: 3, need: 10 });
    expect(v.detail).toMatch(/0 이라는 뜻이 아닙니다/);
  });

  it('표본이 차면 게이트가 열린다(대조군 — 항상 산출 불가라 말하면 지표가 죽는다)', () => {
    expect(judgeSample(rejectRate, 10)).toBeNull();
    expect(judgeSample(rejectRate, 999)).toBeNull();
    // 게이트가 없는 지표에는 아무 말도 하지 않는다
    expect(judgeSample(quickAccept, 0)).toBeNull();
  });

  it('🔴 분모는 사람이 결정한 건만 — 만료(EXPIRED)를 섞으면 거부율이 부풀려진다', () => {
    expect(rejectRate.sql).toMatch(/status IN \('ACCEPTED','EDITED','REJECTED'\)/);
    expect(rejectRate.sql, '만료를 분모에 넣지 않는다').not.toMatch(/EXPIRED/);
    expect(rejectRate.sql).toMatch(/interval '1 hour'/);
  });

  /* ── ② 5초 미만 승인 — 자기 이력 p95×2 ── */

  it("🔴 노출 기록이 없는 건을 '0초 검토'로 세지 않는다", () => {
    expect(quickAccept.sql).toMatch(/presented_at IS NOT NULL/);
    // 시계 아티팩트(역전)는 표본에서 뺀다 — 역전 자체는 정합성 축이 센다
    expect(quickAccept.sql).toMatch(/decided_at >= presented_at/);
    expect(quickAccept.sql).toMatch(/interval '5 seconds'/);
  });

  it('임계 규칙이 자기 이력 p95×2 다', () => {
    expect(quickAccept.thresholdRule).toBe('P95_X2');
  });

  it('🔴 표본이 모자라면 판정하지 않는다(미판정 — 정상이라 그리지 않는다)', () => {
    const v = judgePulse(quickAccept, Array(PULSE_MIN_BASELINE - 1).fill(0), 50);
    expect(v.kind).toBe('WARMING');
  });

  it('p95×2 를 넘고 절대 하한도 넘으면 급변이다', () => {
    // 평상시 대부분 1, 가끔 4 → p95 ≈ 4, 임계 ≈ 8
    const base = [...Array(190).fill(1), ...Array(10).fill(4)];
    const p95 = percentile(base, 0.95)!;
    expect(p95).toBeGreaterThan(0);
    const v = judgePulse(quickAccept, base, Math.ceil(p95 * 2) + 10);
    expect(v.kind).toBe('ANOMALY');
    expect(v.detail).toMatch(/p95/);
    // z 는 이 규칙에서 재지 않는다 — 0 으로 채우면 재지 않은 통계를 잰 척하게 된다
    expect((v as { z: number | null }).z).toBeNull();
  });

  it('🔴 임계를 넘어도 절대 하한 미만이면 경보하지 않는다(희소 축의 잡음)', () => {
    const base = [...Array(199).fill(0), 1];
    // p95=0 → 임계를 만들 수 없다. minDelta(5) 미만이면 판정 보류
    const quiet = judgePulse(quickAccept, base, 2);
    expect(quiet.kind).toBe('FLAT');
    expect(quiet.detail).toMatch(/임계를 만들 수 없습니다/);
    // 대조군: 하한을 넘는 급증은 침묵하지 않는다
    expect(judgePulse(quickAccept, base, 40).kind).toBe('ANOMALY');
  });

  it('percentile 은 SQL percentile_cont 와 같은 선형보간이다', () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 6);
  });
});

describe('펄스 등록부 — 근거와 하한이 있다', () => {
  it('🔴 모든 지표에 minDelta 하한이 있다(없으면 거짓 경보가 쏟아진다)', () => {
    for (const m of PULSE_METRICS) {
      expect(m.minDelta, `${m.key} 의 minDelta 가 0 이면 1건 변동이 경보가 된다`).toBeGreaterThan(0);
    }
  });

  it('지표마다 왜 보는지 근거가 있다', () => {
    for (const m of PULSE_METRICS) expect(m.why.length, m.key).toBeGreaterThan(20);
  });

  it('🔴 SQL 은 값 `n` 을 낸다 — 화면이 해석할 필요가 없게', () => {
    for (const m of PULSE_METRICS) {
      expect(m.sql, `${m.key}`).toMatch(/AS n\b/);
      expect(m.sql, `${m.key} 가 여러 행을 낼 수 있다`).toMatch(/count\(\*\)/);
    }
  });

  /**
   * 🔴 표본 게이트와 분모는 **한 벌**이다. 한쪽만 있으면 조용히 어긋난다:
   *    · `minSample` 만 있고 `d` 가 없으면 → 매 틱 "표본을 확인할 수 없음" 실패
   *    · `d` 만 내고 `minSample` 이 없으면 → 분모를 재고도 **게이트를 걸지 않는다**(잡음이 쌓인다)
   */
  it('🔴 표본 게이트(minSample)와 분모(AS d)는 함께 있거나 함께 없다', () => {
    const gated = PULSE_METRICS.filter((m) => m.minSample != null);
    expect(gated.length, '게이트 지표가 하나도 없으면 이 가드는 아무것도 보증하지 않는다').toBeGreaterThan(0);
    for (const m of gated) {
      expect(m.sql, `${m.key}: 게이트가 있는데 분모(AS d)를 내지 않는다`).toMatch(/AS d\b/);
      expect(m.minSample!, `${m.key}: 표본 하한이 0 이면 게이트가 아니다`).toBeGreaterThan(0);
    }
    for (const m of PULSE_METRICS.filter((m) => /AS d\b/.test(m.sql))) {
      expect(m.minSample, `${m.key}: 분모를 내면서 게이트를 걸지 않는다`).not.toBeUndefined();
    }
  });

  it('🔴 딥 스윕 지표를 여기 복사하지 않았다 — 층이 다르다', () => {
    // 실시간 층은 인덱스를 타는 카운트만. 전테이블 조인(UNION ALL 다발)은 여기 오면 안 된다
    for (const m of PULSE_METRICS) {
      expect(m.sql.match(/UNION ALL/g) ?? [], `${m.key} 가 딥 스윕처럼 무겁다`).toHaveLength(0);
    }
  });

  /**
   * 🔴 **SQL 이 실재하지 않는 컬럼을 가리켰다**(2026-09-03 운영에서 드러남).
   *    `audit_logs.created_at` 으로 적었는데 실제 컬럼은 `timestamp` 라, 이 지표가
   *    7틱 내내 실패했다. "0 을 쌓지 않는다" 규칙이 작동해 baseline 은 안전했고 화면도
   *    '관측 없음'이라 말했지만, **가드가 없어 배포 전에 못 잡았다.**
   *    prisma 스키마에서 테이블·컬럼을 뽑아 대조한다.
   */
  it('🔴 SQL 이 참조하는 테이블·컬럼이 스키마에 실재한다', () => {
    const schema = readFileSync(join(REPO_ROOT, 'apps/api/prisma/schema.prisma'), 'utf-8');

    /**
     * 🔴 **전역 이름 집합으로는 잡히지 않는다**(재주입에서 드러남).
     *    `audit_logs.created_at` 으로 되돌려도 통과했다 — `created_at` 이 **다른 테이블**에
     *    있었기 때문이다. 테이블→컬럼 관계로 파싱해야 이 가드가 진짜다.
     */
    const tableCols = new Map<string, Set<string>>();
    for (const m of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      const body = m[2];
      const table = /@@map\("([^"]+)"\)/.exec(body)?.[1];
      if (!table) continue; // @@map 없는 모델은 이 등록부가 참조하지 않는다
      const cols = new Set<string>();
      for (const f of body.matchAll(/^\s{2}(\w+)\s+[\w[\]?]+([^\n]*)$/gm)) {
        const mapped = /@map\("([^"]+)"\)/.exec(f[2])?.[1];
        cols.add(mapped ?? f[1]);   // @map 이 없으면 필드명이 곧 컬럼명
      }
      tableCols.set(table, cols);
    }
    expect(tableCols.size, '모델을 하나도 못 뽑았다 — 검사가 헛돈다').toBeGreaterThan(200);

    const SYSTEM = /^pg_/;
    for (const m of PULSE_METRICS) {
      const from = [...m.sql.matchAll(/FROM\s+([a-z_][a-z0-9_]*)/gi)].map((x) => x[1]);
      expect(from.length, `${m.key} 에 FROM 절이 없다`).toBeGreaterThan(0);
      // 시스템 뷰(pg_stat_activity)의 컬럼은 스키마에 없는 것이 정상 — 억지 가드를 만들지 않는다
      if (from.some((t) => SYSTEM.test(t))) continue;

      for (const t of from) {
        expect(tableCols.has(t), `${m.key}: 테이블 '${t}' 가 스키마에 없습니다`).toBe(true);
      }
      const cols = new Set<string>();
      for (const t of from) for (const c of tableCols.get(t) ?? []) cols.add(c);

      const used = [...m.sql.matchAll(/(?:WHERE|AND)\s+"?([a-z_][a-z0-9_]*)"?\s*(?:>|<|=|IN|NOT)/gi)].map((x) => x[1]);
      expect(used.length, `${m.key} 의 WHERE 절에서 컬럼을 못 뽑았다`).toBeGreaterThan(0);
      for (const c of used) {
        expect(cols.has(c), `${m.key}: '${from.join('/')}' 에 컬럼 '${c}' 가 없습니다(다른 테이블에 있는 이름일 수 있습니다)`).toBe(true);
      }
    }
  });

  it('🔴 딥링크는 실재하는 화면만', () => {
    for (const m of PULSE_METRICS.filter((x) => x.drillDown)) {
      const page = join(REPO_ROOT, 'apps/web/src/app/(main)', m.drillDown!.replace(/^\//, ''), 'page.tsx');
      expect(() => readFileSync(page, 'utf-8'), `${m.key} → ${m.drillDown} 화면이 없습니다`).not.toThrow();
    }
  });
});

function mkPrisma(over: Record<string, unknown> = {}) {
  const created: Record<string, unknown>[] = [];
  return {
    created,
    sentinelPulse: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async (a: { data: Record<string, unknown> }) => { created.push(a.data); return {}; }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    // 🔴 표본 게이트가 있는 지표는 분모(d)까지 와야 잰다 — 목이 정본의 실제 반환 모양이어야 한다
    $queryRawUnsafe: vi.fn(async () => [{ n: 42, d: 50 }]),
    ...over,
  };
}

describe('실시간 틱 — 잴 수 없으면 0 을 쌓지 않는다', () => {
  it('전 지표를 재서 시계열에 쌓는다', async () => {
    const prisma = mkPrisma();
    const r = await new SentinelService(prisma as never).tickPulse();
    expect(r.measured).toBe(PULSE_METRICS.length);
    expect(r.failed).toBe(0);
    expect(prisma.created).toHaveLength(PULSE_METRICS.length);
  });

  it('🔴 조회가 실패한 지표는 **0 을 쌓지 않는다** — baseline 이 오염되면 다음 정상값이 급변이 된다', async () => {
    let n = 0;
    const prisma = mkPrisma({
      $queryRawUnsafe: vi.fn(async () => { n += 1; if (n === 2) throw new Error('DB 오류'); return [{ n: 42, d: 50 }]; }),
    });
    const r = await new SentinelService(prisma as never).tickPulse();
    expect(r.failed).toBe(1);
    expect(r.measured).toBe(PULSE_METRICS.length - 1);
    expect(prisma.created, '실패분이 0 으로 쌓이면 안 된다').toHaveLength(PULSE_METRICS.length - 1);
  });

  it('🔴 숫자가 아닌 결과도 쌓지 않는다', async () => {
    const prisma = mkPrisma({ $queryRawUnsafe: vi.fn(async () => [{ n: null }]) });
    const r = await new SentinelService(prisma as never).tickPulse();
    expect(r.measured).toBe(0);
    expect(r.failed).toBe(PULSE_METRICS.length);
  });

  /**
   * 🔴 **표본 부족은 실패가 아니고 0 도 아니다.** 분모가 게이트 미만이면 아무것도 쌓지 않고
   *    `notComputable` 로 그 사실을 말한다. 이것을 실패로 세면 진짜 실패가 로그에 묻히고,
   *    0 으로 쌓으면 baseline 이 잡음으로 만들어져 다음 정상값이 급변이 된다.
   */
  it('🔴 표본이 모자란 지표는 실패도 0 도 아니다 — 산출 불가로 남는다', async () => {
    const gated = PULSE_METRICS.filter((m) => m.minSample != null);
    const prisma = mkPrisma({
      // 분모를 게이트 미만으로 — 게이트 없는 지표는 d 를 보지 않으므로 그대로 잰다
      $queryRawUnsafe: vi.fn(async () => [{ n: 42, d: 1 }]),
    });
    const r = await new SentinelService(prisma as never).tickPulse();
    expect(r.failed, '표본 부족을 실패로 세지 않는다').toBe(0);
    expect(r.notComputable).toHaveLength(gated.length);
    expect(r.notComputable.join(' ')).toMatch(/산출 불가/);
    expect(r.measured).toBe(PULSE_METRICS.length - gated.length);
    expect(prisma.created, '산출 불가분이 0 으로 쌓이면 안 된다').toHaveLength(PULSE_METRICS.length - gated.length);
  });

  /** 🔴 분모를 **읽지 못한 것**은 표본 부족과 다른 사실이다 — 게이트를 확인할 수 없으므로 실패다 */
  it('🔴 분모(d)를 못 읽으면 산출 불가라 단정하지 않고 실패로 남긴다', async () => {
    const gated = PULSE_METRICS.filter((m) => m.minSample != null);
    const prisma = mkPrisma({ $queryRawUnsafe: vi.fn(async () => [{ n: 42 }]) });
    const r = await new SentinelService(prisma as never).tickPulse();
    expect(r.failed).toBe(gated.length);
    expect(r.notComputable, '모르는 것을 표본 부족이라 말하지 않는다').toHaveLength(0);
  });

  it('🔴 틱은 조용하다 — 급변을 찾아도 알림 표시를 만들지 않는다', async () => {
    const prisma = mkPrisma({
      sentinelPulse: {
        findMany: vi.fn(async () => Array(200).fill({ value: 1 })),
        create: vi.fn(async () => ({})),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      $queryRawUnsafe: vi.fn(async () => [{ n: 9999 }]),
    });
    const svc = new SentinelService(prisma as never);
    const r = await svc.tickPulse();
    expect(r.anomalies.length, '급변은 찾아야 한다').toBeGreaterThan(0);
    // 알림 경로(sentinelFinding)를 아예 건드리지 않는다
    expect((prisma as unknown as { sentinelFinding?: unknown }).sentinelFinding).toBeUndefined();
  });
});
