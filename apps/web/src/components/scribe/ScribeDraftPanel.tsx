'use client';

import { useState } from 'react';
import { toast } from '@/stores/toast-store';
import { scribeApi, type ScribeDraft } from '@/lib/scribe-api';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';

export interface SoapDraft {
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
}

function extractSoap(d: ScribeDraft): SoapDraft {
  const s = (d.soap ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof s[k] === 'string' ? (s[k] as string) : undefined);
  return {
    subjective: pick('subjective') ?? pick('S'),
    objective: pick('objective') ?? pick('O'),
    assessment: pick('assessment') ?? pick('A'),
    plan: pick('plan') ?? pick('P'),
  };
}

const FIELD_LABEL: Record<keyof SoapDraft, string> = { subjective: 'S 주관', objective: 'O 객관', assessment: 'A 평가', plan: 'P 계획' };

/**
 * WeRU.B SOAP 초안 패널(§8.2) — 전사→초안(NER+SOAP) 생성·검토·S/O/A/P 적용.
 * 보조 우선(P-1): AI는 초안만. 적용 후에도 의사가 편집·검토·서명. 면책(disclaimer) 표기.
 */
export default function ScribeDraftPanel({
  encounterId,
  sessionId,
  onApply,
}: {
  encounterId: string;
  sessionId: string;
  onApply?: (field: keyof SoapDraft, text: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<ScribeDraft | null>(null);

  const generate = async () => {
    setLoading(true);
    try {
      const res = await scribeApi.draft(encounterId, sessionId);
      setDraft(res.data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('NO_TRANSCRIPT')) toast.info('전사가 아직 준비되지 않았습니다.');
      else if (msg.includes('TRANSCRIPTION_DISABLED')) toast.info('전사 기능이 비활성 상태입니다.');
      else toast.error('초안 생성 실패 — 직접 작성해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  const soap = draft ? extractSoap(draft) : null;

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-800 dark:bg-amber-950/20">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-amber-800 dark:text-amber-300">✦ {AI_ORIGIN_TEXT} SOAP 초안</span>
        <button type="button" onClick={generate} disabled={loading} className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
          {loading ? '생성 중…' : draft ? '재생성' : '생성'}
        </button>
      </div>

      {draft?.chief_complaint && <p className="mb-2 text-xs text-neutral-600 dark:text-neutral-300">주호소: {draft.chief_complaint}</p>}

      {soap && (
        <div className="space-y-1.5">
          {(Object.keys(FIELD_LABEL) as (keyof SoapDraft)[]).map((f) => {
            const val = soap[f];
            if (!val) return null;
            return (
              <div key={f} className="rounded bg-white p-2 text-sm dark:bg-neutral-900">
                <div className="mb-0.5 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-neutral-500">{FIELD_LABEL[f]}</span>
                  {onApply && (
                    <button type="button" onClick={() => onApply(f, val)} className="text-[11px] text-amber-700 underline dark:text-amber-400">
                      적용
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-neutral-800 dark:text-neutral-200">{val}</p>
              </div>
            );
          })}
          {Array.isArray(draft?.icd_codes) && draft!.icd_codes!.length > 0 && (
            <p className="text-[11px] text-neutral-500">ICD 후보: {draft!.icd_codes!.join(', ')} (의사 확정 필요)</p>
          )}
        </div>
      )}

      {draft && (
        <p className="mt-2 text-[10px] leading-tight text-neutral-400">
          {typeof draft.disclaimer === 'string'
            ? draft.disclaimer
            : `${AI_ORIGIN_TEXT}가 생성한 참고 초안입니다. 진단·처방 등 최종 판단·서명은 의료진이 수행합니다.`}
        </p>
      )}
    </div>
  );
}
