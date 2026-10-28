'use client';

/**
 * 경영성과 **3D 지도** — 시도(선택 시 시군구) 입체 판 위에 병원 건물 모형(기획 finance-map-visual-3d §3-2).
 *
 * 부호화(2D 와 같다 · `finance-map.ts`): 모양 = 종별(상급종합=옥상 십자 탑 · 종합=건물 · 병원=낮은 건물 · 요양=박공 지붕 ·
 *   정신=원통 · 한방=모임 지붕) · 색 = 의료이익률 6단(산출 불가 회색) · **높이·굵기 = 의료수익 규모(√ · 상대값)**.
 * 🔴 정직 표기:
 *   - 높이는 규모의 상대 표시다 — **실제 건물 높이·층수가 아니다**(화면 모서리에 말한다).
 *   - 좌표 없는 기관은 반투명 + 바닥 고리(위치 근사 · 주소 읍면동·시군구 안의 점) — 2D 점선과 같은 뜻.
 *   - WebGL 을 만들 수 없으면 그리지 않고 `onUnavailable` 로 알린다(부모가 2D 로 돌아가 그 사실을 말한다).
 * 3D 는 보조 보기다 — 정보는 전부 2D 에도 있다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { formatNum } from '@hospital-run/shared';
import { T, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { groupMarkers, marginColor, marginInk, markerShape, sizeRatio, type Cluster, type MarkerShape } from './finance-map';
import { marginText } from './MapMarker';
import { normalizeSido, shortHospitalName, usePlacedPoints, type MapPoint } from './KoreaBubbleMap';

interface GeoFeature { code: string; name: string; rings: [number, number][][] }
type Placed3D = MapPoint & { lat: number; lng: number; approx: boolean };
/** 묶음 입력 — 화면 좌표(px) */
type Grp = { key: string; x: number; y: number; pinned: boolean; surplus: boolean | null; p: Placed3D };

/** 투영 — 경위도 → 장면 좌표(단위: 1° 위도 = K) · cos 보정으로 국토 모양 유지 */
const LNG0 = 127.7, LAT0 = 36.1, K = 60, COS = Math.cos((36 * Math.PI) / 180);
export const proj3d = (lng: number, lat: number): [number, number] => [(lng - LNG0) * COS * K, -(lat - LAT0) * K];
const BASE_H = 1.4; // 판 두께

/** 건물 치수 — 규모 비율(0~1 · 없으면 null) → 가로·높이 */
export function buildingSize(ratio: number | null): { w: number; h: number } {
  const r = ratio ?? 0;
  return { w: 1.1 + r * 2.4, h: 1.6 + r * 24 };
}

/**
 * 확대 배율 — 카메라가 가까워질수록 건물을 줄여 **화면 크기를 일정하게** 한다(2D 표식과 같은 동작 · 2026-09-30).
 * 🔴 종전엔 건물이 월드 크기 고정이라 서울처럼 병원이 몰린 곳을 확대하면 건물이 서로를 덮는 벽이 됐고,
 *    앞의 큰 건물이 클릭을 다 가져가 수도권은 아무것도 누를 수 없었다.
 * 기준 = 전국 맞춤 거리 · 확대하면 조금은 커진다(지수 0.85 — 2D 의 grow 와 같은 뜻).
 */
export const REF_DIST_DEFAULT = 850;
export function zoomScale(dist: number, refDist: number): number {
  if (!(dist > 0) || !(refDist > 0)) return 1;
  return Math.min(1, Math.max(0.03, Math.pow(dist / refDist, 0.85)));
}

/** 종별 몸체·지붕 형상(단위 크기 1 · 바닥 y=0) */
function bodyGeometry(shape: MarkerShape): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (shape === 'psych' || shape === 'other') g = new THREE.CylinderGeometry(0.5, 0.5, 1, shape === 'psych' ? 20 : 8);
  else g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}
function roofGeometry(shape: MarkerShape): THREE.BufferGeometry | null {
  if (shape === 'longterm') { // 박공(삼각기둥)
    const g = new THREE.CylinderGeometry(0.62, 0.62, 1.04, 3);
    g.rotateZ(Math.PI / 2); g.rotateX(Math.PI / 6); g.scale(1, 0.55, 1); g.translate(0, 0.16, 0);
    return g;
  }
  if (shape === 'kmed') { // 모임 지붕
    const g = new THREE.ConeGeometry(0.82, 0.5, 4); g.rotateY(Math.PI / 4); g.translate(0, 0.25, 0);
    return g;
  }
  if (shape === 'tertiary') { // 옥상 십자
    const a = new THREE.BoxGeometry(0.7, 0.16, 0.2), b = new THREE.BoxGeometry(0.2, 0.16, 0.7);
    const pos = [...(a.toNonIndexed().attributes.position.array as Float32Array), ...(b.toNonIndexed().attributes.position.array as Float32Array)];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.translate(0, 0.14, 0);
    return g;
  }
  return null;
}
/** 종별 몸체 비율(가로·높이 배수) — 상급종합은 가늘고 높게 · 병원·요양은 낮게 */
const SHAPE_FACTOR: Record<MarkerShape, { w: number; h: number }> = {
  tertiary: { w: 0.9, h: 1.25 }, general: { w: 1, h: 1 }, hospital: { w: 1, h: 0.7 }, longterm: { w: 1.1, h: 0.55 },
  psych: { w: 1, h: 0.75 }, kmed: { w: 1.05, h: 0.6 }, other: { w: 0.9, h: 0.7 },
};

/**
 * 카메라 조작(순수 함수 — WebGL 없이 시험) · 화면 기준 상하좌우 이동 · 확대/축소 · 좌우 회전.
 * 이동은 **땅 위(XZ)** 에서 — 위/아래 버튼은 화면 위쪽(카메라가 보는 방향)을 땅에 투영한 방향으로 간다.
 */
export type Pose = { pos: THREE.Vector3; target: THREE.Vector3 };
export const CAM_MIN = 20, CAM_MAX = 1200;
export function panPose(p: Pose, dir: 'up' | 'down' | 'left' | 'right', stepRatio = 0.18): Pose {
  const fwd = p.target.clone().sub(p.pos); fwd.y = 0;
  if (fwd.lengthSq() < 1e-9) fwd.set(0, 0, -1); // 위에서 내려다볼 때 — 화면 위쪽은 북쪽(−z)
  fwd.normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x); // fwd 를 오른쪽으로 90°
  const step = p.pos.distanceTo(p.target) * stepRatio;
  const d = dir === 'up' ? fwd : dir === 'down' ? fwd.clone().negate() : dir === 'right' ? right : right.clone().negate();
  const off = d.clone().multiplyScalar(step);
  return { pos: p.pos.clone().add(off), target: p.target.clone().add(off) };
}
export function zoomPose(p: Pose, factor: number): Pose {
  const v = p.pos.clone().sub(p.target);
  const len = Math.min(CAM_MAX, Math.max(CAM_MIN, v.length() * factor));
  return { pos: p.target.clone().add(v.setLength(len)), target: p.target.clone() };
}
export function rotatePose(p: Pose, radians: number): Pose {
  const v = p.pos.clone().sub(p.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), radians);
  return { pos: p.target.clone().add(v), target: p.target.clone() };
}

interface Core {
  renderer: THREE.WebGLRenderer; labels: CSS2DRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
  base: THREE.Group; marks: THREE.Group;
  /** 누를 수 있는 것 — 건물(pts) 또는 묶음(clusters) */
  pick: { mesh: THREE.InstancedMesh; pts?: Placed3D[]; clusters?: Cluster<Grp>[] }[];
  /** 마지막 배치 때 카메라(이만큼 움직이면 다시 배치) · 전국 맞춤 거리 */
  lastLayout: { d: number; pos: THREE.Vector3; target: THREE.Vector3 } | null; refDist: number;
  cards: { obj: CSS2DObject; el: HTMLElement; pinned: boolean }[]; goal: { pos: THREE.Vector3; target: THREE.Vector3 } | null; frame: number;
  /** 맞춤 시점(범위 전체) — '맞춤' 버튼이 돌아가는 곳 */
  home: Pose | null;
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
  });
  for (const c of [...g.children]) { if (c instanceof CSS2DObject) c.element.remove(); g.remove(c); }
}

function card(p: Placed3D, pinned: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = `fb3d-card${pinned ? ' fb3d-card--pinned' : ''}`;
  const m = p.ratios?.medicalProfitMargin ?? null;
  const name = document.createElement('div'); name.className = 'fb3d-card__name'; name.textContent = shortHospitalName(p.name);
  const meta = document.createElement('div'); meta.className = 'fb3d-card__meta';
  const mg = document.createElement('b'); mg.textContent = marginText(m); mg.style.color = marginInk(m);
  meta.append(mg, document.createTextNode(p.medicalProfit != null ? ` · ${formatNum(p.medicalProfit / 1e8, 'moneyEok')}` : ''));
  el.append(name, meta);
  return el;
}

export default function KoreaMap3D({ points, sido, selected, onPick, onUnavailable }: {
  points: MapPoint[];
  sido: string;
  selected: string | null;
  onPick: (name: string) => void;
  onUnavailable?: () => void;
}) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const hostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<Core | null>(null);
  const [view, setView] = useState<'iso' | 'top'>('iso');
  const [ready, setReady] = useState(false);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  // 카메라가 멈춘 뒤 다시 배치하라는 신호(무대 루프 → React)
  const [layoutTick, setLayoutTick] = useState(0);
  const relayoutRef = useRef(() => setLayoutTick((n) => n + 1));
  const clusterTipRef = useRef<(c: Cluster<Grp>) => string>(() => '');

  const geoQ = useQuery({
    queryKey: ['kr-provinces-2018'],
    queryFn: async () => { const r = await fetch('/geo/kr-provinces-2018.json'); if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as { provinces: GeoFeature[] }; },
    staleTime: Infinity,
  });
  const provinces = useMemo(() => geoQ.data?.provinces ?? [], [geoQ.data]);
  const provCode = sido ? provinces.find((p) => p.name === normalizeSido(sido))?.code ?? null : null;
  const sggQ = useQuery({
    queryKey: ['kr-sgg-2018', provCode],
    queryFn: async () => { const r = await fetch(`/geo/kr-sgg-2018/${provCode}.json`); if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as { municipalities: GeoFeature[] }; },
    enabled: !!provCode,
    staleTime: Infinity,
  });
  const { placed } = usePlacedPoints(points);
  const shown = useMemo(() => placed.out.filter((p) => !sido || normalizeSido(p.sido) === normalizeSido(sido)), [placed, sido]);

  // ── 무대(한 번) ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      onUnavailable?.();
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    host.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e0f2fe');
    scene.fog = new THREE.Fog('#e0f2fe', 700, 1400);
    const camera = new THREE.PerspectiveCamera(34, 1, 1, 4000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = CAM_MIN;
    controls.maxDistance = CAM_MAX;
    controls.screenSpacePanning = true;
    controls.addEventListener('start', () => { if (coreRef.current) coreRef.current.goal = null; });

    scene.add(new THREE.HemisphereLight('#ffffff', '#cbd5e1', 2.1));
    scene.add(new THREE.AmbientLight('#ffffff', 0.35));
    const sun = new THREE.DirectionalLight('#fff7ed', 2.0);
    sun.position.set(-220, 380, 260);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -420, right: 420, top: 420, bottom: -420, far: 1400 });
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    // 바다
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: '#dbeafe', roughness: 1 }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = -0.2; sea.receiveShadow = true;
    scene.add(sea);

    const base = new THREE.Group(), marks = new THREE.Group();
    scene.add(base, marks);
    const core: Core = { renderer, labels, scene, camera, controls, base, marks, pick: [], cards: [], goal: null, frame: 0, home: null, lastLayout: null, refDist: REF_DIST_DEFAULT };
    coreRef.current = core;

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h); labels.setSize(w, h);
      camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const ray = new THREE.Raycaster();
    const hitAt = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      let best: { d: number; p: Placed3D | null; c: Cluster<Grp> | null } | null = null;
      for (const { mesh, pts, clusters } of core.pick) {
        const h = ray.intersectObject(mesh, false)[0];
        if (h && h.instanceId != null && (!best || h.distance < best.d)) {
          best = { d: h.distance, p: pts ? pts[h.instanceId] : null, c: clusters ? clusters[h.instanceId] : null };
        }
      }
      return { p: best?.p ?? null, c: best?.c ?? null, rect };
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const { p, c } = hitAt(e);
      if (p) onPickRef.current(p.name);
      else if (c) {
        // 묶음 — 2D 처럼 그 자리로 다가간다(보던 방향 유지) · 충분히 가까워지면 풀린다
        const cx = c.members.reduce((a, m) => a + proj3d(m.p.lng, m.p.lat)[0], 0) / c.n;
        const cz = c.members.reduce((a, m) => a + proj3d(m.p.lng, m.p.lat)[1], 0) / c.n;
        const target = new THREE.Vector3(cx, 0, cz);
        const off = camera.position.clone().sub(controls.target);
        core.goal = { pos: target.clone().add(off.setLength(Math.max(CAM_MIN, off.length() * 0.4))), target };
      }
    };
    const onMove = (e: PointerEvent) => {
      const tip = tipRef.current;
      if (!tip) return;
      if (e.buttons) { tip.style.display = 'none'; return; }
      const { p, c, rect } = hitAt(e);
      renderer.domElement.style.cursor = p ? 'pointer' : c ? 'zoom-in' : 'grab';
      if (c) {
        // 묶음 안내 — n곳 · 흑자 k/n(분모 = 의료이익을 아는 기관) · 누르면 확대
        tip.style.display = 'block';
        tip.style.left = `${e.clientX - rect.left + 14}px`;
        tip.style.top = `${e.clientY - rect.top + 14}px`;
        const nm = tip.querySelector<HTMLElement>('[data-f="name"]');
        if (nm) nm.textContent = clusterTipRef.current(c);
        for (const k of ['meta']) { const el = tip.querySelector<HTMLElement>(`[data-f="${k}"]`); if (el) el.textContent = ''; }
        tip.querySelector<HTMLElement>('dl')?.style.setProperty('display', 'none');
        const ap = tip.querySelector<HTMLElement>('[data-f="approx"]'); if (ap) ap.style.display = 'none';
        return;
      }
      tip.querySelector<HTMLElement>('dl')?.style.setProperty('display', '');
      if (!p) { tip.style.display = 'none'; return; }
      tip.dataset.name = p.name;
      tip.style.display = 'block';
      tip.style.left = `${e.clientX - rect.left + 14}px`;
      tip.style.top = `${e.clientY - rect.top + 14}px`;
      const set = (k: string, v: string, color?: string) => { const el = tip.querySelector<HTMLElement>(`[data-f="${k}"]`); if (el) { el.textContent = v; if (color) el.style.color = color; } };
      set('name', p.name);
      set('meta', [p.hospitalType, p.beds != null ? `${p.beds}` : null, [p.sido, p.sigungu].filter(Boolean).join(' ')].filter(Boolean).join(' · '));
      set('rev', p.medicalRevenue != null ? formatNum(p.medicalRevenue / 1e8, 'moneyEok') : '-');
      set('profit', p.medicalProfit != null ? formatNum(p.medicalProfit / 1e8, 'moneyEok') : '-');
      set('margin', marginText(p.ratios?.medicalProfitMargin), marginInk(p.ratios?.medicalProfitMargin));
      const ap = tip.querySelector<HTMLElement>('[data-f="approx"]');
      if (ap) ap.style.display = p.approx ? 'block' : 'none';
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', () => { if (tipRef.current) tipRef.current.style.display = 'none'; });

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (core.goal) {
        camera.position.lerp(core.goal.pos, 0.12);
        controls.target.lerp(core.goal.target, 0.12);
        if (camera.position.distanceTo(core.goal.pos) < 0.5) core.goal = null;
      }
      controls.update();
      core.frame++;
      // 카메라가 자리를 잡으면 다시 배치(크기·묶음) — 매 프레임이 아니라 멈춘 뒤에
      if (core.frame % 12 === 0 && !core.goal) {
        const d = camera.position.distanceTo(controls.target);
        const last = core.lastLayout;
        if (!last || Math.abs(d - last.d) / last.d > 0.06 || controls.target.distanceTo(last.target) > d * 0.05 || camera.position.distanceTo(last.pos) > d * 0.08) {
          core.lastLayout = { d, pos: camera.position.clone(), target: controls.target.clone() };
          relayoutRef.current();
        }
      }
      // 정보 카드 겹침 정리(10프레임마다) — 고정 카드 먼저, 가까운 것 먼저
      if ((core.frame === 3 || core.frame % 10 === 0) && core.cards.length) {
        const w = host.clientWidth, h = host.clientHeight;
        const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [];
        const v = new THREE.Vector3();
        const order = [...core.cards].sort((a, b) => Number(b.pinned) - Number(a.pinned)
          || a.obj.getWorldPosition(v).distanceTo(camera.position) - b.obj.getWorldPosition(new THREE.Vector3()).distanceTo(camera.position));
        for (const c of order) {
          c.obj.getWorldPosition(v).project(camera);
          const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
          const bw = c.el.offsetWidth || 120, bh = c.el.offsetHeight || 34;
          const box = { x1: x - bw / 2, y1: y - bh, x2: x + bw / 2, y2: y };
          const clash = v.z > 1 || boxes.some((o) => box.x1 < o.x2 && box.x2 > o.x1 && box.y1 < o.y2 && box.y2 > o.y1);
          const show = c.pinned || !clash;
          c.el.style.opacity = show ? '1' : '0';
          if (show) boxes.push(box);
        }
      }
      renderer.render(scene, camera);
      labels.render(scene, camera);
    };
    tick();
    setReady(true);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      disposeGroup(base); disposeGroup(marks);
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
      coreRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 판(시도 · 선택 시도는 시군구로) ──
  const municipalities = sggQ.data?.municipalities;
  useEffect(() => {
    const core = coreRef.current;
    if (!core || !ready) return;
    disposeGroup(core.base);
    const selName = normalizeSido(sido);
    const addPlate = (f: GeoFeature, top: string, side: string, h: number, lineColor: string) => {
      const shapes = f.rings.map((r) => new THREE.Shape(r.map(([lng, lat]) => { const [x, z] = proj3d(lng, lat); return new THREE.Vector2(x, -z); })));
      const geo = new THREE.ExtrudeGeometry(shapes, { depth: h, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, [new THREE.MeshStandardMaterial({ color: top, roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: side, roughness: 0.9 })]);
      mesh.receiveShadow = true; mesh.castShadow = true;
      core.base.add(mesh);
      for (const r of f.rings) {
        const pts = r.map(([lng, lat]) => { const [x, z] = proj3d(lng, lat); return new THREE.Vector3(x, h + 0.04, z); });
        core.base.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: lineColor })));
      }
    };
    provinces.forEach((pv, i) => {
      const on = !selName || pv.name === selName;
      if (selName && pv.name === selName && municipalities?.length) return; // 시군구로 대신 세운다
      const tone = i % 2 ? '#f1f5f9' : '#e8eef5';
      addPlate(pv, on ? tone : '#e2e8f0', on ? '#94a3b8' : '#cbd5e1', on ? BASE_H : BASE_H * 0.5, on ? '#64748b' : '#cbd5e1');
    });
    if (selName && municipalities?.length) {
      municipalities.forEach((m, i) => addPlate(m, ['#eef2ff', '#e0e7ff', '#f5f3ff', '#ede9fe'][i % 4], '#818cf8', BASE_H * 1.6, '#6366f1'));
    }
    // 시점 — 보이는 범위에 맞춘다
    const box = new THREE.Box3().setFromObject(core.base);
    const focus = selName ? (() => {
      const b = new THREE.Box3();
      for (const o of core.base.children) if (o instanceof THREE.Mesh) {
        const bb = new THREE.Box3().setFromObject(o);
        if (bb.max.y > BASE_H * 0.9) b.union(bb);
      }
      return b.isEmpty() ? box : b;
    })() : box;
    const c = focus.getCenter(new THREE.Vector3()); c.y = 0;
    const span = Math.max(focus.max.x - focus.min.x, focus.max.z - focus.min.z);
    // 비스듬히 보면 먼 쪽(북)이 작아져 잘린다 — 초점을 조금 북쪽으로
    if (view === 'iso') c.z -= (focus.max.z - focus.min.z) * 0.08;
    // 수직 시야각 34° 기준으로 범위가 다 들어오는 거리 + 여유(비스듬히 보면 먼 쪽이 줄어든다)
    const d = (span / 2) / Math.tan((34 / 2) * (Math.PI / 180)) * 1.42 + 30;
    const pos = view === 'top' ? new THREE.Vector3(c.x + 0.01, d, c.z + 0.01) : new THREE.Vector3(c.x - d * 0.18, d * 0.78, c.z + d * 0.62);
    core.goal = { pos, target: c };
    core.home = { pos: pos.clone(), target: c.clone() };
    if (!selName) core.refDist = pos.distanceTo(c); // 전국 맞춤 거리 = 크기 기준
  }, [ready, provinces, municipalities, sido, view]);

  // 묶음 안내 문구(번역) — 무대 루프가 부른다
  clusterTipRef.current = (c) => (c.surplusN
    ? tfAttr('{n}곳 · 흑자 {k}/{m} — 누르면 확대', { n: c.n, k: c.surplusK, m: c.surplusN })
    : tfAttr('{n}곳 · 의료이익을 아는 기관 없음 — 누르면 확대', { n: c.n }));

  // ── 건물(종별 인스턴스) + 묶음 + 정보 카드 ── 카메라가 멈출 때마다 크기·묶음을 다시 정한다
  useEffect(() => {
    const core = coreRef.current;
    if (!core || !ready) return;
    disposeGroup(core.marks);
    core.pick = [];
    core.cards = [];
    const cam = core.camera;
    const dist = cam.position.distanceTo(core.controls.target);
    const S = zoomScale(dist, core.refDist);
    const maxRev = Math.max(0, ...shown.map((p) => p.medicalRevenue ?? 0));
    const plateTop = (p: Placed3D) => (sido && normalizeSido(p.sido) === normalizeSido(sido) && sggQ.data ? BASE_H * 1.6 : BASE_H);

    // 화면 좌표로 묶는다(2D 와 같은 정본 groupMarkers) · 선택·우리 병원은 묶지 않는다
    const W = core.renderer.domElement.clientWidth || 1, H = core.renderer.domElement.clientHeight || 1;
    const v = new THREE.Vector3();
    const toScreen = (x: number, y: number, z: number) => { v.set(x, y, z).project(cam); return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, behind: v.z > 1 }; };
    // ppd = 화면 px / 위도 1° (보는 중심에서 잰다)
    const t = core.controls.target;
    const a0 = toScreen(t.x, 0, t.z), a1 = toScreen(t.x, 0, t.z - K);
    const ppd = Math.hypot(a1.x - a0.x, a1.y - a0.y);
    const items: Grp[] = shown.map((p) => {
      const [x, z] = proj3d(p.lng, p.lat);
      const sc = toScreen(x, plateTop(p), z);
      // 화면 뒤(카메라 뒤)는 묶지 않는다 — 고정으로 둬 개별로 남긴다
      return { key: p.name, x: sc.x, y: sc.y, pinned: sc.behind || p.name === selected || !!p.self, surplus: p.medicalProfit == null ? null : p.medicalProfit >= 0, p };
    });
    const grouped = groupMarkers(items, ppd);
    const singles = grouped.singles.map((g) => g.p);

    const groups = new Map<string, Placed3D[]>();
    for (const p of singles) {
      const k = `${markerShape(p.hospitalType)}|${p.approx ? 1 : 0}`;
      const arr = groups.get(k);
      if (arr) arr.push(p); else groups.set(k, [p]);
    }
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    for (const [k, pts] of groups) {
      const [shape, approxFlag] = k.split('|') as [MarkerShape, string];
      const approx = approxFlag === '1';
      const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0.05, transparent: approx, opacity: approx ? 0.55 : 1 });
      const body = new THREE.InstancedMesh(bodyGeometry(shape), mat, pts.length);
      const roofGeo = roofGeometry(shape);
      const roof = roofGeo ? new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, transparent: approx, opacity: approx ? 0.55 : 1, emissive: shape === 'tertiary' ? '#dc2626' : '#000000', emissiveIntensity: shape === 'tertiary' ? 0.35 : 0 }), pts.length) : null;
      pts.forEach((p, i) => {
        const [x, z] = proj3d(p.lng, p.lat);
        const { w, h } = buildingSize(sizeRatio(p.medicalRevenue, maxRev));
        const f = SHAPE_FACTOR[shape];
        const bw = w * f.w * S, bh = h * f.h * S, y0 = plateTop(p);
        m4.compose(new THREE.Vector3(x, y0, z), new THREE.Quaternion(), new THREE.Vector3(bw, bh, bw));
        body.setMatrixAt(i, m4);
        body.setColorAt(i, col.set(marginColor(p.ratios?.medicalProfitMargin)));
        if (roof) {
          m4.compose(new THREE.Vector3(x, y0 + bh, z), new THREE.Quaternion(), new THREE.Vector3(bw, shape === 'tertiary' ? bw : bw * 0.9, bw));
          roof.setMatrixAt(i, m4);
          roof.setColorAt(i, col.set(shape === 'tertiary' ? '#ef4444' : shape === 'kmed' ? '#475569' : '#64748b'));
        }
      });
      body.castShadow = !approx; body.receiveShadow = true;
      core.marks.add(body);
      core.pick.push({ mesh: body, pts });
      if (roof) { roof.castShadow = !approx; core.marks.add(roof); core.pick.push({ mesh: roof, pts }); }
      // 위치 근사 — 바닥 고리
      if (approx) {
        const ring = new THREE.InstancedMesh(new THREE.RingGeometry(0.85, 1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#334155', transparent: true, opacity: 0.45 }), pts.length);
        pts.forEach((p, i) => {
          const [x, z] = proj3d(p.lng, p.lat);
          const { w } = buildingSize(sizeRatio(p.medicalRevenue, maxRev));
          m4.compose(new THREE.Vector3(x, plateTop(p) + 0.06, z), new THREE.Quaternion(), new THREE.Vector3(w * 0.95 * S, 1, w * 0.95 * S));
          ring.setMatrixAt(i, m4);
        });
        core.marks.add(ring);
      }
    }

    // 묶음 — 낮은 원판 + 숫자 표 · 테두리 = 흑자 비율(2D 와 같은 뜻) · 누르면 확대
    if (grouped.clusters.length) {
      const disc = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 28).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }), grouped.clusters.length);
      grouped.clusters.forEach((c, i) => {
        const cx = c.members.reduce((acc, m) => acc + proj3d(m.p.lng, m.p.lat)[0], 0) / c.n;
        const cz = c.members.reduce((acc, m) => acc + proj3d(m.p.lng, m.p.lat)[1], 0) / c.n;
        const r = (2.2 + Math.log2(c.n) * 0.7) * S;
        const y0 = plateTop(c.members[0].p);
        m4.compose(new THREE.Vector3(cx, y0, cz), new THREE.Quaternion(), new THREE.Vector3(r, 1.2 * S, r));
        disc.setMatrixAt(i, m4);
        const f = c.surplusN ? c.surplusK / c.surplusN : null;
        disc.setColorAt(i, col.set(f == null ? '#e2e8f0' : f >= 0.5 ? '#ccfbf1' : '#ffe4e6'));
        const el = document.createElement('div');
        el.className = 'fb3d-cluster';
        el.dataset.cluster = String(c.n);
        const deg = f == null ? 0 : Math.round(f * 360);
        el.style.background = f == null ? '#94a3b8' : `conic-gradient(#14b8a6 0 ${deg}deg, #fb7185 ${deg}deg 360deg)`;
        const inner = document.createElement('span'); inner.textContent = String(c.n);
        el.append(inner);
        const obj = new CSS2DObject(el);
        obj.position.set(cx, y0 + 1.2 * S + 0.5, cz);
        obj.center.set(0.5, 0.5);
        core.marks.add(obj);
      });
      disc.castShadow = true;
      core.marks.add(disc);
      core.pick.push({ mesh: disc, clusters: grouped.clusters });
    }

    // 정보 카드 — 선택 기관 + 규모 상위 12곳(묶이지 않은 것 중 · 겹치면 tick 에서 숨긴다)
    const top = [...singles].sort((a, b) => (b.medicalRevenue ?? 0) - (a.medicalRevenue ?? 0)).slice(0, 12);
    const sel = shown.find((p) => p.name === selected || p.self);
    const withCards = sel && !top.includes(sel) ? [sel, ...top] : top;
    for (const p of withCards) {
      const pinned = p === sel;
      const el = card(p, pinned);
      const obj = new CSS2DObject(el);
      const [x, z] = proj3d(p.lng, p.lat);
      const { h } = buildingSize(sizeRatio(p.medicalRevenue, maxRev));
      obj.position.set(x, plateTop(p) + h * SHAPE_FACTOR[markerShape(p.hospitalType)].h * S + 2.5 * S, z);
      obj.center.set(0.5, 1);
      core.marks.add(obj);
      core.cards.push({ obj, el, pinned });
    }
    core.frame = 0; // 새 카드 — 다음 몇 프레임 안에 겹침 정리
    // 선택 기관 — 바닥 강조 고리
    if (sel) {
      const [x, z] = proj3d(sel.lng, sel.lat);
      const halo = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.4, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#4f46e5', transparent: true, opacity: 0.85 }));
      halo.scale.setScalar(Math.max(S, 0.05));
      halo.position.set(x, plateTop(sel) + 0.08, z);
      core.marks.add(halo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shown, selected, sido, sggQ.data, layoutTick]);

  // 목록에서 기관을 고르면 카메라가 그 건물로 다가간다(보던 방향은 유지)
  useEffect(() => {
    const core = coreRef.current;
    if (!core || !ready || !selected) return;
    const p = shown.find((x) => x.name === selected);
    if (!p) return;
    const [x, z] = proj3d(p.lng, p.lat);
    const target = new THREE.Vector3(x, 0, z);
    const dir = core.camera.position.clone().sub(core.controls.target).normalize();
    core.goal = { pos: target.clone().add(dir.multiplyScalar(140)), target };
  }, [ready, selected, shown]);

  // 조작 도구 — 지금 목표(움직이는 중이면 그 목표)에서 다음 목표를 만든다(연타해도 누적된다)
  const move = (f: (p: Pose) => Pose) => {
    const core = coreRef.current;
    if (!core) return;
    const from: Pose = core.goal ?? { pos: core.camera.position.clone(), target: core.controls.target.clone() };
    core.goal = f(from);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    const act: Record<string, () => void> = {
      ArrowUp: () => move((p) => panPose(p, 'up')), ArrowDown: () => move((p) => panPose(p, 'down')),
      ArrowLeft: () => move((p) => panPose(p, 'left')), ArrowRight: () => move((p) => panPose(p, 'right')),
      '+': () => move((p) => zoomPose(p, 0.75)), '=': () => move((p) => zoomPose(p, 0.75)), '-': () => move((p) => zoomPose(p, 1 / 0.75)),
    };
    if (act[k]) { e.preventDefault(); act[k](); }
  };
  const pad = 'flex h-9 w-9 items-center justify-center rounded-lg border bg-white/95 text-sm font-semibold text-gray-700 shadow-sm hover:bg-indigo-50 active:bg-indigo-100';

  const btn = 'rounded-lg border bg-white/95 px-2.5 py-1 text-[11px] font-medium text-gray-700 shadow-sm hover:bg-indigo-50';
  return (
    <div className="relative h-[620px] w-full overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-indigo-300" ref={hostRef} tabIndex={0} onKeyDown={onKey}>
      <style>{`
        .fb3d-card{background:rgba(255,255,255,.94);border:1px solid rgba(148,163,184,.55);border-radius:10px;padding:3px 8px 4px;box-shadow:0 4px 12px rgba(15,23,42,.18);font-size:11px;line-height:1.25;white-space:nowrap;transition:opacity .2s;pointer-events:none}
        .fb3d-card--pinned{border-color:#4f46e5;box-shadow:0 0 0 2px rgba(79,70,229,.35),0 6px 16px rgba(15,23,42,.25)}
        .fb3d-card__name{font-weight:700;color:#0f172a}
        .fb3d-card__meta{color:#475569}
        .fb3d-cluster{width:30px;height:30px;border-radius:9999px;padding:3px;box-shadow:0 2px 6px rgba(15,23,42,.3);pointer-events:none}
        .fb3d-cluster span{display:flex;width:100%;height:100%;align-items:center;justify-content:center;border-radius:9999px;background:#fff;font-size:11px;font-weight:700;color:#1e293b}
      `}</style>
      <div ref={tipRef} className="pointer-events-none absolute z-20 w-max max-w-[260px] rounded-xl bg-slate-900/95 px-3 py-2 text-[11px] text-white shadow-xl" style={{ display: 'none' }}>
        <p data-f="name" className="font-semibold leading-snug" />
        <p data-f="meta" className="text-slate-300" />
        <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
          <dt className="text-slate-400"><T k="의료수익" /></dt><dd data-f="rev" className="text-right" />
          <dt className="text-slate-400"><T k="의료이익" /></dt><dd data-f="profit" className="text-right" />
          <dt className="text-slate-400"><T k="의료이익률" /></dt><dd data-f="margin" className="text-right font-semibold" />
        </dl>
        <p data-f="approx" className="mt-1 text-amber-300" style={{ display: 'none' }}><T k="위치 근사 — 주소 읍면동·시군구 안의 점" /></p>
      </div>
      <div className="absolute right-2 top-2 z-10 flex gap-1">
        <button type="button" className={`${btn} ${view === 'iso' ? 'ring-2 ring-indigo-300' : ''}`} onClick={() => setView('iso')}><T k="비스듬히" /></button>
        <button type="button" className={`${btn} ${view === 'top' ? 'ring-2 ring-indigo-300' : ''}`} onClick={() => setView((v) => (v === 'top' ? 'iso' : 'top'))}><T k="위에서" /></button>
      </div>
      {/* 조작 도구 — 상하좌우 이동 · 확대/축소 · 회전 · 맞춤(키보드: 방향키·+/−) */}
      <div className="absolute bottom-10 right-2 z-10 flex flex-col items-center gap-1.5" data-controls="3d">
        <div className="grid grid-cols-3 gap-1">
          <span />
          <button type="button" className={pad} onClick={() => move((p) => panPose(p, 'up'))} aria-label={tAttr('위로 이동')} title={tAttr('위로 이동')}>▲</button>
          <span />
          <button type="button" className={pad} onClick={() => move((p) => panPose(p, 'left'))} aria-label={tAttr('왼쪽으로 이동')} title={tAttr('왼쪽으로 이동')}>◀</button>
          <button type="button" className={`${pad} text-xs`} onClick={() => { const c = coreRef.current; if (c?.home) c.goal = { pos: c.home.pos.clone(), target: c.home.target.clone() }; }} aria-label={tAttr('전체 맞춤')} title={tAttr('전체 맞춤')}>⤢</button>
          <button type="button" className={pad} onClick={() => move((p) => panPose(p, 'right'))} aria-label={tAttr('오른쪽으로 이동')} title={tAttr('오른쪽으로 이동')}>▶</button>
          <span />
          <button type="button" className={pad} onClick={() => move((p) => panPose(p, 'down'))} aria-label={tAttr('아래로 이동')} title={tAttr('아래로 이동')}>▼</button>
          <span />
        </div>
        <div className="flex gap-1">
          <button type="button" className={pad} onClick={() => move((p) => zoomPose(p, 0.75))} aria-label={tAttr('확대')} title={tAttr('확대')}>+</button>
          <button type="button" className={pad} onClick={() => move((p) => zoomPose(p, 1 / 0.75))} aria-label={tAttr('축소')} title={tAttr('축소')}>−</button>
        </div>
        <div className="flex gap-1">
          <button type="button" className={`${pad} text-xs`} onClick={() => move((p) => rotatePose(p, Math.PI / 8))} aria-label={tAttr('왼쪽으로 회전')} title={tAttr('왼쪽으로 회전')}>⟲</button>
          <button type="button" className={`${pad} text-xs`} onClick={() => move((p) => rotatePose(p, -Math.PI / 8))} aria-label={tAttr('오른쪽으로 회전')} title={tAttr('오른쪽으로 회전')}>⟳</button>
        </div>
      </div>
      <p className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-gray-600 shadow-sm">
        <T k="높이·굵기 = 의료수익 규모(상대값) — 실제 건물 높이가 아닙니다 · 드래그 회전 · 휠 확대 · 오른쪽 도구·방향키로 이동 · 건물을 누르면 분석" />
      </p>
    </div>
  );
}
