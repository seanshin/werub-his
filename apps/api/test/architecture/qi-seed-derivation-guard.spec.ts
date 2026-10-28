import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  QI_INDICATOR_CATALOG,
  QI_SIM_PROFILES,
  buildQiMeasurements,
  qiMeasurementSeedIndex,
} from '../../prisma/seeds/qi-measurement';
import {
  computeMeasurementValue,
  resolveIndicatorPolicy,
  valueDerivedFromRatio,
  evaluateMeetTarget,
  MEASUREMENT_VALUE_MAX,
} from '../../src/modules/quality/indicator-policy';

/**
 * 🔴 시드가 만든 QI 측정값이 **정본 산출식과 일치하는가** — 시드를 실행하지 않고 검증한다.
 *
 * 원래 결함(2026-08-18 운영 실측): 측정 300건 중 **273건(91%)** 이 `value ≠ 분자/분모 × 배율`.
 * 시드가 값을 먼저 정하고 분자를 `×100` 가정으로 역산했기 때문에, `×1000` 지표는 재산출이 10배,
 * 배율 1 지표는 1/100 이 됐다. 화면 [정정 저장]을 아무것도 안 고치고 눌러도 낙상률이 10배로 뛴다.
 *
 * 🔴 이 가드는 **결함을 재주입하면 실패해야 가드다**. 재주입 검증 방법(2026-08-18 실행·원복 확인):
 *    `prisma/seeds/qi-measurement.ts` 의 분자 산출을 옛 식으로 되돌리면
 *      const numerator = Math.round((aimed * denominator) / 100);   // ×100 가정
 *    → 아래 '① 분자/분모에서 산출' 이 ×1000·×1 지표에서 무더기로 실패한다.
 */
describe('QI 시드 — 값은 분자/분모에서 나온다', () => {
  const catalog = QI_INDICATOR_CATALOG.map((qi) => ({
    id: `00000000-0000-4000-a000-0000000000${String(qi.i).padStart(2, '0')}`,
    name: qi.name,
    category: qi.category,
    formula: qi.formula,
    targetValue: qi.targetValue,
  }));

  it('① 생성된 모든 측정값이 정본 산출식과 일치한다 (value = 분자/분모 × 배율)', () => {
    const mismatched: string[] = [];
    let total = 0;
    for (const qi of catalog) {
      const scale = resolveIndicatorPolicy(qi).valueScale;
      for (const row of buildQiMeasurements(qi)) {
        total++;
        const derived = valueDerivedFromRatio(row.value, row.numerator, row.denominator, scale);
        if (derived !== true) {
          mismatched.push(
            `${qi.name} ${row.period}: value=${row.value} · ${row.numerator}/${row.denominator}×${scale}=${computeMeasurementValue(row.numerator, row.denominator, scale)}`,
          );
        }
      }
    }
    expect(total).toBe(QI_INDICATOR_CATALOG.length * 12);
    expect(mismatched, `분자/분모에서 나오지 않은 값 ${mismatched.length}/${total}건`).toEqual([]);
  });

  it('② 생성기가 쓰는 배율이 지표 정본 배율과 같다 (배율을 왜곡해 값을 맞추지 않는다)', () => {
    for (const qi of catalog) {
      const policy = resolveIndicatorPolicy(qi);
      // formula 에서 배율이 읽혀야 한다 — 'ASSUMED'(백분율 가정)로 새는 지표가 있으면 안 된다
      expect(policy.valueScaleKnown, `${qi.name}: formula 에서 배율을 못 읽어 100 을 가정한다`).toBe(true);
      for (const row of buildQiMeasurements(qi)) {
        expect(row.valueScale, `${qi.name} 배율 불일치`).toBe(policy.valueScale);
      }
    }
  });

  it('③ 달성 판정은 정본(evaluateMeetTarget) 과 같다 — 시드가 키워드 목록을 따로 두지 않는다', () => {
    for (const qi of catalog) {
      const direction = resolveIndicatorPolicy(qi).direction;
      expect(direction, `${qi.name}: 방향 미등재`).not.toBeNull();
      for (const row of buildQiMeasurements(qi)) {
        expect(row.meetTarget, `${qi.name} ${row.period}`).toBe(
          evaluateMeetTarget(row.value, qi.targetValue, direction),
        );
      }
    }
  });

  it('④ 값이 저장 한계와 임상적으로 그럴듯한 범위 안에 있다', () => {
    for (const qi of catalog) {
      const target = qi.targetValue;
      for (const row of buildQiMeasurements(qi)) {
        expect(row.value, `${qi.name} ${row.period} 음수`).toBeGreaterThanOrEqual(0);
        expect(row.value, `${qi.name} ${row.period} Decimal(5,2) 초과`).toBeLessThanOrEqual(MEASUREMENT_VALUE_MAX);
        expect(Number.isInteger(row.numerator), `${qi.name} 분자가 정수가 아니다`).toBe(true);
        expect(Number.isInteger(row.denominator), `${qi.name} 분모가 정수가 아니다`).toBe(true);
        expect(row.denominator, `${qi.name} 분모 0`).toBeGreaterThan(0);
        expect(row.numerator, `${qi.name} 분자 > 분모(비율 지표에서 100% 초과)`).toBeLessThanOrEqual(
          resolveIndicatorPolicy(qi).valueScale === 1 ? Number.MAX_SAFE_INTEGER : row.denominator,
        );
        // 목표의 10배를 넘으면 시뮬레이션 모수가 어긋난 것이다(예전 역산 결함의 증상이 10배였다)
        expect(row.value, `${qi.name} ${row.period} 값 ${row.value} 이 목표 ${target} 의 10배 초과`).toBeLessThan(
          target * 10,
        );
      }
    }
  });

  it('⑤ 결정론적이다 — 같은 시각으로 두 번 생성하면 같은 값이 나온다', () => {
    const now = new Date('2026-08-18T00:00:00Z');
    for (const qi of catalog) {
      expect(buildQiMeasurements(qi, { now })).toEqual(buildQiMeasurements(qi, { now }));
    }
  });

  it('⑥ 모든 카탈로그 지표에 시뮬레이션 모수가 등재돼 있다 (기본값으로 조용히 새지 않는다)', () => {
    const missing = QI_INDICATOR_CATALOG.filter((qi) => !QI_SIM_PROFILES[qi.name]).map((q) => q.name);
    expect(missing, '모수 미등재 지표는 base 50/분모 100 기본값으로 생성된다').toEqual([]);
  });

  it('⑧ 측정 행 id 가 (지표, 기간)에서 결정된다 — 순번 id 는 실행마다 다른 행을 가리킨다', () => {
    const seen = new Map<number, string>();
    for (const qi of QI_INDICATOR_CATALOG) {
      const rows = buildQiMeasurements({
        id: 'x',
        name: qi.name,
        category: qi.category,
        formula: qi.formula,
        targetValue: qi.targetValue,
      });
      for (const row of rows) {
        const idx = qiMeasurementSeedIndex(qi.i, row.period);
        const key = `${qi.name} ${row.period}`;
        expect(seen.has(idx), `id 인덱스 ${idx} 충돌: ${seen.get(idx)} ↔ ${key}`).toBe(false);
        seen.set(idx, key);
        // 같은 (지표, 기간)이면 언제 계산해도 같은 인덱스
        expect(qiMeasurementSeedIndex(qi.i, row.period)).toBe(idx);
      }
    }
    expect(seen.size).toBe(QI_INDICATOR_CATALOG.length * 12);
  });

  it('⑨ 기간이 id 공간을 벗어나면 조용히 겹치지 않고 터진다', () => {
    expect(() => qiMeasurementSeedIndex(1, '2019-12')).toThrow();
    expect(() => qiMeasurementSeedIndex(1, '2037-01')).toThrow();
    expect(() => qiMeasurementSeedIndex(1, '2026-8')).toThrow();
  });

  it('⑦ seed.ts 에 옛 역산 코드·키워드 방향 판정이 되살아나지 않는다', () => {
    const seed = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf-8');
    // 옛 코드: const numer = Math.round(value * denom / 100);
    expect(seed, 'QI 분자를 ×100 가정으로 역산하는 코드가 되살아났다').not.toMatch(
      /Math\.round\(\s*value\s*\*\s*denom\s*\/\s*100\s*\)/,
    );
    // 옛 코드: const lowerIsBetter = [...].some(k => qi.name.includes(k));
    expect(seed, '시드가 지표 방향을 키워드로 다시 추정한다 — 정본은 indicator-policy 하나다').not.toMatch(
      /lowerIsBetter/,
    );
    expect(seed, 'QI 측정 생성은 prisma/seeds/qi-measurement.ts 정본을 부른다').toContain('buildQiMeasurements');
    // 순번 id upsert 로 되돌아가면 12개월 창이 굴러갈 때 unique(indicatorId, period) 를 위반한다
    expect(seed, 'QI 측정 upsert 가 순번 id 로 되돌아갔다 — 자연키(indicatorId_period)로 맞춰야 한다').not.toMatch(
      /makeUuid\('01010000',\s*qmCount\)/,
    );
    expect(seed, 'QI 측정 upsert 는 자연키를 쓴다').toContain('indicatorId_period');
  });
  /**
   * 🔴 **말일 회귀** — 2026-08-29 에 이 가드가 처음 붉어졌다.
   *    `setMonth()` 로 달을 빼면 29·30·31일에는 짧은 달을 건너뛰어
   *    **2월이 사라지고 3월이 두 번** 나온다 → `@@unique([indicatorId, period])` 위반으로
   *    **매달 말일에 `prisma db seed` 가 죽는다.**
   *    🔴 오늘 날짜로만 돌리면 한 달에 사흘만 잡힌다 — **말일을 고정해서** 센다.
   */
  it('🔴 어느 날짜에 돌려도 기간이 중복되지 않는다(말일·짧은 달 포함)', () => {
    const DAYS = [1, 15, 28, 29, 30, 31];
    const MONTHS = [0, 1, 2, 6, 11]; // 1·2·3·7·12월 — 2월(짧은 달) 전후를 반드시 포함
    for (const y of [2025, 2026, 2028]) {          // 2028 = 윤년
      for (const mo of MONTHS) {
        for (const d of DAYS) {
          const now = new Date(y, mo, d);
          if (now.getMonth() !== mo) continue;      // 그 달에 없는 날짜는 건너뛴다
          const rows = buildQiMeasurements(
            { id: 'x', name: QI_INDICATOR_CATALOG[0].name, category: QI_INDICATOR_CATALOG[0].category,
              formula: QI_INDICATOR_CATALOG[0].formula, targetValue: QI_INDICATOR_CATALOG[0].targetValue },
            { now },
          );
          const periods = rows.map((r) => r.period);
          expect(new Set(periods).size, `${y}-${mo + 1}-${d} 에서 기간이 중복됐다: ${periods.join(' ')}`)
            .toBe(periods.length);
          // 🔴 건너뛴 달이 없어야 한다 — 12개월을 요청했으면 연속 12개다
          expect(periods.length, `${y}-${mo + 1}-${d}`).toBe(12);
        }
      }
    }
  });

});
