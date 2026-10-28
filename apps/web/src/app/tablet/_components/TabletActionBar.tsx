'use client';

export type TabletAction = { key: string; label: string; icon?: string; onTap: () => void; primary?: boolean; danger?: boolean; disabled?: boolean };

/** 하단 고정 액션 바(엄지존). 키보드 핫키(F2 저장·F8 취소 등) 대체. */
export default function TabletActionBar({ left = [], right = [] }: { left?: TabletAction[]; right?: TabletAction[] }) {
  const btn = (a: TabletAction) => (
    <button
      key={a.key}
      onClick={a.onTap}
      disabled={a.disabled}
      className={`min-h-[52px] px-5 rounded-2xl text-base font-semibold inline-flex items-center gap-2 disabled:opacity-40 ${
        a.danger ? 'bg-red-600 text-white' : a.primary ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-200'
      }`}
    >
      {a.icon && <span aria-hidden>{a.icon}</span>}
      {a.label}
    </button>
  );
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 bg-white/95 backdrop-blur border-t border-gray-200 px-3 py-2.5 flex items-center justify-between gap-2">
      <div className="flex gap-2">{left.map(btn)}</div>
      <div className="flex gap-2">{right.map(btn)}</div>
    </div>
  );
}
