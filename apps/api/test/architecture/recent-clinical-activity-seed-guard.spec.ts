import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReferenceRangeService } from '../../src/modules/reference-range/reference-range.service';
import { VITALS_THRESHOLDS, evaluateVitals } from '../../src/modules/vitals/vitals-evaluate';
import {
  LAB_PANELS,
  IMAGING_STUDIES,
  MEDICATION_RECIPES,
  VISIT_TEMPLATES,
  SEED_UUID_HEAD,
  TIMELINE,
  ADULT_AGE,
  NS,
  TIMELINE as TL,
  buildActivityPlan,
  buildRawVitals,
  collectPlanViolations,
  deriveLabItemValue,
  labJourneyDescription,
  labJourneySeverity,
  pickLabIntent,
  pickVitalsAbnormal,
  summarizePlan,
  seedUuid,
  visitsForWeekday,
  type LabIntent,
  type LabRange,
  type PlanContext,
  type SeedPatient,
} from '../../prisma/seeds/recent-activity-plan';

/**
 * 🔴 최근 구간 임상 활동 시드 — **DB 없이** 생성 결과를 검증한다.
 *
 * 원래 결함(2026-08-18 운영 실측): 축마다 최신일이 갈려 "진료는 했는데 아무 일도 안 일어난" 상태였다
 * (encounters 08-05 · lab 07-28 · dispensings 07-14 · billings 07-10 · imaging 07-09).
 * 원인 = 기존 시드 upsert 207 개 중 **159 개가 `update: {}`** 라 재실행해도 날짜가 고착됐다.
 *
 * 🔴 **가드는 결함을 재주입하면 실패해야 가드다.** 재주입 검증(2026-08-18 실행·원복 확인)은
 *    각 describe 블록 주석에 적어 두었다.
 *
 * 생성기 정본: prisma/seeds/recent-activity-plan.ts
 * 러너:        prisma/seeds/recent-clinical-activity.ts
 */

// ── 정본 판정기(러너가 쓰는 것과 **같은 함수**) ──────────────────────────
const svc = new ReferenceRangeService({} as never);
const computeFlag = (v: number, r: LabRange) => svc.computeFlag(v, r);

// ── 합성 컨텍스트 ────────────────────────────────────────────────────────
const NOW = new Date(2026, 7, 18, 15, 30, 0, 0); // 2026-08-18 15:30 로컬

function makePatients(n: number): SeedPatient[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
    gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
    ageYears: 30 + (i % 45),
    copayRate: i % 9 === 0 ? 0 : 0.3,
    copayCategory: i % 9 === 0 ? 'MEDICAID' : 'NHI',
    flatCopay: 0,
  }));
}

function makeContext(over: Partial<PlanContext> = {}): PlanContext {
  const procedureByCode = Object.fromEntries(
    [...LAB_PANELS.map((p) => p.procedureCode), ...IMAGING_STUDIES.map((s) => s.procedureCode)].map((code, i) => [
      code,
      { id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`, code, nameKo: `수가 ${code}`, unitPrice: 1000 + i * 130, copayRate: 0.3, insuranceCovered: true },
    ]),
  );
  const medicationByRecipe = Object.fromEntries(
    MEDICATION_RECIPES.map((r, i) => [
      r.key,
      { id: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`, code: `M${i}`, nameKo: `${r.ingredient} 정`, unitPrice: 90 + i * 17, insuranceCode: i === 4 ? null : `INS${i}` },
    ]),
  );
  const diagnosisByCode = Object.fromEntries(
    Array.from(new Set(VISIT_TEMPLATES.map((t) => t.diagnosisCode))).map((code, i) => [
      code,
      { id: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`, code, nameKo: `상병 ${code}`, notPrimary: false, sexRestriction: null, ageMin: null, ageMax: null },
    ]),
  );
  return {
    now: NOW,
    windowDays: 42,
    patients: makePatients(40),
    doctors: [1, 2, 3].map((i) => ({ id: `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`, department: '내과', name: `의사${i}` })),
    labTechIds: ['66666666-6666-4666-8666-000000000001', '66666666-6666-4666-8666-000000000002'],
    pharmacistIds: ['77777777-7777-4777-8777-000000000001', '77777777-7777-4777-8777-000000000002'],
    radiologistIds: ['88888888-8888-4888-8888-000000000001'],
    nurseIds: ['bbbbbbbb-bbbb-4bbb-8bbb-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002'],
    // 🔴 임계치는 정본 기본값을 그대로 — 테스트가 자기 숫자를 만들면 정본과 갈라진다
    vitalsThresholds: VITALS_THRESHOLDS,
    procedureByCode,
    consultationCode: { id: '99999999-9999-4999-8999-000000000001', code: 'AA254', nameKo: '재진 진찰료(병원)', unitPrice: 15280, copayRate: 0.3, insuranceCovered: true },
    medicationByRecipe,
    diagnosisByCode,
    attachTargets: [
      {
        encounterId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
        patientId: makePatients(40)[3].id,
        doctorId: '55555555-5555-4555-8555-000000000001',
        visitAt: new Date(NOW.getTime() - 6 * 86_400_000),
        hasBilling: false,
        hasPreVisitVitals: false,
      },
      {
        encounterId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
        patientId: makePatients(40)[7].id,
        doctorId: '55555555-5555-4555-8555-000000000002',
        visitAt: new Date(NOW.getTime() - 2 * 86_400_000),
        hasBilling: true, // 기존 청구 — 손대면 안 된다
        hasPreVisitVitals: true, // 기존 활력 — 손대면 안 된다
      },
    ],
    ...over,
  };
}

// ════════════════════════════════════════════════════════════════════════
describe('① 계획 불변식 — 시각 순서·상태 정합·참조 무결성', () => {
  /**
   * 🔴 재주입 검증: `recent-activity-plan.ts` 의 TIMELINE 에서
   *      labCollected: 46  →  labCollected: 30   (오더 접수 40 보다 앞으로)
   *    으로 되돌리면 "채혈이 오더 접수보다 앞선다" 가 수백 건 터진다. 원복 확인함.
   *    같은 방식으로 `imagingReported: 120 → 70`(촬영 78 보다 앞) 도 실패한다.
   */
  const plan = buildActivityPlan(makeContext());

  it('위반이 하나도 없다', () => {
    const v = collectPlanViolations(plan);
    expect(v.slice(0, 20)).toEqual([]);
    expect(v.length).toBe(0);
  });

  it('충분한 양을 만든다 — 오늘까지 끊기지 않게', () => {
    const s = summarizePlan(plan);
    expect(s.visits).toBeGreaterThan(120);
    expect(s.orders).toBeGreaterThan(200);
    expect(s.labResults).toBeGreaterThan(100);
    expect(s.dispensings).toBeGreaterThan(80);
    expect(s.billings).toBeGreaterThan(100);
    expect(s.imagingResults).toBeGreaterThan(10);
  });

  it('🔴 미래 시각이 하나도 없다 — 아직 오지 않은 일을 기록하지 않는다', () => {
    const times: Date[] = [];
    for (const v of plan.visits) {
      times.push(v.visitAt);
      if (v.encounter?.signedAt) times.push(v.encounter.signedAt);
      for (const o of v.orders) times.push(...([o.createdAt, o.receivedAt, o.startedAt, o.completedAt].filter(Boolean) as Date[]));
      for (const r of v.labResults) times.push(...([r.collectedAt, r.completedAt, r.verifiedAt].filter(Boolean) as Date[]));
      for (const i of v.imagingResults) times.push(...([i.acquiredAt, i.reportedAt].filter(Boolean) as Date[]));
      for (const d of v.dispensings) times.push(...([d.dispensedAt, d.verifiedAt, d.issuedAt].filter(Boolean) as Date[]));
      if (v.billing) times.push(...([v.billing.createdAt, v.billing.paidAt].filter(Boolean) as Date[]));
    }
    const future = times.filter((t) => t.getTime() > NOW.getTime());
    expect(future.map((t) => t.toISOString())).toEqual([]);
  });

  it('오늘 건은 아직 안 끝난 단계를 기록하지 않는다 (진행 중인 병원)', () => {
    const today = plan.visits.filter((v) => v.visitAt.toDateString() === NOW.toDateString());
    expect(today.length).toBeGreaterThan(0);
    // 15:30 기준이면 오전 진료는 전부 완료됐어야 하고, 상태·시각은 위 불변식이 이미 검증한다.
    for (const v of today) {
      for (const o of v.orders) {
        if (o.status !== 'COMPLETED') expect(o.completedAt).toBeNull();
      }
    }
  });

  it('구간이 창 전체를 덮는다 — 하루도 통째로 비지 않는다(일요일 휴진 제외)', () => {
    const days = new Set(plan.visits.filter((v) => v.isNewEncounter).map((v) => v.visitAt.toDateString()));
    let expected = 0;
    for (let d = 0; d < 42; d++) {
      const day = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - d);
      if (visitsForWeekday(day.getDay()) > 0) expected++;
    }
    expect(days.size).toBe(expected);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('② 기존 데이터 훼손 금지', () => {
  const plan = buildActivityPlan(makeContext());

  it('기존 진료는 진료 행을 수정하지 않는다(붙이기만)', () => {
    const attached = plan.visits.filter((v) => !v.isNewEncounter);
    expect(attached.length).toBeGreaterThan(0);
    for (const v of attached) {
      expect(v.encounter).toBeNull();
      expect(v.diagnosis).toBeNull();
      expect(v.orders.length).toBeGreaterThan(0);
    }
  });

  it('🔴 이미 청구가 있는 진료에는 청구를 만들지 않는다', () => {
    const withExisting = plan.visits.find((v) => v.encounterId === 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002');
    expect(withExisting).toBeDefined();
    expect(withExisting!.billing).toBeNull();
  });

  it('만드는 행은 전부 시드 UUID 네임스페이스 안에 있다(운영 데이터와 구분)', () => {
    const ids: string[] = [];
    for (const v of plan.visits) {
      if (v.isNewEncounter) ids.push(v.encounterId);
      for (const o of v.orders) ids.push(o.orderId, o.prescriptionId);
      for (const r of v.labResults) ids.push(r.labResultId, ...r.items.map((i) => i.itemId));
      for (const i of v.imagingResults) ids.push(i.imagingResultId);
      for (const d of v.dispensings) ids.push(d.dispensingId, ...d.items.map((i) => i.dispensingItemId));
      if (v.billing) ids.push(v.billing.billingId, ...v.billing.items.map((i) => i.billingItemId));
    }
    expect(ids.length).toBeGreaterThan(500);
    expect(ids.filter((i) => !i.startsWith(SEED_UUID_HEAD))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length); // id 충돌 없음
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('③ 멱등 · 날짜 갱신 — `update: {}` 가 만든 결함의 반대편', () => {
  /**
   * 🔴 재주입 검증: 러너(`recent-clinical-activity.ts`)의 encounter upsert 를
   *      `update: data` → `update: {}` 로 되돌리면 아래 '러너가 update:{} 를 쓰지 않는다' 가 실패한다.
   *    또 생성기의 자연키를 `d${d}s${seq}` → 절대 날짜(`YYYY-MM-DD`)로 바꾸면
   *    '재실행하면 같은 키가 하루 앞으로 굴러간다' 가 실패한다. 둘 다 원복 확인함.
   */
  it('같은 시각으로 두 번 만들면 완전히 같다', () => {
    const a = buildActivityPlan(makeContext());
    const b = buildActivityPlan(makeContext());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('🔴 하루 뒤에 다시 만들면 같은 키의 행이 하루 앞으로 갱신된다(고착 금지)', () => {
    const a = buildActivityPlan(makeContext());
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    const b = buildActivityPlan(makeContext({ now: tomorrow }));

    const byKeyA = new Map(a.visits.filter((v) => v.isNewEncounter).map((v) => [v.key, v]));
    const byKeyB = new Map(b.visits.filter((v) => v.isNewEncounter).map((v) => [v.key, v]));
    const shared = [...byKeyA.keys()].filter((k) => byKeyB.has(k));
    expect(shared.length).toBeGreaterThan(100);

    for (const k of shared) {
      const va = byKeyA.get(k)!;
      const vb = byKeyB.get(k)!;
      expect(vb.encounterId).toBe(va.encounterId); // 같은 행
      expect(vb.visitAt.getTime()).toBe(va.visitAt.getTime() + 86_400_000); // 날짜는 갱신
    }
  });

  it('🔴 러너가 `update: {}` 를 쓰지 않는다 — 그게 이 결함의 원인이었다', () => {
    const raw = readFileSync(join(__dirname, '..', '..', 'prisma', 'seeds', 'recent-clinical-activity.ts'), 'utf-8');
    // 주석은 뺀다 — 이 파일은 결함을 **설명**하느라 `update: {}` 를 문서에 적어 두었다.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const upserts = code.match(/\.upsert\(/g) ?? [];
    expect(upserts.length).toBeGreaterThan(8);
    expect(code).not.toMatch(/update:\s*\{\s*\}/);
    // 모든 upsert 가 실제 페이로드를 갖는지 — `update: <식별자>Data`
    expect(code.match(/update:\s*\w+Data\b/g)?.length ?? 0).toBeGreaterThanOrEqual(upserts.length);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('④ 검사값 — 값은 기준치에서 나오고 flag 는 정본이 판정한다', () => {
  /**
   * 🔴 재주입 검증: `deriveLabItemValue` 의 마지막 줄을
   *      `const flag = computeFlag(rounded, range);`  →  `const flag = intent;`
   *    로 바꾸면(= 의도한 flag 를 그대로 저장) 아래 '값과 flag 가 정본 판정과 일치한다' 가
   *    반올림 경계에서 깨진다. 더 확실한 재주입은 `roundBy(positive,'labValue')` 를
   *    `Math.round(positive)` 로 바꾸는 것 — 소수 기준치(HbA1c·Cr)에서 무더기로 실패한다. 원복 확인함.
   */
  // 실제 기준치 마스터가 갖는 여러 모양 — 양끝 있음 / 상한만 / 하한만 / 위급역치 있음·없음
  const RANGES: { name: string; r: LabRange }[] = [
    { name: 'WBC 4000-10000', r: { low: 4000, high: 10000, criticalLow: null, criticalHigh: null } },
    { name: 'Hb(M) 13.0-17.5', r: { low: 13, high: 17.5, criticalLow: null, criticalHigh: null } },
    { name: 'K 3.5-5.0 (위급 2.8/6.5)', r: { low: 3.5, high: 5.0, criticalLow: 2.8, criticalHigh: 6.5 } },
    { name: 'Na 136-145 (위급 120/160)', r: { low: 136, high: 145, criticalLow: 120, criticalHigh: 160 } },
    { name: 'Glucose 70-110 (위급 40/500)', r: { low: 70, high: 110, criticalLow: 40, criticalHigh: 500 } },
    { name: 'CRP <0.5 (상한만)', r: { low: null, high: 0.5, criticalLow: null, criticalHigh: null } },
    { name: 'Cr(F) 0.6-1.1', r: { low: 0.6, high: 1.1, criticalLow: null, criticalHigh: null } },
    { name: 'HbA1c 4.0-6.0', r: { low: 4, high: 6, criticalLow: null, criticalHigh: null } },
    { name: '위급역치만(범위 없음)', r: { low: null, high: null, criticalLow: 2.8, criticalHigh: 6.5 } },
  ];
  const INTENTS: LabIntent[] = ['N', 'H', 'L', 'HH', 'LL'];

  it('🔴 저장되는 flag 는 항상 정본이 그 값에서 판정한 값이다', () => {
    const bad: string[] = [];
    for (const { name, r } of RANGES) {
      for (const intent of INTENTS) {
        for (let j = 0; j < 20; j++) {
          const d = deriveLabItemValue(r, intent, j / 20, computeFlag);
          if (!d) continue;
          const recomputed = computeFlag(d.value, r);
          if (recomputed !== d.flag) bad.push(`${name}/${intent}/j${j}: 저장 ${d.flag} ≠ 재판정 ${recomputed} (값 ${d.value})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('값이 양수이고 임상적으로 터무니없지 않다 — 기준치 대비 배수 상한', () => {
    const bad: string[] = [];
    for (const { name, r } of RANGES) {
      for (const intent of INTENTS) {
        for (let j = 0; j < 20; j++) {
          const d = deriveLabItemValue(r, intent, j / 20, computeFlag);
          if (!d) continue;
          if (d.value <= 0) bad.push(`${name}/${intent}: 0 이하 (${d.value})`);
          const ceiling = (r.criticalHigh ?? r.high ?? 1) * 3;
          if (d.value > ceiling) bad.push(`${name}/${intent}: 기준치 대비 과도 (${d.value} > ${ceiling})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('🔴 기준치가 전혀 없으면 값을 지어내지 않는다(null)', () => {
    const empty: LabRange = { low: null, high: null, criticalLow: null, criticalHigh: null };
    for (const intent of INTENTS) {
      expect(deriveLabItemValue(empty, intent, 0.5, computeFlag)).toBeNull();
    }
  });

  it('🔴 위급값은 드물고, 이상값은 있되 과하지 않다 — 거짓 경보는 진짜 경보를 죽인다', () => {
    // 생성기가 실제로 쓰는 분포(pickLabIntent)를 그대로 돌려 본다.
    const N = 20000;
    let critical = 0;
    let abnormal = 0;
    for (let i = 0; i < N; i++) {
      const intent = pickLabIntent(i / N, false);
      if (intent === 'HH' || intent === 'LL') critical++;
      if (intent !== 'N') abnormal++;
    }
    expect(critical / N).toBeLessThan(0.05);
    expect(critical / N).toBeGreaterThan(0);
    expect(abnormal / N).toBeGreaterThan(0.1);
    expect(abnormal / N).toBeLessThan(0.45);
  });

  it('위급역치가 없는 기준치에서는 위급 flag 가 나오지 않는다(억지로 만들지 않는다)', () => {
    const noCrit: LabRange = { low: 4000, high: 10000, criticalLow: null, criticalHigh: null };
    for (const intent of ['HH', 'LL'] as LabIntent[]) {
      const d = deriveLabItemValue(noCrit, intent, 0.5, computeFlag);
      expect(d).not.toBeNull();
      expect(['HH', 'LL']).not.toContain(d!.flag);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('⑤ 금액 — 라인 합·본인부담·수납액이 서로 맞는다', () => {
  /**
   * 🔴 재주입 검증: 생성기에서 `insuranceCovered: totalAmount - patientCopay` 를
   *    `insuranceCovered: totalAmount` 로 바꾸면 '보험부담+본인부담 ≠ 총액'이 전 건 실패한다.
   *    `paidAmount: patientCopay` → `patientCopay + 100` 도 '수납액 ≠ 본인부담금'으로 잡힌다. 원복 확인함.
   */
  const plan = buildActivityPlan(makeContext());
  const billings = plan.visits.map((v) => v.billing).filter(Boolean) as NonNullable<(typeof plan.visits)[number]['billing']>[];

  it('청구가 충분히 생성된다', () => {
    expect(billings.length).toBeGreaterThan(100);
  });

  it('라인 합 = 총액, 보험부담 + 본인부담 = 총액, 수납액 = 본인부담', () => {
    for (const b of billings) {
      expect(b.items.reduce((s, i) => s + i.amount, 0)).toBe(b.totalAmount);
      expect(b.insuranceCovered + b.patientCopay).toBe(b.totalAmount);
      if (b.status === 'PAID') expect(b.paidAmount).toBe(b.patientCopay);
      else expect(b.paidAmount).toBeNull();
    }
  });

  it('🔴 비급여(급여코드 없는 약)는 전액 본인부담으로 잡는다 — 보험 과다청구 금지', () => {
    const nonCovered = billings.flatMap((b) => b.items).filter((i) => i.insuranceCategory === 'NON_COVERED');
    expect(nonCovered.length).toBeGreaterThan(0);
    for (const i of nonCovered) {
      expect(i.copayRate).toBe(1);
      expect(i.fullCopay).toBe(true);
    }
  });

  it('의료급여(본인부담률 0) 환자의 본인부담금은 0 이다 — 0.3 하드코딩이 아니다', () => {
    const zeroRatePatients = new Set(makePatients(40).filter((p) => p.copayRate === 0).map((p) => p.id));
    const theirs = billings.filter((b) => zeroRatePatients.has(b.patientId));
    expect(theirs.length).toBeGreaterThan(0);
    for (const b of theirs) {
      // 수가 마스터 copayRate(0.3)가 있는 라인은 마스터가 이기고(정본 규칙), 약은 환자 율을 쓴다.
      const medLines = b.items.filter((i) => i.codeType === 'MEDICATION' && i.insuranceCategory === 'COVERED');
      for (const i of medLines) expect(i.copayRate).toBe(0);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('⑥ 임상 내용 — 모순을 만들지 않는다', () => {
  it('SOAP 는 검사 결과를 단정하지 않는다(결과는 진료보다 뒤에 나온다)', () => {
    // 결과 판정을 미리 말하는 표현이 템플릿에 없어야 한다.
    const forbidden = ['정상 범위', '정상범위', '수치 정상', '조절 양호', '결과 정상', '음성 확인'];
    const bad: string[] = [];
    for (const t of VISIT_TEMPLATES) {
      const text = `${t.subjective}\n${t.objective}\n${t.assessment}\n${t.plan}`;
      for (const f of forbidden) if (text.includes(f)) bad.push(`${t.key}: '${f}'`);
    }
    expect(bad).toEqual([]);
  });

  it('영상 판독문은 SOAP 에 없는 새 급성 진단을 만들지 않는다', () => {
    const forbidden = ['폐렴', '골절', '종괴', '악성', '천공', '출혈', '경색', '기흉'];
    const bad: string[] = [];
    for (const s of IMAGING_STUDIES) {
      for (const [k, t] of Object.entries({ normal: s.normal, incidental: s.incidental })) {
        const text = `${t.finding} ${t.impression}`;
        for (const f of forbidden) if (text.includes(f)) bad.push(`${s.key}.${k}: '${f}'`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('투약 수량 = 1일 횟수 × 투여일수 (수량이 용법에서 나온다)', () => {
    const plan = buildActivityPlan(makeContext());
    const medOrders = plan.visits.flatMap((v) => v.orders).filter((o) => o.prescriptionType === 'MEDICATION');
    expect(medOrders.length).toBeGreaterThan(50);
    for (const o of medOrders) {
      const recipe = MEDICATION_RECIPES.find((r) => r.dosage === o.dosage && r.frequency === o.frequency && r.durationDays === o.duration);
      expect(recipe, `용법 ${o.dosage}/${o.frequency}/${o.duration}일 이 레시피에 없다`).toBeDefined();
      expect(o.quantity).toBe(recipe!.timesPerDay * recipe!.durationDays);
    }
  });

  it('타임라인 상수 자체가 순서를 지킨다', () => {
    expect(TIMELINE.labOrdered).toBeLessThanOrEqual(TIMELINE.labReceived);
    expect(TIMELINE.labReceived).toBeLessThanOrEqual(TIMELINE.labCollected);
    expect(TIMELINE.imagingStarted).toBeLessThanOrEqual(TIMELINE.imagingAcquired);
    expect(TIMELINE.imagingAcquired).toBeLessThanOrEqual(TIMELINE.imagingCompleted);
    expect(TIMELINE.imagingCompleted).toBeLessThanOrEqual(TIMELINE.imagingReported);
    expect(TIMELINE.pharmacyReceived).toBeLessThanOrEqual(TIMELINE.pharmacyDispensed);
    expect(TIMELINE.pharmacyDispensed).toBeLessThanOrEqual(TIMELINE.pharmacyVerified);
    expect(TIMELINE.pharmacyVerified).toBeLessThanOrEqual(TIMELINE.pharmacyIssued);
    expect(TIMELINE.billingCreated).toBeLessThanOrEqual(TIMELINE.billingPaid);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('⑦ 인력이 부족하면 절차를 흉내내지 않는다', () => {
  it('검사자가 1명이면 독립 검증(VERIFIED)을 만들지 않는다', () => {
    const plan = buildActivityPlan(makeContext({ labTechIds: ['66666666-6666-4666-8666-000000000001'] }));
    const labs = plan.visits.flatMap((v) => v.labResults);
    expect(labs.length).toBeGreaterThan(0);
    expect(labs.filter((r) => r.status === 'VERIFIED')).toEqual([]);
    expect(labs.filter((r) => r.verifiedBy != null)).toEqual([]);
    expect(collectPlanViolations(plan)).toEqual([]);
  });

  it('약사가 1명이면 2인 확인을 만들지 않는다(교부는 그대로 진행)', () => {
    const plan = buildActivityPlan(makeContext({ pharmacistIds: ['77777777-7777-4777-8777-000000000001'] }));
    const disp = plan.visits.flatMap((v) => v.dispensings);
    expect(disp.length).toBeGreaterThan(0);
    expect(disp.filter((d) => d.verifiedBy != null)).toEqual([]);
    expect(disp.some((d) => d.status === 'ISSUED')).toBe(true);
    expect(collectPlanViolations(plan)).toEqual([]);
  });

  it('판독의가 없으면 소견을 지어내지 않고 ACQUIRED 로 남긴다', () => {
    const plan = buildActivityPlan(makeContext({ radiologistIds: [] }));
    const imgs = plan.visits.flatMap((v) => v.imagingResults);
    expect(imgs.length).toBeGreaterThan(0);
    for (const i of imgs) {
      expect(i.status).toBe('ACQUIRED');
      expect(i.finding).toBeNull();
      expect(i.impression).toBeNull();
    }
    expect(collectPlanViolations(plan)).toEqual([]);
  });

  it('마스터가 비어 있으면 그 축은 아예 만들지 않는다(가짜 코드 금지)', () => {
    const plan = buildActivityPlan(makeContext({ procedureByCode: {}, medicationByRecipe: {}, consultationCode: null }));
    expect(plan.visits.flatMap((v) => v.orders)).toEqual([]);
    expect(plan.visits.flatMap((v) => v.billing ? [v.billing] : [])).toEqual([]);
    expect(collectPlanViolations(plan)).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('⑧ 환자 여정 이벤트 — 정의만 있고 발행이 없던 갭의 반대편', () => {
  /**
   * 🔴 재주입 검증(2026-08-18 실행·원복 확인):
   *   ① 생성기에서 `for (const o of orders) { ... je(...) }` 블록을 지우면
   *      '오더 수와 오더 여정 이벤트 수가 다르다' 가 전 방문에서 터진다(= 발행 누락 = 그 갭 재현).
   *   ② LAB_RESULT 의 `eventAt: r.completedAt` 를 `eventAt: plan.now` 로 바꾸면
   *      '여정 시각은 사실이 일어난 시각이다' 가 실패한다(모르는 시각을 원장에 박는 것).
   *   ③ 이벤트 타입을 `'VISIT_DONE'` 같은 새 이름으로 바꾸면 '정본에 없는 이벤트 타입' 이 실패한다.
   */
  const plan = buildActivityPlan(makeContext());
  const allEvents = plan.visits.flatMap((v) => v.journeyEvents);

  it('충분히 발행된다', () => {
    const s = summarizePlan(plan);
    expect(s.journeyEvents).toBeGreaterThan(800);
    expect(allEvents.length).toBe(s.journeyEvents);
  });

  it('🔴 이벤트 타입을 새로 정의하지 않는다 — 정본 발행부에 있는 것만 쓴다', () => {
    const svcSrc = readFileSync(join(__dirname, '..', '..', 'src', 'modules', 'journey', 'journey.service.ts'), 'utf-8');
    const lisSrc = readFileSync(join(__dirname, '..', '..', 'src', 'modules', 'journey', 'journey.listener.ts'), 'utf-8');
    const canon = new Set([...`${svcSrc}\n${lisSrc}`.matchAll(/'([A-Z][A-Z_]{3,})'/g)].map((m) => m[1]));
    expect(canon.size).toBeGreaterThan(10);
    const ours = new Set(allEvents.map((e) => e.eventType));
    expect([...ours].filter((t) => !canon.has(t))).toEqual([]);
  });

  it('🔴 eventAt 은 그 사실이 일어난(의료진이 알게 된) 시각이다 — `지금` 이 아니다', () => {
    const bad: string[] = [];
    for (const v of plan.visits) {
      const byType = (t: string) => v.journeyEvents.filter((e) => e.eventType === t);
      if (v.encounter?.signedAt) {
        const e = byType('ENCOUNTER_SIGNED')[0];
        if (e && e.eventAt.getTime() !== v.encounter.signedAt.getTime()) bad.push(`${v.key} SIGNED`);
      }
      for (const r of v.labResults) {
        if (!r.completedAt) continue;
        const e = v.journeyEvents.find((x) => x.refId === r.labResultId);
        if (!e || e.eventAt.getTime() !== r.completedAt.getTime()) bad.push(`${v.key} LAB`);
      }
      for (const im of v.imagingResults) {
        if (im.status !== 'REPORTED') continue;
        const e = v.journeyEvents.find((x) => x.refId === im.imagingResultId);
        if (!e || e.eventAt.getTime() !== im.reportedAt!.getTime()) bad.push(`${v.key} IMG`);
      }
      for (const d of v.dispensings) {
        if (!d.dispensedAt) continue;
        const e = v.journeyEvents.find((x) => x.refId === d.dispensingId);
        if (!e || e.eventAt.getTime() !== d.dispensedAt.getTime()) bad.push(`${v.key} DISP`);
      }
      for (const o of v.orders) {
        const e = v.journeyEvents.find((x) => x.refId === o.orderId);
        if (!e || e.eventAt.getTime() !== o.createdAt.getTime()) bad.push(`${v.key} ORDER`);
      }
      if (v.billing?.paidAt) {
        const e = byType('BILLING_PAID')[0];
        if (!e || e.eventAt.getTime() !== v.billing.paidAt.getTime()) bad.push(`${v.key} PAID`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('🔴 없는 사실에는 이벤트를 발행하지 않는다 (미완료 검사·미판독 영상)', () => {
    for (const v of plan.visits) {
      const labEvents = v.journeyEvents.filter((e) => e.eventType === 'LAB_RESULT');
      expect(labEvents.length).toBe(v.labResults.filter((r) => r.completedAt).length);
      const imgEvents = v.journeyEvents.filter((e) => e.eventType === 'IMAGING_RESULT');
      expect(imgEvents.length).toBe(v.imagingResults.filter((i) => i.status === 'REPORTED').length);
    }
  });

  it('🔴 대기열 행을 만들지 않으므로 RECEPTION_CHECKIN 을 발행하지 않는다(가짜 대기번호 금지)', () => {
    expect(allEvents.filter((e) => e.eventType === 'RECEPTION_CHECKIN')).toEqual([]);
    expect(allEvents.filter((e) => e.refType === 'WAITING_QUEUE')).toEqual([]);
    expect(allEvents.filter((e) => e.metadata != null)).toEqual([]);
  });

  it('🔴 남의 진료에는 진료 시작·서명 이벤트를 발행하지 않는다(중복 발행 금지)', () => {
    for (const v of plan.visits.filter((x) => !x.isNewEncounter)) {
      expect(v.journeyEvents.map((e) => e.eventType)).not.toContain('ENCOUNTER_START');
      expect(v.journeyEvents.map((e) => e.eventType)).not.toContain('ENCOUNTER_SIGNED');
    }
  });

  it('검사 결과 이벤트의 설명·severity 는 실제 flag 에서 나온다 (정본 lab.service 산식)', () => {
    expect(labJourneyDescription(['N', 'N'])).toBe('2개 항목 · 정상');
    expect(labJourneySeverity(['N', 'N'])).toBeNull();
    expect(labJourneyDescription(['H', 'N'])).toBe('2개 항목 · 이상 1건');
    expect(labJourneySeverity(['H', 'N'])).toBe('WARNING');
    // 🔴 위급(HH/LL)을 부분매칭(H/L)으로 보면 여기가 WARNING 으로 떨어진다 — 정본 lab-flags 를 쓴다
    expect(labJourneyDescription(['HH', 'N'])).toBe('2개 항목 · 이상 1건 · 🔴위급값');
    expect(labJourneySeverity(['HH', 'N'])).toBe('CRITICAL');
    expect(labJourneySeverity(['LL'])).toBe('CRITICAL');
    expect(labJourneySeverity([null])).toBeNull();
  });

  it('계획 단계의 검사 이벤트는 설명을 비워 둔다 — 러너가 실제 flag 로 채운다', () => {
    const labEvents = allEvents.filter((e) => e.eventType === 'LAB_RESULT');
    expect(labEvents.length).toBeGreaterThan(100);
    for (const e of labEvents) {
      expect(e.description).toBeNull();
      expect(e.severity).toBeNull();
      expect(e.fillFromLabResultId).toBe(e.refId);
    }
  });

  it('🔴 러너가 검사 이벤트 설명을 정본 산식으로 채운다(비워 둔 채 쓰지 않는다)', () => {
    const runner = readFileSync(join(__dirname, '..', '..', 'prisma', 'seeds', 'recent-clinical-activity.ts'), 'utf-8');
    expect(runner).toMatch(/labJourneyDescription\(flags\)/);
    expect(runner).toMatch(/labJourneySeverity\(flags\)/);
    expect(runner).toMatch(/eventAt: ev\.eventAt/);
    expect(runner).not.toMatch(/eventAt: new Date\(\)/); // 🔴 '지금'을 박지 않는다
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('⑨ 내원 전 활력징후 — 판정은 정본, 값은 연령에 맞게', () => {
  /**
   * 🔴 직전 릴리즈 실적발: 시드가 **정상 BP 150/95 를 ABNORMAL** 로 저장했고
   *    **14세 신장 260cm** 를 심었다. 아래 두 축이 그 재발을 막는다.
   *
   * 🔴 재주입 검증(2026-08-18 실행·원복 확인):
   *   ① `buildPreVisitVitalsRow` 의 `isAbnormal: ev.isAbnormal` 을 `isAbnormal: true` 로 바꾸면
   *      'isAbnormal 은 정본 재판정과 일치한다' 가 무더기로 실패한다(= 150/95 를 ABNORMAL 로 찍던 결함).
   *   ② `buildRawVitals` 의 소아 분기 `const height = adult ? … : null` 을
   *      `const height = 260` 으로 바꾸면 '신장 260cm 는 나올 수 없다' 가 실패한다.
   */
  const plan = buildActivityPlan(makeContext());
  const vitals = plan.visits.map((v) => v.preVisitVitals).filter(Boolean) as NonNullable<(typeof plan.visits)[number]['preVisitVitals']>[];

  it('새 진료마다 만들어진다(기존 활력이 있는 진료는 제외)', () => {
    expect(vitals.length).toBeGreaterThan(150);
    const skipped = plan.visits.find((v) => v.encounterId === 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002');
    expect(skipped!.preVisitVitals).toBeNull(); // 기존 활력 — 손대지 않는다
  });

  it('🔴 isAbnormal 은 정본(evaluateVitals) 재판정과 정확히 일치한다', () => {
    const bad: string[] = [];
    for (const pv of vitals) {
      const re = evaluateVitals(
        {
          systolicBp: pv.systolicBp, diastolicBp: pv.diastolicBp, heartRate: pv.heartRate,
          temperature: pv.temperature, spo2: pv.spo2, respiratoryRate: pv.respiratoryRate,
          painScore: pv.painScore, weight: pv.weight, height: pv.height,
        },
        VITALS_THRESHOLDS,
      );
      if (re.isAbnormal !== pv.isAbnormal) bad.push(`${pv.vitalsId}: 저장 ${pv.isAbnormal} ≠ 재판정 ${re.isAbnormal} (BP ${pv.systolicBp}/${pv.diastolicBp} HR ${pv.heartRate} BT ${pv.temperature} SpO2 ${pv.spo2})`);
      if (JSON.stringify(re.abnormalLabels) !== JSON.stringify(pv.abnormalLabels)) bad.push(`${pv.vitalsId}: 라벨 불일치`);
      if ((re.bmi ?? null) !== pv.bmi) bad.push(`${pv.vitalsId}: BMI 불일치 (${pv.bmi} vs ${re.bmi})`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('🔴 회귀: 정상 BP 150/95 는 이상이 아니다 — 정본이 그렇게 말한다', () => {
    expect(evaluateVitals({ systolicBp: 150, diastolicBp: 95 }, VITALS_THRESHOLDS).isAbnormal).toBe(false);
    // 생성기가 만든 행 중 그런 값이 이상으로 저장된 것이 없어야 한다
    const wrong = vitals.filter((pv) => pv.isAbnormal && pv.abnormalLabels.length === 0);
    expect(wrong).toEqual([]);
  });

  it('🔴 소아는 신장·체중·BMI 를 비운다 — 성장도표 정본 없이 지어내지 않는다(260cm 재발 방지)', () => {
    const patients = makePatients(40);
    const byId = new Map(patients.map((p) => [p.id, p]));
    for (const pv of vitals) {
      const p = byId.get(pv.patientId);
      if (!p || p.ageYears == null) continue;
      if (p.ageYears < ADULT_AGE) {
        expect(pv.height, `${p.ageYears}세에 신장이 있다`).toBeNull();
        expect(pv.weight).toBeNull();
        expect(pv.bmi).toBeNull();
      }
    }
    // 소아를 강제로 넣어도 마찬가지
    const child = buildRawVitals('child-key', 14, 'MALE', 'NONE');
    expect(child.height).toBeNull();
    expect(child.weight).toBeNull();
  });

  it('성인 체격·활력이 임상적으로 가능한 범위다', () => {
    for (const pv of vitals) {
      if (pv.height != null) { expect(pv.height).toBeGreaterThanOrEqual(140); expect(pv.height).toBeLessThanOrEqual(200); }
      if (pv.weight != null) { expect(pv.weight).toBeGreaterThanOrEqual(35); expect(pv.weight).toBeLessThanOrEqual(150); }
      if (pv.bmi != null) { expect(pv.bmi).toBeGreaterThan(12); expect(pv.bmi).toBeLessThan(45); }
      expect(pv.spo2!).toBeGreaterThanOrEqual(70);
      expect(pv.spo2!).toBeLessThanOrEqual(100);
      expect(pv.diastolicBp!).toBeLessThan(pv.systolicBp!);
      expect(pv.painScore).toBeGreaterThanOrEqual(0);
      expect(pv.painScore).toBeLessThanOrEqual(10);
    }
  });

  it('측정 시각이 접수와 진료 시작 사이다', () => {
    for (const v of plan.visits) {
      const pv = v.preVisitVitals;
      if (!pv) continue;
      expect(pv.measuredAt.getTime()).toBeLessThanOrEqual(v.visitAt.getTime());
      expect(pv.measuredAt.getTime()).toBeGreaterThanOrEqual(v.visitAt.getTime() + TL.checkIn * 60_000);
    }
  });

  it('🔴 이상 활력은 드물다 — 거짓 경보는 진짜 경보를 죽인다', () => {
    const rate = vitals.filter((pv) => pv.isAbnormal).length / vitals.length;
    expect(rate).toBeGreaterThan(0.01);
    expect(rate).toBeLessThan(0.2);
  });

  it('🔴 이상으로 의도한 값은 실제로 정본이 이상으로 판정한다(라벨만 붙이고 마는 일 없음)', () => {
    for (const kind of ['FEVER', 'HYPERTENSIVE', 'HYPOXIA', 'TACHYCARDIA'] as const) {
      for (let i = 0; i < 12; i++) {
        const raw = buildRawVitals(`k${kind}${i}`, 45, i % 2 ? 'FEMALE' : 'MALE', kind);
        const ev = evaluateVitals(raw, VITALS_THRESHOLDS);
        expect(ev.isAbnormal, `${kind}/${i} 가 정본 판정에서 정상으로 나온다`).toBe(true);
      }
    }
    // 반대로 NONE 은 이상이 아니어야 한다
    for (let i = 0; i < 40; i++) {
      const raw = buildRawVitals(`n${i}`, 40, i % 2 ? 'FEMALE' : 'MALE', 'NONE');
      expect(evaluateVitals(raw, VITALS_THRESHOLDS).isAbnormal, `NONE/${i} 가 이상으로 나온다`).toBe(false);
    }
  });

  it('이상 분포 자체가 드물게 설계돼 있다', () => {
    let abnormal = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (pickVitalsAbnormal(i / N) !== 'NONE') abnormal++;
    expect(abnormal / N).toBeGreaterThan(0.02);
    expect(abnormal / N).toBeLessThan(0.15);
  });

  it('간호사가 없으면 활력을 만들지 않는다 — 측정자를 지어내지 않는다', () => {
    const p = buildActivityPlan(makeContext({ nurseIds: [] }));
    expect(p.visits.filter((v) => v.preVisitVitals != null)).toEqual([]);
    expect(collectPlanViolations(p)).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('⑩ 자연키 동결 — 이미 운영 DB 에 들어간 행이 갈라지지 않게', () => {
  /**
   * 🔴 이 시드는 **이미 운영 DB 에 기록됐다**(2026-08-18 코디네이터 실행).
   *    자연키(→ id)가 바뀌면 같은 사실이 **두 행**으로 남는다 — 멱등이 깨지는 방식 중 최악이다.
   *    두 축(여정 이벤트·내원 전 활력)을 덧붙이면서 기존 키를 건드리지 않았음을 여기서 고정한다.
   *
   * 🔴 재주입 검증: `seedUuid` 의 해시 입력을 `${ns}|${naturalKey}` → `${naturalKey}` 로 바꾸거나
   *    방문 키를 `d${d}s${seq}` → `${date}s${seq}` 로 바꾸면 아래가 전부 실패한다. 원복 확인함.
   *
   * 값을 갱신해야 한다면 그것은 **운영 DB 에 중복 행을 만든다는 뜻**이다 — 코디네이터와 상의할 것.
   */
  /** 자연키 → id. 값은 **생성기가 실제로 낸 것**을 옮겨 적었다(2026-08-18). */
  const FROZEN: [string, string, string][] = [
    [NS.ENCOUNTER, 'd0s0', '00000000-0000-4000-a000-ca014bc557a9'],
    [NS.ENCOUNTER, 'd41s0', '00000000-0000-4000-a000-ca010e50efc7'],
    [NS.BILLING, 'd7s1', '00000000-0000-4000-a000-ca0ab366560d'],
  ];

  it('seedUuid 자체가 같은 값을 낸다', () => {
    for (const [ns, key, expected] of FROZEN) {
      expect(seedUuid(ns, key), `${ns}|${key}`).toBe(expected);
    }
  });

  /**
   * 🔴 위 테스트만으로는 **부족하다.** `seedUuid` 를 직접 부르면 생성기가 실제로 어떤 키를 쓰는지는
   *    검사되지 않는다 — 방문 키를 `d0s0` → `v0s0` 로 바꿔도 위는 통과한다
   *    (2026-08-18 재주입에서 실제로 통과했다. **가드가 다른 이유로 통과한 사례**).
   *    그래서 **생성기가 낸 id** 를 본다.
   */
  it('🔴 생성기가 실제로 내는 id 가 동결값과 같다 (운영 DB 중복 방지)', () => {
    const plan = buildActivityPlan(makeContext({ attachTargets: [] }));
    const byKey = new Map(plan.visits.map((v) => [v.key, v]));

    const v0 = byKey.get('d0s0');
    expect(v0, "방문 키 'd0s0' 이 사라졌다 — 자연키가 바뀌면 운영 DB 에 중복 행이 생긴다").toBeDefined();
    expect(v0!.encounterId).toBe('00000000-0000-4000-a000-ca014bc557a9');
    expect(v0!.orders[0].orderId).toBe('00000000-0000-4000-a000-ca04eadb9ac3');
    expect(v0!.orders[0].prescriptionId).toBe('00000000-0000-4000-a000-ca03193dc6ee');
    expect(v0!.labResults[0].labResultId).toBe('00000000-0000-4000-a000-ca05c57adf05');
    expect(v0!.billing!.billingId).toBe('00000000-0000-4000-a000-ca0a6e642ad2');

    // 창의 반대쪽 끝도 고정한다(창 길이·요일 배치가 바뀌면 여기서 걸린다)
    const vEnd = byKey.get('d41s0');
    expect(vEnd, "방문 키 'd41s0' 이 사라졌다").toBeDefined();
    expect(vEnd!.encounterId).toBe('00000000-0000-4000-a000-ca010e50efc7');

    expect(byKey.get('d7s1')!.billing!.billingId).toBe('00000000-0000-4000-a000-ca0ab366560d');
    expect(byKey.get('d1s0')!.labResults[0].labResultId).toBe('00000000-0000-4000-a000-ca050a55627f');
  });

  it('두 축의 네임스페이스가 기존과 겹치지 않는다', () => {
    const all = Object.values(NS);
    expect(new Set(all).size).toBe(all.length);
    expect(NS.JOURNEY).not.toBe(NS.PRE_VISIT_VITALS);
    // 같은 자연키라도 네임스페이스가 다르면 다른 행
    expect(seedUuid(NS.JOURNEY, 'd0s0')).not.toBe(seedUuid(NS.PRE_VISIT_VITALS, 'd0s0'));
    expect(seedUuid(NS.JOURNEY, 'd0s0')).not.toBe(seedUuid(NS.ENCOUNTER, 'd0s0'));
  });

  it('두 축을 붙여도 기존 축의 생성량이 변하지 않는다 (덧붙이기이지 재작성이 아니다)', () => {
    const s = summarizePlan(buildActivityPlan(makeContext()));
    // 코디네이터가 운영에 기록한 규모와 같은 구조 — 여기 숫자가 흔들리면 기존 행이 움직인 것이다.
    expect(s.newEncounters).toBe(162);
    expect(s.orders).toBeGreaterThan(200);
    expect(s.journeyEvents).toBeGreaterThan(0);
    expect(s.preVisitVitals).toBeGreaterThan(0);
  });
});
