'use client';

import { useMemo, useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import type { TItem } from './record-card';

import { EmptyState } from '@/components/ui/display';

const ROWS: { k: 'S' | 'O' | 'A' | 'P'; label: string }[] = [
  { k: 'S', label: 'S' },
  { k: 'O', label: 'O' },
  { k: 'A', label: 'A' },
  { k: 'P', label: 'P' },
];
const ROW_HINT: Record<string, string> = { S: '주관적', O: '객관적', A: '평가', P: '계획' };
const fmtDate = (iso: string) => {
  try { return kdate(new Date(iso), 'date'); }
  catch { return iso; }
};

/**
 * 차트 시계열 — 진료 회차를 **위에서 아래로** 쌓고, 각 회차 안의 S/O/A/P 는 라벨 열을 고정해
 * 같은 항목이 세로로 정렬되게 한다(좁은 참조 패널에서도 경과 비교가 가능한 방향).
 * 좌우 표 형태는 열이 늘어나면 가로 스크롤이 강제되어 패널에서 읽기 어려웠다.
 */
export function ChartCompareView({ items, onOpenDetail }: { items: TItem[]; onOpenDetail?: (it: TItem) => void }) {
  const [newestFirst, setNewestFirst] = useState(false); // 기본=과거→최신(경과 서사 방향)

  const encs = useMemo(() => {
    const list = items.filter((i) => i.type === 'ENCOUNTER').slice()
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return newestFirst ? list.reverse() : list;
  }, [items, newestFirst]);

  if (!encs.length) return <EmptyState icon="📝" title="해당 기간 진료기록이 없습니다." />;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] text-gray-400">
          {newestFirst ? '위가 최근 · 아래가 과거' : '위가 과거 · 아래가 최근'} · 같은 항목(S/O/A/P)이 세로로 정렬
        </p>
        <button type="button" onClick={() => setNewestFirst((v) => !v)}
          className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
          {newestFirst ? '↓ 과거순' : '↑ 최신순'}
        </button>
      </div>

      {/* 시간 레일 — 회차를 세로로 잇는다 */}
      <ol className="relative border-l-2 border-gray-100 ml-1.5 space-y-3">
        {encs.map((e, idx) => (
          <li key={e.id} className="relative pl-4">
            {/* 레일 점 — 최근 회차 강조 */}
            <span className={`absolute -left-[7px] top-2 w-3 h-3 rounded-full border-2 border-white ${(!newestFirst && idx === encs.length - 1) || (newestFirst && idx === 0) ? 'bg-blue-600' : 'bg-gray-300'}`} />

            <div className="rounded-xl border border-gray-100 bg-white shadow-sm px-3 py-2">
              {/* 회차 머리 — 일자·작성자·C.C. */}
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="min-w-0">
                  <span className="text-xs font-bold text-gray-900">{fmtDate(e.at)}</span>
                  <span className="text-[11px] text-gray-400 ml-1.5">
                    {e.author || '-'}{e.visitType ? ` · ${e.visitType}` : ''}
                  </span>
                  {e.title && <div className="text-[11px] text-blue-700 font-medium truncate" title={e.title}>C.C. {e.title}</div>}
                </div>
                <span className="flex items-center gap-1.5 shrink-0">
                  {e.status && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{e.status}</span>}
                  {onOpenDetail && (
                    <button type="button" onClick={() => onOpenDetail(e)} title="이 진료 상세 열기"
                      className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-200 text-indigo-600 hover:bg-indigo-50">자료 ↗</button>
                  )}
                </span>
              </div>

              {/* S/O/A/P — 라벨 열 고정으로 회차 간 세로 정렬 */}
              <div className="space-y-0.5">
                {ROWS.map((r) => {
                  const v = e.soap?.[r.k];
                  return (
                    <div key={r.k} className="flex gap-2 text-[11px]">
                      <span className="w-6 shrink-0 font-bold text-gray-400" title={ROW_HINT[r.k]}>{r.label}</span>
                      {v ? <span className="flex-1 text-gray-700 whitespace-pre-wrap break-words">{v}</span>
                        : <span className="flex-1 text-gray-300">—</span>}
                    </div>
                  );
                })}
                <div className="flex gap-2 text-[11px] pt-0.5 border-t border-gray-50 mt-1">
                  <span className="w-6 shrink-0 text-gray-400">진단</span>
                  <span className="flex-1 text-gray-600">
                    {e.diagnoses?.length
                      ? e.diagnoses.map((d) => `${d.name ?? ''}${d.code ? `(${d.code})` : ''}`).filter(Boolean).join(', ')
                      : <span className="text-gray-300">—</span>}
                  </span>
                </div>
                <div className="flex gap-2 text-[11px]">
                  <span className="w-6 shrink-0 text-gray-400">처방</span>
                  <span className="flex-1 text-gray-600">{e.rxCount ? `${e.rxCount}건` : <span className="text-gray-300">—</span>}</span>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
