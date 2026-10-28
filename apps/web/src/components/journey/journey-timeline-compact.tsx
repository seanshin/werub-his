'use client';

import { useMemo, useState } from 'react';
import {
  JOURNEY_EPISODE_LABEL, JOURNEY_ORIGIN_BADGE, JOURNEY_TRACKS, JOURNEY_TRANSITION_BADGE, journeyTransitionOf,
  type JourneyObjectType, type JourneyTrack,
} from '@hospital-run/shared';
import { kdate } from '@/lib/ui-settings';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { TRACK_DOT, TRACK_ORDER, TRACK_TONE, displayOf, placedAt, titleCoversLabel } from './journey-ui';

export interface CompactJourneyEvent {
  id: string;
  eventType: string;
  title?: string | null;
  description?: string | null;
  department?: string | null;
  doctorName?: string | null;
  severity?: string | null;
  eventAt: string;
  occurredAt?: string | null;
  occurredAtSource?: string | null;
  occurredAtPrecision?: string | null;
  plannedAt?: string | null;
  dataOrigin?: string | null;
  transition?: string | null;
  objects?: { objectType: string; objectId: string }[];
}

const BADGE_TONE = { amber: 'bg-amber-100 text-amber-800', gray: 'bg-gray-100 text-gray-600', red: 'bg-rose-100 text-rose-700' } as const;

/**
 * 여정 타임라인(조밀형) — 관제 상세처럼 좁은 패널이 **남는 높이를 다 쓰며** 풍부하게 보이게(2026-10-01 사람 요청).
 *  · 머리: 기간(첫~끝)·건수·트랙별 건수 칩(누르면 그 트랙만 — 불러온 범위 안)
 *  · 날짜 묶음(고정 머리) · 트랙 색 점과 세로 줄 · 제목이 라벨을 이미 말하면 라벨을 반복하지 않는다
 *  · 발생 시각 미상은 행마다 두 줄을 쓰지 않고 시각 앞 `◌` + 범례 한 줄로(정직성은 유지·소음은 줄임)
 *  · 정정·취소·데모 표식 · 방문 단위 · 예정 시각 · 위급/경고 강조
 */
export function JourneyTimelineCompact({ events }: { events: CompactJourneyEvent[] }) {
  const tAttr = useTAttr();
  const [track, setTrack] = useState<JourneyTrack | null>(null);
  const sorted = useMemo(() => events.slice().sort((a, b) => placedAt(b) - placedAt(a) || (a.id < b.id ? 1 : -1)), [events]);
  const counts = useMemo(() => {
    const m = new Map<JourneyTrack, number>();
    for (const e of sorted) { const t = displayOf(e.eventType)?.track ?? 'OTHER'; m.set(t, (m.get(t) ?? 0) + 1); }
    return m;
  }, [sorted]);
  const shown = track ? sorted.filter((e) => (displayOf(e.eventType)?.track ?? 'OTHER') === track) : sorted;
  const groups = useMemo(() => {
    const out: { day: string; items: CompactJourneyEvent[] }[] = [];
    for (const ev of shown) {
      const day = kdate(new Date(placedAt(ev)), 'dateWeekday');
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(ev); else out.push({ day, items: [ev] });
    }
    return out;
  }, [shown]);
  const anyUnknown = shown.some((e) => !e.occurredAt);
  const first = sorted[sorted.length - 1];
  const last = sorted[0];

  return (
    <div className="flex min-h-0 flex-col" data-journey-compact>
      <div className="shrink-0 space-y-2 pb-2">
        {first && last && (
          <p className="text-[11px] text-gray-500">
            {kdate(new Date(placedAt(first)), 'datetimeShort')} ~ {kdate(new Date(placedAt(last)), 'datetimeShort')}
            {' · '}<Tf k="{수}건" params={{ 수: sorted.length }} />
          </p>
        )}
        <div className="flex flex-wrap gap-1" role="group" aria-label={tAttr('기록 종류로 거르기')}>
          <button type="button" onClick={() => setTrack(null)} aria-pressed={track === null}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${track === null ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            <T k="전체" /> {sorted.length}
          </button>
          {TRACK_ORDER.filter((t) => counts.get(t)).map((t) => (
            <button key={t} type="button" onClick={() => setTrack(track === t ? null : t)} aria-pressed={track === t}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] ${track === t ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${TRACK_DOT[t]}`} aria-hidden />
              <T k={JOURNEY_TRACKS[t]} /> {counts.get(t)}
            </button>
          ))}
        </div>
        {anyUnknown && (
          <p className="text-[10px] text-gray-400" data-journey-unknown-legend>
            <span className="font-mono">◌</span> <T k="표시 시각 — 발생 시각을 모르는 기록(출처 확인 불가)" />
          </p>
        )}
      </div>

      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {groups.map((g) => (
          <li key={g.day}>
            <h5 className="sticky top-0 z-[1] bg-white/95 py-1 text-[11px] font-semibold text-gray-500 backdrop-blur">{g.day}</h5>
            <ol className="relative ml-[54px] border-l border-gray-200">
              {g.items.map((ev) => <CompactRow key={ev.id} ev={ev} />)}
            </ol>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CompactRow({ ev }: { ev: CompactJourneyEvent }) {
  const tAttr = useTAttr();
  const disp = displayOf(ev.eventType);
  const trackKey: JourneyTrack = disp?.track ?? 'OTHER';
  const transition = journeyTransitionOf(ev);
  const badge = transition ? JOURNEY_TRANSITION_BADGE[transition] : undefined;
  const origin = ev.dataOrigin ? JOURNEY_ORIGIN_BADGE[ev.dataOrigin] : undefined;
  const ep = ev.objects?.[0];
  const epLabel = ep ? JOURNEY_EPISODE_LABEL[ep.objectType as JourneyObjectType] : undefined;
  const unknown = !ev.occurredAt;
  const at = new Date(placedAt(ev));
  const showLabel = disp && !titleCoversLabel(ev.title, disp.label);
  const sev = ev.severity === 'CRITICAL' ? 'bg-rose-50/70' : ev.severity === 'WARNING' ? 'bg-amber-50/60' : '';
  return (
    <li className={`relative -ml-px rounded-r-md py-1.5 pl-4 pr-1 ${sev}`} data-journey-event={ev.eventType}>
      {/* 시각 — 세로 줄 왼쪽 바깥 */}
      <span className={`absolute -left-[54px] top-1.5 w-[46px] text-right text-[11px] tabular-nums ${unknown ? 'text-gray-400' : 'text-gray-600'}`}
        title={unknown ? tAttr('발생 시각을 모르는 기록입니다 — 표시 시각은 출처를 확인할 수 없습니다') : undefined}>
        {unknown && <span className="font-mono">◌</span>}
        {ev.occurredAtPrecision === 'DAY' ? '—' : kdate(at, 'time')}
      </span>
      <span className={`absolute -left-[5px] top-[9px] h-2.5 w-2.5 rounded-full ring-2 ring-white ${TRACK_DOT[trackKey]}`} aria-hidden />
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="text-xs" aria-hidden>{disp?.icon ?? '○'}</span>
        <span className="text-[13px] font-medium text-gray-900">{ev.title || (disp ? <T k={disp.label} /> : <T k="기록 종류 미등록" />)}</span>
        {showLabel && <span className={`rounded px-1.5 text-[10px] ${TRACK_TONE[trackKey]}`}><T k={disp!.label} /></span>}
        {!disp && ev.title && <span className="rounded bg-gray-100 px-1.5 text-[10px] text-gray-500"><T k="기록 종류 미등록" /></span>}
        {badge && <span className={`rounded px-1.5 text-[10px] font-medium ${BADGE_TONE[badge.tone]}`}><T k={badge.label} /></span>}
        {ev.occurredAtSource === 'USER_CLAIMED' && <span className="rounded bg-amber-50 px-1.5 text-[10px] text-amber-700"><T k="입력된 시각" /></span>}
        {origin && <span className="rounded border border-dashed border-gray-300 px-1.5 text-[10px] text-gray-500"><T k={origin} /></span>}
      </div>
      {(ev.description || ev.department || epLabel || ev.plannedAt) && (
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-gray-500">
          {ev.department && <span>{ev.department}{ev.doctorName ? ` · ${ev.doctorName}` : ''}</span>}
          {epLabel && <span className="text-indigo-700"><T k={epLabel} /></span>}
          {ev.plannedAt && <span className="text-indigo-700"><T k="예정" /> {kdate(new Date(ev.plannedAt), 'datetimeShort')}</span>}
          {ev.description && <span className="w-full text-gray-600">{ev.description}</span>}
        </div>
      )}
    </li>
  );
}
