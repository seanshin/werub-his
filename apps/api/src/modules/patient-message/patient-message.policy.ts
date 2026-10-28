/**
 * 환자↔담당의 메시지 — 직원 측 열람·답변 범위(순수 함수 · Nest 의존 없음).
 *
 * 🔴 (2026-09-14 기획서 전수 검토) 포털·모바일이 `PatientMessage(sender PATIENT)` 를 쓰는데
 *    읽는 곳이 환자 본인 목록뿐이었다 — 환자는 담당의에게 보냈다고 믿지만 **아무에게도 도달하지 않았다.**
 *
 * 범위 정본:
 *  · 열람 = shared `CHART_CLINICAL_ROLES`(차트 임상 열람 역할 — 정본이 둘이 되지 않게 그대로 쓴다)
 *  · DOCTOR 는 **자기 지정분 + 담당 미지정분**만 본다(다른 의사에게 온 메시지는 그 의사의 것)
 *  · 그 외 열람 역할(ADMIN·NURSE·PHARMACIST·MEDICAL_RECORDS)은 전건 — 환자 지목 열람은 감사 원장에 남는다
 *  · 답변 = DOCTOR 만(진료 조언 책임) — 간호사·관리자가 의사 이름으로 답하지 않는다
 */
import { CHART_CLINICAL_ROLES } from '@hospital-run/shared';

export type MessageScope = 'MINE_AND_UNASSIGNED' | 'ALL';

export const PATIENT_MESSAGE_READ_ROLES = CHART_CLINICAL_ROLES;
export const PATIENT_MESSAGE_REPLY_ROLES = ['DOCTOR'] as const;

export function messageScopeFor(role: string | undefined | null): MessageScope | null {
  if (!role || !(PATIENT_MESSAGE_READ_ROLES as readonly string[]).includes(role)) return null;
  return role === 'DOCTOR' ? 'MINE_AND_UNASSIGNED' : 'ALL';
}

/** Prisma where 조각 — DOCTOR 는 doctorId ∈ {본인, null} */
export function scopeWhere(scope: MessageScope, userId: string): { OR?: Array<{ doctorId: string | null }> } {
  return scope === 'ALL' ? {} : { OR: [{ doctorId: userId }, { doctorId: null }] };
}

/**
 * 담당 표시 — 🔴 null 은 "누가 받는지 모른다"는 사실이다. 임의로 배정하지 않고 그대로 말한다.
 * (포털 전송 시 doctorId 가 없으면 최근 진료 의사로 채운다 — 그것이 환자가 고른 것인지 추정인지는
 *  스키마에 남지 않는다. 화면은 "지정"이라 부르지 "환자가 선택"이라 부르지 않는다.)
 */
export type Assignment = 'MINE' | 'UNASSIGNED' | 'OTHER';
export function assignmentOf(doctorId: string | null, userId: string): Assignment {
  if (doctorId == null) return 'UNASSIGNED';
  return doctorId === userId ? 'MINE' : 'OTHER';
}
