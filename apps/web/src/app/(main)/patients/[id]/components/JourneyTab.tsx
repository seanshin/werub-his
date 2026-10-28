'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { kdate } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import type { JourneyEvent } from './types';
import {
  JOURNEY_EPISODE_END_REASON_TEXT, JOURNEY_EPISODE_LABEL, JOURNEY_EPISODE_STATE_LABEL, JOURNEY_ORIGIN_BADGE, JOURNEY_TRACKS, JOURNEY_TRANSITION_BADGE,
  journeyEventTypesOfTrack, journeyTransitionOf,
  type JourneyEpisodeSummary, type JourneyObjectType, type JourneyTrack,
} from '@hospital-run/shared';
import { TRACK_DOT, TRACK_ORDER, TRACK_TONE, displayOf, placedAt, titleCoversLabel } from '@/components/journey/journey-ui';

import { EmptyState } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { JourneyReportPanel } from './JourneyReportPanel';
import { ClinicalLensView } from '@/components/journey/clinical-lens-view';
import { JourneyVisitStrip, VisitSpan } from '@/components/journey/journey-visit-strip';

/**
 * 환자 여정 타임라인(직원) — 2026-10-01 여정 P3 UX 재구성.
 *  · 최신순 · 날짜 묶음 · 정렬 기준은 **발생 시각(모르면 표시 시각)** 이라고 밝힌다(종전: 오래된 순·평면 나열·줄 순서와 찍힌 시각이 어긋났다)
 *  · 유형 라벨·아이콘은 shared 표시 정본(`journey-display`) — 종전 로컬 아이콘 표는 26/63 유형뿐이었다
 *  · 트랙 필터는 서버 `types` 로(잘림 판정이 필터 기준으로 맞게)
 *  · 방문 묶음(2026-10-01) — 방문을 고르면 그 방문 기록만 **서버에서**(`episodeType`·`episodeId`) 불러온다. 종전 "이 방문만"은
 *    화면이 불러온 범위 안에서만 걸러, 잘린 앞부분의 그 방문 기록이 보이지 않았다
 *  · 정정·취소·철회는 표식으로(같은 무게의 새 행으로 보이지 않게) · 데모/시드 행 표식 · 예정 시각 병기
 */

const SEVERITY_EDGE: Record<string, string> = {
  CRITICAL: 'border-l-red-500 bg-red-50/60',
  WARNING: 'border-l-amber-400 bg-amber-50/50',
};
const BADGE_TONE = { amber: 'bg-amber-100 text-amber-800', gray: 'bg-gray-100 text-gray-600', red: 'bg-rose-100 text-rose-700' } as const;

type TimelineResp = { data: JourneyEvent[]; meta?: { truncated?: boolean; olderCursor?: string | null } };

/**
 * 여정 탭 — 두 관점(2026-10-01 사람 요청).
 *  · 환자 경로: 접수·진료·입원·수술·퇴원 등 환자가 지나간 길(여정 원장)
 *  · 진료 관점: 의료진이 확인하는 처방·오더·위급값의 단계와 질관리 점검(도메인 원장)
 */
export function JourneyTab({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const [lens, setLens] = useState<'PATIENT' | 'CLINICAL'>('PATIENT');
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl bg-gray-100 p-1" role="tablist" aria-label={tAttr('여정 관점')}>
        {([['PATIENT', '환자 경로'], ['CLINICAL', '진료 관점(처방·오더·질관리)']] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={lens === k} onClick={() => setLens(k)}
            className={`min-h-[36px] rounded-lg px-4 text-sm ${lens === k ? 'bg-white font-semibold text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <T k={label} />
          </button>
        ))}
      </div>
      {lens === 'PATIENT' ? <PatientPathView patientId={patientId} /> : <ClinicalLensView patientId={patientId} />}
    </div>
  );
}

function PatientPathView({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const [track, setTrack] = useState<JourneyTrack | 'ALL'>('ALL');
  const [episode, setEpisode] = useState<{ type: string; id: string } | null>(null);
  /** 방문 묶음에서 고른 방문의 요약(행의 방문 칩으로 고르면 요약이 없을 수 있다 — 묶음 목록에서 찾는다) */
  const [episodeSummary, setEpisodeSummary] = useState<JourneyEpisodeSummary | null>(null);
  const typesParam = track === 'ALL' ? undefined : journeyEventTypesOfTrack(track).join(',');
  const params = {
    ...(typesParam ? { types: typesParam } : {}),
    ...(episode ? { episodeType: episode.type, episodeId: episode.id } : {}),
  };
  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['journey', patientId, track, episode?.type ?? null, episode?.id ?? null],
    queryFn: () => apiClient.get<TimelineResp>(`/api/v1/journey/${patientId}/timeline`, Object.keys(params).length ? params : undefined),
  });
  const qc = useQueryClient();
  const selectEpisode = (ep: { type: string; id: string } | null, summary?: JourneyEpisodeSummary | null) => {
    setEpisode(ep);
    // 행의 방문 칩으로 고르면 요약이 없다 — 방문 묶음이 이미 받아 둔 목록에서 찾는다(없으면 요약 없이 이름만)
    const cached = qc.getQueryData<{ data?: JourneyEpisodeSummary[] }>(['journey-episodes', patientId])?.data;
    setEpisodeSummary(summary ?? (ep ? cached?.find((x) => x.type === ep.type && x.id === ep.id) ?? null : null));
  };

  const latest: JourneyEvent[] = Array.isArray(data?.data) ? data!.data : [];
  /**
   * 이전 기록은 커서로 이어 받는다. 🔴 첫 페이지가 다시 조회되면(최신 창이 앞으로 밀리면) 이어 붙인 이전 기록과
   * 새 첫 페이지 사이가 조용히 빌 수 있다 — 첫 페이지가 바뀔 때 이어 받은 것을 비운다.
   */
  const [older, setOlder] = useState<{ events: JourneyEvent[]; cursor: string | null; loading: boolean; failed: boolean }>({ events: [], cursor: null, loading: false, failed: false });
  useEffect(() => { setOlder({ events: [], cursor: null, loading: false, failed: false }); }, [dataUpdatedAt, track, episode?.type, episode?.id]);
  const firstCursor = data?.meta?.olderCursor ?? null;
  const cursor = older.events.length ? older.cursor : firstCursor;
  const hasOlder = older.events.length ? !!older.cursor : !!data?.meta?.truncated;
  const loadOlder = async () => {
    if (!cursor) return;
    setOlder((o) => ({ ...o, loading: true, failed: false }));
    try {
      const r = await apiClient.get<TimelineResp>(`/api/v1/journey/${patientId}/timeline`, { before: cursor, ...params });
      setOlder((o) => ({ events: [...(r.data ?? []), ...o.events], cursor: r.meta?.olderCursor ?? null, loading: false, failed: false }));
    } catch {
      setOlder((o) => ({ ...o, loading: false, failed: true }));
    }
  };

  const loaded = useMemo(() => {
    const seen = new Set<string>();
    return [...older.events, ...latest].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  }, [older.events, latest]);
  const shown = useMemo(
    // 방문 거르기는 서버가 한다(관계표 + P1 전 행의 원 기록 귀속) — 여기서 다시 거르면 관계 없는 옛 행이 빠진다
    () => loaded.slice().sort((a, b) => placedAt(b) - placedAt(a) || (a.id < b.id ? 1 : -1)),
    [loaded],
  );
  /** 날짜 묶음 — 화면 시간대 기준 날짜 문자열(표시와 같은 정본) */
  const groups = useMemo(() => {
    const out: { day: string; items: JourneyEvent[] }[] = [];
    for (const ev of shown) {
      const day = kdate(new Date(placedAt(ev)), 'dateWeekday');
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(ev);
      else out.push({ day, items: [ev] });
    }
    return out;
  }, [shown]);
  const byId = useMemo(() => new Map(loaded.map((e) => [e.id, e])), [loaded]);

  return (
    <div className="space-y-4">
      <JourneyVisitStrip patientId={patientId} selected={episode} onSelect={(ep) => selectEpisode(ep ? { type: ep.type, id: ep.id } : null, ep)} />
      <JourneyReportPanel patientId={patientId} />
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm" aria-label={tAttr('환자 여정 타임라인')}>
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900"><T k="환자 여정 타임라인" /></h3>
          <p className="text-[11px] text-gray-500">
            <T k="최신순 · 발생 시각 기준(모르면 표시 시각)" />
            {!isLoading && !isError && <> · <Tf k="표시 {수}건" params={{ 수: shown.length }} /></>}
          </p>
          {shown.some((e) => !e.occurredAt) && (
            <p className="w-full text-[10px] text-gray-400" data-journey-unknown-legend>
              <span className="font-mono">◌</span> <T k="표시 시각 — 발생 시각을 모르는 기록(출처 확인 불가)" />
            </p>
          )}
        </header>

        {/* 트랙 필터 — 서버 types 로 거른다(잘림 판정이 필터 기준) */}
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label={tAttr('기록 종류로 거르기')}>
          {(['ALL', ...TRACK_ORDER] as const).map((t) => (
            <button key={t} type="button" onClick={() => { setTrack(t); selectEpisode(null); }} aria-pressed={track === t}
              className={`rounded-full border px-3 py-1 text-xs transition ${track === t ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {t === 'ALL' ? <T k="전체" /> : <span className="inline-flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${TRACK_DOT[t]}`} aria-hidden /><T k={JOURNEY_TRACKS[t]} /></span>}
            </button>
          ))}
        </div>

        {episode && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800" data-journey-episode-filter>
            <span><Tf k="{방문} 기록만 보는 중" params={{ 방문: tAttr(JOURNEY_EPISODE_LABEL[episode.type as JourneyObjectType] ?? '방문') }} /></span>
            {episodeSummary && (
              <span className="flex flex-wrap items-center gap-1.5" data-journey-episode-summary>
                {episodeSummary.title && <span className="font-medium">{episodeSummary.title}</span>}
                <VisitSpan ep={episodeSummary} />
                <span className="rounded bg-white px-1.5 text-[10px]"><T k={JOURNEY_EPISODE_STATE_LABEL[episodeSummary.state]} /></span>
                {episodeSummary.endUnavailableReason && <span className="text-[10px] text-amber-700"><T k={JOURNEY_EPISODE_END_REASON_TEXT[episodeSummary.endUnavailableReason]} /></span>}
              </span>
            )}
            <button type="button" onClick={() => selectEpisode(null)} className="rounded border border-indigo-200 bg-white px-2 py-0.5 hover:bg-indigo-100"><T k="전체 보기" /></button>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100" />)}
          </div>
        ) : isError ? (
          // 🔴 조회 실패를 "이벤트가 없습니다"로 그리지 않는다
          <QueryErrorFallback error={error} onRetry={() => refetch()} />
        ) : shown.length === 0 ? (
          <EmptyState icon="📝" title={track === 'ALL' && !episode ? '기록된 이벤트가 없습니다.' : '이 조건에 맞는 기록이 없습니다.'}
            hint={hasOlder ? <T k="더 오래된 기록이 있을 수 있습니다 — 아래에서 이전 기록을 불러오세요." /> : undefined} />
        ) : (
          <ol className="space-y-4">
            {groups.map((g) => (
              <li key={g.day}>
                <h4 className="sticky top-0 z-[1] mb-1.5 bg-white/95 py-1 text-[11px] font-semibold text-gray-500 backdrop-blur">{g.day}</h4>
                <ol className="relative space-y-1 border-l border-gray-200 pl-4">
                  {g.items.map((ev) => (
                    <EventRow key={ev.id} ev={ev} superseded={ev.supersedesId ? byId.get(ev.supersedesId) ?? null : null}
                      onEpisode={(type, id) => selectEpisode({ type, id })} />
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        )}

        {!isLoading && !isError && hasOlder && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 text-xs" data-journey-older>
            <span className="text-amber-700"><Tf k="이전 기록이 더 있습니다 — 지금 {수}건 표시" params={{ 수: loaded.length }} /></span>
            <button type="button" onClick={loadOlder} disabled={older.loading}
              className="min-h-[36px] rounded-lg border border-gray-200 px-3 hover:bg-gray-50 disabled:opacity-50">
              {older.loading ? <T k="불러오는 중…" /> : <T k="이전 기록 더 보기" />}
            </button>
            {older.failed && <span role="alert" className="text-rose-600"><T k="이전 기록을 불러오지 못했습니다" /></span>}
          </div>
        )}
      </section>
    </div>
  );
}

function EventRow({ ev, superseded, onEpisode }: {
  ev: JourneyEvent;
  superseded: JourneyEvent | null;
  onEpisode: (type: string, id: string) => void;
}) {
  const tAttr = useTAttr();
  const disp = displayOf(ev.eventType);
  const transition = journeyTransitionOf(ev);
  const badge = transition ? JOURNEY_TRANSITION_BADGE[transition] : undefined;
  const origin = ev.dataOrigin ? JOURNEY_ORIGIN_BADGE[ev.dataOrigin] : undefined;
  const ep = ev.objects?.[0];
  const epLabel = ep ? JOURNEY_EPISODE_LABEL[ep.objectType as JourneyObjectType] : undefined;
  const edge = ev.severity ? SEVERITY_EDGE[ev.severity] ?? '' : '';
  return (
    <li className={`relative rounded-r-lg border-l-2 border-transparent py-2 pl-3 pr-2 ${edge}`} data-journey-event={ev.eventType}>
      <span className={`absolute -left-[25px] top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs ring-2 ${disp ? TRACK_DOT[disp.track].replace('bg-', 'ring-') : 'ring-gray-200'}`} aria-hidden>
        {disp?.icon ?? '○'}
      </span>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {(!disp || !titleCoversLabel(ev.title, disp.label)) && (
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${disp ? TRACK_TONE[disp.track] : 'bg-gray-100 text-gray-500'}`}>
                {disp ? <T k={disp.label} /> : <T k="기록 종류 미등록" />}
              </span>
            )}
            {badge && <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${BADGE_TONE[badge.tone]}`}><T k={badge.label} /></span>}
            {origin && (
              <span className="rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-500" title={tAttr('실제 업무 기록이 아닙니다(데모·시드·이관 데이터)')}>
                <T k={origin} />
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-gray-900">
            {ev.navUrl ? <Link href={ev.navUrl} className="font-medium text-blue-700 hover:underline">{ev.title}</Link> : <span className="font-medium">{ev.title}</span>}
          </p>
          {ev.description && <p className="mt-0.5 text-xs text-gray-600">{ev.description}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
            {ev.department && <span>{ev.department}{ev.doctorName ? ` · ${ev.doctorName}` : ''}</span>}
            {ev.plannedAt && <span className="text-indigo-700"><T k="예정" /> {kdate(new Date(ev.plannedAt), 'datetimeShort')}</span>}
            {ep && epLabel && (
              <button type="button" onClick={() => onEpisode(ep.objectType, ep.objectId)}
                className="rounded-full border border-gray-200 px-2 py-0.5 text-gray-600 hover:border-indigo-300 hover:text-indigo-700"
                title={tAttr('이 방문의 기록만 보기')}>
                <T k={epLabel} /> ›
              </button>
            )}
            {transition === 'REVISED' && (
              <span className="text-amber-800">
                {superseded
                  ? <Tf k="앞 기록 정정 — {시각} 기록" params={{ 시각: kdate(new Date(placedAt(superseded)), 'datetimeShort') }} />
                  : ev.supersedesId ? <T k="앞 기록 정정 — 대상 기록은 불러온 범위 밖" /> : <T k="정정 — 대상 기록 미상" />}
              </span>
            )}
          </div>
        </div>
        <EventTime ev={ev} />
      </div>
    </li>
  );
}

/**
 * 시각 칸 — 발생 시각과 기록 시각을 가른다(여정 P1·P3).
 *  · 발생 시각이 있으면 그것을 크게, 5분 넘게 늦게 기록됐으면 기록 시각(`createdAt` — 정본)을 함께
 *  · 직원이 입력한 과거 시각이면 "입력된 시각" · 날짜만 아는 값은 날짜만
 *  · 🔴 발생 시각을 모르면(P1 이전 행) 종전 **표시 시각**에 "발생 미상" 표식 — 그 값은 기록 시각도 아니다(시드 롤포워드가 다시 쓴 행이 있다)
 */
const LATE_RECORD_MS = 5 * 60_000;
function EventTime({ ev }: { ev: JourneyEvent }) {
  const tAttr = useTAttr();
  const occurred = ev.occurredAt ? new Date(ev.occurredAt) : null;
  const recorded = ev.createdAt ? new Date(ev.createdAt) : null;
  if (!occurred || Number.isNaN(occurred.getTime())) {
    const shownAt = new Date(ev.eventAt);
    return (
      <span className="shrink-0 whitespace-nowrap text-right text-[11px] text-gray-500"
        title={tAttr('발생 시각을 모르는 기록입니다 — 표시 시각은 출처를 확인할 수 없습니다')}>
        <span className="block text-gray-500"><span className="font-mono" aria-label={tAttr('발생 미상')}>◌</span>{kdate(shownAt, 'time')}</span>
      </span>
    );
  }
  const late = recorded && recorded.getTime() - occurred.getTime() > LATE_RECORD_MS;
  return (
    <span className="shrink-0 whitespace-nowrap text-right text-[11px] text-gray-500">
      <span className="block text-gray-800">{ev.occurredAtPrecision === 'DAY' ? <T k="날짜만 기록" /> : kdate(occurred, 'time')}</span>
      {ev.occurredAtSource === 'USER_CLAIMED' && (
        <span className="block"><span className="rounded bg-amber-50 px-1 text-[10px] text-amber-700" title={tAttr('직원이 입력한 시각입니다(시스템이 관측한 시각이 아닙니다)')}><T k="입력된 시각" /></span></span>
      )}
      {late && recorded && <span className="block text-[10px] text-gray-400"><T k="기록" /> {kdate(recorded, 'datetimeShort')}</span>}
    </span>
  );
}
