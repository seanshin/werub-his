/**
 * 환자 여정 P1(2026-10-01) — 사건–객체 관계·시각 출처·데이터 출처 어휘 정본.
 * 근거: `docs/01-plan/features/patient-journey-model.plan.md` §5.1·§5.4 (OCEL 2.0 사건–객체 관계 · FHIR Provenance occurred/recorded).
 *
 * 🔴 저장된 `refType` 은 표기가 4가지로 갈려 있다(`ADMISSION`·`EmergencyVisit`·`protocol`·`diagnostic_test`).
 *    저장값은 소급 변경하지 않는다 — 관계표에는 **이 파일의 객체 유형 한 가지 표기**만 쓰고, 옛 refType 은 아래 매핑으로 읽는다.
 */
import type { JourneyEventType } from './journey-event-types';

/** 객체 유형(관계표 `object_type`) — 표기 한 가지(파스칼) */
export const JOURNEY_OBJECT_TYPES = [
  'WaitingQueue', 'Encounter', 'EmergencyVisit', 'Admission', 'Surgery', 'PacuRecord', 'CheckupVisit',
  'CheckupStationLog', 'CheckupSummary', 'Appointment', 'Order', 'LabResult', 'ImagingResult', 'Dispensing',
  'MedicationAdministration', 'BloodTransfusion', 'Billing', 'Claim', 'ConsentForm', 'ProtocolInstance',
  'ChargeOfCare', 'DeliveryRecord', 'PathologyReport', 'MdtCase', 'VocTicket', 'PatientMessage', 'DiagnosticTest',
] as const;
export type JourneyObjectType = (typeof JOURNEY_OBJECT_TYPES)[number];

/** 방문 단위(episode)가 될 수 있는 객체 — 시작·끝이 있는 한 번의 연속된 진료 관계(FHIR Encounter·OMOP visit) */
export const JOURNEY_EPISODE_OBJECT_TYPES: readonly JourneyObjectType[] = [
  'WaitingQueue', 'EmergencyVisit', 'Admission', 'Surgery', 'CheckupVisit',
];

/** 관계 한정자(OCEL qualifier) */
export const JOURNEY_QUALIFIERS = ['episode', 'focus', 'location', 'performer'] as const;
export type JourneyQualifier = (typeof JOURNEY_QUALIFIERS)[number];

/** 저장된 옛 refType → 객체 유형(읽는 쪽 매핑 · 저장값 불변) */
export const JOURNEY_REF_TYPE_TO_OBJECT: Readonly<Record<string, JourneyObjectType>> = {
  WAITING_QUEUE: 'WaitingQueue', ENCOUNTER: 'Encounter', EmergencyVisit: 'EmergencyVisit', ADMISSION: 'Admission',
  SURGERY: 'Surgery', PACU: 'PacuRecord', CheckupVisit: 'CheckupVisit', CheckupStationLog: 'CheckupStationLog',
  CheckupSummary: 'CheckupSummary', Appointment: 'Appointment', Order: 'Order', LabResult: 'LabResult',
  ImagingResult: 'ImagingResult', Dispensing: 'Dispensing', MedicationAdministration: 'MedicationAdministration',
  BloodTransfusion: 'BloodTransfusion', Billing: 'Billing', CLAIM: 'Claim', ConsentForm: 'ConsentForm',
  protocol: 'ProtocolInstance', CHARGE_OF_CARE: 'ChargeOfCare', DeliveryRecord: 'DeliveryRecord',
  PATHOLOGY_REPORT: 'PathologyReport', MDT_CASE: 'MdtCase', VocTicket: 'VocTicket', PatientMessage: 'PatientMessage',
  diagnostic_test: 'DiagnosticTest',
};

/**
 * 방문 단위 귀속이 **필수**인 사건 유형과 그 방문 단위의 객체 유형(불변식 I3).
 * 진료 기록(`ENCOUNTER_*`)은 외래·입원 어느 쪽에도 붙을 수 있어 필수에서 뺐다(focus=Encounter).
 */
export const JOURNEY_EPISODE_REQUIRED: Readonly<Partial<Record<JourneyEventType, JourneyObjectType>>> = {
  RECEPTION_CHECKIN: 'WaitingQueue', RECEPTION_CALLED: 'WaitingQueue',
  ER_ARRIVAL: 'EmergencyVisit', ER_TRIAGE: 'EmergencyVisit', ER_TREATMENT_START: 'EmergencyVisit',
  ER_DISPOSITION: 'EmergencyVisit', ER_CHECKOUT: 'EmergencyVisit',
  ER_BED_ASSIGNED: 'EmergencyVisit', ER_BED_MOVED: 'EmergencyVisit', ER_BED_RELEASED: 'EmergencyVisit',
  ADMISSION: 'Admission', ADMISSION_CANCELLED: 'Admission', BED_TRANSFER: 'Admission', TRANSFER_CARE: 'Admission', DISCHARGE: 'Admission',
  SURGERY_START: 'Surgery', SURGERY_COMPLETE: 'Surgery', PACU_ADMISSION: 'Surgery', PACU_DISCHARGE: 'Surgery',
  CHECKUP_RESERVED: 'CheckupVisit', CHECKUP_CHECKIN: 'CheckupVisit', CHECKUP_STATION_ARRIVE: 'CheckupVisit',
  CHECKUP_STATION_COMPLETE: 'CheckupVisit', CHECKUP_COMPLETE: 'CheckupVisit', CHECKUP_CANCELLED: 'CheckupVisit',
};

/** 발생 시각의 출처(FHIR Provenance occurred vs recorded) */
export const JOURNEY_TIME_SOURCES = ['DOMAIN_FIELD', 'USER_CLAIMED', 'SAME_AS_RECORDED', 'UNKNOWN'] as const;
export type JourneyTimeSource = (typeof JOURNEY_TIME_SOURCES)[number];

/** 데이터 출처 — 리허설·실서비스 전환 때 시드·데모를 가려낼 기준 */
export const JOURNEY_DATA_ORIGINS = ['LIVE', 'SEED', 'DEMO', 'IMPORTED', 'UNKNOWN'] as const;
export type JourneyDataOrigin = (typeof JOURNEY_DATA_ORIGINS)[number];

/** 시각 출처 화면 문구 — 시각이 무엇을 뜻하는지 밝힌다(관측처럼 보이게 하지 않는다) */
export const JOURNEY_TIME_SOURCE_LABEL: Record<JourneyTimeSource, string> = {
  DOMAIN_FIELD: '발생 시각',
  USER_CLAIMED: '입력된 시각',
  SAME_AS_RECORDED: '발생 시각',
  UNKNOWN: '기록 시각(발생 시각 미상)',
};

/** 옛 refType 을 객체 유형으로 — 모르는 표기는 null(추정하지 않는다) */
export function journeyObjectTypeOf(refType: string | null | undefined): JourneyObjectType | null {
  if (!refType) return null;
  return JOURNEY_REF_TYPE_TO_OBJECT[refType] ?? null;
}
