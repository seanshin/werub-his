import { canConfirmReadBack } from '@hospital-run/shared';

/**
 * `/safety` 탭 노출 판정 정본 (2026-08-27 · 전역 역할 프로브 회수)
 *
 * ── 왜 여기 있나 ─────────────────────────────────────────────────────────────
 * 🔴 **화면이 여는 것과 API 가 허용하는 것이 갈라져 있었다.**
 *    `PatientSafetyController` 는 클래스 레벨 `@Roles(DOCTOR, NURSE, ADMIN)` 이고,
 *    `RolesGuard` 는 역할 게이트와 권한 게이트를 **AND** 로 건다(둘 다 통과해야 한다).
 *    그런데 화면은 `safety:incident:review` **권한만** 보고 탭을 열었다.
 *
 *    코드 기본 매트릭스에서는 두 집합이 우연히 같아서 오늘은 티가 나지 않는다.
 *    그러나 `/admin/rbac` 오버라이드는 **권한을 넓히는 방향으로도 작동한다**
 *    (`PermissionService.hasPermission` — 오버라이드가 코드 기본값을 이긴다).
 *    병원이 약사에게 전담인력 권한을 주는 순간 화면은 대시보드·식별·보호대·RCA 탭을
 *    열고, 그 5개 EP 는 **역할 게이트에서 전부 403** 이 된다. 오버라이드로는
 *    `@Roles` 가 넓어지지 않기 때문이다(`auth.controller.ts` /me 주석과 같은 판단).
 *
 *    → 화면 판정 = **역할 AND 권한**. 그리고 접었으면 **접었다고 말한다**.
 *
 * 🔴 이 목록은 손으로 적은 사본이다 — `test/architecture/screen-role-gate-canon.spec.ts`
 *    가 `patient-safety.controller.ts` 의 클래스 레벨 `@Roles` 와 **기계로 대조**한다.
 *    (역할 목록 정본은 shared 에 있어야 하나 이번 회수의 파일 범위 밖이라 대조 가드로 대신한다.)
 */
export const SAFETY_REVIEW_API_ROLES = ['DOCTOR', 'NURSE', 'ADMIN'] as const;

/** 전건 열람·조사·RCA 권한 키(환자안전 전담인력) */
export const SAFETY_REVIEW_PERMISSION = 'safety:incident:review';

export interface SafetyViewer {
  role?: string | null;
  permissions?: string[] | null;
}

export const roleAllowsSafetyReview = (role?: string | null): boolean =>
  !!role && (SAFETY_REVIEW_API_ROLES as readonly string[]).includes(role);

export const hasSafetyReviewPermission = (permissions?: string[] | null): boolean =>
  !!permissions?.includes(SAFETY_REVIEW_PERMISSION);

/** 화면이 전담인력 탭을 열어도 되는가 = 역할 AND 권한(서버가 그 순서로 검사한다) */
export const canReviewSafety = (v: SafetyViewer): boolean =>
  roleAllowsSafetyReview(v.role) && hasSafetyReviewPermission(v.permissions);

/**
 * 왜 접혔는지 — 화면이 사람에게 말할 사실.
 *  · `null`         = 접히지 않았다
 *  · `'PERMISSION'` = 역할은 되는데 전담인력 권한이 없다(일반적인 경우)
 *  · `'ROLE'`       = 권한은 부여돼 있는데 **서버 역할 게이트가 막는다**
 *                     — 권한만 보고 "곧 열린다"고 읽으면 안 되는 자리다
 */
export function safetyReviewBlockReason(v: SafetyViewer): 'ROLE' | 'PERMISSION' | null {
  if (canReviewSafety(v)) return null;
  if (hasSafetyReviewPermission(v.permissions) && !roleAllowsSafetyReview(v.role)) return 'ROLE';
  return 'PERMISSION';
}

export const SAFETY_TABS = [
  { key: 'dashboard', label: '대시보드', icon: '📊', review: true, clinical: false },
  { key: 'identification', label: '환자 식별', icon: '🆔', review: true, clinical: false },
  { key: 'restraint', label: '신체보호대', icon: '🛏️', review: true, clinical: false },
  // 🔴 복창 확인은 임상 행위다 — API 는 DOCTOR/NURSE/ADMIN 이므로 그 밖의 직군에게는 탭 자체를
  //    띄우지 않는다(띄우면 급양·원무 계정이 403 빨간 배너를 본다). 역할 정본은 shared 한 벌.
  { key: 'readback', label: '구두처방 복창', icon: '📞', review: false, clinical: true },
  { key: 'list', label: '사고 목록', icon: '📋', review: false, clinical: false },
  { key: 'rca', label: '근본원인분석(RCA)', icon: '🧭', review: true, clinical: false },
  { key: 'report', label: '사고 보고', icon: '🚨', review: false, clinical: false },
] as const;

export type SafetyTabKey = (typeof SAFETY_TABS)[number]['key'];
export type SafetyTab = (typeof SAFETY_TABS)[number];

/** 이 사용자에게 보일 탭 — 부를 수 없는 EP 를 부르는 탭은 애초에 렌더하지 않는다 */
export function visibleSafetyTabs(v: SafetyViewer): SafetyTab[] {
  const review = canReviewSafety(v);
  const readBack = canConfirmReadBack(v.role);
  return SAFETY_TABS.filter((t) => (review || !t.review) && (!t.clinical || readBack));
}

/** 접힌 탭 라벨 — "없는 것"이 아니라 "안 보이는 것"이라고 말하기 위해 */
export function hiddenSafetyTabLabels(v: SafetyViewer): string[] {
  const visible = new Set(visibleSafetyTabs(v).map((t) => t.key as string));
  return SAFETY_TABS.filter((t) => !visible.has(t.key)).map((t) => t.label);
}
