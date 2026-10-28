/**
 * 원내 코드 호출(코드블루 등) 정본 — 2026-10-07.
 * 🔴 서버(`POST staff-calls/code` @Roles ADMIN·DOCTOR·NURSE)는 간호사에게 열려 있는데, 직원 화면(/staff)은 Code 탭을
 *    의사·관리자에게만 보여 **심정지를 가장 먼저 발견하는 간호사가 코드블루를 호출할 길이 없었다**. 역할 목록을 한 곳에 둔다.
 */
export const CODE_CALL_ROLES = ['ADMIN', 'DOCTOR', 'NURSE'] as const;
export const CODE_CALL_TYPES = ['CODE_BLUE', 'CODE_RED', 'CODE_GRAY'] as const;
export type CodeCallType = (typeof CODE_CALL_TYPES)[number];
export const CODE_CALL_LABEL: Record<CodeCallType, string> = {
  CODE_BLUE: 'CODE BLUE (심정지)',
  CODE_RED: 'CODE RED (화재)',
  CODE_GRAY: 'CODE GRAY (폭력)',
};
export function canCallCode(role: string | null | undefined): boolean {
  return !!role && (CODE_CALL_ROLES as readonly string[]).includes(role);
}
