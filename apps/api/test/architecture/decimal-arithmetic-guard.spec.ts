import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

/**
 * 🔴 **Prisma `Decimal` 을 `Number()` 없이 `+`/`reduce` 하면 합계가 문자열로 연결돼 손상된다** (2026-09-01 · 발굴 · 예방 가드).
 *
 * `new Prisma.Decimal('300000').valueOf()` 는 **문자열**이라 `0 + Decimal === '0300000'`,
 * `[D,D].reduce((s,x)=>s+x,0) === '0100200'` 이 된다(곱셈 `*` 은 number 로 강제돼 안전). 선량 누적·
 * 청구 합계 등 안전·재무에 닿는다. 정본: 산술 전 `Number(x)`/`_sum`(Prisma aggregate).
 *
 * 🔴 대상은 **어느 모델에서도 Int/Float 가 아닌 Decimal 전용 필드명**으로 한정(amount·value 등 Int 겸용 제외 —
 *    오탐 방지). 검출 패턴은 **DB 행 합산이 명백한 두 형태**: `reduce(=> acc + x.field)` · `+= x.field`
 *    (단순 `a + x.field` 는 DTO number 오탐이 커 제외). 현재 0건 동결 — 새로 생기면 실패한다.
 */
it('오라클 — Decimal 은 valueOf 가 문자열이라 + 가 손상된다', () => {
  const d = new Prisma.Decimal('300000');
  expect(typeof d.valueOf()).toBe('string');
  expect((0 as unknown as string) + (d as unknown as string)).toBe('0300000');
  expect(Number(d)).toBe(300000); // 정본 변환
});

// 모호하지 않은 Decimal 전용 필드(스키마에서 Int/Float 로 안 쓰이는 것)
const DECIMAL_ONLY = ['actualCost','ahi','albumin','anesthesiaDoseMg','bandMg','basdai','baseCurve','bmdTScore','bmi','breslowThickness','bsa','capMg','co2Percent','computedVolumeMl','copayAmount','copayRate','cpapPressure','criticalHigh','criticalLow','ctdiVol','cumulativeDose','currentWeight','das28','deliveredDose','directCost','dlco','dlp','doseAreaProduct','dosePerM2','dryWeight','effectiveDoseMsv','egfr','estimatedCost','fev1','fev1Fvc','fixedDose','fractionDose','fraxScore','fundalHeight','fvc','haqDi','hba1c','headCircCm','headCircumference','heightCm','indirectCost','inrActual','inrTarget','iopOd','iopOs','ktV','ktv','lengthCm','lvef','maxSingleDose','measuredValue','normalMax','normalMin','orderedAmount','pasiScore','preTransfusionHb','prePregnancyWeight','postWeight','preWeight','procalcitonin','prostateVolume','proteinTarget','psaValue','remPercent','resultLevel','resultValue','rvu','scoradScore','sleepEfficiency','supineAhi','targetMean','targetRangeMax','targetRangeMin','targetSD','targetValue','tbsa','totalDose','usageHours','weightKg','zScore'];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.ts') && !e.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}
const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('🔴 Decimal 필드를 변환 없이 합산하지 않는다(0 동결)', () => {
  const files = walk(join(process.cwd(), 'src'));
  it('컨트롤/스캔 대조군 — 소스를 실제로 훑는다', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('reduce/+= 로 Decimal 전용 필드를 Number 없이 더하는 곳이 없다', () => {
    const fieldAlt = DECIMAL_ONLY.join('|');
    // reduce(...) => acc + <ident>.<field>   (Number/toNumber/parseFloat 로 감싸지 않은 것)
    const reduceRe = new RegExp(String.raw`reduce\([^)]*\)\s*=>\s*[\w.]+\s*\+\s*(?!Number\(|[\w.]*toNumber|parseFloat|parseInt)[\w?.]+\.(${fieldAlt})\b`);
    // += <ident>.<field>
    const plusEqRe = new RegExp(String.raw`\+=\s*(?!Number\(|[\w.]*toNumber|parseFloat|parseInt)[\w?.]+\.(${fieldAlt})\b`);
    const hits: string[] = [];
    for (const f of files) {
      const c = strip(readFileSync(f, 'utf8'));
      for (const line of c.split('\n')) {
        if (reduceRe.test(line) || plusEqRe.test(line)) {
          hits.push(`${f.split('/src/')[1]}: ${line.trim().slice(0, 100)}`);
        }
      }
    }
    expect(hits, `Decimal 전용 필드를 Number() 없이 합산:\n  ${hits.join('\n  ')}`).toEqual([]);
  });

  it('🔴 재주입 — 나쁜 코드는 잡고 정본(Number)은 통과시킨다(가드가 헛돌지 않는다)', () => {
    const fieldAlt = DECIMAL_ONLY.join('|');
    const reduceRe = new RegExp(String.raw`reduce\([^)]*\)\s*=>\s*[\w.]+\s*\+\s*(?!Number\(|[\w.]*toNumber|parseFloat|parseInt)[\w?.]+\.(${fieldAlt})\b`);
    const plusEqRe = new RegExp(String.raw`\+=\s*(?!Number\(|[\w.]*toNumber|parseFloat|parseInt)[\w?.]+\.(${fieldAlt})\b`);
    const bad = (l: string) => reduceRe.test(l) || plusEqRe.test(l);
    // 나쁜 것(문자열 연결로 합계 손상)
    expect(bad('const t = rows.reduce((s, x) => s + x.effectiveDoseMsv, 0);')).toBe(true);
    expect(bad('cumulative += fraction.deliveredDose;')).toBe(true);
    expect(bad('total = items.reduce((acc, i) => acc + i.copayAmount, 0);')).toBe(true);
    // 좋은 것(정본 변환/곱셈/집계)
    expect(bad('const t = rows.reduce((s, x) => s + Number(x.effectiveDoseMsv), 0);')).toBe(false);
    expect(bad('cumulative += Number(fraction.deliveredDose);')).toBe(false);
    expect(bad('const v = qty * item.copayAmount;')).toBe(false);
    expect(bad('const a = _sum.effectiveDoseMsv ?? 0;')).toBe(false);
  });

  /**
   * 🔴 비교도 같은 footgun — `Decimal > Decimal` 은 valueOf=문자열이라 **사전식**이 된다
   *    (`Decimal(10) > Decimal(9) === false`·`Decimal(100) < Decimal(20) === true`). number 리터럴
   *    피연산자면 안전(`Decimal > 0`). 오탐 0인 두 형태만 막는다: ①수치전용 필드 vs 문자열 리터럴
   *    ②수치전용 필드끼리 비교(low/high/value 등 config-number 겸용 이름은 제외).
   */
  const NUMERIC_ONLY = ['egfr','hba1c','rvu','bsa','bmi','ktV','ktv','lvef','psaValue','procalcitonin','albumin','cumulativeDose','effectiveDoseMsv','deliveredDose','totalDose','maxSingleDose','maxDailyDose','anesthesiaDoseMg','copayRate','ctdiVol','dlp','doseAreaProduct','tbsa','das28','pasiScore','scoradScore','fraxScore','fev1','fvc','dlco','preTransfusionHb','zScore','bmdTScore'];
  it('수치전용 Decimal 필드를 문자열/서로 비교하지 않는다(사전식 방지·0 동결)', () => {
    const alt = NUMERIC_ONLY.join('|');
    const vsStr = new RegExp(String.raw`[\w?.]+\.(${alt})\s*(<=|>=|<|>)\s*['"]`);
    const vsField = new RegExp(String.raw`[\w?.]+\.(${alt})\s*(<=|>=|<|>)\s*(?!Number\(|[\w.]*toNumber|parseFloat)[\w?.]+\.(${alt})\b`);
    const hits: string[] = [];
    for (const f of files) {
      const c = strip(readFileSync(f, 'utf8'));
      for (const line of c.split('\n')) {
        if (line.includes('Number(') || line.includes('toNumber')) continue;
        if (vsStr.test(line) || vsField.test(line)) hits.push(`${f.split('/src/')[1]}: ${line.trim().slice(0, 100)}`);
      }
    }
    expect(hits, `Decimal 을 사전식으로 비교:\n  ${hits.join('\n  ')}`).toEqual([]);
  });

  it('🔴 재주입 — Decimal 사전식 비교를 잡는다', () => {
    const alt = ['egfr','hba1c','maxDailyDose'].join('|');
    const vsField = new RegExp(String.raw`[\w?.]+\.(${alt})\s*(<=|>=|<|>)\s*(?!Number\()[\w?.]+\.(${alt})\b`);
    const vsStr = new RegExp(String.raw`[\w?.]+\.(${alt})\s*(<=|>=|<|>)\s*['"]`);
    expect(vsField.test('if (a.maxDailyDose > b.maxDailyDose) {')).toBe(true);
    expect(vsStr.test("if (lab.hba1c > '6.5') {")).toBe(true);
    expect(vsField.test('if (Number(a.maxDailyDose) > Number(b.maxDailyDose)) {')).toBe(false);
    expect(vsField.test('if (a.maxDailyDose > 0) {')).toBe(false); // number 리터럴은 안전
  });
});
