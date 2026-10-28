'use client';

/**
 * 서명 전 기록품질 체크리스트 — **감시 모드, 비차단**(chart-ai-assistant-agent §4.2 기록품질 · §7.2 감시).
 *
 * 🔴 이것은 게이트가 아니다. 서명 버튼은 이 결과와 무관하게 살아 있고, 호출은 서명과 **병렬**로 돈다(서명을 기다리게 하지 않는다).
 *    "막지 않는다"를 화면이 그대로 말한다. 실패는 실패라고 말한다("서명은 계속할 수 있습니다").
 * 🔴 종전(2026-08-19 이전) page.tsx 는 서명 핸들러가 chart-qa 를 **await** 했다 — 6~17초 동안 서명이 멈췄고, 결과는 toast 한 줄로 사라졌다.
 */
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { KDate } from '@/components/ui/display';
import { SkillNotice, type SkillEnvelope } from './AiAssistantPanel';
import { T } from '@/components/ui/i18n-text';

export interface PreSignQaIssue {
  category: string;
  level: 'ERROR' | 'WARNING' | 'INFO' | string;
  message: string;
  suggestion?: string;
}
export interface PreSignQaResult extends SkillEnvelope {
  score?: number;
  grade?: string;
  level?: string;
  totalIssues?: number;
  issues?: PreSignQaIssue[];
}

export type PreSignQaState =
  | { status: 'idle' }
  | { status: 'running'; startedAt: string }
  | { status: 'done'; result: PreSignQaResult; at: string; inputKey: string }
  | { status: 'failed'; error: string; at: string };

const LEVEL_TONE: Record<string, { box: string; chip: string }> = {
  ERROR: { box: 'bg-rose-50 border-rose-200', chip: 'bg-rose-600 text-white' },
  WARNING: { box: 'bg-amber-50 border-amber-200', chip: 'bg-amber-500 text-white' },
  INFO: { box: 'bg-blue-50 border-blue-200', chip: 'bg-blue-500 text-white' },
};

export function PreSignQaChecklist({
  state, onRun, canRun, afterSign = false, className = '',
}: {
  state: PreSignQaState;
  /** "지금 확인" — 현재 폼 값으로 다시 돈다 */
  onRun?: () => void;
  canRun?: boolean;
  /** 서명 뒤 도착한 결과 — 기록은 이미 서명됐음을 함께 말한다 */
  afterSign?: boolean;
  className?: string;
}) {
  if (state.status === 'idle') return null;
  return (
    <div className={`rounded-xl border border-indigo-100 bg-indigo-50/30 px-4 py-3 space-y-2 ${className}`} data-presign-qa={state.status} role="status" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-indigo-800">
          {AI_ORIGIN_TEXT} 기록품질 제안 <span className="font-normal text-indigo-500">— 감시 모드 · 막지 않습니다</span>
          {afterSign && <span className="ml-1 font-normal text-gray-500"><T k="(기록은 이미 서명되었습니다 — 보완은 정정 절차로)" /></span>}
        </p>
        {onRun && !afterSign && (
          <button type="button" onClick={onRun} disabled={!canRun || state.status === 'running'}
            className="min-h-[44px] px-3 text-xs font-medium rounded-lg bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-40">
            {state.status === 'running' ? '확인 중…' : '다시 확인'}
          </button>
        )}
      </div>

      {state.status === 'running' && (
        <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" aria-hidden="true" />
          <T k="기록품질 확인 중 (최대 15초) — 서명은 기다리지 않습니다" />
        </p>
      )}

      {state.status === 'failed' && (
        <p className="text-[11px] text-rose-700" data-presign-qa-failed><T k="기록품질 확인 실패 — 서명은 계속할 수 있습니다" /> <span className="text-rose-500">({state.error})</span></p>
      )}

      {state.status === 'done' && (() => {
        const r = state.result;
        const issues = r.issues ?? [];
        return (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
              <SkillNotice env={r} />
              <span className="text-gray-400"><KDate value={state.at} mode="time" /> 기준</span>
              {r.grade != null && <span>등급 {r.grade}</span>}
              {r.totalIssues != null && <span>이슈 {r.totalIssues}건</span>}
            </div>
            {issues.length === 0 ? (
              <p className="text-[11px] text-gray-600">{r.source === 'FALLBACK' || r.source === 'UNAVAILABLE' ? '이슈 목록을 산출하지 못했습니다(위 사유)' : `${AI_ORIGIN_TEXT}가 찾은 이슈 없음 — 없다는 뜻이 아니라 찾지 못했다는 뜻입니다`}</p>
            ) : (
              <ul className="space-y-1">
                {issues.map((it, i) => {
                  const tone = LEVEL_TONE[it.level] ?? LEVEL_TONE.INFO;
                  return (
                    <li key={i} className={`rounded-lg border px-2.5 py-1.5 ${tone.box}`}>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${tone.chip}`}>{it.level}</span>
                        <span className="text-[10px] text-gray-500">{it.category}</span>
                      </div>
                      <p className="text-xs text-gray-800 mt-0.5">{it.message}</p>
                      {it.suggestion && <p className="text-[11px] text-indigo-600 mt-0.5">제안: {it.suggestion}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })()}
    </div>
  );
}
