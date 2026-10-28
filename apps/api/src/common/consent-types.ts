/**
 * 의사 확약(전자결재) 필요 동의서 종류 — 코드 기본(폴백 정본).
 * 개정 표면 = config `consent.doctorSignRequiredTypes`(§7 P2).
 * ⚠️ `sign.highRiskConsentTypes`(PASS 재인증 3종)와는 **다른 정책**이다 — 종전엔 ess·품질지표가
 *    5종을 하드코딩하고 sign 은 3종이라 갈라져 있었음(2026-08-04 실측). 두 정책을 명시적으로 분리.
 */
export const DOCTOR_SIGN_REQUIRED_CONSENT_TYPES = ['SURGERY', 'ANESTHESIA', 'PROCEDURE', 'RESEARCH', 'DNR'];
