import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SpaceAssetService,
  coordinateRejection,
  legacyTextMatches,
  suggestNodes,
} from '../../src/modules/space-asset/space-asset.service';
import { ASSET_LOADERS } from '../../src/modules/space-asset/asset-adapters';

/**
 * 공간 자산 배치 원장 — 기획 spatial-flow-vision-3d §5-A.
 *
 * 못박는 것:
 *   ① 자산당 활성 배치 하나 — 이동은 이전 배치를 MOVED 로 끝내고 연다(이력 보존) · 같은 위치 재전송은 변경 없음.
 *   ② 잠금 키는 (종류, 자산) 단위 — withAdvisoryLock 실모양(`$transaction` + `$executeRaw`).
 *   ③ 좌표는 도면 확정 구역에서만 — GRID_AUTO·출처 없음·경계 밖은 거부(지어낸 좌표 금지).
 *   ④ 자기 테이블이 위치를 가진 종류(QR 스테이션)는 원장에 쓰지 않는다 — 정본 둘 금지.
 *   ⑤ 어댑터는 비밀값(전광판 API 키·단말 IP/MAC/비콘·스테이션 keyHash)을 싣지 않는다 — 목이 원값을 줘도.
 *   ⑥ 배치율 분모=활성 자산 · 분모 0 이면 null · 폐기 자산은 분모에서 빠진다.
 *   ⑦ 원장이 가리키는 자산 행이 사라져도 숨기지 않는다(assetMissing).
 */

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const USER = U(900);

const FLOOR2 = { id: U(1), parentId: null, nodeType: 'FLOOR', name: '2층 외래', code: '2f', floor: 2, roomNumber: null, spaceType: 'FLOOR', isActive: true, metadata: null };
const LAB = { id: U(2), parentId: U(1), nodeType: 'ZONE', name: '채혈실/검사실', code: 'F2-LAB', floor: 2, roomNumber: null, spaceType: 'LAB', isActive: true, metadata: { geometrySource: 'GRID_AUTO', bounds: { x: 0, y: 0, w: 4, h: 3 } } };
const IMG = { id: U(3), parentId: U(1), nodeType: 'ZONE', name: '영상실 (X-ray/CT)', code: 'F2-IMG', floor: 2, roomNumber: null, spaceType: 'IMAGING', isActive: true, metadata: { geometrySource: 'DRAWING_CONFIRMED', rect: { x: 0, y: 32.4, w: 12.6, h: 8 } } };
const CLINIC = { id: U(4), parentId: U(1), nodeType: 'ZONE', name: '내과 1진료실', code: 'F2-IM-201', floor: 2, roomNumber: '201', spaceType: 'CLINIC', isActive: true, metadata: null };
const BLDG = { id: U(5), parentId: null, nodeType: 'BUILDING', name: '본관', code: 'MAIN', floor: null, roomNumber: null, spaceType: 'BUILDING', isActive: true, metadata: null };

function fakePrisma() {
  const placements: any[] = [];
  const locks: string[] = [];
  let seq = 100;
  const nodes = [FLOOR2, LAB, IMG, CLINIC, BLDG];
  // 🔴 자산 원행은 비밀 필드까지 통째로 준다 — 어댑터가 select 를 무시해도 비밀이 새지 않는지 본다
  const equipment = [
    { id: U(10), name: '초음파 진단기', assetNumber: 'EQ-001', category: '진단장비', model: 'LOGIQ', status: 'ACTIVE', location: '2층 채혈실' },
    { id: U(11), name: '구형 X-ray', assetNumber: 'EQ-002', category: '진단장비', model: null, status: 'RETIRED', location: '1층 영상의학과' },
  ];
  const terminals = [{ id: U(20), label: null, deviceUuid: 'abcdef-123456', ipAddress: '10.0.0.7', macAddress: 'AA:BB', beaconId: 'BEACON-9', mode: 'PUBLIC', status: 'ACTIVE', location: '내과 1진료실' }];
  const boxes = [{ id: U(30), name: '2층 대기 TV', key: 'SECRET-API-KEY', isActive: true }];
  const stations = [{ id: U(40), label: '채혈실 QR', deviceType: 'TABLET', keyHash: 'deadbeef', isActive: true, zoneId: U(2) }];
  const byIds = (rows: any[]) => async ({ where }: any = {}) => (where?.id?.in ? rows.filter((r) => where.id.in.includes(r.id)) : rows);
  const match = (p: any, w: any = {}) =>
    (w.endedAt === undefined || (w.endedAt === null ? p.endedAt == null : true)) &&
    (!w.assetKind || p.assetKind === w.assetKind) &&
    (!w.assetId || p.assetId === w.assetId) &&
    (!w.spaceNodeId || (w.spaceNodeId.in ? w.spaceNodeId.in.includes(p.spaceNodeId) : p.spaceNodeId === w.spaceNodeId));
  const ap = {
    findMany: async ({ where, orderBy }: any = {}) => {
      const rows = placements.filter((p) => match(p, where)).map((p) => ({ ...p }));
      if (orderBy?.placedAt) rows.sort((x, y) => (orderBy.placedAt === 'desc' ? -1 : 1) * (x.placedAt.getTime() - y.placedAt.getTime()));
      return rows;
    },
    findFirst: async ({ where }: any) => { const r = placements.find((p) => match(p, where)); return r ? { ...r } : null; },
    findUnique: async ({ where }: any) => { const r = placements.find((p) => p.id === where.id); return r ? { ...r } : null; },
    create: async ({ data }: any) => { const r = { id: U(++seq), placedAt: new Date(Date.UTC(2026, 8, 28, 0, 0, seq)), endedAt: null, endedById: null, endReason: null, ...data }; placements.push(r); return { ...r }; },
    update: async ({ where, data }: any) => { const r = placements.find((p) => p.id === where.id); Object.assign(r, data); return { ...r }; },
  };
  const tx = {
    assetPlacement: ap,
    $executeRaw: async (_s: TemplateStringsArray, key: string) => { locks.push(key); return 1; },
  };
  const prisma: any = {
    assetPlacement: ap,
    spaceNode: { findMany: async () => nodes, findUnique: async ({ where }: any) => nodes.find((n) => n.id === where.id) ?? null },
    equipment: { findMany: byIds(equipment) },
    labInstrument: { findMany: async () => [] },
    dialysisMachine: { findMany: async () => [] },
    pharmacyDevice: { findMany: async () => [] },
    consentSigningDevice: { findMany: async () => [] },
    terminalRegistry: { findMany: byIds(terminals) },
    workstationProfile: { findMany: async () => [] },
    inventoryStorage: { findMany: async () => [] },
    displayApiKey: { findMany: byIds(boxes) },
    locationStation: { findMany: byIds(stations) },
    $transaction: async (cb: any) => cb(tx),
  };
  return { prisma, placements, locks, equipment };
}

describe('공간 자산 배치 원장', () => {
  let f: ReturnType<typeof fakePrisma>;
  let svc: SpaceAssetService;
  beforeEach(() => { f = fakePrisma(); svc = new SpaceAssetService(f.prisma); });

  it('① 배치 → 같은 위치 재전송은 변경 없음 → 이동은 이전 배치를 MOVED 로 끝낸다(활성 하나)', async () => {
    const a = await svc.place({ kind: 'EQUIPMENT', assetId: U(10), spaceNodeId: LAB.id, source: 'MANUAL' }, USER);
    expect(a.changed).toBe(true);
    expect(a.placement.legacyTextAtPlacement).toBe('2층 채혈실');
    const again = await svc.place({ kind: 'EQUIPMENT', assetId: U(10), spaceNodeId: LAB.id, source: 'MANUAL' }, USER);
    expect(again.changed).toBe(false);
    expect(f.placements).toHaveLength(1);

    const moved = await svc.place({ kind: 'EQUIPMENT', assetId: U(10), spaceNodeId: CLINIC.id, source: 'MANUAL' }, USER);
    expect(moved.changed).toBe(true);
    expect(moved.movedFrom).toBe(LAB.id);
    expect(f.placements.filter((p) => p.endedAt == null)).toHaveLength(1);
    expect(f.placements.find((p) => p.spaceNodeId === LAB.id)).toMatchObject({ endReason: 'MOVED', endedById: USER });
    expect((await svc.history('EQUIPMENT', U(10))).map((h) => h.space?.name)).toEqual(['내과 1진료실', '채혈실/검사실']);
  });

  it('② 잠금 키는 (종류, 자산) 단위', async () => {
    await svc.place({ kind: 'TERMINAL', assetId: U(20), spaceNodeId: CLINIC.id, source: 'MANUAL' }, USER);
    expect(f.locks).toEqual([`asset-placement:TERMINAL:${U(20)}`]);
  });

  it('③ 좌표: 확정 도면 구역 안에서만 받는다', async () => {
    await expect(svc.place({ kind: 'EQUIPMENT', assetId: U(10), spaceNodeId: LAB.id, x: 1, y: 1, source: 'MANUAL' }, USER))
      .rejects.toMatchObject({ response: { code: 'GEOMETRY_UNCONFIRMED' } });
    await expect(svc.place({ kind: 'EQUIPMENT', assetId: U(10), spaceNodeId: CLINIC.id, x: 1, y: 1, source: 'MANUAL' }, USER))
      .rejects.toMatchObject({ response: { code: 'GEOMETRY_UNCONFIRMED' } });
    await expect(svc.place({ kind: 'EQUIPMENT', assetId: U(10), spaceNodeId: IMG.id, x: 30, y: 35, source: 'MANUAL' }, USER))
      .rejects.toMatchObject({ response: { code: 'GEOMETRY_UNCONFIRMED' } }); // 경계 밖
    await expect(svc.place({ kind: 'EQUIPMENT', assetId: U(10), spaceNodeId: IMG.id, x: 3, source: 'MANUAL' }, USER))
      .rejects.toMatchObject({ response: { code: 'COORDINATE_PAIR' } });
    // 대조군: 확정 구역 안의 좌표는 받는다
    const ok = await svc.place({ kind: 'EQUIPMENT', assetId: U(10), spaceNodeId: IMG.id, x: 3.5, y: 36, source: 'MANUAL' }, USER);
    expect(ok.changed).toBe(true);
    expect(coordinateRejection({ metadata: { geometrySource: 'DRAWING_DRAFT', rect: { x: 0, y: 0, w: 9, h: 9 } } }, 1, 1)).toMatch(/확정되지 않은/);
  });

  it('④ 자기 테이블이 위치를 가진 종류(QR 스테이션)는 원장에 쓰지 않는다 — 대신 NATIVE 로 보여준다', async () => {
    await expect(svc.place({ kind: 'LOCATION_STATION', assetId: U(40), spaceNodeId: LAB.id, source: 'MANUAL' }, USER))
      .rejects.toMatchObject({ response: { code: 'ASSET_KIND_NOT_PLACEABLE' } });
    expect(f.placements).toHaveLength(0);
    const rows = await svc.placements({ floor: '2f', kind: 'LOCATION_STATION' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'NATIVE', placementId: null, space: { id: LAB.id } });
  });

  it('건물 단위에는 배치할 수 없다 · 없는 자산은 404', async () => {
    await expect(svc.place({ kind: 'EQUIPMENT', assetId: U(10), spaceNodeId: BLDG.id, source: 'MANUAL' }, USER))
      .rejects.toMatchObject({ response: { code: 'SPACE_NOT_PLACEABLE' } });
    await expect(svc.place({ kind: 'EQUIPMENT', assetId: U(99), spaceNodeId: LAB.id, source: 'MANUAL' }, USER))
      .rejects.toMatchObject({ response: { code: 'ASSET_NOT_FOUND' } });
  });

  it('⑤ 어댑터는 비밀값을 싣지 않는다(원행에 있어도)', async () => {
    const box = JSON.stringify(await ASSET_LOADERS.DISPLAY_BOX(f.prisma));
    expect(box).not.toContain('SECRET-API-KEY');
    const term = JSON.stringify(await ASSET_LOADERS.TERMINAL(f.prisma));
    for (const secret of ['10.0.0.7', 'AA:BB', 'BEACON-9', 'abcdef-123456']) expect(term).not.toContain(secret);
    expect(term).toContain('…123456'); // 실물 대조용 끝 6자리만
    expect(JSON.stringify(await ASSET_LOADERS.LOCATION_STATION(f.prisma))).not.toContain('deadbeef');
  });

  it('⑥ 배치율: 분모=활성 자산(폐기 제외) · 분모 0 이면 null · 텍스트 불일치를 센다', async () => {
    await svc.place({ kind: 'EQUIPMENT', assetId: U(10), spaceNodeId: CLINIC.id, source: 'MANUAL' }, USER); // 텍스트 '2층 채혈실' ↔ 내과 1진료실
    const cov = await svc.coverage();
    const eq = cov.find((c) => c.kind === 'EQUIPMENT')!;
    expect(eq).toMatchObject({ total: 2, active: 1, placed: 1, unplaced: 0, placedRatio: 1, legacyDiffers: 1 });
    expect(cov.find((c) => c.kind === 'LAB_INSTRUMENT')!.placedRatio).toBeNull();
    const st = cov.find((c) => c.kind === 'LOCATION_STATION')!;
    expect(st).toMatchObject({ placeable: false, placed: 1 });
  });

  it('⑦ 원장이 가리키는 자산 행이 사라져도 숨기지 않는다', async () => {
    await svc.place({ kind: 'EQUIPMENT', assetId: U(10), spaceNodeId: LAB.id, source: 'MANUAL' }, USER);
    f.equipment.splice(0, 1);
    const rows = await svc.placements({ floor: '2f' });
    expect(rows.find((r) => r.kind === 'EQUIPMENT')).toMatchObject({ assetMissing: true, asset: null });
  });

  it('미배치 목록은 활성만 · 기존 텍스트로 후보를 제안하되 배치하지 않는다', async () => {
    const r = await svc.unplaced('EQUIPMENT');
    expect(r.items.map((i) => i.asset.id)).toEqual([U(10)]); // 폐기(U11) 제외
    expect(r.items[0].suggestions[0]).toMatchObject({ spaceNodeId: LAB.id });
    expect(f.placements).toHaveLength(0);
  });

  it('배치 종료는 사유와 함께 기록되고 두 번 끝낼 수 없다', async () => {
    const { placement } = await svc.place({ kind: 'EQUIPMENT', assetId: U(10), spaceNodeId: LAB.id, source: 'MANUAL' }, USER);
    const ended = await svc.end(placement.id, '수리 반출', USER);
    expect(ended).toMatchObject({ endReason: '수리 반출', endedById: USER });
    await expect(svc.end(placement.id, '또', USER)).rejects.toMatchObject({ response: { code: 'PLACEMENT_ALREADY_ENDED' } });
  });

  it('텍스트 대조: 없음=null(불일치 아님) · 이름 토큰·실번호로 가리키면 같다', () => {
    expect(legacyTextMatches(null, CLINIC)).toBeNull();
    expect(legacyTextMatches('  ', CLINIC)).toBeNull();
    expect(legacyTextMatches('2층 채혈실', LAB)).toBe(true);
    expect(legacyTextMatches('201호', CLINIC)).toBe(true);
    expect(legacyTextMatches('1층 영상의학과', LAB)).toBe(false);
    expect(suggestNodes('1층 영상의학과', [FLOOR2, LAB, IMG, CLINIC] as any)).toEqual([]); // 층도 이름도 안 맞으면 제안 없음
  });

  it('스키마와 마이그레이션이 같은 테이블을 말한다', () => {
    const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20260928000001_asset_placements/migration.sql'), 'utf8');
    expect(schema).toMatch(/model AssetPlacement \{[\s\S]*?@@map\("asset_placements"\)/);
    expect(sql).toContain('CREATE TABLE "asset_placements"');
    for (const col of ['asset_kind', 'asset_id', 'space_node_id', 'legacy_text_at_placement', 'ended_at', 'end_reason'])
      expect(sql).toContain(`"${col}"`);
  });
});
