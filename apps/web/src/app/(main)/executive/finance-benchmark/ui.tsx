'use client';

/**
 * 경영성과 벤치마크 화면 부품 — 카드·지표 타일·탭·기관 찾기(2026-09-29 · 레이아웃 정리).
 * 한 화면 안에서 같은 모양을 쓰게 여기 둔다(카드마다 머리·여백이 제각각이던 것을 맞춘다).
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { T, useTAttr } from '@/components/ui/i18n-text';

export function Card({ title, subtitle, actions, children, className = '', bodyClassName = 'p-4' }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)] ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className="text-[14px] font-semibold text-slate-800">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function KpiTile({ label, value, hint, tone = 'slate', onClick }: {
  label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'slate' | 'indigo' | 'teal' | 'rose'; onClick?: () => void;
}) {
  const bar = { slate: 'bg-slate-300', indigo: 'bg-indigo-500', teal: 'bg-teal-500', rose: 'bg-rose-500' }[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={`relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-left shadow-[0_1px_3px_rgba(15,23,42,0.05)] ${onClick ? 'transition hover:border-indigo-200 hover:shadow-md' : ''}`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <div className="mt-1 truncate text-[20px] font-bold tabular-nums text-slate-900">{value}</div>
      {hint && <p className="mt-0.5 truncate text-[11px] text-slate-500">{hint}</p>}
    </Tag>
  );
}

export function Tabs<K extends string>({ value, onChange, items }: { value: K; onChange: (k: K) => void; items: { key: K; label: ReactNode; badge?: ReactNode }[] }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {items.map((it) => (
        <button key={it.key} role="tab" type="button" aria-selected={value === it.key} onClick={() => onChange(it.key)} data-tab={it.key}
          className={`min-h-[36px] rounded-lg px-3.5 text-[13px] font-medium transition ${value === it.key ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
          {it.label}{it.badge != null && <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 text-[10px] text-slate-600">{it.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/** 기관 찾기 — 1,000곳이 넘어 긴 선택 상자 대신 이름으로 찾는다(앞 30곳까지 보이고 더 있으면 그렇다고 말한다) */
export function InstitutionPicker({ names, value, onChange }: { names: { name: string; hint?: string | null; self?: boolean }[]; value: string | null; onChange: (name: string | null) => void }) {
  const tAttr = useTAttr();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => {
    const t = q.trim();
    const all = t ? names.filter((n) => n.name.includes(t)) : names;
    return { list: all.slice(0, 30), more: Math.max(0, all.length - 30) };
  }, [names, q]);
  return (
    <div ref={box} className="relative w-full max-w-[360px]"
      onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      {value && !open ? (
        <div className="flex min-h-[40px] items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 text-[13px]">
          <span className="truncate font-medium text-indigo-900" title={value}>{value}</span>
          <button type="button" onClick={() => { setOpen(true); setQ(''); }} className="ml-auto shrink-0 text-[11px] text-indigo-700 hover:underline"><T k="바꾸기" /></button>
          <button type="button" onClick={() => onChange(null)} className="shrink-0 text-slate-400 hover:text-slate-700" aria-label={tAttr('선택 해제')}>✕</button>
        </div>
      ) : (
        <input autoFocus={open} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          placeholder={tAttr('기관 이름으로 찾기')} aria-label={tAttr('기관 이름으로 찾기')}
          className="min-h-[40px] w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] shadow-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" />
      )}
      {open && (
        <ul className="absolute z-30 mt-1 max-h-[320px] w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-[12.5px] shadow-xl" role="listbox">
          {hits.list.map((n) => (
            <li key={n.name}>
              <button type="button" onClick={() => { onChange(n.name); setOpen(false); setQ(''); }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-indigo-50 ${n.name === value ? 'bg-indigo-50' : ''}`}>
                <span className="truncate">{n.self ? '★ ' : ''}{n.name}</span>
                {n.hint && <span className="shrink-0 text-[11px] text-slate-400">{n.hint}</span>}
              </button>
            </li>
          ))}
          {hits.list.length === 0 && <li className="px-3 py-2 text-slate-400"><T k="찾는 기관이 없습니다" /></li>}
          {hits.more > 0 && <li className="px-3 py-1.5 text-[11px] text-slate-400">{tAttr('더 있음 — 이름을 더 입력하세요')} (+{hits.more})</li>}
        </ul>
      )}
    </div>
  );
}
