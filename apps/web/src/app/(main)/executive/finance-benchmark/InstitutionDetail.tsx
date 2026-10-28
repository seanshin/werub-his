'use client';

/**
 * 선택 기관 상세 — 경영성과 벤치마크 오른쪽 칸(지도 옆). 공시 계정만으로 그린다(지어내지 않는다).
 *   · 개요: 종별·설립·병상·지역 · 의료수익·의료이익·당기순이익 · 동급(같은 종별) 의료이익률 순위·백분위
 *   · 손익 흐름·수익 구성(세목 드릴다운)은 `ProfitDrilldown.tsx` 로 옮겼다(2026-09-29).
 * 🔴 정직: 계정이 없으면 그 칸은 산출 불가(0 으로 그리지 않는다) · 병상 수가 없으면 병상당 지표 산출 불가 ·
 *    순위의 분모(동급 n)를 함께 쓴다 · 워터폴의 '법인세·준비금 등'은 경상이익과 당기순이익의 차이다(세목을 지어내지 않는다).
 */
import { formatNum, type FinanceAccounts, type FinanceRatio } from '@hospital-run/shared';
import { Num, Ratio } from '@/components/ui/display';
import { T, Tf } from '@/components/ui/i18n-text';

export interface DetailRow {
  name: string; self: boolean; hospitalType: string | null; foundingType: string | null; beds: number | null;
  sido: string | null; sigungu: string | null; medicalRevenue: number | null; medicalProfit: number | null;
  ratios: Record<FinanceRatio, number | null>; accounts?: FinanceAccounts;
}

const pct = (v: number | null | undefined) => (v == null ? null : v * 100);
const eok = (v: number | null | undefined) => (v == null ? null : v / 1e8);
const NA = () => <Ratio numerator={null} denominator={null} pctOnly />;

function Money({ v, tone = false }: { v: number | null | undefined; tone?: boolean }) {
  if (v == null) return <NA />;
  return <span className={tone ? (v >= 0 ? 'text-teal-700' : 'text-rose-600') : undefined}><Num value={eok(v)} domain="moneyEok" /></span>;
}
function Pct({ v }: { v: number | null | undefined }) {
  return v == null ? <NA /> : <Num value={pct(v)} domain="percent" />;
}

/** 개요 + 동급 순위 */
export function InstitutionSummary({ cur, peers }: { cur: DetailRow; peers: DetailRow[] }) {
  const a = cur.accounts ?? {};
  const pool = [...peers, cur].filter((r) => r.ratios.medicalProfitMargin != null).sort((x, y) => (y.ratios.medicalProfitMargin as number) - (x.ratios.medicalProfitMargin as number));
  const rank = pool.findIndex((r) => r.name === cur.name);
  const n = pool.length;
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-gray-800">{cur.self ? '★ ' : ''}{cur.name}</p>
        <p className="text-[11px] text-gray-500">{[cur.hospitalType, cur.foundingType, [cur.sido, cur.sigungu].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(118px,1fr))]">
        <div className="rounded-xl bg-slate-50 p-2"><p className="text-[11px] text-gray-500"><T k="병상" /></p><p className="whitespace-nowrap text-[17px] font-bold tabular-nums">{cur.beds ?? <NA />}</p></div>
        <div className="rounded-xl bg-slate-50 p-2"><p className="text-[11px] text-gray-500"><T k="의료수익" /></p><p className="whitespace-nowrap text-[17px] font-bold tabular-nums"><Money v={a.medicalRevenue} /></p></div>
        <div className="rounded-xl bg-slate-50 p-2"><p className="text-[11px] text-gray-500"><T k="의료이익" /></p><p className="whitespace-nowrap text-[17px] font-bold tabular-nums"><Money v={a.medicalProfit} tone /></p></div>
        <div className="rounded-xl bg-slate-50 p-2"><p className="text-[11px] text-gray-500"><T k="당기순이익" /></p><p className="whitespace-nowrap text-[17px] font-bold tabular-nums"><Money v={a.netIncome} tone /></p></div>
      </div>
      {rank >= 0 && n > 1 && (
        <div className="mt-3">
          <p className="mb-1 text-[12px] text-gray-700">
            <Tf k="동급 의료이익률 {순위}위 / {n}곳(상위 {백분위}%)" params={{ 순위: rank + 1, n, 백분위: formatNum(((rank + 1) / n) * 100, 'percent', { unit: false }) }} />
          </p>
          {/* 순위 막대 — 왼쪽이 1위 */}
          <div className="relative h-2 rounded-full bg-gradient-to-r from-teal-400 via-slate-200 to-rose-400">
            <div className="absolute -top-1 h-4 w-1.5 -translate-x-1/2 rounded bg-indigo-700" style={{ left: `${(rank / Math.max(1, n - 1)) * 100}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}

/** 기관을 고르기 전 — 지금 보는 범위의 의료이익률 상위·하위 5곳(누르면 선택) */
export function TopBottomList({ rows, onPick }: { rows: DetailRow[]; onPick: (name: string) => void }) {
  const ranked = rows.filter((r) => r.ratios.medicalProfitMargin != null).sort((a, b) => (b.ratios.medicalProfitMargin as number) - (a.ratios.medicalProfitMargin as number));
  if (!ranked.length) return null;
  const top = ranked.slice(0, 5), bottom = ranked.slice(-5).reverse();
  const List = ({ items, tone }: { items: DetailRow[]; tone: string }) => (
    <ul className="space-y-1">
      {items.map((r) => (
        <li key={r.name}>
          <button onClick={() => onPick(r.name)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-slate-50">
            <span className="truncate">{r.name}</span><span className={`font-semibold ${tone}`}><Pct v={r.ratios.medicalProfitMargin} /></span>
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
      <p className="mb-1 font-semibold text-gray-800"><Tf k="의료이익률 상위·하위 — 지금 보는 범위 {n}곳" params={{ n: ranked.length }} /></p>
      <p className="mb-2 text-[11px] text-gray-500"><T k="누르면 그 기관의 상세가 보입니다" /></p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><p className="mb-1 text-[11px] font-medium text-teal-700"><T k="상위 5" /></p><List items={top} tone="text-teal-700" /></div>
        <div><p className="mb-1 text-[11px] font-medium text-rose-600"><T k="하위 5" /></p><List items={bottom} tone="text-rose-600" /></div>
      </div>
    </section>
  );
}
