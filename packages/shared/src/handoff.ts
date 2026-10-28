/**
 * 인수인계(I-PASS) 어휘 정본 — 2026-10-04.
 *
 * 🔴 어휘가 세 갈래였다:
 *  - 서버 DTO 는 `STABLE·UNSTABLE·CRITICAL` 만 받는다
 *  - 입원 상세 I-PASS 폼은 자유 입력(`예: 안정 / 주의 / 위중`)을 보내 **개통 이래 400**(저장 0)
 *  - 시드 생성기는 한국어(`안정·주의·위중`)를 박았고, 인수인계 화면은 그것을 "중증도 미기재"로 그렸다
 *    — 적힌 값을 없다고 말한 것이다(P1)
 * 정본은 여기 하나. 어휘 밖 저장값은 지어낸 코드로 바꾸지 않고 **원문 그대로 + 어휘 밖**으로 말한다.
 */

export const HANDOFF_ILLNESS = ['STABLE', 'UNSTABLE', 'CRITICAL'] as const;
export type HandoffIllness = (typeof HANDOFF_ILLNESS)[number];

/** 화면 이름 — 위중도 오름차순 */
export const HANDOFF_ILLNESS_LABEL: Record<HandoffIllness, string> = {
  STABLE: '안정',
  UNSTABLE: '불안정',
  CRITICAL: '위급',
};

export interface HandoffIllnessView {
  /** 어휘 안이면 코드, 아니면 null */
  code: HandoffIllness | null;
  /** 저장값(없으면 null) — 어휘 밖이면 화면이 이것을 그대로 보인다 */
  raw: string | null;
  /** 저장값이 있으나 어휘 밖 */
  offVocab: boolean;
}

/** 저장값 → 표시 판정. 비어 있으면 미기재(안정으로 접지 않는다), 어휘 밖이면 원문 보존 */
export function handoffIllnessOf(v: unknown): HandoffIllnessView {
  if (typeof v !== 'string' || !v.trim()) return { code: null, raw: null, offVocab: false };
  const s = v.trim();
  return (HANDOFF_ILLNESS as readonly string[]).includes(s)
    ? { code: s as HandoffIllness, raw: s, offVocab: false }
    : { code: null, raw: s, offVocab: true };
}

/** 조치 상태 어휘 — 완료 판정은 `DONE` 만 */
export const HANDOFF_ACTION_STATUS = ['PENDING', 'DONE'] as const;
export type HandoffActionStatus = (typeof HANDOFF_ACTION_STATUS)[number];

/**
 * 조치 목록 항목 — `actionList` JSON 배열의 한 칸.
 * 완료 표시(2026-10-04)는 **누가·언제**를 함께 남긴다 — 이름 없는 체크는 인수인계 책임 기록이 아니다.
 */
export interface HandoffAction {
  action: string; status?: string; deadline?: string;
  doneAt?: string; doneById?: string; doneByName?: string;
}

/**
 * 조치 목록 읽기 — 저장 모양이 배열이 아니면(옛 문자열·null) 빈 목록이 아니라 `null`(모름)로.
 * 완료 판정은 `DONE` 만 — 모르는 상태값을 완료로 세지 않는다.
 */
export function handoffActionsOf(v: unknown): { items: HandoffAction[]; open: number; done: number } | null {
  if (!Array.isArray(v)) return null;
  const items = v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).action === 'string')
    .map((x) => ({
      action: String(x.action),
      ...(typeof x.status === 'string' ? { status: x.status } : {}),
      ...(typeof x.deadline === 'string' ? { deadline: x.deadline } : {}),
      ...(typeof x.doneAt === 'string' ? { doneAt: x.doneAt } : {}),
      ...(typeof x.doneById === 'string' ? { doneById: x.doneById } : {}),
      ...(typeof x.doneByName === 'string' ? { doneByName: x.doneByName } : {}),
    }));
  const done = items.filter((i) => i.status === 'DONE').length;
  return { items, open: items.length - done, done };
}

/**
 * 인계 종류(2026-10-26) — 🔴 종전엔 아무 문자열이나 받았고, 같은 "간호 교대 인계"에 두 단어가 쓰였다:
 *    입원 상세 화면은 간호사면 `NURSING_SHIFT`, 서버 교대 경로·시드는 간호사 인계도 `SHIFT_CHANGE`(운영 간호사→간호사 111건).
 *    간호 스테이션은 `NURSING_SHIFT` 일 때만 "인수 확인 + 담당 인수"를 보여 줘 111건이 그 단추를 못 받았다.
 *  · 새 기록: 이 어휘만 받는다(DTO 검사) · 교대 인계는 **보낸 사람 직종**으로 종류를 정한다(`shiftHandoffTypeFor`)
 *  · 쌓인 기록은 고치지 않는다 — 대신 **종류 + 보낸 사람 직종**으로 판정한 `kind` 를 서버가 내려 준다(`handoffKindOf`)
 */
export const HANDOFF_TYPES = ['NURSING_SHIFT', 'SHIFT_CHANGE', 'ER_TO_ADMISSION', 'ICU_TO_WARD', 'TRANSFER'] as const;
export type HandoffType = (typeof HANDOFF_TYPES)[number];
export const HANDOFF_TYPE_LABEL: Record<HandoffType, string> = {
  NURSING_SHIFT: '간호 교대', SHIFT_CHANGE: '의사 교대·주치의 변경', ER_TO_ADMISSION: '응급→입원', ICU_TO_WARD: '중환자실→병동', TRANSFER: '전과·전동',
};

/** 판정 종류 — 화면 분기 정본(문자열 종류를 직접 비교하지 않는다) */
export type HandoffKind = 'NURSING_SHIFT' | 'PHYSICIAN_SHIFT' | 'ER_TO_ADMISSION' | 'ICU_TO_WARD' | 'TRANSFER' | 'UNKNOWN';
export const HANDOFF_KIND_LABEL: Record<HandoffKind, string> = {
  NURSING_SHIFT: '간호 교대', PHYSICIAN_SHIFT: '의사 교대·주치의 변경', ER_TO_ADMISSION: '응급→입원', ICU_TO_WARD: '중환자실→병동', TRANSFER: '전과·전동', UNKNOWN: '종류 미상',
};

/** 종류 + 보낸 사람 직종 → 판정 종류. 교대(SHIFT_CHANGE)를 간호사가 보냈으면 간호 교대다(옛 기록·시드). 모르는 종류는 UNKNOWN. */
export function handoffKindOf(type: string | null | undefined, fromRole: string | null | undefined): HandoffKind {
  switch (type) {
    case 'NURSING_SHIFT': return 'NURSING_SHIFT';
    case 'SHIFT_CHANGE': return fromRole === 'NURSE' ? 'NURSING_SHIFT' : 'PHYSICIAN_SHIFT';
    case 'ER_TO_ADMISSION': return 'ER_TO_ADMISSION';
    case 'ICU_TO_WARD': return 'ICU_TO_WARD';
    case 'TRANSFER': return 'TRANSFER';
    default: return 'UNKNOWN';
  }
}

/** 교대 인계를 새로 적을 때의 종류 — 보낸 사람 직종으로(간호사 = NURSING_SHIFT) */
export function shiftHandoffTypeFor(role: string | null | undefined): HandoffType {
  return role === 'NURSE' ? 'NURSING_SHIFT' : 'SHIFT_CHANGE';
}
