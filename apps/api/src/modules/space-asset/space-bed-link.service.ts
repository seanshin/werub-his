import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PLACEABLE_NODE_TYPES } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 병상 ↔ 도면 공간 연결(2026-10-02 · 통합 상황판 3D 병상).
 *
 * 🔴 **사람이 잇는다** — 시스템은 제안만 한다(진료실 연결과 같은 규약).
 *    제안 규칙: 일반 병동 = 병동 층 + 호실 번호가 같은 병실 구역(`WARD_ROOM`)이 **정확히 하나**일 때 ·
 *               응급 병동 = 응급실 구역(`ER`)이 정확히 하나일 때(도면에 구역별 칸이 없어 응급실 한 공간 — 구역 위치를 지어내지 않는다).
 *    둘 이상이면(동명·중복) 제안하지 않는다.
 */
@Injectable()
export class SpaceBedLinkService {
  constructor(private readonly prisma: PrismaService) {}

  private async zones() {
    return this.prisma.spaceNode.findMany({
      where: { isActive: true, nodeType: { in: [...PLACEABLE_NODE_TYPES] } },
      select: { id: true, name: true, floor: true, roomNumber: true, spaceType: true, nodeType: true },
    });
  }

  private suggestFor(
    bed: { roomNumber: string; ward: { floor: number; type: string } },
    zones: Awaited<ReturnType<SpaceBedLinkService['zones']>>,
  ) {
    const same = bed.ward.type === 'EMERGENCY'
      ? zones.filter((z) => z.spaceType === 'ER')
      : zones.filter((z) => z.spaceType === 'WARD_ROOM' && z.floor === bed.ward.floor && z.roomNumber === bed.roomNumber);
    return same.length === 1 ? same[0] : null;
  }

  /** 병상 목록 — 연결 상태 + 제안(미연결일 때만) */
  async list() {
    const [beds, zones] = await Promise.all([
      this.prisma.bed.findMany({
        where: { ward: { isActive: true } },
        select: {
          id: true, roomNumber: true, bedNumber: true, spaceNodeId: true,
          ward: { select: { id: true, name: true, floor: true, type: true } },
          spaceNode: { select: { id: true, name: true, floor: true } },
        },
        orderBy: [{ ward: { name: 'asc' } }, { roomNumber: 'asc' }, { bedNumber: 'asc' }],
      }),
      this.zones(),
    ]);
    return beds.map((b) => {
      const s = b.spaceNodeId ? null : this.suggestFor(b, zones);
      return {
        bedId: b.id, ward: b.ward, roomNumber: b.roomNumber, bedNumber: b.bedNumber,
        space: b.spaceNode ? { id: b.spaceNode.id, name: b.spaceNode.name, floor: b.spaceNode.floor } : null,
        suggestion: s ? { spaceNodeId: s.id, name: s.name, floor: s.floor } : null,
      };
    });
  }

  /** 연결·해제(spaceNodeId=null) — 층·구역 단위 활성 공간에만 */
  async set(bedIds: string[], spaceNodeId: string | null) {
    if (spaceNodeId) {
      const node = await this.prisma.spaceNode.findUnique({ where: { id: spaceNodeId }, select: { isActive: true, nodeType: true } });
      if (!node || !node.isActive) throw new NotFoundException({ code: 'SPACE_NOT_FOUND', message: '공간을 찾을 수 없거나 비활성입니다.' });
      if (!(PLACEABLE_NODE_TYPES as readonly string[]).includes(node.nodeType)) {
        throw new BadRequestException({ code: 'SPACE_NOT_PLACEABLE', message: '층·구역 단위에만 연결할 수 있습니다.', details: { nodeType: node.nodeType } });
      }
    }
    const found = await this.prisma.bed.count({ where: { id: { in: bedIds } } });
    if (found !== bedIds.length) throw new NotFoundException({ code: 'BED_NOT_FOUND', message: '없는 병상이 섞여 있습니다.', details: { requested: bedIds.length, found } });
    const r = await this.prisma.bed.updateMany({ where: { id: { in: bedIds } }, data: { spaceNodeId } });
    return { updated: r.count };
  }

  /**
   * 제안 일괄 연결 — 관리자가 누를 때만(자동 크론 아님). 이미 연결된 병상은 건드리지 않는다 · 제안이 없거나 모호하면 남긴다.
   * 연결은 그 순간 아직 미연결인 병상에만(조건부 — 그 사이 누가 이었으면 덮지 않는다).
   */
  async linkSuggested() {
    const rows = await this.list();
    const groups = new Map<string, string[]>();
    let noSuggestion = 0;
    for (const r of rows) {
      if (r.space) continue;
      if (!r.suggestion) { noSuggestion++; continue; }
      groups.set(r.suggestion.spaceNodeId, [...(groups.get(r.suggestion.spaceNodeId) ?? []), r.bedId]);
    }
    let linked = 0;
    for (const [spaceNodeId, ids] of groups) {
      const u = await this.prisma.bed.updateMany({ where: { id: { in: ids }, spaceNodeId: null }, data: { spaceNodeId } });
      linked += u.count;
    }
    return { linked, noSuggestion, alreadyLinked: rows.filter((r) => r.space).length };
  }
}
