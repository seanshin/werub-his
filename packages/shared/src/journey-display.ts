/**
 * 환자 여정 **표시 정본**(2026-10-01 여정 P3 · UX 검토) — 유형 라벨·트랙·방문 단위 이름·전이/출처 표식.
 *
 * 🔴 종전엔 화면마다 자기 표를 뒀다(P12):
 *    · 여정 대시보드 `EVENT_TYPE_LABEL` 15키 중 10키가 **어휘에 없는 이름** — 실제 유형 칩은 `RECEPTION_CHECKIN` 같은 코드로 보였다
 *    · 직원 탭 아이콘 26/63 · 모바일 아이콘 표엔 발행되지 않는 `ROUND`
 *    · 보고서는 유형을 `font-mono` 원 코드로 그렸다
 *    이제 `Record<JourneyEventType, …>` 로 어휘 전 항목을 강제한다(빠지면 컴파일 실패).
 * 라벨은 한국어 원문 = i18n 키다(화면은 `<T k={라벨}>` 로 그린다).
 */
import type { JourneyEventType } from './journey-event-types';
import { JOURNEY_ACTIVITY_MAP } from './journey-activity';
import type { JourneyObjectType } from './journey-objects';

/** 여정 트랙 — 필터 칩·색 묶음 */
export const JOURNEY_TRACKS = {
  OPD: '외래',
  ER: '응급',
  IPD: '입원',
  OR: '수술',
  CHECKUP: '검진',
  ORDER: '처방·검사',
  BILLING: '수납·청구',
  CONSENT: '동의서',
  OTHER: '기타',
} as const;
export type JourneyTrack = keyof typeof JOURNEY_TRACKS;

export interface JourneyEventDisplay {
  /** 직원·환자 공통 라벨(사건의 종류 — 서버 제목과 별개로 늘 같은 말) */
  label: string;
  track: JourneyTrack;
  /** 웹 아이콘(문자) — 모바일은 자기 아이콘 세트를 트랙으로 고른다 */
  icon: string;
}

const d = (label: string, track: JourneyTrack, icon: string): JourneyEventDisplay => ({ label, track, icon });

export const JOURNEY_EVENT_DISPLAY: Readonly<Record<JourneyEventType, JourneyEventDisplay>> = {
  RECEPTION_CHECKIN: d('외래 접수', 'OPD', '🏥'),
  RECEPTION_CALLED: d('진료실 호출', 'OPD', '📢'),
  ENCOUNTER_START: d('진료 시작', 'OPD', '🩺'),
  ENCOUNTER_SIGNED: d('진료 기록 서명', 'OPD', '✅'),
  ENCOUNTER_AMENDED: d('진료 기록 정정', 'OPD', '✏️'),
  APPOINTMENT_BOOKED: d('예약', 'OPD', '📅'),
  PRESCRIPTION_ADDED: d('처방', 'ORDER', '💊'),
  ORDER_CREATED: d('검사·처치 오더', 'ORDER', '📋'),
  ORDER_COMPLETED: d('오더 완료', 'ORDER', '✔️'),
  LAB_RESULT: d('검사 결과', 'ORDER', '🧪'),
  IMAGING_RESULT: d('영상 판독', 'ORDER', '📷'),
  DISPENSED: d('조제 완료', 'ORDER', '💊'),
  MEDICATION_ADMINISTERED: d('투약', 'IPD', '💉'),
  TRANSFUSION_COMPLETED: d('수혈 완료', 'IPD', '🩸'),
  CANCER_REGISTRY_CANDIDATE: d('암등록 후보', 'OTHER', '🗂️'),
  MDT_DECISION: d('다학제 결정', 'OTHER', '👥'),
  PROTOCOL_STEP: d('진료 경로 단계', 'OTHER', '🧭'),
  BILLING_CREATED: d('진료비 생성', 'BILLING', '🧾'),
  BILLING_PAID: d('수납 완료', 'BILLING', '💳'),
  BILLING_AMEND_REVIEW: d('청구 정정 검토', 'BILLING', '🧾'),
  BILLING_CREATE_FAILED: d('진료비 생성 실패', 'BILLING', '⚠️'),
  CLAIM_REVIEW: d('청구 심사', 'BILLING', '🧾'),
  ER_ARRIVAL: d('응급실 도착', 'ER', '🚨'),
  ER_TRIAGE: d('응급 분류', 'ER', '🔴'),
  ER_TREATMENT_START: d('응급 처치 시작', 'ER', '⚡'),
  ER_DISPOSITION: d('응급 처분', 'ER', '📤'),
  ER_CHECKOUT: d('응급실 퇴실', 'ER', '🚪'),
  ER_BILLING_FAILED: d('응급 진료비 생성 실패', 'ER', '⚠️'),
  ER_BED_ASSIGNED: d('응급 병상 배정', 'ER', '🛏️'),
  ER_BED_MOVED: d('응급 병상 이동', 'ER', '🔄'),
  ER_BED_RELEASED: d('응급 병상 해제', 'ER', '🛏️'),
  GOLDEN_PATHWAY_ACTIVATED: d('골든타임 경로 발동', 'ER', '⏱️'),
  ADMISSION: d('입원', 'IPD', '🛏️'),
  ADMISSION_CANCELLED: d('입원 취소', 'IPD', '↩️'),
  BED_TRANSFER: d('전실', 'IPD', '🔄'),
  TRANSFER_CARE: d('주치의 변경', 'IPD', '👨‍⚕️'),
  DISCHARGE: d('퇴원', 'IPD', '🏠'),
  SURGERY_START: d('수술 시작', 'OR', '🔪'),
  SURGERY_COMPLETE: d('수술 종료', 'OR', '✅'),
  PACU_ADMISSION: d('회복실 입실', 'OR', '🛌'),
  PACU_DISCHARGE: d('회복실 퇴실', 'OR', '🚶'),
  NEWBORN_CRITICAL: d('신생아 위급', 'IPD', '👶'),
  CONSENT_REQUESTED: d('동의서 요청', 'CONSENT', '📝'),
  CONSENT_SIGNED: d('동의서 서명', 'CONSENT', '✍️'),
  CONSENT_COMPLETED: d('동의서 완료', 'CONSENT', '✅'),
  CONSENT_REVOKED: d('동의 철회', 'CONSENT', '↩️'),
  CHECKUP_RESERVED: d('검진 예약', 'CHECKUP', '📅'),
  CHECKUP_CHECKIN: d('검진 접수', 'CHECKUP', '🏥'),
  CHECKUP_STATION_ARRIVE: d('검진 항목 도착', 'CHECKUP', '📍'),
  CHECKUP_STATION_COMPLETE: d('검진 항목 완료', 'CHECKUP', '✔️'),
  CHECKUP_CRITICAL: d('검진 위급 소견', 'CHECKUP', '⚠️'),
  CHECKUP_COMPLETE: d('검진 종합 판정', 'CHECKUP', '✅'),
  CHECKUP_CANCELLED: d('검진 취소', 'CHECKUP', '↩️'),
  CHRONIC_ALERT: d('만성질환 알림', 'OTHER', '⚠️'),
  CSSD_RECALL: d('기구 회수 추적', 'OTHER', '🧰'),
  'voc.received': d('고객의 소리 접수', 'OTHER', '💬'),
  'voc.answered': d('고객의 소리 답변', 'OTHER', '💬'),
  'voc.closed': d('고객의 소리 종결', 'OTHER', '💬'),
  PATIENT_MESSAGE_SENT: d('환자 메시지 발송', 'OTHER', '✉️'),
  PATIENT_MESSAGE_REPLIED: d('환자 메시지 답장', 'OTHER', '✉️'),
  DIAGNOSTIC_CANCELLED: d('검사 취소', 'ORDER', '↩️'),
  DIAGNOSTIC_ON_HOLD: d('검사 보류', 'ORDER', '⏸️'),
  DIAGNOSTIC_RESUMED: d('검사 재개', 'ORDER', '▶️'),
};

/** 유형 → 표시. 어휘 밖(과거 시드 `ROUND` 등)은 null — 화면은 "기록 종류 미등록"으로 말한다(코드를 그대로 라벨로 쓰지 않는다) */
export function journeyEventDisplay(eventType: string | null | undefined): JourneyEventDisplay | null {
  if (!eventType) return null;
  return JOURNEY_EVENT_DISPLAY[eventType as JourneyEventType] ?? null;
}

/** 트랙에 속한 유형들 — 서버 `types` 필터로 보낸다 */
export function journeyEventTypesOfTrack(track: JourneyTrack): JourneyEventType[] {
  return (Object.entries(JOURNEY_EVENT_DISPLAY) as [JourneyEventType, JourneyEventDisplay][])
    .filter(([, v]) => v.track === track)
    .map(([k]) => k);
}

/** 방문 단위 이름 */
export const JOURNEY_EPISODE_LABEL: Readonly<Partial<Record<JourneyObjectType, string>>> = {
  WaitingQueue: '외래 방문',
  EmergencyVisit: '응급 방문',
  Admission: '입원',
  Surgery: '수술',
  CheckupVisit: '검진 방문',
};

/** 전이 표식 — 같은 무게의 새 행으로 보이면 안 되는 것만(정정·취소·철회·보류·실패) */
export const JOURNEY_TRANSITION_BADGE: Readonly<Record<string, { label: string; tone: 'amber' | 'gray' | 'red' }>> = {
  REVISED: { label: '정정', tone: 'amber' },
  CANCELLED: { label: '취소', tone: 'gray' },
  REVOKED: { label: '철회', tone: 'gray' },
  SUSPENDED: { label: '보류', tone: 'gray' },
  ENTERED_IN_ERROR: { label: '오기록', tone: 'red' },
  FAILED: { label: '실패', tone: 'red' },
};

/** 행의 전이 — 저장된 값이 없으면(P2 이전 행) 유형 매핑에서 파생(ER_DISPOSITION 최초/변경은 과거 행에서 가를 수 없다 — COMPLETED 로 본다) */
export function journeyTransitionOf(row: { eventType: string; transition?: string | null }): string | null {
  if (row.transition) return row.transition;
  return JOURNEY_ACTIVITY_MAP[row.eventType as JourneyEventType]?.transition ?? null;
}

/** 데이터 출처 표식 — 데모·시드만 표식한다(과거 행 UNKNOWN 에 붙이면 전 행이 표식이라 소음이다) */
export const JOURNEY_ORIGIN_BADGE: Readonly<Record<string, string>> = {
  DEMO: '데모',
  SEED: '시드',
  IMPORTED: '이관',
};

/**
 * 방문 묶음(2026-10-01 · P3 표시 잔여) — 환자의 방문 단위를 **도메인 원장**에서 요약한다(여정 원장 아님).
 * 끝 시각은 정본이 있는 방문만 말한다 — 2026-10-03 결정: 외래 끝 = **수납 완료**(D8 `journey.outpatientEnd`) ·
 *    응급 끝 = **퇴실 시각**(D9 `emergency.departureTimeSource` — `EmergencyVisit.departedAt`). 그 시각이 없으면 끝을 비우고 **이유**를 싣는다
 *    (대기열 완료·처분 시각을 끝처럼 그리지 않는다).
 */
export const JOURNEY_EPISODE_STATES = ['PLANNED', 'OPEN', 'ENDED', 'CANCELLED', 'END_UNDEFINED', 'UNKNOWN'] as const;
export type JourneyEpisodeState = (typeof JOURNEY_EPISODE_STATES)[number];
export const JOURNEY_EPISODE_STATE_LABEL: Readonly<Record<JourneyEpisodeState, string>> = {
  PLANNED: '예정',
  OPEN: '진행 중',
  ENDED: '끝남',
  CANCELLED: '취소됨',
  END_UNDEFINED: '끝 시각 없음',
  /** 원장 상태값이 아는 어휘 밖 — 추정해 진행 중/끝남으로 그리지 않는다 */
  UNKNOWN: '상태 확인 불가',
};
export const JOURNEY_EPISODE_END_REASONS = ['OUTPATIENT_NOT_PAID', 'DEPARTURE_NOT_RECORDED'] as const;
export type JourneyEpisodeEndReason = (typeof JOURNEY_EPISODE_END_REASONS)[number];
export const JOURNEY_EPISODE_END_REASON_TEXT: Readonly<Record<JourneyEpisodeEndReason, string>> = {
  OUTPATIENT_NOT_PAID: '외래 방문의 끝(수납 완료)이 아직 없습니다 — 수납 전이거나 미수입니다',
  DEPARTURE_NOT_RECORDED: '응급실 퇴실 시각이 기록되지 않았습니다(자동 종결·퇴실 시각 기록 이전 방문)',
};

export const JOURNEY_EPISODE_MILESTONES = ['DISPOSITION', 'SCHEDULED', 'RESERVED_DATE'] as const;
export type JourneyEpisodeMilestone = (typeof JOURNEY_EPISODE_MILESTONES)[number];
export const JOURNEY_EPISODE_MILESTONE_LABEL: Readonly<Record<JourneyEpisodeMilestone, string>> = {
  DISPOSITION: '처분 결정',
  SCHEDULED: '예정',
  /** 날짜만(@db.Date) — `at` 은 YYYY-MM-DD */
  RESERVED_DATE: '예약일',
};

export interface JourneyEpisodeSummary {
  type: JourneyObjectType;
  id: string;
  /** 과·병동·술식·프로그램 — 원장에 있는 것만 */
  title: string | null;
  startAt: string | null;
  endAt: string | null;
  state: JourneyEpisodeState;
  endUnavailableReason: JourneyEpisodeEndReason | null;
  /** 끝은 아니지만 방문 안의 결정·예정 시각(응급 처분 등) — 끝처럼 그리지 않는다 · 문장은 화면이 `JOURNEY_EPISODE_MILESTONE_LABEL` 로 */
  milestone: { kind: JourneyEpisodeMilestone; at: string } | null;
  /** 원장 상태값 그대로(표시는 state) */
  domainStatus: string | null;
}
