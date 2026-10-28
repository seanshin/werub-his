'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { COMMITTEE_AUTHORITIES, joinPatientName, type CommitteeCode } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { MechanismBadge } from './engine-parts';
import type { DecisionItem } from './types';
import { Rich } from './rich';

/**
 * 위원회 중요결정 **일괄 의사결정**(2026-10-11 사용자 "관련된 위원회 중요결정사항에 대해서 일괄 변경").
 *
 * 🔴 일괄이어도 경로는 하나씩과 같다 — 서버가 회의 하나를 만들고 결정마다 안건→배정→의결(정족수·명부 대조 그대로),
 *    권한자 항목은 결정 화면과 같은 의사결정 경로를 지난다.
 * 🔴 쓰기 폼은 미선택으로 시작한다 — 선택지·회의 일시·참석자를 미리 채우지 않는다(시드 선택으로 채우기는 사람이 누르는 단추).
 * 🔴 결과는 항목마다 — 일부 실패를 전체 성공으로 말하지 않는다.
 */
interface BulkResult {
  committeeCode: string; meetingId: string | null; total: number; succeeded: number; failed: number;
  results: Array<{ key: string; choice: string; ok: boolean; path: 'COMMITTEE' | 'ROLE' | null; decisionNo?: string; registryWritten?: boolean; enact?: { enacted?: number; failed?: number; error?: { code: string; message: string } }; error?: { code: string; message: string } }>;
}

export function BulkDecisionPanel({ code, items, onClose }: { code: CommitteeCode; items: DecisionItem[]; onClose: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  /** 이 위원회가 정할 수 있는 결정(주관·합동 · 위원회 층 · 건별 판단 제외) */
  const candidates = useMemo(() => items.filter((d) => d.layer === 'INTERNAL_COMMITTEE' && d.mechanism !== 'PER_EVENT'
    && !!d.committee && (d.committee.lead === code || d.committee.joint.includes(code))), [items, code]);
  const [picked, setPicked] = useState<Record<string, string>>({}); // key → 선택값('' = 고르지 않음)
  const [basis, setBasis] = useState('');
  const [authority, setAuthority] = useState('');
  const [note, setNote] = useState('');
  const [heldAt, setHeldAt] = useState('');
  const [attendees, setAttendees] = useState<string[]>([]);
  const [enactNow, setEnactNow] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  const committeesQ = useQuery({
    queryKey: ['gov-summary'],
    queryFn: () => apiClient.get<{ data: { committees: Array<{ id: string; code: string; quorum?: number }> } }>('/api/v1/governance/summary'),
    staleTime: 60_000,
  });
  const committee = committeesQ.data?.data?.committees?.find((c) => c.code === code);
  const rosterQ = useQuery({
    queryKey: ['gld-committee', committee?.id],
    queryFn: () => apiClient.get<{ data: { quorum: number; members: Array<{ userId: string; role: string; source?: string; user: { name?: string; familyName?: string; givenName?: string } | null }> } }>(`/api/v1/gld/committees/${committee!.id}`),
    enabled: !!committee?.id,
  });
  const roster = rosterQ.data?.data?.members ?? [];
  const quorum = rosterQ.data?.data?.quorum ?? committee?.quorum ?? COMMITTEE_AUTHORITIES[code].quorum;

  const selectedKeys = Object.keys(picked);
  const selected = candidates.filter((d) => selectedKeys.includes(d.key));
  const needsMeeting = selected.some((d) => d.approvalPath !== 'AUTHORIZED_ROLE');
  const needsAuthority = selected.some((d) => d.approvalPath === 'AUTHORIZED_ROLE');
  const allChosen = selected.length > 0 && selected.every((d) => !!picked[d.key]);
  const meetingOk = !needsMeeting || (!!heldAt && attendees.length >= Math.max(1, quorum));
  const ready = allChosen && basis.trim().length >= 4 && (!needsAuthority || authority.trim().length >= 2) && meetingOk;

  const toggle = (k: string) => setPicked((p) => { const n = { ...p }; if (k in n) delete n[k]; else n[k] = ''; return n; });
  /** 사람이 누르는 단추 — 고른 항목 중 비어 있는 것만 지금 기록된 선택(시드 포함)으로 채운다 */
  const fillFromRecord = () => setPicked((p) => {
    const n = { ...p };
    for (const d of selected) if (!n[d.key] && d.record?.choice) n[d.key] = d.record.choice;
    return n;
  });

  const submit = useMutation({
    mutationFn: () => apiClient.post<{ data: BulkResult }>('/api/v1/admin/decisions/bulk', {
      committeeCode: code,
      items: selected.map((d) => ({ key: d.key, choice: picked[d.key] })),
      basisRef: basis.trim(), authorityClaim: authority.trim(), ...(note.trim() ? { note: note.trim() } : {}),
      ...(needsMeeting ? { meeting: { heldAt: new Date(heldAt).toISOString(), attendeeUserIds: attendees } } : {}),
      enactNow,
    }),
    onSuccess: (r) => {
      const res = r.data;
      setResult(res);
      qc.invalidateQueries({ queryKey: ['human-decisions'] });
      qc.invalidateQueries({ queryKey: ['decision-log-all'] });
      if (res.failed) toast.warning(`일괄 의사결정 ${res.total}건 중 ${res.failed}건 실패 — 항목별 사유를 확인하세요.`);
      else toast.success(`일괄 의사결정 ${res.succeeded}건을 확정했습니다.`);
    },
    onError: (e) => toast.error((e as { message?: string })?.message ?? '일괄 의사결정을 하지 못했습니다.'),
  });

  const nameOf = (m: (typeof roster)[number]) => m.user?.name || joinPatientName(m.user?.familyName, m.user?.givenName) || m.userId;
  const titleOf = (k: string) => candidates.find((d) => d.key === k)?.title ?? k;

  return (
    <section className="rounded-xl border-2 border-indigo-300 bg-indigo-50/40 px-4 py-3 space-y-3" data-bulk-panel={code}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-indigo-950"><T k="일괄 의사결정" /> — {COMMITTEE_AUTHORITIES[code].name}</p>
          <p className="text-[11px] text-indigo-900"><T k="고른 결정을 한 회의에서 차례로 의결합니다 — 결정마다 안건이 생기고 정족수·명부 대조를 그대로 지납니다. 권한자 항목은 권한 근거로 의사결정합니다." /></p>
        </div>
        <button type="button" onClick={onClose} className="min-h-[44px] px-3 text-[12px] text-gray-600 hover:text-gray-900"><T k="닫기" /></button>
      </div>

      {result ? (
        <div className="space-y-2" data-bulk-result>
          <p className="text-[12px] font-semibold" data-bulk-summary>
            <T k="결과" />: <T k="성공" /> {result.succeeded} · <span className={result.failed ? 'text-red-700' : ''}><T k="실패" /> {result.failed}</span> / {result.total}
          </p>
          <ul className="space-y-1 text-[11px]">
            {result.results.map((r) => (
              <li key={r.key} data-bulk-row={r.key} data-bulk-ok={String(r.ok)} className={`rounded border px-2 py-1 ${r.ok ? 'border-emerald-200 bg-white' : 'border-red-300 bg-red-50'}`}>
                <b>{titleOf(r.key)}</b> → {candidates.find((d) => d.key === r.key)?.options.find((o) => o.value === r.choice)?.label ?? r.choice}
                {' · '}{r.ok ? (r.path === 'COMMITTEE' ? <>{r.decisionNo} <T k="의결" />{r.registryWritten === false && <span className="text-amber-900"> · <T k="등록부 반영 실패" /></span>}</> : <T k="권한자 의사결정" />) : <span className="text-red-800">{r.error?.message ?? r.error?.code}</span>}
                {r.enact && (r.enact.error ? <span className="text-amber-900"> · <T k="집행 안 됨" />: {r.enact.error.message}</span> : <span> · <T k="집행" /> {r.enact.enacted ?? 0}</span>)}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-semibold"><T k="고른 결정" /> {selected.length} / {candidates.length}</span>
            <button type="button" onClick={fillFromRecord} disabled={!selected.length} data-bulk-fill
              className="min-h-[36px] px-2.5 rounded-lg border border-indigo-300 bg-white text-indigo-900 disabled:opacity-40">
              <T k="빈 선택을 지금 기록된 선택(시드 포함)으로 채우기" />
            </button>
          </div>
          <ul className="max-h-[22rem] overflow-y-auto space-y-1" data-bulk-list>
            {candidates.map((d) => {
              const on = d.key in picked;
              return (
                <li key={d.key} className={`rounded-lg border px-2 py-1.5 ${on ? 'border-indigo-300 bg-white' : 'border-gray-200 bg-white/60'}`} data-bulk-candidate={d.key}>
                  <label className="flex items-center gap-2 min-h-[36px]">
                    <input type="checkbox" checked={on} onChange={() => toggle(d.key)} data-bulk-check={d.key} />
                    <span className="text-[12px] font-semibold text-gray-900 flex-1 min-w-0"><Rich text={d.title} /></span>
                    <MechanismBadge mechanism={d.mechanism} />
                    {d.committee?.lead !== code && <span className="text-[10px] text-gray-500"><T k="합동" /></span>}
                  </label>
                  {on && (
                    <div className="pl-6 flex flex-wrap items-center gap-2 text-[11px]">
                      <select value={picked[d.key]} onChange={(e) => setPicked((p) => ({ ...p, [d.key]: e.target.value }))} data-bulk-choice={d.key}
                        aria-label={tAttr('선택지')} className="min-h-[36px] max-w-full px-2 rounded-lg border border-gray-300 text-[12px] bg-white">
                        <option value="">{tAttr('— 선택지를 고르세요 —')}</option>
                        {d.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {d.record && <span className="text-gray-500"><T k={d.seeded ? '지금(개발 시드)' : '지금'} />: {d.options.find((o) => o.value === d.record!.choice)?.label ?? d.record.choice}</span>}
                      <span className="text-gray-500">{d.approvalPath === 'AUTHORIZED_ROLE' ? <T k="권한자 의사결정" /> : <T k="회의에서 의결" />}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="grid gap-2 sm:grid-cols-2 text-[12px]">
            <label className="block"><span className="text-gray-700"><T k="의사결정 근거" /> *</span>
              <input value={basis} onChange={(e) => setBasis(e.target.value)} data-bulk-basis placeholder={tAttr('회의록·문서 번호')} className="mt-0.5 w-full min-h-[44px] px-2.5 rounded-lg border border-gray-300" />
            </label>
            {needsAuthority && (
              <label className="block"><span className="text-gray-700"><T k="권한 근거(권한자 항목)" /> *</span>
                <input value={authority} onChange={(e) => setAuthority(e.target.value)} data-bulk-authority className="mt-0.5 w-full min-h-[44px] px-2.5 rounded-lg border border-gray-300" />
              </label>
            )}
            <label className="block sm:col-span-2"><span className="text-gray-700"><T k="메모" /></span>
              <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-0.5 w-full min-h-[44px] px-2.5 rounded-lg border border-gray-300" />
            </label>
          </div>

          {needsMeeting && (
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 space-y-1.5 text-[12px]" data-bulk-meeting>
              <p className="font-semibold text-gray-800"><T k="의결 회의" /> <span className="font-normal text-gray-500">(<T k="정족수" /> {quorum})</span></p>
              <label className="block"><span className="text-gray-700"><T k="회의 일시" /> *</span>
                <input type="datetime-local" value={heldAt} onChange={(e) => setHeldAt(e.target.value)} data-bulk-heldat className="mt-0.5 block min-h-[44px] px-2.5 rounded-lg border border-gray-300" />
              </label>
              <p className="text-gray-700"><T k="참석자" /> * <span className="text-gray-500">({attendees.length}/{quorum})</span></p>
              {rosterQ.isError ? <QueryErrorFallback error={rosterQ.error} onRetry={rosterQ.refetch} size="compact" />
                : rosterQ.isLoading ? <p className="text-gray-400"><T k="불러오는 중…" /></p>
                : roster.length === 0 ? <p className="text-amber-900" data-bulk-roster-empty><T k="위원 명부가 비어 있습니다 — 위원을 먼저 임명해야 의결할 수 있습니다." /></p>
                : (
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {roster.map((m) => (
                      <label key={m.userId} className="inline-flex items-center gap-1 min-h-[36px]">
                        <input type="checkbox" checked={attendees.includes(m.userId)} data-bulk-attendee={m.userId}
                          onChange={() => setAttendees((a) => (a.includes(m.userId) ? a.filter((x) => x !== m.userId) : [...a, m.userId]))} />
                        {nameOf(m)} <span className="text-gray-400">{m.role}{m.source === 'SEED' ? ` · ${tAttr('시드')}` : ''}</span>
                      </label>
                    ))}
                  </div>
                )}
              <p className="text-[11px] text-gray-500"><T k="참석자는 실제로 참석한 위원만 고르세요 — 시스템은 참석 여부를 확인하지 못합니다." /></p>
            </div>
          )}

          <label className="flex items-center gap-2 text-[12px] min-h-[36px]">
            <input type="checkbox" checked={enactNow} onChange={(e) => setEnactNow(e.target.checked)} data-bulk-enact />
            <T k="의결 직후 설정 반영(자동 집행이 꺼져 있으면 반영하지 않고 그렇다고 알려 줍니다)" />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!ready || submit.isPending} onClick={() => submit.mutate()} data-bulk-submit
              className="min-h-[44px] px-4 rounded-lg bg-indigo-700 text-white text-[13px] font-semibold disabled:opacity-40">
              {submit.isPending ? <T k="저장 중…" /> : <><T k="일괄 의사결정" /> {selected.length}<T k="건" /></>}
            </button>
            {!ready && selected.length > 0 && (
              <span className="text-[11px] text-amber-900" data-bulk-missing>
                {!allChosen ? tAttr('선택지를 고르지 않은 결정이 있습니다') : basis.trim().length < 4 ? tAttr('의사결정 근거를 입력하세요') : needsAuthority && authority.trim().length < 2 ? tAttr('권한 근거를 입력하세요') : tAttr('회의 일시와 정족수 이상의 참석자가 필요합니다')}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
