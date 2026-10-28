'use client';

import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { markProposalPresented } from '@/lib/ai-proposal';
import { T } from '@/components/ui/i18n-text';

/**
 * F-1 간호기록 AI 근거기반 초안 패널(WeRU.B) — 기획 §8.3.
 * 비동기·논블로킹: 「초안 생성」 → 근거(EWS·낙상·MAR) 기반 초안 + 출처 칩 표시 → 「적용」 시 폼 prefill.
 * 보조 우선: AI는 DRAFT를 만들지 않고 콘텐츠만 제시. 적용 후에도 간호사가 편집·검토·서명.
 */
export interface NursingDraftCitation { field: string; source: string; refId: string; text: string; at?: string | null }
export interface NursingDraftProvenance { aiModel: string; aiPromptVersion: string; aiSourceSnapshot: Record<string, unknown> }
export interface NursingDraftResult {
  source: 'AI' | 'FALLBACK';
  noteType: string;
  draft: Record<string, string | null>;
  citations: NursingDraftCitation[];
  confidence: number;
  provenance: NursingDraftProvenance;
}

const SOURCE_LABEL: Record<string, string> = {
  EarlyWarningScore: 'NEWS2', FallRiskAssessment: '낙상', MedicationAdministration: '투약', VitalSign: 'V/S',
};

export default function NursingAiDraftPanel({ admissionId, noteType, onApply }: {
  admissionId: string;
  noteType: string;
  onApply: (draft: Record<string, string | null>, provenance: NursingDraftProvenance, citations: NursingDraftCitation[]) => void;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'disabled' | 'error'>('idle');
  const [result, setResult] = useState<NursingDraftResult | null>(null);
  const [errMsg, setErrMsg] = useState('');
  /** 노출 보고를 이미 보낸 제안 id — 리렌더마다 다시 보내지 않는다(서버도 멱등이지만 호출을 만들지 않는다) */
  const presentedRef = useRef<string | null>(null);

  /**
   * 🔴 **노출(PRESENTED)은 화면이 실제로 그렸을 때만** 보고한다 — 생성됨 ≠ 사람이 봤음.
   *    이 보고가 없으면 감독 지표가 결정 건을 "0초 만에 검토한 건"으로 읽는다(서버가 `NOT_PRESENTED` 로 표시).
   *    제안 id 가 없는 초안(원장 미기록)은 보고할 대상이 없다 — 지어내지 않는다.
   */
  useEffect(() => {
    if (state !== 'ready' || !result) return;
    const id = (result.provenance?.aiSourceSnapshot as { aiProposalId?: unknown } | undefined)?.aiProposalId;
    if (typeof id !== 'string' || !id || presentedRef.current === id) return;
    presentedRef.current = id;
    void markProposalPresented(id, 'nursing-ai-draft');
  }, [state, result]);

  const generate = async () => {
    setState('loading'); setResult(null); setErrMsg('');
    try {
      const res = await apiClient.post<{ data: NursingDraftResult }>(`/api/v1/admissions/${admissionId}/nursing-notes/ai-draft`, { noteType });
      const r = ((res as { data?: { data?: NursingDraftResult } })?.data?.data ?? (res as { data?: NursingDraftResult })?.data) as NursingDraftResult;
      setResult(r); setState('ready');
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err?.code === 'AI_ASSIST_DISABLED') setState('disabled');
      else { setErrMsg(err?.message ?? '초안 생성 실패'); setState('error'); }
    }
  };

  const apply = () => {
    if (result) onApply(result.draft, result.provenance, result.citations);
    setState('idle'); setResult(null);
  };

  return (
    <div className="relative rounded-lg border border-amber-200 bg-amber-50/40 pl-3 pr-3 py-2.5">
      <span className="absolute left-0 top-0 h-full w-0.5 rounded-l bg-gradient-to-b from-amber-400 to-transparent" />
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-amber-800">✦ {AI_ORIGIN_TEXT} 간호기록 초안</span>
        {state === 'idle' && (
          <button onClick={generate} className="px-2.5 py-1 rounded bg-amber-600 text-white text-xs hover:bg-amber-700"><T k="초안 생성" /></button>
        )}
        {state === 'loading' && (
          <span className="flex items-center gap-1.5 text-xs text-amber-700">
            <span className="w-3 h-3 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin" /> <T k="근거 수집·작성 중…" />
          </span>
        )}
        {(state === 'error' || state === 'disabled') && (
          <button onClick={generate} className="px-2.5 py-1 rounded border border-amber-300 text-amber-700 text-xs hover:bg-amber-100">{<T k="다시 시도" />}</button>
        )}
      </div>

      {state === 'disabled' && (
        <p className="mt-1.5 text-[11px] text-gray-500">간호기록 {AI_ORIGIN_TEXT} 보조가 비활성 상태입니다(관리자 설정 필요).</p>
      )}
      {state === 'error' && (
        <p className="mt-1.5 text-[11px] text-rose-600">{errMsg}</p>
      )}

      {state === 'ready' && result && (
        <div className="mt-2 space-y-2">
          {result.source === 'FALLBACK' && (
            <p className="text-[11px] text-gray-500">{AI_ORIGIN_TEXT} 미사용(근거 기반 객관 항목만) — 판단·계획은 간호사가 작성하세요.</p>
          )}
          {result.confidence > 0 && result.confidence < 0.4 && (
            <p className="text-[11px] text-rose-600"><T k="초안 신뢰도 낮음 — 면밀히 검토하세요." /></p>
          )}
          {/* 초안 미리보기 */}
          <div className="space-y-1 text-xs text-gray-700">
            {Object.entries(result.draft).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex gap-1.5">
                <span className="flex-shrink-0 font-semibold text-gray-400 uppercase text-[10px] mt-0.5">{k.slice(0, 3)}</span>
                <span className="whitespace-pre-wrap leading-relaxed">{v}</span>
              </div>
            ))}
          </div>
          {/* 근거 칩 */}
          {result.citations.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {result.citations.map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white border border-amber-200 text-[10px] text-amber-800 whitespace-nowrap"
                  title={`${c.source} · ${c.refId}`}>
                  📎 {SOURCE_LABEL[c.source] ?? c.source} {c.text}
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2 pt-0.5">
            <button onClick={apply} className="px-3 py-1 rounded bg-amber-600 text-white text-xs hover:bg-amber-700">{<T k="적용" />}</button>
            <button onClick={() => { setState('idle'); setResult(null); }} className="px-3 py-1 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50">{<T k="무시" />}</button>
          </div>
          <p className="text-[10px] text-gray-400"><T k="근거 외 임상사실은 생성하지 않습니다. 적용 후 반드시 검토·수정하고 간호사 책임으로 서명하세요." /></p>
        </div>
      )}
    </div>
  );
}
