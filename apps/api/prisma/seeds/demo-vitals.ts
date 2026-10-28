import { assertSeedAllowed } from '../seed-mode-guard';
/**
 * 데모 활력징후 시드 — PreVisitVitals(일반병동) + EarlyWarningScore(NEWS2)
 * 트윈 활력징후/위험 확장 데모용. 이미 vitals 있는 환자는 건너뜀(멱등).
 * 실행: npx ts-node prisma/seeds/demo-vitals.ts
 *
 * 🔴 종전엔 `demo-vitals.js`(CommonJS) 였고, 그래서 정본 TS 모듈을 부를 수 없어
 *    **판정 규칙을 손으로 베껴 적었다.** 베낀 규칙 둘이 정본과 어긋나 있었다:
 *
 *    ① `isAbnormal` — 시드는 `sbp>=140 || sbp<100 || hr>100 || hr<60 || temp>=37.8 || spo2<94 || rr>20`.
 *       정본 `vitals-evaluate.VITALS_THRESHOLDS` 에서 그 값들은 **warn 층**(주의)이고 이상 판정은
 *       `sbp 80–180 · hr 40–130 · temp 35.0–38.5 · spo2 ≥90 · rr 8–30` 이다.
 *       → BP 150/95 처럼 앱 규칙상 정상인 행이 타임라인에서 ABNORMAL 로 붉게 떴다
 *         (`record-timeline.service` 가 `isAbnormal` 을 그대로 렌더한다).
 *       정본 파일 머리말이 "임계치가 세 벌로 갈라져 있었음 → 판정은 여기 하나로 모은다"라고
 *       못박아 둔 바로 그 자리에 시드가 네 번째 벌을 만들고 있었다.
 *
 *    ② NEWS2 등급 밴드 — 시드는 `단일 3점 → MEDIUM`.
 *       ⚠️ src 에 밴드가 **두 벌** 있다: `icu-scores.computeNews2` 는 `총점≥5 || 단일3점 → MEDIUM`,
 *       `patient-safety.calculateNews2`(이 테이블에 쓰는 쪽) 는 `단일3점 → LOW_MEDIUM`.
 *       시드는 제3의 벌을 만들지 않고 **부를 수 있는 정본 하나**(computeNews2)를 쓴다.
 *       src 두 벌은 사람이 통합해야 한다 — 통합되면 이 시드는 자동으로 따라간다.
 */
import { PrismaClient } from '@prisma/client';
import { computeNews2 } from '../../src/modules/icu/icu-scores';
import { evaluateVitals, calcBmi } from '../../src/modules/vitals/vitals-evaluate';

const prisma = new PrismaClient();

const rnd = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[rnd(0, arr.length - 1)];

async function main() {
  const NURSE = (await prisma.user.findFirst({ where: { role: 'NURSE' }, select: { id: true } }))?.id;
  if (!NURSE) throw new Error('간호사 사용자 없음');
  const patients = await prisma.patient.findMany({ select: { id: true } });
  let vCount = 0, eCount = 0, skipped = 0;

  for (let pi = 0; pi < patients.length; pi++) {
    const pid = patients[pi].id;
    const existing = await prisma.preVisitVitals.count({ where: { patientId: pid } });
    if (existing > 0) { skipped++; continue; }

    // 환자별 기저(다양성) — 일부는 만성/고위험 경향
    const highRisk = pi % 6 === 0;          // 약 1/6 고위험 경향
    const measures = rnd(4, 6);             // 측정 4~6회
    for (let m = 0; m < measures; m++) {
      const daysAgo = (measures - m) * rnd(1, 3);
      const measuredAt = new Date(Date.now() - daysAgo * 86400000 - rnd(0, 23) * 3600000);
      const systolicBp = highRisk ? rnd(95, 165) : rnd(105, 135);
      const diastolicBp = Math.round(systolicBp * (0.62 + Math.random() * 0.08));
      const heartRate = highRisk ? rnd(58, 118) : rnd(62, 92);
      const temperature = highRisk ? +(36.3 + Math.random() * 2.0).toFixed(1) : +(36.3 + Math.random() * 0.9).toFixed(1);
      const spo2 = highRisk ? rnd(91, 99) : rnd(95, 99);
      const respiratoryRate = highRisk ? rnd(14, 25) : rnd(14, 19);
      const painScore = rnd(0, highRisk ? 6 : 3);
      const height = 150 + rnd(0, 35);
      const weight = +(45 + Math.random() * 45).toFixed(1);
      const measurement = { systolicBp, diastolicBp, heartRate, temperature, spo2, respiratoryRate, painScore, weight, height };
      // 🔴 이상 판정도 BMI 도 정본이 낸다 — 시드가 자기 식을 쓰면 같은 화면에서 규칙이 갈린다
      const { isAbnormal } = evaluateVitals(measurement);
      await prisma.preVisitVitals.create({
        data: {
          patientId: pid, nurseId: NURSE, ...measurement,
          bmi: calcBmi(weight, height),
          isAbnormal, measuredAt, notes: m === measures - 1 ? '일반병동 정기 측정' : null,
        },
      });
      vCount++;
    }

    // 고위험 경향 환자 + 일부는 NEWS2 기록
    if (highRisk || pi % 4 === 0) {
      const ewsN = rnd(1, 3);
      for (let e = 0; e < ewsN; e++) {
        const onOxygen = highRisk && Math.random() < 0.4;
        const v = {
          respiratoryRate: highRisk ? rnd(16, 26) : rnd(14, 20),
          spo2: highRisk ? rnd(90, 98) : rnd(95, 99),
          // computeNews2 는 보충산소를 fio2(>21) 로 읽는다 — 실내공기는 21%
          fio2: onOxygen ? 32 : 21,
          systolicBp: highRisk ? rnd(92, 150) : rnd(108, 132),
          heartRate: highRisk ? rnd(60, 120) : rnd(64, 90),
          temperature: highRisk ? +(36.5 + Math.random() * 2).toFixed(1) : +(36.4 + Math.random()).toFixed(1),
          consciousness: Math.random() < (highRisk ? 0.15 : 0.02) ? pick(['VOICE', 'CONFUSION']) : 'ALERT',
        };
        const r = computeNews2(v);
        /**
         * 🔴 정본은 **미측정이면 `score: null`**(산출 불가)로 답한다 — 그 사실이 타입에 있다.
         *    시드가 그것을 NOT NULL 컬럼에 넣으면 터진다. 여기서는 모든 활력을 채우므로
         *    실제로 null 이 나오지 않지만, **폴백으로 0 을 넣지 않는다** — 산출 불가면 만들지 않는다.
         *    (0 점은 "재서 정상"이라는 다른 사실이다)
         */
        if (r.score == null || r.riskLevel == null) continue;
        const recordedAt = new Date(Date.now() - (ewsN - e) * rnd(2, 8) * 3600000);
        await prisma.earlyWarningScore.create({
          data: {
            patientId: pid, nurseId: NURSE,
            respiratoryRate: v.respiratoryRate, spO2: v.spo2, supplementalO2: onOxygen, spO2Scale: 1,
            systolicBp: v.systolicBp, heartRate: v.heartRate,
            consciousness: v.consciousness, temperature: v.temperature,
            totalScore: r.score, riskLevel: r.riskLevel,
            /**
             * 🔴 2026-08-28 정정 — 종전 주석은 *"computeNews2 는 `sbp`"* 라고 적고 `r.params.sbp` 를 읽었다.
             *    정본 `News2Breakdown` 은 **양쪽 다 `bp`** 다(`packages/shared/src/news2.ts:43`).
             *    그래서 `r.params.sbp` 는 `undefined` 였고 **혈압 항목이 조용히 사라졌다.**
             *    시드가 tsc 범위 밖이라 컴파일러가 잡지 못한 것이 근본 원인이다.
             *    (운영 코드는 `scoreBreakdown` 을 통째로 넘겨 이 결함이 없다 — 시드 한정)
             */
            scoreBreakdown: { ...r.params },
            escalationRequired: r.riskLevel === 'HIGH' || r.riskLevel === 'MEDIUM',
            recordedAt,
          },
        });
        eCount++;
      }
    }
  }
  console.log(`완료 — PreVisitVitals ${vCount}건, EarlyWarningScore ${eCount}건, 건너뜀 ${skipped}명`);
  await prisma.$disconnect();
}
assertSeedAllowed(__filename, 'DEMO'); // 🔴 실행 진입에서만 판정 — 테스트가 이 모듈을 import 하므로 최상단에 두지 않는다(상용 릴리즈 T2-3)
main().catch((e) => { console.error(e); process.exit(1); });
