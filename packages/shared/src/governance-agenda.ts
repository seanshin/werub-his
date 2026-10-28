/**
 * 위원회 안건 상태 라벨 정본(2026-10-07) — 거버넌스 화면과, 기능 화면에서 올린 안건 표시가 같은 말을 쓰게.
 * 어휘는 api `CommitteeAgenda.status`(SUBMITTED·SCHEDULED·RESOLVED·REJECTED·DEFERRED·WITHDRAWN).
 */
export const AGENDA_STATUSES = ['SUBMITTED', 'SCHEDULED', 'RESOLVED', 'REJECTED', 'DEFERRED', 'WITHDRAWN'] as const;
export type AgendaStatus = (typeof AGENDA_STATUSES)[number];
export const AGENDA_STATUS_LABEL: Record<AgendaStatus, string> = {
  SUBMITTED: '접수', SCHEDULED: '상정', RESOLVED: '의결', REJECTED: '부결', DEFERRED: '보류', WITHDRAWN: '철회',
};
/** 아직 위원회가 결론 내지 않은 안건 */
export const OPEN_AGENDA_STATUSES: readonly AgendaStatus[] = ['SUBMITTED', 'SCHEDULED', 'DEFERRED'];
