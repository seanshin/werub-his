'use client';

/**
 * 층 평면도(2D 정본) — 확정 도면 기하(`GET /api/v1/space/geometry`)를 그린다. 기획 spatial-flow-vision-3d P2.
 *
 * 🔴 정직 표기:
 *   - 합성 도면이면 워터마크를 지우지 않는다(`notice` — 한가운데 옅은 글자 + 모서리 띠).
 *   - 환자: 관측(QR·스테이션) = 채운 점 · 추정(이벤트 번역) = 빈 점선 점 — 같은 모양으로 그리지 않는다. 추정은 끌 수 있다.
 *   - 혼잡도: 정원 미설정 = 회색 빗금(초록=여유로 그리지 않는다). 혼잡도는 범주 색 **위에 덧칠**한다(방 종류를 지우지 않는다).
 *   - 좌표를 모르는 것(구역 미상·배치 안 된 자산)은 그리지 않는다 — 수는 부모 화면이 따로 말한다.
 *
 * 표현(2026-09-28 재구성): 공간 종류 38개를 범주 8개로 묶어 색을 준다(`spaceCategoryOf`) · 벽은 굵기로 층위를 준다
 * (외벽 > 방 벽 > 열린 공간 경계) · 방 이름은 흰 테두리 글자로 두 줄까지 · 수직 코어는 빗금과 기호.
 */
import type { ReactNode } from 'react';

export interface GeoSpace {
  id: string;
  name: string;
  number: string | null;
  type: string;
  rect: { x: number; y: number; w: number; h: number };
  open: boolean;
  restricted: boolean;
  verticalCore: string | null;
  spaceNodeId: string | null;
}
export interface GeoFloor {
  key: string;
  level: number;
  title: string;
  footprint: { x: number; y: number; w: number; h: number };
  spaceNodeId: string | null;
  spaces: GeoSpace[];
  connections: { id: string; kind: string; at: [number, number]; widthM: number; restricted: boolean }[];
}
export type HeatLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';

/** 공간 범주 — 범례(부모 화면)와 같은 키 */
export type SpaceCategory = 'CLINIC' | 'WAIT' | 'DIAG' | 'ACUTE' | 'WARD' | 'STAFF' | 'SUPPORT' | 'CORE' | 'TOILET' | 'CIRCULATION';

const CATEGORY_OF: Record<string, SpaceCategory> = {
  CLINIC: 'CLINIC', CONSULT: 'CLINIC', EXAM: 'CLINIC', TREATMENT: 'CLINIC', EKG: 'CLINIC', TRIAGE: 'CLINIC', THERAPY: 'CLINIC',
  WAITING: 'WAIT', LOBBY: 'WAIT', HALL: 'WAIT', LOUNGE: 'WAIT', RECEPTION: 'WAIT', CASHIER: 'WAIT', AMENITY: 'WAIT',
  LAB: 'DIAG', IMAGING: 'DIAG', ENDOSCOPY: 'DIAG',
  ER: 'ACUTE', ICU: 'ACUTE', SURGERY: 'ACUTE', RECOVERY: 'ACUTE', DELIVERY: 'ACUTE', ISOLATION: 'ACUTE', ANTEROOM: 'ACUTE',
  WARD_ROOM: 'WARD', NURSERY: 'WARD',
  NURSE_STATION: 'STAFF', NURSE_ROOM: 'STAFF', STAFF: 'STAFF', LOCKER: 'STAFF', PHARMACY: 'STAFF',
  SUPPORT: 'SUPPORT', PLANT: 'SUPPORT', SHAFT: 'SUPPORT',
  ELEVATOR: 'CORE', STAIR: 'CORE', ESCALATOR: 'CORE',
  TOILET: 'TOILET',
  CORRIDOR: 'CIRCULATION',
};
export function spaceCategoryOf(type: string): SpaceCategory {
  return CATEGORY_OF[type] ?? 'SUPPORT';
}

/** 범주 색 — 채움·방 벽 · 범례도 이 값을 쓴다 */
export const SPACE_CATEGORY_STYLE: Record<SpaceCategory, { fill: string; edge: string }> = {
  CLINIC: { fill: '#d5f0e8', edge: '#0f766e' },
  WAIT: { fill: '#fbefd5', edge: '#b45309' },
  DIAG: { fill: '#e6e0fb', edge: '#6d28d9' },
  ACUTE: { fill: '#fde0e3', edge: '#be123c' },
  WARD: { fill: '#dbeafe', edge: '#1d4ed8' },
  STAFF: { fill: '#e0e7ff', edge: '#4338ca' },
  SUPPORT: { fill: '#eceae6', edge: '#57534e' },
  CORE: { fill: '#cbd5e1', edge: '#334155' },
  TOILET: { fill: '#dff3f8', edge: '#0e7490' },
  CIRCULATION: { fill: '#f7f5f0', edge: '#a8a29e' },
};

const HEAT_FILL: Record<HeatLevel, string> = {
  LOW: '#22c55e', MEDIUM: '#eab308', HIGH: '#f97316', CRITICAL: '#ef4444', UNKNOWN: 'url(#fp-heat-unknown)',
};

/** 방 이름 배치 — 폭에 맞춰 한 줄 또는 두 줄 · 너무 작으면 그리지 않는다(마우스를 올리면 이름이 뜬다) */
function labelLayout(name: string, w: number, h: number): { lines: string[]; size: number } | null {
  const fit = (s: string) => (w * 0.84) / Math.max(2, s.length);
  const one = Math.min(1.05, fit(name), h * 0.34);
  if (one >= 0.62 || name.length <= 5) return one >= 0.42 ? { lines: [name], size: one } : null;
  // 두 줄 — 공백·가운뎃점 근처에서, 없으면 가운데에서 자른다
  const mid = Math.floor(name.length / 2);
  const seps = [...name].map((c, i) => (c === ' ' || c === '·' || c === '/' ? i : -1)).filter((i) => i > 0);
  const cut = seps.length ? seps.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a)) : mid;
  const a = name.slice(0, cut).trim();
  const b = name.slice(cut).replace(/^[\s·/]/, '').trim();
  const two = Math.min(1.0, fit(a.length > b.length ? a : b), h * 0.24);
  if (two > one && two >= 0.42) return { lines: [a, b], size: two };
  return one >= 0.42 ? { lines: [name], size: one } : null;
}

/** 수직 코어 기호(엘리베이터: 위아래 삼각형 · 계단: 계단선) — 층 좌표계(m) */
function CoreGlyph({ s }: { s: GeoSpace }) {
  const cx = s.rect.x + s.rect.w / 2, cy = s.rect.y + s.rect.h / 2;
  const k = Math.min(s.rect.w, s.rect.h) * 0.22;
  if (s.type === 'ELEVATOR') {
    return (
      <g fill="#334155" opacity={0.8} style={{ pointerEvents: 'none' }}>
        <path d={`M ${cx} ${cy - k * 1.1} l ${k * 0.7} ${k * 0.8} h ${-k * 1.4} z`} />
        <path d={`M ${cx} ${cy + k * 1.1} l ${k * 0.7} ${-k * 0.8} h ${-k * 1.4} z`} />
      </g>
    );
  }
  if (s.type === 'STAIR' || s.type === 'ESCALATOR') {
    const st = k * 0.55;
    const x0 = cx - st * 2, y0 = cy + st * 2;
    return (
      <path d={`M ${x0} ${y0} h ${st} v ${-st} h ${st} v ${-st} h ${st} v ${-st} h ${st}`} fill="none" stroke="#334155"
        strokeWidth={0.14} strokeLinejoin="round" opacity={0.8} style={{ pointerEvents: 'none' }} />
    );
  }
  return null;
}

export function FloorPlanSvg({
  floor,
  frame,
  notice,
  labels = true,
  patients,
  showInferred = false,
  heat,
  assets,
  highlight,
  route,
  onSelect,
  focus,
  children,
}: {
  floor: GeoFloor;
  /** 여러 층을 같은 축척·원점으로 그릴 때(3D 적층) 쓰는 공통 틀 — 없으면 이 층 외곽 */
  frame?: { w: number; h: number };
  notice?: string | null;
  labels?: boolean;
  /** spaceNodeId → 관측·추정 인원 */
  patients?: Map<string, { observed: number; inferred: number }>;
  showInferred?: boolean;
  heat?: Map<string, HeatLevel>;
  /** spaceNodeId → 배치된 자산 수 */
  assets?: Map<string, number>;
  highlight?: Set<string>;
  /** 층 좌표계(m) 경로 점 — P3 길안내 */
  route?: [number, number][];
  onSelect?: (s: GeoSpace) => void;
  /** 이 영역(m)만 확대해 그린다 — 휴대폰 대기표에서 경로 주변만 */
  focus?: { x: number; y: number; w: number; h: number };
  children?: ReactNode;
}) {
  const W = frame?.w ?? floor.footprint.x + floor.footprint.w;
  const H = frame?.h ?? floor.footprint.y + floor.footprint.h;
  const fp = floor.footprint;
  // 한 페이지에 평면도가 여러 개(3D 적층)여도 defs id 가 섞이지 않게 층 키로 가른다
  const uid = `fp-${floor.key}`;
  const rooms = floor.spaces.filter((s) => s.type !== 'CORRIDOR');
  const corridors = floor.spaces.filter((s) => s.type === 'CORRIDOR');

  return (
    <svg viewBox={focus ? `${focus.x} ${focus.y} ${focus.w} ${focus.h}` : `-2 -2 ${W + 4} ${H + 4}`} className="h-auto w-full select-none"
      role="img" aria-label={floor.title} style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif' }}>
      <defs>
        <pattern id="fp-heat-unknown" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="1.2" height="1.2" fill="#e5e7eb" />
          <line x1="0" y1="0" x2="0" y2="1.2" stroke="#9ca3af" strokeWidth="0.35" />
        </pattern>
        <pattern id={`${uid}-core`} width="0.8" height="0.8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="0.8" height="0.8" fill={SPACE_CATEGORY_STYLE.CORE.fill} />
          <line x1="0" y1="0" x2="0" y2="0.8" stroke="#94a3b8" strokeWidth="0.12" />
        </pattern>
        <pattern id={`${uid}-restricted`} width="1" height="1" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="1" stroke="#e11d48" strokeWidth="0.07" opacity="0.45" />
        </pattern>
        <filter id={`${uid}-slab`} x="-5%" y="-5%" width="110%" height="115%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.7" floodColor="#0f172a" floodOpacity="0.22" />
        </filter>
        <marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#e11d48" />
        </marker>
      </defs>

      {/* 층 바닥판 */}
      <rect x={fp.x} y={fp.y} width={fp.w} height={fp.h} rx={0.35} fill="#fbfaf7" filter={`url(#${uid}-slab)`} />

      {/* 복도 — 바닥 톤 */}
      {corridors.map((s) => (
        <rect key={s.id} x={s.rect.x} y={s.rect.y} width={s.rect.w} height={s.rect.h} fill={SPACE_CATEGORY_STYLE.CIRCULATION.fill} />
      ))}

      {/* 방 채움 + 혼잡도 덧칠 */}
      {rooms.map((s) => {
        const cat = spaceCategoryOf(s.type);
        const h = s.spaceNodeId ? heat?.get(s.spaceNodeId) : undefined;
        const fill = cat === 'CORE' ? `url(#${uid}-core)` : SPACE_CATEGORY_STYLE[cat].fill;
        return (
          <g key={s.id} onClick={onSelect ? () => onSelect(s) : undefined} style={onSelect ? { cursor: 'pointer' } : undefined}
            className={onSelect ? 'transition-opacity hover:opacity-80' : undefined}>
            <title>{s.name}</title>
            <rect x={s.rect.x} y={s.rect.y} width={s.rect.w} height={s.rect.h} fill={fill} />
            {h && <rect x={s.rect.x} y={s.rect.y} width={s.rect.w} height={s.rect.h} fill={HEAT_FILL[h]} opacity={h === 'UNKNOWN' ? 0.85 : 0.5} />}
            {s.restricted && <rect x={s.rect.x} y={s.rect.y} width={s.rect.w} height={s.rect.h} fill={`url(#${uid}-restricted)`} />}
          </g>
        );
      })}

      {/* 벽 — 방 벽(닫힌 방) · 열린 공간은 점선 경계 */}
      {rooms.map((s) => (
        <rect key={`w-${s.id}`} x={s.rect.x} y={s.rect.y} width={s.rect.w} height={s.rect.h} fill="none"
          stroke={s.open ? '#a8a29e' : '#3f3f46'} strokeWidth={s.open ? 0.07 : 0.14}
          strokeDasharray={s.open ? '0.45 0.35' : undefined} style={{ pointerEvents: 'none' }} />
      ))}
      {/* 외벽 */}
      <rect x={fp.x} y={fp.y} width={fp.w} height={fp.h} rx={0.35} fill="none" stroke="#1e293b" strokeWidth={0.42} style={{ pointerEvents: 'none' }} />

      {/* 선택 강조 */}
      {rooms.filter((s) => s.spaceNodeId && highlight?.has(s.spaceNodeId)).map((s) => (
        <rect key={`hl-${s.id}`} x={s.rect.x} y={s.rect.y} width={s.rect.w} height={s.rect.h} fill="#6366f1" fillOpacity={0.12}
          stroke="#4f46e5" strokeWidth={0.4} style={{ pointerEvents: 'none' }} />
      ))}

      {/* 문·출입구 — 외부 출입구는 초록 · 통제 문은 빨강 */}
      {floor.connections.filter((c) => c.kind !== 'OPENING').map((c) => (
        <circle key={c.id} cx={c.at[0]} cy={c.at[1]} r={c.kind === 'EXTERIOR' ? 0.42 : 0.2}
          fill={c.kind === 'EXTERIOR' ? '#16a34a' : c.restricted ? '#e11d48' : '#ffffff'}
          stroke={c.kind === 'EXTERIOR' ? '#ffffff' : c.restricted ? '#ffffff' : '#52525b'} strokeWidth={c.kind === 'EXTERIOR' ? 0.12 : 0.07}
          style={{ pointerEvents: 'none' }} />
      ))}

      {/* 수직 코어 기호 */}
      {rooms.filter((s) => spaceCategoryOf(s.type) === 'CORE').map((s) => <CoreGlyph key={`g-${s.id}`} s={s} />)}

      {/* 방 이름 — 흰 테두리 글자(무늬·혼잡도 위에서도 읽히게) */}
      {labels && rooms.map((s) => {
        if (spaceCategoryOf(s.type) === 'CORE' && s.rect.w * s.rect.h < 30) return null;
        const L = labelLayout(s.name, s.rect.w, s.rect.h);
        if (!L) return null;
        const cx = s.rect.x + s.rect.w / 2, cy = s.rect.y + s.rect.h / 2;
        const lh = L.size * 1.15;
        const y0 = cy - ((L.lines.length - 1) * lh) / 2;
        return (
          <text key={`t-${s.id}`} x={cx} y={y0} textAnchor="middle" dominantBaseline="middle" fontSize={L.size} fontWeight={600}
            fill="#1f2937" stroke="#ffffff" strokeWidth={L.size * 0.22} strokeLinejoin="round" paintOrder="stroke" style={{ pointerEvents: 'none' }}>
            {L.lines.map((ln, i) => <tspan key={i} x={cx} dy={i === 0 ? 0 : lh}>{ln}</tspan>)}
          </text>
        );
      })}

      {/* 환자 — 관측=채운 점 · 추정=빈 점선 점 */}
      {patients && rooms.map((s) => {
        const p = s.spaceNodeId ? patients.get(s.spaceNodeId) : undefined;
        if (!p) return null;
        const r = Math.min(0.85, s.rect.w * 0.16);
        const cx = s.rect.x + r + 0.3, cy = s.rect.y + r + 0.3;
        return (
          <g key={`p-${s.id}`} style={{ pointerEvents: 'none' }}>
            {p.observed > 0 && (<>
              <circle cx={cx} cy={cy} r={r} fill="#2563eb" stroke="#ffffff" strokeWidth={0.16} />
              <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={r * 1.05} fontWeight={700} fill="#fff">{p.observed}</text>
            </>)}
            {showInferred && p.inferred > 0 && (<>
              <circle cx={cx + (p.observed > 0 ? r * 2.3 : 0)} cy={cy} r={r} fill="#ffffff" stroke="#475569" strokeWidth={0.12} strokeDasharray="0.3 0.2" />
              <text x={cx + (p.observed > 0 ? r * 2.3 : 0)} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={r * 1.05} fontWeight={600} fill="#334155">{p.inferred}</text>
            </>)}
          </g>
        );
      })}

      {/* 배치 자산 수(관리자) */}
      {assets && rooms.map((s) => {
        const n = s.spaceNodeId ? assets.get(s.spaceNodeId) : undefined;
        if (!n) return null;
        return (
          <g key={`a-${s.id}`} style={{ pointerEvents: 'none' }}>
            <rect x={s.rect.x + s.rect.w - 1.9} y={s.rect.y + 0.3} width={1.6} height={1.1} rx={0.3} fill="#7c3aed" stroke="#fff" strokeWidth={0.1} />
            <text x={s.rect.x + s.rect.w - 1.1} y={s.rect.y + 0.85} textAnchor="middle" dominantBaseline="central" fontSize={0.7} fontWeight={700} fill="#fff">{n}</text>
          </g>
        );
      })}

      {/* 경로 — 흰 테두리 위 선 · 출발(초록)·도착(빨강) */}
      {route && route.length > 1 && (
        <g style={{ pointerEvents: 'none' }}>
          <polyline points={route.map((p) => p.join(',')).join(' ')} fill="none" stroke="#ffffff" strokeWidth={1.0} strokeLinejoin="round" strokeLinecap="round" />
          <polyline points={route.map((p) => p.join(',')).join(' ')} fill="none" stroke="#e11d48" strokeWidth={0.5} strokeLinejoin="round" strokeLinecap="round"
            markerEnd={`url(#${uid}-arrow)`} />
          <circle cx={route[0][0]} cy={route[0][1]} r={0.55} fill="#16a34a" stroke="#fff" strokeWidth={0.15} />
          <circle cx={route[route.length - 1][0]} cy={route[route.length - 1][1]} r={0.6} fill="#e11d48" stroke="#fff" strokeWidth={0.15} />
        </g>
      )}

      {/* 합성 도면 표식 — 지우지 않는다: 한가운데 옅은 글자 + 모서리 띠 */}
      {notice && (<>
        <text x={W / 2} y={H / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.max(1.6, W / 36)} fontWeight={700} fill="#e11d48" opacity={0.1}
          transform={`rotate(-10 ${W / 2} ${H / 2})`} style={{ pointerEvents: 'none' }}>{notice}</text>
        <g style={{ pointerEvents: 'none' }}>
          <rect x={fp.x + fp.w - notice.length * 0.82 - 0.8} y={fp.y - 1.9} width={notice.length * 0.82 + 0.8} height={1.5} rx={0.3} fill="#e11d48" />
          <text x={fp.x + fp.w - 0.4} y={fp.y - 1.15} textAnchor="end" dominantBaseline="middle" fontSize={0.8} fontWeight={600} fill="#fff"
            textLength={notice.length * 0.78} lengthAdjust="spacingAndGlyphs">{notice}</text>
        </g>
      </>)}
      {children}
    </svg>
  );
}
