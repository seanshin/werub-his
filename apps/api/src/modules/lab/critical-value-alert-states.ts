/**
 * 위급값 경보(CriticalValueAlert) 상태 정본 — 클로즈드루프 상태기계(agent-emr-alignment.plan.md §4.1 · 2단계 2-1).
 *
 * 기획서 어휘: DETECTED → NOTIFIED → ACK → ACTED → CLOSED (+ ESCALATED 크론).
 * 저장 어휘와의 대응 — 🔴 이름을 새로 짓지 않고, 이미 원장에 있는 값을 유지한다(일어난 사실은 소급하지 않는다).
 *
 * | 기획서     | 저장값        | 비고 |
 * |-----------|--------------|------|
 * | DETECTED  | PENDING      | 탐지와 통보가 **한 값**이다 — `notifiedAt` 은 탐지 시각이고 실제 발송은 fire-and-forget 이다 |
 * | NOTIFIED  | (PENDING)    | "통보됨"을 따로 세울 근거(도달 기록)가 없다. 도달을 모르는데 NOTIFIED 로 적으면 거짓 원장이다 |
 * | ESCALATED | ESCALATED    | 허용시간(`lab.criticalValue.escalateAfterMinutes`) 초과 미확인 — **크론만** 전이. 미설정이면 전이 없음 |
 * | ACK       | ACKNOWLEDGED | 기존 값 그대로(read-back 검증·대리 확인 사유) |
 * | ACTED     | ACTED        | 확인 이후 조치 기록 |
 * | CLOSED    | CLOSED       | 조치 이후 종결 |
 */
export const CRITICAL_ALERT_STATUSES = ['PENDING', 'ESCALATED', 'ACKNOWLEDGED', 'ACTED', 'CLOSED'] as const;
export type CriticalAlertStatus = (typeof CRITICAL_ALERT_STATUSES)[number];

/**
 * 아직 아무도 확인하지 않은 경보 — "미확인"을 세는 모든 곳(배너·보드·포털 수치 마스킹·지표·감시자)이 이 집합을 쓴다.
 * 🔴 `status: 'PENDING'` 만 보면 상향 보고된(ESCALATED) 경보가 **미확인 목록에서 사라지고 포털 마스킹이 풀린다** —
 *    가장 급한 경보가 가장 먼저 안 보이게 된다.
 */
export const CRITICAL_ALERT_OPEN_STATUSES: CriticalAlertStatus[] = ['PENDING', 'ESCALATED'];

/** 확인이 끝난 경보(이후 조치·종결 포함) — 복창 누락 지표의 분모·분자가 이 집합을 본다 */
export const CRITICAL_ALERT_ACKNOWLEDGED_STATUSES: CriticalAlertStatus[] = ['ACKNOWLEDGED', 'ACTED', 'CLOSED'];

/** 허용 전이표 — 여기 없는 전이는 400 */
export const CRITICAL_ALERT_TRANSITIONS: Readonly<Record<CriticalAlertStatus, readonly CriticalAlertStatus[]>> = {
  PENDING: ['ESCALATED', 'ACKNOWLEDGED'],
  ESCALATED: ['ACKNOWLEDGED'],
  ACKNOWLEDGED: ['ACTED'],
  ACTED: ['CLOSED'],
  CLOSED: [],
};

export function canTransitionCriticalAlert(from: string, to: CriticalAlertStatus): boolean {
  const allowed = CRITICAL_ALERT_TRANSITIONS[from as CriticalAlertStatus];
  return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * 허용시간(분) — 기관 파라미터. 🔴 기본값 없음(`null`) = 상향 보고하지 않는다.
 * 종전엔 보드가 `30` 을 하드코딩해 "30분 초과"를 정책인 척 그렸다 — 위원회가 정할 값을 코드가 정하지 않는다.
 */
export const CRITICAL_ALERT_ESCALATE_CONFIG_KEY = 'lab.criticalValue.escalateAfterMinutes';

/** config 값 → 양의 정수 분 또는 null(미설정·해석 불가). 해석 불가를 기본값으로 바꾸지 않는다. */
export function parseEscalateAfterMinutes(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}
