/**
 * CRM 자동 연락 크론의 정본 목록 — 크론 데코레이터·발송 기록 제목·현황 조회(`GET automation/reminders`)가 **같은 목록**을 본다.
 *
 * 🔴 (2026-09-14) 현황 EP 를 붙이면서 크론 이름·주기·기록 제목을 화면용으로 한 벌 더 적으면
 *    같은 사실에 정본이 둘이 된다(크론을 바꾸면 현황이 조용히 틀린다). 크론이 이 상수를 직접 쓴다.
 * 🔴 이 크론들은 **설정 게이트 없이 매일 돈다**(대외 발신 3조건 중 '설정 기본 OFF'·'승인'이 없다 — 채널이 운영 모드로만 막는다).
 *    현황 EP 는 그 사실을 그대로 말하고, 수동 실행(`POST automation/reminders/run`)은 만들지 않는다(사람 결정 — 정본 발송 경로·승인).
 */
export interface CrmOutboundJob {
  /** @Cron name — 크론 생존 감시와 같은 이름 */
  key: string;
  label: string;
  cron: string;
  /** PatientCommunicationLog.type */
  logType: 'REMINDER' | 'RECALL' | 'FOLLOW_UP';
  /** PatientCommunicationLog.subject — 발송 기록을 작업에 귀속시키는 열쇠 */
  subjects: readonly string[];
}

export const CRM_OUTBOUND_JOBS = {
  appointment: {
    key: 'crm-appointment-reminder', label: '예약 리마인더 D-1', cron: '0 9 * * *', logType: 'REMINDER',
    subjects: ['예약 리마인더'],
  },
  checkup: {
    key: 'crm-checkup-reminder', label: '검진 리마인더 D-7·D-1', cron: '30 9 * * *', logType: 'REMINDER',
    subjects: ['검진 리마인더 D-7', '검진 리마인더 D-1'],
  },
  dental: {
    key: 'crm-dental-recall', label: '치과 리콜 D-14', cron: '0 10 * * *', logType: 'RECALL',
    subjects: ['치과 리콜'],
  },
  foreign: {
    key: 'crm-foreign-followup', label: '해외환자 사후관리 D+1·7·30·180', cron: '0 11 * * *', logType: 'FOLLOW_UP',
    subjects: ['Satisfaction Survey (D+1)', 'Report Summary (D+7)', 'Follow-up Check (D+30)', 'Re-visit Invitation (D+180)'],
  },
} as const satisfies Record<string, CrmOutboundJob>;

export const CRM_OUTBOUND_JOB_LIST: readonly CrmOutboundJob[] = Object.values(CRM_OUTBOUND_JOBS);
