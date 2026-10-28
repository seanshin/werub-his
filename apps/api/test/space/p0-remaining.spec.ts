import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OBSERVED_LOCATION_SOURCES } from '@hospital-run/shared';
import { SpaceAssetService } from '../../src/modules/space-asset/space-asset.service';
import { MetaverseService } from '../../src/modules/metaverse/metaverse.service';
import { WaitingQueueService } from '../../src/modules/waiting-queue/waiting-queue.service';
import { PULSE_METRICS } from '../../src/sentinel/pulse-registry';

/**
 * 공간·동선 P0 잔여 — 외래 진료실 ↔ 공간 · 층 구성(시설 안내) · 관측 비율 펄스.
 *
 *   ① 진료실 목록 = 스케줄 이름 원문 ∪ 기존 연결 · 이름이 같은 구역은 **후보만**(연결된 것엔 후보 없음)
 *   ② 연결: 스케줄에 없는 이름 거부(오타가 새 진료실이 되지 않게) · 건물 단위 거부 · null=해제
 *   ③ 대기표 위치: 연결된 진료실만 층·구역 — 미연결은 null(층을 지어내지 않는다) · 지하는 B1
 *   ④ 층 구성 EP 는 이름·실번호만(정원·좌표·환자 없음 — 전 직원 공개이므로)
 *   ⑤ 관측 비율 펄스: 분모를 내고 시뮬레이션을 뺀다 · 급락 감시
 */

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NODES = [
  { id: U(1), parentId: null, nodeType: 'FLOOR', name: '2층 외래', code: '2f', floor: 2, roomNumber: null, spaceType: 'FLOOR', isActive: true, metadata: null },
  { id: U(2), parentId: U(1), nodeType: 'ZONE', name: '내과 1진료실', code: 'F2-IM-201', floor: 2, roomNumber: '201', spaceType: 'CLINIC', isActive: true, metadata: null },
  { id: U(3), parentId: U(1), nodeType: 'ZONE', name: '외과 1진료실', code: 'F2-SG-203', floor: 2, roomNumber: '203', spaceType: 'CLINIC', isActive: true, metadata: { bounds: { x: 0 } } },
  { id: U(9), parentId: null, nodeType: 'BUILDING', name: '본관', code: 'MAIN', floor: null, roomNumber: null, spaceType: 'BUILDING', isActive: true, metadata: null },
];

function spacePrisma(rooms: any[] = []) {
  const upserts: any[] = [];
  const prisma: any = {
    spaceNode: { findMany: vi.fn(async () => NODES), findUnique: vi.fn(async ({ where }: any) => NODES.find((n) => n.id === where.id) ?? null) },
    clinicSchedule: {
      groupBy: vi.fn(async () => [{ roomName: '내과 1진료실', _count: { _all: 4 } }, { roomName: '외과1진료실', _count: { _all: 2 } }, { roomName: '가정의학과 1진료실', _count: { _all: 1 } }]),
      count: vi.fn(async ({ where }: any) => (['내과 1진료실', '외과1진료실', '가정의학과 1진료실'].includes(where.roomName) ? 1 : 0)),
    },
    clinicRoom: {
      findMany: vi.fn(async () => rooms),
      count: vi.fn(async ({ where }: any) => rooms.filter((r) => r.name === where.name).length),
      upsert: vi.fn(async (a: any) => { upserts.push(a); return { ...a.create }; }),
    },
  };
  return { prisma, upserts };
}

describe('① 외래 진료실 목록 — 후보는 제안만', () => {
  it('스케줄 이름 ∪ 기존 연결 · 공백 무시 정확 일치만 후보 · 연결된 것엔 후보 없음', async () => {
    const { prisma } = spacePrisma([{ name: '내과 1진료실', spaceNodeId: U(2), spaceNode: { id: U(2), name: '내과 1진료실', floor: 2 } }]);
    const rows = await new SpaceAssetService(prisma).clinicRooms();
    const by = new Map(rows.map((r) => [r.name, r]));
    expect(by.get('내과 1진료실')).toMatchObject({ activeSchedules: 4, space: { id: U(2) }, suggestion: null });
    expect(by.get('외과1진료실')).toMatchObject({ space: null, suggestion: { spaceNodeId: U(3) } }); // 공백만 다르다
    expect(by.get('가정의학과 1진료실')).toMatchObject({ space: null, suggestion: null }); // 같은 이름 구역 없음
    expect(prisma.clinicRoom.upsert).not.toHaveBeenCalled(); // 목록 조회가 연결하지 않는다
  });
});

describe('② 진료실 연결 쓰기', () => {
  it('스케줄에 없는 이름 거부 · 건물 단위 거부 · 정상 연결 · null 해제', async () => {
    const { prisma, upserts } = spacePrisma();
    const svc = new SpaceAssetService(prisma);
    await expect(svc.setClinicRoom('없는진료실', U(2), 'u1')).rejects.toMatchObject({ response: { code: 'CLINIC_ROOM_UNKNOWN' } });
    await expect(svc.setClinicRoom('내과 1진료실', U(9), 'u1')).rejects.toMatchObject({ response: { code: 'SPACE_NOT_PLACEABLE' } });
    await svc.setClinicRoom('내과 1진료실', U(2), 'u1');
    await svc.setClinicRoom('외과1진료실', null, 'u1');
    expect(upserts.map((u) => [u.where.name, u.update.spaceNodeId])).toEqual([['내과 1진료실', U(2)], ['외과1진료실', null]]);
  });
});

describe('③ 대기표 진료실 위치', () => {
  function svcWith(room: any) {
    const prisma: any = { clinicRoom: { findUnique: vi.fn(async () => room) } };
    return new WaitingQueueService(prisma, {} as any);
  }
  it('연결됨 → 층 표식·구역 · 지하는 B1 · 미연결/이름 없음 → null', async () => {
    expect(await (svcWith({ spaceNode: { name: '내과 1진료실', floor: 2 } }) as any).roomLocation('내과 1진료실'))
      .toEqual({ zoneName: '내과 1진료실', floorLabel: '2F' });
    expect(await (svcWith({ spaceNode: { name: '검진 접수', floor: -1 } }) as any).roomLocation('검진'))
      .toEqual({ zoneName: '검진 접수', floorLabel: 'B1' });
    expect(await (svcWith({ spaceNode: null }) as any).roomLocation('외과1진료실')).toBeNull();
    expect(await (svcWith(null) as any).roomLocation(null)).toBeNull();
  });
});

describe('④ 층 구성(시설 안내) — 이름만', () => {
  it('층별로 구역 이름·실번호만 · 정원·좌표·메타 없음', async () => {
    const prisma: any = { spaceNode: { findMany: vi.fn(async () => NODES) } };
    const dir = await new MetaverseService(prisma).getDirectory();
    expect(dir).toHaveLength(1);
    expect(dir[0]).toMatchObject({ name: '2층 외래', floor: 2 });
    expect(dir[0].zones.map((z: any) => z.name)).toEqual(['내과 1진료실', '외과 1진료실']);
    for (const z of dir[0].zones) expect(Object.keys(z).sort()).toEqual(['department', 'id', 'name', 'roomNumber', 'spaceType']);
    // select 로 좌표·정원을 아예 읽지 않는다
    const sel = prisma.spaceNode.findMany.mock.calls[0][0].select;
    expect(sel.metadata).toBeUndefined();
    expect(sel.capacity).toBeUndefined();
  });
  it('층 구성 EP 는 역할 제한이 없고(전 직원) 환자 위치 EP 는 제한이 남는다', () => {
    const ctl = readFileSync(join(__dirname, '../../src/modules/metaverse/metaverse.controller.ts'), 'utf8');
    const dirBlock = /@Get\('directory'\)[\s\S]*?async getDirectory/.exec(ctl)![0];
    expect(dirBlock).not.toMatch(/@Roles/);
    expect(/@Get\('patients'\)\s*\n\s*@Roles\(/.test(ctl)).toBe(true);
  });
  it('시설 안내는 층 구성을 이 EP 에서 그리고, 결정 대기 중인 예시는 지우지 않는다', () => {
    const page = readFileSync(join(__dirname, '../../../web/src/app/(main)/facility-info/page.tsx'), 'utf8');
    expect(page).toMatch(/\/api\/v1\/metaverse\/directory/);
    expect(page).toMatch(/const FLOORS = \[/); // policy.facilityInfo.floorGuide 결정 전
  });
});

describe('⑤ 관측 비율 펄스', () => {
  it('분모를 내고 시뮬레이션을 빼며 급락을 본다', () => {
    const m = PULSE_METRICS.find((x) => x.key === 'location.observedRatio');
    expect(m).toBeTruthy();
    expect(m!.sql).toMatch(/AS d/);
    expect(m!.sql).toMatch(/source <> 'SIMULATED'/);
    expect(m!.minSample).toBeGreaterThanOrEqual(10);
    expect(m!.watchDrop).toBe(true);
  });
  it('🔴 관측으로 세는 출처 목록이 shared 정본과 같다(2026-10-09 무선 AP 측위 추가 때 SQL 만 남을 뻔)', () => {
    const m = PULSE_METRICS.find((x) => x.key === 'location.observedRatio')!;
    const inSql = /source IN \(([^)]*)\)/.exec(m.sql)![1].split(',').map((x) => x.trim().replace(/'/g, '')).sort();
    expect(inSql).toEqual([...OBSERVED_LOCATION_SOURCES].sort());
  });
});

describe('⑥ 진료실 이름 정확 일치 일괄 연결', () => {
  it('정확 일치(공백 무시)만 · 이미 연결된 것은 건드리지 않음 · 동명 구역이 둘이면 잇지 않음', async () => {
    const dupNodes = [...NODES, { id: U(7), parentId: U(1), nodeType: 'ZONE', name: '가정의학과 1진료실', code: 'X1', floor: 2, roomNumber: null, spaceType: 'CLINIC', isActive: true, metadata: null },
      { id: U(8), parentId: U(1), nodeType: 'ZONE', name: '가정의학과1진료실', code: 'X2', floor: 2, roomNumber: null, spaceType: 'CLINIC', isActive: true, metadata: null }];
    const { prisma, upserts } = spacePrisma([{ name: '내과 1진료실', spaceNodeId: U(2), spaceNode: { id: U(2), name: '내과 1진료실', floor: 2 } }]);
    prisma.spaceNode.findMany = vi.fn(async () => dupNodes);
    const r = await new SpaceAssetService(prisma).linkExactClinicRooms('admin');
    expect(r.linked).toEqual([{ name: '외과1진료실', space: '외과 1진료실' }]);
    expect(r.ambiguous).toEqual(['가정의학과 1진료실']);
    expect(upserts.map((u) => u.where.name)).toEqual(['외과1진료실']);
    expect(upserts[0].update).toMatchObject({ spaceNodeId: U(3), updatedById: 'admin' });
  });
});
