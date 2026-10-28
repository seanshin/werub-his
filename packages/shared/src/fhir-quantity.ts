/**
 * FHIR Quantity 생성 정본 (numeric-format-policy.plan.md P4 — 저장=표시=청구=FHIR 일치).
 *
 * 🔴 핵심 규약: `system: 'http://unitsofmeasure.org'` 은 **UCUM 코드일 때만** 붙인다.
 *    화면 표시 단위(`/μL`·`mmHg`·`10^3/uL`·`℃`)를 UCUM 코드 자리에 실어보내면 외부 소비자
 *    (LIS·SMART 앱·CDA)는 파싱에 실패하거나 다른 단위로 읽는다 — 표준을 지켰다는 **허위 표기**다.
 *    UCUM 을 모르면 `unit`(사람이 읽는 표시)만 내보낸다. FHIR Quantity 는 unit 단독을 허용한다.
 *
 * 참조: UCUM 2.1(unitsofmeasure.org) · FHIR R4 Quantity · NUMERIC_POLICIES(도메인 정책 정본)
 */

import { NUMERIC_POLICIES, roundBy } from './numeric-policy';

export interface FhirQuantity {
  value: number;
  unit?: string;
  system?: string;
  code?: string;
}

export const UCUM_SYSTEM = 'http://unitsofmeasure.org';

/**
 * 표시 단위 → UCUM 코드 대응표(검증된 것만).
 * 🔴 추정 금지 — 여기 없으면 `undefined`(system/code 미부착). 새 단위는 UCUM 명세 확인 후 등재한다.
 * 키는 normalizeUnit() 을 거친 형태(마이크로 기호·제곱 기호·대소문자 원형 유지).
 */
export const UCUM_BY_DISPLAY: Record<string, string> = {
  // 농도·질량
  'mg/dL': 'mg/dL', 'g/dL': 'g/dL', 'mg/L': 'mg/L', 'g/L': 'g/L', 'ng/mL': 'ng/mL', 'ng/dL': 'ng/dL',
  'pg/mL': 'pg/mL', 'ug/dL': 'ug/dL', 'ug/L': 'ug/L', 'ug/mL': 'ug/mL',
  'mmol/L': 'mmol/L', 'umol/L': 'umol/L', 'nmol/L': 'nmol/L', 'pmol/L': 'pmol/L',
  'mEq/L': 'meq/L', 'meq/L': 'meq/L', // UCUM 은 대소문자 구분 — equivalent=eq
  // 효소·국제단위 (UCUM 국제단위=[IU])
  'U/L': 'U/L', 'U/mL': 'U/mL', 'IU/L': '[IU]/L', 'IU/mL': '[IU]/mL', 'IU': '[IU]',
  'mIU/L': 'm[IU]/L', 'mIU/mL': 'm[IU]/mL', 'uIU/mL': 'u[IU]/mL',
  // 세포수 (UCUM 지수 표기=10*n)
  '/uL': '/uL', '/mL': '/mL', '/L': '/L',
  '10^3/uL': '10*3/uL', '10^6/uL': '10*6/uL', '10^9/L': '10*9/L', '10^12/L': '10*12/L',
  'K/uL': '10*3/uL', 'M/uL': '10*6/uL',
  '/HPF': '/[HPF]', '/LPF': '/[LPF]',
  // 활력·계측
  'mmHg': 'mm[Hg]', 'cmH2O': 'cm[H2O]',
  'C': 'Cel', 'degC': 'Cel',
  'kg': 'kg', 'g': 'g', 'mg': 'mg', 'ug': 'ug', 'pg': 'pg',
  'cm': 'cm', 'mm': 'mm', 'm': 'm',
  'kg/m2': 'kg/m2', 'm2': 'm2',
  'L': 'L', 'mL': 'mL', 'dL': 'dL', 'fL': 'fL',
  'bpm': '/min', '/min': '/min', 'mm/hr': 'mm/h',
  // 시간
  's': 's', 'sec': 's', 'ms': 'ms', 'min': 'min', 'h': 'h', 'hr': 'h', 'd': 'd',
  // 비율
  '%': '%',
};

/**
 * 표시 단위 정규화 — 마이크로 기호(μ/µ)→u, 제곱 기호(²/³)→2/3, 섭씨 기호 제거, 공백 제거.
 * UCUM 코드 자체를 만들지 않는다(대응표 조회용 키만 만든다).
 */
function normalizeUnit(unit: string): string {
  return unit
    .trim()
    .replace(/[μµ]/g, 'u') // Greek small mu · micro sign → u
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/℃/g, 'C') // 단일 문자 섭씨(U+2103)
    .replace(/°C/g, 'C')
    .replace(/\s+/g, '');
}

/**
 * 표시 단위 → UCUM 코드. **모르면 undefined**(호출부는 system/code 를 붙이지 않는다).
 */
export function toUcumCode(unit?: string | null): string | undefined {
  if (!unit) return undefined;
  const key = normalizeUnit(unit);
  if (!key) return undefined;
  return UCUM_BY_DISPLAY[key];
}

/**
 * 수치 강제 변환 — Quantity.value 로 쓸 수 있는 유한 수만 통과.
 * 🔴 Prisma `Decimal` 을 그대로 받는 호출부가 많다(normalMin/normalMax·체온·체중). 객체를 걸러버리면
 *    참조범위·값이 **조용히 사라진다** → String() 경유로 수용한다. 반대로 빈 문자열은 `Number('')===0`
 *    이라 0 으로 둔갑하므로 명시적으로 막는다. 불리언·비수치 문자열은 통과시키지 않는다.
 */
function toFiniteNumber(value: unknown): number | null {
  if (value == null || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** 도메인 정책의 UCUM 코드(레지스트리 정본). 정책·ucumUnit 없으면 undefined. */
export function ucumOf(policyKey: string): string | undefined {
  return NUMERIC_POLICIES[policyKey]?.ucumUnit;
}

/**
 * FHIR Quantity 조립 — 값·표시단위·UCUM 을 정책 정본에서 가져온다.
 *
 * - `policyKey` 지정 시: 값은 `roundBy` 정책 반올림(`round:false` 로 해제), 단위·UCUM 은 레지스트리.
 * - `policyKey` 미지정(외부 보고값 등): 값은 **그대로**, `unit` 문자열로 UCUM 을 역조회한다.
 *   🔴 검사 결과처럼 **LIS 가 보고한 값**은 재반올림하지 않는다 — 보고값 변조가 된다.
 * - 값이 수치가 아니면 `undefined`(호출부가 valueString 등으로 분기).
 */
export function fhirQuantity(
  value: unknown,
  opts?: { policyKey?: string; unit?: string | null; round?: boolean },
): FhirQuantity | undefined {
  const raw = toFiniteNumber(value);
  if (raw == null) return undefined;

  const policy = opts?.policyKey ? NUMERIC_POLICIES[opts.policyKey] : undefined;
  const shouldRound = opts?.round ?? !!policy;
  const v = shouldRound && opts?.policyKey ? (roundBy(raw, opts.policyKey) ?? raw) : raw;

  const unit = opts?.unit ?? policy?.displayUnit;
  const code = policy?.ucumUnit ?? toUcumCode(unit);

  return {
    value: v,
    ...(unit ? { unit } : {}),
    // UCUM 을 확인한 경우에만 표준 선언 — 모르면 표시 단위만(허위 표기 금지)
    ...(code ? { system: UCUM_SYSTEM, code } : {}),
  };
}
