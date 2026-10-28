/**
 * 무선 AP 기반 원내 위치 — 수집 프로토콜(wifi-location.v1)·측위 계산 정본 (기획 `docs/01-plan/features/wifi-ap-location.plan.md`)
 *
 * 흐름: 수집기(무선 컨트롤러·태그 게이트웨이·환자 앱) → `POST /api/v1/location/wifi/ingest`(wifi-location.v1)
 *       → 단말 해시로 **동의 받아 연결한 환자**를 찾는다(연결 없는 단말은 저장하지 않고 수만 센다)
 *       → AP 등록부 좌표로 측위(층 선택 → 강한 AP 가중 중심 → 오차 반경) → 측위 원장
 *       → 같은 방이 연속으로 잡히면 위치 원장(PatientLocation · 출처 OBSERVED_WIFI)으로 옮긴다.
 *
 * 🔴 근사다 — 무선 측위는 벽·사람·단말 방향에 흔들린다. 좌표마다 **오차 반경**을 함께 싣고, 반경이 방보다 크면 방을 고르지 않고 층까지만 말한다.
 * 🔴 교정하지 않은 AP 는 기본 전파 모델(`WIFI_PATH_LOSS_DEFAULT`)로 계산한다 — 화면이 "교정 안 됨"이라고 말한다(기본값을 측정값인 척하지 않는다).
 * 🔴 단말 식별자(MAC·태그 번호) 원문은 저장하지 않는다 — 서버는 sha256 해시만 남긴다. 프로토콜은 수집기 쪽 해시(HMAC)도 허용한다.
 */

export const WIFI_LOCATION_SCHEMA = 'wifi-location.v1' as const;

/** 수집 방식 — NETWORK: 무선 컨트롤러가 단말 신호를 여러 AP 에서 들은 값 · DEVICE: 단말(태그·앱)이 주변 AP 를 스캔한 값 */
export const WIFI_COLLECT_MODES = ['NETWORK', 'DEVICE'] as const;
export type WifiCollectMode = (typeof WIFI_COLLECT_MODES)[number];
export const WIFI_COLLECT_MODE_LABEL: Record<WifiCollectMode, string> = {
  NETWORK: '무선 컨트롤러 수집(AP 가 단말 신호를 들음)',
  DEVICE: '단말 스캔(태그·앱이 주변 AP 를 들음)',
};

/** 단말 종류 — 환자에게 연결할 때 밝힌다 */
export const WIFI_DEVICE_KINDS = ['TAG', 'PATIENT_APP', 'NETWORK_CLIENT'] as const;
export type WifiDeviceKind = (typeof WIFI_DEVICE_KINDS)[number];
export const WIFI_DEVICE_KIND_LABEL: Record<WifiDeviceKind, string> = {
  TAG: '병원 지급 위치 태그',
  PATIENT_APP: '환자 앱(단말 스캔)',
  NETWORK_CLIENT: '환자 단말(무선망 접속)',
};

/** 연결 근거 — 개인위치정보는 동의가 있어야 연결한다(근거 없는 연결은 받지 않는다) */
export const WIFI_CONSENT_BASES = ['WRITTEN', 'VERBAL_RECORDED', 'DEMO'] as const;
export type WifiConsentBasis = (typeof WIFI_CONSENT_BASES)[number];
export const WIFI_CONSENT_BASIS_LABEL: Record<WifiConsentBasis, string> = {
  WRITTEN: '서면 동의',
  VERBAL_RECORDED: '구두 동의(기록자 남김)',
  DEMO: '데모(가상 환자)',
};

/** 측위 품질 — POINT: AP 3대 이상 · CELL: 1~2대(그 AP 근처라는 것만 안다) */
export const WIFI_FIX_QUALITIES = ['POINT', 'CELL'] as const;
export type WifiFixQuality = (typeof WIFI_FIX_QUALITIES)[number];
export const WIFI_FIX_QUALITY_LABEL: Record<WifiFixQuality, string> = {
  POINT: '좌표(AP 3대 이상)',
  CELL: 'AP 근처(1~2대)',
};

export const WIFI_FIX_METHOD = 'WCENTROID_V1' as const;
/** 측위 방법 — 가중 중심(경로 손실 모델) · 신호 지도 최근접(현장 측정 표본) */
export const WIFI_FIX_METHODS = ['WCENTROID_V1', 'FINGERPRINT_KNN_V1'] as const;
export type WifiFixMethod = (typeof WIFI_FIX_METHODS)[number];
export const WIFI_FIX_METHOD_LABEL: Record<WifiFixMethod, string> = {
  WCENTROID_V1: '가중 중심(전파 모델)',
  FINGERPRINT_KNN_V1: '신호 지도(현장 측정 표본)',
};

/**
 * 현장 측정(2026-10-10) — 위치를 아는 지점에서 잰 신호 표본.
 *  · 신호 지도(핑거프린트) 측위: 그 층 표본이 minSamplesPerFloor 이상일 때만 쓴다 — 적으면 가중 중심 그대로
 *  · 교정 제안: AP 마다 (표본 지점–AP 거리, 들린 세기) 쌍으로 경로 손실 모델을 맞춘다 — 적용은 사람이
 */
export const WIFI_FINGERPRINT = {
  minSamplesPerFloor: 10,
  k: 3,
  /** 표본·관측 한쪽에만 들린 AP 는 이 세기로 본다(dBm) */
  missingRssi: -100,
  /** 관측과 표본이 함께 들은 AP 가 이보다 적으면 그 표본은 비교하지 않는다 */
  minCommonAps: 3,
} as const;
export const WIFI_CALIBRATION_FIT = {
  minPairs: 5,
  /** 거리 범위가 좁으면 기울기를 믿을 수 없다 — 최대/최소 거리 비 */
  minDistanceRatio: 3,
  /** 맞춘 감쇠 지수가 이 밖이면 받아들이지 않는다(측정 오류·가림 의심) */
  exponentRange: [1.5, 6] as const,
} as const;
export const WIFI_SURVEY_SOURCES = ['SURVEY'] as const;
/** 시뮬레이션 측위 보존(시간) — 데모 생성기가 지운다. 관측 측위는 결정 location.retentionDays 전엔 지우지 않는다 */
export const WIFI_SIM_FIX_KEEP_HOURS = 24;

/** 프로토콜 한계 — 넘으면 배치 전체를 400 으로 돌려보낸다(부분 저장 없음) */
export const WIFI_PROTOCOL_LIMITS = {
  maxObservations: 500,
  maxReadings: 32,
  maxDeviceRefLength: 128,
  rssiMin: -110,
  rssiMax: -10,
  /** 수집기 시계가 앞서 있어도 받는 한도(초) — 넘으면 그 관측만 거절 */
  futureSkewSec: 120,
  /** 이보다 오래된 관측은 받지 않는다(초) — 늦게 온 위치로 "지금"을 바꾸지 않는다 */
  maxAgeSec: 900,
} as const;

/** 측위 계산 상수 */
export const WIFI_SOLVER = {
  /** 이보다 약한 신호는 쓰지 않는다(dBm) */
  minRssi: -90,
  /** 측위에 쓰는 강한 AP 수 상한 */
  topK: 4,
  /** 층 선택 — 가장 센 층의 신호 몫이 이보다 작으면 층이 모호하다고 표시한다 */
  floorShareConfident: 0.6,
  /** 오차 반경 하한(m) — 무선 측위가 이보다 정확하다고 말하지 않는다 */
  minAccuracyM: 3,
  /** 오차 반경이 이보다 크면 방을 고르지 않고 층까지만(FLOOR) */
  zoneMaxAccuracyM: 8,
  /** 같은 방이 이만큼 연속으로 잡혀야 위치 원장을 옮긴다(방 경계 떨림 방지) */
  zoneConfirmFixes: 2,
} as const;

/**
 * 기본 전파 모델(로그 거리 경로 손실) — **교정하지 않은 AP 에 쓰는 가정값**이다.
 * RSSI(d) = rssiAt1m − 10·n·log10(d). 병원 실내(벽·사람)는 n≈2.5~3.5 로 보고된다는 일반 값의 중간을 썼다 — 측정값이 아니다.
 */
export const WIFI_PATH_LOSS_DEFAULT = { rssiAt1m: -40, exponent: 2.8 } as const;

/** 층을 건너 들리는 신호의 감쇠(dB) — 데모 신호 생성에만 쓴다(측위는 층 선택을 신호 몫으로 한다) */
export const WIFI_FLOOR_ATTENUATION_DB = 18;

export interface WifiReading { bssid: string; rssi: number; band?: '2.4' | '5' | '6'; channel?: number }
export interface WifiObservation { deviceRef: string; observedAt: string; readings: WifiReading[] }
export interface WifiLocationBatch {
  schema: typeof WIFI_LOCATION_SCHEMA;
  mode: WifiCollectMode;
  sentAt: string;
  /** DEVICE_HASHED: deviceRef 가 이미 수집기 쪽 해시(HMAC) — 서버는 그대로 다시 sha256 한다 */
  deviceRefKind?: 'RAW' | 'DEVICE_HASHED';
  observations: WifiObservation[];
}

/** AP 등록부 한 대의 측위용 기하(층 도면 좌표계 · m) */
export interface WifiApGeo {
  bssid: string;
  floorKey: string;
  floorLevel: number;
  x: number;
  y: number;
  /** 교정값 — null 이면 기본 모델 */
  rssiAt1m: number | null;
  pathLossExponent: number | null;
}

const BSSID_RE = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;

/** BSSID 정규화 — 대소문자·구분자(-·.) 차이를 없앤다 · 형식이 아니면 null */
export function normalizeBssid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hex = raw.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return null;
  const s = hex.match(/.{2}/g)!.join(':');
  return BSSID_RE.test(s) ? s : null;
}

export interface WifiBatchCheck { ok: boolean; errors: string[] }

/** 배치 형식 검사 — 형식 오류는 배치 전체 거절(어느 것이 저장됐는지 수집기가 모르게 만들지 않는다) */
export function checkWifiBatch(body: unknown): WifiBatchCheck {
  const errors: string[] = [];
  const b = body as Partial<WifiLocationBatch> | null;
  if (!b || typeof b !== 'object') return { ok: false, errors: ['BODY_NOT_OBJECT'] };
  if (b.schema !== WIFI_LOCATION_SCHEMA) errors.push('SCHEMA');
  if (!WIFI_COLLECT_MODES.includes(b.mode as WifiCollectMode)) errors.push('MODE');
  if (typeof b.sentAt !== 'string' || Number.isNaN(Date.parse(b.sentAt))) errors.push('SENT_AT');
  if (b.deviceRefKind != null && b.deviceRefKind !== 'RAW' && b.deviceRefKind !== 'DEVICE_HASHED') errors.push('DEVICE_REF_KIND');
  if (!Array.isArray(b.observations)) errors.push('OBSERVATIONS');
  else {
    if (b.observations.length === 0) errors.push('OBSERVATIONS_EMPTY');
    if (b.observations.length > WIFI_PROTOCOL_LIMITS.maxObservations) errors.push('OBSERVATIONS_TOO_MANY');
    b.observations.forEach((o, i) => {
      if (!o || typeof o.deviceRef !== 'string' || !o.deviceRef.trim() || o.deviceRef.length > WIFI_PROTOCOL_LIMITS.maxDeviceRefLength) errors.push(`OBS_${i}_DEVICE_REF`);
      if (!o || typeof o.observedAt !== 'string' || Number.isNaN(Date.parse(o.observedAt))) errors.push(`OBS_${i}_OBSERVED_AT`);
      if (!o || !Array.isArray(o.readings) || o.readings.length === 0 || o.readings.length > WIFI_PROTOCOL_LIMITS.maxReadings) { errors.push(`OBS_${i}_READINGS`); return; }
      o.readings.forEach((r, j) => {
        if (!r || !normalizeBssid(r.bssid)) errors.push(`OBS_${i}_R${j}_BSSID`);
        if (!r || typeof r.rssi !== 'number' || !Number.isFinite(r.rssi) || r.rssi < WIFI_PROTOCOL_LIMITS.rssiMin || r.rssi > WIFI_PROTOCOL_LIMITS.rssiMax) errors.push(`OBS_${i}_R${j}_RSSI`);
      });
    });
  }
  return { ok: errors.length === 0, errors: errors.slice(0, 50) };
}

/** 관측 시각 판정 — 미래(시계 어긋남 한도 밖)·너무 오래된 것은 그 관측만 거절 */
export function wifiObservationAgeReason(observedAt: Date, receivedAt: Date): 'FUTURE' | 'TOO_OLD' | null {
  const diffSec = (receivedAt.getTime() - observedAt.getTime()) / 1000;
  if (diffSec < -WIFI_PROTOCOL_LIMITS.futureSkewSec) return 'FUTURE';
  if (diffSec > WIFI_PROTOCOL_LIMITS.maxAgeSec) return 'TOO_OLD';
  return null;
}

/** 경로 손실 모델로 RSSI → 거리(m) — 하한 0.5m */
export function rssiToDistanceM(rssi: number, rssiAt1m: number, exponent: number): number {
  return Math.max(0.5, Math.pow(10, (rssiAt1m - rssi) / (10 * exponent)));
}

/** 거리(m) → 기대 RSSI — 데모 신호 생성·교정 화면용 */
export function distanceToRssi(distanceM: number, rssiAt1m: number, exponent: number): number {
  return rssiAt1m - 10 * exponent * Math.log10(Math.max(0.5, distanceM));
}

export type WifiSolveFailure = 'NO_KNOWN_AP' | 'ALL_TOO_WEAK';
export interface WifiFix {
  floorKey: string;
  floorLevel: number;
  x: number;
  y: number;
  accuracyM: number;
  apCount: number;
  quality: WifiFixQuality;
  /** 고른 층이 전체 신호에서 차지한 몫(0~1) — floorShareConfident 미만이면 층이 모호 */
  floorShare: number;
  method: WifiFixMethod;
  /** 기본 모델(교정 안 됨)로 계산한 AP 가 섞였는가 */
  uncalibrated: boolean;
  used: Array<{ bssid: string; rssi: number; distanceM: number }>;
}

/**
 * 측위 — 층 선택(선형 전력 합) → 그 층의 강한 AP topK 로 1/d² 가중 중심 → 오차 반경.
 * 오차 반경 = max(하한, 가중 중심에서 각 AP 까지 거리와 추정 거리의 차이 RMS) — AP 1~2대면 가장 가까운 추정 거리.
 */
export function solveWifiPosition(readings: WifiReading[], aps: Map<string, WifiApGeo>): { ok: true; fix: WifiFix } | { ok: false; reason: WifiSolveFailure } {
  const known: Array<{ ap: WifiApGeo; rssi: number }> = [];
  for (const r of readings) {
    const b = normalizeBssid(r.bssid);
    const ap = b ? aps.get(b) : undefined;
    if (ap) known.push({ ap, rssi: r.rssi });
  }
  if (known.length === 0) return { ok: false, reason: 'NO_KNOWN_AP' };
  // 같은 AP 가 여러 번 오면 가장 센 값만
  const best = new Map<string, { ap: WifiApGeo; rssi: number }>();
  for (const k of known) { const c = best.get(k.ap.bssid); if (!c || k.rssi > c.rssi) best.set(k.ap.bssid, k); }
  const usable = [...best.values()].filter((k) => k.rssi >= WIFI_SOLVER.minRssi);
  if (usable.length === 0) return { ok: false, reason: 'ALL_TOO_WEAK' };

  const power = (rssi: number) => Math.pow(10, rssi / 10);
  const byFloor = new Map<string, number>();
  for (const k of usable) byFloor.set(k.ap.floorKey, (byFloor.get(k.ap.floorKey) ?? 0) + power(k.rssi));
  const total = [...byFloor.values()].reduce((a, b) => a + b, 0);
  const [floorKey, floorPower] = [...byFloor.entries()].sort((a, b) => b[1] - a[1])[0];
  const onFloor = usable.filter((k) => k.ap.floorKey === floorKey).sort((a, b) => b.rssi - a.rssi).slice(0, WIFI_SOLVER.topK);

  let uncalibrated = false;
  const used = onFloor.map((k) => {
    const at1m = k.ap.rssiAt1m ?? WIFI_PATH_LOSS_DEFAULT.rssiAt1m;
    const n = k.ap.pathLossExponent ?? WIFI_PATH_LOSS_DEFAULT.exponent;
    if (k.ap.rssiAt1m == null || k.ap.pathLossExponent == null) uncalibrated = true;
    return { k, distanceM: rssiToDistanceM(k.rssi, at1m, n) };
  });
  let sw = 0, sx = 0, sy = 0;
  for (const u of used) { const w = 1 / (u.distanceM * u.distanceM); sw += w; sx += w * u.k.ap.x; sy += w * u.k.ap.y; }
  const x = sx / sw, y = sy / sw;
  const quality: WifiFixQuality = used.length >= 3 ? 'POINT' : 'CELL';
  let accuracyM: number;
  if (quality === 'CELL') accuracyM = Math.min(...used.map((u) => u.distanceM));
  else {
    let se = 0;
    for (const u of used) { const geo = Math.hypot(u.k.ap.x - x, u.k.ap.y - y); se += (geo - u.distanceM) ** 2; }
    accuracyM = Math.sqrt(se / used.length);
  }
  accuracyM = Math.max(WIFI_SOLVER.minAccuracyM, accuracyM);
  return {
    ok: true,
    fix: {
      floorKey, floorLevel: onFloor[0].ap.floorLevel, x, y, accuracyM, apCount: used.length, quality,
      floorShare: total > 0 ? floorPower / total : 0, method: WIFI_FIX_METHOD, uncalibrated,
      used: used.map((u) => ({ bssid: u.k.ap.bssid, rssi: u.k.rssi, distanceM: u.distanceM })),
    },
  };
}

/** 측위 점을 도면 방에 대응 — 반경이 크거나 층이 모호하거나 연결된 방이 아니면 층까지만 */
export interface WifiSpaceRef { spaceNodeId: string | null; rect: { x: number; y: number; w: number; h: number } }
export function wifiZoneForFix(fix: Pick<WifiFix, 'x' | 'y' | 'accuracyM' | 'floorShare'>, spaces: WifiSpaceRef[]): { granularity: 'ZONE' | 'FLOOR'; spaceNodeId: string | null } {
  const inside = spaces.filter((s) => fix.x >= s.rect.x && fix.x <= s.rect.x + s.rect.w && fix.y >= s.rect.y && fix.y <= s.rect.y + s.rect.h);
  // 겹친 사각형이면 가장 작은 방(안쪽 방)
  const hit = inside.sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
  if (!hit || !hit.spaceNodeId) return { granularity: 'FLOOR', spaceNodeId: null };
  if (fix.accuracyM > WIFI_SOLVER.zoneMaxAccuracyM || fix.floorShare < WIFI_SOLVER.floorShareConfident) return { granularity: 'FLOOR', spaceNodeId: null };
  return { granularity: 'ZONE', spaceNodeId: hit.spaceNodeId };
}

/** 결정적 의사난수(0~1) — 데모 신호 생성이 같은 입력에 같은 값을 내게 */
export function wifiDemoNoise(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h % 100000) / 100000;
}

/**
 * 데모 신호 생성 — 실제 위치(truth) 에서 각 AP 가 들었을 RSSI 를 기본 모델 + 잡음(±noiseDb)으로 만든다.
 * 다른 층 AP 는 층 감쇠를 더한다. 측위 엔진은 이 값을 실제 수집과 똑같이 푼다(엔진 자체를 시험하는 셈).
 * 🔴 이 값은 측정이 아니다 — 저장할 때 출처 SIMULATED 로만.
 */
export function simulateWifiReadings(truth: { floorLevel: number; x: number; y: number }, aps: WifiApGeo[], seed: string, noiseDb = 6): WifiReading[] {
  const out: WifiReading[] = [];
  for (const ap of aps) {
    const floors = Math.abs(ap.floorLevel - truth.floorLevel);
    if (floors > 1) continue;
    const d = Math.hypot(ap.x - truth.x, ap.y - truth.y);
    const at1m = ap.rssiAt1m ?? WIFI_PATH_LOSS_DEFAULT.rssiAt1m;
    const n = ap.pathLossExponent ?? WIFI_PATH_LOSS_DEFAULT.exponent;
    const noise = (wifiDemoNoise(`${seed}:${ap.bssid}`) * 2 - 1) * noiseDb;
    const rssi = distanceToRssi(d, at1m, n) - floors * WIFI_FLOOR_ATTENUATION_DB + noise;
    if (rssi >= WIFI_SOLVER.minRssi) out.push({ bssid: ap.bssid, rssi: Math.trunc(rssi) });
  }
  return out.sort((a, b) => b.rssi - a.rssi).slice(0, WIFI_PROTOCOL_LIMITS.maxReadings);
}

// ── 현장 측정 표본 · 신호 지도 측위 · 교정 맞춤(2026-10-10) ──

export interface WifiSurveyPoint { id: string; floorKey: string; floorLevel: number; x: number; y: number; readings: WifiReading[] }

/** 신호 공간 거리 — 둘 중 하나라도 들은 AP 합집합 · 못 들은 쪽은 missingRssi · 함께 들은 AP 수를 함께 */
export function wifiSignalDistance(a: WifiReading[], b: WifiReading[]): { distance: number; common: number } {
  const ma = new Map<string, number>(); const mb = new Map<string, number>();
  for (const r of a) { const k = normalizeBssid(r.bssid); if (k) ma.set(k, Math.max(ma.get(k) ?? -Infinity, r.rssi)); }
  for (const r of b) { const k = normalizeBssid(r.bssid); if (k) mb.set(k, Math.max(mb.get(k) ?? -Infinity, r.rssi)); }
  const keys = new Set([...ma.keys(), ...mb.keys()]);
  let se = 0; let common = 0;
  for (const k of keys) {
    const va = ma.get(k); const vb = mb.get(k);
    if (va != null && vb != null) common++;
    se += ((va ?? WIFI_FINGERPRINT.missingRssi) - (vb ?? WIFI_FINGERPRINT.missingRssi)) ** 2;
  }
  return { distance: keys.size ? Math.sqrt(se / keys.size) : Infinity, common };
}

/**
 * 신호 지도 측위 — 층은 이미 고른 것(가중 중심의 층 선택)을 쓰고, 그 층 표본 중 신호가 가장 닮은 k 개의 가중 중심.
 * 오차 반경 = max(하한, 이웃 지점들이 중심에서 떨어진 가중 RMS). 비교할 표본이 모자라면 null(호출자는 가중 중심 그대로).
 */
export function solveWifiFingerprint(readings: WifiReading[], survey: WifiSurveyPoint[], floorKey: string): { x: number; y: number; accuracyM: number; neighbors: Array<{ id: string; distance: number }> } | null {
  const onFloor = survey.filter((p) => p.floorKey === floorKey);
  if (onFloor.length < WIFI_FINGERPRINT.minSamplesPerFloor) return null;
  const scored = onFloor
    .map((p) => ({ p, ...wifiSignalDistance(readings, p.readings) }))
    .filter((s) => s.common >= WIFI_FINGERPRINT.minCommonAps && Number.isFinite(s.distance))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, WIFI_FINGERPRINT.k);
  if (scored.length < WIFI_FINGERPRINT.k) return null;
  let sw = 0, sx = 0, sy = 0;
  const w = scored.map((s) => 1 / (s.distance + 1));
  scored.forEach((s, i) => { sw += w[i]; sx += w[i] * s.p.x; sy += w[i] * s.p.y; });
  const x = sx / sw, y = sy / sw;
  let se = 0;
  scored.forEach((s, i) => { se += w[i] * ((s.p.x - x) ** 2 + (s.p.y - y) ** 2); });
  const accuracyM = Math.max(WIFI_SOLVER.minAccuracyM, Math.sqrt(se / sw));
  return { x, y, accuracyM, neighbors: scored.map((s) => ({ id: s.p.id, distance: s.distance })) };
}

/** 가중 중심 결과에 신호 지도를 얹는다 — 표본이 충분하면 좌표·반경·방법을 바꾼다(층·층 몫은 그대로) */
export function refineWithFingerprint(fix: WifiFix, readings: WifiReading[], survey: WifiSurveyPoint[]): WifiFix {
  const fp = solveWifiFingerprint(readings, survey, fix.floorKey);
  if (!fp) return fix;
  // 신호 지도는 전파 모델을 쓰지 않는다 — 교정 여부와 무관
  return { ...fix, x: fp.x, y: fp.y, accuracyM: fp.accuracyM, quality: 'POINT', method: 'FINGERPRINT_KNN_V1', uncalibrated: false };
}

export type WifiCalibrationFitFailure = 'TOO_FEW_PAIRS' | 'NARROW_DISTANCE_RANGE' | 'IMPLAUSIBLE_EXPONENT';
/**
 * 교정 맞춤 — RSSI = A − 10·n·log10(d) 를 최소제곱으로. 쌍이 적거나 거리 범위가 좁거나 지수가 그럴듯하지 않으면 맞추지 않는다(이유).
 * 🔴 결과는 **제안**이다 — AP 에 적용하는 것은 사람(관리자)이 한다.
 */
export function fitPathLoss(pairs: Array<{ distanceM: number; rssi: number }>):
  | { ok: true; rssiAt1m: number; exponent: number; pairs: number; rmseDb: number }
  | { ok: false; reason: WifiCalibrationFitFailure; pairs: number } {
  const ps = pairs.filter((p) => p.distanceM > 0 && Number.isFinite(p.rssi));
  if (ps.length < WIFI_CALIBRATION_FIT.minPairs) return { ok: false, reason: 'TOO_FEW_PAIRS', pairs: ps.length };
  const ds = ps.map((p) => Math.max(0.5, p.distanceM));
  if (Math.max(...ds) / Math.min(...ds) < WIFI_CALIBRATION_FIT.minDistanceRatio) return { ok: false, reason: 'NARROW_DISTANCE_RANGE', pairs: ps.length };
  const xs = ds.map((d) => Math.log10(d)); const ys = ps.map((p) => p.rssi);
  const n = xs.length; const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const slope = sxy / sxx; const A = my - slope * mx; const exponent = -slope / 10;
  if (!(exponent >= WIFI_CALIBRATION_FIT.exponentRange[0] && exponent <= WIFI_CALIBRATION_FIT.exponentRange[1])) return { ok: false, reason: 'IMPLAUSIBLE_EXPONENT', pairs: n };
  let se = 0; for (let i = 0; i < n; i++) se += (ys[i] - (A + slope * xs[i])) ** 2;
  return { ok: true, rssiAt1m: A, exponent, pairs: n, rmseDb: Math.sqrt(se / n) };
}
export const WIFI_CALIBRATION_FIT_FAILURE_LABEL: Record<WifiCalibrationFitFailure, string> = {
  TOO_FEW_PAIRS: '이 AP 를 들은 측정 표본이 모자랍니다',
  NARROW_DISTANCE_RANGE: '측정 지점들의 거리 범위가 좁아 기울기를 믿을 수 없습니다',
  IMPLAUSIBLE_EXPONENT: '맞춘 감쇠 지수가 실내 범위를 벗어났습니다(측정 확인 필요)',
};

/** AP 별 교정 쌍 — 같은 층 표본만(층을 건넌 신호는 감쇠가 섞인다) */
export function calibrationPairsFor(ap: Pick<WifiApGeo, 'bssid' | 'floorKey' | 'x' | 'y'>, survey: WifiSurveyPoint[]): Array<{ distanceM: number; rssi: number }> {
  const out: Array<{ distanceM: number; rssi: number }> = [];
  for (const p of survey) {
    if (p.floorKey !== ap.floorKey) continue;
    const r = p.readings.filter((x) => normalizeBssid(x.bssid) === ap.bssid).sort((a, b) => b.rssi - a.rssi)[0];
    if (r) out.push({ distanceM: Math.hypot(p.x - ap.x, p.y - ap.y), rssi: r.rssi });
  }
  return out;
}

// ── AP 등록부 CSV 가져오기(2026-10-10) ──

/** 한 번에 가져오는 행 상한 — 넘으면 나눠서 올린다(일부만 받지 않는다) */
export const WIFI_AP_IMPORT_MAX_ROWS = 500;
export const WIFI_AP_CSV_HEADER = ['bssid', 'label', 'floorKey', 'x', 'y', 'vendor'] as const;
export type WifiApCsvError = 'BAD_HEADER' | 'TOO_MANY_ROWS' | 'COLUMN_COUNT' | 'BSSID_INVALID' | 'LABEL_EMPTY' | 'FLOOR_EMPTY' | 'COORD_INVALID' | 'DUPLICATE_IN_FILE';
export const WIFI_AP_CSV_ERROR_LABEL: Record<WifiApCsvError, string> = {
  BAD_HEADER: '첫 줄은 bssid,label,floorKey,x,y,vendor 여야 합니다',
  TOO_MANY_ROWS: '한 번에 500행까지 — 나눠서 올리십시오',
  COLUMN_COUNT: '칸 수가 맞지 않습니다',
  BSSID_INVALID: 'BSSID 형식이 아닙니다',
  LABEL_EMPTY: '이름이 비었습니다',
  FLOOR_EMPTY: '층 키가 비었습니다',
  COORD_INVALID: '좌표가 숫자가 아니거나 범위(-1000~5000) 밖입니다',
  DUPLICATE_IN_FILE: '같은 파일 안에 같은 BSSID 가 또 있습니다',
};
export interface WifiApCsvRow { line: number; bssid: string; label: string; floorKey: string; x: number; y: number; vendor: string | null }

/**
 * CSV → AP 행. 🔴 틀린 줄을 조용히 버리지 않는다 — 줄 번호와 이유를 돌려주고, 호출자는 오류가 하나라도 있으면 아무것도 넣지 않는다.
 * 큰따옴표 칸·쉼표 포함 값은 지원하지 않는다(AP 이름에 쉼표를 쓰지 않는 단순 형식 — 첫 줄 머리글 필수).
 */
export function parseWifiApCsv(text: string): { rows: WifiApCsvRow[]; errors: Array<{ line: number; reason: WifiApCsvError; value?: string }> } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const errors: Array<{ line: number; reason: WifiApCsvError; value?: string }> = [];
  const head = (lines[0] ?? '').split(',').map((x) => x.trim());
  const okHead = head.length >= 5 && WIFI_AP_CSV_HEADER.slice(0, 5).every((h, i) => head[i] === h) && (head.length === 5 || head[5] === 'vendor');
  if (!okHead) return { rows: [], errors: [{ line: 1, reason: 'BAD_HEADER' }] };
  const body = lines.slice(1).map((l, i) => ({ l, line: i + 2 })).filter((x) => x.l.trim() !== '');
  if (body.length > WIFI_AP_IMPORT_MAX_ROWS) return { rows: [], errors: [{ line: 1, reason: 'TOO_MANY_ROWS', value: String(body.length) }] };
  const rows: WifiApCsvRow[] = [];
  const seen = new Set<string>();
  for (const { l, line } of body) {
    const c = l.split(',').map((x) => x.trim());
    if (c.length !== head.length) { errors.push({ line, reason: 'COLUMN_COUNT' }); continue; }
    const bssid = normalizeBssid(c[0]);
    if (!bssid) { errors.push({ line, reason: 'BSSID_INVALID', value: c[0] }); continue; }
    if (!c[1]) { errors.push({ line, reason: 'LABEL_EMPTY' }); continue; }
    if (!c[2]) { errors.push({ line, reason: 'FLOOR_EMPTY' }); continue; }
    const x = Number(c[3]); const y = Number(c[4]);
    const inRange = (v: number) => c[3] !== '' && Number.isFinite(v) && v >= -1000 && v <= 5000;
    if (!inRange(x) || c[4] === '' || !inRange(y)) { errors.push({ line, reason: 'COORD_INVALID' }); continue; }
    if (seen.has(bssid)) { errors.push({ line, reason: 'DUPLICATE_IN_FILE', value: bssid }); continue; }
    seen.add(bssid);
    rows.push({ line, bssid, label: c[1].slice(0, 100), floorKey: c[2].slice(0, 10), x, y, vendor: c[5] ? c[5].slice(0, 40) : null });
  }
  return { rows, errors };
}

/** 관측 경과(분) — 미래·모름은 null(측위 시각을 지어내지 않는다) */
export function wifiFixAgeMinutes(observedAt: string | Date | null | undefined, now: number): number | null {
  if (!observedAt) return null;
  const t = new Date(observedAt).getTime();
  if (!Number.isFinite(t) || t > now) return null;
  return Math.floor((now - t) / 60000);
}
