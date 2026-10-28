import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import {
  WIFI_FINGERPRINT, WIFI_SIM_FIX_KEEP_HOURS, calibrationPairsFor, fitPathLoss, normalizeBssid, parseWifiApCsv,
  type WifiCollectMode, type WifiConsentBasis, type WifiDeviceKind, type WifiReading, type WifiSurveyPoint,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { withAdvisoryLock } from '../../common/util/advisory-lock';
import { WifiPositioningService, WIFI_ENABLED_KEY, WIFI_KEY_GRACE_KEY, wifiGraceRedisKey, wifiGraceOfRedisKey } from './wifi-positioning.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';

const BINDING_LIST_CAP = 300;
/** 환자 상태로 거를 때 읽는 열린 연결 상한 — 넘으면 잘렸다고 말한다 */
const BINDING_STATE_SCAN_CAP = 2000;
/** 일괄 해제 한 번의 상한 */
export const WIFI_UNBIND_BULK_MAX = 100;
/** 재원 종료·사망 때 열린 단말 연결 자동 해제 — 결정 location.wifi.autoUnbindOnEnd · 미설정 = 끔(사람이 점검 목록에서 해제) */
export const WIFI_AUTO_UNBIND_KEY = 'location.wifi.autoUnbindOnEnd';
export const WIFI_KEY_GRACE_MAX_MINUTES = 1440;
export type WifiAutoUnbindCause = 'DISCHARGE' | 'TRANSFER' | 'DECEASED';
/** 자동 해제 사유 — 원장에 남는 문장(조립하지 않는 고정 문구 · 어느 결정으로 해제됐는지 함께) */
export const WIFI_AUTO_UNBIND_REASON: Record<WifiAutoUnbindCause, string> = {
  DISCHARGE: '자동 해제 — 퇴원(결정 location.wifi.autoUnbindOnEnd)',
  TRANSFER: '자동 해제 — 전원(결정 location.wifi.autoUnbindOnEnd)',
  DECEASED: '자동 해제 — 사망(결정 location.wifi.autoUnbindOnEnd)',
};
/** 설정 값 해석 — 1~1440 정수만 유예 · 그 밖(미설정·형식 위반)은 유예 없음(즉시 무효) */
export function wifiKeyGraceMinutes(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= WIFI_KEY_GRACE_MAX_MINUTES ? v : null;
}

/**
 * 무선 위치 등록부 — AP(좌표·교정)·수집기(키)·단말↔환자 연결(동의 근거) · 현황.
 *
 * 🔴 수집기 키 원문은 발급 응답에서 한 번만 준다(sha256 만 저장).
 * 🔴 단말 연결은 동의 근거가 있어야 한다 · 해제는 지우지 않고 시각·사유 · 한 단말은 한 환자에게만(환자별이 아니라 단말별 잠금).
 * 🔴 단말 원문(MAC·태그 번호)은 저장하지 않는다 — 해시와 사람이 알아볼 끝 4자리만.
 */
@Injectable()
export class WifiRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly positioning: WifiPositioningService,
    private readonly config: ConfigRuntimeService,
    @Optional() private readonly redis?: RedisService,
  ) {}
  private readonly logger = new Logger(WifiRegistryService.name);

  // ── AP ──
  async listAccessPoints() {
    return this.prisma.wifiAccessPoint.findMany({ orderBy: [{ floorLevel: 'asc' }, { label: 'asc' }] });
  }

  async createAccessPoint(dto: { bssid: string; label: string; floorKey: string; x: number; y: number; vendor?: string | null }, userId: string) {
    const bssid = normalizeBssid(dto.bssid);
    if (!bssid) throw new BadRequestException({ code: 'BSSID_INVALID', message: 'BSSID 형식이 아닙니다(예: aa:bb:cc:dd:ee:ff).' });
    const ctx = await this.positioning.context();
    const floor = await this.floorOf(dto.floorKey);
    const zoneId = this.zoneAt(ctx.spacesByFloor.get(dto.floorKey) ?? [], dto.x, dto.y);
    try {
      const r = await this.prisma.wifiAccessPoint.create({
        data: { bssid, label: dto.label, floorKey: dto.floorKey, floorLevel: floor.level, x: dto.x, y: dto.y, zoneId, vendor: dto.vendor ?? null, dataOrigin: 'REGISTERED', createdById: userId },
      });
      this.positioning.invalidate();
      return r;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException({ code: 'BSSID_DUPLICATE', message: '이미 등록된 BSSID 입니다.' });
      throw e;
    }
  }

  /**
   * AP 등록부 CSV 가져오기(2026-10-10) — create-only.
   *  · 🔴 한 줄이라도 틀리면(형식·도면에 없는 층) **아무것도 넣지 않는다**(일부만 들어간 등록부를 만들지 않는다) — 줄 번호와 이유
   *  · 이미 등록된 BSSID 는 건드리지 않고 건너뜀으로 센다(관리자가 고친 좌표·교정을 덮지 않는다)
   *  · dryRun 이면 미리보기만(쓰기 0)
   */
  async importAccessPoints(csv: string, dryRun: boolean, userId: string) {
    const { rows, errors } = parseWifiApCsv(csv);
    const ctx = await this.positioning.context();
    const floorByKey = new Map(ctx.floors.map((f) => [f.key, f]));
    const floorErrors = rows.filter((r) => !floorByKey.has(r.floorKey)).map((r) => ({ line: r.line, reason: 'FLOOR_NOT_IN_DRAWING' as const, value: r.floorKey }));
    const allErrors = [...errors, ...floorErrors].sort((a, b) => a.line - b.line);
    const existing = rows.length
      ? new Set((await this.prisma.wifiAccessPoint.findMany({ where: { bssid: { in: rows.map((r) => r.bssid) } }, select: { bssid: true } })).map((r) => r.bssid))
      : new Set<string>();
    const toCreate = rows.filter((r) => floorByKey.has(r.floorKey) && !existing.has(r.bssid));
    const preview = {
      total: rows.length + errors.length, valid: rows.length, errors: allErrors,
      create: toCreate.length, skipExisting: rows.filter((r) => existing.has(r.bssid)).map((r) => ({ line: r.line, bssid: r.bssid })),
      floors: [...new Set(toCreate.map((r) => r.floorKey))].sort(),
    };
    if (dryRun || allErrors.length > 0 || toCreate.length === 0) return { ...preview, applied: false, created: 0 };
    const r = await this.prisma.wifiAccessPoint.createMany({
      data: toCreate.map((a) => ({
        bssid: a.bssid, label: a.label, floorKey: a.floorKey, floorLevel: floorByKey.get(a.floorKey)!.level, x: a.x, y: a.y,
        zoneId: this.zoneAt(ctx.spacesByFloor.get(a.floorKey) ?? [], a.x, a.y), vendor: a.vendor, dataOrigin: 'REGISTERED', createdById: userId,
      })),
      skipDuplicates: true, // 미리보기와 적용 사이에 누가 같은 BSSID 를 넣었어도 덮지 않는다
    });
    this.positioning.invalidate();
    return { ...preview, applied: true, created: r.count };
  }

  /** 좌표·교정·활성 변경 — 교정값은 둘 다 주거나 둘 다 지운다(한쪽만 교정된 AP 를 "교정됨"으로 그리지 않게) */
  async updateAccessPoint(id: string, dto: { x?: number; y?: number; label?: string; isActive?: boolean; rssiAt1m?: number | null; pathLossExponent?: number | null }) {
    const cur = await this.prisma.wifiAccessPoint.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException({ code: 'AP_NOT_FOUND', message: 'AP 를 찾을 수 없습니다.' });
    const calTouched = dto.rssiAt1m !== undefined || dto.pathLossExponent !== undefined;
    if (calTouched && (dto.rssiAt1m == null) !== (dto.pathLossExponent == null)) {
      throw new BadRequestException({ code: 'CALIBRATION_PARTIAL', message: '교정값은 1m 수신 세기와 감쇠 지수를 함께 넣거나 함께 지웁니다.' });
    }
    const x = dto.x ?? cur.x, y = dto.y ?? cur.y;
    const ctx = await this.positioning.context();
    const r = await this.prisma.wifiAccessPoint.update({
      where: { id },
      data: {
        x, y, label: dto.label ?? undefined, isActive: dto.isActive ?? undefined,
        zoneId: dto.x !== undefined || dto.y !== undefined ? this.zoneAt(ctx.spacesByFloor.get(cur.floorKey) ?? [], x, y) : undefined,
        ...(calTouched ? { rssiAt1m: dto.rssiAt1m ?? null, pathLossExponent: dto.pathLossExponent ?? null, calibratedAt: dto.rssiAt1m == null ? null : new Date() } : {}),
      },
    });
    this.positioning.invalidate();
    return r;
  }

  private async floorOf(floorKey: string) {
    const f = (await this.positioning.context()).floors.find((x) => x.key === floorKey);
    if (!f) throw new BadRequestException({ code: 'FLOOR_NOT_IN_DRAWING', message: '확정 도면에 없는 층입니다 — 도면을 먼저 확정해야 AP 를 놓을 수 있습니다.', details: { floorKey } });
    return f;
  }

  private zoneAt(spaces: Array<{ spaceNodeId: string | null; rect: { x: number; y: number; w: number; h: number } }>, x: number, y: number): string | null {
    const hit = spaces.filter((s) => x >= s.rect.x && x <= s.rect.x + s.rect.w && y >= s.rect.y && y <= s.rect.y + s.rect.h)
      .sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
    return hit?.spaceNodeId ?? null;
  }

  // ── 현장 측정 표본(2026-10-10) ──
  /**
   * 기록 — 확정 도면의 층·좌표 · 측정 시각 필수(미래 거부) · 같은 AP 중복은 센 값 하나로.
   * 🔴 이 표본이 신호 지도 측위와 교정 제안의 원천이다 — 지우지 않고 무효(사유).
   */
  async createSurvey(dto: { floorKey: string; x: number; y: number; measuredAt: string; readings: Array<{ bssid: string; rssi: number }>; note?: string | null }, userId: string, now = new Date()) {
    const floor = await this.floorOf(dto.floorKey);
    const measuredAt = new Date(dto.measuredAt);
    if (Number.isNaN(measuredAt.getTime())) throw new BadRequestException({ code: 'SURVEY_MEASURED_AT_INVALID', message: '측정 시각 형식이 아닙니다.' });
    if (measuredAt.getTime() > now.getTime() + 5 * 60_000) throw new BadRequestException({ code: 'SURVEY_MEASURED_AT_FUTURE', message: '측정 시각이 미래입니다.' });
    const best = new Map<string, number>();
    const bad: string[] = [];
    for (const r of dto.readings) {
      const b = normalizeBssid(r.bssid);
      if (!b) { bad.push(r.bssid); continue; }
      best.set(b, Math.max(best.get(b) ?? -Infinity, r.rssi));
    }
    if (bad.length) throw new BadRequestException({ code: 'SURVEY_BSSID_INVALID', message: 'BSSID 형식이 아닌 값이 있습니다.', details: { bad } });
    const ctx = await this.positioning.context();
    const row = await this.prisma.wifiSurveySample.create({
      data: {
        floorKey: dto.floorKey, floorLevel: floor.level, x: dto.x, y: dto.y,
        zoneId: this.zoneAt(ctx.spacesByFloor.get(dto.floorKey) ?? [], dto.x, dto.y),
        readings: [...best].map(([bssid, rssi]) => ({ bssid, rssi })), measuredAt, collectedById: userId, note: dto.note?.trim() || null,
      },
    });
    this.positioning.invalidate();
    return row;
  }

  async listSurvey(opts: { floorKey?: string }) {
    const where = { ...(opts.floorKey ? { floorKey: opts.floorKey } : {}) };
    const [items, perFloor] = await Promise.all([
      this.prisma.wifiSurveySample.findMany({ where, orderBy: { measuredAt: 'desc' }, take: 300 }),
      this.prisma.wifiSurveySample.groupBy({ by: ['floorKey'], where: { voidedAt: null }, _count: { _all: true } }),
    ]);
    const total = await this.prisma.wifiSurveySample.count({ where });
    return {
      items,
      meta: {
        total, truncated: total > items.length,
        // 층마다 신호 지도 측위가 켜지는 기준(유효 표본 수)
        perFloor: perFloor.map((f) => ({ floorKey: f.floorKey, samples: f._count._all, fingerprintActive: f._count._all >= WIFI_FINGERPRINT.minSamplesPerFloor })),
        minSamplesPerFloor: WIFI_FINGERPRINT.minSamplesPerFloor,
      },
    };
  }

  async voidSurvey(id: string, reason: string, userId: string) {
    const cur = await this.prisma.wifiSurveySample.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException({ code: 'SURVEY_NOT_FOUND', message: '측정 표본을 찾을 수 없습니다.' });
    if (cur.voidedAt) return cur;
    const r = await this.prisma.wifiSurveySample.update({ where: { id }, data: { voidedAt: new Date(), voidedById: userId, voidReason: reason.trim() } });
    this.positioning.invalidate();
    return r;
  }

  /**
   * 교정 제안 — AP 마다 같은 층 유효 표본의 (거리, 세기) 쌍으로 경로 손실 모델을 맞춘다.
   * 🔴 제안만 — 적용은 관리자가 AP 교정값으로 넣는다(기존 PATCH). 맞추지 못하면 이유를 말한다(0·기본값을 제안으로 내지 않는다).
   */
  async calibrationSuggestions() {
    const [aps, rows] = await Promise.all([
      this.prisma.wifiAccessPoint.findMany({ where: { isActive: true }, orderBy: [{ floorLevel: 'asc' }, { label: 'asc' }] }),
      this.prisma.wifiSurveySample.findMany({ where: { voidedAt: null }, select: { id: true, floorKey: true, floorLevel: true, x: true, y: true, readings: true } }),
    ]);
    const survey: WifiSurveyPoint[] = rows.map((r) => ({ ...r, readings: Array.isArray(r.readings) ? (r.readings as unknown as WifiReading[]) : [] }));
    return {
      samples: survey.length,
      items: aps.map((ap) => {
        const fit = fitPathLoss(calibrationPairsFor(ap, survey));
        return {
          apId: ap.id, bssid: ap.bssid, label: ap.label, floorKey: ap.floorKey,
          current: { rssiAt1m: ap.rssiAt1m, pathLossExponent: ap.pathLossExponent, calibratedAt: ap.calibratedAt },
          suggestion: fit.ok ? { rssiAt1m: fit.rssiAt1m, pathLossExponent: fit.exponent, pairs: fit.pairs, rmseDb: fit.rmseDb } : null,
          reason: fit.ok ? null : fit.reason,
          pairs: fit.pairs,
        };
      }),
    };
  }

  // ── 수집기 ──
  async listCollectors() {
    return this.prisma.wifiCollector.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, label: true, mode: true, vendor: true, isActive: true, lastSeenAt: true, lastBatch: true, dataOrigin: true, createdAt: true, keyRotatedAt: true } });
  }

  /** 발급 — 키 원문은 이 응답에서만 */
  async createCollector(dto: { label: string; mode: WifiCollectMode; vendor?: string | null }, userId: string) {
    const key = `wfc_${randomBytes(24).toString('hex')}`;
    const c = await this.prisma.wifiCollector.create({
      data: { label: dto.label, mode: dto.mode, vendor: dto.vendor ?? null, keyHash: createHash('sha256').update(key).digest('hex'), dataOrigin: 'REGISTERED', createdById: userId },
      select: { id: true, label: true, mode: true },
    });
    return { ...c, key, keyNotice: '키는 지금 한 번만 보입니다 — 수집기 설정에 넣고 이 화면을 닫으면 다시 볼 수 없습니다.' };
  }

  /**
   * 키 교체(2026-10-10) — 새 키 원문은 이 응답에서 한 번만. 🔴 교체 즉시 이전 키는 무효(해시를 바꾼다 — 유예 없음).
   * 수집기 설정을 바꾸는 동안 들어오는 배치는 401 이 된다 — 화면이 그 사실을 먼저 말한다.
   */
  async rotateCollectorKey(id: string, now = new Date()) {
    const c = await this.prisma.wifiCollector.findUnique({ where: { id }, select: { id: true, label: true, keyHash: true } });
    if (!c) throw new NotFoundException({ code: 'COLLECTOR_NOT_FOUND', message: '수집기를 찾을 수 없습니다.' });
    const key = `wfc_${randomBytes(24).toString('hex')}`;
    await this.prisma.wifiCollector.update({ where: { id }, data: { keyHash: createHash('sha256').update(key).digest('hex'), keyRotatedAt: now } });
    // 유예(2026-10-10 · 결정 location.wifi.keyRotationGraceMinutes) — 설정이 있으면 이전 키를 그 시간 동안만 같은 수집기로 받는다.
    // 다시 교체하면 그 전 유예는 끝낸다(유예 중인 키는 늘 하나). 유예 저장에 실패하면 이전 키는 즉시 무효로 말한다(지어내지 않는다).
    const graceMinutes = wifiKeyGraceMinutes(await this.config.get(WIFI_KEY_GRACE_KEY));
    let graceUntil: Date | null = null;
    if (this.redis) {
      try {
        const prev = await this.redis.get(wifiGraceOfRedisKey(c.id));
        if (prev) await this.redis.del(wifiGraceRedisKey(prev));
        await this.redis.del(wifiGraceOfRedisKey(c.id));
        if (graceMinutes) {
          await this.redis.set(wifiGraceRedisKey(c.keyHash), c.id, 'EX', graceMinutes * 60);
          await this.redis.set(wifiGraceOfRedisKey(c.id), c.keyHash, 'EX', graceMinutes * 60);
          graceUntil = new Date(now.getTime() + graceMinutes * 60_000);
        }
      } catch (e) {
        this.logger.warn(`수집기 키 유예 저장 실패 — 이전 키는 즉시 무효 collector=${c.id}: ${e instanceof Error ? e.message : String(e)}`);
        graceUntil = null;
      }
    }
    return {
      id: c.id, label: c.label, key, keyRotatedAt: now, graceMinutes: graceUntil ? graceMinutes : null, graceUntil,
      keyNotice: graceUntil
        ? '새 키는 지금 한 번만 보입니다 — 이전 키는 유예 시각까지만 받습니다. 그 전에 수집기 설정을 바꾸십시오.'
        : '새 키는 지금 한 번만 보입니다 — 이전 키는 방금 무효가 됐습니다. 수집기 설정을 바로 바꾸십시오.',
    };
  }

  /**
   * 재원 종료·사망 때 그 환자의 열린 단말 연결 자동 해제(2026-10-10 · 결정 location.wifi.autoUnbindOnEnd).
   * 🔴 설정이 정확히 true 일 때만 — 미설정·끔이면 아무것도 바꾸지 않고 현황의 '연결 점검'에 남는다(사람이 본다).
   * 퇴원·전원인데 같은 환자가 아직 다른 재원 중이면 해제하지 않는다. 해제자 = 사망 처리한 사람(퇴원 이벤트는 시스템 = null).
   */
  async autoUnbindForPatient(patientId: string, cause: WifiAutoUnbindCause, actorId: string | null, now = new Date()) {
    if ((await this.config.get(WIFI_AUTO_UNBIND_KEY)) !== true) return { applied: false as const, reason: 'SETTING_OFF' as const, unbound: 0 };
    if (cause !== 'DECEASED') {
      const stillIn = await this.prisma.admission.count({ where: { patientId, status: 'ADMITTED' } });
      if (stillIn > 0) return { applied: false as const, reason: 'STILL_ADMITTED' as const, unbound: 0 };
    }
    const r = await this.prisma.wifiDeviceBinding.updateMany({
      where: { patientId, unboundAt: null },
      data: { unboundAt: now, unboundById: actorId, unboundReason: WIFI_AUTO_UNBIND_REASON[cause] },
    });
    return { applied: true as const, reason: null, unbound: r.count };
  }

  async setCollectorActive(id: string, isActive: boolean) {
    const c = await this.prisma.wifiCollector.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundException({ code: 'COLLECTOR_NOT_FOUND', message: '수집기를 찾을 수 없습니다.' });
    return this.prisma.wifiCollector.update({ where: { id }, data: { isActive }, select: { id: true, isActive: true } });
  }

  // ── 단말 ↔ 환자 연결 ──
  async listBindings(opts: { patientId?: string; activeOnly?: boolean; state?: 'DECEASED' | 'NOT_ADMITTED' | 'ADMITTED' }) {
    // 🔴 (2026-10-10) 환자 상태 거르기는 열린 연결에서만 의미가 있다 — 상한 전에 거르기 위해 그때는 열린 연결 전부(작다)를 읽는다
    const byState = !!opts.state;
    const where = { ...(opts.patientId ? { patientId: opts.patientId } : {}), ...(opts.activeOnly || byState ? { unboundAt: null } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.wifiDeviceBinding.findMany({ where, orderBy: { boundAt: 'desc' }, take: byState ? BINDING_STATE_SCAN_CAP : BINDING_LIST_CAP, select: { id: true, deviceKind: true, displayHint: true, patientId: true, consentBasis: true, consentNote: true, boundAt: true, boundById: true, unboundAt: true, unboundReason: true, dataOrigin: true } }),
      this.prisma.wifiDeviceBinding.count({ where }),
    ]);
    const pids = [...new Set(rows.map((r) => r.patientId))];
    const [patients, admitted] = pids.length ? await Promise.all([
      this.prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, familyName: true, givenName: true, mrn: true, isDeceased: true } }),
      this.prisma.admission.findMany({ where: { patientId: { in: pids }, status: 'ADMITTED' }, select: { patientId: true } }),
    ]) : [[], []];
    const pm = new Map(patients.map((p) => [p.id, p]));
    const inStay = new Set(admitted.map((a) => a.patientId));
    /**
     * 🔴 (2026-10-10) 열린 연결의 환자 상태 — 퇴원·사망 뒤에도 연결이 열려 있으면 그 태그가 다른 사람에게 가 있어도 그 환자 위치로 쌓인다.
     *    자동 해제는 하지 않는다(외래 환자도 태그를 쓸 수 있다 — 끊는 기준은 사람 결정). 화면이 상태를 말하고 사람이 해제한다.
     *    DECEASED(사망) · NOT_ADMITTED(재원 중 입원 없음 — 외래 사용일 수 있다) · ADMITTED
     */
    const stateOf = (pid: string) => (pm.get(pid)?.isDeceased ? 'DECEASED' : inStay.has(pid) ? 'ADMITTED' : 'NOT_ADMITTED');
    const all = rows.map((r) => ({ ...r, patient: pm.get(r.patientId) ?? null, patientState: stateOf(r.patientId) }));
    if (!byState) return { items: all, meta: { total, truncated: total > rows.length } };
    const hit = all.filter((r) => r.patientState === opts.state);
    // 열린 연결이 스캔 상한을 넘으면 거른 결과도 일부일 수 있다 — 그 사실을 함께
    return { items: hit.slice(0, BINDING_LIST_CAP), meta: { total: hit.length, truncated: hit.length > BINDING_LIST_CAP || total > rows.length, scanned: rows.length, openTotal: total } };
  }

  /**
   * 연결 — 동의 근거 필수(DEMO 는 데모 모드에서만 · 화면에서는 고를 수 없다) · 같은 단말이 다른 환자에게 열려 있으면 409.
   * 단말 원문은 해시로만 남기고 끝 4자리를 사람이 알아볼 표식으로 둔다.
   */
  async bind(dto: { deviceRef: string; deviceKind: WifiDeviceKind; patientId: string; consentBasis: WifiConsentBasis; consentNote?: string | null }, userId: string) {
    if (dto.consentBasis === 'DEMO') throw new BadRequestException({ code: 'CONSENT_BASIS_DEMO', message: '데모 근거는 직원 화면에서 쓸 수 없습니다.' });
    if (dto.consentBasis === 'VERBAL_RECORDED' && !dto.consentNote?.trim()) throw new BadRequestException({ code: 'CONSENT_NOTE_REQUIRED', message: '구두 동의는 누구에게서 어떻게 받았는지 적어야 합니다.' });
    const patient = await this.prisma.patient.findUnique({ where: { id: dto.patientId }, select: { id: true, isDeceased: true } });
    if (!patient) throw new NotFoundException({ code: 'PATIENT_NOT_FOUND', message: '환자를 찾을 수 없습니다.' });
    // 🔴 (2026-10-10) 사망한 환자에게 위치 태그를 연결하지 않는다
    if (patient.isDeceased) throw new BadRequestException({ code: 'PATIENT_DECEASED', message: '사망한 환자에게는 단말을 연결할 수 없습니다.' });
    const ref = dto.deviceRef.trim();
    const deviceHash = WifiPositioningService.hashDevice(ref);
    return withAdvisoryLock(this.prisma, `wifi-binding:${deviceHash}`, async (tx) => {
      const open = await tx.wifiDeviceBinding.findFirst({ where: { deviceHash, unboundAt: null }, select: { id: true, patientId: true } });
      if (open) throw new ConflictException({ code: 'DEVICE_ALREADY_BOUND', message: '이 단말은 이미 다른 연결이 열려 있습니다 — 먼저 해제하십시오.', details: { bindingId: open.id, samePatient: open.patientId === dto.patientId } });
      return tx.wifiDeviceBinding.create({
        data: { deviceHash, deviceKind: dto.deviceKind, displayHint: ref.slice(-4), patientId: dto.patientId, consentBasis: dto.consentBasis, consentNote: dto.consentNote?.trim() || null, boundById: userId, dataOrigin: 'REGISTERED' },
        select: { id: true, deviceKind: true, displayHint: true, patientId: true, consentBasis: true, boundAt: true },
      });
    });
  }

  async unbind(id: string, reason: string, userId: string) {
    if (!reason?.trim()) throw new BadRequestException({ code: 'UNBIND_REASON_REQUIRED', message: '해제 사유를 적어야 합니다.' });
    const b = await this.prisma.wifiDeviceBinding.findUnique({ where: { id }, select: { unboundAt: true } });
    if (!b) throw new NotFoundException({ code: 'BINDING_NOT_FOUND', message: '연결을 찾을 수 없습니다.' });
    if (b.unboundAt) throw new ConflictException({ code: 'BINDING_ALREADY_UNBOUND', message: '이미 해제된 연결입니다.' });
    return this.prisma.wifiDeviceBinding.update({ where: { id }, data: { unboundAt: new Date(), unboundById: userId, unboundReason: reason.trim() }, select: { id: true, unboundAt: true } });
  }

  /**
   * 일괄 해제(2026-10-10) — 사유 하나로 여럿(상한 100) · 🔴 자동이 아니라 사람이 고른 연결만 · 이미 해제된 것은 건너뜀으로 센다(덮지 않는다).
   */
  async unbindMany(ids: string[], reason: string, userId: string, now = new Date()) {
    if (!reason?.trim()) throw new BadRequestException({ code: 'UNBIND_REASON_REQUIRED', message: '해제 사유를 적어야 합니다.' });
    const uniq = [...new Set(ids)];
    if (uniq.length === 0 || uniq.length > WIFI_UNBIND_BULK_MAX) throw new BadRequestException({ code: 'UNBIND_BULK_SIZE', message: '한 번에 해제할 수 있는 수를 벗어났습니다.', details: { min: 1, max: WIFI_UNBIND_BULK_MAX } });
    const found = await this.prisma.wifiDeviceBinding.findMany({ where: { id: { in: uniq } }, select: { id: true, unboundAt: true } });
    const open = found.filter((b) => !b.unboundAt).map((b) => b.id);
    const r = open.length
      ? await this.prisma.wifiDeviceBinding.updateMany({ where: { id: { in: open }, unboundAt: null }, data: { unboundAt: now, unboundById: userId, unboundReason: reason.trim() } })
      : { count: 0 };
    return { requested: uniq.length, unbound: r.count, alreadyUnbound: found.length - open.length, notFound: uniq.length - found.length };
  }

  // ── 현황 ──
  /**
   * 수집 설정·AP 수(교정 여부)·수집기 마지막 수신·최근 1시간 측위(출처별)·시뮬레이션 방 적중률(분모 함께).
   * 🔴 적중률은 **시뮬레이션 신호**에 대한 엔진 성능이다 — 실제 병원 정확도가 아니다(실측은 교정 측정으로).
   */
  async status(now = new Date()) {
    const hourAgo = new Date(now.getTime() - 3600_000);
    const dayAgo = new Date(now.getTime() - 86400_000);
    const [autoUnbindSrc, graceSrc] = await Promise.all([this.config.getWithSource(WIFI_AUTO_UNBIND_KEY), this.config.getWithSource(WIFI_KEY_GRACE_KEY)]);
    const [enabledSrc, aps, collectors, fixesBySource, activeBindings, sim] = await Promise.all([
      this.config.getWithSource(WIFI_ENABLED_KEY),
      this.prisma.wifiAccessPoint.groupBy({ by: ['floorKey', 'dataOrigin'], where: { isActive: true }, _count: { _all: true } }),
      this.prisma.wifiCollector.findMany({ select: { id: true, label: true, mode: true, isActive: true, lastSeenAt: true, lastBatch: true, dataOrigin: true } }),
      this.prisma.wifiPositionFix.groupBy({ by: ['source'], where: { observedAt: { gte: hourAgo } }, _count: { _all: true } }),
      this.prisma.wifiDeviceBinding.count({ where: { unboundAt: null } }),
      this.prisma.$queryRaw<Array<{ total: bigint; zoned: bigint; hit: bigint }>>`
        SELECT count(*)::bigint AS total,
               count(*) FILTER (WHERE granularity = 'ZONE')::bigint AS zoned,
               count(*) FILTER (WHERE granularity = 'ZONE' AND zone_id = truth_zone_id)::bigint AS hit
          FROM wifi_position_fixes
         WHERE source = 'SIMULATED' AND truth_zone_id IS NOT NULL AND observed_at >= ${dayAgo}`,
    ]);
    const [uncalibrated, surveyByFloor, openBindings] = await Promise.all([
      this.prisma.wifiAccessPoint.count({ where: { isActive: true, OR: [{ rssiAt1m: null }, { pathLossExponent: null }] } }),
      this.prisma.wifiSurveySample.groupBy({ by: ['floorKey'], where: { voidedAt: null }, _count: { _all: true } }),
      this.prisma.wifiDeviceBinding.findMany({ where: { unboundAt: null }, select: { patientId: true } }),
    ]);
    // 열린 연결 점검 — 사망·재원 아님(자동 해제하지 않는다 · 사람이 본다)
    const openPids = [...new Set(openBindings.map((b) => b.patientId))];
    const [deadRows, admittedRows] = openPids.length ? await Promise.all([
      this.prisma.patient.findMany({ where: { id: { in: openPids }, isDeceased: true }, select: { id: true } }),
      this.prisma.admission.findMany({ where: { patientId: { in: openPids }, status: 'ADMITTED' }, select: { patientId: true } }),
    ]) : [[], []];
    const dead = new Set(deadRows.map((d) => d.id)); const inStay = new Set(admittedRows.map((a) => a.patientId));
    const s = sim[0] ?? { total: 0n, zoned: 0n, hit: 0n };
    return {
      enabled: enabledSrc.value === true,
      enabledSource: enabledSrc.source,
      accessPoints: { byFloor: aps.map((a) => ({ floorKey: a.floorKey, dataOrigin: a.dataOrigin, count: a._count._all })), uncalibrated },
      collectors,
      fixesLastHour: Object.fromEntries(fixesBySource.map((f) => [f.source, f._count._all])),
      activeBindings,
      // 사람 결정 두 가지의 현재 값(2026-10-10) — 화면이 결정 화면으로 잇는다
      autoUnbind: { on: autoUnbindSrc.value === true, source: autoUnbindSrc.source, decisionKey: WIFI_AUTO_UNBIND_KEY },
      keyRotationGrace: { minutes: wifiKeyGraceMinutes(graceSrc.value), source: graceSrc.source, decisionKey: WIFI_KEY_GRACE_KEY },
      bindingCheck: {
        deceased: openBindings.filter((b) => dead.has(b.patientId)).length,
        notAdmitted: openBindings.filter((b) => !dead.has(b.patientId) && !inStay.has(b.patientId)).length,
      },
      survey: {
        samples: surveyByFloor.reduce((n, f) => n + f._count._all, 0),
        fingerprintFloors: surveyByFloor.filter((f) => f._count._all >= WIFI_FINGERPRINT.minSamplesPerFloor).map((f) => f.floorKey).sort(),
        minSamplesPerFloor: WIFI_FINGERPRINT.minSamplesPerFloor,
      },
      // 🔴 관측 측위·위치 원장 보존 기간은 결정 location.retentionDays(허가권자) 전 — 지우지 않는다. 시뮬레이션만 24시간 뒤 생성기가 지운다
      retention: { decisionKey: 'location.retentionDays', observedDeleted: false, simulatedHours: WIFI_SIM_FIX_KEEP_HOURS },
      simulation: { total: Number(s.total), zoned: Number(s.zoned), hit: Number(s.hit) },
    };
  }
}
