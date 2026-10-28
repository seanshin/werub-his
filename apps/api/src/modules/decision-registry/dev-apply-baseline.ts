/**
 * 개발 반영 결정 중 **이미 코드가 특정 선택대로 동작하는 것**(판정표 "🔴 시드대로 구현됨") — 2026-10-12 기획 P2.
 *
 * 정본 판정표: `docs/05-reference/decision-dev-apply-baseline.md`(가드 `dev-apply-baseline.spec.ts` 가 이 표와 양방향 대조).
 *  · 실결정이 이 선택과 **다르면** 실결정 기록 순간 원장에 "되돌림 필요"(DEV_REVERT_NEEDED)가 남는다
 *  · 같으면 화면이 "코드가 이미 이 선택대로 동작(판정표)"을 말하고, 반영 확인은 사람이 근거와 함께 남긴다
 */
export const DEV_APPLY_IMPLEMENTED: Readonly<Record<string, string>> = {
  'journey.outpatientEnd': 'BILLING_PAID',
  'emergency.departureTimeSource': 'DEPARTED_AT_FIELD',
  'qi.measurementSource': 'ADD_SOURCE_COLUMN',
  'policy.db.unappliedIndexes': 'ABSORB_SCHEMA',
  'wayfinding.patientExposure': 'QR_GUIDE_MASK_RESTRICTED',
  'auth.staffIdleTimeout': 'ENFORCE_ALL',
  // 2026-10-20 사용자 지시(포털 세련화 P3 · 배치 10-J)
  'portal.visitSummaryScope': 'GENERAL',
  'portal.patientReportedVitals': 'REFERENCE_ONLY',
  'portal.costEstimate': 'SHOW_AS_ESTIMATE',
  'portal.labResultRelease': 'VALUES_NOW_JUDGMENT_AFTER_REVIEW',
  // 2026-10-20 환자 목록 세련화 P0(v4.102.0)로 구현 · 배치 10-K
  'patient.contactSearch': 'CONTACT_ROLE_ONLY',
  'access.roleDataAccess.scope': 'LIST_ONLY',
  // 2026-10-21 임상 규칙·템플릿 P1·P2(v4.110.0·v4.111.0)로 구현 · 배치 10-L
  'catalog.activeEdit': 'NEW_VERSION',
  'cdss.legacyRules': 'KEEP_READONLY',
};
