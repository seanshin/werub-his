/**
 * 무선 AP 기반 원내 위치(2026-10-09 · wifi-location.v1).
 *  · 🔴 꺼져 있으면 503(받은 척하지 않는다) · 형식 오류는 배치 전체 400 · 수집 방식이 다르면 400
 *  · 🔴 연결(동의) 없는 단말은 저장하지 않는다(해시도 남기지 않음) · 미래·오래된 관측은 그 관측만 거절
 *  · 🔴 위치 원장은 같은 방이 연속 두 번 잡혀야 옮긴다 · 층까지만 아는 측위·시뮬레이션은 원장을 옮기지 않는다
 *  · 연결은 동의 근거 필수(구두는 메모 필수 · DEMO 는 직원 화면 불가) · 한 단말은 한 연결 · 해제는 사유
 *  · 시드 배치 — 층마다 3대 이상 · 수직 코어 안에 두지 않음 · 멱등(같은 도면 → 같은 BSSID)
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { simulateWifiReadings, type SpaceImportV1 } from '@hospital-run/shared';
import { WifiPositioningService } from '../../src/modules/wifi-location/wifi-positioning.service';
import { WifiRegistryService } from '../../src/modules/wifi-location/wifi-registry.service';
import { planDemoAccessPoints } from '../../prisma/seeds/wifi-access-points';
import { DECISION_BATCH_2026_10_E } from '../../src/modules/decision-registry/decision.registry.batch-2026-10-e';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';

const NOW = new Date('2026-10-09T05:00:00Z');
const KEY = 'wfc_test';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
// 2층 30×20m — 방 A(0~15) · 방 B(15~30) · AP 4대
const APS = [
  { bssid: '02:00:00:00:00:01', floorKey: '2F', floorLevel: 2, x: 3, y: 3, rssiAt1m: null, pathLossExponent: null },
  { bssid: '02:00:00:00:00:02', floorKey: '2F', floorLevel: 2, x: 12, y: 3, rssiAt1m: null, pathLossExponent: null },
  { bssid: '02:00:00:00:00:03', floorKey: '2F', floorLevel: 2, x: 3, y: 17, rssiAt1m: null, pathLossExponent: null },
  { bssid: '02:00:00:00:00:04', floorKey: '2F', floorLevel: 2, x: 27, y: 10, rssiAt1m: null, pathLossExponent: null },
];
const GEO = { floors: [{ key: '2F', level: 2, spaces: [
  { spaceNodeId: 'room-a', rect: { x: 0, y: 0, w: 15, h: 20 } },
  { spaceNodeId: 'room-b', rect: { x: 15, y: 0, w: 15, h: 20 } },
] }] };
const readingsAt = (x: number, y: number) => simulateWifiReadings({ floorLevel: 2, x, y }, APS, 'fixed', 0);
const batch = (obs: Array<{ deviceRef: string; observedAt?: string; readings?: unknown }>, mode = 'NETWORK') => ({
  schema: 'wifi-location.v1', mode, sentAt: NOW.toISOString(),
  observations: obs.map((o) => ({ deviceRef: o.deviceRef, observedAt: o.observedAt ?? NOW.toISOString(), readings: o.readings ?? readingsAt(5, 8) })),
});

function mk(opts: { enabled?: boolean; bindings?: Array<{ id: string; deviceHash: string; patientId: string }>; prevFix?: { zoneId: string | null; granularity: string } | null; openZone?: string | null; newer?: boolean; deceased?: string[] } = {}) {
  const fixes: any[] = [];
  const prisma: any = {
    wifiAccessPoint: { findMany: vi.fn(async () => APS) },
    wifiSurveySample: { findMany: vi.fn(async () => []) }, // 현장 측정 표본 없음 — 가중 중심(2026-10-10)
    wifiCollector: { findFirst: vi.fn(async (a: any) => (a.where.keyHash === sha(KEY) ? { id: 'c1', mode: 'NETWORK' } : null)), update: vi.fn(async () => ({})) },
    wifiDeviceBinding: { findMany: vi.fn(async () => opts.bindings ?? []) },
    wifiPositionFix: {
      // 직전(observedAt ≤ 이 관측) · 더 새 측위(observedAt > 이 관측 — 늦게 온 관측 판정)
      findFirst: vi.fn(async (a: any) => (a?.where?.observedAt?.gt ? (opts.newer ? { id: 'newer' } : null) : (opts.prevFix ?? null))),
      create: vi.fn(async (a: any) => { fixes.push(a.data); return { id: `f${fixes.length}` }; }),
      update: vi.fn(async () => ({})),
    },
    patient: { findMany: vi.fn(async (a: any) => (opts.deceased ?? []).filter((id) => a.where.id.in.includes(id)).map((id) => ({ id }))) },
    patientLocation: { findFirst: vi.fn(async () => (opts.openZone === undefined ? null : { zoneId: opts.openZone })) },
  };
  const floor = { recordLocation: vi.fn(async () => ({ id: 'loc-1' })) };
  const space = { geometry: vi.fn(async () => GEO) };
  const config = { get: vi.fn(async () => opts.enabled ?? true) };
  return { svc: new WifiPositioningService(prisma, floor as never, space as never, config as never), prisma, floor, fixes };
}
const bound = [{ id: 'b1', deviceHash: WifiPositioningService.hashDevice('tag-0001'), patientId: 'p1' }];

describe('수집 — 거절 조건', () => {
  it('🔴 키가 없거나 틀리면 401 · 꺼져 있으면 503 이고 아무것도 저장하지 않는다', async () => {
    const a = mk();
    await expect(a.svc.ingest(undefined, batch([{ deviceRef: 'tag-0001' }]), NOW)).rejects.toMatchObject({ status: 401 });
    await expect(a.svc.ingest('wrong', batch([{ deviceRef: 'tag-0001' }]), NOW)).rejects.toMatchObject({ status: 401 });
    const off = mk({ enabled: false, bindings: bound });
    await expect(off.svc.ingest(KEY, batch([{ deviceRef: 'tag-0001' }]), NOW)).rejects.toMatchObject({ status: 503 });
    expect(off.prisma.wifiPositionFix.create).not.toHaveBeenCalled();
  });
  it('🔴 형식 오류는 배치 전체 400 · 수집 방식이 등록과 다르면 400', async () => {
    const a = mk({ bindings: bound });
    await expect(a.svc.ingest(KEY, { ...batch([{ deviceRef: 'tag-0001' }]), schema: 'v0' }, NOW)).rejects.toMatchObject({ status: 400 });
    await expect(a.svc.ingest(KEY, batch([{ deviceRef: 'tag-0001' }], 'DEVICE'), NOW)).rejects.toMatchObject({ status: 400 });
    expect(a.prisma.wifiPositionFix.create).not.toHaveBeenCalled();
  });
  it('🔴 연결 없는 단말은 저장하지 않고 수만 센다 · 미래/오래된 관측·모르는 AP 는 사유별로', async () => {
    const a = mk({ bindings: bound });
    const r = await a.svc.ingest(KEY, batch([
      { deviceRef: 'stranger' },
      { deviceRef: 'tag-0001', observedAt: '2026-10-09T05:10:00Z' },
      { deviceRef: 'tag-0001', observedAt: '2026-10-09T04:00:00Z' },
      { deviceRef: 'tag-0001', readings: [{ bssid: 'aa:aa:aa:aa:aa:aa', rssi: -50 }] },
      { deviceRef: 'tag-0001' },
    ]), NOW);
    expect(r).toMatchObject({ accepted: 5, stored: 1, unbound: 1, rejected: { FUTURE: 1, TOO_OLD: 1, NO_KNOWN_AP: 1 } });
    expect(a.fixes).toHaveLength(1);
    expect(a.fixes[0]).toMatchObject({ patientId: 'p1', bindingId: 'b1', collectorId: 'c1', source: 'OBSERVED_WIFI', floorKey: '2F' });
    // 단말 원문은 어디에도 없다
    expect(JSON.stringify(a.fixes)).not.toContain('tag-0001');
    expect(JSON.stringify(a.fixes)).not.toContain('stranger');
    expect(a.prisma.wifiCollector.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastBatch: expect.objectContaining({ stored: 1, unbound: 1 }) }) }));
  });
});

describe('위치 원장 반영', () => {
  it('🔴 첫 측위는 원장을 옮기지 않는다(연속 확인 전)', async () => {
    const a = mk({ bindings: bound, prevFix: null });
    const r = await a.svc.ingest(KEY, batch([{ deviceRef: 'tag-0001' }]), NOW);
    expect(r.moved).toBe(0);
    expect(a.floor.recordLocation).not.toHaveBeenCalled();
  });
  it('🔴 직전 측위도 같은 방이면 OBSERVED_WIFI 로 옮긴다 · 이미 그 방이면 옮기지 않는다', async () => {
    const a = mk({ bindings: bound, prevFix: { zoneId: 'room-a', granularity: 'ZONE' }, openZone: 'room-b' });
    const r = await a.svc.ingest(KEY, batch([{ deviceRef: 'tag-0001' }]), NOW);
    expect(r.moved).toBe(1);
    expect(a.floor.recordLocation).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'p1', zoneId: 'room-a', source: 'OBSERVED_WIFI', granularity: 'ZONE' }));
    const same = mk({ bindings: bound, prevFix: { zoneId: 'room-a', granularity: 'ZONE' }, openZone: 'room-a' });
    expect((await same.svc.ingest(KEY, batch([{ deviceRef: 'tag-0001' }]), NOW)).moved).toBe(0);
  });
  it('🔴 직전이 다른 방이면 옮기지 않는다(경계 떨림) · 층까지만이면 옮기지 않는다', async () => {
    const a = mk({ bindings: bound, prevFix: { zoneId: 'room-b', granularity: 'ZONE' }, openZone: null });
    expect((await a.svc.ingest(KEY, batch([{ deviceRef: 'tag-0001' }]), NOW)).moved).toBe(0);
    // AP 1대만 → CELL · 반경 큼 → FLOOR
    const b = mk({ bindings: bound, prevFix: { zoneId: null, granularity: 'FLOOR' }, openZone: null });
    const r = await b.svc.ingest(KEY, batch([{ deviceRef: 'tag-0001', readings: [{ bssid: APS[3].bssid, rssi: -80 }] }]), NOW);
    expect(r.stored).toBe(1);
    expect(b.fixes[0]).toMatchObject({ granularity: 'FLOOR', zoneId: null, quality: 'CELL' });
    expect(b.floor.recordLocation).not.toHaveBeenCalled();
  });
  it('🔴 시뮬레이션 측위는 원장을 옮기지 않는다', async () => {
    const a = mk({ prevFix: { zoneId: 'room-a', granularity: 'ZONE' }, openZone: null });
    const solved = (await import('@hospital-run/shared')).solveWifiPosition(readingsAt(5, 8), new Map(APS.map((x) => [x.bssid, x])));
    if (!solved.ok) throw new Error('solve');
    const r = await a.svc.storeFix({ deviceHash: 'h', patientId: 'p1', bindingId: null, collectorId: null, observedAt: NOW, fix: solved.fix, source: 'SIMULATED', truthZoneId: 'room-a' });
    expect(r.moved).toBe(false);
    expect(a.floor.recordLocation).not.toHaveBeenCalled();
    expect(a.fixes[0]).toMatchObject({ source: 'SIMULATED', truthZoneId: 'room-a' });
  });
});

describe('단말 연결 — 동의 근거', () => {
  const reg = (open: { id: string; patientId: string } | null = null) => {
    const tx = { wifiDeviceBinding: { findFirst: vi.fn(async () => open), create: vi.fn(async (a: any) => ({ id: 'nb', ...a.data })) }, $executeRaw: vi.fn(async () => 1) };
    const prisma: any = {
      patient: { findUnique: vi.fn(async () => ({ id: 'p1' })) },
      wifiDeviceBinding: { findUnique: vi.fn(async () => ({ unboundAt: null })), update: vi.fn(async () => ({ id: 'b1' })) },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };
    return { svc: new WifiRegistryService(prisma, {} as never, {} as never), tx, prisma };
  };
  const dto = { deviceRef: 'TAG-00012345', deviceKind: 'TAG' as const, patientId: 'p1', consentBasis: 'WRITTEN' as const };
  it('🔴 DEMO 근거는 거절 · 구두 동의는 메모 필수', async () => {
    await expect(reg().svc.bind({ ...dto, consentBasis: 'DEMO' }, 'u1')).rejects.toMatchObject({ status: 400 });
    await expect(reg().svc.bind({ ...dto, consentBasis: 'VERBAL_RECORDED' }, 'u1')).rejects.toMatchObject({ status: 400 });
  });
  it('🔴 단말 원문 대신 해시와 끝 4자리만 · 이미 열린 연결이 있으면 409', async () => {
    const a = reg();
    await a.svc.bind(dto, 'u1');
    const data = (a.tx.wifiDeviceBinding.create.mock.calls[0] as any)[0].data;
    expect(data).toMatchObject({ deviceHash: WifiPositioningService.hashDevice('TAG-00012345'), displayHint: '2345', consentBasis: 'WRITTEN', boundById: 'u1' });
    expect(JSON.stringify(data)).not.toContain('TAG-00012345');
    await expect(reg({ id: 'b0', patientId: 'p2' }).svc.bind(dto, 'u1')).rejects.toMatchObject({ status: 409 });
  });
  it('해제는 사유 필수', async () => {
    await expect(reg().svc.unbind('b1', '  ', 'u1')).rejects.toMatchObject({ status: 400 });
  });
});

describe('데모 AP 배치 시드', () => {
  const payload = { schema: 'space-import.v1', floors: [
    { key: '1F', spaceNodeCode: 'F1', level: 1, title: '1층', elevationM: 0, heightM: 4, footprint: { x: 0, y: 0, w: 48, h: 24 },
      spaces: [{ id: 's1', spaceNodeCode: 'Z1', name: '로비', number: null, type: 'LOBBY', rect: { x: 0, y: 0, w: 24, h: 24 }, open: true, restricted: false },
        { id: 's2', spaceNodeCode: null, name: '계단', number: null, type: 'CORE', rect: { x: 24, y: 0, w: 12, h: 12 }, open: true, restricted: false, verticalCore: 'A' }],
      connections: [], graph: { nodes: [], edges: [] } },
    { key: 'B1', spaceNodeCode: 'FB', level: -1, title: '지하', elevationM: -4, heightM: 4, footprint: { x: 0, y: 0, w: 8, h: 8 }, spaces: [], connections: [], graph: { nodes: [], edges: [] } },
  ], verticalEdges: [] } as unknown as SpaceImportV1;
  it('격자 · 수직 코어 안에는 두지 않음 · 작은 층도 3대 · 같은 도면이면 같은 BSSID', () => {
    const p = planDemoAccessPoints(payload);
    const f1 = p.filter((x) => x.floorKey === '1F');
    expect(f1.length).toBe(7); // 4×2 격자 − 코어 안 1
    expect(f1.some((x) => x.x === 30 && x.y === 6)).toBe(false);
    expect(f1.find((x) => x.x === 6 && x.y === 6)!.spaceNodeCode).toBe('Z1');
    expect(p.filter((x) => x.floorKey === 'B1').length).toBe(3);
    expect(new Set(p.map((x) => x.bssid)).size).toBe(p.length);
    expect(planDemoAccessPoints(payload)).toEqual(p);
    expect(p.every((x) => x.bssid.startsWith('02:') && x.label.endsWith('(데모)'))).toBe(true);
  });
});

describe('기획서 ↔ 결정 등록부', () => {
  it('🔴 기획서 §7 의 결정 키가 전부 등록부에 있다 · 배치 10-E 는 집행 대상을 갖지 않는다', () => {
    const plan = readFileSync(join(__dirname, '../../../../docs/01-plan/features/wifi-ap-location.plan.md'), 'utf8');
    const sec = plan.slice(plan.indexOf('## 7.'), plan.indexOf('## 8.'));
    const keys = [...sec.matchAll(/`(location\.[a-zA-Z.]+)`/g)].map((m) => m[1]).filter((k) => !k.startsWith('location.wifi.enabled'));
    expect(keys.length).toBeGreaterThanOrEqual(4);
    const reg = new Set(DECISION_REGISTRY.map((d) => d.key));
    expect(keys.filter((k) => !reg.has(k))).toEqual([]);
    for (const d of DECISION_BATCH_2026_10_E) expect(sec).toContain(d.key);
    expect(DECISION_BATCH_2026_10_E.flatMap((d) => d.options ?? []).every((o) => o.enact === null)).toBe(true);
    expect(DECISION_BATCH_2026_10_E.find((d) => d.key === 'location.wifi.collect')!.layer).toBe('LICENSE_HOLDER');
  });
});

describe('흐름 추적 보완(2026-10-10)', () => {
  it('🔴 사망한 환자에게 열린 연결 — 측위를 저장하지 않고 사유를 센다(그 태그는 다른 사람·분실물)', async () => {
    const { svc, fixes, floor } = mk({ bindings: bound, deceased: ['p1'], prevFix: { zoneId: 'room-a', granularity: 'ZONE' } });
    const r = await svc.ingest(KEY, batch([{ deviceRef: 'tag-0001' }]), NOW);
    expect(r).toMatchObject({ stored: 0, rejected: { PATIENT_DECEASED: 1 } });
    expect(fixes).toEqual([]);
    expect(floor.recordLocation).not.toHaveBeenCalled();
  });
  it('🔴 늦게 온 관측 — 측위는 남기되 더 새 측위가 있으면 위치 원장을 옮기지 않는다', async () => {
    const { svc, fixes, floor } = mk({ bindings: bound, prevFix: { zoneId: 'room-a', granularity: 'ZONE' }, newer: true });
    const r = await svc.ingest(KEY, batch([{ deviceRef: 'tag-0001' }]), NOW);
    expect(r).toMatchObject({ stored: 1, moved: 0, lateNoMove: 1 });
    expect(fixes).toHaveLength(1);
    expect(floor.recordLocation).not.toHaveBeenCalled();
  });
  it('대조군 — 더 새 측위가 없으면 같은 방 연속이면 옮긴다 · 원장 메타에 관측 시각·방법', async () => {
    const { svc, floor } = mk({ bindings: bound, prevFix: { zoneId: 'room-a', granularity: 'ZONE' } });
    const r = await svc.ingest(KEY, batch([{ deviceRef: 'tag-0001' }]), NOW);
    expect(r).toMatchObject({ moved: 1, lateNoMove: 0 });
    expect((floor.recordLocation.mock.calls[0] as any[])[0].metadata).toMatchObject({ observedAt: NOW.toISOString(), method: 'WCENTROID_V1' });
  });
  it('직전 측위는 이 관측보다 앞선 것으로만 찾는다', async () => {
    const { svc, prisma } = mk({ bindings: bound });
    await svc.ingest(KEY, batch([{ deviceRef: 'tag-0001' }]), NOW);
    const prevCall = prisma.wifiPositionFix.findFirst.mock.calls.find((c: any) => c[0].where.observedAt?.lte);
    expect(prevCall[0].where.observedAt.lte).toEqual(NOW);
  });
});

describe('등록부 흐름 보완(2026-10-10) — 사망·재원 아님·현황', () => {
  const reg = (over: Record<string, unknown> = {}) => {
    const prisma: any = {
      patient: {
        findUnique: vi.fn(async (a: any) => (a.where.id === 'dead' ? { id: 'dead', isDeceased: true } : { id: a.where.id, isDeceased: false })),
        findMany: vi.fn(async (a: any) => [
          { id: 'dead', familyName: '고', givenName: '인', mrn: 'M1', isDeceased: true },
          { id: 'in', familyName: '재', givenName: '원', mrn: 'M2', isDeceased: false },
          { id: 'out', familyName: '외', givenName: '래', mrn: 'M3', isDeceased: false },
        ].filter((p) => a.where.id.in.includes(p.id) && (a.where.isDeceased === undefined || p.isDeceased === a.where.isDeceased))),
      },
      admission: { findMany: vi.fn(async () => [{ patientId: 'in' }]) },
      wifiDeviceBinding: {
        findMany: vi.fn(async () => [{ id: 'b1', patientId: 'dead', unboundAt: null }, { id: 'b2', patientId: 'in', unboundAt: null }, { id: 'b3', patientId: 'out', unboundAt: null }]),
        count: vi.fn(async () => 3),
      },
      wifiAccessPoint: { groupBy: vi.fn(async () => []), count: vi.fn(async () => 0) },
      wifiCollector: { findMany: vi.fn(async () => []) },
      wifiPositionFix: { groupBy: vi.fn(async () => []) },
      wifiSurveySample: { groupBy: vi.fn(async () => [{ floorKey: '2F', _count: { _all: 12 } }, { floorKey: '3F', _count: { _all: 4 } }]) },
      $queryRaw: vi.fn(async () => [{ total: 0n, zoned: 0n, hit: 0n }]),
      ...over,
    };
    const config = { getWithSource: vi.fn(async () => ({ value: false, source: 'DEFAULT' })) };
    return new WifiRegistryService(prisma, {} as never, config as never);
  };
  it('🔴 사망한 환자에게는 연결하지 않는다', async () => {
    await expect(reg().bind({ deviceRef: 'tag-9999', deviceKind: 'TAG', patientId: 'dead', consentBasis: 'WRITTEN' }, 'u1')).rejects.toMatchObject({ response: { code: 'PATIENT_DECEASED' } });
  });
  it('연결 목록이 환자 상태를 말한다 — 자동 해제하지 않는다', async () => {
    const r = await reg().listBindings({});
    expect(Object.fromEntries(r.items.map((i: any) => [i.patientId, i.patientState]))).toEqual({ dead: 'DECEASED', in: 'ADMITTED', out: 'NOT_ADMITTED' });
  });
  it('현황 — 열린 연결 점검·측정 표본·신호 지도 층·보존(결정 전 지우지 않음)', async () => {
    const s = await reg().status();
    expect(s.bindingCheck).toEqual({ deceased: 1, notAdmitted: 1 });
    expect(s.survey).toEqual({ samples: 16, fingerprintFloors: ['2F'], minSamplesPerFloor: 10 });
    expect(s.retention).toEqual({ decisionKey: 'location.retentionDays', observedDeleted: false, simulatedHours: 24 });
  });
});
