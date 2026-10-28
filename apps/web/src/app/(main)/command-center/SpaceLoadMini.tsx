'use client';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { T, Tf } from '@/components/ui/i18n-text';
import { Unit } from '@/components/ui/display';
import { placedQueueCount, type SpaceLoad } from './Building3DSection';

/**
 * 공간 부하 요약(2026-10-02 · 상황판 디자인 C 3단 관제 배치의 오른쪽 열) — 3D 보기와 **같은 응답**(`/command-center/space-load`).
 * 넓은 화면에서만 부른다(좁은 화면은 3D 보기를 열 때만 조회한다 — 종전과 같다).
 * 🔴 색 기준은 흐름 목표 opdWaitMin 하나 — 출처(설정/기본값)를 함께 말한다. 도면에 못 놓은 대기는 0 으로 사라지지 않게 센다.
 */
export function SpaceLoadMini() {
  const q = useQuery({
    queryKey: ['command-center-space-load'],
    queryFn: () => apiClient.get<{ data: SpaceLoad }>('/api/v1/command-center/space-load'),
    refetchInterval: pollMs('normal'),
  });
  const raw = q.data?.data as unknown;
  const load = ((raw as { data?: SpaceLoad })?.data ?? raw) as SpaceLoad | undefined;

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]" data-space-load-mini>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Building2 className="h-4 w-4" /></span>
        <h2 className="text-sm font-bold text-slate-900"><T k="공간 부하" /></h2>
        <a href="#building-3d" className="ml-auto text-[11px] font-medium text-blue-600 hover:text-blue-700"><T k="3D 건물 보기" /> ↓</a>
      </div>
      {q.isError ? <p className="text-xs text-amber-600"><T k="조회 실패" /></p>
        : !load ? <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
        : (() => {
          const over = load.rooms.filter((r) => r.level === 'OVER_TARGET');
          const busy = load.rooms.filter((r) => r.level !== 'IDLE');
          const worst = [...load.rooms].filter((r) => r.longestWaitMin != null).sort((a, b) => (b.longestWaitMin ?? 0) - (a.longestWaitMin ?? 0))[0];
          const placed = placedQueueCount(load);
          const unplaced = load.unplaced.queueWithoutRoom + load.unplaced.queueRoomNotLinked.reduce((s, r) => s + r.count, 0);
          return (
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-slate-500"><T k="목표 초과 진료실" /></span>
                <b className={over.length ? 'text-rose-600' : 'text-slate-700'}>{over.length}<Unit>곳</Unit> <span className="font-normal text-slate-400">/ {busy.length}<Unit>곳</Unit> <T k="대기 중" /></span></b></div>
              <div className="flex justify-between gap-2"><span className="shrink-0 text-slate-500"><T k="가장 오래 기다린 진료실" /></span>
                <span className="truncate text-right text-slate-700">{worst ? <>{worst.name} · <b>{worst.longestWaitMin}</b><Unit>분</Unit></> : <span className="text-slate-400">-</span>}</span></div>
              <div className="flex justify-between"><span className="text-slate-500"><T k="도면에 놓은 대기" /></span>
                <span className="tabular-nums text-slate-700">{placed} / {load.queueTotal}</span></div>
              {unplaced > 0 && <p className="text-[11px] text-amber-700"><Tf k="도면에 못 놓은 대기 {수}명(진료실 미지정·미연결)" params={{ 수: unplaced }} /></p>}
              <p className="text-[10.5px] text-slate-400">
                <Tf k="기준: 외래 대기 목표 {분}분" params={{ 분: load.target.opdWaitMin }} /> · <T k={load.target.source === 'CONFIG' ? '설정값' : '기본값(미설정)'} />
              </p>
            </div>
          );
        })()}
    </section>
  );
}
