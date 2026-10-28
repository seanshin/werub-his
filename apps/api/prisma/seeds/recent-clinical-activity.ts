import { assertSeedAllowed } from '../seed-mode-guard';
/**
 * 최근 구간 임상 활동 시드 — 진료 → 오더 → 검사·영상 → 조제 → 청구·수납을 **하나로 잇는다**.
 *
 * 실행:
 *   npx ts-node --transpile-only prisma/seeds/recent-clinical-activity.ts            # 실제 기록
 *   npx ts-node --transpile-only prisma/seeds/recent-clinical-activity.ts --dry-run  # 계획만 검증·출력(쓰기 없음)
 *   RECENT_ACTIVITY_WINDOW_DAYS=28 npx ts-node --transpile-only prisma/seeds/recent-clinical-activity.ts
 *
 * ── 왜 필요한가(2026-08-18 운영 실측) ────────────────────────────────────
 *   orders 는 오늘까지 살아 있는데 encounters 08-05 · lab_results 07-28 · dispensings 07-14 ·
 *   billings(paid) 07-10 · imaging_results 07-09 에서 멈췄다. 화면은 "진료는 했는데 아무 일도
 *   일어나지 않은" 병원을 보여준다. 원인은 기존 시드 upsert 207 개 중 **159 개가 `update: {}`** 라
 *   재실행해도 날짜가 첫 생성 시점에 고착된 것이다.
 *
 * ── 이 시드가 지키는 것 ──────────────────────────────────────────────────
 *   ① **기존 데이터를 훼손하지 않는다.** 진료 행은 새로 만든 것만 쓰고, 기존 진료에는 **붙이기만** 한다.
 *      이미 청구가 있는 진료의 청구는 손대지 않는다.
 *   ② **`update: {}` 를 쓰지 않는다.** 모든 upsert 가 실제 update 페이로드를 갖는다 —
 *      재실행하면 창(기본 6주)이 통째로 앞으로 굴러 오늘까지 연속된다.
 *      🔴 그래서 **오늘 진행 중이던 건은 다음 실행에서 완료 상태로 갱신된다**(창이 미끄러지므로 정상).
 *   ③ **판정은 정본이 한다.** 검사 flag = `ReferenceRangeService.computeFlag`,
 *      기준치 해소 = `ReferenceRangeService.resolve`, 나이 = shared `ageOf`,
 *      본인부담률 = `EligibilityService.resolveCopayRate`, 금액 반올림 = shared `roundBy`.
 *      🔴 값을 손으로 베끼지 않는다 — 베낀 값이 정본과 어긋난 사고가 이 저장소에 여러 건 있다.
 *   ④ **모르는 것은 만들지 않는다.** 기준치 없는 검사항목·마스터에 없는 약·수가 없는 검사는 건너뛴다.
 *      아직 오지 않은 시각의 단계(판독·검증·교부)는 만들지 않는다.
 *   ⑤ **쓰기 전에 불변식을 검증한다**(`collectPlanViolations`). 위반이 하나라도 있으면 **아무것도 쓰지 않는다.**
 *   ⑥ **진료를 만들면 딸린 것까지가 한 벌이다.** 이 시드는 진료·오더·결과·수납뿐 아니라
 *      **환자 여정 이벤트**(`patient_journey_events`)와 **내원 전 활력**(`pre_visit_vitals`)까지 함께 남긴다.
 *      🔴 여정 이벤트 타입·페이로드는 **정본 발행부에서 그대로** 가져왔다(새로 정의하지 않는다) —
 *         "정의만 있고 발행이 없던" 갭이 이 저장소에서 이미 적발된 적 있다(journey_event_coverage).
 *      🔴 활력의 이상 판정·BMI 는 **정본 `evaluateVitals`/`calcBmi`** 가 한다. 임계치는 config
 *         `clinical.vitals.thresholds` 를 정본 `mergeVitalsThresholds` 로 병합해 쓴다.
 *
 * ── 주의 ────────────────────────────────────────────────────────────────
 *   · 시각은 **서버 로컬 시각**으로 판다(`src/common/day-range` 규약). 컨테이너 OS 는 UTC 이고
 *     KST 는 pm2 `TZ` 로만 온다 — 이 시드를 직접 돌릴 때는 `TZ=Asia/Seoul` 을 붙여라.
 *   · 생성 데이터는 전부 시드 UUID(`00000000-0000-4000-a000-ca0…`)를 갖고 `notes` 에 출처를 남긴다.
 *   · 이 저장소의 운영 DB 는 **가상 병원 시드**다(CLAUDE.md). 실환자 데이터가 들어온 뒤에는 돌리지 마라.
 */

import { PrismaClient, Gender, Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ageOf } from '@hospital-run/shared';
import { ReferenceRangeService, ResolvedRange } from '../../src/modules/reference-range/reference-range.service';
// 🔴 활력 이상 판정 임계치 정본(+ config 오버라이드 병합). 시드가 숫자를 적지 않는다.
import { mergeVitalsThresholds } from '../../src/modules/vitals/vitals-evaluate';
import { ConfigRuntimeService } from '../../src/modules/config/config-runtime.service';
import { EligibilityService } from '../../src/modules/eligibility/eligibility.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import {
  LAB_PANELS,
  IMAGING_STUDIES,
  MEDICATION_RECIPES,
  VISIT_TEMPLATES,
  SEED_UUID_HEAD,
  NS,
  buildActivityPlan,
  collectPlanViolations,
  deriveLabItemValue,
  labJourneyDescription,
  labJourneySeverity,
  summarizePlan,
  type ActivityPlan,
  type AttachTarget,
  type LabIntent,
  type LabRange,
  type PlanContext,
  type SeedDiagnosisCode,
  type SeedMedicationCode,
  type SeedPatient,
  type SeedProcedureCode,
} from './recent-activity-plan';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const WINDOW_DAYS = Number(process.env.RECENT_ACTIVITY_WINDOW_DAYS ?? 42);
/** 기존 진료에 붙일 때 되짚는 기간(일). */
const ATTACH_LOOKBACK_DAYS = Number(process.env.RECENT_ACTIVITY_ATTACH_DAYS ?? 30);
/** 새 진료에 돌려쓸 환자 풀 크기 — 너무 크면 한 환자당 방문이 희박해진다. */
const PATIENT_POOL = Number(process.env.RECENT_ACTIVITY_PATIENTS ?? 120);
const SEED_NOTE = '데모 시드(recent-clinical-activity) — 실환자 기록 아님';

// ════════════════════════════════════════════════════════════════════════
// 정본 서비스 — Nest DI 없이 필요한 의존만 넣어 직접 만든다.
// (resolveCopayRate 는 prisma·configRuntime 만 쓰고, computeFlag/resolve 는 prisma 만 쓴다.)
// ════════════════════════════════════════════════════════════════════════
const px = prisma as unknown as PrismaService;
const configRuntime = new ConfigRuntimeService(px, new EventEmitter2());
const eligibility = new EligibilityService(px, configRuntime, undefined as never, undefined as never);
const referenceRange = new ReferenceRangeService(px);
/** 🔴 flag 판정 정본 — 시드가 자기 식으로 판정하지 않는다. */
const computeFlag = (value: number, r: LabRange) => referenceRange.computeFlag(value, r);

// ════════════════════════════════════════════════════════════════════════
// 1. 컨텍스트 수집 (전부 DB 실측 — 이 파일은 가격·기준치를 적어 두지 않는다)
// ════════════════════════════════════════════════════════════════════════

async function loadContext(now: Date): Promise<{ ctx: PlanContext; labTestByCode: Record<string, { nameKo: string; unit: string | null; loincCode: string | null }>; warnings: string[] }> {
  const warnings: string[] = [];

  const allDoctors = await prisma.user.findMany({
    where: { role: 'DOCTOR', isActive: true },
    select: { id: true, department: true, specialty: true, familyName: true, givenName: true },
    orderBy: { email: 'asc' },
  });
  const radiologists = allDoctors.filter((d) => (d.department ?? '').includes('영상') || (d.specialty ?? '').includes('영상'));
  const clinicDoctors = allDoctors.filter((d) => !(d.department ?? '').includes('영상'));
  if (!radiologists.length) warnings.push('영상의학과 의사가 없어 영상 결과는 판독 전(ACQUIRED) 상태로만 남는다 — 판독의를 지어내지 않는다.');

  const labTechs = await prisma.user.findMany({ where: { role: 'LAB_TECH', isActive: true }, select: { id: true }, orderBy: { email: 'asc' } });
  const pharmacists = await prisma.user.findMany({ where: { role: 'PHARMACIST', isActive: true }, select: { id: true }, orderBy: { email: 'asc' } });
  const nurses = await prisma.user.findMany({ where: { role: 'NURSE', isActive: true }, select: { id: true }, orderBy: { email: 'asc' } });
  if (!nurses.length) warnings.push('간호사 계정이 없어 내원 전 활력을 만들지 않는다 — 측정자를 지어내지 않는다.');
  // 🔴 이상 판정 임계치 = 정본 기본값 + 운영 오버라이드(config). 시드가 숫자를 적지 않는다.
  const vitalsThresholds = mergeVitalsThresholds(await configRuntime.get('clinical.vitals.thresholds').catch(() => null));
  if (labTechs.length < 2) warnings.push(`임상병리사 ${labTechs.length}명 — 독립 검증(VERIFIED)을 만들지 않는다.`);
  if (pharmacists.length < 2) warnings.push(`약사 ${pharmacists.length}명 — 2인 확인(VERIFIED)을 만들지 않는다.`);

  // ── 수가 마스터: 코드로만 조회(이름 휴리스틱 금지) ──
  const procedureCodesNeeded = Array.from(new Set([...LAB_PANELS.map((p) => p.procedureCode), ...IMAGING_STUDIES.map((s) => s.procedureCode)]));
  const procedureByCode: Record<string, SeedProcedureCode> = {};
  for (const code of procedureCodesNeeded) {
    const row = await prisma.procedureCode.findFirst({ where: { code, isActive: true }, orderBy: { validFrom: 'desc' } });
    if (!row || row.unitPrice == null) { warnings.push(`수가 ${code} 없음(또는 단가 없음) — 해당 검사는 생성하지 않는다.`); continue; }
    procedureByCode[code] = {
      id: row.id, code: row.code, nameKo: row.nameKo, unitPrice: row.unitPrice,
      copayRate: row.copayRate == null ? null : Number(row.copayRate),
      insuranceCovered: row.insuranceCovered,
    };
  }
  // 진찰료 — 재진 우선(정기 추적 진료가 대부분)
  let consultationCode: SeedProcedureCode | null = null;
  for (const code of ['AA254', 'AA257', 'AA154', 'AA157']) {
    const row = await prisma.procedureCode.findFirst({ where: { code, isActive: true }, orderBy: { validFrom: 'desc' } });
    if (row && row.unitPrice != null) {
      consultationCode = { id: row.id, code: row.code, nameKo: row.nameKo, unitPrice: row.unitPrice, copayRate: row.copayRate == null ? null : Number(row.copayRate), insuranceCovered: row.insuranceCovered };
      break;
    }
  }
  if (!consultationCode) warnings.push('진찰료 수가를 찾지 못해 청구에 진찰료 라인을 넣지 않는다.');

  // ── 약품 마스터: 성분명으로 조회. 마약류·향정은 데모 처방에서 제외. ──
  const medicationByRecipe: Record<string, SeedMedicationCode> = {};
  for (const r of MEDICATION_RECIPES) {
    const row = await prisma.medicationCode.findFirst({
      where: {
        isActive: true,
        narcoticType: null,
        unitPrice: { not: null },
        ingredient: { contains: r.ingredient, mode: 'insensitive' },
      },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, nameKo: true, unitPrice: true, insuranceCode: true },
    });
    if (!row || row.unitPrice == null) { warnings.push(`약품 성분 '${r.ingredient}' 미발견 — 그 약은 처방하지 않는다.`); continue; }
    medicationByRecipe[r.key] = { id: row.id, code: row.code, nameKo: row.nameKo, unitPrice: row.unitPrice, insuranceCode: row.insuranceCode };
  }

  // ── 상병 마스터 ──
  const diagnosisByCode: Record<string, SeedDiagnosisCode> = {};
  for (const code of Array.from(new Set(VISIT_TEMPLATES.map((t) => t.diagnosisCode)))) {
    const row = await prisma.diagnosisCode.findFirst({ where: { code, isActive: true }, orderBy: { validFrom: 'desc' } });
    if (!row) { warnings.push(`상병 ${code} 없음 — 그 템플릿은 상병 없이 진료만 만든다.`); continue; }
    diagnosisByCode[code] = { id: row.id, code: row.code, nameKo: row.nameKo, notPrimary: row.notPrimary, sexRestriction: row.sexRestriction, ageMin: row.ageMin, ageMax: row.ageMax };
  }

  // ── 검사 마스터(이름·단위·LOINC) — LOINC 은 **코드 기반**으로만 가져온다 ──
  const testCodes = Array.from(new Set(LAB_PANELS.flatMap((p) => p.testCodes)));
  const labTestRows = await prisma.labTestCode.findMany({ where: { code: { in: testCodes } }, select: { code: true, nameKo: true, unit: true, loincCode: true } });
  const labTestByCode = Object.fromEntries(labTestRows.map((r) => [r.code, { nameKo: r.nameKo, unit: r.unit, loincCode: r.loincCode }]));
  for (const c of testCodes) if (!labTestByCode[c]) warnings.push(`검사코드 ${c} 마스터 없음 — 그 항목은 결과를 만들지 않는다.`);

  // ── 환자 풀 ──
  const patientRows = await prisma.patient.findMany({
    where: { isActive: true },
    select: { id: true, gender: true, dateOfBirth: true, insuranceType: true },
    orderBy: { mrn: 'asc' },
    take: PATIENT_POOL,
  });
  const grade = String((await configRuntime.get('billing.institution.grade')) ?? 'CLINIC').toLowerCase();
  const patients: SeedPatient[] = [];
  for (const p of patientRows) {
    // 🔴 본인부담률 정본 — 자격조회 우선·보험유형 폴백. 0.3 하드코딩 금지.
    const { rate, copayCategory } = await eligibility.resolveCopayRate(p.id, p.insuranceType, 'OUTPATIENT');
    let flatCopay = 0;
    if (copayCategory === 'MA_TYPE1') flatCopay = Number((await configRuntime.get(`billing.copay.ma1.flat.${grade}`)) ?? 1000);
    else if (copayCategory === 'MA_TYPE2' && grade === 'clinic') flatCopay = Number((await configRuntime.get('billing.copay.ma2.flat.clinic')) ?? 1000);
    patients.push({
      id: p.id,
      gender: p.gender as SeedPatient['gender'],
      ageYears: ageOf(p.dateOfBirth, now), // 🔴 365.25 근사 금지 — 정본 ageOf
      copayRate: rate,
      copayCategory,
      flatCopay,
    });
  }

  // ── 붙일 기존 진료: 최근 N일 · 처방이 (우리 것 말고는) 없는 것 ──
  const attachFrom = new Date(now.getTime() - ATTACH_LOOKBACK_DAYS * 86_400_000);
  const recent = await prisma.encounter.findMany({
    where: { createdAt: { gte: attachFrom, lte: now } },
    select: {
      id: true, patientId: true, doctorId: true, createdAt: true,
      prescriptions: { select: { id: true } },
      billing: { select: { id: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 300,
  });
  const patientIds = new Set(patients.map((p) => p.id));
  const attachTargets: AttachTarget[] = [];
  for (const e of recent) {
    const ourRxHead = `${SEED_UUID_HEAD}${NS.PRESCRIPTION}`;
    const foreignRx = e.prescriptions.some((rx) => !rx.id.startsWith(ourRxHead));
    if (foreignRx) continue; // 이미 임상 활동이 있는 진료는 건드리지 않는다
    if (!patientIds.has(e.patientId)) {
      // 환자 풀 밖이면 본인부담률을 모른다 → 청구를 만들지 않도록 풀에 넣고 실측한다
      const p = await prisma.patient.findUnique({ where: { id: e.patientId }, select: { id: true, gender: true, dateOfBirth: true, insuranceType: true } });
      if (!p) continue;
      const { rate, copayCategory } = await eligibility.resolveCopayRate(p.id, p.insuranceType, 'OUTPATIENT');
      let flatCopay = 0;
      if (copayCategory === 'MA_TYPE1') flatCopay = Number((await configRuntime.get(`billing.copay.ma1.flat.${grade}`)) ?? 1000);
      else if (copayCategory === 'MA_TYPE2' && grade === 'clinic') flatCopay = Number((await configRuntime.get('billing.copay.ma2.flat.clinic')) ?? 1000);
      patients.push({ id: p.id, gender: p.gender as SeedPatient['gender'], ageYears: ageOf(p.dateOfBirth, now), copayRate: rate, copayCategory, flatCopay });
      patientIds.add(p.id);
    }
    // 🔴 남의 측정을 덮지 않는다 — 우리 id 가 아닌 활력이 이미 있으면 그 진료는 활력을 만들지 않는다.
    const ourVitalsHead = `${SEED_UUID_HEAD}${NS.PRE_VISIT_VITALS}`;
    const existingVitals = await prisma.preVisitVitals.findFirst({ where: { encounterId: e.id }, select: { id: true } });
    const hasPreVisitVitals = !!existingVitals && !existingVitals.id.startsWith(ourVitalsHead);
    attachTargets.push({ encounterId: e.id, patientId: e.patientId, doctorId: e.doctorId, visitAt: e.createdAt, hasBilling: !!e.billing, hasPreVisitVitals });
  }

  const ctx: PlanContext = {
    now,
    windowDays: WINDOW_DAYS,
    patients,
    doctors: (clinicDoctors.length ? clinicDoctors : allDoctors).map((d) => ({
      id: d.id,
      department: d.department,
      name: `${d.familyName ?? ''}${d.givenName ?? ''}` || null, // 정본(encounter.service)과 같은 조립
    })),
    labTechIds: labTechs.map((u) => u.id),
    pharmacistIds: pharmacists.map((u) => u.id),
    radiologistIds: radiologists.map((u) => u.id),
    nurseIds: nurses.map((u) => u.id),
    vitalsThresholds,
    procedureByCode,
    consultationCode,
    medicationByRecipe,
    diagnosisByCode,
    attachTargets,
  };
  return { ctx, labTestByCode, warnings };
}

// ════════════════════════════════════════════════════════════════════════
// 2. 검사값 실체화 — 기준치는 **정본이 해소**하고 flag 도 **정본이 판정**한다
// ════════════════════════════════════════════════════════════════════════

interface MaterializedLabItem {
  itemId: string;
  testName: string;
  testCode: string;
  loincCode: string | null;
  value: string;
  unit: string;
  normalMin: number | null;
  normalMax: number | null;
  flag: string | null;
}

const rangeCache = new Map<string, ResolvedRange | null>();

async function resolveRange(testCode: string, loincCode: string | null, gender: string, ageYears: number | null): Promise<ResolvedRange | null> {
  const key = `${testCode}|${gender}|${ageYears ?? 'na'}`;
  if (rangeCache.has(key)) return rangeCache.get(key)!;
  const sex = gender === 'MALE' || gender === 'FEMALE' ? (gender as Gender) : null;
  const r = await referenceRange.resolve({ testCode, loincCode, sex, ageYears });
  rangeCache.set(key, r);
  return r;
}

async function materializeLabItems(
  items: { itemId: string; testCode: string; intent: LabIntent; jitter: number }[],
  patient: SeedPatient,
  labTestByCode: Record<string, { nameKo: string; unit: string | null; loincCode: string | null }>,
): Promise<MaterializedLabItem[]> {
  const out: MaterializedLabItem[] = [];
  for (const spec of items) {
    const master = labTestByCode[spec.testCode];
    if (!master) continue; // 마스터 없는 코드는 결과를 지어내지 않는다
    const range = await resolveRange(spec.testCode, master.loincCode, patient.gender, patient.ageYears);
    if (!range) continue; // 🔴 기준치가 없으면 값을 만들지 않는다(정상/이상을 판정할 근거가 없다)
    const lr: LabRange = { low: range.low, high: range.high, criticalLow: range.criticalLow, criticalHigh: range.criticalHigh };
    if (lr.low == null && lr.high == null && lr.criticalLow == null && lr.criticalHigh == null) continue;
    const derived = deriveLabItemValue(lr, spec.intent, spec.jitter, computeFlag);
    if (!derived) continue;
    out.push({
      itemId: spec.itemId,
      testName: master.nameKo,
      testCode: spec.testCode,
      loincCode: master.loincCode, // 코드 기반 매핑만(이름 매칭 금지)
      value: String(derived.value),
      unit: range.unit ?? master.unit ?? '',
      normalMin: lr.low,
      normalMax: lr.high,
      flag: derived.flag,
    });
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════
// 3. 쓰기 — 🔴 upsert 의 update 는 **비어 있지 않다**(이 시드가 존재하는 이유)
// ════════════════════════════════════════════════════════════════════════

async function writePlan(plan: ActivityPlan, labTestByCode: Record<string, { nameKo: string; unit: string | null; loincCode: string | null }>, patients: SeedPatient[]) {
  const patientById = new Map(patients.map((p) => [p.id, p]));
  const counts = { encounters: 0, diagnoses: 0, prescriptions: 0, orders: 0, labResults: 0, labItems: 0, imaging: 0, dispensings: 0, dispensingItems: 0, billings: 0, billingItems: 0, skippedBillings: 0, preVisitVitals: 0, skippedVitals: 0, journeyEvents: 0 };

  let done = 0;
  for (const v of plan.visits) {
    const patient = patientById.get(v.patientId);
    if (!patient) continue;

    // ── 진료(새로 만든 것만) ──
    if (v.isNewEncounter && v.encounter) {
      const e = v.encounter;
      const encData = {
        patientId: v.patientId,
        doctorId: v.doctorId,
        visitType: e.visitType,
        chiefComplaint: e.chiefComplaint,
        subjective: e.subjective,
        objective: e.objective,
        assessment: e.assessment,
        plan: e.plan,
        status: e.status,
        signedAt: e.signedAt,
        signedBy: e.signedBy,
        createdAt: v.visitAt,
      };
      await prisma.encounter.upsert({ where: { id: v.encounterId }, update: encData, create: { id: v.encounterId, ...encData } });
      counts.encounters++;

      if (v.diagnosis) {
        const dxData = { encounterId: v.encounterId, diagnosisCodeId: v.diagnosis.diagnosisCodeId, type: 'PRIMARY', rank: 1, certainty: 'CONFIRMED' };
        await prisma.encounterDiagnosis.upsert({ where: { id: v.diagnosis.encounterDiagnosisId }, update: dxData, create: { id: v.diagnosis.encounterDiagnosisId, ...dxData } });
        counts.diagnoses++;
      }
    }

    // ── 처방 · 오더 ──
    for (const o of v.orders) {
      const rxData = {
        encounterId: v.encounterId,
        type: o.prescriptionType,
        status: 'ACTIVE' as const,
        medicationCodeId: o.medicationCodeId,
        procedureCodeId: o.procedureCodeId,
        diagnosisCodeId: o.diagnosisCodeId,
        dosage: o.dosage,
        frequency: o.frequency,
        duration: o.duration,
        quantity: o.quantity,
        route: o.route,
        instructions: o.instructions,
        priority: 'ROUTINE',
        source: 'MANUAL',
        createdBy: v.doctorId,
        prescriberId: v.doctorId,
        createdAt: o.createdAt,
      };
      await prisma.prescription.upsert({ where: { id: o.prescriptionId }, update: rxData, create: { id: o.prescriptionId, ...rxData } });
      counts.prescriptions++;

      const orderData = {
        prescriptionId: o.prescriptionId,
        department: o.department,
        status: o.status,
        receivedAt: o.receivedAt, receivedById: o.receivedById,
        startedAt: o.startedAt, startedById: o.startedById,
        completedAt: o.completedAt, completedById: o.completedById,
        priority: 'ROUTINE',
        notes: o.notes,
        createdAt: o.createdAt,
      };
      await prisma.order.upsert({ where: { id: o.orderId }, update: orderData, create: { id: o.orderId, ...orderData } });
      counts.orders++;
    }

    // ── 검사 결과 ──
    // 🔴 여정 이벤트 설명은 **실제 판정된 flag** 에서 나와야 한다(지어낸 '정상'을 박지 않는다).
    const flagsByLabResult = new Map<string, (string | null)[]>();
    for (const r of v.labResults) {
      const items = r.items.length ? await materializeLabItems(r.items, patient, labTestByCode) : [];
      flagsByLabResult.set(r.labResultId, items.map((i) => i.flag));
      const lrData = {
        orderId: r.orderId,
        patientId: r.patientId,
        technicianId: r.technicianId,
        status: r.status,
        collectedAt: r.collectedAt,
        completedAt: r.completedAt,
        verifiedBy: r.verifiedBy,
        verifiedAt: r.verifiedAt,
        notes: SEED_NOTE,
        createdAt: r.collectedAt,
      };
      await prisma.labResult.upsert({ where: { orderId: r.orderId }, update: lrData, create: { id: r.labResultId, ...lrData } });
      counts.labResults++;
      for (const it of items) {
        const itemData = {
          labResultId: r.labResultId,
          testName: it.testName,
          testCode: it.testCode,
          loincCode: it.loincCode,
          value: it.value,
          unit: it.unit,
          normalMin: it.normalMin,
          normalMax: it.normalMax,
          flag: it.flag,
        };
        await prisma.labResultItem.upsert({ where: { id: it.itemId }, update: itemData, create: { id: it.itemId, ...itemData } });
        counts.labItems++;
      }
    }

    // ── 영상 결과 ──
    for (const im of v.imagingResults) {
      const imData = {
        orderId: im.orderId,
        patientId: im.patientId,
        radiologistId: im.radiologistId,
        modality: im.modality,
        bodyPart: im.bodyPart,
        finding: im.finding,
        impression: im.impression,
        status: im.status,
        acquiredAt: im.acquiredAt,
        reportedAt: im.reportedAt,
        createdAt: im.acquiredAt ?? v.visitAt,
      };
      await prisma.imagingResult.upsert({ where: { orderId: im.orderId }, update: imData, create: { id: im.imagingResultId, ...imData } });
      counts.imaging++;
    }

    // ── 조제 ──
    for (const d of v.dispensings) {
      const dData = {
        orderId: d.orderId,
        patientId: d.patientId,
        pharmacistId: d.pharmacistId,
        status: d.status,
        careType: 'OUTPATIENT',
        dispensedAt: d.dispensedAt,
        verifiedBy: d.verifiedBy,
        verifiedAt: d.verifiedAt,
        issuedBy: d.issuedBy,
        issuedAt: d.issuedAt,
        issuedTo: d.issuedTo,
        notes: SEED_NOTE,
        createdAt: d.dispensedAt ?? v.visitAt,
      };
      await prisma.dispensing.upsert({ where: { orderId: d.orderId }, update: dData, create: { id: d.dispensingId, ...dData } });
      counts.dispensings++;
      for (const it of d.items) {
        const diData = { dispensingId: d.dispensingId, medicationCodeId: it.medicationCodeId, prescribedQty: it.prescribedQty, dispensedQty: it.dispensedQty };
        await prisma.dispensingItem.upsert({ where: { id: it.dispensingItemId }, update: diData, create: { id: it.dispensingItemId, ...diData } });
        counts.dispensingItems++;
      }
    }

    // ── 청구·수납 ──
    if (v.billing) {
      const b = v.billing;
      const existing = await prisma.billing.findUnique({ where: { encounterId: b.encounterId }, select: { id: true } });
      if (existing && existing.id !== b.billingId) {
        counts.skippedBillings++; // 🔴 남의 청구는 건드리지 않는다
      } else {
        const bData = {
          encounterId: b.encounterId,
          patientId: b.patientId,
          totalAmount: b.totalAmount,
          insuranceCovered: b.insuranceCovered,
          patientCopay: b.patientCopay,
          status: b.status,
          paidAt: b.paidAt,
          paidAmount: b.paidAmount,
          paymentMethod: b.paymentMethod,
          receiptNo: b.receiptNo,
          copayCategory: b.copayCategory,
          cashierNote: SEED_NOTE,
          createdAt: b.createdAt,
        };
        await prisma.billing.upsert({ where: { encounterId: b.encounterId }, update: bData, create: { id: b.billingId, ...bData } });
        counts.billings++;
        for (const i of b.items) {
          const biData = {
            billingId: b.billingId,
            codeType: i.codeType,
            codeId: i.codeId,
            codeName: i.codeName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            amount: i.amount,
            copayRate: i.copayRate,
            insuranceCategory: i.insuranceCategory,
            fullCopay: i.fullCopay,
            sourcePrescriptionId: i.sourcePrescriptionId,
          };
          await prisma.billingItem.upsert({ where: { id: i.billingItemId }, update: biData, create: { id: i.billingItemId, ...biData } });
          counts.billingItems++;
        }
      }
    }

    // ── 내원 전 활력 ──
    if (v.preVisitVitals) {
      const pv = v.preVisitVitals;
      const existing = await prisma.preVisitVitals.findFirst({ where: { encounterId: pv.encounterId }, select: { id: true } });
      if (existing && existing.id !== pv.vitalsId) {
        counts.skippedVitals++; // 🔴 남의 측정은 건드리지 않는다
      } else {
        const pvData = {
          encounterId: pv.encounterId,
          patientId: pv.patientId,
          nurseId: pv.nurseId,
          systolicBp: pv.systolicBp,
          diastolicBp: pv.diastolicBp,
          heartRate: pv.heartRate,
          temperature: pv.temperature,
          spo2: pv.spo2,
          respiratoryRate: pv.respiratoryRate,
          weight: pv.weight,
          height: pv.height,
          bmi: pv.bmi,
          painScore: pv.painScore,
          notes: pv.notes,
          isAbnormal: pv.isAbnormal, // 정본 evaluateVitals 산출값
          measuredAt: pv.measuredAt,
        };
        await prisma.preVisitVitals.upsert({ where: { id: pv.vitalsId }, update: pvData, create: { id: pv.vitalsId, ...pvData } });
        counts.preVisitVitals++;
      }
    }

    // ── 환자 여정 이벤트 ──
    for (const ev of v.journeyEvents) {
      // 검사 결과 이벤트만 실제 flag 에서 설명·severity 를 채운다(정본 lab.service 와 같은 식)
      let description = ev.description;
      let severity = ev.severity;
      if (ev.fillFromLabResultId) {
        const flags = flagsByLabResult.get(ev.fillFromLabResultId);
        if (!flags || flags.length === 0) continue; // 🔴 결과 항목이 없으면 "결과 완료"라고 말하지 않는다
        description = labJourneyDescription(flags);
        severity = labJourneySeverity(flags);
      }
      const jeData = {
        patientId: ev.patientId,
        eventType: ev.eventType,
        eventAt: ev.eventAt, // 🔴 '지금'이 아니라 그 사실이 일어난 시각
        dataOrigin: 'SEED', // 여정 P1 — 시드 사건(실서비스 전환 때 걸러낼 기준)
        title: ev.title,
        description,
        department: ev.department,
        doctorId: ev.doctorId,
        doctorName: ev.doctorName,
        refType: ev.refType,
        refId: ev.refId,
        navUrl: ev.navUrl,
        severity,
        metadata: ev.metadata ? (ev.metadata as Prisma.InputJsonValue) : undefined,
      };
      await prisma.patientJourneyEvent.upsert({ where: { id: ev.eventId }, update: jeData, create: { id: ev.eventId, ...jeData } });
      counts.journeyEvents++;
    }

    done++;
    if (done % 25 === 0) console.log(`   … ${done}/${plan.visits.length} 방문 기록`);
  }
  return counts;
}

// ════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════

async function main() {
  const now = new Date();
  console.log(`▶ 최근 구간 임상 활동 시드 — 기준 시각 ${now.toISOString()} (로컬 ${now.toString()})`);
  console.log(`   창 ${WINDOW_DAYS}일 · 기존 진료 부착 ${ATTACH_LOOKBACK_DAYS}일 · 환자 풀 ${PATIENT_POOL}${DRY_RUN ? ' · DRY-RUN(쓰기 없음)' : ''}`);

  const { ctx, labTestByCode, warnings } = await loadContext(now);
  for (const w of warnings) console.warn(`   ⚠ ${w}`);

  const plan = buildActivityPlan(ctx);

  // 🔴 쓰기 전에 불변식 검증 — 하나라도 어긋나면 아무것도 쓰지 않는다.
  const violations = collectPlanViolations(plan);
  if (violations.length) {
    console.error(`✖ 계획 불변식 위반 ${violations.length}건 — 아무것도 쓰지 않는다:`);
    for (const v of violations.slice(0, 30)) console.error(`   · ${v}`);
    if (violations.length > 30) console.error(`   … 외 ${violations.length - 30}건`);
    process.exitCode = 1;
    return;
  }

  const s = summarizePlan(plan);
  console.log(`   계획: 방문 ${s.visits}건(신규 ${s.newEncounters} · 부착 ${s.attachedEncounters}) · 오더 ${s.orders} · 검사 ${s.labResults}(항목 ${s.labItems}) · 영상 ${s.imagingResults} · 조제 ${s.dispensings} · 청구 ${s.billings}(수납 ${s.paidBillings})`);
  console.log(`   딸린 것: 여정 이벤트 ${s.journeyEvents} · 내원 전 활력 ${s.preVisitVitals}(이상 ${s.abnormalVitals} = 정본 evaluateVitals 판정)`);
  console.log(`   구간: ${plan.windowStart.toISOString().slice(0, 10)} ~ ${now.toISOString().slice(0, 10)}`);

  if (DRY_RUN) {
    console.log('✔ DRY-RUN — 계획은 정합하다. 쓰기 없이 종료한다.');
    return;
  }

  const counts = await writePlan(plan, labTestByCode, ctx.patients);
  console.log('✔ 기록 완료');
  console.table(counts);
  if (counts.skippedBillings) console.log(`   ℹ 기존 청구가 있어 건너뛴 진료 ${counts.skippedBillings}건 — 훼손 방지`);
  if (counts.skippedVitals) console.log(`   ℹ 기존 활력이 있어 건너뛴 진료 ${counts.skippedVitals}건 — 훼손 방지`);
}

assertSeedAllowed(__filename, 'DEMO'); // 🔴 실행 진입에서만 판정 — 테스트가 이 모듈을 import 하므로 최상단에 두지 않는다(상용 릴리즈 T2-3)
main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
