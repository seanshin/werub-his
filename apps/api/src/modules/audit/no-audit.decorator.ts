import { SetMetadata } from '@nestjs/common';

export const NO_AUDIT_KEY = 'audit:skip';
export const AUDIT_RESOURCE_KEY = 'audit:resourceType';

/**
 * 감사 면제 표시. 변이 라우트는 기본 감사 ON 이므로, 감사 가치가 없는 라우트에만 명시적으로 부착한다.
 * 부착 시 **사유 주석 필수** — 면제 근거는 docs/03-analysis/audit-coverage-audit-2026-07.md 에도 등재.
 */
export const NoAudit = () => SetMetadata(NO_AUDIT_KEY, true);

/** 경로에서 파생되는 기본 리소스명 대신 명시적으로 지정 */
export const AuditResource = (resourceType: string) => SetMetadata(AUDIT_RESOURCE_KEY, resourceType);

export const AI_READ_KEY = 'audit:aiRead';

/**
 * 🔴 환자 지목 **AI 조회**를 열람 감사에 올린다 — 2026-08-20 신설.
 *
 * 왜 필요한가: 이 EP 들은 GET 이지만 **환자 기록을 읽어 프롬프트에 담는 열람 행위**다.
 * 그런데 `PHI_READ_PATTERNS` 는 `/api/v1/lab/results/<uuid>` 는 알아도
 * `/api/v1/lab/orders/<uuid>/ai-interpret` 는 모르고, 쿼리에 `patientId` 도 없어
 * `patientIdFromQuery` 도 null 이었다. 그래서 **개통 이래 한 줄도 남지 않았다**
 * (운영 실측 2026-08-20: `audit_logs` 의 AI 열람은 `AiPatientContext` 91행뿐).
 *
 * 종전 정본이던 `auditAiEgress` 는 `medical-ai.controller` 의 **private 메서드**라
 * 다른 9개 모듈이 쓸 수 없었다 — 정본을 만든 것과 모든 소비처가 그것을 쓰는 것은 다른 일이다.
 *
 * 🔴 환자 귀속에 실패하면 **실패했다고 원장에 적는다**(`patientBound=false`).
 * 모르는 것을 patientId 인 척 넣지 않는다.
 *
 * 전제(2026-08-20 사람 결정): AI 서버는 **원내**(WeRU.B). 이 감사는 국외이전·제3자 제공이
 * 아니라 **접근기록**을 남기기 위한 것이다.
 */
export const AuditAiRead = (resourceType: string) => SetMetadata(AI_READ_KEY, resourceType);
