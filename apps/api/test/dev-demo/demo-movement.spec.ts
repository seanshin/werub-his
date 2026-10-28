/**
 * 데모 환자 이동 시뮬레이터(2026-10-09) — 통합 상황판 3D 환자 위치를 데모로 보이게.
 *  · 🔴 원장과 모순되게 놓지 않는다(대기 중을 진료실에·떠난 환자를 남기지 않는다) · 병동 층 모르면 놓지 않는다
 *  · 🔴 REAL 모드·데모 꺼짐이면 돌지 않는다 · 관측 위치가 열린 환자는 건드리지 않는다 · 남이 연 시뮬레이션은 닫지 않는다
 */
import { WifiPositioningService } from '../../src/modules/wifi-location/wifi-positioning.service';
import { describe, it, expect, vi } from 'vitest';
import { planDemoPositions, demoHash, type ZoneRef } from '../../src/modules/dev-demo/demo-movement';
import { DemoMovementService, DEMO_MOVEMENT_EVENT } from '../../src/modules/dev-demo/demo-movement.service';

const Z = (id: string, spaceType: string, floor: number, department: string | null = null): ZoneRef => ({ id, spaceType, floor, department, code: id });
const zones = [
  Z('rec1', 'RECEPTION', 1), Z('cash1', 'CASHIER', 1), Z('ph1', 'PHARMACY', 1), Z('er1', 'ER', 1), Z('or1', 'SURGERY', 1), Z('pacu1', 'RECOVERY', 1),
  Z('wait2-im', 'WAITING', 2, '내과'), Z('wait2-sg', 'WAITING', 2, '외과'), Z('clin201', 'CLINIC', 2), Z('lab2', 'LAB', 2),
  Z('w301', 'WARD_ROOM', 3), Z('w302', 'WARD_ROOM', 3),
];
const now = new Date('2026-10-09T05:00:00Z');
const ago = (m: number) => new Date(now.getTime() - m * 60000);
const base = { now, zones, clinicRoomZone: new Map([['내과1진료실', 'clin201']]), queue: [], inpatients: [], er: [], surgeries: [], pacu: [] };
// 진료 전 검사 갈래(hash%4==0)인 환자 id 와 아닌 id
const preTestId = Array.from({ length: 50 }, (_, i) => `p-pre-${i}`).find((id) => demoHash(id) % 4 === 0)!;
const plainId = Array.from({ length: 50 }, (_, i) => `p-plain-${i}`).find((id) => demoHash(id) % 4 !== 0)!;

describe('이동 계획 — 원장과 모순되지 않게', () => {
  it('🔴 대기 중이면 접수 → 대기실(같은 진료과 대기실) · 진료실엔 두지 않는다', () => {
    const q = (pid: string, m: number) => ({ patientId: pid, status: 'WAITING', roomName: '내과1진료실', departmentName: '내과', checkedInAt: ago(m), completedAt: null });
    const p = planDemoPositions({ ...base, queue: [q('a', 2), q(plainId, 40)] });
    expect(p.get('a')).toMatchObject({ zoneId: 'rec1', status: 'reception' });
    expect(p.get(plainId)).toMatchObject({ zoneId: 'wait2-im', status: 'waiting' });
    expect([...p.values()].some((x) => x.zoneId === 'clin201')).toBe(false);
  });
  it('진료 전 검사 갈래는 15~30분에 검사실을 다녀온다(그 뒤 대기실)', () => {
    const q = (m: number) => ({ patientId: preTestId, status: 'WAITING', roomName: '내과1진료실', departmentName: '내과', checkedInAt: ago(m), completedAt: null });
    expect(planDemoPositions({ ...base, queue: [q(20)] }).get(preTestId)).toMatchObject({ zoneId: 'lab2', status: 'in-lab' });
    expect(planDemoPositions({ ...base, queue: [q(40)] }).get(preTestId)).toMatchObject({ zoneId: 'wait2-im' });
  });
  it('🔴 진료 중이면 그 진료실 · 진료 뒤 수납 → 약국 → 떠남', () => {
    const p = planDemoPositions({ ...base, queue: [
      { patientId: 'ip', status: 'IN_PROGRESS', roomName: '내과1진료실', departmentName: '내과', checkedInAt: ago(50), completedAt: null },
      { patientId: 'c10', status: 'COMPLETED', roomName: '내과1진료실', departmentName: '내과', checkedInAt: ago(90), completedAt: ago(10) },
      { patientId: 'c20', status: 'COMPLETED', roomName: '내과1진료실', departmentName: '내과', checkedInAt: ago(90), completedAt: ago(20) },
      { patientId: 'c40', status: 'COMPLETED', roomName: '내과1진료실', departmentName: '내과', checkedInAt: ago(90), completedAt: ago(40) },
    ] });
    expect(p.get('ip')).toMatchObject({ zoneId: 'clin201', status: 'in-treatment' });
    expect(p.get('c10')).toMatchObject({ zoneId: 'cash1' });
    expect(p.get('c20')).toMatchObject({ zoneId: 'ph1' });
    expect(p.has('c40')).toBe(false);
  });
  it('🔴 입원은 병동 층의 병실 · 층을 모르면 놓지 않는다 · 미래 접수는 놓지 않는다', () => {
    const p = planDemoPositions({ ...base,
      inpatients: [{ patientId: 'in1', wardFloor: 3, roomNumber: '301' }, { patientId: 'in2', wardFloor: null, roomNumber: null }],
      queue: [{ patientId: 'fut', status: 'WAITING', roomName: null, departmentName: '내과', checkedInAt: new Date(now.getTime() + 600000), completedAt: null }] });
    expect(['w301', 'w302']).toContain(p.get('in1')!.zoneId);
    expect(p.has('in2')).toBe(false);
    expect(p.has('fut')).toBe(false);
  });
  it('한 환자는 한 곳 — 수술 중이 외래 대기보다 먼저', () => {
    const p = planDemoPositions({ ...base, surgeries: [{ patientId: 'x' }], queue: [{ patientId: 'x', status: 'WAITING', roomName: null, departmentName: '내과', checkedInAt: ago(40), completedAt: null }] });
    expect(p.get('x')).toMatchObject({ zoneId: 'or1', status: 'in-surgery' });
  });
});

describe('시뮬레이터 실행', () => {
  const mk = (opts: { mode?: string; enabled?: boolean; open?: Array<{ patientId: string; zoneId: string; source: string; eventType: string | null }> }) => {
    const prisma = {
      spaceNode: { findMany: vi.fn(async () => zones) },
      clinicRoom: { findMany: vi.fn(async () => [{ name: '내과1진료실', spaceNodeId: 'clin201' }]) },
      waitingQueue: { findMany: vi.fn(async () => [
        { patientId: 'q1', status: 'IN_PROGRESS', roomName: '내과1진료실', departmentName: '내과', checkedInAt: ago(60), completedAt: null },
        { patientId: 'q2', status: 'IN_PROGRESS', roomName: '내과1진료실', departmentName: '내과', checkedInAt: ago(60), completedAt: null },
        { patientId: 'q3', status: 'IN_PROGRESS', roomName: '내과1진료실', departmentName: '내과', checkedInAt: ago(60), completedAt: null },
      ]) },
      admission: { findMany: vi.fn(async () => []) },
      emergencyVisit: { findMany: vi.fn(async () => []) },
      surgery: { findMany: vi.fn(async () => []) },
      pacuRecord: { findMany: vi.fn(async () => []) },
      patientLocation: { findMany: vi.fn(async () => opts.open ?? []) },
    };
    const floor = { recordLocation: vi.fn(async () => ({})), closeOpenLocations: vi.fn(async () => ({ closed: 1 })) };
    const demo = { isEnabled: vi.fn(async () => opts.enabled ?? true) };
    const hisMode = { effective: vi.fn(async () => opts.mode ?? 'REHEARSAL') };
    return { svc: new DemoMovementService(prisma as never, floor as never, demo as never, hisMode as never), prisma, floor };
  };
  it('🔴 REAL 모드·데모 꺼짐이면 아무것도 읽지도 쓰지도 않는다', async () => {
    const real = mk({ mode: 'REAL' });
    expect(await real.svc.run(now)).toMatchObject({ ran: false, reason: 'REAL_MODE' });
    expect(real.prisma.waitingQueue.findMany).not.toHaveBeenCalled();
    const off = mk({ enabled: false });
    expect(await off.svc.run(now)).toMatchObject({ ran: false, reason: 'DEMO_DISABLED' });
    expect(off.floor.recordLocation).not.toHaveBeenCalled();
  });
  it('🔴 관측 위치가 열린 환자는 건드리지 않는다 · 같은 구역이면 쓰지 않는다 · 나머지는 SIMULATED 로 정본 쓰기 경로를 지난다', async () => {
    const { svc, floor } = mk({ open: [
      { patientId: 'q1', zoneId: 'lab2', source: 'OBSERVED_QR', eventType: null },
      { patientId: 'q2', zoneId: 'clin201', source: 'SIMULATED', eventType: DEMO_MOVEMENT_EVENT },
    ] });
    const r = await svc.run(now);
    expect(r).toMatchObject({ ran: true, skippedObserved: 1, unchanged: 1, moved: 1 });
    expect(floor.recordLocation).toHaveBeenCalledTimes(1);
    expect(floor.recordLocation).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'q3', zoneId: 'clin201', source: 'SIMULATED', granularity: 'ZONE', eventType: DEMO_MOVEMENT_EVENT }));
  });
  it('🔴 이 생성기가 놓은 환자가 계획에서 빠지면 닫고 · 남이 연 시뮬레이션은 닫지 않는다', async () => {
    const { svc, floor } = mk({ open: [
      { patientId: 'gone', zoneId: 'wait2-im', source: 'SIMULATED', eventType: DEMO_MOVEMENT_EVENT },
      { patientId: 'other', zoneId: 'wait2-im', source: 'SIMULATED', eventType: 'ER_ARRIVAL' },
    ] });
    const r = await svc.run(now);
    expect(r.closed).toBe(1);
    expect(floor.closeOpenLocations).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'gone', closeSource: 'SIMULATED' }));
    expect(floor.closeOpenLocations).not.toHaveBeenCalledWith(expect.objectContaining({ patientId: 'other' }));
  });
});

describe('무선 측위 시뮬레이션(2026-10-09)', () => {
  const APS = [
    { bssid: '02:00:00:00:00:01', floorKey: '2F', floorLevel: 2, x: 2, y: 2, rssiAt1m: null, pathLossExponent: null },
    { bssid: '02:00:00:00:00:02', floorKey: '2F', floorLevel: 2, x: 18, y: 2, rssiAt1m: null, pathLossExponent: null },
    { bssid: '02:00:00:00:00:03', floorKey: '2F', floorLevel: 2, x: 10, y: 14, rssiAt1m: null, pathLossExponent: null },
  ];
  const ctx = (aps = APS) => ({
    aps: new Map(aps.map((a) => [a.bssid, a])), apList: aps, floors: [{ key: '2F', level: 2 }],
    spacesByFloor: new Map([['2F', [{ spaceNodeId: 'clin201', rect: { x: 0, y: 0, w: 20, h: 16 } }]]]),
    zoneRect: new Map([['clin201', { floorKey: '2F', floorLevel: 2, rect: { x: 0, y: 0, w: 20, h: 16 } }]]),
    survey: [],
  });
  const mkW = (c: ReturnType<typeof ctx>, open: Array<{ patientId: string; zoneId: string; source: string; eventType: string | null }> = []) => {
    const prisma: any = {
      spaceNode: { findMany: vi.fn(async () => zones) },
      clinicRoom: { findMany: vi.fn(async () => [{ name: '내과1진료실', spaceNodeId: 'clin201' }]) },
      waitingQueue: { findMany: vi.fn(async () => ['q1', 'q2'].map((patientId) => ({ patientId, status: 'IN_PROGRESS', roomName: '내과1진료실', departmentName: '내과', checkedInAt: ago(60), completedAt: null }))) },
      admission: { findMany: vi.fn(async () => []) }, emergencyVisit: { findMany: vi.fn(async () => []) },
      surgery: { findMany: vi.fn(async () => []) }, pacuRecord: { findMany: vi.fn(async () => []) },
      patientLocation: { findMany: vi.fn(async () => open) },
      wifiPositionFix: { deleteMany: vi.fn(async () => ({ count: 4 })) },
    };
    const floor = { recordLocation: vi.fn(async () => ({})), closeOpenLocations: vi.fn(async () => ({ closed: 1 })) };
    // 측위는 실제 서비스의 solve(가중 중심 → 표본이 있으면 신호 지도)와 같은 길 — 표본 없음
    const wifi = { context: vi.fn(async () => c), storeFix: vi.fn(async () => ({ fixId: 'f', moved: false })), solve: (r: any, ctx: any) => WifiPositioningService.prototype.solve.call({}, r, ctx) };
    const svc = new DemoMovementService(prisma, floor as never, { isEnabled: async () => true } as never, { effective: async () => 'REHEARSAL' } as never, wifi as never);
    return { svc, wifi, prisma };
  };
  it('🔴 AP 가 없으면 만들지 않고 이유를 말한다', async () => {
    const { svc, wifi } = mkW(ctx([]));
    expect((await svc.run(now)).wifi).toEqual({ skipped: 'NO_ACCESS_POINTS' });
    expect(wifi.storeFix).not.toHaveBeenCalled();
  });
  it('🔴 SIMULATED 로 신호를 만든 방과 함께 저장 · 관측 위치가 열린 환자는 만들지 않음 · 지우는 것은 이 생성기 몫만', async () => {
    const { svc, wifi, prisma } = mkW(ctx(), [{ patientId: 'q2', zoneId: 'lab2', source: 'OBSERVED_WIFI', eventType: 'WIFI_FIX' }]);
    const r = await svc.run(now);
    expect(r.wifi).toEqual({ fixes: 1, failed: 0, pruned: 4 });
    expect(wifi.storeFix).toHaveBeenCalledTimes(1);
    expect(wifi.storeFix).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'q1', source: 'SIMULATED', truthZoneId: 'clin201', collectorId: null, bindingId: null }), expect.anything());
    expect(prisma.wifiPositionFix.deleteMany.mock.calls[0][0].where).toMatchObject({ source: 'SIMULATED', collectorId: null, bindingId: null });
  });
});
