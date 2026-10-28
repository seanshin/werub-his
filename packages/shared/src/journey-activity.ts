/**
 * 환자 여정 P2(2026-10-01) — 활동(activity)·전이(transition) 매핑 정본 + 관측 범위 등록부.
 * 근거: `docs/01-plan/features/patient-journey-model.plan.md` §5.1·§5.3·§5.9 (XES lifecycle·FHIR status·OCEL activity).
 *
 * 🔴 저장된 `eventType` 은 소급 변경하지 않는다 — 새 행은 이 표에서 **결정적으로** 파생한 activity·transition 을 함께 저장하고,
 *    과거 행은 null 로 둔다(읽는 쪽이 이 표로 파생할 수 있다 — 단 `ER_DISPOSITION` 의 최초/변경은 과거 행에서 가를 수 없다).
 */
import type { JourneyEventType } from './journey-event-types';

/** 전이 어휘 — 생명주기 단계(XES lifecycle·FHIR status 대응). 사람 결정이 아니라 문헌 어휘 정리다 */
export const JOURNEY_TRANSITIONS = [
  'REQUESTED', 'SCHEDULED', 'STARTED', 'IN_PROGRESS', 'SUSPENDED', 'RESUMED',
  'COMPLETED', 'CANCELLED', 'DISCONTINUED', 'REVISED', 'REVOKED', 'FAILED', 'ENTERED_IN_ERROR',
] as const;
export type JourneyTransition = (typeof JOURNEY_TRANSITIONS)[number];

export interface JourneyActivityMapping {
  activity: string;
  transition: JourneyTransition;
  /**
   * 같은 원 기록(refId)에 이 전이가 **한 번만** 일어나는가 — 참이면 멱등 키 `<activity>:<transition>:<refId>` 로
   * 이중 발행을 막는다(부분 유니크). 재발생이 정상인 것(호출 반복·재배정·결과 정정)은 false.
   */
  once: boolean;
  /** 전이만으로 못 담는 상태(FHIR Task businessStatus) */
  outcome?: string;
}

const m = (activity: string, transition: JourneyTransition, once = false, outcome?: string): JourneyActivityMapping =>
  outcome ? { activity, transition, once, outcome } : { activity, transition, once };

/** 어휘 전 항목의 매핑 — 빠지면 컴파일·가드가 실패한다(`Record<JourneyEventType, …>`) */
export const JOURNEY_ACTIVITY_MAP: Readonly<Record<JourneyEventType, JourneyActivityMapping>> = {
  RECEPTION_CHECKIN: m('OUTPATIENT_VISIT', 'STARTED', true),
  RECEPTION_CALLED: m('OUTPATIENT_CALL', 'COMPLETED'),
  ENCOUNTER_START: m('CONSULTATION', 'STARTED', true),
  ENCOUNTER_SIGNED: m('CONSULT_NOTE', 'COMPLETED', true), // 서명 = 기록 완료(진료 종료가 아니다)
  ENCOUNTER_AMENDED: m('CONSULT_NOTE', 'REVISED'),
  APPOINTMENT_BOOKED: m('APPOINTMENT', 'SCHEDULED', true),
  PRESCRIPTION_ADDED: m('MEDICATION_ORDER', 'REQUESTED', true),
  ORDER_CREATED: m('ORDER', 'REQUESTED', true),
  ORDER_COMPLETED: m('ORDER', 'COMPLETED', true),
  LAB_RESULT: m('LAB_RESULT', 'COMPLETED'),
  IMAGING_RESULT: m('IMAGING_REPORT', 'COMPLETED'),
  DISPENSED: m('DISPENSING', 'COMPLETED', true),
  MEDICATION_ADMINISTERED: m('MED_ADMIN', 'COMPLETED', true),
  TRANSFUSION_COMPLETED: m('TRANSFUSION', 'COMPLETED', true),
  CANCER_REGISTRY_CANDIDATE: m('CANCER_REGISTRY_SCREEN', 'COMPLETED'),
  MDT_DECISION: m('MDT', 'COMPLETED'),
  PROTOCOL_STEP: m('PROTOCOL_STEP', 'COMPLETED'),
  BILLING_CREATED: m('BILLING', 'REQUESTED', true),
  BILLING_PAID: m('BILLING', 'COMPLETED'), // 분납·재수납이 있어 한 번이라 단정하지 않는다
  BILLING_AMEND_REVIEW: m('BILLING_REVIEW', 'REQUESTED'),
  BILLING_CREATE_FAILED: m('BILLING', 'FAILED'),
  CLAIM_REVIEW: m('CLAIM_REVIEW', 'COMPLETED'),
  ER_ARRIVAL: m('ER_VISIT', 'STARTED', true),
  ER_TRIAGE: m('ER_TRIAGE', 'COMPLETED', true),
  ER_TREATMENT_START: m('ER_TREATMENT', 'STARTED', true),
  // 최초 결정 — 변경 경로는 발행 지점이 `REVISED` 로 덮는다(과거 행은 둘을 가를 수 없다)
  ER_DISPOSITION: m('ER_DISPOSITION_DECISION', 'COMPLETED', true),
  ER_CHECKOUT: m('ER_VISIT', 'COMPLETED', true),
  ER_BILLING_FAILED: m('BILLING', 'FAILED'),
  ER_BED_ASSIGNED: m('ER_BED_OCCUPANCY', 'STARTED'),
  ER_BED_MOVED: m('ER_BED_OCCUPANCY', 'REVISED'),
  ER_BED_RELEASED: m('ER_BED_OCCUPANCY', 'COMPLETED'),
  GOLDEN_PATHWAY_ACTIVATED: m('EMERGENCY_PATHWAY', 'STARTED'),
  ADMISSION: m('INPATIENT_STAY', 'STARTED', true),
  ADMISSION_CANCELLED: m('INPATIENT_STAY', 'CANCELLED', true),
  BED_TRANSFER: m('WARD_BED_OCCUPANCY', 'REVISED'),
  TRANSFER_CARE: m('ATTENDING', 'REVISED'),
  DISCHARGE: m('INPATIENT_STAY', 'COMPLETED', true),
  SURGERY_START: m('OR_STAY', 'STARTED', true),
  SURGERY_COMPLETE: m('OR_STAY', 'COMPLETED', true),
  PACU_ADMISSION: m('PACU_STAY', 'STARTED', true),
  PACU_DISCHARGE: m('PACU_STAY', 'COMPLETED', true),
  NEWBORN_CRITICAL: m('NEWBORN_ALERT', 'COMPLETED'),
  CONSENT_REQUESTED: m('CONSENT', 'REQUESTED'),
  CONSENT_SIGNED: m('CONSENT', 'IN_PROGRESS', false, 'SIGNED_BY_PATIENT'),
  CONSENT_COMPLETED: m('CONSENT', 'COMPLETED'),
  CONSENT_REVOKED: m('CONSENT', 'REVOKED'),
  CHECKUP_RESERVED: m('CHECKUP_VISIT', 'SCHEDULED', true),
  CHECKUP_CHECKIN: m('CHECKUP_VISIT', 'STARTED', true),
  CHECKUP_STATION_ARRIVE: m('CHECKUP_STATION', 'STARTED'),
  CHECKUP_STATION_COMPLETE: m('CHECKUP_STATION', 'COMPLETED'),
  CHECKUP_CRITICAL: m('CHECKUP_ALERT', 'COMPLETED'),
  CHECKUP_COMPLETE: m('CHECKUP_VISIT', 'COMPLETED', true),
  CHECKUP_CANCELLED: m('CHECKUP_VISIT', 'CANCELLED', true),
  CHRONIC_ALERT: m('CHRONIC_ALERT', 'COMPLETED'),
  CSSD_RECALL: m('DEVICE_RECALL_TRACE', 'COMPLETED'),
  'voc.received': m('VOC', 'REQUESTED', true),
  'voc.answered': m('VOC', 'REVISED'),
  'voc.closed': m('VOC', 'COMPLETED'),
  PATIENT_MESSAGE_SENT: m('PATIENT_MESSAGE', 'REQUESTED', true),
  PATIENT_MESSAGE_REPLIED: m('PATIENT_MESSAGE', 'COMPLETED'),
  DIAGNOSTIC_CANCELLED: m('DIAGNOSTIC_TEST', 'CANCELLED'),
  DIAGNOSTIC_ON_HOLD: m('DIAGNOSTIC_TEST', 'SUSPENDED'),
  DIAGNOSTIC_RESUMED: m('DIAGNOSTIC_TEST', 'RESUMED'),
};

/** 같은 활동의 사건 유형들 — 정정(REVISED)이 가리킬 앞 사건을 찾을 때 쓴다 */
export function journeyEventTypesOfActivity(activity: string): JourneyEventType[] {
  return (Object.entries(JOURNEY_ACTIVITY_MAP) as [JourneyEventType, JourneyActivityMapping][])
    .filter(([, v]) => v.activity === activity)
    .map(([k]) => k);
}

export interface JourneyObservedSince {
  /** 첫 발행 코드 커밋 시각 — **배포 시각이 아니다**(운영 배포는 그 뒤. 사이 구간의 부재는 코드가 없어서다) */
  since: string;
  commit: string;
}

/**
 * 관측 범위 등록부(불변식 I7) — 어휘 항목마다 **발행 코드가 처음 들어온 커밋**.
 * 근거: `git log --reverse -S "eventType: '<유형>'" -- apps/api/src` 의 첫 커밋(2026-10-01 CLI 가 git 이력으로 확인 · 추정 아님).
 * `null` = 그 패턴으로 발행하지 않아(리스너 삼항·상태 맵) git 이력으로 **확인하지 못했다** — 날짜를 지어내지 않는다.
 * 이 시각 이전의 부재는 "없었다"가 아니라 "기록 범위 밖"이다.
 */
export const JOURNEY_OBSERVED_SINCE: Readonly<Record<JourneyEventType, JourneyObservedSince | null>> = {
  'RECEPTION_CHECKIN': { since: '2026-05-08T19:56:43+09:00', commit: 'ac937ac2e' },
  'RECEPTION_CALLED': { since: '2026-05-29T17:09:31+09:00', commit: 'ed003bb26' },
  'ENCOUNTER_START': { since: '2026-05-18T10:39:14+09:00', commit: 'ad517bf55' },
  'ENCOUNTER_SIGNED': { since: '2026-05-18T10:39:14+09:00', commit: 'ad517bf55' },
  'ENCOUNTER_AMENDED': { since: '2026-06-28T16:26:50+09:00', commit: '469aec8a2' },
  'APPOINTMENT_BOOKED': { since: '2026-07-28T10:25:39+09:00', commit: '570ec0447' },
  'PRESCRIPTION_ADDED': null,
  'ORDER_CREATED': { since: '2026-05-29T17:09:31+09:00', commit: 'ed003bb26' },
  'ORDER_COMPLETED': { since: '2026-09-14T14:33:36+09:00', commit: 'd6cfef981' },
  'LAB_RESULT': { since: '2026-05-29T17:09:31+09:00', commit: 'ed003bb26' },
  'IMAGING_RESULT': { since: '2026-05-29T17:17:19+09:00', commit: 'c4001c984' },
  'DISPENSED': { since: '2026-07-28T10:25:39+09:00', commit: '570ec0447' },
  'MEDICATION_ADMINISTERED': { since: '2026-07-28T10:25:39+09:00', commit: '570ec0447' },
  'TRANSFUSION_COMPLETED': { since: '2026-07-28T10:25:39+09:00', commit: '570ec0447' },
  'CANCER_REGISTRY_CANDIDATE': { since: '2026-07-04T15:44:35+09:00', commit: '89f62e84c' },
  'MDT_DECISION': { since: '2026-07-04T15:44:35+09:00', commit: '89f62e84c' },
  'PROTOCOL_STEP': { since: '2026-06-23T14:00:10+09:00', commit: '50bb6e45b' },
  'BILLING_CREATED': { since: '2026-09-14T14:33:36+09:00', commit: 'd6cfef981' },
  'BILLING_PAID': { since: '2026-05-20T09:04:21+09:00', commit: 'bbaf797b0' },
  'BILLING_AMEND_REVIEW': { since: '2026-06-29T09:52:26+09:00', commit: '4103c06d4' },
  'BILLING_CREATE_FAILED': { since: '2026-08-24T14:58:11+09:00', commit: 'd31f93cdd' },
  'CLAIM_REVIEW': { since: '2026-07-05T08:14:52+09:00', commit: '4368f52b3' },
  'ER_ARRIVAL': { since: '2026-05-08T19:56:43+09:00', commit: 'ac937ac2e' },
  'ER_TRIAGE': { since: '2026-05-18T10:39:14+09:00', commit: 'ad517bf55' },
  'ER_TREATMENT_START': { since: '2026-09-14T14:33:36+09:00', commit: 'd6cfef981' },
  'ER_DISPOSITION': { since: '2026-05-18T10:39:14+09:00', commit: 'ad517bf55' },
  'ER_CHECKOUT': { since: '2026-08-05T11:17:47+09:00', commit: 'ac953edfa' },
  'ER_BILLING_FAILED': { since: '2026-06-28T16:40:48+09:00', commit: '6b54a8ba4' },
  'ER_BED_ASSIGNED': { since: '2026-08-05T10:52:25+09:00', commit: '21fde82c0' },
  'ER_BED_MOVED': { since: '2026-08-05T10:52:25+09:00', commit: '21fde82c0' },
  'ER_BED_RELEASED': { since: '2026-08-05T10:52:25+09:00', commit: '21fde82c0' },
  'GOLDEN_PATHWAY_ACTIVATED': { since: '2026-07-11T12:09:57+09:00', commit: '50fb07bf9' },
  'ADMISSION': { since: '2026-05-08T19:56:43+09:00', commit: 'ac937ac2e' },
  'ADMISSION_CANCELLED': { since: '2026-07-10T11:28:17+09:00', commit: '091a7fea9' },
  'BED_TRANSFER': { since: '2026-07-10T10:34:18+09:00', commit: '1e576dc4e' },
  'TRANSFER_CARE': { since: '2026-07-15T19:32:54+09:00', commit: '6fcdc35b6' },
  'DISCHARGE': { since: '2026-05-18T10:39:14+09:00', commit: 'ad517bf55' },
  'SURGERY_START': { since: '2026-05-18T10:39:14+09:00', commit: 'ad517bf55' },
  'SURGERY_COMPLETE': { since: '2026-05-08T19:56:43+09:00', commit: 'ac937ac2e' },
  'PACU_ADMISSION': { since: '2026-07-04T10:03:14+09:00', commit: 'db5bbb5de' },
  'PACU_DISCHARGE': { since: '2026-07-04T10:03:14+09:00', commit: 'db5bbb5de' },
  'NEWBORN_CRITICAL': { since: '2026-07-11T14:02:44+09:00', commit: '828b43b00' },
  'CONSENT_REQUESTED': { since: '2026-05-29T18:18:55+09:00', commit: 'a56124159' },
  'CONSENT_SIGNED': { since: '2026-05-29T18:18:55+09:00', commit: 'a56124159' },
  'CONSENT_COMPLETED': { since: '2026-05-29T18:18:55+09:00', commit: 'a56124159' },
  'CONSENT_REVOKED': { since: '2026-09-14T14:33:36+09:00', commit: 'd6cfef981' },
  'CHECKUP_RESERVED': { since: '2026-05-30T11:19:53+09:00', commit: '5d19b4fa3' },
  'CHECKUP_CHECKIN': { since: '2026-05-30T11:19:53+09:00', commit: '5d19b4fa3' },
  'CHECKUP_STATION_ARRIVE': { since: '2026-05-30T10:48:21+09:00', commit: '6d627bb12' },
  'CHECKUP_STATION_COMPLETE': { since: '2026-05-30T10:48:21+09:00', commit: '6d627bb12' },
  'CHECKUP_CRITICAL': { since: '2026-05-30T10:48:21+09:00', commit: '6d627bb12' },
  'CHECKUP_COMPLETE': { since: '2026-05-30T11:19:53+09:00', commit: '5d19b4fa3' },
  'CHECKUP_CANCELLED': { since: '2026-05-30T11:19:53+09:00', commit: '5d19b4fa3' },
  'CHRONIC_ALERT': { since: '2026-06-27T11:25:30+09:00', commit: '7b74db26a' },
  'CSSD_RECALL': { since: '2026-07-11T13:58:40+09:00', commit: '1a1cd9b2e' },
  'voc.received': { since: '2026-07-24T16:30:49+09:00', commit: '75259332e' },
  'voc.answered': { since: '2026-07-24T16:54:50+09:00', commit: '7f32c03eb' },
  'voc.closed': { since: '2026-07-24T16:54:50+09:00', commit: '7f32c03eb' },
  'PATIENT_MESSAGE_SENT': { since: '2026-09-14T14:44:28+09:00', commit: 'cd4833d6e' },
  'PATIENT_MESSAGE_REPLIED': { since: '2026-09-14T14:44:28+09:00', commit: 'cd4833d6e' },
  'DIAGNOSTIC_CANCELLED': null,
  'DIAGNOSTIC_ON_HOLD': null,
  'DIAGNOSTIC_RESUMED': null,};

/**
 * 원 기록 귀속(refType·refId)까지 갖춘 발행이 시작된 커밋 — 감시자 상태–사건 대조(I5)는 이 이후만 센다.
 * 확인한 것만 둔다(나머지는 미확인 — 대조에 쓰지 않는다).
 */
export const JOURNEY_REF_ATTACHED_SINCE: Readonly<Partial<Record<JourneyEventType, JourneyObservedSince>>> = {
  // 첫 발행부터 refType 'EmergencyVisit'·refId 동반(d6cfef981 diff 확인)
  ER_TREATMENT_START: { since: '2026-09-14T14:33:36+09:00', commit: 'd6cfef981' },
  // 여정 P0-5 에서 refType 'ADMISSION'·refId 를 붙였다(그 전 행은 입원에 귀속 불가)
  DISCHARGE: { since: '2026-10-01T10:42:38+09:00', commit: '1a405f5cd' },
  // (2026-10-01 I5 확장) 아래는 `git log --reverse -S "<현재 발행 줄의 refType·refId 문자열>"` 첫 커밋.
  //   🔴 현재 문자열이 처음 나타난 시점이다 — 그 전에 다른 모양으로 귀속했을 수 있어 경계가 실제보다 늦을 수 있다(덜 센다 · 안전측).
  ER_ARRIVAL: { since: '2026-10-01T10:42:38+09:00', commit: '1a405f5cd' }, // 여정 P0-5 에서 refType 'EmergencyVisit'·refId
  // 입원 생성 두 경로 중 **나중에** 귀속된 쪽(admission.service 1e576dc4e · inpatient.service 는 ac937ac2e 05-08)
  ADMISSION: { since: '2026-07-10T10:34:18+09:00', commit: '1e576dc4e' },
  SURGERY_START: { since: '2026-10-01T10:42:38+09:00', commit: '1a405f5cd' }, // 여정 P0-5 에서 refId
  SURGERY_COMPLETE: { since: '2026-05-08T19:56:43+09:00', commit: 'ac937ac2e' },
  PACU_ADMISSION: { since: '2026-07-04T10:03:14+09:00', commit: 'db5bbb5de' },
  PACU_DISCHARGE: { since: '2026-07-04T10:03:14+09:00', commit: 'db5bbb5de' },
};
