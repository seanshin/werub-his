import { describe, it, expect, vi } from 'vitest';
import { DurService } from '../../src/modules/prescription/dur/dur.service';
import {
  INTERACTION_RULES, AGE_RULES, DOSE_LIMITS, BEERS_CRITERIA, PEDIATRIC_DOSE_PER_KG,
} from '../../src/modules/prescription/dur/dur-rules.defaults';
import {
  hayMatchesTerm, buildMedicationHay, NON_FORMULARY_TERMS,
} from '../../src/modules/prescription/dur/ingredient-terms';
import { REAL_MEDICATIONS, findRealMed, type RealMedRow } from './fixtures/real-medication-vocabulary';

/**
 * 🔴 DUR 판정 가드 — **실제 룰 × 실제 약품 어휘**.
 *
 * 왜 새로 쓰는가:
 *  - `dur-enforce-gate.spec.ts` 는 DurService 를 목으로 대체한다 → 탐지기가 죽어도 초록이다.
 *  - `phase2-dur.spec.ts` 는 판정 로직을 스펙 안에 재구현하고 한글 성분명을 먹인다 → 운영과 무관하다.
 *  이 스펙은 **진짜 DurService** 를 운영 DB 에서 뜬 **진짜 약품 행**으로 돌린다.
 *  dur.service.ts 의 매칭을 종전(`newIngredient.includes(rule.drugA)`)으로 되돌리면 아래가 전부 실패한다.
 */

const RULE_TERMS = {
  interaction: INTERACTION_RULES.flatMap((r) => [r.drugA, r.drugB]),
  age: AGE_RULES.map((r) => r.ingredient),
  maxDose: DOSE_LIMITS.map((r) => r.ingredient),
  pediatric: PEDIATRIC_DOSE_PER_KG.map((r) => r.ingredient),
};

/** 처방 가능한 룰어(비처방 물질 제외) */
const prescribable = (terms: string[]) => [...new Set(terms)].filter((t) => !(t in NON_FORMULARY_TERMS));

describe('DUR 룰어 ↔ 실제 약품 어휘 도달성', () => {
  it('🔴 종전 판정(ingredient 단일 필드·대소문자 구분)은 한글 룰어에 단 한 건도 닿지 않는다 — 결함 재현', () => {
    // 종전 dur.service.ts 의 판정 술어를 그대로 재현
    const legacyMatch = (med: RealMedRow, term: string) => (med.ingredient ?? '').includes(term);
    const koTerms = prescribable([...RULE_TERMS.interaction, ...RULE_TERMS.age, ...RULE_TERMS.maxDose, ...RULE_TERMS.pediatric])
      .filter((t) => /[가-힣]/.test(t));
    expect(koTerms.length).toBeGreaterThan(20);
    const reachable = koTerms.filter((t) => REAL_MEDICATIONS.some((m) => legacyMatch(m, t)));
    // 실제 어휘는 영문 INN 이므로 한글 룰어는 전부 사멸이었다
    expect(reachable).toEqual([]);
  });

  it('봉합 후: 처방 가능한 모든 룰어가 실제 약품 어휘에 닿는다(사멸 룰 0)', () => {
    const all = prescribable([...RULE_TERMS.interaction, ...RULE_TERMS.age, ...RULE_TERMS.maxDose, ...RULE_TERMS.pediatric]);
    const dead = all.filter((t) => !REAL_MEDICATIONS.some((m) => hayMatchesTerm(buildMedicationHay(m), t)));
    expect(dead).toEqual([]);
  });

  it('비처방 물질(알코올·자몽)은 "고쳤다"고 말하지 않는다 — 명시적으로 남는다', () => {
    // 별칭을 붙여 억지 매칭하면 소독용 에탄올에 ERROR 가 뜬다(거짓 경보가 진짜 경보를 죽인다)
    expect(Object.keys(NON_FORMULARY_TERMS).sort()).toEqual(['알코올', '자몽']);
    for (const t of Object.keys(NON_FORMULARY_TERMS)) {
      expect(REAL_MEDICATIONS.some((m) => hayMatchesTerm(buildMedicationHay(m), t))).toBe(false);
    }
  });

  it('Beers 룰은 원래 살아 있었다 — 실제 어휘로 재확인(디펜히드라민만 원내 미보유)', () => {
    const unreachable = BEERS_CRITERIA
      .filter((r) => !REAL_MEDICATIONS.some((m) => r.keywords.some((k) => buildMedicationHay(m).includes(k.toLowerCase()))))
      .map((r) => r.keywords[0]);
    expect(unreachable).toEqual(['diphenhydramine']);
  });
});

// ── 실제 DurService 종단 판정 ────────────────────────────────────────────────
type Ctx = { newMed: RealMedRow; existing: RealMedRow[]; dob?: Date; weightKg?: number };

function makeService(ctx: Ctx) {
  const rx = (m: RealMedRow) => ({ medicationCodeId: m.id, medicationCode: m });
  const prisma = {
    medicationCode: {
      findUnique: vi.fn().mockResolvedValue({
        ...ctx.newMed, pregnancyCategory: null, maxDailyDose: null, highAlertFlag: false,
        highAlertCategory: null, lasaGroup: null,
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    patient: { findUnique: vi.fn().mockResolvedValue({ dateOfBirth: ctx.dob ?? new Date('1970-01-01'), allergies: null }) },
    encounter: {
      findUnique: vi.fn().mockResolvedValue({ pregnancyStatus: null }),
      findFirst: vi.fn().mockResolvedValue({ id: 'enc-1' }),
    },
    prescription: {
      findMany: vi.fn()
        .mockResolvedValueOnce(ctx.existing.map(rx))   // 같은 내원
        .mockResolvedValue([]),                        // 최근 30일
    },
    preVisitVitals: { findFirst: vi.fn().mockResolvedValue(ctx.weightKg ? { weight: ctx.weightKg } : null) },
  };
  // 룰 정본은 테이블이지만 판정 데이터는 기본값과 동일(dur-rules.migration.spec.ts 가 왕복 대조)
  const rulesRepo = {
    getRuleSet: vi.fn().mockResolvedValue({
      interaction: INTERACTION_RULES, age: AGE_RULES, maxDose: DOSE_LIMITS,
      beers: BEERS_CRITERIA, pediatric: PEDIATRIC_DOSE_PER_KG,
    }),
  };
  return new DurService(prisma as never, rulesRepo as never);
}

const run = (ctx: Ctx, dose?: { dosage?: string; frequency?: string }) =>
  makeService(ctx).checkInteractions('enc-1', ctx.newMed.id, 'pat-1', dose);

describe('DurService 실제 판정 — 운영 어휘 그대로', () => {
  it('🔴 와파린 + 아스피린 = 출혈 위험 ERROR (dur.enforce=BLOCK 이 실제로 차단해야 하는 건)', async () => {
    const warnings = await run({ newMed: findRealMed('warfarin'), existing: [findRealMed('aspirin')] });
    const err = warnings.filter((w) => w.type === 'INTERACTION' && w.severity === 'ERROR');
    expect(err.map((w) => w.message)).toContain('출혈 위험 증가 (항응고+항혈소판)');
  });

  it('반대 방향(아스피린 처방 중 와파린 기존)도 동일하게 잡는다', async () => {
    const warnings = await run({ newMed: findRealMed('aspirin'), existing: [findRealMed('warfarin')] });
    expect(warnings.some((w) => w.type === 'INTERACTION' && w.severity === 'ERROR')).toBe(true);
  });

  it('오메프라졸 + 클로피도그렐 = ERROR (심혈관 위험)', async () => {
    const warnings = await run({ newMed: findRealMed('omeprazole'), existing: [findRealMed('clopidogrel')] });
    expect(warnings.some((w) => w.type === 'INTERACTION' && w.severity === 'ERROR')).toBe(true);
  });

  it('클래리스로마이신 + 아토르바스타틴 = ERROR (횡문근융해증) — 한글 상품명이 성분어를 안 담아도 잡는다', async () => {
    const clari = findRealMed('clarithromycin');
    expect(clari.nameKo).not.toContain('클래리스로마이신'); // 실제 표기는 '클래리트로마이신'
    const warnings = await run({ newMed: clari, existing: [findRealMed('atorvastatin')] });
    expect(warnings.some((w) => w.type === 'INTERACTION' && w.severity === 'ERROR')).toBe(true);
  });

  it('약효군 룰도 산다 — SSRI(에스시탈로프람) + MAO억제제(리네졸리드) = ERROR', async () => {
    const warnings = await run({ newMed: findRealMed('escitalopram'), existing: [findRealMed('linezolid')] });
    expect(warnings.some((w) => w.type === 'INTERACTION' && w.severity === 'ERROR')).toBe(true);
  });

  it('ACE억제제(캅토프릴) + 칼륨보존이뇨제(스피로노락톤) = 고칼륨혈증 WARNING', async () => {
    const warnings = await run({ newMed: findRealMed('captopril'), existing: [findRealMed('spironolactone')] });
    expect(warnings.some((w) => w.type === 'INTERACTION' && w.message.includes('고칼륨혈증'))).toBe(true);
  });

  it('메트포르민 + 조영제(이오헥솔) = 유산산증 WARNING', async () => {
    const warnings = await run({ newMed: findRealMed('metformin'), existing: [findRealMed('iohexol')] });
    expect(warnings.some((w) => w.type === 'INTERACTION' && w.message.includes('유산산증'))).toBe(true);
  });

  it('연령 금기: 12세 소아 + 아스피린 = ERROR (Reye 증후군)', async () => {
    const dob = new Date(); dob.setFullYear(dob.getFullYear() - 12);
    const warnings = await run({ newMed: findRealMed('aspirin'), existing: [], dob });
    expect(warnings.some((w) => w.type === 'AGE_CONTRAINDICATION' && w.severity === 'ERROR')).toBe(true);
  });

  it('연령 금기: 6세 + 테트라사이클린 = ERROR — 한글 표기가 룰과 달라도(테라싸이클린) 잡는다', async () => {
    const dob = new Date(); dob.setFullYear(dob.getFullYear() - 6);
    const tetra = findRealMed('tetracycline');
    expect(tetra.nameKo).not.toContain('테트라사이클린');
    const warnings = await run({ newMed: tetra, existing: [], dob });
    expect(warnings.some((w) => w.type === 'AGE_CONTRAINDICATION' && w.severity === 'ERROR')).toBe(true);
  });

  it('용량 상한: 용법을 못 읽으면 "용량 확인" WARNING (모르는 것을 안전하다고 말하지 않는다)', async () => {
    const warnings = await run({ newMed: findRealMed('acetaminophen'), existing: [] });
    expect(warnings.some((w) => w.type === 'DOSE_EXCEEDED' && w.severity === 'WARNING')).toBe(true);
  });

  it('용량 상한: 상한 이내면 INFO — 전건 상시 경고(거짓 경보)를 만들지 않는다', async () => {
    // 운영 활성 처방 실측 최빈값: acetaminophen 500mg · 1일 3회 (45건) = 1,500mg/일 < 4,000
    const warnings = await run({ newMed: findRealMed('acetaminophen'), existing: [] }, { dosage: '500mg', frequency: '1일 3회' });
    const dose = warnings.filter((w) => w.type === 'DOSE_EXCEEDED' || w.type === 'MAX_DOSE');
    expect(dose.map((w) => w.severity)).toEqual(['INFO']);
  });

  it('🔴 용량 상한: 실제로 초과하면 ERROR (아세트아미노펜 1,500mg × 1일 4회 = 6,000mg/일 > 4,000)', async () => {
    const warnings = await run({ newMed: findRealMed('acetaminophen'), existing: [] }, { dosage: '1500mg', frequency: '1일 4회' });
    expect(warnings.some((w) => w.type === 'MAX_DOSE' && w.severity === 'ERROR')).toBe(true);
  });

  it('소아 체중기반: 20kg 8세 + 아목시실린 → 체중 기반 상한 산출', async () => {
    const dob = new Date(); dob.setFullYear(dob.getFullYear() - 8);
    const warnings = await run({ newMed: findRealMed('amoxicillin'), existing: [], dob, weightKg: 20 });
    expect(warnings.some((w) => w.type === 'DOSE_EXCEEDED' && w.message.includes('체중기반'))).toBe(true);
  });

  it('Beers: 70세 + 디아제팜 = 노인주의(종전에도 살아 있던 경로 — 회귀 방지)', async () => {
    const dob = new Date(); dob.setFullYear(dob.getFullYear() - 70);
    const warnings = await run({ newMed: findRealMed('diazepam'), existing: [], dob });
    expect(warnings.some((w) => w.type === 'BEERS')).toBe(true);
  });

  it('무관한 병용은 경고하지 않는다 — 거짓 경보 없음', async () => {
    const warnings = await run({ newMed: findRealMed('ceftriaxone'), existing: [findRealMed('cetirizine')] });
    expect(warnings.filter((w) => w.type === 'INTERACTION')).toEqual([]);
  });
});
