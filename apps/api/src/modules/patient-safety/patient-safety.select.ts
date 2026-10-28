import { Prisma } from '@prisma/client';

/**
 * 환자안전사고 응답 노출 위생 — **보고자 신원은 서버 밖으로 나가지 않는다.**
 *
 * 근거: 환자안전법 §16(비밀 유지)·§17(보고자에 대한 불이익 조치 2년 이하 징역,
 *      보고자 정보 누설 3년 이하 징역·3천만원 이하 벌금).
 *
 * 🔴 종전 `getIncidents` 는 `findMany({ where, orderBy })` — `select` 가 **없었다.**
 *    Prisma 는 select 가 없으면 스칼라 전체를 돌려주므로 운영 75건 전부의 `reporter_id`
 *    (실측 31명의 실계정 UUID)가 응답 JSON 에 실려 나갔다. 화면이 그리지 않을 뿐,
 *    브라우저 devtools·프록시 로그·HTTP 캐시에는 그대로 남는다.
 *
 * 🔴 이 저장소엔 **같은 유형의 선례**가 있다 — `include: { patient: true }` 가 암호화 PID 를
 *    통째로 실어나르던 것을 `common/patient-select.ts` 의 `PATIENT_SENSITIVE_OMIT` 정본으로
 *    47건 봉합했다. 그 **패턴**(정본 상수 하나 + 계약 테스트)을 그대로 재사용한다.
 *    상수를 공유하지는 않는다 — 그쪽은 '환자 PID', 이쪽은 '보고자 신원'이라 개념이 다르고,
 *    한 상수에 두 개념을 담으면 한쪽을 고칠 때 다른 쪽이 조용히 따라 바뀐다.
 *
 * 설계서(AgentEMR v0.2 §5.3.7)는 보고자 식별정보를 **파이프라인 진입 전에 분리**하라고 한다.
 * 현재 스키마는 `SafetyIncident.reporterId` 가 **NOT NULL 본체 컬럼**이라 완전 분리(별도 테이블·
 * 익명 보고 토큰)는 스키마 변경 없이는 불가능하다. 스키마 없이 할 수 있는 최대치는
 * **읽기 경로 전량에서 신원을 제거하고, 필요한 판정(내 보고인가)은 서버에서만 하는 것**이다.
 */
export const SAFETY_INCIDENT_PUBLIC_SELECT = {
  id: true,
  patientId: true,
  type: true,
  severity: true,
  description: true,
  location: true,
  occurredAt: true,
  actionTaken: true,
  status: true,
  rcaCompleted: true,
  createdAt: true,
  // QI 흐름(2026-10-08) — 병동·위해 정도·익명 여부·첫 검토·종결 시각(검토자·종결자 id 는 내보내지 않는다)
  wardId: true,
  harmLevel: true,
  anonymous: true,
  reviewedAt: true,
  closedAt: true,
  // 2026-10-09 KOPS 직접 보고 기록(번호·시각 — 기록자 id 는 내보내지 않는다)
  kopsManualRef: true,
  kopsManualAt: true,
  // 🔴 reporterId 없음 — 의도적. 새 필드를 넣을 때 여기 한 줄이 정본이다.
} as const satisfies Prisma.SafetyIncidentSelect;

/**
 * 서버 내부 판정용 — `reporterId` 를 **비교에만** 쓰고 응답에는 넣지 않는다.
 * (호출부는 반드시 `stripReporter()` 로 걷어내고 내보낸다.)
 */
export const SAFETY_INCIDENT_INTERNAL_SELECT = {
  ...SAFETY_INCIDENT_PUBLIC_SELECT,
  reporterId: true,
} as const satisfies Prisma.SafetyIncidentSelect;

/**
 * 내부 조회 결과 → 응답 형태.
 * `reporterId` 를 **불리언 한 개**(`reportedByMe`)로 바꾼다 — 보고자 본인은 자기 보고를 추적할
 * 수 있어야 하고(그게 없으면 보고자는 자기 신고가 어떻게 됐는지 모른다), 그 목적에 ID 는 필요없다.
 */
export function stripReporter<T extends { reporterId?: string | null }>(
  row: T,
  viewerUserId: string | null | undefined,
): Omit<T, 'reporterId'> & { reportedByMe: boolean } {
  const { reporterId, ...rest } = row;
  return { ...rest, reportedByMe: !!viewerUserId && reporterId === viewerUserId };
}
