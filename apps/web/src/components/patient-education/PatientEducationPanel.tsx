'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EDUCATION_LEARNERS, EDUCATION_LEARNER_LABEL, EDUCATION_METHODS, EDUCATION_METHOD_LABEL, EDUCATION_SOURCE_LABEL, EDUCATION_TOPICS,
  EDUCATION_TOPIC_LABEL, EDUCATION_UNDERSTANDING, EDUCATION_UNDERSTANDING_LABEL, EDUCATION_TEXT_MAX,
  type EducationLearner, type EducationMethod, type EducationSource, type EducationTopic, type EducationUnderstanding,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { kdate } from '@/lib/ui-settings';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/**
 * 환자 교육 기록 — 2026-09-30.
 *
 * 🔴 종전엔 교육이 흩어진 자유 글뿐이었다(퇴원요약·간호기록 E·약국 복약상담·영양상담). 누가·누구에게·무엇을·어떻게·이해했는가를 한 곳에 남긴다.
 *  · 주제·대상은 고르고(처음엔 미선택) 내용은 비어 있으면 안 된다 · 이해도는 평가한 경우에만(비우면 "미기록")
 *  · 지우지 않는다 — 기록한 사람이 사유와 함께 무효 처리
 *  · 다른 기록에 적힌 교육도 출처와 함께 보인다(읽기 전용) — 한 출처를 못 불러오면 그렇다고 말한다
 */
const WRITE_ROLES = ['DOCTOR', 'NURSE', 'PHARMACIST', 'NUTRITION', 'LAB_TECH', 'ADMIN'];

type Rec = {
  id: string; topic: EducationTopic; content: string; learner: EducationLearner; learnerNote: string | null; methods: EducationMethod[] | null;
  understanding: EducationUnderstanding | null; barriers: string | null; followUpNeeded: boolean | null; educatedAt: string; educatorId: string;
  educatorName: string | null; voidedAt: string | null; voidReason: string | null; voidedByName: string | null;
};
type Related = { source: Exclude<EducationSource, 'RECORD'>; id: string; at: string; byName: string | null; label: string | null; content: string };
type Resp = { records: Rec[]; related: Related[]; relatedCapPerSource: number; sourceErrors: { source: EducationSource; message: string }[] };

type Draft = { topic: '' | EducationTopic; learner: '' | EducationLearner; learnerNote: string; content: string; methods: EducationMethod[]; understanding: '' | EducationUnderstanding; barriers: string; followUpNeeded: boolean; educatedAt: string };

const localNow = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const emptyDraft = (): Draft => ({ topic: '', learner: '', learnerNote: '', content: '', methods: [], understanding: '', barriers: '', followUpNeeded: false, educatedAt: localNow() });

export function PatientEducationPanel({ patientId, compact = false }: { patientId: string; compact?: boolean }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canWrite = !!user?.role && WRITE_ROLES.includes(user.role);
  const key = ['patient-education', patientId];
  const q = useQuery({ queryKey: key, queryFn: () => apiClient.get<{ data: Resp }>(`/api/v1/patients/${patientId}/education`).then((r) => r.data) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null);
  const [showVoided, setShowVoided] = useState(false);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post(`/api/v1/patients/${patientId}/education`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['discharge-readiness'] }); },
  });
  const voidMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiClient.post(`/api/v1/patients/${patientId}/education/${id}/void`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['discharge-readiness'] }); },
  });

  const valid = !!draft && !!draft.topic && !!draft.learner && !!draft.content.trim() && !!draft.educatedAt;
  const submit = async () => {
    if (!draft || !valid) { toast.error(tAttr('주제·대상·내용·교육 시각을 정해 주세요.')); return; }
    try {
      await create.mutateAsync({
        topic: draft.topic, learner: draft.learner, content: draft.content.trim(), educatedAt: new Date(draft.educatedAt).toISOString(),
        ...(draft.learnerNote.trim() ? { learnerNote: draft.learnerNote.trim() } : {}),
        ...(draft.methods.length ? { methods: draft.methods } : {}),
        ...(draft.understanding ? { understanding: draft.understanding } : {}),
        ...(draft.barriers.trim() ? { barriers: draft.barriers.trim() } : {}),
        ...(draft.followUpNeeded ? { followUpNeeded: true } : {}),
      });
      toast.success(tAttr('환자 교육을 기록했습니다.'));
      setDraft(null);
    } catch (e) { toast.error(extractErrorMessage(e) || tAttr('환자 교육 기록에 실패했습니다.')); }
  };
  const doVoid = async () => {
    if (!voiding?.reason.trim()) return;
    try { await voidMut.mutateAsync({ id: voiding.id, reason: voiding.reason.trim() }); toast.success(tAttr('기록을 무효 처리했습니다.')); setVoiding(null); }
    catch (e) { toast.error(extractErrorMessage(e) || tAttr('무효 처리에 실패했습니다.')); }
  };

  const data = q.data;
  const active = (data?.records ?? []).filter((r) => !r.voidedAt);
  const voided = (data?.records ?? []).filter((r) => r.voidedAt);
  const chip = 'rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap';

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3" data-education-panel>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900"><T k="환자 교육" /></h3>
        {canWrite && !draft && (
          <button type="button" onClick={() => setDraft(emptyDraft())} data-education-new className="min-h-[44px] rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700"><T k="교육 기록" /></button>
        )}
      </div>

      {draft && canWrite && (
        <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3" data-education-form>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-[11px] font-semibold text-gray-500"><T k="주제 (필수)" />
              <select value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value as EducationTopic })} data-education-topic className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm">
                <option value="">{tAttr('선택')}</option>
                {EDUCATION_TOPICS.map((t) => <option key={t} value={t}>{tAttr(EDUCATION_TOPIC_LABEL[t])}</option>)}
              </select>
            </label>
            <fieldset className="text-[11px] font-semibold text-gray-500 sm:col-span-2"><legend><T k="대상 (필수)" /></legend>
              <div className="mt-1 flex flex-wrap gap-1">
                {EDUCATION_LEARNERS.map((l) => (
                  <button key={l} type="button" onClick={() => setDraft({ ...draft, learner: l })} data-education-learner={l}
                    className={`min-h-[44px] rounded-lg border px-3 text-xs ${draft.learner === l ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}>
                    <T k={EDUCATION_LEARNER_LABEL[l]} />
                  </button>
                ))}
                <input value={draft.learnerNote} onChange={(e) => setDraft({ ...draft, learnerNote: e.target.value })} maxLength={EDUCATION_TEXT_MAX.short}
                  placeholder={tAttr('보호자 관계 등(선택)')} className="min-w-[140px] flex-1 rounded-lg border border-gray-200 bg-white px-2 text-xs" />
              </div>
            </fieldset>
          </div>
          <label className="block text-[11px] font-semibold text-gray-500"><T k="교육 내용 (필수)" />
            <textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} maxLength={EDUCATION_TEXT_MAX.content} rows={3} data-education-content className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm" />
          </label>
          <fieldset className="text-[11px] font-semibold text-gray-500"><legend><T k="방법" /></legend>
            <div className="mt-1 flex flex-wrap gap-3">
              {EDUCATION_METHODS.map((m) => (
                <label key={m} className="flex min-h-[32px] items-center gap-1 text-xs font-normal text-gray-700">
                  <input type="checkbox" checked={draft.methods.includes(m)} onChange={(e) => setDraft({ ...draft, methods: e.target.checked ? [...draft.methods, m] : draft.methods.filter((x) => x !== m) })} />
                  <T k={EDUCATION_METHOD_LABEL[m]} />
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="text-[11px] font-semibold text-gray-500"><legend><T k="이해도 (평가한 경우에만)" /></legend>
            <div className="mt-1 flex flex-wrap gap-1">
              {EDUCATION_UNDERSTANDING.map((u) => (
                <button key={u} type="button" onClick={() => setDraft({ ...draft, understanding: draft.understanding === u ? '' : u })} data-education-understanding={u}
                  className={`min-h-[44px] rounded-lg border px-3 text-xs ${draft.understanding === u ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}>
                  <T k={EDUCATION_UNDERSTANDING_LABEL[u]} />
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-[11px] font-semibold text-gray-500 sm:col-span-2"><T k="교육 장애(언어·청력·인지 등)" />
              <input value={draft.barriers} onChange={(e) => setDraft({ ...draft, barriers: e.target.value })} maxLength={EDUCATION_TEXT_MAX.short} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm" />
            </label>
            <label className="text-[11px] font-semibold text-gray-500"><T k="교육 시각 (필수)" />
              <input type="datetime-local" value={draft.educatedAt} onChange={(e) => setDraft({ ...draft, educatedAt: e.target.value })} data-education-at className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm" />
            </label>
          </div>
          <label className="flex min-h-[32px] items-center gap-2 text-xs text-gray-700">
            <input type="checkbox" checked={draft.followUpNeeded} onChange={(e) => setDraft({ ...draft, followUpNeeded: e.target.checked })} />
            <T k="재교육 필요" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm text-gray-700"><T k="닫기" /></button>
            <button type="button" onClick={() => void submit()} disabled={!valid || create.isPending} data-education-submit className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50">
              {create.isPending ? <T k="저장중..." /> : <T k="저장" />}
            </button>
          </div>
        </div>
      )}

      {q.isLoading ? (
        <div className="h-16 rounded-lg bg-gray-100 animate-pulse" />
      ) : q.isError ? (
        <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />
      ) : data ? (
        <>
          {active.length === 0 ? (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500" data-education-empty><T k="교육 기록이 없습니다." /></p>
          ) : (
            <ul className="space-y-2">
              {active.map((r) => (
                <li key={r.id} className="rounded-lg border border-gray-100 px-3 py-2 text-xs" data-education-row={r.id}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`${chip} bg-indigo-50 text-indigo-700`}><T k={EDUCATION_TOPIC_LABEL[r.topic] ?? r.topic} /></span>
                    <span className={`${chip} bg-gray-100 text-gray-700`}><T k={EDUCATION_LEARNER_LABEL[r.learner] ?? r.learner} />{r.learnerNote ? ` · ${r.learnerNote}` : ''}</span>
                    <span className={`${chip} ${r.understanding === 'UNDERSTOOD' ? 'bg-emerald-50 text-emerald-700' : r.understanding ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-500'}`} data-education-understood={r.understanding ?? 'NONE'}>
                      {r.understanding ? <T k={EDUCATION_UNDERSTANDING_LABEL[r.understanding]} /> : <T k="이해도 미기록" />}
                    </span>
                    {r.followUpNeeded && <span className={`${chip} bg-rose-50 text-rose-700`}><T k="재교육 필요" /></span>}
                    <span className="ml-auto text-[11px] text-gray-500">{kdate(r.educatedAt, 'datetime')} · {r.educatorName ?? '—'}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-gray-800">{r.content}</p>
                  {(r.methods?.length || r.barriers) ? (
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      {r.methods?.length ? r.methods.map((m) => tAttr(EDUCATION_METHOD_LABEL[m] ?? m)).join(', ') : null}
                      {r.barriers ? <>{r.methods?.length ? ' · ' : ''}<T k="교육 장애" />: {r.barriers}</> : null}
                    </p>
                  ) : null}
                  {canWrite && (r.educatorId === user?.id || user?.role === 'ADMIN') && (
                    voiding?.id === r.id ? (
                      <div className="mt-1 flex gap-1">
                        <input value={voiding.reason} onChange={(e) => setVoiding({ id: r.id, reason: e.target.value })} maxLength={EDUCATION_TEXT_MAX.reason} placeholder={tAttr('무효 처리 사유(필수)')} className="flex-1 rounded border border-gray-200 px-2 text-xs" />
                        <button type="button" onClick={() => void doVoid()} disabled={!voiding.reason.trim()} className="min-h-[36px] rounded border border-rose-300 px-2 text-xs text-rose-700 disabled:opacity-50"><T k="무효 처리" /></button>
                        <button type="button" onClick={() => setVoiding(null)} className="min-h-[36px] rounded border border-gray-300 px-2 text-xs"><T k="닫기" /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setVoiding({ id: r.id, reason: '' })} data-education-void className="mt-1 text-[11px] text-gray-500 underline"><T k="잘못 기록함(무효 처리)" /></button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
          {voided.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowVoided((v) => !v)} className="text-[11px] text-gray-500 underline"><Tf k="무효 처리된 기록 {n}건" params={{ n: voided.length }} /></button>
              {showVoided && (
                <ul className="mt-1 space-y-1">
                  {voided.map((r) => (
                    <li key={r.id} className="rounded border border-dashed border-gray-200 px-2 py-1 text-[11px] text-gray-400" data-education-voided={r.id}>
                      <span className="line-through">{r.content}</span> — <T k="무효" />: {r.voidReason} ({r.voidedByName ?? '—'} · {kdate(r.voidedAt, 'datetime')})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!compact && (
            <div className="space-y-1.5 border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-gray-600"><T k="다른 기록에 적힌 교육(읽기 전용)" /></p>
              {data.sourceErrors.length > 0 && (
                <p className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800" data-education-source-error>
                  <T k="불러오지 못한 출처" />: {data.sourceErrors.map((e) => tAttr(EDUCATION_SOURCE_LABEL[e.source] ?? e.source)).join(', ')}
                </p>
              )}
              {data.related.length === 0 ? (
                <p className="text-[11px] text-gray-400"><T k="다른 기록에 적힌 교육이 없습니다." /></p>
              ) : (
                <ul className="space-y-1">
                  {data.related.map((r) => (
                    <li key={`${r.source}-${r.id}`} className="rounded bg-gray-50 px-2 py-1 text-[11px] text-gray-700" data-education-related={r.source}>
                      <span className="font-semibold text-gray-600"><T k={EDUCATION_SOURCE_LABEL[r.source]} /></span>
                      {r.label ? ` · ${r.label}` : ''} · {kdate(r.at, 'datetime')}{r.byName ? ` · ${r.byName}` : ''}
                      <p className="line-clamp-2 whitespace-pre-wrap">{r.content}</p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[10px] text-gray-400"><Tf k="출처마다 최근 {n}건까지 보입니다." params={{ n: data.relatedCapPerSource }} /></p>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
