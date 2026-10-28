'use client';

export type Segment = { key: string; label: string; count?: number };

/** 큰 터치 세그먼트 탭(가로 스크롤·스냅). 핫키/작은 탭 대체. */
export default function SegmentedTabs({ segments, active, onChange }: {
  segments: Segment[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {segments.map((s) => {
        const on = s.key === active;
        return (
          <button
            key={s.key}
            onClick={() => onChange(s.key)}
            className={`shrink-0 min-h-[48px] px-5 rounded-2xl text-base font-semibold transition-colors ${
              on ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-700 border border-gray-200'
            }`}
          >
            {s.label}
            {s.count != null && s.count > 0 && (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${on ? 'bg-white/25' : 'bg-gray-100 text-gray-600'}`}>{s.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
