import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SYNTHETIC_GEOMETRY_NOTICE,
  buildRouteGraph,
  centerNodeOf,
  describeRoute,
  findRoute,
  SpaceImportSource,
  SpaceImportV1,
  geometrySourceForImport,
  rectOverlapArea,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { HisModeService } from '../../common/his-mode/his-mode.service';
import { withAdvisoryLock } from '../../common/util/advisory-lock';

type NodeLite = { id: string; code: string | null; nodeType: string; floor: number | null; name: string; isActive: boolean; metadata: unknown };

/**
 * 검증 항목 — 🔴 문장이 아니라 **코드와 값**이다(서버가 한국어 문장을 조립하면 화면 언어를 바꿔도 그 줄은 한국어로 남는다).
 * 화면이 코드별 문장 틀에 값을 넣어 그린다.
 */
export type ImportIssueCode =
  | 'SCHEMA' | 'NO_FLOORS' | 'FLOOR_CODE_UNKNOWN' | 'BAD_RECT' | 'SPACE_CODE_UNKNOWN' | 'SPACE_FLOOR_MISMATCH'
  | 'DUP_CODE' | 'OVERLAP' | 'CONN_BROKEN' | 'EDGE_BROKEN' | 'VERTICAL_BROKEN' | 'ENTRANCE_BROKEN'
  | 'MISSING_ZONES' | 'NO_MAIN_ENTRANCE';
export interface ImportIssue { code: ImportIssueCode; floor?: string; space?: string; other?: string; value?: string | number; names?: string[] }

export interface ImportValidation {
  errors: ImportIssue[];
  warnings: ImportIssue[];
  floors: Array<{ key: string; spaceNodeCode: string; spaces: number; mapped: number; connections: number; missingZones: string[] }>;
  totals: { spaces: number; mapped: number; connections: number; graphEdges: number; entrances: number };
}

/**
 * space-import.v1 검증 — 순수 함수(공간 노드 목록만 받는다).
 * 🔴 오류 = 확정 불가(참조가 끊기거나 공간 정본과 어긋남). 경고 = 확정은 되지만 사람이 알아야 할 것(도면에 없는 구역).
 */
export function validateSpaceImport(payload: unknown, nodes: NodeLite[]): ImportValidation {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const p = payload as Partial<SpaceImportV1>;
  const out: ImportValidation = { errors, warnings, floors: [], totals: { spaces: 0, mapped: 0, connections: 0, graphEdges: 0, entrances: 0 } };
  if (!p || p.schema !== 'space-import.v1') { errors.push({ code: 'SCHEMA' }); return out; }
  if (!Array.isArray(p.floors) || !p.floors.length) { errors.push({ code: 'NO_FLOORS' }); return out; }

  const byCode = new Map(nodes.filter((n) => n.code).map((n) => [n.code!, n]));
  const nodeIds = new Set<string>();
  const seenCodes = new Set<string>();
  for (const F of p.floors) {
    const floorNode = byCode.get(F.spaceNodeCode);
    if (!floorNode || floorNode.nodeType !== 'FLOOR') { errors.push({ code: 'FLOOR_CODE_UNKNOWN', floor: F.key, value: F.spaceNodeCode }); continue; }
    const ids = new Set(F.spaces.map((s) => s.id));
    let mapped = 0;
    for (const s of F.spaces) {
      if (!s.rect || !(s.rect.w > 0) || !(s.rect.h > 0)) errors.push({ code: 'BAD_RECT', floor: F.key, space: s.name });
      if (s.spaceNodeCode) {
        const n = byCode.get(s.spaceNodeCode);
        if (!n) errors.push({ code: 'SPACE_CODE_UNKNOWN', floor: F.key, space: s.name, value: s.spaceNodeCode });
        else if (n.floor !== floorNode.floor) errors.push({ code: 'SPACE_FLOOR_MISMATCH', floor: F.key, space: s.name, value: s.spaceNodeCode, other: String(n.floor) });
        else mapped++;
        if (seenCodes.has(s.spaceNodeCode)) errors.push({ code: 'DUP_CODE', value: s.spaceNodeCode });
        seenCodes.add(s.spaceNodeCode);
      }
    }
    for (let i = 0; i < F.spaces.length; i++)
      for (let j = i + 1; j < F.spaces.length; j++)
        if (rectOverlapArea(F.spaces[i].rect, F.spaces[j].rect) > 0.01) errors.push({ code: 'OVERLAP', floor: F.key, space: F.spaces[i].name, other: F.spaces[j].name });
    for (const c of F.connections ?? [])
      if (!ids.has(c.between[0]) || (c.between[1] != null && !ids.has(c.between[1]))) errors.push({ code: 'CONN_BROKEN', floor: F.key, value: c.id });
    for (const n of F.graph?.nodes ?? []) nodeIds.add(n.id);
    const localIds = new Set((F.graph?.nodes ?? []).map((n) => n.id));
    for (const e of F.graph?.edges ?? [])
      if (!localIds.has(e.from) || !localIds.has(e.to)) errors.push({ code: 'EDGE_BROKEN', floor: F.key, value: `${e.from}→${e.to}` });
    // 공간 모델에는 있는데 도면에 없는 구역 — 좌표가 생기지 않는다(경고)
    const drawn = new Set(F.spaces.map((s) => s.spaceNodeCode).filter(Boolean));
    const missingZones = nodes
      .filter((n) => n.isActive && n.nodeType === 'ZONE' && n.floor === floorNode.floor && n.code && !drawn.has(n.code))
      .map((n) => n.name);
    if (missingZones.length) warnings.push({ code: 'MISSING_ZONES', floor: F.key, names: missingZones, value: missingZones.length });
    out.floors.push({ key: F.key, spaceNodeCode: F.spaceNodeCode, spaces: F.spaces.length, mapped, connections: (F.connections ?? []).length, missingZones });
    out.totals.spaces += F.spaces.length;
    out.totals.mapped += mapped;
    out.totals.connections += (F.connections ?? []).length;
    out.totals.graphEdges += (F.graph?.edges ?? []).length;
  }
  for (const e of p.verticalEdges ?? []) {
    out.totals.graphEdges++;
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) errors.push({ code: 'VERTICAL_BROKEN', value: `${e.from}→${e.to}` });
  }
  for (const en of p.entrances ?? []) {
    out.totals.entrances++;
    if (!nodeIds.has(en.nodeId)) errors.push({ code: 'ENTRANCE_BROKEN', floor: en.floor, space: en.name });
  }
  if (!(p.entrances ?? []).some((e) => e.main && !e.restricted)) warnings.push({ code: 'NO_MAIN_ENTRANCE' });
  return out;
}

@Injectable()
export class SpaceModelService {
  constructor(private readonly prisma: PrismaService, private readonly mode: HisModeService) {}

  private nodes(): Promise<NodeLite[]> {
    return this.prisma.spaceNode.findMany({ select: { id: true, code: true, nodeType: true, floor: true, name: true, isActive: true, metadata: true } });
  }

  async list() {
    return this.prisma.spaceImport.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, schema: true, source: true, status: true, title: true, summary: true, createdById: true, confirmedById: true, confirmedAt: true, rejectedReason: true, createdAt: true },
      take: 50,
    });
  }

  /** 올리기 — 검증 결과를 함께 저장한다(오류가 있어도 기록은 남긴다 · 확정만 막는다) */
  async create(title: string, payload: unknown, userId: string) {
    const synthetic = (payload as { synthetic?: boolean })?.synthetic === true;
    const source: SpaceImportSource = synthetic ? 'SYNTHETIC' : 'DRAWING';
    const effective = await this.mode.effective();
    if (synthetic && effective === 'REAL')
      throw new BadRequestException({ code: 'SYNTHETIC_IN_REAL', message: '운영 모드 REAL 에서는 합성 도면을 올릴 수 없습니다.' });
    const validation = validateSpaceImport(payload, await this.nodes());
    return this.prisma.spaceImport.create({
      data: {
        schema: 'space-import.v1', source, status: 'DRAFT', title,
        payload: payload as Prisma.InputJsonValue,
        summary: validation as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
      select: { id: true, source: true, status: true, title: true, summary: true, createdAt: true },
    });
  }

  /**
   * 확정 — 검증 오류 0 일 때만. 이전 확정본을 SUPERSEDED 로 돌리고 그 좌표를 공간 노드에서 걷은 뒤 새 좌표를 새긴다(한 트랜잭션).
   * 🔴 확정 시점에 다시 검증한다(올린 뒤 공간 모델이 바뀌었을 수 있다) · 합성 도면은 확정 시점에도 REAL 이면 거부.
   */
  async confirm(id: string, userId: string) {
    const imp = await this.prisma.spaceImport.findUnique({ where: { id } });
    if (!imp) throw new NotFoundException({ code: 'IMPORT_NOT_FOUND', message: '가져오기 기록을 찾을 수 없습니다.' });
    if (imp.status !== 'DRAFT') throw new BadRequestException({ code: 'IMPORT_NOT_DRAFT', message: '초안 상태만 확정할 수 있습니다.', details: { status: imp.status } });
    if (imp.source === 'SYNTHETIC' && (await this.mode.effective()) === 'REAL')
      throw new BadRequestException({ code: 'SYNTHETIC_IN_REAL', message: '운영 모드 REAL 에서는 합성 도면을 확정할 수 없습니다.' });
    const nodes = await this.nodes();
    const v = validateSpaceImport(imp.payload, nodes);
    if (v.errors.length)
      throw new BadRequestException({ code: 'IMPORT_INVALID', message: '검증 오류가 있어 확정할 수 없습니다.', details: { errors: v.errors.slice(0, 20), total: v.errors.length } });

    const payload = imp.payload as unknown as SpaceImportV1;
    const geometrySource = geometrySourceForImport(imp.source as SpaceImportSource);
    const byCode = new Map(nodes.filter((n) => n.code).map((n) => [n.code!, n]));
    return withAdvisoryLock(this.prisma, 'space-import-confirm', async (tx) => {
      const prev = await tx.spaceImport.findMany({ where: { status: 'CONFIRMED' }, select: { id: true } });
      const prevIds = new Set(prev.map((x) => x.id));
      // 이전 확정본이 새긴 좌표를 걷는다(격자 기하가 있던 노드는 GRID_AUTO 로 되돌린다)
      for (const n of nodes) {
        const m = (n.metadata ?? {}) as Record<string, unknown>;
        if (!m.importId || !prevIds.has(String(m.importId))) continue;
        const { rect: _r, importId: _i, drawingSpaceId: _d, ...rest } = m;
        void _r; void _i; void _d;
        await tx.spaceNode.update({ where: { id: n.id }, data: { metadata: { ...rest, geometrySource: rest.bounds ? 'GRID_AUTO' : undefined } as Prisma.InputJsonValue } });
      }
      if (prev.length) await tx.spaceImport.updateMany({ where: { id: { in: [...prevIds] } }, data: { status: 'SUPERSEDED' } });
      let applied = 0;
      for (const F of payload.floors) for (const s of F.spaces) {
        if (!s.spaceNodeCode) continue;
        const n = byCode.get(s.spaceNodeCode)!;
        const cur = (nodes.find((x) => x.id === n.id)?.metadata ?? {}) as Record<string, unknown>;
        const base = prevIds.has(String(cur.importId)) ? {} : cur;
        await tx.spaceNode.update({
          where: { id: n.id },
          data: { metadata: { ...base, ...(cur.bounds ? { bounds: cur.bounds } : {}), rect: s.rect, geometrySource, importId: imp.id, drawingSpaceId: s.id } as unknown as Prisma.InputJsonValue },
        });
        applied++;
      }
      const done = await tx.spaceImport.update({
        where: { id }, data: { status: 'CONFIRMED', confirmedById: userId, confirmedAt: new Date() },
        select: { id: true, status: true, source: true, confirmedAt: true },
      });
      return { ...done, appliedNodes: applied, superseded: prev.length, warnings: v.warnings };
    });
  }

  /**
   * 확정 철회 — 사용 중 도면을 내린다(대체본 없이). 공간 노드의 좌표를 회수하고 WITHDRAWN 으로 남긴다(지우지 않음).
   * 🔴 되돌릴 수 없는 확정은 두지 않는다 — 합성 도면을 시연 뒤 내리거나 잘못 확정한 실도면을 거둘 길이 있어야 한다.
   */
  async withdraw(id: string, reason: string) {
    const imp = await this.prisma.spaceImport.findUnique({ where: { id }, select: { status: true } });
    if (!imp) throw new NotFoundException({ code: 'IMPORT_NOT_FOUND', message: '가져오기 기록을 찾을 수 없습니다.' });
    if (imp.status !== 'CONFIRMED') throw new BadRequestException({ code: 'IMPORT_NOT_CONFIRMED', message: '사용 중(확정) 도면만 철회할 수 있습니다.', details: { status: imp.status } });
    const nodes = await this.nodes();
    return withAdvisoryLock(this.prisma, 'space-import-confirm', async (tx) => {
      let cleared = 0;
      for (const n of nodes) {
        const m = (n.metadata ?? {}) as Record<string, unknown>;
        if (m.importId !== id) continue;
        const { rect: _r, importId: _i, drawingSpaceId: _d, ...rest } = m;
        void _r; void _i; void _d;
        await tx.spaceNode.update({ where: { id: n.id }, data: { metadata: { ...rest, geometrySource: rest.bounds ? 'GRID_AUTO' : undefined } as Prisma.InputJsonValue } });
        cleared++;
      }
      await tx.spaceImport.update({ where: { id }, data: { status: 'WITHDRAWN', rejectedReason: reason } });
      return { id, status: 'WITHDRAWN', clearedNodes: cleared };
    });
  }

  async reject(id: string, reason: string) {
    const imp = await this.prisma.spaceImport.findUnique({ where: { id }, select: { status: true } });
    if (!imp) throw new NotFoundException({ code: 'IMPORT_NOT_FOUND', message: '가져오기 기록을 찾을 수 없습니다.' });
    if (imp.status !== 'DRAFT') throw new BadRequestException({ code: 'IMPORT_NOT_DRAFT', message: '초안 상태만 반려할 수 있습니다.', details: { status: imp.status } });
    return this.prisma.spaceImport.update({ where: { id }, data: { status: 'REJECTED', rejectedReason: reason }, select: { id: true, status: true } });
  }

  /** 확정된 최신 한 벌(없으면 null) — 뷰어·길안내 공용 */
  async activeImport() {
    return this.prisma.spaceImport.findFirst({ where: { status: 'CONFIRMED' }, orderBy: { confirmedAt: 'desc' } });
  }

  /**
   * 길안내(P3) — 확정 도면 그래프에서 경로·구조화된 단계·층별 경로 점. 문장은 만들지 않는다.
   * from: 'entrance:<id>' 또는 SpaceNode id · to: SpaceNode id.
   * 🔴 계산할 수 없으면 이유를 말한다(NO_GEOMETRY·TARGET_NOT_IN_DRAWING·START_UNKNOWN·NO_PATH) — 직선·추정 경로를 그리지 않는다.
   */
  async route(q: { from?: string; to: string; accessibleOnly: boolean; allowRestricted: boolean }) {
    const imp = await this.activeImport();
    if (!imp || (imp.source === 'SYNTHETIC' && (await this.mode.effective()) === 'REAL')) return { available: false as const, reason: 'NO_GEOMETRY' };
    const payload = imp.payload as unknown as SpaceImportV1;
    const g = buildRouteGraph(payload);
    const nodes = await this.nodes();
    const codeOf = new Map(nodes.map((n) => [n.id, n.code]));
    const toCode = codeOf.get(q.to);
    const target = toCode ? centerNodeOf(g, toCode) : null;
    if (!target) return { available: false as const, reason: 'TARGET_NOT_IN_DRAWING' };
    const entrances = (payload.entrances ?? []).filter((e) => q.allowRestricted || !e.restricted);
    let start: string | null = null;
    if (!q.from) start = entrances.find((e) => e.main)?.nodeId ?? null;
    else if (q.from.startsWith('entrance:')) start = entrances.find((e) => e.id === q.from!.slice(9))?.nodeId ?? null;
    else { const c = codeOf.get(q.from); start = c ? centerNodeOf(g, c) : null; }
    if (!start) return { available: false as const, reason: 'START_UNKNOWN' };
    const r = findRoute(g, [start], [target], { accessibleOnly: q.accessibleOnly, allowRestricted: q.allowRestricted });
    if (!r) return { available: false as const, reason: 'NO_PATH' };
    const d = describeRoute(g, r.path);
    return {
      available: true as const,
      synthetic: imp.source === 'SYNTHETIC',
      notice: imp.source === 'SYNTHETIC' ? SYNTHETIC_GEOMETRY_NOTICE : null,
      accessibleOnly: q.accessibleOnly,
      walkM: Math.round(r.walkM),
      // 걷는 거리는 정수 m 로(화면이 반올림하지 않게 — FE 수치 가드)
      steps: d.steps.map((st) => (st.kind === 'WALK' ? { ...st, distanceM: Math.round(st.distanceM) } : st)),
      segments: d.segments,
    };
  }

  /**
   * 한 공간에서 여러 공간까지의 경로 거리(m) — 검진 다음 검사 추천의 동점 처리(P4).
   * 확정 도면이 없거나(REAL 합성 포함) 도면에 없는 공간이면 그 값은 null(지어내지 않는다) · 통제 구역 제외.
   */
  async walkDistances(fromSpaceNodeId: string | null, toSpaceNodeIds: string[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>(toSpaceNodeIds.map((id) => [id, null]));
    if (!fromSpaceNodeId || !toSpaceNodeIds.length) return out;
    const imp = await this.activeImport();
    if (!imp || (imp.source === 'SYNTHETIC' && (await this.mode.effective()) === 'REAL')) return out;
    const g = buildRouteGraph(imp.payload as unknown as SpaceImportV1);
    const nodes = await this.nodes();
    const codeOf = new Map(nodes.map((n) => [n.id, n.code]));
    const fromCode = codeOf.get(fromSpaceNodeId);
    const start = fromCode ? centerNodeOf(g, fromCode) : null;
    if (!start) return out;
    for (const id of toSpaceNodeIds) {
      if (id === fromSpaceNodeId) { out.set(id, 0); continue; }
      const c = codeOf.get(id);
      const t = c ? centerNodeOf(g, c) : null;
      if (!t) continue;
      const r = findRoute(g, [start], [t], { allowRestricted: false });
      out.set(id, r ? Math.round(r.walkM) : null);
    }
    return out;
  }

  /** 출발점으로 고를 수 있는 출입구(환자용은 통제 출입구 제외) */
  async entrances(includeRestricted: boolean) {
    const imp = await this.activeImport();
    if (!imp || (imp.source === 'SYNTHETIC' && (await this.mode.effective()) === 'REAL')) return [];
    const payload = imp.payload as unknown as SpaceImportV1;
    return (payload.entrances ?? []).filter((e) => includeRestricted || !e.restricted).map((e) => ({ id: e.id, name: e.name, floor: e.floor, main: e.main }));
  }

  /**
   * 길안내 화면이 그릴 층 기하(경로가 지나는 층만) — **무인증 공개 응답**(환자 대기표 QR).
   * 🔴 (2026-10-12 사용자 지시 · 결정 `wayfinding.patientExposure` = QR_GUIDE_MASK_RESTRICTED) 종전엔 통제 구역의
   *    이름·번호·사각형이 그대로 나갔다(경로는 통제 구역을 지나지 않는데도). 통제 구역은 **응답에서 뺀다** —
   *    이름·배치를 지어 바꾸지 않고, 몇 곳을 뺐는지만 남겨 화면이 "표시하지 않음"을 말하게 한다. 통제 출입구도 뺀다.
   */
  async floorsForRoute(floorKeys: string[]) {
    const geo = await this.geometry();
    if (!geo) return [];
    return geo.floors.filter((f) => floorKeys.includes(f.key)).map((f) => ({
      ...f,
      spaces: f.spaces.filter((s) => !s.restricted),
      restrictedHidden: f.spaces.filter((s) => s.restricted).length,
      connections: f.connections.filter((c) => c.kind === 'EXTERIOR' && !c.restricted),
    }));
  }

  /**
   * 기하(뷰어용) — 방·문·층 윤곽만. 동선 그래프·가상 자산은 싣지 않는다(길안내는 경로 EP 가 계산).
   * 🔴 합성 도면이면 `notice` 를 싣는다 — 화면은 그것을 지우지 않고 그린다.
   */
  async geometry() {
    const imp = await this.activeImport();
    if (!imp) return null;
    // 🔴 REAL 로 전환된 뒤 남아 있는 합성 도면은 내려보내지 않는다(올리기·확정은 이미 막혀 있다 — 전환 전에 확정된 것)
    if (imp.source === 'SYNTHETIC' && (await this.mode.effective()) === 'REAL') return null;
    const payload = imp.payload as unknown as SpaceImportV1;
    const nodes = await this.nodes();
    const idByCode = new Map(nodes.filter((n) => n.code).map((n) => [n.code!, n.id]));
    return {
      importId: imp.id,
      source: imp.source,
      synthetic: imp.source === 'SYNTHETIC',
      notice: imp.source === 'SYNTHETIC' ? SYNTHETIC_GEOMETRY_NOTICE : null,
      confirmedAt: imp.confirmedAt,
      floors: payload.floors.map((F) => ({
        key: F.key, level: F.level, title: F.title, elevationM: F.elevationM, heightM: F.heightM, footprint: F.footprint,
        spaceNodeId: idByCode.get(F.spaceNodeCode) ?? null,
        spaces: F.spaces.map((s) => ({
          id: s.id, name: s.name, number: s.number, type: s.type, rect: s.rect, open: s.open, restricted: s.restricted,
          verticalCore: s.verticalCore ?? null, spaceNodeId: s.spaceNodeCode ? idByCode.get(s.spaceNodeCode) ?? null : null,
        })),
        connections: F.connections.map((c) => ({ id: c.id, kind: c.kind, at: c.at, widthM: c.widthM, restricted: c.restricted })),
      })),
    };
  }
}
