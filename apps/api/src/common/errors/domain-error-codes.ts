/**
 * 도메인별 커스텀 에러코드 — EMR/HIS 전용
 *
 * 네이밍 규칙: {DOMAIN}_{ERROR_TYPE}
 * HTTP 상태코드와 독립적으로 도메인 에러를 식별
 */

// ─── 환자 ───────────────────────────────────────
export const PATIENT_NOT_FOUND = 'PATIENT_NOT_FOUND';
export const PATIENT_DUPLICATE_MRN = 'PATIENT_DUPLICATE_MRN';
export const PATIENT_INACTIVE = 'PATIENT_INACTIVE';

// ─── 진료 ───────────────────────────────────────
export const ENCOUNTER_NOT_FOUND = 'ENCOUNTER_NOT_FOUND';
export const ENCOUNTER_ALREADY_CLOSED = 'ENCOUNTER_ALREADY_CLOSED';
export const ENCOUNTER_NOT_CHECKED_IN = 'ENCOUNTER_NOT_CHECKED_IN';

// ─── 처방 ───────────────────────────────────────
export const PRESCRIPTION_NOT_FOUND = 'PRESCRIPTION_NOT_FOUND';
export const PRESCRIPTION_ALREADY_DISPENSED = 'PRESCRIPTION_ALREADY_DISPENSED';
export const PRESCRIPTION_DUR_CONFLICT = 'PRESCRIPTION_DUR_CONFLICT';

// ─── 수납 ───────────────────────────────────────
export const BILLING_NOT_FOUND = 'BILLING_NOT_FOUND';
export const BILLING_ALREADY_PAID = 'BILLING_ALREADY_PAID';
export const BILLING_ALREADY_CANCELLED = 'BILLING_ALREADY_CANCELLED';
export const BILLING_REFUND_EXCEEDS = 'BILLING_REFUND_EXCEEDS';
export const BILLING_INVALID_STATUS = 'BILLING_INVALID_STATUS';
export const BILLING_PAYMENT_INVALID = 'BILLING_PAYMENT_INVALID';

// ─── 청구 ───────────────────────────────────────
export const CLAIM_NOT_FOUND = 'CLAIM_NOT_FOUND';
export const CLAIM_ALREADY_SUBMITTED = 'CLAIM_ALREADY_SUBMITTED';
export const CLAIM_APPEAL_NOT_ALLOWED = 'CLAIM_APPEAL_NOT_ALLOWED';

// ─── 동의서 ─────────────────────────────────────
export const CONSENT_NOT_FOUND = 'CONSENT_NOT_FOUND';
export const CONSENT_ALREADY_SIGNED = 'CONSENT_ALREADY_SIGNED';
export const CONSENT_EXPIRED = 'CONSENT_EXPIRED';

// ─── 알레르기 ───────────────────────────────────
export const ALLERGY_NOT_FOUND = 'ALLERGY_NOT_FOUND';
export const ALLERGY_DUPLICATE = 'ALLERGY_DUPLICATE';

// ─── 간호 ───────────────────────────────────────
export const MAR_NOT_FOUND = 'MAR_NOT_FOUND';
export const MAR_INVALID_STATUS = 'MAR_INVALID_STATUS';
export const MAR_ALREADY_ADMINISTERED = 'MAR_ALREADY_ADMINISTERED';
export const NURSING_NOTE_NOT_FOUND = 'NURSING_NOTE_NOT_FOUND';

// ─── 입원 ───────────────────────────────────────
export const ADMISSION_NOT_FOUND = 'ADMISSION_NOT_FOUND';
export const ADMISSION_BED_OCCUPIED = 'ADMISSION_BED_OCCUPIED';
export const ADMISSION_ALREADY_DISCHARGED = 'ADMISSION_ALREADY_DISCHARGED';

// ─── 인증/보안 ──────────────────────────────────
export const AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS';
export const AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED';
export const AUTH_INSUFFICIENT_ROLE = 'AUTH_INSUFFICIENT_ROLE';
export const AUTH_BTG_REQUIRED = 'AUTH_BTG_REQUIRED';

// ─── AI 컨시어지 ────────────────────────────────
export const CONCIERGE_SESSION_NOT_FOUND = 'CONCIERGE_SESSION_NOT_FOUND';
export const CONCIERGE_SESSION_CLOSED = 'CONCIERGE_SESSION_CLOSED';
export const CONCIERGE_PATIENT_AUTH_FAILED = 'CONCIERGE_PATIENT_AUTH_FAILED';

// ─── 검사 ───────────────────────────────────────
export const LAB_ORDER_NOT_FOUND = 'LAB_ORDER_NOT_FOUND';
export const LAB_RESULT_NOT_FOUND = 'LAB_RESULT_NOT_FOUND';
export const LAB_SPECIMEN_INVALID = 'LAB_SPECIMEN_INVALID';

// ─── 기초검사 상태 전이 ─────────────────────────
export const DIAGNOSTIC_TRANSITION_NOT_ALLOWED = 'DIAGNOSTIC_TRANSITION_NOT_ALLOWED';
export const DIAGNOSTIC_TRANSITION_REASON_REQUIRED = 'DIAGNOSTIC_TRANSITION_REASON_REQUIRED';
/** 결과가 기록된 검사 취소 — acknowledgeResult 로 확인받아야 한다(409) */
export const DIAGNOSTIC_HAS_RESULT = 'DIAGNOSTIC_HAS_RESULT';

// ─── 문진표 검토 ─────────────────────────
/** 제출되지 않은(발송·열람·작성중·만료) 문진표는 '검토됨'으로 표시하지 않는다(409) */
export const QUESTIONNAIRE_NOT_SUBMITTED = 'QUESTIONNAIRE_NOT_SUBMITTED';

// ─── 상담 부서 이관·빠른답변 템플릿 ─────────────────────────
export const CONSULT_ROUTE_TEAM_INVALID = 'CONSULT_ROUTE_TEAM_INVALID';
export const CONSULT_TEMPLATE_SCOPE = 'CONSULT_TEMPLATE_SCOPE';

// ─── CSSD 기구 개체 ─────────────────────────────
/** 재포장에 넣은 개체 번호가 등록돼 있지 않다(details.missing) */
export const CSSD_UNIT_NOT_REGISTERED = 'CSSD_UNIT_NOT_REGISTERED';
/** 폐기된 개체를 패키지에 넣으려 했다(details.retired) */
export const CSSD_UNIT_RETIRED = 'CSSD_UNIT_RETIRED';

// ─── 본인 비밀번호 변경(400 — 입력 문제는 401 이 아니다) ─────────────
export const PASSWORD_CURRENT_MISMATCH = 'PASSWORD_CURRENT_MISMATCH';
export const PASSWORD_POLICY_VIOLATION = 'PASSWORD_POLICY_VIOLATION';
