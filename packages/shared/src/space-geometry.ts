/**
 * 공간 기하 — 가져오기 형식(space-import.v1)·기하 출처·경로 계산 정본 (기획 `spatial-flow-vision-3d.plan.md` P1~P3)
 *
 * 🔴 기하 출처는 신뢰 단계가 다르다:
 *    GRID_AUTO(격자 자동배치 — 모양만) < SYNTHETIC(합성 도면 — 실제 건물 아님 · 시연 전용) < DRAWING_CONFIRMED(실도면을 사람이 확정) · SURVEYED(실측)
 *    합성 도면은 **운영 모드 REAL 에서 적용할 수 없다** — 지어낸 건물 위에 실환자 길안내를 그리지 않는다.
 *    합성 기하로 그리는 모든 화면·안내에는 `SYNTHETIC_GEOMETRY_NOTICE` 를 붙인다.
 */

export const GEOMETRY_SOURCES = ['GRID_AUTO', 'SYNTHETIC', 'DRAWING_DRAFT', 'DRAWING_CONFIRMED', 'SURVEYED'] as const;
export type GeometrySource = (typeof GEOMETRY_SOURCES)[number];

export const SYNTHETIC_GEOMETRY_NOTICE = '합성 도면 — 실제 건물 아님(시연용 가상병원 배치)';

/** 가져오기 출처 — payload.synthetic=true 면 SYNTHETIC */
export const SPACE_IMPORT_SOURCES = ['SYNTHETIC', 'DRAWING'] as const;
export type SpaceImportSource = (typeof SPACE_IMPORT_SOURCES)[number];
export const SPACE_IMPORT_STATUSES = ['DRAFT', 'CONFIRMED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN'] as const;
export type SpaceImportStatus = (typeof SPACE_IMPORT_STATUSES)[number];
export const SPACE_IMPORT_STATUS_LABEL: Record<SpaceImportStatus, string> = {
  DRAFT: '초안', CONFIRMED: '확정(사용 중)', REJECTED: '반려', SUPERSEDED: '대체됨', WITHDRAWN: '철회됨',
};

/** 확정 시 공간 노드에 새기는 기하 출처 */
export function geometrySourceForImport(source: SpaceImportSource): GeometrySource {
  return source === 'SYNTHETIC' ? 'SYNTHETIC' : 'DRAWING_CONFIRMED';
}

// ── space-import.v1 (생성기 `scripts/floorplan/generate-synthetic-floorplans.mjs` 가 쓰는 형식) ──
export interface SpaceRect { x: number; y: number; w: number; h: number }
export interface SpaceImportSpace {
  id: string;
  spaceNodeCode: string | null;
  name: string;
  number: string | null;
  type: string;
  rect: SpaceRect;
  areaM2?: number;
  capacity?: number | null;
  open: boolean;
  restricted: boolean;
  radiationShielded?: boolean;
  verticalCore?: string | null;
}
export interface SpaceImportConnection {
  id: string;
  kind: 'DOOR' | 'OPENING' | 'EXTERIOR';
  at: [number, number];
  widthM: number;
  between: [string, string | null];
  restricted: boolean;
}
export interface GraphNode { id: string; at: [number, number]; kind: string; spaceId: string | null }
export interface GraphEdge { from: string; to: string; kind: string; distanceM: number; accessible: boolean; restricted: boolean }
export interface SpaceImportFloor {
  key: string;
  spaceNodeCode: string;
  level: number;
  title: string;
  elevationM: number;
  heightM: number;
  footprint: SpaceRect;
  gridY?: number[];
  spaces: SpaceImportSpace[];
  connections: SpaceImportConnection[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  assets?: unknown[];
}
export interface SpaceImportEntrance { id: string; floor: string; spaceId: string; name: string; nodeId: string; main: boolean; restricted: boolean }
export interface SpaceImportV1 {
  schema: 'space-import.v1';
  synthetic?: boolean;
  notice?: string;
  hospitalCode?: string;
  building?: { code: string; name: string; gridX?: number[] };
  floors: SpaceImportFloor[];
  vertical?: unknown[];
  verticalEdges: GraphEdge[];
  entrances?: SpaceImportEntrance[];
}

/** 두 사각형 겹침 면적(㎡) */
export function rectOverlapArea(a: SpaceRect, b: SpaceRect): number {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}

/** 층 표식 — 지하 B1, 지상 1F */
export function floorLabelOf(level: number | null | undefined): string | null {
  if (level == null) return null;
  return level < 0 ? `B${-level}` : `${level}F`;
}
