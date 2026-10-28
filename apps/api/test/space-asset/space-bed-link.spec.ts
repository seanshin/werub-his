/**
 * 병상 ↔ 도면 공간(2026-10-02 · 통합 상황판 3D 병상).
 *  · 🔴 사람이 잇는다 — 제안은 층·호실이 같은 병실 구역이 **하나뿐일 때만** · 응급 병동은 응급실 구역이 하나뿐일 때만(구역 위치를 지어내지 않는다)
 *  · 일괄 연결은 유일한 제안만 · 이미 연결된 병상은 덮지 않는다(조건부)
 *  · 공간 부하의 병상 층: 응급 점유는 활성 배정이 정본 · 점유 표시인데 배정 없음 = MISMATCH · 미연결은 병동별로 센다 · 환자 정보 없음
 * 재주입: 제안의 "하나뿐" 조건을 지우면, 일괄 연결의 spaceNodeId:null 조건을 지우면, ER 점유를 status 로 바꾸면 실패한다.
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { SpaceBedLinkService } from '../../src/modules/space-asset/space-bed-link.service';
import { SpaceAssetController } from '../../src/modules/space-asset/space-asset.controller';
import { CommandCenterSpaceService } from '../../src/modules/command-center/command-center-space.service';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

const W3 = { id: 'w3', name: '3층 내과병동', floor: 3, type: 'GENERAL' };
const ER = { id: 'we', name: '응급병동', floor: 1, type: 'EMERGENCY' };
const bed = (id: string, ward: typeof W3, room: string, no: string, spaceNodeId: string | null = null) =>
  ({ id, roomNumber: room, bedNumber: no, spaceNodeId, ward, spaceNode: spaceNodeId ? { id: spaceNodeId, name: 'x', floor: ward.floor } : null });
const zone = (id: string, spaceType: string, floor: number, roomNumber: string | null, nodeType = 'ZONE') => ({ id, name: id, floor, roomNumber, spaceType, nodeType });

function makeLink(beds: unknown[], zones: unknown[]) {
  const updateMany = vi.fn(async ({ where }: { where: { id: { in: string[] }; spaceNodeId?: null } }) => ({ count: where.id.in.length }));
  const prisma = {
    bed: { findMany: vi.fn(async () => beds), count: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((i) => (beds as { id: string }[]).some((b) => b.id === i)).length), updateMany },
    spaceNode: {
      findMany: vi.fn(async () => zones),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const z = (zones as { id: string; nodeType: string }[]).find((x) => x.id === where.id);
        return z ? { isActive: true, nodeType: z.nodeType } : null;
      }),
    },
  };
  return { svc: new SpaceBedLinkService(prisma as never), updateMany };
}

describe('제안 — 하나뿐일 때만', () => {
  it('🔴 일반 병동 = 같은 층·같은 호실 병실 하나 · 응급 병동 = 응급실 하나 · 이미 연결된 병상은 제안 없음', async () => {
    const { svc } = makeLink(
      [bed('b1', W3, '301', 'A'), bed('b2', W3, '302', 'A', 'z302'), bed('e1', ER, 'RESUS', '1')],
      [zone('z301', 'WARD_ROOM', 3, '301'), zone('z302', 'WARD_ROOM', 3, '302'), zone('z401', 'WARD_ROOM', 4, '301'), zone('zer', 'ER', 1, null)],
    );
    const r = await svc.list();
    expect(r.find((x) => x.bedId === 'b1')!.suggestion).toMatchObject({ spaceNodeId: 'z301' }); // 4층 301 은 층이 달라 아님
    expect(r.find((x) => x.bedId === 'b2')!.suggestion).toBeNull();
    expect(r.find((x) => x.bedId === 'e1')!.suggestion).toMatchObject({ spaceNodeId: 'zer' });
  });

  it('🔴 같은 층·호실이 둘이면(중복) · 응급실 구역이 둘이면 제안하지 않는다(추정해 잇지 않는다)', async () => {
    const { svc } = makeLink(
      [bed('b1', W3, '301', 'A'), bed('e1', ER, 'GEN', '1')],
      [zone('z1', 'WARD_ROOM', 3, '301'), zone('z2', 'WARD_ROOM', 3, '301'), zone('er1', 'ER', 1, null), zone('er2', 'ER', 1, null)],
    );
    const r = await svc.list();
    expect(r.every((x) => x.suggestion === null)).toBe(true);
  });
});

describe('연결·일괄', () => {
  it('일괄은 유일한 제안만 · 아직 미연결인 병상에만(조건부 — 그 사이 연결된 것은 덮지 않는다)', async () => {
    const { svc, updateMany } = makeLink(
      [bed('b1', W3, '301', 'A'), bed('b2', W3, '301', 'B'), bed('b3', W3, '309', 'A'), bed('b4', W3, '302', 'A', 'z302')],
      [zone('z301', 'WARD_ROOM', 3, '301'), zone('z302', 'WARD_ROOM', 3, '302')],
    );
    const r = await svc.linkSuggested();
    expect(r).toMatchObject({ linked: 2, noSuggestion: 1, alreadyLinked: 1 });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ['b1', 'b2'] }, spaceNodeId: null }, data: { spaceNodeId: 'z301' } });
  });

  it('공간 검증 — 없는 공간·층/구역 단위가 아닌 공간·없는 병상은 거부 · 해제(null)는 허용', async () => {
    const { svc } = makeLink([bed('b1', W3, '301', 'A')], [zone('z301', 'WARD_ROOM', 3, '301'), zone('bld', 'BUILDING', 0, null, 'BUILDING')]);
    await expect(svc.set(['b1'], 'nope')).rejects.toMatchObject({ status: 404 });
    await expect(svc.set(['b1'], 'bld')).rejects.toMatchObject({ status: 400 });
    await expect(svc.set(['b1', 'ghost'], 'z301')).rejects.toMatchObject({ status: 404 });
    expect(await svc.set(['b1'], null)).toEqual({ updated: 1 });
  });

  it('관리자 전용(클래스 @Roles)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SpaceAssetController)).toEqual([UserRole.ADMIN]);
  });
});

describe('공간 부하 — 병상 층', () => {
  function makeLoad(beds: unknown[], activeErBedIds: string[]) {
    const prisma = {
      waitingQueue: { findMany: vi.fn(async () => []) },
      clinicRoom: { findMany: vi.fn(async () => []) },
      checkupStationLog: { findMany: vi.fn(async () => []) },
      checkupStation: { findMany: vi.fn(async () => []) },
      bed: { findMany: vi.fn(async () => beds) },
      emergencyBedAssignment: { findMany: vi.fn(async () => activeErBedIds.map((bedId) => ({ bedId }))) },
    };
    return new CommandCenterSpaceService(prisma as never);
  }
  const b = (id: string, ward: { name: string; type: string }, room: string, no: string, status: string, spaceNodeId: string | null) =>
    ({ id, roomNumber: room, bedNumber: no, status, spaceNodeId, ward });

  it('🔴 응급 점유는 활성 배정이 정본 — 배정 있음=OCCUPIED · 점유 표시인데 배정 없음=MISMATCH · 일반 병동은 원장 상태', async () => {
    const svc = makeLoad([
      b('e1', { name: '응급병동', type: 'EMERGENCY' }, 'RESUS', '1', 'AVAILABLE', 'zer'),
      b('e2', { name: '응급병동', type: 'EMERGENCY' }, 'RESUS', '2', 'OCCUPIED', 'zer'),
      b('w1', { name: '3층', type: 'GENERAL' }, '301', 'A', 'OCCUPIED', 'z301'),
      b('w2', { name: '3층', type: 'GENERAL' }, '301', 'B', 'CLEANING', 'z301'),
      b('w3', { name: '4층', type: 'GENERAL' }, '401', 'A', 'AVAILABLE', null),
    ], ['e1']);
    const r = await svc.spaceLoad(new Date('2026-10-02T03:00:00Z'));
    const er = r.bedRooms.find((x) => x.spaceNodeId === 'zer')!;
    expect(er).toMatchObject({ emergency: true });
    expect(er.beds.map((x) => x.state)).toEqual(['OCCUPIED', 'MISMATCH']);
    expect(r.bedRooms.find((x) => x.spaceNodeId === 'z301')!.beds.map((x) => x.state)).toEqual(['OCCUPIED', 'CLEANING']);
    expect(r.bedsUnlinked).toEqual([{ ward: '4층', count: 1 }]);
    expect(r.bedsTotal).toBe(5);
    // 환자 정보 없음
    expect(JSON.stringify(r.bedRooms)).not.toMatch(/patient|name"/i);
  });
});
