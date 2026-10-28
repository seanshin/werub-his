import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Subject, Observable, merge, interval, map, filter } from 'rxjs';
import type { LocationGranularity, LocationSource } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { currentLocationScope } from './current-location';

/** 기하가 어디서 왔는가 — 시드 격자 표식이 없는 bounds 는 "기록 안 됨", bounds 가 없어 기본 상자를 준 것은 FALLBACK_DEFAULT */
function boundsSourceOf(meta: unknown): string {
  const m = (meta ?? {}) as { bounds?: unknown; geometrySource?: string };
  if (!m.bounds) return 'FALLBACK_DEFAULT';
  return m.geometrySource ?? 'UNRECORDED';
}

@Injectable()
export class FloorService {
  private readonly logger = new Logger(FloorService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 🔴 환자 위치 원장의 **유일한 쓰기 경로**(P0-3) — QR 체크인·여정 추정·검진 스테이션이 모두 여기를 지난다.
   *   ① 열린 위치를 닫는다(체류 분 `duration` 을 채운다 — 종전 여정 경로는 비웠다)
   *   ② 새 위치를 연다(출처·해상도를 반드시 밝힌다 — 관측과 추정을 같은 모양으로 넣지 않는다)
   *   ③ 층 보드 SSE 로 이동을 알린다(실패는 warn — 위치 기록은 이미 끝났으니 되돌리지 않는다)
   */
  /**
   * 🔴 (2026-10-03) 한 환자에 대한 위치 쓰기는 줄을 선다 — 같은 순간 들어온 사건 둘(응급 도착·분류 등)이 서로의
   *    열린 위치를 못 본 채 각자 열어 **열린 위치가 둘**인 환자가 운영에 18명 있었다("한 환자 한 현재 위치"가 깨짐).
   *    환자별 트랜잭션 잠금(다른 환자와는 막지 않는다).
   */
  private lockPatient(tx: Prisma.TransactionClient, patientId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`patient_location:${patientId}`}))`;
  }

  async recordLocation(input: {
    patientId: string;
    zoneId: string;
    source: LocationSource;
    /** ZONE|FLOOR — 호출자가 밝힌다(서버 기본값 없음 · 저장 기본값 가드) */
    granularity: LocationGranularity;
    status: string;
    eventType?: string | null;
    eventId?: string | null;
    metadata?: Prisma.InputJsonValue;
  }) {
    const now = new Date();
    const { prev, created } = await this.prisma.$transaction(async (tx) => {
      await this.lockPatient(tx, input.patientId);
      const open = await tx.patientLocation.findMany({
        where: { patientId: input.patientId, leftAt: null },
        orderBy: { enteredAt: 'desc' },
        select: { id: true, zoneId: true, enteredAt: true },
      });
      for (const o of open) {
        await tx.patientLocation.update({
          where: { id: o.id },
          data: { leftAt: now, duration: Math.max(0, Math.round((now.getTime() - o.enteredAt.getTime()) / 60000)) }, // QR 경로의 종전 규칙(반올림 분) 유지
        });
      }
      const created = await tx.patientLocation.create({
        data: {
          patientId: input.patientId,
          zoneId: input.zoneId,
          source: input.source,
          granularity: input.granularity,
          status: input.status,
          eventType: input.eventType ?? null,
          eventId: input.eventId ?? null,
          metadata: input.metadata,
        },
      });
      return { prev: open[0] ?? null, created };
    });
    await this.emitMovement(input.patientId, prev?.zoneId ?? null, input.zoneId);
    return created;
  }

  /**
   * 열린 위치를 **새 위치 없이** 닫는다(2026-10-03) — 환자가 병원 공간을 떠났다는 업무 사실이 있을 때만.
   *
   * 🔴 종전엔 위치가 새 위치가 열릴 때만 닫혔다 — 떠난 환자의 마지막 위치가 영영 "현재"로 남았다(운영 열린 위치 69 중
   *    대부분이 7~9월 추정 위치). 퇴원은 오히려 "로비에 있다(완료)"를 새로 열었다.
   * 🔴 닫는 시각 = 그 업무 사실이 기록된 시각(퇴원 처리 등) — 실제로 문을 나선 시각은 모른다. 그래서 행에 **닫은 근거**를 남긴다
   *    (`metadata.closedBy`·`closeSource: INFERRED_EVENT`) — 관측한 퇴장과 같은 모양으로 넣지 않는다.
   * 2026-10-03 결정: 외래 끝 = 수납 완료(D8) · 응급 퇴실 = 퇴실 시각 칸(D9) — 두 사건도 여기로 닫는다. 처분 결정은 여전히 퇴실이 아니다.
   * `at` — 떠난 시각을 업무 원장이 알면(응급 퇴실 시각 등) 그 시각으로 닫는다. 그 시각보다 **뒤에 들어온** 열린 기록은
   *   이 떠남과 무관한 기록이라 건드리지 않는다(음의 체류를 만들지 않는다).
   */
  async closeOpenLocations(input: { patientId: string; closedBy: string; eventRef?: string | null; at?: Date | null; closeSource: 'INFERRED_EVENT' | 'SIMULATED' }) {
    const now = input.at ?? new Date();
    const closed = await this.prisma.$transaction(async (tx) => {
      await this.lockPatient(tx, input.patientId);
      const open = await tx.patientLocation.findMany({
        where: { patientId: input.patientId, leftAt: null, enteredAt: { lte: now } },
        orderBy: { enteredAt: 'desc' },
        select: { id: true, zoneId: true, enteredAt: true, metadata: true },
      });
      for (const o of open) {
        const prevMeta = o.metadata && typeof o.metadata === 'object' && !Array.isArray(o.metadata) ? (o.metadata as Record<string, unknown>) : {};
        await tx.patientLocation.update({
          where: { id: o.id },
          data: {
            leftAt: now,
            duration: Math.max(0, Math.round((now.getTime() - o.enteredAt.getTime()) / 60000)),
            metadata: { ...prevMeta, closedBy: input.closedBy, closeSource: input.closeSource, ...(input.eventRef ? { closeRef: input.eventRef } : {}) } as Prisma.InputJsonValue,
          },
        });
      }
      return open;
    });
    if (closed[0]) await this.emitLeave(input.patientId, closed[0].zoneId);
    return { closed: closed.length };
  }

  // [clinic-floor P3] #2 실시간 이동 이벤트 스트림
  private readonly events$ = new Subject<{ floorId: string; payload: MessageEvent }>();

  getEventStream(floorId: string): Observable<MessageEvent> {
    const stream = this.events$.asObservable().pipe(
      filter((e) => e.floorId === floorId),
      map((e) => e.payload),
    );
    const heartbeat = interval(15000).pipe(map(() => ({ type: 'ping', data: '{}' } as MessageEvent)));
    return merge(stream, heartbeat);
  }

  /** PatientLocation 변경 시 호출 — 이동/입장 이벤트 발행 (best-effort) */
  async emitMovement(patientId: string, fromZoneId: string | null, toZoneId: string) {
    try {
      const toZone = await this.prisma.spaceNode.findUnique({
        where: { id: toZoneId }, select: { code: true, id: true, floor: true, parentId: true },
      });
      if (!toZone) return;
      const floorId = await this.resolveFloorCode(toZone);
      if (!floorId) return;

      let fromCode: string | null = null;
      if (fromZoneId) {
        const fz = await this.prisma.spaceNode.findUnique({ where: { id: fromZoneId }, select: { code: true, id: true } });
        fromCode = fz?.code ?? fz?.id ?? null;
      }
      const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { mrn: true } });
      const entityId = `p-${patient?.mrn ?? patientId.substring(0, 8)}`;
      const data: Record<string, unknown> = {
        entityId, entityType: 'patient', toZone: toZone.code ?? toZone.id, at: new Date().toISOString(),
      };
      if (fromCode) data.fromZone = fromCode;
      this.events$.next({ floorId, payload: { type: fromCode ? 'move' : 'enter', data } as MessageEvent });
    } catch (err) {
      // 🔴 종전 `catch { /* 무시 */ }` — 층 보드가 조용히 멈춰도 흔적이 없었다. 위치 기록은 끝났으니 막지 않고 남긴다.
      this.logger.warn(`Floor movement emit failed (patient ${patientId}, zone ${toZoneId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 퇴장(leave) 이벤트 — 마지막 위치 종료 시 */
  async emitLeave(patientId: string, fromZoneId: string) {
    try {
      const fz = await this.prisma.spaceNode.findUnique({
        where: { id: fromZoneId }, select: { code: true, id: true, floor: true, parentId: true },
      });
      if (!fz) return;
      const floorId = await this.resolveFloorCode(fz);
      if (!floorId) return;
      const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { mrn: true } });
      const entityId = `p-${patient?.mrn ?? patientId.substring(0, 8)}`;
      this.events$.next({
        floorId,
        payload: { type: 'leave', data: { entityId, entityType: 'patient', fromZone: fz.code ?? fz.id, at: new Date().toISOString() } } as MessageEvent,
      });
    } catch (err) {
      this.logger.warn(`Floor leave emit failed (patient ${patientId}, zone ${fromZoneId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async resolveFloorCode(zone: { floor: number | null; parentId: string | null }): Promise<string | null> {
    if (zone.floor != null) {
      const f = await this.prisma.spaceNode.findFirst({ where: { nodeType: 'FLOOR', floor: zone.floor }, select: { code: true, id: true } });
      if (f) return f.code ?? f.id;
    }
    let pid = zone.parentId;
    for (let i = 0; i < 3 && pid; i++) {
      const n: { nodeType: string; code: string | null; id: string; parentId: string | null } | null =
        await this.prisma.spaceNode.findUnique({ where: { id: pid }, select: { nodeType: true, code: true, id: true, parentId: true } });
      if (!n) break;
      if (n.nodeType === 'FLOOR') return n.code ?? n.id;
      pid = n.parentId;
    }
    return null;
  }

  // #1 층 목록
  async getFloorPlans() {
    const floors = await this.prisma.spaceNode.findMany({
      where: { nodeType: 'FLOOR', isActive: true },
      orderBy: { floor: 'asc' },
      include: { _count: { select: { children: true } } },
    });
    return {
      floors: floors.map(f => ({
        id: f.code ?? f.id,
        name: f.name,
        description: f.metadata ? (f.metadata as any).description ?? '' : '',
        zoneCount: f._count.children,
        hasMapData: true,
      })),
    };
  }

  // #2 층 평면도 데이터
  async getFloorPlan(floorId: string) {
    const floorNode = await this.findFloorNode(floorId);
    if (!floorNode) return null;
    return {
      floorId: floorNode.code ?? floorNode.id,
      name: floorNode.name,
      grid: (floorNode.metadata as any)?.grid ?? { cols: 40, rows: 30 },
      walls: (floorNode.metadata as any)?.walls ?? [],
      doors: (floorNode.metadata as any)?.doors ?? [],
      backgroundImage: (floorNode.metadata as any)?.backgroundImage ?? null,
      updatedAt: floorNode.updatedAt,
    };
  }

  // #3 구역 목록
  async getZones(floorId: string) {
    const floorNode = await this.findFloorNode(floorId);
    if (!floorNode) return { zones: [] };

    const zones = await this.prisma.spaceNode.findMany({
      where: { parentId: floorNode.id, isActive: true, nodeType: { in: ['WING', 'ZONE'] } },
      orderBy: { sortOrder: 'asc' },
    });

    return {
      zones: zones.map(z => ({
        id: z.code ?? z.id,
        name: z.name,
        type: this.mapSpaceTypeToClinicType(z.spaceType),
        capacity: z.capacity ?? 0,
        // 🔴 계약(clinic-floor)상 폴백 상자는 유지하되 **지어낸 값임을 함께 싣는다**
        bounds: (z.metadata as any)?.bounds ?? { x: 0, y: 0, w: 4, h: 3 },
        boundsSource: boundsSourceOf(z.metadata),
        color: z.color ?? this.getDefaultColor(z.spaceType),
      })),
    };
  }

  // #4 현재 환자/의료진 위치
  async getEntities(floorId: string, type?: string) {
    const floorNode = await this.findFloorNode(floorId);
    if (!floorNode) return { entities: [], totalPatients: 0, totalStaff: 0 };

    // 이 층의 zone ID 목록
    const zoneIds = await this.getZoneIds(floorNode.id);

    // 현재 위치 — 정본 판정(열린 기록 중 오늘 들어왔거나 재원·응급 진행 중 · current-location.ts)
    const scope = await currentLocationScope(this.prisma);
    const locations = await this.prisma.patientLocation.findMany({
      where: { zoneId: { in: zoneIds }, ...scope.current },
    });

    // 환자 정보 조회
    const patientIds = [...new Set(locations.map(l => l.patientId))];
    const patients = patientIds.length ? await this.prisma.patient.findMany({
      where: { id: { in: patientIds } },
      select: { id: true, familyName: true, givenName: true, mrn: true },
    }) : [];
    const patientMap = new Map(patients.map(p => [p.id, p]));

    // zone 이름 매핑
    const zones = await this.prisma.spaceNode.findMany({
      where: { id: { in: zoneIds } },
      select: { id: true, code: true, spaceType: true, department: true },
    });
    const zoneMap = new Map(zones.map(z => [z.id, z]));

    const entities = locations.map(loc => {
      const patient = patientMap.get(loc.patientId);
      const zone = zoneMap.get(loc.zoneId);
      const waitMinutes = Math.floor((Date.now() - loc.enteredAt.getTime()) / 60000);
      const name = patient ? `${patient.familyName}O${patient.givenName?.substring(1) ?? ''}` : '알 수 없음';

      return {
        id: `p-${patient?.mrn ?? loc.patientId.substring(0, 8)}`,
        type: 'patient' as const,
        label: name,
        zoneId: zone?.code ?? loc.zoneId,
        status: loc.status,
        waitMinutes,
        arrivedAt: loc.enteredAt.toISOString(),
        department: zone?.department ?? null,
        locationSource: loc.source, // 관측(OBSERVED_*)·추정(INFERRED_EVENT)·시뮬레이션 — 화면이 같은 모양으로 그리지 않게
      };
    }).filter(e => !type || e.type === type);

    // 층까지만 아는 위치(FLOOR 해상도)는 구역 칸에 그리지 않는다 — 대신 수를 숨기지 않는다
    const floorOnly = await this.prisma.patientLocation.count({ where: { zoneId: floorNode.id, ...scope.current } });
    // 오래된 열린 기록(떠났는지 모름) — 그리지 않고 수만 말한다
    const staleOpen = await this.prisma.patientLocation.count({ where: { zoneId: { in: [...zoneIds, floorNode.id] }, ...scope.stale } });

    return {
      entities,
      totalPatients: entities.filter(e => e.type === 'patient').length,
      patientsZoneUnknown: floorOnly,
      staleOpen,
      totalStaff: 0,
      timestamp: new Date().toISOString(),
    };
  }

  // #6 구역별 실시간 통계
  async getStats(floorId: string) {
    const floorNode = await this.findFloorNode(floorId);
    if (!floorNode) return { stats: [] };

    const zones = await this.prisma.spaceNode.findMany({
      where: { parentId: floorNode.id, isActive: true, nodeType: { in: ['WING', 'ZONE'] } },
    });
    const zoneIds = zones.map(z => z.id);

    const scope = await currentLocationScope(this.prisma);
    const locations = await this.prisma.patientLocation.findMany({
      where: { zoneId: { in: zoneIds }, ...scope.current },
    });

    // 오늘 전체 (todayTotal)
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayLocations = await this.prisma.patientLocation.findMany({
      where: { zoneId: { in: zoneIds }, enteredAt: { gte: today } },
    });

    const stats = zones.map(z => {
      const current = locations.filter(l => l.zoneId === z.id);
      const todayAll = todayLocations.filter(l => l.zoneId === z.id);
      const currentCount = current.length;
      const capacity = z.capacity ?? 1;
      const waitTimes = current.map(l => Math.floor((Date.now() - l.enteredAt.getTime()) / 60000));
      // 🔴 (2026-09-17 L4) 대기 표본 0 = 산출 불가. 같은 객체의 maxWait 도 표본이 없으면 의미가 없다.
      const avgWait = waitTimes.length ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : null;
      const maxWait = waitTimes.length ? Math.max(...waitTimes) : 0;

      let congestion = 'low';
      if (currentCount >= capacity) congestion = 'critical';
      else if (currentCount >= capacity * 0.7) congestion = 'high';
      else if (currentCount >= capacity * 0.3) congestion = 'normal';

      return {
        zoneId: z.code ?? z.id,
        zoneName: z.name,
        currentCount,
        capacity,
        avgWaitMinutes: avgWait,
        maxWaitMinutes: maxWait,
        congestion,
        todayTotal: todayAll.length,
      };
    });

    return { stats, timestamp: new Date().toISOString() };
  }

  // #7 층 전체 요약 (위젯용)
  async getFloorSummary(floorId: string) {
    const floorNode = await this.findFloorNode(floorId);
    if (!floorNode) return null;

    const { stats } = await this.getStats(floorId);
    const totalPatients = stats.reduce((sum, s) => sum + s.currentCount, 0);
    // 🔴 (2026-09-17 L4) 종전엔 **표본이 없어 0 이던 구역까지 분모에 넣어** 층 평균을 희석했다
    //    (전광판 ClinicQueueBoard 가 같은 함정을 이미 겪었다). 표본 있는 구역만으로 평균을 낸다.
    const sampledWaits = stats.map((s) => s.avgWaitMinutes).filter((v): v is number => v != null);
    const avgWait = sampledWaits.length
      ? Math.round(sampledWaits.reduce((sum, v) => sum + v, 0) / sampledWaits.length)
      : null;

    const bottleneck = stats.reduce((max, s) =>
      s.currentCount > (max?.currentCount ?? 0) ? s : max, stats[0] ?? null);

    const overallCongestion = totalPatients > stats.reduce((sum, s) => sum + s.capacity, 0) * 0.7
      ? 'high' : totalPatients > stats.reduce((sum, s) => sum + s.capacity, 0) * 0.3
      ? 'normal' : 'low';

    return {
      floorId: floorNode.code ?? floorNode.id,
      floorName: floorNode.name,
      totalPatients,
      totalStaff: 0,
      avgWaitMinutes: avgWait,
      bottleneck: bottleneck ? {
        zoneId: bottleneck.zoneId,
        zoneName: bottleneck.zoneName,
        currentCount: bottleneck.currentCount,
        avgWaitMinutes: bottleneck.avgWaitMinutes,
      } : null,
      congestion: overallCongestion,
      zonesSummary: stats.map(s => ({
        zoneId: s.zoneId,
        name: s.zoneName,
        count: s.currentCount,
        congestion: s.congestion,
      })),
      timestamp: new Date().toISOString(),
    };
  }

  // #9 환자 이동 이력
  async getEntityHistory(entityId: string, date?: string) {
    // entityId: "p-P2026-0001" 형태 → MRN 추출
    const mrn = entityId.replace('p-', '');
    const patient = await this.prisma.patient.findFirst({
      where: { mrn: { contains: mrn } },
      select: { id: true, familyName: true, givenName: true, mrn: true },
    });
    if (!patient) return null;

    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate); nextDay.setDate(nextDay.getDate() + 1);

    const locations = await this.prisma.patientLocation.findMany({
      where: { patientId: patient.id, enteredAt: { gte: targetDate, lt: nextDay } },
      orderBy: { enteredAt: 'asc' },
    });

    // zone 이름 매핑
    const zoneIds = [...new Set(locations.map(l => l.zoneId))];
    const zones = zoneIds.length ? await this.prisma.spaceNode.findMany({
      where: { id: { in: zoneIds } },
      select: { id: true, name: true, code: true },
    }) : [];
    const zoneMap = new Map(zones.map(z => [z.id, z]));

    const movements = locations.map(l => {
      const zone = zoneMap.get(l.zoneId);
      return {
        zoneId: zone?.code ?? l.zoneId,
        zoneName: zone?.name ?? 'unknown',
        enterAt: l.enteredAt.toISOString(),
        leaveAt: l.leftAt?.toISOString() ?? null,
        durationMinutes: l.duration ?? (l.leftAt ? Math.floor((l.leftAt.getTime() - l.enteredAt.getTime()) / 60000) : Math.floor((Date.now() - l.enteredAt.getTime()) / 60000)),
      };
    });

    const totalMinutes = movements.reduce((s, m) => s + m.durationMinutes, 0);
    const totalWaitMinutes = locations.filter(l => l.status === 'waiting').reduce((s, l) => s + (l.duration ?? 0), 0);

    return {
      entityId,
      type: 'patient',
      label: `${patient.familyName}O${patient.givenName?.substring(1) ?? ''}`,
      department: null,
      date: targetDate.toISOString().split('T')[0],
      movements,
      totalMinutes,
      totalWaitMinutes,
    };
  }

  // ── [clinic-floor P2] #1 존간 전이 집계 (OD Matrix) ──
  async getFlows(floorId: string, windowMinutes = 60, fromIso?: string, toIso?: string) {
    const floorNode = await this.findFloorNode(floorId);
    const base = { floorId, windowMinutes, generatedAt: new Date().toISOString(), flows: [] as unknown[] };
    if (!floorNode) return base;

    const zoneIds = await this.getZoneIds(floorNode.id);
    const end = this.parseDate(toIso) ?? new Date();
    const start = this.parseDate(fromIso) ?? new Date(end.getTime() - windowMinutes * 60000);

    const locs = await this.prisma.patientLocation.findMany({
      where: { zoneId: { in: zoneIds }, enteredAt: { gte: start, lte: end } },
      orderBy: [{ patientId: 'asc' }, { enteredAt: 'asc' }],
      select: { patientId: true, zoneId: true, enteredAt: true, leftAt: true, duration: true },
    });
    const codeMap = await this.getZoneCodeMap(zoneIds);

    const agg = new Map<string, { count: number; durs: number[] }>();
    let prev: (typeof locs)[number] | null = null;
    for (const l of locs) {
      if (prev && prev.patientId === l.patientId && prev.zoneId !== l.zoneId) {
        const fromZone = codeMap.get(prev.zoneId)?.code ?? prev.zoneId;
        const toZone = codeMap.get(l.zoneId)?.code ?? l.zoneId;
        const key = `${fromZone}${toZone}`;
        const dur = prev.duration ?? Math.max(0, Math.round(
          ((prev.leftAt?.getTime() ?? l.enteredAt.getTime()) - prev.enteredAt.getTime()) / 60000));
        const a = agg.get(key) ?? { count: 0, durs: [] };
        a.count++; a.durs.push(dur); agg.set(key, a);
      }
      prev = l;
    }

    const flows = [...agg.entries()].map(([k, a]) => {
      const [fromZone, toZone] = k.split('');
      const sorted = [...a.durs].sort((x, y) => x - y);
      // 🔴 (2026-09-17 L4) 체류 표본 0 = 산출 불가(0 분 체류가 아니다)
      const avg = a.durs.length ? Math.round((a.durs.reduce((s, d) => s + d, 0) / a.durs.length) * 10) / 10 : null;
      const p90 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] : 0;
      return { fromZone, toZone, count: a.count, avgMinutes: avg, p90Minutes: p90 };
    }).sort((x, y) => y.count - x.count);

    return { floorId: floorNode.code ?? floorNode.id, windowMinutes, generatedAt: new Date().toISOString(), flows };
  }

  // ── [clinic-floor P2] #4 층 단위 이력 일괄 (리플레이/OD) ──
  async getFloorHistory(floorId: string, fromIso?: string, toIso?: string, types?: string, cursor?: string) {
    const floorNode = await this.findFloorNode(floorId);
    if (!floorNode) return { floorId, from: fromIso ?? null, to: toIso ?? null, nextCursor: null, entities: [] };

    const zoneIds = await this.getZoneIds(floorNode.id);
    const end = this.parseDate(toIso) ?? new Date();
    const start = this.parseDate(fromIso) ?? new Date(end.getTime() - 24 * 3600 * 1000);
    // 현재 PatientLocation은 환자만 추적 — types에 staff만 지정되면 빈 결과
    if (types && !types.split(',').includes('patient')) {
      return { floorId: floorNode.code ?? floorNode.id, from: start.toISOString(), to: end.toISOString(), nextCursor: null, entities: [] };
    }

    const locs = await this.prisma.patientLocation.findMany({
      where: { zoneId: { in: zoneIds }, enteredAt: { gte: start, lte: end } },
      orderBy: [{ patientId: 'asc' }, { enteredAt: 'asc' }],
    });
    const codeMap = await this.getZoneCodeMap(zoneIds);

    const byPatient = new Map<string, typeof locs>();
    for (const l of locs) {
      const arr = byPatient.get(l.patientId);
      if (arr) arr.push(l); else byPatient.set(l.patientId, [l]);
    }

    // cursor: patientId 기준 페이지네이션
    let patientIds = [...byPatient.keys()].sort();
    if (cursor) patientIds = patientIds.filter((id) => id > cursor);
    const PAGE = 100;
    const pageIds = patientIds.slice(0, PAGE);
    const nextCursor = patientIds.length > PAGE ? pageIds[pageIds.length - 1] : null;

    const patients = pageIds.length ? await this.prisma.patient.findMany({
      where: { id: { in: pageIds } },
      select: { id: true, familyName: true, givenName: true, mrn: true },
    }) : [];
    const pmap = new Map(patients.map((p) => [p.id, p]));

    const entities = pageIds.map((pid) => {
      const p = pmap.get(pid);
      const movements = byPatient.get(pid)!.map((l) => {
        const z = codeMap.get(l.zoneId);
        return {
          zoneId: z?.code ?? l.zoneId,
          zoneName: z?.name ?? 'unknown',
          enterAt: l.enteredAt.toISOString(),
          leaveAt: l.leftAt?.toISOString() ?? null,
          durationMinutes: l.duration ?? (l.leftAt
            ? Math.round((l.leftAt.getTime() - l.enteredAt.getTime()) / 60000)
            : Math.round((Date.now() - l.enteredAt.getTime()) / 60000)),
        };
      });
      return {
        entityId: `p-${p?.mrn ?? pid.substring(0, 8)}`,
        label: p ? `${p.familyName}O${p.givenName?.substring(1) ?? ''}` : '알 수 없음',
        type: 'patient' as const,
        movements,
      };
    });

    return { floorId: floorNode.code ?? floorNode.id, from: start.toISOString(), to: end.toISOString(), nextCursor, entities };
  }

  // ── [clinic-floor P3] #3 존 토폴로지 (인접·경로) ──
  async getTopology(floorId: string) {
    const floorNode = await this.findFloorNode(floorId);
    if (!floorNode) return { floorId, nodes: [], edges: [] };
    const zones = await this.prisma.spaceNode.findMany({
      where: { parentId: floorNode.id, isActive: true, nodeType: { in: ['WING', 'ZONE'] } },
    });
    const codeOf = (z: { code: string | null; id: string }) => z.code ?? z.id;
    const doorOf = (z: { metadata: unknown }) => {
      const m = z.metadata as any;
      if (m?.door?.x != null) return { x: m.door.x, y: m.door.y };
      const b = m?.bounds ?? { x: 0, y: 0, w: 4, h: 3 };
      return { x: Math.round((b.x + b.w / 2) * 10) / 10, y: Math.round((b.y + b.h / 2) * 10) / 10 };
    };
    /** 문 좌표의 출처 — 기록된 문 / bounds 중심 추정 / bounds 도 없어 기본 상자 중심 */
    const doorSourceOf = (z: { metadata: unknown }) => {
      const m = z.metadata as any;
      if (m?.door?.x != null) return 'RECORDED';
      return m?.bounds ? 'ZONE_CENTER' : 'FALLBACK_DEFAULT';
    };
    const byId = new Map(zones.map((z) => [z.id, z]));
    const byCode = new Map(zones.map((z) => [codeOf(z), z]));
    const nodes = zones.map((z) => ({ zoneId: codeOf(z), door: doorOf(z), doorSource: doorSourceOf(z), boundsSource: boundsSourceOf(z.metadata) }));

    const seen = new Set<string>();
    const edges: unknown[] = [];
    for (const z of zones) {
      const conn = z.connectedTo as any;
      const list = Array.isArray(conn) ? conn : [];
      for (const c of list) {
        const ref = typeof c === 'string' ? c : c?.to ?? c?.zoneId ?? c?.id;
        if (!ref) continue;
        const target = byCode.get(ref) ?? byId.get(ref);
        if (!target) continue;
        const a = codeOf(z), b = codeOf(target);
        const key = [a, b].sort().join('\x01');
        if (seen.has(key)) continue;
        seen.add(key);
        const dA = doorOf(z), dB = doorOf(target);
        const polyline = typeof c === 'object' && Array.isArray(c?.polyline) ? c.polyline : [[dA.x, dA.y], [dB.x, dB.y]];
        const distance = typeof c === 'object' && c?.distance != null
          ? c.distance
          : (z.walkTime ?? Math.round(Math.hypot(dB.x - dA.x, dB.y - dA.y) * 10) / 10);
        // 🔴 `distance` 칸에 세 가지가 섞인다 — 기록된 거리 / 걸음 시간(walkTime·분 — 단위가 다르다) / 좌표 직선거리(격자라면 지어낸 값)
        const distanceSource = typeof c === 'object' && c?.distance != null ? 'RECORDED' : z.walkTime != null ? 'WALK_TIME_MIN' : 'EUCLID_FALLBACK';
        edges.push({ a, b, polyline, distance, distanceSource, bidirectional: true });
      }
    }
    return { floorId: codeOf(floorNode), nodes, edges };
  }

  // ── [clinic-floor P3] #5 존별 SLA/기대치 ──
  async getSla(floorId: string) {
    const floorNode = await this.findFloorNode(floorId);
    if (!floorNode) return { floorId, zones: [] };
    const zones = await this.prisma.spaceNode.findMany({
      where: { parentId: floorNode.id, isActive: true, nodeType: { in: ['WING', 'ZONE'] } },
    });
    const defaultWait: Record<string, number> = {
      WAITING: 15, RECEPTION: 10, CASHIER: 10, CLINIC: 20, LAB: 20,
      PHARMACY: 10, IMAGING: 25, ENDOSCOPY: 30, EKG: 15, PFT: 15,
    };
    const zonesOut = zones.map((z) => {
      const sla = ((z.metadata as any)?.sla ?? {}) as Record<string, unknown>;
      return {
        zoneId: z.code ?? z.id,
        targetWaitMinutes: (sla.targetWaitMinutes as number) ?? defaultWait[z.spaceType] ?? 15,
        targetThroughputPerHour: (sla.targetThroughputPerHour as number) ?? 40,
        maxCapacity: z.capacity ?? (sla.maxCapacity as number) ?? 0,
        ...(Array.isArray(sla.expectedByHour) ? { expectedByHour: sla.expectedByHour } : {}),
      };
    });
    return { floorId: floorNode.code ?? floorNode.id, zones: zonesOut };
  }

  // ── [clinic-floor 선택] #6 흐름 차단/이슈 컨텍스트 ──
  async getIssues(floorId: string) {
    const floorNode = await this.findFloorNode(floorId);
    if (!floorNode) return { issues: [] };
    const issues: Record<string, unknown>[] = [];
    const now = new Date().toISOString();

    // (1) 혼잡 임계 = 흐름 차단 신호 (실데이터)
    const { stats } = await this.getStats(floorId);
    for (const s of stats) {
      if (s.congestion === 'critical') {
        issues.push({ scope: 'zone', zoneId: s.zoneId, type: 'blocked', severity: 'high', since: now, note: `혼잡 임계 (${s.currentCount}/${s.capacity})` });
      }
    }

    // (2) 수동 구성 이슈(metadata.issues) + 장비 다운(equipment)
    const zones = await this.prisma.spaceNode.findMany({
      where: { parentId: floorNode.id, isActive: true, nodeType: { in: ['WING', 'ZONE'] } },
      select: { code: true, id: true, metadata: true, equipment: true },
    });
    for (const z of zones) {
      const zoneId = z.code ?? z.id;
      const m = z.metadata as any;
      if (Array.isArray(m?.issues)) {
        for (const it of m.issues) {
          issues.push({ scope: 'zone', zoneId, type: it.type ?? 'blocked', severity: it.severity ?? 'medium', since: it.since ?? now, note: it.note });
        }
      }
      const eq = z.equipment as any;
      if (Array.isArray(eq)) {
        for (const e of eq) {
          if (e?.status === 'down' || e?.down === true) {
            issues.push({ scope: 'zone', zoneId, type: 'equipment_down', severity: 'high', since: e.since ?? now, note: e.name ? `${e.name} 점검중` : '장비 점검중' });
          }
        }
      }
    }
    return { issues };
  }

  // ── [clinic-floor P4] #8 예약/예정 동선 (Scheduled Flow) ──
  async getSchedule(floorId: string) {
    const floorNode = await this.findFloorNode(floorId);
    if (!floorNode) return { floorId, schedules: [] };
    const zoneIds = await this.getZoneIds(floorNode.id);

    // 현재 이 층 환자 + 현재 존 — 정본 판정(오래된 열린 기록은 현재가 아니다)
    const scope = await currentLocationScope(this.prisma);
    const locs = await this.prisma.patientLocation.findMany({
      where: { zoneId: { in: zoneIds }, ...scope.current },
      orderBy: { enteredAt: 'desc' },
      select: { patientId: true, zoneId: true },
    });
    const currentByPatient = new Map<string, string>();
    for (const l of locs) if (!currentByPatient.has(l.patientId)) currentByPatient.set(l.patientId, l.zoneId);
    const patientIds = [...currentByPatient.keys()];
    if (!patientIds.length) return { floorId: floorNode.code ?? floorNode.id, schedules: [] };

    const floorZones = await this.prisma.spaceNode.findMany({ where: { id: { in: zoneIds } }, select: { id: true, code: true } });
    const floorCodeById = new Map(floorZones.map((z) => [z.id, z.code ?? z.id]));
    const allZones = await this.prisma.spaceNode.findMany({
      where: { nodeType: { in: ['ZONE', 'WING'] }, isActive: true },
      select: { code: true, id: true, spaceType: true, department: true, floor: true },
    });
    const floorNum = floorNode.floor;
    const zoneBySpaceType = (st: string) => {
      const c = allZones.filter((z) => z.spaceType === st);
      return c.find((z) => z.floor === floorNum) ?? c[0];
    };
    const clinicByDept = (dept?: string | null) => {
      const c = allZones.filter((z) => z.spaceType === 'CLINIC' && (!dept || z.department === dept));
      return c.find((z) => z.floor === floorNum) ?? c[0];
    };
    const DEPT_ST: Record<string, string> = { PHARMACY: 'PHARMACY', LAB: 'LAB', IMAGING: 'IMAGING', THERAPY: 'THERAPY' };
    const ORDER_TYPE: Record<string, string> = { PHARMACY: 'pharmacy', LAB: 'lab', IMAGING: 'imaging', THERAPY: 'therapy' };

    interface Sched { currentZone: string; nextZone: string; scheduledAt: string; orderType: string; status: string; at: number }
    const byPatient = new Map<string, Sched>();
    const consider = (pid: string, nextCode: string | undefined, at: Date, orderType: string, status: string) => {
      if (!nextCode) return;
      const cur = floorCodeById.get(currentByPatient.get(pid)!) ?? currentByPatient.get(pid)!;
      const s: Sched = { currentZone: cur, nextZone: nextCode, scheduledAt: at.toISOString(), orderType, status, at: at.getTime() };
      const ex = byPatient.get(pid);
      if (!ex || s.at < ex.at) byPatient.set(pid, s); // 가장 임박한 것
    };

    const now = new Date();
    // 예약(consult)
    const appts = await this.prisma.appointment.findMany({
      where: { patientId: { in: patientIds }, status: 'SCHEDULED', scheduledAt: { gte: now } },
      include: { doctor: { select: { department: true } } },
    });
    for (const a of appts) consider(a.patientId, clinicByDept(a.doctor?.department)?.code ?? undefined, a.scheduledAt, 'consult', 'scheduled');

    // 오더(lab/imaging/pharmacy/therapy)
    const orders = await this.prisma.order.findMany({
      where: { status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] }, prescription: { encounter: { patientId: { in: patientIds } } } },
      include: { prescription: { select: { encounter: { select: { patientId: true } } } } },
    });
    for (const o of orders) {
      const pid = o.prescription?.encounter?.patientId;
      if (!pid || !currentByPatient.has(pid)) continue;
      const z = zoneBySpaceType(DEPT_ST[o.department]);
      consider(pid, z?.code ?? undefined, o.createdAt, ORDER_TYPE[o.department] ?? 'order', o.status === 'ORDERED' ? 'ordered' : 'in_progress');
    }

    const ids = [...byPatient.keys()];
    const patients = ids.length ? await this.prisma.patient.findMany({ where: { id: { in: ids } }, select: { id: true, mrn: true } }) : [];
    const mrn = new Map(patients.map((p) => [p.id, p.mrn]));
    const schedules = ids.map((pid) => {
      const s = byPatient.get(pid)!;
      return {
        entityId: `p-${mrn.get(pid) ?? pid.substring(0, 8)}`,
        currentZone: s.currentZone,
        nextZone: s.nextZone,
        scheduledAt: s.scheduledAt,
        orderType: s.orderType,
        status: s.status,
      };
    });
    return { floorId: floorNode.code ?? floorNode.id, schedules };
  }

  // ── helpers ──

  private parseDate(iso?: string): Date | null {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  private async getZoneCodeMap(zoneIds: string[]): Promise<Map<string, { code: string; name: string }>> {
    if (!zoneIds.length) return new Map();
    const zones = await this.prisma.spaceNode.findMany({
      where: { id: { in: zoneIds } },
      select: { id: true, code: true, name: true },
    });
    return new Map(zones.map((z) => [z.id, { code: z.code ?? z.id, name: z.name }]));
  }

  private async findFloorNode(floorId: string) {
    // floorId: "1f", "2f" 등 → floor 번호 추출
    const floorNum = parseInt(floorId.replace(/[^-\d]/g, ''));
    return this.prisma.spaceNode.findFirst({
      where: {
        OR: [
          { code: floorId },
          { floor: isNaN(floorNum) ? undefined : floorNum, nodeType: 'FLOOR' },
        ],
        nodeType: 'FLOOR',
      },
    });
  }

  private async getZoneIds(floorNodeId: string): Promise<string[]> {
    const children = await this.prisma.spaceNode.findMany({
      where: { parentId: floorNodeId, isActive: true },
      select: { id: true },
    });
    // 재귀 1단계 (wing → zone)
    const grandChildren = children.length ? await this.prisma.spaceNode.findMany({
      where: { parentId: { in: children.map(c => c.id) }, isActive: true },
      select: { id: true },
    }) : [];
    return [...children.map(c => c.id), ...grandChildren.map(c => c.id)];
  }

  private mapSpaceTypeToClinicType(spaceType: string): string {
    const map: Record<string, string> = {
      LOBBY: 'other', RECEPTION: 'reception', CASHIER: 'reception',
      WAITING: 'waiting', CLINIC: 'treatment', NURSE_STATION: 'nurse_station',
      LAB: 'lab', EKG: 'lab', PFT: 'lab', EEG: 'lab',
      IMAGING: 'lab', ENDOSCOPY: 'lab',
      PHARMACY: 'pharmacy', WARD_ROOM: 'ward', WARD_BED: 'ward',
      SURGERY: 'surgery', ER: 'other', ER_BED: 'other',
      ICU: 'ward', TRIAGE: 'other',
    };
    return map[spaceType] ?? 'other';
  }

  private getDefaultColor(spaceType: string): string {
    const map: Record<string, string> = {
      RECEPTION: '#3B82F6', CASHIER: '#3B82F6',
      WAITING: '#F59E0B', CLINIC: '#10B981',
      LAB: '#8B5CF6', PHARMACY: '#EF4444',
      SURGERY: '#DC2626', WARD_ROOM: '#3B82F6',
      ER: '#DC2626', ICU: '#DC2626',
      NURSE_STATION: '#10B981',
    };
    return map[spaceType] ?? '#6B7280';
  }
}
