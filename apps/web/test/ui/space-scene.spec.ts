import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSceneModel, cutDoors, floorElevation, SCENE_FLOOR_GAP } from '../../src/components/space/space-scene';
import type { GeoFloor } from '../../src/components/space/FloorPlanSvg';

/**
 * 3D 장면 기술자(순수 함수) — 기획 spatial-flow-vision-3d §8 "WebGL 렌더가 아니라 장면을 만드는 함수를 테스트한다".
 * 🔴 지어내지 않는다: 벽은 닫힌 방에서만 · 문 틈은 도면의 문 자리에만(폭 모르면 틈 없음) · 공유 변은 한 번.
 */
const sp = (id: string, type: string, x: number, y: number, w: number, h: number, open = false) =>
  ({ id, name: id, number: null, type, rect: { x, y, w, h }, open, restricted: false, verticalCore: null, spaceNodeId: `n-${id}` });
const F: GeoFloor = {
  key: '1F', level: 1, title: '1층', footprint: { x: 0, y: 0, w: 20, h: 10 }, spaceNodeId: null,
  spaces: [
    sp('A', 'CLINIC', 0, 0, 10, 5),
    sp('B', 'CLINIC', 10, 0, 10, 5),   // A 와 x=10 변을 공유
    sp('C', 'CORRIDOR', 0, 5, 20, 2),
    sp('D', 'WAITING', 0, 7, 20, 3, true), // 열린 공간 — 벽 없음
  ],
  connections: [
    { id: 'd1', kind: 'DOOR', at: [5, 5], widthM: 1.2, restricted: false },   // A 아래 변
    { id: 'd0', kind: 'DOOR', at: [15, 5], widthM: 0, restricted: false },    // 폭 모름 → 틈 없음
    { id: 'o1', kind: 'OPENING', at: [10, 7], widthM: 4, restricted: false }, // 개구부는 문 아님
  ],
};

describe('buildSceneModel', () => {
  const m = buildSceneModel([F]);
  const inner = m.walls.filter((w) => !w.outer);
  it('닫힌 방만 벽 · 공유 변은 한 번 · 외곽선 위 변은 외벽이 대신', () => {
    // A: 아래 변(z=5)·오른쪽 변(x=10) / B: 아래 변(z=5) — 위·바깥 변은 외곽선
    const vertical10 = inner.filter((w) => Math.abs(w.x1 - 10) < 1e-6 && Math.abs(w.x2 - 10) < 1e-6);
    expect(vertical10).toHaveLength(1);
    expect(inner.every((w) => !(w.z1 >= 7 && w.z2 >= 7))).toBe(true); // 열린 대기실 경계에 벽 없음
  });
  it('문 자리에 문 폭만큼 틈 · 폭 0 인 문은 틈을 내지 않는다', () => {
    const aBottom = inner.filter((w) => Math.abs(w.z1 - 5) < 1e-6 && w.x2 <= 10 + 1e-6);
    expect(aBottom.map((w) => [w.x1, w.x2])).toEqual([[0, 4.4], [5.6, 10]]);
    const bBottom = inner.filter((w) => Math.abs(w.z1 - 5) < 1e-6 && w.x1 >= 10 - 1e-6);
    expect(bBottom.map((w) => [w.x1, w.x2])).toEqual([[10, 20]]);
  });
  it('외벽 4변 · 범주 색 · 복도 표식 · 외곽', () => {
    expect(m.walls.filter((w) => w.outer)).toHaveLength(4);
    expect(m.rooms.find((r) => r.space.id === 'A')!.category).toBe('CLINIC');
    expect(m.rooms.find((r) => r.space.id === 'C')!.corridor).toBe(true);
    expect(m.bounds).toEqual({ minX: 0, minZ: 0, maxX: 20, maxZ: 10 });
  });
});

describe('cutDoors · floorElevation', () => {
  it('세로 변에서도 틈 · 범위 밖 문은 무시', () => {
    expect(cutDoors({ x1: 3, z1: 0, x2: 3, z2: 10 }, [{ at: [3, 5], widthM: 2 }, { at: [3, 30], widthM: 2 }]))
      .toEqual([{ x1: 3, z1: 0, x2: 3, z2: 4 }, { x1: 3, z1: 6, x2: 3, z2: 10 }]);
  });
  it('선택 층 위쪽만 벌린다', () => {
    expect(floorElevation(1, 1, 10)).toBe(SCENE_FLOOR_GAP);
    expect(floorElevation(2, 1, 10)).toBe(2 * SCENE_FLOOR_GAP + 10);
    expect(floorElevation(2, -1, 10)).toBe(2 * SCENE_FLOOR_GAP);
  });
});

describe('배선', () => {
  const viewer = readFileSync(join(__dirname, '../../src/components/space/SpaceViewer.tsx'), 'utf8');
  const gl = readFileSync(join(__dirname, '../../src/components/space/FloorStackWebGL.tsx'), 'utf8');
  it('three 는 3D 를 열 때만(동적 import · 서버 렌더 제외)', () => {
    expect(viewer).toMatch(/dynamic\(\(\) => import\('\.\/FloorStackWebGL'\), \{ ssr: false/);
    expect(viewer).not.toMatch(/from 'three'/);
  });
  it('🔴 WebGL 을 못 만들면 CSS 3D 로 떨어지고 그 사실을 말한다 · 절단 벽 고지 · 합성 표식', () => {
    expect(gl).toMatch(/catch \{\s*setFailed\(true\)/);
    expect(gl).toMatch(/<FloorStack3D /);
    expect(gl).toMatch(/실제 층고 아님/);
    expect(gl).toMatch(/\{notice && /);
  });
});

import { arrangeInRoom, placeAssetMarkers, type AssetMarker } from '../../src/components/space/space-scene';
import { placementMarkers } from '../../src/components/space/AssetPlacementPanel';

describe('자산 표식 배치(3D)', () => {
  const m = buildSceneModel([F]);
  const mk = (id: string, sid: string, x: number | null = null, y: number | null = null): AssetMarker =>
    ({ placementId: `p${id}`, kind: 'EQUIPMENT', assetId: id, group: 'MEDICAL_DEVICE', label: id, spaceNodeId: sid, x, y });
  it('방 안 정렬 — 전부 방 안(여백) · 서로 다른 점', () => {
    const pts = arrangeInRoom({ x: 0, y: 0, w: 10, h: 5 }, 5);
    expect(pts).toHaveLength(5);
    for (const [x, y] of pts) { expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(10); expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(5); }
    expect(new Set(pts.map((p) => p.join(','))).size).toBe(5);
    expect(arrangeInRoom({ x: 0, y: 0, w: 4, h: 4 }, 0)).toEqual([]);
  });
  it('🔴 좌표가 있으면 그 지점(positioned) · 없으면 방 안 정렬(positioned:false) · 도면에 없는 공간은 그리지 않는다', () => {
    const out = placeAssetMarkers(m.rooms, [mk('a', 'n-A'), mk('b', 'n-A'), mk('c', 'n-B', 12.5, 2.5), mk('d', 'n-없음')]);
    expect(out).toHaveLength(3);
    const c = out.find((o) => o.marker.assetId === 'c')!;
    expect(c).toMatchObject({ positioned: true, at: [12.5, 2.5], floorKey: '1F' });
    for (const o of out.filter((x) => x.marker.spaceNodeId === 'n-A')) {
      expect(o.positioned).toBe(false);
      expect(o.at[0]).toBeGreaterThan(0); expect(o.at[0]).toBeLessThan(10);
    }
  });
  it('원장 행 → 표식: 공간·자산 없는 행 제외 · 그룹은 shared 정본', () => {
    const rows: any[] = [
      { placementId: 'p1', kind: 'TERMINAL', kindLabel: '', source: 'MANUAL', asset: { id: 't1', label: 'PC-1', detail: null }, space: { id: 'n-A', name: 'A', floor: 1 }, x: null, y: null, placedAt: null },
      { placementId: 'p2', kind: 'EQUIPMENT', kindLabel: '', source: 'MANUAL', asset: null, space: { id: 'n-A', name: 'A', floor: 1 }, x: null, y: null, placedAt: null },
    ];
    expect(placementMarkers(rows)).toEqual([{ placementId: 'p1', kind: 'TERMINAL', assetId: 't1', group: 'IT', label: 'PC-1', spaceNodeId: 'n-A', x: null, y: null }]);
  });
});

describe('배치 편집 배선', () => {
  const panel = readFileSync(join(__dirname, '../../src/components/space/AssetPlacementPanel.tsx'), 'utf8');
  const viewer = readFileSync(join(__dirname, '../../src/components/space/SpaceViewer.tsx'), 'utf8');
  it('🔴 합성 도면이면 좌표를 보내지 않는다(방 단위) · 기존 원장 EP 만 쓴다', () => {
    expect(panel).toMatch(/synthetic \|\| !pickedPoint \? \{\} : \{ x: pickedPoint\[0\], y: pickedPoint\[1\] \}/);
    expect(panel).toMatch(/'\/api\/v1\/space-assets\/placements'/);
    expect(panel).toMatch(/\/api\/v1\/space-assets\/placements\/\$\{placementId\}\/end/);
  });
  it('🔴 배치 종료는 사유 2자 이상 · 자체 테이블 자산(NATIVE)은 바꾸지 않는다', () => {
    expect(panel).toMatch(/endReason\.trim\(\)\.length < 2/);
    expect(panel).toMatch(/selectedAsset\.placementId \? \(/);
  });
  it('편집 패널·버튼은 관리자에게만(원장 API 가 관리자 전용)', () => {
    expect(viewer).toMatch(/\{editAssets && isAdmin && \(/);
    expect(viewer).toMatch(/\{isAdmin && <Pill on=\{editAssets\}/);
  });
});
