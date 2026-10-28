import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ASSET_KINDS,
  ASSET_KIND_META,
  AssetKind,
  COORDINATE_TRUSTED_GEOMETRY,
  PLACEABLE_NODE_TYPES,
  PlacementSource,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { withAdvisoryLock } from '../../common/util/advisory-lock';
import { ASSET_LOADERS, AssetView } from './asset-adapters';

type NodeLite = {
  id: string;
  parentId: string | null;
  nodeType: string;
  name: string;
  code: string | null;
  floor: number | null;
  roomNumber: string | null;
  spaceType: string;
  isActive: boolean;
  metadata: unknown;
};

const NODE_SELECT = {
  id: true, parentId: true, nodeType: true, name: true, code: true, floor: true,
  roomNumber: true, spaceType: true, isActive: true, metadata: true,
} as const;

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
/** 공간 이름 토큰 — '채혈실/검사실' → ['채혈실','검사실'] · '영상실 (X-ray/CT)' → ['영상실','x-ray','ct'] (2자 이상) */
const nameTokens = (name: string) => name.split(/[\s/·()（）,]+/).map(norm).filter((t) => t.length >= 2);

/** 자유 텍스트가 배치된 공간을 가리키는지 — 이름·실번호·코드 중 하나라도 들어 있으면 "같다"고 본다(느슨한 대조) */
export function legacyTextMatches(text: string | null, node: Pick<NodeLite, 'name' | 'roomNumber' | 'code'>): boolean | null {
  if (!text || !text.trim()) return null; // 텍스트 없음 = 대조 불가(불일치 아님)
  const t = norm(text);
  if (t.includes(norm(node.name))) return true;
  if (nameTokens(node.name).some((tok) => t.includes(tok))) return true;
  if (node.roomNumber && t.includes(norm(node.roomNumber))) return true;
  if (node.code && t.includes(norm(node.code))) return true;
  return false;
}

/** 후보 근거 코드 — 문장은 화면이 만든다(서버 조립 한국어 금지) */
export type SuggestionReason = 'NAME' | 'NAME_PART' | 'ROOM_NUMBER' | 'FLOOR';

/** 텍스트 → 공간 후보(제안만 — 자동 배치 없음). 점수와 근거를 함께 돌려준다 */
export function suggestNodes(text: string | null, nodes: NodeLite[], limit = 3) {
  if (!text || !text.trim()) return [];
  const t = norm(text);
  const floorHit = /(?:^|\D)(\d{1,2})\s*층/.exec(text) ?? /\b[bB](\d)\b/.exec(text);
  const textFloor = floorHit ? (/[bB]/.test(floorHit[0]) ? -Number(floorHit[1]) : Number(floorHit[1])) : null;
  const scored: Array<{ spaceNodeId: string; name: string; floor: number | null; score: number; reasons: SuggestionReason[] }> = [];
  for (const n of nodes) {
    if (!n.isActive || n.nodeType !== 'ZONE') continue;
    const reasons: SuggestionReason[] = [];
    let score = 0;
    const nn = norm(n.name);
    if (nn.length >= 2 && t.includes(nn)) { score += 3; reasons.push('NAME'); }
    else if (nameTokens(n.name).some((tok) => t.includes(tok))) { score += 2; reasons.push('NAME_PART'); }
    else if (t.length >= 2 && nn.includes(t)) { score += 2; reasons.push('NAME_PART'); }
    if (n.roomNumber && new RegExp(`(^|\\D)${n.roomNumber}(\\D|$)`).test(text)) { score += 2; reasons.push('ROOM_NUMBER'); }
    if (score > 0 && textFloor != null && n.floor === textFloor) { score += 1; reasons.push('FLOOR'); }
    if (score > 0) scored.push({ spaceNodeId: n.id, name: n.name, floor: n.floor, score, reasons });
  }
  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

/** 좌표를 받을 수 있는 구역인가 — 도면 확정 구역만(기획 §4 원칙 2). 아니면 거부 사유 */
export function coordinateRejection(node: Pick<NodeLite, 'metadata'>, x: number, y: number): string | null {
  const m = (node.metadata ?? {}) as { geometrySource?: string; rect?: { x: number; y: number; w: number; h: number } };
  if (!m.geometrySource || !(COORDINATE_TRUSTED_GEOMETRY as readonly string[]).includes(m.geometrySource))
    return '도면이 확정되지 않은 공간입니다. 좌표 없이 공간만 기록하세요.';
  const r = m.rect;
  if (!r) return '확정 도면에 이 공간의 경계가 없습니다. 좌표 없이 공간만 기록하세요.';
  if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) return '좌표가 공간 경계 밖입니다.';
  return null;
}

@Injectable()
export class SpaceAssetService {
  constructor(private readonly prisma: PrismaService) {}

  private async nodes(): Promise<NodeLite[]> {
    return this.prisma.spaceNode.findMany({ select: NODE_SELECT });
  }

  /** 층 노드와 그 아래 전부(트리) */
  private subtree(all: NodeLite[], rootId: string): NodeLite[] {
    const out: NodeLite[] = [];
    const q = [rootId];
    while (q.length) {
      const id = q.shift()!;
      const n = all.find((x) => x.id === id);
      if (n) out.push(n);
      for (const c of all) if (c.parentId === id) q.push(c.id);
    }
    return out;
  }

  private floorOf(all: NodeLite[], node: NodeLite | undefined): NodeLite | null {
    let cur = node;
    while (cur && cur.nodeType !== 'FLOOR') cur = all.find((x) => x.id === cur!.parentId);
    return cur ?? null;
  }

  private async loadAssets(kind: AssetKind, ids?: string[]): Promise<AssetView[]> {
    return ASSET_LOADERS[kind](this.prisma, ids);
  }

  /** 공간 트리(층 → 구역) — 선택기용 */
  async spaces() {
    const all = await this.nodes();
    const floors = all.filter((n) => n.nodeType === 'FLOOR').sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0));
    return floors.map((f) => ({
      id: f.id, code: f.code, name: f.name, floor: f.floor,
      zones: this.subtree(all, f.id)
        .filter((n) => n.id !== f.id && n.isActive)
        .map((n) => ({
          id: n.id, code: n.code, name: n.name, roomNumber: n.roomNumber, spaceType: n.spaceType, nodeType: n.nodeType,
          geometrySource: ((n.metadata ?? {}) as { geometrySource?: string }).geometrySource ?? null,
        })),
    }));
  }

  /**
   * 종류별 배치 현황 — 분모(활성 자산)와 함께. 배치율은 분모 0 이면 null(산출 불가).
   * legacyDiffers: 배치됐는데 자산 테이블 텍스트가 그 공간을 가리키지 않는 건(느슨한 대조 — "틀림"이 아니라 "다름").
   */
  async coverage() {
    const [placements, all] = await Promise.all([
      this.prisma.assetPlacement.findMany({ where: { endedAt: null }, select: { assetKind: true, assetId: true, spaceNodeId: true } }),
      this.nodes(),
    ]);
    const out = [];
    for (const kind of ASSET_KINDS) {
      const meta = ASSET_KIND_META[kind];
      const assets = await this.loadAssets(kind);
      const active = assets.filter((a) => a.active);
      const byAsset = new Map(placements.filter((p) => p.assetKind === kind).map((p) => [p.assetId, p.spaceNodeId]));
      const placedNode = (a: AssetView) => (meta.placeable ? byAsset.get(a.id) : a.nativeSpaceNodeId ?? undefined);
      const placed = active.filter((a) => placedNode(a));
      let legacyDiffers = 0;
      let legacyUnknown = 0;
      for (const a of placed) {
        const n = all.find((x) => x.id === placedNode(a));
        const m = n ? legacyTextMatches(a.legacyText, n) : null;
        if (m === false) legacyDiffers++;
        if (m === null && meta.hasLegacyText) legacyUnknown++;
      }
      out.push({
        kind, label: meta.label, group: meta.group, sourceTable: meta.sourceTable, placeable: meta.placeable,
        total: assets.length, active: active.length, placed: placed.length, unplaced: active.length - placed.length,
        placedRatio: active.length ? placed.length / active.length : null,
        unplacedWithLegacyText: active.filter((a) => !placedNode(a) && a.legacyText?.trim()).length,
        legacyDiffers, legacyUnknown,
      });
    }
    return out;
  }

  /** 배치 목록 — 층(코드 또는 id)·공간·종류로 거른다. 원장 배치 + 자산 테이블 자체 배치(NATIVE) */
  async placements(q: { floor?: string; spaceNodeId?: string; kind?: AssetKind }) {
    const all = await this.nodes();
    let scope: Set<string> | null = null;
    if (q.floor) {
      const f = all.find((n) => n.nodeType === 'FLOOR' && (n.id === q.floor || n.code === q.floor));
      if (!f) throw new NotFoundException({ code: 'FLOOR_NOT_FOUND', message: '층을 찾을 수 없습니다.', details: { floor: q.floor } });
      scope = new Set(this.subtree(all, f.id).map((n) => n.id));
    }
    if (q.spaceNodeId) scope = new Set([q.spaceNodeId]);

    const rows = await this.prisma.assetPlacement.findMany({
      where: {
        endedAt: null,
        ...(q.kind ? { assetKind: q.kind } : {}),
        ...(scope ? { spaceNodeId: { in: [...scope] } } : {}),
      },
      orderBy: { placedAt: 'desc' },
    });
    const kinds = q.kind ? [q.kind] : [...ASSET_KINDS];
    const out = [];
    for (const kind of kinds) {
      const meta = ASSET_KIND_META[kind];
      if (meta.placeable) {
        const mine = rows.filter((r) => r.assetKind === kind);
        if (!mine.length) continue;
        const assets = new Map((await this.loadAssets(kind, mine.map((r) => r.assetId))).map((a) => [a.id, a]));
        for (const r of mine) {
          const n = all.find((x) => x.id === r.spaceNodeId);
          const a = assets.get(r.assetId) ?? null;
          out.push({
            placementId: r.id, kind, kindLabel: meta.label, source: r.source as PlacementSource,
            asset: a, assetMissing: !a, // 원장은 가리키는데 자산 행이 사라졌다 — 숨기지 않는다
            space: n ? { id: n.id, name: n.name, code: n.code, floor: n.floor, nodeType: n.nodeType } : null,
            floor: this.floorOf(all, n)?.name ?? null,
            x: r.x == null ? null : Number(r.x), y: r.y == null ? null : Number(r.y),
            placedAt: r.placedAt, note: r.note,
            legacyTextMatches: a && n ? legacyTextMatches(a.legacyText, n) : null,
          });
        }
      } else {
        const assets = (await this.loadAssets(kind)).filter((a) => a.nativeSpaceNodeId && (!scope || scope.has(a.nativeSpaceNodeId)));
        for (const a of assets) {
          const n = all.find((x) => x.id === a.nativeSpaceNodeId);
          out.push({
            placementId: null, kind, kindLabel: meta.label, source: 'NATIVE' as PlacementSource,
            asset: a, assetMissing: false,
            space: n ? { id: n.id, name: n.name, code: n.code, floor: n.floor, nodeType: n.nodeType } : null,
            floor: this.floorOf(all, n)?.name ?? null, x: null, y: null, placedAt: null, note: null, legacyTextMatches: null,
          });
        }
      }
    }
    return out;
  }

  /** 미배치 자산(활성만) + 기존 텍스트 기반 후보 공간(제안) */
  async unplaced(kind: AssetKind) {
    const meta = ASSET_KIND_META[kind];
    if (!meta.placeable) return { kind, placeable: false, items: [] };
    const [assets, active, all] = await Promise.all([
      this.loadAssets(kind),
      this.prisma.assetPlacement.findMany({ where: { assetKind: kind, endedAt: null }, select: { assetId: true } }),
      this.nodes(),
    ]);
    const placed = new Set(active.map((p) => p.assetId));
    return {
      kind, placeable: true,
      items: assets
        .filter((a) => a.active && !placed.has(a.id))
        .map((a) => ({ asset: a, suggestions: suggestNodes(a.legacyText, all) })),
    };
  }

  /**
   * 배치·이동 — 자산당 활성 배치 하나(advisory lock). 같은 공간·같은 좌표면 아무것도 바꾸지 않는다(멱등).
   * 이동이면 이전 배치를 끝내고(MOVED) 새 배치를 연다 — 이력은 지우지 않는다.
   */
  async place(dto: { kind: AssetKind; assetId: string; spaceNodeId: string; x?: number; y?: number; source: PlacementSource; note?: string }, userId: string) {
    const meta = ASSET_KIND_META[dto.kind];
    if (!meta.placeable)
      throw new BadRequestException({ code: 'ASSET_KIND_NOT_PLACEABLE', message: '이 종류는 자기 테이블이 위치를 관리합니다. 그 화면에서 바꾸세요.', details: { kind: dto.kind, sourceTable: meta.sourceTable } });
    if ((dto.x == null) !== (dto.y == null))
      throw new BadRequestException({ code: 'COORDINATE_PAIR', message: '좌표는 x·y 를 함께 보내거나 둘 다 비워야 합니다.' });

    const [asset] = await this.loadAssets(dto.kind, [dto.assetId]);
    if (!asset) throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: '자산을 찾을 수 없습니다.', details: { kind: dto.kind, assetId: dto.assetId } });
    const node = await this.prisma.spaceNode.findUnique({ where: { id: dto.spaceNodeId }, select: NODE_SELECT });
    if (!node || !node.isActive) throw new NotFoundException({ code: 'SPACE_NOT_FOUND', message: '공간을 찾을 수 없거나 비활성입니다.' });
    if (!(PLACEABLE_NODE_TYPES as readonly string[]).includes(node.nodeType))
      throw new BadRequestException({ code: 'SPACE_NOT_PLACEABLE', message: '층·구역 단위에만 배치할 수 있습니다.', details: { nodeType: node.nodeType } });
    if (dto.x != null && dto.y != null) {
      const why = coordinateRejection(node, dto.x, dto.y);
      if (why) throw new BadRequestException({ code: 'GEOMETRY_UNCONFIRMED', message: why });
    }

    return withAdvisoryLock(this.prisma, `asset-placement:${dto.kind}:${dto.assetId}`, async (tx) => {
      const current = await tx.assetPlacement.findFirst({ where: { assetKind: dto.kind, assetId: dto.assetId, endedAt: null } });
      const sameXY = (current?.x == null ? null : Number(current.x)) === (dto.x ?? null)
        && (current?.y == null ? null : Number(current.y)) === (dto.y ?? null);
      if (current && current.spaceNodeId === dto.spaceNodeId && sameXY) return { placement: current, changed: false };
      if (current) {
        await tx.assetPlacement.update({
          where: { id: current.id },
          data: { endedAt: new Date(), endedById: userId, endReason: 'MOVED' },
        });
      }
      const placement = await tx.assetPlacement.create({
        data: {
          assetKind: dto.kind, assetId: dto.assetId, spaceNodeId: dto.spaceNodeId,
          x: dto.x ?? null, y: dto.y ?? null, source: dto.source, note: dto.note ?? null,
          legacyTextAtPlacement: asset.legacyText?.slice(0, 200) ?? null, placedById: userId,
        },
      });
      return { placement, changed: true, movedFrom: current?.spaceNodeId ?? null };
    });
  }

  /** 배치 종료(철거·반출·폐기) — 사유 필수. 자산 행은 건드리지 않는다 */
  async end(placementId: string, reason: string, userId: string) {
    const p = await this.prisma.assetPlacement.findUnique({ where: { id: placementId } });
    if (!p) throw new NotFoundException({ code: 'PLACEMENT_NOT_FOUND', message: '배치 기록을 찾을 수 없습니다.' });
    return withAdvisoryLock(this.prisma, `asset-placement:${p.assetKind}:${p.assetId}`, async (tx) => {
      const cur = await tx.assetPlacement.findUnique({ where: { id: placementId } });
      if (!cur || cur.endedAt) throw new BadRequestException({ code: 'PLACEMENT_ALREADY_ENDED', message: '이미 종료된 배치입니다.' });
      return tx.assetPlacement.update({ where: { id: placementId }, data: { endedAt: new Date(), endedById: userId, endReason: reason } });
    });
  }

  /**
   * 외래 진료실 이름 ↔ 공간(P0-5). 진료실은 `ClinicSchedule.roomName` 텍스트로만 있다 — 그 이름 원문을 모아
   * 연결 상태와 **후보**(공간 이름이 정규화 후 정확히 같은 구역)를 준다. 🔴 후보는 제안일 뿐 자동 연결하지 않는다.
   */
  async clinicRooms() {
    const [schedules, rooms, nodes] = await Promise.all([
      this.prisma.clinicSchedule.groupBy({ by: ['roomName'], where: { isActive: true }, _count: { _all: true } }),
      this.prisma.clinicRoom.findMany({ include: { spaceNode: { select: { id: true, name: true, floor: true } } } }),
      this.nodes(),
    ]);
    const byName = new Map(rooms.map((r) => [r.name, r]));
    const names = new Set<string>([...schedules.map((s) => s.roomName), ...rooms.map((r) => r.name)]);
    const zones = nodes.filter((n) => n.isActive && (n.nodeType === 'ZONE' || n.nodeType === 'WING'));
    return [...names].sort((a, b) => a.localeCompare(b)).map((name) => {
      const linked = byName.get(name);
      const exact = zones.find((z) => norm(z.name) === norm(name));
      return {
        name,
        activeSchedules: schedules.find((s) => s.roomName === name)?._count._all ?? 0,
        space: linked?.spaceNode ? { id: linked.spaceNode.id, name: linked.spaceNode.name, floor: linked.spaceNode.floor } : null,
        suggestion: !linked?.spaceNodeId && exact ? { spaceNodeId: exact.id, name: exact.name, floor: exact.floor } : null,
      };
    });
  }

  /** 진료실 이름 ↔ 공간 연결(spaceNodeId=null 이면 해제). 스케줄·기존 연결에 없는 이름은 받지 않는다(오타가 새 진료실이 되지 않게) */
  async setClinicRoom(name: string, spaceNodeId: string | null, userId: string) {
    const used = await this.prisma.clinicSchedule.count({ where: { roomName: name } })
      + await this.prisma.clinicRoom.count({ where: { name } });
    if (!used) throw new NotFoundException({ code: 'CLINIC_ROOM_UNKNOWN', message: '진료 스케줄에 없는 진료실 이름입니다.', details: { name } });
    if (spaceNodeId) {
      const node = await this.prisma.spaceNode.findUnique({ where: { id: spaceNodeId }, select: NODE_SELECT });
      if (!node || !node.isActive) throw new NotFoundException({ code: 'SPACE_NOT_FOUND', message: '공간을 찾을 수 없거나 비활성입니다.' });
      if (!(PLACEABLE_NODE_TYPES as readonly string[]).includes(node.nodeType))
        throw new BadRequestException({ code: 'SPACE_NOT_PLACEABLE', message: '층·구역 단위에만 연결할 수 있습니다.', details: { nodeType: node.nodeType } });
    }
    return this.prisma.clinicRoom.upsert({
      where: { name },
      update: { spaceNodeId, updatedById: userId },
      create: { name, spaceNodeId, updatedById: userId },
    });
  }

  /**
   * 이름 정확 일치 후보 일괄 연결 — 관리자가 누를 때만(자동 크론 아님).
   * 🔴 기준은 **정규화 후 이름이 정확히 같은 것뿐**(공백만 무시) — 비슷한 이름을 추정해 잇지 않는다(환자를 엉뚱한 방으로 안내하게 된다).
   *    이미 연결된 진료실은 건드리지 않는다 · 일치하는 구역이 둘 이상이면(동명) 잇지 않고 남긴다.
   */
  async linkExactClinicRooms(userId: string) {
    const rows = await this.clinicRooms();
    const all = await this.nodes();
    const zones = all.filter((n) => n.isActive && (n.nodeType === 'ZONE' || n.nodeType === 'WING'));
    const linked: Array<{ name: string; space: string }> = [];
    const ambiguous: string[] = [];
    for (const r of rows) {
      if (r.space || !r.suggestion) continue;
      const same = zones.filter((z) => norm(z.name) === norm(r.name));
      if (same.length !== 1) { ambiguous.push(r.name); continue; }
      await this.prisma.clinicRoom.upsert({
        where: { name: r.name },
        update: { spaceNodeId: same[0].id, updatedById: userId },
        create: { name: r.name, spaceNodeId: same[0].id, updatedById: userId },
      });
      linked.push({ name: r.name, space: same[0].name });
    }
    const remaining = rows.filter((r) => !r.space).length - linked.length;
    return { linked, ambiguous, remainingUnlinked: remaining };
  }

  /** 자산 한 건의 배치 이력(최신순) */
  async history(kind: AssetKind, assetId: string) {
    const [rows, all] = await Promise.all([
      this.prisma.assetPlacement.findMany({ where: { assetKind: kind, assetId }, orderBy: { placedAt: 'desc' } }),
      this.nodes(),
    ]);
    return rows.map((r) => {
      const n = all.find((x) => x.id === r.spaceNodeId);
      return {
        id: r.id, space: n ? { id: n.id, name: n.name, floor: n.floor } : null, floor: this.floorOf(all, n)?.name ?? null,
        x: r.x == null ? null : Number(r.x), y: r.y == null ? null : Number(r.y),
        source: r.source, note: r.note, legacyTextAtPlacement: r.legacyTextAtPlacement,
        placedAt: r.placedAt, placedById: r.placedById, endedAt: r.endedAt, endedById: r.endedById, endReason: r.endReason,
      };
    });
  }
}
