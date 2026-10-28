/**
 * 무선 AP 측위 정본(2026-10-09) — 프로토콜 검사·층 선택·가중 중심·오차 반경·방 대응.
 *  · 🔴 반경이 크거나 층이 모호하면 방을 고르지 않는다 · 교정 안 된 AP 를 밝힌다 · 모르는 AP 만 오면 측위하지 않는다
 */
import { describe, it, expect } from 'vitest';
import { parseWifiApCsv, wifiFixAgeMinutes, WIFI_AP_IMPORT_MAX_ROWS } from './wifi-location';
import {
  calibrationPairsFor, distanceToRssi as d2r, fitPathLoss, refineWithFingerprint, solveWifiFingerprint, solveWifiPosition as solve2, wifiSignalDistance,
  WIFI_FINGERPRINT, type WifiApGeo as Geo, type WifiSurveyPoint,
} from './wifi-location';
import {
  checkWifiBatch, normalizeBssid, solveWifiPosition, wifiZoneForFix, simulateWifiReadings, wifiObservationAgeReason,
  rssiToDistanceM, distanceToRssi, WIFI_PATH_LOSS_DEFAULT, WIFI_SOLVER, type WifiApGeo,
} from './wifi-location';

const ap = (n: number, floorKey: string, floorLevel: number, x: number, y: number, cal = false): WifiApGeo => ({
  bssid: `02:00:00:00:00:${n.toString(16).padStart(2, '0')}`, floorKey, floorLevel, x, y, rssiAt1m: cal ? -38 : null, pathLossExponent: cal ? 2.6 : null,
});
// 2층 40×20m 에 AP 6대(격자) + 3층 2대
const APS = [ap(1, '2F', 2, 5, 5), ap(2, '2F', 2, 20, 5), ap(3, '2F', 2, 35, 5), ap(4, '2F', 2, 5, 15), ap(5, '2F', 2, 20, 15), ap(6, '2F', 2, 35, 15), ap(7, '3F', 3, 10, 10), ap(8, '3F', 3, 30, 10)];
const MAP = new Map(APS.map((a) => [a.bssid, a]));

describe('프로토콜', () => {
  const ok = { schema: 'wifi-location.v1', mode: 'NETWORK', sentAt: '2026-10-09T05:00:00Z', observations: [{ deviceRef: 'tag-1', observedAt: '2026-10-09T05:00:00Z', readings: [{ bssid: 'AA-BB-CC-DD-EE-01', rssi: -55 }] }] };
  it('정상 배치를 통과시키고 BSSID 표기 차이를 정규화한다', () => {
    expect(checkWifiBatch(ok)).toEqual({ ok: true, errors: [] });
    expect(normalizeBssid('AA-BB-CC-DD-EE-01')).toBe('aa:bb:cc:dd:ee:01');
    expect(normalizeBssid('aabb.ccdd.ee01')).toBe('aa:bb:cc:dd:ee:01');
    expect(normalizeBssid('zz:00')).toBeNull();
  });
  it('🔴 형식 오류는 배치 전체 거절 — 스키마·모드·RSSI 범위·빈 관측', () => {
    expect(checkWifiBatch({ ...ok, schema: 'v0' }).errors).toContain('SCHEMA');
    expect(checkWifiBatch({ ...ok, mode: 'X' }).errors).toContain('MODE');
    expect(checkWifiBatch({ ...ok, observations: [] }).errors).toContain('OBSERVATIONS_EMPTY');
    expect(checkWifiBatch({ ...ok, observations: [{ ...ok.observations[0], readings: [{ bssid: 'aa:bb:cc:dd:ee:01', rssi: 5 }] }] }).errors).toContain('OBS_0_R0_RSSI');
    expect(checkWifiBatch(null).ok).toBe(false);
  });
  it('관측 시각 — 미래(시계 어긋남 한도 밖)·너무 오래된 것', () => {
    const now = new Date('2026-10-09T05:00:00Z');
    expect(wifiObservationAgeReason(new Date('2026-10-09T05:05:00Z'), now)).toBe('FUTURE');
    expect(wifiObservationAgeReason(new Date('2026-10-09T04:40:00Z'), now)).toBe('TOO_OLD');
    expect(wifiObservationAgeReason(new Date('2026-10-09T04:59:00Z'), now)).toBeNull();
  });
  it('경로 손실 모델 왕복', () => {
    const r = distanceToRssi(10, WIFI_PATH_LOSS_DEFAULT.rssiAt1m, WIFI_PATH_LOSS_DEFAULT.exponent);
    expect(rssiToDistanceM(r, WIFI_PATH_LOSS_DEFAULT.rssiAt1m, WIFI_PATH_LOSS_DEFAULT.exponent)).toBeCloseTo(10, 5);
  });
});

describe('측위', () => {
  it('잡음 없는 신호면 실제 위치 근처 · 층을 맞추고 AP 3대 이상은 POINT · 교정 안 된 AP 를 밝힌다', () => {
    const truth = { floorLevel: 2, x: 12, y: 9 };
    const r = solveWifiPosition(simulateWifiReadings(truth, APS, 's', 0), MAP);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fix.floorKey).toBe('2F');
    expect(Math.hypot(r.fix.x - truth.x, r.fix.y - truth.y)).toBeLessThan(6);
    expect(r.fix.quality).toBe('POINT');
    expect(r.fix.apCount).toBe(WIFI_SOLVER.topK);
    expect(r.fix.uncalibrated).toBe(true);
    expect(r.fix.floorShare).toBeGreaterThan(WIFI_SOLVER.floorShareConfident); // 위층 AP 도 층 감쇠를 거쳐 들린다
    expect(r.fix.accuracyM).toBeGreaterThanOrEqual(WIFI_SOLVER.minAccuracyM);
  });
  it('🔴 모르는 AP 만 오면 측위하지 않는다 · 약한 신호만이면 측위하지 않는다', () => {
    expect(solveWifiPosition([{ bssid: 'aa:aa:aa:aa:aa:aa', rssi: -50 }], MAP)).toEqual({ ok: false, reason: 'NO_KNOWN_AP' });
    expect(solveWifiPosition([{ bssid: APS[0].bssid, rssi: -95 }], MAP)).toEqual({ ok: false, reason: 'ALL_TOO_WEAK' });
  });
  it('🔴 AP 1대면 CELL — 위치는 그 AP · 반경은 추정 거리', () => {
    const r = solveWifiPosition([{ bssid: APS[0].bssid, rssi: -68 }], MAP);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fix).toMatchObject({ quality: 'CELL', x: 5, y: 5, apCount: 1 });
    expect(r.fix.accuracyM).toBeCloseTo(rssiToDistanceM(-68, -40, 2.8), 5);
  });
  it('교정된 AP 만 쓰면 uncalibrated=false · 같은 AP 중복은 센 값 하나', () => {
    const cal = [ap(1, '2F', 2, 0, 0, true), ap(2, '2F', 2, 10, 0, true), ap(3, '2F', 2, 0, 10, true)];
    const r = solveWifiPosition([{ bssid: cal[0].bssid, rssi: -60 }, { bssid: cal[0].bssid, rssi: -50 }, { bssid: cal[1].bssid, rssi: -60 }, { bssid: cal[2].bssid, rssi: -60 }], new Map(cal.map((a) => [a.bssid, a])));
    if (!r.ok) throw new Error(r.reason);
    expect(r.fix.uncalibrated).toBe(false);
    expect(r.fix.used.find((u) => u.bssid === cal[0].bssid)!.rssi).toBe(-50);
  });
});

describe('방 대응', () => {
  const spaces = [
    { spaceNodeId: 'room-a', rect: { x: 0, y: 0, w: 15, h: 10 } },
    { spaceNodeId: 'inner', rect: { x: 2, y: 2, w: 4, h: 4 } },
    { spaceNodeId: null, rect: { x: 15, y: 0, w: 25, h: 10 } },
  ];
  it('반경이 작고 층이 확실하면 그 방(겹치면 안쪽 방)', () => {
    expect(wifiZoneForFix({ x: 10, y: 5, accuracyM: 4, floorShare: 0.95 }, spaces)).toEqual({ granularity: 'ZONE', spaceNodeId: 'room-a' });
    expect(wifiZoneForFix({ x: 3, y: 3, accuracyM: 4, floorShare: 0.95 }, spaces)).toEqual({ granularity: 'ZONE', spaceNodeId: 'inner' });
  });
  it('🔴 반경이 크거나 층이 모호하거나 연결 안 된 공간이면 층까지만', () => {
    expect(wifiZoneForFix({ x: 10, y: 5, accuracyM: WIFI_SOLVER.zoneMaxAccuracyM + 1, floorShare: 0.95 }, spaces).granularity).toBe('FLOOR');
    expect(wifiZoneForFix({ x: 10, y: 5, accuracyM: 4, floorShare: 0.5 }, spaces).granularity).toBe('FLOOR');
    expect(wifiZoneForFix({ x: 20, y: 5, accuracyM: 4, floorShare: 0.95 }, spaces)).toEqual({ granularity: 'FLOOR', spaceNodeId: null });
    expect(wifiZoneForFix({ x: 100, y: 5, accuracyM: 4, floorShare: 0.95 }, spaces).granularity).toBe('FLOOR');
  });
});

// ── 현장 측정 · 신호 지도 · 교정 맞춤(2026-10-10) ──

describe('교정 맞춤 fitPathLoss', () => {
  it('알려진 모델에서 만든 쌍이면 그 값을 되찾는다', () => {
    const pairs = [1, 2, 4, 6, 10, 15, 20].map((d) => ({ distanceM: d, rssi: d2r(d, -38, 3.1) }));
    const r = fitPathLoss(pairs);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.rssiAt1m).toBeCloseTo(-38, 5); expect(r.exponent).toBeCloseTo(3.1, 5); expect(r.rmseDb).toBeLessThan(1e-6); }
  });
  it('🔴 맞추지 못하면 이유 — 쌍 부족·거리 범위 좁음·지수 비현실', () => {
    expect(fitPathLoss([{ distanceM: 2, rssi: -50 }])).toMatchObject({ ok: false, reason: 'TOO_FEW_PAIRS' });
    expect(fitPathLoss([5, 5.5, 6, 6.2, 7].map((d) => ({ distanceM: d, rssi: d2r(d, -40, 2.8) })))).toMatchObject({ ok: false, reason: 'NARROW_DISTANCE_RANGE' });
    // 거리가 멀수록 세지는 엉터리(지수 음수)
    expect(fitPathLoss([1, 3, 6, 10, 20].map((d, i) => ({ distanceM: d, rssi: -80 + i * 8 })))).toMatchObject({ ok: false, reason: 'IMPLAUSIBLE_EXPONENT' });
  });
  it('AP 별 쌍은 같은 층 표본만', () => {
    const ap = { bssid: 'aa:bb:cc:dd:ee:01', floorKey: '1F', x: 0, y: 0 };
    const pts: WifiSurveyPoint[] = [
      { id: 's1', floorKey: '1F', floorLevel: 1, x: 3, y: 4, readings: [{ bssid: 'AA-BB-CC-DD-EE-01', rssi: -55 }] },
      { id: 's2', floorKey: '2F', floorLevel: 2, x: 0, y: 0, readings: [{ bssid: 'aa:bb:cc:dd:ee:01', rssi: -70 }] },
    ];
    expect(calibrationPairsFor(ap, pts)).toEqual([{ distanceM: 5, rssi: -55 }]);
  });
});

describe('신호 지도 측위', () => {
  const aps: Geo[] = [[0, 0], [30, 0], [0, 30], [30, 30]].map(([x, y], i) => ({ bssid: `aa:bb:cc:dd:ee:0${i + 1}`, floorKey: '1F', floorLevel: 1, x, y, rssiAt1m: null, pathLossExponent: null }));
  const readingsAt = (x: number, y: number) => aps.map((a) => ({ bssid: a.bssid, rssi: Math.round(d2r(Math.hypot(a.x - x, a.y - y), -40, 2.8)) }));
  const grid: WifiSurveyPoint[] = [];
  for (let x = 2; x <= 28; x += 6) for (let y = 2; y <= 28; y += 6) grid.push({ id: `g${x}-${y}`, floorKey: '1F', floorLevel: 1, x, y, readings: readingsAt(x, y) });

  it('표본이 충분하면 가장 닮은 표본들 근처 · 방법이 신호 지도로 바뀐다', () => {
    const obs = readingsAt(14, 14);
    const base = solve2(obs, new Map(aps.map((a) => [a.bssid, a])));
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const fix = refineWithFingerprint(base.fix, obs, grid);
    expect(fix.method).toBe('FINGERPRINT_KNN_V1');
    expect(Math.hypot(fix.x - 14, fix.y - 14)).toBeLessThan(4);
    expect(fix.floorKey).toBe(base.fix.floorKey);
    expect(fix.uncalibrated).toBe(false);
  });
  it('🔴 그 층 표본이 기준보다 적으면 가중 중심 그대로', () => {
    const obs = readingsAt(14, 14);
    expect(solveWifiFingerprint(obs, grid.slice(0, WIFI_FINGERPRINT.minSamplesPerFloor - 1), '1F')).toBeNull();
    expect(solveWifiFingerprint(obs, grid, '2F')).toBeNull();
  });
  it('함께 들은 AP 가 적은 표본은 비교하지 않는다', () => {
    const d = wifiSignalDistance([{ bssid: 'aa:bb:cc:dd:ee:01', rssi: -50 }], [{ bssid: 'aa:bb:cc:dd:ee:02', rssi: -50 }]);
    expect(d.common).toBe(0);
  });
});

describe('AP 등록부 CSV(2026-10-10)', () => {
  const H = 'bssid,label,floorKey,x,y,vendor';
  it('정상 행 — BSSID 정규화 · vendor 빈칸 null · 빈 줄 무시 · BOM 허용', () => {
    const r = parseWifiApCsv(`\uFEFF${H}\nAA-BB-CC-DD-EE-01,3F 스테이션,3F,12.5,8,\n\naa:bb:cc:dd:ee:02,복도,3F,20,8,Cisco`);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, bssid: 'aa:bb:cc:dd:ee:01', label: '3F 스테이션', floorKey: '3F', x: 12.5, y: 8, vendor: null },
      { line: 4, bssid: 'aa:bb:cc:dd:ee:02', label: '복도', floorKey: '3F', x: 20, y: 8, vendor: 'Cisco' },
    ]);
  });
  it('🔴 틀린 줄은 줄 번호와 이유 — 조용히 버리지 않는다', () => {
    const r = parseWifiApCsv(`${H}\nnope,a,1F,1,1,\naa:bb:cc:dd:ee:01,,1F,1,1,\naa:bb:cc:dd:ee:02,a,,1,1,\naa:bb:cc:dd:ee:03,a,1F,x,1,\naa:bb:cc:dd:ee:04,a,1F,1\naa:bb:cc:dd:ee:05,a,1F,1,1,\naa:bb:cc:dd:ee:05,b,1F,2,2,\naa:bb:cc:dd:ee:06,a,1F,1,9999,`);
    expect(r.errors.map((e) => [e.line, e.reason])).toEqual([[2, 'BSSID_INVALID'], [3, 'LABEL_EMPTY'], [4, 'FLOOR_EMPTY'], [5, 'COORD_INVALID'], [6, 'COLUMN_COUNT'], [8, 'DUPLICATE_IN_FILE'], [9, 'COORD_INVALID']]);
    expect(r.rows.map((x) => x.bssid)).toEqual(['aa:bb:cc:dd:ee:05']);
  });
  it('머리글이 다르거나 행이 상한을 넘으면 아무 행도 내지 않는다', () => {
    expect(parseWifiApCsv('mac,name,floor,x,y\naa:bb:cc:dd:ee:01,a,1F,1,1')).toEqual({ rows: [], errors: [{ line: 1, reason: 'BAD_HEADER' }] });
    const many = [H, ...Array.from({ length: WIFI_AP_IMPORT_MAX_ROWS + 1 }, (_, i) => `02:00:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')},a,1F,1,1,`)].join('\n');
    expect(parseWifiApCsv(many).rows).toEqual([]);
    expect(parseWifiApCsv(many).errors[0].reason).toBe('TOO_MANY_ROWS');
  });
  it('관측 경과 — 미래·모름은 null', () => {
    const now = Date.parse('2026-10-10T05:00:00Z');
    expect(wifiFixAgeMinutes('2026-10-10T04:57:30Z', now)).toBe(2);
    expect(wifiFixAgeMinutes('2026-10-10T05:01:00Z', now)).toBeNull();
    expect(wifiFixAgeMinutes(null, now)).toBeNull();
  });
});
