'use client';

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import StatusBadge from '@/components/ui/StatusBadge';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { useCodeSearch, CodeSearchDropdown, type CodeItem } from '@/components/prescription/order-entry';
import { DiscontinueDialog } from '@/components/prescription/DiscontinueDialog';
import { useAuthStore } from '@/stores/auth-store';

/**
 * 퇴원약 처방 — 2026-09-30 퇴원약 오더화.
 *
 * 🔴 종전 퇴원약은 퇴원요약의 자유 기재뿐이었다 — DUR·원내 처방집·조제 오더를 지나지 않았고, 퇴원 준비는
 *    "목록이 비어 있지 않다"로만 셌다. 여기서 쓰는 퇴원약은 **처방 원장**에 남고(dischargeMed) 약국이 조제한다.
 *  · 일수·총량·조제 구분은 의사가 정한다(입원 약 값을 복사해 채우지 않는다 — 용량·횟수만 참고로 옮긴다)
 *  · DUR 은 이 입원의 입원 중 약을 비교에서 뺀다(퇴원과 함께 끝나는 약) — 퇴원약끼리·다른 복용약과만 본다
 *  · 입원 약을 자동으로 끊지 않는다(사람 결정 `discharge.stopInpatientMedsOnDischarge`)
 */
type Rx = {
  id: string; status: string; dosage: string | null; frequency: string | null; duration: number | null; quantity: number | null;
  route: string | null; dispensingType: string | null; discontinueReason?: string | null;
  medicationCode: { id: string; code: string; nameKo: string } | null;
  orders: { id: string; status: string }[];
};
type ListResp = { admissionStatus: string; encounterId: string | null; items: Rx[]; inpatientActive: Rx[]; inpatientTruncated: boolean };

type Draft = { medicationCodeId: string; name: string; dosage: string; frequency: string; route: string; days: string; quantity: string; dispensingType: '' | 'INTERNAL' | 'EXTERNAL' };

/** `canWrite` 를 넘기지 않으면 로그인 역할로 정한다(의사·관리자 — 서버 EP 와 같은 규칙).
 *  역할 검사를 페이지에 두지 않는다 — 페이지 스캐너가 형제 조회까지 '게이트 달린 호출'로 보고 대조에서 뺀다. */
export function DischargeRxPanel({ admissionId, canWrite: canWriteProp }: { admissionId: string; canWrite?: boolean }) {
  const role = useAuthStore((st) => st.user?.role);
  const canWrite = canWriteProp ?? (role === 'DOCTOR' || role === 'ADMIN');
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const qc = useQueryClient();
  const key = ['discharge-prescriptions', admissionId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => apiClient.get<{ data: ListResp }>(`/api/v1/admissions/${admissionId}/discharge-prescriptions`).then((r) => r.data),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [durBlocked, setDurBlocked] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [stopping, setStopping] = useState<Rx | null>(null);
  const search = useCodeSearch('MEDICATION');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post<{ data: unknown; durWarnings?: { message?: string }[] }>(`/api/v1/admissions/${admissionId}/discharge-prescriptions`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['discharge-readiness', admissionId] });
    },
  });

  const startFrom = (rx: Rx) => {
    if (!rx.medicationCode) return;
    // 용량·횟수·경로만 참고로 옮긴다 — 일수·총량·조제 구분은 비워 둔다(퇴원약은 새 결정)
    setDraft({ medicationCodeId: rx.medicationCode.id, name: rx.medicationCode.nameKo, dosage: rx.dosage ?? '', frequency: rx.frequency ?? '', route: rx.route ?? '', days: '', quantity: '', dispensingType: '' });
    setDurBlocked(null); setOverrideReason('');
  };
  const startNew = (c: CodeItem) => {
    setDraft({ medicationCodeId: c.id, name: c.nameKo, dosage: '', frequency: '', route: '', days: '', quantity: '', dispensingType: '' });
    setDurBlocked(null); setOverrideReason('');
    search.reset();
  };

  const d = Number(draft?.days); const qn = Number(draft?.quantity);
  const valid = !!draft && Number.isInteger(d) && d >= 1 && Number.isInteger(qn) && qn >= 1 && !!draft.dispensingType && !!draft.dosage.trim() && !!draft.frequency.trim();

  const submit = async () => {
    if (!draft || !valid) { toast.error(tAttr('용량·횟수·일수·총량·조제 구분을 모두 정해 주세요.')); return; }
    try {
      const res = await create.mutateAsync({
        type: 'MEDICATION', medicationCodeId: draft.medicationCodeId, dosage: draft.dosage.trim(), frequency: draft.frequency.trim(),
        route: draft.route.trim() || undefined, duration: d, quantity: qn, dispensingType: draft.dispensingType,
        ...(durBlocked ? { overrideDur: true, overrideReason: overrideReason.trim() } : {}),
      });
      const warns = (res as { durWarnings?: unknown[] })?.durWarnings ?? [];
      if (warns.length > 0) toast.warning(tfAttr('퇴원약을 처방했습니다 — DUR 경고 {n}건이 기록되었습니다.', { n: warns.length }));
      else toast.success(tAttr('퇴원약을 처방했습니다 — 약국 조제 오더가 만들어졌습니다.'));
      setDraft(null); setDurBlocked(null); setOverrideReason('');
    } catch (e) {
      const details = (e as { details?: { durWarnings?: unknown[] } })?.details;
      if (details?.durWarnings && !durBlocked) { setDurBlocked(extractErrorMessage(e) || 'DUR'); return; }
      toast.error(extractErrorMessage(e) || tAttr('퇴원약 처방에 실패했습니다.'));
    }
  };

  const data = q.data;
  const active = (data?.items ?? []).filter((r) => r.status === 'ACTIVE');
  const writable = canWrite && data?.admissionStatus === 'ADMITTED';

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3" data-discharge-rx-panel>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900"><T k="퇴원약 처방" /></h3>
        {data && <span className="text-xs text-gray-500"><Tf k="활성 {n}건" params={{ n: active.length }} /></span>}
      </div>
      <p className="text-xs text-gray-500"><T k="퇴원약은 처방으로 남고 약국이 조제합니다 — 입원 중 약은 자동으로 중단되지 않습니다." /></p>

      {q.isLoading ? (
        <div className="h-16 rounded-lg bg-gray-100 animate-pulse" />
      ) : q.isError ? (
        <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />
      ) : data ? (
        <>
          {data.items.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" data-discharge-rx-empty><T k="아직 처방된 퇴원약이 없습니다." /></p>
          ) : (
            <ul className="space-y-1.5">
              {data.items.map((rx) => (
                <li key={rx.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-xs" data-discharge-rx-row={rx.status}>
                  <span className="font-medium text-gray-900">{rx.medicationCode?.nameKo ?? '—'}</span>
                  <span className="text-gray-600">{[rx.dosage, rx.frequency, rx.duration != null ? tfAttr('{n}일', { n: rx.duration }) : null, rx.quantity != null ? tfAttr('총 {n}', { n: rx.quantity }) : null].filter(Boolean).join(' · ')}</span>
                  <span className="text-gray-500">{rx.dispensingType === 'EXTERNAL' ? <T k="원외" /> : <T k="원내 조제" />}</span>
                  <StatusBadge domain="prescription" status={rx.status} />
                  {rx.orders[0] && <StatusBadge domain="order" status={rx.orders[0].status} />}
                  {rx.status === 'DISCONTINUED' && rx.discontinueReason && <span className="text-gray-500">{rx.discontinueReason}</span>}
                  {writable && rx.status === 'ACTIVE' && (
                    <button type="button" onClick={() => setStopping(rx)} className="ml-auto min-h-[44px] rounded-lg border border-gray-300 px-3 text-xs text-gray-700 hover:bg-gray-50"><T k="중단" /></button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {writable && (
            <div className="space-y-2 border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-gray-600"><T k="입원 중 약에서 옮기기" /></p>
              {data.inpatientActive.length === 0 ? (
                <p className="text-xs text-gray-400"><T k="입원 중 활성 약이 없습니다." /></p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {data.inpatientActive.map((rx) => (
                    <button key={rx.id} type="button" onClick={() => startFrom(rx)} data-discharge-rx-from={rx.id}
                      className="min-h-[44px] rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs text-teal-800 hover:bg-teal-100">
                      {rx.medicationCode?.nameKo ?? '—'} <span className="text-teal-600">{[rx.dosage, rx.frequency].filter(Boolean).join(' ')}</span>
                    </button>
                  ))}
                </div>
              )}
              {data.inpatientTruncated && <p className="text-[11px] text-amber-700"><T k="입원 중 약이 많아 앞의 200건만 보입니다." /></p>}
              <div className="relative">
                <input
                  value={search.query}
                  onFocus={() => { if (search.results.length === 0) void search.search(''); else search.setOpen(true); }}
                  onChange={(e) => {
                    search.setQuery(e.target.value);
                    if (debounceRef.current) clearTimeout(debounceRef.current);
                    const v = e.target.value;
                    debounceRef.current = setTimeout(() => void search.search(v), 300);
                  }}
                  placeholder={tAttr('새 약 검색')}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
                {search.open && (
                  <CodeSearchDropdown activeTab="MEDICATION" results={search.results} query={search.query} searching={search.searching} failed={search.failed} onSelect={startNew} />
                )}
              </div>
            </div>
          )}

          {draft && writable && (
            <div className="space-y-2 rounded-xl border border-teal-200 bg-teal-50/50 p-3" data-discharge-rx-draft>
              <p className="text-sm font-semibold text-gray-900">{draft.name}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {([['dosage', '용량 (필수)'], ['frequency', '횟수 (필수)'], ['route', '경로']] as const).map(([k, label]) => (
                  <label key={k} className="text-[11px] font-semibold text-gray-500"><T k={label} />
                    <input value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm" />
                  </label>
                ))}
                <label className="text-[11px] font-semibold text-gray-500"><T k="일수 (필수)" />
                  <input type="number" min={1} value={draft.days} onChange={(e) => setDraft({ ...draft, days: e.target.value })} data-discharge-rx-days className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm" />
                </label>
                <label className="text-[11px] font-semibold text-gray-500"><T k="총량 (필수)" />
                  <input type="number" min={1} value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} data-discharge-rx-quantity className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm" />
                </label>
                <fieldset className="text-[11px] font-semibold text-gray-500"><legend><T k="조제 (필수)" /></legend>
                  <div className="mt-1 flex gap-1">
                    {(['INTERNAL', 'EXTERNAL'] as const).map((v) => (
                      <button key={v} type="button" onClick={() => setDraft({ ...draft, dispensingType: v })} data-discharge-rx-dispense={v}
                        className={`min-h-[44px] flex-1 rounded-lg border px-2 text-xs ${draft.dispensingType === v ? 'border-teal-600 bg-teal-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}>
                        {v === 'INTERNAL' ? <T k="원내 조제" /> : <T k="원외" />}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
              {durBlocked && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  <p className="font-semibold"><T k="DUR 경고로 막혔습니다" /> — {durBlocked}</p>
                  <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder={tAttr('강제 처방 사유(필수)')} className="mt-2 w-full rounded border border-red-200 bg-white px-2 py-1.5 text-xs" />
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setDraft(null)} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm text-gray-700"><T k="닫기" /></button>
                <button type="button" onClick={() => void submit()} disabled={create.isPending || !valid || (!!durBlocked && !overrideReason.trim())} data-discharge-rx-submit
                  className="min-h-[44px] rounded-lg bg-teal-600 px-4 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50">
                  {create.isPending ? <T k="처방 중…" /> : durBlocked ? <T k="사유와 함께 처방" /> : <T k="퇴원약 처방" />}
                </button>
              </div>
            </div>
          )}
          {!writable && data.admissionStatus !== 'ADMITTED' && (
            <p className="text-[11px] text-gray-500"><T k="입원 중일 때만 퇴원약을 처방할 수 있습니다." /></p>
          )}
        </>
      ) : null}

      {stopping && (
        <DiscontinueDialog prescriptionId={stopping.id} name={stopping.medicationCode?.nameKo ?? ''} onClose={() => setStopping(null)}
          onDone={() => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['discharge-readiness', admissionId] }); }} />
      )}
    </section>
  );
}
