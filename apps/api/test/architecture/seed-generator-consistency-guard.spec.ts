import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 시드 생성기가 **같은 행 안에서 모순되는 데이터**를 만들지 않는가 — 소스 대조 가드.
 *
 * 시드를 실행하지 않고 검증한다(운영 DB 접속·시드 실행 금지). QI 측정처럼 로직을 함수로 뽑을 수 있는
 * 것은 `qi-seed-derivation-guard.spec.ts` 가 값으로 검증하고, 여기서는 **되살아나면 안 되는 코드 모양**을
 * 동결한다. 각 항목은 2026-08-18 실제로 고친 결함이며, 되돌리면 이 테스트가 실패해야 한다.
 *
 * 원칙(CLAUDE.md): 파생값은 원자료에서 나온다 · 판정 규칙은 정본 하나 · 모르면 지어내지 않는다.
 */
const API = process.cwd();
const read = (rel: string) => readFileSync(join(API, rel), 'utf-8');
/**
 * 주석을 걷어낸 본문. 🔴 이 가드 자신이 오탐을 냈다 — 결함을 설명하는 **주석 안의 옛 코드 문자열**에
 * 정규식이 걸려, 고쳐진 파일을 "결함이 되살아났다"고 신고했다.
 * 거짓 경보는 진짜 경보를 죽인다. 코드 모양을 보는 단언은 코드만 본다.
 */
const readCode = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');

describe('시드 생성기 — 파생값은 원자료에서 나온다', () => {
  it('🔴 검사 플래그를 비수치 값에 숫자 비교로 매기지 않는다 (NaN 이 정상 N 으로 샌다)', () => {
    const seed = read('prisma/seed.ts');
    // 옛 코드: Number(t.value) < t.min ? 'L' : Number(t.value) > t.max ? 'H' : 'N'
    //  → Number('50-100') = NaN, 두 비교가 모두 false 라 농뇨 50-100/HPF 가 'N'(정상)이 됐다
    expect(seed, "Number(t.value) 직접 비교가 되살아났다 — '50-100' 이 정상으로 저장된다").not.toMatch(
      /Number\(t\.value\)\s*<\s*t\.min/,
    );
    // 정본은 하나 — 일반 검사와 응급 검사 두 곳이 같은 함수를 부른다(사본을 두면 한쪽만 고쳐진다)
    expect(seed.match(/labFlagOf\(t\.value/g)?.length, '검사 플래그 판정이 두 곳에서 정본을 부르지 않는다').toBe(2);
  });

  it('🔴 재고 입출고 금액이 그 행의 수량에서 나온다', () => {
    const seed = read('prisma/seed.ts');
    // 옛 코드: totalCost: unitPrice * (20 + i * 10)  ← ISSUE 행 수량과 무관 → |수량|의 2배
    expect(seed, 'totalCost 가 수량과 다른 식을 쓴다').not.toMatch(/totalCost:\s*\(item\.unitPrice \?\? 1000\) \* \(20 \+ i \* 10\)/);
    expect(seed).toContain('Math.abs(txQty)');
  });

  it('🔴 증상 총점은 항목의 합이다 (리터럴로 찍지 않는다)', () => {
    const seed = read('prisma/seed.ts');
    expect(seed, 'ESAS 총점을 `40 + i*3` 리터럴로 되돌렸다').not.toMatch(/totalScore:\s*40 \+ i \* 3/);
  });

  it('🔴 조제 총량은 투여 빈도 × 일수다', () => {
    const seed = read('prisma/seed.ts');
    // 옛 코드: durations[i%3] * (i%3 === 0 ? 3 : 2) → '1일 1회 × 30일'이 60정
    expect(seed, "'1일 1회' 처방이 다시 2배가 된다").not.toMatch(/durations\[i % 3\] \* \(i % 3 === 0 \? 3 : 2\)/);
    expect(seed).toContain('dosesPerDay');
  });

  it('🔴 혈액제제 상태는 만료일에서 파생된다 (만료품이 AVAILABLE 로 남지 않는다)', () => {
    const seed = read('prisma/seed.ts');
    expect(seed, "status 를 다시 'AVAILABLE' 기본값으로 두었다 — 만료 혈소판이 출고 가능 재고가 된다").not.toMatch(
      /status:\s*\(bp as any\)\.status \?\? 'AVAILABLE'/,
    );
    expect(seed).toContain('derivedStatus');
  });

  it('🔴 검사 소견을 종류와 무관한 상수로 넣지 않는다 (뇌파 결과지에 심전도 판독문)', () => {
    const seed = read('prisma/seed.ts');
    expect(seed, 'EKG 판독문이 모든 검사에 상수로 들어간다').not.toMatch(
      /findings: stat === 'COMPLETED' \? 'Normal sinus rhythm/,
    );
    expect(seed).toContain('DIAG_NORMAL_FINDINGS');
  });
});

describe('시드 생성기 — 판정 규칙은 정본 하나다 (P12)', () => {
  it('🔴 NEWS2 점수·등급을 리터럴로 찍지 않고 정본이 산출한다', () => {
    const seed = read('prisma/seed.ts');
    expect(seed, 'EWS 점수·등급 리터럴 배열이 되살아났다').not.toMatch(/totalScore:\s*\[1, 7, 9, 2\]/);
    expect(seed, 'NEWS2 는 정본 computeNews2 가 산출한다').toContain('computeNews2');
    // 🔴 스키마에 없는 필드로 되돌아가면 이 블록은 다시 통째로 죽는다 — 그것도 조용히.
    //    9254 줄에서 열린 하나의 거대한 try 가 여기서 터지면 그 뒤 확장 시드 전체가 건너뛰어진다
    //    ("Extended seed partially failed"). seed.ts 는 @ts-nocheck 라 타입도 못 잡는다.
    const ewsBlock = seed.slice(seed.indexOf('// EarlyWarningScore')).slice(0, 4000);
    for (const dead of ['assessedBy:', 'assessedAt:']) {
      expect(ewsBlock, `EarlyWarningScore 에 스키마에 없는 필드 ${dead} 가 되살아났다`).not.toContain(dead);
    }
    for (const required of ['nurseId:', 'spO2:', 'scoreBreakdown:', 'recordedAt:']) {
      expect(ewsBlock, `EarlyWarningScore 필수 필드 ${required} 가 빠졌다 — Prisma 검증 오류로 이 블록이 통째로 죽는다`).toContain(required);
    }
  });

  it('🔴 낙상 위험등급은 Morse 정본이 산출한다 (자가입력 등급 금지)', () => {
    const seed = read('prisma/seed.ts');
    expect(seed, '등급 리터럴이 되살아났다 — 45 는 HIGH 이지 MODERATE 가 아니다').not.toMatch(
      /score: 45, level: 'MODERATE'/,
    );
    expect(seed).toContain("deriveRiskLevel('FALL_RISK', fr.score)");
  });

  it('🔴 활력 이상 판정은 vitals-evaluate 정본이 한다 (시드가 warn 임계를 이상으로 쓰지 않는다)', () => {
    for (const f of ['prisma/seed-chart-richness.ts', 'prisma/seeds/demo-vitals.ts']) {
      const src = read(f);
      expect(src, `${f}: isAbnormal 을 자체 임계로 되돌렸다`).not.toMatch(/isAbnormal:\s*sbp\s*>=\s*140/);
      expect(src, `${f}: 정본 evaluateVitals 를 부르지 않는다`).toContain('evaluateVitals');
    }
  });

  it('🔴 demo-vitals 는 NEWS2 밴드를 손으로 베끼지 않는다 (CommonJS 로 되돌리면 정본을 못 부른다)', () => {
    expect(existsSync(join(API, 'prisma/seeds/demo-vitals.js')), 'demo-vitals.js(CommonJS)가 되살아났다 — TS 정본을 import 할 수 없다').toBe(false);
    const src = read('prisma/seeds/demo-vitals.ts');
    expect(src, '등급 밴드를 손으로 적었다').not.toMatch(/s >= 7 \? 'HIGH'/);
    expect(src).toContain('computeNews2');
  });

  it('🔴 HbA1c 참고상한은 정본(6.5)이다', () => {
    for (const f of ['prisma/seed-chronic-followup.ts', 'prisma/seed-timeline-history.ts']) {
      expect(read(f), `${f}: HbA1c 상한 5.7 이 되살아났다 — 같은 화면에서 참고범위가 갈린다`).not.toContain("'%', 'H', 4, 5.7]");
    }
  });

  it('🔴 비급여 청구 라인은 전액 본인부담이다 (보험자가 비급여를 부담하지 않는다)', () => {
    const sql = read('prisma/seeds/billing-erp-calc.seed.sql');
    expect(sql, 'copay_rate 를 급여여부와 독립 추첨하는 코드가 되살아났다').not.toContain('0.5000, 0.0000]::numeric[]');
    expect(sql, '전액본인부담 표시(full_copay)가 빠졌다').toContain('full_copay');
  });
});

describe('시드 생성기 — 시각은 앞뒤가 맞는다', () => {
  it('🔴 퇴원일이 미래가 되지 않는다', () => {
    const sql = read('prisma/seeds/refresh-current-ops.seed.sql');
    expect(sql, "discharge_date = admit_date + 5일 을 무조건 박으면 어제 입원 환자의 퇴원일이 미래다").not.toMatch(
      /discharge_date = admit_date \+ interval '5 days'/,
    );
    expect(sql).toContain('LEAST(admit_date');
  });

  it('🔴 진료가 끝나지 않은 대기열에 완료시각을 채우지 않는다', () => {
    const sql = read('prisma/seeds/refresh-current-ops.seed.sql');
    expect(sql, 'CASHIER_WAITING 에도 completed_at 이 들어간다').toContain("s.status = 'COMPLETED' AND s.co IS NOT NULL");
  });

  it("🔴 '수술 후' 간호기록이 수술보다 먼저 찍히지 않는다", () => {
    const src = read('prisma/seed-timeline-history.ts');
    expect(src, '입원 당일 22시에 수술 후 통증 기록이 다시 찍힌다(수술은 다음날 09시)').not.toMatch(
      /at\.setDate\(at\.getDate\(\) \+ \(i < 2 \? 0 : 2\)\)/,
    );
  });

  it('🔴 회복실 입실이 수술 종료보다 앞서지 않는다', () => {
    const src = read('prisma/seed-pacu-demo.ts');
    expect(src, '입실 시각을 수술과 무관한 리터럴로 되돌렸다').not.toMatch(/arrivalTime: minAgo\(150\)/);
    expect(src).toContain('const arrivalMin = endedMin - 10');
  });

  it('🔴 소아 성장기록의 측정일이 출생연도에 고정되지 않는다', () => {
    const src = readCode('prisma/seeds/dept-richness.ts');
    // 옛 코드: new Date(by, 0, 15 + m * 12 % 300) — 연산 우선순위상 항상 출생연도(1월 15일 + 최대 299일)
    // 🔴 이 단언은 처음에 `measuredAt: new Date(by, ...)` 라는 **한 가지 표기**만 막아서,
    //    결함을 `const measuredAt = new Date(by, ...)` 로 재주입했더니 통과했다.
    //    금지 표기를 늘어놓는 대신 **있어야 할 파생**을 단언한다 — 측정일은 생년월일에서 나온다.
    expect(src, '측정일이 다시 출생연도로 고정된다(생후 24개월 기록이 돌 이전)').not.toMatch(/new Date\(by, 0, 15/);
    expect(src, '측정일이 생년월일 + 개월수에서 파생되지 않는다').toContain('measuredAt.setMonth(measuredAt.getMonth() + m)');
    // 같은 결함이 예방접종일에도 있었다 — 하반기 출생아의 '생후 0개월 BCG'가 출생 전으로 찍혔다
    expect(src, '예방접종일이 다시 출생연도 1월로 고정된다').not.toMatch(/new Date\(by, Math\.floor\(v\.m\), 15\)/);
    expect(src, '예방접종일이 생년월일에서 파생되지 않는다').toContain('givenAt.setMonth(givenAt.getMonth() + Math.floor(v.m))');
  });
});

describe('시드 생성기 — 불가능한 값을 만들지 않는다', () => {
  it('🔴 소아 신장·두위가 선형식으로 폭주하지 않고 BMI 는 키·몸무게에서 나온다', () => {
    const src = readCode('prisma/seeds/dept-richness.ts');
    // 옛 코드: height: 50 + m * 1.25 (14세 260cm) · headCirc: 34 + m * 0.42 (104.6cm) · bmi: 14 + r*3(난수)
    expect(src, '신장 선형식이 되살아났다 — 168개월이면 260cm').not.toMatch(/height:\s*50 \+ m \* 1\.25/);
    expect(src, '두위 선형식이 되살아났다 — 168개월이면 104.6cm').not.toMatch(/headCirc:\s*34 \+ m \* 0\.42/);
    expect(src, 'BMI 를 난수로 되돌렸다').not.toMatch(/bmi:\s*14 \+ \(r\(10\) \* 3\)/);
    expect(src, 'BMI 는 정본 calcBmi 가 키·몸무게에서 계산한다').toContain('calcBmi(weight, height)');
  });
});
