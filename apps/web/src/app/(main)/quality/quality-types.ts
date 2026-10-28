/**
 * 질 향상(QI) 화면 공용 타입·라벨.
 *
 * 🔴 대시보드(`page.tsx`)와 측정 입력 패널(`MeasurementPanel.tsx`)이 같은 개념을 각자 정의하면
 *    라벨이 조용히 드리프트한다(같은 사실에 정본이 둘 — P12). 여기 한 곳에서만 정의한다.
 *
 * 판정·방향·단위·배율의 **정본은 서버**(`apps/api/src/modules/quality/indicator-policy.ts`)다.
 * 이 파일은 서버가 내려준 값을 **표시하는 규칙**만 갖는다 — 판정을 다시 만들지 않는다.
 */

export type Direction = 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER' | null;
export type DirectionSource = 'COLUMN' | 'REGISTRY' | 'HINT' | null;
export type UndeterminedReason = 'DIRECTION_NOT_REGISTERED' | 'NO_TARGET' | 'NO_VALUE' | null;
export type ValueScaleSource = 'COLUMN' | 'FORMULA' | 'ASSUMED';

export interface QiIndicator {
  id: string;
  name: string;
  category: string;
  formula?: string | null;
  /** 서버 해석 결과(컬럼 → 산식) — null 이면 모르는 것이다(추정 금지) */
  unit: string | null;
  direction: Direction;
  /** 방향의 출처 — COLUMN=등재됨 · REGISTRY/HINT=코드 기본값 · null=미등재 */
  directionSource: DirectionSource;
  /** 🔴 등재한 방향이 코드 등재표와 반대다 — 조용히 넘기지 않는다 */
  directionConflict?: boolean;
  /** 컬럼에 실제로 등재된 원본(편집 폼 프리필용 — 폴백이 섞이지 않은 값) */
  registeredDirection: Direction;
  registeredUnit: string | null;
  registeredValueScale: number | null;
  valueScale: number;
  valueScaleKnown: boolean;
  valueScaleSource?: ValueScaleSource;
  targetValue: number | string;
  latestValue: number | null;
  latestPeriod: string | null;
  /** true=달성 · false=미달 · null=미측정이거나 방향 미상(판정 불가) */
  meetTarget: boolean | null;
  undeterminedReason?: UndeterminedReason;
  achievementPercent: number | null;
  /**
   * 원내 구조화 원장과의 대조 근거(서버가 붙인다). 매핑이 없거나 세지 못했으면 `null` —
   * 🔴 그 지표에는 **아무 말도 하지 않는다**(추정한 원장을 붙이면 거짓 경보가 된다).
   */
  /** period: 센 기간(YYYY-MM) · null = 전 기간(측정 없음) */
  ledger?: { source: string; count: number; period?: string | null } | null;
  /** 2026-10-08 QI 흐름 — 정본 행의 출처(MANUAL·AUTO·CPOE·SEED) · 같은 달 다른 칸 값(병기) · 적용 중인 정본 규칙 */
  latestSource?: string | null;
  alternate?: { value: number; source: string | null; numerator: number; denominator: number } | null;
  precedence?: string;
  supplierKey?: string | null;
  /** 실제로 쓰이는 공급원(등재 키 우선 · 없으면 이름 정규형) — 서버가 붙인다 */
  effectiveSupplierKey?: string | null;
}

/** 측정 이력 1행 — `GET /api/v1/quality/measurements/:indicatorId` 응답. */
export interface QiMeasurementRow {
  id: string;
  period: string;
  numerator: number;
  denominator: number;
  value: number | null;
  unit: string | null;
  direction: Direction;
  valueScale: number;
  valueScaleKnown: boolean;
  valueScaleSource?: ValueScaleSource;
  target?: number | null;
  /** 🔴 **읽는 시점 재판정**(정본). 저장값을 그대로 믿지 않는다 */
  meetTarget: boolean | null;
  /** 저장 당시 기록된 판정 — 재판정과 갈릴 수 있어 남긴다 */
  storedMeetTarget: boolean | null;
  /** 🔴 저장값 ≠ 재판정 — 화면이 이 사실을 감추지 않는다 */
  storedDiverges?: boolean;
  /**
   * 🔴 이 행의 값이 **분자/분모 × 배율에서 나온 값인가**(서버 판정).
   * `false` = 아니다(값이 따로 기록된 행) · `null` = 판정 불가(값 없음·분모 0).
   * 화면이 분자·분모와 값을 나란히 보여주면서 이 사실을 감추면 같은 표에 정본이 둘이 된다(P12).
   */
  valueDerived?: boolean | null;
  /** 분자/분모 × 현재 배율의 산출값 — 정정하면 값이 여기로 옮겨간다 */
  ratioValue?: number | null;
  undetermined: boolean;
  undeterminedReason: UndeterminedReason;
  measuredAt: string | null;
}

/** 측정값 입력 응답 — 서버가 확정한 값·배율·판정. */
export interface QiMeasurementResult {
  id: string;
  period: string;
  numerator: number;
  denominator: number;
  value: number | string | null;
  unit: string | null;
  direction: Direction;
  directionSource: DirectionSource;
  valueScale: number;
  valueScaleKnown: boolean;
  valueScaleSource?: ValueScaleSource;
  target?: number | null;
  meetTarget: boolean | null;
  undetermined: boolean;
  undeterminedReason: UndeterminedReason;
  directionRegistered?: boolean;
}

export const DIRECTION_LABEL: Record<Exclude<Direction, null>, string> = {
  LOWER_IS_BETTER: '낮을수록 좋음',
  HIGHER_IS_BETTER: '높을수록 좋음',
};

/** 출처를 감추지 않는다 — '등재됨'과 '코드가 대신 정해준 것'은 다른 사실이다. */
export const SOURCE_LABEL: Record<Exclude<DirectionSource, null>, string> = {
  COLUMN: '등재',
  REGISTRY: '코드 기본',
  HINT: '이름 추정',
};

/** 🔴 배율의 출처도 사실이다 — '가정'을 '등재'처럼 보이게 하지 않는다. */
export const SCALE_SOURCE_LABEL: Record<ValueScaleSource, string> = {
  COLUMN: '등재',
  FORMULA: '산출공식',
  ASSUMED: '가정',
};

export const UNDETERMINED_LABEL: Record<Exclude<UndeterminedReason, null>, string> = {
  DIRECTION_NOT_REGISTERED: '지표 방향(높을수록/낮을수록 좋음) 미등재 — 달성 판정 불가',
  NO_TARGET: '목표값 미등재 — 달성 판정 불가',
  NO_VALUE: '측정값 없음 — 달성 판정 불가',
};

/** 단위 미상은 `%` 가 아니다 — 붙이지 않는다(종전 결함: 25지표 전부에 `%`). */
export const unitSuffix = (unit: string | null | undefined) => (unit ? ` ${unit}` : '');

/**
 * 측정값 표시 — 서버가 소수 2자리로 확정해 저장한다(`Decimal(5,2)`).
 * @returns 문자열 | null(값 없음 — 호출부가 '0' 이 아니라 '없음'으로 그린다)
 */
export function fmtMeasurementValue(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(Number(n));
}

/** 입력 문자열 → 음이 아닌 유한수 | null(비었거나 숫자가 아님). 빈 값을 0 으로 접지 않는다. */
export function parseCount(raw: string): number | null {
  const t = (raw ?? '').trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * 저장 전 미리보기 값 — **서버와 같은 식**(분자/분모 × 배율).
 *
 * 🔴 분모가 0 이면 값을 만들지 않는다(`null`). 0 으로 나눈 결과를 `0`·`∞` 로 적으면
 *    '표본이 없다'는 사실이 '값이 0 이다'로 뒤바뀐다.
 * 🔴 이 값은 **예상치**다 — 저장된 값은 서버 응답으로만 확정한다(화면이 두 번째 정본이 되지 않게).
 */
export function previewMeasurementValue(
  numerator: number | null,
  denominator: number | null,
  scale: number,
): number | null {
  if (numerator === null || denominator === null) return null;
  if (!(denominator > 0)) return null;
  if (!Number.isFinite(scale)) return null;
  return (numerator / denominator) * scale;
}

/** 판정 라벨 — true/false/null 셋을 둘로 접지 않는다(P10). */
export function meetTargetLabel(v: boolean | null): string {
  return v === true ? '✓ 달성' : v === false ? '✗ 미달' : '판정 불가';
}
