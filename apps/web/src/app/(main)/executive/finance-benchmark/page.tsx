'use client';

/**
 * 경영성과 벤치마크(3002) — 의료기관 회계정보공시 손익으로 동급 병원과 비교한다.
 * 분석 틀은 외부 공개 프로젝트 "국내 (상급)종합병원 경영성과 대시보드"(TAEJIN-AHN/Hospital-Profit-Visualization)에서 배웠다:
 *   ① 지역 내 병원 간 의료이익 비교 ② 의료수익경상이익률 동급 비교 ③ 연도별 의료이익률 추이 ④ 의료수익 대비 비용 구조 편차
 *
 * 🔴 정직 표기:
 *   - 동급 비교는 **중앙값 기준** — 평균·사분위·n 을 함께 보인다(종합병원 의료이익률 평균과 중앙값이 크게 다르다).
 *   - 우리 병원 손익은 HIS 에 없다 — 설정으로 지정된 공시 기관만 "우리 병원"이다. 미지정이면 그렇게 말한다(지어내지 않는다).
 *   - 의료수익이 없거나 0 이하인 기관의 비율은 산출 불가 · 좌표가 없는 기관은 주소의 읍면동·시군구 안의 점에 "위치 근사"로 그린다(지도가 수를 밝힌다).
 *   - 종별(상급종합·종합·병원·요양·정신)은 합쳐 비교하지 않는다 — 종별 개관은 줄을 나누고, 종별을 고르면 지도·목록도 그 종별로 좁힌다.
 *   - 의원(개원가)은 회계정보공시 대상이 아니다 — 손익을 채우지 않고 무엇이 공개되는지만 밝힌다.
 *   - 공시 원자료는 관리자가 가져온다(출처 메모·가져오기 이력을 화면에 남긴다).
 */
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COST_RATIOS, FINANCE_RATIOS, peerDeviation, peerStat,
  type FinanceAccounts, type FinanceRatio, type PeerStat,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import { KDate, Num, Ratio } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { KoreaBubbleMap, normalizeSido } from './KoreaBubbleMap';
import { InstitutionSummary, TopBottomList } from './InstitutionDetail';
import { ProfitDrilldown, RevenueMixDrill } from './ProfitDrilldown';
import { TrendChart, type TrendRow } from './TrendChart';
import { Card, InstitutionPicker, KpiTile, Tabs } from './ui';
import { ClinicDisclosureNote, TypeOverview } from './TypeOverview';
import { MapLegend } from './MapMarker';

// 3D 는 three.js — 브라우저에서만(서버 렌더 제외) · 불러오는 동안 자리만 잡는다
const KoreaMap3D = dynamic(() => import('./KoreaMap3D'), { ssr: false, loading: () => <div className="h-[620px] w-full animate-pulse rounded-xl bg-sky-50" /> });

type Ratios = Record<FinanceRatio, number | null>;
interface Overview {
  available: boolean;
  reason?: 'NO_DATA';
  years?: number[];
  year?: number;
  types?: string[];
  type?: string | null;
  peerCount?: number;
  peer?: Record<FinanceRatio, PeerStat>;
  self?: { status: 'NOT_SET' | 'NOT_FOUND' | 'FOUND'; name: string | null; ratios?: Ratios; accounts?: FinanceAccounts; hospitalType?: string | null };
  lastImport?: { createdAt: string; fileName: string; sourceNote: string | null } | null;
}
interface InstRow {
  name: string; institutionCode?: string | null; self: boolean; hospitalType: string | null; foundingType: string | null; beds: number | null;
  sido: string | null; sigungu: string | null; lat: number | null; lng: number | null;
  medicalRevenue: number | null; medicalProfit: number | null; ratios: Ratios; accounts?: FinanceAccounts;
}
interface Institutions { available: boolean; year?: number; regions?: Record<string, Record<string, number>>; rows?: InstRow[] }
interface ImportResult { totalRows: number; created: number; updated: number; rejected: number; rejects: { line: number; name: string | null; year: number | null; reason: string; detail?: string }[] }

const pct = (v: number | null | undefined) => (v == null ? null : v * 100);
const eok = (v: number | null | undefined) => (v == null ? null : v / 1e8);

/** 비율 한 칸 — null 은 산출 불가 */
function P({ v, className }: { v: number | null | undefined; className?: string }) {
  return v == null ? <span className={`text-gray-400 ${className ?? ''}`}><Ratio numerator={null} denominator={null} pctOnly /></span> : <Num value={pct(v)} domain="percent" className={className} />;
}
function Pp({ v, worse }: { v: number | null; worse: boolean | null }) {
  if (v == null) return <span className="text-gray-400">-</span>;
  const tone = worse ? 'text-rose-600' : 'text-emerald-600';
  return <span className={`font-semibold ${tone}`}>{v > 0 ? '+' : ''}<Num value={pct(v)} domain="percentPoint" /></span>;
}

function RatioLabel({ r }: { r: FinanceRatio }) {
  switch (r) {
    case 'medicalProfitMargin': return <T k="의료이익률" />;
    case 'ordinaryMargin': return <T k="의료수익경상이익률" />;
    case 'laborRatio': return <T k="인건비율" />;
    case 'materialRatio': return <T k="재료비율" />;
    case 'adminRatio': return <T k="관리운영비율" />;
    case 'netMargin': return <T k="당기순이익률" />;
    case 'nonMedicalNetRatio': return <T k="의료외 순손익률" />;
    case 'researchShare': return <T k="연구수익 비중" />;
    default: return <T k="입원수익 비중" />;
  }
}

/** ② 분포 위치 — 사분위 띠·중앙값·평균·선택 기관 */
function RangeBar({ peer, v }: { peer: PeerStat; v: number | null }) {
  const vals = [peer.p25, peer.p75, peer.median, peer.mean, v].filter((x): x is number => x != null);
  if (peer.n === 0 || vals.length === 0) return <p className="text-[12px] text-gray-400"><Ratio numerator={null} denominator={null} pctOnly /></p>;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(1e-9, hi - lo);
  const pos = (n: number) => `${6 + ((n - lo) / span) * 88}%`;
  return (
    <div className="relative h-12">
      <div className="absolute top-5 h-2 w-full rounded-full bg-slate-100" />
      {peer.p25 != null && peer.p75 != null && (
        <div className="absolute top-5 h-2 rounded-full bg-slate-300" style={{ left: pos(peer.p25), width: `calc(${pos(peer.p75)} - ${pos(peer.p25)})` }} />
      )}
      {peer.median != null && <div className="absolute top-3 h-6 w-0.5 bg-slate-700" style={{ left: pos(peer.median) }} title="median" />}
      {peer.mean != null && <div className="absolute top-3 h-6 w-0.5 bg-amber-500" style={{ left: pos(peer.mean) }} title="mean" />}
      {v != null && <div className="absolute top-3.5 h-5 w-5 -translate-x-1/2 rounded-full border-2 border-white bg-indigo-600 shadow" style={{ left: pos(v) }} />}
    </div>
  );
}

export default function FinanceBenchmarkPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';
  const [year, setYear] = useState<number | null>(null);
  const [type, setType] = useState<string>('');
  const [picked, setPicked] = useState<string | null>(null);
  const [sido, setSido] = useState('');
  const [sigungu, setSigungu] = useState('');
  const [tab, setTab] = useState<'overview' | 'map' | 'analysis' | 'import'>('overview');
  const [mapMode, setMapMode] = useState<'2d' | '3d'>('2d');
  const [no3d, setNo3d] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const ovQ = useQuery({
    queryKey: ['fb-overview', year, type],
    queryFn: () => apiClient.get<{ data: Overview }>('/api/v1/finance-benchmark/overview', { ...(year ? { year: String(year) } : {}), ...(type ? { type } : {}) }),
  });
  const ov = ovQ.data?.data;
  const effYear = ov?.year ?? null;
  const instQ = useQuery({
    queryKey: ['fb-institutions', effYear],
    queryFn: () => apiClient.get<{ data: Institutions }>('/api/v1/finance-benchmark/institutions', effYear ? { year: String(effYear) } : {}),
    enabled: !!ov?.available,
  });
  const inst = instQ.data?.data;
  const selfName = ov?.self?.status === 'FOUND' ? ov.self.name : null;
  const name = picked ?? selfName;
  // 추이는 기관 코드로 잇는다(연도마다 공시 이름 표기가 다르다) — 코드가 없는 기관만 이름으로
  const nameCode = (inst?.rows ?? []).find((r) => r.name === name)?.institutionCode ?? null;
  const trendQ = useQuery({
    queryKey: ['fb-trend', name, nameCode],
    queryFn: () => apiClient.get<{ data: { rows: TrendRow[]; linkedBy: 'CODE' | 'NAME'; names: string[] } }>('/api/v1/finance-benchmark/trend', nameCode ? { code: nameCode } : { name: name! }),
    enabled: !!name && !!inst,
  });
  const importsQ = useQuery({
    queryKey: ['fb-imports'],
    queryFn: () => apiClient.get<{ data: { id: string; fileName: string; sourceNote: string | null; totalRows: number; created: number; updated: number; rejected: number; createdAt: string }[] }>('/api/v1/finance-benchmark/imports'),
    enabled: isAdmin,
  });
  const importM = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file!);
      if (note.trim()) fd.append('sourceNote', note.trim());
      return apiClient.postForm<{ data: ImportResult }>('/api/v1/finance-benchmark/imports', fd);
    },
    onSuccess: (r) => {
      setResult(r.data);
      toast.success(tAttr('공시 손익을 가져왔습니다'));
      for (const k of ['fb-overview', 'fb-institutions', 'fb-trend', 'fb-imports']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : tAttr('가져오기 실패')),
  });

  const rows = inst?.rows ?? [];
  const cur = rows.find((r) => r.name === name) ?? null;
  // 고른 기관의 종별로 동급을 맞춘다(종별이 다르면 비교가 성립하지 않는다)
  const curType = cur?.hospitalType ?? ov?.type ?? null;
  const peersOfType = useMemo(() => rows.filter((r) => r.name !== name && (!curType || r.hospitalType === curType)), [rows, name, curType]);
  const peerStats = useMemo(() => {
    if (!ov?.peer) return null;
    // 서버 동급(종별·자기 제외)과 같은 규칙을 고른 기관 기준으로 다시 센다
    const out = {} as Record<FinanceRatio, PeerStat>;
    for (const k of FINANCE_RATIOS) out[k] = peerStat(peersOfType.map((r) => r.ratios[k]));
    return out;
  }, [peersOfType, ov?.peer]);
  // 지도·지역 목록은 고른 종별로 좁힌다(종별 자동이면 전체)
  const typeRows = type ? rows.filter((r) => r.hospitalType === type) : rows;
  const regionRows = typeRows.filter((r) => (!sido || r.sido === sido) && (!sigungu || r.sigungu === sigungu));

  // 핵심 지표(범위 = 고른 종별 · 없으면 전체)
  const withProfit = typeRows.filter((r) => r.medicalProfit != null);
  const marginMedian = peerStat(typeRows.map((r) => r.ratios.medicalProfitMargin));
  const curDev = cur && peerStats ? peerDeviation('medicalProfitMargin', cur.ratios.medicalProfitMargin, peerStats.medicalProfitMargin) : null;
  const pickerNames = useMemo(() => [...rows].sort((a, b) => a.name.localeCompare(b.name)).map((r) => ({ name: r.name, hint: [r.hospitalType, r.sigungu].filter(Boolean).join(' · '), self: r.self })), [rows]);
  const goAnalysis = (n: string) => { setPicked(n); setTab('analysis'); };

  if (ovQ.isError) return <QueryErrorFallback error={ovQ.error} onRetry={() => ovQ.refetch()} />;

  const peerTable = (
    <Card title={<Tf k="동급 분포 — {종별} {n}곳" params={{ 종별: curType ?? tAttr('전체 종별'), n: peerStats?.medicalProfitMargin.n ?? 0 }} />}
      subtitle={<T k="지표(분모: 의료수익)" />} bodyClassName="p-0">
      {!curType && (ov?.types ?? []).length > 1 && (
        <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-[11px] text-amber-800">
          <T k="종별이 섞인 분포입니다 — 요양·정신병원과 종합병원은 비용 구조가 달라 비교 기준으로 쓰지 마세요. 위 종별 개관이나 종별 선택으로 좁히세요." />
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50/80 text-[11px] text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium"><T k="지표(분모: 의료수익)" /></th>
              <th className="px-3 py-2 text-right font-medium">{cur ? <span title={cur.name}>{cur.name.length > 14 ? `${cur.name.slice(0, 14)}…` : cur.name}</span> : <T k="선택 기관" />}</th>
              <th className="px-3 py-2 text-right font-medium"><T k="동급 중앙값" /></th>
              <th className="px-3 py-2 text-right font-medium"><T k="편차" /></th>
              <th className="px-3 py-2 text-right font-medium"><T k="평균" /></th>
              <th className="px-4 py-2 text-right font-medium"><T k="사분위(25~75%)" /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {FINANCE_RATIOS.map((k) => {
              const ps = peerStats?.[k];
              const v = cur ? cur.ratios[k] : null;
              const dev = ps ? peerDeviation(k, v, ps) : { diff: null, worse: null };
              return (
                <tr key={k} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2 text-slate-700"><RatioLabel r={k} />{COST_RATIOS.includes(k) && <span className="ml-1 text-[10px] text-slate-400"><T k="(낮을수록 좋음)" /></span>}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{cur ? <P v={v} /> : '-'}</td>
                  <td className="px-3 py-2 text-right tabular-nums"><P v={ps?.median} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{k === 'inpatientShare' || k === 'researchShare' ? <span className="text-slate-300">-</span> : <Pp v={dev.diff} worse={dev.worse} />}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500"><P v={ps?.mean} /></td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500"><P v={ps?.p25} /> ~ <P v={ps?.p75} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );

  const regionList = (
    <Card title={<T k="지역 기관" />} subtitle={<Tf k="{n}곳 · 누르면 지도가 그 기관으로 옮겨 갑니다" params={{ n: regionRows.length }} />} bodyClassName="p-2">
      <ul className="max-h-[300px] space-y-0.5 overflow-y-auto pr-1 text-[12px]">
        {regionRows.slice(0, 120).map((r) => (
          <li key={r.name}>
            <button onClick={() => setPicked(r.name)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 ${r.name === name ? 'bg-indigo-50 ring-1 ring-indigo-100' : ''}`}>
              <span className="min-w-0 truncate">{r.self ? '★ ' : ''}{r.name} <span className="text-slate-400">{r.sigungu}</span></span>
              <span className={`shrink-0 tabular-nums ${r.medicalProfit == null ? 'text-slate-300' : r.medicalProfit >= 0 ? 'text-teal-700' : 'text-rose-600'}`}>{r.medicalProfit == null ? '-' : <Num value={eok(r.medicalProfit)} domain="moneyEok" />}</span>
            </button>
          </li>
        ))}
      </ul>
      {regionRows.length > 120 && <p className="px-2 pt-1 text-[10px] text-slate-400"><Tf k="앞 {n}곳만 보입니다 — 시도·시군구로 좁히세요" params={{ n: 120 }} /></p>}
    </Card>
  );

  return (
    <div className="space-y-5">
      {/* 머리 — 제목 · 회계연도 · 종별 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900"><T k="경영성과 벤치마크" /></h2>
          <p className="mt-1 text-sm text-slate-500"><T k="의료기관 회계정보공시 손익으로 동급 병원과 비교합니다 — 비교 기준은 중앙값입니다." /></p>
        </div>
        {ov?.available && (
          <div className="flex flex-wrap items-center gap-2">
            <select value={effYear ?? ''} onChange={(e) => setYear(Number(e.target.value))} className="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm" aria-label={tAttr('회계연도')}>
              {(ov.years ?? []).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} className="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm" aria-label={tAttr('종별')}>
              <option value="">{tAttr('종별 자동(우리 병원 기준)')}</option>
              {(ov.types ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
      </div>

      {ov && !ov.available && (
        <Card><p className="py-4 text-center text-sm text-slate-600"><T k="가져온 공시 손익이 없습니다 — 관리자가 아래에서 CSV 를 가져오면 비교가 시작됩니다." /></p></Card>
      )}

      {ov?.available && (<>
        {/* 핵심 지표 */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile label={<Tf k="공시 기관 ({연도})" params={{ 연도: effYear ?? '' }} />} value={typeRows.length.toLocaleString()} hint={type || tAttr('전체 종별')} onClick={() => setTab('overview')} />
          <KpiTile tone="indigo" label={<T k="의료이익률 중앙값" />} value={<P v={marginMedian.median} />} hint={<Tf k="n = {n}곳" params={{ n: marginMedian.n }} />} />
          <KpiTile tone="teal" label={<T k="흑자 기관(의료이익)" />} value={<Ratio numerator={withProfit.filter((r) => (r.medicalProfit as number) >= 0).length} denominator={withProfit.length} pctOnly />}
            hint={<Tf k="{k} / {n}곳" params={{ k: withProfit.filter((r) => (r.medicalProfit as number) >= 0).length, n: withProfit.length }} />} />
          <KpiTile tone={curDev?.worse ? 'rose' : 'slate'} label={cur ? <span title={cur.name}>{cur.name}</span> : <T k="선택 기관" />}
            value={cur ? <P v={cur.ratios.medicalProfitMargin} /> : <span className="text-[14px] font-medium text-slate-400"><T k="기관을 고르세요" /></span>}
            hint={cur && curDev?.diff != null ? <><T k="동급 중앙값 대비" /> <Pp v={curDev.diff} worse={curDev.worse} /></> : undefined}
            onClick={cur ? () => setTab('analysis') : undefined} />
        </div>

        {/* 탭 + 기관 찾기 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={tab} onChange={setTab} items={[
            { key: 'overview' as const, label: <T k="개관" /> },
            { key: 'map' as const, label: <T k="지역·지도" /> },
            { key: 'analysis' as const, label: <T k="기관 분석" /> },
            ...(isAdmin ? [{ key: 'import' as const, label: <T k="가져오기" /> }] : []),
          ]} />
          <InstitutionPicker names={pickerNames} value={name} onChange={(n) => setPicked(n)} />
        </div>

        {ov.self && ov.self.status !== 'FOUND' && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            {ov.self.status === 'NOT_SET'
              ? <T k="우리 병원이 지정되지 않아 동급 분포만 보입니다 — 시스템 설정 finance.benchmark.selfInstitution 에 공시 기관명을 넣으면 비교합니다. 아래 목록에서 다른 기관을 골라 볼 수도 있습니다." />
              : <Tf k="지정된 우리 병원「{이름}」이 이 연도 공시에 없습니다 — 기관명이 공시와 정확히 같은지 확인하세요." params={{ 이름: ov.self.name ?? '' }} />}
          </p>
        )}

        {/* ── 개관 ── */}
        {tab === 'overview' && (
          <div className="grid items-start gap-4">
            {rows.length > 0 && <TypeOverview rows={rows} active={type} onPick={(t) => { setType(t); setPicked(null); }} />}
            {peerTable}
            <ClinicDisclosureNote />
          </div>
        )}

        {/* ── 지역·지도 ── 지도(넓게) + 오른쪽: 고른 기관 요약 → 지역 기관 목록 */}
        {tab === 'map' && (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card title={<><T k="지역 내 병원 간 의료이익 비교" />{type && <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">{type}</span>}</>}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <select value={sido} onChange={(e) => { setSido(e.target.value); setSigungu(''); }} className="min-h-[34px] rounded-lg border border-slate-200 px-2 text-[12px]" aria-label={tAttr('시도')}>
                    <option value="">{tAttr('시도 전체')}</option>
                    {Object.keys(inst?.regions ?? {}).sort().map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select value={sigungu} onChange={(e) => setSigungu(e.target.value)} disabled={!sido} className="min-h-[34px] rounded-lg border border-slate-200 px-2 text-[12px]" aria-label={tAttr('시군구')}>
                    <option value="">{tAttr('시군구 전체')}</option>
                    {Object.keys(inst?.regions?.[sido] ?? {}).sort().map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[12px]" role="group" aria-label={tAttr('지도 보기')}>
                    {(['2d', '3d'] as const).map((m) => (
                      <button key={m} type="button" onClick={() => setMapMode(m)} disabled={m === '3d' && no3d}
                        className={`min-h-[30px] rounded-md px-3 font-medium ${mapMode === m ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'} disabled:opacity-40`}>
                        {m === '2d' ? <T k="2D 지도" /> : <T k="3D 지도" />}
                      </button>
                    ))}
                  </div>
                </div>
              }>
              {no3d && <p className="mb-2 text-[11px] text-amber-700"><T k="이 기기에서는 3D(WebGL)를 만들 수 없어 2D 지도로 보여 줍니다." /></p>}
              {instQ.isError ? <QueryErrorFallback error={instQ.error} onRetry={() => instQ.refetch()} size="compact" />
                : mapMode === '3d' && !no3d ? (<>
                  <KoreaMap3D points={typeRows} sido={sido} selected={name} onPick={setPicked} onUnavailable={() => { setNo3d(true); setMapMode('2d'); }} />
                  <div className="mt-2"><MapLegend /></div>
                </>) : <KoreaBubbleMap points={typeRows} sido={sido} sigungu={sigungu} selected={name} onPick={setPicked}
                  onPickSido={(s) => { setSido(Object.keys(inst?.regions ?? {}).find((k) => normalizeSido(k) === s) ?? s); setSigungu(''); }}
                  onPickSigungu={setSigungu} />}
            </Card>
            <div className="space-y-4">
              {cur ? (<>
                <InstitutionSummary cur={cur} peers={peersOfType} />
                <button type="button" onClick={() => setTab('analysis')}
                  className="min-h-[44px] w-full rounded-xl bg-indigo-600 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">
                  <T k="이 기관 상세 분석 보기" /> →
                </button>
              </>) : <TopBottomList rows={regionRows.filter((r) => !curType || r.hospitalType === curType)} onPick={setPicked} />}
              {regionList}
            </div>
          </div>
        )}

        {/* ── 기관 분석 ── */}
        {tab === 'analysis' && (!cur ? (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Card><div className="py-6 text-center">
              <p className="text-sm font-medium text-slate-700"><T k="분석할 기관을 고르세요" /></p>
              <p className="mt-1 text-[12px] text-slate-500"><T k="위의 「기관 이름으로 찾기」나 오른쪽 상위·하위 목록, 지역·지도 탭에서 고를 수 있습니다." /></p>
            </div></Card>
            <TopBottomList rows={typeRows} onPick={goAnalysis} />
          </div>
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <div className="space-y-4">
              <InstitutionSummary cur={cur} peers={peersOfType} />
              <Card title={<T k="의료수익경상이익률 — 동급 대비 위치" />} subtitle={<T k="경상이익(법인세차감전순이익) ÷ 의료수익 — 연구·기부 등 의료외 손익이 반영됩니다." />}>
                {peerStats ? (<>
                  <RangeBar peer={peerStats.ordinaryMargin} v={cur.ratios.ordinaryMargin} />
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
                    <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-indigo-600 align-middle" /><T k="선택 기관" /> <P v={cur.ratios.ordinaryMargin} /></span>
                    <span><span className="mr-1 inline-block h-3 w-0.5 bg-slate-700 align-middle" /><T k="중앙값" /> <P v={peerStats.ordinaryMargin.median} /></span>
                    <span><span className="mr-1 inline-block h-3 w-0.5 bg-amber-500 align-middle" /><T k="평균" /> <P v={peerStats.ordinaryMargin.mean} /></span>
                    <span><span className="mr-1 inline-block h-2 w-4 rounded bg-slate-300 align-middle" /><T k="사분위(25~75%)" /></span>
                  </div>
                </>) : <p className="text-[12px] text-slate-500"><T k="불러오는 중…" /></p>}
              </Card>
              <Card title={<T k="의료수익 대비 비용 — 동급 중앙값과 편차" />} subtitle={<T k="동급보다 높은 비용은 붉게 표시합니다(개선 검토 대상 · 판정 아님)." />}>
                {peerStats ? (
                  <div className="space-y-3">
                    {COST_RATIOS.map((k) => {
                      const v = cur.ratios[k], m = peerStats[k].median;
                      const dev = peerDeviation(k, v, peerStats[k]);
                      const maxV = Math.max(v ?? 0, m ?? 0, 0.01);
                      return (
                        <div key={k}>
                          <div className="mb-1 flex items-center justify-between text-[12px]"><RatioLabel r={k} /><Pp v={dev.diff} worse={dev.worse} /></div>
                          <div className="relative h-2.5 rounded-full bg-slate-100">
                            <div className={`h-2.5 rounded-full ${dev.worse ? 'bg-rose-500' : 'bg-indigo-500'}`} style={{ width: `${((v ?? 0) / maxV) * 100}%` }} />
                            {m != null && <span className="absolute -top-1 w-0.5 rounded bg-slate-600" style={{ left: `${(m / maxV) * 100}%`, height: 18 }} title="median" />}
                          </div>
                          <div className="mt-0.5 flex justify-between text-[10px] text-slate-500"><span><T k="선택 기관" /> <P v={v} /></span><span><T k="동급 중앙값" /> <P v={m} /></span></div>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="text-[12px] text-slate-500"><T k="불러오는 중…" /></p>}
              </Card>
              <Card title={<T k="연도별 의료이익률 추이" />} subtitle={<T k="선 색 = 흑자/적자 · 두께 = 크기 · 점선 = 같은 종별 중앙값" />}>
                {trendQ.isError ? <QueryErrorFallback error={trendQ.error} onRetry={() => trendQ.refetch()} size="compact" />
                  : trendQ.data ? (<>
                    <TrendChart rows={trendQ.data.data.rows} k="medicalProfitMargin" />
                    {trendQ.data.data.linkedBy === 'CODE' && trendQ.data.data.names.length > 1 && (
                      <p className="mt-1 text-[11px] text-slate-500"><Tf k="연도마다 공시 이름이 달라 기관 코드로 이었습니다({n}가지 표기)" params={{ n: trendQ.data.data.names.length }} /></p>
                    )}
                    {trendQ.data.data.linkedBy === 'NAME' && (
                      <p className="mt-1 text-[11px] text-amber-700"><T k="기관 코드가 없는 자료라 이름으로 이었습니다 — 이름 표기가 다른 해는 빠졌을 수 있습니다." /></p>
                    )}
                  </>)
                  : <p className="text-[12px] text-slate-500"><T k="불러오는 중…" /></p>}
              </Card>
            </div>
            <div className="space-y-4">
              <ProfitDrilldown cur={cur} year={effYear} />
              <RevenueMixDrill cur={cur} peers={peersOfType} year={effYear} />
            </div>
            <div className="xl:col-span-2">{peerTable}</div>
          </div>
        ))}
      </>)}

      {/* ── 가져오기(관리자) ── */}
      {isAdmin && (tab === 'import' || (ov && !ov.available)) && (
        <Card title={<T k="공시 손익 가져오기(관리자)" />}
          subtitle={<T k="CSV(UTF-8) · 머리행은 공시 열 이름(연도·기관명·종별·주소·Ⅰ.의료수익·Ⅱ-1.인건비 …). 엑셀은 'CSV UTF-8' 로 저장하세요. 항등식(의료수익−의료비용=의료이익 등)이 맞지 않는 행은 들이지 않고 사유를 보여줍니다. 같은 기관·연도는 덮어씁니다." />}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[12px]" />
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={tAttr('출처 메모(예: HASPA 2021 회계연도 · 내려받은 날짜)')}
                className="min-h-[40px] min-w-[280px] flex-1 rounded-xl border border-slate-200 px-3 text-[12px]" />
              <button disabled={!file || importM.isPending} onClick={() => importM.mutate()} className="min-h-[44px] rounded-xl bg-indigo-600 px-4 text-[12px] font-medium text-white disabled:opacity-40">
                <T k="가져오기" />
              </button>
            </div>
            {result && (
              <div className="rounded-xl border bg-slate-50 p-2 text-[12px]">
                <Tf k="{전체}행 중 새로 {생성} · 갱신 {갱신} · 거절 {거절}" params={{ 전체: result.totalRows, 생성: result.created, 갱신: result.updated, 거절: result.rejected }} />
                {result.rejects.length > 0 && (
                  <ul className="mt-1 max-h-40 overflow-y-auto text-[11px] text-rose-700">
                    {result.rejects.map((r) => <li key={`${r.line}-${r.name}`}><Tf k="{줄}행 {기관} — {사유}" params={{ 줄: r.line, 기관: r.name ?? '-', 사유: `${r.reason}${r.detail ? ` (${r.detail})` : ''}` }} /></li>)}
                  </ul>
                )}
              </div>
            )}
            {(importsQ.data?.data ?? []).length > 0 && (
              <table className="w-full text-[11px]">
                <thead className="text-slate-500"><tr><th className="py-1 text-left"><T k="시각" /></th><th className="text-left"><T k="파일" /></th><th className="text-left"><T k="출처 메모" /></th><th className="text-right"><T k="새로/갱신/거절" /></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {(importsQ.data?.data ?? []).map((i) => (
                    <tr key={i.id}><td className="py-1"><KDate value={i.createdAt} mode="datetimeShort" /></td><td>{i.fileName}</td><td className="text-slate-500">{i.sourceNote ?? '-'}</td><td className="text-right tabular-nums">{i.created}/{i.updated}/{i.rejected}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      {/* 출처 — 맨 아래 한 줄 */}
      <p className="border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400">
        <T k="자료: 한국보건산업진흥원 의료기관 회계정보공시(손익계산서 상위 계정) · 분석 틀: 외부 공개 프로젝트「국내 (상급)종합병원 경영성과 대시보드」 · 우리 병원 손익은 HIS 에 없어 공시 기관 지정으로만 비교합니다." />
        {ov?.lastImport && <> · <Tf k="마지막 가져오기 {시각} ({파일})" params={{ 시각: <KDate value={ov.lastImport.createdAt} mode="datetimeShort" />, 파일: ov.lastImport.fileName }} /></>}
      </p>
    </div>
  );
}
