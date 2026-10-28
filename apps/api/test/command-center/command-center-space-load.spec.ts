/**
 * 통합 상황판 3D — 공간 위 부하(2026-10-01 · `GET /api/v1/command-center/space-load`).
 *  · 부하는 **업무 원장**(대기열·검진 스테이션 기록) — 위치 원장(대부분 추정)이 아니다
 *  · 색 기준은 정본 흐름 목표 하나(출처 CONFIG/FALLBACK 을 함께) — 목표 초과만 OVER_TARGET · 대기 없으면 IDLE
 *  · 🔴 공간에 못 놓는 대기는 0 으로 사라지지 않는다 — 진료실 미지정 · 미연결 진료실(이름별) · 미연결 스테이션
 * 재주입: 미지정·미연결 계수를 지우면, 목표 비교를 ≥ 로 바꾸면 실패한다.
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { CommandCenterSpaceService } from '../../src/modules/command-center/command-center-space.service';
import { CommandCenterController } from '../../src/modules/command-center/command-center.controller';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

const NOW = new Date('2026-10-01T03:00:00Z'); // 12:00 KST
const min = (m: number) => new Date(NOW.getTime() - m * 60_000);

function make(opts: { queue?: unknown[]; rooms?: unknown[]; logs?: unknown[]; stations?: unknown[]; config?: Record<string, unknown> }) {
  const prisma = {
    waitingQueue: { findMany: vi.fn(async () => opts.queue ?? []) },
    clinicRoom: { findMany: vi.fn(async () => opts.rooms ?? []) },
    checkupStationLog: { findMany: vi.fn(async () => opts.logs ?? []) },
    checkupStation: { findMany: vi.fn(async () => opts.stations ?? []) },
    bed: { findMany: vi.fn(async () => []) },
    emergencyBedAssignment: { findMany: vi.fn(async () => []) },
  };
  const config = opts.config ? { get: vi.fn(async (k: string) => opts.config![k] ?? null) } : undefined;
  return { svc: new CommandCenterSpaceService(prisma as never, config as never), prisma };
}

describe('진료실 부하', () => {
  it('🔴 진료실→공간 구역 · 대기/호출/진료 중 · 최장 대기 · 목표 초과만 OVER_TARGET(기본값이면 출처 FALLBACK)', async () => {
    const { svc } = make({
      rooms: [{ name: '내과 1진료실', spaceNodeId: 'n1' }, { name: '외과 1진료실', spaceNodeId: 'n2' }],
      queue: [
        { roomName: '내과 1진료실', status: 'WAITING', checkedInAt: min(45) },
        { roomName: '내과 1진료실', status: 'WAITING', checkedInAt: min(5) },
        { roomName: '내과 1진료실', status: 'IN_CONSULTATION', checkedInAt: min(60) },
        { roomName: '외과 1진료실', status: 'WAITING', checkedInAt: min(30) },
        { roomName: '외과 1진료실', status: 'CALLED', checkedInAt: min(50) },
      ],
    });
    const r = await svc.spaceLoad(NOW);
    expect(r.target).toEqual({ opdWaitMin: 30, source: 'FALLBACK' });
    const naegwa = r.rooms.find((x) => x.spaceNodeId === 'n1')!;
    expect(naegwa).toMatchObject({ waiting: 2, called: 0, inConsultation: 1, longestWaitMin: 45, level: 'OVER_TARGET' });
    // 목표와 같으면 초과가 아니다(정확히 30분)
    expect(r.rooms.find((x) => x.spaceNodeId === 'n2')).toMatchObject({ waiting: 1, called: 1, longestWaitMin: 30, level: 'WITHIN_TARGET' });
  });

  it('원내 설정 목표면 그 값·출처 CONFIG', async () => {
    const { svc } = make({ config: { 'qi.targets.opdWaitMinutes': 60 }, rooms: [{ name: 'A', spaceNodeId: 'n1' }], queue: [{ roomName: 'A', status: 'WAITING', checkedInAt: min(45) }] });
    const r = await svc.spaceLoad(NOW);
    expect(r.target).toEqual({ opdWaitMin: 60, source: 'CONFIG' });
    expect(r.rooms[0].level).toBe('WITHIN_TARGET');
  });

  it('🔴 공간에 못 놓는 대기를 센다 — 진료실 미지정 · 미연결 진료실(이름별) · 분모(오늘 대기 전체)', async () => {
    const { svc } = make({
      rooms: [{ name: '내과 1진료실', spaceNodeId: 'n1' }, { name: '피부과 진료실', spaceNodeId: null }],
      queue: [
        { roomName: null, status: 'WAITING', checkedInAt: min(10) },
        { roomName: null, status: 'WAITING', checkedInAt: min(10) },
        { roomName: '피부과 진료실', status: 'WAITING', checkedInAt: min(10) },
        { roomName: '없는 진료실', status: 'CALLED', checkedInAt: min(10) },
        { roomName: '내과 1진료실', status: 'WAITING', checkedInAt: min(10) },
      ],
    });
    const r = await svc.spaceLoad(NOW);
    expect(r.queueTotal).toBe(5);
    expect(r.unplaced.queueWithoutRoom).toBe(2);
    expect(r.unplaced.queueRoomNotLinked).toEqual(expect.arrayContaining([{ roomName: '피부과 진료실', count: 1 }, { roomName: '없는 진료실', count: 1 }]));
    expect(r.rooms).toHaveLength(1);
  });

  it('대조군 — 오늘 대기가 없으면 진료실 목록은 비고 미지정도 0(0 이 사실일 때 0)', async () => {
    const r = await make({ rooms: [{ name: 'A', spaceNodeId: 'n1' }] }).svc.spaceLoad(NOW);
    expect(r).toMatchObject({ rooms: [], queueTotal: 0, unplaced: { queueWithoutRoom: 0, queueRoomNotLinked: [] } });
  });
});

describe('검진 스테이션', () => {
  it('미완료 기록 — 시작 전=대기 · 시작 후=검사 중 · 미연결 스테이션과 그 기록을 센다', async () => {
    const { svc } = make({
      stations: [{ stationId: 'S1', name: '채혈', spaceNodeId: 'n9' }, { stationId: 'S2', name: '시력', spaceNodeId: null }],
      logs: [
        { stationId: 'S1', startedAt: null }, { stationId: 'S1', startedAt: null }, { stationId: 'S1', startedAt: min(3) },
        { stationId: 'S2', startedAt: null },
      ],
    });
    const r = await svc.spaceLoad(NOW);
    expect(r.stations).toEqual([{ spaceNodeId: 'n9', name: '채혈', waiting: 2, inProgress: 1 }]);
    expect(r.unplaced).toMatchObject({ stationsNotLinked: 1, stationLogsNotPlaced: 1 });
  });
});

describe('권한', () => {
  it('상황판과 같은 역할(클래스 @Roles) — 집계만', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, CommandCenterController) as UserRole[];
    expect(roles).toEqual(expect.arrayContaining([UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE]));
    expect(Reflect.getMetadata(ROLES_KEY, CommandCenterController.prototype.spaceLoad)).toBeUndefined();
  });
});
