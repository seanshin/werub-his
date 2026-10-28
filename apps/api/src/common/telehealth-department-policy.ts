/**
 * 비대면(원격) 진료 가능 진료과 정책 — **정본 하나**.
 *
 * 🔴 `enabled: null` 은 **미설정 = 전체 허용**이다. 빈 배열 `[]` 은 정반대(아무 과도 불가)이므로
 *    두 값을 같은 것으로 다루면 안 된다. 관리자 설정 화면(`/remote-consult` → 비대면 가능 진료과)이
 *    "제한 없음"이라고 말할 근거는 이 함수 하나여야 한다 — 화면이 숫자를 지어내면 안 된다.
 *
 * 🔴 이 정책은 비대면 예약을 만드는 경로 **전부**가 읽어야 한다. 한 경로만 읽으면
 *    설정 화면의 "선택한 진료과만 비대면 진료가 가능합니다"가 곧바로 거짓말이 된다.
 *      · remote-consultation(비대면 상담) `createConsultation`
 *      · telehealth(원격진료 세션) `createSession` — 원내 예약 화면
 *      · portal `telehealth-book` / `telehealth-departments` — 환자 포털 예약
 */

export const TELEHEALTH_DEPARTMENT_CONFIG_KEY = 'remote-consult.departments';

export interface TelehealthDepartmentPolicy {
  /** null = 미설정(전체 허용) · 배열 = 그 진료과만 허용 */
  enabled: string[] | null;
  infectiousMode: boolean;
}

/** SystemConfig 한 건만 읽으면 되므로 PrismaService 전체를 요구하지 않는다(테스트 용이) */
type SystemConfigReader = {
  systemConfig: {
    findUnique(args: { where: { key: string } }): Promise<{ value: unknown } | null>;
  };
};

export async function getTelehealthDepartmentPolicy(
  prisma: SystemConfigReader,
): Promise<TelehealthDepartmentPolicy> {
  const cfg = await prisma.systemConfig.findUnique({ where: { key: TELEHEALTH_DEPARTMENT_CONFIG_KEY } });
  const v = (cfg?.value ?? undefined) as { enabled?: string[] | null; infectiousMode?: boolean } | undefined;
  return {
    // undefined(키 없음)와 null(명시적 미설정) 둘 다 '전체 허용'. 빈 배열은 그대로 둔다.
    enabled: v?.enabled ?? null,
    infectiousMode: v?.infectiousMode ?? false,
  };
}

/**
 * 해당 진료과가 비대면 예약 가능한가.
 * · 미설정(enabled=null) → 전체 허용
 * · 진료과 미상(null/공백) → **막지 않는다.** 모르는 것을 근거로 거절하지 않는다(기존 게이트와 동일 의미).
 */
export function isTelehealthDepartmentEligible(
  policy: TelehealthDepartmentPolicy,
  department: string | null | undefined,
): boolean {
  if (!policy.enabled) return true;
  if (!department) return true;
  return policy.enabled.includes(department);
}

/** 예약 화면에 내려보낼 진료과 목록을 정책으로 좁힌다(미설정이면 원본 그대로) */
export function filterTelehealthDepartments(
  policy: TelehealthDepartmentPolicy,
  departments: string[],
): string[] {
  if (!policy.enabled) return departments;
  const allow = new Set(policy.enabled);
  return departments.filter((d) => allow.has(d));
}
