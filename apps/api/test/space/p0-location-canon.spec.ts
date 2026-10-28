import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FloorService } from '../../src/modules/floor/floor.service';
import { JourneyService } from '../../src/modules/journey/journey.service';
import { CheckupStationService } from '../../src/modules/checkup/checkup-station.service';

/**
 * 공간·동선 P0 정본화 — 기획 spatial-flow-vision-3d P0-1~P0-9.
 *
 * 못박는 것:
 *   ① 위치 원장의 쓰기는 `FloorService.recordLocation` 하나 — 열린 위치를 전부 닫고(체류 분 채움) 출처·해상도를 밝혀 연다.
 *   ② 추정 후보가 여럿이면 아무 구역이나 고르지 않는다 — 한 층이면 층 단위, 층도 갈리면 기록하지 않는다.
 *   ③ 시뮬레이터 이벤트는 SIMULATED · 검진 스테이션 도착은 공간에 연결됐을 때만 OBSERVED_STATION.
 *   ④ 다음 스테이션: 오늘 도착·미완료만 센다 · 검사 순서가 대기보다 먼저 · 위치는 공간 연결에서만.
 *   ⑤ 포털의 하드코딩 층·위치 텍스트 제거 · 스테이션 조회 실패를 빈 목록으로 접지 않는다.
 *   ⑥ 마이그레이션 백필은 기록된 사실에서만 파생 · source 에 DB 기본값 없음.
 *   ⑦ 격자 시드는 기하 출처 표식을 남기고 걸음 시간을 지어내지 않는다.
 */

const src = (rel: string) => readFileSync(join(__dirname, '../..', rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const T0 = new Date('2026-09-28T01:00:00Z');

describe('① 위치 원장 단일 쓰기 경로 — FloorService.recordLocation', () => {
  function make(open: { id: string; zoneId: string; enteredAt: Date }[]) {
    const updates: any[] = [];
    const creates: any[] = [];
    const tx = {
      $executeRaw: vi.fn(async () => 1), // 환자별 위치 쓰기 잠금(2026-10-03)
      patientLocation: {
        findMany: vi.fn(async () => open),
        update: vi.fn(async (a: any) => { updates.push(a); return a; }),
        create: vi.fn(async (a: any) => { creates.push(a.data); return { id: 'new', ...a.data }; }),
      },
    };
    const prisma: any = { $transaction: async (cb: any) => cb(tx) };
    const svc = new FloorService(prisma);
    const emit = vi.spyOn(svc, 'emitMovement').mockResolvedValue(undefined);
    return { svc, updates, creates, emit };
  }

  it('열린 위치를 전부 닫고(체류 분) 출처·해상도를 밝혀 연다 · 직전 구역에서 이동으로 알린다', async () => {
    vi.useFakeTimers({ now: new Date(T0.getTime() + 25 * 60000 + 20000) });
    const { svc, updates, creates, emit } = make([
      { id: 'a', zoneId: 'z-old', enteredAt: T0 },
      { id: 'b', zoneId: 'z-older', enteredAt: new Date(T0.getTime() - 3600000) },
    ]);
    await svc.recordLocation({ patientId: 'p1', zoneId: 'z-new', source: 'OBSERVED_QR', granularity: 'ZONE', status: 'PRESENT', eventType: 'QR_CHECKIN' });
    vi.useRealTimers();
    expect(updates.map((u) => [u.where.id, u.data.duration])).toEqual([['a', 25], ['b', 85]]);
    expect(creates[0]).toMatchObject({ zoneId: 'z-new', source: 'OBSERVED_QR', granularity: 'ZONE', status: 'PRESENT' });
    expect(emit).toHaveBeenCalledWith('p1', 'z-old', 'z-new');
  });

  it('이동 발행 실패는 warn 으로 남기고 던지지 않는다(대조: 성공이면 warn 없음)', async () => {
    const prisma: any = { spaceNode: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) } };
    const svc = new FloorService(prisma);
    const warn = vi.fn();
    (svc as any).logger = { warn };
    await expect(svc.emitMovement('p1', null, 'z1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/db down/);

    const ok: any = { spaceNode: { findUnique: vi.fn().mockResolvedValue(null) } };
    const svc2 = new FloorService(ok);
    const warn2 = vi.fn();
    (svc2 as any).logger = { warn: warn2 };
    await svc2.emitMovement('p1', null, 'z1');
    expect(warn2).not.toHaveBeenCalled();
  });
});

describe('②③ 여정 → 위치 — 추정·관측·시뮬레이션', () => {
  function make(opts: { candidates?: { id: string; floor: number | null }[]; floorNode?: { id: string } | null; stationSpace?: string | null }) {
    const prisma: any = {
      spaceNode: {
        findMany: vi.fn().mockResolvedValue(opts.candidates ?? []),
        findFirst: vi.fn().mockResolvedValue(opts.floorNode ?? null),
      },
      checkupStationLog: {
        findUnique: vi.fn().mockResolvedValue(opts.stationSpace === undefined ? null : { station: { spaceNodeId: opts.stationSpace } }),
      },
    };
    const floor: any = { recordLocation: vi.fn().mockResolvedValue({}) };
    const svc = new JourneyService(prisma, floor);
    const run = (ev: any) => (svc as any).updatePatientLocation({ patientId: 'p1', title: 't', ...ev }, 'ev1');
    return { prisma, floor, run };
  }

  it('후보 1 → 구역 · INFERRED_EVENT', async () => {
    const { floor, run } = make({ candidates: [{ id: 'z1', floor: 2 }] });
    await run({ eventType: 'ORDER_CREATED' });
    expect(floor.recordLocation).toHaveBeenCalledWith(expect.objectContaining({ zoneId: 'z1', granularity: 'ZONE', source: 'INFERRED_EVENT' }));
  });

  it('🔴 후보 여럿·한 층 → 층 노드(FLOOR) — 아무 구역이나 고르지 않는다', async () => {
    const { floor, run } = make({ candidates: [{ id: 'z1', floor: 2 }, { id: 'z2', floor: 2 }], floorNode: { id: 'f2' } });
    await run({ eventType: 'ORDER_CREATED' });
    expect(floor.recordLocation).toHaveBeenCalledWith(expect.objectContaining({ zoneId: 'f2', granularity: 'FLOOR' }));
  });

  it('🔴 후보가 여러 층에 걸치면 기록하지 않는다', async () => {
    const { floor, run } = make({ candidates: [{ id: 'z1', floor: 2 }, { id: 'z9', floor: -1 }], floorNode: { id: 'f2' } });
    await run({ eventType: 'ORDER_CREATED' });
    expect(floor.recordLocation).not.toHaveBeenCalled();
  });

  it('시뮬레이터 이벤트는 SIMULATED', async () => {
    const { floor, run } = make({ candidates: [{ id: 'z1', floor: 1 }] });
    await run({ eventType: 'ER_ARRIVAL', metadata: { simulated: true } });
    expect(floor.recordLocation).toHaveBeenCalledWith(expect.objectContaining({ source: 'SIMULATED' }));
  });

  it('검진 스테이션 도착 — 공간 연결 있음=OBSERVED_STATION · 없음=기록 안 함 · 참조 없음=기록 안 함', async () => {
    const a = make({ stationSpace: 'z-lab' });
    await a.run({ eventType: 'CHECKUP_STATION_ARRIVE', refType: 'CheckupStationLog', refId: 'log1' });
    expect(a.floor.recordLocation).toHaveBeenCalledWith(expect.objectContaining({ zoneId: 'z-lab', source: 'OBSERVED_STATION' }));

    const b = make({ stationSpace: null });
    await b.run({ eventType: 'CHECKUP_STATION_ARRIVE', refType: 'CheckupStationLog', refId: 'log1' });
    expect(b.floor.recordLocation).not.toHaveBeenCalled();

    const c = make({ stationSpace: 'z-lab' });
    await c.run({ eventType: 'CHECKUP_STATION_ARRIVE' });
    expect(c.floor.recordLocation).not.toHaveBeenCalled();
    expect(c.prisma.spaceNode.findMany).not.toHaveBeenCalled(); // 추정 매핑으로 새지 않는다
  });

  // 🔴 2026-09-28 — 시뮬레이터는 이제 원장에 아예 쓰지 않는다(격리 · test/simulator/simulator.service.spec.ts).
  //    표식 경로(metadata.simulated → SIMULATED)는 다른 발행자를 위해 journey 쪽에 남는다.
  it('시뮬레이터는 여정 원장에 발행하지 않는다(소스)', () => {
    expect(strip(src('src/modules/simulator/simulator.service.ts'))).not.toMatch(/journey\.emit/);
  });
});

describe('④ 다음 스테이션 — 오늘만 · 순서 우선 · 위치는 공간 연결에서', () => {
  function make() {
    const groupBy = vi.fn().mockResolvedValue([
      { stationId: 'ck-blood', _count: 5 },   // 채혈: 5명 × 4분 = 20분
      { stationId: 'ck-ecg', _count: 0 },     // 심전도: 0분
    ]);
    const prisma: any = {
      checkupVisit: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'v1',
          stationLogs: [],
          items: [
            { testName: '혈액검사', category: 'LAB', finding: 'PENDING' },
            { testName: '심전도', category: 'DIAGNOSTIC', finding: 'PENDING' },
          ],
        }),
      },
      checkupStation: {
        findMany: vi.fn().mockResolvedValue([
          { stationId: 'ck-blood', name: '채혈실', category: 'LAB', icon: null, avgMinutes: 4, spaceNode: { id: 'n1', name: '검진 채혈실', floor: -1 } },
          { stationId: 'ck-ecg', name: '심전도실', category: 'DIAGNOSTIC', icon: null, avgMinutes: 5, spaceNode: null },
        ]),
      },
      checkupStationLog: { groupBy },
    };
    return { svc: new CheckupStationService(prisma), groupBy };
  }

  it('🔴 대기 수는 오늘 도착·미완료만(날짜 조건이 실제로 걸린다)', async () => {
    const { svc, groupBy } = make();
    await svc.getNextStation('v1');
    const where = groupBy.mock.calls[0][0].where;
    expect(where.completedAt).toBeNull();
    expect(where.arrivedAt.gte).toBeInstanceOf(Date);
    expect(where.arrivedAt.lt).toBeInstanceOf(Date);
  });

  it('🔴 금식 채혈(우선순위 1)이 대기가 길어도 심전도(3)보다 먼저 · 위치는 공간 연결 이름', async () => {
    const { svc } = make();
    const next = await svc.getNextStation('v1');
    expect(next).toMatchObject({ stationId: 'ck-blood', location: '검진 채혈실', floor: -1, estimatedWait: 20 });
  });

  it('공간 연결이 없는 스테이션의 위치는 null(자유 텍스트로 채우지 않는다)', async () => {
    const { svc } = make();
    // 채혈을 끝낸 방문 → 심전도만 남는다
    (svc as any).prisma.checkupVisit.findUnique.mockResolvedValue({
      id: 'v1', stationLogs: [{ stationId: 'ck-blood', completedAt: new Date() }],
      items: [{ testName: '심전도', category: 'DIAGNOSTIC', finding: 'PENDING' }],
    });
    const next = await svc.getNextStation('v1');
    expect(next).toMatchObject({ stationId: 'ck-ecg', location: null, floor: null });
  });
});

describe('⑤ 포털 — 하드코딩 위치 제거 · 실패를 없음으로 접지 않는다', () => {
  const portal = strip(src('src/modules/portal/portal.service.ts'));
  it('검사실 표에 층·위치 텍스트가 없다', () => {
    const m = /const ROOM_STATION[^=]*=\s*\{([\s\S]*?)\};/.exec(portal);
    expect(m, 'ROOM_STATION 표를 찾지 못했다(가드가 헛돈다)').toBeTruthy();
    expect(m![1]).not.toMatch(/\d\s*층|\bB\d|[1-9]F'/);
    expect(portal).not.toMatch(/ROOM_MAP/);
  });
  it('스테이션 조회 실패를 빈 목록으로 접지 않는다', () => {
    expect(portal).not.toMatch(/checkupStation\.findMany\([^)]*\)\s*\.catch\(\(\)\s*=>\s*\[\]\)/);
  });
  it('추천 정렬은 정본 rankNextStations', () => {
    expect(portal).toMatch(/rankNextStations\(pendingWithCongestion\)/);
    expect(portal).not.toMatch(/CONGESTION_ORDER/);
  });
});

describe('⑥ 마이그레이션 — 백필은 기록된 사실에서만', () => {
  const sql = src('prisma/migrations/20260928000002_location_source_station_space/migration.sql');
  const schema = src('prisma/schema.prisma');
  it('출처 4갈래 파생 · 미상은 UNKNOWN · NOT NULL · DB 기본값 없음', () => {
    expect(sql).toMatch(/WHEN "event_type" = 'QR_CHECKIN' THEN 'OBSERVED_QR'/);
    expect(sql).toMatch(/WHEN "metadata" ->> 'demo' = 'true' THEN 'SIMULATED'/);
    expect(sql).toMatch(/WHEN "event_type" IS NOT NULL THEN 'INFERRED_EVENT'/);
    expect(sql).toMatch(/ELSE 'UNKNOWN'/);
    expect(sql).toMatch(/ALTER COLUMN "source" SET NOT NULL/);
    expect(sql).not.toMatch(/"source" VARCHAR\(20\)[^;]*DEFAULT/);
    expect(schema).toMatch(/source\s+String\s+@db\.VarChar\(20\)\s*\n/); // 스키마에도 기본값 없음
  });
  it('스테이션 공간 연결을 마이그레이션이 채우지 않는다(가상병원 배치를 박지 않음)', () => {
    expect(sql).not.toMatch(/UPDATE "ck_stations"/);
  });
});

describe('⑦ 격자 시드 — 기하 출처 표식 · 걸음 시간 날조 금지', () => {
  const seed = strip(src('prisma/seed-floor-metadata.ts'));
  it('geometrySource GRID_AUTO 를 남기고 walkTime 기본값을 채우지 않는다', () => {
    expect(seed).toMatch(/geometrySource:\s*'GRID_AUTO'/);
    expect(seed).not.toMatch(/walkTime:\s*[^,}]*\?\?\s*\d/);
  });
});
