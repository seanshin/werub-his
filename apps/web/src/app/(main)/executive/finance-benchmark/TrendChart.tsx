'use client';

import type { FinanceRatio } from '@hospital-run/shared';
import { Ratio } from '@/components/ui/display';
import { useTAttr } from '@/components/ui/i18n-text';

export interface TrendRow {
  year: number; hospitalType: string | null; institutionName?: string;
  ratios: Record<FinanceRatio, number | null>;
  peerMedian: { medicalProfitMargin: number | null; ordinaryMargin: number | null }; peerN: number;
}

/**
 * ③ 추이 — 원 대시보드처럼 0 기준 색·절댓값 두께 · 동급 중앙값 점선.
 * 🔴 가로축은 **연도** — 공시가 없는 해는 선을 끊고 "공시 없음"으로 표시한다(종전: 점을 순서대로 이어 2021→2023 이 한 칸처럼 보였다).
 */
export function TrendChart({ rows, k }: { rows: TrendRow[]; k: 'medicalProfitMargin' | 'ordinaryMargin' }) {
  const tAttr = useTAttr();
  const pts = rows.map((r) => ({ year: r.year, v: r.ratios[k], m: r.peerMedian[k] }));
  const vals = pts.flatMap((p) => [p.v, p.m]).filter((x): x is number => x != null);
  if (vals.length === 0) return <p className="text-[12px] text-gray-400"><Ratio numerator={null} denominator={null} pctOnly /></p>;
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const y0 = Math.min(...pts.map((p) => p.year)), y1 = Math.max(...pts.map((p) => p.year));
  const missing = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i).filter((y) => !pts.some((p) => p.year === y));
  const W = 520, H = 200, L = 44, R = 16, TOP = 16, B = 28;
  const x = (year: number) => L + (y1 === y0 ? (W - L - R) / 2 : ((year - y0) * (W - L - R)) / (y1 - y0));
  const y = (v: number) => TOP + ((hi - v) / Math.max(1e-9, hi - lo)) * (H - TOP - B);
  const adjacent = (i: number) => pts[i].year - pts[i - 1].year === 1; // 이웃한 해만 잇는다
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="trend">
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#94a3b8" strokeDasharray="3 3" />
      {missing.map((yr) => (
        <g key={`gap${yr}`} data-missing-year={yr}>
          <rect x={x(yr) - 14} y={TOP} width={28} height={H - TOP - B} fill="#f1f5f9" />
          <text x={x(yr)} y={TOP + 12} textAnchor="middle" fontSize={9} fill="#94a3b8">{tAttr('공시 없음')}</text>
          <text x={x(yr)} y={H - 8} textAnchor="middle" fontSize={11} fill="#cbd5e1">{yr}</text>
        </g>
      ))}
      {pts.map((p, i) => i > 0 && adjacent(i) && p.m != null && pts[i - 1].m != null && (
        <line key={`m${i}`} x1={x(pts[i - 1].year)} x2={x(p.year)} y1={y(pts[i - 1].m as number)} y2={y(p.m)} stroke="#64748b" strokeDasharray="6 4" strokeWidth={1.5} />
      ))}
      {pts.map((p, i) => i > 0 && adjacent(i) && p.v != null && pts[i - 1].v != null && (
        <line key={`v${i}`} x1={x(pts[i - 1].year)} x2={x(p.year)} y1={y(pts[i - 1].v as number)} y2={y(p.v)}
          stroke={(p.v as number) >= 0 ? '#0d9488' : '#e11d48'} strokeWidth={2 + Math.min(6, Math.abs(p.v as number) * 40)} strokeLinecap="round" />
      ))}
      {pts.map((p) => (
        <g key={p.year}>
          {p.v != null && <circle cx={x(p.year)} cy={y(p.v)} r={5} fill={p.v >= 0 ? '#0d9488' : '#e11d48'} stroke="#fff" strokeWidth={2} />}
          <text x={x(p.year)} y={H - 8} textAnchor="middle" fontSize={11} fill="#475569">{p.year}</text>
        </g>
      ))}
    </svg>
  );
}

