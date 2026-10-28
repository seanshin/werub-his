/**
 * 알레르기 확인 상태 정본 — **서버 `allergy.service.ts` 가 내는 값 그대로**.
 *
 * 🔴 발단(2026-08-26 실측): 환자 차트 헤더가 `allergies.length === 0` 이면
 *    초록 **`NKDA`**(No Known Drug Allergy)를 달고 있었다. 그것은 **"물어봤고 없었다"**는
 *    임상적 단언인데, 운영에서 **알레르기 평가를 받은 환자는 0명**이었다
 *    (환자 874명 · 알레르기 기록 12명 · 평가 0명) — **862명이 근거 없는 초록 배지**를 달고 있었고
 *    처방하는 의사가 그것을 봤다.
 *
 * 🔴 서버에는 이 4상태가 진작 있었고 **환자 포털과 진료 입력 화면은 그것을 썼다.**
 *    차트만 2상태로 접고 있었다 — 모두가 가장 먼저 여는 화면이 유일하게.
 *
 * 규칙
 *  - **미확인은 회색이 아니라 주의다.** 모르는 것은 안전한 쪽이 아니다.
 *  - **초록은 평가 기록이 있을 때만.** 기록이 없으면 초록을 그리지 않는다.
 *  - **모르는 값을 한국어인 척하지 않는다** — 원문 그대로 보여주고 가드가 이 표를 고치라고 실패한다.
 */
export const ALLERGY_STATUSES = [
  'HAS_ALLERGIES',
  'NOT_ASSESSED',
  'UNABLE_TO_ASSESS',
  'NO_KNOWN_ALLERGIES',
] as const;
export type AllergyStatusKey = (typeof ALLERGY_STATUSES)[number];

export interface AllergyStatusMeta {
  /** 화면 배지 문구 */
  label: string;
  /** 이 상태가 무엇을 뜻하는지 — title/툴팁에 그대로 쓴다 */
  meaning: string;
  /** `danger` 알레르기 있음 · `warn` 확인되지 않음 · `safe` 확인했고 없음 */
  tone: 'danger' | 'warn' | 'safe';
}

export const ALLERGY_STATUS_META: Record<AllergyStatusKey, AllergyStatusMeta> = {
  HAS_ALLERGIES: {
    label: '알레르기 있음',
    meaning: '등록된 알레르기가 있습니다.',
    tone: 'danger',
  },
  NOT_ASSESSED: {
    // 🔴 "없음"이 아니라 "확인되지 않음" — 물어본 사람이 없다는 뜻이다
    label: '알레르기 미확인',
    meaning: '알레르기를 확인한 기록이 없습니다 — 없다는 뜻이 아닙니다.',
    tone: 'warn',
  },
  UNABLE_TO_ASSESS: {
    label: '알레르기 확인 불가',
    meaning: '확인을 시도했으나 파악하지 못했습니다(의식·언어·보호자 부재 등).',
    tone: 'warn',
  },
  NO_KNOWN_ALLERGIES: {
    label: '알레르기 없음(확인함)',
    meaning: '확인한 결과 알려진 알레르기가 없습니다(NKDA).',
    tone: 'safe',
  },
};

export function allergyStatusMeta(status: string | null | undefined): AllergyStatusMeta {
  return (
    ALLERGY_STATUS_META[status as AllergyStatusKey] ?? {
      // 🔴 모르는 값을 안전하다고 말하지 않는다 — 원문을 보여주고 주의로 그린다
      label: String(status ?? 'UNKNOWN'),
      meaning: '알 수 없는 상태 값입니다 — 안전한 쪽으로 읽지 마세요.',
      tone: 'warn',
    }
  );
}

/** 🔴 초록은 **평가 기록이 있을 때만**. 기록 없이 초록을 그리는 경로를 만들지 않는다. */
export function allergyStatusIsReassuring(status: string | null | undefined, assessedAt: unknown): boolean {
  return status === 'NO_KNOWN_ALLERGIES' && !!assessedAt;
}

/**
 * 🔴 알레르기 **확인 상태**(4상태)를 조회할 수 있는 역할 — API `@Roles` 와 **같은 목록 하나**다.
 *
 * 실측(2026-08-27): `GET /patients/:id/allergies/status` 는 이 4역할만 200 이고
 * `LAB_TECH·RECEPTIONIST·MEDICAL_RECORDS·CHECKUP` 은 **403** 이다. 그런데 같은 역할들이
 * `/patients/:id/summary` 로는 **알레르기 목록을 그대로 받는다.**
 *
 * 그래서 화면은 **권한이 없으면 부르지 않는다** — 403 을 "확인 못 함"으로 그리면
 * 시스템 장애처럼 읽히고, 목록에 알레르기가 있는데도 경고가 약해진다.
 * 🔴 **FE 와 API 양쪽에 적으면 갈라진다 — 이 상수 하나를 양쪽이 쓴다**(가드가 일치를 강제).
 */
export const ALLERGY_STATUS_ROLES = ['DOCTOR', 'NURSE', 'PHARMACIST', 'ADMIN'] as const;
export type AllergyStatusRole = (typeof ALLERGY_STATUS_ROLES)[number];
export const canReadAllergyStatus = (role: string | null | undefined): boolean =>
  !!role && (ALLERGY_STATUS_ROLES as readonly string[]).includes(role);
