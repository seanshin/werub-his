/**
 * 통합 상황판 — 환자 여정 섹션의 역할 게이트 정본 (2026-08-27)
 *
 * ── 실측 ────────────────────────────────────────────────────────────────────
 * nav 는 `/command-center` 를 ADMIN·DOCTOR·NURSE·PHARMACIST·LAB_TECH 에게 연다.
 * 그런데 하단 '환자 여정' 섹션은 `GET /api/v1/journey-console/board` 를 무조건 불렀고,
 * 그 EP 는 `@Roles(ADMIN, EXECUTIVE)` 다 → **임상 4역할 전부 403**.
 * 게다가 실패 처리가 `if (isError) return null` 이라 섹션이 **소리 없이 사라졌다**
 * (사람은 "여정 데이터가 없다"고 읽는다 — 없는 것과 못 보는 것은 다른 사실이다).
 *
 * 🔴 여기서 EP 를 여는 것은 답이 아니다. 여정 콘솔은 **경영 관제** 화면이고
 *    (`/journey-console` 도 같은 컨트롤러다) 임상 역할의 업무 도구가 아니다.
 *    → 화면이 접고, 접었다는 사실을 말한다.
 *
 * 🔴 이 목록은 손으로 적은 사본이다 — `test/architecture/screen-role-gate-canon.spec.ts`
 *    가 `journey-console.controller.ts` 의 클래스 레벨 `@Roles` 와 기계로 대조한다.
 */
export const JOURNEY_BOARD_ROLES = ['ADMIN', 'EXECUTIVE'] as const;

export const canSeeJourneyBoard = (role?: string | null): boolean =>
  !!role && (JOURNEY_BOARD_ROLES as readonly string[]).includes(role);

/**
 * 통합 상황판 자체의 역할 게이트 정본(2026-10-02 · 상황판↔대시보드 역할 분리).
 * 대시보드의 "병원 상황 요약" 위젯·"상황판에서 보기" 링크가 이 목록으로 판정한다 — 못 여는 역할에게 길을 내지 않는다.
 * 🔴 사본이다 — `screen-role-gate-canon.spec.ts` 가 `command-center.controller.ts` 클래스 `@Roles` 와 대조한다.
 */
export const COMMAND_CENTER_ROLES = ['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH'] as const;

export const canSeeCommandCenter = (role?: string | null): boolean =>
  !!role && (COMMAND_CENTER_ROLES as readonly string[]).includes(role);

/** 경영 화면(`/executive`) — 추이·손익은 여기서 본다(nav 와 같은 집합) */
export const EXECUTIVE_VIEW_ROLES = ['ADMIN', 'EXECUTIVE'] as const;

export const canSeeExecutive = (role?: string | null): boolean =>
  !!role && (EXECUTIVE_VIEW_ROLES as readonly string[]).includes(role);
