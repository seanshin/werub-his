'use client';

/**
 * 층 적층 **WebGL 3D** — three.js 로 확정 도면을 입체로 세운다(2026-09-28 · three 설치 허가 후). 기획 spatial-flow-vision-3d P2.
 *
 * 장면: 층판 + 범주 색 바닥 + 절단 벽(문 자리는 틈) + 수직 코어 + 환자 표식 + 경로 관 · 그림자 · 궤도 카메라.
 * 🔴 정직 표기(2D 와 같은 규칙):
 *   - 벽 높이는 **보기용 절단 높이**다(실제 층고 아님) — 화면 모서리에 말한다.
 *   - 관측 = 채운 파란 구 · 추정 = 빈 회색 고리(기본 꺼짐) — 같은 모양으로 그리지 않는다.
 *   - 합성 도면이면 표식을 지우지 않는다(무대 모서리 띠).
 *   - WebGL 을 만들 수 없으면(구형 단말·GPU 차단) CSS 3D 로 떨어지고 **그 사실을 말한다**(조용히 다른 그림을 그리지 않는다).
 * 3D 는 보조 보기다 — 정보는 전부 2D 평면도에도 있다.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { T } from '@/components/ui/i18n-text';
import type { GeoFloor, GeoSpace, HeatLevel } from './FloorPlanSvg';
import { BED_COLOR, type BedMark } from './bed-marks';
import { FloorStack3D } from './FloorStack3D';
import {
  SCENE_CORE_H, SCENE_FLOOR_GAP, SCENE_OUTER_WALL_H, SCENE_WALL_H, SCENE_WALL_T,
  buildSceneModel, floorElevation, placeAssetMarkers, type AssetMarker, type SceneModel,
} from './space-scene';

const HEAT_COLOR: Record<HeatLevel, string> = { LOW: '#22c55e', MEDIUM: '#eab308', HIGH: '#f97316', CRITICAL: '#ef4444', UNKNOWN: '#9ca3af' };
const EXPLODE = 14; // 선택 층 위쪽을 벌리는 높이(m)
type ViewKey = 'iso' | 'top' | 'front';

interface Props {
  floors: GeoFloor[];
  selectedKey: string | null;
  onSelectFloor: (key: string) => void;
  notice?: string | null;
  /** simulated — 데모 시뮬레이터 위치(실제 위치 아님 · 2026-10-09) */
  patients?: Map<string, { observed: number; inferred: number; simulated?: number }>;
  /** 병상 표식(통합 상황판) — 공간별 병상 상태 · 환자 정보 없음 · 없으면 그리지 않는다 */
  beds?: Map<string, BedMark[]>;
  showInferred?: boolean;
  /** 시뮬레이션(데모) 위치를 그린다 — 보라 반투명 구 · 실제 위치 아님 */
  showSimulated?: boolean;
  heat?: Map<string, HeatLevel>;
  routeByFloor?: Map<string, [number, number][]>;
  /** 방 선택 — 확정 도면이면 누른 지점(층 좌표계 m)도 함께 */
  onSelectSpace?: (s: GeoSpace, point: [number, number]) => void;
  highlightSpaceNodeId?: string | null;
  /** 자산 배치 표식(관리자) — 없으면 그리지 않는다 */
  assets?: AssetMarker[];
  onSelectAsset?: (m: AssetMarker) => void;
  /** 선택한 자산 `${kind}:${assetId}` */
  selectedAssetKey?: string | null;
  /** 배치 후보 방(기존 텍스트에서 찾은 제안) — 노랗게 */
  suggestSpaceNodeIds?: Set<string>;
  /** 배치 중 — 방 위에서 커서가 바뀐다 */
  placing?: boolean;
  /** 이 자산으로 카메라를 옮긴다(목록에서 고를 때) */
  focusAssetKey?: string | null;
  /** 무선 AP(층 좌표 m) — 천장 표식 · 교정 안 된 AP 는 회색 */
  wifiAps?: WifiApMark[];
  /** 무선 측위 점(층 좌표 m) — 오차 반경 원과 함께 · 관측=파랑 · 시뮬레이션=보라 · 추적 중=주황 */
  wifiFixes?: WifiFixMark[];
  /** 추적 환자의 측위 궤적(시간순) — 선으로 */
  wifiTrail?: Array<{ floorKey: string; x: number; y: number }>;
}

export interface WifiApMark { floorKey: string; x: number; y: number; calibrated: boolean }
export interface WifiFixMark { floorKey: string; x: number; y: number; accuracyM: number; simulated: boolean; tracked: boolean }

/** 자산 그룹별 강조색 */
const ASSET_ACCENT: Record<AssetMarker['group'], string> = { MEDICAL_DEVICE: '#0d9488', IT: '#4f46e5', STORAGE: '#d97706', DISPLAY: '#0284c7' };
export const assetKeyOf = (m: Pick<AssetMarker, 'kind' | 'assetId'>) => `${m.kind}:${m.assetId}`;

/** 자산 모형(m) — 그룹별 모양: 의료기기=장비 카트 · IT=책상+모니터 · 보관=선반 · 전광판=기둥 패널 */
function assetModel(m: AssetMarker, alpha: number): THREE.Group {
  const g = new THREE.Group();
  const accent = ASSET_ACCENT[m.group];
  const transparent = alpha < 1;
  const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, transparent, opacity: alpha, ...extra });
  const box = (w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    b.position.set(x, y, z);
    b.castShadow = !transparent;
    g.add(b);
    return b;
  };
  if (m.group === 'IT') {
    if (m.kind === 'CONSENT_DEVICE') {
      box(0.08, 1.0, 0.08, mat('#94a3b8'), 0, 0.5, 0);
      box(0.34, 0.24, 0.03, mat('#0f172a', { emissive: accent, emissiveIntensity: 0.55 }), 0, 1.08, 0).rotation.x = -0.5;
    } else {
      box(1.2, 0.05, 0.6, mat('#e2e8f0'), 0, 0.74, 0);
      for (const sx of [-0.55, 0.55]) box(0.05, 0.72, 0.55, mat('#94a3b8'), sx, 0.37, 0);
      box(0.06, 0.18, 0.06, mat('#334155'), 0, 0.86, -0.12);
      box(0.62, 0.38, 0.04, mat('#0f172a', { emissive: accent, emissiveIntensity: 0.6 }), 0, 1.12, -0.14);
      if (m.kind === 'TERMINAL') box(0.18, 0.4, 0.4, mat('#334155'), 0.42, 0.97, 0.02);
    }
  } else if (m.group === 'MEDICAL_DEVICE') {
    const tall = m.kind === 'DIALYSIS_MACHINE' ? 1.45 : m.kind === 'PHARMACY_DEVICE' ? 1.7 : 1.05;
    box(0.62, tall, 0.52, mat('#f8fafc'), 0, tall / 2 + 0.08, 0);
    box(0.64, 0.1, 0.54, mat(accent), 0, tall + 0.13, 0);
    box(0.4, 0.26, 0.02, mat('#0f172a', { emissive: accent, emissiveIntensity: 0.7 }), 0, tall * 0.72, 0.27);
    for (const [wx, wz] of [[-0.24, -0.2], [0.24, -0.2], [-0.24, 0.2], [0.24, 0.2]] as const) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12), mat('#334155'));
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.05, wz);
      g.add(w);
    }
  } else if (m.group === 'STORAGE') {
    box(1.1, 1.8, 0.45, mat('#fef3c7'), 0, 0.9, 0);
    for (const h of [0.3, 0.75, 1.2, 1.65]) box(1.12, 0.04, 0.47, mat(accent), 0, h, 0);
  } else {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.7, 12), mat('#475569'));
    pole.position.y = 0.85;
    g.add(pole);
    box(1.1, 0.64, 0.06, mat('#0f172a', { emissive: accent, emissiveIntensity: 0.8 }), 0, 1.75, 0);
  }
  // 건물 축척에서 알아보게 조금 키운다(보기용 — 실제 크기 주장 아님)
  g.scale.setScalar(1.25);
  g.traverse((o) => { o.userData.asset = m; });
  return g;
}

interface Core {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  pickables: THREE.Mesh[];
  assetPickables: THREE.Object3D[];
  /** 평면도 좌표 원점 보정(장면 가운데 맞춤) */
  center: [number, number];
  camGoal: { pos: THREE.Vector3; target: THREE.Vector3 } | null;
  frame: number;
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
    if (o instanceof CSS2DObject) o.element.remove();
  });
}

function labelEl(text: string, cls: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  return el;
}

/** 벽 조각 → 상자 형상(병합용) */
function wallBox(x1: number, z1: number, x2: number, z2: number, h: number, t: number, y: number) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const g = new THREE.BoxGeometry(len + t, h, t);
  const horizontal = Math.abs(z1 - z2) < 1e-3;
  if (!horizontal) g.rotateY(Math.PI / 2);
  g.translate((x1 + x2) / 2, y + h / 2, (z1 + z2) / 2);
  return g;
}

function buildContent(model: SceneModel, p: Props, selIdx: number, pickables: THREE.Mesh[], assetPickables: THREE.Object3D[]): THREE.Group {
  const root = new THREE.Group();
  const cx = (model.bounds.minX + model.bounds.maxX) / 2;
  const cz = (model.bounds.minZ + model.bounds.maxZ) / 2;
  root.position.set(-cx, 0, -cz);

  for (const f of model.floors) {
    const sel = f.key === (p.selectedKey ?? '');
    const above = selIdx >= 0 && f.index > selIdx;
    const faint = selIdx >= 0 && !sel;
    const alpha = above ? 0.1 : faint ? 0.35 : 1;
    const y = floorElevation(f.index, selIdx, EXPLODE);
    const g = new THREE.Group();
    g.position.y = y;
    root.add(g);
    const fp = f.footprint;
    const transparent = alpha < 1;

    // 층판
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(fp.w, 0.35, fp.h),
      new THREE.MeshStandardMaterial({ color: sel ? '#c7d2fe' : '#cbd5e1', roughness: 0.9, transparent, opacity: alpha }),
    );
    slab.position.set(fp.x + fp.w / 2, -0.18, fp.y + fp.h / 2);
    slab.receiveShadow = !transparent;
    g.add(slab);

    // 바닥(범주 색 · 혼잡도 덧칠 · 선택 강조)
    for (const r of model.rooms.filter((x) => x.floorKey === f.key)) {
      const heat = r.space.spaceNodeId ? p.heat?.get(r.space.spaceNodeId) : undefined;
      // 조명 아래에서 파스텔이 바래지 않게 범주 테두리색 쪽으로 조금 당긴다(색상은 2D 와 같은 범주)
      const color = new THREE.Color(r.corridor ? '#e7e5e4' : r.fill);
      if (!r.corridor) color.lerp(new THREE.Color(r.edge), 0.18);
      if (heat) color.lerp(new THREE.Color(HEAT_COLOR[heat]), 0.55);
      const hl = !!r.space.spaceNodeId && r.space.spaceNodeId === p.highlightSpaceNodeId;
      const mat = new THREE.MeshStandardMaterial({
        color, roughness: 0.85, transparent, opacity: alpha,
        emissive: hl ? new THREE.Color('#6366f1') : new THREE.Color('#000000'), emissiveIntensity: hl ? 0.6 : 0,
      });
      const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), mat);
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.set(r.x + r.w / 2, 0.01, r.z + r.d / 2);
      floorMesh.receiveShadow = !transparent;
      floorMesh.userData.space = r.space;
      g.add(floorMesh);
      if (sel && !r.corridor) pickables.push(floorMesh);

      // 배치 후보 방(제안) — 노란 반투명 기둥 · 자동 배치는 없다
      if (sel && r.space.spaceNodeId && p.suggestSpaceNodeIds?.has(r.space.spaceNodeId)) {
        const sug = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.9, r.d),
          new THREE.MeshBasicMaterial({ color: '#f59e0b', transparent: true, opacity: 0.28, depthWrite: false }));
        sug.position.set(r.x + r.w / 2, 0.45, r.z + r.d / 2);
        g.add(sug);
      }
      // 선택한 방 — 남색 윤곽 + 반투명 기둥(범주 색 위에서도 보이게)
      if (hl) {
        const ring = [[r.x, r.z], [r.x + r.w, r.z], [r.x + r.w, r.z + r.d], [r.x, r.z + r.d], [r.x, r.z]].map(([a, b]) => new THREE.Vector3(a, 0.06, b));
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineBasicMaterial({ color: '#4f46e5' })));
        const glow = new THREE.Mesh(new THREE.BoxGeometry(r.w, SCENE_WALL_H + 0.6, r.d),
          new THREE.MeshBasicMaterial({ color: '#6366f1', transparent: true, opacity: 0.22, depthWrite: false }));
        glow.position.set(r.x + r.w / 2, (SCENE_WALL_H + 0.6) / 2, r.z + r.d / 2);
        g.add(glow);
      }
      // 통제 구역 — 붉은 테두리
      if (r.space.restricted && !transparent) {
        const pts = [[r.x, r.z], [r.x + r.w, r.z], [r.x + r.w, r.z + r.d], [r.x, r.z + r.d], [r.x, r.z]].map(([a, b]) => new THREE.Vector3(a, 0.03, b));
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#e11d48' })));
      }
      // 수직 코어 — 더 높은 어두운 기둥
      if (r.core) {
        const core = new THREE.Mesh(
          new THREE.BoxGeometry(r.w * 0.92, SCENE_CORE_H, r.d * 0.92),
          new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.6, transparent: true, opacity: alpha * 0.85 }),
        );
        core.position.set(r.x + r.w / 2, SCENE_CORE_H / 2, r.z + r.d / 2);
        core.castShadow = !transparent;
        g.add(core);
      }
      // 방 이름(선택 층만 · 작은 방은 생략)
      if (sel && !r.corridor && !r.core && r.w * r.d >= 22 && Math.min(r.w, r.d) >= 3.5) {
        const el = labelEl(r.space.name, 'space3d-label');
        el.dataset.area = String(r.w * r.d);
        const lbl = new CSS2DObject(el);
        lbl.position.set(r.x + r.w / 2, SCENE_WALL_H + 0.4, r.z + r.d / 2);
        g.add(lbl);
      }
      // 병상 — 방 안쪽 가장자리를 따라 침대 모양 블록(상태 색) · 응급실은 여러 줄
      const bm = r.space.spaceNodeId ? p.beds?.get(r.space.spaceNodeId) : undefined;
      if (bm && bm.length && !above) {
        const perRow = Math.max(1, Math.floor((r.w - 0.8) / 1.3));
        bm.forEach((state, i) => {
          const col = i % perRow, row = Math.floor(i / perRow);
          const bx = r.x + 0.9 + col * 1.3, bz = r.z + r.d - 1.4 - row * 2.3;
          if (bz < r.z + 0.6) return; // 방을 넘치면 그리지 않는다(옆 목록이 전부를 말한다)
          const bed = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 1.9),
            new THREE.MeshStandardMaterial({ color: BED_COLOR[state], roughness: 0.5, transparent, opacity: alpha, emissive: state === 'MISMATCH' ? '#7f1d1d' : '#000000', emissiveIntensity: state === 'MISMATCH' ? 0.5 : 0 }));
          bed.position.set(bx, 0.3, bz);
          bed.castShadow = !transparent;
          g.add(bed);
        });
      }
      // 환자 — 관측=파란 구 · 추정=빈 고리
      const pc = r.space.spaceNodeId ? p.patients?.get(r.space.spaceNodeId) : undefined;
      if (pc && !above) {
        const px = r.x + Math.min(1.2, r.w * 0.25), pz = r.z + Math.min(1.2, r.d * 0.25);
        if (pc.observed > 0) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16),
            new THREE.MeshStandardMaterial({ color: '#2563eb', emissive: '#1d4ed8', emissiveIntensity: 0.35, transparent, opacity: alpha }));
          s.position.set(px, 0.9, pz);
          s.castShadow = !transparent;
          g.add(s);
          if (sel) { const l = new CSS2DObject(labelEl(String(pc.observed), 'space3d-count')); l.position.set(px, 1.9, pz); g.add(l); }
        }
        if (p.showInferred && pc.inferred > 0) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 12, 32),
            new THREE.MeshStandardMaterial({ color: '#64748b', transparent: true, opacity: alpha * 0.9 }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(px + (pc.observed > 0 ? 1.5 : 0), 0.15, pz);
          g.add(ring);
          if (sel) { const l = new CSS2DObject(labelEl(String(pc.inferred), 'space3d-count space3d-count--inferred')); l.position.set(px + (pc.observed > 0 ? 1.5 : 0), 1.0, pz); g.add(l); }
        }
        // 시뮬레이션(데모) — 보라 반투명 구 · 관측·추정과 다른 모양으로(실제 위치처럼 보이지 않게)
        if (p.showSimulated && pc.simulated != null && pc.simulated > 0) {
          const off = (pc.observed > 0 ? 1.5 : 0) + (p.showInferred && pc.inferred > 0 ? 1.5 : 0);
          const s = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 14),
            new THREE.MeshStandardMaterial({ color: '#a855f7', emissive: '#7e22ce', emissiveIntensity: 0.25, transparent: true, opacity: alpha * 0.55 }));
          s.position.set(px + off, 0.8, pz - 0.6);
          g.add(s);
          if (sel) { const l = new CSS2DObject(labelEl(String(pc.simulated), 'space3d-count space3d-count--simulated')); l.position.set(px + off, 1.7, pz - 0.6); g.add(l); }
        }
      }
    }

    // 벽 — 층마다 하나로 병합(그리기 호출을 줄인다)
    const inner = model.walls.filter((w) => w.floorKey === f.key && !w.outer).map((w) => wallBox(w.x1, w.z1, w.x2, w.z2, SCENE_WALL_H, SCENE_WALL_T, 0));
    const outer = model.walls.filter((w) => w.floorKey === f.key && w.outer).map((w) => wallBox(w.x1, w.z1, w.x2, w.z2, SCENE_OUTER_WALL_H, SCENE_WALL_T * 1.8, 0));
    for (const [list, color] of [[inner, '#f8fafc'], [outer, '#e2e8f0']] as const) {
      if (!list.length) continue;
      const merged = mergeGeometries(list as THREE.BufferGeometry[]);
      list.forEach((x) => x.dispose());
      if (!merged) continue;
      const wall = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color, roughness: 0.7, transparent, opacity: alpha }));
      wall.castShadow = !transparent;
      wall.receiveShadow = !transparent;
      g.add(wall);
      if (!transparent) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(merged, 30), new THREE.LineBasicMaterial({ color: '#475569', transparent: true, opacity: 0.55 }));
        g.add(edges);
      }
    }

    // 무선 AP — 천장 높이의 작은 원판(교정됨=남색 · 교정 안 됨=회색) · 위층(투명)은 그리지 않는다
    if (p.wifiAps?.length && !above) {
      for (const a of p.wifiAps.filter((x) => x.floorKey === f.key)) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 20),
          new THREE.MeshStandardMaterial({ color: a.calibrated ? '#3730a3' : '#64748b', transparent, opacity: alpha }));
        disc.position.set(a.x, SCENE_WALL_H - 0.2, a.y);
        g.add(disc);
        if (sel) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, SCENE_WALL_H - 0.3, 6),
            new THREE.MeshBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.5 }));
          pole.position.set(a.x, (SCENE_WALL_H - 0.3) / 2, a.y);
          g.add(pole);
        }
      }
    }
    // 무선 측위 점 — 오차 반경 원(선택 층만 · 근사라는 것을 모양으로 말한다) + 점
    if (p.wifiFixes?.length && !above) {
      for (const w of p.wifiFixes.filter((x) => x.floorKey === f.key)) {
        const color = w.tracked ? '#f59e0b' : w.simulated ? '#a855f7' : '#2563eb';
        if (sel || w.tracked) {
          const disk = new THREE.Mesh(new THREE.CircleGeometry(w.accuracyM, 32),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: w.tracked ? 0.22 : 0.08, depthWrite: false }));
          disk.rotation.x = -Math.PI / 2;
          disk.position.set(w.x, 0.05, w.y);
          g.add(disk);
        }
        const dot = new THREE.Mesh(new THREE.SphereGeometry(w.tracked ? 0.45 : 0.28, 14, 10),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, transparent: true, opacity: (w.simulated && !w.tracked ? 0.6 : 1) * alpha }));
        dot.position.set(w.x, 1.1, w.y);
        g.add(dot);
      }
    }
    // 추적 환자의 측위 궤적
    const trail = p.wifiTrail?.filter((t) => t.floorKey === f.key) ?? [];
    if (trail.length >= 2 && !above) {
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(trail.map((t) => new THREE.Vector3(t.x, 0.6, t.y))),
        new THREE.LineBasicMaterial({ color: '#f59e0b' })));
    }

    // 층 이름표
    const tag = new CSS2DObject(labelEl(sel ? `${f.key}  ${f.title}` : f.key, sel ? 'space3d-floor space3d-floor--sel' : 'space3d-floor'));
    tag.position.set(fp.x - 2, 0.2, fp.y);
    if (above) tag.element.style.opacity = '0.4';
    g.add(tag);

    // 자산 모형 — 선택 층만 누를 수 있다 · 방 단위(좌표 없음)는 방 안 정렬
    if (p.assets?.length && !above) {
      for (const pm of placeAssetMarkers(model.rooms, p.assets).filter((x) => x.floorKey === f.key)) {
        const obj = assetModel(pm.marker, sel ? 1 : alpha);
        obj.position.set(pm.at[0], 0.02, pm.at[1]);
        // 방 안 정렬 배치는 살짝 비스듬히 — 좌표로 놓인 것과 구분되지 않게 하지 않는다: 좌표 배치는 바닥 점을 단다
        if (pm.positioned) {
          const dot = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), new THREE.MeshBasicMaterial({ color: '#0f172a' }));
          dot.rotation.x = -Math.PI / 2;
          dot.position.set(pm.at[0], 0.025, pm.at[1]);
          g.add(dot);
        }
        g.add(obj);
        if (sel) assetPickables.push(obj);
        const selected = p.selectedAssetKey === assetKeyOf(pm.marker);
        if (selected) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 12, 40), new THREE.MeshBasicMaterial({ color: '#6366f1' }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(pm.at[0], 0.06, pm.at[1]);
          g.add(ring);
          const l = new CSS2DObject(labelEl(pm.marker.label, 'space3d-asset'));
          l.position.set(pm.at[0], 2.3, pm.at[1]);
          g.add(l);
        }
      }
    }

    // 경로 — 붉은 관
    const pts = p.routeByFloor?.get(f.key);
    if (pts && pts.length > 1 && !above) {
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 1; i < pts.length; i++) {
        path.add(new THREE.LineCurve3(new THREE.Vector3(pts[i - 1][0], 0.45, pts[i - 1][1]), new THREE.Vector3(pts[i][0], 0.45, pts[i][1])));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(8, pts.length * 6), 0.22, 8, false),
        new THREE.MeshStandardMaterial({ color: '#e11d48', emissive: '#e11d48', emissiveIntensity: 0.5 }));
      g.add(tube);
      for (const [pt, c] of [[pts[0], '#16a34a'], [pts[pts.length - 1], '#e11d48']] as const) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.4 }));
        m.position.set(pt[0], 0.6, pt[1]);
        g.add(m);
      }
    }
  }
  return root;
}

/** 한 지점으로 다가가는 시점 — 지금 보는 방향은 유지하고 거리만 줄인다 */
function closeUp(point: THREE.Vector3, camera: THREE.PerspectiveCamera, controls: OrbitControls) {
  const dir = camera.position.clone().sub(controls.target).normalize();
  const target = point.clone();
  return { pos: target.clone().add(dir.multiplyScalar(18)), target };
}

function viewPose(v: ViewKey, model: SceneModel, selIdx: number) {
  const span = Math.max(model.bounds.maxX - model.bounds.minX, model.bounds.maxZ - model.bounds.minZ);
  const ty = selIdx >= 0 ? floorElevation(selIdx, selIdx, EXPLODE) : (model.floors.length * SCENE_FLOOR_GAP) / 2;
  const target = new THREE.Vector3(0, ty, 0);
  const d = span * 1.45;
  const pos = v === 'top' ? new THREE.Vector3(0.01, ty + d * 1.25, 0.01)
    : v === 'front' ? new THREE.Vector3(0, ty + d * 0.28, d * 1.15)
      : new THREE.Vector3(-d * 0.62, ty + d * 0.72, d * 0.78);
  return { pos, target };
}

export default function FloorStackWebGL(props: Props) {
  const { floors, selectedKey, onSelectFloor, notice } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<Core | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [failed, setFailed] = useState(false);
  const modelRef = useRef<SceneModel | null>(null);
  const sorted = [...floors].sort((a, b) => a.level - b.level);
  const selIdx = sorted.findIndex((f) => f.key === selectedKey);

  // ── 무대(한 번) ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    host.appendChild(renderer.domElement);

    const labels = new CSS2DRenderer();
    labels.domElement.style.position = 'absolute';
    labels.domElement.style.inset = '0';
    labels.domElement.style.pointerEvents = 'none';
    host.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#0b1120', 160, 420);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 15;
    controls.maxDistance = 400;
    controls.addEventListener('start', () => { if (coreRef.current) coreRef.current.camGoal = null; });

    scene.add(new THREE.HemisphereLight('#f1f5f9', '#334155', 1.0));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(-60, 120, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -90; sun.shadow.camera.right = 90; sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
    sun.shadow.camera.far = 400;
    sun.shadow.bias = -0.0004;
    scene.add(sun, sun.target);
    const grid = new THREE.GridHelper(400, 80, '#334155', '#1e293b');
    grid.position.y = -2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    scene.add(grid);

    const content = new THREE.Group();
    scene.add(content);
    const core: Core = { renderer, labels, scene, camera, controls, content, pickables: [], assetPickables: [], center: [0, 0], camGoal: null, frame: 0 };
    coreRef.current = core;

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h);
      labels.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // 방 선택 — 끌기와 구분(움직임 5px 이하만 클릭)
    let down: { x: number; y: number } | null = null;
    const ray = new THREE.Raycaster();
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      // 자산이 방보다 앞이면 자산을 고른다
      const aHit = ray.intersectObjects(core.assetPickables, true)[0];
      const hit = ray.intersectObjects(core.pickables, false)[0];
      if (aHit && (!hit || aHit.distance <= hit.distance)) {
        const m = aHit.object.userData.asset as AssetMarker | undefined;
        if (m) { propsRef.current.onSelectAsset?.(m); return; }
      }
      const sp = hit?.object.userData.space as GeoSpace | undefined;
      if (sp && hit) propsRef.current.onSelectSpace?.(sp, [hit.point.x + core.center[0], hit.point.z + core.center[1]]);
    };
    // 가리키기 — 자산 위에서 이름표 · 방/자산 위에서 커서
    const tip = document.createElement('div');
    tip.className = 'space3d-tip';
    tip.style.display = 'none';
    host.appendChild(tip);
    const onMove = (e: PointerEvent) => {
      if (e.buttons) { tip.style.display = 'none'; return; }
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const aHit = ray.intersectObjects(core.assetPickables, true)[0];
      const m = aHit?.object.userData.asset as AssetMarker | undefined;
      if (m) {
        tip.textContent = m.label;
        tip.style.display = 'block';
        tip.style.left = `${e.clientX - rect.left + 12}px`;
        tip.style.top = `${e.clientY - rect.top + 12}px`;
        renderer.domElement.style.cursor = 'pointer';
        return;
      }
      tip.style.display = 'none';
      const overRoom = ray.intersectObjects(core.pickables, false).length > 0;
      renderer.domElement.style.cursor = overRoom ? (propsRef.current.placing ? 'copy' : 'pointer') : 'grab';
    };
    renderer.domElement.addEventListener('pointermove', onMove);
    // 더블클릭 — 그 지점으로 다가간다(방 안 자산을 보려고)
    const onDbl = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects([...core.assetPickables, ...core.pickables], true)[0];
      if (!hit) return;
      core.camGoal = closeUp(hit.point, camera, controls);
    };
    renderer.domElement.addEventListener('dblclick', onDbl);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    // 이름표 겹침 정리 — 화면 좌표에서 겹치면 면적이 작은 방부터 숨긴다(몇 프레임마다)
    let n = 0;
    const declutter = () => {
      const els = [...labels.domElement.querySelectorAll<HTMLElement>('.space3d-label')];
      els.sort((a, b) => Number(b.dataset.area) - Number(a.dataset.area));
      const kept: DOMRect[] = [];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const hit = kept.some((k) => r.left < k.right + 2 && r.right > k.left - 2 && r.top < k.bottom + 1 && r.bottom > k.top - 1);
        el.style.visibility = hit ? 'hidden' : 'visible';
        if (!hit) kept.push(r);
      }
    };
    const tick = () => {
      core.frame = requestAnimationFrame(tick);
      if (++n % 8 === 0) declutter();
      if (core.camGoal) {
        camera.position.lerp(core.camGoal.pos, 0.08);
        controls.target.lerp(core.camGoal.target, 0.08);
        if (camera.position.distanceTo(core.camGoal.pos) < 0.2) core.camGoal = null;
      }
      controls.update();
      renderer.render(scene, camera);
      labels.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(core.frame);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('dblclick', onDbl);
      tip.remove();
      disposeGroup(content);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
      coreRef.current = null;
    };
  }, []);

  // ── 내용(데이터·선택이 바뀔 때) ──
  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;
    const model = buildSceneModel(floors);
    const firstBuild = modelRef.current == null;
    modelRef.current = model;
    disposeGroup(core.content);
    core.content.clear();
    core.pickables = [];
    core.assetPickables = [];
    core.center = [(model.bounds.minX + model.bounds.maxX) / 2, (model.bounds.minZ + model.bounds.maxZ) / 2];
    core.content.add(buildContent(model, props, selIdx, core.pickables, core.assetPickables));
    const pose = viewPose('iso', model, selIdx);
    if (firstBuild) { core.camera.position.copy(pose.pos); core.controls.target.copy(pose.target); }
    else core.camGoal = { pos: core.camera.position.clone().add(pose.target.clone().sub(core.controls.target)), target: pose.target };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floors, selectedKey, props.beds, props.patients, props.showInferred, props.showSimulated, props.heat, props.routeByFloor, props.highlightSpaceNodeId, props.assets, props.selectedAssetKey, props.suggestSpaceNodeIds, props.wifiAps, props.wifiFixes, props.wifiTrail]);

  // 목록에서 자산을 고르면 그 자산으로 다가간다
  useEffect(() => {
    const core = coreRef.current;
    if (!core || !props.focusAssetKey) return;
    const obj = core.assetPickables.find((o) => assetKeyOf(o.userData.asset as AssetMarker) === props.focusAssetKey);
    if (!obj) return;
    const wp = new THREE.Vector3();
    obj.getWorldPosition(wp);
    core.camGoal = closeUp(wp, core.camera, core.controls);
  }, [props.focusAssetKey]);

  const setView = (v: ViewKey) => {
    const core = coreRef.current, model = modelRef.current;
    if (!core || !model) return;
    core.camGoal = viewPose(v, model, selIdx);
  };

  if (failed) {
    return (
      <div className="space-y-2">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          <T k="이 기기에서 WebGL 3D 를 만들 수 없어 간이 3D(CSS)로 보여줍니다." />
          {props.beds && <> <T k="간이 3D 에는 병상 표식이 없습니다 — 옆 목록을 보십시오." /></>}
        </p>
        <FloorStack3D floors={floors} selectedKey={selectedKey} onSelectFloor={onSelectFloor} notice={notice}
          patients={props.patients} showInferred={props.showInferred} heat={props.heat} routeByFloor={props.routeByFloor} />
      </div>
    );
  }

  return (
    <div className="relative h-[620px] w-full overflow-hidden rounded-2xl border border-slate-800"
      style={{ background: 'radial-gradient(ellipse at 50% 30%, #1e293b 0%, #0f172a 55%, #020617 100%)' }}>
      <style>{`
        .space3d-label{font:600 10.5px/1.2 ui-sans-serif,system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;color:#0f172a;
          padding:1px 6px;border-radius:6px;background:rgba(255,255,255,.82);box-shadow:0 1px 3px rgba(0,0,0,.25);white-space:nowrap;pointer-events:none}
        .space3d-count{font:700 11px/1 ui-sans-serif,system-ui,sans-serif;color:#fff;background:#2563eb;padding:3px 6px;border-radius:999px;border:1.5px solid #fff;pointer-events:none}
        .space3d-count--inferred{background:#fff;color:#334155;border:1.5px dashed #64748b}
        .space3d-count--simulated{background:#f5f3ff;color:#6b21a8;border:1.5px dotted #a855f7}
        .space3d-floor{font:700 12px/1 ui-sans-serif,system-ui,sans-serif;color:#e2e8f0;background:#334155;padding:4px 8px;border-radius:6px;white-space:nowrap;pointer-events:none}
        .space3d-asset{font:700 11px/1.2 ui-sans-serif,system-ui,sans-serif;color:#fff;background:#4f46e5;padding:3px 8px;border-radius:8px;white-space:nowrap;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.4)}
        .space3d-tip{position:absolute;z-index:5;font:600 11px/1.2 ui-sans-serif,system-ui,sans-serif;color:#0f172a;background:#fff;padding:4px 8px;border-radius:8px;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.35);white-space:nowrap}
        .space3d-floor--sel{background:#6366f1;color:#fff;box-shadow:0 0 14px rgba(99,102,241,.8)}
      `}</style>
      <div ref={hostRef} className="absolute inset-0" style={{ touchAction: 'none' }} />

      {/* 시점 프리셋 */}
      <div className="absolute left-3 top-3 flex overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
        {(['iso', 'top', 'front'] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className="min-h-[36px] px-3 text-[11px] font-medium text-slate-200 hover:bg-white/10">
            {v === 'iso' ? <T k="비스듬히" /> : v === 'top' ? <T k="위에서" /> : <T k="앞에서" />}
          </button>
        ))}
      </div>

      {/* 층 패널 — 엘리베이터처럼 위층이 위 */}
      <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-1 rounded-2xl border border-white/10 bg-white/5 p-1.5 backdrop-blur">
        {[...sorted].reverse().map((f) => (
          <button key={f.key} onClick={() => onSelectFloor(f.key)} aria-pressed={selectedKey === f.key}
            className={`min-h-[40px] min-w-[48px] rounded-xl text-xs font-bold transition ${selectedKey === f.key ? 'bg-indigo-500 text-white shadow-[0_0_16px_rgba(99,102,241,0.7)]' : 'text-slate-300 hover:bg-white/10'}`}>
            {f.key}
          </button>
        ))}
      </div>

      {/* 합성 표식(지우지 않는다) · 절단 벽 고지 */}
      {notice && (
        <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-rose-600/90 px-2 py-1 text-[11px] font-semibold text-white"><T k={notice} /></p>
      )}
      <div className="pointer-events-none absolute bottom-3 left-3 space-y-1">
        <p className="rounded-md bg-black/40 px-2 py-1 text-[10px] text-slate-300"><T k="벽은 속이 보이게 낮춘 단면입니다(실제 층고 아님) · 드래그 회전 · 휠 확대 · 방을 누르면 선택 · 더블클릭하면 다가감" /></p>
      </div>
    </div>
  );
}
