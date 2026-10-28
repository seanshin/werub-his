import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rankNextStations } from '@hospital-run/shared';
import { SpaceModelService } from '../../src/modules/space-model/space-model.service';
import { CheckupStationService } from '../../src/modules/checkup/checkup-station.service';

/**
 * P4a — 검진 다음 검사 추천에 이동 거리(확정 도면 경로 m).
 *   ① walkDistances: 같은 공간 0 · 가까운 방이 짧다 · 도면에 없는 공간/출발 미상/REAL 합성 → null(지어내지 않는다)
 *   ② getNextStation: 순서·대기가 같을 때만 거리가 순서를 가른다 · 출발 = 마지막 완료 스테이션의 공간
 *   ③ 🔴 거리를 시간으로 바꾸지 않는다 — 대기가 다르면 거리가 이기지 못한다
 */
const FIX = JSON.parse(readFileSync(join(__dirname, '../../prisma/fixtures/floorplans-synthetic/space-import.v1.json'), 'utf8'));
const N: any[] = [];
{
  let i = 0;
  for (const F of FIX.floors) for (const s of F.spaces) if (s.spaceNodeCode)
    N.push({ id: `00000000-0000-4000-8000-${String(++i).padStart(12, '0')}`, code: s.spaceNodeCode, nodeType: 'ZONE', floor: F.level, name: s.name, isActive: true, metadata: null });
}
const idOf = (code: string) => N.find((n) => n.code === code)!.id;

function space(mode = 'REHEARSAL', imp: any = { id: 'i', status: 'CONFIRMED', source: 'SYNTHETIC', payload: FIX, confirmedAt: new Date() }) {
  const prisma: any = { spaceNode: { findMany: vi.fn(async () => N) }, spaceImport: { findFirst: vi.fn(async () => imp) } };
  return new SpaceModelService(prisma, { effective: vi.fn(async () => mode) } as any);
}

describe('① walkDistances', () => {
  it('같은 공간 0 · 같은 층이 다른 층보다 가깝다 · 정수 m', async () => {
    const d = await space().walkDistances(idOf('B1-RC'), [idOf('B1-RC'), idOf('B1-LAB'), idOf('F2-LAB')]);
    expect(d.get(idOf('B1-RC'))).toBe(0);
    const near = d.get(idOf('B1-LAB'))!, far = d.get(idOf('F2-LAB'))!;
    expect(Number.isInteger(near)).toBe(true);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });
  it('출발 미상 · 도면에 없는 공간 · 도면 없음 · REAL 합성 → null', async () => {
    const unknown = '00000000-0000-4000-8000-999999999999';
    expect([...(await space().walkDistances(null, [idOf('B1-LAB')])).values()]).toEqual([null]);
    expect((await space().walkDistances(idOf('B1-RC'), [unknown])).get(unknown)).toBeNull();
    expect([...(await space('REHEARSAL', null).walkDistances(idOf('B1-RC'), [idOf('B1-LAB')])).values()]).toEqual([null]);
    expect([...(await space('REAL').walkDistances(idOf('B1-RC'), [idOf('B1-LAB')])).values()]).toEqual([null]);
  });
});

describe('② ③ 정렬 규칙', () => {
  const c = (key: string, o: Partial<{ priority: number; waitingCount: number | null; avgMinutes: number | null; distanceM: number | null }>) =>
    ({ key, priority: 1, waitingCount: 0, avgMinutes: 5, distanceM: null, ...o });
  it('순서·대기가 같으면 가까운 방 · 거리 미상은 뒤로', () => {
    expect(rankNextStations([c('a', { distanceM: 80 }), c('b', { distanceM: 20 }), c('c', {})]).map((x) => x.key)).toEqual(['b', 'a', 'c']);
  });
  it('🔴 대기가 다르면 거리가 이기지 못한다(거리를 시간으로 바꾸지 않는다) · 순서 규칙이 먼저', () => {
    expect(rankNextStations([c('near', { waitingCount: 2, distanceM: 5 }), c('far', { waitingCount: 1, distanceM: 300 })])[0].key).toBe('far');
    expect(rankNextStations([c('near', { priority: 2, distanceM: 1 }), c('far', { priority: 1, distanceM: 300 })])[0].key).toBe('far');
  });
});

describe('② getNextStation 배선', () => {
  it('출발 = 마지막 완료 스테이션의 공간 · 대기 같은 두 방 중 가까운 쪽 · distanceM 응답', async () => {
    const t0 = new Date('2026-09-28T01:00:00Z'), t1 = new Date('2026-09-28T01:30:00Z');
    const prisma: any = {
      checkupVisit: { findUnique: vi.fn(async () => ({
        id: 'v', program: { items: [] },
        stationLogs: [
          { stationId: 'ck-physical', completedAt: t0, station: { spaceNodeId: idOf('F2-LAB') } },
          { stationId: 'ck-rc', completedAt: t1, station: { spaceNodeId: idOf('B1-RC') } },
        ],
        items: [{ testName: '흉부 X-ray', category: 'IMAGING', finding: 'PENDING' }],
      })) },
      checkupStation: { findMany: vi.fn(async () => [
        { stationId: 'ck-far', name: '먼 촬영실', category: 'IMAGING', avgMinutes: 5, icon: null, spaceNode: { id: idOf('F2-LAB'), name: '채혈실/검사실', floor: 2 } },
        { stationId: 'ck-near', name: '가까운 촬영실', category: 'IMAGING', avgMinutes: 5, icon: null, spaceNode: { id: idOf('B1-XRAY'), name: '검진 X-ray', floor: -1 } },
      ]) },
      checkupStationLog: { groupBy: vi.fn(async () => []) },
    };
    const sm = space();
    const spy = vi.spyOn(sm, 'walkDistances');
    const r: any = await new CheckupStationService(prisma, undefined, sm).getNextStation('v');
    expect(spy.mock.calls[0][0]).toBe(idOf('B1-RC')); // 가장 최근 완료
    expect(r.stationId).toBe('ck-near');
    expect(typeof r.distanceM).toBe('number');
  });
  it('도면 모듈이 없으면 거리 없이 추천(distanceM null)', async () => {
    const prisma: any = {
      checkupVisit: { findUnique: vi.fn(async () => ({ id: 'v', program: { items: [] }, stationLogs: [], items: [{ testName: 'x', category: 'LAB', finding: 'PENDING' }] })) },
      checkupStation: { findMany: vi.fn(async () => [{ stationId: 's', name: 's', category: 'LAB', avgMinutes: 5, icon: null, spaceNode: null }]) },
      checkupStationLog: { groupBy: vi.fn(async () => []) },
    };
    expect(await new CheckupStationService(prisma).getNextStation('v')).toMatchObject({ stationId: 's', distanceM: null });
  });
});
