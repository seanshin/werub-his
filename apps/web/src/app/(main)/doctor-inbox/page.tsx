'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import {
  INBOX_CATEGORIES, INBOX_GROUPS, INBOX_LABEL, INBOX_ROLES, groupByPatient, inboxGrandTotal, summarizeConsults, summarizePharmacist, summarizePreOrders,
  summarizeRenewals, summarizeResults, summarizeVerbal, waitedMinutes, summarizeUnsigned, summarizeSentConsults, overdueOf,
  type InboxCategory, type InboxPatientItem, type InboxPatientRef, type InboxState,
} from '@/lib/doctor-inbox';
import { kstToday } from '@/lib/kst-today';
import { Duration, EmptyState, PatientName, StaffName } from '@/components/ui/display';
import { useAuthStore } from '@/stores/auth-store';
import { T, Tf } from '@/components/ui/i18n-text';
import ResultsInboxPage from '../results-inbox/page';
import VerbalOrdersPage from '../verbal-orders/page';
import RenewalsPage from '../renewals/page';
import PharmacistRepliesPage from '../pharmacist-replies/page';
import ConsultationsPage from '../consultations/page';
import { PREORDER_PENDING_KEY, PreOrderPendingPanel, fetchMyPendingPreOrders } from './PreOrderPendingPanel';
import { HandledTodayPanel, MY_FOLLOWUPS_KEY, SentConsultsPanel, UnsignedRecordsPanel, fetchMyFollowups } from './FollowupPanels';

/**
 * 의사 할 일함(1014) — 2026-10-07.
 *
 * 🔴 의사가 처리할 "줄어드는 목록"이 메뉴 여럿에 흩어져 **무엇이 몇 건 남았고 무엇부터 봐야 하는지** 한 번에 볼 수 없었다
 *    (결과 확인 1011 · 구두 처방 확인 1012 · 갱신 대기 1013 · 약사 회신 1217 · 사전처방은 목록 화면조차 없었다 · 협진은 협진 화면 안).
 * 여기서는 여섯을 한 화면에 센다 — 각 목록의 정본 EP 응답만 요약하고(같은 캐시 키), 목록은 그 화면 컴포넌트를 그대로 싣는다.
 * 보기 둘: **목록별**(카드 → 그 목록) · **환자별**(한 환자에게 걸린 일을 묶는다 — 받은 목록 안에서만, 잘렸으면 그렇다고).
 * 말하는 사실: 남은 건수 · 정본 목록이 이미 갖는 긴급 구분 · 가장 오래 기다린 시간 · 잘림.
 * 말하지 않는 것: "기한 초과" — 처리 기한은 원내 정책이고 등록된 기준이 없다. 조회 실패를 0건으로.
 */
export default function DoctorInboxPage() {
  const role = useAuthStore((st) => st.user?.role);
  // 🔴 권한 밖이면 부르지 않는다 — 종전엔 메뉴만 숨기고, 주소로 들어온 간호사에게 목록 EP 7개가 전부 403 이었다(카드 7개 "불러오지 못함")
  if (!role || !(INBOX_ROLES as readonly string[]).includes(role)) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border bg-white p-6 text-sm text-gray-600" data-inbox-forbidden>
        <p className="font-semibold text-gray-900"><T k="의사 할 일함" /></p>
        <p className="mt-1"><T k="처방의 본인의 목록이라 의사·관리자 계정에서만 엽니다. 이 계정에서는 목록을 부르지 않습니다." /></p>
      </div>
    );
  }
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-gray-50" />}>
      <DoctorInbox />
    </Suspense>
  );
}

const CONSULT_LIMIT = 50;
type P = { id?: string | null; mrn?: string | null; familyName?: string | null; givenName?: string | null } | null | undefined;
const ref = (p: P): InboxPatientRef | null =>
  p ? { id: p.id ?? null, mrn: p.mrn ?? null, familyName: p.familyName ?? null, givenName: p.givenName ?? null } : null;

/** 봉투가 한 겹이든 두 겹이든 — 목록 화면과 같은 풀기 */
function inner<X extends object>(raw: unknown, key: string): X | undefined {
  const r = (raw as { data?: unknown } | undefined)?.data as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return undefined;
  return (key in r ? r : (r as { data?: unknown }).data) as X | undefined;
}

type ResultsRes = { total: number; counts: { critical: number; abnormal: number; other: number }; items: { completedAt: string | null; severity: string; patient: P }[] };
type VerbalRes = { items: { createdAt: string; readBackConfirmedAt?: string | null; encounter?: { patient?: P } | null }[]; total: number; truncated: boolean };
type RenewRes = { items: { createdAt: string; bucket: string; dosing?: { endsAt: string | null }; encounter?: { patient?: P } }[]; counts: Record<'EXPIRED' | 'ENDING_SOON' | 'NO_END', number>; truncated: boolean };
type Intervention = { createdAt: string; patientId: string; patientName: string | null };
type Substitution = { requestedAt: string; originalPrescription?: { encounter?: { patient?: P } | null } | null };
type Consult = { createdAt: string; status: string; urgency?: string | null; encounter?: { patient?: P } | null };

function useInbox(on: boolean) {
  const poll = pollMs('normal');
  // 🔴 캐시 키·조회 함수는 각 목록 화면과 같다 — 목록에서 처리하면(무효화) 요약 수도 함께 줄어든다
  const results = useQuery({
    queryKey: ['results-inbox', 'summary'],
    queryFn: async () => {
      const r = await apiClient.get<unknown>('/api/v1/doctors/results-inbox?limit=100&offset=0');
      return ((r as { data?: unknown })?.data ?? r) as ResultsRes;
    },
    refetchInterval: poll, enabled: on,
  });
  const verbal = useQuery({ queryKey: ['verbal-cosign-pending'], queryFn: () => apiClient.get<{ data: unknown }>('/api/v1/prescriptions/verbal-cosign/pending'), refetchInterval: poll, enabled: on });
  const renewals = useQuery({ queryKey: ['renewals-due'], queryFn: () => apiClient.get<{ data: unknown }>('/api/v1/prescriptions/renewals/due'), refetchInterval: poll, enabled: on });
  const interventions = useQuery({
    queryKey: ['my-pharmacist-interventions'],
    queryFn: () => apiClient.get<{ data: Intervention[]; meta?: { truncated: boolean; limit: number } }>('/api/v1/pharmacist/interventions/mine'),
    refetchInterval: poll, enabled: on,
  });
  const substitutions = useQuery({ queryKey: ['my-substitutions'], queryFn: () => apiClient.get<{ data: Substitution[] }>('/api/v1/pharmacy/substitution/mine'), refetchInterval: poll, enabled: on });
  const preorders = useQuery({ queryKey: PREORDER_PENDING_KEY, queryFn: fetchMyPendingPreOrders, refetchInterval: poll, enabled: on });
  // 협진 화면의 '내게 온' 과 같은 키·같은 상한
  const consults = useQuery({ queryKey: ['inbox-consultations'], queryFn: () => apiClient.get<{ data: Consult[] }>(`/api/v1/consultations/inbox?limit=${CONSULT_LIMIT}`), refetchInterval: poll, enabled: on });
  // 나 기준 후속 일(미서명 기록·회신 도착한 내 협진·처리 기한) — 목록 패널과 같은 키
  const followups = useQuery({ queryKey: MY_FOLLOWUPS_KEY, queryFn: fetchMyFollowups, refetchInterval: poll, enabled: on });

  const now = Date.now();
  const today = kstToday();
  const st = <Q extends { isError: boolean; isLoading: boolean }>(q: Q, make: () => InboxState | undefined): InboxState =>
    q.isError ? 'failed' : q.isLoading ? 'loading' : (make() ?? 'failed');

  const vData = inner<VerbalRes>(verbal.data, 'items');
  const rData = inner<RenewRes>(renewals.data, 'items');
  const consultList = (() => {
    const d = (consults.data as { data?: unknown } | undefined)?.data;
    return Array.isArray(d) ? (d as Consult[]) : Array.isArray((d as { data?: unknown } | undefined)?.data) ? ((d as { data: Consult[] }).data) : undefined;
  })();

  const states: Record<InboxCategory, InboxState> = {
    results: st(results, () => (results.data && typeof results.data.total === 'number' ? summarizeResults(results.data) : undefined)),
    verbal: st(verbal, () => (vData && Array.isArray(vData.items) ? summarizeVerbal(vData) : undefined)),
    renewals: st(renewals, () => (rData && Array.isArray(rData.items) && rData.counts ? summarizeRenewals(rData) : undefined)),
    // 둘 중 하나라도 실패하면 약사 회신 전체를 실패로(반쪽 수를 전체로 말하지 않는다)
    pharmacist: interventions.isError || substitutions.isError ? 'failed'
      : interventions.isLoading || substitutions.isLoading ? 'loading'
        : Array.isArray(interventions.data?.data) && Array.isArray(substitutions.data?.data)
          ? summarizePharmacist(interventions.data!.data, substitutions.data!.data, !!interventions.data?.meta?.truncated)
          : 'failed',
    preorders: st(preorders, () => (preorders.data ? summarizePreOrders(preorders.data, now, today) : undefined)),
    consults: st(consults, () => (consultList ? summarizeConsults(consultList, CONSULT_LIMIT) : undefined)),
    unsigned: st(followups, () => (followups.data ? summarizeUnsigned(followups.data) : undefined)),
    sentConsults: st(followups, () => (followups.data ? summarizeSentConsults(followups.data) : undefined)),
  };

  // 환자별 — 받은 목록 안의 항목만(정본 응답 그대로 · 긴급은 각 목록의 구분)
  const items: InboxPatientItem[] = [];
  if (typeof states.results === 'object') for (const i of results.data!.items ?? []) items.push({ category: 'results', patient: ref(i.patient), at: i.completedAt, urgent: i.severity === 'CRITICAL' });
  if (typeof states.verbal === 'object') for (const i of vData!.items) items.push({ category: 'verbal', patient: ref(i.encounter?.patient), at: i.createdAt, urgent: !i.readBackConfirmedAt });
  if (typeof states.renewals === 'object') for (const i of rData!.items) items.push({ category: 'renewals', patient: ref(i.encounter?.patient), at: i.dosing?.endsAt ?? i.createdAt, urgent: i.bucket === 'EXPIRED' });
  if (typeof states.pharmacist === 'object') {
    // 중재 응답은 이름을 한 덩어리(patientName)로 준다 — 성·이름으로 쪼개지 않고 그대로 싣는다
    for (const i of interventions.data!.data) items.push({ category: 'pharmacist', patient: { id: i.patientId, mrn: null, familyName: i.patientName, givenName: null }, at: i.createdAt, urgent: false });
    for (const s of substitutions.data!.data) items.push({ category: 'pharmacist', patient: ref(s.originalPrescription?.encounter?.patient), at: s.requestedAt, urgent: false });
  }
  if (typeof states.preorders === 'object') for (const p of preorders.data!) items.push({ category: 'preorders', patient: ref(p.patient), at: p.createdAt, urgent: !!p.expiresAt && Date.parse(p.expiresAt) < now });
  if (typeof states.consults === 'object') for (const c of consultList!.filter((x) => x.status === 'REQUESTED' || x.status === 'ACCEPTED')) items.push({ category: 'consults', patient: ref(c.encounter?.patient), at: c.createdAt, urgent: c.urgency === 'EMERGENT' || c.urgency === 'URGENT' });
  if (typeof states.unsigned === 'object' && followups.data) {
    for (const e of followups.data.unsignedEncounters.items) items.push({ category: 'unsigned', patient: ref(e.patient), at: e.createdAt, urgent: false });
    for (const d of followups.data.unsignedDischargeSummaries.items) items.push({ category: 'unsigned', patient: ref(d.admission?.patient), at: d.createdAt, urgent: d.admission?.status === 'DISCHARGED' });
    for (const c of followups.data.repliedConsults.items) items.push({ category: 'sentConsults', patient: ref(c.encounter?.patient), at: c.repliedAt, urgent: c.urgency === 'EMERGENT' || c.urgency === 'URGENT' });
  }
  const missing = INBOX_CATEGORIES.filter((c) => typeof states[c] !== 'object');
  const truncatedCats = INBOX_CATEGORIES.filter((c) => typeof states[c] === 'object' && (states[c] as { truncated: boolean }).truncated);

  // 처리 기한 — 원내 정책(설정 doctor.inbox.dueHours) · 'loading'/'failed'/값 — 미설정은 null
  const dueHours: number | null | 'loading' | 'failed' = followups.isError ? 'failed' : followups.isLoading ? 'loading' : (followups.data?.policy?.dueHours ?? null);
  return { states, now, patients: groupByPatient(items), missing, truncatedCats, dueHours };
}

function DoctorInbox() {
  const router = useRouter();
  const params = useSearchParams();
  const user = useAuthStore((st) => st.user);
  const { states, now, patients, missing, truncatedCats, dueHours } = useInbox(true);
  const due = typeof dueHours === 'number' ? dueHours : null;
  const viewParam = params.get('view');
  const view = viewParam === 'patients' ? 'patients' : viewParam === 'handled' ? 'handled' : 'lists';
  const tabParam = params.get('tab') as InboxCategory | null;
  const tab: InboxCategory = tabParam && INBOX_CATEGORIES.includes(tabParam) ? tabParam : 'results';
  const grand = inboxGrandTotal(INBOX_CATEGORIES.map((c) => states[c]));
  const go = (q: string) => router.replace(`/doctor-inbox?${q}`, { scroll: false });
  // 먼저 볼 것 — 각 목록의 긴급 구분 중 0 이 아닌 것만(정본 구분 그대로 · 새 기준 없음)
  const firsts = INBOX_CATEGORIES.flatMap((c) => {
    const s = states[c];
    return typeof s === 'object' ? s.urgent.filter((u) => u.count > 0).map((u) => ({ c, ...u })) : [];
  });

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900"><T k="의사 할 일함" /></h2>
          <p className="mt-1 text-sm text-gray-500">
            {grand != null
              ? <span data-inbox-grand={grand}><Tf k="남은 일 {n}건" params={{ n: grand }} /></span>
              : <span data-inbox-grand="unknown"><T k="일부 목록을 아직 확인하지 못해 전체 건수를 말하지 않습니다" /></span>}
            {' · '}<T k="처리하면 목록에서 사라집니다." />{' '}
            {/* 🔴 처리 기한은 원내 정책(설정 doctor.inbox.dueHours) — 미설정이면 늦음을 판정하지 않고 그렇게 말한다 */}
            <span data-inbox-due={typeof dueHours === 'number' ? dueHours : dueHours ?? 'unset'}>
              {typeof dueHours === 'number' ? <Tf k="처리 기한 {h}시간(원내 설정) — 가장 오래 기다린 항목으로 넘김을 표시합니다" params={{ h: dueHours }} />
                : dueHours === 'loading' ? null
                  : dueHours === 'failed' ? <T k="처리 기한 설정을 확인하지 못해 늦음을 판정하지 않습니다" />
                    : <T k="처리 기한(늦음)은 판정하지 않습니다 — 원내 기준이 설정되지 않았습니다(시스템 설정 doctor.inbox.dueHours)." />}
            </span>
            {user?.role === 'ADMIN' && dueHours !== 'loading' && (
              <Link href="/admin/ai-settings" className="ml-1 text-blue-700 underline" data-inbox-due-settings><T k="처리 기한 설정" /></Link>
            )}
          </p>
          {/* 🔴 누구의 목록인가 — 서버는 모든 목록을 "로그인한 사람 본인"으로 좁힌다(다른 의사의 일을 대신 보는 화면이 아니다) */}
          <p className="mt-1 text-xs text-gray-600" data-inbox-scope={user?.role ?? ''}>
            <T k="기준: 로그인한 본인" /> — <b>{user ? <StaffName familyName={user.familyName} givenName={user.givenName} role={user.role} /> : '-'}</b>
            {' · '}<T k="내가 처방했거나 담당한 진료·내가 받은 요청만 셉니다" />
          </p>
          {user?.role === 'ADMIN' && (
            <p className="mt-1 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800" data-inbox-admin-note>
              <T k="관리자 계정입니다 — 관리자 이름으로 기록된 처방·진료가 있으면 그 건이 보입니다. 다른 의사의 할 일을 모아 보는 화면이 아닙니다." />
            </p>
          )}
        </div>
        <div className="flex rounded-lg border bg-white p-0.5 text-xs" role="tablist" aria-label="보기">
          {(['lists', 'patients', 'handled'] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} data-inbox-view={v}
              onClick={() => go(v === 'patients' ? 'view=patients' : v === 'handled' ? 'view=handled' : `tab=${tab}`)}
              className={`min-h-[36px] rounded-md px-3 font-semibold ${view === v ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              <T k={v === 'lists' ? '목록별' : v === 'patients' ? '환자별' : '처리한 것'} />
            </button>
          ))}
        </div>
      </div>

      {firsts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-red-100 bg-red-50/50 px-3 py-2" data-inbox-firsts>
          <span className="text-xs font-bold text-red-800"><T k="먼저 볼 것" /></span>
          {firsts.map((f) => (
            <button key={`${f.c}-${f.label}`} type="button" onClick={() => go(`tab=${f.c}`)} data-inbox-first={f.c}
              className="min-h-[32px] rounded-lg bg-white px-2 text-xs font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50">
              <T k={INBOX_LABEL[f.c]} /> · <T k={f.label} /> {f.count}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* 왼쪽 — 묶음(결과·처방·협업)별 목록 · 각 목록의 구분과 가장 오래 기다린 시간 */}
        <nav className="space-y-3 lg:sticky lg:top-4 lg:self-start" aria-label="할 일 목록" role="tablist">
          {INBOX_GROUPS.map((g) => (
            <div key={g.key} data-inbox-group={g.key}>
              <p className="mb-1 px-1 text-[11px] font-bold uppercase tracking-wide text-gray-500"><T k={g.label} /></p>
              <div className="space-y-1.5">
                {g.categories.map((c) => <CategoryCard key={c} c={c} s={states[c]} active={view === 'lists' && c === tab} now={now} dueHours={due} onClick={() => go(`tab=${c}`)} />)}
              </div>
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          {view === 'handled' ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-4"><HandledTodayPanel today={kstToday()} /></div>
          ) : view === 'patients' ? (
            <PatientView rows={patients.rows} unattributed={patients.unattributed} missing={missing} truncated={truncatedCats} now={now}
              focus={params.get('patient')} onClearFocus={() => go('view=patients')}
              onOpen={(c, pid) => go(c === 'results' && pid ? `tab=results&patientId=${pid}` : `tab=${c}`)} />
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white p-4" role="tabpanel" data-inbox-panel={tab}>
              {/* 목록 화면은 자기 폭 제한(max-w)을 갖는다 — 할 일함 안에서는 패널 폭을 다 쓴다 */}
              <div className="[&>*]:!max-w-none [&>*]:!mx-0">
                {tab === 'results' && <ResultsInboxPage />}
                {tab === 'verbal' && <VerbalOrdersPage />}
                {tab === 'renewals' && <RenewalsPage />}
                {tab === 'pharmacist' && <PharmacistRepliesPage />}
                {tab === 'preorders' && <PreOrderPendingPanel />}
                {tab === 'consults' && <ConsultationsPage />}
                {tab === 'unsigned' && <UnsignedRecordsPanel />}
                {tab === 'sentConsults' && <SentConsultsPanel />}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryCard({ c, s, active, now, dueHours, onClick }: { c: InboxCategory; s: InboxState; active: boolean; now: number; dueHours: number | null; onClick: () => void }) {
  const urgentN = typeof s === 'object' ? s.urgent.reduce((a, u) => a + u.count, 0) : 0;
  const waited = typeof s === 'object' ? waitedMinutes(s.oldestAt, now) : null;
  const overdue = typeof s === 'object' && s.total > 0 ? overdueOf(s.oldestAt, dueHours, now) : null;
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} data-inbox-card={c}
      className={`block w-full min-h-[44px] rounded-xl border px-3 py-2 text-left transition-colors ${active ? 'border-blue-500 bg-blue-50/70 ring-1 ring-blue-300' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-800"><T k={INBOX_LABEL[c]} /></span>
        {s === 'loading' ? <span className="h-5 w-8 animate-pulse rounded bg-gray-100" />
          : s === 'failed' ? null
            : (
              <span className="flex items-baseline gap-1">
                {urgentN > 0 && <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white" data-inbox-urgent={urgentN}>{urgentN}</span>}
                <span className="text-lg font-bold text-gray-900" data-inbox-total={s.total}>{s.total}{s.truncated && <span className="text-xs text-amber-700">+</span>}</span>
              </span>
            )}
      </div>
      {s === 'failed' ? <p className="mt-1 text-xs font-semibold text-red-700" data-inbox-failed={c}><T k="목록을 불러오지 못했습니다 — 0건이 아닙니다" /></p>
        : typeof s === 'object' && (
          <>
            {s.total > 0 && (
              <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                {s.urgent.map((u) => (
                  <span key={u.label} className={`rounded px-1.5 py-0.5 ${u.count > 0 ? 'bg-red-50 font-semibold text-red-700' : 'bg-gray-50 text-gray-400'}`}><T k={u.label} /> {u.count}</span>
                ))}
                {s.other.map((o) => <span key={o.label} className="rounded bg-gray-50 px-1.5 py-0.5 text-gray-600"><T k={o.label} /> {o.count}</span>)}
              </div>
            )}
            <p className="mt-1 text-[11px] text-gray-500" data-inbox-oldest={c}>
              {s.total === 0 ? <T k="남은 일 없음" />
                : waited != null ? <><T k="가장 오래 기다림" /> <Duration minutes={waited} dense />{overdue && <span className="ml-1 rounded bg-red-600 px-1 font-semibold text-white" data-inbox-overdue={c}><T k="기한 넘김" /></span>}</>
                  : <T k="가장 오래 기다린 시간은 모릅니다(목록이 잘렸거나 시각 없음)" />}
              {s.truncated && <span className="ml-1 text-amber-700"><T k="상한으로 잘림" /></span>}
            </p>
          </>
        )}
    </button>
  );
}

function PatientView({ rows: allRows, unattributed, missing, truncated, now, focus, onClearFocus, onOpen }: {
  rows: ReturnType<typeof groupByPatient>['rows'];
  unattributed: number;
  missing: InboxCategory[];
  truncated: InboxCategory[];
  now: number;
  /** 차트에서 들어온 환자(id) — 그 환자만 */
  focus: string | null;
  onClearFocus: () => void;
  onOpen: (c: InboxCategory, patientId: string | null) => void;
}) {
  const rows = focus ? allRows.filter((r) => r.patient.id === focus) : allRows;
  return (
    <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4" data-inbox-patients>
      {focus && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800" data-inbox-patient-focus={focus}>
          <T k="차트에서 온 환자만 봅니다" />
          <button type="button" onClick={onClearFocus} className="min-h-[28px] rounded border border-blue-200 bg-white px-2 font-semibold"><T k="전체 환자 보기" /></button>
        </p>
      )}
      {/* 무엇을 묶었는지 먼저 말한다 — 못 받은 목록·잘린 목록은 이 보기에서 빠지거나 일부만 있다 */}
      {missing.length > 0 && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" data-inbox-patients-missing>
          <T k="아직 받지 못한 목록은 이 보기에 없습니다:" /> {missing.map((c, i) => <span key={c}>{i > 0 && ' · '}<T k={INBOX_LABEL[c]} /></span>)}
        </p>
      )}
      {truncated.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" data-inbox-patients-truncated>
          <T k="상한으로 잘린 목록은 받은 만큼만 묶었습니다:" /> {truncated.map((c, i) => <span key={c}>{i > 0 && ' · '}<T k={INBOX_LABEL[c]} /></span>)}
        </p>
      )}
      {rows.length === 0 ? <EmptyState icon="✅" title={focus ? '받은 목록에는 이 환자에게 걸린 내 할 일이 없습니다' : missing.length ? '받은 목록에는 환자별로 묶을 일이 없습니다' : '남은 일이 없습니다'} compact /> : (
        <ul className="divide-y">
          {rows.map((r) => {
            const waited = waitedMinutes(r.oldestAt, now);
            return (
              <li key={r.key} className="flex flex-wrap items-center gap-3 py-2.5" data-inbox-patient={r.key}>
                <div className="min-w-[10rem] flex-1">
                  <p className="text-sm font-semibold text-gray-900">
                    {r.patient.id
                      ? <Link href={`/patients/${r.patient.id}`} className="hover:underline" data-inbox-patient-chart={r.patient.id}><PatientName familyName={r.patient.familyName} givenName={r.patient.givenName} mrn={r.patient.mrn} /></Link>
                      : <PatientName familyName={r.patient.familyName} givenName={r.patient.givenName} mrn={r.patient.mrn} />}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    <Tf k="{n}건" params={{ n: r.total }} />
                    {r.urgent > 0 && <span className="ml-1 font-semibold text-red-700" data-inbox-patient-urgent={r.urgent}><Tf k="긴급 {n}" params={{ n: r.urgent }} /></span>}
                    {waited != null && <> · <T k="가장 오래 기다림" /> <Duration minutes={waited} dense /></>}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {INBOX_CATEGORIES.filter((c) => r.counts[c]).map((c) => (
                    <button key={c} type="button" onClick={() => onOpen(c, r.patient.id)} data-inbox-patient-chip={c}
                      className="min-h-[32px] rounded-lg border border-gray-200 bg-gray-50 px-2 text-[11px] text-gray-700 hover:bg-gray-100">
                      <T k={INBOX_LABEL[c]} /> {r.counts[c]}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {unattributed > 0 && (
        <p className="text-[11px] text-gray-500" data-inbox-unattributed={unattributed}>
          <Tf k="환자 식별(id·등록번호)이 없는 항목 {n}건은 묶지 않았습니다 — 목록별 보기에 있습니다" params={{ n: unattributed }} />
        </p>
      )}
    </section>
  );
}

