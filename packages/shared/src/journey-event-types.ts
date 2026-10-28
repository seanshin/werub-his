/**
 * 환자 여정 이벤트 어휘 정본 — `patient_journey_events.event_type` 에 쓰이는 값.
 *
 * 🔴 (2026-09-14) 정본이 셋이었다: 연동 가이드 문서(19종 "미구현" 표)·API 위치 매핑(`journey.service`)·
 *    web 타임라인 아이콘(`JourneyTab TYPE_ICON`). 셋이 서로 다른 이름을 들고 있어
 *    "처방 여정 미발행"(실제로는 리스너 삼항으로 발행 중)·"담당의 변경 미발행"(실제로는 `TRANSFER_CARE`) 같은
 *    거짓 잔여가 문서에 남았다. 이 파일이 하나의 목록이고, 가드(`journey-event-vocabulary.spec.ts`)가
 *    발행 지점 전수와 기계 대조한다 — 여기 없는 이름으로 발행하면 실패, 여기 있는데 발행 0 이면 실패.
 *
 * 🔴 이미 쌓인 이벤트 이름은 **소급 변경하지 않는다**(`voc.*` 소문자 포함). 다른 이름은 읽는 쪽이 매핑한다.
 * 🔴 여정 이벤트는 **환자 포털 타임라인에 그대로 나간다**(`portal.service getJourneyTimeline` — 유형 필터 없음).
 *    새 유형을 넣기 전에 환자에게 보여도 되는 문장인지 먼저 본다.
 */
export const JOURNEY_EVENT_TYPES = [
  // 외래
  'RECEPTION_CHECKIN', 'RECEPTION_CALLED', 'ENCOUNTER_START', 'ENCOUNTER_SIGNED', 'ENCOUNTER_AMENDED',
  'APPOINTMENT_BOOKED',
  // 오더·결과·조제
  'PRESCRIPTION_ADDED', 'ORDER_CREATED', 'ORDER_COMPLETED', 'LAB_RESULT', 'IMAGING_RESULT', 'DISPENSED',
  'MEDICATION_ADMINISTERED', 'TRANSFUSION_COMPLETED', 'CANCER_REGISTRY_CANDIDATE', 'MDT_DECISION', 'PROTOCOL_STEP',
  // 수납·청구
  'BILLING_CREATED', 'BILLING_PAID', 'BILLING_AMEND_REVIEW', 'BILLING_CREATE_FAILED', 'CLAIM_REVIEW',
  // 응급
  'ER_ARRIVAL', 'ER_TRIAGE', 'ER_TREATMENT_START', 'ER_DISPOSITION', 'ER_CHECKOUT', 'ER_BILLING_FAILED',
  'ER_BED_ASSIGNED', 'ER_BED_MOVED', 'ER_BED_RELEASED', 'GOLDEN_PATHWAY_ACTIVATED',
  // 입원·수술
  'ADMISSION', 'ADMISSION_CANCELLED', 'BED_TRANSFER', 'TRANSFER_CARE', 'DISCHARGE',
  'SURGERY_START', 'SURGERY_COMPLETE', 'PACU_ADMISSION', 'PACU_DISCHARGE', 'NEWBORN_CRITICAL',
  // 동의서
  'CONSENT_REQUESTED', 'CONSENT_SIGNED', 'CONSENT_COMPLETED', 'CONSENT_REVOKED',
  // 검진·만성·기타
  'CHECKUP_RESERVED', 'CHECKUP_CHECKIN', 'CHECKUP_STATION_ARRIVE', 'CHECKUP_STATION_COMPLETE',
  'CHECKUP_CRITICAL', 'CHECKUP_COMPLETE', 'CHECKUP_CANCELLED', 'CHRONIC_ALERT', 'CSSD_RECALL',
  'voc.received', 'voc.answered', 'voc.closed',
  // 환자 메시지(2026-09-14 A1) · 진단검사 상태 전이(2026-09-14 A5)
  'PATIENT_MESSAGE_SENT', 'PATIENT_MESSAGE_REPLIED',
  'DIAGNOSTIC_CANCELLED', 'DIAGNOSTIC_ON_HOLD', 'DIAGNOSTIC_RESUMED',
] as const;

export type JourneyEventType = (typeof JOURNEY_EVENT_TYPES)[number];

/**
 * 가이드 문서·화면에 이름은 있으나 **발행하지 않는** 유형과 그 사유 — 목록 동결(가드).
 * "구현 안 됨"과 "하지 않기로 한 것·다른 이름으로 이미 하는 것"을 가르기 위한 목록이다.
 */
export const JOURNEY_EVENT_NOT_EMITTED: Readonly<Record<string, string>> = {
  ATTENDING_CHANGE: '다른 이름으로 발행 중 — 담당의 변경(전과)은 `TRANSFER_CARE`(admission.service). 읽는 쪽은 JOURNEY_EVENT_ALIASES 로 매핑',
  FOLLOWUP_SCHEDULED: '다른 이름으로 발행 중 — 예약 생성은 `APPOINTMENT_BOOKED`(schedule.service)',
  ROUND: '도메인 행위 없음 — 회진 기록 모델·EP 가 없다(시뮬레이터만 이 이름을 쓴다)',
  HANDOFF: '직원 내부 인계 — 여정은 환자 포털에 노출되므로 발행하지 않는다',
  ALERT: '일반형 이름 대신 특화 이름으로 발행 중 — CHRONIC_ALERT·CHECKUP_CRITICAL·NEWBORN_CRITICAL',
  NURSING_ASSESSMENT: '🔴 사람 결정 필요 — 근무조마다 생기는 직원 기록이고 여정은 환자 포털에 무필터로 나간다(노출 범위 결정 전 발행 안 함)',
  FALL_RISK_ASSESSED: '🔴 사람 결정 필요 — 위험 평가 점수가 환자 포털 타임라인에 그대로 나간다(노출 범위 결정 전 발행 안 함)',
  SAFETY_INCIDENT: '🔴 사람 결정 필요 — 환자안전 보고는 보고자 보호(환자안전법 §17) 대상이고 여정은 환자 포털에 노출된다',
  INFECTION_DETECTED: '🔴 사람 결정 필요 — 감염 감시 등록이 환자 포털 타임라인에 그대로 나간다(노출·문구 결정 전 발행 안 함)',
  MEAL_ORDER: '끼니 단위 급식 주문(mealOrder)은 하루 여러 건이라 타임라인을 덮는다 — 식이 처방(dietOrder) 단위 표기는 이름·노출 결정 필요',
};

/** 다른 이름으로 이미 발행 중인 유형 — 읽는 쪽(아이콘·필터) 매핑. 저장된 이름은 바꾸지 않는다. */
export const JOURNEY_EVENT_ALIASES: Readonly<Record<string, JourneyEventType>> = {
  ATTENDING_CHANGE: 'TRANSFER_CARE',
  FOLLOWUP_SCHEDULED: 'APPOINTMENT_BOOKED',
};

export function isJourneyEventType(v: unknown): v is JourneyEventType {
  return typeof v === 'string' && (JOURNEY_EVENT_TYPES as readonly string[]).includes(v);
}

/**
 * 🔴 (2026-09-14) 환자 포털 타임라인에서 **숨기는** 유형과 사유 — `portal.service getJourneyTimeline` 이 유형 필터 없이
 *    암등록 후보·청구 심사·청구 생성 실패(설명에 내부 오류 메시지)까지 환자에게 돌려줬다.
 * 판정은 **fail-closed**: 어휘에 없는 이름(옛 이름·오타·새 유형)은 숨긴다 — 새 유형은 환자에게 보여도 되는지 정한 뒤 여기서 뺀다.
 * 위급 경보 3종은 `policy.criticalValue.patientNotify`(현행 WITHHOLD — 환자 알림 보류·결과 직접 조회는 가능)와 맞춘다.
 */
export const JOURNEY_EVENT_PATIENT_HIDDEN: Readonly<Partial<Record<JourneyEventType, string>>> = {
  CANCER_REGISTRY_CANDIDATE: '직원 내부 — 암등록 후보 선별(확진·통보 전)',
  MDT_DECISION: '직원 내부 — 다학제 회의 결정(설명·통보는 진료 경로로)',
  PROTOCOL_STEP: '직원 내부 — 임상 프로토콜 단계 진행',
  BILLING_AMEND_REVIEW: '직원 내부 — 청구 정정 심사',
  BILLING_CREATE_FAILED: '직원 내부 — 청구 생성 실패(설명에 내부 오류 메시지)',
  CLAIM_REVIEW: '직원 내부 — 보험 청구 심사',
  ER_BILLING_FAILED: '직원 내부 — 응급 청구 실패',
  GOLDEN_PATHWAY_ACTIVATED: '직원 내부 — 중증 경로 활성화 운영 신호',
  CSSD_RECALL: '직원 내부 — 멸균 기구 회수 추적(환자 통보는 별도 절차)',
  ER_BED_ASSIGNED: '직원 내부 — 응급 병상 배정 운영',
  ER_BED_MOVED: '직원 내부 — 응급 병상 이동 운영',
  ER_BED_RELEASED: '직원 내부 — 응급 병상 해제 운영',
  CHRONIC_ALERT: '위급·경보 — policy.criticalValue.patientNotify 현행 WITHHOLD 와 맞춤',
  CHECKUP_CRITICAL: '위급·경보 — policy.criticalValue.patientNotify 현행 WITHHOLD 와 맞춤',
  NEWBORN_CRITICAL: '위급·경보 — policy.criticalValue.patientNotify 현행 WITHHOLD 와 맞춤',
  DIAGNOSTIC_CANCELLED: '직원 내부 — 취소 사유는 직원이 쓴 문장이라 환자용 설명이 아니다(환자 안내 문구·노출은 사람 결정)',
  DIAGNOSTIC_ON_HOLD: '직원 내부 — 보류 사유는 직원이 쓴 문장이라 환자용 설명이 아니다(환자 안내 문구·노출은 사람 결정)',
  DIAGNOSTIC_RESUMED: '직원 내부 — 보류 해제 운영 신호',
};

export const PATIENT_VISIBLE_JOURNEY_EVENT_TYPES: readonly JourneyEventType[] =
  JOURNEY_EVENT_TYPES.filter((t) => !(t in JOURNEY_EVENT_PATIENT_HIDDEN));

/** 환자에게 보여도 되는 유형인가 — 어휘 밖(옛 이름·오타)은 false(fail-closed) */
export function isPatientVisibleJourneyEvent(v: unknown): boolean {
  return isJourneyEventType(v) && !(v in JOURNEY_EVENT_PATIENT_HIDDEN);
}

/**
 * 🔴 (2026-09-14) 환자 포털에 **설명(description)을 그대로 보여도 되는** 유형 — 발행 지점의 설명이 구조화 값
 *    (용량·수량·코드·고정 문장) 또는 환자 본인이 쓴 문장(VOC 제목)으로만 만들어지는 유형만 넣는다.
 * 과거 행은 소급 수정하지 않는다: 처방·오더(오더 메모)·응급(주호소·트리아지/처분 메모)·영상(판독 소견)·퇴원(요약)·
 *    입원 취소(사유)·PACU(강제 퇴실 사유)·예약(사유) 설명에 직원 자유 입력이 이미 저장돼 있다. 그래서 포털은 원 설명을
 *    그대로 싣지 않고 이 목록에 있는 유형만 통과시킨다(fail-closed — 새 유형은 발행 지점 설명이 구조화 값뿐인지 확인한 뒤 넣는다).
 *    직원 화면 여정 조회(journey.service)는 원문 그대로다.
 */
export const JOURNEY_PATIENT_DESCRIPTION_SAFE: ReadonlySet<string> = new Set<JourneyEventType>([
  'MEDICATION_ADMINISTERED', // 용량 · 경로
  'TRANSFUSION_COMPLETED', // 수혈량 mL
  'LAB_RESULT', // 항목 수 · 이상 건수
  'ER_CHECKOUT', // 처분 코드
  'BILLING_PAID', // 고정 문장
  'ENCOUNTER_SIGNED', 'ENCOUNTER_AMENDED', // 고정 문장
  'CONSENT_REQUESTED', 'CONSENT_SIGNED', 'CONSENT_COMPLETED', 'CONSENT_REVOKED', // 서식 이름 · 고정 문장
  'voc.received', 'voc.answered', 'voc.closed', // 환자 본인이 쓴 VOC 제목
]);

/** 포털에 싣는 설명 — 설명 안전 유형이 아니면 null(제목만 보인다) */
export function patientJourneyDescription(eventType: unknown, description: string | null | undefined): string | null {
  if (description == null || description === '') return null;
  return typeof eventType === 'string' && JOURNEY_PATIENT_DESCRIPTION_SAFE.has(eventType) ? description : null;
}
