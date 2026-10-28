'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * [위원회 상정] 공용 부품(거버넌스 P3 §6 · TipTap 개편 2026-08-05) —
 * 리치 에디터(정본 rich-text-editor 재사용) + AI 사전 검토(유사/중복 안건·관련 기능·보완 질의·비차단).
 * sourceRef 규약: { type: 'SAFETY_GATE'|'GO_LIVE'|'FORMULARY_REQUEST'|'DATA_QUALITY', key }
 * surfaceKey(예 'config:dur.enforce')를 주면 표면 담당 매핑(D14)으로 위원회를 자동 제안한다.
 */

export interface ProposeSourceRef { type: 'SAFETY_GATE' | 'GO_LIVE' | 'FORMULARY_REQUEST' | 'DATA_QUALITY' | 'DECISION'; key: string; [k: string]: unknown }

interface Committee { id: string; code: string; name: string; quorum?: number }
interface SurfaceMapRow { surfaceKey: string; committeeId: string; note?: string | null }
interface PrecheckResult {
  similar: { agendaId: string; title: string; status: string; decisionNo?: string | null; committee?: string | null; reason: string }[];
  relatedFeatures: string[];
  questions: string[];
  scopeNote?: string | null;
  disclaimer: string;
}

function unwrap<T>(res: unknown): T | undefined {
  const inner = (res as { data?: unknown })?.data;
  return ((inner as { data?: unknown })?.data ?? inner) as T | undefined;
}

const AGENDA_STATUS_LABEL: Record<string, string> = {
  SUBMITTED: '접수', SCHEDULED: '상정', RESOLVED: '의결', REJECTED: '부결', DEFERRED: '보류', WITHDRAWN: '철회',
};

export function ProposeAgendaModal({ sourceRef, surfaceKey, committeeCodes, defaultTitle = '', defaultBody = '', onClose, onDone }: {
  sourceRef?: ProposeSourceRef;
  surfaceKey?: string;
  /**
   * 🔴 이 안건을 받을 수 있는 위원회 — `[주관, ...합동]`(결정 등록부 정본 shared `decision-committees`).
   *    주면 그 위원회만 고를 수 있고 주관이 미리 골라진다. 서버도 같은 규칙으로 거부한다(화면만 막지 않는다).
   */
  committeeCodes?: readonly string[];
  defaultTitle?: string;
  defaultBody?: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const summaryQ = useQuery({
    queryKey: ['gov-summary'],
    queryFn: () => apiClient.get('/api/v1/governance/summary'),
    staleTime: 60_000,
  });
  const allCommittees = unwrap<{ committees: Committee[] }>(summaryQ.data)?.committees ?? [];
  // 주관이 먼저 — 등록부가 준 순서(주관, 합동…)대로
  const committees = committeeCodes?.length
    ? allCommittees.filter((c) => committeeCodes.includes(c.code)).sort((a, b) => committeeCodes.indexOf(a.code) - committeeCodes.indexOf(b.code))
    : allCommittees;
  const leadId = committeeCodes?.length ? allCommittees.find((c) => c.code === committeeCodes[0])?.id : undefined;

  const surfaceQ = useQuery({
    queryKey: ['gov-surface-map'],
    queryFn: () => apiClient.get('/api/v1/governance/surface-map'),
    staleTime: 300_000,
  });
  const surfaceRows = unwrap<SurfaceMapRow[]>(surfaceQ.data) ?? [];
  const suggestedId = leadId ?? (surfaceKey ? surfaceRows.find((r) => r.surfaceKey === surfaceKey)?.committeeId : undefined);

  const [committeeId, setCommitteeId] = useState('');
  const effectiveCommitteeId = committeeId || suggestedId || '';
  const [title, setTitle] = useState(defaultTitle);
  // 종전 plain 텍스트 defaultBody(상정 버튼의 실측 요약) → 단락 HTML 로 승격
  const [body, setBody] = useState(defaultBody && !/^\s*</.test(defaultBody)
    ? `<p>${defaultBody.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '</p><p>')}</p>`
    : defaultBody);
  const [precheck, setPrecheck] = useState<PrecheckResult | null>(null);

  const committeeSurfaces = surfaceRows.filter((r) => r.committeeId === effectiveCommitteeId);
  const selectedCommittee = committees.find((c) => c.id === effectiveCommitteeId);
  const bodyEmpty = !body || !body.replace(/<[^>]+>/g, '').trim();

  const runPrecheck = useMutation({
    mutationFn: () => apiClient.post('/api/v1/governance/agendas/precheck', {
      ...(effectiveCommitteeId ? { committeeId: effectiveCommitteeId } : {}),
      title: title.trim(),
      ...(bodyEmpty ? {} : { body }),
    }),
    onSuccess: (res) => {
      const r = unwrap<PrecheckResult>(res);
      if (r) setPrecheck(r);
    },
    onError: (e) => toast.error((e as { message?: string })?.message || 'AI 사전 검토 실패 — governance.ai.enabled·AI 서버 상태를 확인하세요.'),
  });

  const submit = useMutation({
    mutationFn: () => apiClient.post('/api/v1/governance/agendas', {
      committeeId: effectiveCommitteeId,
      title: title.trim(),
      ...(bodyEmpty ? {} : { body }),
      ...(sourceRef ? { sourceRef } : {}),
    }),
    onSuccess: () => {
      toast.success('위원회에 안건이 접수되었습니다 — /admin/governance 안건 탭에서 추적하세요.');
      qc.invalidateQueries({ queryKey: ['gov-agendas'] });
      qc.invalidateQueries({ queryKey: ['gov-summary'] });
      onDone?.();
      onClose();
    },
    onError: (e) => toast.error((e as { message?: string })?.message || '안건 접수에 실패했습니다.'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-bold text-gray-900"><T k="위원회 상정" /></h3>
          <p className="text-[11px] text-gray-400 mt-0.5">전 직원 제안 가능 · 근거(실측 수치·화면·문서)를 인용할수록 심의가 빨라집니다. 상정 전 <b>AI 사전 검토</b>로 유사 안건·보완점을 확인하세요.</p>
        </div>
        {sourceRef && (
          <p className="text-[11px] text-gray-500 bg-gray-50 rounded-lg px-2.5 py-1.5"><T k="출처 자동 첨부:" /> <span className="font-mono">{sourceRef.type} · {sourceRef.key}</span></p>
        )}

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="위원회" /></label>
          <select value={effectiveCommitteeId} onChange={(e) => { setCommitteeId(e.target.value); setPrecheck(null); }}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="">{tAttr('— 위원회 선택 —')}</option>
            {committees.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code}){c.id === suggestedId ? (leadId ? ' · 주관' : ' · 담당') : (committeeCodes?.length ? ' · 합동' : '')}</option>
            ))}
          </select>
          {committeeCodes?.length ? (
            <p className="mt-1 text-[11px] text-indigo-800" data-propose-assigned>
              <T k="이 결정은 등록부가 정한 주관·합동 위원회에만 올릴 수 있습니다" />
            </p>
          ) : null}
          {committeeSurfaces.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1 items-center">
              <span className="text-[10px] text-gray-400">{selectedCommittee?.code} <T k="담당 표면:" /></span>
              {committeeSurfaces.slice(0, 5).map((s) => (
                <span key={s.surfaceKey} title={s.note ?? ''} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{s.surfaceKey.replace(/^(config|master|template):/, '')}</span>
              ))}
              {committeeSurfaces.length > 5 && <span className="text-[10px] text-gray-400">외 {committeeSurfaces.length - 5}</span>}
            </div>
          )}
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="안건 제목 *" /></label>
          <input value={title} onChange={(e) => { setTitle(e.target.value); setPrecheck(null); }} placeholder={tAttr('예: ○○ 게이트 WARN 전환 판단 — 근거 요약')}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="배경·근거·제안 내용" /></label>
          <RichTextEditor content={body} onChange={setBody}
            placeholder={tAttr('배경 → 실측 근거(수치·날짜) → 제안(원하는 결정) 순으로 쓰면 좋습니다…')} />
        </div>

        {/* AI 사전 검토 — 비차단 브리핑 */}
        <div className="border border-violet-100 bg-violet-50/40 rounded-xl p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-violet-700">🤖 <T k="AI 사전 검토" /> <span className="font-normal text-violet-400"><T k="— 유사 안건·관련 기능·보완 질의(비차단)" /></span></p>
            <button onClick={() => runPrecheck.mutate()} disabled={!title.trim() || runPrecheck.isPending}
              className="px-2.5 py-1 text-[11px] font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-40">
              {/* 🔴 `재검토` 는 앞 카탈로그에 'Review due'(검토 기한)로 이미 있다 — 여기선 "다시 검토"라
                  뜻이 다르므로 문맥 키 `재검토@AI검토` 를 쓴다(동음이의 규약). */}
              {runPrecheck.isPending ? <T k="검토 중…(수십 초)" /> : precheck ? <T k="재검토@AI검토" /> : <T k="검토 실행" />}
            </button>
          </div>
          {precheck && (
            <div className="mt-2 space-y-2 text-xs text-gray-700">
              {precheck.similar.length > 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                  <p className="font-bold text-amber-700 mb-1">⚠ 유사·중복 가능 안건 {precheck.similar.length}건 — 기존 안건을 먼저 확인하세요</p>
                  {precheck.similar.map((s) => (
                    <div key={s.agendaId} className="py-0.5">
                      {/* 🔴 안건 상태 어휘는 앞 카탈로그와 동음이의다(`접수`→'Reception'(외래 접수) ·
                          `철회`→'Revoked'). 문맥 키 `@안건` 으로 분리한다 — ko 는 `@` 뒤가 잘려 렌더 불변. */}
                      <span className="text-[10px] font-bold px-1 rounded bg-amber-100 text-amber-700 mr-1"><T k={`${AGENDA_STATUS_LABEL[s.status] ?? s.status}@안건`} /></span>
                      <span className="font-medium">{s.title}</span>
                      {s.decisionNo && <span className="ml-1 font-mono text-[10px] text-indigo-500">⚖ {s.decisionNo}</span>}
                      <span className="text-gray-500"> — {s.reason}</span>
                    </div>
                  ))}
                  <p className="text-[10px] text-amber-600 mt-1"><T k="의결된 안건의 변경 요청이라면 새 안건에서 해당 GOV 번호를 인용(supersede 재심의)하세요." /></p>
                </div>
              ) : (
                <p className="text-emerald-700">✓ <T k="유사·중복 안건이 발견되지 않았습니다." /></p>
              )}
              {precheck.questions.length > 0 && (
                <div>
                  <p className="font-bold text-violet-700"><T k="상정 전 보완 질의" /></p>
                  <ul className="list-disc ml-4 mt-0.5 space-y-0.5">
                    {precheck.questions.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </div>
              )}
              {precheck.relatedFeatures.length > 0 && (
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="font-bold text-violet-700"><T k="관련 기능·표면:" /></span>
                  {precheck.relatedFeatures.map((f, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-violet-100 text-violet-700">{f}</span>
                  ))}
                </div>
              )}
              {precheck.scopeNote && <p><b className="text-violet-700"><T k="집행 경로" /></b> — {precheck.scopeNote}</p>}
              <p className="text-[10px] text-violet-400">{precheck.disclaimer}</p>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={() => submit.mutate()} disabled={!effectiveCommitteeId || !title.trim() || submit.isPending}
            className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl disabled:opacity-40 hover:bg-blue-700">
            {/* 🔴 `접수 중…` 은 앞 카탈로그에 'Checking in…'(외래 접수)로 있다 — 여기선 안건 제출이라
                  뜻이 다르므로 문맥 키를 쓴다. `상정` 도 마찬가지로 이 화면 어휘다. */}
            {submit.isPending ? <T k="접수 중…@안건" /> : precheck?.similar.length ? <T k="유사 안건 확인함 · 상정" /> : <T k="상정" />}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
        </div>
      </div>
    </div>
  );
}

/** 버튼+모달 결합형 — 목록/카드 행에 바로 심는 용도 */
export function ProposeAgendaButton({ sourceRef, surfaceKey, committeeCodes, defaultTitle, defaultBody, className, label = '위원회 상정' }: {
  sourceRef: ProposeSourceRef;
  surfaceKey?: string;
  committeeCodes?: readonly string[];
  defaultTitle?: string;
  defaultBody?: string;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={className ?? 'px-2 py-1 text-[11px] font-medium bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 whitespace-nowrap'}>
        ⚖ {label}
      </button>
      {open && (
        <ProposeAgendaModal sourceRef={sourceRef} surfaceKey={surfaceKey} committeeCodes={committeeCodes}
          defaultTitle={defaultTitle} defaultBody={defaultBody} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
