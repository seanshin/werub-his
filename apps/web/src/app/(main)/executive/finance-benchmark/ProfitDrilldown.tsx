'use client';

/**
 * 손익 흐름·수익 구성 — 세목까지 **드릴다운**(2026-09-29 · 사용자 요청 "더 세련되게, 드릴다운되는 형태로").
 *
 * 손익 흐름: 의료수익 → 비용 4항목 → 의료이익 → 의료외 수익·비용 → 경상이익 → 당기순이익. 줄마다 의료수익 대비 비중.
 *   의료수익·인건비·재료비·관리운영비·의료외수익·의료외비용 줄을 누르면 세목이 그 자리에 펼쳐진다
 *   (금액 · 상위 계정 안 비중 · 의료수익 대비 · 같은 종별 동급 중앙값과 차이). 세목 안에 세목이 있으면 한 번 더 펼친다.
 * 수익 구성: 입원·외래·기타 도넛 — 조각을 누르면 그 세목.
 *
 * 🔴 정직: 세목은 공시 계정 그대로(이름은 공시 표기 — 번역하지 않는 데이터 값) · 세목 자료가 없는 해는 "세목 자료 없음"(0 으로 그리지 않는다) ·
 *    세목 합이 상위 계정과 다르면 그 사실을 말한다 · 동급 비교는 중앙값·n · 비용이 동급보다 높으면 붉게(판정 아님), 수익 세목은 색으로 좋고 나쁨을 말하지 않는다.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DRILL_CODE, accountChildren, formatNum, peerStat, type FinanceAccounts, type FinanceRatio } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { Num, Ratio } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

export interface DrillRow {
  name: string; institutionName?: string; institutionCode?: string | null; beds: number | null;
  medicalRevenue: number | null; ratios: Record<FinanceRatio, number | null>; accounts?: FinanceAccounts;
}
interface DetailNode { code: string; name: string; parent: string | null; amount: number | null; share: number | null; peerMedianShare: number | null; peerN: number }
interface DetailResp { available: boolean; reason?: 'NO_DETAIL'; nodes?: DetailNode[]; mismatches?: { code: string; name: string }[]; peerCount?: number }

const NA = () => <Ratio numerator={null} denominator={null} pctOnly />;
const eok = (v: number) => formatNum(v / 1e8, 'moneyEok');
function Pct({ v, signed = false }: { v: number | null | undefined; signed?: boolean }) {
  if (v == null) return <NA />;
  return <>{signed && v > 0 ? '+' : ''}<Num value={v * 100} domain={signed ? 'percentPoint' : 'percent'} /></>;
}

/** 세목 조회 — 기관 코드가 있으면 코드로(연도마다 이름이 다르다) */
export function useDrillDetail(cur: DrillRow, year: number | null) {
  const key = cur.institutionCode ?? cur.institutionName ?? cur.name;
  return useQuery({
    queryKey: ['fb-detail', key, year],
    queryFn: () => apiClient.get<{ data: DetailResp }>('/api/v1/finance-benchmark/detail', {
      ...(cur.institutionCode ? { code: cur.institutionCode } : { name: cur.institutionName ?? cur.name }),
      ...(year ? { year: String(year) } : {}),
    }),
  });
}

/** 세목 목록(한 단계) — 큰 것부터 8개 + 나머지는 접어 둔다 · 자식이 있으면 한 번 더 펼친다 */
function DrillList({ parent, nodes, tone, depth = 0 }: { parent: DetailNode; nodes: DetailNode[]; tone: 'cost' | 'revenue'; depth?: number }) {
  const tAttr = useTAttr();
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const kids = accountChildren(parent.code)
    .map((k) => nodes.find((n) => n.code === k.code))
    .filter((n): n is DetailNode => !!n && n.amount != null)
    .sort((a, b) => Math.abs(b.amount as number) - Math.abs(a.amount as number));
  if (!kids.length) return <p className="px-2 py-1 text-[11px] text-gray-400"><T k="세목이 없습니다" /></p>;
  const shown = showAll ? kids : kids.slice(0, 8);
  const rest = kids.length - shown.length;
  const maxAbs = Math.max(1, ...kids.map((k) => Math.abs(k.amount as number)));
  return (
    <div className={`space-y-1 ${depth ? 'ml-4 border-l border-slate-200 pl-2' : ''}`}>
      {shown.map((k) => {
        const inParent = parent.amount ? (k.amount as number) / parent.amount : null;
        const diff = k.share != null && k.peerMedianShare != null ? k.share - k.peerMedianShare : null;
        const worse = tone === 'cost' && diff != null && diff > 0.005;
        const hasKids = accountChildren(k.code).some((c) => nodes.find((n) => n.code === c.code && n.amount != null));
        return (
          <div key={k.code}>
            <button type="button" disabled={!hasKids} onClick={() => setOpen(open === k.code ? null : k.code)}
              className="grid w-full grid-cols-[minmax(0,1fr)_90px_76px_64px_70px] items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px] hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
              data-drill-row={k.code}>
              <span className="truncate text-gray-700">{hasKids ? (open === k.code ? '▾ ' : '▸ ') : ''}{k.name}</span>
              <span className="relative h-2 rounded-full bg-slate-100">
                <span className={`absolute left-0 top-0 h-2 rounded-full ${tone === 'cost' ? 'bg-rose-300' : 'bg-teal-300'}`} style={{ width: `${(Math.abs(k.amount as number) / maxAbs) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums text-gray-800">{eok(k.amount as number)}</span>
              <span className="text-right tabular-nums text-gray-500" title={tAttr('상위 계정 안 비중')}>{inParent == null ? '-' : <Pct v={inParent} />}</span>
              <span className={`text-right tabular-nums text-[11px] ${worse ? 'font-semibold text-rose-600' : 'text-gray-500'}`} title={tAttr('의료수익 대비 — 동급 중앙값과 차이')}>
                {diff == null ? <span className="text-gray-300">-</span> : <Pct v={diff} signed />}
              </span>
            </button>
            {open === k.code && <DrillList parent={k} nodes={nodes} tone={tone} depth={depth + 1} />}
          </div>
        );
      })}
      {rest > 0 && (
        <button type="button" onClick={() => setShowAll(true)} className="ml-2 text-[11px] text-indigo-600 hover:underline">
          <Tf k="그 밖 {n}개 더 보기" params={{ n: rest }} />
        </button>
      )}
    </div>
  );
}

type Step = { key: string; label: ReactNode; delta: number; total?: boolean; drill?: string; tone?: 'cost' | 'revenue' };

/** 손익 흐름 — 워터폴 + 세목 드릴다운 */
export function ProfitDrilldown({ cur, year }: { cur: DrillRow; year: number | null }) {
  const a = cur.accounts ?? {};
  const q = useDrillDetail(cur, year);
  const [open, setOpen] = useState<string | null>(null);
  const need = [a.medicalRevenue, a.laborCost, a.materialCost, a.adminCost, a.medicalProfit];
  if (need.some((v) => v == null)) return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)]"><p className="mb-1 font-semibold text-gray-800"><T k="손익 흐름" /></p><p className="text-[12px] text-gray-500"><T k="필요한 공시 계정이 없어 그리지 않습니다" /></p></section>
  );
  const rev = a.medicalRevenue as number;
  const steps: Step[] = [
    { key: 'rev', label: <T k="의료수익" />, delta: rev, total: true, drill: DRILL_CODE.medicalRevenue, tone: 'revenue' },
    { key: 'labor', label: <T k="인건비" />, delta: -(a.laborCost as number), drill: DRILL_CODE.laborCost, tone: 'cost' },
    { key: 'mat', label: <T k="재료비" />, delta: -(a.materialCost as number), drill: DRILL_CODE.materialCost, tone: 'cost' },
    { key: 'adm', label: <T k="관리운영비" />, delta: -(a.adminCost as number), drill: DRILL_CODE.adminCost, tone: 'cost' },
    ...(a.otherMedicalCost ? [{ key: 'oth', label: <T k="기타의료비용" />, delta: -a.otherMedicalCost }] : []),
    { key: 'mp', label: <T k="의료이익" />, delta: a.medicalProfit as number, total: true },
    ...(a.nonMedicalRevenue != null ? [{ key: 'nmr', label: <T k="의료외수익" />, delta: a.nonMedicalRevenue, drill: DRILL_CODE.nonMedicalRevenue, tone: 'revenue' as const }] : []),
    ...(a.nonMedicalCost != null ? [{ key: 'nmc', label: <T k="의료외비용" />, delta: -a.nonMedicalCost, drill: DRILL_CODE.nonMedicalCost, tone: 'cost' as const }] : []),
    ...(a.preTaxIncome != null ? [{ key: 'pt', label: <T k="경상이익" />, delta: a.preTaxIncome, total: true }] : []),
    ...(a.preTaxIncome != null && a.netIncome != null ? [{ key: 'tax', label: <T k="법인세·준비금 등" />, delta: a.netIncome - a.preTaxIncome }] : []),
    ...(a.netIncome != null ? [{ key: 'ni', label: <T k="당기순이익" />, delta: a.netIncome, total: true }] : []),
  ];
  let run = 0;
  const bars = steps.map((s) => {
    const from = s.total ? 0 : run;
    const to = s.total ? s.delta : run + s.delta;
    run = to;
    return { ...s, from, to };
  });
  const lo = Math.min(0, ...bars.flatMap((b) => [b.from, b.to])), hi = Math.max(0, ...bars.flatMap((b) => [b.from, b.to]));
  const pos = (v: number) => ((v - lo) / Math.max(1, hi - lo)) * 100;
  const d = q.data?.data;
  const nodes = d?.available ? d.nodes ?? [] : [];
  const drillable = (code?: string) => !!code && nodes.some((n) => n.parent === code && n.amount != null);

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-800"><T k="손익 흐름" /></p>
          <p className="text-[11px] text-gray-500"><T k="줄을 누르면 세목이 펼쳐집니다 — 금액 · 상위 계정 안 비중 · 의료수익 대비 동급 중앙값과 차이" /></p>
        </div>
        <div className="flex gap-1.5 text-[11px]">
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700"><T k="의료이익률" /> <Pct v={cur.ratios.medicalProfitMargin} /></span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700"><T k="당기순이익률" /> <Pct v={cur.ratios.netMargin} /></span>
        </div>
      </div>

      <div className="space-y-0.5">
        {bars.map((b) => {
          const left = Math.min(pos(b.from), pos(b.to)), width = Math.max(0.6, Math.abs(pos(b.to) - pos(b.from)));
          const canDrill = drillable(b.drill);
          const isOpen = open === b.key && canDrill;
          const color = b.total ? (b.to >= 0 ? 'from-indigo-500 to-violet-500' : 'from-rose-600 to-rose-500') : b.delta >= 0 ? 'from-teal-400 to-emerald-400' : 'from-rose-300 to-rose-400';
          const parent = b.drill ? nodes.find((n) => n.code === b.drill) : undefined;
          return (
            <div key={b.key} className={b.total ? 'border-t border-slate-100 pt-0.5' : ''}>
              <button type="button" disabled={!canDrill} onClick={() => setOpen(isOpen ? null : b.key)} data-step={b.key}
                className={`group grid w-full grid-cols-[112px_minmax(0,1fr)_84px_52px] items-center gap-2 rounded-lg px-1.5 py-1.5 text-left ${canDrill ? 'hover:bg-slate-50' : 'cursor-default'} ${isOpen ? 'bg-slate-50' : ''}`}>
                <span className={`flex items-center gap-1 truncate text-[12.5px] ${b.total ? 'font-bold text-gray-900' : 'text-gray-600'}`}>
                  <span className={`w-3 text-[10px] text-gray-400 ${canDrill ? '' : 'invisible'}`}>{isOpen ? '▾' : '▸'}</span>{b.label}
                </span>
                <span className="relative h-5">
                  <span className="absolute inset-y-0 w-px bg-slate-300" style={{ left: `${pos(0)}%` }} />
                  <span className={`absolute top-0.5 h-4 rounded-md bg-gradient-to-r shadow-sm transition-all ${color} ${canDrill ? 'group-hover:brightness-105' : ''}`}
                    style={{ left: `${left}%`, width: `${width}%` }} />
                </span>
                <span className={`text-right text-[12.5px] tabular-nums ${b.total ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
                  {`${b.delta >= 0 && !b.total ? '+' : ''}${eok(b.delta)}`}
                </span>
                <span className="text-right text-[11px] tabular-nums text-gray-400"><Pct v={b.delta / rev} /></span>
              </button>
              {isOpen && parent && (
                <div className="mb-1 mt-0.5 rounded-xl border border-slate-100 bg-white p-1.5 shadow-inner">
                  <div className="grid grid-cols-[minmax(0,1fr)_90px_76px_64px_70px] gap-2 px-2 pb-1 text-[10px] text-gray-400">
                    <span><T k="세목" /></span><span /><span className="text-right"><T k="금액" /></span><span className="text-right"><T k="안 비중" /></span><span className="text-right"><T k="동급 대비" /></span>
                  </div>
                  <DrillList parent={parent} nodes={nodes} tone={b.tone ?? 'cost'} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[10px] text-gray-400">
        {q.isLoading ? <T k="세목을 불러오는 중…" />
          : q.isError ? <span className="text-rose-600"><T k="세목을 불러오지 못했습니다 — 상위 계정만 보입니다" /></span>
          : d && !d.available ? <T k="이 해에는 세목 자료가 없어 상위 계정만 보입니다" />
          : d?.available ? <Tf k="동급 = 같은 종별·같은 해 세목이 있는 {n}곳 · 동급 대비 = 의료수익 대비 비중의 중앙값과 차이(%p) · 비용이 동급보다 높으면 붉게(판정 아님)" params={{ n: d.peerCount ?? 0 }} />
          : null}
        {d?.available && !!d.mismatches?.length && (
          <span className="ml-1 text-amber-700"><Tf k="· 세목 합이 상위 계정과 다른 곳: {목록}" params={{ 목록: d.mismatches!.map((m) => m.name).join(', ') }} /></span>
        )}
      </p>
    </section>
  );
}

/** 수익 구성 — 입원·외래·기타 도넛 · 조각을 누르면 세목 · 효율 지표는 동급 막대와 함께 */
export function RevenueMixDrill({ cur, peers, year }: { cur: DrillRow; peers: DrillRow[]; year: number | null }) {
  const a = cur.accounts ?? {};
  const rev = a.medicalRevenue ?? null;
  const q = useDrillDetail(cur, year);
  const [pick, setPick] = useState<string | null>(null);
  const share = (v: number | undefined) => (rev && rev > 0 && v != null ? v / rev : null);
  const mix = [
    { key: '60101000', label: <T k="입원" />, v: share(a.inpatientRevenue), color: '#6366f1' },
    { key: '60102000', label: <T k="외래" />, v: share(a.outpatientRevenue), color: '#38bdf8' },
    { key: '60103000', label: <T k="기타" />, v: share(a.otherMedicalRevenue), color: '#cbd5e1' },
  ];
  const nodes = q.data?.data.available ? q.data.data.nodes ?? [] : [];
  const perBed = (r: DrillRow) => (r.beds && r.beds > 0 && r.accounts?.medicalRevenue != null ? r.accounts.medicalRevenue / r.beds : null);
  const metrics: { key: string; label: ReactNode; v: number | null; m: number | null; money?: boolean }[] = [
    { key: 'bed', label: <T k="병상당 의료수익" />, v: perBed(cur), m: peerStat(peers.map(perBed)).median, money: true },
    { key: 'inp', label: <T k="입원수익 비중" />, v: cur.ratios.inpatientShare, m: peerStat(peers.map((r) => r.ratios.inpatientShare)).median },
    { key: 'res', label: <T k="연구수익 비중" />, v: cur.ratios.researchShare, m: peerStat(peers.map((r) => r.ratios.researchShare)).median },
    { key: 'nmn', label: <T k="의료외 순손익률" />, v: cur.ratios.nonMedicalNetRatio, m: peerStat(peers.map((r) => r.ratios.nonMedicalNetRatio)).median },
    { key: 'net', label: <T k="당기순이익률" />, v: cur.ratios.netMargin, m: peerStat(peers.map((r) => r.ratios.netMargin)).median },
  ];
  // 도넛 호
  const R = 46, C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = mix.filter((m) => m.v != null && m.v > 0).map((m) => { const o = acc; acc += m.v as number; return { ...m, off: o }; });
  const picked = pick ? nodes.find((n) => n.code === pick) : undefined;
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
      <p className="mb-2 font-semibold text-gray-800"><T k="수익 구성·효율" /></p>
      {mix.every((m) => m.v == null) ? <p className="text-[12px] text-gray-500"><NA /></p> : (
        <div className="flex flex-wrap items-center gap-4">
          <svg viewBox="0 0 120 120" className="h-32 w-32 shrink-0" role="img" aria-label="revenue mix">
            <circle cx={60} cy={60} r={R} fill="none" stroke="#f1f5f9" strokeWidth={16} />
            {arcs.map((m) => (
              <circle key={m.key} cx={60} cy={60} r={R} fill="none" stroke={m.color} strokeWidth={pick === m.key ? 20 : 16}
                strokeDasharray={`${(m.v as number) * C} ${C}`} strokeDashoffset={-m.off * C} transform="rotate(-90 60 60)"
                style={{ cursor: nodes.length ? 'pointer' : 'default', transition: 'stroke-width .15s' }}
                onClick={() => nodes.length && setPick(pick === m.key ? null : m.key)} data-arc={m.key} />
            ))}
            <text x={60} y={56} textAnchor="middle" fontSize={9} fill="#64748b">{rev != null ? <T k="의료수익" /> : null}</text>
            <text x={60} y={70} textAnchor="middle" fontSize={12} fontWeight={700} fill="#0f172a">{rev != null ? eok(rev) : ''}</text>
          </svg>
          <div className="min-w-[140px] flex-1 space-y-1 text-[12px]">
            {mix.map((m) => (
              <button key={m.key} type="button" onClick={() => nodes.length && setPick(pick === m.key ? null : m.key)}
                className={`flex w-full items-center justify-between rounded-lg px-2 py-1 ${pick === m.key ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />{m.label}</span>
                <span className="tabular-nums font-medium"><Pct v={m.v} /></span>
              </button>
            ))}
            {nodes.length > 0 && <p className="px-2 text-[10px] text-gray-400"><T k="조각을 누르면 세목" /></p>}
          </div>
        </div>
      )}
      {picked && (
        <div className="mt-2 rounded-xl border border-slate-100 p-1.5">
          <DrillList parent={picked} nodes={nodes} tone="revenue" />
        </div>
      )}
      <div className="mt-3 space-y-2">
        {metrics.map((r) => {
          const max = Math.max(Math.abs(r.v ?? 0), Math.abs(r.m ?? 0), 1e-9);
          return (
            <div key={r.key} className="text-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">{r.label}</span>
                <span className="tabular-nums"><b className="text-gray-900">{r.v == null ? <NA /> : r.money ? eok(r.v) : <Pct v={r.v} />}</b>
                  <span className="ml-2 text-[11px] text-gray-400"><T k="동급" /> {r.m == null ? <NA /> : r.money ? eok(r.m) : <Pct v={r.m} />}</span></span>
              </div>
              <div className="relative mt-1 h-1.5 rounded-full bg-slate-100">
                {r.v != null && <span className="absolute left-0 top-0 h-1.5 rounded-full bg-indigo-500" style={{ width: `${(Math.abs(r.v) / max) * 100}%` }} />}
                {r.m != null && <span className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-slate-500" style={{ left: `${(Math.abs(r.m) / max) * 100}%` }} title="median" />}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-gray-400"><Tf k="동급 = 같은 종별 {n}곳(선택 기관 제외)" params={{ n: peers.length }} /> · <T k="막대 = 선택 기관 · 세로선 = 동급 중앙값" /></p>
    </section>
  );
}
