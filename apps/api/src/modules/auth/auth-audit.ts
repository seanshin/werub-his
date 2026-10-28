/**
 * 직원 접속기록(로그인·로그아웃) 감사 정본 — 의료법 §23④ / 전자의무기록 관리·보존 기준.
 *
 * 🔴 2026-08-18 실측: 이 파일이 생기기 전까지 **직원 로그인·로그아웃은 한 건도 기록되지 않았다.**
 *    `audit-routes.ts` 의 AUDIT_EXEMPT 가 `/api/v1/auth/(login|refresh|logout)` 을 면제하면서
 *    사유를 "세션 감사는 auth 모듈 자체 기록"이라 적어 두었으나, auth 모듈에 감사 호출이 0건이었다.
 *    (면제 사유가 사실이 아니었다 — 면제는 근거를 남기지만, 그 근거도 점검 대상이다.)
 *    운영 실측: AuditLog 의 'LOGIN' 은 **포털(환자)만** 기록 중이었다(portal.service).
 *
 * 표현 규약 — AuditAction enum 은 CREATE/READ/UPDATE/DELETE 4종뿐이라 '로그인'이라는 동작을
 * action 으로 표현할 수 없다. 그래서 **resourceType 으로 사건을 구분**한다(PrintAttempt 선례와 동일):
 *   - `AuthSession` + CREATE  = 로그인 성공(세션 발급)
 *   - `AuthSession` + DELETE  = 로그아웃(세션 종료)
 *   - `AuthLoginFailure` + CREATE = 로그인 실패
 * 🔴 성공과 실패를 같은 resourceType 으로 묶지 않는다 — 감사 화면(`/admin/audit`)은 `changes` 를
 *    렌더하지 않으므로, 한 벌로 묶으면 실패가 화면에서 성공처럼 보인다.
 *
 * 🔴 알려진 한계(정직하게 남긴다) — `AuditLog.userId` 는 User FK(NOT NULL)다.
 *    **존재하지 않는 계정으로의 로그인 시도는 이 원장에 담을 수 없다.**(주체가 없다)
 *    그 경우는 서버 로거로만 남고, 별도 테이블은 스키마 제안 목록에 있다(사람 승인 필요).
 *    실패 카운터(Redis `login:fail:*`)는 종전대로 잠금에만 쓰인다 — 원장이 아니다.
 */

/** 로그인 성공·로그아웃 — 세션 생명주기 */
export const AUTH_AUDIT_RESOURCE = 'AuthSession';

/** 로그인 실패 — 주체가 식별되는 경우에만(존재하는 계정) */
export const AUTH_FAILURE_AUDIT_RESOURCE = 'AuthLoginFailure';

/**
 * 인증 경로. 🔴 모르면 안전측으로 접는다 — 호출부가 넘기지 않으면 'UNSPECIFIED' 로 **기록은 남긴다**
 * (경로를 모른다고 접속 사실 자체를 버리지 않는다).
 */
export type AuthMethod =
  | 'PASSWORD'
  | 'PASSKEY'
  | 'RECOVERY'
  | 'SSO'
  | 'REFRESH_MIGRATE'
  | 'UNSPECIFIED';

/** 로그인 실패 사유 — 화면·통계에서 브루트포스와 오타를 구분하기 위한 어휘 */
export type AuthFailureReason =
  | 'BAD_PASSWORD'
  | 'INACTIVE'
  | 'LOCKED'
  | 'TOKEN_REUSE';

export interface AuthContext {
  method?: AuthMethod;
  ipAddress?: string;
  userAgent?: string;
}

/** 요청에서 클라이언트 IP·UA 추출 — 프록시 뒤(nginx)라 x-forwarded-for 우선(기존 포털 규약과 동일) */
export function authContextFromRequest(
  req: { headers?: Record<string, unknown>; ip?: string },
  method: AuthMethod = 'UNSPECIFIED',
): AuthContext {
  const xff = req?.headers?.['x-forwarded-for'];
  const ipAddress = (typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined) || req?.ip;
  const ua = req?.headers?.['user-agent'];
  return {
    method,
    ipAddress: ipAddress ?? undefined,
    userAgent: typeof ua === 'string' ? ua.slice(0, 500) : undefined,
  };
}
