/**
 * 방문 묶음(2026-10-01 · 여정 P3 표시 잔여) — 환자의 방문 단위를 **도메인 원장**에서 요약한다.
 *
 * 여정 원장은 지표·요약의 정본이 아니다(기획 §5.10) — 시작·끝·상태는 각 방문 원장의 필드에서 읽는다.
 * 🔴 끝을 지어내지 않는다(2026-10-03 결정):
 *    · 외래 — 끝 = **수납 완료**(D8 `journey.outpatientEnd` = BILLING_PAID · 그 진료의 수납 paidAt). 대기열 완료 시각을 끝으로 그리지 않는다 ·
 *      수납 전·미수면 끝 없음(이유 OUTPATIENT_NOT_PAID).
 *    · 응급 — 끝 = **퇴실 시각**(D9 = `EmergencyVisit.departedAt`). 처분 시각은 **결정 시각**이지 퇴실이 아니다(milestone) ·
 *      퇴실 시각 없이 종결된 방문(자동 종결·기록 이전)은 끝 없음(이유 DEPARTURE_NOT_RECORDED).
 * 🔴 모르는 상태값은 진행 중/끝남으로 추정하지 않는다(UNKNOWN).
 */
import type { JourneyEpisodeEndReason, JourneyEpisodeState, JourneyEpisodeSummary } from '@hospital-run/shared';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** 외래 끝으로 인정하는 수납 상태 — 수납 완료 뒤 환불돼도 방문이 끝난 사실은 그대로다 */
export const OUTPATIENT_END_BILLING_STATUSES = ['PAID', 'REFUNDED'] as const;

/** 외래 끝 시각(D8) — 그 진료의 수납 완료 시각 · 접수보다 앞이면(데이터 결함) 끝으로 쓰지 않는다 */
export function outpatientEndAt(q: { checkedInAt: Date }, billing: { status: string; paidAt: Date | null } | null | undefined): Date | null {
  if (!billing?.paidAt || !(OUTPATIENT_END_BILLING_STATUSES as readonly string[]).includes(billing.status)) return null;
  return billing.paidAt.getTime() >= q.checkedInAt.getTime() ? billing.paidAt : null;
}

export function outpatientEpisode(q: { id: string; departmentName: string; status: string; checkedInAt: Date; billing?: { status: string; paidAt: Date | null } | null }): JourneyEpisodeSummary {
  const open = ['WAITING', 'CALLED', 'IN_CONSULTATION', 'CASHIER_WAITING', 'PHARMACY_WAITING'];
  const done = ['COMPLETED', 'VISIT_COMPLETED'];
  const endAt = outpatientEndAt(q, q.billing);
  const state: JourneyEpisodeState = ['CANCELLED', 'NO_SHOW'].includes(q.status) ? 'CANCELLED'
    : endAt ? 'ENDED'
    : open.includes(q.status) ? 'OPEN' : done.includes(q.status) ? 'END_UNDEFINED' : 'UNKNOWN';
  return {
    type: 'WaitingQueue', id: q.id, title: q.departmentName || null, startAt: iso(q.checkedInAt), endAt: state === 'ENDED' ? iso(endAt) : null, state,
    endUnavailableReason: state === 'END_UNDEFINED' ? 'OUTPATIENT_NOT_PAID' : null, milestone: null, domainStatus: q.status,
  };
}

export function emergencyEpisode(v: { id: string; status: string; arrivalAt: Date; disposition: string | null; dispositionAt: Date | null; departedAt?: Date | null }): JourneyEpisodeSummary {
  const known = ['PENDING_TRIAGE', 'TRIAGED', 'PENDING_DOCTOR', 'IN_TREATMENT', 'PENDING_RESULT', 'UNDER_OBSERVATION', 'PENDING_DISPOSITION'];
  const departed = v.departedAt && v.departedAt.getTime() >= v.arrivalAt.getTime() ? v.departedAt : null;
  const state: JourneyEpisodeState = v.status === 'COMPLETED' ? (departed ? 'ENDED' : 'END_UNDEFINED') : known.includes(v.status) ? 'OPEN' : 'UNKNOWN';
  const reason: JourneyEpisodeEndReason | null = state === 'END_UNDEFINED' ? 'DEPARTURE_NOT_RECORDED' : null;
  return {
    type: 'EmergencyVisit', id: v.id, title: null, startAt: iso(v.arrivalAt), endAt: state === 'ENDED' ? iso(departed) : null, state, endUnavailableReason: reason,
    milestone: v.dispositionAt ? { kind: 'DISPOSITION', at: v.dispositionAt.toISOString() } : null, domainStatus: v.status,
  };
}

export function admissionEpisode(a: { id: string; status: string; admitDate: Date; dischargeDate: Date | null; wardName: string | null }): JourneyEpisodeSummary {
  const state: JourneyEpisodeState = a.status === 'ADMITTED' ? 'OPEN'
    : a.status === 'CANCELLED' ? 'CANCELLED'
    : (a.status === 'DISCHARGED' || a.status === 'TRANSFERRED') ? (a.dischargeDate ? 'ENDED' : 'UNKNOWN') : 'UNKNOWN';
  return {
    type: 'Admission', id: a.id, title: a.wardName, startAt: iso(a.admitDate), endAt: state === 'ENDED' ? iso(a.dischargeDate) : null,
    state, endUnavailableReason: null, milestone: null, domainStatus: a.status,
  };
}

export function surgeryEpisode(s: { id: string; status: string; procedureName: string; scheduledAt: Date; startedAt: Date | null; endedAt: Date | null }): JourneyEpisodeSummary {
  const state: JourneyEpisodeState = s.status === 'SCHEDULED' ? 'PLANNED' : s.status === 'IN_PROGRESS' ? 'OPEN'
    : s.status === 'CANCELLED' ? 'CANCELLED' : s.status === 'COMPLETED' ? (s.endedAt ? 'ENDED' : 'UNKNOWN') : 'UNKNOWN';
  return {
    type: 'Surgery', id: s.id, title: s.procedureName || null,
    // 시작·끝은 수술실 기록 버튼 시각(절개·봉합 아님 — "수술 시간" 정의는 D10)
    startAt: iso(s.startedAt), endAt: state === 'ENDED' ? iso(s.endedAt) : null, state, endUnavailableReason: null,
    milestone: state === 'PLANNED' ? { kind: 'SCHEDULED', at: s.scheduledAt.toISOString() } : null, domainStatus: s.status,
  };
}

export function checkupEpisode(c: { id: string; status: string; scheduledDate: Date; checkedInAt: Date | null; completedAt: Date | null; programName: string | null }): JourneyEpisodeSummary {
  // 생애주기는 검진 원장 정본(`checkup.service.ts` 전이표): 검사완료·부분완료·판정 중은 아직 진행 중 · 완료·통보는 끝(검진 서비스도 같이 센다)
  const open = ['CHECKED_IN', 'IN_PROGRESS', 'EXAM_COMPLETE', 'PARTIAL_COMPLETE', 'REVIEW'];
  const state: JourneyEpisodeState = c.status === 'RESERVED' ? 'PLANNED'
    : open.includes(c.status) ? 'OPEN'
    : (c.status === 'COMPLETED' || c.status === 'DELIVERED') ? (c.completedAt ? 'ENDED' : 'UNKNOWN')
    : (c.status === 'CANCELLED' || c.status === 'NO_SHOW') ? 'CANCELLED' : 'UNKNOWN';
  return {
    type: 'CheckupVisit', id: c.id, title: c.programName, startAt: iso(c.checkedInAt), endAt: state === 'ENDED' ? iso(c.completedAt) : null,
    state, endUnavailableReason: null,
    // 예약일은 날짜만(@db.Date) — 시각처럼 그리지 않도록 날짜 문자열로
    milestone: state === 'PLANNED' ? { kind: 'RESERVED_DATE', at: c.scheduledDate.toISOString().slice(0, 10) } : null, domainStatus: c.status,
  };
}

/** 정렬 키 — 시작(없으면 예정) 최신순 */
export function episodeSortKey(e: JourneyEpisodeSummary): number {
  const t = e.startAt ?? e.milestone?.at ?? null;
  return t ? Date.parse(t) : 0;
}
