import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WIFI_SIM_FIX_KEEP_HOURS, isObservedLocation, simulateWifiReadings, wifiDemoNoise } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FloorService } from '../floor/floor.service';
import { HisModeService } from '../../common/his-mode/his-mode.service';
import { DevDemoService } from './dev-demo.service';
import { localDateKey, parseLocalDate } from '../../common/day-range';
import { planDemoPositions, type ZoneRef } from './demo-movement';
import { WifiPositioningService } from '../wifi-location/wifi-positioning.service';

/** 한 주기에 쓰는 위치 상한 — 첫 실행(대기 수백 명)에서 쓰기 폭주를 막는다(남은 것은 다음 주기) */
const MAX_WRITES_PER_RUN = 400;
/** 한 주기에 만드는 시뮬레이션 측위 상한 · 시뮬레이션 측위 보관(시간) — 데모 측위 원장이 무한히 쌓이지 않게(이 생성기가 쓴 것만 지운다) */
const MAX_WIFI_FIXES_PER_RUN = 400;
const SIM_FIX_KEEP_HOURS = WIFI_SIM_FIX_KEEP_HOURS; // 정본 shared(관리 현황이 같은 값을 말한다)
/** 데모 이동 주기(ms) — 같은 주기 안에서는 같은 측위 점(결정적) */
const TICK_MS = 120_000;
const ER_ACTIVE = ['PENDING_TRIAGE', 'TRIAGED', 'PENDING_DOCTOR', 'IN_TREATMENT', 'PENDING_RESULT', 'UNDER_OBSERVATION', 'PENDING_DISPOSITION'];
export const DEMO_MOVEMENT_EVENT = 'DEMO_MOVEMENT';

export interface DemoMovementResult {
  ran: boolean;
  reason?: string;
  planned: number;
  moved: number;
  unchanged: number;
  closed: number;
  skippedObserved: number;
  capped: boolean;
  /** 무선 측위 시뮬레이션 — AP·확정 도면이 없으면 null(이유와 함께) */
  wifi?: { fixes: number; failed: number; pruned: number } | { skipped: 'NO_ACCESS_POINTS' | 'NO_GEOMETRY' | 'NOT_WIRED' };
}

/**
 * 데모 환자 이동 시뮬레이터(2026-10-09) — 통합 상황판 3D·층 보드가 "환자가 어디에 있는지"를 데모로 보여 주게.
 *
 * 🔴 실제 위치가 아니다: 출처 SIMULATED · eventType DEMO_MOVEMENT · metadata.demo=true. 화면은 "시뮬레이션"으로 따로 그린다.
 * 🔴 운영 모드 REAL 이면 돌지 않는다(실환자 원장에 가짜 이동을 쓰지 않는다) · 데모 데이터 설정(dev.demoDateRoll)이 꺼져도 돌지 않는다.
 * 🔴 관측 위치(QR·스테이션·직원 입력)가 열려 있는 환자는 건드리지 않는다 — 관측이 시뮬레이션을 이긴다.
 * 쓰기는 위치 원장의 유일한 쓰기 경로(`FloorService.recordLocation` — 환자별 잠금·열린 위치 닫기)를 지난다.
 */
@Injectable()
export class DemoMovementService {
  private readonly logger = new Logger(DemoMovementService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly floor: FloorService,
    private readonly demo: DevDemoService,
    @Optional() private readonly hisMode?: HisModeService,
    @Optional() private readonly wifi?: WifiPositioningService,
  ) {}

  /** 2분마다 — 데모가 켜져 있고 REAL 이 아닐 때만 */
  @Cron('0 */2 * * * *', { name: 'dev-demo-patient-movement', timeZone: 'Asia/Seoul' })
  async tick() {
    try {
      const r = await this.run(new Date());
      if (r.ran && (r.moved > 0 || r.closed > 0)) this.logger.log(`데모 환자 이동 — 이동 ${r.moved} · 떠남 ${r.closed} · 그대로 ${r.unchanged}${r.capped ? ' · 상한 도달(다음 주기)' : ''}`);
    } catch (e) {
      this.logger.warn(`데모 환자 이동 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async run(now: Date): Promise<DemoMovementResult> {
    const empty = { planned: 0, moved: 0, unchanged: 0, closed: 0, skippedObserved: 0, capped: false };
    if (this.running) return { ran: false, reason: 'ALREADY_RUNNING', ...empty };
    // 🔴 모드를 모르면(서비스 없음) 돌지 않는다 — 안전측
    const mode = this.hisMode ? await this.hisMode.effective() : 'REAL';
    if (mode === 'REAL') return { ran: false, reason: 'REAL_MODE', ...empty };
    if (!(await this.demo.isEnabled())) return { ran: false, reason: 'DEMO_DISABLED', ...empty };
    this.running = true;
    try {
      return await this.sync(now);
    } finally {
      this.running = false;
    }
  }

  private async sync(now: Date): Promise<DemoMovementResult> {
    const todayStart = parseLocalDate(localDateKey(now))!;
    const [zones, rooms, queue, admissions, er, surgeries, pacu] = await Promise.all([
      this.prisma.spaceNode.findMany({
        where: { spaceType: { in: ['RECEPTION', 'WAITING', 'CLINIC', 'LAB', 'IMAGING', 'CASHIER', 'PHARMACY', 'ER', 'SURGERY', 'RECOVERY', 'WARD_ROOM'] } },
        select: { id: true, floor: true, spaceType: true, department: true, code: true },
      }),
      this.prisma.clinicRoom.findMany({ where: { spaceNodeId: { not: null } }, select: { name: true, spaceNodeId: true } }),
      this.prisma.waitingQueue.findMany({
        where: { checkedInAt: { gte: todayStart }, status: { in: ['WAITING', 'CALLED', 'IN_PROGRESS', 'COMPLETED'] } },
        select: { patientId: true, status: true, roomName: true, departmentName: true, checkedInAt: true, completedAt: true },
      }),
      this.prisma.admission.findMany({
        where: { status: 'ADMITTED' },
        select: { patientId: true, bed: { select: { roomNumber: true, ward: { select: { floor: true } } } } },
      }),
      this.prisma.emergencyVisit.findMany({ where: { arrivalAt: { gte: todayStart }, status: { in: ER_ACTIVE } }, select: { patientId: true } }),
      this.prisma.surgery.findMany({ where: { status: 'IN_PROGRESS' as never }, select: { patientId: true } }),
      this.prisma.pacuRecord.findMany({ where: { dischargeTime: null, arrivalTime: { gte: todayStart } }, select: { patientId: true } }),
    ]);
    const plan = planDemoPositions({
      now,
      zones: zones as ZoneRef[],
      clinicRoomZone: new Map(rooms.map((r) => [r.name, r.spaceNodeId!])),
      queue,
      inpatients: admissions.map((a) => ({ patientId: a.patientId, wardFloor: a.bed?.ward?.floor ?? null, roomNumber: a.bed?.roomNumber ?? null })),
      er, surgeries, pacu,
    });

    // 지금 열린 위치 — 계획 대상 + 이 생성기가 연 시뮬레이션(떠난 환자를 닫기 위해)
    const open = await this.prisma.patientLocation.findMany({
      where: { leftAt: null, OR: [{ patientId: { in: [...plan.keys()] } }, { source: 'SIMULATED', eventType: DEMO_MOVEMENT_EVENT }] },
      orderBy: { enteredAt: 'desc' },
      select: { patientId: true, zoneId: true, source: true, eventType: true },
    });
    const latest = new Map<string, (typeof open)[number]>();
    for (const o of open) if (!latest.has(o.patientId)) latest.set(o.patientId, o);

    const r: DemoMovementResult = { ran: true, planned: plan.size, moved: 0, unchanged: 0, closed: 0, skippedObserved: 0, capped: false };
    let writes = 0;
    for (const [patientId, p] of plan) {
      const cur = latest.get(patientId);
      if (cur && isObservedLocation(cur.source)) { r.skippedObserved++; continue; } // 관측이 이긴다
      if (cur && cur.zoneId === p.zoneId) { r.unchanged++; continue; }
      if (writes >= MAX_WRITES_PER_RUN) { r.capped = true; break; }
      await this.floor.recordLocation({
        patientId, zoneId: p.zoneId, source: 'SIMULATED', granularity: 'ZONE', status: p.status,
        eventType: DEMO_MOVEMENT_EVENT, metadata: { demo: true, simulated: true, reason: p.reason },
      });
      writes++; r.moved++;
    }
    // 이 생성기가 놓았는데 지금은 계획에 없는 환자 — 떠났다(진료·수납 끝·퇴원)
    for (const [patientId, cur] of latest) {
      if (plan.has(patientId)) continue;
      if (cur.source !== 'SIMULATED' || cur.eventType !== DEMO_MOVEMENT_EVENT) continue;
      if (writes >= MAX_WRITES_PER_RUN) { r.capped = true; break; }
      await this.floor.closeOpenLocations({ patientId, closedBy: DEMO_MOVEMENT_EVENT, closeSource: 'SIMULATED' });
      writes++; r.closed++;
    }
    r.wifi = await this.simulateWifi(plan, latest, now);
    return r;
  }

  /**
   * 무선 AP 측위 시뮬레이션 — 계획 위치(방) 안의 점에서 각 AP 가 들었을 RSSI 를 만들고 **실제 수집과 같은 엔진**으로 푼다.
   * 🔴 측위 원장에 출처 SIMULATED · 신호를 만든 방(truthZoneId)을 함께 남긴다 — 엔진 적중률을 분모와 함께 셀 수 있게(실제 병원 정확도가 아니다).
   * 🔴 위치 원장은 건드리지 않는다(이동은 위의 업무 상태 계획이 정한다) · 관측 위치가 열린 환자는 만들지 않는다.
   */
  private async simulateWifi(plan: Map<string, { zoneId: string }>, latest: Map<string, { source: string }>, now: Date): Promise<NonNullable<DemoMovementResult['wifi']>> {
    if (!this.wifi) return { skipped: 'NOT_WIRED' };
    const ctx = await this.wifi.context();
    if (ctx.apList.length === 0) return { skipped: 'NO_ACCESS_POINTS' };
    if (ctx.zoneRect.size === 0) return { skipped: 'NO_GEOMETRY' };
    const bucket = Math.floor(now.getTime() / TICK_MS);
    let fixes = 0, failed = 0;
    for (const [patientId, p] of plan) {
      if (fixes + failed >= MAX_WIFI_FIXES_PER_RUN) break;
      const cur = latest.get(patientId);
      if (cur && isObservedLocation(cur.source)) continue;
      const zr = ctx.zoneRect.get(p.zoneId);
      if (!zr) continue; // 도면에 없는 방 — 점을 지어내지 않는다
      const seed = `${patientId}:${bucket}`;
      const truth = {
        floorLevel: zr.floorLevel,
        x: zr.rect.x + zr.rect.w * (0.15 + 0.7 * wifiDemoNoise(`${seed}:x`)),
        y: zr.rect.y + zr.rect.h * (0.15 + 0.7 * wifiDemoNoise(`${seed}:y`)),
      };
      const solved = this.wifi.solve(simulateWifiReadings(truth, ctx.apList, seed), ctx);
      if (!solved.ok) { failed++; continue; }
      await this.wifi.storeFix({
        deviceHash: WifiPositioningService.hashDevice(`demo:${patientId}`), patientId, bindingId: null, collectorId: null,
        observedAt: now, fix: solved.fix, source: 'SIMULATED', truthZoneId: p.zoneId,
      }, ctx);
      fixes++;
    }
    const pruned = await this.prisma.wifiPositionFix.deleteMany({
      where: { source: 'SIMULATED', collectorId: null, bindingId: null, observedAt: { lt: new Date(now.getTime() - SIM_FIX_KEEP_HOURS * 3600_000) } },
    });
    return { fixes, failed, pruned: pruned.count };
  }
}
