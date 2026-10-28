import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SpaceModelService, validateSpaceImport } from '../../src/modules/space-model/space-model.service';

/**
 * 공간 도면 가져오기(P1) — 기획 spatial-flow-vision-3d.
 *
 *   ① 실제 합성 도면 정답은 시드 공간 모델에 대해 오류 0 으로 검증된다(대조군)
 *   ② 겹침·층 어긋남·없는 코드·끊긴 출입구·중복 코드 → 오류(확정 불가)
 *   ③ 합성 도면은 REAL 에서 올리지도 확정하지도 못한다
 *   ④ 확정: 오류 있으면 거부 · 매핑된 노드에만 rect·기하 출처(SYNTHETIC) · 이전 확정본 SUPERSEDED·좌표 회수 · 초안만 확정
 */

const FIX = JSON.parse(readFileSync(join(__dirname, '../../prisma/fixtures/floorplans-synthetic/space-import.v1.json'), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(FIX));

/** 정답에서 시드 공간 모델을 재구성(층 노드 + 매핑된 구역) — 실제 seed 코드·층과 같다(합성 도면 가드가 대조) */
function seedNodes() {
  const nodes: any[] = [];
  let i = 0;
  for (const F of FIX.floors) {
    nodes.push({ id: `f-${F.key}`, code: F.spaceNodeCode, nodeType: 'FLOOR', floor: F.level, name: F.title, isActive: true, metadata: null });
    for (const s of F.spaces) if (s.spaceNodeCode)
      nodes.push({ id: `n-${++i}`, code: s.spaceNodeCode, nodeType: 'ZONE', floor: F.level, name: s.name, isActive: true, metadata: { bounds: { x: 0 } } });
  }
  return nodes;
}

describe('① 대조군 — 합성 도면 정답은 오류 0', () => {
  it('오류 0 · 매핑 63 · 주출입구 있음(경고 없음)', () => {
    const v = validateSpaceImport(FIX, seedNodes());
    expect(v.errors).toEqual([]);
    expect(v.totals.mapped).toBe(63);
    expect(v.totals.entrances).toBeGreaterThanOrEqual(4);
    expect(v.warnings).toEqual([]);
  });
});

describe('② 결함 → 오류', () => {
  it('겹침', () => {
    const p = clone();
    p.floors[1].spaces[1].rect = { ...p.floors[1].spaces[2].rect };
    expect(validateSpaceImport(p, seedNodes()).errors.some((e) => e.code === 'OVERLAP')).toBe(true);
  });
  it('공간 코드의 층이 공간 모델과 다름', () => {
    const p = clone();
    const s = p.floors[2].spaces.find((x: any) => x.spaceNodeCode);
    const code = s.spaceNodeCode;
    s.spaceNodeCode = null;
    p.floors[1].spaces.find((x: any) => !x.spaceNodeCode).spaceNodeCode = code;
    expect(validateSpaceImport(p, seedNodes()).errors.some((e) => e.code === 'SPACE_FLOOR_MISMATCH' && e.value === code)).toBe(true);
  });
  it('없는 층 코드 · 없는 공간 코드 · 중복 코드', () => {
    const p = clone();
    p.floors[0].spaceNodeCode = 'NOPE';
    p.floors[1].spaces[0].spaceNodeCode = 'NOPE-ZONE';
    const dupCode = p.floors[2].spaces.find((x: any) => x.spaceNodeCode).spaceNodeCode;
    p.floors[2].spaces.find((x: any) => !x.spaceNodeCode && x.type !== 'CORRIDOR').spaceNodeCode = dupCode;
    const errs = validateSpaceImport(p, seedNodes()).errors;
    expect(errs).toContainEqual(expect.objectContaining({ code: 'FLOOR_CODE_UNKNOWN', value: 'NOPE' }));
    expect(errs).toContainEqual(expect.objectContaining({ code: 'SPACE_CODE_UNKNOWN', value: 'NOPE-ZONE' }));
    expect(errs).toContainEqual(expect.objectContaining({ code: 'DUP_CODE', value: dupCode }));
  });
  it('출입구가 그래프에 없음 · 수직 연결이 끊김', () => {
    const p = clone();
    p.entrances[0].nodeId = 'ghost';
    p.verticalEdges[0].to = 'ghost2';
    const codes = validateSpaceImport(p, seedNodes()).errors.map((e) => e.code);
    expect(codes).toContain('ENTRANCE_BROKEN');
    expect(codes).toContain('VERTICAL_BROKEN');
  });
  it('도면에 없는 구역은 경고(확정은 된다)', () => {
    const nodes = [...seedNodes(), { id: 'extra', code: 'F2-NEW', nodeType: 'ZONE', floor: 2, name: '신설실', isActive: true, metadata: null }];
    const v = validateSpaceImport(FIX, nodes);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toContainEqual(expect.objectContaining({ code: 'MISSING_ZONES', floor: '2F', names: ['신설실'] }));
  });
});

function fakeService(opts: { mode?: string; imports?: any[] }) {
  const nodes = seedNodes();
  const imports: any[] = opts.imports ?? [];
  const nodeUpdates: any[] = [];
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    spaceImport: {
      findMany: vi.fn(async ({ where }: any) => imports.filter((x) => x.status === where.status)),
      updateMany: vi.fn(async ({ where, data }: any) => { for (const x of imports) if (where.id.in.includes(x.id)) Object.assign(x, data); return { count: 1 }; }),
      update: vi.fn(async ({ where, data }: any) => { const x = imports.find((y) => y.id === where.id); Object.assign(x, data); return x; }),
    },
    spaceNode: { update: vi.fn(async (a: any) => { nodeUpdates.push(a); const n = nodes.find((x) => x.id === a.where.id); n.metadata = a.data.metadata; return n; }) },
  };
  const prisma: any = {
    spaceNode: { findMany: vi.fn(async () => nodes) },
    spaceImport: {
      findUnique: vi.fn(async ({ where }: any) => imports.find((x) => x.id === where.id) ?? null),
      create: vi.fn(async ({ data }: any) => { const x = { id: `imp-${imports.length + 1}`, ...data }; imports.push(x); return x; }),
    },
    $transaction: async (cb: any) => cb(tx),
  };
  const mode: any = { effective: vi.fn(async () => opts.mode ?? 'REHEARSAL') };
  return { svc: new SpaceModelService(prisma, mode), imports, nodes, nodeUpdates };
}

describe('③ 합성 도면 — REAL 에서 막는다', () => {
  it('올리기 거부 · 대조군 REHEARSAL 은 초안으로 저장', async () => {
    await expect(fakeService({ mode: 'REAL' }).svc.create('t', FIX, 'u')).rejects.toMatchObject({ response: { code: 'SYNTHETIC_IN_REAL' } });
    const ok = fakeService({});
    const r = await ok.svc.create('t', FIX, 'u');
    expect(r).toMatchObject({ source: 'SYNTHETIC', status: 'DRAFT' });
  });
  it('확정 시점에도 REAL 이면 거부', async () => {
    const f = fakeService({ mode: 'REAL', imports: [{ id: 'i1', status: 'DRAFT', source: 'SYNTHETIC', payload: FIX }] });
    await expect(f.svc.confirm('i1', 'u')).rejects.toMatchObject({ response: { code: 'SYNTHETIC_IN_REAL' } });
  });
});

describe('④ 확정', () => {
  it('오류가 있으면 거부 · 초안이 아니면 거부', async () => {
    const bad = clone();
    bad.floors[0].spaceNodeCode = 'NOPE';
    const f = fakeService({ imports: [{ id: 'i1', status: 'DRAFT', source: 'SYNTHETIC', payload: bad }, { id: 'i2', status: 'CONFIRMED', source: 'SYNTHETIC', payload: FIX }] });
    await expect(f.svc.confirm('i1', 'u')).rejects.toMatchObject({ response: { code: 'IMPORT_INVALID' } });
    await expect(f.svc.confirm('i2', 'u')).rejects.toMatchObject({ response: { code: 'IMPORT_NOT_DRAFT' } });
  });

  it('매핑 노드에 rect·SYNTHETIC 을 새기고 이전 확정본을 대체·회수한다', async () => {
    const f = fakeService({ imports: [{ id: 'old', status: 'CONFIRMED', source: 'SYNTHETIC', payload: FIX }, { id: 'new', status: 'DRAFT', source: 'SYNTHETIC', payload: FIX }] });
    // 이전 확정본이 새긴 좌표가 있는 노드 하나
    const zone = f.nodes.find((n) => n.code === 'F2-LAB');
    zone.metadata = { bounds: { x: 1 }, rect: { x: 9, y: 9, w: 1, h: 1 }, geometrySource: 'SYNTHETIC', importId: 'old' };
    const r = await f.svc.confirm('new', 'admin');
    expect(r).toMatchObject({ status: 'CONFIRMED', appliedNodes: 63, superseded: 1 });
    expect(f.imports.find((x) => x.id === 'old').status).toBe('SUPERSEDED');
    const lab = FIX.floors.find((F: any) => F.key === '2F').spaces.find((s: any) => s.spaceNodeCode === 'F2-LAB');
    expect(zone.metadata).toMatchObject({ rect: lab.rect, geometrySource: 'SYNTHETIC', importId: 'new', bounds: { x: 1 } });
    // 층 노드·매핑 안 된 공간은 건드리지 않는다
    expect(f.nodeUpdates.every((u) => !String(u.where.id).startsWith('f-'))).toBe(true);
  });
});

describe('⑤ P2 — 철회·REAL 보호', () => {
  it('철회: 확정본만 · 그 도면이 새긴 좌표만 회수(격자 bounds 는 남김) · WITHDRAWN', async () => {
    const f = fakeService({ imports: [{ id: 'cur', status: 'CONFIRMED', source: 'SYNTHETIC', payload: FIX }, { id: 'd', status: 'DRAFT', source: 'SYNTHETIC', payload: FIX }] });
    const a = f.nodes.find((n) => n.code === 'F2-LAB');
    a.metadata = { bounds: { x: 1 }, rect: { x: 1, y: 1, w: 1, h: 1 }, geometrySource: 'SYNTHETIC', importId: 'cur' };
    const b = f.nodes.find((n) => n.code === 'F2-IMG');
    b.metadata = { rect: { x: 2, y: 2, w: 1, h: 1 }, geometrySource: 'SYNTHETIC', importId: 'other' };
    const r = await f.svc.withdraw('cur', '시연 종료');
    expect(r).toMatchObject({ status: 'WITHDRAWN', clearedNodes: 1 });
    expect(a.metadata).toEqual({ bounds: { x: 1 }, geometrySource: 'GRID_AUTO' });
    expect(b.metadata.importId).toBe('other'); // 다른 도면 좌표는 건드리지 않는다
    await expect(f.svc.withdraw('d', '사유')).rejects.toMatchObject({ response: { code: 'IMPORT_NOT_CONFIRMED' } });
  });

  it('REAL 로 전환된 뒤 남은 합성 확정본은 기하로 내려보내지 않는다(대조: REHEARSAL 은 내려보낸다)', async () => {
    const mk = (mode: string) => {
      const f = fakeService({ mode });
      (f.svc as any).prisma.spaceImport.findFirst = vi.fn(async () => ({ id: 'x', status: 'CONFIRMED', source: 'SYNTHETIC', payload: FIX, confirmedAt: new Date() }));
      return f.svc;
    };
    expect(await mk('REAL').geometry()).toBeNull();
    const g = await mk('REHEARSAL').geometry();
    expect(g).toMatchObject({ synthetic: true, notice: expect.stringContaining('실제 건물 아님') });
    expect(g!.floors).toHaveLength(7);
    expect(JSON.stringify(g)).not.toContain('"graph"'); // 뷰어 기하에 동선 그래프를 싣지 않는다
  });
});
