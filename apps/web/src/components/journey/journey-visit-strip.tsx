'use client';

import { useQuery } from '@tanstack/react-query';
import {
  JOURNEY_EPISODE_END_REASON_TEXT, JOURNEY_EPISODE_LABEL, JOURNEY_EPISODE_MILESTONE_LABEL, JOURNEY_EPISODE_STATE_LABEL,
  type JourneyEpisodeState, type JourneyEpisodeSummary, type JourneyObjectType,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { kdate } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

type EpisodesResp = { data: JourneyEpisodeSummary[]; meta?: { truncatedTypes?: string[]; perTypeLimit?: number } };

const STATE_TONE: Record<JourneyEpisodeState, string> = {
  PLANNED: 'bg-indigo-50 text-indigo-700',
  OPEN: 'bg-emerald-50 text-emerald-700',
  ENDED: 'bg-gray-100 text-gray-600',
  CANCELLED: 'bg-gray-100 text-gray-400 line-through',
  END_UNDEFINED: 'bg-amber-50 text-amber-700',
  UNKNOWN: 'bg-amber-50 text-amber-700',
};

/** 방문 하나의 기간 문장 — 끝을 모르면 이유를, 처분은 끝이 아니라 결정 시각으로 */
export function VisitSpan({ ep }: { ep: JourneyEpisodeSummary }) {
  const at = (s: string) => kdate(new Date(s), 'datetimeShort');
  return (
    <span className="text-[11px] text-gray-500">
      {ep.startAt ? at(ep.startAt) : ep.milestone ? <><T k={JOURNEY_EPISODE_MILESTONE_LABEL[ep.milestone.kind]} /> {ep.milestone.kind === 'RESERVED_DATE' ? kdate(new Date(`${ep.milestone.at}T00:00:00`), 'date') : at(ep.milestone.at)}</> : <T k="시작 기록 없음" />}
      {ep.endAt && <> → {at(ep.endAt)}</>}
      {ep.startAt && ep.milestone && <> · <T k={JOURNEY_EPISODE_MILESTONE_LABEL[ep.milestone.kind]} /> {at(ep.milestone.at)}</>}
    </span>
  );
}

/**
 * 방문 묶음(2026-10-01 · 여정 P3 표시 잔여) — 환자의 방문 단위를 도메인 원장에서 요약해 타임라인 위에 띄운다.
 * 누르면 그 방문 기록만 **서버에서** 불러온다(종전 "이 방문만"은 화면이 불러온 범위 안에서만 걸렀다).
 * 🔴 끝 시각은 정본이 있는 방문만 — 외래 끝(D8)·응급 퇴실(D9)은 이유를 말한다.
 */
export function JourneyVisitStrip({ patientId, selected, onSelect }: {
  patientId: string;
  selected: { type: string; id: string } | null;
  onSelect: (ep: JourneyEpisodeSummary | null) => void;
}) {
  const tAttr = useTAttr();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['journey-episodes', patientId],
    queryFn: () => apiClient.get<EpisodesResp>(`/api/v1/journey/${patientId}/episodes`),
  });
  const eps = data?.data ?? [];
  const truncated = data?.meta?.truncatedTypes ?? [];

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" aria-label={tAttr('방문 묶음')} data-journey-visits>
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900"><T k="방문 묶음" /></h3>
        <p className="text-[11px] text-gray-500"><T k="방문 원장 기준 · 누르면 그 방문 기록만 봅니다" /></p>
      </header>
      {isLoading ? (
        <div className="flex gap-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-16 w-48 shrink-0 animate-pulse rounded-xl bg-gray-100" />)}</div>
      ) : isError ? (
        <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
      ) : eps.length === 0 ? (
        <p className="text-xs text-gray-500"><T k="기록된 방문이 없습니다" /></p>
      ) : (
        <ol className="flex gap-2 overflow-x-auto pb-1">
          {eps.map((ep) => {
            const on = selected?.type === ep.type && selected?.id === ep.id;
            const label = JOURNEY_EPISODE_LABEL[ep.type as JourneyObjectType] ?? '방문';
            return (
              <li key={`${ep.type}:${ep.id}`} className="shrink-0">
                <button type="button" aria-pressed={on} onClick={() => onSelect(on ? null : ep)} data-journey-visit={ep.type}
                  className={`flex min-h-[44px] w-56 flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition ${on ? 'border-indigo-400 bg-indigo-50/60 ring-1 ring-indigo-300' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <span className="flex w-full items-center gap-1.5">
                    <span className="text-xs font-semibold text-gray-800"><T k={label} /></span>
                    <span className={`ml-auto rounded px-1.5 text-[10px] ${STATE_TONE[ep.state]}`}><T k={JOURNEY_EPISODE_STATE_LABEL[ep.state]} /></span>
                  </span>
                  {ep.title && <span className="w-full truncate text-xs text-gray-700" title={ep.title}>{ep.title}</span>}
                  <VisitSpan ep={ep} />
                  {ep.endUnavailableReason && (
                    <span className="text-[10px] text-amber-700" title={tAttr(JOURNEY_EPISODE_END_REASON_TEXT[ep.endUnavailableReason])}>
                      <T k={ep.endUnavailableReason === 'DEPARTURE_NOT_RECORDED' ? '퇴실 시각 기록 없음' : '수납 전'} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {truncated.length > 0 && (
        <p className="mt-1 text-[10px] text-amber-700">
          <Tf k="방문 종류마다 최근 {수}건만 보입니다" params={{ 수: data?.meta?.perTypeLimit ?? 0 }} />
        </p>
      )}
    </section>
  );
}
