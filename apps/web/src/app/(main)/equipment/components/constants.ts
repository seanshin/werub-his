/*
 * 🔴 장비 상태 라벨/색은 여기 있었지만 **DB enum 과 어휘가 달랐다**
 *    (표: ACTIVE·MAINTENANCE·INACTIVE·RETIRED / DB: ACTIVE·UNDER_MAINTENANCE·BROKEN·RETIRED).
 *    정비중·고장 장비가 영문 원문에 무채색으로 떴다 → shared 정본 + `<StatusBadge domain="equipment">`.
 */
export const LOG_TYPE_LABEL: Record<string, string> = {
  INSPECTION: '정기점검', CALIBRATION: '교정', REPAIR: '수리', FAULT_REPORT: '고장신고', AS_REQUEST: 'A/S 요청',
};
/** 정비/A/S 진행 상태 — 화면에 영문 원문(REQUESTED…)이 그대로 뜨던 것 */
export const LOG_STATUS_LABEL: Record<string, string> = {
  REQUESTED: '요청', IN_PROGRESS: '진행중', COMPLETED: '완료', CANCELLED: '취소',
};
export const LOG_STATUS_COLOR: Record<string, string> = {
  REQUESTED: 'bg-amber-50 text-amber-700', IN_PROGRESS: 'bg-blue-50 text-blue-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700', CANCELLED: 'bg-gray-100 text-gray-500',
};
export const INSP_TYPE_LABEL: Record<string, string> = { DAILY: '일일', WEEKLY: '주간', MONTHLY: '월간', QUARTERLY: '분기', ANNUAL: '연간' };
export const RESULT_COLOR: Record<string, string> = { PASS: 'bg-emerald-50 text-emerald-700', FAIL: 'bg-red-50 text-red-700', CONDITIONAL: 'bg-amber-50 text-amber-700' };
export const CONDITION_LABEL: Record<string, string> = { NORMAL: '정상', ISSUE: '이상감지', FAULT: '고장' };
export const CONDITION_COLOR: Record<string, string> = { NORMAL: 'text-emerald-600', ISSUE: 'text-amber-600', FAULT: 'text-red-600' };
