'use client';

/**
 * 병원 표식(SVG) — 종별 모양 · 이익률 색 · 규모 크기(부호화 정본 `finance-map.ts`).
 * 좌표는 (0,0) 중심 · 반지름 r 기준으로 그린다(부모가 translate).
 */
import { HOSPITAL_TYPES, formatNum } from '@hospital-run/shared';
import { Ratio } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';
import { MARGIN_BINS, MARGIN_NA_COLOR, markerShape, type MarkerShape } from './finance-map';

/** 모양 외곽(단위 반지름 1) — 종별마다 한눈에 갈리게 */
export function shapePath(shape: MarkerShape, r: number): string {
  const s = (v: number) => v * r;
  switch (shape) {
    case 'tertiary': { // 육각 방패
      const pts = Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i - Math.PI / 2; return [Math.cos(a) * r * 1.08, Math.sin(a) * r * 1.08]; });
      return `M${pts.map((p) => p.join(',')).join('L')}Z`;
    }
    case 'general': { // 모서리 둥근 사각
      const a = s(0.88), q = s(0.28);
      return `M${-a + q},${-a}H${a - q}Q${a},${-a} ${a},${-a + q}V${a - q}Q${a},${a} ${a - q},${a}H${-a + q}Q${-a},${a} ${-a},${a - q}V${-a + q}Q${-a},${-a} ${-a + q},${-a}Z`;
    }
    case 'longterm': // 집(박공)
      return `M0,${s(-1.05)}L${s(1)},${s(-0.15)}V${s(0.9)}H${s(-1)}V${s(-0.15)}Z`;
    case 'psych': // 둥근 마름모
      return `M0,${s(-1.1)}Q${s(0.12)},${s(-1.1)} ${s(1.02)},${s(-0.08)}Q${s(1.1)},0 ${s(1.02)},${s(0.08)}Q${s(0.12)},${s(1.1)} 0,${s(1.1)}Q${s(-0.12)},${s(1.1)} ${s(-1.02)},${s(0.08)}Q${s(-1.1)},0 ${s(-1.02)},${s(-0.08)}Q${s(-0.12)},${s(-1.1)} 0,${s(-1.1)}Z`;
    default: // 원(병원·한방·그 밖)
      return `M${-r},0A${r},${r} 0 1,0 ${r},0A${r},${r} 0 1,0 ${-r},0Z`;
  }
}

/** 안쪽 기호 — 십자(병원 계열) · 잎(한방) · 하트(요양) · 점(정신) */
function glyph(shape: MarkerShape, r: number) {
  const w = Math.max(0.9, r * 0.22), l = r * 0.52;
  if (shape === 'kmed') return <path d={`M0,${l}C${-l},${l * 0.2} ${-l * 0.4},${-l} 0,${-l}C${l * 0.4},${-l} ${l},${l * 0.2} 0,${l}Z`} fill="#fff" fillOpacity={0.92} />;
  if (shape === 'longterm') return <path d={`M0,${r * 0.62}L${-r * 0.42},${r * 0.2}A${r * 0.21},${r * 0.21} 0 0,1 0,${-r * 0.05}A${r * 0.21},${r * 0.21} 0 0,1 ${r * 0.42},${r * 0.2}Z`} fill="#fff" fillOpacity={0.92} />;
  if (shape === 'psych') return <circle r={r * 0.3} fill="#fff" fillOpacity={0.92} />;
  if (shape === 'other') return null;
  return <path d={`M${-w / 2},${-l}H${w / 2}V${-w / 2}H${l}V${w / 2}H${w / 2}V${l}H${-w / 2}V${w / 2}H${-l}V${-w / 2}H${-w / 2}Z`} fill="#fff" fillOpacity={0.95} />;
}

export function HospitalMarker({ shape, r, color, approx, selected }: { shape: MarkerShape; r: number; color: string; approx: boolean; selected: boolean }) {
  return (
    <>
      {selected && <circle r={r * 1.55 + 3} fill="none" stroke="#4f46e5" strokeWidth={2.5} strokeOpacity={0.9} />}
      <path d={shapePath(shape, r)} fill={color} fillOpacity={approx ? 0.72 : 0.95}
        stroke={approx ? '#334155' : '#ffffff'} strokeWidth={approx ? 1.1 : 1.4} strokeDasharray={approx ? '2.5 2' : undefined}
        style={{ filter: 'drop-shadow(0 1px 1.5px rgba(15,23,42,0.35))' }} />
      {r >= 4.5 && glyph(shape, r)}
    </>
  );
}

/** 이익률 칩 글자(부호 포함) — 산출 불가는 '-' */
export function marginText(margin: number | null | undefined): string {
  if (margin == null || !Number.isFinite(margin)) return '-';
  return `${margin > 0 ? '+' : ''}${formatNum(margin * 100, 'percent')}`;
}

// 종별 이름은 공시 데이터 값(HASPA 표기) — 정본 목록에서 가져온다(화면이 따로 적지 않는다)
const SHAPE_ROWS = HOSPITAL_TYPES.map((t) => ({ shape: markerShape(t), label: t as string }));
const BIN_LABEL: Record<(typeof MARGIN_BINS)[number]['key'], string> = { m10: '≤−10%', m3: '−10~−3%', m0: '−3~0%', p3: '0~3%', p10: '3~10%', 'p10+': '≥10%' };

/** 범례 — 모양=종별 · 색=의료이익률 · 크기=의료수익 · 점선=위치 근사 · 묶음 */
export function MapLegend() {
  return (
    <div className="flex flex-wrap items-start gap-x-5 gap-y-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-[11px] text-slate-600">
      <div>
        <p className="mb-1 font-semibold text-slate-700"><T k="모양 = 종별" /></p>
        <div className="flex flex-wrap gap-x-2.5 gap-y-1">
          {SHAPE_ROWS.map((s) => (
            <span key={s.shape} className="inline-flex items-center gap-1">
              <svg width={18} height={18} viewBox="-9 -9 18 18" aria-hidden><HospitalMarker shape={s.shape} r={6.5} color="#64748b" approx={false} selected={false} /></svg>
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 font-semibold text-slate-700"><T k="색 = 의료이익률" /></p>
        <div className="flex items-center gap-0.5">
          {MARGIN_BINS.map((b) => (
            <span key={b.key} className="flex flex-col items-center">
              <span className="h-2.5 w-9 first:rounded-l last:rounded-r" style={{ background: b.color }} />
              <span className="mt-0.5 text-[9.5px] text-slate-500">{BIN_LABEL[b.key]}</span>
            </span>
          ))}
          <span className="ml-1.5 flex flex-col items-center">
            <span className="h-2.5 w-9 rounded" style={{ background: MARGIN_NA_COLOR }} />
            <span className="mt-0.5 text-[9.5px] text-slate-500"><Ratio numerator={null} denominator={null} pctOnly /></span>
          </span>
        </div>
      </div>
      <div className="space-y-0.5">
        <p className="font-semibold text-slate-700"><T k="크기 = 의료수익(규모)" /></p>
        <p className="inline-flex items-center gap-1"><svg width={16} height={16} viewBox="-8 -8 16 16" aria-hidden><HospitalMarker shape="hospital" r={5.5} color="#94a3b8" approx selected={false} /></svg><T k="점선 = 위치 근사(주소 읍면동·시군구 안의 점)" /></p>
        <p className="inline-flex items-center gap-1"><span className="inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-teal-500 bg-white text-[8px] font-bold text-slate-700">n</span><T k="묶음 = n곳 · 테두리 = 흑자 비율(확대하면 풀림)" /></p>
      </div>
    </div>
  );
}
