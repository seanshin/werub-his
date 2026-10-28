/**
 * 임상 데이터 볼륨 확장 시드 — 공통 정본 (순수 TS · Prisma/DB 없음)
 *
 * 실행: 이 파일은 단독 실행하지 않는다. 도메인 시드가 import 한다.
 *   cd apps/api && npx ts-node --transpile-only prisma/seeds/clinical-volume-<도메인>.ts
 *
 * ── 왜 순수 TS 인가 ─────────────────────────────────────────────────────
 * 생성 로직을 Prisma 에서 떼어내면 **시드를 실행하지 않고** 결과를 검증할 수 있다
 * (`test/architecture/clinical-volume-seed-guard.spec.ts`). 운영 DB 를 건드리지 않고도
 * "시각이 뒤집혔다 / 미래다 / 생리학적으로 불가능하다 / 정본 판정과 다르다"를 잡는다.
 * 같은 구조를 `prisma/seeds/qi-measurement.ts` 가 이미 쓰고 있다 — 관례를 따른다.
 *
 * ── UUID 네임스페이스 ───────────────────────────────────────────────────
 * 🔴 기존 시드는 전부 `00000000-0000-4000-a000-…` 를 쓴다(메인 seed.ts `makeUuid`).
 *    이 축은 **variant nibble 을 `b`** 로 바꿔 `00000000-0000-4000-b000-…` 를 쓴다.
 *    동시에 도는 다른 시드(recent-* 계열)와 **한 행도 겹치지 않기** 위한 분리다.
 *    (`b` 는 RFC4122 variant 10xx 에 속하는 유효 값이다 — 8·9·a·b)
 *
 * ── 멱등 규약 ───────────────────────────────────────────────────────────
 * 🔴 `update: {}` 를 쓰지 않는다. 기존 시드 207 upsert 중 159 가 `update: {}` 라
 *    재실행해도 날짜가 갱신되지 않았고, 그래서 축마다 시점이 고착됐다.
 *    여기서는 `upsertArgs(row)` 가 create 페이로드에서 `id` 만 뺀 것을 그대로 update 로
 *    넘긴다 — 재실행하면 시각이 오늘 기준으로 다시 굴러간다.
 */

// ────────────────────────────── UUID ──────────────────────────────

/** 이 축 전용 UUID 접두 — 다른 시드(`…-a000-…`)와 절대 겹치지 않는다 */
export const CV_UUID_PREFIX = '00000000-0000-4000-b000-';

/**
 * 테이블별 4-hex 태그. 🔴 정본은 이 표 하나다 — 도메인 파일이 리터럴을 적지 않는다.
 * 가드가 값 중복을 검사한다(태그가 겹치면 두 테이블이 같은 id 를 쓴다).
 */
export const CV_TAGS = {
  // 영상
  imagingPrescription: 'c001',
  imagingOrder: 'c002',
  imagingResult: 'c003',
  // 수술
  surgery: 'c100',
  opNote: 'c101',
  anesthesiaRecord: 'c102',
  surgicalChecklist: 'c103',
  preAnesthesiaEval: 'c104',
  // 중환자·응급
  codeBlue: 'c201',
  icuAdmission: 'c205',
  rrtActivation: 'c202',
  emergencyDisposition: 'c203',
  emergencyReassessment: 'c204',
  // 입원(간호기록·투약·입원 이력)
  admission: 'c601',
  inpatientEncounter: 'c602',
  inpatientPrescription: 'c603',
  pharmacyOrder: 'c604',
  medAdmin: 'c605',
  admissionNursingNote: 'c606',
  // 간호
  nursingNote: 'c401',
  flowSheetEntry: 'c402',
  clinicalHandoff: 'c403',
  round: 'c404',
  // 안전·감염
  safetyIncident: 'c501',
  rcaReport: 'c505',
  haiCase: 'c503',
  mdroRegistry: 'c504',
} as const;

export type CvTag = (typeof CV_TAGS)[keyof typeof CV_TAGS];

/**
 * 결정적 UUID — `00000000-0000-4000-b000-<tag4><index8>`.
 * index 는 0 ≤ i < 2^32. 넘치면 조용히 겹치지 않고 **터진다**(겹친 id 는 재실행 때
 * 다른 행을 덮어쓴다 — 조용한 데이터 소실이 된다).
 */
export function cvUuid(tag: CvTag, index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
    throw new Error(`cvUuid: index 범위 밖 (${index}) — id 공간이 겹친다`);
  }
  if (!/^[0-9a-f]{4}$/.test(tag)) throw new Error(`cvUuid: 태그 형식 오류 (${tag})`);
  return `${CV_UUID_PREFIX}${tag}${index.toString(16).padStart(8, '0')}`;
}

/**
 * 자연키 문자열에서 뽑은 결정적 UUID — 목록 순서가 바뀌어도 같은 대상은 같은 id 를 갖는다.
 * (기존 방문·수술처럼 **내가 만들지 않은 행에 자식을 붙일 때** 쓴다. 순번 index 를 쓰면
 *  원본 목록이 하나만 늘어도 전부 밀려 재실행 때 중복 행이 생긴다.)
 * 🔴 해시 충돌은 조용한 덮어쓰기다 — 가드가 "생성된 id 전량 유일"을 검사한다.
 */
export function cvUuidKey(tag: CvTag, key: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return cvUuid(tag, h >>> 0);
}

// ────────────────────────── 결정적 난수 ──────────────────────────

/** mulberry32 — 문자열 시드로 재실행 동일 결과. Math.random 을 쓰지 않는다. */
export function cvRandom(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pickOne = <T>(arr: readonly T[], r: number): T => arr[Math.floor(r * arr.length) % arr.length];
export const intBetween = (r: number, lo: number, hi: number): number => Math.round(lo + r * (hi - lo));
export const round1 = (x: number): number => Math.round(x * 10) / 10;

// ────────────────────────── 시각 헬퍼 ──────────────────────────
//
// 🔴 미래 시각 금지. 모든 생성기는 `now` 를 인자로 받는다(테스트가 시각을 고정할 수 있어야
//    "오늘은 통과하고 내일은 실패하는" 가드가 되지 않는다).

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const plusMinutes = (d: Date, m: number): Date => new Date(d.getTime() + m * MINUTE);
export const plusHours = (d: Date, h: number): Date => new Date(d.getTime() + h * HOUR);

/** 행 배열의 모든 Date 필드가 now 이하인가 — 위반 메시지 목록(빈 배열 = 통과) */
export function checkNoFuture(rows: Record<string, unknown>[], now: Date, label = ''): string[] {
  const bad: string[] = [];
  rows.forEach((row, i) => {
    for (const [k, v] of Object.entries(row)) {
      if (v instanceof Date && v.getTime() > now.getTime()) {
        bad.push(`${label}[${i}].${k} = ${v.toISOString()} > now(${now.toISOString()})`);
      }
    }
  });
  return bad;
}

/** `[이른 필드, 늦은 필드]` 순서 규칙. 둘 중 하나라도 null 이면 검사하지 않는다(미기록은 사실이다). */
export type TimeOrderRule = readonly [string, string];

export function checkTimeOrder(
  rows: Record<string, unknown>[],
  rules: readonly TimeOrderRule[],
  label = '',
): string[] {
  const bad: string[] = [];
  rows.forEach((row, i) => {
    for (const [a, b] of rules) {
      const va = row[a];
      const vb = row[b];
      if (!(va instanceof Date) || !(vb instanceof Date)) continue;
      if (va.getTime() > vb.getTime()) {
        bad.push(`${label}[${i}]: ${a}(${va.toISOString()}) > ${b}(${vb.toISOString()})`);
      }
    }
  });
  return bad;
}

// ─────────────────── 생리학적 가능 범위 (정본) ───────────────────
//
// 🔴 "14세 신장 260cm · HbA1c 2%" 가 실제로 심어져 있었다. 값 생성기는 이 표를 넘길 수 없다.
//    이 표는 **정상 범위가 아니라 인간에게 물리적으로 가능한 범위**다 — 이상치는 이 안에서 만든다.

export const CV_PLAUSIBLE_RANGE: Record<string, readonly [number, number]> = {
  // 활력 (FlowSheetEntry · RRT 활력 스냅샷)
  heartRate: [20, 220],
  systolicBp: [50, 260],
  diastolicBp: [20, 160],
  respiratoryRate: [4, 60],
  temperature: [32.0, 42.5],
  spo2: [50, 100],
  gcsScore: [3, 15],
  painScore: [0, 10],
  // 섭취·배설 (FlowSheetEntry)
  intakeOral: [0, 4000],
  intakeIv: [0, 6000],
  intakeOther: [0, 4000],
  outputUrine: [0, 4000],
  outputDrain: [0, 3000],
  outputOther: [0, 3000],
  // 수술·마취
  ebl: [0, 8000],
  estimatedBloodLoss: [0, 8000],
  urineOutput: [0, 4000],
  asaClass: [1, 6],
  cardiacRiskRcri: [0, 6],
  // 소생·감염
  defibrillationCount: [0, 20],
  deviceDays: [0, 400],
};

/**
 * 🔴 이 표 자체도 점검 대상이다 — **어느 행에도 없는 키**를 적어두면 검사가 있는 것처럼 보이지만
 *    한 번도 실행되지 않는다(이 저장소에서 가드가 헛돈 사례 10건의 전형). 가드가 커버리지를 센다.
 */
export function plausibleKeysCovered(rows: Record<string, unknown>[]): Set<string> {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) if (CV_PLAUSIBLE_RANGE[k] && row[k] != null) seen.add(k);
  }
  return seen;
}

/** 범위 위반 목록 — 키가 표에 없으면 검사하지 않는다(모르는 것을 판정하지 않는다) */
export function checkPlausible(rows: Record<string, unknown>[], label = ''): string[] {
  const bad: string[] = [];
  rows.forEach((row, i) => {
    for (const [k, v] of Object.entries(row)) {
      const range = CV_PLAUSIBLE_RANGE[k];
      if (!range) continue;
      if (v == null) continue;
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) continue;
      if (n < range[0] || n > range[1]) {
        bad.push(`${label}[${i}].${k} = ${n} — 생리학적 가능 범위 ${range[0]}~${range[1]} 밖`);
      }
    }
  });
  return bad;
}

// ────────────────────────── 실행 컨텍스트 ──────────────────────────

/** 시드가 DB 에서 읽어와 생성기에 넘기는 참조 데이터(생성기는 DB 를 모른다) */
export interface CvPatientRef {
  id: string;
  /** Prisma 컬럼명 그대로 — `birthDate` 로 적었다가 tsc 에 잡혔다(스키마는 `dateOfBirth`) */
  dateOfBirth: Date | null;
  gender: string | null;
}

export interface CvContext {
  now: Date;
  patients: CvPatientRef[];
  doctors: string[];
  nurses: string[];
}

// ────────────────────────── 멱등 upsert ──────────────────────────

/**
 * 🔴 `update: {}` 금지의 구현 — create 페이로드에서 `id` 만 뺀 것을 그대로 update 로 쓴다.
 *    기존 시드 207 upsert 중 159 가 `update: {}` 라 **재실행해도 날짜가 갱신되지 않았고**,
 *    그래서 축마다 시점이 고착됐다. 이 헬퍼를 통과한 행은 재실행하면 오늘 기준으로 다시 굴러간다.
 *
 * 호출부는 `await prisma.order.upsert(upsertArgs(row))` 처럼 **Prisma 델리게이트를 직접** 부른다.
 * 델리게이트를 `any`/`never` 로 받는 범용 헬퍼를 만들면 필드명 오타를 tsc 가 못 잡는다 —
 * 이 시드의 유일한 기계적 검증 수단이 타입 대조라서, 그 검증을 스스로 끄지 않는다.
 */
export function upsertArgs<T extends { id: string }>(row: T): {
  where: { id: string };
  create: T;
  update: Omit<T, 'id'>;
} {
  const { id, ...rest } = row;
  return { where: { id }, create: row, update: rest as Omit<T, 'id'> };
}

/**
 * 자연키(유니크 컬럼) upsert 용 — create 페이로드에서 `id` 만 뺀 update 페이로드.
 * 1:1 테이블(`visitId @unique` 등)은 id 가 아니라 자연키로 맞춰야 재실행이 안전하다.
 */
export function withoutId<T extends { id: string }>(row: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = row;
  return rest as Omit<T, 'id'>;
}

/** 도메인 시드 공통 요약 출력 */
export function cvReport(domain: string, counts: Record<string, number>): void {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const detail = Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(' · ');
  console.log(`[clinical-volume:${domain}] ${total}행 — ${detail}`);
}
