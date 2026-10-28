import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRouteGraph, centerNodeOf, describeRoute, findRoute } from './space-route';
import type { SpaceImportV1 } from './space-geometry';

/** 길안내 정본(P3) — 합성 도면 정답(apps/api/prisma/fixtures)으로 돌린다 */
const P = JSON.parse(readFileSync(join(__dirname, '../../../apps/api/prisma/fixtures/floorplans-synthetic/space-import.v1.json'), 'utf8')) as SpaceImportV1;
const g = buildRouteGraph(P);
const MAIN = P.entrances!.find((e) => e.main)!.nodeId;
const to = (code: string) => centerNodeOf(g, code)!;
const kinds = (path: string[]) => path.slice(1).map((id, i) => g.adj.get(path[i])!.find((e) => e.to === id)!.kind);

describe('길안내 경로 정본', () => {
  it('휠체어 경로는 엘리베이터만 — 에스컬레이터·계단 간선이 없다(대조: 일반 경로는 에스컬레이터를 쓴다)', () => {
    const acc = findRoute(g, [MAIN], [to('F2-IM-201')], { accessibleOnly: true })!;
    expect(kinds(acc.path)).toContain('ELEVATOR');
    expect(kinds(acc.path).some((k) => k === 'STAIR' || k === 'ESCALATOR')).toBe(false);
    const any = findRoute(g, [MAIN], [to('F2-IM-201')])!;
    expect(kinds(any.path)).toContain('ESCALATOR');
    expect(any.walkM).toBeLessThan(acc.walkM);
  });

  it('환자 경로는 통제 구역을 지나지 않는다 — 수술실은 직원 경로로만', () => {
    expect(findRoute(g, [MAIN], [to('F1-OR1')])).toBeNull();
    const staff = findRoute(g, [MAIN], [to('F1-OR1')], { allowRestricted: true });
    expect(staff).not.toBeNull();
  });

  it('통제 구역이 아닌 매핑 구역은 전부 주출입구에서 휠체어로 닿는다', () => {
    const miss: string[] = [];
    for (const F of P.floors) for (const s of F.spaces)
      if (s.spaceNodeCode && !s.restricted && !findRoute(g, [MAIN], [to(s.spaceNodeCode)], { accessibleOnly: true })) miss.push(s.name);
    expect(miss).toEqual([]);
  });

  it('단계: 출발 공간 이름 · 연속 엘리베이터 이동은 한 단계 · 도착 · 층별 경로 점', () => {
    const r = findRoute(g, [MAIN], [to('F6-601')], { accessibleOnly: true })!;
    const d = describeRoute(g, r.path);
    expect(d.steps[0]).toMatchObject({ kind: 'START', space: '주출입구 풍제실' });
    const vert = d.steps.filter((s) => s.kind === 'VERTICAL');
    expect(vert).toHaveLength(1);
    expect(vert[0]).toMatchObject({ mode: 'ELEVATOR', fromFloor: '1F', toFloor: '6F' });
    expect(d.steps[d.steps.length - 1]).toMatchObject({ kind: 'ARRIVE', floor: '6F', space: '601호' });
    expect(d.segments.map((s) => s.floor)).toEqual(['1F', '2F', '3F', '4F', '5F', '6F']);
  });

  it('없는 노드는 null(지어내지 않는다)', () => {
    expect(findRoute(g, ['ghost'], [to('F2-IM-201')])).toBeNull();
    expect(centerNodeOf(g, 'NOPE')).toBeNull();
  });
});
