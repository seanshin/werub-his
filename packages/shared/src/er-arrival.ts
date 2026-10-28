/**
 * 응급 도착 상황 기록 어휘 정본 — 기획 `docs/01-plan/features/er-arrival-record.plan.md`.
 *
 * 🔴 배경(2026-09-29 실측): 응급 미확인 등록 화면의 "도착 상황 메모"·"손상 유형"은 API 가 검증까지 하고
 *    **저장 직전에 버렸다**(서비스가 Patient 행만 만든다 · 컬럼 없음 · 보여주는 화면 없음). 개통 이래 기록 0.
 *
 * 규칙:
 *   - 모르는 것은 `UNKNOWN`/null — 기본값으로 채우지 않는다(도착 시각을 '지금'으로 박지 않는다).
 *   - 기록은 고치지 않고 **덧붙인다**(첫 기록 INITIAL + 추가 기록 ADDENDUM) — 나중에 경찰·보호자에게 들은 사실이 원래 기록을 덮지 않게.
 *   - 화면·API·시드가 같은 목록을 쓴다(여기 하나).
 */

export const ARRIVAL_NOTE_KINDS = ['INITIAL', 'ADDENDUM'] as const;
export type ArrivalNoteKind = (typeof ARRIVAL_NOTE_KINDS)[number];

/** 내원 수단 */
export const ARRIVAL_MODES = ['WALK_IN', 'AMBULANCE_119', 'AMBULANCE_PRIVATE', 'POLICE', 'TRANSFER', 'HELICOPTER', 'OTHER', 'UNKNOWN'] as const;
export type ArrivalMode = (typeof ARRIVAL_MODES)[number];
export const ARRIVAL_MODE_LABEL: Record<ArrivalMode, string> = {
  WALK_IN: '도보·자가', AMBULANCE_119: '119 구급차', AMBULANCE_PRIVATE: '사설 구급차', POLICE: '경찰 인계',
  TRANSFER: '타 병원 전원', HELICOPTER: '헬기', OTHER: '기타', UNKNOWN: '모름',
};

/** 손상 유형(복수 선택) — 종전 화면의 한국어 값 12종을 코드로(`INJURY_LEGACY_LABEL` 로 옛 입력을 받는다) */
export const INJURY_TYPES = ['TRAFFIC', 'FALL', 'BLUNT', 'PENETRATING', 'BURN', 'POISONING', 'DROWNING', 'ASPHYXIA', 'SELF_HARM', 'ASSAULT', 'NON_TRAUMA', 'OTHER', 'UNKNOWN'] as const;
export type InjuryType = (typeof INJURY_TYPES)[number];
export const INJURY_TYPE_LABEL: Record<InjuryType, string> = {
  TRAFFIC: '교통사고', FALL: '추락', BLUNT: '외상(둔기)', PENETRATING: '외상(예기)', BURN: '화상', POISONING: '중독/약물',
  DROWNING: '익수', ASPHYXIA: '질식', SELF_HARM: '자해', ASSAULT: '폭행', NON_TRAUMA: '비외상(질병)', OTHER: '기타', UNKNOWN: '미상',
};
/** 옛 입력(한국어 값) → 코드 — 모르는 값은 null(지어내지 않는다) */
export function injuryTypeFromLegacy(v: string | null | undefined): InjuryType | null {
  const t = (v ?? '').trim();
  if (!t) return null;
  if ((INJURY_TYPES as readonly string[]).includes(t)) return t as InjuryType;
  const hit = (Object.entries(INJURY_TYPE_LABEL) as [InjuryType, string][]).find(([, l]) => l === t);
  return hit ? hit[0] : null;
}

/** 도착 시 의식(AVPU) — 평가하지 않았으면 NOT_ASSESSED(정상으로 두지 않는다) */
export const ARRIVAL_CONSCIOUSNESS = ['ALERT', 'VERBAL', 'PAIN', 'UNRESPONSIVE', 'NOT_ASSESSED'] as const;
export type ArrivalConsciousness = (typeof ARRIVAL_CONSCIOUSNESS)[number];
export const ARRIVAL_CONSCIOUSNESS_LABEL: Record<ArrivalConsciousness, string> = {
  ALERT: 'A 명료', VERBAL: 'V 목소리에 반응', PAIN: 'P 통증에 반응', UNRESPONSIVE: 'U 무반응', NOT_ASSESSED: '평가 안 함',
};

/** 동행·인계자 */
export const COMPANION_TYPES = ['NONE', 'FAMILY', 'ACQUAINTANCE', 'BYSTANDER', 'POLICE', 'EMS', 'OTHER', 'UNKNOWN'] as const;
export type CompanionType = (typeof COMPANION_TYPES)[number];
export const COMPANION_TYPE_LABEL: Record<CompanionType, string> = {
  NONE: '동행 없음', FAMILY: '가족', ACQUAINTANCE: '지인', BYSTANDER: '목격자·신고자', POLICE: '경찰', EMS: '구급대원', OTHER: '기타', UNKNOWN: '모름',
};

/** 이 기록의 정보 출처 — 누구에게 들었거나 무엇을 보고 적었나 */
export const ARRIVAL_INFO_SOURCES = ['EMS', 'POLICE', 'COMPANION', 'BYSTANDER', 'STAFF_OBSERVED', 'PATIENT', 'OTHER'] as const;
export type ArrivalInfoSource = (typeof ARRIVAL_INFO_SOURCES)[number];
export const ARRIVAL_INFO_SOURCE_LABEL: Record<ArrivalInfoSource, string> = {
  EMS: '구급대', POLICE: '경찰', COMPANION: '동행인', BYSTANDER: '목격자·신고자', STAFF_OBSERVED: '직원 관찰', PATIENT: '환자 진술', OTHER: '기타',
};

/** 소지품 보관 */
export const BELONGING_CUSTODY = ['WITH_PATIENT', 'HOSPITAL_STORED', 'HANDED_TO_POLICE', 'HANDED_TO_GUARDIAN', 'UNKNOWN'] as const;
export type BelongingCustody = (typeof BELONGING_CUSTODY)[number];
export const BELONGING_CUSTODY_LABEL: Record<BelongingCustody, string> = {
  WITH_PATIENT: '환자 소지', HOSPITAL_STORED: '병원 보관', HANDED_TO_POLICE: '경찰 인계', HANDED_TO_GUARDIAN: '보호자 인계', UNKNOWN: '모름',
};
export interface ArrivalBelonging { item: string; custody: BelongingCustody }

/** 글자 수 상한(DTO·화면 공용) */
export const ARRIVAL_TEXT_MAX = { short: 100, place: 300, long: 2000 } as const;

/** 기록 한 벌 — 비어 있는 칸은 "모름/적지 않음"이다(기본값 아님) */
export interface ArrivalNoteInput {
  arrivalAt?: string | null;
  arrivalMode?: ArrivalMode | null;
  emsUnit?: string | null;
  foundLocation?: string | null;
  foundAt?: string | null;
  circumstance?: string | null;
  consciousness?: ArrivalConsciousness | null;
  injuryTypes?: InjuryType[];
  companionType?: CompanionType | null;
  companionName?: string | null;
  companionContact?: string | null;
  companionRelation?: string | null;
  belongings?: ArrivalBelonging[];
  identifyingFeatures?: string | null;
  policeInvolved?: boolean | null;
  policeAgency?: string | null;
  policeOfficer?: string | null;
  policeCaseNo?: string | null;
  infoSource?: ArrivalInfoSource | null;
  note?: string | null;
}

/** 무엇이든 하나라도 적었는가 — 빈 기록은 만들지 않는다(빈 행이 "기록함"으로 읽히지 않게) */
export function arrivalNoteHasContent(n: ArrivalNoteInput): boolean {
  const s = (v: string | null | undefined) => !!v && v.trim().length > 0;
  return !!(
    s(n.arrivalAt) || n.arrivalMode || s(n.emsUnit) || s(n.foundLocation) || s(n.foundAt) || s(n.circumstance) || n.consciousness
    || (n.injuryTypes?.length ?? 0) > 0 || n.companionType || s(n.companionName) || s(n.companionContact) || s(n.companionRelation)
    || (n.belongings?.some((b) => s(b.item)) ?? false) || s(n.identifyingFeatures) || n.policeInvolved != null
    || s(n.policeAgency) || s(n.policeOfficer) || s(n.policeCaseNo) || n.infoSource || s(n.note)
  );
}
