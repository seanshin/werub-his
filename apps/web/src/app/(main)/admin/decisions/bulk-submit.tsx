'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate } from '@/components/ui/display';
import { toast } from '@/stores/toast-store';
import { AGENDA_STATUS_LABEL, COMMITTEE_AUTHORITIES, OPEN_AGENDA_STATUSES, type CommitteeCode } from '@hospital-run/shared';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import type { DecisionItem } from './types';
import { Rich } from './rich';

/**
 * 위원회 안건 **일괄 상정**(2026-10-21 사용자 "안건 상정까지 기능 구현").
 *
 * 🔴 상정은 의결이 아니다 — 결정마다 안건을 접수하고(고르면) 회의에 배정할 뿐, 등록부·설정은 바뀌지 않는다(개발 시드도 그대로).
 * 🔴 서버가 하나씩 올리는 것과 같은 경로로 처리한다 — 배정 위원회·선택지 물려받기·같은 결정 안건 하나 규칙 그대로.
 * 🔴 쓰기 폼은 미선택으로 시작한다 — 결정도 회의 방식도 고르기 전에는 올리지 않는다.
 * 올릴 수 없는 결정(이미 실결정·안건 진행 중·권한자가 기록·안건 확인 불가)은 이유와 함께 보이되 고를 수 없다.
 */
interface SubmitResult {
  committeeCode: string; meetingId: string | null; total: number; succeeded: number; failed: number;
  results: Array<{ key: string; ok: boolean; agendaId?: string; status?: 'SUBMITTED' | 'SCHEDULED'; error?: { code: string; message: string } }>;
}
type Meeting = { id: string; title: string; scheduledAt: string; status: string; minutesSignedAt: string | null };
type MeetingMode = '' | 'NONE' | 'EXISTING' | 'NEW';

/** 같은 결정의 열린 안건(접수·상정·보류)이 있는가 — 상태 집합은 shared 정본 */
export const isOpen = (d: DecisionItem) => !!d.agenda && d.agenda !== 'UNKNOWN' && (OPEN_AGENDA_STATUSES as readonly string[]).includes(d.agenda.status);

/** 고를 수 없는 이유 — null 이면 올릴 수 있다 */
export function submitBlockReason(d: DecisionItem): string | null {
  if (d.decided) return '이미 의사결정됨 — 다시 정하려면 결정 화면에서 재상정';
  if (d.agenda === 'UNKNOWN') return '안건 상태 확인 불가';
  if (isOpen(d)) return '안건 진행 중';
  return null;
}

export function BulkSubmitPanel({ code, items, onClose }: { code: CommitteeCode; items: DecisionItem[]; onClose: () => void }) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const qc = useQueryClient();
  /** 이 위원회에 올릴 수 있는 종류(주관·합동 · 위원회 층 · 건별 판단·권한자 기록 제외) */
  const candidates = useMemo(() => items.filter((d) => d.layer === 'INTERNAL_COMMITTEE' && d.mechanism !== 'PER_EVENT' && d.approvalPath !== 'AUTHORIZED_ROLE'
    && !!d.committee && (d.committee.lead === code || d.committee.joint.includes(code))), [items, code]);
  const selectable = candidates.filter((d) => !submitBlockReason(d));
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<MeetingMode>('');
  const [meetingId, setMeetingId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [result, setResult] = useState<SubmitResult | null>(null);

  const committeesQ = useQuery({
    queryKey: ['gov-summary'],
    queryFn: () => apiClient.get<{ data: { committees: Array<{ id: string; code: string }> } }>('/api/v1/governance/summary'),
    staleTime: 60_000,
  });
  const committee = committeesQ.data?.data?.committees?.find((c) => c.code === code);
  const meetingsQ = useQuery({
    queryKey: ['gld-meetings', committee?.id, 'SCHEDULED'],
    queryFn: () => apiClient.get<{ data: Meeting[] }>('/api/v1/gld/meetings', { committeeId: committee!.id, status: 'SCHEDULED' }),
    enabled: mode === 'EXISTING' && !!committee?.id,
  });
  // 봉인된 회의에는 올리지 않는다(서버도 거부)
  const meetings = (meetingsQ.data?.data ?? []).filter((m) => !m.minutesSignedAt);

  const meetingOk = mode === 'NONE' || (mode === 'EXISTING' && !!meetingId) || (mode === 'NEW' && !!scheduledAt);
  const ready = picked.length > 0 && meetingOk;
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const submit = useMutation({
    mutationFn: () => apiClient.post<{ data: SubmitResult }>('/api/v1/admin/decisions/bulk-submit', {
      committeeCode: code, keys: picked,
      ...(mode === 'EXISTING' ? { meetingId } : {}),
      ...(mode === 'NEW' ? { scheduledAt: new Date(scheduledAt).toISOString(), ...(meetingTitle.trim() ? { meetingTitle: meetingTitle.trim() } : {}) } : {}),
    }),
    onSuccess: (r) => {
      const res = r.data;
      setResult(res);
      qc.invalidateQueries({ queryKey: ['human-decisions'] });
      qc.invalidateQueries({ queryKey: ['gov-agendas'] });
      qc.invalidateQueries({ queryKey: ['gld-meetings'] });
      if (res.failed) toast.warning(tfAttr('안건 {전체}건 중 {실패}건을 올리지 못했습니다 — 항목별 사유를 확인하세요.', { 전체: res.total, 실패: res.failed }));
      else toast.success(tfAttr('안건 {수}건을 올렸습니다.', { 수: res.succeeded }));
    },
    onError: (e) => toast.error((e as { message?: string })?.message ?? tAttr('안건을 올리지 못했습니다.')),
  });

  const titleOf = (k: string) => candidates.find((d) => d.key === k)?.title ?? k;

  return (
    <section className="rounded-xl border-2 border-sky-300 bg-sky-50/40 px-4 py-3 space-y-3" data-bulk-submit-panel={code}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-sky-950"><T k="일괄 상정" /> — {COMMITTEE_AUTHORITIES[code].name}</p>
          <p className="text-[11px] text-sky-900"><T k="고른 결정을 이 위원회 안건으로 올립니다 — 의결이 아니라서 결정·설정은 바뀌지 않습니다. 의결은 회의 뒤 '일괄 의사결정'이나 안건 화면에서 합니다." /></p>
        </div>
        <button type="button" onClick={onClose} className="min-h-[44px] px-3 text-[12px] text-gray-600 hover:text-gray-900"><T k="닫기" /></button>
      </div>

      {result ? (
        <div className="space-y-2" data-bulk-submit-result>
          <p className="text-[12px] font-semibold">
            <T k="결과" />: <T k="성공" /> {result.succeeded} · <span className={result.failed ? 'text-red-700' : ''}><T k="실패" /> {result.failed}</span> / {result.total}
          </p>
          <ul className="space-y-1 text-[11px]">
            {result.results.map((r) => (
              <li key={r.key} data-bulk-submit-row={r.key} data-bulk-submit-ok={String(r.ok)} className={`rounded border px-2 py-1 ${r.ok ? 'border-emerald-200 bg-white' : 'border-red-300 bg-red-50'}`}>
                <b><Rich text={titleOf(r.key)} /></b>{' · '}
                {r.ok ? <T k={r.status === 'SCHEDULED' ? '회의에 상정됨' : '안건 접수됨(회의 배정 전)'} /> : <span className="text-red-800">{r.error?.message ?? r.error?.code}</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-semibold"><T k="고른 결정" /> {picked.length} / {selectable.length}</span>
            <button type="button" onClick={() => setPicked(selectable.map((d) => d.key).slice(0, 50))} disabled={!selectable.length} data-bulk-submit-all
              className="min-h-[36px] px-2.5 rounded-lg border border-sky-300 bg-white text-sky-900 disabled:opacity-40">
              <T k="올릴 수 있는 결정 모두 고르기" />
            </button>
            {picked.length > 0 && <button type="button" onClick={() => setPicked([])} className="min-h-[36px] px-2 text-gray-600"><T k="선택 해제" /></button>}
            {selectable.length > 50 && <span className="text-amber-900"><Tf k="한 번에 {수}건까지 올립니다" params={{ 수: 50 }} /></span>}
          </div>
          <ul className="max-h-[22rem] overflow-y-auto space-y-1" data-bulk-submit-list>
            {candidates.map((d) => {
              const why = submitBlockReason(d);
              const on = picked.includes(d.key);
              const ag = d.agenda && d.agenda !== 'UNKNOWN' ? d.agenda : null;
              return (
                <li key={d.key} className={`rounded-lg border px-2 py-1.5 ${on ? 'border-sky-300 bg-white' : 'border-gray-200 bg-white/60'} ${why ? 'opacity-70' : ''}`} data-bulk-submit-candidate={d.key}>
                  <label className="flex items-center gap-2 min-h-[36px]">
                    <input type="checkbox" checked={on} disabled={!!why} onChange={() => toggle(d.key)} data-bulk-submit-check={d.key} />
                    <span className="text-[12px] font-semibold text-gray-900 flex-1 min-w-0"><Rich text={d.title} /></span>
                    {d.seeded && <span className="text-[10px] text-violet-700"><T k="개발 시드" /></span>}
                    {d.committee?.lead !== code && <span className="text-[10px] text-gray-500"><T k="합동" /></span>}
                  </label>
                  {why && (
                    <p className="pl-6 text-[11px] text-gray-600" data-bulk-submit-blocked={d.key}>
                      <T k={why} />
                      {ag && isOpen(d) && <> · {ag.committee?.name ?? ''} <T k={AGENDA_STATUS_LABEL[ag.status] ?? ag.status} /></>}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <fieldset className="rounded-lg border border-gray-200 bg-white px-3 py-2 space-y-1.5 text-[12px]" data-bulk-submit-meeting>
            <legend className="px-1 font-semibold text-gray-800"><T k="회의" /> *</legend>
            {([
              ['NONE', '회의 배정 없이 접수만(간사가 나중에 배정)'],
              ['EXISTING', '예정된 회의에 상정'],
              ['NEW', '새 회의를 잡고 상정'],
            ] as const).map(([v, label]) => (
              <label key={v} className="flex items-center gap-2 min-h-[36px]">
                <input type="radio" name={`submit-meeting-${code}`} checked={mode === v} onChange={() => setMode(v)} data-bulk-submit-mode={v} />
                <T k={label} />
              </label>
            ))}
            {mode === 'EXISTING' && (
              meetingsQ.isError ? <QueryErrorFallback error={meetingsQ.error} onRetry={meetingsQ.refetch} size="compact" />
                : meetingsQ.isLoading || !committee ? <p className="text-gray-400"><T k="불러오는 중…" /></p>
                : meetings.length === 0 ? <p className="text-amber-900" data-bulk-submit-no-meeting><T k="예정된 회의가 없습니다 — 새 회의를 잡거나 접수만 하세요." /></p>
                : (
                  <select value={meetingId} onChange={(e) => setMeetingId(e.target.value)} data-bulk-submit-meeting-select aria-label={tAttr('회의')}
                    className="min-h-[44px] max-w-full px-2 rounded-lg border border-gray-300 bg-white">
                    <option value="">{tAttr('— 회의를 고르세요 —')}</option>
                    {meetings.map((m) => <option key={m.id} value={m.id}>{m.title} · {new Date(m.scheduledAt).toLocaleString()}</option>)}
                  </select>
                )
            )}
            {mode === 'NEW' && (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block"><span className="text-gray-700"><T k="회의 예정 일시" /> *</span>
                  <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} data-bulk-submit-at className="mt-0.5 block w-full min-h-[44px] px-2.5 rounded-lg border border-gray-300" />
                </label>
                <label className="block"><span className="text-gray-700"><T k="회의 이름" /></span>
                  <input value={meetingTitle} onChange={(e) => setMeetingTitle(e.target.value)} placeholder={COMMITTEE_AUTHORITIES[code].name} className="mt-0.5 w-full min-h-[44px] px-2.5 rounded-lg border border-gray-300" />
                </label>
                <p className="sm:col-span-2 text-[11px] text-gray-500"><T k="참석자는 회의 때 실제로 온 위원을 기록합니다 — 지금 넣지 않습니다." /></p>
              </div>
            )}
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!ready || submit.isPending} onClick={() => submit.mutate()} data-bulk-submit-go
              className="min-h-[44px] px-4 rounded-lg bg-sky-700 text-white text-[13px] font-semibold disabled:opacity-40">
              {submit.isPending ? <T k="저장 중…" /> : <><T k="일괄 상정" /> {picked.length}<T k="건" /></>}
            </button>
            {!ready && (
              <span className="text-[11px] text-amber-900" data-bulk-submit-missing>
                {!picked.length ? tAttr('올릴 결정을 고르세요') : tAttr('회의 방식을 고르세요(예정 회의는 회의까지 · 새 회의는 일시까지)')}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** 결정 행의 단건 상정 자리 — 열린 안건이 있으면 단추 대신 진행 상태(서버도 같은 결정의 안건을 둘 받지 않는다) */
export function OpenAgendaNote({ d }: { d: DecisionItem }) {
  if (!isOpen(d) || !d.agenda || d.agenda === 'UNKNOWN') return null;
  return (
    <span className="text-[11px] text-sky-800" data-open-agenda={d.agenda.status}>
      <T k="안건 진행 중" /> · {d.agenda.committee?.name ?? ''} <T k={AGENDA_STATUS_LABEL[d.agenda.status] ?? d.agenda.status} /> · <KDate value={d.agenda.updatedAt} mode="date" />
    </span>
  );
}
