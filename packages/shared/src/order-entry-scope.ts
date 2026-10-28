/**
 * 오더 입력 범위 — **직종별로 무엇을 본인 권한으로, 무엇을 의사 승인으로 등록하는가**(2026-09-29 · 정본 하나).
 *
 * 🔴 종전 모델은 "비처방 역할이면 **어떤 오더든** 지정 의사 + 승인" 한 가지였다.
 *    그래서 간호사가 자기 업무 범위의 간호 중재(NIC)를 기록하려 해도 의사 승인을 받아야 했고,
 *    물리·작업·언어치료사는 역할(UserRole)이 아예 없어 온보딩에서 **조회 전용(READ)** 으로 떨어졌다.
 *
 * 모델:
 *  - 역할(UserRole)은 **무엇에 접근하는가**(RBAC)를 정하고, 직종(profession)은 **무엇을 등록하는가**를 좁힌다.
 *  - 의료기사(임상병리사·방사선사·물리/작업/언어치료사)는 역할 `LAB_TECH` 하나를 공유하고 직종으로 갈린다
 *    (방사선사가 이미 그렇게 운영되고 있었다).
 *  - 모드: SELF(본인 권한·본인이 책임자) · DELEGATE(지정 의사 + 그 의사의 승인 — 종전 흐름) · NONE(입력 불가).
 *
 * 🔴 안전 규칙(코드가 강제):
 *  1. **SELF 는 직종별 상한(SELF_ELIGIBLE)을 넘지 못한다** — 원내 설정(override)으로도 비의사의 약·검사·영상 등을
 *     본인 권한으로 올릴 수 없다. 설정은 **낮추기**(SELF→DELEGATE→NONE)와 DELEGATE 범위 조정만 한다.
 *  2. **직종은 역할과 맞아야 한다**(PROFESSION_ROLE) — LAB_TECH 계정에 직종 '의사'를 적어 권한을 올리는 경로를 막는다.
 *     맞지 않으면 무시하고 역할 기본 직종을 쓴다(그 사실을 source 로 밝힌다).
 *  3. 모르는 직종·유형은 NONE(모르면 안전측).
 *
 * 법적 근거는 조문을 여기 적지 않는다(검증되지 않은 조문을 코드에 박지 않는다) — 판단은 원내 결정
 * `order.entryScope.policy`(결정 등록부)가 갖고, 기본값은 보수적으로 둔다.
 */

export const CLINICAL_PROFESSIONS = [
  'DOCTOR',
  'NURSE',
  'PHYSICAL_THERAPIST',
  'OCCUPATIONAL_THERAPIST',
  'SPEECH_THERAPIST',
  'RADIOLOGIC_TECHNOLOGIST',
  'CLINICAL_LAB_TECHNOLOGIST',
  'DIETITIAN',
  'PHARMACIST',
] as const;
export type ClinicalProfession = typeof CLINICAL_PROFESSIONS[number];

export const CLINICAL_PROFESSION_LABEL: Record<ClinicalProfession, string> = {
  DOCTOR: '의사',
  NURSE: '간호사',
  PHYSICAL_THERAPIST: '물리치료사',
  OCCUPATIONAL_THERAPIST: '작업치료사',
  SPEECH_THERAPIST: '언어치료사',
  RADIOLOGIC_TECHNOLOGIST: '방사선사',
  CLINICAL_LAB_TECHNOLOGIST: '임상병리사',
  DIETITIAN: '영양사',
  PHARMACIST: '약사',
};

/** 오더 유형 — Prisma `PrescriptionType` 의 거울(가드가 집합 일치를 확인) */
export const ORDER_ENTRY_TYPES = ['MEDICATION', 'LAB', 'IMAGING', 'THERAPY', 'DIET', 'ACTIVITY', 'NURSING'] as const;
export type OrderEntryType = typeof ORDER_ENTRY_TYPES[number];

export type OrderEntryMode = 'SELF' | 'DELEGATE' | 'NONE';
export const ORDER_ENTRY_MODE_LABEL: Record<OrderEntryMode, string> = {
  SELF: '본인 권한',
  DELEGATE: '의사 승인 필요',
  NONE: '입력 불가',
};

/** 직종이 가질 수 있는 역할 — 이 밖의 조합은 직종을 무시한다(권한 상승 차단) */
export const PROFESSION_ROLE: Record<ClinicalProfession, string> = {
  DOCTOR: 'DOCTOR',
  NURSE: 'NURSE',
  PHYSICAL_THERAPIST: 'LAB_TECH',
  OCCUPATIONAL_THERAPIST: 'LAB_TECH',
  SPEECH_THERAPIST: 'LAB_TECH',
  RADIOLOGIC_TECHNOLOGIST: 'LAB_TECH',
  CLINICAL_LAB_TECHNOLOGIST: 'LAB_TECH',
  DIETITIAN: 'NUTRITION',
  PHARMACIST: 'PHARMACIST',
};

/** 직종 미지정 계정의 역할 기본 직종 */
export const ROLE_DEFAULT_PROFESSION: Partial<Record<string, ClinicalProfession>> = {
  DOCTOR: 'DOCTOR',
  NURSE: 'NURSE',
  LAB_TECH: 'CLINICAL_LAB_TECHNOLOGIST',
  NUTRITION: 'DIETITIAN',
  PHARMACIST: 'PHARMACIST',
};

/**
 * 본인 권한(SELF)으로 올릴 수 있는 상한 — 비의사는 **자기 업무 범위의 기록성 오더**만.
 * 간호사: 간호 중재(NIC·간호지시). 그 밖의 비의사는 없음.
 */
export const SELF_ELIGIBLE: Record<ClinicalProfession, readonly OrderEntryType[]> = {
  DOCTOR: ORDER_ENTRY_TYPES,
  NURSE: ['NURSING'],
  PHYSICAL_THERAPIST: [],
  OCCUPATIONAL_THERAPIST: [],
  SPEECH_THERAPIST: [],
  RADIOLOGIC_TECHNOLOGIST: [],
  CLINICAL_LAB_TECHNOLOGIST: [],
  DIETITIAN: [],
  PHARMACIST: [],
};

/**
 * 기본 범위(보수적). 빠진 칸 = NONE.
 *  - 간호사: 간호 오더는 본인 권한 · 그 밖은 구두처방 대리입력(의사 승인) — 종전 흐름 유지
 *  - 치료사: 치료 오더만 의사 승인으로(의사의 지도 하에 시행하는 직종)
 *  - 방사선사: 영상 · 임상병리사: 검사 — 의사 승인(종전 워크인 검사 흐름)
 *  - 영양사: 기본 없음 — 역할(NUTRITION)이 오더 권한 없음으로 정의돼 있다. 식이 오더 입력 여부는 원내 결정
 *  - 약사: 없음(조제·검토 직종)
 */
export const DEFAULT_ORDER_ENTRY_SCOPE: Record<ClinicalProfession, Partial<Record<OrderEntryType, OrderEntryMode>>> = {
  DOCTOR: { MEDICATION: 'SELF', LAB: 'SELF', IMAGING: 'SELF', THERAPY: 'SELF', DIET: 'SELF', ACTIVITY: 'SELF', NURSING: 'SELF' },
  NURSE: { NURSING: 'SELF', MEDICATION: 'DELEGATE', LAB: 'DELEGATE', IMAGING: 'DELEGATE', THERAPY: 'DELEGATE', DIET: 'DELEGATE', ACTIVITY: 'DELEGATE' },
  PHYSICAL_THERAPIST: { THERAPY: 'DELEGATE' },
  OCCUPATIONAL_THERAPIST: { THERAPY: 'DELEGATE' },
  SPEECH_THERAPIST: { THERAPY: 'DELEGATE' },
  RADIOLOGIC_TECHNOLOGIST: { IMAGING: 'DELEGATE' },
  CLINICAL_LAB_TECHNOLOGIST: { LAB: 'DELEGATE' },
  DIETITIAN: {},
  PHARMACIST: {},
};

export type OrderEntryScopeOverride = Partial<Record<string, Partial<Record<string, string>>>>;

export function isClinicalProfession(v: unknown): v is ClinicalProfession {
  return typeof v === 'string' && (CLINICAL_PROFESSIONS as readonly string[]).includes(v);
}

export type ProfessionSource = 'SET' | 'ROLE_DEFAULT' | 'MISMATCH_IGNORED' | 'NONE';

/** 계정의 유효 직종 — 지정값이 역할과 맞을 때만 쓴다 */
export function resolveProfession(role: string | null | undefined, profession: string | null | undefined): { profession: ClinicalProfession | null; source: ProfessionSource } {
  const roleDefault = role ? ROLE_DEFAULT_PROFESSION[role] ?? null : null;
  if (profession) {
    if (isClinicalProfession(profession) && PROFESSION_ROLE[profession] === role) return { profession, source: 'SET' };
    return { profession: roleDefault, source: 'MISMATCH_IGNORED' };
  }
  return roleDefault ? { profession: roleDefault, source: 'ROLE_DEFAULT' } : { profession: null, source: 'NONE' };
}

/**
 * 한 유형의 입력 모드.
 *  - DOCTOR·ADMIN(운영 계정) 역할 → SELF(종전 동작)
 *  - 그 밖 → 직종 기본 범위 ∘ 원내 설정(override) — 단 SELF 는 상한(SELF_ELIGIBLE) 안에서만
 */
export function orderEntryMode(
  role: string | null | undefined,
  profession: string | null | undefined,
  type: string,
  override?: OrderEntryScopeOverride | null,
): OrderEntryMode {
  if (role === 'DOCTOR' || role === 'ADMIN') return 'SELF';
  if (!(ORDER_ENTRY_TYPES as readonly string[]).includes(type)) return 'NONE';
  const t = type as OrderEntryType;
  const { profession: p } = resolveProfession(role, profession);
  if (!p) return 'NONE';
  let mode: OrderEntryMode = DEFAULT_ORDER_ENTRY_SCOPE[p][t] ?? 'NONE';
  const o = override?.[p]?.[t];
  if (o === 'SELF' || o === 'DELEGATE' || o === 'NONE') mode = o;
  // 상한 — 설정으로도 SELF 를 넘겨받지 못한다
  if (mode === 'SELF' && !SELF_ELIGIBLE[p].includes(t)) mode = 'DELEGATE';
  return mode;
}

/** 전 유형 모드 표 — 화면이 탭마다 무엇을 할지 정한다 */
export function orderEntryModes(role: string | null | undefined, profession: string | null | undefined, override?: OrderEntryScopeOverride | null): Record<OrderEntryType, OrderEntryMode> {
  return Object.fromEntries(ORDER_ENTRY_TYPES.map((t) => [t, orderEntryMode(role, profession, t, override)])) as Record<OrderEntryType, OrderEntryMode>;
}

/**
 * 치료 **시행**(시작·완료 기록) 직종 — 오더 입력과 별개(치료사는 오더는 의사 승인, 시행 기록은 본인 업무).
 * 🔴 종전: 치료 워크리스트는 LAB_TECH 에 열려 있었지만 시작·완료는 DOCTOR/NURSE/ADMIN 뿐이라 치료사에게 상시 403.
 * LAB_TECH 는 임상병리사와 공유하므로 **직종으로 가른다** — 직종 미지정(역할 기본=임상병리사)은 시행 불가(관리자가 지정).
 */
export const REHAB_EXECUTOR_PROFESSIONS: readonly ClinicalProfession[] = ['PHYSICAL_THERAPIST', 'OCCUPATIONAL_THERAPIST', 'SPEECH_THERAPIST'];
/** 치료 오더(방사선 치료 포함)의 시행 직종 */
export const THERAPY_EXECUTOR_PROFESSIONS: readonly ClinicalProfession[] = [...REHAB_EXECUTOR_PROFESSIONS, 'RADIOLOGIC_TECHNOLOGIST'];

/** 시행 가능 여부 — 의사·간호사·관리자는 종전대로 · LAB_TECH 는 지정 직종이 목록에 있을 때만 */
export function canExecuteTherapy(role: string | null | undefined, profession: string | null | undefined, allowed: readonly ClinicalProfession[]): boolean {
  if (role === 'DOCTOR' || role === 'NURSE' || role === 'ADMIN') return true;
  if (role !== 'LAB_TECH') return false;
  const { profession: p, source } = resolveProfession(role, profession);
  return source === 'SET' && !!p && allowed.includes(p);
}

/**
 * 오더 **시행·결과 기록** 범위(완료 처리·결과 기록) — 입력 범위와 별개(2026-09-29).
 * 🔴 종전: `/orders` 행의 접수·시작·완료 버튼이 역할·유형과 무관하게 떴고 서버도 가르지 않아,
 *    누구나 검사·영상 오더를 **결과 없이 '완료'** 로 만들 수 있었다(검사 결과 원장에 아무것도 없는데 완료).
 * 접수·시작은 종전대로 두고 **완료와 결과 기록만** 가른다(기존 흐름 무중단).
 *  - 의사·관리자: 전 유형
 *  - 간호사: 약(투약 시행)·치료·간호·활동·식이
 *  - 약사: 약
 *  - 의료기사(LAB_TECH): 검사·영상(종전 흐름 — 직종 무관) · 치료는 치료 직종(물리·작업·언어·방사선)만
 */
export function canExecuteOrder(role: string | null | undefined, profession: string | null | undefined, type: string): boolean {
  if (role === 'DOCTOR' || role === 'ADMIN') return true;
  if (role === 'NURSE') return ['MEDICATION', 'THERAPY', 'NURSING', 'ACTIVITY', 'DIET'].includes(type);
  if (role === 'PHARMACIST') return type === 'MEDICATION';
  if (role === 'LAB_TECH') {
    if (type === 'LAB' || type === 'IMAGING') return true;
    if (type === 'THERAPY') return canExecuteTherapy(role, profession, THERAPY_EXECUTOR_PROFESSIONS);
  }
  return false;
}

/**
 * 결과를 **전용 원장**에 쓰는 유형 — 여기에 범용 결과를 쓰면 같은 사실에 정본이 둘이 된다(검사 결과가 위급값·추이·CDS 를
 * 못 탄다). 화면은 전용 화면으로 안내한다.
 */
export const DEDICATED_RESULT_SCREEN: Partial<Record<OrderEntryType, { href: string; label: string }>> = {
  LAB: { href: '/lab', label: '검사 결과 입력(검사실)' },
  IMAGING: { href: '/imaging', label: '영상 판독(영상의학)' },
  MEDICATION: { href: '/pharmacy', label: '조제·투약 기록(약제·간호 MAR)' },
};
/** 범용 결과 기록(요약·소견·시행 시각·결과지) 유형 */
export const GENERIC_RESULT_TYPES: readonly OrderEntryType[] = ['THERAPY', 'NURSING', 'ACTIVITY', 'DIET'];

/** 범용 결과 기록 한 건 — 정정은 새 항목(AMENDMENT)으로 덧붙인다(지우지 않는다) */
export interface OrderResultEntry {
  id: string;
  kind: 'RESULT' | 'AMENDMENT';
  summary: string;
  findings?: string | null;
  /** 실제 시행 시각(기록자 입력) — 시스템 스탬프(접수·시작·완료 시각)는 '기록한 때'라 다르다 */
  performedAt: string | null;
  recordedAt: string;
  recordedBy: string;
  recordedByName?: string | null;
  amends?: string | null;
}
export interface OrderResultAttachment {
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedByName?: string | null;
  uploadedAt: string;
}
export interface OrderResultDoc {
  entries: OrderResultEntry[];
  attachments: OrderResultAttachment[];
}
/** Order.result JSON → 구조(구 형식·빈 값도 안전하게) */
export function parseOrderResult(v: unknown): OrderResultDoc {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<OrderResultDoc>) : {};
  return {
    entries: Array.isArray(o.entries) ? (o.entries as OrderResultEntry[]) : [],
    attachments: Array.isArray(o.attachments) ? (o.attachments as OrderResultAttachment[]) : [],
  };
}
