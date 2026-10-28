import { describe, it, expect, vi } from 'vitest';
import { distanceToRssi, simulateWifiReadings, WIFI_FINGERPRINT } from '@hospital-run/shared';
import { WifiPositioningService } from '../../src/modules/wifi-location/wifi-positioning.service';
import { WifiRegistryService } from '../../src/modules/wifi-location/wifi-registry.service';

/**
 * 무선 현장 측정 · 신호 지도 · 교정 제안(2026-10-10).
 * 🔴 실제 수집 결정 뒤 사람이 하는 "현장 교정"을 도구로 — 표본은 지우지 않고 무효 · 교정은 제안만(적용은 사람) · 표본이 모자라면 기존 엔진 그대로.
 */
const NOW = new Date('2026-10-10T05:00:00Z');
const APS = [
  { id: 'ap1', bssid: '02:00:00:00:00:01', label: 'AP1', floorKey: '2F', floorLevel: 2, x: 3, y: 3, rssiAt1m: null, pathLossExponent: null, calibratedAt: null },
  { id: 'ap2', bssid: '02:00:00:00:00:02', label: 'AP2', floorKey: '2F', floorLevel: 2, x: 27, y: 3, rssiAt1m: null, pathLossExponent: null, calibratedAt: null },
  { id: 'ap3', bssid: '02:00:00:00:00:03', label: 'AP3', floorKey: '2F', floorLevel: 2, x: 3, y: 17, rssiAt1m: null, pathLossExponent: null, calibratedAt: null },
  { id: 'ap4', bssid: '02:00:00:00:00:04', label: 'AP4', floorKey: '2F', floorLevel: 2, x: 27, y: 17, rssiAt1m: null, pathLossExponent: null, calibratedAt: null },
];
const GEO = { floors: [{ key: '2F', level: 2, spaces: [{ spaceNodeId: 'room-a', rect: { x: 0, y: 0, w: 15, h: 20 } }, { spaceNodeId: 'room-b', rect: { x: 15, y: 0, w: 15, h: 20 } }] }] };
// 실제 전파가 기본 모델과 다르다(-35 dBm · 3.4) — 현장 표본은 이 "실제"로 만든다
const TRUE_MODEL = { rssiAt1m: -35, exponent: 3.4 };
const realReadings = (x: number, y: number) => APS.map((a) => ({ bssid: a.bssid, rssi: Math.round(distanceToRssi(Math.hypot(a.x - x, a.y - y), TRUE_MODEL.rssiAt1m, TRUE_MODEL.exponent)) }));
const grid = () => {
  const out: any[] = [];
  for (let x = 2; x <= 28; x += 5) for (let y = 2; y <= 18; y += 5) out.push({ id: `s${x}-${y}`, floorKey: '2F', floorLevel: 2, x, y, readings: realReadings(x, y), voidedAt: null });
  return out;
};

function positioning(survey: any[]) {
  const prisma: any = {
    wifiAccessPoint: { findMany: vi.fn(async () => APS) },
    wifiSurveySample: { findMany: vi.fn(async (a: any) => survey.filter((s) => (a?.where?.voidedAt === null ? !s.voidedAt : true))) },
  };
  return new WifiPositioningService(prisma, {} as never, { geometry: vi.fn(async () => GEO) } as never, { get: vi.fn(async () => true) } as never);
}

describe('측위 — 현장 표본이 충분하면 신호 지도', () => {
  it('🔴 표본 없음 → 가중 중심(종전 엔진 그대로)', async () => {
    const svc = positioning([]);
    const r = svc.solve(realReadings(22, 10), await svc.context());
    expect(r.ok && r.fix.method).toBe('WCENTROID_V1');
  });
  it('표본이 기준 이상 → 신호 지도 · 실제 전파가 기본 모델과 달라도 실제 위치 가까이', async () => {
    const svc = positioning(grid());
    const ctx = await svc.context();
    expect(ctx.survey.length).toBeGreaterThanOrEqual(WIFI_FINGERPRINT.minSamplesPerFloor);
    const r = svc.solve(realReadings(22, 10), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fix.method).toBe('FINGERPRINT_KNN_V1');
    expect(Math.hypot(r.fix.x - 22, r.fix.y - 10)).toBeLessThan(4);
  });
  it('🔴 무효 표본은 측위에 쓰지 않는다', async () => {
    const svc = positioning(grid().map((s) => ({ ...s, voidedAt: NOW })));
    expect((await svc.context()).survey).toEqual([]);
  });
  it('데모 신호(같은 엔진)도 같은 길을 지난다', async () => {
    const svc = positioning([]);
    const ctx = await svc.context();
    const r = svc.solve(simulateWifiReadings({ floorLevel: 2, x: 5, y: 5 }, ctx.apList, 'seed', 0), ctx);
    expect(r.ok).toBe(true);
  });
});

function registry(opts: { survey?: any[]; floors?: Array<{ key: string; level: number }> } = {}) {
  const created: any[] = [];
  const survey = opts.survey ?? [];
  const prisma: any = {
    wifiAccessPoint: { findMany: vi.fn(async () => APS) },
    wifiSurveySample: {
      create: vi.fn(async (a: any) => { created.push(a.data); return { id: 'new', ...a.data }; }),
      findMany: vi.fn(async () => survey),
      findUnique: vi.fn(async (a: any) => survey.find((s) => s.id === a.where.id) ?? null),
      update: vi.fn(async (a: any) => ({ id: a.where.id, ...a.data })),
      groupBy: vi.fn(async () => []),
      count: vi.fn(async () => survey.length),
    },
  };
  const pos = { context: vi.fn(async () => ({ floors: opts.floors ?? [{ key: '2F', level: 2 }], spacesByFloor: new Map([['2F', GEO.floors[0].spaces]]) })), invalidate: vi.fn() };
  return { svc: new WifiRegistryService(prisma, pos as never, {} as never), prisma, created, pos };
}

describe('현장 측정 표본 기록', () => {
  const dto = { floorKey: '2F', x: 5, y: 5, measuredAt: '2026-10-10T04:00:00Z', readings: [{ bssid: '02-00-00-00-00-01', rssi: -50 }, { bssid: '02:00:00:00:00:01', rssi: -45 }, { bssid: '02:00:00:00:00:02', rssi: -70 }] };
  it('층 레벨·방을 도면에서 · 같은 AP 는 센 값 하나 · BSSID 정규화 · 측위 캐시 무효화', async () => {
    const { svc, created, pos } = registry();
    await svc.createSurvey(dto, 'u1', NOW);
    expect(created[0]).toMatchObject({ floorKey: '2F', floorLevel: 2, zoneId: 'room-a', collectedById: 'u1', readings: [{ bssid: '02:00:00:00:00:01', rssi: -45 }, { bssid: '02:00:00:00:00:02', rssi: -70 }] });
    expect(pos.invalidate).toHaveBeenCalled();
  });
  it('🔴 도면에 없는 층·미래 시각·BSSID 형식 오류는 거절(저장 0)', async () => {
    const { svc, created } = registry();
    await expect(svc.createSurvey({ ...dto, floorKey: '9F' }, 'u1', NOW)).rejects.toMatchObject({ response: { code: 'FLOOR_NOT_IN_DRAWING' } });
    await expect(svc.createSurvey({ ...dto, measuredAt: '2026-10-10T06:00:00Z' }, 'u1', NOW)).rejects.toMatchObject({ response: { code: 'SURVEY_MEASURED_AT_FUTURE' } });
    await expect(svc.createSurvey({ ...dto, readings: [{ bssid: 'nope', rssi: -50 }] }, 'u1', NOW)).rejects.toMatchObject({ response: { code: 'SURVEY_BSSID_INVALID' } });
    expect(created).toEqual([]);
  });
  it('무효는 지우지 않고 시각·사유 · 이미 무효면 그대로', async () => {
    const { svc, prisma } = registry({ survey: [{ id: 's1', voidedAt: null }, { id: 's2', voidedAt: NOW }] });
    await svc.voidSurvey('s1', ' 위치 잘못 ', 'u1');
    expect(prisma.wifiSurveySample.update.mock.calls[0][0].data).toMatchObject({ voidedById: 'u1', voidReason: '위치 잘못' });
    await svc.voidSurvey('s2', '다시', 'u1');
    expect(prisma.wifiSurveySample.update).toHaveBeenCalledTimes(1);
  });
});

describe('교정 제안', () => {
  it('🔴 표본으로 실제 전파를 되찾는다 — 제안만(AP 를 바꾸지 않는다)', async () => {
    const { svc, prisma } = registry({ survey: grid() });
    const r = await svc.calibrationSuggestions();
    const s = r.items.find((x) => x.bssid === '02:00:00:00:00:01')!;
    expect(s.suggestion).not.toBeNull();
    expect(s.suggestion!.rssiAt1m).toBeCloseTo(TRUE_MODEL.rssiAt1m, 0);
    expect(s.suggestion!.pathLossExponent).toBeCloseTo(TRUE_MODEL.exponent, 1);
    expect(prisma.wifiAccessPoint.update).toBeUndefined();
  });
  it('표본이 없으면 제안 없음 + 이유(0·기본값을 제안으로 내지 않는다)', async () => {
    const r = await registry({ survey: [] }).svc.calibrationSuggestions();
    expect(r.samples).toBe(0);
    expect(r.items.every((x) => x.suggestion === null && x.reason === 'TOO_FEW_PAIRS')).toBe(true);
  });
});
