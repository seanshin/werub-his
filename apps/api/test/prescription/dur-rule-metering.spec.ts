/**
 * 임상 규칙·템플릿 P1 — DUR 룰 정본 화면·적중 계측(2026-10-21 · `clinical-rules-templates-review-2026-10.plan.md` A1).
 *  · 표에서 온 룰은 경고에 룰 id 를 싣는다(처방 원장 `dur_warnings` 에 남아 룰별 적중을 센다) · 코드 기본값(폴백) 룰은 없다
 *  · 🔴 개관: 룰 id 기록 시작 전이면 적중 null(계측 전 — 0 아님) · 시작 뒤면 기간 안 적중 · 실효 시작 = max(기간 시작, 계측 시작)
 *  · 🔴 유형별 출처 — 활성 룰 0 인 유형은 코드 기본값(마지막 룰을 꺼도 그 유형은 꺼지지 않는다) · 조회 실패 null
 *  · 코드 규칙 정본(shared) ↔ 판정 코드 경고 유형 · DUR 표 유형 ↔ DTO 허용 값 기계 대조
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CLINICAL_CODE_RULES, DUR_RULE_TYPES } from '@hospital-run/shared';
import { DurService } from '../../src/modules/prescription/dur/dur.service';
import { DurRulesRepo, rowsToRuleSet, defaultsToRows } from '../../src/modules/prescription/dur/dur-rules.repo';
import { DurRulesController } from '../../src/modules/prescription/dur/dur-rules.controller';
import { UpsertDurRuleDto } from '../../src/modules/prescription/dur/dur-rules.dto';

const row = (o: Record<string, unknown>) => ({ ruleType: 'INTERACTION', severity: 'ERROR', drugA: null, drugB: null, keywords: null, minAge: null, maxAge: null, maxDailyDose: null, maxPerKgDay: null, maxAbsolute: null, unit: null, message: 'm', isActive: true, ...o });

function dur(rows: unknown[] | 'FAIL', newMed: Record<string, unknown>, opts: { birthYear?: number; existing?: unknown[] } = {}) {
  const prisma: any = {
    medicationCode: { findUnique: vi.fn(async () => ({ id: 'mc-new', nameKo: '신규', ingredient: 'x', ingredientCode: 'X', category: null, pregnancyCategory: null, highAlertFlag: false, lasaGroup: null, maxDailyDose: null, ...newMed })) },
    patient: { findUnique: vi.fn(async () => ({ dateOfBirth: new Date(`${opts.birthYear ?? 1990}-01-01`), allergies: null })) },
    encounter: { findUnique: vi.fn(async () => ({ pregnancyStatus: null })), findFirst: vi.fn(async () => null) },
    prescription: { findMany: vi.fn().mockResolvedValueOnce(opts.existing ?? []).mockResolvedValueOnce([]) },
    preVisitVitals: { findFirst: vi.fn(async () => null) },
  };
  const repo = new DurRulesRepo({ durRule: { findMany: rows === 'FAIL' ? vi.fn().mockRejectedValue(new Error('x')) : vi.fn(async () => rows) } } as never);
  return new DurService(prisma, repo);
}

describe('룰 id — 표에서 온 룰만', () => {
  it('rowsToRuleSet 이 행 id 를 ruleId 로 싣는다 · 시드 이관 행(id 없음)은 싣지 않는다(기본값 왕복 불변)', () => {
    const set = rowsToRuleSet([row({ id: 'r-int', drugA: 'warfarin', drugB: 'aspirin' }) as never]);
    expect(set.interaction[0].ruleId).toBe('r-int');
    const fromDefaults = rowsToRuleSet(defaultsToRows() as never);
    expect(fromDefaults.interaction.every((r) => r.ruleId === undefined)).toBe(true);
  });

  it('🔴 표 룰이 낸 경고(병용·Beers)는 ruleId 를 든다', async () => {
    const svc = dur([
      row({ id: 'r-int', drugA: 'warfarin', drugB: 'aspirin' }),
      row({ id: 'r-beers', ruleType: 'BEERS', severity: 'WARNING', keywords: ['warfarin'] }),
      row({ id: 'r-age', ruleType: 'AGE', drugA: 'warfarin', minAge: 1 }),
      row({ id: 'r-dose', ruleType: 'MAX_DOSE', drugA: 'warfarin', maxDailyDose: 10, unit: 'mg' }),
      row({ id: 'r-ped', ruleType: 'PEDIATRIC_DOSE', drugA: 'zzz', maxPerKgDay: 1, unit: 'mg' }),
    ], { ingredient: 'warfarin', nameKo: '와파린' }, { birthYear: 1950, existing: [{ medicationCodeId: 'mc-old', medicationCode: { nameKo: '아스피린', ingredient: 'aspirin', ingredientCode: 'A' } }] });
    const w = await svc.checkInteractions('enc', 'mc-new', 'p', { dosage: '5mg', frequency: '1일 3회' } as never);
    expect(w.find((x) => x.type === 'INTERACTION')?.ruleId).toBe('r-int');
    expect(w.find((x) => x.type === 'BEERS')?.ruleId).toBe('r-beers');
    expect(w.find((x) => x.type === 'AGE_CONTRAINDICATION')?.ruleId).toBe('r-age');
    expect(w.find((x) => x.type === 'MAX_DOSE' || x.type === 'DOSE_EXCEEDED')?.ruleId).toBe('r-dose');
  });

  it('대조군 — 폴백(코드 기본값) 룰의 경고는 ruleId 가 없다', async () => {
    const svc = dur('FAIL', { ingredient: 'warfarin', nameKo: '와파린' }, { existing: [{ medicationCodeId: 'mc-old', medicationCode: { nameKo: '아스피린', ingredient: 'aspirin', ingredientCode: 'A' } }] });
    const w = await svc.checkInteractions('enc', 'mc-new', 'p');
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((x) => x.ruleId === undefined)).toBe(true);
  });
});

describe('🔴 유형별 출처 — 활성 0 이면 코드 기본값', () => {
  it('표에 병용만 있으면 나머지 유형은 FALLBACK · 조회 실패 null', async () => {
    const repo = new DurRulesRepo({ durRule: { findMany: vi.fn(async () => [row({ id: 'a', drugA: 'x', drugB: 'y' })]) } } as never);
    expect(await repo.sourceByType()).toEqual({ interaction: 'TABLE', age: 'FALLBACK', maxDose: 'FALLBACK', beers: 'FALLBACK', pediatric: 'FALLBACK' });
    const bad = new DurRulesRepo({ durRule: { findMany: vi.fn().mockRejectedValue(new Error('db')) } } as never);
    expect(await bad.sourceByType()).toBeNull();
  });
});

describe('🔴 개관 — 적중 계측', () => {
  function ctl(since: Date | null, hits: Array<{ id: string; n: number }>) {
    const prisma: any = {
      durRule: { findMany: vi.fn(async () => [row({ id: 'r1', drugA: 'a', drugB: 'b' }), row({ id: 'r2', drugA: 'c', drugB: 'd' })]) },
      $queryRaw: vi.fn().mockResolvedValueOnce([{ since }]).mockResolvedValueOnce(hits),
    };
    const repo = { sourceByType: vi.fn(async () => ({ interaction: 'TABLE', age: 'FALLBACK', maxDose: 'FALLBACK', beers: 'FALLBACK', pediatric: 'FALLBACK' })) };
    return new DurRulesController(prisma, repo as never);
  }
  it('계측 시작 전이면 적중 null(0 아님) · 실효 시작 null', async () => {
    const r = (await ctl(null, []).overview('90')).data;
    expect(r.rules.map((x) => x.hits)).toEqual([null, null]);
    expect(r.metering.since).toBeNull();
    expect(r.window.effectiveFrom).toBeNull();
  });
  it('계측 뒤 — 기간 안 적중 · 없는 룰은 0 · 실효 시작 = 늦은 쪽 · 코드 규칙 정본 · 기간 상한 365', async () => {
    const since = new Date(Date.now() - 3 * 86_400_000);
    const r = (await ctl(since, [{ id: 'r1', n: 4 }]).overview('90')).data;
    expect(r.rules.map((x) => x.hits)).toEqual([4, 0]);
    expect(r.window.effectiveFrom).toBe(since.toISOString());
    expect(r.codeRules).toBe(CLINICAL_CODE_RULES);
    expect((await ctl(since, []).overview('9999')).data.window.days).toBe(365);
  });
});

describe('정본 대조', () => {
  const root = join(__dirname, '../../src/modules');
  it('코드 규칙 목록의 경고 유형이 판정 코드에 실재한다(DUR type · CDSS category)', () => {
    const durSrc = readFileSync(join(root, 'prescription/dur/dur.service.ts'), 'utf8') + readFileSync(join(root, 'allergy/allergy.service.ts'), 'utf8');
    const cdssSrc = readFileSync(join(root, 'cdss/cdss.service.ts'), 'utf8');
    for (const r of CLINICAL_CODE_RULES) {
      const src = r.engine === 'DUR' ? durSrc : cdssSrc;
      const pat = r.engine === 'DUR' ? `type: '${r.emits}'` : `category: '${r.emits}'`;
      expect(src.includes(pat), `${r.key} → ${pat}`).toBe(true);
    }
  });
  it('DUR 표 유형 = DTO 허용 값', () => {
    for (const t of DUR_RULE_TYPES) expect(validateSync(plainToInstance(UpsertDurRuleDto, { ruleType: t, severity: 'WARNING', message: 'm' })), t).toHaveLength(0);
    expect(validateSync(plainToInstance(UpsertDurRuleDto, { ruleType: 'NOPE', severity: 'WARNING', message: 'm' })).length).toBeGreaterThan(0);
  });
});
