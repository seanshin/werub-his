'use client';

import { useState } from 'react';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { AiOriginLabel, AiDisclaimer } from './AiOriginLabel';
import { T, useTAttr, Tf } from '@/components/ui/i18n-text';

/**
 * AI 보조 패널 디자인 시스템
 * - 좌측 amber 세로선 (AI 영역 표시)
 * - amber/warm 계열 색상 (의료진 영역 blue와 구분)
 * - 표기는 정본 `AiOriginLabel`(AI 병기 · 2026-08-19 정책) — "자동분석" 같은 말로 AI 임을 가리지 않는다
 *
 * 🔴 출처는 **3상태**다(서버 정본 `medical-ai/ai-grounding.ts`):
 *   `AI`(호출·응답) / `FALLBACK`(호출했으나 실패 → 규칙 기반 대체) / `UNAVAILABLE`(원자료가 없어 **부르지 않음**).
 *   2026-08-19 실측: 서버는 17곳에서 3상태를 배출하는데 이 부품은 `UNAVAILABLE` 을 몰라 원시 JSON 을 덤프했고,
 *   `FALLBACK` 을 "데이터 부족"이라 불러 두 사실을 하나로 뭉갰다. 화면이 둘을 같게 그리면 결함이 화면으로 옮겨올 뿐이다.
 *   `error` 도 조용히 `null` 을 그리지 않는다 — 실패는 실패라고 말한다(§7.9).
 */

export type AiSource = 'AI' | 'FALLBACK' | 'UNAVAILABLE';

interface AiSuggestionPanelProps {
  title: string;
  data: unknown;
  /** 서버 응답의 `source`. 생략 시 `data.source` 를 본다. */
  source?: AiSource | string;
  isLoading?: boolean;
  error?: string;
  onAccept?: () => void;
  onReject?: () => void;
  compact?: boolean;
}

export function AiSuggestionPanel({ title, data, source, isLoading, error, onAccept, onReject, compact }: AiSuggestionPanelProps) {
  const tAttr = useTAttr();
  const [expanded, setExpanded] = useState(!compact);
  const [feedback, setFeedback] = useState<'accepted' | 'rejected' | null>(null);

  if (isLoading) {
    return (
      <div className="flex gap-0 rounded-xl overflow-hidden border border-amber-200">
        <div className="w-1 bg-amber-400 shrink-0 animate-pulse" />
        <div className="flex-1 bg-amber-50/50 p-3">
          <div className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-amber-500 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            <span className="text-xs text-amber-600"><T k="분석 중..." /></span>
          </div>
        </div>
      </div>
    );
  }

  const dataObj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const resolvedSource = (source ?? dataObj?.source) as string | undefined;
  const isUnavailable = resolvedSource === 'UNAVAILABLE';

  // 🔴 실패는 실패라고 말한다 — `null` 을 그리면 "제안 없음"과 구분되지 않는다
  if (error) {
    return (
      <div className="flex gap-0 rounded-xl overflow-hidden border border-rose-200" role="status">
        <div className="w-1 bg-rose-300 shrink-0" />
        <div className="flex-1 bg-rose-50/40 px-3 py-2 text-xs text-rose-700">
          <span className="font-semibold">{title}</span> — <Tf k="{출처} 호출 실패: {사유}" params={{ 출처: AI_ORIGIN_TEXT, 사유: String(error ?? '') }} />
        </div>
      </div>
    );
  }
  if (!data) return null;

  // 🔴 부르지 않았다 — 원자료 부재. 규칙 기반 대체도, AI 소견도 아니다.
  if (isUnavailable) {
    const reason = typeof dataObj?.reason === 'string' ? dataObj.reason : tAttr('원자료가 없어 산출하지 않았습니다');
    return (
      <div className="flex gap-0 rounded-xl overflow-hidden border border-gray-200" data-ai-source="UNAVAILABLE">
        <div className="w-1 bg-gray-300 shrink-0" />
        <div className="flex-1 bg-gray-50/60 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-700">{title}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 font-bold"><T k="산출 불가" /></span>
          </div>
          <p className="mt-1 text-xs text-gray-600">{reason}</p>
          <p className="mt-1 text-[11px] text-gray-500"><Tf k="{출처}를 호출하지 않았습니다 — 원자료가 생기면 다시 산출됩니다." params={{ 출처: AI_ORIGIN_TEXT }} /></p>
        </div>
      </div>
    );
  }

  const isAi = resolvedSource === 'AI';
  const isFallback = resolvedSource === 'FALLBACK';
  const serverDisclaimer = typeof dataObj?.disclaimer === 'string' ? dataObj.disclaimer : null;

  // AI 응답에서 텍스트 추출
  const parsed = (() => {
    if (typeof data === 'string') return data;
    let d = data as Record<string, unknown>;
    // 중첩 래퍼 unwrap — {trend:{answer}}·{data:{...}}·{result:{...}} 형태에서 본문까지 하강
    for (let i = 0; i < 3 && d; i++) {
      const next = d.trend ?? d.data ?? d.result;
      if (next && typeof next === 'object' && !Array.isArray(next)) d = next as Record<string, unknown>;
      else break;
    }
    const v = d.answer ?? d.text ?? d.summary ?? d.interpretation ?? d.analysis ?? d.prediction ?? d.suggestions ?? d.recommendation ?? d.report ?? d.review ?? d.guidance ?? d.opNote ?? d.reply ?? d.classification ?? d.score;
    return v !== undefined ? v : JSON.stringify(d, null, 2);
  })();
  // 이스케이프된 개행(\n) 복원 — whitespace-pre-wrap 렌더 정합
  const displayText = (typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)).replace(/\\n/g, '\n');

  return (
    <div className="flex gap-0 rounded-xl overflow-hidden border border-amber-200 shadow-sm">
      {/* 좌측 amber 세로선 — AI 영역 식별자 */}
      <div className={`w-1 shrink-0 ${isAi ? 'bg-gradient-to-b from-amber-400 to-orange-400' : 'bg-gray-300'}`} />

      <div className="flex-1 bg-gradient-to-r from-amber-50/80 to-orange-50/30">
        {/* 헤더 */}
        <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-amber-100/30 transition">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-md bg-amber-100 flex items-center justify-center">
              <svg className="w-3 h-3 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </span>
            <span className="text-xs font-semibold text-amber-900">{title}</span>
            {isAi && <AiOriginLabel note={serverDisclaimer} />}
            {isFallback && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-300 text-gray-700 font-bold" title={`${AI_ORIGIN_TEXT} ${tAttr('응답을 받지 못해 규칙 기반 결과로 대체했습니다')}`}>
                <Tf k="{출처} 미응답 · 규칙 대체" params={{ 출처: AI_ORIGIN_TEXT }} />
              </span>
            )}
          </div>
          <svg className={`w-3.5 h-3.5 text-amber-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* 본문 */}
        {expanded && (
          <div className="px-3 pb-3 space-y-2">
            <div className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto bg-white/70 rounded-lg p-2.5 border border-amber-100">
              {displayText}
            </div>

            {/* 액션 버튼 */}
            {isAi && !feedback && (onAccept || onReject) && (
              <div className="flex gap-1.5">
                {onAccept && (
                  <button onClick={() => { setFeedback('accepted'); onAccept(); }}
                    className="flex-1 py-1.5 text-[10px] font-bold bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition">
                    <T k="적용" />
                  </button>
                )}
                {onReject && (
                  <button onClick={() => { setFeedback('rejected'); onReject(); }}
                    className="flex-1 py-1.5 text-[10px] font-bold bg-white text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
                    <T k="무시" />
                  </button>
                )}
              </div>
            )}
            {feedback === 'accepted' && <p className="text-[10px] text-amber-700 font-bold"><T k="적용 완료" /></p>}
            {feedback === 'rejected' && <p className="text-[10px] text-gray-400"><T k="무시됨" /></p>}

            {isAi ? (
              <AiDisclaimer text={serverDisclaimer} />
            ) : (
              <p className="text-[11px] text-gray-500"><Tf k="규칙 기반 대체 결과입니다({출처} 소견 아님) — 최종 판단은 의료진이 합니다." params={{ 출처: AI_ORIGIN_TEXT }} /></p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 인라인 AI 제안 배지 — FALLBACK/UNAVAILABLE 은 AI 제안이 아니므로 그리지 않는다 */
export function AiInlineBadge({ label, value, source }: { label: string; value: string; source?: string }) {
  if (!value || source === 'FALLBACK' || source === 'UNAVAILABLE') return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200" title={`${AI_ORIGIN_TEXT} 제안`}>
      <svg className="w-2.5 h-2.5 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
      {label}: {value}
    </span>
  );
}

/** AI 영역 섹션 래퍼 — 기존 UI 안에 AI 블록을 감쌀 때 */
export function AiSection({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="relative pl-3 border-l-2 border-amber-300">
      {label && (
        <div className="absolute -left-[1px] top-0 flex items-center gap-1 -translate-x-full pr-2">
          <span className="text-[7px] text-amber-500 font-bold uppercase tracking-wider whitespace-nowrap">{label}</span>
        </div>
      )}
      {children}
    </div>
  );
}
