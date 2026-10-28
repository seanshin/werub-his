/**
 * 길안내 경로 — 정본 하나(서버·앱이 같은 함수) · 기획 `spatial-flow-vision-3d.plan.md` P3
 *
 * 입력은 확정 도면(space-import.v1)의 동선 그래프(층별 간선 + 수직 연결)다.
 * 🔴 규칙:
 *   - 휠체어·유모차(accessibleOnly) = 엘리베이터만(계단·에스컬레이터 간선 제외).
 *   - 환자 경로는 출입 통제 간선(수술부 청결복도·직원 구역 문 등)을 지나지 않는다 — 직원 도구만 allowRestricted.
 *   - 안내 문장은 만들지 않는다 — **구조화된 단계**(걷기·수직 이동·도착)만 낸다. 문장은 화면이 조립한다(서버 조립 한국어 금지).
 *   - 수직 이동 비용은 시간 추정이 아니라 **경로 선택용 가중치**다(엘리베이터 대기 등을 모른다 — 걸음 시간을 지어내지 않는다).
 */
import type { SpaceImportV1 } from './space-geometry';

/** 경로 선택 가중치(m 환산) — 시간이 아니다 */
export const ROUTE_VERTICAL_WEIGHT = { ELEVATOR: 25, STAIR: 15, ESCALATOR: 12 } as const;

export interface RouteNode { id: string; at: [number, number]; floor: string; spaceId: string | null }
export interface RouteEdgeRef { to: string; kind: string; distanceM: number; accessible: boolean; restricted: boolean }
export interface RouteGraph {
  nodes: Map<string, RouteNode>;
  adj: Map<string, RouteEdgeRef[]>;
  /** spaceId → 공간 이름·층 */
  spaces: Map<string, { name: string; floor: string; spaceNodeCode: string | null; restricted: boolean; verticalCore: string | null }>;
  floorOrder: string[];
}

export function buildRouteGraph(p: SpaceImportV1): RouteGraph {
  const nodes = new Map<string, RouteNode>();
  const adj = new Map<string, RouteEdgeRef[]>();
  const spaces: RouteGraph['spaces'] = new Map();
  const add = (a: string, e: RouteEdgeRef) => { if (!adj.has(a)) adj.set(a, []); adj.get(a)!.push(e); };
  for (const F of p.floors) {
    for (const s of F.spaces) spaces.set(s.id, { name: s.name, floor: F.key, spaceNodeCode: s.spaceNodeCode, restricted: s.restricted, verticalCore: s.verticalCore ?? null });
    for (const n of F.graph.nodes) nodes.set(n.id, { id: n.id, at: n.at, floor: F.key, spaceId: n.spaceId });
    for (const e of F.graph.edges) {
      add(e.from, { to: e.to, kind: e.kind, distanceM: e.distanceM, accessible: e.accessible, restricted: e.restricted });
      add(e.to, { to: e.from, kind: e.kind, distanceM: e.distanceM, accessible: e.accessible, restricted: e.restricted });
    }
  }
  for (const e of p.verticalEdges ?? []) {
    add(e.from, { to: e.to, kind: e.kind, distanceM: e.distanceM, accessible: e.accessible, restricted: e.restricted });
    add(e.to, { to: e.from, kind: e.kind, distanceM: e.distanceM, accessible: e.accessible, restricted: e.restricted });
  }
  return { nodes, adj, spaces, floorOrder: [...p.floors].sort((a, b) => a.level - b.level).map((f) => f.key) };
}

const edgeCost = (e: RouteEdgeRef) =>
  e.kind in ROUTE_VERTICAL_WEIGHT ? ROUTE_VERTICAL_WEIGHT[e.kind as keyof typeof ROUTE_VERTICAL_WEIGHT] : e.distanceM;

/** 다익스트라(다중 출발·도착) — 없으면 null */
export function findRoute(
  g: RouteGraph,
  from: string[],
  to: string[],
  opts: { accessibleOnly?: boolean; allowRestricted?: boolean } = {},
): { path: string[]; walkM: number } | null {
  const target = new Set(to.filter((t) => g.nodes.has(t)));
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const open: Array<[number, string]> = [];
  for (const f of from) if (g.nodes.has(f)) { dist.set(f, 0); open.push([0, f]); }
  if (!open.length || !target.size) return null;
  const done = new Set<string>();
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]);
    const [d, u] = open.shift()!;
    if (done.has(u)) continue;
    done.add(u);
    if (target.has(u)) {
      const path = [u];
      while (prev.has(path[0])) path.unshift(prev.get(path[0])!);
      // 걸은 거리(수평 간선 합) — 수직 이동은 거리로 세지 않는다
      let walkM = 0;
      for (let i = 1; i < path.length; i++) {
        const e = g.adj.get(path[i - 1])!.find((x) => x.to === path[i])!;
        if (!(e.kind in ROUTE_VERTICAL_WEIGHT)) walkM += e.distanceM;
      }
      return { path, walkM };
    }
    for (const e of g.adj.get(u) ?? []) {
      if (opts.accessibleOnly && !e.accessible) continue;
      if (!opts.allowRestricted && e.restricted) continue;
      const nd = d + edgeCost(e);
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, u); open.push([nd, e.to]); }
    }
  }
  return null;
}

export type RouteStep =
  | { kind: 'START'; floor: string; space: string }
  | { kind: 'WALK'; floor: string; through: string[]; distanceM: number }
  | { kind: 'VERTICAL'; mode: 'ELEVATOR' | 'STAIR' | 'ESCALATOR'; fromFloor: string; toFloor: string; core: string | null }
  | { kind: 'ARRIVE'; floor: string; space: string };

/** 경로 → 층별 경로 점 + 구조화된 안내 단계 */
export function describeRoute(g: RouteGraph, path: string[]): { steps: RouteStep[]; segments: Array<{ floor: string; points: [number, number][] }> } {
  const steps: RouteStep[] = [];
  const segments: Array<{ floor: string; points: [number, number][] }> = [];
  const nameOf = (id: string | null) => (id ? g.spaces.get(id)?.name ?? null : null);
  const first = g.nodes.get(path[0])!;
  const last = g.nodes.get(path[path.length - 1])!;
  // 출발점이 문·출입구 지점이면 공간이 없다 — 경로상 첫 공간 이름을 쓴다
  const firstSpace = path.map((id) => g.nodes.get(id)!.spaceId).find((x) => x) ?? null;
  steps.push({ kind: 'START', floor: first.floor, space: nameOf(firstSpace) ?? '' });
  let walk: { floor: string; through: string[]; distanceM: number } | null = null;
  let seg: { floor: string; points: [number, number][] } | null = null;
  const flushWalk = () => { if (walk && (walk.distanceM > 0 || walk.through.length)) steps.push({ kind: 'WALK', ...walk }); walk = null; };
  for (let i = 0; i < path.length; i++) {
    const n = g.nodes.get(path[i])!;
    if (!seg || seg.floor !== n.floor) { seg = { floor: n.floor, points: [] }; segments.push(seg); }
    seg.points.push(n.at);
    if (i === 0) continue;
    const e = g.adj.get(path[i - 1])!.find((x) => x.to === path[i])!;
    if (e.kind in ROUTE_VERTICAL_WEIGHT) {
      flushWalk();
      const from = g.nodes.get(path[i - 1])!;
      const coreSpace = from.spaceId ? g.spaces.get(from.spaceId) : undefined;
      // 연속된 같은 수직 이동(엘리베이터로 여러 층)은 한 단계로 합친다
      const lastStep = steps[steps.length - 1];
      if (lastStep && lastStep.kind === 'VERTICAL' && lastStep.mode === e.kind && lastStep.toFloor === from.floor) lastStep.toFloor = n.floor;
      else steps.push({ kind: 'VERTICAL', mode: e.kind as 'ELEVATOR' | 'STAIR' | 'ESCALATOR', fromFloor: from.floor, toFloor: n.floor, core: coreSpace?.verticalCore ?? null });
    } else {
      if (!walk) walk = { floor: n.floor, through: [], distanceM: 0 };
      walk.distanceM += e.distanceM;
      const nm = nameOf(n.spaceId);
      if (nm && walk.through[walk.through.length - 1] !== nm && nm !== nameOf(last.spaceId)) walk.through.push(nm);
    }
  }
  flushWalk();
  steps.push({ kind: 'ARRIVE', floor: last.floor, space: nameOf(last.spaceId) ?? '' });
  return { steps, segments };
}

/** SpaceNode 코드 → 그 공간 중심 노드 id(생성기 규약 `<spaceId>:c`) */
export function centerNodeOf(g: RouteGraph, spaceNodeCode: string): string | null {
  for (const [id, s] of g.spaces) if (s.spaceNodeCode === spaceNodeCode) return g.nodes.has(`${id}:c`) ? `${id}:c` : null;
  return null;
}
