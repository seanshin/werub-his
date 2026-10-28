/**
 * 합성 평면도 정답 데이터(space-import.v1) 계약 — 기획 spatial-flow-vision-3d §10 P1.
 *
 * 🔴 이 도면은 실제 건물이 아니다. 여기서 지키는 것은 "정답이 스스로 모순되지 않는가"와
 *    "시드 SpaceNode 와 갈라지지 않았는가" 두 가지다 — 시드 구역을 바꾸면 도면도 다시 만들어야 한다
 *    (`node scripts/floorplan/generate-synthetic-floorplans.mjs`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_KINDS } from '@hospital-run/shared';

const DIR = join(__dirname, '../../prisma/fixtures/floorplans-synthetic');
const truth = JSON.parse(readFileSync(join(DIR, 'space-import.v1.json'), 'utf8'));

function seedZones(): Map<string, number> {
  const src = readFileSync(join(__dirname, '../../prisma/seed.ts'), 'utf8');
  const start = src.indexOf('const spaceData = [');
  const block = src.slice(start, src.indexOf('];', start));
  const out = new Map<string, number>();
  for (const m of block.matchAll(/code: '([^']+)', nodeType: 'ZONE'[^\n]*?floor: (-?\d+)/g)) out.set(m[1], Number(m[2]));
  return out;
}

type Rect = { x: number; y: number; w: number; h: number };
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

describe('합성 평면도 정답(space-import.v1)', () => {
  it('합성임을 스스로 밝힌다', () => {
    expect(truth.schema).toBe('space-import.v1');
    expect(truth.synthetic).toBe(true);
    expect(truth.notice).toContain('실제 건물 아님');
  });

  it('시드 SpaceNode ZONE 과 코드·층이 정확히 일치한다(누락·초과·층 어긋남 0)', () => {
    const seed = seedZones();
    expect(seed.size).toBeGreaterThan(50); // 추출 정규식이 빗나가 0 대 0 으로 통과하는 것을 막는다
    const mapped = new Map<string, number>();
    for (const f of truth.floors) for (const s of f.spaces) if (s.spaceNodeCode) {
      expect(mapped.has(s.spaceNodeCode)).toBe(false);
      mapped.set(s.spaceNodeCode, f.level);
    }
    expect([...mapped.entries()].sort()).toEqual([...seed.entries()].sort());
  });

  it('층마다 공간이 겹치지 않고 외곽 안에 있다', () => {
    for (const f of truth.floors) {
      const fp = f.footprint;
      for (const s of f.spaces) {
        expect(s.rect.x).toBeGreaterThanOrEqual(fp.x - 1e-6);
        expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(fp.x + fp.w + 1e-6);
      }
      for (let i = 0; i < f.spaces.length; i++)
        for (let j = i + 1; j < f.spaces.length; j++)
          expect(overlap(f.spaces[i].rect, f.spaces[j].rect), `${f.key} ${f.spaces[i].name}↔${f.spaces[j].name}`).toBeLessThan(0.01);
    }
  });

  it('문·간선이 없는 공간·노드를 가리키지 않는다', () => {
    const nodeIds = new Set<string>();
    for (const f of truth.floors) {
      const ids = new Set(f.spaces.map((s: { id: string }) => s.id));
      for (const c of f.connections) for (const b of c.between) if (b !== null) expect(ids.has(b)).toBe(true);
      for (const n of f.graph.nodes) nodeIds.add(n.id);
    }
    for (const f of truth.floors) for (const e of f.graph.edges) {
      expect(nodeIds.has(e.from) && nodeIds.has(e.to)).toBe(true);
      expect(e.distanceM).toBeGreaterThanOrEqual(0);
    }
    for (const e of truth.verticalEdges) expect(nodeIds.has(e.from) && nodeIds.has(e.to)).toBe(true);
  });

  it('주출입구에서 엘리베이터(접근성 간선)만으로 모든 공간에 닿는다 — 계단·에스컬레이터 제외', () => {
    const adj = new Map<string, string[]>();
    const add = (a: string, b: string) => adj.set(a, [...(adj.get(a) ?? []), b]);
    const edges = [...truth.floors.flatMap((f: { graph: { edges: unknown[] } }) => f.graph.edges), ...truth.verticalEdges] as {
      from: string; to: string; accessible: boolean;
    }[];
    for (const e of edges) if (e.accessible) { add(e.from, e.to); add(e.to, e.from); }
    const f1 = truth.floors.find((f: { key: string }) => f.key === '1F');
    const start = `${f1.spaces.find((s: { name: string }) => s.name === '주출입구 풍제실').id}:c`;
    const seen = new Set([start]);
    const q = [start];
    while (q.length) for (const m of adj.get(q.shift()!) ?? []) if (!seen.has(m)) { seen.add(m); q.push(m); }
    const unreached = truth.floors.flatMap((f: { spaces: { id: string; name: string; type: string }[] }) =>
      f.spaces.filter((s) => s.type !== 'SHAFT' && s.type !== 'CORRIDOR' && !seen.has(`${s.id}:c`)).map((s) => s.name));
    expect(unreached).toEqual([]);
    // 대조군: 계단·에스컬레이터는 접근성 간선이 아니다
    expect(truth.verticalEdges.filter((e: { kind: string; accessible: boolean }) => e.kind !== 'ELEVATOR' && e.accessible)).toEqual([]);
  });

  it('도면 파일이 층마다 있다(기본 도면 + 장비·단말 배치도)', () => {
    for (const f of truth.floors)
      for (const file of [f.files.svg, f.files.png, f.files.assetsSvg, f.files.assetsPng]) expect(existsSync(join(DIR, file)), file).toBe(true);
  });

  it('가상 자산 배치: 종류는 shared 정본 어휘 · 좌표는 자기 공간 안 · id 는 SYN- 로 실자산과 구분', () => {
    let n = 0;
    for (const f of truth.floors) {
      const byId = new Map(f.spaces.map((s: { id: string; rect: Rect }) => [s.id, s]));
      for (const a of f.assets) {
        n++;
        expect(ASSET_KINDS as readonly string[]).toContain(a.kind);
        expect(a.id).toMatch(/^SYN-/);
        const sp = byId.get(a.spaceId) as { rect: Rect } | undefined;
        expect(sp, a.id).toBeTruthy();
        const r = sp!.rect;
        expect(a.at[0] > r.x && a.at[0] < r.x + r.w && a.at[1] > r.y && a.at[1] < r.y + r.h, `${a.id} ${a.label}`).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(100); // 레이어가 조용히 비지 않았다
  });
});
