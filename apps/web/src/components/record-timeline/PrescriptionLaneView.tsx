'use client';

import { useMemo, useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { buildLanes, laneTicks, nowPos, type RxInput } from './prescription-lanes';
import type { TItem } from './record-card';

import { EmptyState } from '@/components/ui/display';

const RX_TYPE_LABEL: Record<string, string> = {
  MEDICATION: '약', LAB: '검사', IMAGING: '영상', THERAPY: '치료', DIET: '식이', ACTIVITY: '활동', NURSING: '간호지시',
};
const BAR_COLOR: Record<string, string> = {
  MEDICATION: 'bg-amber-400', THERAPY: 'bg-teal-400', DIET: 'bg-lime-400',
  ACTIVITY: 'bg-sky-400', NURSING: 'bg-violet-400', LAB: 'bg-emerald-400', IMAGING: 'bg-cyan-400',
};
const fmtD = (ms: number) => kdate(new Date(ms), 'monthDay');

/**
 * 처방 시계열 — 약품(지시)별 레인 + 기간 막대.
 * 카드 나열로는 읽히지 않는 "언제부터 언제까지·언제 바뀌었나·지금 무엇이 진행 중인가"를 보여준다.
 */
export function PrescriptionLaneView({ items, onOpenDetail }: { items: TItem[]; onOpenDetail?: (it: TItem) => void }) {
  const [medOnly, setMedOnly] = useState(false); // 활동·간호지시·식이가 섞이므로 '약만' 필터 제공
  const nowMs = Date.now();

  const source = useMemo(
    () => items.filter((i) => i.type === 'PRESCRIPTION' && (!medOnly || i.rxType === 'MEDICATION')),
    [items, medOnly],
  );
  const byId = useMemo(() => new Map(source.map((i) => [i.id, i])), [source]);
  const { lanes, range } = useMemo(
    () => buildLanes(source.map((i) => ({
      id: i.id, at: i.at, title: i.title, code: i.code, rxType: i.rxType,
      dosage: i.dosage, frequency: i.frequency, duration: i.duration, status: i.status,
    } as RxInput)), nowMs),
    [source, nowMs],
  );

  const ticks = range ? laneTicks(range) : [];
  const today = range ? nowPos(range, nowMs) : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] text-gray-400">
          막대 = 처방 기간(일수 기준) · 기간 미상은 시점 표시 · <b className="text-emerald-600">진행 중</b>은 좌측 점
        </p>
        <button type="button" onClick={() => setMedOnly((v) => !v)}
          className={`text-[11px] px-2 py-1 rounded-lg border ${medOnly ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200'}`}>
          약만 보기
        </button>
      </div>

      {!lanes.length || !range ? (
        <EmptyState icon="💊" title="해당 기간 처방이 없습니다." />
      ) : (
        <div className="space-y-1">
          {/* 축 눈금 */}
          <div className="relative h-4 ml-40 mr-2 border-b border-gray-200">
            {ticks.map((t) => (
              <span key={t.ms} className="absolute -top-0.5 text-[9px] text-gray-400 -translate-x-1/2" style={{ left: `${t.pos * 100}%` }}>{t.label}</span>
            ))}
          </div>

          {lanes.map((l) => (
            <div key={l.key} className="flex items-center gap-2 group">
              {/* 레인 라벨 */}
              <div className="w-40 shrink-0 flex items-center gap-1 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${l.ongoing ? 'bg-emerald-500' : 'bg-gray-200'}`} title={l.ongoing ? '진행 중' : '종료'} />
                <span className="text-[11px] text-gray-700 truncate" title={l.name}>{l.name}</span>
                <span className="text-[9px] text-gray-400 shrink-0">{RX_TYPE_LABEL[l.rxType] ?? l.rxType}</span>
              </div>
              {/* 막대 트랙 */}
              <div className="relative flex-1 h-6 mr-2 rounded bg-gray-50">
                {today !== null && <span className="absolute inset-y-0 w-px bg-rose-300" style={{ left: `${today * 100}%` }} title="오늘" />}
                {l.bars.map((b) => (
                  <button key={b.id} type="button"
                    onClick={() => { const it = byId.get(b.id); if (it && onOpenDetail) onOpenDetail(it); }}
                    title={`${fmtD(b.startMs)}${b.hasDuration ? ` ~ ${fmtD(b.endMs)}` : ''}${b.label ? ` · ${b.label}` : ''}${b.status === 'CANCELLED' ? ' · 취소' : ''}`}
                    style={{ left: `${b.left * 100}%`, width: `${b.width * 100}%` }}
                    className={`absolute top-1 h-4 rounded ${BAR_COLOR[l.rxType] ?? 'bg-gray-400'} ${b.status === 'CANCELLED' ? 'opacity-30 line-through' : 'opacity-80 hover:opacity-100'} ${!b.hasDuration ? 'rounded-full' : ''}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
