'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { UnitText } from '@/components/ui/display';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';

export interface SummaryResult {
  mode: 'all' | 'chart' | 'rx';
  engine: 'RULE' | 'RULE+AI';
  aiText: string | null;
  lines: string[];
  counts: Record<string, number>;
  period: { from: string | null; to: string | null };
  itemCount: number;
  disclaimer: string;
  issues: Issue[];
}

export interface Issue {
  level: 'CRITICAL' | 'WARN' | 'INFO';
  at: string;
  category: '검사' | '활력' | '추세' | '미확인';
  label: string;
  value?: string;
  why: string;
  source?: { type: string; id: string };
}

const LEVEL_UI: Record<string, { rail: string; dot: string; label: string; text: string; value: string }> = {
  CRITICAL: { rail: 'bg-rose-500', dot: 'bg-rose-500', label: '위급', text: 'text-rose-600', value: 'text-rose-700' },
  WARN: { rail: 'bg-amber-400', dot: 'bg-amber-400', label: '주의', text: 'text-amber-600', value: 'text-amber-700' },
  INFO: { rail: 'bg-gray-300', dot: 'bg-gray-300', label: '참고', text: 'text-gray-500', value: 'text-gray-700' },
};

const MODE_LABEL: Record<string, string> = { all: '전체 경과', chart: '진료 경과', rx: '약물 이력' };

/**
 * 시계열 하단 정리 패널 — **남는 공간을 채우는 요약 영역**.
 *
 * 규칙 집계는 진입 즉시 자동 표시(서버 rule-only·빠름)해서 빈 공간이 생기지 않게 하고,
 * 'AI 문장 추가'를 누르면 그 위에 WeRU.B 서술 요약이 붙는다(느린 호출은 사용자 의사로만).
 * 요약은 참고용이며 원본 확인을 대체하지 않는다는 면책을 항상 노출.
 */
export function AiSummaryPanel({
  patientId, mode, months, types, fill = false,
}: {
  patientId: string;
  mode: 'all' | 'chart' | 'rx';
  months: number | null;
  types?: string[];
  /** true = 남은 높이를 채우고 내부 스크롤(참조 패널 내장 모드) */
  fill?: boolean;
}) {
  const [loading, setLoading] = useState(false);   // AI 포함 재생성
  const [booting, setBooting] = useState(true);    // 최초 규칙 집계
  const [res, setRes] = useState<SummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = useCallback(async (useAi: boolean) => {
    setError(null); setCopied(false);
    if (useAi) setLoading(true);
    try {
      const body: Record<string, unknown> = { mode, ai: useAi };
      if (months) body.from = new Date(Date.now() - months * 30 * 86400000).toISOString();
      if (mode === 'all' && types?.length) body.types = types.join(',');
      const r = await apiClient.post<{ data: SummaryResult }>(`/api/v1/patients/${patientId}/record-timeline/summary`, body);
      setRes(r.data);
    } catch {
      setError('요약을 생성하지 못했습니다. 잠시 후 다시 시도하세요.');
    } finally {
      setLoading(false);
      setBooting(false);
    }
  }, [patientId, mode, months, types]);

  // 진입·필터 변경 시 규칙 집계 자동 표시(AI 호출 없음 — 빠르고 항상 성공)
  useEffect(() => { setBooting(true); void run(false); }, [run]);

  const copy = async () => {
    if (!res) return;
    const text = [res.aiText, '', ...res.lines].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* 클립보드 차단 환경 */ }
  };

  return (
    <section className={`pt-2 border-t border-gray-100 ${fill ? 'h-full min-h-0 flex flex-col' : ''}`}>
      <div className="flex flex-shrink-0 items-center justify-between gap-2">
        <span className="flex items-baseline gap-1.5 text-[11px]">
          <b className="text-xs font-semibold text-gray-800">{MODE_LABEL[mode]} 정리</b>
          <span className="text-gray-400">현재 필터 기준</span>
        </span>
        <div className="flex items-center gap-1">
          {res && (
            <button type="button" onClick={copy}
              className="rounded-md px-2 py-1 text-[11px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700">
              {copied ? '복사됨' : '복사'}
            </button>
          )}
          <button type="button" onClick={() => run(true)} disabled={loading || booting}
            className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-40">
            {loading ? 'AI 정리 중…' : res?.engine === 'RULE+AI' ? 'AI 다시 정리' : 'AI 문장 추가'}
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-[11px] text-rose-600">{error}</p>}

      <div className={`mt-2 rounded-xl border border-gray-200/80 bg-gray-50/60 p-3 ${fill ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : ''}`}>
        {booting ? (
          <p className="text-[11px] text-gray-400">기록 집계 중…</p>
        ) : !res ? (
          <p className="text-[11px] text-gray-400">요약할 기록이 없습니다.</p>
        ) : (
          <>
            <div className="mb-2 flex flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
              <span className="text-gray-500">{res.engine === 'RULE+AI' ? `${AI_ORIGIN_TEXT} + 규칙` : '규칙 집계'}</span>
              <span className="text-gray-300">·</span>
              <span className="tabular-nums text-gray-400">
                {res.period.from ? `${res.period.from} ~ ${res.period.to}` : '기간 없음'} · {res.itemCount}건
              </span>
              {/* 위급·주의는 개수만 조용히(줄마다 배지를 반복하지 않고 여기서 총량을 알린다) */}
              {(['CRITICAL', 'WARN'] as const).map((lv) => {
                const n = res.issues?.filter((i) => i.level === lv).length ?? 0;
                if (!n) return null;
                const ui = LEVEL_UI[lv];
                return (
                  <span key={lv} className={`inline-flex items-center gap-1 font-semibold ${ui.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${ui.dot}`} />{ui.label} {n}
                  </span>
                );
              })}
            </div>

            <div className={fill ? 'flex-1 min-h-0 overflow-y-auto pr-1' : ''}>
              {/* 중요 수치·이슈 — 값 강조 + **왜 이슈인지** 설명. 위급이 맨 위 */}
              {res.issues?.length > 0 && (
                <div className="mb-2 space-y-1">
                  {res.issues.map((is, i) => {
                    const ui = LEVEL_UI[is.level] ?? LEVEL_UI.INFO;
                    return (
                      <div key={i} className="relative rounded-lg bg-white pl-3 pr-2 py-1.5 ring-1 ring-gray-200/70">
                        <span className={`absolute inset-y-1 left-0 w-[3px] rounded-full ${ui.rail}`} aria-hidden />
                        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                          <span className={`text-[10px] font-semibold ${ui.text}`}>{ui.label}</span>
                          <span className="text-[10px] text-gray-400">{is.category}</span>
                          <span className="text-[11px] font-semibold text-gray-900">{is.label}</span>
                          {is.value && <span className={`text-[11px] font-bold tabular-nums ${ui.value}`}><UnitText text={is.value} /></span>}
                          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-gray-400">{is.at.slice(0, 10)}</span>
                        </div>
                        <p className="mt-0.5 text-[10.5px] leading-relaxed text-gray-600">{is.why}</p>
                      </div>
                    );
                  })}
                </div>
              )}
              {res.aiText && <p className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed mb-2">{res.aiText}</p>}
              <ul className="space-y-1">
                {res.lines.map((l, i) => (
                  <li key={i} className="text-[11px] text-gray-700 flex gap-1.5 leading-relaxed">
                    <span className="shrink-0 text-gray-300">·</span><span className="flex-1 break-words">{l}</span>
                  </li>
                ))}
              </ul>
              {!res.aiText && res.itemCount > 0 && (
                <p className="mt-2 text-[10px] text-gray-400">
                  위는 기록에서 뽑은 집계입니다. <b className="text-gray-500">AI 문장 추가</b>를 누르면 서술 요약이 앞에 붙습니다.
                </p>
              )}
            </div>

            <p className="mt-2 text-[10px] text-gray-400 flex-shrink-0">{res.disclaimer}</p>
          </>
        )}
      </div>
    </section>
  );
}
