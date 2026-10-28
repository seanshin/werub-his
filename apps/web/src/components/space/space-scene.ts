/**
 * 확정 도면 기하 → 3D 장면 기술자(순수 함수 · WebGL 없음) — 기획 spatial-flow-vision-3d §8 "장면을 만드는 순수 함수를 테스트한다".
 *
 * 좌표: 평면도 x → 3D x · 평면도 y → 3D z · 층 → 3D y(층 높이 × 순서). 단위 m.
 * 🔴 지어내지 않는다: 벽은 **닫힌 방의 경계**에서만 만들고(열린 공간·복도는 벽 없음), 문 틈은 도면의 문(DOOR·EXTERIOR) 자리에만 낸다.
 *    벽 높이는 실측이 아니라 **보기용 절단 높이**다(속이 보이게 낮춘 단면) — 화면이 그렇게 말한다.
 */
import { SPACE_CATEGORY_STYLE, spaceCategoryOf, type GeoFloor, type GeoSpace, type SpaceCategory } from './FloorPlanSvg';

/** 층 간 간격(m) — 보기용 */
export const SCENE_FLOOR_GAP = 6;
/** 절단 벽 높이(m) — 속이 보이게 낮춘 단면(실제 층고 아님) */
export const SCENE_WALL_H = 1.4;
export const SCENE_OUTER_WALL_H = 1.8;
export const SCENE_CORE_H = 3.2;
export const SCENE_WALL_T = 0.16;

export interface SceneRoom {
  space: GeoSpace;
  floorKey: string;
  category: SpaceCategory;
  fill: string;
  edge: string;
  /** 바닥 사각형(m) — x·z 는 왼쪽 위 모서리 */
  x: number; z: number; w: number; d: number;
  core: boolean;
  corridor: boolean;
}
export interface SceneWall { floorKey: string; x1: number; z1: number; x2: number; z2: number; outer: boolean }
export interface SceneFloor { key: string; level: number; index: number; title: string; footprint: GeoFloor['footprint'] }

export interface SceneModel {
  floors: SceneFloor[];
  rooms: SceneRoom[];
  walls: SceneWall[];
  /** 건물 전체 외곽(m) */
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
}

const EPS = 0.05;
/** 변 비교 키 — cm 단위 정수로(같은 변을 두 방이 공유하면 한 번만 세운다) */
const cm = (v: number) => Math.trunc(v * 100 + (v >= 0 ? 0.5 : -0.5));
const key4 = (a: number, b: number, c: number, d: number) => [a, b, c, d].map(cm).join(',');

/**
 * 한 선분에서 문 자리를 빼고 남은 조각들 — 문은 선분 위(거리 0.3m 이내)·범위 안에 있는 것만.
 * 🔴 문 폭을 모르면(0 이하) 0.9m 로 두지 않고 그 문은 **틈을 내지 않는다**(지어낸 폭으로 벽을 뚫지 않는다).
 */
export function cutDoors(seg: { x1: number; z1: number; x2: number; z2: number }, doors: { at: [number, number]; widthM: number }[]) {
  const horizontal = Math.abs(seg.z1 - seg.z2) < EPS;
  const [a0, a1] = horizontal ? [Math.min(seg.x1, seg.x2), Math.max(seg.x1, seg.x2)] : [Math.min(seg.z1, seg.z2), Math.max(seg.z1, seg.z2)];
  const fixed = horizontal ? seg.z1 : seg.x1;
  // 문마다 자기 폭으로 틈을 낸다
  const doorGaps = doors
    .filter((d) => d.widthM > 0 && Math.abs((horizontal ? d.at[1] : d.at[0]) - fixed) <= 0.3)
    .map((d) => { const c = horizontal ? d.at[0] : d.at[1]; return [c - d.widthM / 2, c + d.widthM / 2] as [number, number]; })
    .filter(([s, e]) => e > a0 + EPS && s < a1 - EPS)
    .sort((p, q) => p[0] - q[0]);
  const out: { x1: number; z1: number; x2: number; z2: number }[] = [];
  let cur = a0;
  for (const [s, e] of doorGaps) {
    if (s > cur + EPS) out.push(horizontal ? { x1: cur, z1: fixed, x2: Math.min(s, a1), z2: fixed } : { x1: fixed, z1: cur, x2: fixed, z2: Math.min(s, a1) });
    cur = Math.max(cur, e);
  }
  if (a1 > cur + EPS) out.push(horizontal ? { x1: cur, z1: fixed, x2: a1, z2: fixed } : { x1: fixed, z1: cur, x2: fixed, z2: a1 });
  return out;
}

export function buildSceneModel(floors: GeoFloor[]): SceneModel {
  const sorted = [...floors].sort((a, b) => a.level - b.level);
  const rooms: SceneRoom[] = [];
  const walls: SceneWall[] = [];
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;

  for (const f of sorted) {
    const fp = f.footprint;
    minX = Math.min(minX, fp.x); minZ = Math.min(minZ, fp.y); maxX = Math.max(maxX, fp.x + fp.w); maxZ = Math.max(maxZ, fp.y + fp.h);
    const doors = f.connections.filter((c) => c.kind !== 'OPENING').map((c) => ({ at: c.at, widthM: c.widthM }));
    for (const s of f.spaces) {
      const category = spaceCategoryOf(s.type);
      const st = SPACE_CATEGORY_STYLE[category];
      rooms.push({
        space: s, floorKey: f.key, category, fill: st.fill, edge: st.edge,
        x: s.rect.x, z: s.rect.y, w: s.rect.w, d: s.rect.h,
        core: category === 'CORE', corridor: s.type === 'CORRIDOR',
      });
    }
    // 방 벽 — 닫힌 방만 · 이웃 방과 겹치는 변은 한 번만
    const seen = new Set<string>();
    for (const s of f.spaces) {
      if (s.open || s.type === 'CORRIDOR') continue;
      const { x, y, w, h } = s.rect;
      const edges = [
        { x1: x, z1: y, x2: x + w, z2: y }, { x1: x, z1: y + h, x2: x + w, z2: y + h },
        { x1: x, z1: y, x2: x, z2: y + h }, { x1: x + w, z1: y, x2: x + w, z2: y + h },
      ];
      for (const e of edges) {
        const k = key4(e.x1, e.z1, e.x2, e.z2);
        if (seen.has(k)) continue;
        seen.add(k);
        // 외곽선 위의 변은 외벽이 대신한다
        const onOuter = (Math.abs(e.z1 - e.z2) < EPS && (Math.abs(e.z1 - fp.y) < EPS || Math.abs(e.z1 - (fp.y + fp.h)) < EPS))
          || (Math.abs(e.x1 - e.x2) < EPS && (Math.abs(e.x1 - fp.x) < EPS || Math.abs(e.x1 - (fp.x + fp.w)) < EPS));
        if (onOuter) continue;
        for (const piece of cutDoors(e, doors)) walls.push({ floorKey: f.key, ...piece, outer: false });
      }
    }
    // 외벽 — 외부 출입구(EXTERIOR)·문 자리만 틈
    const outer = [
      { x1: fp.x, z1: fp.y, x2: fp.x + fp.w, z2: fp.y }, { x1: fp.x, z1: fp.y + fp.h, x2: fp.x + fp.w, z2: fp.y + fp.h },
      { x1: fp.x, z1: fp.y, x2: fp.x, z2: fp.y + fp.h }, { x1: fp.x + fp.w, z1: fp.y, x2: fp.x + fp.w, z2: fp.y + fp.h },
    ];
    for (const e of outer) for (const piece of cutDoors(e, doors)) walls.push({ floorKey: f.key, ...piece, outer: true });
  }

  return {
    floors: sorted.map((f, index) => ({ key: f.key, level: f.level, index, title: f.title, footprint: f.footprint })),
    rooms,
    walls,
    bounds: { minX, minZ, maxX, maxZ },
  };
}

/** 층 기준 높이(m) — 선택 층 위쪽은 벌린다(분해도) */
export function floorElevation(index: number, selectedIndex: number, explode: number): number {
  return index * SCENE_FLOOR_GAP + (selectedIndex >= 0 && index > selectedIndex ? explode : 0);
}

/**
 * 방 안 자동 정렬 — 좌표가 없는(방 단위) 배치를 방 안에 격자로 늘어놓는다.
 * 🔴 이 점들은 **위치가 아니다**(보기용 정렬) — 좌표가 기록된 배치만 그 지점에 그린다(호출부가 가른다).
 */
export function arrangeInRoom(rect: { x: number; y: number; w: number; h: number }, n: number): [number, number][] {
  if (n <= 0) return [];
  const margin = Math.min(0.9, Math.min(rect.w, rect.h) * 0.18);
  const iw = Math.max(0.1, rect.w - margin * 2), ih = Math.max(0.1, rect.h - margin * 2);
  // 방 비율에 맞춰 열 수를 고른다(긴 쪽으로 더 많이)
  const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt((n * iw) / ih))));
  const rows = Math.ceil(n / cols);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    out.push([rect.x + margin + (iw * (c + 0.5)) / cols, rect.y + margin + (ih * (r + 0.5)) / rows]);
  }
  return out;
}

export interface AssetMarker {
  /** 원장 배치 id(자체 테이블 배치는 null) */
  placementId: string | null;
  kind: string;
  assetId: string;
  group: 'MEDICAL_DEVICE' | 'IT' | 'STORAGE' | 'DISPLAY';
  label: string;
  spaceNodeId: string;
  /** 기록된 좌표(층 좌표계 m) — 없으면 null(방 단위) */
  x: number | null;
  y: number | null;
}

/** 자산 표식의 3D 위치 — 좌표가 있으면 그 지점, 없으면 방 안 정렬(`positioned:false`) */
export function placeAssetMarkers(
  rooms: Pick<SceneRoom, 'space' | 'floorKey' | 'x' | 'z' | 'w' | 'd'>[],
  markers: AssetMarker[],
): Array<{ marker: AssetMarker; floorKey: string; at: [number, number]; positioned: boolean }> {
  const bySpace = new Map(rooms.filter((r) => r.space.spaceNodeId).map((r) => [r.space.spaceNodeId as string, r]));
  const out: Array<{ marker: AssetMarker; floorKey: string; at: [number, number]; positioned: boolean }> = [];
  const loose = new Map<string, AssetMarker[]>();
  for (const m of markers) {
    const room = bySpace.get(m.spaceNodeId);
    if (!room) continue; // 도면에 없는 공간(층 단위 배치 등) — 3D 에 그리지 않는다(수는 부모가 말한다)
    if (m.x != null && m.y != null) out.push({ marker: m, floorKey: room.floorKey, at: [m.x, m.y], positioned: true });
    else loose.set(m.spaceNodeId, [...(loose.get(m.spaceNodeId) ?? []), m]);
  }
  for (const [sid, list] of loose) {
    const room = bySpace.get(sid)!;
    const pts = arrangeInRoom({ x: room.x, y: room.z, w: room.w, h: room.d }, list.length);
    list.forEach((m, i) => out.push({ marker: m, floorKey: room.floorKey, at: pts[i], positioned: false }));
  }
  return out;
}
