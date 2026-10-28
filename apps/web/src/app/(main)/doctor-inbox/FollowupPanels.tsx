'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { MyFollowups } from '@/lib/doctor-inbox';
import { EmptyState, KDate, PatientName, StaffName } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';

/**
 * 의사 할 일함 — 나 기준 목록 둘(2026-10-10). 정본 EP 하나(`doctors/my-followups`)를 요약과 목록이 같은 키로 쓴다.
 *  · 미서명 기록 — 진료기록(DRAFT)·퇴원요약(DRAFT) · 서명은 각 작성 화면에서(여기서 서명하지 않는다)
 *  · 회신 도착한 내 협진 — 회신을 읽고 '확인·종결'하면 사라진다(종결 = 기존 정본 EP)
 */
export const MY_FOLLOWUPS_KEY = ['doctor-my-followups'] as const;

export async function fetchMyFollowups(): Promise<MyFollowups> {
  const r = await apiClient.get<{ data: MyFollowups }>('/api/v1/doctors/my-followups');
  const d = (r as { data?: unknown })?.data as MyFollowups | { data: MyFollowups } | undefined;
  const v = d && 'unsignedEncounters' in d ? d : (d as { data?: MyFollowups } | undefined)?.data;
  if (!v) throw new Error('my-followups 응답 모양이 다릅니다');
  return v;
}

function useFollowups() {
  return useQuery({ queryKey: MY_FOLLOWUPS_KEY, queryFn: fetchMyFollowups });
}

function Truncated({ shown, total }: { shown: number; total: number }) {
  return shown < total ? (
    <p className="text-[11px] text-amber-700" data-followup-truncated><Tf k="오래된 순 {shown}건만 보입니다(전체 {total}건)" params={{ shown, total }} /></p>
  ) : null;
}

export function UnsignedRecordsPanel() {
  const q = useFollowups();
  if (q.isLoading) return <div className="h-32 animate-pulse rounded-xl bg-gray-50" />;
  if (q.isError || !q.data) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />;
  const { unsignedEncounters: e, unsignedDischargeSummaries: d } = q.data;
  return (
    <div className="space-y-4" data-followup-panel="unsigned">
      <p className="text-xs text-gray-500"><T k="내가 담당·작성한 기록 중 아직 서명하지 않은 것입니다. 서명은 각 작성 화면에서 합니다." /></p>
      <section>
        <h3 className="mb-1 text-sm font-bold text-gray-800"><T k="진료기록" /> <span className="text-gray-500">{e.total}</span></h3>
        {e.items.length === 0 ? <EmptyState icon="✅" title="미서명 진료기록이 없습니다" compact /> : (
          <ul className="divide-y rounded-xl border">
            {e.items.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm" data-unsigned-encounter={x.id}>
                <span className="min-w-[9rem] font-semibold"><PatientName familyName={x.patient?.familyName} givenName={x.patient?.givenName} mrn={x.patient?.mrn} /></span>
                <span className="flex-1 truncate text-xs text-gray-600">{x.chiefComplaint ?? '—'}</span>
                <span className="text-xs text-gray-500"><T k="작성 시작" /> <KDate value={x.createdAt} mode="datetime" /></span>
                {x.patient?.id && (
                  <Link href={`/patients/${x.patient.id}/encounter/new?encounterId=${x.id}`} className="min-h-[36px] rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white" data-unsigned-open={x.id}>
                    <T k="기록 열기" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        <Truncated shown={e.items.length} total={e.total} />
      </section>
      <section>
        <h3 className="mb-1 text-sm font-bold text-gray-800"><T k="퇴원요약" /> <span className="text-gray-500">{d.total}</span></h3>
        {d.items.length === 0 ? <EmptyState icon="✅" title="미서명 퇴원요약이 없습니다" compact /> : (
          <ul className="divide-y rounded-xl border">
            {d.items.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm" data-unsigned-discharge={x.id}>
                <span className="min-w-[9rem] font-semibold"><PatientName familyName={x.admission?.patient?.familyName} givenName={x.admission?.patient?.givenName} mrn={x.admission?.patient?.mrn} /></span>
                <span className="flex-1 text-xs text-gray-600">
                  {x.admission?.status === 'DISCHARGED'
                    ? <span className="font-semibold text-red-700"><T k="퇴원함" /> {x.admission.dischargeDate && <KDate value={x.admission.dischargeDate} />}</span>
                    : <T k="재원 중" />}
                </span>
                <span className="text-xs text-gray-500"><T k="작성 시작" /> <KDate value={x.createdAt} mode="datetime" /></span>
                <Link href={`/inpatient/${x.admissionId}/discharge-summary`} className="min-h-[36px] rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white" data-unsigned-discharge-open={x.id}>
                  <T k="퇴원요약 열기" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Truncated shown={d.items.length} total={d.total} />
      </section>
    </div>
  );
}

export function SentConsultsPanel() {
  const q = useFollowups();
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const close = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/consultations/${id}/close`, {}),
    onSuccess: () => { toast.success(tAttr('협진을 확인·종결했습니다.')); qc.invalidateQueries({ queryKey: MY_FOLLOWUPS_KEY }); },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('종결하지 못했습니다.')),
  });
  if (q.isLoading) return <div className="h-32 animate-pulse rounded-xl bg-gray-50" />;
  if (q.isError || !q.data) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data.repliedConsults;
  return (
    <div className="space-y-2" data-followup-panel="sentConsults">
      <p className="text-xs text-gray-500"><T k="내가 의뢰한 협진에 회신이 왔습니다. 회신을 읽고 확인·종결하면 목록에서 사라집니다." /></p>
      {c.items.length === 0 ? <EmptyState icon="✅" title="회신이 도착한 내 협진이 없습니다" compact /> : (
        <ul className="space-y-2">
          {c.items.map((x) => (
            <li key={x.id} className="rounded-xl border p-3 text-sm" data-sent-consult={x.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold"><PatientName familyName={x.encounter?.patient?.familyName} givenName={x.encounter?.patient?.givenName} mrn={x.encounter?.patient?.mrn} /></span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{x.toDepartment}</span>
                {(x.urgency === 'EMERGENT' || x.urgency === 'URGENT') && <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700"><T k={x.urgency === 'EMERGENT' ? '응급' : '긴급'} /></span>}
                <span className="ml-auto text-xs text-gray-500">
                  <T k="회신" /> {x.repliedAt ? <KDate value={x.repliedAt} mode="datetime" /> : '—'}
                  {x.replyDoctor && <> · <StaffName familyName={x.replyDoctor.familyName} givenName={x.replyDoctor.givenName} /></>}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500"><T k="의뢰 사유" />: {x.reason}</p>
              <p className="mt-1 whitespace-pre-wrap rounded-lg bg-blue-50/60 p-2 text-sm text-gray-800">{x.replyContent ?? '—'}</p>
              {x.recommendations && <p className="mt-1 whitespace-pre-wrap text-xs text-gray-700"><T k="권고" />: {x.recommendations}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {x.encounter?.patient?.id && (
                  <Link href={`/patients/${x.encounter.patient.id}?tab=referrals`} className="min-h-[44px] rounded-lg border px-3 py-2 text-xs font-semibold text-gray-700"><T k="차트 열기" /></Link>
                )}
                <button type="button" disabled={close.isPending} onClick={() => close.mutate(x.id)} data-sent-consult-close={x.id}
                  className="min-h-[44px] rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                  <T k="확인·종결" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {c.items.length < c.total && <p className="text-[11px] text-amber-700"><Tf k="오래된 순 {shown}건만 보입니다(전체 {total}건)" params={{ shown: c.items.length, total: c.total }} /></p>}
    </div>
  );
}

// ── 오늘 처리한 것(2026-10-10 · `doctors/my-handled`) ──

export const HANDLED_KIND_LABEL: Record<string, string> = {
  RESULT_ACK: '검사결과 확인',
  VERBAL_COSIGN: '구두 처방 사후 서명',
  RENEWAL: '처방 갱신',
  PREORDER_APPROVE: '사전처방 승인',
  PHARMACIST_REPLY: '약사 중재 회신',
  CONSULT_REPLY: '협진 회신',
  ENCOUNTER_SIGN: '진료기록 서명',
  DISCHARGE_SIGN: '퇴원요약 서명',
};
export interface MyHandled {
  date: string;
  counts: Record<string, number>;
  total: number;
  truncated: boolean;
  items: Array<{ kind: string; id: string; at: string | null; label: string | null; patient: { id: string; mrn: string; familyName: string | null; givenName: string | null } | null; href: string | null }>;
  limit: number;
  notCounted: string[];
}

/**
 * 하루 동안 내가 처리한 일 — 🔴 처리자·시각이 원장에 남는 일만 센다(지어내지 않는다).
 * 협진 종결처럼 처리자 칸이 없는 일은 세지 않고 그렇다고 말한다.
 */
export function HandledTodayPanel({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const q = useQuery({
    queryKey: ['doctor-my-handled', date],
    queryFn: async () => {
      const r = await apiClient.get<{ data: MyHandled }>(`/api/v1/doctors/my-handled?date=${date}`);
      const d = (r as { data?: unknown })?.data as MyHandled | { data: MyHandled };
      return ('counts' in (d as object) ? d : (d as { data: MyHandled }).data) as MyHandled;
    },
  });
  const [kind, setKind] = useState<string>('');
  return (
    <div className="space-y-3" data-handled-panel>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-gray-600"><T k="날짜" />
          <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="ml-1 min-h-[36px] rounded-lg border px-2 text-sm" data-handled-date />
        </label>
        {q.data && <span className="text-sm font-semibold text-gray-800" data-handled-total={q.data.total}><Tf k="처리 {n}건" params={{ n: q.data.total }} /></span>}
      </div>
      <p className="text-[11px] text-gray-500"><T k="처리자와 시각이 기록에 남는 일만 셉니다. 협진 종결은 종결자가 기록되지 않아 세지 않습니다." /></p>
      {q.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-gray-50" />
        : q.isError || !q.data ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />
        : (
          <>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="처리 종류">
              <button type="button" role="tab" aria-selected={kind === ''} onClick={() => setKind('')}
                className={`min-h-[36px] rounded-lg px-2 text-xs ${kind === '' ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-700'}`}><T k="전체" /> {q.data.total}</button>
              {Object.entries(HANDLED_KIND_LABEL).map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} data-handled-kind={k} disabled={!q.data!.counts[k]}
                  className={`min-h-[36px] rounded-lg px-2 text-xs disabled:opacity-40 ${kind === k ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-700'}`}>
                  <T k={l} /> {q.data!.counts[k] ?? 0}
                </button>
              ))}
            </div>
            {q.data.total === 0 ? <EmptyState icon="🗂️" title="이 날 처리한 일이 없습니다" compact /> : (
              <ul className="divide-y rounded-xl border">
                {q.data.items.filter((i) => !kind || i.kind === kind).map((i) => (
                  <li key={`${i.kind}-${i.id}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-handled-item={i.kind}>
                    <span className="w-28 shrink-0 text-xs text-gray-500">{i.at ? <KDate value={i.at} mode="datetime" /> : '—'}</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px]"><T k={HANDLED_KIND_LABEL[i.kind] ?? i.kind} /></span>
                    {i.patient && <span className="font-semibold"><PatientName familyName={i.patient.familyName} givenName={i.patient.givenName} mrn={i.patient.mrn} /></span>}
                    {i.label && <span className="truncate text-xs text-gray-600">{i.label}</span>}
                    {i.href && <Link href={i.href} className="ml-auto min-h-[36px] rounded-lg border px-2 py-1.5 text-xs text-gray-700" data-handled-open><T k="열기" /></Link>}
                  </li>
                ))}
              </ul>
            )}
            {q.data.truncated && <p className="text-[11px] text-amber-700" data-handled-truncated><Tf k="종류마다 최근 {n}건까지만 목록에 보입니다(수는 전체)" params={{ n: q.data.limit }} /></p>}
          </>
        )}
    </div>
  );
}
