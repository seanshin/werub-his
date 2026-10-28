/**
 * 최근 구간 임상 활동 **생성기**(순수 TS·DB 없음) — 시드와 가드 테스트가 같은 표를 본다.
 *
 * 🔴 왜 만들었나(2026-08-18 운영 실측): 축마다 최신일이 갈려 **"진료는 했는데 아무 일도 안 일어난"**
 *    상태였다. orders 는 오늘까지 살아 있는데 encounters 08-05 · lab_results 07-28 ·
 *    dispensings 07-14 · billings(paid) 07-10 · imaging_results 07-09 에서 멈췄다.
 *    원인은 기존 시드 `upsert` 207 개 중 **159 개가 `update: {}`** 라 재실행해도 날짜가
 *    첫 생성 시점에 고착됐기 때문이다. 이 파일은 **그 실수를 반복하지 않는다** —
 *    모든 시각은 실행 시점(`now`)에서 파생되고, 러너는 `update:{}` 를 쓰지 않는다.
 *
 * ── 이 파일이 지키는 규칙 ────────────────────────────────────────────────
 *  ① **순수 함수**다. Prisma·Nest 를 import 하지 않는다 — 시드를 **실행하지 않고** 검증하려고 분리했다.
 *     (같은 이유로 분리된 선례: `prisma/seeds/qi-measurement.ts`)
 *  ② **판정은 정본이 한다.** 검사 flag 는 `ReferenceRangeService.computeFlag` 를 **주입받아** 부른다
 *     (러너·테스트가 같은 함수를 넘긴다). 금액 반올림은 shared `roundBy`.
 *     🔴 값을 손으로 베끼면 정본과 어긋난다 — 이 저장소에서 여러 번 난 사고다(Morse 45→MODERATE 등).
 *  ③ **모르는 것은 만들지 않는다.** 기준치(ReferenceRange)가 없는 검사항목은 값을 지어내지 않고 **건너뛴다**.
 *     아직 오지 않은 시각의 단계는 **생성하지 않는다**(미래 시각 금지·"실행하지 않고 성공 상태만 기록" 금지).
 *  ④ **판독문은 새 진단을 만들지 않는다.** 영상 소견은 정상 또는 **SOAP 와 모순되지 않는 부수 소견**만 쓴다.
 *     SOAP 는 검사 결과를 단정하지 않는다(결과는 진료보다 **뒤에** 나온다 — 그 시점에 알 수 없다).
 *
 * ── UUID 규약 ────────────────────────────────────────────────────────────
 *  기존 시드는 `makeUuid(prefix, index)` 로 **순번**을 id 에 썼다. 🔴 그 방식은 순번이 흔들리면
 *  같은 id 가 다른 대상을 가리킨다(qi-measurement 에서 실제로 터진 결함). 여기서는 같은
 *  시드 UUID 네임스페이스(`00000000-0000-4000-a000-…`)를 유지하되 **자연키에서** id 를 만든다.
 *
 * 정본 참조: apps/api/src/modules/reference-range/reference-range.service.ts (computeFlag)
 *           apps/api/src/modules/billing/billing.service.ts (buildPrescriptionLineItem·computePatientCopay)
 *           packages/shared/src/numeric-policy.ts (roundBy)
 */

import { createHash } from 'node:crypto';
// 🔴 flag 해석은 shared 정본 하나(`lab-flags`). 부분 매칭(H/L 만)을 손으로 적으면
//    위급값(HH·LL)이 정상처럼 새어 나간다 — 이 저장소의 기록된 안전사고 계열이다.
import { roundBy, isAbnormalFlag, isCriticalFlag } from '@hospital-run/shared';
// 🔴 활력 판정·BMI 는 **정본이 한다**. 종전 시드가 정상 BP 150/95 를 ABNORMAL 로 찍고
//    14세 신장 260cm 를 심은 것이 직전 릴리즈에서 적발됐다 — 판정을 손으로 적으면 그렇게 된다.
//    `vitals-evaluate.ts` 는 Nest 데코레이터·DI 없는 순수 TS 라 그대로 import 할 수 있다
//    (선례: seeds/dept-richness.ts 의 calcBmi).
import { evaluateVitals, type VitalsThresholds } from '../../src/modules/vitals/vitals-evaluate';

// ════════════════════════════════════════════════════════════════════════
// 0. 결정적 UUID
// ════════════════════════════════════════════════════════════════════════

/** 시드 데이터 식별자 — 운영 데이터와 구분되는 접두(메인 seed `makeUuid` 와 동일 가족). */
export const SEED_UUID_HEAD = '00000000-0000-4000-a000-';

/** 네임스페이스(4 hex). 기존 시드 prefix 중 `ca0*` 로 시작하는 것은 없다(2026-08-18 전수 확인). */
export const NS = {
  ENCOUNTER: 'ca01',
  ENC_DIAGNOSIS: 'ca02',
  PRESCRIPTION: 'ca03',
  ORDER: 'ca04',
  LAB_RESULT: 'ca05',
  LAB_ITEM: 'ca06',
  IMAGING: 'ca07',
  DISPENSING: 'ca08',
  DISPENSING_ITEM: 'ca09',
  BILLING: 'ca0a',
  BILLING_ITEM: 'ca0b',
  JOURNEY: 'ca0c',
  PRE_VISIT_VITALS: 'ca0d',
} as const;

/**
 * 자연키 → 결정적 UUID. 같은 키는 몇 번 돌려도 같은 행을 가리킨다(멱등의 근거).
 * 🔴 순번(row order)에서 만들지 않는다 — 대상이 바뀌면 id 가 엉뚱한 행을 덮어쓴다.
 */
export function seedUuid(ns: string, naturalKey: string): string {
  if (!/^[0-9a-f]{4}$/.test(ns)) throw new Error(`[recent-activity] 네임스페이스는 4 hex 여야 한다: ${ns}`);
  const hash = createHash('sha1').update(`${ns}|${naturalKey}`).digest('hex').slice(0, 8);
  return `${SEED_UUID_HEAD}${ns}${hash}`;
}

/** 결정적 의사난수(0~1) — 재실행 동일 결과. 기존 시드(dept-richness)와 같은 관용구. */
export function rnd(seed: string, k: number): number {
  const h = createHash('sha1').update(`${seed}#${k}`).digest();
  return ((h[0] << 16) | (h[1] << 8) | h[2]) / 0x1000000;
}

// ════════════════════════════════════════════════════════════════════════
// 1. 시간 축 — 외래 1회 방문의 표준 타임라인(분 단위 오프셋)
// ════════════════════════════════════════════════════════════════════════

/**
 * 🔴 순서에 의미가 있다. 한국 외래는 **진료 → 수납 → 검사/약국**이다.
 *    (그래서 `paidAt` 이 검사 완료보다 앞설 수 있다 — 그건 결함이 아니다.
 *     지켜야 하는 것은 "수납은 진료보다 뒤"·"결과는 오더보다 뒤"다.)
 */
export const TIMELINE = {
  /** 접수 — 진료 시작 25분 전. (WaitingQueue 행은 만들지 않는다 → 아래 주석 참조) */
  checkIn: -25,
  /** 내원 전 활력 측정 — 접수와 진료 사이. */
  preVisitVitals: -15,

  encounterSigned: 20,

  billingCreated: 20,
  billingPaid: 32,

  labOrdered: 22,
  labReceived: 40, // 채혈실 접수
  labStarted: 45,
  labCollected: 46, // 채혈
  labVerifiedAfterComplete: 20, // 독립 검증(다른 검사자)

  imagingOrdered: 23,
  imagingReceived: 50,
  imagingStarted: 70,
  imagingAcquired: 78,
  imagingCompleted: 85, // 촬영 완료 = 오더 완료
  imagingReported: 120, // 판독은 그 뒤

  pharmacyOrdered: 24,
  pharmacyReceived: 45,
  pharmacyDispensed: 55,
  pharmacyVerified: 60, // 2인 확인(다른 약사)
  pharmacyIssued: 65, // 교부
} as const;

const MIN = 60_000;
const addMin = (base: Date, minutes: number) => new Date(base.getTime() + minutes * MIN);

// ════════════════════════════════════════════════════════════════════════
// 2. 검사 패널 · 값 생성
// ════════════════════════════════════════════════════════════════════════

export type LabIntent = 'N' | 'H' | 'L' | 'HH' | 'LL';

export interface LabRange {
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
}

/** `ReferenceRangeService.computeFlag` 의 형태. 러너·테스트가 **정본을 주입**한다. */
export type ComputeFlagFn = (value: number, r: LabRange) => string | null;

export interface LabPanel {
  key: string;
  label: string;
  /** 수가 마스터 코드(ProcedureCode.code) — 러너가 코드로 조회한다(이름 매칭 금지). */
  procedureCode: string;
  /** LabTestCode.code 목록 — 결과 항목. 기준치가 없는 코드는 러너가 건너뛴다. */
  testCodes: string[];
  /** 결과 소요(분) — 오더 시행 시작에서 결과 완료까지. */
  tatMinutes: number;
}

/**
 * 패널 정의. `procedureCode`·`testCodes` 는 메인 시드가 심는 마스터 코드다
 * (`prisma/seed.ts` procedureCodes·labTestCodes). 🔴 값(가격·기준치)은 여기 적지 않는다 —
 * **마스터에서 읽는다.** 여기 적으면 마스터가 바뀔 때 조용히 갈라진다.
 */
export const LAB_PANELS: LabPanel[] = [
  { key: 'CBC', label: '일반혈액검사(CBC)', procedureCode: 'E6541', testCodes: ['L0002', 'L0003', 'L0004', 'L0005'], tatMinutes: 60 },
  { key: 'RENAL', label: '신장기능검사(BUN/Cr)', procedureCode: 'E6551', testCodes: ['L0101', 'L0102'], tatMinutes: 90 },
  { key: 'LFT', label: '간기능검사(AST/ALT)', procedureCode: 'E6561', testCodes: ['L0103', 'L0104'], tatMinutes: 90 },
  { key: 'GLU', label: '혈당검사(Glucose)', procedureCode: 'E6571', testCodes: ['L0105'], tatMinutes: 60 },
  { key: 'HBA1C', label: 'HbA1c(당화혈색소)', procedureCode: 'E6591', testCodes: ['L0106'], tatMinutes: 120 },
  { key: 'LYTE', label: '전해질검사(Na/K)', procedureCode: 'E6512', testCodes: ['L0201', 'L0202'], tatMinutes: 60 },
  { key: 'CRP', label: 'CRP(C-반응성 단백)', procedureCode: 'E6502', testCodes: ['L0108'], tatMinutes: 90 },
  { key: 'TSH', label: '갑상선기능검사(TSH)', procedureCode: 'E6522', testCodes: ['L0601'], tatMinutes: 120 },
];

export const LAB_PANEL_BY_KEY: Record<string, LabPanel> = Object.fromEntries(LAB_PANELS.map((p) => [p.key, p]));

/**
 * 의도한 flag 분포 — **위급값은 드물게**. 기준치가 위급역치를 갖지 않으면 정본이 HH/LL 을 낼 수
 * 없으므로 자연히 N/H/L 로 떨어진다(그때 값을 억지로 만들지 않는다).
 */
export function pickLabIntent(r: number, biasHigh: boolean): LabIntent {
  if (biasHigh) {
    if (r < 0.30) return 'N';
    if (r < 0.82) return 'H';
    if (r < 0.90) return 'L';
    if (r < 0.98) return 'HH';
    return 'LL';
  }
  if (r < 0.70) return 'N';
  if (r < 0.855) return 'H';
  if (r < 0.975) return 'L';
  if (r < 0.99) return 'HH';
  return 'LL';
}

/** 기준치 안/밖 어디를 겨냥할지 정해 **후보값**을 만든다(반올림·판정 전). 불가능하면 null. */
function candidateValue(range: LabRange, intent: LabIntent, j: number): number | null {
  const { low, high, criticalLow: cl, criticalHigh: ch } = range;
  switch (intent) {
    case 'N': {
      if (low != null && high != null) return low + (high - low) * (0.15 + 0.7 * j);
      if (high != null) return high * (0.4 + 0.45 * j);
      if (low != null) return low * (1.05 + 0.5 * j);
      if (cl != null && ch != null) return cl + (ch - cl) * (0.3 + 0.4 * j);
      return null;
    }
    case 'H': {
      if (high == null) return null;
      const cap = ch != null ? ch : high * 1.6;
      if (cap <= high) return null;
      return high + (cap - high) * (0.2 + 0.5 * j);
    }
    case 'L': {
      if (low == null) return null;
      const floor = cl != null ? cl : Math.max(0, low * 0.45);
      if (floor >= low) return null;
      return low - (low - floor) * (0.2 + 0.5 * j);
    }
    case 'HH': {
      if (ch == null || ch <= 0) return null;
      return ch * (1.05 + 0.35 * j);
    }
    case 'LL': {
      if (cl == null || cl <= 0) return null;
      return cl * (0.55 + 0.35 * j);
    }
  }
}

/**
 * 검사값 1건 생성 — **값을 먼저 만들고 flag 는 정본이 판정한다.**
 * 🔴 반대로(플래그를 정해놓고 값을 끼워맞추기) 하면 반올림 한 번에 값과 flag 가 어긋난다.
 *    그래서 `flag` 는 **항상** 주입된 정본(`computeFlag`)이 만든 값이다.
 * 기준치가 아예 없어 어떤 값도 근거를 갖지 못하면 **null**(항목 생략) — 지어내지 않는다.
 */
export function deriveLabItemValue(
  range: LabRange,
  intent: LabIntent,
  jitter: number,
  computeFlag: ComputeFlagFn,
): { value: number; flag: string | null; intentMet: boolean } | null {
  const raw = candidateValue(range, intent, jitter) ?? candidateValue(range, 'N', jitter);
  if (raw == null || !Number.isFinite(raw)) return null;
  const positive = raw > 0 ? raw : Math.max(0.01, Math.abs(raw));
  // 자릿수 정본 — 검사수치는 CLSI 3 유효숫자(`NUMERIC_POLICIES.labValue`)
  const rounded = roundBy(positive, 'labValue');
  if (rounded == null) return null;
  const flag = computeFlag(rounded, range);
  return { value: rounded, flag, intentMet: flag === intent };
}

// ════════════════════════════════════════════════════════════════════════
// 3. 영상 검사 — 수가 코드에 **묶인** 판독문
// ════════════════════════════════════════════════════════════════════════

export interface ImagingStudy {
  key: string;
  /** ProcedureCode.code — 러너가 코드로 조회(가격·급여 여부는 마스터에서). */
  procedureCode: string;
  /** DICOM modality(기존 시드와 동일 표기: CR·CT·US). */
  modality: string;
  bodyPart: string;
  normal: { finding: string; impression: string };
  /**
   * 부수 소견(정상 아님) — 🔴 **SOAP 에 없는 새 급성 진단을 만들지 않는다.**
   * 만성질환 맥락에서 자연스럽거나 우연히 발견되는 양성 소견만 둔다.
   */
  incidental: { finding: string; impression: string };
}

export const IMAGING_STUDIES: ImagingStudy[] = [
  {
    key: 'CXR',
    procedureCode: 'HA011',
    modality: 'CR',
    bodyPart: '흉부',
    normal: {
      finding: '양측 폐야 청명하며 활동성 침윤 음영 없음. 심흉곽비 정상 범위. 양측 늑골횡격막각 예리함. 종격동 폭 정상.',
      impression: '흉부 단순촬영상 특이 소견 없음.',
    },
    incidental: {
      finding: '심흉곽비 경도 증가(0.53). 양측 폐야 청명하며 침윤 음영 없음. 늑골횡격막각 예리함.',
      impression: '경도 심비대. 활동성 폐질환 소견 없음. 임상 경과에 따라 추적 권고.',
    },
  },
  {
    key: 'US_ABD',
    procedureCode: 'HG101',
    modality: 'US',
    bodyPart: '복부',
    normal: {
      finding: '간 실질 에코 균질하며 국소 병변 없음. 담낭 벽 두께 정상, 담석 없음. 총담관 확장 없음. 양측 신장 크기·피질 에코 정상. 복강내 유리액 없음.',
      impression: '복부 초음파상 특이 소견 없음.',
    },
    incidental: {
      finding: '간 실질 에코 경도 증가(신장 피질 대비). 국소 병변 없음. 담낭 벽 두께 정상, 담석 없음. 양측 신장 정상.',
      impression: '경도 지방간 소견. 그 외 특이 소견 없음.',
    },
  },
];

export const IMAGING_BY_KEY: Record<string, ImagingStudy> = Object.fromEntries(IMAGING_STUDIES.map((s) => [s.key, s]));

// ════════════════════════════════════════════════════════════════════════
// 4. 투약 — 성분(ingredient)으로 마스터를 찾는다
// ════════════════════════════════════════════════════════════════════════

export interface MedicationRecipe {
  key: string;
  /** MedicationCode.ingredient 검색어(영문 성분명). 러너가 못 찾으면 **그 약은 건너뛴다**. */
  ingredient: string;
  dosage: string;
  frequency: string;
  /** 1일 투여 횟수 — `quantity = timesPerDay × durationDays` 의 근거. */
  timesPerDay: number;
  durationDays: number;
  route: string;
  instructions: string;
}

/**
 * 🔴 여기 적힌 용법은 **성인 경구 상용량**이다. 마스터에서 찾은 제품의 함량이 다르면
 *    용량 문구와 어긋날 수 있으므로, 러너는 성분명이 정확히 일치하는 항목만 쓴다.
 */
export const MEDICATION_RECIPES: MedicationRecipe[] = [
  { key: 'metformin', ingredient: 'metformin', dosage: '500mg', frequency: '1일 2회', timesPerDay: 2, durationDays: 28, route: 'PO', instructions: '아침·저녁 식후 즉시 복용' },
  { key: 'amlodipine', ingredient: 'amlodipine', dosage: '5mg', frequency: '1일 1회', timesPerDay: 1, durationDays: 28, route: 'PO', instructions: '아침 식후 30분' },
  { key: 'losartan', ingredient: 'losartan', dosage: '50mg', frequency: '1일 1회', timesPerDay: 1, durationDays: 28, route: 'PO', instructions: '아침 식후 30분' },
  { key: 'atorvastatin', ingredient: 'atorvastatin', dosage: '10mg', frequency: '1일 1회', timesPerDay: 1, durationDays: 28, route: 'PO', instructions: '취침 전 복용' },
  { key: 'acetaminophen', ingredient: 'acetaminophen', dosage: '500mg', frequency: '1일 3회', timesPerDay: 3, durationDays: 3, route: 'PO', instructions: '식후 30분·발열 시' },
  { key: 'rebamipide', ingredient: 'rebamipide', dosage: '100mg', frequency: '1일 3회', timesPerDay: 3, durationDays: 14, route: 'PO', instructions: '매 식후 30분' },
  { key: 'levocetirizine', ingredient: 'levocetirizine', dosage: '5mg', frequency: '1일 1회', timesPerDay: 1, durationDays: 7, route: 'PO', instructions: '취침 전 복용' },
];

export const RECIPE_BY_KEY: Record<string, MedicationRecipe> = Object.fromEntries(MEDICATION_RECIPES.map((r) => [r.key, r]));

// ════════════════════════════════════════════════════════════════════════
// 5. 방문 템플릿 — 상병이 검사·영상·투약을 정한다
// ════════════════════════════════════════════════════════════════════════

export interface VisitTemplate {
  key: string;
  /** DiagnosisCode.code(KCD-8). 러너가 코드로 조회하고, 없으면 상병 없이 진료만 만든다. */
  diagnosisCode: string;
  chiefComplaint: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  labPanels: string[];
  /** 이 상병에서 임상적으로 말이 되는 영상만 — 아니면 비운다. */
  imagingKey?: string;
  imagingRatio?: number; // 0~1
  medicationKeys: string[];
  /** 이 상병에서 자연스럽게 이상치가 나오는 검사(예: 당뇨의 혈당·HbA1c). */
  biasHighTestCodes: string[];
}

/**
 * 🔴 SOAP 는 **검사 결과를 단정하지 않는다.** 결과는 이 진료보다 **뒤에** 나오므로
 *    "혈당 조절 양호" 같은 문장은 그 시점에 알 수 없는 것을 말하는 것이다(P1).
 *    그래서 A/P 는 관찰·계획만 적는다.
 */
export const VISIT_TEMPLATES: VisitTemplate[] = [
  {
    key: 'HTN',
    diagnosisCode: 'I10',
    chiefComplaint: '고혈압 정기 추적',
    subjective: '고혈압으로 외래 추적 중. 처방약은 빠짐없이 복용했다고 함. 두통·흉통·호흡곤란 호소 없음. 가정혈압은 측정하지 않았다고 함.',
    objective: '의식 명료, 전신 상태 양호. 흉부 청진상 심잡음 없고 호흡음 정상. 하지 부종 없음.',
    assessment: '본태성 고혈압, 외래 추적. 현재 증상 호소 없음.',
    plan: '1) 현재 처방 유지\n2) 금일 채혈 — 신기능·전해질 추적\n3) 가정혈압 1일 2회 기록 교육\n4) 4주 후 외래 재진',
    labPanels: ['RENAL', 'LYTE'],
    imagingKey: 'CXR',
    imagingRatio: 0.3,
    medicationKeys: ['amlodipine'],
    biasHighTestCodes: [],
  },
  {
    key: 'DM',
    diagnosisCode: 'E11',
    chiefComplaint: '당뇨 정기 추적',
    subjective: '제2형 당뇨로 추적 중. 최근 식사량 늘었다고 함. 자가혈당 측정은 간헐적. 저혈당 증상·시야 변화·발 저림 호소 없음.',
    objective: '의식 명료. 양측 족부 피부 병변 없고 족배동맥 촉지 양호. 복부 압통 없음.',
    assessment: '제2형 당뇨병, 외래 추적. 금일 채혈로 조절 상태 확인 예정.',
    plan: '1) 금일 채혈 — HbA1c·공복혈당·신기능\n2) 결과 확인 후 용량 조정 여부 결정\n3) 식사·운동 교육 재시행\n4) 4주 후 외래 재진',
    labPanels: ['HBA1C', 'GLU', 'RENAL'],
    medicationKeys: ['metformin'],
    biasHighTestCodes: ['L0105', 'L0106'],
  },
  {
    key: 'URI',
    diagnosisCode: 'J00',
    chiefComplaint: '3일 전부터 인후통·콧물',
    subjective: '3일 전부터 인후통, 맑은 콧물, 간헐적 기침. 미열 있었다고 함. 호흡곤란·객혈 없음. 최근 여행력 없음.',
    objective: '인두 발적 관찰. 편도 비대·삼출물 없음. 경부 림프절 압통 없음. 폐 청진상 수포음 없음.',
    assessment: '급성 비인두염(감기). 하기도 침범 시사 소견 없음.',
    plan: '1) 대증 치료 — 해열·진통\n2) 수분 섭취·휴식 교육\n3) 금일 채혈 — 염증 수치 확인\n4) 3일 내 호전 없거나 고열 지속 시 재방문',
    labPanels: ['CRP', 'CBC'],
    imagingKey: 'CXR',
    imagingRatio: 0.25,
    medicationKeys: ['acetaminophen', 'levocetirizine'],
    biasHighTestCodes: ['L0108'],
  },
  {
    key: 'GERD',
    diagnosisCode: 'K21',
    chiefComplaint: '식후 명치 쓰림',
    subjective: '2주 전부터 식후 명치 쓰림과 신물 오름. 야간 증상으로 수면 방해 있음. 흑색변·체중감소·연하곤란 없음.',
    objective: '복부 부드럽고 압통 없음. 장음 정상. 결막 창백 없음.',
    assessment: '위식도역류질환 의심. 경고 증상 없음.',
    plan: '1) 점막보호제 처방\n2) 취침 3시간 전 금식·야식 제한 교육\n3) 복부 초음파로 담도계 감별\n4) 2주 후 증상 재평가',
    labPanels: ['LFT', 'CBC'],
    imagingKey: 'US_ABD',
    imagingRatio: 0.5,
    medicationKeys: ['rebamipide'],
    biasHighTestCodes: [],
  },
  {
    key: 'DYSLIPID',
    diagnosisCode: 'E78',
    chiefComplaint: '이상지질혈증 추적',
    subjective: '이상지질혈증으로 약물 복용 중. 근육통·짙은 소변 등 부작용 의심 증상 없음. 음주는 주 1회 정도.',
    objective: '전신 상태 양호. 황색종 없음. 복부 압통 없음.',
    assessment: '이상지질혈증, 약물 치료 중. 간독성 감시 필요.',
    plan: '1) 스타틴 유지\n2) 금일 채혈 — 간기능 추적\n3) 근육통 발생 시 즉시 내원 교육\n4) 8주 후 외래 재진',
    labPanels: ['LFT', 'RENAL'],
    medicationKeys: ['atorvastatin'],
    biasHighTestCodes: ['L0103', 'L0104'],
  },
  {
    key: 'HTN_TSH',
    diagnosisCode: 'I10',
    chiefComplaint: '피로감 및 혈압 추적',
    subjective: '고혈압 추적 중 최근 피로감 호소. 체중 변화·추위 민감성 변화는 뚜렷하지 않음. 흉통·두근거림 없음.',
    objective: '전신 상태 양호. 갑상선 종대 촉지되지 않음. 하지 부종 없음.',
    assessment: '본태성 고혈압 추적 중 비특이적 피로감. 갑상선기능 감별 필요.',
    plan: '1) 금일 채혈 — 갑상선기능·일반혈액\n2) 항고혈압제 유지\n3) 결과 확인 후 추가 검사 여부 결정\n4) 2주 후 외래',
    labPanels: ['TSH', 'CBC'],
    medicationKeys: ['losartan'],
    biasHighTestCodes: [],
  },
];

// ════════════════════════════════════════════════════════════════════════
// 5-b. 내원 전 활력징후 — 값은 그럴듯하게, **판정은 정본이**
// ════════════════════════════════════════════════════════════════════════

/**
 * 🔴 직전 릴리즈에서 적발된 것(같은 부류의 시드 결함):
 *    · **정상 BP 150/95 를 `isAbnormal=true`** 로 저장 → 화면이 멀쩡한 환자를 이상으로 표시
 *    · **14세 신장 260cm** → 값 자체가 임상적으로 불가능
 *    둘 다 시드가 **판정을 손으로 적고** **값을 아무렇게나 만든** 결과다.
 *
 * 여기서는 갈라놓는다:
 *    ① 값 생성 = 이 파일(연령·성별에 맞는 그럴듯한 범위. 소아는 신장·체중을 **비운다** —
 *       성장도표 정본이 없는데 지어내면 위 260cm 가 다시 난다)
 *    ② 이상 판정·BMI = **정본**(`evaluateVitals`/`calcBmi`, 임계치는 config 병합분을 러너가 주입)
 *    ③ 저장 정규화 = 정본과 같은 `roundBy` 키(vitals.service.record 와 동일)
 */
export type VitalsAbnormalKind = 'NONE' | 'FEVER' | 'HYPERTENSIVE' | 'HYPOXIA' | 'TACHYCARDIA';

/** 이상 활력은 드물게 — 거짓 경보는 진짜 경보를 죽인다. */
export function pickVitalsAbnormal(r: number): VitalsAbnormalKind {
  if (r < 0.92) return 'NONE';
  if (r < 0.955) return 'FEVER';
  if (r < 0.975) return 'HYPERTENSIVE';
  if (r < 0.99) return 'HYPOXIA';
  return 'TACHYCARDIA';
}

export interface RawVitals {
  systolicBp: number;
  diastolicBp: number;
  heartRate: number;
  temperature: number;
  spo2: number;
  respiratoryRate: number;
  painScore: number;
  /** 🔴 소아는 null — 성장도표 정본 없이 신장·체중을 지어내지 않는다. */
  weight: number | null;
  height: number | null;
}

/** 만 19세 이상만 성인 체격 표를 쓴다. */
export const ADULT_AGE = 19;

/** 연령·성별에 맞는 원측정치. 결정적(같은 키 → 같은 값). */
export function buildRawVitals(natural: string, ageYears: number | null, gender: string, kind: VitalsAbnormalKind): RawVitals {
  const r = (k: number) => rnd(natural, k);
  const adult = ageYears == null || ageYears >= ADULT_AGE;
  const male = gender === 'MALE';

  let systolicBp = adult ? 105 + r(1) * 38 : 95 + r(1) * 20;
  let diastolicBp = adult ? 62 + r(2) * 26 : 58 + r(2) * 18;
  let heartRate = adult ? 62 + r(3) * 36 : 78 + r(3) * 34;
  let temperature = 36.3 + r(4) * 0.9;
  let spo2 = 96 + r(5) * 3;
  const respiratoryRate = adult ? 14 + r(6) * 6 : 18 + r(6) * 8;
  const painScore = Math.floor(r(7) * 4);

  // 이상치는 **정본 임계치를 넘도록** 만든다(넘지 않으면 isAbnormal 이 false 로 나오고, 그건 가드가 잡는다)
  if (kind === 'FEVER') temperature = 38.6 + r(8) * 0.8;
  if (kind === 'HYPERTENSIVE') { systolicBp = 182 + r(9) * 18; diastolicBp = 106 + r(10) * 12; }
  if (kind === 'HYPOXIA') spo2 = 87 + r(11) * 3;
  if (kind === 'TACHYCARDIA') heartRate = 131 + r(12) * 15;

  const height = adult ? (male ? 165 + r(13) * 18 : 152 + r(13) * 17) : null;
  const weight = adult ? (male ? 58 + r(14) * 32 : 45 + r(14) * 30) : null;

  return { systolicBp, diastolicBp, heartRate, temperature, spo2, respiratoryRate, painScore, weight, height };
}

export interface PlannedPreVisitVitals {
  vitalsId: string;
  encounterId: string;
  patientId: string;
  nurseId: string;
  measuredAt: Date;
  systolicBp: number | null;
  diastolicBp: number | null;
  heartRate: number | null;
  temperature: number | null;
  spo2: number | null;
  respiratoryRate: number | null;
  weight: number | null;
  height: number | null;
  bmi: number | null;
  painScore: number;
  /** 🔴 정본(`evaluateVitals`)이 판정한 값 — 시드가 정하지 않는다. */
  isAbnormal: boolean;
  abnormalLabels: string[];
  notes: string;
}

/**
 * 저장 행 — 정규화(`roundBy`)와 판정(`evaluateVitals`) 순서가 **정본 vitals.service.record 와 같다**.
 * 🔴 판정을 반올림 **전** 값으로 하면 저장값과 판정이 어긋난다(38.549→38.5 인데 FEVER 판정 같은 것).
 *    그래서 반올림한 값으로 판정한다.
 */
export function buildPreVisitVitalsRow(
  natural: string,
  args: { encounterId: string; patientId: string; nurseId: string; measuredAt: Date; ageYears: number | null; gender: string; thresholds: VitalsThresholds },
): PlannedPreVisitVitals {
  const kind = pickVitalsAbnormal(rnd(natural, 0));
  const raw = buildRawVitals(natural, args.ageYears, args.gender, kind);

  // 정본과 같은 수치 정책 키로 저장 정규화
  const m = {
    systolicBp: roundBy(raw.systolicBp, 'systolicBp'),
    diastolicBp: roundBy(raw.diastolicBp, 'diastolicBp'),
    heartRate: roundBy(raw.heartRate, 'heartRate'),
    temperature: roundBy(raw.temperature, 'temperature'),
    spo2: roundBy(raw.spo2, 'spo2'),
    respiratoryRate: roundBy(raw.respiratoryRate, 'respiratoryRate'),
    weight: roundBy(raw.weight, 'weight'),
    height: roundBy(raw.height, 'height'),
  };
  const ev = evaluateVitals({ ...m, painScore: raw.painScore }, args.thresholds);

  return {
    vitalsId: seedUuid(NS.PRE_VISIT_VITALS, natural),
    encounterId: args.encounterId,
    patientId: args.patientId,
    nurseId: args.nurseId,
    measuredAt: args.measuredAt,
    ...m,
    bmi: roundBy(ev.bmi, 'bmi'),
    painScore: raw.painScore,
    isAbnormal: ev.isAbnormal,
    abnormalLabels: ev.abnormalLabels,
    notes: '외래 접수 후 내원 전 측정(데모 시드) — 실환자 기록 아님',
  };
}

// ════════════════════════════════════════════════════════════════════════
// 5-c. 환자 여정 이벤트 — **정본 발행부의 페이로드를 그대로** 쓴다
// ════════════════════════════════════════════════════════════════════════

/**
 * 🔴 이 저장소에는 **"정의만 있고 발행이 없던"** 갭이 이미 적발돼 있다(journey_event_coverage).
 *    그래서 이벤트 타입·제목·부서·refType 을 **새로 정의하지 않고** 정본 발행부에서 그대로 옮겼다:
 *      · ENCOUNTER_START   ← encounter.service.ts / waiting-queue.service.ts(startConsultation)
 *      · ENCOUNTER_SIGNED  ← encounter.service.ts sign()
 *      · ORDER_CREATED / PRESCRIPTION_ADDED ← journey.listener.ts onOrderCreated (부서 표 포함)
 *      · LAB_RESULT        ← lab.service.ts (설명·severity 산식까지)
 *      · IMAGING_RESULT    ← imaging.service.ts
 *      · DISPENSED         ← journey.listener.ts onDispensed
 *      · BILLING_PAID      ← billing.service.ts (수납 완료 시 직접 create)
 *
 * 🔴 `eventAt` = **의료진이 알게 된 시점**(record_timeline_expansion 규약).
 *    정본은 상태 전이 직후에 발행하므로 각 전이 시각을 그대로 쓴다 —
 *    검사는 `completedAt`(결과가 존재하게 된 순간), 영상은 `reportedAt`(판독이 난 순간),
 *    조제는 `dispensedAt`, 수납은 `paidAt`. `new Date()`(지금)를 박으면 **모르는 시각을 원장에 박는 것**이다.
 *
 * 🔴 RECEPTION_CHECKIN 은 **일부러 발행하지 않는다.** 정본은 `refType:'WAITING_QUEUE'`·`refId`·
 *    `metadata.queueNumber` 를 함께 남기는데 이 시드는 WaitingQueue 행을 만들지 않는다.
 *    없는 대기번호를 지어내느니 이벤트를 남기지 않는 편이 사실에 가깝다.
 */
export const JOURNEY_DEPT_BY_RX_TYPE: Record<string, string> = {
  MEDICATION: '약제부',
  LAB: '진단검사의학과',
  IMAGING: '영상의학과',
};

export interface PlannedJourneyEvent {
  eventId: string;
  patientId: string;
  eventType: string;
  eventAt: Date;
  title: string;
  description: string | null;
  department: string | null;
  doctorId: string | null;
  doctorName: string | null;
  refType: string | null;
  refId: string | null;
  navUrl: string | null;
  severity: string | null;
  metadata: Record<string, unknown> | null;
  /**
   * 🔴 검사 결과 이벤트의 설명·severity 는 **실제 판정된 flag** 에서 나온다.
   *    flag 는 기준치 해소(DB)를 거쳐야 정해지므로 러너가 채운다 — 계획 단계에서는 비운다.
   *    (지어낸 "정상"을 미리 박으면 실제 위급값과 어긋난다)
   */
  fillFromLabResultId?: string;
}

/**
 * 정본 `lab.service` 의 설명 문자열 **산식**(문구를 베끼는 게 아니라 같은 식을 쓴다).
 * 이상/위급 판정은 shared `lab-flags` 정본 — 여기서 다시 정의하지 않는다.
 */
export function labJourneyDescription(flags: (string | null)[]): string {
  const abnormalCount = flags.filter((f) => isAbnormalFlag(f)).length;
  const hasCritical = flags.some((f) => isCriticalFlag(f));
  return `${flags.length}개 항목${abnormalCount > 0 ? ` · 이상 ${abnormalCount}건` : ' · 정상'}${hasCritical ? ' · 🔴위급값' : ''}`;
}

/** 정본 `lab.service` 의 severity 산식(위급 > 이상 > 미표기). */
export function labJourneySeverity(flags: (string | null)[]): string | null {
  const hasCritical = flags.some((f) => isCriticalFlag(f));
  const abnormalCount = flags.filter((f) => isAbnormalFlag(f)).length;
  return hasCritical ? 'CRITICAL' : abnormalCount > 0 ? 'WARNING' : null;
}

// ════════════════════════════════════════════════════════════════════════
// 6. 입력 컨텍스트 (러너가 DB 에서 실측해 채운다)
// ════════════════════════════════════════════════════════════════════════

export interface SeedPatient {
  id: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';
  ageYears: number | null;
  /** `EligibilityService.resolveCopayRate` 가 돌려준 값 — 정본 그대로. */
  copayRate: number;
  copayCategory: string;
  /** 의료급여 외래 정액 본인부담(원). 해당 없으면 0 — 러너가 config 에서 실측. */
  flatCopay: number;
}

export interface SeedDoctor {
  id: string;
  department: string | null;
  /** 여정 `doctorName` — 정본(encounter.service)이 `familyName+givenName` 를 담는다. */
  name: string | null;
}

export interface SeedProcedureCode {
  id: string;
  code: string;
  nameKo: string;
  unitPrice: number;
  copayRate: number | null;
  insuranceCovered: boolean;
}

export interface SeedMedicationCode {
  id: string;
  code: string;
  nameKo: string;
  unitPrice: number;
  /** 급여 등재 대리 신호 — billing.service 의 판정과 같다. */
  insuranceCode: string | null;
}

export interface SeedDiagnosisCode {
  id: string;
  code: string;
  nameKo: string;
  notPrimary: boolean;
  sexRestriction: string | null;
  ageMin: number | null;
  ageMax: number | null;
}

/** 이미 있는 진료 — 여기에 붙인다(고아 데이터를 새로 만들지 않는다). */
export interface AttachTarget {
  encounterId: string;
  patientId: string;
  doctorId: string;
  visitAt: Date;
  /** 이 진료에 이미 청구가 있으면 손대지 않는다. */
  hasBilling: boolean;
  /** 이 진료에 이미 내원 전 활력이 있으면 손대지 않는다. */
  hasPreVisitVitals: boolean;
}

export interface PlanContext {
  now: Date;
  /** 되짚을 기간(일). 기본 42(6주). */
  windowDays: number;
  patients: SeedPatient[];
  doctors: SeedDoctor[];
  labTechIds: string[];
  pharmacistIds: string[];
  radiologistIds: string[];
  /** 내원 전 활력 측정자. 비어 있으면 활력을 만들지 않는다(측정자를 지어내지 않는다). */
  nurseIds: string[];
  /**
   * 활력 이상 판정 임계치 — 러너가 config `clinical.vitals.thresholds` 를
   * 정본 `mergeVitalsThresholds` 로 병합해 주입한다. 시드가 숫자를 적지 않는다.
   */
  vitalsThresholds: VitalsThresholds;
  /** ProcedureCode.code → 마스터 행. 없는 코드는 그 항목을 만들지 않는다. */
  procedureByCode: Record<string, SeedProcedureCode>;
  /** 진찰료 수가(재진). 없으면 진찰료 라인을 만들지 않는다. */
  consultationCode: SeedProcedureCode | null;
  /** MedicationRecipe.key → 마스터 행. 못 찾은 성분은 빠진다. */
  medicationByRecipe: Record<string, SeedMedicationCode>;
  /** DiagnosisCode.code → 마스터 행. */
  diagnosisByCode: Record<string, SeedDiagnosisCode>;
  attachTargets: AttachTarget[];
}

// ════════════════════════════════════════════════════════════════════════
// 7. 출력 형태
// ════════════════════════════════════════════════════════════════════════

export type OrderStatusLite = 'ORDERED' | 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED';

export interface PlannedOrder {
  prescriptionId: string;
  orderId: string;
  department: 'LAB' | 'IMAGING' | 'PHARMACY';
  prescriptionType: 'LAB' | 'IMAGING' | 'MEDICATION';
  status: OrderStatusLite;
  createdAt: Date;
  receivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  receivedById: string | null;
  startedById: string | null;
  completedById: string | null;
  procedureCodeId: string | null;
  medicationCodeId: string | null;
  diagnosisCodeId: string | null;
  /** 처방 표시용 — 투약만. */
  dosage: string | null;
  frequency: string | null;
  duration: number | null;
  quantity: number | null;
  route: string | null;
  instructions: string | null;
  notes: string;
}

export interface PlannedLabItemSpec {
  itemId: string;
  testCode: string;
  intent: LabIntent;
  jitter: number;
}

export interface PlannedLabResult {
  labResultId: string;
  orderId: string;
  patientId: string;
  technicianId: string;
  status: 'COLLECTED' | 'COMPLETED' | 'VERIFIED';
  collectedAt: Date;
  completedAt: Date | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  items: PlannedLabItemSpec[];
}

export interface PlannedImagingResult {
  imagingResultId: string;
  orderId: string;
  patientId: string;
  radiologistId: string | null;
  modality: string;
  bodyPart: string;
  status: 'ORDERED' | 'ACQUIRED' | 'REPORTED';
  acquiredAt: Date | null;
  reportedAt: Date | null;
  finding: string | null;
  impression: string | null;
}

export interface PlannedDispensingItem {
  dispensingItemId: string;
  medicationCodeId: string;
  prescribedQty: number;
  dispensedQty: number;
}

export interface PlannedDispensing {
  dispensingId: string;
  orderId: string;
  patientId: string;
  pharmacistId: string;
  status: 'PENDING' | 'DISPENSED' | 'VERIFIED' | 'ISSUED';
  dispensedAt: Date | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  issuedBy: string | null;
  issuedAt: Date | null;
  issuedTo: string | null;
  items: PlannedDispensingItem[];
}

export interface PlannedBillingItem {
  billingItemId: string;
  codeType: string;
  codeId: string;
  codeName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  copayRate: number;
  fullCopay: boolean;
  insuranceCategory: 'COVERED' | 'NON_COVERED';
  sourcePrescriptionId: string | null;
}

export interface PlannedBilling {
  billingId: string;
  encounterId: string;
  patientId: string;
  totalAmount: number;
  insuranceCovered: number;
  patientCopay: number;
  status: 'PENDING' | 'PAID';
  paidAt: Date | null;
  paidAmount: number | null;
  paymentMethod: string | null;
  receiptNo: string | null;
  copayCategory: string;
  createdAt: Date;
  items: PlannedBillingItem[];
}

export interface PlannedVisit {
  key: string;
  /** 새로 만드는 진료인가(false = 기존 진료에 붙임 — 진료 행은 건드리지 않는다). */
  isNewEncounter: boolean;
  encounterId: string;
  patientId: string;
  doctorId: string;
  visitAt: Date;
  encounter: {
    status: 'DRAFT' | 'SIGNED';
    signedAt: Date | null;
    signedBy: string | null;
    chiefComplaint: string;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    visitType: 'OUTPATIENT';
  } | null;
  diagnosis: { encounterDiagnosisId: string; diagnosisCodeId: string } | null;
  orders: PlannedOrder[];
  labResults: PlannedLabResult[];
  imagingResults: PlannedImagingResult[];
  dispensings: PlannedDispensing[];
  billing: PlannedBilling | null;
  /** 내원 전 활력 — 접수~진료 사이 측정. 측정자가 없거나 기존 값이 있으면 null. */
  preVisitVitals: PlannedPreVisitVitals | null;
  /** 환자 여정 이벤트 — 위 흐름에 **대응하는** 것만. 없는 사실을 만들지 않는다. */
  journeyEvents: PlannedJourneyEvent[];
}

export interface ActivityPlan {
  now: Date;
  windowStart: Date;
  visits: PlannedVisit[];
}

// ════════════════════════════════════════════════════════════════════════
// 8. 생성기
// ════════════════════════════════════════════════════════════════════════

/** 그날 몇 명 볼 것인가 — 일요일 휴진, 토요일 오전만. */
export function visitsForWeekday(weekday: number): number {
  if (weekday === 0) return 0; // 일
  if (weekday === 6) return 2; // 토(오전)
  return 5;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * 진료 시작 시각 — 09:00 부터 35분 간격.
 * 🔴 서버 로컬 시각으로 판다 — 이 저장소의 날짜 정본(`src/common/day-range`)과 같은 규약이다
 *    (`new Date('2026-08-13')` 은 TZ 와 무관하게 UTC 자정이라 KST 에서 9시간 어긋난다).
 */
function visitStart(day: Date, seq: number): Date {
  const nine = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0, 0);
  return new Date(nine.getTime() + seq * 35 * MIN);
}

/** 상병 마스터 제약(주상병 가능·성별·연령)에 맞는 템플릿을 고른다. 없으면 null. */
export function pickTemplate(ctx: PlanContext, patient: SeedPatient, offset: number): VisitTemplate {
  const n = VISIT_TEMPLATES.length;
  for (let i = 0; i < n; i++) {
    const t = VISIT_TEMPLATES[(offset + i) % n];
    const dx = ctx.diagnosisByCode[t.diagnosisCode];
    if (!dx) return t; // 상병 마스터가 없으면 상병 없이 진료만 — 템플릿 자체는 유효
    if (dx.notPrimary) continue;
    if (dx.sexRestriction === 'M' && patient.gender !== 'MALE') continue;
    if (dx.sexRestriction === 'F' && patient.gender !== 'FEMALE') continue;
    if (dx.ageMin != null && patient.ageYears != null && patient.ageYears < dx.ageMin) continue;
    if (dx.ageMax != null && patient.ageYears != null && patient.ageYears > dx.ageMax) continue;
    return t;
  }
  return VISIT_TEMPLATES[offset % n];
}

interface BuildVisitArgs {
  ctx: PlanContext;
  key: string;
  isNewEncounter: boolean;
  encounterId: string;
  patient: SeedPatient;
  doctorId: string;
  visitAt: Date;
  template: VisitTemplate;
  withBilling: boolean;
  /** 여정 `doctorName`·`department` — 정본 페이로드가 담는 값. 모르면 null(지어내지 않는다). */
  doctorName: string | null;
  department: string | null;
  /** 기존 활력이 있는 진료면 false — 남의 측정을 덮지 않는다. */
  withPreVisitVitals: boolean;
}

function buildVisit(a: BuildVisitArgs): PlannedVisit | null {
  const { ctx, key, isNewEncounter, encounterId, patient, doctorId, visitAt, template } = a;
  const now = ctx.now;
  const at = (m: number) => addMin(visitAt, m);
  const reached = (m: number) => at(m).getTime() <= now.getTime();

  if (visitAt.getTime() > now.getTime()) return null; // 🔴 미래 진료는 만들지 않는다

  const dx = ctx.diagnosisByCode[template.diagnosisCode] ?? null;
  const orders: PlannedOrder[] = [];
  const labResults: PlannedLabResult[] = [];
  const imagingResults: PlannedImagingResult[] = [];
  const dispensings: PlannedDispensing[] = [];
  const notes = '데모 시드(recent-clinical-activity) — 실환자 기록 아님';

  // ── 검사 오더 ──────────────────────────────────────────────────────
  if (reached(TIMELINE.labOrdered) && ctx.labTechIds.length > 0) {
    for (const panelKey of template.labPanels) {
      const panel = LAB_PANEL_BY_KEY[panelKey];
      const proc = panel ? ctx.procedureByCode[panel.procedureCode] : undefined;
      if (!panel || !proc) continue; // 수가 마스터가 없으면 만들지 않는다

      const natural = `${key}|lab|${panel.key}`;
      const prescriptionId = seedUuid(NS.PRESCRIPTION, natural);
      const orderId = seedUuid(NS.ORDER, natural);
      const completedMin = TIMELINE.labStarted + panel.tatMinutes;
      const verifiedMin = completedMin + TIMELINE.labVerifiedAfterComplete;

      const techIdx = Math.floor(rnd(natural, 1) * ctx.labTechIds.length) % ctx.labTechIds.length;
      const technicianId = ctx.labTechIds[techIdx];
      const verifier = ctx.labTechIds.length > 1 ? ctx.labTechIds[(techIdx + 1) % ctx.labTechIds.length] : null;

      const status: OrderStatusLite = reached(completedMin)
        ? 'COMPLETED'
        : reached(TIMELINE.labStarted)
          ? 'IN_PROGRESS'
          : reached(TIMELINE.labReceived)
            ? 'RECEIVED'
            : 'ORDERED';

      orders.push({
        prescriptionId,
        orderId,
        department: 'LAB',
        prescriptionType: 'LAB',
        status,
        createdAt: at(TIMELINE.labOrdered),
        receivedAt: reached(TIMELINE.labReceived) ? at(TIMELINE.labReceived) : null,
        startedAt: reached(TIMELINE.labStarted) ? at(TIMELINE.labStarted) : null,
        completedAt: reached(completedMin) ? at(completedMin) : null,
        receivedById: reached(TIMELINE.labReceived) ? technicianId : null,
        startedById: reached(TIMELINE.labStarted) ? technicianId : null,
        completedById: reached(completedMin) ? technicianId : null,
        procedureCodeId: proc.id,
        medicationCodeId: null,
        diagnosisCodeId: dx?.id ?? null,
        dosage: null, frequency: null, duration: null, quantity: null, route: null, instructions: null,
        notes,
      });

      if (reached(TIMELINE.labCollected)) {
        const resultDone = reached(completedMin);
        // 🔴 독립 검증은 **다른 사람**이 있을 때만 — 검사자 1명이면 VERIFIED 를 흉내내지 않는다.
        const verified = resultDone && verifier != null && reached(verifiedMin);
        labResults.push({
          labResultId: seedUuid(NS.LAB_RESULT, natural),
          orderId,
          patientId: patient.id,
          technicianId,
          status: verified ? 'VERIFIED' : resultDone ? 'COMPLETED' : 'COLLECTED',
          collectedAt: at(TIMELINE.labCollected),
          completedAt: resultDone ? at(completedMin) : null,
          verifiedBy: verified ? verifier : null,
          verifiedAt: verified ? at(verifiedMin) : null,
          // 결과 항목은 **결과가 나온 뒤에만** 존재한다
          items: resultDone
            ? panel.testCodes.map((testCode, i) => ({
                itemId: seedUuid(NS.LAB_ITEM, `${natural}|${testCode}`),
                testCode,
                intent: pickLabIntent(rnd(natural, 10 + i), template.biasHighTestCodes.includes(testCode)),
                jitter: rnd(natural, 40 + i),
              }))
            : [],
        });
      }
    }
  }

  // ── 영상 오더 ──────────────────────────────────────────────────────
  const study = template.imagingKey ? IMAGING_BY_KEY[template.imagingKey] : undefined;
  const imagingProc = study ? ctx.procedureByCode[study.procedureCode] : undefined;
  if (study && imagingProc && reached(TIMELINE.imagingOrdered) && rnd(key, 2) < (template.imagingRatio ?? 0)) {
    const natural = `${key}|img|${study.key}`;
    const prescriptionId = seedUuid(NS.PRESCRIPTION, natural);
    const orderId = seedUuid(NS.ORDER, natural);
    const radiologistId = ctx.radiologistIds.length
      ? ctx.radiologistIds[Math.floor(rnd(natural, 3) * ctx.radiologistIds.length) % ctx.radiologistIds.length]
      : null;

    const status: OrderStatusLite = reached(TIMELINE.imagingCompleted)
      ? 'COMPLETED'
      : reached(TIMELINE.imagingStarted)
        ? 'IN_PROGRESS'
        : reached(TIMELINE.imagingReceived)
          ? 'RECEIVED'
          : 'ORDERED';

    orders.push({
      prescriptionId,
      orderId,
      department: 'IMAGING',
      prescriptionType: 'IMAGING',
      status,
      createdAt: at(TIMELINE.imagingOrdered),
      receivedAt: reached(TIMELINE.imagingReceived) ? at(TIMELINE.imagingReceived) : null,
      startedAt: reached(TIMELINE.imagingStarted) ? at(TIMELINE.imagingStarted) : null,
      completedAt: reached(TIMELINE.imagingCompleted) ? at(TIMELINE.imagingCompleted) : null,
      receivedById: null, startedById: null, completedById: null,
      procedureCodeId: imagingProc.id,
      medicationCodeId: null,
      diagnosisCodeId: dx?.id ?? null,
      dosage: null, frequency: null, duration: null, quantity: null, route: null, instructions: null,
      notes,
    });

    if (reached(TIMELINE.imagingAcquired)) {
      // 🔴 판독이 나기 전에는 소견·판독의를 채우지 않는다("실행하지 않고 성공 상태만 기록" 금지)
      const reported = reached(TIMELINE.imagingReported) && radiologistId != null;
      const incidental = rnd(natural, 4) < 0.25;
      const text = incidental ? study.incidental : study.normal;
      imagingResults.push({
        imagingResultId: seedUuid(NS.IMAGING, natural),
        orderId,
        patientId: patient.id,
        radiologistId: reported ? radiologistId : null,
        modality: study.modality,
        bodyPart: study.bodyPart,
        status: reported ? 'REPORTED' : 'ACQUIRED',
        acquiredAt: at(TIMELINE.imagingAcquired),
        reportedAt: reported ? at(TIMELINE.imagingReported) : null,
        finding: reported ? text.finding : null,
        impression: reported ? text.impression : null,
      });
    }
  }

  // ── 투약 오더 · 조제 ────────────────────────────────────────────────
  if (reached(TIMELINE.pharmacyOrdered) && ctx.pharmacistIds.length > 0) {
    for (const recipeKey of template.medicationKeys) {
      const recipe = RECIPE_BY_KEY[recipeKey];
      const med = recipe ? ctx.medicationByRecipe[recipe.key] : undefined;
      if (!recipe || !med) continue; // 마스터에 없는 약은 처방하지 않는다

      const natural = `${key}|med|${recipe.key}`;
      const prescriptionId = seedUuid(NS.PRESCRIPTION, natural);
      const orderId = seedUuid(NS.ORDER, natural);
      const quantity = recipe.timesPerDay * recipe.durationDays; // 🔴 수량은 용법에서 나온다
      const pIdx = Math.floor(rnd(natural, 5) * ctx.pharmacistIds.length) % ctx.pharmacistIds.length;
      const pharmacistId = ctx.pharmacistIds[pIdx];
      const secondPharmacist = ctx.pharmacistIds.length > 1 ? ctx.pharmacistIds[(pIdx + 1) % ctx.pharmacistIds.length] : null;

      const status: OrderStatusLite = reached(TIMELINE.pharmacyIssued)
        ? 'COMPLETED'
        : reached(TIMELINE.pharmacyDispensed)
          ? 'IN_PROGRESS'
          : reached(TIMELINE.pharmacyReceived)
            ? 'RECEIVED'
            : 'ORDERED';

      orders.push({
        prescriptionId,
        orderId,
        department: 'PHARMACY',
        prescriptionType: 'MEDICATION',
        status,
        createdAt: at(TIMELINE.pharmacyOrdered),
        receivedAt: reached(TIMELINE.pharmacyReceived) ? at(TIMELINE.pharmacyReceived) : null,
        startedAt: reached(TIMELINE.pharmacyDispensed) ? at(TIMELINE.pharmacyDispensed) : null,
        completedAt: reached(TIMELINE.pharmacyIssued) ? at(TIMELINE.pharmacyIssued) : null,
        receivedById: reached(TIMELINE.pharmacyReceived) ? pharmacistId : null,
        startedById: reached(TIMELINE.pharmacyDispensed) ? pharmacistId : null,
        completedById: reached(TIMELINE.pharmacyIssued) ? pharmacistId : null,
        procedureCodeId: null,
        medicationCodeId: med.id,
        diagnosisCodeId: dx?.id ?? null,
        dosage: recipe.dosage,
        frequency: recipe.frequency,
        duration: recipe.durationDays,
        quantity,
        route: recipe.route,
        instructions: recipe.instructions,
        notes,
      });

      if (reached(TIMELINE.pharmacyReceived)) {
        const dispensed = reached(TIMELINE.pharmacyDispensed);
        // 🔴 2인 확인은 **다른 약사**가 있을 때만. 없으면 검수 단계를 건너뛴다(흉내내지 않는다).
        const verified = dispensed && secondPharmacist != null && reached(TIMELINE.pharmacyVerified);
        const issued = dispensed && reached(TIMELINE.pharmacyIssued);
        dispensings.push({
          dispensingId: seedUuid(NS.DISPENSING, natural),
          orderId,
          patientId: patient.id,
          pharmacistId,
          status: issued ? 'ISSUED' : verified ? 'VERIFIED' : dispensed ? 'DISPENSED' : 'PENDING',
          dispensedAt: dispensed ? at(TIMELINE.pharmacyDispensed) : null,
          verifiedBy: verified ? secondPharmacist : null,
          verifiedAt: verified ? at(TIMELINE.pharmacyVerified) : null,
          issuedBy: issued ? pharmacistId : null,
          issuedAt: issued ? at(TIMELINE.pharmacyIssued) : null,
          issuedTo: issued ? '환자 본인' : null,
          items: dispensed
            ? [{
                dispensingItemId: seedUuid(NS.DISPENSING_ITEM, natural),
                medicationCodeId: med.id,
                prescribedQty: quantity,
                dispensedQty: quantity,
              }]
            : [],
        });
      }
    }
  }

  // ── 청구·수납 ──────────────────────────────────────────────────────
  let billing: PlannedBilling | null = null;
  if (a.withBilling && reached(TIMELINE.billingCreated)) {
    const items: PlannedBillingItem[] = [];
    const push = (
      suffix: string,
      codeType: string,
      codeId: string,
      codeName: string,
      quantity: number,
      unitPrice: number,
      copayRate: number,
      covered: boolean,
      sourcePrescriptionId: string | null,
    ) => {
      items.push({
        billingItemId: seedUuid(NS.BILLING_ITEM, `${key}|${suffix}`),
        codeType, codeId, codeName, quantity, unitPrice,
        amount: unitPrice * quantity,
        copayRate,
        fullCopay: copayRate >= 1,
        insuranceCategory: covered ? 'COVERED' : 'NON_COVERED',
        sourcePrescriptionId,
      });
    };

    // 진찰료
    if (ctx.consultationCode) {
      const c = ctx.consultationCode;
      const nonCovered = c.insuranceCovered === false;
      push('fee', 'CONSULTATION', c.id, c.nameKo, 1, c.unitPrice,
        nonCovered ? 1 : (c.copayRate ?? patient.copayRate), !nonCovered, null);
    }
    // 오더 라인 — billing.service.buildPrescriptionLineItem 과 같은 규칙
    for (const o of orders) {
      if (o.medicationCodeId) {
        const med = Object.values(ctx.medicationByRecipe).find((m) => m.id === o.medicationCodeId);
        if (!med) continue;
        const isCovered = !!med.insuranceCode;
        const rate = isCovered ? patient.copayRate : 1;
        push(`rx|${o.orderId}`, 'MEDICATION', med.id, med.nameKo, o.quantity ?? 1, med.unitPrice, rate, isCovered, o.prescriptionId);
      } else if (o.procedureCodeId) {
        const proc = Object.values(ctx.procedureByCode).find((p) => p.id === o.procedureCodeId);
        if (!proc) continue;
        const nonCovered = proc.insuranceCovered === false;
        const rate = nonCovered ? 1 : (proc.copayRate ?? patient.copayRate);
        push(`pc|${o.orderId}`, o.department === 'LAB' ? 'LAB' : 'IMAGING', proc.id, proc.nameKo, 1, proc.unitPrice, rate, !nonCovered, o.prescriptionId);
      }
    }

    if (items.length > 0) {
      const totalAmount = items.reduce((s, i) => s + i.amount, 0);
      // 🔴 본인부담 = 라인별 율 합산. 정본 billing.service.computePatientCopay 와 같은 식.
      //    금액 반올림은 shared `roundBy`(money=원 단위) — 손으로 Math.round 하지 않는다.
      const lineSum = items.reduce((s, i) => s + (roundBy(i.amount * i.copayRate, 'money') ?? 0), 0);
      let patientCopay = roundBy(lineSum, 'money') ?? 0;
      // 의료급여 외래 정액 본인부담(1·2종) — 율 산정이 정액보다 낮으면 정액
      if (patient.flatCopay > 0 && totalAmount > 0) {
        patientCopay = Math.max(patientCopay, Math.min(patient.flatCopay, totalAmount));
      }
      const paid = reached(TIMELINE.billingPaid) && rnd(key, 6) < 0.9; // 10% 는 미수(현실)
      billing = {
        billingId: seedUuid(NS.BILLING, key),
        encounterId,
        patientId: patient.id,
        totalAmount,
        insuranceCovered: totalAmount - patientCopay,
        patientCopay,
        status: paid ? 'PAID' : 'PENDING',
        paidAt: paid ? at(TIMELINE.billingPaid) : null,
        paidAmount: paid ? patientCopay : null,
        paymentMethod: paid ? (rnd(key, 7) < 0.75 ? 'CARD' : 'CASH') : null,
        receiptNo: paid ? `R${seedUuid(NS.BILLING, key).slice(-10).toUpperCase()}` : null,
        copayCategory: patient.copayCategory,
        createdAt: at(TIMELINE.billingCreated),
        items,
      };
    }
  }

  // ── 내원 전 활력징후 ───────────────────────────────────────────────
  let preVisitVitals: PlannedPreVisitVitals | null = null;
  if (a.withPreVisitVitals && ctx.nurseIds.length > 0) {
    const natural = `${key}|vitals`;
    const nurseId = ctx.nurseIds[Math.floor(rnd(natural, 20) * ctx.nurseIds.length) % ctx.nurseIds.length];
    preVisitVitals = buildPreVisitVitalsRow(natural, {
      encounterId,
      patientId: patient.id,
      nurseId,
      measuredAt: at(TIMELINE.preVisitVitals), // 접수와 진료 사이
      ageYears: patient.ageYears,
      gender: patient.gender,
      thresholds: ctx.vitalsThresholds,
    });
  }

  // ── 환자 여정 이벤트 ───────────────────────────────────────────────
  // 🔴 우리가 **실제로 만든 사실**에만 대응시킨다. 기존 진료(부착)의 진료 시작·서명은
  //    우리가 만든 것이 아니고 이미 이벤트가 있을 수 있으므로 발행하지 않는다(중복 금지).
  const journeyEvents: PlannedJourneyEvent[] = [];
  const je = (suffix: string, e: Omit<PlannedJourneyEvent, 'eventId' | 'patientId'>) => {
    journeyEvents.push({ eventId: seedUuid(NS.JOURNEY, `${key}|jn|${suffix}`), patientId: patient.id, ...e });
  };

  if (isNewEncounter) {
    // 정본: waiting-queue.service.startConsultation (외래 흐름 변형).
    // metadata.queueNumber 는 대기열 행이 없으므로 담지 않는다 — 없는 번호를 지어내지 않는다.
    je('ENCOUNTER_START', {
      eventType: 'ENCOUNTER_START',
      eventAt: visitAt,
      title: a.department ? `${a.department} 진료 시작` : '진료 시작',
      description: null,
      department: a.department,
      doctorId,
      doctorName: a.doctorName,
      refType: 'ENCOUNTER',
      refId: encounterId,
      navUrl: `/patients/${patient.id}/encounter/new?encounterId=${encounterId}`,
      severity: null,
      metadata: null,
    });
    if (reached(TIMELINE.encounterSigned)) {
      // 정본: encounter.service.sign() — refType/부서를 담지 않는다(정본 그대로).
      je('ENCOUNTER_SIGNED', {
        eventType: 'ENCOUNTER_SIGNED',
        eventAt: at(TIMELINE.encounterSigned),
        title: '진료 완료 (서명)',
        description: '차트 서명 완료',
        department: null, doctorId: null, doctorName: null,
        refType: null, refId: null, navUrl: null, severity: null, metadata: null,
      });
    }
  }

  // 정본: journey.listener.onOrderCreated — 오더 진입 경로가 8개라 단일 구독점으로 모은 그 페이로드.
  for (const o of orders) {
    const isMed = o.prescriptionType === 'MEDICATION';
    je(`ORDER|${o.orderId}`, {
      eventType: isMed ? 'PRESCRIPTION_ADDED' : 'ORDER_CREATED',
      eventAt: o.createdAt,
      title: isMed ? '처방 발행' : '검사·처치 오더 발행',
      description: o.notes.slice(0, 200),
      department: JOURNEY_DEPT_BY_RX_TYPE[o.prescriptionType] ?? null,
      doctorId: null, doctorName: null,
      refType: 'Order', refId: o.orderId, navUrl: null,
      severity: null, // priority=ROUTINE → 정본도 severity 를 담지 않는다
      metadata: null,
    });
  }

  // 정본: lab.service — 설명·severity 는 **실제 flag** 에서 나오므로 러너가 채운다.
  for (const r of labResults) {
    if (!r.completedAt) continue; // 결과가 없는데 "결과 완료"라고 말하지 않는다
    je(`LAB|${r.labResultId}`, {
      eventType: 'LAB_RESULT',
      eventAt: r.completedAt, // 🔴 의료진이 알게 된 시점 = 결과가 존재하게 된 순간
      title: '검사 결과 완료',
      description: null,
      department: '진단검사의학과',
      doctorId: null, doctorName: null,
      refType: 'LabResult', refId: r.labResultId, navUrl: null,
      severity: null,
      metadata: null,
      fillFromLabResultId: r.labResultId,
    });
  }

  // 정본: imaging.service — 판독이 난 뒤에만.
  for (const im of imagingResults) {
    if (im.status !== 'REPORTED' || !im.reportedAt || !im.impression) continue;
    je(`IMG|${im.imagingResultId}`, {
      eventType: 'IMAGING_RESULT',
      eventAt: im.reportedAt,
      title: '영상 판독 완료',
      description: im.impression.slice(0, 200),
      department: '영상의학과',
      doctorId: null, doctorName: null,
      refType: 'ImagingResult', refId: im.imagingResultId, navUrl: null,
      severity: null, metadata: null,
    });
  }

  // 정본: journey.listener.onDispensed.
  for (const d of dispensings) {
    if (!d.dispensedAt) continue;
    je(`DISP|${d.dispensingId}`, {
      eventType: 'DISPENSED',
      eventAt: d.dispensedAt,
      title: '조제 완료',
      description: null,
      department: '약제부',
      doctorId: null, doctorName: null,
      refType: 'Dispensing', refId: d.dispensingId, navUrl: null,
      severity: null, metadata: null,
    });
  }

  // 정본: billing.service 수납 완료 — refType 없이 title/description 만 담는다(정본 그대로).
  if (billing && billing.paidAt) {
    const hasPrescriptions = orders.length > 0;
    je('BILLING_PAID', {
      eventType: 'BILLING_PAID',
      eventAt: billing.paidAt,
      title: '수납 완료',
      description: hasPrescriptions ? '약국에서 처방약을 수령하세요' : '진료가 완료되었습니다',
      department: null, doctorId: null, doctorName: null,
      refType: null, refId: null, navUrl: null, severity: null, metadata: null,
    });
  }

  return {
    key,
    isNewEncounter,
    encounterId,
    patientId: patient.id,
    doctorId,
    visitAt,
    encounter: isNewEncounter
      ? {
          status: reached(TIMELINE.encounterSigned) ? 'SIGNED' : 'DRAFT',
          signedAt: reached(TIMELINE.encounterSigned) ? at(TIMELINE.encounterSigned) : null,
          signedBy: reached(TIMELINE.encounterSigned) ? doctorId : null,
          chiefComplaint: template.chiefComplaint,
          subjective: template.subjective,
          objective: template.objective,
          assessment: template.assessment,
          plan: template.plan,
          visitType: 'OUTPATIENT',
        }
      : null,
    diagnosis:
      isNewEncounter && dx
        ? { encounterDiagnosisId: seedUuid(NS.ENC_DIAGNOSIS, key), diagnosisCodeId: dx.id }
        : null,
    orders,
    labResults,
    imagingResults,
    dispensings,
    billing,
    preVisitVitals,
    journeyEvents,
  };
}

/**
 * 최근 구간 활동 계획을 만든다.
 *
 * ① **부착**: 최근 진료(orders 가 없는 것)에 검사·투약·청구를 붙인다 — 고아 데이터를 새로 만들지 않는다.
 *    진료 행 자체는 **수정하지 않는다**(기존 데이터 훼손 금지).
 * ② **보충**: 창(기본 6주) 안의 각 날짜에 새 외래 진료를 만들어 오늘까지 연속되게 한다.
 *    🔴 날짜는 **`now` 에서 역산**한다 — 재실행하면 통째로 앞으로 굴러간다(이 시드의 존재 이유).
 */
export function buildActivityPlan(ctx: PlanContext): ActivityPlan {
  if (!ctx.patients.length) throw new Error('[recent-activity] 환자가 없다 — 메인 시드를 먼저 돌려라');
  if (!ctx.doctors.length) throw new Error('[recent-activity] 의사 계정이 없다 — 메인 시드를 먼저 돌려라');

  const visits: PlannedVisit[] = [];
  const today = startOfDay(ctx.now);
  const windowStart = new Date(today.getTime() - (ctx.windowDays - 1) * 24 * 60 * MIN);

  // ① 기존 진료에 부착
  for (const t of ctx.attachTargets) {
    const patient = ctx.patients.find((p) => p.id === t.patientId);
    if (!patient) continue;
    const key = `attach|${t.encounterId}`;
    const template = pickTemplate(ctx, patient, Math.floor(rnd(key, 0) * VISIT_TEMPLATES.length));
    const doc = ctx.doctors.find((d) => d.id === t.doctorId) ?? null;
    const v = buildVisit({
      ctx, key,
      isNewEncounter: false,
      encounterId: t.encounterId,
      patient,
      doctorId: t.doctorId,
      visitAt: t.visitAt,
      template,
      withBilling: !t.hasBilling, // 이미 청구가 있으면 손대지 않는다
      doctorName: doc?.name ?? null,
      department: doc?.department ?? null,
      withPreVisitVitals: !t.hasPreVisitVitals, // 이미 활력이 있으면 손대지 않는다
    });
    if (v && (v.orders.length > 0 || v.billing || v.preVisitVitals)) visits.push(v);
  }

  // ② 창 안의 새 진료
  for (let d = ctx.windowDays - 1; d >= 0; d--) {
    const day = new Date(today.getTime() - d * 24 * 60 * MIN);
    const count = visitsForWeekday(day.getDay());
    for (let seq = 0; seq < count; seq++) {
      const at = visitStart(day, seq);
      if (at.getTime() > ctx.now.getTime()) continue;
      const key = `d${d}s${seq}`;
      const patient = ctx.patients[(d * 13 + seq * 7) % ctx.patients.length];
      const doctor = ctx.doctors[(d * 3 + seq) % ctx.doctors.length];
      const template = pickTemplate(ctx, patient, (d * 5 + seq) % VISIT_TEMPLATES.length);
      const v = buildVisit({
        ctx, key,
        isNewEncounter: true,
        encounterId: seedUuid(NS.ENCOUNTER, key),
        patient,
        doctorId: doctor.id,
        visitAt: at,
        template,
        withBilling: true,
        doctorName: doctor.name,
        department: doctor.department,
        withPreVisitVitals: true,
      });
      if (v) visits.push(v);
    }
  }

  return { now: ctx.now, windowStart, visits };
}

// ════════════════════════════════════════════════════════════════════════
// 9. 불변식 — 러너가 **쓰기 전에** 부르고, 가드 테스트가 같은 함수를 부른다
// ════════════════════════════════════════════════════════════════════════

const le = (a: Date | null, b: Date | null) => a == null || b == null || a.getTime() <= b.getTime();

/**
 * 계획의 불변식 위반 목록. 빈 배열이면 통과.
 * 🔴 여기서 걸러야 할 것들은 전부 이 저장소에서 **실제로 났던** 사고다:
 *    미래 시각 · `completed_at < started_at` · `signedAt < createdAt` · 상태와 시각의 불일치 ·
 *    결과가 오더보다 앞섬 · 값과 flag 불일치.
 */
export function collectPlanViolations(plan: ActivityPlan): string[] {
  const v: string[] = [];
  const now = plan.now.getTime();
  const ids = new Map<string, string>();
  const seeId = (id: string, what: string) => {
    if (!id.startsWith(SEED_UUID_HEAD)) v.push(`${what}: 시드 UUID 네임스페이스 밖 (${id})`);
    const prev = ids.get(id);
    if (prev) v.push(`id 충돌: ${id} 를 ${prev} 와 ${what} 가 함께 쓴다`);
    else ids.set(id, what);
  };
  const notFuture = (d: Date | null, what: string) => {
    if (d && d.getTime() > now) v.push(`${what}: 미래 시각 ${d.toISOString()}`);
  };

  for (const visit of plan.visits) {
    const label = `visit ${visit.key}`;
    notFuture(visit.visitAt, `${label}.visitAt`);
    if (visit.isNewEncounter) seeId(visit.encounterId, `${label}.encounter`);

    if (visit.encounter) {
      const e = visit.encounter;
      notFuture(e.signedAt, `${label}.signedAt`);
      if (!le(visit.visitAt, e.signedAt)) v.push(`${label}: signedAt 이 진료 시작보다 앞선다`);
      if ((e.status === 'SIGNED') !== (e.signedAt != null)) v.push(`${label}: 진료 상태(${e.status})와 signedAt 이 어긋난다`);
      if ((e.signedAt != null) !== (e.signedBy != null)) v.push(`${label}: signedAt 과 signedBy 가 짝이 안 맞는다`);
    }
    if (visit.diagnosis) seeId(visit.diagnosis.encounterDiagnosisId, `${label}.diagnosis`);

    const orderById = new Map(visit.orders.map((o) => [o.orderId, o]));
    for (const o of visit.orders) {
      const ol = `${label}.order ${o.department}`;
      seeId(o.orderId, `${ol}`);
      seeId(o.prescriptionId, `${ol}.prescription`);
      notFuture(o.createdAt, `${ol}.createdAt`);
      notFuture(o.receivedAt, `${ol}.receivedAt`);
      notFuture(o.startedAt, `${ol}.startedAt`);
      notFuture(o.completedAt, `${ol}.completedAt`);
      if (!le(visit.visitAt, o.createdAt)) v.push(`${ol}: 오더가 진료보다 앞선다`);
      if (!le(o.createdAt, o.receivedAt)) v.push(`${ol}: receivedAt < createdAt`);
      if (!le(o.receivedAt, o.startedAt)) v.push(`${ol}: startedAt < receivedAt`);
      if (!le(o.startedAt, o.completedAt)) v.push(`${ol}: completedAt < startedAt`);
      if ((o.status === 'COMPLETED') !== (o.completedAt != null)) v.push(`${ol}: 상태(${o.status})와 completedAt 이 어긋난다`);
      if (o.status === 'IN_PROGRESS' && o.startedAt == null) v.push(`${ol}: IN_PROGRESS 인데 startedAt 이 없다`);
      if (o.status !== 'ORDERED' && o.receivedAt == null) v.push(`${ol}: ${o.status} 인데 receivedAt 이 없다`);
      if (o.prescriptionType === 'MEDICATION') {
        if (!o.medicationCodeId) v.push(`${ol}: 투약 처방에 약 코드가 없다`);
        if (o.quantity == null || o.duration == null) v.push(`${ol}: 투약 처방에 수량/일수가 없다`);
      } else if (!o.procedureCodeId) {
        v.push(`${ol}: 행위 처방에 수가 코드가 없다`);
      }
    }

    for (const r of visit.labResults) {
      const rl = `${label}.lab ${r.labResultId.slice(-6)}`;
      seeId(r.labResultId, rl);
      const o = orderById.get(r.orderId);
      if (!o) { v.push(`${rl}: 오더 참조가 계획 안에 없다 (${r.orderId})`); continue; }
      if (o.department !== 'LAB') v.push(`${rl}: LAB 이 아닌 오더(${o.department})에 검사결과가 달렸다`);
      notFuture(r.collectedAt, `${rl}.collectedAt`);
      notFuture(r.completedAt, `${rl}.completedAt`);
      notFuture(r.verifiedAt, `${rl}.verifiedAt`);
      if (!le(o.receivedAt, r.collectedAt)) v.push(`${rl}: 채혈이 오더 접수보다 앞선다`);
      if (!le(r.collectedAt, r.completedAt)) v.push(`${rl}: completedAt < collectedAt`);
      if (!le(r.completedAt, r.verifiedAt)) v.push(`${rl}: verifiedAt < completedAt`);
      if ((r.status === 'VERIFIED') !== (r.verifiedAt != null)) v.push(`${rl}: 상태(${r.status})와 verifiedAt 이 어긋난다`);
      if (r.verifiedBy != null && r.verifiedBy === r.technicianId) v.push(`${rl}: 검증자가 입력자와 같다(독립검증 아님)`);
      if ((r.status === 'COLLECTED') !== (r.completedAt == null)) v.push(`${rl}: 상태(${r.status})와 completedAt 이 어긋난다`);
      if (r.completedAt == null && r.items.length > 0) v.push(`${rl}: 결과가 나오기 전에 항목이 있다`);
      for (const it of r.items) seeId(it.itemId, `${rl}.item ${it.testCode}`);
    }

    for (const im of visit.imagingResults) {
      const il = `${label}.imaging`;
      seeId(im.imagingResultId, il);
      const o = orderById.get(im.orderId);
      if (!o) { v.push(`${il}: 오더 참조가 계획 안에 없다`); continue; }
      if (o.department !== 'IMAGING') v.push(`${il}: IMAGING 이 아닌 오더에 영상결과가 달렸다`);
      notFuture(im.acquiredAt, `${il}.acquiredAt`);
      notFuture(im.reportedAt, `${il}.reportedAt`);
      if (!le(o.startedAt, im.acquiredAt)) v.push(`${il}: 촬영이 오더 시행보다 앞선다`);
      if (!le(im.acquiredAt, im.reportedAt)) v.push(`${il}: reportedAt < acquiredAt`);
      if ((im.status === 'REPORTED') !== (im.reportedAt != null)) v.push(`${il}: 상태(${im.status})와 reportedAt 이 어긋난다`);
      if ((im.finding != null) !== (im.status === 'REPORTED')) v.push(`${il}: 판독 전인데 소견이 있다(또는 그 반대)`);
      if (im.status === 'REPORTED' && im.radiologistId == null) v.push(`${il}: 판독 완료인데 판독의가 없다`);
    }

    for (const d of visit.dispensings) {
      const dl = `${label}.dispensing`;
      seeId(d.dispensingId, dl);
      const o = orderById.get(d.orderId);
      if (!o) { v.push(`${dl}: 오더 참조가 계획 안에 없다`); continue; }
      if (o.department !== 'PHARMACY') v.push(`${dl}: PHARMACY 가 아닌 오더에 조제가 달렸다`);
      notFuture(d.dispensedAt, `${dl}.dispensedAt`);
      notFuture(d.issuedAt, `${dl}.issuedAt`);
      if (!le(o.receivedAt, d.dispensedAt)) v.push(`${dl}: 조제가 오더 접수보다 앞선다`);
      if (!le(d.dispensedAt, d.verifiedAt)) v.push(`${dl}: verifiedAt < dispensedAt`);
      if (!le(d.verifiedAt ?? d.dispensedAt, d.issuedAt)) v.push(`${dl}: issuedAt 이 앞선다`);
      if ((d.status === 'ISSUED') !== (d.issuedAt != null)) v.push(`${dl}: 상태(${d.status})와 issuedAt 이 어긋난다`);
      if (d.verifiedBy != null && d.verifiedBy === d.pharmacistId) v.push(`${dl}: 2인 확인자가 조제 약사와 같다`);
      if (d.status === 'PENDING' && d.items.length > 0) v.push(`${dl}: 조제 전인데 항목이 있다`);
      for (const it of d.items) {
        seeId(it.dispensingItemId, `${dl}.item`);
        if (it.dispensedQty > it.prescribedQty) v.push(`${dl}: 조제량이 처방량을 넘는다`);
        if (o.quantity != null && it.prescribedQty !== o.quantity) v.push(`${dl}: 처방량과 조제 항목 수량이 다르다`);
      }
    }

    // ── 내원 전 활력 ────────────────────────────────────────────────
    const pv = visit.preVisitVitals;
    if (pv) {
      const vl = `${label}.vitals`;
      seeId(pv.vitalsId, vl);
      notFuture(pv.measuredAt, `${vl}.measuredAt`);
      if (pv.measuredAt.getTime() > visit.visitAt.getTime()) v.push(`${vl}: 내원 전 활력이 진료 시작보다 뒤다`);
      if (pv.measuredAt.getTime() < addMin(visit.visitAt, TIMELINE.checkIn).getTime()) v.push(`${vl}: 접수보다 앞서 측정됐다`);
      if (pv.encounterId !== visit.encounterId) v.push(`${vl}: 다른 진료를 가리킨다`);
      if (pv.patientId !== visit.patientId) v.push(`${vl}: 다른 환자를 가리킨다`);
      // 🔴 판정은 정본이 한 값이어야 한다 — 라벨이 있으면 이상, 없으면 정상.
      if (pv.isAbnormal !== (pv.abnormalLabels.length > 0)) v.push(`${vl}: isAbnormal 이 판정 라벨과 어긋난다`);
      // 🔴 임상적으로 불가능한 값(14세 260cm 계열) 차단
      if (pv.height != null && (pv.height < 140 || pv.height > 200)) v.push(`${vl}: 신장 ${pv.height}cm 는 성인 표에서 나올 수 없다`);
      if (pv.weight != null && (pv.weight < 35 || pv.weight > 150)) v.push(`${vl}: 체중 ${pv.weight}kg 범위 밖`);
      if ((pv.height == null) !== (pv.weight == null)) v.push(`${vl}: 신장·체중 중 하나만 있다(BMI 근거 불완전)`);
      if ((pv.bmi != null) !== (pv.height != null && pv.weight != null)) v.push(`${vl}: BMI 가 신장·체중 없이 있다(또는 그 반대)`);
      if (pv.bmi != null && (pv.bmi < 12 || pv.bmi > 45)) v.push(`${vl}: BMI ${pv.bmi} 범위 밖`);
      if (pv.spo2 != null && (pv.spo2 < 70 || pv.spo2 > 100)) v.push(`${vl}: SpO2 ${pv.spo2}% 범위 밖`);
      if (pv.systolicBp != null && pv.diastolicBp != null && pv.diastolicBp >= pv.systolicBp) v.push(`${vl}: 이완기가 수축기 이상이다`);
      if (pv.painScore < 0 || pv.painScore > 10) v.push(`${vl}: 통증점수 범위 밖`);
      if (!pv.nurseId) v.push(`${vl}: 측정자가 없다`);
    }

    // ── 환자 여정 이벤트 ────────────────────────────────────────────
    const orderIds = new Set(visit.orders.map((o) => o.orderId));
    const labIds = new Set(visit.labResults.map((r) => r.labResultId));
    const imgIds = new Set(visit.imagingResults.map((i) => i.imagingResultId));
    const dispIds = new Set(visit.dispensings.map((d) => d.dispensingId));
    for (const ev of visit.journeyEvents) {
      const el = `${label}.journey ${ev.eventType}`;
      seeId(ev.eventId, el);
      notFuture(ev.eventAt, `${el}.eventAt`);
      if (ev.patientId !== visit.patientId) v.push(`${el}: 다른 환자를 가리킨다`);
      // 🔴 여정 시각은 그 사실이 일어난(=의료진이 알게 된) 시점이지 '지금'이 아니다
      if (ev.eventAt.getTime() < addMin(visit.visitAt, TIMELINE.checkIn).getTime()) v.push(`${el}: 접수보다 앞선 여정 시각`);
      // 🔴 부착 진료에는 진료 시작·서명 이벤트를 발행하지 않는다(중복 발행 금지)
      if (!visit.isNewEncounter && (ev.eventType === 'ENCOUNTER_START' || ev.eventType === 'ENCOUNTER_SIGNED')) {
        v.push(`${el}: 우리가 만들지 않은 진료에 진료 이벤트를 발행한다`);
      }
      // refId 는 우리가 만든 행을 가리켜야 한다(허구 참조 금지 — refId 는 @db.Uuid 다)
      if (ev.refType === 'Order' && !orderIds.has(ev.refId ?? '')) v.push(`${el}: 없는 오더를 가리킨다`);
      if (ev.refType === 'LabResult' && !labIds.has(ev.refId ?? '')) v.push(`${el}: 없는 검사결과를 가리킨다`);
      if (ev.refType === 'ImagingResult' && !imgIds.has(ev.refId ?? '')) v.push(`${el}: 없는 영상결과를 가리킨다`);
      if (ev.refType === 'Dispensing' && !dispIds.has(ev.refId ?? '')) v.push(`${el}: 없는 조제를 가리킨다`);
      if (ev.refType === 'ENCOUNTER' && ev.refId !== visit.encounterId) v.push(`${el}: 없는 진료를 가리킨다`);
      if ((ev.refType != null) !== (ev.refId != null)) v.push(`${el}: refType 과 refId 가 짝이 안 맞는다`);
      if (ev.eventType === 'LAB_RESULT' && !ev.fillFromLabResultId) v.push(`${el}: 검사 결과 설명을 채울 근거가 없다`);
    }
    // 사실 ↔ 이벤트 대응(발행 누락 = 이 저장소에서 이미 적발된 갭)
    const evTypes = visit.journeyEvents.map((e) => e.eventType);
    if (visit.isNewEncounter && !evTypes.includes('ENCOUNTER_START')) v.push(`${label}: 새 진료인데 ENCOUNTER_START 가 없다`);
    if (visit.encounter?.signedAt && !evTypes.includes('ENCOUNTER_SIGNED')) v.push(`${label}: 서명했는데 ENCOUNTER_SIGNED 가 없다`);
    if (visit.orders.length !== evTypes.filter((t) => t === 'ORDER_CREATED' || t === 'PRESCRIPTION_ADDED').length) {
      v.push(`${label}: 오더 수와 오더 여정 이벤트 수가 다르다`);
    }
    if (visit.labResults.filter((r) => r.completedAt).length !== evTypes.filter((t) => t === 'LAB_RESULT').length) {
      v.push(`${label}: 완료된 검사 수와 LAB_RESULT 이벤트 수가 다르다`);
    }
    if (visit.imagingResults.filter((i) => i.status === 'REPORTED').length !== evTypes.filter((t) => t === 'IMAGING_RESULT').length) {
      v.push(`${label}: 판독된 영상 수와 IMAGING_RESULT 이벤트 수가 다르다`);
    }
    if (visit.dispensings.filter((d) => d.dispensedAt).length !== evTypes.filter((t) => t === 'DISPENSED').length) {
      v.push(`${label}: 조제 수와 DISPENSED 이벤트 수가 다르다`);
    }
    if ((visit.billing?.paidAt != null) !== evTypes.includes('BILLING_PAID')) {
      v.push(`${label}: 수납 사실과 BILLING_PAID 이벤트가 어긋난다`);
    }

    const b = visit.billing;
    if (b) {
      const bl = `${label}.billing`;
      seeId(b.billingId, bl);
      notFuture(b.createdAt, `${bl}.createdAt`);
      notFuture(b.paidAt, `${bl}.paidAt`);
      if (!le(visit.visitAt, b.createdAt)) v.push(`${bl}: 청구가 진료보다 앞선다`);
      if (!le(b.createdAt, b.paidAt)) v.push(`${bl}: paidAt < createdAt`);
      if ((b.status === 'PAID') !== (b.paidAt != null)) v.push(`${bl}: 상태(${b.status})와 paidAt 이 어긋난다`);
      if ((b.paidAt != null) !== (b.paidAmount != null)) v.push(`${bl}: paidAt 과 paidAmount 가 짝이 안 맞는다`);
      const sum = b.items.reduce((s, i) => s + i.amount, 0);
      if (sum !== b.totalAmount) v.push(`${bl}: 항목 합(${sum}) ≠ 총액(${b.totalAmount})`);
      if (b.insuranceCovered + b.patientCopay !== b.totalAmount) v.push(`${bl}: 보험부담+본인부담 ≠ 총액`);
      if (b.patientCopay < 0 || b.insuranceCovered < 0) v.push(`${bl}: 음수 금액`);
      if (b.paidAmount != null && b.paidAmount !== b.patientCopay) v.push(`${bl}: 수납액 ≠ 본인부담금`);
      for (const i of b.items) {
        seeId(i.billingItemId, `${bl}.item ${i.codeName}`);
        if (i.amount !== i.unitPrice * i.quantity) v.push(`${bl}: 라인 금액이 단가×수량과 다르다 (${i.codeName})`);
        if (i.copayRate < 0 || i.copayRate > 1) v.push(`${bl}: 본인부담률 범위 밖 (${i.copayRate})`);
        if (i.fullCopay !== (i.copayRate >= 1)) v.push(`${bl}: fullCopay 표시가 율과 어긋난다`);
        if (i.sourcePrescriptionId && !visit.orders.some((o) => o.prescriptionId === i.sourcePrescriptionId)) {
          v.push(`${bl}: 청구 라인이 계획에 없는 처방을 가리킨다`);
        }
      }
    }
  }
  return v;
}

/** 계획 요약(로그·리포트용). */
export function summarizePlan(plan: ActivityPlan) {
  let orders = 0, labs = 0, labItems = 0, imaging = 0, dispensings = 0, billings = 0, paid = 0, newEnc = 0, attached = 0;
  let journeyEvents = 0, preVisitVitals = 0, abnormalVitals = 0;
  for (const v of plan.visits) {
    if (v.isNewEncounter) newEnc++; else attached++;
    orders += v.orders.length;
    labs += v.labResults.length;
    labItems += v.labResults.reduce((s, r) => s + r.items.length, 0);
    imaging += v.imagingResults.length;
    dispensings += v.dispensings.length;
    if (v.billing) { billings++; if (v.billing.status === 'PAID') paid++; }
    journeyEvents += v.journeyEvents.length;
    if (v.preVisitVitals) { preVisitVitals++; if (v.preVisitVitals.isAbnormal) abnormalVitals++; }
  }
  return { visits: plan.visits.length, newEncounters: newEnc, attachedEncounters: attached, orders, labResults: labs, labItems, imagingResults: imaging, dispensings, billings, paidBillings: paid, journeyEvents, preVisitVitals, abnormalVitals };
}
