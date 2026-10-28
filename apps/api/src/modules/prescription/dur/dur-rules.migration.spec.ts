import { describe, it, expect } from 'vitest';
import {
  INTERACTION_RULES, AGE_RULES, DOSE_LIMITS, BEERS_CRITERIA, PEDIATRIC_DOSE_PER_KG,
} from './dur-rules.defaults';
import { defaultsToRows, rowsToRuleSet } from './dur-rules.repo';

/**
 * DUR 룰 테이블 이관 전수 대조(P0-a) — 하드코딩 → 행 → 룰셋 왕복이 원본과 동일해야 한다.
 * (프리셋 이관 선례: 치환 전 전수 대조 assert — 데이터 이관에서 한 건이라도 새면 차단 룰이 소실된다)
 */
describe('DUR 룰 이관 왕복 동등성', () => {
  const roundTrip = rowsToRuleSet(defaultsToRows() as never);

  it('행 변환 총량 = 원본 총량', () => {
    expect(defaultsToRows().length).toBe(
      INTERACTION_RULES.length + AGE_RULES.length + DOSE_LIMITS.length + BEERS_CRITERIA.length + PEDIATRIC_DOSE_PER_KG.length,
    );
  });

  it('INTERACTION 전수 일치(쌍·심각도·메시지)', () => {
    expect(roundTrip.interaction).toEqual(INTERACTION_RULES);
  });

  it('AGE 전수 일치', () => {
    expect(roundTrip.age).toEqual(AGE_RULES.map((r) => ({ ingredient: r.ingredient, minAge: r.minAge, maxAge: r.maxAge, severity: r.severity, message: r.message })));
  });

  it('MAX_DOSE 전수 일치', () => {
    expect(roundTrip.maxDose).toEqual(DOSE_LIMITS);
  });

  it('BEERS 전수 일치(키워드 배열 보존)', () => {
    expect(roundTrip.beers).toEqual(BEERS_CRITERIA);
  });

  it('PEDIATRIC 전수 일치(mg/kg·절대상한 보존)', () => {
    expect(roundTrip.pediatric).toEqual(PEDIATRIC_DOSE_PER_KG.map((r) => ({ ingredient: r.ingredient, maxPerKgDay: r.maxPerKgDay, unit: r.unit, maxAbsolute: r.maxAbsolute })));
  });

  it('폴백 안전망: 타입이 통째로 비면 기본값으로 채워진다', async () => {
    const { DurRulesRepo } = await import('./dur-rules.repo');
    const prisma = { durRule: { findMany: async () => [] } };
    const repo = new DurRulesRepo(prisma as never);
    const set = await repo.getRuleSet();
    expect(set.interaction.length).toBe(INTERACTION_RULES.length);
    expect(set.beers.length).toBe(BEERS_CRITERIA.length);
  });

  it('로드 실패 시 전체 폴백(차단 게이트 공백 방지)', async () => {
    const { DurRulesRepo } = await import('./dur-rules.repo');
    const prisma = { durRule: { findMany: async () => { throw new Error('db down'); } } };
    const repo = new DurRulesRepo(prisma as never);
    const set = await repo.getRuleSet();
    expect(set.interaction.length).toBe(INTERACTION_RULES.length);
  });
});
