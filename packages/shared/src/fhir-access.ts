import { EVERY_STAFF_ROLE } from './constants';

/**
 * FHIR 접근 역할 정본 — **직원 JWT 로 `/fhir/R4/*` 를 부를 수 있는 역할**.
 *
 * 🔴 발단(2026-08-27 운영 실측): FHIR 컨트롤러는 `FhirDualAuthGuard`(SMART 토큰 + 직원 JWT 겸용)만
 *    쓰고 **`RolesGuard` 가 없었다.** 그래서 급양·원무·의무기록 계정으로도
 *    `GET /fhir/R4/Patient` 가 **200 · total 873** 을 돌려줬다 —
 *    엔트리에 **성명·MRN·생년월일·성별·전화·주소**가 담긴다. 그리고 그 열람은 **감사에도 남지 않았다.**
 *
 * 규칙
 *  - **SMART 토큰 경로는 이 목록과 무관하다.** SMART 은 자기 scope·환자 컨텍스트로 이미 판정된다
 *    (좁히려다 외부 연동을 끊지 않는다 — 이 목록은 **직원 JWT 경로에만** 적용된다).
 *  - 기본값은 **차트 임상정보를 보는 3역할 + ADMIN**. 운영에서 역할을 더 열어야 하면
 *    설정 `security.fhir.staffRoles` 에 추가한다(관리 → 시스템 설정).
 *  - 🔴 **2026-08-27 사람 결정 — `LAB_TECH` 를 기본값에서 뺀다.**
 *    2026-08-27 오전 이 목록을 처음 만들 때 `LAB_TECH` 를 넣었는데, 같은 날 오후 화면 쪽 정본
 *    `CHART_CLINICAL_ROLES`(차트 요약 임상필드)에는 **넣지 않았다** — 같은 사람이 같은 날 만든
 *    **비대칭**이었다. 그 결과 검사기사는 **화면에서 못 보는 임상정보를 API 로는 전건 조회**할 수
 *    있었다(§5 "EP 를 여는 것이 항상 답은 아니다" · "권한 역전은 뒤집힌 채 오래 산다").
 *    LIS 연동은 **SMART OAuth 경로**라 이 변경과 무관하다(끊기지 않는다).
 *    검사기사가 FHIR 를 실제로 써야 하는 업무가 확인되면 **설정으로 다시 연다** — 되돌리기 쉬운
 *    방향으로 좁혔다(넓히는 방향은 되돌리기 어렵다).
 *  - 🔴 **설정을 못 읽으면 기본값으로 좁힌다 — 조용히 넓히지 않는다.**
 *  - 🔴 알 수 없는 역할 문자열은 **버린다**(오타로 권한이 생기지 않는다).
 *    전부 버려져 빈 목록이 되면 기본값으로 돌아간다(잠금 방지).
 */
export const FHIR_STAFF_ROLES_CONFIG_KEY = 'security.fhir.staffRoles';

/**
 * 기본 허용 — 차트 임상정보를 보는 3역할 + ADMIN.
 * 🔴 화면 정본 `CHART_CLINICAL_ROLES` 와 **같은 임상 역할 집합**을 쓴다(둘이 갈라지면 화면이
 *    막은 것을 API 가 내준다). `MEDICAL_RECORDS` 는 차트 열람은 되지만 FHIR 전건 조회는
 *    별개 판단이라 여기 넣지 않는다 — 필요하면 설정으로 연다.
 */
export const FHIR_STAFF_ROLES_DEFAULT = ['DOCTOR', 'NURSE', 'PHARMACIST', 'ADMIN'] as const;

/**
 * 설정값(배열·쉼표 문자열 모두 허용)을 정규화한다.
 * - 알 수 없는 역할은 버리고 `dropped` 로 돌려준다(화면이 "무시됐다"고 말할 수 있게).
 * - 결과가 비면 기본값(`usedDefault: true`).
 */
export function parseFhirStaffRoles(raw: unknown): {
  roles: string[];
  dropped: string[];
  usedDefault: boolean;
} {
  const known = new Set<string>(EVERY_STAFF_ROLE as readonly string[]);
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  const seen = new Set<string>();
  const roles: string[] = [];
  const dropped: string[] = [];
  for (const v of list) {
    const r = String(v ?? '').trim().toUpperCase();
    if (!r) continue;
    if (!known.has(r)) {
      dropped.push(r);
      continue;
    }
    if (!seen.has(r)) {
      seen.add(r);
      roles.push(r);
    }
  }
  if (roles.length === 0) return { roles: [...FHIR_STAFF_ROLES_DEFAULT], dropped, usedDefault: true };
  return { roles, dropped, usedDefault: false };
}

/** 직원 JWT 로 FHIR 를 부를 수 있는가 — `roles` 는 `parseFhirStaffRoles().roles` */
export function canAccessFhirAsStaff(role: string | null | undefined, roles: readonly string[]): boolean {
  return !!role && roles.includes(role);
}
