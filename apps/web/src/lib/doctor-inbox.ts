/**
 * 의사 할 일함(2026-10-07) — 검사결과 확인·구두/전화 처방 확인·처방 갱신·약사 회신을 **한 곳에서** 센다.
 *
 * 🔴 정본은 각 목록이다 — 여기는 그 목록들이 이미 부르는 EP 응답을 **요약만** 한다(같은 사실에 두 번째 산식을 두지 않는다).
 *    목록 화면도 그대로 쓴다(할 일함이 그 컴포넌트를 탭으로 싣는다).
 * 요약은 3상태 — 조회 중(null 이 아니라 'loading')·실패('failed')·값. **실패를 0건으로 말하지 않는다.**
 * "늦었다"는 판정은 하지 않는다 — 처리 기한은 원내 정책이고 등록된 기준이 없다. 가장 오래 기다린 시간(사실)만 말한다.
 */

export type InboxCategory = 'results' | 'verbal' | 'renewals' | 'pharmacist' | 'preorders' | 'consults' | 'unsigned' | 'sentConsults';
export const INBOX_CATEGORIES: InboxCategory[] = ['results', 'verbal', 'renewals', 'pharmacist', 'preorders', 'consults', 'unsigned', 'sentConsults'];
export const INBOX_LABEL: Record<InboxCategory, string> = {
  results: '검사결과 확인',
  verbal: '구두·전화 처방 확인',
  renewals: '처방 갱신 대기',
  pharmacist: '약사 회신 요청',
  preorders: '사전처방 승인 대기',
  consults: '협진 회신 대기',
  unsigned: '미서명 기록',
  sentConsults: '회신 도착한 내 협진',
};

/** 화면 묶음 — 결과(확인할 것) · 처방(내가 낸 처방의 후속) · 협업(다른 직종·과가 기다리는 회신) */
export const INBOX_GROUPS: { key: 'result' | 'order' | 'record' | 'collab'; label: string; categories: InboxCategory[] }[] = [
  { key: 'result', label: '결과', categories: ['results'] },
  { key: 'order', label: '처방', categories: ['verbal', 'renewals', 'preorders'] },
  { key: 'record', label: '기록', categories: ['unsigned'] },
  { key: 'collab', label: '협업', categories: ['pharmacist', 'consults', 'sentConsults'] },
];

/** 할 일함을 여는 역할 — 각 목록 EP 의 서버 @Roles(DOCTOR·ADMIN · RolesGuard 는 ADMIN 통과)와 같다 */
export const INBOX_ROLES = ['DOCTOR', 'ADMIN'] as const;

/** 긴급 표지 — 각 정본 목록이 이미 갖는 구분만(새 기준을 만들지 않는다) */
export interface InboxSummary {
  /** 남은 건수 */
  total: number;
  /** 먼저 볼 것(정본 구분) — 라벨과 수 */
  urgent: { label: string; count: number }[];
  /** 그 밖의 구분(정보) */
  other: { label: string; count: number }[];
  /** 가장 오래 기다린 항목의 시작 시각(ISO) — 목록이 시각을 주지 않으면 null(모른다) */
  oldestAt: string | null;
  /** 목록이 상한으로 잘렸으면 true — total 은 "적어도" */
  truncated: boolean;
}
export type InboxState = 'loading' | 'failed' | InboxSummary;

const minIso = (xs: (string | null | undefined)[]): string | null => {
  let best: string | null = null;
  for (const x of xs) {
    if (!x) continue;
    const t = Date.parse(x);
    if (Number.isNaN(t)) continue;
    if (best == null || t < Date.parse(best)) best = x;
  }
  return best;
};

/** 결과 확인함 응답(`doctors/results-inbox`) — 서버 counts 를 그대로 */
export function summarizeResults(r: { total: number; counts: { critical: number; abnormal: number; other: number }; items?: { completedAt: string | null }[] }): InboxSummary {
  return {
    total: r.total,
    urgent: [{ label: '위급', count: r.counts.critical }],
    other: [{ label: '이상', count: r.counts.abnormal }, { label: '그 외', count: r.counts.other }],
    // 결과 확인함은 위급·이상 순으로 자른다 — 다 받지 못했으면 가장 오래된 결과를 모른다(받은 것 중 최소를 전체로 말하지 않는다)
    oldestAt: (r.items?.length ?? 0) < r.total ? null : minIso((r.items ?? []).map((i) => i.completedAt)),
    truncated: (r.items?.length ?? 0) < r.total,
  };
}

/** 구두·전화 처방 확인(`prescriptions/verbal-cosign/pending`) */
export function summarizeVerbal(r: { items: { createdAt: string; readBackConfirmedAt?: string | null }[]; total: number; truncated: boolean }): InboxSummary {
  // 복창 기록 없음 — 받은 간호사의 복창 확인이 남지 않은 구두 처방(정본 필드 readBackConfirmedAt)
  const noReadBack = r.items.filter((i) => !i.readBackConfirmedAt).length;
  return {
    total: r.total,
    urgent: [{ label: '복창 기록 없음', count: noReadBack }],
    other: [],
    oldestAt: minIso(r.items.map((i) => i.createdAt)),
    truncated: r.truncated,
  };
}

/** 처방 갱신 대기(`prescriptions/renewals/due`) — 서버 버킷 그대로 */
export function summarizeRenewals(r: { items: { createdAt: string; dosing?: { endsAt: string | null } }[]; counts: Record<'EXPIRED' | 'ENDING_SOON' | 'NO_END', number>; truncated: boolean }): InboxSummary {
  return {
    total: r.counts.EXPIRED + r.counts.ENDING_SOON + r.counts.NO_END,
    urgent: [{ label: '만료됨', count: r.counts.EXPIRED }],
    other: [{ label: '곧 만료', count: r.counts.ENDING_SOON }, { label: '기간 없음', count: r.counts.NO_END }],
    // 만료된 처방은 "기간이 끝난 시각"부터 기다린 것이다 — 만료 건이 없으면 가장 오래된 처방 시각
    oldestAt: minIso(r.items.map((i) => i.dosing?.endsAt ?? null)) ?? minIso(r.items.map((i) => i.createdAt)),
    truncated: r.truncated,
  };
}

/** 약사 회신(`pharmacist/interventions/mine` + `pharmacy/substitution/mine`) — 둘 다 대기 건만 온다 */
export function summarizePharmacist(interventions: { createdAt: string }[], substitutions: { requestedAt: string }[], interventionsTruncated: boolean): InboxSummary {
  return {
    total: interventions.length + substitutions.length,
    urgent: [],
    other: [{ label: '중재 회신', count: interventions.length }, { label: '대체조제 승인', count: substitutions.length }],
    oldestAt: minIso([...interventions.map((i) => i.createdAt), ...substitutions.map((s) => s.requestedAt)]),
    truncated: interventionsTruncated,
  };
}

/** 경과 분 — 미래·해석 불가는 null(지어내지 않는다) */
export function waitedMinutes(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t > now) return null;
  return Math.floor((now - t) / 60000);
}

/** 할 일함 전체 — 하나라도 실패·조회 중이면 합계를 말하지 않는다(부분 합을 전체로 말하지 않는다) */
export function inboxGrandTotal(states: InboxState[]): number | null {
  let sum = 0;
  for (const s of states) {
    if (s === 'loading' || s === 'failed') return null;
    sum += s.total;
  }
  return sum;
}

/** 사전처방 승인 대기(`pre-orders/pending` — 내가 낸 PENDING) — 기록에 있는 시각만으로 구분 */
export function summarizePreOrders(items: { createdAt: string; scheduledDate?: string | null; expiresAt?: string | null }[], now: number, today: string): InboxSummary {
  // 만료 시각이 지났는데 아직 PENDING — 승인해도 쓸 수 없을 수 있다(서버 판정 아님 · 기록된 expiresAt 비교)
  const expired = items.filter((i) => i.expiresAt && Date.parse(i.expiresAt) < now).length;
  // 예정일(날짜)이 오늘보다 앞 — 예정일 문자열 비교(YYYY-MM-DD · KST 오늘)
  const pastScheduled = items.filter((i) => i.scheduledDate && i.scheduledDate.slice(0, 10) < today).length;
  const dueToday = items.filter((i) => i.scheduledDate && i.scheduledDate.slice(0, 10) === today).length;
  return {
    total: items.length,
    urgent: [{ label: '만료 시각 지남', count: expired }, { label: '예정일 지남', count: pastScheduled }],
    other: [{ label: '오늘 예정', count: dueToday }],
    oldestAt: minIso(items.map((i) => i.createdAt)),
    truncated: false,
  };
}

/** 협진 회신 대기(`consultations/inbox` — 내게 온 REQUESTED·ACCEPTED) · 상한까지 왔으면 잘렸을 수 있다 */
export function summarizeConsults(items: { createdAt: string; urgency?: string | null; status: string }[], limit: number): InboxSummary {
  const open = items.filter((i) => i.status === 'REQUESTED' || i.status === 'ACCEPTED');
  return {
    total: open.length,
    // 협진 의뢰서가 가진 긴급도 어휘(ROUTINE·URGENT·EMERGENT)만
    urgent: [{ label: '응급', count: open.filter((i) => i.urgency === 'EMERGENT').length }, { label: '긴급', count: open.filter((i) => i.urgency === 'URGENT').length }],
    other: [{ label: '접수함', count: open.filter((i) => i.status === 'ACCEPTED').length }],
    oldestAt: minIso(open.map((i) => i.createdAt)),
    truncated: items.length >= limit,
  };
}

// ── 환자별 묶어 보기 ──
export interface InboxPatientRef { id: string | null; mrn: string | null; familyName: string | null; givenName: string | null }
export interface InboxPatientItem { category: InboxCategory; patient: InboxPatientRef | null; at: string | null; urgent: boolean }
export interface InboxPatientRow {
  key: string;
  patient: InboxPatientRef;
  counts: Partial<Record<InboxCategory, number>>;
  total: number;
  urgent: number;
  oldestAt: string | null;
}

/**
 * 환자별로 묶는다 — 환자 id 가 있으면 id, 없으면 MRN 으로(대체조제 응답은 id 를 주지 않는다).
 * 둘 다 없는 항목은 묶지 않고 따로 센다(이름만으로 같은 사람이라 단정하지 않는다).
 * 정렬: 긴급 많은 순 → 건수 많은 순 → 오래 기다린 순.
 */
export function groupByPatient(items: InboxPatientItem[]): { rows: InboxPatientRow[]; unattributed: number } {
  const map = new Map<string, InboxPatientRow>();
  let unattributed = 0;
  for (const it of items) {
    const p = it.patient;
    const key = p?.id ? `id:${p.id}` : p?.mrn ? `mrn:${p.mrn}` : null;
    if (!key || !p) { unattributed++; continue; }
    let row = map.get(key);
    if (!row) { row = { key, patient: { ...p }, counts: {}, total: 0, urgent: 0, oldestAt: null }; map.set(key, row); }
    if (!row.patient.id && p.id) row.patient.id = p.id;
    row.counts[it.category] = (row.counts[it.category] ?? 0) + 1;
    row.total++;
    if (it.urgent) row.urgent++;
    row.oldestAt = minIso([row.oldestAt, it.at]);
  }
  const rows = [...map.values()].sort((a, b) =>
    b.urgent - a.urgent || b.total - a.total || (Date.parse(a.oldestAt ?? '9999') - Date.parse(b.oldestAt ?? '9999')));
  return { rows, unattributed };
}

// ── 내 후속 일(2026-10-10 · `doctors/my-followups`) ──

export interface MyFollowups {
  unsignedEncounters: { items: { id: string; createdAt: string; updatedAt: string; chiefComplaint: string | null; patient: InboxPatientRef | null }[]; total: number; truncated: boolean };
  unsignedDischargeSummaries: { items: { id: string; admissionId: string; createdAt: string; updatedAt: string; admission: { patient: InboxPatientRef | null; dischargeDate: string | null; status: string } | null }[]; total: number; truncated: boolean };
  repliedConsults: { items: { id: string; toDepartment: string; urgency: string | null; reason: string; replyContent: string | null; recommendations: string | null; repliedAt: string | null; createdAt: string; replyDoctor: { familyName: string | null; givenName: string | null } | null; encounter: { id: string; patient: InboxPatientRef | null } | null }[]; total: number; truncated: boolean };
  /** 처리 기한(시간) — 원내 정책 · 미설정이면 null(늦음 판정 없음) */
  policy: { dueHours: number | null };
  limit: number;
}

/** 미서명 기록 — 진료기록·퇴원요약 · 서버 전체 수 그대로(잘렸으면 truncated) */
export function summarizeUnsigned(f: MyFollowups): InboxSummary {
  const e = f.unsignedEncounters; const d = f.unsignedDischargeSummaries;
  return {
    total: e.total + d.total,
    // 퇴원한 환자의 퇴원요약이 아직 미서명 — 서식 정본 구분(상태 문자열)만
    urgent: [{ label: '퇴원 후 미서명 퇴원요약', count: d.items.filter((x) => x.admission?.status === 'DISCHARGED').length }],
    other: [{ label: '진료기록', count: e.total }, { label: '퇴원요약', count: d.total }],
    oldestAt: e.truncated || d.truncated ? null : minIso([...e.items.map((x) => x.createdAt), ...d.items.map((x) => x.createdAt)]),
    truncated: e.truncated || d.truncated,
  };
}

/** 회신 도착한 내 협진 — 읽고 종결하면 사라진다 · 기다림 = 회신 도착 이후 */
export function summarizeSentConsults(f: MyFollowups): InboxSummary {
  const c = f.repliedConsults;
  return {
    total: c.total,
    urgent: [{ label: '응급', count: c.items.filter((i) => i.urgency === 'EMERGENT').length }, { label: '긴급', count: c.items.filter((i) => i.urgency === 'URGENT').length }],
    other: [],
    oldestAt: c.truncated ? null : minIso(c.items.map((i) => i.repliedAt)),
    truncated: c.truncated,
  };
}

/**
 * 처리 기한 판정 — 🔴 기한이 미설정(null)이면 판정하지 않는다(null). 가장 오래 기다린 시간만으로 판정하므로
 * 그 시각을 모르면(잘림·시각 없음) 역시 null.
 */
export function overdueOf(oldestAt: string | null, dueHours: number | null, now: number): boolean | null {
  if (dueHours == null) return null;
  const m = waitedMinutes(oldestAt, now);
  return m == null ? null : m > dueHours * 60;
}
