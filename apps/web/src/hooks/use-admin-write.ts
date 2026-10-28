'use client';

import { useAuthStore } from '@/stores/auth-store';

/**
 * 🔴 **관리자 전용 쓰기 UI 를 그릴지 판정하는 정본**(2026-08-30 · 발굴 22회차).
 *
 * 마스터·거버넌스 화면들은 nav 를 임상 직군에게 열어 두고(목록 조회는 그들 업무다)
 * **쓰기 EP 만 `@Roles(ADMIN)`** 인 구조다. 화면이 그 버튼을 그대로 띄우면
 * 누를 때마다 403 이고, 화면이 **가진 적 없는 권한을 가진 척**하게 된다.
 *
 * 다섯 화면이 각자 `role === 'ADMIN'` 을 적으면 갈라진다 — 판정은 여기 하나다.
 * (서버 `RolesGuard` 는 ADMIN 을 모든 역할 검사에서 통과시키므로 기준이 ADMIN 하나로 맞다.)
 *
 * 🔴 이 훅은 **표시만** 정한다. 실제 차단은 서버 `@Roles` 가 한다 —
 *    화면에서 숨겼다는 이유로 서버 가드를 걷지 않는다.
 */
export function useAdminWrite(): boolean {
  return useHasRole('ADMIN');
}

/**
 * 🔴 **관리자만이 아니라 "그 행위를 하는 직군"으로 판정해야 하는 자리**가 있다.
 *    항암 사이클 시작(무균조제 지시가 따라 나온다)·협진 회신·병리 서명처럼
 *    서버가 특정 임상 직군에만 연 쓰기를 다른 직군 화면이 그리면 상시 403 이다.
 *
 *    `RolesGuard` 가 ADMIN 을 모든 역할 검사에서 통과시키므로 **ADMIN 은 항상 참**이다 —
 *    서버 판정과 화면 표시가 갈리지 않게 여기서 같은 규칙을 쓴다.
 *
 * 🔴 화면이 직접 `role === 'DOCTOR'` 를 적으면 정본이 갈라진다. 판정은 여기 하나다.
 */
export function useHasRole(...roles: string[]): boolean {
  const role = useAuthStore((s) => s.user?.role);
  if (!role) return false;
  return role === 'ADMIN' || roles.includes(role);
}

/**
 * 쓰기 UI 를 숨긴 자리에 **왜 없는지**를 말한다 — 빈 자리는 "기능이 없다"로 읽힌다.
 * 화면 상단에 한 줄로 둔다(상시 노출 문구는 짧게).
 */
export function adminWriteNotice(what: string): string {
  return `${what}은(는) 관리자 권한입니다 — 이 계정에서는 조회만 가능합니다.`;
}
