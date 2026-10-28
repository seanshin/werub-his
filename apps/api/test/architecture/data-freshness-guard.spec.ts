/**
 * scripts/data-freshness.mjs (시점 정합 판정기) 의 가드.
 *
 * 🔴 이 저장소에서 **가드가 헛돌았던 사례가 10건** 나왔다(부분 문자열 단언·주석 오독·
 *    목(mock)만 통과·파일 파손으로 "no tests"). 그래서 여기서는:
 *      1. 판정 케이스 표(SELFTESTS)를 **스크립트와 공유**한다 — 케이스 정본이 둘이 되지 않게.
 *      2. 케이스마다 "결함을 심은 스냅샷"을 넣고 **그 결함이 잡히는지**를 본다
 *         (= 결함 재주입이 케이스 정의 자체에 들어 있다).
 *      3. 반대로 "정상인데 경보가 나면" 실패하는 케이스도 같은 표에 있다(거짓 경보 방지).
 *      4. 케이스 수가 줄면 실패한다 — 표가 비어 조용히 통과하는 것을 막는다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 저장소 루트의 스크립트를 직접 불러온다(정본이 하나여야 하므로 복사하지 않는다).
import {
  AXES,
  DELEGATED,
  EXCLUDED_REVERSALS,
  PAIRS,
  POLICY,
  REVERSALS,
  SECTION_CONTRACT,
  SELFTESTS,
  buildSql,
  healthySnapshot,
  judge,
} from '../../../../scripts/data-freshness.mjs';

const REPO_ROOT = join(__dirname, '../../../..');

describe('시점 정합 판정기 — 판정 케이스(결함 재주입 포함)', () => {
  // 🔴 표가 비면 아래 it.each 가 0건이 되어 "통과"처럼 보인다. 하한을 못박는다.
  it('판정 케이스가 충분히 있다(표가 비어 조용히 통과하는 것을 막는다)', () => {
    expect(SELFTESTS.length).toBeGreaterThanOrEqual(26);
  });

  it.each(SELFTESTS.map((t: any) => [t.name, t] as const))('%s', (_name, t: any) => {
    const snapshot = t.build(healthySnapshot());
    const result = judge(snapshot);
    // expect() 는 실패 사유 문자열 또는 null 을 돌려준다. null 이 통과다.
    expect(t.expect(result)).toBeNull();
  });
});

describe('시점 정합 판정기 — 구조 불변식', () => {
  it('정상 스냅샷은 위반 0건 (거짓 경보가 없어야 진짜 경보가 산다)', () => {
    expect(judge(healthySnapshot()).findings).toHaveLength(0);
  });

  it('생성 SQL 은 SELECT 만 — 운영 DB 에 쓰지 않는다', () => {
    const sql = buildSql(30);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|COPY)\b/i);
  });

  it('축 키·인과쌍 키가 중복되지 않는다', () => {
    const axisKeys = AXES.map((a: any) => a.key);
    expect(new Set(axisKeys).size).toBe(axisKeys.length);
    const pairKeys = PAIRS.map((p: any) => p.key);
    expect(new Set(pairKeys).size).toBe(pairKeys.length);
  });

  it('인과쌍의 상류·하류는 모두 정의된 축을 가리킨다(오타로 판정이 꺼지는 것을 막는다)', () => {
    const keys = new Set(AXES.map((a: any) => a.key));
    for (const p of PAIRS as any[]) {
      expect(keys.has(p.up), `${p.key} 의 상류 ${p.up}`).toBe(true);
      expect(keys.has(p.down), `${p.key} 의 하류 ${p.down}`).toBe(true);
    }
  });

  it('모든 인과쌍에 근거(why·tatWhy)가 적혀 있다 — 근거 없는 임계값은 거짓 경보를 만든다', () => {
    for (const p of PAIRS as any[]) {
      expect(p.why?.length ?? 0, `${p.key}.why`).toBeGreaterThan(10);
      expect(p.tatWhy?.length ?? 0, `${p.key}.tatWhy`).toBeGreaterThan(10);
      expect(typeof p.tatDays).toBe('number');
    }
  });

  it('희소 축이 실제로 존재한다 — 없으면 "드문 축 면제" 정책이 죽은 코드다', () => {
    expect(AXES.filter((a: any) => a.rarity === 'rare').length).toBeGreaterThanOrEqual(5);
  });

  it('계획(plan) 컬럼이 실제로 존재한다 — 없으면 미래 시각 면제 규칙이 죽은 코드다', () => {
    expect(AXES.filter((a: any) => a.kind === 'plan').length).toBeGreaterThanOrEqual(1);
  });

  /**
   * 🔴 P12(같은 사실에 정본이 둘) 방지.
   *    시각 역전의 일부는 이미 `infra/scripts/data-integrity-scan.sql` 이 세고 있다.
   *    거기 있는 테이블·조건을 여기서 다시 세면 두 도구가 갈라진다.
   */
  it('data-integrity-scan.sql 이 이미 세는 시각 역전을 다시 세지 않는다', () => {
    const scan = readFileSync(join(REPO_ROOT, 'infra/scripts/data-integrity-scan.sql'), 'utf8');
    const alreadyThere = [
      { table: 'orders', expr: 'completed_at < started_at' },
      { table: 'lab_results', expr: 'completed_at < collected_at' },
    ];
    for (const dup of alreadyThere) {
      // 전제 확인: 정말 그 스캔에 있는가(전제가 무너지면 이 가드는 의미가 없다).
      expect(scan.replace(/\s+/g, ' ')).toContain(dup.expr);
      // 본 검사: 우리 목록에 같은 테이블+조건이 없어야 한다.
      expect(
        (REVERSALS as any[]).some((r) => r.table === dup.table && r.expr === dup.expr),
        `${dup.table}: ${dup.expr} 가 두 도구에 중복 정의됐다`,
      ).toBe(false);
    }
  });

  it('위임 목록이 실제 파일을 가리킨다(문서만 남고 파일이 사라지는 것을 막는다)', () => {
    expect(DELEGATED.length).toBeGreaterThan(0);
    for (const [where] of DELEGATED as [string, string][]) {
      const file = where.split(' · ')[0].trim();
      expect(() => readFileSync(join(REPO_ROOT, file), 'utf8')).not.toThrow();
    }
  });

  /**
   * 🔴 `created_at` 은 행이 DB 에 들어온 시각이고 `signed_at`·`paid_at` 은 임상·업무 시각이다.
   *    두 축을 비교한 탓에 30+2건의 거짓 경보가 났고, 간호기록에서는 같은 비교가 187건을 만든다
   *    (중앙값 격차 27.9일 — tolerance 로는 못 거른다). 되살리면 반드시 실패해야 한다.
   */
  it('시각 역전 쌍에 created_at 이 섞이지 않는다 (다른 시간축을 비교하지 않는다)', () => {
    const bad = (REVERSALS as any[]).filter(
      (r) => r.earlier === 'created_at' || r.later === 'created_at',
    );
    expect(bad.map((r) => r.key)).toEqual([]);
    // 뺐다는 사실과 근거가 남아 있어야 한다(조용히 사라지면 다음 사람이 되살린다).
    expect(EXCLUDED_REVERSALS.length).toBeGreaterThanOrEqual(3);
    for (const [what, why] of EXCLUDED_REVERSALS as [string, string][]) {
      expect(what.length).toBeGreaterThan(5);
      expect(why.length).toBeGreaterThan(30);
    }
  });

  it('모든 역전 쌍이 격차를 잴 수 있다 (조건만 있으면 아티팩트와 진짜를 구분 못 한다)', () => {
    for (const r of REVERSALS as any[]) {
      expect(typeof r.earlier, r.key).toBe('string');
      expect(typeof r.later, r.key).toBe('string');
      expect(r.expr).toBe(`${r.later} < ${r.earlier}`);
    }
  });

  it('생성 SQL 이 역전을 진짜/아티팩트로 나눠 센다', () => {
    const sql = buildSql(30);
    for (const r of REVERSALS as any[]) {
      const gap = `EXTRACT(epoch FROM (${r.earlier} - ${r.later}))`;
      expect(sql, r.key).toContain(`${gap} >= ${POLICY.reversalToleranceSeconds}`);
      expect(sql, r.key).toContain(`${gap} < ${POLICY.reversalToleranceSeconds}`);
    }
  });

  /**
   * 🔴 표시(verdict)와 판정(findings)의 계약은 **성질 검사가 훑는 범위 그 자체**다.
   *    섹션을 하나 빼거나 소견 유형을 계약에서 지우면, 그 경로는 검사되지 않은 채 조용히 열린다
   *    (실제로 인과쌍 경로가 그렇게 열려 있었다). 그래서 계약의 모양을 여기서 못박는다.
   */
  it('표시/판정 계약이 네 섹션을 모두 덮는다 (섹션을 빼면 그 경로가 조용히 열린다)', () => {
    expect(Object.keys(SECTION_CONTRACT).sort()).toEqual(['axes', 'pairs', 'probes', 'revs']);
  });

  it('judge 가 내는 모든 소견 유형이 계약에 등재되어 있다 (요약에만 뜨고 표에 없는 소견 금지)', () => {
    // 판정 케이스 전체를 돌려 실제로 발생하는 소견 유형을 모은다(손으로 적지 않는다).
    const seen = new Set<string>();
    for (const t of SELFTESTS as any[]) {
      for (const f of judge(t.build(healthySnapshot())).findings) seen.add(f.type);
    }
    // 전제: 유형이 몇 개는 실제로 나와야 이 검사가 의미를 갖는다.
    expect(seen.size).toBeGreaterThanOrEqual(7);

    const covered = new Set<string>(
      Object.values(SECTION_CONTRACT).flatMap((c: any) => c.types),
    );
    const orphan = [...seen].filter((t) => t !== 'UNPARSABLE_TIME' && !covered.has(t));
    expect(orphan, `계약에 없는 소견 유형: ${orphan.join(', ')}`).toEqual([]);
  });

  it('한 소견 유형이 두 섹션에 걸치지 않는다 (걸치면 어느 표가 정본인지 갈라진다)', () => {
    const seen = new Map<string, string[]>();
    for (const [name, c] of Object.entries(SECTION_CONTRACT) as [string, any][]) {
      for (const t of c.types) seen.set(t, [...(seen.get(t) ?? []), name]);
    }
    for (const [type, owners] of seen) {
      expect(owners, `${type} 이 ${owners.join('/')} 에 중복 등재`).toHaveLength(1);
    }
  });

  it('정책 상수가 합리적 범위 안에 있다(0 이나 무한대로 바뀌면 판정이 통째로 꺼진다)', () => {
    expect(POLICY.lagFloorDays).toBeGreaterThanOrEqual(1);
    expect(POLICY.minGapSamples).toBeGreaterThanOrEqual(2);
    expect(POLICY.minUpstream).toBeGreaterThanOrEqual(1);
    expect(POLICY.gapMultiplier).toBeGreaterThan(0);
    expect(POLICY.lagBudgetCapDays).toBeGreaterThan(POLICY.lagFloorDays);
    // 0 이면 아티팩트가 전부 진짜로, 너무 크면 진짜 역전이 조용히 사라진다.
    expect(POLICY.reversalToleranceSeconds).toBeGreaterThan(0);
    expect(POLICY.reversalToleranceSeconds).toBeLessThanOrEqual(60);
  });
});
