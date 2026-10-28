import { BadRequestException, Injectable, Logger, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  WIFI_SOLVER, checkWifiBatch, joinPatientName, normalizeBssid, refineWithFingerprint, solveWifiPosition, wifiObservationAgeReason, wifiZoneForFix,
  type WifiApGeo, type WifiFix, type WifiLocationBatch, type WifiReading, type WifiSpaceRef, type WifiSurveyPoint,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { FloorService } from '../floor/floor.service';
import { SpaceModelService } from '../space-model/space-model.service';
import { dayRange } from '../../common/day-range';

export const WIFI_ENABLED_KEY = 'location.wifi.enabled';
/** 키 교체 유예(분) — 결정 location.wifi.keyRotationGraceMinutes · 미설정(null) = 이전 키 즉시 무효 */
export const WIFI_KEY_GRACE_KEY = 'location.wifi.keyRotationGraceMinutes';
/** 교체 전 키 해시 → 수집기 id (TTL = 유예) · 스키마 없이 Redis 에만 둔다(만료가 곧 무효) */
export const wifiGraceRedisKey = (keyHash: string) => `wifi:collector-grace:${keyHash}`;
/** 수집기별 현재 유예 중인 이전 키 해시(다시 교체하면 그 전 유예를 끝낸다) */
export const wifiGraceOfRedisKey = (collectorId: string) => `wifi:collector-grace-of:${collectorId}`;
export const WIFI_FIX_EVENT = 'WIFI_FIX';
/** "지금" 위치로 보는 측위 창(분) */
export const WIFI_LIVE_WINDOW_MIN = { default: 10, max: 60 } as const;
const LIVE_CAP = 3000;
const TRAIL_CAP = 600;
const CACHE_MS = 60_000;

export interface WifiContext {
  aps: Map<string, WifiApGeo>;
  apList: WifiApGeo[];
  /** 층 키 → 그 층 공간(방 대응용) */
  spacesByFloor: Map<string, WifiSpaceRef[]>;
  /** 방(SpaceNode) → 층 키·사각형(데모 신호 생성용) */
  zoneRect: Map<string, { floorKey: string; floorLevel: number; rect: { x: number; y: number; w: number; h: number } }>;
  /** 확정 도면의 층(키·레벨) — 도면이 없으면 빈 목록 */
  floors: Array<{ key: string; level: number }>;
  /** 현장 측정 표본(무효 제외) — 층마다 충분하면 신호 지도 측위(2026-10-10) */
  survey: WifiSurveyPoint[];
}

export interface StoreFixInput {
  deviceHash: string;
  patientId: string | null;
  bindingId: string | null;
  collectorId: string | null;
  observedAt: Date;
  fix: WifiFix;
  source: 'OBSERVED_WIFI' | 'SIMULATED';
  truthZoneId?: string | null;
}

/**
 * 무선 AP 측위 — 수집(wifi-location.v1) → 동의 연결 확인 → 측위 → 측위 원장 → (방이 확인되면) 위치 원장.
 *
 * 🔴 수집은 설정 `location.wifi.enabled`(기본 꺼짐 · 결정 `location.wifi.collect`)가 켜져야 받는다 — 꺼져 있으면 503 으로 말한다(받은 척하지 않는다).
 * 🔴 연결(동의) 없는 단말은 저장하지 않는다 — 해시도 남기지 않고 수만 센다.
 * 🔴 위치 원장은 같은 방이 연속 `WIFI_SOLVER.zoneConfirmFixes` 번 잡혀야 옮긴다(방 경계에서 위치가 깜빡이지 않게) · 층까지만 아는 측위는 원장을 옮기지 않는다.
 */
@Injectable()
export class WifiPositioningService {
  private readonly logger = new Logger(WifiPositioningService.name);
  private cache: { at: number; ctx: WifiContext } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly floor: FloorService,
    private readonly space: SpaceModelService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  static hashDevice(deviceRef: string): string {
    return createHash('sha256').update(deviceRef.trim()).digest('hex');
  }

  invalidate() { this.cache = null; }

  /** AP 등록부 + 확정 도면 공간 — 1분 캐시(등록부를 바꾸면 invalidate) */
  async context(): Promise<WifiContext> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.ctx;
    const [rows, geo, surveyRows] = await Promise.all([
      this.prisma.wifiAccessPoint.findMany({ where: { isActive: true }, select: { bssid: true, floorKey: true, floorLevel: true, x: true, y: true, rssiAt1m: true, pathLossExponent: true } }),
      this.space.geometry(),
      this.prisma.wifiSurveySample.findMany({ where: { voidedAt: null }, select: { id: true, floorKey: true, floorLevel: true, x: true, y: true, readings: true } }),
    ]);
    const survey: WifiSurveyPoint[] = surveyRows.map((r) => ({ ...r, readings: Array.isArray(r.readings) ? (r.readings as unknown as WifiReading[]) : [] }));
    const apList: WifiApGeo[] = rows.map((r) => ({ ...r }));
    const spacesByFloor = new Map<string, WifiSpaceRef[]>();
    const zoneRect: WifiContext['zoneRect'] = new Map();
    for (const f of geo?.floors ?? []) {
      spacesByFloor.set(f.key, f.spaces.map((s) => ({ spaceNodeId: s.spaceNodeId, rect: s.rect })));
      for (const s of f.spaces) if (s.spaceNodeId && !zoneRect.has(s.spaceNodeId)) zoneRect.set(s.spaceNodeId, { floorKey: f.key, floorLevel: f.level, rect: s.rect });
    }
    const floors = (geo?.floors ?? []).map((f) => ({ key: f.key, level: f.level }));
    const ctx: WifiContext = { aps: new Map(apList.map((a) => [a.bssid, a])), apList, spacesByFloor, zoneRect, floors, survey };
    this.cache = { at: Date.now(), ctx };
    return ctx;
  }

  /**
   * 측위 한 번 — 가중 중심(층 선택·전파 모델) 뒤, 그 층 현장 측정 표본이 충분하면 신호 지도로 좌표를 다시 잡는다.
   * 수집과 데모 시뮬레이션이 같은 길을 지난다(엔진이 둘이 되지 않게).
   */
  solve(readings: WifiReading[], ctx: WifiContext) {
    const solved = solveWifiPosition(readings, ctx.aps);
    return solved.ok ? { ok: true as const, fix: refineWithFingerprint(solved.fix, readings, ctx.survey) } : solved;
  }

  async enabled(): Promise<boolean> {
    if (!this.config) return false; // 설정을 모르면 받지 않는다(안전측)
    return (await this.config.get(WIFI_ENABLED_KEY)) === true;
  }

  /** 수집기 키 인증 — 활성 수집기만 */
  async authCollector(key: string | undefined) {
    if (!key) throw new UnauthorizedException({ code: 'COLLECTOR_KEY_REQUIRED', message: '수집기 키(X-Collector-Key)가 필요합니다.' });
    const hash = createHash('sha256').update(key).digest('hex');
    const c = await this.prisma.wifiCollector.findFirst({ where: { keyHash: hash, isActive: true }, select: { id: true, mode: true } });
    if (c) return { ...c, viaGraceKey: false };
    // 키 교체 유예(2026-10-10 · 결정 location.wifi.keyRotationGraceMinutes) — 교체 전 키는 유예 동안만 같은 수집기로 받는다.
    // 🔴 유예 저장소(Redis)를 읽지 못하면 받지 않는다(모르면 안전측 — 유예 없음과 같다)
    let graceId: string | null = null;
    if (this.redis) {
      try { graceId = await this.redis.get(wifiGraceRedisKey(hash)); } catch (e) { this.logger.warn(`수집기 키 유예 조회 실패 — 이전 키를 받지 않는다: ${e instanceof Error ? e.message : String(e)}`); }
    }
    const g = graceId ? await this.prisma.wifiCollector.findFirst({ where: { id: graceId, isActive: true }, select: { id: true, mode: true } }) : null;
    if (!g) throw new UnauthorizedException({ code: 'COLLECTOR_KEY_INVALID', message: '등록되지 않았거나 비활성인 수집기입니다.' });
    return { ...g, viaGraceKey: true };
  }

  /**
   * 수집 — 형식 오류는 배치 전체 400 · 꺼져 있으면 503 · 그 밖에는 관측별 결과를 센다.
   * 결과: accepted(형식 통과 관측) · stored(측위 저장) · unbound(연결 없는 단말 — 저장 안 함) · rejected(사유별) · moved(위치 원장 이동)
   */
  async ingest(collectorKey: string | undefined, body: unknown, now = new Date()) {
    const collector = await this.authCollector(collectorKey);
    const chk = checkWifiBatch(body);
    if (!chk.ok) throw new BadRequestException({ code: 'WIFI_BATCH_INVALID', message: 'wifi-location.v1 형식이 아닙니다 — 배치 전체를 받지 않았습니다.', details: { errors: chk.errors } });
    const batch = body as WifiLocationBatch;
    if (batch.mode !== collector.mode) throw new BadRequestException({ code: 'WIFI_MODE_MISMATCH', message: '수집기에 등록된 수집 방식과 배치의 방식이 다릅니다.', details: { registered: collector.mode, sent: batch.mode } });
    if (!(await this.enabled())) {
      await this.touchCollector(collector.id, now, { accepted: 0, stored: 0, unbound: 0, rejected: { DISABLED: batch.observations.length }, moved: 0 });
      throw new ServiceUnavailableException({ code: 'WIFI_LOCATION_DISABLED', message: '무선 위치 수집이 꺼져 있습니다(설정 location.wifi.enabled · 결정 location.wifi.collect) — 아무것도 저장하지 않았습니다.' });
    }
    const ctx = await this.context();
    const hashes = [...new Set(batch.observations.map((o) => WifiPositioningService.hashDevice(o.deviceRef)))];
    const bindings = await this.prisma.wifiDeviceBinding.findMany({ where: { deviceHash: { in: hashes }, unboundAt: null }, select: { id: true, deviceHash: true, patientId: true } });
    const byHash = new Map(bindings.map((b) => [b.deviceHash, b]));
    // 🔴 (2026-10-10) 사망한 환자에게 열린 연결 — 그 태그는 다른 사람·분실물이다. 그 환자 이름으로 위치를 쌓지 않는다(연결 해제는 사람 몫 · 현황이 센다)
    const deceased = bindings.length
      ? new Set((await this.prisma.patient.findMany({ where: { id: { in: [...new Set(bindings.map((b) => b.patientId))] }, isDeceased: true }, select: { id: true } })).map((p) => p.id))
      : new Set<string>();
    const result = { accepted: batch.observations.length, stored: 0, unbound: 0, rejected: {} as Record<string, number>, moved: 0, lateNoMove: 0 };
    const reject = (r: string) => { result.rejected[r] = (result.rejected[r] ?? 0) + 1; };
    // 같은 단말이 한 배치에 여럿이면 시각순으로(연속 판정이 순서를 쓴다)
    const obs = [...batch.observations].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
    for (const o of obs) {
      const hash = WifiPositioningService.hashDevice(o.deviceRef);
      const binding = byHash.get(hash);
      if (!binding) { result.unbound++; continue; }
      if (deceased.has(binding.patientId)) { reject('PATIENT_DECEASED'); continue; }
      const observedAt = new Date(o.observedAt);
      const age = wifiObservationAgeReason(observedAt, now);
      if (age) { reject(age); continue; }
      const solved = this.solve(o.readings, ctx);
      if (!solved.ok) { reject(solved.reason); continue; }
      const r = await this.storeFix({ deviceHash: hash, patientId: binding.patientId, bindingId: binding.id, collectorId: collector.id, observedAt, fix: solved.fix, source: 'OBSERVED_WIFI' }, ctx);
      result.stored++;
      if (r.moved) result.moved++;
      if (r.late) result.lateNoMove++;
    }
    // 이전 키(유예)로 들어왔으면 현황이 말한다 — 수집기 설정을 아직 안 바꿨다는 뜻
    await this.touchCollector(collector.id, now, collector.viaGraceKey ? { ...result, viaGraceKey: true } : result);
    return result;
  }

  private async touchCollector(id: string, now: Date, last: object) {
    await this.prisma.wifiCollector.update({ where: { id }, data: { lastSeenAt: now, lastBatch: { ...last, at: now.toISOString() } as Prisma.InputJsonValue } });
  }

  /**
   * 측위 한 건 저장 + (관측이면) 위치 원장 반영. 시뮬레이션은 원장을 옮기지 않는다(데모 이동기가 업무 상태로 따로 놓는다).
   * 원장 이동 조건: 방(ZONE) 측위 · 직전 측위도 같은 방 · 지금 열린 위치가 그 방이 아님.
   */
  async storeFix(input: StoreFixInput, ctx?: WifiContext): Promise<{ fixId: string; moved: boolean; late?: boolean }> {
    const c = ctx ?? (await this.context());
    const zone = wifiZoneForFix(input.fix, c.spacesByFloor.get(input.fix.floorKey) ?? []);
    /**
     * 🔴 (2026-10-10) 직전 = **이 관측보다 앞선** 관측 측위(종전: 그 단말의 가장 최근 측위).
     *    관측은 15분까지 늦게 올 수 있다 — 늦게 온 옛 관측이 더 최근 위치를 원장에서 덮어쓰지 않게, 이보다 새 측위가 이미 있으면 원장을 옮기지 않는다.
     */
    const [prev, newer] = input.source === 'OBSERVED_WIFI'
      ? await Promise.all([
        this.prisma.wifiPositionFix.findFirst({ where: { deviceHash: input.deviceHash, source: 'OBSERVED_WIFI', observedAt: { lte: input.observedAt } }, orderBy: { observedAt: 'desc' }, select: { zoneId: true, granularity: true } }),
        this.prisma.wifiPositionFix.findFirst({ where: { deviceHash: input.deviceHash, source: 'OBSERVED_WIFI', observedAt: { gt: input.observedAt } }, select: { id: true } }),
      ])
      : [null, null];
    const created = await this.prisma.wifiPositionFix.create({
      data: {
        deviceHash: input.deviceHash, patientId: input.patientId, bindingId: input.bindingId, collectorId: input.collectorId,
        observedAt: input.observedAt, floorKey: input.fix.floorKey, floorLevel: input.fix.floorLevel, x: input.fix.x, y: input.fix.y,
        accuracyM: input.fix.accuracyM, apCount: input.fix.apCount, quality: input.fix.quality, floorShare: input.fix.floorShare,
        uncalibrated: input.fix.uncalibrated, zoneId: zone.spaceNodeId, granularity: zone.granularity, method: input.fix.method,
        source: input.source, readings: input.fix.used as unknown as Prisma.InputJsonValue, truthZoneId: input.truthZoneId ?? null,
      },
      select: { id: true },
    });
    if (input.source !== 'OBSERVED_WIFI' || !input.patientId || zone.granularity !== 'ZONE' || !zone.spaceNodeId) return { fixId: created.id, moved: false };
    if (newer) return { fixId: created.id, moved: false, late: true };
    // 연속 확인 — 직전 관측 측위도 같은 방이어야(zoneConfirmFixes = 2 → 직전 1건)
    if (WIFI_SOLVER.zoneConfirmFixes > 1 && !(prev && prev.granularity === 'ZONE' && prev.zoneId === zone.spaceNodeId)) return { fixId: created.id, moved: false };
    const open = await this.prisma.patientLocation.findFirst({ where: { patientId: input.patientId, leftAt: null }, orderBy: { enteredAt: 'desc' }, select: { zoneId: true } });
    if (open?.zoneId === zone.spaceNodeId) return { fixId: created.id, moved: false };
    const loc = await this.floor.recordLocation({
      patientId: input.patientId, zoneId: zone.spaceNodeId, source: 'OBSERVED_WIFI', granularity: 'ZONE', status: 'wifi',
      // 원장 진입 시각은 기록 시각(정본 쓰기 규약) — 실제 관측 시각·측위 방법을 함께 남긴다
      eventType: WIFI_FIX_EVENT, metadata: { fixId: created.id, observedAt: input.observedAt.toISOString(), method: input.fix.method, accuracyM: input.fix.accuracyM, apCount: input.fix.apCount, uncalibrated: input.fix.uncalibrated },
    });
    await this.prisma.wifiPositionFix.update({ where: { id: created.id }, data: { locationId: loc.id } });
    return { fixId: created.id, moved: true };
  }

  /** 지금(최근 N분) 단말별 마지막 측위 — 3D 측위 점 · 이름·등록번호는 화면이 가린다 */
  async live(minutes?: number, now = new Date()) {
    const win = Math.min(WIFI_LIVE_WINDOW_MIN.max, Math.max(1, minutes ?? WIFI_LIVE_WINDOW_MIN.default));
    const since = new Date(now.getTime() - win * 60000);
    const rows = await this.prisma.wifiPositionFix.findMany({
      where: { observedAt: { gte: since, lte: now } },
      orderBy: { observedAt: 'desc' },
      take: LIVE_CAP + 1,
      select: { deviceHash: true, patientId: true, observedAt: true, floorKey: true, floorLevel: true, x: true, y: true, accuracyM: true, apCount: true, quality: true, floorShare: true, uncalibrated: true, zoneId: true, granularity: true, source: true, method: true },
    });
    const truncated = rows.length > LIVE_CAP;
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows.slice(0, LIVE_CAP)) if (!latest.has(r.deviceHash)) latest.set(r.deviceHash, r);
    const items = [...latest.values()];
    const pids = [...new Set(items.map((i) => i.patientId).filter((x): x is string => !!x))];
    const patients = pids.length ? await this.prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, familyName: true, givenName: true, mrn: true } }) : [];
    const pm = new Map(patients.map((p) => [p.id, p]));
    return {
      items: items.map(({ deviceHash: _d, ...i }) => {
        const p = i.patientId ? pm.get(i.patientId) : undefined;
        return { ...i, patientName: p ? joinPatientName(p.familyName, p.givenName) : null, mrn: p?.mrn ?? null };
      }),
      meta: { windowMin: win, since: since.toISOString(), truncated, total: items.length },
    };
  }

  /** 한 환자의 하루(KST) 측위 궤적 — 시간순 · 상한을 넘으면 잘랐다고 말한다 */
  async trail(patientId: string, date: string) {
    // KST 하루 정본 — 형식이 틀리면 dayRange 가 400 · 날짜를 안 주면 전 기간이 되지 않게 여기서 400
    const range = date ? dayRange(date, date) : undefined;
    if (!range) throw new BadRequestException({ code: 'DATE_REQUIRED', message: '날짜(YYYY-MM-DD)를 지정해 주세요.' });
    const rows = await this.prisma.wifiPositionFix.findMany({
      where: { patientId, observedAt: range },
      orderBy: { observedAt: 'asc' },
      take: TRAIL_CAP + 1,
      select: { observedAt: true, floorKey: true, floorLevel: true, x: true, y: true, accuracyM: true, apCount: true, quality: true, zoneId: true, granularity: true, source: true, uncalibrated: true, method: true },
    });
    return { items: rows.slice(0, TRAIL_CAP), meta: { truncated: rows.length > TRAIL_CAP, cap: TRAIL_CAP } };
  }
}
