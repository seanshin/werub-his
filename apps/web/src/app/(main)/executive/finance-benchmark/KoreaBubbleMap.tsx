'use client';

/**
 * 지역 내 병원 간 의료이익 — 시도 경계 지도 위 버블(원 크기 = 의료이익 규모 · 색 = 흑자/적자).
 *
 * 경계: 통계청 SGIS 센서스용 행정구역경계(시도·시군구·읍면동) 2018 · 공공누리 제1유형(출처 표시) · 단순화본
 *   `/geo/kr-provinces-2018.json`(전국) · `/geo/kr-sgg-2018/<시도코드>.json` · `/geo/kr-emd-2018/<시도코드>.json`.
 * 상세 수준: 확대할수록 **시도 → 시군구 → 읍면동** 경계와 이름을 더한다(`mapLevel`) — 화면에 보이는 시도의 파일만 그때 받는다.
 * 투영: 경위도 등장방형 + 기준 위도 cos 보정 — 가로·세로 축척을 같게 해 국토 모양이 찌그러지지 않는다.
 * 표식(기획 finance-map-visual-3d): 모양 = 종별 · 색 = 의료이익률 6단 · 크기 = 의료수익(규모) · 확대 전에는 화면 격자로 묶는다(n · 흑자 k/n).
 * 🔴 정직: 경계를 못 불러오면 "지도 없음"을 말하고 점만 그린다 · 큰 원을 먼저 그려 작은 원이 가려지지 않게 한다.
 *    좌표 없는 기관(공시 원자료에는 좌표가 없다)은 **주소 시군구의 면적 중심**에 점선 원으로 근사해 그리고 "위치 근사"라고 말한다
 *    (`/geo/kr-sgg-2018-centroids.json` · 같은 시군구 여럿은 겹치지 않게 조금씩 벌린다 — 그 벌림은 위치 정보가 아니다).
 *    시군구도 못 맞추면 그리지 않고 그 수를 지도 아래에 밝힌다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { formatNum, normalizeSidoName } from '@hospital-run/shared';
import { Num, Ratio } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { emdCandidates, groupMarkers, matchEmd, marginColor, marginInk, markerShape, sizeRatio, type Cluster } from './finance-map';
import { HospitalMarker, MapLegend, marginText } from './MapMarker';

interface Province { code: string; name: string; rings: [number, number][][] }
interface Municipality { code: string; name: string; rings: [number, number][][] }
export interface MapPoint {
  name: string; self: boolean; sido: string | null; sigungu: string | null; lat: number | null; lng: number | null; medicalProfit: number | null;
  hospitalType?: string | null; beds?: number | null; medicalRevenue?: number | null; address?: string | null;
  ratios?: { medicalProfitMargin: number | null; ordinaryMargin: number | null };
}
/** 위치 근사 수준 — 좌표 없는 기관을 주소의 읍면동 안 점(emd) 또는 시군구 안 점(sgg)에 둔다 */
type ApproxLevel = 'emd' | 'sgg' | null;
type Placed = MapPoint & { lat: number; lng: number; approx: boolean; approxLevel: ApproxLevel };

type Bubble = { p: Placed; x: number; y: number; r: number; key: string; pinned: boolean; surplus: boolean | null };
interface Submunicipality { code: string; name: string; rings: [number, number][][] }
type Box = { minLng: number; maxLng: number; minLat: number; maxLat: number };

/** 상세 수준 — 화면 px/위도1° 기준(전국 맞춤 ≈ 80) · 시도를 고르면 시군구부터 · 시군구를 고르면 읍면동 */
export type MapLevel = 'sido' | 'sgg' | 'emd';
export const SGG_PPD = 200, SGG_LABEL_PPD = 320, EMD_PPD = 1100, EMD_LABEL_PPD = 2000;
export function mapLevel(ppd: number, sidoPicked: boolean, sigunguPicked: boolean): MapLevel {
  if (sigunguPicked || ppd >= EMD_PPD) return 'emd';
  if (sidoPicked || ppd >= SGG_PPD) return 'sgg';
  return 'sido';
}

/** 경계 한 벌의 외곽 상자·이름표 자리(가장 큰 고리의 면적 중심) — 객체마다 한 번만 계산 */
const geoCache = new WeakMap<object, { box: Box; c: [number, number] }>();
function geoOf(f: { rings: [number, number][][] }) {
  const hit = geoCache.get(f);
  if (hit) return hit;
  const box: Box = { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity };
  let best = { a: -1, c: [0, 0] as [number, number] };
  for (const r of f.rings) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < r.length; i++) {
      const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length];
      if (x1 < box.minLng) box.minLng = x1; if (x1 > box.maxLng) box.maxLng = x1;
      if (y1 < box.minLat) box.minLat = y1; if (y1 > box.maxLat) box.maxLat = y1;
      const cr = x1 * y2 - x2 * y1; a += cr; cx += (x1 + x2) * cr; cy += (y1 + y2) * cr;
    }
    if (Math.abs(a) > best.a && a !== 0) best = { a: Math.abs(a), c: [cx / (3 * a), cy / (3 * a)] };
  }
  const out = { box, c: best.a > 0 ? best.c : [(box.minLng + box.maxLng) / 2, (box.minLat + box.maxLat) / 2] as [number, number] };
  geoCache.set(f, out);
  return out;
}
const boxHit = (a: Box, b: Box) => a.minLng <= b.maxLng && a.maxLng >= b.minLng && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
async function getJson<R>(url: string): Promise<R> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as R;
}

/** 시도 이름 정규화 — 약칭은 정식 이름으로(shared 정본), 개칭된 이름은 2018 경계 이름으로 */
const SIDO_ALIAS: Record<string, string> = { 강원특별자치도: '강원도', 전북특별자치도: '전라북도' };
export const normalizeSido = (s: string | null) => {
  if (!s) return s;
  const full = normalizeSidoName(s) ?? s;
  return SIDO_ALIAS[full] ?? full;
};
/** 2018 경계 이후 개칭된 시군구 → 경계 이름(인천 남구 → 미추홀구 2018-07 개칭) */
const SGG_ALIAS: Record<string, string> = { '인천광역시|미추홀구': '남구' };

/** 지도 이름표용 짧은 이름 — 법인 접두어·재단명을 뗀다(전체 이름은 마우스를 올리면 나온다) */
export function shortHospitalName(name: string): string {
  let n = name.replace(/^(\(의\)|\(재\)|의료법인|재단법인|학교법인|사회복지법인|사단법인)\s*/, '');
  const m = /^.+?(?:의료재단|복지재단|사회복지재단|학원|재단)\s*(.+(?:병원|의료원|센터).*)$/.exec(n);
  if (m) n = m[1];
  return n.length > 14 ? `${n.slice(0, 14)}…` : n;
}

/** 공시 시군구('고양시'·'성남시 분당구') ↔ 경계 시군구('고양시일산동구'·'성남시분당구') — 띄어쓰기를 무시하고, 구가 있는 시는 앞머리로 맞춘다 */
const inSigungu = (boundaryName: string, sigungu: string) => {
  const k = sigungu.replace(/\s+/g, '');
  return boundaryName === k || boundaryName.startsWith(k);
};

/**
 * 좌표 있는 기관은 그대로 · 없으면 주소의 읍면동 또는 시군구 **땅 안의 점**에 **위치 근사** · 못 맞추면 뺀다.
 * 2D·3D 가 같은 규칙을 쓰게 여기 하나만 둔다.
 */
export function usePlacedPoints<P extends MapPoint>(points: P[]) {
  const cenQ = useQuery({
    queryKey: ['kr-sgg-2018-centroids'],
    queryFn: async () => {
      const r = await fetch('/geo/kr-sgg-2018-centroids.json');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { sido: Record<string, Record<string, [number, number]>> };
    },
    staleTime: Infinity,
  });
  const emdQ = useQuery({
    queryKey: ['kr-emd-2018-points'],
    queryFn: async () => {
      const r = await fetch('/geo/kr-emd-2018-points.json');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { sido: Record<string, Record<string, Record<string, [number, number]>>> };
    },
    staleTime: Infinity,
  });
  // 좌표 있는 기관은 그대로 · 없으면 ① 주소의 읍면동 안 점 ② 시군구 안 점(구가 있는 시는 그 구들의 평균) · 못 맞추면 뺀다
  // 🔴 점은 면적 중심이 아니라 **땅 안의 점**(섬이 흩어진 군의 면적 중심은 바다에 떨어졌다 — 2026-09-29 실화면)
  const placed = useMemo(() => {
    const cen = cenQ.data?.sido;
    const emdPts = emdQ.data?.sido;
    const out: (P & { lat: number; lng: number; approx: boolean; approxLevel: ApproxLevel })[] = [];
    let unplaced = 0;
    for (const p of points) {
      if (p.lat != null && p.lng != null) { out.push({ ...p, lat: p.lat, lng: p.lng, approx: false, approxLevel: null }); continue; }
      const table = cen && p.sido ? cen[normalizeSido(p.sido) as string] : undefined;
      const sgg = p.sigungu ? SGG_ALIAS[`${normalizeSido(p.sido)}|${p.sigungu}`] ?? p.sigungu : null;
      let hits = table && sgg ? Object.entries(table).filter(([n]) => inSigungu(n, sgg)).map(([, c]) => c) : [];
      // 시군구가 하나뿐인 시도(세종)는 주소의 읍면 이름과 무관하게 그 중심
      if (!hits.length && table && Object.keys(table).length === 1) hits = Object.values(table);
      if (!hits.length) { unplaced++; continue; }
      // 읍면동까지 — 맞은 시군구(구가 있는 시는 그 구들)의 읍면동 표에서 주소 어절을 찾는다
      const sidoKey = normalizeSido(p.sido) as string;
      const sggNames = table && sgg ? Object.keys(table).filter((n) => inSigungu(n, sgg)) : [];
      const cands = emdCandidates(p.address);
      let emdPt: [number, number] | null = null;
      for (const n of sggNames.length ? sggNames : Object.keys(emdPts?.[sidoKey] ?? {})) {
        emdPt = matchEmd(emdPts?.[sidoKey]?.[n], cands);
        if (emdPt) break;
      }
      if (emdPt) { out.push({ ...p, lng: emdPt[0], lat: emdPt[1], approx: true, approxLevel: 'emd' }); continue; }
      out.push({ ...p, lng: hits.reduce((s, c) => s + c[0], 0) / hits.length, lat: hits.reduce((s, c) => s + c[1], 0) / hits.length, approx: true, approxLevel: 'sgg' });
    }
    return { out, unplaced };
  }, [points, cenQ.data, emdQ.data]);
  return { placed, cenQ };
}

export function KoreaBubbleMap({ points, sido, sigungu, selected, onPick, onPickSido, onPickSigungu, clusterOff }: {
  points: MapPoint[];
  sido: string;
  sigungu: string;
  selected: string | null;
  onPick: (name: string) => void;
  onPickSido: (sido: string) => void;
  onPickSigungu?: (sigungu: string) => void;
  /** 묶음 끄기(개별 표식 검사용) */
  clusterOff?: boolean;
}) {
  const tAttr = useTAttr();
  const geoQ = useQuery({
    queryKey: ['kr-provinces-2018'],
    queryFn: async () => {
      const r = await fetch('/geo/kr-provinces-2018.json');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { provinces: Province[] };
    },
    staleTime: Infinity,
  });
  const provinces = geoQ.data?.provinces ?? [];
  const provCode = sido ? provinces.find((p) => p.name === normalizeSido(sido))?.code ?? null : null;
  const sggQ = useQuery({
    queryKey: ['kr-sgg-2018', provCode],
    queryFn: async () => {
      const r = await fetch(`/geo/kr-sgg-2018/${provCode}.json`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { municipalities: Municipality[] };
    },
    enabled: !!provCode,
    staleTime: Infinity,
  });
  const { placed, cenQ } = usePlacedPoints(points);
  // 🔴 메모 — 렌더마다 새 빈 배열이면 view 가 매번 다시 계산돼 확대 상태가 계속 초기화된다
  const munis = useMemo(() => (provCode ? sggQ.data?.municipalities ?? [] : []), [provCode, sggQ.data]);
  // 경계 시군구 → 공시 시군구(누르면 그 시군구로 좁힌다) — 시도(2018 경계 이름)별
  const sigunguByProv = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of points) {
      const k = normalizeSido(p.sido);
      if (!k || !p.sigungu) continue;
      const arr = m.get(k) ?? [];
      if (!arr.includes(p.sigungu)) arr.push(p.sigungu);
      m.set(k, arr);
    }
    return m;
  }, [points]);

  const W = 560, H = 620, PAD = 18;
  const view = useMemo(() => {
    // 보여줄 범위 — 시군구 선택=그 기관들 · 시도 선택=그 시도 경계 · 아니면 전국
    const pts: [number, number][] = [];
    const focusProv = sido ? provinces.filter((p) => p.name === normalizeSido(sido)) : provinces;
    if (sigungu) {
      // 시군구 경계가 있으면 경계로 · 없으면 그 기관들로
      for (const m of munis) if (inSigungu(m.name, sigungu)) for (const r of m.rings) for (const c of r) pts.push(c);
      if (!pts.length) for (const p of points) if (p.lng != null && p.lat != null && p.sigungu === sigungu) pts.push([p.lng, p.lat]);
    }
    if (!pts.length) for (const p of focusProv) for (const r of p.rings) for (const c of r) pts.push(c);
    if (!pts.length) for (const p of points) if (p.lng != null && p.lat != null) pts.push([p.lng, p.lat]);
    if (!pts.length) return null;
    let minX = Math.min(...pts.map((c) => c[0])), maxX = Math.max(...pts.map((c) => c[0]));
    let minY = Math.min(...pts.map((c) => c[1])), maxY = Math.max(...pts.map((c) => c[1]));
    // 너무 좁은 범위(시군구 한 곳)는 최소 폭을 둔다
    const minSpan = 0.12;
    // 가장자리 여백 8%
    const padX = (maxX - minX) * 0.08, padY = (maxY - minY) * 0.08;
    minX -= padX; maxX += padX; minY -= padY; maxY += padY;
    if (maxX - minX < minSpan) { const c = (minX + maxX) / 2; minX = c - minSpan / 2; maxX = c + minSpan / 2; }
    if (maxY - minY < minSpan) { const c = (minY + maxY) / 2; minY = c - minSpan / 2; maxY = c + minSpan / 2; }
    const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
    const scale = Math.min((W - PAD * 2) / ((maxX - minX) * k), (H - PAD * 2) / (maxY - minY));
    const ox = (W - (maxX - minX) * k * scale) / 2, oy = (H - (maxY - minY) * scale) / 2;
    return {
      x: (lng: number) => ox + (lng - minX) * k * scale,
      y: (lat: number) => oy + (maxY - lat) * scale,
      lng: (x: number) => minX + (x - ox) / (k * scale),
      lat: (y: number) => maxY - (y - oy) / scale,
      scale,
    };
  }, [provinces, munis, points, sido, sigungu]);

  const inRegion = (p: MapPoint) => (!sido || normalizeSido(p.sido) === normalizeSido(sido)) && (!sigungu || p.sigungu === sigungu);
  const shown = placed.out.filter((p) => p.medicalProfit != null && (!sido || normalizeSido(p.sido) === normalizeSido(sido)) && (!sigungu || p.sigungu === sigungu));
  const approxN = shown.filter((p) => p.approx).length;
  const unplacedN = cenQ.isSuccess ? points.filter((p) => (p.lat == null || p.lng == null) && inRegion(p)).length - approxN : 0;
  const maxRev = Math.max(0, ...shown.map((p) => p.medicalRevenue ?? 0));
  // 크기 = 규모(의료수익 √) · 전국 보기는 작게 · 시도는 조금 크게 · 시군구는 상한 고정(표식이 지역을 덮지 않게)
  const rMax = sigungu ? 13 : sido ? 14 : 11;

  // ── 확대·이동 — 경계는 확대 그룹 안(선 굵기 고정) · 원·이름표는 화면 좌표(확대해도 크기 거의 그대로) ──
  const [z, setZ] = useState({ k: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<{ p?: Placed; c?: Cluster<Bubble>; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  // 지역이 바뀌면 맞춤으로 돌아간다
  useEffect(() => { setZ({ k: 1, tx: 0, ty: 0 }); }, [sido, sigungu]);
  const K_MIN = 1, K_MAX = 64;
  const zoomAt = (factor: number, sx: number, sy: number) => setZ((cur) => {
    const k = Math.min(K_MAX, Math.max(K_MIN, cur.k * factor));
    const f = k / cur.k;
    return { k, tx: sx - (sx - cur.tx) * f, ty: sy - (sy - cur.ty) * f };
  });
  /** 화면 좌표(px) → SVG 좌표 */
  const toSvg = (clientX: number, clientY: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { x: W / 2, y: H / 2, s: 1 };
    const s = W / r.width;
    return { x: (clientX - r.left) * s, y: (clientY - r.top) * s, s };
  };
  // 휠 확대 — 페이지 스크롤을 막아야 해서 passive:false 로 직접 단다(React onWheel 은 막지 못한다)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x, y } = toSvg(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.25 : 0.8, x, y);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!view]);

  // ── 상세 수준 — 확대할수록 시도 → 시군구 → 읍면동 경계·이름(화면에 보이는 시도 파일만 받는다) ──
  const ppd = view ? view.scale * z.k : 0;
  const level = mapLevel(ppd, !!sido, !!sigungu);
  const vb: Box | null = view ? { minLng: view.lng(-z.tx / z.k), maxLng: view.lng((W - z.tx) / z.k), maxLat: view.lat(-z.ty / z.k), minLat: view.lat((H - z.ty) / z.k) } : null;
  const visibleProv = vb ? provinces.filter((p) => (!sido || p.name === normalizeSido(sido)) && boxHit(geoOf(p).box, vb)).map((p) => p.code) : [];
  const sggQs = useQueries({
    queries: (level === 'sido' ? [] : visibleProv).map((c) => ({
      queryKey: ['kr-sgg-2018', c], queryFn: () => getJson<{ municipalities: Municipality[] }>(`/geo/kr-sgg-2018/${c}.json`), staleTime: Infinity,
    })),
  });
  const emdQs = useQueries({
    queries: (level === 'emd' ? visibleProv : []).map((c) => ({
      queryKey: ['kr-emd-2018', c], queryFn: () => getJson<{ submunicipalities: Submunicipality[] }>(`/geo/kr-emd-2018/${c}.json`), staleTime: Infinity,
    })),
  });
  // 경로 문자열은 보기(view)가 같으면 다시 만들지 않는다(확대·이동은 그룹 변환이라 경로가 그대로다)
  const pathCache = useMemo(() => new WeakMap<object, string>(), [view]);
  const pathOf = (f: { rings: [number, number][][] }) => {
    let d = pathCache.get(f);
    if (d == null && view) { d = f.rings.map((r) => `M${r.map((c) => `${view.x(c[0])},${view.y(c[1])}`).join('L')}Z`).join(''); pathCache.set(f, d); }
    return d ?? '';
  };
  // 시군구 경계가 도착한 시도는 시도 외곽선을 그리지 않는다(단순화 정도가 달라 두 줄로 겹친다) · 도착 전에는 시도 선을 남긴다
  const sggLoaded = new Set(sggQs.flatMap((q) => (q.data?.municipalities?.[0] ? [q.data.municipalities[0].code.slice(0, 2)] : [])));
  const detailLoading = [...sggQs, ...emdQs].some((q) => q.isLoading);
  const detailError = [...sggQs, ...emdQs].some((q) => q.isError);

  // 목록·선택 상자에서 기관을 고르면 지도가 그 기관으로 옮겨 간다(화면 밖이거나 멀리서 보고 있을 때만 — 지도에서 누른 것은 그대로)
  const selectedPt = selected ? placed.out.find((p) => p.name === selected) ?? null : null;
  const zRef = useRef(z);
  zRef.current = z;
  useEffect(() => {
    if (!view || !selectedPt) return;
    const cur = zRef.current;
    const px = view.x(selectedPt.lng), py = view.y(selectedPt.lat);
    const onScreenX = px * cur.k + cur.tx, onScreenY = py * cur.k + cur.ty;
    const visible = onScreenX > W * 0.1 && onScreenX < W * 0.9 && onScreenY > H * 0.1 && onScreenY < H * 0.9;
    if (visible && cur.k >= 4) return;
    const k = Math.max(cur.k, 6);
    const goal = { k, tx: W / 2 - px * k, ty: H / 2 - py * k };
    // 짧게 움직인다(350ms) — 순간이동하면 어디로 갔는지 놓친다
    const from = cur, t0 = performance.now();
    let raf = 0;
    const step = () => {
      // 시계는 직접 읽는다 — rAF 인자가 없는 환경(테스트·일부 웹뷰)에서 NaN 이 좌표로 번졌다
      const a = Math.min(1, Math.max(0, (performance.now() - t0) / 350)), e = 1 - (1 - a) ** 3;
      setZ({ k: from.k + (goal.k - from.k) * e, tx: from.tx + (goal.tx - from.tx) * e, ty: from.ty + (goal.ty - from.ty) * e });
      if (a < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectedPt?.lat, selectedPt?.lng, view]); // 🔴 view 자체 — 경계가 늦게 오면 보기가 바뀌므로 그때 다시 맞춘다(2026-09-29 실측: 경계 도착 전 계산으로 엉뚱한 곳)

  if (!view) return null;
  const sx = (lng: number) => view.x(lng) * z.k + z.tx;
  const sy = (lat: number) => view.y(lat) * z.k + z.ty;
  // 확대하면 원이 조금 커진다(√k · 상한 2.2배) — 지역을 덮지 않을 만큼
  const grow = Math.min(2.2, Math.sqrt(z.k));
  // 근사 위치가 같은 기관들은 해바라기 배치로 조금씩 벌린다(화면 px — 확대해도 같은 간격)
  const spread = new Map<string, number>();
  const bubbles = shown
    .map((p) => {
      let x = sx(p.lng), y = sy(p.lat);
      if (p.approx) {
        const key = `${p.lng},${p.lat}`;
        const i = spread.get(key) ?? 0;
        spread.set(key, i + 1);
        if (i > 0) { const a = i * 2.39996, d = 4.5 * Math.sqrt(i); x += Math.cos(a) * d; y += Math.sin(a) * d; }
      }
      const r = (3.6 + (sizeRatio(p.medicalRevenue, maxRev) ?? 0) * rMax) * grow;
      return { p, x, y, r, key: p.name, pinned: p.name === selected || p.self, surplus: p.medicalProfit == null ? null : p.medicalProfit >= 0 };
    })
    .filter((b) => b.x > -40 && b.x < W + 40 && b.y > -40 && b.y < H + 40);
  // 묶음 — 확대 전에는 화면 격자로(선택·우리 병원은 묶지 않는다) · 충분히 확대하면 풀린다
  const grouped = groupMarkers(bubbles, ppd, clusterOff);
  const singles = [...grouped.singles].sort((a, b) => b.r - a.r); // 큰 표식 먼저 → 작은 표식이 위에
  const clusterR = (n: number) => 11 + Math.log2(n) * 3.2;

  // 이름표 — 선택·우리 병원 먼저, 그다음 큰 원부터 · 겹치면 뺀다 · 확대할수록 더 많이 붙는다
  const labels: { p: Placed; x: number; y: number; text: string; strong: boolean; margin: string | null }[] = [];
  {
    // 묶음 원 자리를 먼저 막는다
    const boxes: { x1: number; y1: number; x2: number; y2: number }[] = grouped.clusters.map((c) => ({ x1: c.x - clusterR(c.n), y1: c.y - clusterR(c.n), x2: c.x + clusterR(c.n), y2: c.y + clusterR(c.n) }));
    const order = [...singles].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.r - a.r);
    for (const b of order) {
      const strong = b.pinned;
      const text = shortHospitalName(b.p.name);
      const margin = b.p.ratios ? marginText(b.p.ratios.medicalProfitMargin) : null;
      const x = b.x + b.r * 1.15 + 4, y = b.y;
      const box = { x1: x - 2, y1: y - 8, x2: x + text.length * 11 + (margin ? margin.length * 7 + 6 : 0) + 2, y2: y + 8 };
      if (!strong && boxes.some((o) => box.x1 < o.x2 && box.x2 > o.x1 && box.y1 < o.y2 && box.y2 > o.y1)) continue;
      boxes.push(box);
      labels.push({ p: b.p, x, y, text, strong, margin });
      if (labels.length >= 60) break;
    }
  }

  // 지역 이름표 — 수준마다 그 층의 이름(연한 회색 · 병원 이름표 아래 층) · 서로 겹치면 뺀다
  const regionLabels: { key: string; x: number; y: number; text: string; tier: 0 | 1 | 2 }[] = [];
  {
    const cand: { key: string; f: { rings: [number, number][][] }; text: string; tier: 0 | 1 | 2 }[] = [];
    if (level === 'sido' && !sido) for (const pv of provinces) cand.push({ key: `p-${pv.code}`, f: pv, text: pv.name, tier: 0 });
    if ((level === 'sgg' && ppd >= SGG_LABEL_PPD) || level === 'emd') for (const q of sggQs) for (const m of q.data?.municipalities ?? []) cand.push({ key: `s-${m.code}`, f: m, text: m.name, tier: 1 });
    if (level === 'emd' && ppd >= EMD_LABEL_PPD) for (const q of emdQs) for (const e of q.data?.submunicipalities ?? []) cand.push({ key: `e-${e.code}`, f: e, text: e.name, tier: 2 });
    // 병원 원·이름표 자리를 먼저 막는다 — 지역 이름이 병원 위를 덮지 않게(근사 원은 읍면동·시군구 안의 점에 앉는다)
    const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [
      ...singles.map((b) => ({ x1: b.x - b.r, y1: b.y - b.r, x2: b.x + b.r, y2: b.y + b.r })),
      ...grouped.clusters.map((c) => ({ x1: c.x - clusterR(c.n), y1: c.y - clusterR(c.n), x2: c.x + clusterR(c.n), y2: c.y + clusterR(c.n) })),
      ...labels.map((l) => ({ x1: l.x - 2, y1: l.y - 8, x2: l.x + l.text.length * 11 + (l.margin ? l.margin.length * 7 + 6 : 0) + 2, y2: l.y + 8 })),
    ];
    const hits = (b: { x1: number; y1: number; x2: number; y2: number }) => boxes.some((o) => b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1);
    for (const c of cand) {
      const [lng, lat] = geoOf(c.f).c;
      const cx = sx(lng), cy = sy(lat);
      if (cx < 0 || cx > W || cy < 0 || cy > H) continue;
      const fs = c.tier === 0 ? 11 : c.tier === 1 ? 10.5 : 9.5;
      const half = (c.text.length * fs) / 2;
      // 중심 → 아래 → 위 순으로 빈 자리를 찾고, 없으면 그 이름은 뺀다(병원 쪽이 우선)
      const spot = [0, fs + 4, -(fs + 4)].map((dy) => ({ y: cy + dy, box: { x1: cx - half, y1: cy + dy - fs / 2 - 1, x2: cx + half, y2: cy + dy + fs / 2 + 1 } })).find((o) => !hits(o.box));
      if (!spot) continue;
      boxes.push(spot.box);
      regionLabels.push({ key: c.key, x: cx, y: spot.y, text: c.text, tier: c.tier });
      if (regionLabels.length >= 220) break;
    }
  }

  const btn = 'flex h-9 w-9 items-center justify-center rounded-lg border bg-white/95 text-base font-semibold text-gray-700 shadow-sm hover:bg-indigo-50';
  return (
    <div className="space-y-1">
      <div className="relative">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-none select-none rounded-xl bg-sky-50" role="img" aria-label="map"
          style={{ cursor: drag.current?.moved ? 'grabbing' : 'grab', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' }}
          onPointerDown={(e) => {
            const { x, y } = toSvg(e.clientX, e.clientY);
            drag.current = { x, y, tx: z.tx, ty: z.ty, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const { x, y } = toSvg(e.clientX, e.clientY);
            if (!d.moved && Math.hypot(x - d.x, y - d.y) < 4) return;
            if (!d.moved) { d.moved = true; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); setHover(null); }
            setZ((cur) => ({ ...cur, tx: d.tx + (x - d.x), ty: d.ty + (y - d.y) }));
          }}
          onPointerUp={() => { suppressClick.current = !!drag.current?.moved; drag.current = null; }}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={(e) => { const { x, y } = toSvg(e.clientX, e.clientY); zoomAt(2, x, y); }}
        >
          <g transform={`translate(${z.tx} ${z.ty}) scale(${z.k})`}>
            {provinces.map((pv) => {
              const on = sido && normalizeSido(sido) === pv.name;
              return (
                <path key={pv.code} d={pathOf(pv)} fill={on ? '#e0e7ff' : '#f8fafc'} stroke={sggLoaded.has(pv.code) ? 'none' : on ? '#6366f1' : '#94a3b8'}
                  strokeWidth={on ? 1.4 : 0.7}
                  vectorEffect="non-scaling-stroke"
                  onClick={() => { if (suppressClick.current) return; onPickSido(pv.name); }} style={{ cursor: 'pointer' }}>
                  <title>{pv.name}</title>
                </path>
              );
            })}
            {/* 읍면동 — 가장 가는 선 · 누를 수 없다(기관 주소가 읍면동까지 오지 않는다) */}
            {emdQs.flatMap((q) => q.data?.submunicipalities ?? []).filter((e) => !vb || boxHit(geoOf(e).box, vb)).map((e) => (
              <path key={`e-${e.code}`} d={pathOf(e)} fill="transparent" stroke="#c7d2fe" strokeWidth={0.5} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
            ))}
            {/* 시군구 — 누르면 그 시군구로 좁힌다(공시 기관이 있는 곳만) */}
            {sggQs.flatMap((q) => {
              const prov = provinces.find((pv) => pv.code === q.data?.municipalities?.[0]?.code?.slice(0, 2));
              return (q.data?.municipalities ?? []).map((m) => ({ m, provName: prov?.name ?? '' }));
            }).filter(({ m }) => !vb || boxHit(geoOf(m).box, vb)).map(({ m, provName }) => {
              const on = !!sigungu && normalizeSido(sido) === provName && inSigungu(m.name, sigungu);
              const target = sigunguByProv.get(provName)?.find((sg) => inSigungu(m.name, sg));
              return (
                <path key={m.code} d={pathOf(m)} fill={on ? '#c7d2fe' : 'transparent'} stroke={on ? '#4f46e5' : level === 'emd' ? '#818cf8' : '#a5b4fc'}
                  strokeWidth={on ? 1.4 : level === 'emd' ? 0.9 : 0.6}
                  vectorEffect="non-scaling-stroke"
                  onClick={target && onPickSigungu ? (e) => {
                    e.stopPropagation();
                    if (suppressClick.current) return;
                    if (normalizeSido(sido) !== provName) onPickSido(provName);
                    onPickSigungu(target);
                  } : undefined}
                  style={target && onPickSigungu ? { cursor: 'pointer' } : undefined}>
                  <title>{m.name}</title>
                </path>
              );
            })}
          </g>
          {regionLabels.map((l) => (
            <text key={l.key} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle"
              fontSize={l.tier === 0 ? 11 : l.tier === 1 ? 10.5 : 9.5} fontWeight={l.tier === 2 ? 400 : 600}
              fill={l.tier === 2 ? '#94a3b8' : '#64748b'} stroke="#f8fafc" strokeWidth={2.5} paintOrder="stroke" style={{ pointerEvents: 'none' }}>
              {l.text}
            </text>
          ))}
          {grouped.clusters.map((c) => {
            const R = clusterR(c.n), C = 2 * Math.PI * (R - 1.5);
            const f = c.surplusN ? c.surplusK / c.surplusN : null;
            return (
              <g key={`c-${c.members[0].key}`} data-cluster={c.n} transform={`translate(${c.x} ${c.y})`} style={{ cursor: 'zoom-in' }}
                onPointerEnter={() => { if (!drag.current?.moved) setHover({ c, x: c.x, y: c.y - R }); }}
                onPointerLeave={() => setHover((h) => (h?.c === c ? null : h))}
                onClick={() => { if (suppressClick.current) return; setHover(null); zoomAt(2.4, c.x, c.y); }}>
                <circle r={R} fill="#ffffff" fillOpacity={0.95} style={{ filter: 'drop-shadow(0 1px 2px rgba(15,23,42,0.35))' }} />
                {/* 테두리 = 흑자 비율(청록) / 적자(분홍) · 모르면 회색 */}
                <circle r={R - 1.5} fill="none" stroke={f == null ? '#94a3b8' : '#fb7185'} strokeWidth={3} />
                {f != null && f > 0 && <circle r={R - 1.5} fill="none" stroke="#14b8a6" strokeWidth={3} strokeDasharray={`${f * C} ${C}`} transform="rotate(-90)" />}
                <text textAnchor="middle" dominantBaseline="central" fontSize={R > 15 ? 11.5 : 10.5} fontWeight={700} fill="#1e293b" style={{ pointerEvents: 'none' }}>{c.n}</text>
              </g>
            );
          })}
          {singles.map(({ p, x, y, r, pinned }) => (
            <g key={p.name} data-marker={markerShape(p.hospitalType)} data-approx={p.approx ? '1' : undefined} transform={`translate(${x} ${y})`}
              onPointerEnter={() => { if (!drag.current?.moved) setHover({ p, x, y: y - r }); }}
              onPointerLeave={() => setHover((h) => (h?.p?.name === p.name ? null : h))}
              onClick={() => { if (suppressClick.current) return; onPick(p.name); }} style={{ cursor: 'pointer' }}>
              <HospitalMarker shape={markerShape(p.hospitalType)} r={r} color={marginColor(p.ratios?.medicalProfitMargin)} approx={p.approx} selected={pinned} />
            </g>
          ))}
          {labels.map((l) => (
            <text key={`l-${l.p.name}`} x={l.x} y={l.y} dominantBaseline="middle" fontSize={l.strong ? 12 : 11} fontWeight={l.strong ? 700 : 600}
              fill={l.strong ? '#312e81' : '#1e293b'} stroke="#ffffff" strokeWidth={3} paintOrder="stroke" style={{ pointerEvents: 'none' }}>
              {l.text}
              {l.margin && <tspan dx={4} fontSize={10} fontWeight={700} fill={marginInk(l.p.ratios?.medicalProfitMargin)}>{l.margin}</tspan>}
            </text>
          ))}
        </svg>

        {/* 가리킨 병원 — 전체 이름·의료이익(툴팁은 SVG title 처럼 늦게 뜨지 않는다) */}
        {hover && (
          <div className="pointer-events-none absolute z-10 w-max max-w-[260px] -translate-x-1/2 -translate-y-full rounded-xl bg-slate-900/95 px-3 py-2 text-[11px] text-white shadow-xl ring-1 ring-white/10"
            style={{ left: `${(hover.x / W) * 100}%`, top: `calc(${(hover.y / H) * 100}% - 8px)` }}>
            {hover.c ? (<>
              <p className="font-semibold"><Tf k="{n}곳이 모여 있습니다" params={{ n: hover.c.n }} /></p>
              <p className="text-slate-300"><T k="흑자 기관" /> <Ratio numerator={hover.c.surplusK} denominator={hover.c.surplusN} /> · <T k="누르면 확대" /></p>
            </>) : hover.p && (<>
              <p className="font-semibold leading-snug">{hover.p.name}</p>
              <p className="text-slate-300">{[hover.p.hospitalType, hover.p.beds != null ? `${hover.p.beds}${tAttr('병상')}` : null, [hover.p.sido, hover.p.sigungu].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</p>
              <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
                {hover.p.medicalRevenue != null && <><dt className="text-slate-400"><T k="의료수익" /></dt><dd className="text-right">{formatNum(hover.p.medicalRevenue / 1e8, 'moneyEok')}</dd></>}
                <dt className="text-slate-400"><T k="의료이익" /></dt><dd className="text-right">{formatNum((hover.p.medicalProfit as number) / 1e8, 'moneyEok')}</dd>
                {hover.p.ratios && <><dt className="text-slate-400"><T k="의료이익률" /></dt><dd className="text-right font-semibold" style={{ color: marginColor(hover.p.ratios.medicalProfitMargin) === '#94a3b8' ? undefined : marginColor(hover.p.ratios.medicalProfitMargin) }}>{marginText(hover.p.ratios.medicalProfitMargin)}</dd></>}
                {hover.p.ratios && <><dt className="text-slate-400"><T k="의료수익경상이익률" /></dt><dd className="text-right">{marginText(hover.p.ratios.ordinaryMargin)}</dd></>}
              </dl>
              {hover.p.approx && <p className="mt-1 text-amber-300">{hover.p.approxLevel === 'emd' ? <T k="위치 근사 — 주소 읍면동 안의 점" /> : <T k="위치 근사 — 주소 시군구 안의 점" />}</p>}
            </>)}
          </div>
        )}

        {/* 확대·축소·맞춤 */}
        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <button type="button" className={btn} onClick={() => zoomAt(1.5, W / 2, H / 2)} aria-label={tAttr('확대')} title={tAttr('확대')}>+</button>
          <button type="button" className={btn} onClick={() => zoomAt(1 / 1.5, W / 2, H / 2)} aria-label={tAttr('축소')} title={tAttr('축소')}>−</button>
          <button type="button" className={`${btn} text-xs`} onClick={() => setZ({ k: 1, tx: 0, ty: 0 })} aria-label={tAttr('전체 맞춤')} title={tAttr('전체 맞춤')}>⤢</button>
        </div>
        <span className="absolute bottom-2 left-2 rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-gray-600 shadow-sm">
          {level === 'sido' ? <T k="표시 수준: 시도 — 확대하면 시군구 경계·이름" /> : level === 'sgg' ? <T k="표시 수준: 시군구 — 더 확대하면 읍면동" /> : <T k="표시 수준: 읍면동" />}
          {detailLoading && <> · <T k="경계를 불러오는 중…" /></>}
          {detailError && <> · <span className="text-rose-600"><T k="상세 경계 일부를 불러오지 못했습니다" /></span></>}
        </span>
        {z.k > 1.01 && (
          <span className="absolute bottom-2 right-2 rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-gray-600">×<Num value={z.k} domain="zoomFactor" unit={false} /></span>
        )}
      </div>
      {(approxN > 0 || unplacedN > 0) && (
        <p className="text-[11px] text-gray-500">
          {approxN > 0 && <Tf k="점선 원 {수}곳 = 공시에 좌표가 없어 주소의 읍면동(없으면 시군구) 안의 점에 근사로 그렸습니다" params={{ 수: approxN }} />}
          {approxN > 0 && unplacedN > 0 && ' · '}
          {unplacedN > 0 && <Tf k="위치를 알 수 없는 {수}곳은 지도에서 뺐습니다(목록에는 있음)" params={{ 수: unplacedN }} />}
        </p>
      )}
      <MapLegend />
      <p className="text-[10px] text-gray-400">
        <T k="휠·버튼으로 확대/축소 · 드래그로 이동 · 더블클릭 확대 · 원을 누르면 그 병원을 분석합니다" />
        {' · '}
        {geoQ.isError || sggQ.isError ? <T k="지도 경계를 불러오지 못해 경계 없이 점만 그렸습니다" /> : <T k="경계: 통계청 SGIS 행정구역경계 시도·시군구·읍면동(2018 · 공공누리 제1유형) · 시도·시군구를 누르면 그 지역으로 좁힙니다" />}
      </p>
    </div>
  );
}
