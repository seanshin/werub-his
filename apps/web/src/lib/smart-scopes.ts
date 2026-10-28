/**
 * SMART 클라이언트 발급 화면(/admin/smart-clients)의 스코프 선택지.
 *
 * 🔴 r3 B8 (2026-09-28): 종전 선택지 10개 중 8개가 비표준 표기(`encounter/*.read`·`medicationrequest/*.read` 등)라
 *    서버 `SmartAuthService.hasScope` 의 패턴(`<patient|user|system>/<Resource|*>.<read|write|*>`)과 절대 일치하지 않았다 —
 *    관리자가 체크해 저장해도 **아무 권한도 주지 않았다**(P1: 화면이 준다고 말하고 아무것도 안 준다).
 *    여기서는 **기존 선택지의 의미만** 표준 표기로 옮긴다(`encounter/*.read` → `patient/Encounter.read`).
 *    어느 스코프를 기관에 열지는 사람 결정(H4)이라 선택지를 늘리지 않는다 — `system/*` 은 추가하지 않는다.
 *
 * ⚠️ `patient/Encounter.write` 는 표기는 유효하지만 이를 요구하는 FHIR 쓰기 핸들러가 현재 없다(종전 `encounter/*.write` 의 의미 보존).
 */
export const SMART_SCOPE_OPTIONS = [
  'patient/*.read',
  'patient/*.write',
  'patient/Encounter.read',
  'patient/Encounter.write',
  'patient/Observation.read',
  'patient/MedicationRequest.read',
  'patient/Condition.read',
  'patient/AllergyIntolerance.read',
  'patient/Immunization.read',
  'patient/Procedure.read',
] as const;

/** 서버 `hasScope` 가 인정하는 리소스 스코프 문법(표기 검증용). */
export const SMART_RESOURCE_SCOPE_RE = /^(patient|user|system)\/(\*|[A-Z][A-Za-z]+)\.(read|write|\*)$/;
