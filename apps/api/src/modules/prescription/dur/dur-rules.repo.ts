import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  INTERACTION_RULES, AGE_RULES, DOSE_LIMITS, BEERS_CRITERIA, PEDIATRIC_DOSE_PER_KG,
  type InteractionRule, type AgeRule, type DoseLimit, type BeersRule, type PediatricDoseRule,
} from './dur-rules.defaults';

/**
 * DUR 룰 저장소(2026-08-04 거버넌스 P0-a) — 판정 데이터의 정본을 코드에서 테이블로.
 *
 * 안전 설계:
 *  - 🔴 dur.enforce=BLOCK 이 실차단 중 — 룰 로드가 죽으면 "룰 없음=전부 통과"가 되므로
 *    **타입별 0건/로드 실패 시 하드코딩 기본값 폴백**(fail-safe). 기본값 상수는 시드 소스 겸 폴백으로 강등.
 *  - 부팅 시 테이블 비면 기본값 전량 자동 이관(source='SEED'·1회성) — 배포 즉시 테이블 정본.
 *  - 캐시 60초 — 판정은 처방마다 돌므로 매번 5쿼리 금지.
 */
export interface DurRuleSet {
  interaction: InteractionRule[];
  age: AgeRule[];
  maxDose: DoseLimit[];
  beers: BeersRule[];
  pediatric: PediatricDoseRule[];
}

const FALLBACK: DurRuleSet = {
  interaction: INTERACTION_RULES,
  age: AGE_RULES,
  maxDose: DOSE_LIMITS,
  beers: BEERS_CRITERIA,
  pediatric: PEDIATRIC_DOSE_PER_KG,
};

type DurRuleRow = {
  /** 테이블 행 id — 있으면 룰에 실어 경고가 어느 룰에서 나왔는지 남긴다(시드 이관 행에는 아직 없다) */
  id?: string;
  ruleType: string; severity: string; drugA: string | null; drugB: string | null;
  keywords: unknown; minAge: number | null; maxAge: number | null;
  maxDailyDose: number | null; maxPerKgDay: number | null; maxAbsolute: number | null;
  unit: string | null; message: string;
};

/** 테이블 행 → 런타임 룰셋(판정 루프가 쓰는 형태). export = 대조 테스트 대상 */
export function rowsToRuleSet(rows: DurRuleRow[]): DurRuleSet {
  const set: DurRuleSet = { interaction: [], age: [], maxDose: [], beers: [], pediatric: [] };
  for (const r of rows) {
    switch (r.ruleType) {
      case 'INTERACTION':
        if (r.drugA && r.drugB) set.interaction.push({ drugA: r.drugA, drugB: r.drugB, severity: r.severity as 'ERROR' | 'WARNING', message: r.message, ...(r.id ? { ruleId: r.id } : {}) });
        break;
      case 'AGE':
        if (r.drugA) set.age.push({ ingredient: r.drugA, minAge: r.minAge ?? undefined, maxAge: r.maxAge ?? undefined, severity: r.severity as 'ERROR' | 'WARNING', message: r.message, ...(r.id ? { ruleId: r.id } : {}) });
        break;
      case 'MAX_DOSE':
        if (r.drugA && r.maxDailyDose != null) set.maxDose.push({ ingredient: r.drugA, maxDailyDose: r.maxDailyDose, unit: r.unit ?? 'mg', message: r.message, ...(r.id ? { ruleId: r.id } : {}) });
        break;
      case 'BEERS': {
        const kw = Array.isArray(r.keywords) ? (r.keywords as string[]).filter((k) => typeof k === 'string') : [];
        if (kw.length) set.beers.push({ keywords: kw, message: r.message, ...(r.id ? { ruleId: r.id } : {}) });
        break;
      }
      case 'PEDIATRIC_DOSE':
        if (r.drugA && r.maxPerKgDay != null) set.pediatric.push({ ingredient: r.drugA, maxPerKgDay: r.maxPerKgDay, unit: r.unit ?? 'mg', maxAbsolute: r.maxAbsolute ?? undefined, ...(r.id ? { ruleId: r.id } : {}) });
        break;
    }
  }
  return set;
}

/** 기본값 상수 → 테이블 행(시드 이관). export = 왕복 대조 테스트 대상 */
export function defaultsToRows(): Omit<DurRuleRow, never>[] {
  return [
    ...INTERACTION_RULES.map((r) => ({ ruleType: 'INTERACTION', severity: r.severity, drugA: r.drugA, drugB: r.drugB, keywords: null, minAge: null, maxAge: null, maxDailyDose: null, maxPerKgDay: null, maxAbsolute: null, unit: null, message: r.message })),
    ...AGE_RULES.map((r) => ({ ruleType: 'AGE', severity: r.severity, drugA: r.ingredient, drugB: null, keywords: null, minAge: r.minAge ?? null, maxAge: r.maxAge ?? null, maxDailyDose: null, maxPerKgDay: null, maxAbsolute: null, unit: null, message: r.message })),
    ...DOSE_LIMITS.map((r) => ({ ruleType: 'MAX_DOSE', severity: 'WARNING', drugA: r.ingredient, drugB: null, keywords: null, minAge: null, maxAge: null, maxDailyDose: r.maxDailyDose, maxPerKgDay: null, maxAbsolute: null, unit: r.unit, message: r.message })),
    ...BEERS_CRITERIA.map((r) => ({ ruleType: 'BEERS', severity: 'WARNING', drugA: r.keywords[0] ?? null, drugB: null, keywords: r.keywords, minAge: 65, maxAge: null, maxDailyDose: null, maxPerKgDay: null, maxAbsolute: null, unit: null, message: r.message })),
    ...PEDIATRIC_DOSE_PER_KG.map((r) => ({ ruleType: 'PEDIATRIC_DOSE', severity: 'ERROR', drugA: r.ingredient, drugB: null, keywords: null, minAge: null, maxAge: 18, maxDailyDose: null, maxPerKgDay: r.maxPerKgDay, maxAbsolute: r.maxAbsolute ?? null, unit: r.unit, message: `소아 체중기반 상한 ${r.maxPerKgDay}${r.unit}/kg/일${r.maxAbsolute ? ` (절대 최대 ${r.maxAbsolute}${r.unit})` : ''}` })),
  ];
}

@Injectable()
export class DurRulesRepo implements OnModuleInit {
  private readonly logger = new Logger(DurRulesRepo.name);
  private cache: { at: number; set: DurRuleSet } | null = null;
  private static readonly TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // 부팅 자동 이관 — 비차단(실패해도 폴백으로 판정은 산다)
    void this.ensureSeeded().catch((e) => this.logger.warn(`DUR 룰 시드 이관 실패(폴백 유지): ${e instanceof Error ? e.message : e}`));
  }

  async ensureSeeded(): Promise<number> {
    // 🔴 이 Repo 는 3개 모듈(dur·prescription·cdss)에 각각 인스턴스화된다(순환 회피 구조)
    //    → onModuleInit 3회 동시 실행 = check-then-act 레이스로 시드 3중 삽입 실사고(2026-08-04).
    //    advisory lock 으로 직렬화하고 락 안에서 count 재확인한다.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('dur-rules-seed'))`;
      const count = await tx.durRule.count();
      if (count > 0) return 0;
      const rows = defaultsToRows();
      await tx.durRule.createMany({ data: rows.map((r) => ({ ...r, keywords: r.keywords ?? undefined, source: 'SEED' })) });
      this.logger.log(`DUR 룰 기본값 이관: ${rows.length}건 (INTERACTION ${INTERACTION_RULES.length}·AGE ${AGE_RULES.length}·MAX_DOSE ${DOSE_LIMITS.length}·BEERS ${BEERS_CRITERIA.length}·PEDIATRIC ${PEDIATRIC_DOSE_PER_KG.length})`);
      return rows.length;
    });
  }

  /** 판정용 룰셋 — 캐시·타입별 폴백 */
  async getRuleSet(): Promise<DurRuleSet> {
    if (this.cache && Date.now() - this.cache.at < DurRulesRepo.TTL_MS) return this.cache.set;
    try {
      const rows = await this.prisma.durRule.findMany({ where: { isActive: true } });
      const loaded = rowsToRuleSet(rows as DurRuleRow[]);
      // 타입별 폴백 — 어떤 타입이 통째로 비면(삭제 사고 등) 그 타입만 기본값으로(차단 게이트 공백 방지)
      const set: DurRuleSet = {
        interaction: loaded.interaction.length ? loaded.interaction : FALLBACK.interaction,
        age: loaded.age.length ? loaded.age : FALLBACK.age,
        maxDose: loaded.maxDose.length ? loaded.maxDose : FALLBACK.maxDose,
        beers: loaded.beers.length ? loaded.beers : FALLBACK.beers,
        pediatric: loaded.pediatric.length ? loaded.pediatric : FALLBACK.pediatric,
      };
      this.cache = { at: Date.now(), set };
      return set;
    } catch (e) {
      this.logger.warn(`DUR 룰 로드 실패 — 하드코딩 폴백: ${e instanceof Error ? e.message : e}`);
      return FALLBACK;
    }
  }

  invalidate() { this.cache = null; }

  /**
   * 유형별 출처(2026-10-21 임상 규칙 P1) — 🔴 한 유형의 활성 룰이 0 이면 판정은 **코드 기본값**으로 대체된다(차단 공백 방지).
   *    그래서 관리 화면에서 마지막 룰을 꺼도 그 유형은 꺼지지 않는다 — 화면이 그 사실을 말하도록 낸다.
   *    조회 실패면 null(확인 불가).
   */
  async sourceByType(): Promise<Record<keyof DurRuleSet, 'TABLE' | 'FALLBACK'> | null> {
    try {
      const rows = await this.prisma.durRule.findMany({ where: { isActive: true } });
      const loaded = rowsToRuleSet(rows as DurRuleRow[]);
      const src = (k: keyof DurRuleSet) => (loaded[k].length ? 'TABLE' : 'FALLBACK') as 'TABLE' | 'FALLBACK';
      return { interaction: src('interaction'), age: src('age'), maxDose: src('maxDose'), beers: src('beers'), pediatric: src('pediatric') };
    } catch {
      return null;
    }
  }

  // ── 쓰기 정본(P3) — 컨트롤러·거버넌스 집행 엔진이 같은 경로를 쓴다. 캐시 무효화 누락 방지가 목적.
  async createRule(data: Record<string, unknown>) {
    const row = await this.prisma.durRule.create({ data: { ...data, keywords: (data.keywords as never) ?? undefined } as never });
    this.invalidate();
    return row;
  }

  async updateRule(id: string, data: Record<string, unknown>) {
    const row = await this.prisma.durRule.update({ where: { id }, data: { ...data, keywords: (data.keywords as never) ?? undefined } as never });
    this.invalidate();
    return row;
  }

  async deleteRule(id: string) {
    await this.prisma.durRule.delete({ where: { id } });
    this.invalidate();
    return { ok: true };
  }
}
