import { Injectable, Optional } from '@nestjs/common';
import { waitMinutesSince } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { todayRange } from '../../common/day-range';
import { resolveFlowTargetsWithSource } from '../journey-console/flow-canon';

/** 진료실 부하 판정 — 목표 대기를 넘긴 대기자가 있는가(그 이상의 단계는 원내 기준이 없어 만들지 않는다) */
export type SpaceLoadLevel = 'WITHIN_TARGET' | 'OVER_TARGET' | 'IDLE';

export interface SpaceLoadRoom {
  spaceNodeId: string;
  name: string;
  waiting: number;
  called: number;
  inConsultation: number;
  /** 지금 기다리는 사람 중 가장 오래 기다린 분 — 대기자가 없거나 접수 시각이 미래면 null */
  longestWaitMin: number | null;
  level: SpaceLoadLevel;
}

/** 병상 상태 — 원장 상태 그대로 + 응급 병상의 상태–배정 불일치(점유 표시인데 활성 배정 없음 — 응급 보드 'ghost' 와 같은 판정) */
export type BedMarkState = 'OCCUPIED' | 'AVAILABLE' | 'RESERVED' | 'CLEANING' | 'MAINTENANCE' | 'ISOLATION' | 'MISMATCH';

export interface SpaceLoadBedRoom {
  spaceNodeId: string;
  /** 병상 표식 — 환자 정보 없음(점유 여부만) */
  beds: { bedId: string; label: string; state: BedMarkState }[];
  emergency: boolean;
}

export interface SpaceLoadStation {
  spaceNodeId: string;
  name: string;
  waiting: number;
  inProgress: number;
}

/**
 * 통합 상황판 3D — 공간 위에 얹을 **업무 원장** 부하(2026-10-01).
 *
 * 환자 위치(관측·추정)가 아니라 **대기열·검진 스테이션 원장**이 정본이다 — 위치 원장은 대부분 추정·시뮬레이션이라 부하로 쓰지 않는다.
 * 🔴 공간에 놓을 수 없는 것은 0 으로 사라지게 두지 않고 **센다**: 진료실 미지정 대기 · 공간 미연결 진료실의 대기 · 미연결 스테이션.
 * 🔴 색 기준은 정본 흐름 목표(`opdWaitMin` — 원내 설정인지 코드 기본값인지 출처를 함께)뿐이다. 검진 스테이션은 기준이 없어 색을 칠하지 않는다.
 */
@Injectable()
export class CommandCenterSpaceService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  async spaceLoad(now: Date = new Date()) {
    const day = todayRange(now);
    const { targets, sources } = await resolveFlowTargetsWithSource(this.config ?? null);
    const [queue, rooms, logs, stations, beds] = await Promise.all([
      this.prisma.waitingQueue.findMany({
        where: { checkedInAt: day, status: { in: ['WAITING', 'CALLED', 'IN_CONSULTATION'] } },
        select: { roomName: true, status: true, checkedInAt: true },
      }),
      this.prisma.clinicRoom.findMany({ select: { name: true, spaceNodeId: true } }),
      this.prisma.checkupStationLog.findMany({
        where: { arrivedAt: day, completedAt: null },
        select: { stationId: true, startedAt: true },
      }),
      this.prisma.checkupStation.findMany({ where: { isActive: true }, select: { stationId: true, name: true, spaceNodeId: true } }),
      this.prisma.bed.findMany({
        where: { ward: { isActive: true } },
        select: { id: true, roomNumber: true, bedNumber: true, status: true, spaceNodeId: true, ward: { select: { name: true, type: true } } },
        orderBy: [{ roomNumber: 'asc' }, { bedNumber: 'asc' }],
      }),
    ]);

    // 진료실
    const roomNode = new Map(rooms.map((r) => [r.name, r.spaceNodeId]));
    const byRoom = new Map<string, SpaceLoadRoom>();
    let queueWithoutRoom = 0;
    const notLinked = new Map<string, number>();
    for (const q of queue) {
      if (!q.roomName) { queueWithoutRoom++; continue; }
      const node = roomNode.get(q.roomName);
      if (!node) { notLinked.set(q.roomName, (notLinked.get(q.roomName) ?? 0) + 1); continue; }
      const cur = byRoom.get(node) ?? { spaceNodeId: node, name: q.roomName, waiting: 0, called: 0, inConsultation: 0, longestWaitMin: null, level: 'IDLE' as SpaceLoadLevel };
      if (q.status === 'WAITING') {
        cur.waiting++;
        const w = waitMinutesSince(q.checkedInAt, now);
        if (w != null) cur.longestWaitMin = cur.longestWaitMin == null ? w : Math.max(cur.longestWaitMin, w);
      } else if (q.status === 'CALLED') cur.called++;
      else cur.inConsultation++;
      byRoom.set(node, cur);
    }
    for (const r of byRoom.values()) {
      r.level = r.longestWaitMin == null ? 'IDLE' : r.longestWaitMin > targets.opdWaitMin ? 'OVER_TARGET' : 'WITHIN_TARGET';
    }

    // 검진 스테이션
    const stationById = new Map(stations.map((s) => [s.stationId, s]));
    const byStation = new Map<string, SpaceLoadStation>();
    let stationsNotLinked = 0;
    for (const s of stations) if (!s.spaceNodeId) stationsNotLinked++;
    let stationLogsNotPlaced = 0;
    for (const l of logs) {
      const s = stationById.get(l.stationId);
      if (!s?.spaceNodeId) { stationLogsNotPlaced++; continue; }
      const cur = byStation.get(s.spaceNodeId) ?? { spaceNodeId: s.spaceNodeId, name: s.name, waiting: 0, inProgress: 0 };
      if (l.startedAt) cur.inProgress++; else cur.waiting++;
      byStation.set(s.spaceNodeId, cur);
    }

    // 병상 — 응급 병상의 점유는 활성 배정이 정본(응급 베드 보드와 같은 판정)
    const erBedIds = beds.filter((b) => b.ward.type === 'EMERGENCY').map((b) => b.id);
    const active = erBedIds.length
      ? new Set((await this.prisma.emergencyBedAssignment.findMany({ where: { bedId: { in: erBedIds }, releasedAt: null }, select: { bedId: true } })).map((a) => a.bedId))
      : new Set<string>();
    const byBedRoom = new Map<string, SpaceLoadBedRoom>();
    const bedsUnlinked = new Map<string, number>();
    for (const b of beds) {
      if (!b.spaceNodeId) { bedsUnlinked.set(b.ward.name, (bedsUnlinked.get(b.ward.name) ?? 0) + 1); continue; }
      const er = b.ward.type === 'EMERGENCY';
      const state: BedMarkState = er
        ? (active.has(b.id) ? 'OCCUPIED' : b.status === 'OCCUPIED' ? 'MISMATCH' : (b.status as BedMarkState))
        : (b.status as BedMarkState);
      const cur = byBedRoom.get(b.spaceNodeId) ?? { spaceNodeId: b.spaceNodeId, beds: [], emergency: er };
      cur.beds.push({ bedId: b.id, label: `${b.roomNumber}-${b.bedNumber}`, state });
      byBedRoom.set(b.spaceNodeId, cur);
    }

    return {
      asOf: now.toISOString(),
      /** 병상 층 — 도면에 연결된 병상만 · 미연결은 병동별로 센다 */
      bedRooms: [...byBedRoom.values()],
      bedsUnlinked: [...bedsUnlinked.entries()].map(([ward, count]) => ({ ward, count })).sort((a, b) => b.count - a.count),
      bedsTotal: beds.length,
      target: { opdWaitMin: targets.opdWaitMin, source: sources.opdWaitMin },
      rooms: [...byRoom.values()].sort((a, b) => a.name.localeCompare(b.name)),
      stations: [...byStation.values()].sort((a, b) => a.name.localeCompare(b.name)),
      unplaced: {
        /** 오늘 대기열 중 진료실이 정해지지 않은 행(접수 때 진료 일정에 진료실이 없었다) */
        queueWithoutRoom,
        /** 진료실은 있는데 그 진료실이 공간에 연결되지 않은 대기(진료실 이름별) */
        queueRoomNotLinked: [...notLinked.entries()].map(([roomName, count]) => ({ roomName, count })).sort((a, b) => b.count - a.count),
        stationsNotLinked,
        stationLogsNotPlaced,
      },
      /** 오늘 대기열 전체(분모) — 공간에 놓인 것 + 위 세 갈래 */
      queueTotal: queue.length,
    };
  }
}
