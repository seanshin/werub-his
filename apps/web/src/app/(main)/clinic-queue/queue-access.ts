/**
 * `/clinic-queue` 큐 조회 역할 게이트 정본 (2026-08-27 · 전역 역할 프로브 회수)
 *
 * ── 실측 ────────────────────────────────────────────────────────────────────
 * nav 는 `/clinic-queue` 를 ADMIN·DOCTOR·NURSE·RECEPTIONIST 에게 연다.
 * 그런데 화면(본문 부서 탭 + 초광폭 참조 레일)은 **역할과 무관하게** 부서 큐 3종과
 * `queue/my` 를 호출했다 → RECEPTIONIST 4/7 · NURSE 2/7 · DOCTOR 1/7 이 403.
 *
 *   · `GET /api/v1/lab/queue`       @Roles(LAB_TECH, ADMIN, DOCTOR, NURSE)
 *   · `GET /api/v1/imaging/queue`   @Roles(ADMIN, LAB_TECH, DOCTOR)
 *   · `GET /api/v1/pharmacy/queue`  @Roles(PHARMACIST, ADMIN)
 *   · `GET /api/v1/queue/my`        @Roles(DOCTOR, NURSE, ADMIN)
 *   · `GET /api/v1/queue`           @Roles(ADMIN, DOCTOR, NURSE, RECEPTIONIST) — 2026-09-16 E3 봉합
 *     (종전 '역할 게이트 없음(전 직원)' — 대기열은 환자 식별이 실린다. 이 화면의 nav 역할과 같은 집합이다)
 *
 * 🔴 **EP 를 여는 것이 답이 아니다** — 약국 조제 큐는 약사 업무 화면이다. 화면이
 *    자기 역할이 받을 수 있는 큐만 부르고, 못 부르는 것은 **접었다고 말한다**.
 * 🔴 조회를 아예 하지 않는다(`enabled:false`). `queryFn` 안에서 `.catch(()=>[])` 로
 *    삼키면 `isError` 가 영원히 false 가 되어 오류 폴백이 도달 불가 코드가 된다.
 *
 * 🔴 아래 목록은 손으로 적은 사본이다 — `test/architecture/screen-role-gate-canon.spec.ts`
 *    가 각 컨트롤러의 실제 `@Roles` 와 **기계로 대조**한다(한쪽만 바뀌면 실패).
 */

/** ADMIN 은 `RolesGuard` 에서 역할 검사를 통과한다(권한 게이트는 별도) */
const ADMIN = 'ADMIN';

export type DeptQueueKey = 'lab' | 'imaging' | 'pharmacy';

export interface DeptQueueDef {
  key: DeptQueueKey;
  label: string;
  icon: string;
  api: string;
  /** 이 EP 의 서버 `@Roles` 사본 */
  roles: readonly string[];
  /** 접혔을 때 사람에게 할 말 */
  whose: string;
}

export const DEPT_QUEUES: readonly DeptQueueDef[] = [
  { key: 'lab', label: '검사실', icon: '🧪', api: '/api/v1/lab/queue', roles: ['LAB_TECH', ADMIN, 'DOCTOR', 'NURSE'], whose: '검사실 담당' },
  { key: 'imaging', label: '영상실', icon: '🩻', api: '/api/v1/imaging/queue', roles: [ADMIN, 'LAB_TECH', 'DOCTOR'], whose: '영상실 담당' },
  { key: 'pharmacy', label: '약국', icon: '💊', api: '/api/v1/pharmacy/queue', roles: ['PHARMACIST', ADMIN], whose: '약국 담당' },
] as const;

/** `GET /api/v1/queue/my` — 내 환자 대기열 */
export const MY_QUEUE_ROLES = ['DOCTOR', 'NURSE', ADMIN] as const;

export const canFetchDeptQueue = (role: string | null | undefined, key: DeptQueueKey): boolean => {
  const def = DEPT_QUEUES.find((d) => d.key === key);
  return !!role && !!def && def.roles.includes(role);
};

export const canFetchMyQueue = (role?: string | null): boolean =>
  !!role && (MY_QUEUE_ROLES as readonly string[]).includes(role);

/** 이 역할이 볼 수 있는 부서 큐 */
export const allowedDeptQueues = (role?: string | null): DeptQueueDef[] =>
  DEPT_QUEUES.filter((d) => canFetchDeptQueue(role, d.key));

/** 접힌 부서 큐 — "없는 것"이 아니라 "권한이 없어 안 보이는 것" */
export const blockedDeptQueues = (role?: string | null): DeptQueueDef[] =>
  DEPT_QUEUES.filter((d) => !canFetchDeptQueue(role, d.key));
