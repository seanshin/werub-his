import { BadRequestException, Injectable } from '@nestjs/common';
import { dayRange } from '../../common/day-range';
import { Prisma } from '@prisma/client';
import { DWELL_MIN_SAMPLE, DWELL_WINDOW_DAYS, OBSERVED_LOCATION_SOURCES, isObservedLocation } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { currentLocationScope } from '../floor/current-location';

@Injectable()
export class MetaverseService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 층별 안내(시설 안내 화면용) — 공간 정본(SpaceNode)의 층·구역 **이름만**. 환자 수·위치·좌표를 싣지 않는다.
   * 🔴 (2026-09-28 P0-5) 시설 안내의 층 구성이 코드 상수(검진센터 7층)였고 공간 모델(B1)·환자 앱과 갈라져 있었다.
   *    층 구성은 이 정본에서, 시설 상세(가격·운영시간)는 결정 `policy.facilityInfo.floorGuide` 대기 중인 예시로 남는다.
   */
  async getDirectory() {
    const nodes = await this.prisma.spaceNode.findMany({
      where: { isActive: true },
      select: { id: true, nodeType: true, name: true, code: true, floor: true, roomNumber: true, spaceType: true, department: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const floors = nodes.filter((n) => n.nodeType === 'FLOOR').sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0));
    return floors.map((f) => ({
      id: f.id,
      code: f.code,
      name: f.name,
      floor: f.floor,
      zones: nodes
        .filter((n) => (n.nodeType === 'ZONE' || n.nodeType === 'WING') && n.floor === f.floor)
        .map((z) => ({ id: z.id, name: z.name, roomNumber: z.roomNumber, spaceType: z.spaceType, department: z.department })),
    }));
  }

  /** 병원 전체 구조 (층별 구역) */
  async getStructure() {
    const nodes = await this.prisma.spaceNode.findMany({
      where: { isActive: true },
      orderBy: [{ floor: 'asc' }, { sortOrder: 'asc' }],
    });

    // Group by floor
    const floorMap = new Map<number, typeof nodes>();
    for (const node of nodes) {
      const floor = node.floor ?? 0;
      if (!floorMap.has(floor)) floorMap.set(floor, []);
      floorMap.get(floor)!.push(node);
    }

    return {
      hospitalName: 'Hospital RUN',
      totalZones: nodes.length,
      floors: Array.from(floorMap.entries()).map(([floor, zones]) => ({
        floor,
        name: `${floor}층`,
        zones: zones.map(z => ({
          id: z.id,
          name: z.name,
          zoneType: z.spaceType,
          department: z.department,
          roomNumber: z.roomNumber,
          capacity: z.capacity,
          color: z.color,
          icon: z.icon,
          coordinates: z.metadata as Record<string, unknown> | null,
          equipment: z.equipment,
        })),
      })),
    };
  }

  /**
   * 현재 환자 위치 현황 — 정본 판정(`current-location.ts`) · 오래된 열린 기록은 싣지 않고 수(`meta.staleOpen`)로 말한다.
   * 상한 500 — 넘으면 `meta.truncated`.
   */
  async getPatientLocations(floor?: number) {
    const scope = await currentLocationScope(this.prisma);
    const [locations, total, staleOpen] = await Promise.all([
      this.prisma.patientLocation.findMany({ where: scope.current, orderBy: { enteredAt: 'desc' }, take: 500 }),
      this.prisma.patientLocation.count({ where: scope.current }),
      this.prisma.patientLocation.count({ where: scope.stale }),
    ]);
    const meta = { rule: 'TODAY_OR_ACTIVE_STAY', since: scope.since.toISOString(), staleOpen, truncated: total > locations.length, total };

    // Get patient info
    const patientIds = [...new Set(locations.map(l => l.patientId))];
    const patients = patientIds.length > 0
      ? await this.prisma.patient.findMany({
          where: { id: { in: patientIds } },
          select: { id: true, mrn: true, familyName: true, givenName: true },
        })
      : [];
    const patientMap = new Map(patients.map(p => [p.id, p]));

    // Get zone info for floor filtering
    const zoneIds = [...new Set(locations.map(l => l.zoneId))];
    const zones = zoneIds.length > 0
      ? await this.prisma.spaceNode.findMany({
          where: { id: { in: zoneIds } },
          select: { id: true, name: true, floor: true, spaceType: true, department: true },
        })
      : [];
    const zoneMap = new Map(zones.map(z => [z.id, z]));

    let result = locations.map(l => {
      const patient = patientMap.get(l.patientId);
      const zone = zoneMap.get(l.zoneId);
      return {
        id: l.id,
        patientId: l.patientId,
        patientName: patient ? `${patient.familyName}${patient.givenName}` : '',
        mrn: patient?.mrn,
        zoneId: l.zoneId,
        zoneName: zone?.name,
        zoneType: zone?.spaceType,
        floor: zone?.floor,
        department: zone?.department,
        status: l.status,
        enteredAt: l.enteredAt,
        duration: Math.floor((Date.now() - l.enteredAt.getTime()) / 60000),
        // 관측(QR·스테이션)·추정(이벤트 번역)·시뮬레이션 — 화면이 같은 모양으로 그리지 않게(P0-1)
        source: l.source,
        granularity: l.granularity,
      };
    });

    if (floor != null) {
      result = result.filter(r => r.floor === floor);
    }

    return { items: result, meta };
  }

  /** 구역별 혼잡도 히트맵 */
  async getHeatmap() {
    // 층까지만 아는 위치(FLOOR)는 구역 혼잡도에 넣지 않는다 — 어느 구역인지 모른다
    const scope = await currentLocationScope(this.prisma);
    const open = await this.prisma.patientLocation.findMany({
      where: { granularity: 'ZONE', ...scope.current },
      select: { zoneId: true, source: true },
    });
    const byZone = new Map<string, { count: number; observed: number }>();
    for (const o of open) {
      const cur = byZone.get(o.zoneId) ?? { count: 0, observed: 0 };
      cur.count++;
      if (isObservedLocation(o.source)) cur.observed++;
      byZone.set(o.zoneId, cur);
    }
    const locations = [...byZone.entries()].map(([zoneId, v]) => ({ zoneId, ...v }));

    const zoneIds = locations.map(l => l.zoneId);
    const zones = zoneIds.length > 0
      ? await this.prisma.spaceNode.findMany({
          where: { id: { in: zoneIds } },
          select: { id: true, name: true, floor: true, spaceType: true, capacity: true, department: true },
        })
      : [];
    const zoneMap = new Map(zones.map(z => [z.id, z]));

    return locations.map(l => {
      const zone = zoneMap.get(l.zoneId);
      const count = l.count;
      // 🔴 (P0 · 2026-09-28) 종전 `capacity ?? 10` — 정원 미설정 구역의 분모를 지어냈다. 모르면 산출 불가(null·UNKNOWN).
      const capacity = zone?.capacity && zone.capacity > 0 ? zone.capacity : null;
      const occupancy = capacity ? Math.min(Math.round((count / capacity) * 100), 100) : null;
      return {
        zoneId: l.zoneId,
        zoneName: zone?.name,
        zoneType: zone?.spaceType,
        floor: zone?.floor,
        department: zone?.department,
        currentCount: count,
        observedCount: l.observed, // 관측(QR·스테이션) 인원 — 나머지는 이벤트 추정·시뮬레이션
        capacity,
        occupancy,
        level: occupancy == null ? 'UNKNOWN' : occupancy >= 90 ? 'CRITICAL' : occupancy >= 70 ? 'HIGH' : occupancy >= 40 ? 'MEDIUM' : 'LOW',
      };
    }).sort((a, b) => (b.occupancy ?? -1) - (a.occupancy ?? -1));
  }

  /** 환자 동선 이력 */
  async getPatientTrail(patientId: string, date?: string) {
    const where: Record<string, unknown> = { patientId };
    // 🔴 2026-10-09 — 종전엔 `new Date('YYYY-MM-DD')`(UTC 자정)로 잘라 KST 하루가 9시간 밀렸다(오전 9시 전 이동이 전날로 빠짐).
    //    KST 하루 정본(dayRange) · 형식이 틀리면 400
    if (date) {
      const r = dayRange(date, date);
      if (r) where.enteredAt = r;
    }

    const locations = await this.prisma.patientLocation.findMany({
      where,
      orderBy: { enteredAt: 'asc' },
      take: 200,
    });

    const zoneIds = [...new Set(locations.map(l => l.zoneId))];
    const zones = zoneIds.length > 0
      ? await this.prisma.spaceNode.findMany({
          where: { id: { in: zoneIds } },
          select: { id: true, name: true, floor: true, spaceType: true },
        })
      : [];
    const zoneMap = new Map(zones.map(z => [z.id, z]));

    return locations.map(l => {
      const zone = zoneMap.get(l.zoneId);
      return {
        zoneId: l.zoneId,
        zoneName: zone?.name,
        zoneType: zone?.spaceType,
        floor: zone?.floor,
        status: l.status,
        enteredAt: l.enteredAt,
        leftAt: l.leftAt,
        duration: l.duration ?? (l.leftAt ? Math.floor((l.leftAt.getTime() - l.enteredAt.getTime()) / 60000) : null),
        eventType: l.eventType,
        source: l.source,
        granularity: l.granularity,
      };
    });
  }

  /** 층별 실시간 통계 */
  async getFloorStats() {
    const scope = await currentLocationScope(this.prisma);
    const locations = await this.prisma.patientLocation.groupBy({
      by: ['zoneId'],
      where: scope.current,
      _count: { id: true },
    });

    const zoneIds = locations.map(l => l.zoneId);
    const zones = zoneIds.length > 0
      ? await this.prisma.spaceNode.findMany({
          where: { id: { in: zoneIds } },
          select: { id: true, floor: true, spaceType: true },
        })
      : [];
    const zoneMap = new Map(zones.map(z => [z.id, z]));

    const floorStats = new Map<number, { total: number; byType: Record<string, number> }>();
    for (const l of locations) {
      const zone = zoneMap.get(l.zoneId);
      const floor = zone?.floor ?? 0;
      if (!floorStats.has(floor)) floorStats.set(floor, { total: 0, byType: {} });
      const stat = floorStats.get(floor)!;
      stat.total += l._count.id;
      const type = zone?.spaceType ?? 'OTHER';
      stat.byType[type] = (stat.byType[type] ?? 0) + l._count.id;
    }

    return Array.from(floorStats.entries())
      .map(([floor, stat]) => ({ floor, ...stat }))
      .sort((a, b) => a.floor - b.floor);
  }

  /**
   * 구역별 체류 분석(P4b · 기획 spatial-flow-vision-3d) — 완료된 체류(떠난 시각이 있는 행)의 p50/p90(분).
   *
   * 🔴 정직 규칙:
   *   - **관측·추정을 합치지 않는다** — 추정(이벤트 번역)의 체류는 "오더가 난 뒤 다음 이벤트까지"라 체류가 아니다. 별도 열.
   *   - 표본이 `DWELL_MIN_SAMPLE` 미만이면 p50/p90 = null(산출 불가) · 병목 순위는 관측 산출 가능 구역만.
   *   - 시뮬레이션·출처 미상·층 단위(구역 모름) 행은 빼고 **뺀 수를 함께** 낸다.
   *   - 떠난 시각이 들어온 시각보다 이르거나 같은 행은 고치지 않고 `invalid` 로 센다(시드 품질 — 코드로 교정하지 않는다).
   */
  async getDwell(daysRaw?: string) {
    const days = daysRaw == null || daysRaw === '' ? DWELL_WINDOW_DAYS.default : Number(daysRaw);
    if (!Number.isInteger(days) || days < DWELL_WINDOW_DAYS.min || days > DWELL_WINDOW_DAYS.max) {
      throw new BadRequestException({ code: 'DWELL_DAYS_INVALID', min: DWELL_WINDOW_DAYS.min, max: DWELL_WINDOW_DAYS.max });
    }
    const since = new Date(Date.now() - days * 86_400_000);
    const observed = Prisma.join([...OBSERVED_LOCATION_SOURCES]);
    const rows = await this.prisma.$queryRaw<Array<{
      zoneId: string; cls: 'OBSERVED' | 'INFERRED'; n: number; open: number; invalid: number; p50: number | null; p90: number | null;
    }>>`
      SELECT pl.zone_id::text AS "zoneId",
             CASE WHEN pl.source IN (${observed}) THEN 'OBSERVED' ELSE 'INFERRED' END AS cls,
             count(*) FILTER (WHERE pl.left_at > pl.entered_at)::int AS n,
             count(*) FILTER (WHERE pl.left_at IS NULL)::int AS open,
             count(*) FILTER (WHERE pl.left_at IS NOT NULL AND pl.left_at <= pl.entered_at)::int AS invalid,
             round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM pl.left_at - pl.entered_at)) FILTER (WHERE pl.left_at > pl.entered_at) / 60)::numeric)::int AS p50,
             round((percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM pl.left_at - pl.entered_at)) FILTER (WHERE pl.left_at > pl.entered_at) / 60)::numeric)::int AS p90
        FROM patient_locations pl
       WHERE pl.entered_at >= ${since}
         AND pl.granularity = 'ZONE'
         AND (pl.source IN (${observed}) OR pl.source = 'INFERRED_EVENT')
       GROUP BY 1, 2`;
    const excludedRows = await this.prisma.$queryRaw<Array<{ simulated: number; unknown: number; floorOnly: number }>>`
      SELECT count(*) FILTER (WHERE source = 'SIMULATED')::int AS simulated,
             count(*) FILTER (WHERE source = 'UNKNOWN')::int AS unknown,
             count(*) FILTER (WHERE granularity = 'FLOOR' AND source <> 'SIMULATED')::int AS "floorOnly"
        FROM patient_locations WHERE entered_at >= ${since}`;
    const zoneIds = [...new Set(rows.map((r) => r.zoneId))];
    const nodes = zoneIds.length
      ? await this.prisma.spaceNode.findMany({ where: { id: { in: zoneIds } }, select: { id: true, name: true, floor: true } })
      : [];
    const nodeBy = new Map(nodes.map((n) => [n.id, n]));
    const stat = (r?: (typeof rows)[number]) => {
      const n = r?.n ?? 0;
      const ok = n >= DWELL_MIN_SAMPLE;
      return { n, p50: ok ? r!.p50 : null, p90: ok ? r!.p90 : null, open: r?.open ?? 0, invalid: r?.invalid ?? 0 };
    };
    const zones = zoneIds.map((id) => ({
      zoneId: id,
      name: nodeBy.get(id)?.name ?? null,
      floor: nodeBy.get(id)?.floor ?? null,
      observed: stat(rows.find((r) => r.zoneId === id && r.cls === 'OBSERVED')),
      inferred: stat(rows.find((r) => r.zoneId === id && r.cls === 'INFERRED')),
    }));
    // 병목 순위 — 관측 p90 이 산출된 구역만(추정으로 순위를 매기지 않는다)
    zones.sort((a, b) => (b.observed.p90 ?? -1) - (a.observed.p90 ?? -1) || (b.observed.n - a.observed.n) || (b.inferred.n - a.inferred.n));
    const ex = excludedRows[0] ?? { simulated: 0, unknown: 0, floorOnly: 0 };
    return {
      windowDays: days,
      since: since.toISOString(),
      minSample: DWELL_MIN_SAMPLE,
      zones,
      rankedZones: zones.filter((z) => z.observed.p90 != null).length,
      totals: {
        observed: zones.reduce((a, z) => a + z.observed.n, 0),
        inferred: zones.reduce((a, z) => a + z.inferred.n, 0),
      },
      excluded: ex,
    };
  }
}
