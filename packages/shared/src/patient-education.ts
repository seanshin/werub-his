/**
 * 환자 교육 기록 어휘 정본 — 기획 `docs/01-plan/features/patient-education-record.plan.md` (2026-09-30).
 *
 * 🔴 배경(실측): 환자 교육은 **흩어진 자유 글**뿐이었다 — 퇴원요약 `patientEducation`·간호기록 DARE 의 E·약국 복약상담·영양상담.
 *    "누가 · 누구에게(환자/보호자) · 무엇을 · 어떻게 · 이해했는가"를 한 곳에서 볼 수 없었고,
 *    퇴원 준비의 "환자 교육 기록"은 요약 글자가 비어 있지 않은지만 셌다.
 *
 * 규칙:
 *   - 주제·대상은 고른다(기타 있음) · 내용은 비어 있으면 안 된다 — 그 밖은 강제하지 않는다(필수로 강제하면 거짓 데이터가 된다).
 *   - 이해도는 **평가한 경우에만** 적는다 — 비어 있으면 "미기록"(이해함으로 두지 않는다).
 *   - 기록은 지우지 않는다 — 잘못 쓴 것은 사유와 함께 **무효 처리**(원장에 남는다).
 *   - 화면·API 가 같은 목록을 쓴다(여기 하나).
 */

export const EDUCATION_TOPICS = [
  'MEDICATION', 'DISEASE', 'TEST_PROCEDURE', 'SURGERY_ANESTHESIA', 'PAIN', 'FALL_PREVENTION', 'INFECTION_PREVENTION',
  'NUTRITION', 'ACTIVITY_REHAB', 'DEVICE_SELFCARE', 'DISCHARGE', 'OTHER',
] as const;
export type EducationTopic = (typeof EDUCATION_TOPICS)[number];
export const EDUCATION_TOPIC_LABEL: Record<EducationTopic, string> = {
  MEDICATION: '투약·복약', DISEASE: '질병·상태', TEST_PROCEDURE: '검사·시술', SURGERY_ANESTHESIA: '수술·마취', PAIN: '통증 관리',
  FALL_PREVENTION: '낙상 예방', INFECTION_PREVENTION: '감염 예방', NUTRITION: '식이·영양', ACTIVITY_REHAB: '활동·재활',
  DEVICE_SELFCARE: '기구·자가관리', DISCHARGE: '퇴원 후 관리', OTHER: '기타',
};

export const EDUCATION_LEARNERS = ['PATIENT', 'GUARDIAN', 'PATIENT_AND_GUARDIAN'] as const;
export type EducationLearner = (typeof EDUCATION_LEARNERS)[number];
export const EDUCATION_LEARNER_LABEL: Record<EducationLearner, string> = {
  PATIENT: '환자', GUARDIAN: '보호자', PATIENT_AND_GUARDIAN: '환자·보호자',
};

export const EDUCATION_METHODS = ['VERBAL', 'PRINTED', 'DEMONSTRATION', 'VIDEO', 'OTHER'] as const;
export type EducationMethod = (typeof EDUCATION_METHODS)[number];
export const EDUCATION_METHOD_LABEL: Record<EducationMethod, string> = {
  VERBAL: '설명', PRINTED: '인쇄물', DEMONSTRATION: '시범·재시범', VIDEO: '영상', OTHER: '기타',
};

/** 이해도 — 평가한 경우에만. null = 미기록(평가 안 함) */
export const EDUCATION_UNDERSTANDING = ['UNDERSTOOD', 'PARTIAL', 'NOT_UNDERSTOOD'] as const;
export type EducationUnderstanding = (typeof EDUCATION_UNDERSTANDING)[number];
export const EDUCATION_UNDERSTANDING_LABEL: Record<EducationUnderstanding, string> = {
  UNDERSTOOD: '이해함', PARTIAL: '부분 이해', NOT_UNDERSTOOD: '이해 못 함',
};

/** 환자 한 명의 교육 보기에 함께 보이는 출처 — 이 원장(RECORD) + 다른 기록에 적힌 교육(읽기 전용) */
export const EDUCATION_SOURCES = ['RECORD', 'PHARMACY_COUNSEL', 'NUTRITION_COUNSEL', 'NURSING_NOTE', 'DISCHARGE_SUMMARY'] as const;
export type EducationSource = (typeof EDUCATION_SOURCES)[number];
export const EDUCATION_SOURCE_LABEL: Record<EducationSource, string> = {
  RECORD: '교육 기록', PHARMACY_COUNSEL: '복약상담(약국)', NUTRITION_COUNSEL: '영양상담', NURSING_NOTE: '간호기록(교육)', DISCHARGE_SUMMARY: '퇴원요약(환자교육)',
};

export const EDUCATION_TEXT_MAX = { content: 4000, short: 200, reason: 500 } as const;
