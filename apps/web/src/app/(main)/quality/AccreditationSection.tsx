'use client';

/**
 * 인증 기준 자체 평가(QI-FLOW-001 · 2026-10-08).
 *
 * 🔴 기준 문구는 담당자가 **원문을 보고** 넣는다 — 시스템이 인증 기준을 지어 넣지 않는다(시드 없음).
 * 🔴 체계(의료기관평가인증·JCI)는 위원회 결정(accreditation.framework) 전엔 등록이 닫혀 있다.
 *  · 평가는 덧붙이기만(이전 판단이 남는다) · 부분 충족·미충족은 근거 필수
 *  · 자가 평가와 확인(다른 사람)을 가른다 — 확인 전엔 "자가 평가"로 그린다
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACCREDITATION_JUDGMENTS, ACCREDITATION_JUDGMENT_LABEL, type AccreditationJudgment } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Assessment { id: string; cycle: string; judgment: AccreditationJudgment; evidenceText: string | null; assessedBy: string; assessedAt: string; verifiedAt: string | null; verifiedBy: string | null; dueDate: string | null; verified?: boolean }
interface Standard { id: string; framework: string; chapter: string; code: string; title: string; measurableElement: string | null; sourceRef: string | null; latest: Assessment | null }
interface AccreditationList { setting: unknown; allowed: string[]; standards: Standard[] }

const FRAMEWORK_LABEL: Record<string, string> = { KOIHA: '의료기관평가인증', JCI: 'JCI' };
const TONE: Record<AccreditationJudgment, string> = { MET: 'bg-emerald-50 text-emerald-700', PARTIAL: 'bg-amber-50 text-amber-700', NOT_MET: 'bg-red-50 text-red-700', NA: 'bg-gray-100 text-gray-500' };

function AssessForm({ standard, onDone }: { standard: Standard; onDone: () => void }) {
  const tAttr = useTAttr();
  // 🔴 판정은 미선택으로 시작한다
  const [f, setF] = useState({ cycle: String(new Date().getFullYear()), judgment: '' as AccreditationJudgment | '', evidenceText: '', dueDate: '' });
  const needEvidence = f.judgment === 'PARTIAL' || f.judgment === 'NOT_MET';
  // 서버 @Roles(ADMIN·NURSE) 와 같은 판정
  const canAssess = useHasRole('NURSE');
  const save = useMutation({
    mutationFn: () => {
      if (!canAssess) return Promise.reject(new Error(tAttr('자체 평가는 간호사·관리자가 기록합니다.')));
      return apiClient.post(`/api/v1/quality-flow/accreditation/standards/${standard.id}/assessments`, {
      cycle: f.cycle, judgment: f.judgment, ...(f.evidenceText.trim() ? { evidenceText: f.evidenceText.trim() } : {}), ...(f.dueDate ? { dueDate: f.dueDate } : {}),
      });
    },
    onSuccess: () => { toast.success(tAttr('자체 평가를 기록했습니다 — 다른 사람이 확인하기 전까지 자가 평가로 표시됩니다.')); onDone(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('평가를 기록하지 못했습니다.')),
  });
  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs" data-qi-accr-assess={standard.id}>
      <div className="flex flex-wrap items-center gap-2">
        <input value={f.cycle} onChange={(e) => setF({ ...f, cycle: e.target.value })} aria-label={tAttr('평가 주기')} className="w-24 rounded-lg border border-gray-200 px-2 py-1" />
        <select value={f.judgment} onChange={(e) => setF({ ...f, judgment: e.target.value as AccreditationJudgment | '' })} aria-label={tAttr('판정')} className="rounded-lg border border-gray-200 px-2 py-1">
          <option value="">{tAttr('판정 선택')}</option>
          {ACCREDITATION_JUDGMENTS.map((j) => <option key={j} value={j}>{tAttr(ACCREDITATION_JUDGMENT_LABEL[j])}</option>)}
        </select>
        <input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} aria-label={tAttr('보완 기한')} className="rounded-lg border border-gray-200 px-2 py-1" />
      </div>
      <textarea value={f.evidenceText} onChange={(e) => setF({ ...f, evidenceText: e.target.value })} rows={2} aria-label={tAttr('근거')}
        placeholder={tAttr(needEvidence ? '근거 — 무엇이 부족한지(필수)' : '근거(선택)')} className="w-full rounded-lg border border-gray-200 px-2 py-1" />
      <button type="button" disabled={!f.judgment || !f.cycle.trim() || (needEvidence && !f.evidenceText.trim()) || save.isPending} onClick={() => save.mutate()}
        className="min-h-[44px] rounded-lg bg-gray-900 px-3 font-semibold text-white disabled:opacity-40" data-qi-accr-assess-save>
        <T k="평가 기록" />
      </button>
    </div>
  );
}

export default function AccreditationSection() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const isAdmin = useHasRole();
  const canAssess = useHasRole('NURSE');
  const [assessing, setAssessing] = useState<string | null>(null);
  // 🔴 등록 폼은 빈칸·미선택으로 시작한다(기준 문구를 지어 넣지 않는다)
  const [draft, setDraft] = useState({ framework: '', chapter: '', code: '', title: '', measurableElement: '', sourceRef: '' });
  const q = useQuery({
    queryKey: ['qi-accreditation'],
    queryFn: () => apiClient.get<{ data: AccreditationList }>('/api/v1/quality-flow/accreditation').then((r) => r.data),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['qi-accreditation'] });
  const create = useMutation({
    mutationFn: () => {
      if (!isAdmin) throw new Error(tAttr('인증 기준은 관리자가 등록합니다.'));
      return apiClient.post('/api/v1/quality-flow/accreditation/standards', {
        framework: draft.framework, chapter: draft.chapter, code: draft.code, title: draft.title,
        ...(draft.measurableElement.trim() ? { measurableElement: draft.measurableElement } : {}), ...(draft.sourceRef.trim() ? { sourceRef: draft.sourceRef } : {}),
      });
    },
    onSuccess: () => { toast.success(tAttr('인증 기준을 등록했습니다.')); setDraft({ framework: '', chapter: '', code: '', title: '', measurableElement: '', sourceRef: '' }); refresh(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('인증 기준을 등록하지 못했습니다.')),
  });
  const verify = useMutation({
    mutationFn: (id: string) => {
      if (!isAdmin) throw new Error(tAttr('확인은 관리자가 합니다.'));
      return apiClient.post(`/api/v1/quality-flow/accreditation/assessments/${id}/verify`, {});
    },
    onSuccess: () => { toast.success(tAttr('평가를 확인했습니다.')); refresh(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('확인하지 못했습니다.')),
  });
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  if (!d) return <div className="h-16 animate-pulse rounded-lg bg-gray-100" />;
  const input = 'rounded-lg border border-gray-200 px-2 py-1';
  return (
    <div className="space-y-2 text-xs" data-qi-accreditation data-allowed={d.allowed.join(',')}>
      {d.allowed.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800" data-qi-accr-closed>
          <T k="인증 체계가 정해지지 않았습니다(결정 accreditation.framework) — 정해지기 전에는 기준을 등록할 수 없습니다." />
        </p>
      )}
      {isAdmin && d.allowed.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-gray-200 p-2" data-qi-accr-create>
          <p className="text-[11px] text-gray-600"><T k="기준 문구는 인증 기준 원문을 보고 입력하십시오 — 시스템은 기준을 채워 넣지 않습니다." /></p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={draft.framework} onChange={(e) => setDraft({ ...draft, framework: e.target.value })} aria-label={tAttr('인증 체계')} className={input}>
              <option value="">{tAttr('체계 선택')}</option>
              {d.allowed.map((f) => <option key={f} value={f}>{tAttr(FRAMEWORK_LABEL[f] ?? f)}</option>)}
            </select>
            <input value={draft.chapter} onChange={(e) => setDraft({ ...draft, chapter: e.target.value })} placeholder={tAttr('장')} aria-label={tAttr('장')} className={`${input} w-24`} />
            <input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder={tAttr('기준 코드')} aria-label={tAttr('기준 코드')} className={`${input} w-28`} />
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={tAttr('기준 제목')} aria-label={tAttr('기준 제목')} className={`${input} min-w-[14rem] flex-1`} />
          </div>
          <textarea value={draft.measurableElement} onChange={(e) => setDraft({ ...draft, measurableElement: e.target.value })} rows={2} placeholder={tAttr('조사 항목(ME · 선택)')} aria-label={tAttr('조사 항목')} className={`${input} w-full`} />
          <input value={draft.sourceRef} onChange={(e) => setDraft({ ...draft, sourceRef: e.target.value })} placeholder={tAttr('원문 출처(판·쪽 · 선택)')} aria-label={tAttr('원문 출처')} className={`${input} w-full`} />
          <button type="button" disabled={!draft.framework || !draft.chapter.trim() || !draft.code.trim() || !draft.title.trim() || create.isPending} onClick={() => create.mutate()}
            className="min-h-[44px] rounded-lg bg-gray-900 px-3 font-semibold text-white disabled:opacity-40" data-qi-accr-create-save>
            <T k="기준 등록" />
          </button>
        </div>
      )}
      {d.standards.length === 0 ? <p className="text-gray-400"><T k="등록된 인증 기준이 없습니다." /></p> : (
        <ul className="space-y-1.5">
          {d.standards.map((s) => (
            <li key={s.id} className="rounded-lg border border-gray-100 px-2 py-1.5" data-qi-accr-standard={s.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-gray-400"><T k={FRAMEWORK_LABEL[s.framework] ?? s.framework} /></span>
                <b>{s.code}</b>
                <span className="flex-1 text-gray-800">{s.title}</span>
                {s.latest ? (
                  <>
                    <span className={`rounded px-1.5 text-[10px] ${TONE[s.latest.judgment]}`}><T k={ACCREDITATION_JUDGMENT_LABEL[s.latest.judgment]} /></span>
                    <span className="text-[10px] text-gray-500" data-qi-accr-verified={s.latest.verifiedAt ? 'yes' : 'no'}>
                      <T k={s.latest.verifiedAt ? '확인됨' : '자가 평가(확인 전)'} /> · <KDate value={s.latest.assessedAt} />
                    </span>
                    {isAdmin && !s.latest.verifiedAt && (
                      <button type="button" onClick={() => verify.mutate(s.latest!.id)} disabled={verify.isPending} className="rounded border border-gray-300 px-2 py-0.5 text-[11px]" data-qi-accr-verify={s.latest.id}>
                        <T k="확인" />
                      </button>
                    )}
                  </>
                ) : <span className="text-[10px] text-gray-400"><T k="평가 없음" /></span>}
                {canAssess && (
                  <button type="button" onClick={() => setAssessing(assessing === s.id ? null : s.id)} className="rounded border border-gray-200 px-2 py-0.5 text-[11px]">
                    <T k={assessing === s.id ? '닫기' : '평가'} />
                  </button>
                )}
              </div>
              {s.latest?.evidenceText && <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-gray-600">{s.latest.evidenceText}</p>}
              {assessing === s.id && <AssessForm standard={s} onDone={() => { setAssessing(null); refresh(); }} />}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-gray-400"><T k="평가는 덧붙이기만 합니다(이전 판단이 남습니다) · 평가한 사람은 스스로 확인할 수 없습니다." /></p>
    </div>
  );
}
