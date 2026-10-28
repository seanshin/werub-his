/**
 * 약물 상호작용 AI 점검 — 누가 부를 수 있고, 무엇을 넣는가.
 *
 * 🔴 (2026-10-03) 차트 개요의 안전 배너가 **차트를 열 때마다** `/api/v1/ai/drug-interactions` 를 불렀다.
 *    - EP 는 `@Roles(DOCTOR, PHARMACIST)` 인데 개요는 간호사·관리자도 연다 → 늘 403 →
 *      "약물 상호작용(DUR)을 확인하지 못했습니다"가 상시로 떴다(권한 밖을 '조회 실패'로 말함).
 *    - 기간이 끝난 약까지 넣었다(투약 탭은 shared `isScreenedForInteraction` 으로 뺀다 — 거짓 경보).
 *    - AI 결과를 AI 표기 없이 "DUR:" 로 그렸다(약국 DUR 과 구분 불가).
 *    → 배너는 결정론 축(위급값·알레르기)만 자동, AI 점검은 요청할 때만(검사 추이와 같은 규칙).
 *
 * 역할은 서버 `medical-ai.controller.ts` `drugInteractions` 의 `@Roles` 와 **같아야 한다**(기계 대조 가드).
 * `useHasRole` 은 ADMIN 을 늘 통과시키므로 여기에 쓰지 않는다 — ADMIN 은 이 EP 에서 403 이다.
 */
import { dosingWindow, isScreenedForInteraction, type DosingState } from '@hospital-run/shared';

export const DRUG_INTERACTION_AI_ROLES = ['DOCTOR', 'PHARMACIST'] as const;

export function canRequestDrugInteractionAi(role: string | null | undefined): boolean {
  return !!role && (DRUG_INTERACTION_AI_ROLES as readonly string[]).includes(role);
}

/** AI 서버에 한 번에 넘기는 약 수 상한 — 넘으면 잘랐다고 말한다 */
export const DRUG_INTERACTION_MAX = 20;

type RxRow = {
  type?: string | null;
  status?: string | null;
  createdAt?: string | Date | null;
  duration?: number | null;
  discontinuedAt?: string | Date | null;
  dosing?: { state?: DosingState } | null;
  drugName?: string | null;
  medicationCode?: { nameKo?: string | null; nameEn?: string | null } | null;
};

/**
 * 점검 대상 약 이름 — 투약 탭과 같은 규칙: 약(MEDICATION)만 · ACTIVE 만 · 기간이 확실히 끝난 약은 빼고
 * 기간 미상은 넣는다(shared `isScreenedForInteraction`). 같은 약은 한 번만.
 */
export function screenDrugsForInteraction(rows: RxRow[]): { names: string[]; endedExcluded: number; unknownIncluded: number } {
  const names = new Set<string>();
  let endedExcluded = 0;
  let unknownIncluded = 0;
  for (const r of rows) {
    if (r.type && r.type !== 'MEDICATION') continue;
    if (r.status && r.status !== 'ACTIVE') continue;
    const state: DosingState = r.dosing?.state
      ?? (r.createdAt ? dosingWindow({ createdAt: r.createdAt, duration: r.duration ?? null, discontinuedAt: r.discontinuedAt ?? null }).state : 'UNKNOWN');
    const name = r.medicationCode?.nameKo || r.medicationCode?.nameEn || r.drugName;
    if (!name) continue;
    if (!isScreenedForInteraction(state)) { endedExcluded += 1; continue; }
    if (state === 'UNKNOWN') unknownIncluded += 1;
    names.add(name);
  }
  return { names: [...names], endedExcluded, unknownIncluded };
}
